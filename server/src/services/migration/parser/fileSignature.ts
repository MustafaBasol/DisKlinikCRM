/**
 * fileSignature.ts — F3-DATA-MIG-TODAY-001
 *
 * Binary signature classification for migration uploads.
 *
 * TRUST RULE: the declared MIME type and the file extension are attacker- (or
 * merely accident-) controlled metadata. They are NEVER used to decide how a
 * buffer is parsed. The BYTES decide. The extension is only ever recorded as a
 * structural observation so that an operator can see, after the fact, that a
 * file named `.xlsx` actually contained an OLE2 compound document.
 *
 * PRIVACY CONTRACT: `FileSignatureResult.detail` and every `MigrationError`
 * detail produced here carry STRUCTURAL facts only — signature family names,
 * ZIP entry counts, byte lengths, limit names. They must NEVER contain a
 * decoded byte range from the file, a ZIP entry name, or the caller's filename
 * verbatim, because these strings are logged and returned to the client.
 *
 * Node built-ins only. The ZIP inspection below is a bounded read of the
 * central directory — nothing is inflated, so a zip bomb cannot be triggered
 * by classification.
 */

import path from 'path';
import {
  MAX_UPLOAD_BYTES,
  MigrationError,
  type DetectedFileKind,
  type SourceFileFormat,
} from '../contracts.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface FileSignatureResult {
  kind: DetectedFileKind;
  /** SAFE structural note. NEVER file content, NEVER the caller's filename. */
  detail: string;
}

/**
 * The full observation `assertSupportedUpload` makes, including the
 * signature-vs-extension comparison.
 *
 * SPEC NOTE: `assertSupportedUpload` is contractually typed to return only a
 * `SourceFileFormat`, so on the ACCEPT path there is no error object to hang a
 * `detail` on. This function is the accessor for that detail; the assert
 * function is a thin wrapper over it. Callers that want to persist / audit the
 * spoofing observation (e.g. `SIGNATURE_XLS_EXTENSION_XLSX`) call this.
 */
export interface UploadInspection {
  format: SourceFileFormat;
  kind: DetectedFileKind;
  /** e.g. 'SIGNATURE_XLS_EXTENSION_XLSX'. Structural, safe to log. */
  detail: string;
  /** True when the bytes and the extension disagree. The bytes always win. */
  extensionMismatch: boolean;
  sizeBytes: number;
}

// ---------------------------------------------------------------------------
// Magic numbers
// ---------------------------------------------------------------------------

/** OLE2 / CFB compound document — every BIFF5/BIFF8 `.xls` starts with this. */
const OLE2_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/** ZIP local file header. Every OOXML (`.xlsx`, `.docx`, …) starts with this. */
const ZIP_LOCAL_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/** An empty archive (`PK\x05\x06`) and a spanned archive (`PK\x07\x08`). */
const ZIP_EMPTY_HEADER = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const ZIP_SPANNED_HEADER = Buffer.from([0x50, 0x4b, 0x07, 0x08]);

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_EOCD_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;

/** The End Of Central Directory record lives in the last 64 KiB + 22 bytes. */
const EOCD_SEARCH_WINDOW = 64 * 1024 + 22;

/** Fixed sizes from the ZIP APPNOTE. */
const EOCD_MIN_BYTES = 22;
const CENTRAL_ENTRY_MIN_BYTES = 46;
const LOCAL_HEADER_MIN_BYTES = 30;
const ZIP64_EOCD_LOCATOR_BYTES = 20;

/**
 * Hard ceiling on ZIP directory entries examined. Classification only needs to
 * find two well-known names; a malicious archive declaring millions of entries
 * must not turn signature detection into an unbounded loop.
 */
const MAX_ZIP_ENTRIES_SCANNED = 20_000;

/** Longest entry name we will decode while looking for the two marker names. */
const MAX_ZIP_NAME_BYTES = 512;

/** The two entries that make a ZIP an OOXML spreadsheet package. */
const OOXML_CONTENT_TYPES = '[Content_Types].xml';
const XLSX_PART_PREFIX = 'xl/';

/** Display filenames are capped here. Display only — never a filesystem path. */
const MAX_DISPLAY_FILENAME_CHARS = 120;

const DISPLAY_FILENAME_FALLBACK = 'source';

// ---------------------------------------------------------------------------
// Signature detection
// ---------------------------------------------------------------------------

/**
 * Classify a buffer from its bytes alone. Never throws — a caller that wants
 * an exception uses `assertSupportedUpload`.
 */
export function detectFileSignature(buffer: Buffer): FileSignatureResult {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { kind: 'corrupted', detail: 'SIGNATURE_EMPTY_BUFFER' };
  }
  // Below 8 bytes nothing can be classified — not even a complete OLE2 magic
  // fits. Treated as truncated (corrupted), not as an unknown format.
  if (buffer.length < 8) {
    return { kind: 'corrupted', detail: `SIGNATURE_TRUNCATED bytes=${buffer.length}` };
  }

  if (buffer.subarray(0, 8).equals(OLE2_MAGIC)) {
    // BIFF5 vs BIFF8 is NOT decided here — that needs the directory entry
    // (`Book` vs `Workbook`), which is biff8Reader's job. The container is an
    // OLE2 compound document either way, so the format is `xls`.
    return { kind: 'xls', detail: 'SIGNATURE_OLE2' };
  }

  if (buffer.subarray(0, 4).equals(ZIP_LOCAL_HEADER)) {
    return inspectZip(buffer);
  }

  // A ZIP whose first record is not a local file header: either an archive
  // with zero entries, or a spanned/split archive. Neither can be an .xlsx.
  if (buffer.subarray(0, 4).equals(ZIP_EMPTY_HEADER)) {
    return { kind: 'zip_not_xlsx', detail: 'SIGNATURE_ZIP_EMPTY_ARCHIVE' };
  }
  if (buffer.subarray(0, 4).equals(ZIP_SPANNED_HEADER)) {
    return { kind: 'zip_not_xlsx', detail: 'SIGNATURE_ZIP_SPANNED_ARCHIVE' };
  }

  return { kind: 'unsupported', detail: `SIGNATURE_UNSUPPORTED family=${classifyForeign(buffer)}` };
}

/**
 * Name the family of a non-spreadsheet file so the operator sees WHAT they
 * uploaded without any byte of the file being echoed back. Anything not on
 * this list is reported as UNKNOWN — deliberately, because dumping the leading
 * bytes as hex would leak content for text-like formats.
 */
function classifyForeign(buffer: Buffer): string {
  const b0 = buffer[0]!;
  const b1 = buffer[1]!;
  const b2 = buffer[2]!;
  const b3 = buffer[3]!;

  if (b0 === 0x4d && b1 === 0x5a) return 'PE_EXECUTABLE';
  if (b0 === 0x7f && b1 === 0x45 && b2 === 0x4c && b3 === 0x46) return 'ELF_EXECUTABLE';
  if (b0 === 0x25 && b1 === 0x50 && b2 === 0x44 && b3 === 0x46) return 'PDF';
  if (b0 === 0xd7 && b1 === 0xcd && b2 === 0xc6 && b3 === 0x9a) return 'WMF';
  if (b0 === 0x1f && b1 === 0x8b) return 'GZIP';
  if (b0 === 0x42 && b1 === 0x5a && b2 === 0x68) return 'BZIP2';
  if (b0 === 0x37 && b1 === 0x7a && b2 === 0xbc && b3 === 0xaf) return '7ZIP';
  if (b0 === 0x52 && b1 === 0x61 && b2 === 0x72 && b3 === 0x21) return 'RAR';
  if (b0 === 0x89 && b1 === 0x50 && b2 === 0x4e && b3 === 0x47) return 'PNG';
  if (b0 === 0xff && b1 === 0xd8 && b2 === 0xff) return 'JPEG';
  if (b0 === 0x25 && b1 === 0x21) return 'POSTSCRIPT';
  if (b0 === 0x53 && b1 === 0x51 && b2 === 0x4c && b3 === 0x69) return 'SQLITE';

  // Text-ish probes. Only a fixed, bounded prefix is examined and only the
  // CLASSIFICATION is returned — never the matched text.
  const head = buffer.subarray(0, Math.min(buffer.length, 512)).toString('latin1');
  const trimmedHead = head.replace(/^\ufeff/, '').trimStart();
  const lowerHead = trimmedHead.toLowerCase();
  if (lowerHead.startsWith('<!doctype html') || lowerHead.startsWith('<html')) return 'HTML';
  if (lowerHead.startsWith('<?xml')) return 'XML_NOT_PACKAGED';
  if (lowerHead.startsWith('{\\rtf')) return 'RTF';
  if (lowerHead.startsWith('%pdf')) return 'PDF';
  if (isProbablyText(buffer)) return 'PLAIN_TEXT';

  return 'UNKNOWN';
}

/** Heuristic: no NUL bytes and (almost) no C0 control bytes in the prefix. */
function isProbablyText(buffer: Buffer): boolean {
  const limit = Math.min(buffer.length, 1024);
  for (let i = 0; i < limit; i += 1) {
    const byte = buffer[i]!;
    if (byte === 0) return false;
    // Allow TAB (09), LF (0A), CR (0D), FF (0C).
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// ZIP central directory inspection (bounded, no inflation)
// ---------------------------------------------------------------------------

/**
 * Decide whether a ZIP is an OOXML SPREADSHEET package.
 *
 * A `.docx` and a `.xlsx` are both ZIPs starting `PK\x03\x04` and both contain
 * `[Content_Types].xml`. The discriminator is the presence of an `xl/` part.
 * Requiring BOTH markers is what stops a `.docx` (or an arbitrary zip someone
 * renamed) from being handed to the XLSX reader, which would otherwise fail
 * deep inside ExcelJS with an opaque error.
 */
function inspectZip(buffer: Buffer): FileSignatureResult {
  const eocdOffset = findEocd(buffer);
  if (eocdOffset < 0) {
    // A ZIP local header with no reachable End Of Central Directory is a
    // truncated / damaged archive, not an unsupported format. Reporting it as
    // `corrupted` tells the operator "re-export the file", not "wrong format".
    return { kind: 'corrupted', detail: 'SIGNATURE_ZIP_EOCD_NOT_FOUND' };
  }

  const directory = locateCentralDirectory(buffer, eocdOffset);
  if (!directory) {
    return { kind: 'corrupted', detail: 'SIGNATURE_ZIP_CENTRAL_DIRECTORY_UNREADABLE' };
  }

  const scan =
    scanCentralDirectory(buffer, directory.offset, directory.entryCount) ??
    // Some producers write a central directory offset that is wrong by the
    // size of a prepended blob. Falling back to a bounded forward scan of the
    // LOCAL file headers still answers the only question we are asking.
    scanLocalHeaders(buffer);

  if (!scan) {
    return { kind: 'corrupted', detail: 'SIGNATURE_ZIP_CENTRAL_DIRECTORY_UNREADABLE' };
  }

  if (scan.hasContentTypes && scan.hasXlPart) {
    return { kind: 'xlsx', detail: `SIGNATURE_ZIP_OOXML_SPREADSHEET entries=${scan.entriesSeen}` };
  }

  const missing = scan.hasContentTypes ? 'XL_PART' : scan.hasXlPart ? 'CONTENT_TYPES' : 'BOTH';
  return {
    kind: 'zip_not_xlsx',
    detail: `SIGNATURE_ZIP_NOT_OOXML_SPREADSHEET missing=${missing} entries=${scan.entriesSeen}`,
  };
}

/** Backwards scan for `PK\x05\x06` inside the last 64 KiB + 22 bytes. */
function findEocd(buffer: Buffer): number {
  const windowStart = Math.max(0, buffer.length - EOCD_SEARCH_WINDOW);
  for (let i = buffer.length - EOCD_MIN_BYTES; i >= windowStart; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) {
      // Sanity-check the comment length so a random 4-byte match inside
      // compressed data is not mistaken for the real record.
      const commentLength = buffer.readUInt16LE(i + 20);
      if (i + EOCD_MIN_BYTES + commentLength <= buffer.length) return i;
    }
  }
  return -1;
}

interface CentralDirectoryLocation {
  offset: number;
  entryCount: number;
}

/**
 * Read the central-directory offset/count, transparently following the ZIP64
 * records when the 32-bit fields are saturated (0xFFFF / 0xFFFFFFFF). A large
 * .xlsx produced by a modern exporter can legitimately be ZIP64.
 */
function locateCentralDirectory(buffer: Buffer, eocdOffset: number): CentralDirectoryLocation | null {
  let entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let offset = buffer.readUInt32LE(eocdOffset + 16);

  const saturated = entryCount === 0xffff || offset === 0xffffffff;
  if (saturated) {
    const locatorOffset = eocdOffset - ZIP64_EOCD_LOCATOR_BYTES;
    if (locatorOffset < 0) return null;
    if (buffer.readUInt32LE(locatorOffset) !== ZIP64_EOCD_LOCATOR_SIGNATURE) return null;

    const zip64EocdOffset = readUInt64LEBounded(buffer, locatorOffset + 8);
    if (zip64EocdOffset === null || zip64EocdOffset + 56 > buffer.length) return null;
    if (buffer.readUInt32LE(zip64EocdOffset) !== ZIP64_EOCD_SIGNATURE) return null;

    const zip64Count = readUInt64LEBounded(buffer, zip64EocdOffset + 32);
    const zip64Offset = readUInt64LEBounded(buffer, zip64EocdOffset + 48);
    if (zip64Count === null || zip64Offset === null) return null;
    entryCount = zip64Count;
    offset = zip64Offset;
  }

  if (offset < 0 || offset + CENTRAL_ENTRY_MIN_BYTES > buffer.length) return null;
  return { offset, entryCount };
}

/**
 * Read a 64-bit little-endian field, refusing anything above
 * Number.MAX_SAFE_INTEGER instead of silently truncating. A file-declared
 * quantity is untrusted; a lossy read here would become an out-of-range slice.
 */
function readUInt64LEBounded(buffer: Buffer, offset: number): number | null {
  if (offset + 8 > buffer.length) return null;
  const value = buffer.readBigUInt64LE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(value);
}

interface ZipScanResult {
  hasContentTypes: boolean;
  hasXlPart: boolean;
  entriesSeen: number;
}

function scanCentralDirectory(
  buffer: Buffer,
  startOffset: number,
  declaredEntryCount: number,
): ZipScanResult | null {
  if (buffer.readUInt32LE(startOffset) !== CENTRAL_DIR_SIGNATURE) return null;

  // The declared count is untrusted: it only ever LOWERS the iteration bound.
  const budget = Math.min(
    declaredEntryCount > 0 ? declaredEntryCount : MAX_ZIP_ENTRIES_SCANNED,
    MAX_ZIP_ENTRIES_SCANNED,
  );

  let cursor = startOffset;
  let hasContentTypes = false;
  let hasXlPart = false;
  let entriesSeen = 0;

  for (let i = 0; i < budget; i += 1) {
    if (cursor + CENTRAL_ENTRY_MIN_BYTES > buffer.length) break;
    if (buffer.readUInt32LE(cursor) !== CENTRAL_DIR_SIGNATURE) break;

    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const nameStart = cursor + CENTRAL_ENTRY_MIN_BYTES;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > buffer.length) break;

    entriesSeen += 1;
    const marker = classifyEntryName(buffer, nameStart, nameLength);
    if (marker === 'content_types') hasContentTypes = true;
    else if (marker === 'xl_part') hasXlPart = true;
    if (hasContentTypes && hasXlPart) return { hasContentTypes, hasXlPart, entriesSeen };

    cursor = nameEnd + extraLength + commentLength;
  }

  return entriesSeen > 0 ? { hasContentTypes, hasXlPart, entriesSeen } : null;
}

/**
 * Fallback: walk the LOCAL file headers from byte 0. Only usable while the
 * entries are stored back-to-back with known sizes; the walk stops at the
 * first header whose size fields are streamed (bit 3 of the general purpose
 * flag), because then the compressed size is not knowable without inflating.
 */
function scanLocalHeaders(buffer: Buffer): ZipScanResult | null {
  let cursor = 0;
  let hasContentTypes = false;
  let hasXlPart = false;
  let entriesSeen = 0;

  for (let i = 0; i < MAX_ZIP_ENTRIES_SCANNED; i += 1) {
    if (cursor + LOCAL_HEADER_MIN_BYTES > buffer.length) break;
    if (buffer.readUInt32LE(cursor) !== LOCAL_HEADER_SIGNATURE) break;

    const flags = buffer.readUInt16LE(cursor + 6);
    const compressedSize = buffer.readUInt32LE(cursor + 18);
    const nameLength = buffer.readUInt16LE(cursor + 26);
    const extraLength = buffer.readUInt16LE(cursor + 28);
    const nameStart = cursor + LOCAL_HEADER_MIN_BYTES;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > buffer.length) break;

    entriesSeen += 1;
    const marker = classifyEntryName(buffer, nameStart, nameLength);
    if (marker === 'content_types') hasContentTypes = true;
    else if (marker === 'xl_part') hasXlPart = true;
    if (hasContentTypes && hasXlPart) return { hasContentTypes, hasXlPart, entriesSeen };

    // Bit 3 set => sizes live in a trailing data descriptor, so the next
    // header cannot be located arithmetically. Stop rather than guess.
    if ((flags & 0x08) !== 0 || compressedSize === 0xffffffff) break;
    cursor = nameEnd + extraLength + compressedSize;
  }

  return entriesSeen > 0 ? { hasContentTypes, hasXlPart, entriesSeen } : null;
}

/**
 * Decode ONLY enough of an entry name to answer "is this one of the two marker
 * names?", and return a classification token. The decoded name itself never
 * leaves this function — entry names are file content.
 */
function classifyEntryName(
  buffer: Buffer,
  nameStart: number,
  nameLength: number,
): 'content_types' | 'xl_part' | null {
  if (nameLength === 0 || nameLength > MAX_ZIP_NAME_BYTES) return null;
  const name = buffer.toString('latin1', nameStart, nameStart + nameLength);
  // Some producers emit a leading './' or a backslash separator.
  const normalized = name.replace(/\\/g, '/').replace(/^\.\//, '');
  if (normalized === OOXML_CONTENT_TYPES) return 'content_types';
  if (normalized.startsWith(XLSX_PART_PREFIX)) return 'xl_part';
  return null;
}

// ---------------------------------------------------------------------------
// Upload gate
// ---------------------------------------------------------------------------

/**
 * The single intake gate. Returns the format the parser layer must use, chosen
 * from the BYTES. Throws a typed `MigrationError` for anything this feature
 * cannot parse.
 *
 * The `declaredName` is used for EXACTLY ONE purpose: to record whether the
 * extension agreed with the signature. It never selects a parser, and its text
 * is never echoed into an error detail — only the normalized extension token
 * (XLS / XLSX / OTHER / NONE) is.
 */
export function assertSupportedUpload(buffer: Buffer, declaredName: string): SourceFileFormat {
  return inspectUpload(buffer, declaredName).format;
}

/** `assertSupportedUpload` plus the structural observation. See UploadInspection. */
export function inspectUpload(buffer: Buffer, declaredName: string): UploadInspection {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new MigrationError('FILE_MISSING', {
      message: 'No file content was received.',
      detail: 'UPLOAD_EMPTY',
    });
  }

  // Size is checked BEFORE any structural work so an oversized upload is never
  // scanned, and so the 413 is reported for the real reason.
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new MigrationError('FILE_TOO_LARGE', {
      message: 'The uploaded file exceeds the maximum supported size.',
      detail: `UPLOAD_BYTES observed=${buffer.length} allowed=${MAX_UPLOAD_BYTES}`,
    });
  }

  const signature = detectFileSignature(buffer);
  const extension = normalizeExtensionToken(declaredName);
  const mismatch = isExtensionMismatch(signature.kind, extension);

  switch (signature.kind) {
    case 'xls':
    case 'xlsx': {
      const format: SourceFileFormat = signature.kind;
      return {
        format,
        kind: signature.kind,
        // The SIGNATURE always wins. An extension that disagrees is recorded
        // as a structural fact and is NEVER a reason to reject: legacy
        // exporters routinely emit a BIFF8 workbook named `.xlsx`, and
        // refusing it would block a legitimate customer migration.
        detail: `SIGNATURE_${signature.kind.toUpperCase()}_EXTENSION_${extension}`,
        extensionMismatch: mismatch,
        sizeBytes: buffer.length,
      };
    }

    case 'zip_not_xlsx':
      throw new MigrationError('FILE_UNSUPPORTED', {
        message: 'The uploaded file is a ZIP archive but not an Excel workbook.',
        detail: `${signature.detail} extension=${extension}`,
      });

    case 'corrupted':
      throw new MigrationError('FILE_CORRUPTED', {
        message: 'The uploaded file could not be read as a workbook.',
        detail: `${signature.detail} extension=${extension}`,
      });

    case 'unsupported':
    default:
      throw new MigrationError('FILE_UNSUPPORTED', {
        message: 'Only .xls and .xlsx workbooks can be migrated.',
        detail: `${signature.detail} extension=${extension}`,
      });
  }
}

/** XLS | XLSX | OTHER | NONE — a closed set, so no filename text can leak. */
function normalizeExtensionToken(declaredName: string): 'XLS' | 'XLSX' | 'OTHER' | 'NONE' {
  if (typeof declaredName !== 'string') return 'NONE';
  const safe = sanitizeDisplayFilename(declaredName);
  if (safe === DISPLAY_FILENAME_FALLBACK && !/\.[a-z0-9]+$/i.test(declaredName)) return 'NONE';
  const dot = safe.lastIndexOf('.');
  if (dot <= 0 || dot === safe.length - 1) return 'NONE';
  const ext = safe.slice(dot + 1).toLowerCase();
  if (ext === 'xls') return 'XLS';
  if (ext === 'xlsx') return 'XLSX';
  return 'OTHER';
}

function isExtensionMismatch(kind: DetectedFileKind, extension: string): boolean {
  if (kind === 'xls') return extension !== 'XLS';
  if (kind === 'xlsx') return extension !== 'XLSX';
  return false;
}

// ---------------------------------------------------------------------------
// Display filename
// ---------------------------------------------------------------------------

/**
 * Produce a safe, DISPLAY-ONLY label for the uploaded file.
 *
 * CONTRACT: the return value of this function is NEVER used to build a
 * filesystem path, a storage key, a Content-Disposition header or a shell
 * argument. Stored source files are written under a fixed literal name (see
 * sourceFileStore.ts), so no filename the caller supplies ever reaches the
 * filesystem. This function exists so the Platform Admin UI can echo
 * "which file did I upload?" without echoing attacker-controlled text.
 *
 * Defences applied, and why each one:
 *  - path separators (`/` and `\`) and everything before the last one are
 *    removed, so only a basename survives;
 *  - `..` runs are collapsed to a single `.`, so no traversal token can be
 *    rendered even if this value were ever misused;
 *  - C0/C1 control characters are removed, so a name cannot inject CR/LF into
 *    a log line or NUL-truncate a downstream C string;
 *  - Unicode bidirectional overrides are removed, so a name cannot be rendered
 *    right-to-left to disguise its real extension (the classic
 *    `invoice<RLO>slx.exe` trick);
 *  - the result is capped, and an empty result becomes a fixed literal.
 */
export function sanitizeDisplayFilename(name: string): string {
  if (typeof name !== 'string' || name.length === 0) return DISPLAY_FILENAME_FALLBACK;

  // eslint-disable-next-line no-control-regex
  let value = name.replace(/[\u0000-\u001f\u007f-\u009f]/g, '');
  // Bidi overrides / isolates and the zero-width joiners used to hide text.
  value = value.replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '');

  // Windows-style separators first, then POSIX. `path.basename` alone is not
  // enough: on POSIX it does not treat `\` as a separator, so a Windows path
  // would survive whole.
  value = value.replace(/\\/g, '/');
  value = value.slice(value.lastIndexOf('/') + 1);
  // Strip a Windows drive prefix or an NTFS alternate-data-stream suffix.
  value = value.slice(value.lastIndexOf(':') + 1);
  // Defence in depth — basename of an already-flattened string is a no-op on
  // POSIX and strips anything Windows still considers a separator.
  value = path.basename(value);

  // Collapse every traversal token. Display-only, so mangling `a..b.xls` into
  // `a.b.xls` is acceptable; rendering `..` is not.
  value = value.replace(/\.{2,}/g, '.');
  // A name that is only dots/whitespace carries no information.
  value = value.replace(/^[.\s]+/, '').replace(/[\s]+$/, '');

  if (value.length > MAX_DISPLAY_FILENAME_CHARS) {
    value = value.slice(0, MAX_DISPLAY_FILENAME_CHARS);
  }

  return value.length > 0 ? value : DISPLAY_FILENAME_FALLBACK;
}

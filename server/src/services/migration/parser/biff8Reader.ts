/**
 * biff8Reader.ts — self-contained OLE2/CFB + BIFF8 reader for legacy binary
 * `.xls` workbooks. Node built-ins only; NO npm dependency.
 *
 * Why this file exists: the accepted first-customer migration workbook is a
 * genuine BIFF8 binary `.xls` (OLE2 compound file, `Workbook` stream). ExcelJS
 * — the repo's only spreadsheet dependency — reads OOXML `.xlsx` only and
 * cannot open BIFF8, and adding a new spreadsheet dependency is an unresolved
 * supply-chain decision for the program owner. So the record subset we
 * actually need is implemented here, from the specification, with no new
 * third-party code in the trust boundary.
 *
 * PRIVACY CONTRACT (mandatory): `Biff8Error.detail` — and every message this
 * module produces — carries STRUCTURAL facts only: byte offsets, record ids,
 * counts, sector numbers, limit names. It must NEVER contain cell content,
 * a decoded string, a sheet's data, or anything derived from patient data.
 * Errors from this module are logged; workbook content is not loggable.
 *
 * Scope (deliberately narrow — only what a migration import consumes):
 *  - CFB/OLE2 container: header, DIFAT/FAT, directory, normal + mini streams
 *  - BIFF8 record layer with CONTINUE handling
 *  - BOF/EOF, BOUNDSHEET, SST(+CONTINUE), DATEMODE, CODEPAGE, DIMENSIONS,
 *    FORMAT, XF, FILEPASS
 *  - Cells: LABELSST, LABEL, RSTRING, RK, MULRK, NUMBER, BOOLERR, BLANK,
 *    MULBLANK, FORMULA (+STRING for a cached string result)
 *
 * Formulas are NEVER evaluated. Only the value Excel cached in the file is
 * read; the parsed expression (rgce) is skipped entirely.
 *
 * Everything else is skipped by record length. Encrypted workbooks (FILEPASS)
 * and BIFF5 (`Book` stream) are refused with typed errors rather than being
 * partially decoded.
 *
 * References used: [MS-XLS] Excel Binary File Format (.xls) Structure and
 * [MS-CFB] Compound File Binary File Format.
 */

import {
  Biff8Error,
  resolveBiff8Limits,
  throwLimitExceeded,
  type Biff8Limits,
} from './biff8Reader.limits.js';

export { Biff8Error, DEFAULT_BIFF8_LIMITS, resolveBiff8Limits } from './biff8Reader.limits.js';
export type { Biff8ErrorCode, Biff8Limits } from './biff8Reader.limits.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single decoded cell. `empty` covers both BLANK records and never-written cells. */
export type Biff8CellValue =
  | { kind: 'empty' }
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'date'; value: Date; serial: number }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'error'; code: number };

/** Sheet visibility, straight from the BOUNDSHEET hidden-state field. */
export type Biff8SheetVisibility = 'visible' | 'hidden' | 'very_hidden';

export interface Biff8Sheet {
  name: string;
  /** Ordinal of this sheet's BOUNDSHEET record in the workbook globals. */
  index: number;
  /** True for both `hidden` and `very_hidden`. */
  hidden: boolean;
  visibility: Biff8SheetVisibility;
  /** Dense grid height. See the DIMENSIONS note in `finalizeSheet`. */
  rowCount: number;
  /** Dense grid width. See the DIMENSIONS note in `finalizeSheet`. */
  columnCount: number;
  /** Dense: `rows.length === rowCount`, every `rows[r].length === columnCount`. */
  rows: Biff8CellValue[][];
}

export interface Biff8Stats {
  /** BIFF records traversed (globals + every worksheet substream). */
  records: number;
  /** Unique strings decoded from the SST. */
  sstStrings: number;
  /** Total SST references the file declares (cstTotal). */
  sstReferences: number;
  /** Cell records materialised into values (MULRK/MULBLANK counted per cell). */
  cells: number;
  /** FORMULA records seen. None are evaluated. */
  formulas: number;
  /** Wall-clock milliseconds for the whole `readBiff8` call. */
  parseMs: number;
}

export interface Biff8Workbook {
  sheets: Biff8Sheet[];
  dateEpoch: 1900 | 1904;
  /** Windows code page from the CODEPAGE record, or null. Diagnostics only. */
  codePage: number | null;
  stats: Biff8Stats;
}

/**
 * Shared singleton for every empty slot in the dense grid. A 14,891 x 92 sheet
 * has ~1.2M empty slots; allocating an object per slot would cost tens of MB
 * for no information. Frozen so a caller cannot mutate every empty cell at
 * once. Compare with `.kind`, never by identity.
 */
const EMPTY_CELL: Biff8CellValue = Object.freeze({ kind: 'empty' as const });

// ---------------------------------------------------------------------------
// OLE2 / CFB container
// ---------------------------------------------------------------------------

const OLE2_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

const MAXREGSECT = 0xfffffffa;
const DIFSECT = 0xfffffffc;
const FATSECT = 0xfffffffd;
const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;

const CFB_HEADER_BYTES = 512;
const DIR_ENTRY_BYTES = 128;
const HEADER_DIFAT_COUNT = 109;
const MAX_DIR_ENTRIES = 1 << 16;

/** Magic-byte check only. Does not parse anything and never throws. */
export function isOle2(buffer: Buffer): boolean {
  return Buffer.isBuffer(buffer) && buffer.length >= 8 && buffer.subarray(0, 8).equals(OLE2_MAGIC);
}

interface CfbDirEntry {
  name: string;
  objectType: number;
  startSector: number;
  streamSize: number;
}

/**
 * Parsed compound file. Holds a reference to the caller's buffer — no copy of
 * the container is made; only an extracted stream is materialised.
 */
class CfbContainer {
  private readonly buf: Buffer;
  private readonly limits: Biff8Limits;
  private readonly sectorSize: number;
  private readonly miniSectorSize: number;
  private readonly miniCutoff: number;
  private readonly fat: Uint32Array;
  private readonly miniFat: Uint32Array;
  private readonly miniStream: Buffer;
  readonly entries: CfbDirEntry[];

  constructor(buf: Buffer, limits: Biff8Limits) {
    this.buf = buf;
    this.limits = limits;

    if (!isOle2(buf)) {
      throw new Biff8Error('NOT_OLE2', 'compound file magic missing');
    }
    if (buf.length < CFB_HEADER_BYTES) {
      throw new Biff8Error('CFB_MALFORMED', `file shorter than header (${buf.length} bytes)`);
    }

    const sectorShift = buf.readUInt16LE(30);
    const miniSectorShift = buf.readUInt16LE(32);
    if (sectorShift < 7 || sectorShift > 20) {
      throw new Biff8Error('CFB_MALFORMED', `sectorShift=${sectorShift}`);
    }
    if (miniSectorShift < 2 || miniSectorShift >= sectorShift) {
      throw new Biff8Error('CFB_MALFORMED', `miniSectorShift=${miniSectorShift}`);
    }
    this.sectorSize = 1 << sectorShift;
    this.miniSectorSize = 1 << miniSectorShift;
    this.miniCutoff = buf.readUInt32LE(56);
    if (this.miniCutoff === 0 || this.miniCutoff > 0x10000000) {
      throw new Biff8Error('CFB_MALFORMED', `miniStreamCutoff=${this.miniCutoff}`);
    }

    const numFatSectors = buf.readUInt32LE(44);
    const firstDirSector = buf.readUInt32LE(48);
    const firstMiniFatSector = buf.readUInt32LE(60);
    const numMiniFatSectors = buf.readUInt32LE(64);
    const firstDifatSector = buf.readUInt32LE(68);
    const numDifatSectors = buf.readUInt32LE(72);

    this.fat = this.buildFat(numFatSectors, firstDifatSector, numDifatSectors);
    this.entries = this.readDirectory(firstDirSector);

    // Entry 0 is the root storage; its stream is the mini stream container.
    const root = this.entries[0];
    if (!root) throw new Biff8Error('CFB_MALFORMED', 'directory has no root entry');
    this.miniFat = this.readMiniFat(firstMiniFatSector, numMiniFatSectors);
    this.miniStream =
      root.streamSize > 0 && root.startSector <= MAXREGSECT
        ? this.readNormalStream(root.startSector, root.streamSize)
        : Buffer.alloc(0);
  }

  private sectorOffset(id: number): number {
    const offset = CFB_HEADER_BYTES + id * this.sectorSize;
    if (id > MAXREGSECT || offset < 0 || offset + this.sectorSize > this.buf.length) {
      throw new Biff8Error('CFB_MALFORMED', `sector ${id} out of range`);
    }
    return offset;
  }

  /** Collect the FAT sector ids from the header DIFAT plus the DIFAT chain. */
  private buildFat(numFatSectors: number, firstDifatSector: number, numDifatSectors: number): Uint32Array {
    const entriesPerSector = this.sectorSize / 4;
    const maxFatSectors = Math.ceil(this.buf.length / this.sectorSize) + 2;
    if (numFatSectors > maxFatSectors) {
      throw new Biff8Error('CFB_MALFORMED', `numFatSectors=${numFatSectors} exceeds file capacity`);
    }

    const fatSectorIds: number[] = [];
    for (let i = 0; i < HEADER_DIFAT_COUNT && fatSectorIds.length < numFatSectors; i += 1) {
      const id = this.buf.readUInt32LE(76 + i * 4);
      if (id === FREESECT || id === ENDOFCHAIN) break;
      fatSectorIds.push(id);
    }

    let difat = firstDifatSector;
    let difatSeen = 0;
    const visitedDifat = new Set<number>();
    while (
      fatSectorIds.length < numFatSectors &&
      difat !== ENDOFCHAIN &&
      difat !== FREESECT &&
      difat <= MAXREGSECT
    ) {
      if (visitedDifat.has(difat)) {
        throw new Biff8Error('CFB_MALFORMED', `cyclic DIFAT chain at sector ${difat}`);
      }
      visitedDifat.add(difat);
      difatSeen += 1;
      if (difatSeen > numDifatSectors + 1 || difatSeen > this.limits.maxSectorChainLength) {
        throw new Biff8Error('CFB_MALFORMED', `DIFAT chain longer than declared (${difatSeen})`);
      }
      const base = this.sectorOffset(difat);
      for (let i = 0; i < entriesPerSector - 1 && fatSectorIds.length < numFatSectors; i += 1) {
        const id = this.buf.readUInt32LE(base + i * 4);
        if (id === FREESECT || id === ENDOFCHAIN) continue;
        fatSectorIds.push(id);
      }
      difat = this.buf.readUInt32LE(base + (entriesPerSector - 1) * 4);
    }

    if (fatSectorIds.length < numFatSectors) {
      throw new Biff8Error(
        'CFB_MALFORMED',
        `DIFAT lists ${fatSectorIds.length} FAT sectors, header declares ${numFatSectors}`,
      );
    }

    const fat = new Uint32Array(fatSectorIds.length * entriesPerSector);
    for (let s = 0; s < fatSectorIds.length; s += 1) {
      const base = this.sectorOffset(fatSectorIds[s] as number);
      for (let i = 0; i < entriesPerSector; i += 1) {
        fat[s * entriesPerSector + i] = this.buf.readUInt32LE(base + i * 4);
      }
    }
    return fat;
  }

  private readMiniFat(firstMiniFatSector: number, numMiniFatSectors: number): Uint32Array {
    if (numMiniFatSectors === 0 || firstMiniFatSector > MAXREGSECT) return new Uint32Array(0);
    const chain = this.walkChain(firstMiniFatSector, numMiniFatSectors);
    const entriesPerSector = this.sectorSize / 4;
    const miniFat = new Uint32Array(chain.length * entriesPerSector);
    for (let s = 0; s < chain.length; s += 1) {
      const base = this.sectorOffset(chain[s] as number);
      for (let i = 0; i < entriesPerSector; i += 1) {
        miniFat[s * entriesPerSector + i] = this.buf.readUInt32LE(base + i * 4);
      }
    }
    return miniFat;
  }

  /**
   * Follow a FAT chain. Rejects cycles, out-of-range ids and FREESECT misuse.
   * `maxSectors` bounds the walk when the caller knows the expected length.
   */
  private walkChain(start: number, maxSectors: number): number[] {
    const chain: number[] = [];
    const visited = new Set<number>();
    const cap = Math.min(maxSectors, this.limits.maxSectorChainLength);
    let id = start;
    while (id !== ENDOFCHAIN) {
      if (id === FREESECT || id === FATSECT || id === DIFSECT || id > MAXREGSECT) {
        throw new Biff8Error('CFB_MALFORMED', `chain hit reserved sector id 0x${id.toString(16)}`);
      }
      if (visited.has(id)) {
        throw new Biff8Error('CFB_MALFORMED', `cyclic sector chain at sector ${id}`);
      }
      if (chain.length >= cap) {
        throw new Biff8Error('CFB_MALFORMED', `sector chain longer than ${cap} sectors`);
      }
      visited.add(id);
      chain.push(id);
      if (id >= this.fat.length) {
        throw new Biff8Error('CFB_MALFORMED', `sector ${id} beyond FAT (${this.fat.length} entries)`);
      }
      id = this.fat[id] as number;
    }
    return chain;
  }

  /** Bound a file-declared stream size against the actual container size. */
  private checkedSize(size: number, what: string): number {
    if (!Number.isFinite(size) || size < 0) {
      throw new Biff8Error('CFB_MALFORMED', `${what} has invalid size`);
    }
    if (size > this.buf.length) {
      throw new Biff8Error(
        'CFB_MALFORMED',
        `${what} declares ${size} bytes, container is ${this.buf.length}`,
      );
    }
    if (size > this.limits.maxFileBytes) {
      throwLimitExceeded('maxFileBytes', size, this.limits.maxFileBytes);
    }
    return size;
  }

  private readNormalStream(start: number, size: number): Buffer {
    const checked = this.checkedSize(size, 'stream');
    const needed = Math.ceil(checked / this.sectorSize);
    const chain = this.walkChain(start, needed === 0 ? 1 : needed);
    const out = Buffer.allocUnsafe(checked);
    let written = 0;
    for (const id of chain) {
      if (written >= checked) break;
      const base = this.sectorOffset(id);
      const take = Math.min(this.sectorSize, checked - written);
      this.buf.copy(out, written, base, base + take);
      written += take;
    }
    if (written < checked) {
      throw new Biff8Error('CFB_MALFORMED', `stream chain yielded ${written} of ${checked} bytes`);
    }
    return out;
  }

  private readMiniStream(start: number, size: number): Buffer {
    const checked = this.checkedSize(size, 'mini stream');
    const out = Buffer.allocUnsafe(checked);
    const visited = new Set<number>();
    let written = 0;
    let id = start;
    let steps = 0;
    while (written < checked) {
      if (id === ENDOFCHAIN || id > MAXREGSECT) {
        throw new Biff8Error('CFB_MALFORMED', `mini chain ended after ${written} of ${checked} bytes`);
      }
      if (visited.has(id)) {
        throw new Biff8Error('CFB_MALFORMED', `cyclic mini-FAT chain at sector ${id}`);
      }
      steps += 1;
      if (steps > this.limits.maxSectorChainLength) {
        throwLimitExceeded('maxSectorChainLength', steps, this.limits.maxSectorChainLength);
      }
      visited.add(id);
      const base = id * this.miniSectorSize;
      if (base + this.miniSectorSize > this.miniStream.length) {
        throw new Biff8Error('CFB_MALFORMED', `mini sector ${id} outside the mini stream`);
      }
      const take = Math.min(this.miniSectorSize, checked - written);
      this.miniStream.copy(out, written, base, base + take);
      written += take;
      if (id >= this.miniFat.length) {
        throw new Biff8Error('CFB_MALFORMED', `mini sector ${id} beyond mini-FAT`);
      }
      id = this.miniFat[id] as number;
    }
    return out;
  }

  /**
   * Linear scan of every 128-byte slot in the directory sector chain. The
   * red-black sibling/child links are deliberately not followed: a linear scan
   * cannot be steered into a cycle by a crafted tree, and every real entry
   * occupies a slot regardless of its position in the tree.
   */
  private readDirectory(firstDirSector: number): CfbDirEntry[] {
    if (firstDirSector > MAXREGSECT) {
      throw new Biff8Error('CFB_MALFORMED', `firstDirectorySector=${firstDirSector}`);
    }
    const maxSectors = Math.ceil(this.buf.length / this.sectorSize) + 1;
    const chain = this.walkChain(firstDirSector, maxSectors);
    const perSector = Math.floor(this.sectorSize / DIR_ENTRY_BYTES);
    const entries: CfbDirEntry[] = [];
    for (const id of chain) {
      const base = this.sectorOffset(id);
      for (let i = 0; i < perSector; i += 1) {
        if (entries.length >= MAX_DIR_ENTRIES) {
          throw new Biff8Error('CFB_MALFORMED', `directory exceeds ${MAX_DIR_ENTRIES} entries`);
        }
        const off = base + i * DIR_ENTRY_BYTES;
        const objectType = this.buf.readUInt8(off + 66);
        if (objectType === 0) {
          entries.push({ name: '', objectType, startSector: FREESECT, streamSize: 0 });
          continue;
        }
        let nameLen = this.buf.readUInt16LE(off + 64);
        if (nameLen > 64) nameLen = 64;
        // nameLen counts bytes and includes the UTF-16 NUL terminator.
        const nameBytes = nameLen >= 2 ? nameLen - 2 : 0;
        const name = this.buf.toString('utf16le', off, off + nameBytes);
        // Version 3 containers keep the stream size in the low 32 bits.
        const streamSize = this.buf.readUInt32LE(off + 120);
        entries.push({
          name,
          objectType,
          startSector: this.buf.readUInt32LE(off + 116),
          streamSize,
        });
      }
    }
    if (entries.length === 0) {
      throw new Biff8Error('CFB_MALFORMED', 'directory chain is empty');
    }
    return entries;
  }

  /** Case-insensitive lookup of a stream (objectType 2) by decoded name. */
  findStream(name: string): CfbDirEntry | null {
    const wanted = name.toLowerCase();
    for (const entry of this.entries) {
      if (entry.objectType === 2 && entry.name.toLowerCase() === wanted) return entry;
    }
    return null;
  }

  /** Materialise a stream, choosing the mini-stream path below the cutoff. */
  readStream(entry: CfbDirEntry): Buffer {
    if (entry.streamSize === 0) return Buffer.alloc(0);
    if (entry.streamSize < this.miniCutoff) return this.readMiniStream(entry.startSector, entry.streamSize);
    return this.readNormalStream(entry.startSector, entry.streamSize);
  }
}

// ---------------------------------------------------------------------------
// BIFF8 record layer
// ---------------------------------------------------------------------------

const REC_FORMULA = 0x0006;
const REC_EOF = 0x000a;
const REC_CONTINUE = 0x003c;
const REC_DATEMODE = 0x0022;
const REC_FILEPASS = 0x002f;
const REC_CODEPAGE = 0x0042;
const REC_XF = 0x00e0;
const REC_BOUNDSHEET = 0x0085;
const REC_MULRK = 0x00bd;
const REC_MULBLANK = 0x00be;
const REC_RSTRING = 0x00d6;
const REC_LABELSST = 0x00fd;
const REC_SST = 0x00fc;
const REC_BLANK = 0x0201;
const REC_NUMBER = 0x0203;
const REC_LABEL = 0x0204;
const REC_BOOLERR = 0x0205;
const REC_STRING = 0x0207;
const REC_DIMENSIONS = 0x0200;
const REC_RK = 0x027e;
const REC_FORMAT = 0x041e;
const REC_BOF = 0x0809;

const BOF_SUBSTREAM_GLOBALS = 0x0005;
const BOF_SUBSTREAM_WORKSHEET = 0x0010;

const BIFF8_VERSION = 0x0600;

interface RecordRef {
  type: number;
  /** Absolute offset of the payload's first byte within the workbook stream. */
  start: number;
  length: number;
}

/** Read one record header at `pos`, or null at end of stream. */
function readRecord(stream: Buffer, pos: number): RecordRef | null {
  if (pos + 4 > stream.length) return null;
  const type = stream.readUInt16LE(pos);
  const length = stream.readUInt16LE(pos + 2);
  const start = pos + 4;
  if (start + length > stream.length) {
    throw new Biff8Error(
      'BIFF_MALFORMED',
      `record 0x${type.toString(16)} at ${pos} declares ${length} bytes past end of stream`,
    );
  }
  return { type, start, length };
}

// ---------------------------------------------------------------------------
// Strings
// ---------------------------------------------------------------------------

const WIDEN_CHUNK = 4096;

/**
 * Widen compressed (8-bit) BIFF8 character data to UTF-16.
 *
 * Each byte is the low byte of a UTF-16 code unit, so byte 0xE7 is U+00E7 "ç".
 * The widening is done explicitly rather than via `Buffer.toString('latin1')`
 * so the mapping is visible in the code and cannot silently become a locale-
 * or codepage-dependent decode. This is what keeps Turkish text intact.
 */
function widenCompressed(buf: Buffer, start: number, end: number): string {
  if (end <= start) return '';
  const parts: string[] = [];
  for (let p = start; p < end; p += WIDEN_CHUNK) {
    const stop = Math.min(p + WIDEN_CHUNK, end);
    const codes = new Array<number>(stop - p);
    for (let i = p; i < stop; i += 1) codes[i - p] = buf[i] as number;
    parts.push(String.fromCharCode(...codes));
  }
  return parts.length === 1 ? (parts[0] as string) : parts.join('');
}

/**
 * A byte reader over one or more record payloads that remembers where the
 * record boundaries are.
 *
 * The SST is the reason this exists. An SST larger than 8,224 bytes — any SST
 * of a real workbook — spans CONTINUE records, and a single string's character
 * data may be cut anywhere. When that happens the CONTINUE payload starts with
 * a fresh 1-byte grbit describing the encoding of the REMAINING characters,
 * and the encoding is allowed to flip there (compressed -> UTF-16 or back).
 * `readChars` is the only method that consumes that byte; header fields and
 * skipped run/phonetic data cross a boundary without one, per [MS-XLS].
 */
class SegmentReader {
  private readonly buf: Buffer;
  private readonly segments: RecordRef[];
  private segIndex = 0;
  private pos: number;
  private segEnd: number;

  constructor(buf: Buffer, segments: RecordRef[]) {
    if (segments.length === 0) throw new Biff8Error('BIFF_MALFORMED', 'empty record segment list');
    this.buf = buf;
    this.segments = segments;
    const first = segments[0] as RecordRef;
    this.pos = first.start;
    this.segEnd = first.start + first.length;
  }

  private remaining(): number {
    return this.segEnd - this.pos;
  }

  private advanceSegment(): void {
    this.segIndex += 1;
    const seg = this.segments[this.segIndex];
    if (!seg) {
      throw new Biff8Error(
        'BIFF_MALFORMED',
        `string data runs past the last of ${this.segments.length} record segments`,
      );
    }
    this.pos = seg.start;
    this.segEnd = seg.start + seg.length;
  }

  /** True when every byte of every segment has been consumed. */
  atEnd(): boolean {
    return this.segIndex >= this.segments.length - 1 && this.remaining() <= 0;
  }

  /** Move to the next segment if the next `n` header bytes would not fit. */
  ensure(n: number): void {
    while (this.remaining() < n) this.advanceSegment();
  }

  readU8(): number {
    this.ensure(1);
    const v = this.buf.readUInt8(this.pos);
    this.pos += 1;
    return v;
  }

  readU16(): number {
    this.ensure(2);
    const v = this.buf.readUInt16LE(this.pos);
    this.pos += 2;
    return v;
  }

  readU32(): number {
    this.ensure(4);
    const v = this.buf.readUInt32LE(this.pos);
    this.pos += 4;
    return v;
  }

  /** Skip `n` bytes, crossing record boundaries without a grbit re-read. */
  skip(n: number): void {
    let left = n;
    while (left > 0) {
      const avail = this.remaining();
      if (avail <= 0) {
        this.advanceSegment();
        continue;
      }
      const take = Math.min(left, avail);
      this.pos += take;
      left -= take;
    }
  }

  /** Read `count` UTF-16 code units, honouring mid-string CONTINUE splits. */
  readChars(count: number, highByte: boolean): string {
    if (count <= 0) return '';
    let high = highByte;
    let left = count;
    const parts: string[] = [];
    while (left > 0) {
      const avail = this.remaining();
      if (avail <= 0) {
        this.advanceSegment();
        // Fresh encoding flag for the remainder of this string.
        high = (this.readU8() & 0x01) !== 0;
        continue;
      }
      if (high) {
        if (avail < 2) {
          // A UTF-16 unit cannot legally straddle a boundary; resynchronise.
          this.pos += avail;
          continue;
        }
        const take = Math.min(left, avail >> 1);
        parts.push(this.buf.toString('utf16le', this.pos, this.pos + take * 2));
        this.pos += take * 2;
        left -= take;
      } else {
        const take = Math.min(left, avail);
        parts.push(widenCompressed(this.buf, this.pos, this.pos + take));
        this.pos += take;
        left -= take;
      }
    }
    return parts.length === 1 ? (parts[0] as string) : parts.join('');
  }
}

/**
 * BIFF8 XLUnicodeString / XLUnicodeRichExtendedString.
 *
 * `cchBytes` is 2 for SST entries, cell strings and FORMAT strings, 1 for the
 * "short" form used by sheet names. grbit bit0 = fHighByte, bit2 = fExtSt
 * (4-byte cchExtRst follows the flags), bit3 = fRichSt (2-byte cRun follows).
 * Rich-run data (4 bytes per run) and phonetic data (cchExtRst bytes) sit
 * AFTER the character data and are skipped, not decoded.
 */
function readXLUnicodeString(
  reader: SegmentReader,
  cchBytes: 1 | 2,
  allowRichExt: boolean,
  limits: Biff8Limits,
): string {
  const cch = cchBytes === 2 ? reader.readU16() : reader.readU8();
  if (cch > limits.maxStringChars) {
    throwLimitExceeded('maxStringChars', cch, limits.maxStringChars);
  }
  const grbit = reader.readU8();
  const high = (grbit & 0x01) !== 0;
  const rich = allowRichExt && (grbit & 0x08) !== 0;
  const ext = allowRichExt && (grbit & 0x04) !== 0;
  const cRun = rich ? reader.readU16() : 0;
  const cbExt = ext ? reader.readU32() : 0;
  const value = reader.readChars(cch, high);
  if (cRun > 0) reader.skip(cRun * 4);
  if (cbExt > 0) reader.skip(cbExt);
  return value;
}

// ---------------------------------------------------------------------------
// Number formats and dates
// ---------------------------------------------------------------------------

/**
 * Built-in format ids that Excel renders as a date and/or a time.
 * 14-17 and 22 are the classic date/time set; 27-36 and 50-58 are the
 * far-east date sets; 45-47 are elapsed/second time formats.
 */
const BUILTIN_DATE_FORMATS = new Set<number>([
  14, 15, 16, 17, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55,
  56, 57, 58,
]);

/**
 * Decide whether a custom format string renders a date or a time.
 *
 * Quoted literals, backslash-escaped characters and bracketed sections
 * (`[Red]`, `[$TL-41F]`, `[h]`) are removed first so that a currency or
 * locale prefix cannot be mistaken for a date token, then only the first
 * (positive-number) section is tested. Pure numeric formats such as `0.00`
 * or `#,##0` contain none of y/m/d/h/s and are correctly rejected.
 */
function isDateFormatString(format: string): boolean {
  const stripped = format
    .replace(/\[[^\]]*\]/g, '')
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '');
  const positiveSection = stripped.split(';')[0] ?? '';
  return /[ymdhs]/i.test(positiveSection);
}

const MS_PER_DAY = 86_400_000;
const NOON_MS = 12 * 3_600_000;

/**
 * Convert an Excel serial to a Date.
 *
 * 1900 mode reproduces the Lotus 1-2-3 leap-year bug: serial 60 is the
 * non-existent 1900-02-29, so serials below 61 need a one-day correction on
 * top of the 1899-12-30 anchor. 1904 mode has no such bug.
 *
 * A whole-day serial is anchored at 12:00 UTC, never midnight: a midnight
 * anchor lands on the previous calendar day for every viewer west of UTC once
 * the value is rendered locally, which silently shifts birth dates. When the
 * serial carries a fractional part the file is expressing a real time of day,
 * so that time is preserved instead of being forced to noon.
 */
function serialToDate(serial: number, epoch1904: boolean): Date {
  const days = epoch1904 ? serial : serial >= 61 ? serial : serial + 1;
  const base = epoch1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const whole = Math.floor(days);
  const frac = days - whole;
  let ms = base + whole * MS_PER_DAY;
  ms += frac > 0 ? Math.round(frac * MS_PER_DAY) : NOON_MS;
  return new Date(ms);
}

/** Scratch buffer for the RK "high 30 bits of a double" decode. */
const rkScratch = Buffer.alloc(8);

/**
 * Decode an RK number.
 * bit0 fX100: the decoded value is divided by 100.
 * bit1 fInt : 1 => the upper 30 bits are a signed integer (arithmetic shift);
 *             0 => the upper 30 bits are the high 30 bits of an IEEE-754
 *                  double whose low 34 bits are zero.
 */
function decodeRk(rk: number): number {
  const fX100 = (rk & 0x01) !== 0;
  const fInt = (rk & 0x02) !== 0;
  let value: number;
  if (fInt) {
    value = rk >> 2;
  } else {
    rkScratch.writeUInt32LE(0, 0);
    rkScratch.writeInt32LE(rk & ~0x03, 4);
    value = rkScratch.readDoubleLE(0);
  }
  return fX100 ? value / 100 : value;
}

// ---------------------------------------------------------------------------
// Workbook parsing
// ---------------------------------------------------------------------------

interface BoundSheet {
  name: string;
  index: number;
  position: number;
  visibility: Biff8SheetVisibility;
  sheetType: number;
}

interface Globals {
  boundSheets: BoundSheet[];
  sst: string[];
  sstReferences: number;
  epoch1904: boolean;
  codePage: number | null;
  /** ifmt -> format string, from FORMAT records. */
  formats: Map<number, string>;
  /** XF index -> ifmt, from XF records in order of appearance. */
  xfFormats: number[];
  /** Offset just past the globals EOF. */
  endOffset: number;
  records: number;
}

const MAX_XF_RECORDS = 65_536;

/** Collect a record and every CONTINUE record that logically extends it. */
function collectContinued(
  stream: Buffer,
  first: RecordRef,
  limits: Biff8Limits,
): { segments: RecordRef[]; next: number } {
  const segments: RecordRef[] = [first];
  let pos = first.start + first.length;
  for (;;) {
    const peek = readRecord(stream, pos);
    if (!peek || peek.type !== REC_CONTINUE) break;
    if (segments.length > limits.maxContinueChain) {
      throwLimitExceeded('maxContinueChain', segments.length, limits.maxContinueChain);
    }
    segments.push(peek);
    pos = peek.start + peek.length;
  }
  return { segments, next: pos };
}

function parseSst(stream: Buffer, segments: RecordRef[], limits: Biff8Limits): {
  strings: string[];
  references: number;
} {
  const reader = new SegmentReader(stream, segments);
  const cstTotal = reader.readU32();
  const cstUnique = reader.readU32();
  if (cstUnique > limits.maxSstStrings) {
    throwLimitExceeded('maxSstStrings', cstUnique, limits.maxSstStrings);
  }
  const strings = new Array<string>(cstUnique);
  let totalChars = 0;
  for (let i = 0; i < cstUnique; i += 1) {
    if (reader.atEnd()) {
      throw new Biff8Error('BIFF_MALFORMED', `SST ended after ${i} of ${cstUnique} strings`);
    }
    const value = readXLUnicodeString(reader, 2, true, limits);
    totalChars += value.length;
    if (totalChars > limits.maxTotalStringChars) {
      throwLimitExceeded('maxTotalStringChars', totalChars, limits.maxTotalStringChars);
    }
    strings[i] = value;
  }
  return { strings, references: cstTotal };
}

function parseGlobals(stream: Buffer, limits: Biff8Limits): Globals {
  const first = readRecord(stream, 0);
  if (!first || first.type !== REC_BOF) {
    throw new Biff8Error('BIFF_MALFORMED', 'workbook stream does not start with a BOF record');
  }
  if (first.length < 4) {
    throw new Biff8Error('BIFF_MALFORMED', `BOF payload too short (${first.length} bytes)`);
  }
  const version = stream.readUInt16LE(first.start);
  const substream = stream.readUInt16LE(first.start + 2);
  if (version !== 0 && version < BIFF8_VERSION) {
    throw new Biff8Error('BIFF5_UNSUPPORTED', `BOF version 0x${version.toString(16)}`);
  }
  if (substream !== BOF_SUBSTREAM_GLOBALS) {
    throw new Biff8Error('BIFF_MALFORMED', `first substream type 0x${substream.toString(16)}`);
  }

  const globals: Globals = {
    boundSheets: [],
    sst: [],
    sstReferences: 0,
    epoch1904: false,
    codePage: null,
    formats: new Map<number, string>(),
    xfFormats: [],
    endOffset: stream.length,
    records: 1,
  };

  let pos = first.start + first.length;
  for (;;) {
    const rec = readRecord(stream, pos);
    if (!rec) {
      globals.endOffset = stream.length;
      break;
    }
    globals.records += 1;
    let next = rec.start + rec.length;

    switch (rec.type) {
      case REC_EOF:
        globals.endOffset = next;
        return globals;

      case REC_FILEPASS:
        throw new Biff8Error('ENCRYPTED_UNSUPPORTED', 'FILEPASS record present in workbook globals');

      case REC_DATEMODE:
        if (rec.length >= 2) globals.epoch1904 = stream.readUInt16LE(rec.start) === 1;
        break;

      case REC_CODEPAGE:
        if (rec.length >= 2) globals.codePage = stream.readUInt16LE(rec.start);
        break;

      case REC_BOUNDSHEET: {
        if (globals.boundSheets.length >= limits.maxSheets) {
          throwLimitExceeded('maxSheets', globals.boundSheets.length + 1, limits.maxSheets);
        }
        if (rec.length < 6) {
          throw new Biff8Error('BIFF_MALFORMED', `BOUNDSHEET payload ${rec.length} bytes`);
        }
        const position = stream.readUInt32LE(rec.start);
        const hsState = stream.readUInt8(rec.start + 4) & 0x03;
        const sheetType = stream.readUInt8(rec.start + 5);
        const nameReader = new SegmentReader(stream, [
          { type: rec.type, start: rec.start + 6, length: rec.length - 6 },
        ]);
        const name = readXLUnicodeString(nameReader, 1, false, limits);
        globals.boundSheets.push({
          name,
          index: globals.boundSheets.length,
          position,
          visibility: hsState === 2 ? 'very_hidden' : hsState === 1 ? 'hidden' : 'visible',
          sheetType,
        });
        break;
      }

      case REC_FORMAT: {
        if (rec.length < 3) break;
        const ifmt = stream.readUInt16LE(rec.start);
        const collected = collectContinued(stream, rec, limits);
        globals.records += collected.segments.length - 1;
        const reader = new SegmentReader(stream, [
          { type: rec.type, start: rec.start + 2, length: rec.length - 2 },
          ...collected.segments.slice(1),
        ]);
        globals.formats.set(ifmt, readXLUnicodeString(reader, 2, true, limits));
        next = collected.next;
        break;
      }

      case REC_XF: {
        if (globals.xfFormats.length >= MAX_XF_RECORDS) {
          throw new Biff8Error('BIFF_MALFORMED', `more than ${MAX_XF_RECORDS} XF records`);
        }
        globals.xfFormats.push(rec.length >= 4 ? stream.readUInt16LE(rec.start + 2) : 0);
        break;
      }

      case REC_SST: {
        const collected = collectContinued(stream, rec, limits);
        globals.records += collected.segments.length - 1;
        const parsed = parseSst(stream, collected.segments, limits);
        globals.sst = parsed.strings;
        globals.sstReferences = parsed.references;
        next = collected.next;
        break;
      }

      default:
        break;
    }

    pos = next;
  }
  return globals;
}

// ---------------------------------------------------------------------------
// Worksheet parsing
// ---------------------------------------------------------------------------

interface SheetAccumulator {
  /** Sparse: rows[r] is created on first write; holes stay undefined. */
  rows: (Biff8CellValue[] | undefined)[];
  maxRow: number;
  maxCol: number;
}

interface ParseContext {
  stream: Buffer;
  globals: Globals;
  limits: Biff8Limits;
  /** Mutated running totals for Biff8Stats. */
  counters: { records: number; cells: number; formulas: number };
}

/** True when the XF at `ixfe` carries a date/time number format. */
function isDateXf(globals: Globals, ixfe: number): boolean {
  const ifmt = globals.xfFormats[ixfe];
  if (ifmt === undefined) return false;
  if (BUILTIN_DATE_FORMATS.has(ifmt)) return true;
  const custom = globals.formats.get(ifmt);
  return custom !== undefined && isDateFormatString(custom);
}

function numericCell(globals: Globals, ixfe: number, value: number): Biff8CellValue {
  if (isDateXf(globals, ixfe)) {
    return { kind: 'date', value: serialToDate(value, globals.epoch1904), serial: value };
  }
  return { kind: 'number', value };
}

function setCell(
  acc: SheetAccumulator,
  ctx: ParseContext,
  row: number,
  col: number,
  value: Biff8CellValue,
): void {
  const { limits } = ctx;
  if (row >= limits.maxRows) throwLimitExceeded('maxRows', row + 1, limits.maxRows);
  if (col >= limits.maxColumns) throwLimitExceeded('maxColumns', col + 1, limits.maxColumns);
  ctx.counters.cells += 1;
  if (ctx.counters.cells > limits.maxCells) {
    throwLimitExceeded('maxCells', ctx.counters.cells, limits.maxCells);
  }
  let line = acc.rows[row];
  if (!line) {
    line = [];
    acc.rows[row] = line;
  }
  line[col] = value;
  if (row > acc.maxRow) acc.maxRow = row;
  if (col > acc.maxCol) acc.maxCol = col;
}

/**
 * Parse one worksheet substream, beginning at its BOF record.
 * Nested substreams (an embedded chart, for example) are tracked by depth so
 * their EOF does not terminate the worksheet early.
 */
function parseSheet(ctx: ParseContext, sheet: BoundSheet): Biff8Sheet {
  const { stream, globals, limits } = ctx;
  if (sheet.position + 4 > stream.length) {
    throw new Biff8Error('BIFF_MALFORMED', `sheet ${sheet.index} position ${sheet.position} past end`);
  }
  const bof = readRecord(stream, sheet.position);
  if (!bof || bof.type !== REC_BOF) {
    throw new Biff8Error('BIFF_MALFORMED', `no BOF at sheet ${sheet.index} position ${sheet.position}`);
  }
  ctx.counters.records += 1;

  const acc: SheetAccumulator = { rows: [], maxRow: -1, maxCol: -1 };
  let dimRows = 0;
  let dimCols = 0;
  let depth = 1;
  let pos = bof.start + bof.length;
  /** Cell awaiting the STRING record that carries a FORMULA's cached text. */
  let pendingFormulaString: { row: number; col: number } | null = null;

  while (depth > 0) {
    const rec = readRecord(stream, pos);
    if (!rec) break;
    ctx.counters.records += 1;
    let next = rec.start + rec.length;
    const p = rec.start;

    switch (rec.type) {
      case REC_BOF:
        depth += 1;
        break;

      case REC_EOF:
        depth -= 1;
        break;

      case REC_DIMENSIONS: {
        if (rec.length >= 14) {
          const rowFirst = stream.readUInt32LE(p);
          const rowLast = stream.readUInt32LE(p + 4);
          const colFirst = stream.readUInt16LE(p + 8);
          const colLast = stream.readUInt16LE(p + 10);
          dimRows = rowLast > rowFirst ? rowLast : 0;
          dimCols = colLast > colFirst ? colLast : 0;
          if (dimRows > limits.maxRows) throwLimitExceeded('maxRows', dimRows, limits.maxRows);
          if (dimCols > limits.maxColumns) {
            throwLimitExceeded('maxColumns', dimCols, limits.maxColumns);
          }
        }
        break;
      }

      case REC_LABELSST: {
        if (rec.length < 10) break;
        const row = stream.readUInt16LE(p);
        const col = stream.readUInt16LE(p + 2);
        const isst = stream.readUInt32LE(p + 6);
        const value = globals.sst[isst];
        if (value === undefined) {
          throw new Biff8Error('BIFF_MALFORMED', `LABELSST index ${isst} outside SST`);
        }
        setCell(acc, ctx, row, col, { kind: 'string', value });
        break;
      }

      case REC_LABEL:
      case REC_RSTRING: {
        if (rec.length < 9) break;
        const row = stream.readUInt16LE(p);
        const col = stream.readUInt16LE(p + 2);
        const collected = collectContinued(stream, rec, limits);
        ctx.counters.records += collected.segments.length - 1;
        const reader = new SegmentReader(stream, [
          { type: rec.type, start: p + 6, length: rec.length - 6 },
          ...collected.segments.slice(1),
        ]);
        const value = readXLUnicodeString(reader, 2, true, limits);
        setCell(acc, ctx, row, col, { kind: 'string', value });
        next = collected.next;
        break;
      }

      case REC_RK: {
        if (rec.length < 10) break;
        const row = stream.readUInt16LE(p);
        const col = stream.readUInt16LE(p + 2);
        const ixfe = stream.readUInt16LE(p + 4);
        setCell(acc, ctx, row, col, numericCell(globals, ixfe, decodeRk(stream.readInt32LE(p + 6))));
        break;
      }

      case REC_MULRK: {
        if (rec.length < 6) break;
        const row = stream.readUInt16LE(p);
        const colFirst = stream.readUInt16LE(p + 2);
        const count = Math.floor((rec.length - 6) / 6);
        for (let i = 0; i < count; i += 1) {
          const off = p + 4 + i * 6;
          const ixfe = stream.readUInt16LE(off);
          const value = decodeRk(stream.readInt32LE(off + 2));
          setCell(acc, ctx, row, colFirst + i, numericCell(globals, ixfe, value));
        }
        break;
      }

      case REC_NUMBER: {
        if (rec.length < 14) break;
        const row = stream.readUInt16LE(p);
        const col = stream.readUInt16LE(p + 2);
        const ixfe = stream.readUInt16LE(p + 4);
        setCell(acc, ctx, row, col, numericCell(globals, ixfe, stream.readDoubleLE(p + 6)));
        break;
      }

      case REC_BOOLERR: {
        if (rec.length < 8) break;
        const row = stream.readUInt16LE(p);
        const col = stream.readUInt16LE(p + 2);
        const value = stream.readUInt8(p + 6);
        const isError = stream.readUInt8(p + 7) === 1;
        setCell(
          acc,
          ctx,
          row,
          col,
          isError ? { kind: 'error', code: value } : { kind: 'boolean', value: value !== 0 },
        );
        break;
      }

      case REC_BLANK: {
        if (rec.length < 6) break;
        setCell(acc, ctx, stream.readUInt16LE(p), stream.readUInt16LE(p + 2), EMPTY_CELL);
        break;
      }

      case REC_MULBLANK: {
        if (rec.length < 6) break;
        const row = stream.readUInt16LE(p);
        const colFirst = stream.readUInt16LE(p + 2);
        const count = Math.floor((rec.length - 6) / 2);
        for (let i = 0; i < count; i += 1) setCell(acc, ctx, row, colFirst + i, EMPTY_CELL);
        break;
      }

      case REC_FORMULA: {
        // The cached result only. rgce (the parsed expression) is never read
        // and never evaluated.
        if (rec.length < 20) break;
        ctx.counters.formulas += 1;
        const row = stream.readUInt16LE(p);
        const col = stream.readUInt16LE(p + 2);
        const ixfe = stream.readUInt16LE(p + 4);
        pendingFormulaString = null;
        if (stream.readUInt16LE(p + 12) === 0xffff) {
          const kind = stream.readUInt8(p + 6);
          const operand = stream.readUInt8(p + 8);
          if (kind === 0) {
            // Cached string arrives in the following STRING record.
            setCell(acc, ctx, row, col, { kind: 'string', value: '' });
            pendingFormulaString = { row, col };
          } else if (kind === 1) {
            setCell(acc, ctx, row, col, { kind: 'boolean', value: operand !== 0 });
          } else if (kind === 2) {
            setCell(acc, ctx, row, col, { kind: 'error', code: operand });
          } else {
            setCell(acc, ctx, row, col, EMPTY_CELL);
          }
        } else {
          setCell(acc, ctx, row, col, numericCell(globals, ixfe, stream.readDoubleLE(p + 6)));
        }
        break;
      }

      case REC_STRING: {
        if (!pendingFormulaString || rec.length < 3) break;
        const collected = collectContinued(stream, rec, limits);
        ctx.counters.records += collected.segments.length - 1;
        const reader = new SegmentReader(stream, collected.segments);
        const value = readXLUnicodeString(reader, 2, true, limits);
        const line = acc.rows[pendingFormulaString.row];
        if (line) line[pendingFormulaString.col] = { kind: 'string', value };
        pendingFormulaString = null;
        next = collected.next;
        break;
      }

      default:
        break;
    }

    pos = next;
  }

  return finalizeSheet(sheet, acc, dimCols);
}

/**
 * Turn the sparse accumulator into a dense grid.
 *
 * DIMENSIONS is advisory and is resolved asymmetrically, on purpose:
 *  - rows are clamped DOWN to the observed extent. Some writers emit a
 *    whole-sheet DIMENSIONS; honouring it would allocate up to `maxRows`
 *    empty rows for a workbook with ten real ones. Trailing all-empty rows
 *    carry no information for an import.
 *  - columns are expanded UP to the DIMENSIONS extent (already bounded by
 *    `maxColumns` in the caller, so at most 1024 slots per row). A trailing
 *    column that is empty in every row is still part of the sheet's declared
 *    schema width, and a migration must not silently narrow the grid.
 * Rows are never truncated below what was actually read in either direction,
 * so no cell that exists in the file can be lost. For a well-formed workbook
 * both extents agree exactly.
 */
function finalizeSheet(
  sheet: BoundSheet,
  acc: SheetAccumulator,
  dimCols: number,
): Biff8Sheet {
  const observedRows = acc.maxRow + 1;
  const observedCols = acc.maxCol + 1;
  const rowCount = observedRows > 0 ? observedRows : 0;
  const columnCount = observedCols > 0 ? Math.max(observedCols, dimCols) : 0;

  const rows: Biff8CellValue[][] = new Array<Biff8CellValue[]>(rowCount);
  for (let r = 0; r < rowCount; r += 1) {
    const src = acc.rows[r];
    const line = new Array<Biff8CellValue>(columnCount);
    for (let c = 0; c < columnCount; c += 1) {
      const cell = src ? src[c] : undefined;
      line[c] = cell === undefined ? EMPTY_CELL : cell;
    }
    rows[r] = line;
  }

  return {
    name: sheet.name,
    index: sheet.index,
    hidden: sheet.visibility !== 'visible',
    visibility: sheet.visibility,
    rowCount,
    columnCount,
    rows,
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Read a legacy binary `.xls` workbook.
 *
 * @param buffer the whole file. The container is never copied; only the
 *   `Workbook` stream is materialised (one contiguous copy, because CFB
 *   sectors are not stored in order).
 * @param limits optional overrides for DEFAULT_BIFF8_LIMITS.
 * @throws Biff8Error with a stable `.code` for every rejection path.
 */
export function readBiff8(buffer: Buffer, limits?: Partial<Biff8Limits>): Biff8Workbook {
  const startedAt = performance.now();
  const resolved = resolveBiff8Limits(limits);

  if (!Buffer.isBuffer(buffer)) {
    throw new Biff8Error('NOT_OLE2', 'input is not a Buffer');
  }
  if (buffer.length > resolved.maxFileBytes) {
    throwLimitExceeded('maxFileBytes', buffer.length, resolved.maxFileBytes);
  }
  if (!isOle2(buffer)) {
    throw new Biff8Error('NOT_OLE2', `magic mismatch (${buffer.length} bytes)`);
  }

  const container = new CfbContainer(buffer, resolved);
  const workbookEntry = container.findStream('Workbook');
  if (!workbookEntry) {
    if (container.findStream('Book')) {
      throw new Biff8Error('BIFF5_UNSUPPORTED', 'container exposes a BIFF5 "Book" stream');
    }
    throw new Biff8Error('WORKBOOK_STREAM_MISSING', `no "Workbook" stream among ${container.entries.length} directory entries`);
  }

  const stream = container.readStream(workbookEntry);
  const globals = parseGlobals(stream, resolved);

  const ctx: ParseContext = {
    stream,
    globals,
    limits: resolved,
    counters: { records: globals.records, cells: 0, formulas: 0 },
  };

  const sheets: Biff8Sheet[] = [];
  for (const bound of globals.boundSheets) {
    // Only worksheets carry cell records; chart and macro substreams are
    // recognised and skipped rather than mis-parsed.
    if (bound.sheetType !== 0) continue;
    sheets.push(parseSheet(ctx, bound));
  }
  if (sheets.length === 0) {
    throw new Biff8Error('NO_SHEETS', `${globals.boundSheets.length} BOUNDSHEET records, none a worksheet`);
  }

  return {
    sheets,
    dateEpoch: globals.epoch1904 ? 1904 : 1900,
    codePage: globals.codePage,
    stats: {
      records: ctx.counters.records,
      sstStrings: globals.sst.length,
      sstReferences: globals.sstReferences,
      cells: ctx.counters.cells,
      formulas: ctx.counters.formulas,
      parseMs: performance.now() - startedAt,
    },
  };
}

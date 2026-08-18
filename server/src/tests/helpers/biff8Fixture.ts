/**
 * biff8Fixture.ts — synthetic BIFF8 `.xls` writer for tests.
 *
 * Produces a genuine OLE2/CFB container holding a real BIFF8 `Workbook`
 * stream, built from a plain JS description. Tests therefore exercise the
 * reader against real binary input with NO real workbook and NO patient data
 * anywhere in the repository.
 *
 * This writer emits exactly the record subset
 * `services/migration/parser/biff8Reader.ts` consumes — BOF/EOF, CODEPAGE,
 * DATEMODE, FORMAT, XF, BOUNDSHEET, SST(+CONTINUE), DIMENSIONS, LABELSST,
 * NUMBER, RK/MULRK, BOOLERR, BLANK/MULBLANK — and nothing more. It is not a
 * general-purpose Excel writer and the files it produces are not intended to
 * be opened by Excel.
 *
 * Container simplification (deliberate, documented): the `Workbook` stream is
 * zero-padded to at least the 4096-byte mini-stream cutoff so it always lives
 * in normal 512-byte sectors. The root storage therefore carries an empty
 * mini stream and the mini-FAT is empty. The reader implements both the
 * normal and the mini path; only the normal path is reachable from here.
 */

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

export interface FixtureCell {
  /** `null` emits a BLANK cell. A number with `date: true` is an Excel serial. */
  v: string | number | boolean | null;
  date?: boolean;
}

export interface FixtureSheet {
  name: string;
  /** Emits hidden state 1. Use `veryHidden` for state 2. */
  hidden?: boolean;
  veryHidden?: boolean;
  rows: FixtureCell[][];
}

export interface FixtureOptions {
  /** DATEMODE. Default 1900. */
  epoch?: 1900 | 1904;
  /**
   * Shrink the SST record payload budget to 64 bytes so ordinary short
   * strings are split across CONTINUE records, and flip a compressed run to
   * UTF-16 at every split. Both are legal BIFF8 and both are the paths that
   * corrupt Turkish text when a reader gets them wrong.
   */
  forceContinueSplit?: boolean;
  /** Emit MULRK / MULBLANK for runs of 2+ adjacent integers / blanks. */
  preferMulti?: boolean;
}

// ---------------------------------------------------------------------------
// Record ids and low-level writers
// ---------------------------------------------------------------------------

const REC_EOF = 0x000a;
const REC_CONTINUE = 0x003c;
const REC_DATEMODE = 0x0022;
const REC_CODEPAGE = 0x0042;
const REC_XF = 0x00e0;
const REC_BOUNDSHEET = 0x0085;
const REC_MULRK = 0x00bd;
const REC_MULBLANK = 0x00be;
const REC_SST = 0x00fc;
const REC_LABELSST = 0x00fd;
const REC_BLANK = 0x0201;
const REC_DIMENSIONS = 0x0200;
const REC_NUMBER = 0x0203;
const REC_BOOLERR = 0x0205;
const REC_FORMAT = 0x041e;
const REC_BOF = 0x0809;

/** Maximum BIFF8 record payload. CONTINUE carries the overflow. */
const MAX_RECORD_PAYLOAD = 8224;

const DATE_IFMT = 164;
const DATE_FORMAT_STRING = 'yyyy-mm-dd';
/** 16 style XFs then two cell XFs: index 16 = General, index 17 = date. */
const STYLE_XF_COUNT = 16;
const XF_GENERAL = 16;
const XF_DATE = 17;

function record(type: number, payload: Buffer): Buffer {
  const out = Buffer.alloc(4 + payload.length);
  out.writeUInt16LE(type, 0);
  out.writeUInt16LE(payload.length, 2);
  payload.copy(out, 4);
  return out;
}

/** True when any UTF-16 code unit exceeds one byte, so the string cannot be compressed. */
function needsUtf16(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    if (value.charCodeAt(i) > 0xff) return true;
  }
  return false;
}

/** Encode a string the way BIFF8 does: compressed when every unit fits a byte. */
function encodeInlineString(value: string, cchBytes: 1 | 2): Buffer {
  const high = needsUtf16(value);
  const out = Buffer.alloc(cchBytes + 1 + value.length * (high ? 2 : 1));
  if (cchBytes === 2) out.writeUInt16LE(value.length, 0);
  else out.writeUInt8(value.length, 0);
  out.writeUInt8(high ? 1 : 0, cchBytes);
  let p = cchBytes + 1;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (high) {
      out.writeUInt16LE(code, p);
      p += 2;
    } else {
      out.writeUInt8(code & 0xff, p);
      p += 1;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// SST writer with real CONTINUE splitting
// ---------------------------------------------------------------------------

/**
 * Serialises the shared string table across SST + CONTINUE records.
 *
 * Header fields (cch, grbit) are never split — the builder starts a new record
 * instead. Character data IS split wherever the budget runs out, and the
 * CONTINUE payload then opens with a fresh 1-byte grbit for the remaining
 * characters, exactly as [MS-XLS] requires. When `flipOnSplit` is set the
 * remainder of a compressed string continues as UTF-16LE, which is legal and
 * is the case a naive reader decodes as mojibake.
 */
class SstBuilder {
  private readonly limit: number;
  private readonly flipOnSplit: boolean;
  private readonly done: number[][] = [];
  private cur: number[] = [];

  constructor(limit: number, flipOnSplit: boolean) {
    this.limit = limit;
    this.flipOnSplit = flipOnSplit;
  }

  private space(): number {
    return this.limit - this.cur.length;
  }

  private startNewRecord(): void {
    this.done.push(this.cur);
    this.cur = [];
  }

  private ensure(n: number): void {
    if (this.space() < n) this.startNewRecord();
  }

  u32(value: number): void {
    this.ensure(4);
    this.cur.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
  }

  writeString(value: string): void {
    const high = needsUtf16(value);
    // cch(2) + grbit(1) + at least one byte of character data stay together.
    this.ensure(4);
    this.cur.push(value.length & 0xff, (value.length >>> 8) & 0xff, high ? 1 : 0);
    let written = 0;
    let currentHigh = high;
    while (written < value.length) {
      const unit = currentHigh ? 2 : 1;
      if (this.space() < unit) {
        this.startNewRecord();
        if (this.flipOnSplit && !currentHigh) currentHigh = true;
        this.cur.push(currentHigh ? 1 : 0);
        continue;
      }
      const take = Math.min(value.length - written, Math.floor(this.space() / unit));
      for (let i = 0; i < take; i += 1) {
        const code = value.charCodeAt(written + i);
        if (currentHigh) this.cur.push(code & 0xff, (code >>> 8) & 0xff);
        else this.cur.push(code & 0xff);
      }
      written += take;
    }
  }

  /** [SST record, CONTINUE record, ...]. */
  finish(): Buffer[] {
    this.done.push(this.cur);
    this.cur = [];
    return this.done.map((bytes, index) =>
      record(index === 0 ? REC_SST : REC_CONTINUE, Buffer.from(bytes)),
    );
  }
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

const RK_INT_MIN = -(2 ** 29);
const RK_INT_MAX = 2 ** 29 - 1;

function isRkInteger(value: number): boolean {
  return Number.isInteger(value) && value >= RK_INT_MIN && value <= RK_INT_MAX;
}

/** Encode a small integer as an RK value with fInt set. */
function encodeRkInteger(value: number): number {
  return ((value << 2) | 0x02) >>> 0;
}

// ---------------------------------------------------------------------------
// Fixture assembly
// ---------------------------------------------------------------------------

function buildWorkbookStream(sheets: FixtureSheet[], opts: FixtureOptions): Buffer {
  const epoch1904 = opts.epoch === 1904;
  const preferMulti = opts.preferMulti === true;
  const sstLimit = opts.forceContinueSplit ? 64 : MAX_RECORD_PAYLOAD;

  // Pass 1 — shared string table.
  const sstIndex = new Map<string, number>();
  const sstOrder: string[] = [];
  let sstReferences = 0;
  for (const sheet of sheets) {
    for (const row of sheet.rows) {
      for (const cell of row) {
        if (typeof cell.v !== 'string') continue;
        sstReferences += 1;
        if (!sstIndex.has(cell.v)) {
          sstIndex.set(cell.v, sstOrder.length);
          sstOrder.push(cell.v);
        }
      }
    }
  }

  const sst = new SstBuilder(sstLimit, opts.forceContinueSplit === true);
  sst.u32(sstReferences);
  sst.u32(sstOrder.length);
  for (const value of sstOrder) sst.writeString(value);

  // Pass 2 — globals substream.
  const globals: Buffer[] = [];
  const bofPayload = Buffer.alloc(16);
  bofPayload.writeUInt16LE(0x0600, 0);
  bofPayload.writeUInt16LE(0x0005, 2);
  globals.push(record(REC_BOF, bofPayload));

  const codePage = Buffer.alloc(2);
  codePage.writeUInt16LE(1200, 0);
  globals.push(record(REC_CODEPAGE, codePage));

  const dateMode = Buffer.alloc(2);
  dateMode.writeUInt16LE(epoch1904 ? 1 : 0, 0);
  globals.push(record(REC_DATEMODE, dateMode));

  const formatPayload = Buffer.concat([Buffer.alloc(2), encodeInlineString(DATE_FORMAT_STRING, 2)]);
  formatPayload.writeUInt16LE(DATE_IFMT, 0);
  globals.push(record(REC_FORMAT, formatPayload));

  for (let i = 0; i < STYLE_XF_COUNT + 2; i += 1) {
    const xf = Buffer.alloc(20);
    xf.writeUInt16LE(i === XF_DATE ? DATE_IFMT : 0, 2);
    globals.push(record(REC_XF, xf));
  }

  const boundSheetSlots: number[] = [];
  for (const sheet of sheets) {
    const nameBytes = encodeInlineString(sheet.name, 1);
    const payload = Buffer.alloc(6 + nameBytes.length);
    payload.writeUInt32LE(0, 0); // lbPlyPos, back-patched below
    payload.writeUInt8(sheet.veryHidden ? 2 : sheet.hidden ? 1 : 0, 4);
    payload.writeUInt8(0, 5); // dt: worksheet
    nameBytes.copy(payload, 6);
    boundSheetSlots.push(globals.length);
    globals.push(record(REC_BOUNDSHEET, payload));
  }

  for (const rec of sst.finish()) globals.push(rec);
  globals.push(record(REC_EOF, Buffer.alloc(0)));

  // Pass 3 — worksheet substreams, tracking each substream's stream offset.
  let offset = globals.reduce((sum, buf) => sum + buf.length, 0);
  const sheetChunks: Buffer[] = [];
  const sheetPositions: number[] = [];

  for (const sheet of sheets) {
    sheetPositions.push(offset);
    const chunk = buildSheetSubstream(sheet, sstIndex, preferMulti);
    sheetChunks.push(chunk);
    offset += chunk.length;
  }

  for (let i = 0; i < boundSheetSlots.length; i += 1) {
    const buf = globals[boundSheetSlots[i]] as Buffer;
    buf.writeUInt32LE(sheetPositions[i] as number, 4); // payload offset 0
  }

  const body = Buffer.concat([...globals, ...sheetChunks]);
  // Pad past the mini-stream cutoff so the stream uses normal sectors.
  if (body.length >= 4096) return body;
  return Buffer.concat([body, Buffer.alloc(4096 - body.length)]);
}

function buildSheetSubstream(
  sheet: FixtureSheet,
  sstIndex: Map<string, number>,
  preferMulti: boolean,
): Buffer {
  const out: Buffer[] = [];
  const bof = Buffer.alloc(16);
  bof.writeUInt16LE(0x0600, 0);
  bof.writeUInt16LE(0x0010, 2);
  out.push(record(REC_BOF, bof));

  const rowCount = sheet.rows.length;
  let colCount = 0;
  for (const row of sheet.rows) colCount = Math.max(colCount, row.length);

  const dims = Buffer.alloc(14);
  dims.writeUInt32LE(0, 0);
  dims.writeUInt32LE(rowCount, 4);
  dims.writeUInt16LE(0, 8);
  dims.writeUInt16LE(colCount, 10);
  out.push(record(REC_DIMENSIONS, dims));

  for (let r = 0; r < rowCount; r += 1) {
    const row = sheet.rows[r] as FixtureCell[];
    let c = 0;
    while (c < row.length) {
      const cell = row[c] as FixtureCell;

      if (preferMulti && cell.v === null) {
        let end = c;
        while (end < row.length && (row[end] as FixtureCell).v === null) end += 1;
        if (end - c >= 2) {
          const payload = Buffer.alloc(6 + (end - c) * 2);
          payload.writeUInt16LE(r, 0);
          payload.writeUInt16LE(c, 2);
          for (let i = 0; i < end - c; i += 1) payload.writeUInt16LE(XF_GENERAL, 4 + i * 2);
          payload.writeUInt16LE(end - 1, 4 + (end - c) * 2);
          out.push(record(REC_MULBLANK, payload));
          c = end;
          continue;
        }
      }

      if (preferMulti && typeof cell.v === 'number' && cell.date !== true && isRkInteger(cell.v)) {
        let end = c;
        while (end < row.length) {
          const candidate = row[end] as FixtureCell;
          if (typeof candidate.v !== 'number' || candidate.date === true || !isRkInteger(candidate.v)) {
            break;
          }
          end += 1;
        }
        if (end - c >= 2) {
          const payload = Buffer.alloc(6 + (end - c) * 6);
          payload.writeUInt16LE(r, 0);
          payload.writeUInt16LE(c, 2);
          for (let i = 0; i < end - c; i += 1) {
            payload.writeUInt16LE(XF_GENERAL, 4 + i * 6);
            payload.writeUInt32LE(encodeRkInteger((row[c + i] as FixtureCell).v as number), 6 + i * 6);
          }
          payload.writeUInt16LE(end - 1, 4 + (end - c) * 6);
          out.push(record(REC_MULRK, payload));
          c = end;
          continue;
        }
      }

      out.push(encodeSingleCell(r, c, cell, sstIndex));
      c += 1;
    }
  }

  out.push(record(REC_EOF, Buffer.alloc(0)));
  return Buffer.concat(out);
}

function encodeSingleCell(
  row: number,
  col: number,
  cell: FixtureCell,
  sstIndex: Map<string, number>,
): Buffer {
  if (cell.v === null || cell.v === undefined) {
    const payload = Buffer.alloc(6);
    payload.writeUInt16LE(row, 0);
    payload.writeUInt16LE(col, 2);
    payload.writeUInt16LE(XF_GENERAL, 4);
    return record(REC_BLANK, payload);
  }

  if (typeof cell.v === 'string') {
    const isst = sstIndex.get(cell.v);
    if (isst === undefined) throw new Error('biff8Fixture: string missing from the SST index');
    const payload = Buffer.alloc(10);
    payload.writeUInt16LE(row, 0);
    payload.writeUInt16LE(col, 2);
    payload.writeUInt16LE(XF_GENERAL, 4);
    payload.writeUInt32LE(isst, 6);
    return record(REC_LABELSST, payload);
  }

  if (typeof cell.v === 'boolean') {
    const payload = Buffer.alloc(8);
    payload.writeUInt16LE(row, 0);
    payload.writeUInt16LE(col, 2);
    payload.writeUInt16LE(XF_GENERAL, 4);
    payload.writeUInt8(cell.v ? 1 : 0, 6);
    payload.writeUInt8(0, 7);
    return record(REC_BOOLERR, payload);
  }

  const payload = Buffer.alloc(14);
  payload.writeUInt16LE(row, 0);
  payload.writeUInt16LE(col, 2);
  payload.writeUInt16LE(cell.date === true ? XF_DATE : XF_GENERAL, 4);
  payload.writeDoubleLE(cell.v, 6);
  return record(REC_NUMBER, payload);
}

// ---------------------------------------------------------------------------
// CFB container writer
// ---------------------------------------------------------------------------

const OLE2_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const SECTOR_SIZE = 512;
const FAT_ENTRIES_PER_SECTOR = SECTOR_SIZE / 4;
const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;
const FATSECT = 0xfffffffd;

function writeDirEntry(
  target: Buffer,
  offset: number,
  name: string,
  objectType: number,
  startSector: number,
  streamSize: number,
  childId: number,
): void {
  const nameBuf = Buffer.from(name, 'utf16le');
  nameBuf.copy(target, offset);
  target.writeUInt16LE(nameBuf.length + 2, offset + 64);
  target.writeUInt8(objectType, offset + 66);
  target.writeUInt8(1, offset + 67); // colour: black
  target.writeUInt32LE(0xffffffff, offset + 68); // left sibling
  target.writeUInt32LE(0xffffffff, offset + 72); // right sibling
  target.writeUInt32LE(childId, offset + 76);
  target.writeUInt32LE(startSector, offset + 116);
  target.writeUInt32LE(streamSize, offset + 120);
  target.writeUInt32LE(0, offset + 124);
}

/** Wrap one named stream in a minimal, structurally valid CFB v3 container. */
function buildCfbContainer(streamName: string, streamData: Buffer): Buffer {
  const dataSectors = Math.ceil(streamData.length / SECTOR_SIZE);
  let fatSectors = 1;
  for (let guard = 0; guard < 64; guard += 1) {
    const needed = Math.max(
      1,
      Math.ceil((dataSectors + 1 + fatSectors) / FAT_ENTRIES_PER_SECTOR),
    );
    if (needed === fatSectors) break;
    fatSectors = needed;
  }
  if (fatSectors > 109) {
    throw new Error('biff8Fixture: fixture too large for a header-only DIFAT');
  }

  const dirSector = dataSectors;
  const firstFatSector = dataSectors + 1;
  const totalSectors = dataSectors + 1 + fatSectors;
  const out = Buffer.alloc(SECTOR_SIZE + totalSectors * SECTOR_SIZE);

  // Header.
  OLE2_MAGIC.copy(out, 0);
  out.writeUInt16LE(0x003e, 24); // minor version
  out.writeUInt16LE(3, 26); // major version (v3 => 512-byte sectors)
  out.writeUInt16LE(0xfffe, 28); // little endian
  out.writeUInt16LE(9, 30); // sector shift
  out.writeUInt16LE(6, 32); // mini sector shift
  out.writeUInt32LE(0, 40); // directory sector count (0 for v3)
  out.writeUInt32LE(fatSectors, 44);
  out.writeUInt32LE(dirSector, 48);
  out.writeUInt32LE(0, 52); // transaction signature
  out.writeUInt32LE(4096, 56); // mini stream cutoff
  out.writeUInt32LE(ENDOFCHAIN, 60); // first mini FAT sector
  out.writeUInt32LE(0, 64); // mini FAT sector count
  out.writeUInt32LE(ENDOFCHAIN, 68); // first DIFAT sector
  out.writeUInt32LE(0, 72); // DIFAT sector count
  for (let i = 0; i < 109; i += 1) {
    out.writeUInt32LE(i < fatSectors ? firstFatSector + i : FREESECT, 76 + i * 4);
  }

  // Stream payload.
  streamData.copy(out, SECTOR_SIZE);

  // Directory sector: root storage + the single stream.
  const dirOffset = SECTOR_SIZE + dirSector * SECTOR_SIZE;
  writeDirEntry(out, dirOffset, 'Root Entry', 5, ENDOFCHAIN, 0, 1);
  writeDirEntry(out, dirOffset + 128, streamName, 2, dataSectors > 0 ? 0 : ENDOFCHAIN, streamData.length, 0xffffffff);
  out.writeUInt8(0, dirOffset + 256 + 66); // unused slot
  out.writeUInt8(0, dirOffset + 384 + 66); // unused slot

  // FAT.
  const fat = new Uint32Array(fatSectors * FAT_ENTRIES_PER_SECTOR).fill(FREESECT);
  for (let i = 0; i < dataSectors; i += 1) fat[i] = i === dataSectors - 1 ? ENDOFCHAIN : i + 1;
  fat[dirSector] = ENDOFCHAIN;
  for (let i = 0; i < fatSectors; i += 1) fat[firstFatSector + i] = FATSECT;
  for (let i = 0; i < fat.length; i += 1) {
    out.writeUInt32LE(fat[i] as number, SECTOR_SIZE + firstFatSector * SECTOR_SIZE + i * 4);
  }

  return out;
}

// ---------------------------------------------------------------------------
// Exported builders
// ---------------------------------------------------------------------------

/** Build a real BIFF8 `.xls` buffer from a plain description. */
export function buildBiff8Fixture(sheets: FixtureSheet[], opts?: FixtureOptions): Buffer {
  if (sheets.length === 0) throw new Error('biff8Fixture: at least one sheet is required');
  return buildCfbContainer('Workbook', buildWorkbookStream(sheets, opts ?? {}));
}

/**
 * A buffer with a valid OLE2 signature whose header points the FAT at a
 * sector past the end of the file. Must be rejected with CFB_MALFORMED.
 */
export function buildCorruptOle2(): Buffer {
  const out = Buffer.alloc(SECTOR_SIZE);
  OLE2_MAGIC.copy(out, 0);
  out.writeUInt16LE(0x003e, 24);
  out.writeUInt16LE(3, 26);
  out.writeUInt16LE(0xfffe, 28);
  out.writeUInt16LE(9, 30);
  out.writeUInt16LE(6, 32);
  out.writeUInt32LE(1, 44); // one FAT sector...
  out.writeUInt32LE(0, 48);
  out.writeUInt32LE(4096, 56);
  out.writeUInt32LE(ENDOFCHAIN, 60);
  out.writeUInt32LE(0, 64);
  out.writeUInt32LE(ENDOFCHAIN, 68);
  out.writeUInt32LE(0, 72);
  out.writeUInt32LE(9, 76); // ...living in a sector this file does not have
  for (let i = 1; i < 109; i += 1) out.writeUInt32LE(FREESECT, 76 + i * 4);
  return out;
}

/** A buffer that is not a compound file at all. Must be rejected with NOT_OLE2. */
export function buildNonOle2(): Buffer {
  return Buffer.from('PK this is not an OLE2 compound file', 'utf8');
}

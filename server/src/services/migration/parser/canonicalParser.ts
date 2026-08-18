/**
 * canonicalParser.ts — F3-DATA-MIG-TODAY-001
 *
 * The single entry point every other migration module uses to turn an uploaded
 * workbook into the vendor-neutral `CanonicalWorkbook` contract. Nothing
 * downstream (mapping, dry-run, execution, reporting) may import a reader
 * directly: the readers speak `.xls`/`.xlsx`, this module speaks CANONICAL,
 * and that boundary is what keeps a file-format concern out of domain code.
 *
 * PRIVACY CONTRACT: every `MigrationError.detail` produced here contains
 * counts, column INDEXES and code names only. A header text is content the
 * clinic exported and is therefore NEVER placed in an error detail or a log
 * line — only its physical index is.
 */

import {
  MigrationError,
  type CanonicalCell,
  type CanonicalCellType,
  type CanonicalHeader,
  type CanonicalRow,
  type CanonicalSheetMetadata,
  type CanonicalWorkbook,
  type SourceColumnProfile,
  type SourceFileFormat,
} from '../contracts.js';
import { Biff8Error, readBiff8, type Biff8CellValue, type Biff8Workbook } from './biff8Reader.js';
import { readXlsx, type XlsxWorkbookResult } from './xlsxReader.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ParseOptions {
  /** Explicit 0-based sheet selection. Out of range => SHEET_INVALID. */
  sheetIndex?: number;
  /** Cap on DATA rows retained (the header row is never counted). */
  maxRows?: number;
}

/** Structural, non-blocking observations recorded on the workbook metadata. */
export const PARSER_WARNINGS = {
  HIDDEN_SHEETS_PRESENT: 'HIDDEN_SHEETS_PRESENT',
  NO_VISIBLE_SHEET: 'NO_VISIBLE_SHEET',
  EMPTY_LEADING_COLUMN_DROPPED: 'EMPTY_LEADING_COLUMN_DROPPED',
  EMPTY_COLUMN_DROPPED: 'EMPTY_COLUMN_DROPPED',
  UNNAMED_COLUMN_PRESENT: 'UNNAMED_COLUMN_PRESENT',
  DUPLICATE_HEADER: 'DUPLICATE_HEADER',
  ROWS_TRUNCATED: 'ROWS_TRUNCATED',
  TRAILING_EMPTY_ROWS_DROPPED: 'TRAILING_EMPTY_ROWS_DROPPED',
} as const;

/** Prefix used to name a column whose header cell is blank but which has data. */
export const UNNAMED_COLUMN_PREFIX = 'COLUMN_';

/** `profileColumns` stops growing its distinct-value set here. See the note there. */
export const DISTINCT_VALUE_CAP = 50_000;

/** Cell-level observation codes placed on `CanonicalCell.warning`. */
export const CELL_WARNINGS = {
  ERROR_CELL: 'ERROR_CELL',
} as const;

// ---------------------------------------------------------------------------
// Internal shared reader shape
// ---------------------------------------------------------------------------

/**
 * `Biff8CellValue` and `XlsxCellValue` are structurally identical by design —
 * the two readers were written to a single logical shape so this module needs
 * exactly one projection routine.
 */
type ReaderCell = Biff8CellValue;

interface ReaderSheet {
  name: string;
  index: number;
  hidden: boolean;
  rowCount: number;
  columnCount: number;
  rows: ReaderCell[][];
}

interface ReaderWorkbook {
  sheets: ReaderSheet[];
  dateEpoch: 1900 | 1904;
  parseMs: number;
}

/** Shared frozen singleton for the (very many) empty canonical cells. */
const EMPTY_CANONICAL_CELL: CanonicalCell = Object.freeze({ type: 'empty' as const, text: '' });

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function parseSourceWorkbook(
  buffer: Buffer,
  format: SourceFileFormat,
  opts: ParseOptions = {},
): Promise<CanonicalWorkbook> {
  const startedAt = Date.now();

  const reader = format === 'xls' ? readXlsWorkbook(buffer) : normalizeXlsx(await readXlsx(buffer));

  const warnings: string[] = [];
  const selectedSheetIndex = selectSheet(reader.sheets, opts.sheetIndex, warnings);
  const sheet = reader.sheets[selectedSheetIndex]!;

  const { headers, rows } = buildCanonicalSheet(sheet, opts, warnings);

  const sheetMetadata: CanonicalSheetMetadata[] = reader.sheets.map((s) => ({
    name: s.name,
    index: s.index,
    hidden: s.hidden,
    rowCount: s.rowCount,
    columnCount: s.columnCount,
  }));

  return {
    metadata: {
      format,
      sheets: sheetMetadata,
      selectedSheetIndex,
      dateEpoch: reader.dateEpoch,
      warnings,
      // The reader's own timing plus this module's projection cost, so the
      // number reported to an operator is the whole parse, not half of it.
      parseMs: Date.now() - startedAt,
    },
    headers,
    rows,
  };
}

// ---------------------------------------------------------------------------
// Reader dispatch + error translation
// ---------------------------------------------------------------------------

function readXlsWorkbook(buffer: Buffer): ReaderWorkbook {
  try {
    return normalizeBiff8(readBiff8(buffer));
  } catch (error) {
    if (error instanceof Biff8Error) throw translateBiff8Error(error);
    throw error;
  }
}

/**
 * Map the reader's structural failure onto the migration taxonomy.
 *
 * Only `detail` crosses this boundary — `Biff8Error.message` is prefixed with
 * the internal code and could grow free-form text in future, whereas `detail`
 * is contractually structural. Nothing about the reader's internals is leaked
 * to the client beyond the code the operator needs to act on.
 */
function translateBiff8Error(error: Biff8Error): MigrationError {
  const detail = error.detail ? `${error.code} ${error.detail}` : error.code;

  switch (error.code) {
    case 'ENCRYPTED_UNSUPPORTED':
      return new MigrationError('FILE_ENCRYPTED', {
        message: 'The workbook is password protected and cannot be migrated.',
        detail,
      });

    case 'NOT_OLE2':
    case 'BIFF5_UNSUPPORTED':
      return new MigrationError('FILE_UNSUPPORTED', {
        message: 'The workbook uses a file format the migration cannot read.',
        detail,
      });

    case 'CFB_MALFORMED':
    case 'BIFF_MALFORMED':
    case 'WORKBOOK_STREAM_MISSING':
      return new MigrationError('FILE_CORRUPTED', {
        message: 'The workbook is damaged and could not be read.',
        detail,
      });

    case 'LIMIT_EXCEEDED':
      return new MigrationError('FILE_TOO_LARGE', {
        message: 'The workbook exceeds a resource limit of the migration.',
        detail,
      });

    case 'NO_SHEETS':
      return new MigrationError('SHEET_EMPTY', {
        message: 'The workbook contains no worksheets.',
        detail,
      });

    default:
      return new MigrationError('FILE_CORRUPTED', {
        message: 'The workbook could not be read.',
        detail,
      });
  }
}

function normalizeBiff8(wb: Biff8Workbook): ReaderWorkbook {
  return {
    sheets: wb.sheets.map((s) => ({
      name: s.name,
      index: s.index,
      hidden: s.hidden,
      rowCount: s.rowCount,
      columnCount: s.columnCount,
      rows: s.rows,
    })),
    dateEpoch: wb.dateEpoch,
    parseMs: wb.stats.parseMs,
  };
}

function normalizeXlsx(wb: XlsxWorkbookResult): ReaderWorkbook {
  return {
    sheets: wb.sheets.map((s) => ({
      name: s.name,
      index: s.index,
      hidden: s.hidden,
      rowCount: s.rowCount,
      columnCount: s.columnCount,
      rows: s.rows,
    })),
    dateEpoch: wb.dateEpoch,
    parseMs: wb.stats.parseMs,
  };
}

// ---------------------------------------------------------------------------
// Sheet selection
// ---------------------------------------------------------------------------

function selectSheet(
  sheets: ReaderSheet[],
  explicitIndex: number | undefined,
  warnings: string[],
): number {
  if (sheets.length === 0) {
    throw new MigrationError('SHEET_EMPTY', {
      message: 'The workbook contains no worksheets.',
      detail: 'SHEET_COUNT=0',
    });
  }

  if (sheets.some((s) => s.hidden)) {
    // Recorded, never acted on silently: a hidden sheet in a clinic export is
    // frequently the vendor's scratch data, and an operator must be able to
    // see that the file had one before approving a migration.
    warnings.push(PARSER_WARNINGS.HIDDEN_SHEETS_PRESENT);
  }

  if (explicitIndex !== undefined) {
    if (!Number.isInteger(explicitIndex) || explicitIndex < 0 || explicitIndex >= sheets.length) {
      throw new MigrationError('SHEET_INVALID', {
        message: 'The requested worksheet does not exist in this workbook.',
        detail: `SHEET_INDEX_OUT_OF_RANGE requested=${String(explicitIndex)} sheetCount=${sheets.length}`,
      });
    }
    return explicitIndex;
  }

  const firstVisible = sheets.findIndex((s) => !s.hidden);
  if (firstVisible >= 0) return firstVisible;

  // Every sheet is hidden. Falling back to sheet 0 (rather than failing) keeps
  // a legitimate export usable, but the fallback is always recorded so the
  // decision is visible in the run metadata.
  warnings.push(PARSER_WARNINGS.NO_VISIBLE_SHEET);
  return 0;
}

// ---------------------------------------------------------------------------
// Header discovery + row projection
// ---------------------------------------------------------------------------

function buildCanonicalSheet(
  sheet: ReaderSheet,
  opts: ParseOptions,
  warnings: string[],
): { headers: CanonicalHeader[]; rows: CanonicalRow[] } {
  const physicalColumns = sheet.columnCount;
  const headerRow = sheet.rows[0];

  if (!headerRow || sheet.rows.length === 0 || physicalColumns === 0) {
    throw new MigrationError('SHEET_EMPTY', {
      message: 'The selected worksheet is empty.',
      detail: `SHEET_ROWS=${sheet.rows.length} SHEET_COLUMNS=${physicalColumns}`,
    });
  }

  // The header is row 0 by contract. Auto-detecting a header row would make
  // the mapping key (and therefore rerun idempotency) depend on a heuristic
  // that could change between releases — an unacceptable trade for a
  // migration that must produce the same result on every rerun.
  const headerTexts: string[] = new Array<string>(physicalColumns).fill('');
  for (let c = 0; c < physicalColumns; c += 1) {
    headerTexts[c] = projectText(headerRow[c] ?? { kind: 'empty' });
  }

  const dataRowsAvailable = sheet.rows.length - 1;
  if (dataRowsAvailable <= 0) {
    throw new MigrationError('SHEET_EMPTY', {
      message: 'The selected worksheet has a header but no data rows.',
      detail: 'DATA_ROWS=0',
    });
  }

  const columnHasData = computeColumnHasData(sheet, physicalColumns);

  // ---- structurally empty column detection -------------------------------
  //
  // WHY: the real first-customer export carries an artifact column at physical
  // position 0 with no header text and no value in ANY row — an export-tool
  // quirk, not a column of the clinic's data. Keeping it would create a
  // phantom source field that an operator has to map to "ignore" on every
  // rerun, and would shift every human's mental column numbering by one.
  //
  // The rule is deliberately GENERIC (blank header AND blank in every data
  // row), not "index 0", because the same artifact appears at other positions
  // in other exports from the same tool. A column with a blank header but SOME
  // data is NEVER dropped — that would silently discard clinic data — it is
  // named `COLUMN_<index>` instead and flagged for human review.
  const droppedColumns: number[] = [];
  const unnamedColumns: number[] = [];

  const headers: CanonicalHeader[] = [];
  for (let c = 0; c < physicalColumns; c += 1) {
    const text = headerTexts[c]!;
    if (text === '') {
      if (!columnHasData[c]) {
        droppedColumns.push(c);
        continue;
      }
      unnamedColumns.push(c);
      const synthesized = `${UNNAMED_COLUMN_PREFIX}${c}`;
      headers.push({ original: synthesized, normalized: synthesized, index: c });
      continue;
    }
    headers.push({ original: text, normalized: normalizeHeader(text), index: c });
  }

  if (droppedColumns.length > 0) {
    if (droppedColumns.includes(0)) warnings.push(PARSER_WARNINGS.EMPTY_LEADING_COLUMN_DROPPED);
    if (droppedColumns.some((c) => c !== 0)) warnings.push(PARSER_WARNINGS.EMPTY_COLUMN_DROPPED);
  }
  if (unnamedColumns.length > 0) warnings.push(PARSER_WARNINGS.UNNAMED_COLUMN_PRESENT);

  if (headers.length === 0) {
    throw new MigrationError('HEADER_MISSING', {
      message: 'The selected worksheet has no usable header row.',
      detail: `HEADER_COLUMNS=0 PHYSICAL_COLUMNS=${physicalColumns}`,
    });
  }

  assertNoByteIdenticalHeaders(headers);
  disambiguateNormalizedHeaders(headers, warnings);

  // ---- data rows ---------------------------------------------------------
  const requestedMax =
    opts.maxRows !== undefined && Number.isInteger(opts.maxRows) && opts.maxRows >= 0
      ? opts.maxRows
      : dataRowsAvailable;
  const retainedRows = Math.min(dataRowsAvailable, requestedMax);
  if (retainedRows < dataRowsAvailable) warnings.push(PARSER_WARNINGS.ROWS_TRUNCATED);

  const rows: CanonicalRow[] = [];
  for (let r = 0; r < retainedRows; r += 1) {
    const source = sheet.rows[r + 1]!;
    // Aligned to the PHYSICAL column indexes, NOT to `headers`: a dropped
    // artifact column must not shift the cells, because every header carries
    // its physical index and callers read `cells[header.index]`.
    const cells: CanonicalCell[] = new Array<CanonicalCell>(physicalColumns).fill(
      EMPTY_CANONICAL_CELL,
    );
    for (let c = 0; c < physicalColumns; c += 1) {
      const raw = source[c];
      if (!raw || raw.kind === 'empty') continue;
      cells[c] = projectCell(raw);
    }
    // `rowNumber` is 1-based over DATA rows and stays stable regardless of
    // trailing-empty-row trimming, so a report line always points at the same
    // source row across reruns.
    rows.push({ rowNumber: r + 1, cells });
  }

  // Trailing all-empty rows are a spreadsheet artifact (a styled but unused
  // range). Trimming them keeps every downstream count honest.
  let lastMeaningful = rows.length - 1;
  while (lastMeaningful >= 0 && isRowEmpty(rows[lastMeaningful]!)) lastMeaningful -= 1;
  if (lastMeaningful < rows.length - 1) {
    rows.length = lastMeaningful + 1;
    warnings.push(PARSER_WARNINGS.TRAILING_EMPTY_ROWS_DROPPED);
  }

  if (rows.length === 0) {
    throw new MigrationError('SHEET_EMPTY', {
      message: 'The selected worksheet has a header but no data rows.',
      detail: 'DATA_ROWS=0',
    });
  }

  return { headers, rows };
}

/**
 * One pass over the data rows recording, per physical column, whether ANY data
 * row holds a value. Only used to classify blank-header columns, but computed
 * for every column in a single pass so the sheet is never walked twice.
 */
function computeColumnHasData(sheet: ReaderSheet, physicalColumns: number): boolean[] {
  const hasData = new Array<boolean>(physicalColumns).fill(false);
  for (let r = 1; r < sheet.rows.length; r += 1) {
    const row = sheet.rows[r];
    if (!row) continue;
    for (let c = 0; c < physicalColumns; c += 1) {
      if (hasData[c]) continue;
      const cell = row[c];
      if (!cell || cell.kind === 'empty') continue;
      // A whitespace-only string is not data — the artifact column in the real
      // export contains a few of them.
      if (cell.kind === 'string' && cell.value.trim() === '') continue;
      hasData[c] = true;
    }
  }
  return hasData;
}

function isRowEmpty(row: CanonicalRow): boolean {
  for (const cell of row.cells) {
    if (cell.type !== 'empty') return false;
  }
  return true;
}

/**
 * Two byte-identical header names cannot be represented: the mapping table is
 * keyed on `(runId, sourceField)`, so the second column would overwrite the
 * first one's mapping and one of the clinic's columns would silently take the
 * other's destination. Refusing the file is the only safe outcome — the export
 * has to be corrected at source.
 */
function assertNoByteIdenticalHeaders(headers: CanonicalHeader[]): void {
  const seen = new Map<string, number>();
  for (const header of headers) {
    const first = seen.get(header.original);
    if (first !== undefined) {
      throw new MigrationError('HEADER_DUPLICATE', {
        message: 'Two columns in the worksheet have the same header name.',
        // INDEXES only — the header text itself is clinic content.
        detail: `HEADER_DUPLICATE_AT_INDEXES=${first},${header.index}`,
      });
    }
    seen.set(header.original, header.index);
  }
}

/**
 * Headers that differ only by case/whitespace/punctuation collapse to the same
 * `normalized` form. Both columns are KEPT (each may legitimately carry
 * different data) and only `normalized` is disambiguated, never `original`:
 * `original` is the byte-exact rerun key and must stay exactly as exported.
 */
function disambiguateNormalizedHeaders(headers: CanonicalHeader[], warnings: string[]): void {
  const counts = new Map<string, number>();
  let duplicateFound = false;

  for (const header of headers) {
    const seenSoFar = counts.get(header.normalized) ?? 0;
    counts.set(header.normalized, seenSoFar + 1);
    if (seenSoFar > 0) {
      duplicateFound = true;
      header.normalized = `${header.normalized}__${seenSoFar + 1}`;
    }
  }

  if (duplicateFound) warnings.push(PARSER_WARNINGS.DUPLICATE_HEADER);
}

/**
 * Matching-only projection: upper-cased (Turkish-aware via a locale-independent
 * pre-fold so `i`/`İ` and `ı`/`I` do not diverge), punctuation and whitespace
 * collapsed to a single underscore.
 */
function normalizeHeader(text: string): string {
  const folded = text
    .replace(/İ/g, 'I') // İ
    .replace(/ı/g, 'i') // ı
    .toUpperCase();
  return folded
    .replace(/[\s_\-.,;:/\\()[\]{}'"`*?!+#%&@|]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

// ---------------------------------------------------------------------------
// Cell projection
// ---------------------------------------------------------------------------

function projectCell(raw: ReaderCell): CanonicalCell {
  switch (raw.kind) {
    case 'string': {
      const text = raw.value.trim();
      return text === '' ? EMPTY_CANONICAL_CELL : { type: 'string', text };
    }
    case 'number':
      return { type: 'number', text: numberToText(raw.value), numberValue: raw.value };
    case 'date':
      return {
        type: 'date',
        text: isoDateUtc(raw.value),
        dateValue: raw.value,
        dateSerial: raw.serial,
      };
    case 'boolean':
      return { type: 'boolean', text: raw.value ? 'true' : 'false', booleanValue: raw.value };
    case 'error':
      // An Excel error cell (#REF!, #N/A, …) carries no migratable value. It
      // projects to '' so no transform ever sees the literal "#N/A", and the
      // warning preserves the fact that something WAS there.
      return { type: 'error', text: '', warning: CELL_WARNINGS.ERROR_CELL };
    case 'empty':
    default:
      return EMPTY_CANONICAL_CELL;
  }
}

/** The text projection used by header discovery (no cell object allocated). */
function projectText(raw: ReaderCell): string {
  switch (raw.kind) {
    case 'string':
      return raw.value.trim();
    case 'number':
      return numberToText(raw.value);
    case 'date':
      return isoDateUtc(raw.value);
    case 'boolean':
      return raw.value ? 'true' : 'false';
    case 'error':
    case 'empty':
    default:
      return '';
  }
}

/**
 * Lossless decimal text for a number cell.
 *
 * WHY not `String(n)`: for magnitudes outside 1e-7..1e21 JavaScript switches to
 * exponent notation, and a vendor primary key or a phone number rendered as
 * "9.05551234567e+11" would corrupt the provenance key and the phone transform.
 * Thousands separators are never introduced (locale formatting is not used).
 */
function numberToText(value: number): string {
  if (!Number.isFinite(value)) return '';
  if (Object.is(value, -0)) return '0';
  if (Number.isInteger(value) && Math.abs(value) < 1e21) return value.toFixed(0);

  const plain = String(value);
  if (!plain.includes('e') && !plain.includes('E')) return plain;
  return expandExponential(plain);
}

/** Expand "1.2345e-9" / "1.2e+25" into plain positional decimal text. */
function expandExponential(text: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(text);
  if (!match) return text;

  const sign = match[1] ?? '';
  const intPart = match[2] ?? '0';
  const fracPart = match[3] ?? '';
  const exponent = Number(match[4] ?? '0');

  const digits = intPart + fracPart;
  // Position of the decimal point measured from the left of `digits`.
  let pointIndex = intPart.length + exponent;

  let result: string;
  if (pointIndex <= 0) {
    result = `0.${'0'.repeat(-pointIndex)}${digits}`;
  } else if (pointIndex >= digits.length) {
    result = digits + '0'.repeat(pointIndex - digits.length);
  } else {
    result = `${digits.slice(0, pointIndex)}.${digits.slice(pointIndex)}`;
  }

  if (result.includes('.')) result = result.replace(/0+$/, '').replace(/\.$/, '');
  return `${sign}${result}`;
}

/** ISO calendar date in UTC. Time-of-day is intentionally discarded. */
function isoDateUtc(value: Date): string {
  const time = value.getTime();
  if (!Number.isFinite(time)) return '';
  return value.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Column profiling — AGGREGATES ONLY
// ---------------------------------------------------------------------------

/**
 * Per-column aggregate statistics used by the mapping UI and the dry-run
 * report.
 *
 * PRIVACY: this function returns COUNTS AND LENGTHS ONLY. It deliberately
 * exposes no sample value, no most-frequent value and no min/max value — those
 * would each be a patient's name, phone or identity number rendered into an
 * operator-facing report, which this subsystem forbids outright.
 */
export function profileColumns(wb: CanonicalWorkbook): SourceColumnProfile[] {
  const totalRows = wb.rows.length;

  return wb.headers.map((header) => {
    const typeCounts: Record<CanonicalCellType, number> = {
      empty: 0,
      string: 0,
      number: 0,
      date: 0,
      boolean: 0,
      error: 0,
    };

    // The distinct set is CAPPED: a 200k-row free-text column would otherwise
    // retain every distinct patient note in memory purely to produce one
    // integer. Past the cap the count stops rising and nothing else is
    // recorded — a capped `distinctCount` reads as "at least this many".
    const distinct = new Set<string>();
    let distinctCapped = false;
    let filledCount = 0;
    let maxLength = 0;

    for (const row of wb.rows) {
      const cell = row.cells[header.index] ?? EMPTY_CANONICAL_CELL;
      typeCounts[cell.type] += 1;

      const text = cell.text;
      if (text.length === 0) continue;

      filledCount += 1;
      if (text.length > maxLength) maxLength = text.length;
      if (!distinctCapped) {
        if (distinct.size >= DISTINCT_VALUE_CAP && !distinct.has(text)) {
          distinctCapped = true;
        } else {
          distinct.add(text);
        }
      }
    }

    return {
      index: header.index,
      header: header.original,
      filledCount,
      totalRows,
      fillRate: totalRows === 0 ? 0 : Math.round((filledCount / totalRows) * 10_000) / 10_000,
      distinctCount: distinct.size,
      typeCounts,
      maxLength,
    };
  });
}

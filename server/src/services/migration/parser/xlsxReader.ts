/**
 * xlsxReader.ts — F3-DATA-MIG-TODAY-001
 *
 * OOXML (`.xlsx`) reader built on the exceljs dependency the product already
 * ships. It is deliberately INDEPENDENT of `utils/excelImport.ts`: that module
 * is a frozen, template-shaped importer (500-row cap, header cleanup, string
 * projection) whose semantics are wrong for a migration, where every cell's
 * TYPE must survive to the canonical layer so a date is never re-parsed out of
 * a locale-dependent string.
 *
 * The result shape mirrors `Biff8Workbook` exactly so `canonicalParser.ts`
 * treats a legacy `.xls` and a modern `.xlsx` through one code path.
 *
 * SECURITY / RESOURCE NOTES
 *  - Formulas are NEVER evaluated. Only the CACHED result stored in the file
 *    is read, exactly like `excelImport.cellToString` does.
 *  - `wb.xlsx.load()` does not throw for many non-OOXML inputs; it returns a
 *    workbook with zero worksheets. That silent path is converted into a typed
 *    FILE_CORRUPTED here so it can never surface as an unhandled 500.
 *  - The same resource ceilings as the BIFF8 reader apply, imported from the
 *    single source of truth (`biff8Reader.limits.ts`) so the two readers can
 *    never drift apart and let an `.xlsx` bypass a limit an `.xls` enforces.
 *
 * PRIVACY CONTRACT: no cell value is ever logged or placed in an error detail.
 * Details carry limit names, counts and sheet INDEXES — never sheet content.
 */

import ExcelJS from 'exceljs';

import { MigrationError } from '../contracts.js';
import { DEFAULT_BIFF8_LIMITS } from './biff8Reader.limits.js';

// ---------------------------------------------------------------------------
// Public types — structurally identical to the BIFF8 reader's
// ---------------------------------------------------------------------------

export type XlsxCellValue =
  | { kind: 'empty' }
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'date'; value: Date; serial: number }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'error'; code: number };

export type XlsxSheetVisibility = 'visible' | 'hidden' | 'very_hidden';

export interface XlsxSheet {
  name: string;
  index: number;
  /** True for both `hidden` and `very_hidden`. */
  hidden: boolean;
  visibility: XlsxSheetVisibility;
  rowCount: number;
  columnCount: number;
  /** Dense: `rows.length === rowCount`, every `rows[r].length === columnCount`. */
  rows: XlsxCellValue[][];
}

export interface XlsxStats {
  /** Rows visited across every sheet. The OOXML analogue of BIFF records. */
  records: number;
  /** Not meaningful for OOXML (exceljs resolves shared strings itself). */
  sstStrings: number;
  sstReferences: number;
  /** Non-empty cells materialised. */
  cells: number;
  /** Formula cells seen. None are evaluated. */
  formulas: number;
  parseMs: number;
}

export interface XlsxWorkbookResult {
  sheets: XlsxSheet[];
  dateEpoch: 1900 | 1904;
  stats: XlsxStats;
}

// ---------------------------------------------------------------------------
// Limits — shared with the BIFF8 reader on purpose
// ---------------------------------------------------------------------------

const MAX_SHEETS = DEFAULT_BIFF8_LIMITS.maxSheets;
const MAX_COLUMNS = DEFAULT_BIFF8_LIMITS.maxColumns;
const MAX_ROWS = DEFAULT_BIFF8_LIMITS.maxRows;
const MAX_CELLS = DEFAULT_BIFF8_LIMITS.maxCells;
const MAX_STRING_CHARS = DEFAULT_BIFF8_LIMITS.maxStringChars;

/**
 * Shared singleton for every empty slot. A 200k x 1024 grid would otherwise
 * allocate one object per untouched slot; the dense grid is filled with this
 * frozen value instead. Compare with `.kind`, never by identity.
 */
const EMPTY_CELL: XlsxCellValue = Object.freeze({ kind: 'empty' as const });

/**
 * Days between the Excel 1900 epoch (serial 1 === 1900-01-01, with Excel's
 * historical 1900-02-29 bug making the anchor 1899-12-30) and the Unix epoch.
 */
const EXCEL_1900_EPOCH_OFFSET_DAYS = 25569;
/** Same anchor for the Macintosh 1904 date system (1904-01-01). */
const EXCEL_1904_EPOCH_OFFSET_DAYS = 24107;
const MS_PER_DAY = 86_400_000;

/**
 * BIFF error codes ([MS-XLS] BErr). exceljs surfaces the human text, so it is
 * mapped back to the numeric code the canonical layer already understands from
 * the `.xls` path.
 */
const ERROR_TEXT_TO_CODE: Record<string, number> = {
  '#NULL!': 0x00,
  '#DIV/0!': 0x07,
  '#VALUE!': 0x0f,
  '#REF!': 0x17,
  '#NAME?': 0x1d,
  '#NUM!': 0x24,
  '#N/A': 0x2a,
  '#GETTING_DATA': 0x2b,
};

/** Depth guard for the value walker (formula -> result -> hyperlink -> ...). */
const MAX_VALUE_DEPTH = 4;

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function readXlsx(buffer: Buffer): Promise<XlsxWorkbookResult> {
  const startedAt = Date.now();

  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new MigrationError('FILE_MISSING', {
      message: 'No file content was received.',
      detail: 'XLSX_EMPTY_BUFFER',
    });
  }

  const workbook = new ExcelJS.Workbook();
  try {
    // `as any` mirrors utils/excelImport.ts: exceljs bundles its own copy of
    // the Node Buffer typings, so a Buffer from this project's @types/node is
    // structurally rejected even though it is the exact runtime type expected.
    await workbook.xlsx.load(buffer as any);
  } catch {
    // The underlying zip/XML error text can contain fragments of the file, so
    // it is swallowed entirely: only the typed code crosses this boundary.
    throw new MigrationError('FILE_CORRUPTED', {
      message: 'The workbook could not be opened.',
      detail: 'XLSX_LOAD_FAILED',
    });
  }

  const worksheets = workbook.worksheets ?? [];
  if (worksheets.length === 0) {
    // exceljs returns an EMPTY workbook rather than throwing for several
    // non-OOXML inputs (and for a zip missing xl/workbook.xml). Without this
    // guard the caller would see "no sheets" as a programming error later.
    throw new MigrationError('FILE_CORRUPTED', {
      message: 'The workbook contains no readable worksheets.',
      detail: 'XLSX_NO_WORKSHEETS',
    });
  }

  if (worksheets.length > MAX_SHEETS) {
    throw new MigrationError('SHEET_INVALID', {
      message: 'The workbook contains more worksheets than the migration supports.',
      detail: `maxSheets observed=${worksheets.length} allowed=${MAX_SHEETS}`,
    });
  }

  const dateEpoch: 1900 | 1904 = workbook.properties?.date1904 ? 1904 : 1900;

  const stats: XlsxStats = {
    records: 0,
    sstStrings: 0,
    sstReferences: 0,
    cells: 0,
    formulas: 0,
    parseMs: 0,
  };

  const sheets: XlsxSheet[] = [];
  let totalCells = 0;

  for (let sheetIndex = 0; sheetIndex < worksheets.length; sheetIndex += 1) {
    const worksheet = worksheets[sheetIndex]!;
    const sheet = readWorksheet(worksheet, sheetIndex, dateEpoch, stats);

    totalCells += sheet.rowCount * sheet.columnCount;
    if (totalCells > MAX_CELLS) {
      throw new MigrationError('FILE_TOO_LARGE', {
        message: 'The workbook contains more cells than the migration supports.',
        detail: `maxCells observed=${totalCells} allowed=${MAX_CELLS}`,
      });
    }

    sheets.push(sheet);
  }

  stats.parseMs = Date.now() - startedAt;
  return { sheets, dateEpoch, stats };
}

// ---------------------------------------------------------------------------
// Worksheet -> dense typed grid
// ---------------------------------------------------------------------------

function readWorksheet(
  worksheet: ExcelJS.Worksheet,
  sheetIndex: number,
  dateEpoch: 1900 | 1904,
  stats: XlsxStats,
): XlsxSheet {
  // `actualRowCount` / `actualColumnCount` describe the populated region;
  // `rowCount` / `columnCount` describe the declared dimension, which can be
  // inflated by styling applied to whole rows/columns. The dense grid is sized
  // from the DECLARED extent (so nothing is silently clipped) but is bounded
  // by the shared limits below.
  const declaredRows = Math.max(0, worksheet.rowCount || 0);
  const declaredColumns = Math.max(0, worksheet.columnCount || 0);

  if (declaredRows > MAX_ROWS) {
    throw new MigrationError('FILE_TOO_LARGE', {
      message: 'A worksheet contains more rows than the migration supports.',
      detail: `maxRows sheetIndex=${sheetIndex} observed=${declaredRows} allowed=${MAX_ROWS}`,
    });
  }
  if (declaredColumns > MAX_COLUMNS) {
    throw new MigrationError('SHEET_INVALID', {
      message: 'A worksheet contains more columns than the migration supports.',
      detail: `maxColumns sheetIndex=${sheetIndex} observed=${declaredColumns} allowed=${MAX_COLUMNS}`,
    });
  }

  const rows: XlsxCellValue[][] = [];
  for (let r = 0; r < declaredRows; r += 1) {
    rows.push(new Array<XlsxCellValue>(declaredColumns).fill(EMPTY_CELL));
  }

  // Iterating only the rows/cells exceljs actually holds keeps the walk
  // proportional to the POPULATED region, not to the declared rectangle.
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    stats.records += 1;
    const rowIndex = rowNumber - 1;
    if (rowIndex < 0 || rowIndex >= declaredRows) return;
    const target = rows[rowIndex]!;

    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const colIndex = colNumber - 1;
      if (colIndex < 0 || colIndex >= declaredColumns) return;
      if (cell.type === ExcelJS.ValueType.Formula) stats.formulas += 1;

      const value = mapCell(cell, sheetIndex, dateEpoch);
      if (value.kind === 'empty') return;
      target[colIndex] = value;
      stats.cells += 1;
    });
  });

  const state = worksheet.state as string | undefined;
  const visibility: XlsxSheetVisibility =
    state === 'veryHidden' ? 'very_hidden' : state === 'hidden' ? 'hidden' : 'visible';

  return {
    name: typeof worksheet.name === 'string' ? worksheet.name : `Sheet${sheetIndex + 1}`,
    index: sheetIndex,
    hidden: visibility !== 'visible',
    visibility,
    rowCount: declaredRows,
    columnCount: declaredColumns,
    rows,
  };
}

// ---------------------------------------------------------------------------
// Cell mapping
// ---------------------------------------------------------------------------

function mapCell(cell: ExcelJS.Cell, sheetIndex: number, dateEpoch: 1900 | 1904): XlsxCellValue {
  // A merged slave cell repeats the master's value in exceljs; treating it as
  // empty keeps the grid faithful to what a human sees in Excel.
  if (cell.type === ExcelJS.ValueType.Merge) return EMPTY_CELL;

  if (cell.type === ExcelJS.ValueType.Formula) {
    // CACHED RESULT ONLY. `cell.value` for a formula cell is the formula
    // descriptor; `cell.result` is what Excel last computed and stored.
    const result = (cell as unknown as { result?: ExcelJS.CellValue }).result;
    return mapValue(result ?? null, sheetIndex, dateEpoch, 1);
  }

  return mapValue(cell.value, sheetIndex, dateEpoch, 0);
}

function mapValue(
  value: ExcelJS.CellValue | undefined,
  sheetIndex: number,
  dateEpoch: 1900 | 1904,
  depth: number,
): XlsxCellValue {
  if (depth > MAX_VALUE_DEPTH) return EMPTY_CELL;
  if (value === null || value === undefined) return EMPTY_CELL;

  if (typeof value === 'string') {
    return makeString(value, sheetIndex);
  }

  if (typeof value === 'number') {
    // NaN/Infinity cannot round-trip through a canonical text projection and
    // are not legal Excel values; they are treated as absent rather than
    // silently becoming the string "NaN".
    return Number.isFinite(value) ? { kind: 'number', value } : EMPTY_CELL;
  }

  if (typeof value === 'boolean') {
    return { kind: 'boolean', value };
  }

  if (value instanceof Date) {
    const time = value.getTime();
    if (!Number.isFinite(time)) return EMPTY_CELL;
    return { kind: 'date', value, serial: excelSerialFromDate(time, dateEpoch) };
  }

  if (typeof value === 'object') {
    const record = value as unknown as Record<string, unknown>;

    // Rich text: flatten the runs to plain text, dropping the formatting.
    if (Array.isArray(record.richText)) {
      const runs = record.richText as Array<{ text?: unknown }>;
      let text = '';
      for (const run of runs) {
        if (typeof run?.text === 'string') text += run.text;
        if (text.length > MAX_STRING_CHARS) break;
      }
      return makeString(text, sheetIndex);
    }

    // Error cell.
    if (typeof record.error === 'string') {
      const code = ERROR_TEXT_TO_CODE[record.error];
      return { kind: 'error', code: code ?? 0x0f };
    }

    // Hyperlink cell: the DISPLAY text is the data; the target URL is
    // presentation and is deliberately discarded.
    if ('hyperlink' in record && 'text' in record) {
      return mapValue(record.text as ExcelJS.CellValue, sheetIndex, dateEpoch, depth + 1);
    }

    // A shared or ordinary formula descriptor that reached here through a
    // non-Formula `cell.type` (exceljs does this for some producers).
    if ('result' in record) {
      return mapValue(record.result as ExcelJS.CellValue, sheetIndex, dateEpoch, depth + 1);
    }
    if ('sharedFormula' in record || 'formula' in record) {
      // No cached result stored => nothing is known without evaluating, and
      // evaluation is forbidden. Absent is the honest answer.
      return EMPTY_CELL;
    }
  }

  return EMPTY_CELL;
}

function makeString(raw: string, sheetIndex: number): XlsxCellValue {
  if (raw.length === 0) return EMPTY_CELL;
  if (raw.length > MAX_STRING_CHARS) {
    throw new MigrationError('FILE_TOO_LARGE', {
      message: 'A worksheet cell exceeds the maximum supported length.',
      // The LENGTH is structural; the value is not reported.
      detail: `maxStringChars sheetIndex=${sheetIndex} observed=${raw.length} allowed=${MAX_STRING_CHARS}`,
    });
  }
  return { kind: 'string', value: raw };
}

/**
 * Convert a JS timestamp back into the Excel serial the workbook would store,
 * so date handling stays auditable across both readers (the BIFF8 path reads
 * the serial straight out of the file). Rounded to microsecond-of-a-day
 * precision to keep the value stable against float noise.
 */
function excelSerialFromDate(timeMs: number, dateEpoch: 1900 | 1904): number {
  const offset = dateEpoch === 1904 ? EXCEL_1904_EPOCH_OFFSET_DAYS : EXCEL_1900_EPOCH_OFFSET_DAYS;
  const serial = timeMs / MS_PER_DAY + offset;
  return Math.round(serial * 1e6) / 1e6;
}

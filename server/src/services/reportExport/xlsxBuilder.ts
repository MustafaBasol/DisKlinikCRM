/**
 * xlsxBuilder.ts — US-07.3-P1 safe XLSX generation.
 *
 * Thin, authorization-free service (same shape as treatmentProposalPdf.ts):
 * accepts already-authorized, already clinic-scoped, already-typed rows and
 * returns workbook bytes. Performs NO authorization, NO scope resolution —
 * all of that lives in the route handler (reportExport.ts).
 *
 * Column typing contract:
 *  - text: written as a string cell; any value starting with =, +, -, or @
 *    is neutralized (leading apostrophe) to prevent spreadsheet formula
 *    injection when the file is later opened in Excel/Sheets/etc.
 *  - number / currency: written as REAL numeric cells (never stringified —
 *    neutralization never applies to numeric columns, so a legitimate
 *    negative amount stays a native negative number, not defused text).
 *  - date / datetime: written as real JS Date cell values with a numFmt
 *    derived from the clinic's configured date-format preference.
 *  - boolean: written as a native boolean cell.
 */

import ExcelJS from 'exceljs';
import { neutralizeFormulaInjection } from './formulaSafety.js';
import { dateNumFmtFor, datetimeNumFmtFor } from './dateNumberFormat.js';
import type { ReportColumnDefinition, ReportFilterSummary, SupportedExportLocale } from './types.js';

const NUMBER_FORMAT = '#,##0';

/** Excel worksheet names: max 31 chars, and [ ] * ? / \ : are not allowed. */
function sanitizeSheetName(title: string): string {
  const cleaned = title.replace(/[[\]*?/\\:]/g, ' ').trim();
  return (cleaned || 'Report').slice(0, 31);
}

function currencyNumFmt(currencyCode: string): string {
  // currencyCode is always server-resolved from a validated enum (clinic
  // operating preferences / report definition), never raw client input.
  const safeCode = currencyCode.replace(/["\\]/g, '').slice(0, 8) || 'TRY';
  return `#,##0.00 "${safeCode}"`;
}

function toDateCellValue(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === 'string' && value.length > 0) {
    const parsed = new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);
    if (!isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

export interface BuildReportExportWorkbookParams<TRow> {
  locale: SupportedExportLocale;
  title: string;
  columns: ReportColumnDefinition[];
  rows: TRow[];
  toColumnValues: (row: TRow) => Record<string, unknown>;
  currency: string;
  generatedAt: Date;
  clinicDateFormat: string;
  filterSummary: ReportFilterSummary;
  /** Localized labels for the metadata section. */
  strings: {
    generatedAtLabel: string;
    appliedFiltersLabel: string;
  };
}

export async function buildReportExportWorkbookBuffer<TRow>(
  params: BuildReportExportWorkbookParams<TRow>,
): Promise<Buffer> {
  const { locale, title, columns, rows, toColumnValues, currency, generatedAt, clinicDateFormat, filterSummary, strings } = params;

  const workbook = new ExcelJS.Workbook();
  workbook.created = generatedAt;
  const sheet = workbook.addWorksheet(sanitizeSheetName(title));

  const columnCount = Math.max(columns.length, 1);

  // ── Metadata section (title, generated-at, applied filters) ────────────
  const titleRow = sheet.addRow([title]);
  titleRow.font = { bold: true, size: 14 };
  sheet.mergeCells(titleRow.number, 1, titleRow.number, columnCount);

  const generatedAtRow = sheet.addRow([`${strings.generatedAtLabel}: ${generatedAt.toISOString()}`]);
  sheet.mergeCells(generatedAtRow.number, 1, generatedAtRow.number, columnCount);

  const filterEntries = Object.entries(filterSummary);
  const filtersLabelRow = sheet.addRow([
    filterEntries.length > 0
      ? `${strings.appliedFiltersLabel}: ${filterEntries.map(([k, v]) => `${k}=${v}`).join(', ')}`
      : `${strings.appliedFiltersLabel}: —`,
  ]);
  sheet.mergeCells(filtersLabelRow.number, 1, filtersLabelRow.number, columnCount);

  sheet.addRow([]); // spacer

  // ── Column header row (localized) ───────────────────────────────────────
  const headerRow = sheet.addRow(columns.map((col) => col.header[locale]));
  headerRow.font = { bold: true };
  const headerRowNumber = headerRow.number;

  const dateFmt = dateNumFmtFor(clinicDateFormat);
  const datetimeFmt = datetimeNumFmtFor(clinicDateFormat);
  const currencyFmt = currencyNumFmt(currency);

  // ── Data rows ─────────────────────────────────────────────────────────
  for (const row of rows) {
    const values = toColumnValues(row);
    const cellValues = columns.map((col) => {
      const raw = values[col.key];
      switch (col.type) {
        case 'number':
          return typeof raw === 'number' ? raw : Number(raw ?? 0);
        case 'currency':
          return typeof raw === 'number' ? raw : Number(raw ?? 0);
        case 'boolean':
          return Boolean(raw);
        case 'date':
        case 'datetime':
          return toDateCellValue(raw);
        case 'text':
        default:
          return neutralizeFormulaInjection(raw == null ? '' : String(raw));
      }
    });
    const dataRow = sheet.addRow(cellValues);
    columns.forEach((col, idx) => {
      const cell = dataRow.getCell(idx + 1);
      if (col.type === 'number') cell.numFmt = NUMBER_FORMAT;
      else if (col.type === 'currency') cell.numFmt = currencyFmt;
      else if (col.type === 'date') cell.numFmt = dateFmt;
      else if (col.type === 'datetime') cell.numFmt = datetimeFmt;
    });
  }

  // ── Column widths — simple heuristic from header length ─────────────────
  columns.forEach((col, idx) => {
    const headerLength = col.header[locale]?.length ?? 10;
    sheet.getColumn(idx + 1).width = Math.max(12, Math.min(40, headerLength + 4));
  });

  // Freeze the header row so it stays visible while scrolling data.
  sheet.views = [{ state: 'frozen', ySplit: headerRowNumber }];

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

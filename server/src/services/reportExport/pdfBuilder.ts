/**
 * pdfBuilder.ts — US-07.3-P1 generic tabular report PDF.
 *
 * pdfkit is already a project dependency (used by treatmentProposalPdf.ts)
 * and requires no browser binary / heavy runtime, so per the P1 brief a
 * server-side PDF export is added alongside XLSX rather than deferred.
 *
 * Reuses the same NotoSans font bundle as treatmentProposalPdf.ts (correct
 * Turkish/French/German diacritics) and the same measured-row-height /
 * page-break pattern, generalized to an arbitrary N-column report definition
 * instead of the proposal's fixed 4-column layout.
 *
 * Thin, authorization-free service: accepts already-authorized, already
 * clinic-scoped, already-typed rows and returns PDF bytes. No auth, no scope
 * resolution — that lives in the route handler (reportExport.ts).
 */

import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';
import { neutralizeFormulaInjection } from './formulaSafety.js';
import type { ReportColumnDefinition, ReportFilterSummary, SupportedExportLocale } from './types.js';

const FONT_REGULAR = fileURLToPath(new URL('../../assets/fonts/NotoSans-Regular.ttf', import.meta.url));
const FONT_BOLD = fileURLToPath(new URL('../../assets/fonts/NotoSans-Bold.ttf', import.meta.url));

export const PAGE_MARGIN = 40;
const PAGE_WIDTH = 595.28; // A4 width in points
const PAGE_HEIGHT = 841.89; // A4 height in points
export const PAGE_BOTTOM = PAGE_HEIGHT - PAGE_MARGIN;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;
const TABLE_FONT_SIZE = 9;
const ROW_VERTICAL_PADDING = 6;
const ROW_MIN_HEIGHT = 16;
const MAX_CELL_CHARS = 200;

const INTL_LOCALES: Record<SupportedExportLocale, string> = { tr: 'tr-TR', en: 'en-US', fr: 'fr-FR', de: 'de-DE' };

const BOOLEAN_LABELS: Record<SupportedExportLocale, { yes: string; no: string }> = {
  en: { yes: 'Yes', no: 'No' },
  tr: { yes: 'Evet', no: 'Hayır' },
  fr: { yes: 'Oui', no: 'Non' },
  de: { yes: 'Ja', no: 'Nein' },
};

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function formatCell(
  col: ReportColumnDefinition,
  raw: unknown,
  locale: SupportedExportLocale,
  currency: string,
): string {
  const intlLocale = INTL_LOCALES[locale];
  switch (col.type) {
    case 'number':
      return typeof raw === 'number' ? new Intl.NumberFormat(intlLocale).format(raw) : String(raw ?? '');
    case 'currency': {
      const amount = typeof raw === 'number' ? raw : Number(raw ?? 0);
      try {
        return new Intl.NumberFormat(intlLocale, { style: 'currency', currency }).format(amount);
      } catch {
        return `${currency} ${amount.toFixed(2)}`;
      }
    }
    case 'date': {
      const d = raw instanceof Date ? raw : new Date(String(raw));
      if (isNaN(d.getTime())) return String(raw ?? '');
      return new Intl.DateTimeFormat(intlLocale, { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' }).format(d);
    }
    case 'datetime': {
      const d = raw instanceof Date ? raw : new Date(String(raw));
      if (isNaN(d.getTime())) return String(raw ?? '');
      return new Intl.DateTimeFormat(intlLocale, {
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      }).format(d);
    }
    case 'boolean':
      return raw ? BOOLEAN_LABELS[locale].yes : BOOLEAN_LABELS[locale].no;
    case 'text':
    default:
      // Formula injection is a spreadsheet-application-specific risk (Excel/Sheets
      // auto-evaluating a leading =/+/-/@ on open) — inert in a rendered PDF, but
      // neutralized anyway for consistency between the two export formats.
      return truncate(neutralizeFormulaInjection(raw == null ? '' : String(raw)), MAX_CELL_CHARS);
  }
}

export interface BuildReportExportPdfParams<TRow> {
  locale: SupportedExportLocale;
  title: string;
  columns: ReportColumnDefinition[];
  rows: TRow[];
  toColumnValues: (row: TRow) => Record<string, unknown>;
  currency: string;
  generatedAt: Date;
  filterSummary: ReportFilterSummary;
  strings: {
    generatedAtLabel: string;
    appliedFiltersLabel: string;
    noDataLabel: string;
  };
}

export async function buildReportExportPdfBuffer<TRow>(params: BuildReportExportPdfParams<TRow>): Promise<Buffer> {
  const { locale, title, columns, rows, toColumnValues, currency, generatedAt, filterSummary, strings } = params;
  const intlLocale = INTL_LOCALES[locale];

  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN, autoFirstPage: true });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.registerFont('NotoSans', FONT_REGULAR);
      doc.registerFont('NotoSans-Bold', FONT_BOLD);

      doc.font('NotoSans-Bold').fontSize(14).fillColor('#111827').text(title);
      doc.font('NotoSans').fontSize(9).fillColor('#6b7280');
      doc.text(`${strings.generatedAtLabel}: ${new Intl.DateTimeFormat(intlLocale, { dateStyle: 'medium', timeStyle: 'short' }).format(generatedAt)}`);

      const filterEntries = Object.entries(filterSummary);
      doc.text(
        `${strings.appliedFiltersLabel}: ${filterEntries.length > 0 ? filterEntries.map(([k, v]) => `${k}=${v}`).join(', ') : '—'}`,
      );
      doc.moveDown(0.75);
      doc.moveTo(PAGE_MARGIN, doc.y).lineTo(PAGE_WIDTH - PAGE_MARGIN, doc.y).strokeColor('#d1d5db').stroke();
      doc.moveDown(0.5);

      const colWidth = CONTENT_WIDTH / Math.max(columns.length, 1);
      const colX = columns.map((_, idx) => PAGE_MARGIN + idx * colWidth);

      const drawHeader = () => {
        doc.font('NotoSans-Bold').fontSize(TABLE_FONT_SIZE).fillColor('#111827');
        const headerY = doc.y;
        columns.forEach((col, idx) => {
          const align = col.type === 'number' || col.type === 'currency' ? 'right' : 'left';
          doc.text(col.header[locale], colX[idx], headerY, { width: colWidth - 6, align });
        });
        doc.moveDown(0.4);
        doc.moveTo(PAGE_MARGIN, doc.y).lineTo(PAGE_WIDTH - PAGE_MARGIN, doc.y).strokeColor('#d1d5db').stroke();
        doc.moveDown(0.2);
      };

      drawHeader();

      if (rows.length === 0) {
        doc.font('NotoSans').fontSize(9).fillColor('#6b7280').text(strings.noDataLabel);
      } else {
        for (const row of rows) {
          const values = toColumnValues(row);
          const cellTexts = columns.map((col) => formatCell(col, values[col.key], locale, currency));

          doc.font('NotoSans').fontSize(TABLE_FONT_SIZE);
          const rowHeight = Math.max(
            ...cellTexts.map((text, idx) => doc.heightOfString(text || ' ', { width: colWidth - 6 })),
            0,
          ) + ROW_VERTICAL_PADDING;
          const height = Math.max(rowHeight, ROW_MIN_HEIGHT);

          if (doc.y + height > PAGE_BOTTOM) {
            doc.addPage();
            drawHeader();
          }

          const top = doc.y;
          doc.fillColor('#374151');
          columns.forEach((col, idx) => {
            const align = col.type === 'number' || col.type === 'currency' ? 'right' : 'left';
            doc.text(cellTexts[idx], colX[idx], top, { width: colWidth - 6, align });
          });
          doc.x = PAGE_MARGIN;
          doc.y = top + height;
        }
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

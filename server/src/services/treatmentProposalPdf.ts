/**
 * treatmentProposalPdf.ts — US-02.2 Phase 1: deterministic A4 treatment proposal PDF.
 *
 * This module is intentionally "thin service" per the task brief: it accepts an
 * already-authorized, already clinic-scoped canonical data object and returns PDF
 * bytes. It performs NO authorization, NO tenant/clinic lookup, and NO storage —
 * all of that lives in the route handler (server/src/routes/treatmentCases.ts).
 *
 * Font: Noto Sans (OFL-1.1), bundled under ../assets/fonts — required for correct
 * Turkish/French/German diacritics, which PDFKit's built-in AFM fonts cannot render.
 */
import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';
import { sumMoney } from '../utils/money.js';

const FONT_REGULAR = fileURLToPath(new URL('../assets/fonts/NotoSans-Regular.ttf', import.meta.url));
const FONT_BOLD = fileURLToPath(new URL('../assets/fonts/NotoSans-Bold.ttf', import.meta.url));

/** Fail-safe cap: guards against unbounded PDF generation memory/time for pathological cases. */
export const MAX_PROPOSAL_PROCEDURES = 500;

export type ProposalLocale = 'tr' | 'en' | 'fr' | 'de';

export interface TreatmentProposalProcedureLine {
  toothFdi: number | null;
  procedureName: string;
  status: string;
  estimatedCost: number | null;
}

export interface TreatmentProposalData {
  locale: ProposalLocale;
  clinic: {
    name: string;
    address?: string | null;
    phone?: string | null;
  };
  patient: {
    fullName: string;
  };
  treatmentCase: {
    title: string;
    stage: string;
    practitionerName: string | null;
    currency: string;
    /** Case-level cost estimate. Canonical total policy: acceptedAmount ?? estimatedAmount. */
    estimatedAmount?: number | null;
    /** Case-level amount the patient has accepted, when present takes priority over estimatedAmount. */
    acceptedAmount?: number | null;
  };
  procedures: TreatmentProposalProcedureLine[];
  generatedAt: Date;
}

const STRINGS: Record<ProposalLocale, Record<string, string>> = {
  en: {
    title: 'Treatment Proposal',
    generatedOn: 'Generated on',
    patient: 'Patient',
    treatmentCase: 'Treatment Case',
    status: 'Status',
    practitioner: 'Practitioner',
    currency: 'Currency',
    procedures: 'Proposed Procedures',
    colTooth: 'Tooth/Region',
    colProcedure: 'Procedure',
    colStatus: 'Status',
    colAmount: 'Estimated Amount',
    noProcedures: 'No procedures have been added to this treatment case yet.',
    total: 'Total Estimated Amount',
    procedureSubtotal: 'Procedure Subtotal',
    proposalTotal: 'Proposal Total',
    disclaimer:
      'This document is a treatment proposal / cost estimate, not an invoice. The final treatment plan, procedures and costs may change following clinical evaluation.',
  },
  tr: {
    title: 'Tedavi Teklifi',
    generatedOn: 'Oluşturulma Tarihi',
    patient: 'Hasta',
    treatmentCase: 'Tedavi Dosyası',
    status: 'Aşama',
    practitioner: 'Hekim',
    currency: 'Para Birimi',
    procedures: 'Önerilen Prosedürler',
    colTooth: 'Diş/Bölge',
    colProcedure: 'Prosedür',
    colStatus: 'Durum',
    colAmount: 'Tahmini Tutar',
    noProcedures: 'Bu tedavi dosyasına henüz prosedür eklenmemiş.',
    total: 'Toplam Tahmini Tutar',
    procedureSubtotal: 'Prosedür Ara Toplamı',
    proposalTotal: 'Teklif Toplamı',
    disclaimer:
      'Bu belge bir tedavi teklifi / maliyet tahminidir, fatura değildir. Klinik değerlendirme sonrasında nihai tedavi planı, prosedürler ve maliyetler değişebilir.',
  },
  fr: {
    title: 'Proposition de traitement',
    generatedOn: 'Généré le',
    patient: 'Patient',
    treatmentCase: 'Dossier de traitement',
    status: 'Statut',
    practitioner: 'Praticien',
    currency: 'Devise',
    procedures: 'Actes proposés',
    colTooth: 'Dent/Région',
    colProcedure: 'Acte',
    colStatus: 'Statut',
    colAmount: 'Montant estimé',
    noProcedures: "Aucun acte n'a encore été ajouté à ce dossier de traitement.",
    total: 'Montant total estimé',
    procedureSubtotal: 'Sous-total des actes',
    proposalTotal: 'Total de la proposition',
    disclaimer:
      "Ce document est une proposition de traitement / estimation de coût, et non une facture. Le plan de traitement final, les actes et les coûts peuvent évoluer après évaluation clinique.",
  },
  de: {
    title: 'Behandlungsvorschlag',
    generatedOn: 'Erstellt am',
    patient: 'Patient',
    treatmentCase: 'Behandlungsfall',
    status: 'Status',
    practitioner: 'Behandler',
    currency: 'Währung',
    procedures: 'Vorgeschlagene Leistungen',
    colTooth: 'Zahn/Region',
    colProcedure: 'Leistung',
    colStatus: 'Status',
    colAmount: 'Geschätzter Betrag',
    noProcedures: 'Diesem Behandlungsfall wurden noch keine Leistungen hinzugefügt.',
    total: 'Geschätzter Gesamtbetrag',
    procedureSubtotal: 'Zwischensumme der Leistungen',
    proposalTotal: 'Angebotssumme',
    disclaimer:
      'Dieses Dokument ist ein Behandlungsvorschlag / eine Kostenschätzung, keine Rechnung. Der endgültige Behandlungsplan, die Leistungen und Kosten können sich nach der klinischen Untersuchung ändern.',
  },
};

// Bounded, known treatment-case stage keys (mirrors src/locales/*/treatmentCases.json `stages`).
// Any stage value not in this map falls back to the raw stored value — never invented text.
const STAGE_LABELS: Record<ProposalLocale, Record<string, string>> = {
  en: {
    new: 'New Opportunity', consultation_scheduled: 'Consultation Scheduled', consultation_done: 'Consultation Done',
    quote_sent: 'Proposal Sent', waiting_patient_decision: 'Awaiting Decision', accepted: 'Accepted',
    in_progress: 'In Progress', completed: 'Completed', lost: 'Lost',
  },
  tr: {
    new: 'Yeni Fırsat', consultation_scheduled: 'Konsültasyon Planlandı', consultation_done: 'Konsültasyon Yapıldı',
    quote_sent: 'Teklif Gönderildi', waiting_patient_decision: 'Karar Bekleniyor', accepted: 'Kabul Edildi',
    in_progress: 'Devam Ediyor', completed: 'Tamamlandı', lost: 'Kaybedildi',
  },
  fr: {
    new: 'Nouvelle opportunité', consultation_scheduled: 'Consultation planifiée', consultation_done: 'Consultation effectuée',
    quote_sent: 'Proposition envoyée', waiting_patient_decision: 'En attente de décision', accepted: 'Acceptée',
    in_progress: 'En cours', completed: 'Terminée', lost: 'Perdue',
  },
  de: {
    new: 'Neue Gelegenheit', consultation_scheduled: 'Beratung geplant', consultation_done: 'Beratung abgeschlossen',
    quote_sent: 'Vorschlag gesendet', waiting_patient_decision: 'Entscheidung ausstehend', accepted: 'Angenommen',
    in_progress: 'In Bearbeitung', completed: 'Abgeschlossen', lost: 'Verloren',
  },
};

const DATE_LOCALES: Record<ProposalLocale, string> = { tr: 'tr-TR', en: 'en-US', fr: 'fr-FR', de: 'de-DE' };

function resolveLocale(locale: string | null | undefined): ProposalLocale {
  return locale === 'tr' || locale === 'en' || locale === 'fr' || locale === 'de' ? locale : 'en';
}

function formatDate(date: Date, locale: ProposalLocale): string {
  return new Intl.DateTimeFormat(DATE_LOCALES[locale], { year: 'numeric', month: 'long', day: 'numeric' }).format(date);
}

function formatMoney(amount: number, currency: string, locale: ProposalLocale): string {
  try {
    return new Intl.NumberFormat(DATE_LOCALES[locale], { style: 'currency', currency }).format(amount);
  } catch {
    // Unknown/unsupported currency code — fall back to a plain "<code> <amount>" rendering
    // rather than throwing, since currency is tenant-configured data, not a client input we control.
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/**
 * Deterministic procedure subtotal: sums estimatedCost for non-cancelled procedures only,
 * via bounded minor-unit rounding (sumMoney). Defense-in-depth — the route already filters
 * cancelled procedures at the Prisma query level, but this must never trust that alone.
 */
export function calculateProposalTotal(procedures: TreatmentProposalProcedureLine[]): number {
  return sumMoney(procedures.filter((p) => p.status !== 'cancelled').map((p) => p.estimatedCost));
}

export interface ProposalTotals {
  /** Sum of non-cancelled procedure estimatedCost values. */
  procedureSubtotal: number;
  /** The amount to present as the proposal's primary total (see policy below). */
  proposalTotal: number;
  /** True when proposalTotal came from the case-level acceptedAmount/estimatedAmount fields
   *  rather than falling back to the procedure subtotal. */
  totalFromCase: boolean;
  /** True when a case-level amount exists AND differs from the procedure subtotal after
   *  currency rounding — both figures must be shown, never silently merged into one. */
  amountsDiffer: boolean;
}

/**
 * Total reconciliation policy (Phase 1, bounded — see PR discussion):
 *  1. procedureSubtotal = sum of non-cancelled procedure.estimatedCost.
 *  2. proposalTotal uses the canonical case-level amount, acceptedAmount ?? estimatedAmount,
 *     when either is present — this mirrors the established convention already used by
 *     GET /treatment-cases/financial-select and TreatmentCaseDetail's balance calculation.
 *  3. If neither case-level amount is present, proposalTotal falls back to procedureSubtotal.
 *  4. If a case-level amount is present and differs from procedureSubtotal after rounding,
 *     amountsDiffer is set so the caller renders BOTH figures — the procedure subtotal is
 *     never silently relabeled as the case total. No discount/VAT/explanation is invented.
 */
export function calculateProposalTotals(
  procedures: TreatmentProposalProcedureLine[],
  caseAmounts: { estimatedAmount?: number | null; acceptedAmount?: number | null } = {},
): ProposalTotals {
  const procedureSubtotal = calculateProposalTotal(procedures);
  const canonicalCaseAmount = caseAmounts.acceptedAmount ?? caseAmounts.estimatedAmount ?? null;
  const totalFromCase = canonicalCaseAmount !== null;
  const proposalTotal = totalFromCase ? sumMoney([canonicalCaseAmount]) : procedureSubtotal;
  const amountsDiffer = totalFromCase && proposalTotal !== procedureSubtotal;
  return { procedureSubtotal, proposalTotal, totalFromCase, amountsDiffer };
}

export const PAGE_MARGIN = 50;
export const PAGE_BOTTOM = 792 - PAGE_MARGIN; // A4 height in points (PDFKit default) minus bottom margin

// ── Table row layout: measured heights, not fixed moveDown() bookkeeping ────────
// Every cell is measured with PDFKit's real heightOfString() before a row is drawn, so a
// wrapped procedure name can never overlap the next row (blocking review finding).

export const PROPOSAL_TABLE_COL_WIDTHS = { tooth: 65, procedure: 225, status: 95, amount: 95 } as const;
export type ProposalTableColWidths = typeof PROPOSAL_TABLE_COL_WIDTHS;

const TABLE_FONT_SIZE = 9;
const TABLE_ROW_VERTICAL_PADDING = 8; // added above the tallest cell's measured text height
const TABLE_ROW_MIN_HEIGHT = 18; // floor so single-line rows keep the original visual density

// Guards against pathological/hostile field values producing a row taller than a page:
// a value this long would still wrap safely, but truncating keeps row height bounded and
// the PDF byte size sane regardless of what was typed into a free-text field upstream.
const MAX_PROCEDURE_NAME_CHARS = 240;
const MAX_STATUS_CHARS = 120;

/** Bounds a cell's text length, replacing anything cut with a single trailing ellipsis. */
export function truncateCellText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

export interface ProposalTableRowCells {
  tooth: string;
  procedure: string;
  status: string;
  amount: string;
}

/**
 * Measures the real rendered height a table row needs, as the max of every cell's
 * heightOfString() (tooth/procedure/status/amount) plus vertical padding. Callers must set
 * the doc's font/fontSize before calling — this only reads doc.heightOfString(), it never
 * mutates font state itself, so it is safe to reuse the live rendering doc as the measurer.
 */
export function computeProposalRowHeight(
  doc: PDFKit.PDFDocument,
  cells: ProposalTableRowCells,
  colWidths: ProposalTableColWidths = PROPOSAL_TABLE_COL_WIDTHS,
): number {
  const contentHeight = Math.max(
    doc.heightOfString(cells.tooth || ' ', { width: colWidths.tooth }),
    doc.heightOfString(cells.procedure || ' ', { width: colWidths.procedure }),
    doc.heightOfString(cells.status || ' ', { width: colWidths.status }),
    doc.heightOfString(cells.amount || ' ', { width: colWidths.amount }),
  );
  return Math.max(contentHeight + TABLE_ROW_VERTICAL_PADDING, TABLE_ROW_MIN_HEIGHT);
}

export interface ProposalTableColX {
  tooth: number;
  procedure: number;
  status: number;
  amount: number;
}

export interface ProposalRowPlacement {
  /** Index into the rows array passed to layoutProposalTableRows. */
  index: number;
  /** 0-based page counter, relative to the first call (increments once per addPage()). */
  page: number;
  /** doc.y at the top of this row, before drawing. */
  top: number;
  /** The row's real measured height (see computeProposalRowHeight). */
  height: number;
}

/**
 * The actual production row-drawing loop, extracted as a directly-testable function so tests
 * can assert on real row placements (heights, page breaks, non-overlap) without re-implementing
 * this logic or parsing compressed/glyph-encoded PDF bytes. generateTreatmentProposalPdf calls
 * this same function — it is not a copy/simulation.
 *
 * For every row: measures the real height (heightOfString-based), page-breaks BEFORE drawing
 * if the row wouldn't fit (never overflows PAGE_BOTTOM), re-draws the header via drawHeader()
 * after every page break, draws all four cells at the same row top, then advances doc.y by the
 * row's actual measured height — never a fixed moveDown().
 */
export function layoutProposalTableRows(
  doc: PDFKit.PDFDocument,
  rows: ProposalTableRowCells[],
  opts: {
    colX: ProposalTableColX;
    colWidths?: ProposalTableColWidths;
    pageBottom: number;
    fontFamily?: string;
    fontSize?: number;
    textColor?: string;
    drawHeader: () => void;
  },
): ProposalRowPlacement[] {
  const colWidths = opts.colWidths ?? PROPOSAL_TABLE_COL_WIDTHS;
  const fontFamily = opts.fontFamily ?? 'NotoSans';
  const fontSize = opts.fontSize ?? TABLE_FONT_SIZE;
  const placements: ProposalRowPlacement[] = [];
  let page = 0;

  for (let index = 0; index < rows.length; index++) {
    const cells = rows[index];
    doc.font(fontFamily).fontSize(fontSize);
    const height = computeProposalRowHeight(doc, cells, colWidths);

    if (doc.y + height > opts.pageBottom) {
      doc.addPage();
      opts.drawHeader();
      page += 1;
      doc.font(fontFamily).fontSize(fontSize);
    }

    const top = doc.y;
    if (opts.textColor) doc.fillColor(opts.textColor);
    doc.text(cells.tooth, opts.colX.tooth, top, { width: colWidths.tooth });
    doc.text(cells.procedure, opts.colX.procedure, top, { width: colWidths.procedure });
    doc.text(cells.status, opts.colX.status, top, { width: colWidths.status });
    doc.text(cells.amount, opts.colX.amount, top, { width: colWidths.amount, align: 'right' });

    doc.x = PAGE_MARGIN;
    doc.y = top + height;
    placements.push({ index, page, top, height });
  }

  return placements;
}

/**
 * Builds a safe, ASCII-only filename derived from the treatment case id and
 * generation date only — never from patient name or other free-text fields,
 * so a hostile "patient name" value can never influence the Content-Disposition
 * header the browser receives.
 */
export function buildProposalPdfFilename(treatmentCaseId: string, generatedAt: Date): string {
  const safeId = treatmentCaseId.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40) || 'case';
  const yyyy = generatedAt.getUTCFullYear();
  const mm = String(generatedAt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(generatedAt.getUTCDate()).padStart(2, '0');
  return `treatment-proposal-${safeId}-${yyyy}${mm}${dd}.pdf`;
}

export async function generateTreatmentProposalPdf(rawData: TreatmentProposalData): Promise<Buffer> {
  const locale = resolveLocale(rawData.locale);
  const s = STRINGS[locale];
  const data = rawData;

  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN, autoFirstPage: true });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.registerFont('NotoSans', FONT_REGULAR);
      doc.registerFont('NotoSans-Bold', FONT_BOLD);
      doc.font('NotoSans');

      // ── Header ──────────────────────────────────────────────────────────
      doc.font('NotoSans-Bold').fontSize(18).fillColor('#1f2937').text(data.clinic.name || '—');
      doc.font('NotoSans').fontSize(9).fillColor('#6b7280');
      if (data.clinic.address) doc.text(data.clinic.address);
      if (data.clinic.phone) doc.text(data.clinic.phone);
      doc.moveDown(1);
      doc.font('NotoSans-Bold').fontSize(14).fillColor('#111827').text(s.title);
      doc.font('NotoSans').fontSize(9).fillColor('#6b7280').text(`${s.generatedOn}: ${formatDate(data.generatedAt, locale)}`);
      doc.moveDown(1);
      doc.moveTo(PAGE_MARGIN, doc.y).lineTo(545, doc.y).strokeColor('#d1d5db').stroke();
      doc.moveDown(0.75);

      // ── Patient ──────────────────────────────────────────────────────────
      doc.font('NotoSans-Bold').fontSize(11).fillColor('#111827').text(s.patient);
      doc.font('NotoSans').fontSize(10).fillColor('#374151').text(data.patient.fullName);
      doc.moveDown(0.75);

      // ── Treatment case ───────────────────────────────────────────────────
      doc.font('NotoSans-Bold').fontSize(11).fillColor('#111827').text(s.treatmentCase);
      doc.font('NotoSans').fontSize(10).fillColor('#374151');
      doc.text(data.treatmentCase.title);
      const stageLabel = STAGE_LABELS[locale][data.treatmentCase.stage] ?? data.treatmentCase.stage;
      doc.text(`${s.status}: ${stageLabel}`);
      if (data.treatmentCase.practitionerName) doc.text(`${s.practitioner}: ${data.treatmentCase.practitionerName}`);
      doc.text(`${s.currency}: ${data.treatmentCase.currency}`);
      doc.moveDown(0.75);

      // ── Procedure table ──────────────────────────────────────────────────
      // Cancelled procedures must never appear on the proposal or contribute to any total —
      // filtered here as defense-in-depth even though the route already excludes them at the
      // Prisma query level (`status: { not: 'cancelled' }`).
      const activeProcedures = data.procedures.filter((p) => p.status !== 'cancelled');

      doc.font('NotoSans-Bold').fontSize(11).fillColor('#111827').text(s.procedures);
      doc.moveDown(0.25);

      const colX = { tooth: PAGE_MARGIN, procedure: PAGE_MARGIN + 70, status: PAGE_MARGIN + 300, amount: PAGE_MARGIN + 400 };
      const colWidths = PROPOSAL_TABLE_COL_WIDTHS;

      const drawTableHeader = () => {
        doc.font('NotoSans-Bold').fontSize(9).fillColor('#111827');
        const headerY = doc.y;
        doc.text(s.colTooth, colX.tooth, headerY, { width: colWidths.tooth });
        doc.text(s.colProcedure, colX.procedure, headerY, { width: colWidths.procedure });
        doc.text(s.colStatus, colX.status, headerY, { width: colWidths.status });
        doc.text(s.colAmount, colX.amount, headerY, { width: colWidths.amount, align: 'right' });
        doc.moveDown(0.5);
        doc.moveTo(PAGE_MARGIN, doc.y).lineTo(545, doc.y).strokeColor('#d1d5db').stroke();
        doc.moveDown(0.25);
      };

      drawTableHeader();

      if (activeProcedures.length === 0) {
        doc.font('NotoSans').fontSize(9).fillColor('#6b7280').text(s.noProcedures);
      } else {
        const rows: ProposalTableRowCells[] = activeProcedures.map((proc) => ({
          tooth: proc.toothFdi !== null ? String(proc.toothFdi) : '—',
          procedure: truncateCellText(proc.procedureName || '—', MAX_PROCEDURE_NAME_CHARS),
          status: truncateCellText(proc.status || '—', MAX_STATUS_CHARS),
          amount: proc.estimatedCost !== null ? formatMoney(proc.estimatedCost, data.treatmentCase.currency, locale) : '—',
        }));

        layoutProposalTableRows(doc, rows, {
          colX,
          colWidths,
          pageBottom: PAGE_BOTTOM,
          fontFamily: 'NotoSans',
          fontSize: TABLE_FONT_SIZE,
          textColor: '#374151',
          drawHeader: drawTableHeader,
        });
      }

      // Table rows use fixed per-column x/width for doc.text(); reset the cursor's
      // implicit text width back to the full content area before the next
      // unbounded-width text() calls, or they inherit the last column's narrow box.
      doc.x = PAGE_MARGIN;
      doc.moveDown(0.5);
      if (doc.y > PAGE_BOTTOM) doc.addPage();
      doc.moveTo(PAGE_MARGIN, doc.y).lineTo(545, doc.y).strokeColor('#d1d5db').stroke();
      doc.moveDown(0.5);

      // ── Financial summary ────────────────────────────────────────────────
      // Total reconciliation policy: see calculateProposalTotals() doc comment. Cancelled
      // procedures are already excluded from activeProcedures above.
      const totals = calculateProposalTotals(activeProcedures, {
        estimatedAmount: data.treatmentCase.estimatedAmount,
        acceptedAmount: data.treatmentCase.acceptedAmount,
      });
      if (totals.amountsDiffer) {
        if (doc.y > PAGE_BOTTOM - 55) doc.addPage();
        doc.font('NotoSans').fontSize(10).fillColor('#374151').text(
          `${s.procedureSubtotal}: ${formatMoney(totals.procedureSubtotal, data.treatmentCase.currency, locale)}`,
          PAGE_MARGIN,
          doc.y,
          { width: 495, align: 'right' },
        );
        doc.x = PAGE_MARGIN;
        doc.moveDown(0.25);
        doc.font('NotoSans-Bold').fontSize(12).fillColor('#111827').text(
          `${s.proposalTotal}: ${formatMoney(totals.proposalTotal, data.treatmentCase.currency, locale)}`,
          PAGE_MARGIN,
          doc.y,
          { width: 495, align: 'right' },
        );
      } else {
        if (doc.y > PAGE_BOTTOM - 40) doc.addPage();
        const label = totals.totalFromCase ? s.proposalTotal : s.total;
        doc.font('NotoSans-Bold').fontSize(12).fillColor('#111827').text(
          `${label}: ${formatMoney(totals.proposalTotal, data.treatmentCase.currency, locale)}`,
          PAGE_MARGIN,
          doc.y,
          { width: 495, align: 'right' },
        );
      }
      doc.x = PAGE_MARGIN;
      doc.moveDown(1);

      // ── Disclaimer / footer ───────────────────────────────────────────────
      if (doc.y > PAGE_BOTTOM - 40) doc.addPage();
      doc.font('NotoSans').fontSize(8).fillColor('#9ca3af').text(s.disclaimer, PAGE_MARGIN, doc.y, { width: 495, align: 'left' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

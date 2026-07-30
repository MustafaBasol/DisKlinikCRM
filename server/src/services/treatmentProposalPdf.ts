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

/** Deterministic total: sums only the currently-supported estimatedCost field via bounded minor-unit rounding. */
export function calculateProposalTotal(procedures: TreatmentProposalProcedureLine[]): number {
  return sumMoney(procedures.map((p) => p.estimatedCost));
}

const PAGE_MARGIN = 50;
const PAGE_BOTTOM = 792 - PAGE_MARGIN; // A4 height in points (PDFKit default) minus bottom margin

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
      doc.font('NotoSans-Bold').fontSize(11).fillColor('#111827').text(s.procedures);
      doc.moveDown(0.25);

      const colX = { tooth: PAGE_MARGIN, procedure: PAGE_MARGIN + 70, status: PAGE_MARGIN + 300, amount: PAGE_MARGIN + 400 };
      const rowHeight = 18;

      const drawTableHeader = () => {
        doc.font('NotoSans-Bold').fontSize(9).fillColor('#111827');
        const headerY = doc.y;
        doc.text(s.colTooth, colX.tooth, headerY, { width: 65 });
        doc.text(s.colProcedure, colX.procedure, headerY, { width: 225 });
        doc.text(s.colStatus, colX.status, headerY, { width: 95 });
        doc.text(s.colAmount, colX.amount, headerY, { width: 95, align: 'right' });
        doc.moveDown(0.5);
        doc.moveTo(PAGE_MARGIN, doc.y).lineTo(545, doc.y).strokeColor('#d1d5db').stroke();
        doc.moveDown(0.25);
      };

      drawTableHeader();

      if (data.procedures.length === 0) {
        doc.font('NotoSans').fontSize(9).fillColor('#6b7280').text(s.noProcedures);
      } else {
        doc.font('NotoSans').fontSize(9).fillColor('#374151');
        for (const proc of data.procedures) {
          if (doc.y > PAGE_BOTTOM - rowHeight) {
            doc.addPage();
            drawTableHeader();
            doc.font('NotoSans').fontSize(9).fillColor('#374151');
          }
          const rowY = doc.y;
          doc.text(proc.toothFdi !== null ? String(proc.toothFdi) : '—', colX.tooth, rowY, { width: 65 });
          doc.text(proc.procedureName, colX.procedure, rowY, { width: 225 });
          doc.text(proc.status, colX.status, rowY, { width: 95 });
          doc.text(
            proc.estimatedCost !== null ? formatMoney(proc.estimatedCost, data.treatmentCase.currency, locale) : '—',
            colX.amount,
            rowY,
            { width: 95, align: 'right' },
          );
          doc.moveDown(0.6);
        }
      }

      // Table rows use fixed per-column x/width for doc.text(); reset the cursor's
      // implicit text width back to the full content area before the next
      // unbounded-width text() calls, or they inherit the last column's narrow box.
      doc.x = PAGE_MARGIN;
      doc.moveDown(0.5);
      doc.moveTo(PAGE_MARGIN, doc.y).lineTo(545, doc.y).strokeColor('#d1d5db').stroke();
      doc.moveDown(0.5);

      // ── Financial summary ────────────────────────────────────────────────
      if (doc.y > PAGE_BOTTOM - 40) doc.addPage();
      const total = calculateProposalTotal(data.procedures);
      doc.font('NotoSans-Bold').fontSize(12).fillColor('#111827').text(
        `${s.total}: ${formatMoney(total, data.treatmentCase.currency, locale)}`,
        PAGE_MARGIN,
        doc.y,
        { width: 495, align: 'right' },
      );
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

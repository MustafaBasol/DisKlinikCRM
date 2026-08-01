/**
 * treatmentProposalPdf.test.ts — US-02.2 Phase 1: treatment proposal PDF
 *
 * Run with: cd server && npx tsx src/tests/treatmentProposalPdf.test.ts
 * No external test framework — uses node:assert/strict (repo convention).
 *
 * Scope: this exercises the REAL PDF generation service (services/treatmentProposalPdf.ts)
 * and money helper (utils/money.ts) directly — genuine PDFKit output, not simulated.
 *
 * The route-logic section below is a SIMULATION kept for its original purpose (regression
 * coverage on the request/response shape). The independent review's blocking finding — that a
 * simulation does not protect the production Express route — is addressed separately by
 * treatmentCasesProposalPdfRoute.test.ts, which extracts and runs the REAL router's middleware
 * chain (authorize() included) against the real handler. Run both; they are complementary, not
 * duplicates.
 *
 * Test coverage:
 *  ── sumMoney (money.ts) ──────────────────────────────────────────────────
 *   1. Sums plain integers correctly
 *   2. Avoids float drift (0.1 + 0.2 style inputs) via minor-unit rounding
 *   3. Ignores null/undefined/non-finite entries
 *   4. Deterministic regardless of summation order
 *
 *  ── generateTreatmentProposalPdf (real PDFKit output) ───────────────────
 *   5. Produces a non-empty Buffer starting with the "%PDF" magic bytes
 *   6. Turkish diacritics (İ ı Ş ş Ğ ğ Ç ç Ö ö Ü ü) render without throwing
 *   7. French/German diacritics render without throwing
 *   8. calculateProposalTotal matches sum of procedure estimatedCost (deterministic)
 *   9. Unsupported/invented fields (discount, VAT, quantity) passed on a procedure
 *      object have no effect on the calculated total or rendering
 *
 *  ── Cancelled procedures (blocking finding 2) ────────────────────────────
 *  10. calculateProposalTotal excludes cancelled procedures from the sum
 *  11. A PDF is byte-identical whether or not cancelled procedures are mixed into the input
 *      (proves they leave no trace — not in the table, not in the total, not in page layout)
 *  12. All-cancelled renders the same "no procedures" empty state as a genuinely empty case
 *
 *  ── calculateProposalTotals: total reconciliation policy (blocking finding 3) ───
 *  13-22. acceptedAmount/estimatedAmount precedence, absent-both fallback, equal vs
 *      differing amounts, cancelled exclusion, decimal rounding, zero/null handling,
 *      plus two end-to-end generateTreatmentProposalPdf smoke checks
 *
 *  ── Table row layout: measured heights (blocking finding 1) ─────────────
 *  23-30. computeProposalRowHeight (short vs wrapped, max-across-all-cells), truncateCellText
 *      bounding, layoutProposalTableRows (the actual production row loop, not a copy) proving
 *      no-overlap advancement, page-break-before-overflow with header-repeat, a bounded
 *      hostile-length row, a real generated PDF with 25 long-name rows whose page count is
 *      asserted > 1, and the table column-width budget
 *
 *  ── buildProposalPdfFilename ─────────────────────────────────────────────
 *  31. ASCII-safe, ".pdf" suffixed, never contains patient name
 *  32. Strips path traversal / unsafe characters from a hostile case id
 *
 *  ── Route-logic simulation (mirrors routes/treatmentCases.ts) ───────────
 *  33. Authorized same-clinic user → 200, application/pdf, attachment disposition, non-empty body, %PDF magic bytes
 *  34. Cross-clinic user → 404 (never leaks existence)
 *  35. Unauthorized role (BILLING) → rejected by authorize()
 *  36. DENTIST not assigned to the case → 403 Forbidden
 *  37. DENTIST assigned to the case → 200
 *  38. Missing/unknown treatment case id → 404
 *  39. Generator failure → safe generic 500, no patient data or internal paths leaked
 */

import assert from 'node:assert/strict';
import PDFDocument from 'pdfkit';
import { sumMoney } from '../utils/money.js';
import {
  generateTreatmentProposalPdf,
  calculateProposalTotal,
  calculateProposalTotals,
  computeProposalRowHeight,
  layoutProposalTableRows,
  truncateCellText,
  buildProposalPdfFilename,
  MAX_PROPOSAL_PROCEDURES,
  PROPOSAL_TABLE_COL_WIDTHS,
  type TreatmentProposalData,
  type TreatmentProposalProcedureLine,
  type ProposalTableRowCells,
} from '../services/treatmentProposalPdf.js';

/**
 * Normalizes the two known sources of run-to-run non-determinism in PDFKit output
 * (CreationDate timestamp and the trailer's random /ID hash pair) so that two PDFs built
 * from otherwise-identical content compare byte-for-byte equal. Both replacements are
 * fixed-length, so byte offsets elsewhere in the file are unaffected — this is a real
 * equality check on the actual rendered content, not an approximation.
 */
function normalizePdfBuffer(buf: Buffer): string {
  return buf
    .toString('latin1')
    .replace(/D:\d{14}Z/g, 'D:00000000000000Z')
    .replace(/\/ID \[<[0-9a-f]+> <[0-9a-f]+>\]/g, '/ID [<0> <0>]');
}

/** Counts real page objects in a raw PDFKit buffer (`/Type /Page`, excluding the `/Type /Pages` tree node). */
function countPdfPages(buf: Buffer): number {
  const matches = buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g);
  return matches ? matches.length : 0;
}

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${err?.message ?? err}`);
    failed++;
  }
}

console.log('\n=== sumMoney: bounded, deterministic minor-unit summation ===');

await test('sums plain integers correctly', () => {
  assert.equal(sumMoney([100, 200, 300]), 600);
});

await test('avoids float drift on classic 0.1+0.2 style inputs', () => {
  // Raw JS: 0.1 + 0.2 === 0.30000000000000004
  assert.equal(sumMoney([0.1, 0.2]), 0.3);
  assert.equal(sumMoney([10.1, 20.2, 5.05]), 35.35);
});

await test('ignores null/undefined/non-finite entries', () => {
  assert.equal(sumMoney([100, null, undefined, NaN, Infinity, -Infinity, 50]), 150);
});

await test('deterministic regardless of summation order', () => {
  const a = [12.34, 56.78, 9.01, 100];
  const b = [100, 9.01, 56.78, 12.34];
  assert.equal(sumMoney(a), sumMoney(b));
});

console.log('\n=== generateTreatmentProposalPdf: real PDFKit output ===');

function baseData(overrides: Partial<TreatmentProposalData> = {}): TreatmentProposalData {
  return {
    locale: 'en',
    clinic: { name: 'Test Dental Clinic', address: '123 Test St', phone: '+1 555 0100' },
    patient: { fullName: 'Test Patient' },
    treatmentCase: { title: 'Root canal plan', stage: 'quote_sent', practitionerName: 'Dr. Test', currency: 'USD' },
    procedures: [
      { toothFdi: 11, procedureName: 'Root canal', status: 'planned', estimatedCost: 250.5 },
      { toothFdi: 12, procedureName: 'Crown', status: 'planned', estimatedCost: 400 },
    ],
    generatedAt: new Date('2026-01-15T10:00:00Z'),
    ...overrides,
  };
}

await test('produces a non-empty Buffer starting with the %PDF magic bytes', async () => {
  const buf = await generateTreatmentProposalPdf(baseData());
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 0, 'PDF buffer must be non-empty');
  assert.equal(buf.subarray(0, 4).toString('ascii'), '%PDF');
});

await test('Turkish diacritics render without throwing (İ ı Ş ş Ğ ğ Ç ç Ö ö Ü ü)', async () => {
  const data = baseData({
    locale: 'tr',
    clinic: { name: 'İstanbul Ağız ve Diş Sağlığı Kliniği', address: 'Şişli, İstanbul', phone: null },
    patient: { fullName: 'Şeyda Öztürk-Çelik' },
    treatmentCase: { title: 'Diş çekimi ve İmplant Planı', stage: 'in_progress', practitionerName: 'Dr. Gül Yıldız', currency: 'TRY' },
    procedures: [{ toothFdi: 26, procedureName: 'Çürük dolgusu (kompozit)', status: 'planlandı', estimatedCost: 1500 }],
  });
  const buf = await generateTreatmentProposalPdf(data);
  assert.ok(buf.length > 0);
  assert.equal(buf.subarray(0, 4).toString('ascii'), '%PDF');
});

await test('French/German diacritics render without throwing', async () => {
  const fr = baseData({
    locale: 'fr',
    clinic: { name: 'Clinique Dentaire Élysée', address: 'Généraliste, à côté', phone: null },
    patient: { fullName: 'François Müller-Béranger' },
    treatmentCase: { title: 'Plan de traitement orthodontique', stage: 'accepted', practitionerName: 'Dr. Éléonore Beauséjour', currency: 'EUR' },
    procedures: [{ toothFdi: null, procedureName: 'Détartrage complet', status: 'terminé', estimatedCost: 80 }],
  });
  const de = baseData({
    locale: 'de',
    clinic: { name: 'Zahnärztliche Praxis Müller & Söhne', address: 'Königstraße 3', phone: null },
    patient: { fullName: 'Björn Größe-Weiß' },
    treatmentCase: { title: 'Wurzelbehandlung', stage: 'completed', practitionerName: 'Dr. Änne Krüger', currency: 'EUR' },
    procedures: [{ toothFdi: 36, procedureName: 'Wurzelkanalbehandlung', status: 'abgeschlossen', estimatedCost: 300 }],
  });
  const bufFr = await generateTreatmentProposalPdf(fr);
  const bufDe = await generateTreatmentProposalPdf(de);
  assert.ok(bufFr.length > 0 && bufDe.length > 0);
  assert.equal(bufFr.subarray(0, 4).toString('ascii'), '%PDF');
  assert.equal(bufDe.subarray(0, 4).toString('ascii'), '%PDF');
});

await test('calculateProposalTotal matches deterministic sum of estimatedCost values', () => {
  const procedures = baseData().procedures;
  assert.equal(calculateProposalTotal(procedures), 650.5);
  assert.equal(calculateProposalTotal([]), 0);
  assert.equal(
    calculateProposalTotal([{ toothFdi: null, procedureName: 'a', status: 'planned', estimatedCost: null }]),
    0,
  );
});

await test('unsupported/invented fields on a procedure do not affect the calculated total', () => {
  const withInventedFields = [
    { toothFdi: 11, procedureName: 'Filling', status: 'planned', estimatedCost: 100, discountAmount: 999, vatRate: 20, quantity: 5 } as any,
  ];
  // calculateProposalTotal only ever reads .estimatedCost — extra invented fields must be inert.
  assert.equal(calculateProposalTotal(withInventedFields), 100);
});

console.log('\n=== Cancelled procedures: excluded from the table AND the total (blocking finding 2) ===');

await test('calculateProposalTotal excludes cancelled procedures from the sum', () => {
  const procedures: TreatmentProposalProcedureLine[] = [
    { toothFdi: 11, procedureName: 'Filling', status: 'planned', estimatedCost: 100 },
    { toothFdi: 12, procedureName: 'Extraction', status: 'cancelled', estimatedCost: 9999 },
    { toothFdi: 13, procedureName: 'Crown', status: 'completed', estimatedCost: 200 },
  ];
  assert.equal(calculateProposalTotal(procedures), 300);
});

await test('a proposal PDF is byte-identical whether or not cancelled procedures are present in the input', async () => {
  // Cancelled procedures must leave literally no trace in the rendered document — not in the
  // table, not in the total, not even as an invisible row affecting page layout. Comparing the
  // normalized bytes of "3 active only" vs "3 active + 2 cancelled" proves this directly,
  // without needing to parse the PDF's compressed/glyph-encoded text streams.
  const active: TreatmentProposalProcedureLine[] = [
    { toothFdi: 11, procedureName: 'Filling', status: 'planned', estimatedCost: 100 },
    { toothFdi: 12, procedureName: 'Crown', status: 'in_progress', estimatedCost: 200 },
    { toothFdi: 13, procedureName: 'Root canal', status: 'completed', estimatedCost: 300 },
  ];
  const activeOnly = baseData({ procedures: active });
  const withCancelledMixedIn = baseData({
    procedures: [
      active[0],
      { toothFdi: 21, procedureName: 'Extraction (declined)', status: 'cancelled', estimatedCost: 5000 },
      active[1],
      { toothFdi: 22, procedureName: 'Implant (declined)', status: 'cancelled', estimatedCost: 8000 },
      active[2],
    ],
  });

  const bufActiveOnly = await generateTreatmentProposalPdf(activeOnly);
  const bufWithCancelled = await generateTreatmentProposalPdf(withCancelledMixedIn);
  assert.equal(normalizePdfBuffer(bufActiveOnly), normalizePdfBuffer(bufWithCancelled));
});

await test('a proposal with only cancelled procedures renders the localized "no procedures" empty state', async () => {
  const allCancelled = baseData({
    procedures: [
      { toothFdi: 11, procedureName: 'Filling (declined)', status: 'cancelled', estimatedCost: 100 },
      { toothFdi: 12, procedureName: 'Crown (declined)', status: 'cancelled', estimatedCost: 200 },
    ],
  });
  const trulyEmpty = baseData({ procedures: [] });

  const bufAllCancelled = await generateTreatmentProposalPdf(allCancelled);
  const bufTrulyEmpty = await generateTreatmentProposalPdf(trulyEmpty);
  // All-cancelled must render byte-identically to the genuine empty-procedures case — i.e. the
  // same "no procedures have been added" branch, not a table with hidden/blank rows.
  assert.equal(normalizePdfBuffer(bufAllCancelled), normalizePdfBuffer(bufTrulyEmpty));
});

console.log('\n=== calculateProposalTotals: total reconciliation policy (blocking finding 3) ===');

const PROC_100: TreatmentProposalProcedureLine = { toothFdi: 11, procedureName: 'Filling', status: 'planned', estimatedCost: 100 };
const PROC_200: TreatmentProposalProcedureLine = { toothFdi: 12, procedureName: 'Crown', status: 'planned', estimatedCost: 200 };
const PROC_CANCELLED_9999: TreatmentProposalProcedureLine = { toothFdi: 13, procedureName: 'Declined implant', status: 'cancelled', estimatedCost: 9999 };

await test('acceptedAmount present → proposalTotal uses acceptedAmount, not the procedure subtotal', () => {
  const totals = calculateProposalTotals([PROC_100, PROC_200], { acceptedAmount: 500, estimatedAmount: 250 });
  assert.equal(totals.procedureSubtotal, 300);
  assert.equal(totals.proposalTotal, 500);
  assert.equal(totals.totalFromCase, true);
  assert.equal(totals.amountsDiffer, true);
});

await test('only estimatedAmount present (acceptedAmount null) → proposalTotal falls back to estimatedAmount', () => {
  const totals = calculateProposalTotals([PROC_100, PROC_200], { acceptedAmount: null, estimatedAmount: 450 });
  assert.equal(totals.proposalTotal, 450);
  assert.equal(totals.totalFromCase, true);
  assert.equal(totals.amountsDiffer, true); // 450 !== 300 subtotal
});

await test('both case-level amounts absent (null) → proposalTotal falls back to the procedure subtotal', () => {
  const totals = calculateProposalTotals([PROC_100, PROC_200], { acceptedAmount: null, estimatedAmount: null });
  assert.equal(totals.procedureSubtotal, 300);
  assert.equal(totals.proposalTotal, 300);
  assert.equal(totals.totalFromCase, false);
  assert.equal(totals.amountsDiffer, false);
});

await test('both case-level amounts absent (undefined, no caseAmounts arg) → same fallback behavior', () => {
  const totals = calculateProposalTotals([PROC_100, PROC_200]);
  assert.equal(totals.proposalTotal, 300);
  assert.equal(totals.totalFromCase, false);
});

await test('case amount equals the procedure subtotal → amountsDiffer is false, single total shown', () => {
  const totals = calculateProposalTotals([PROC_100, PROC_200], { acceptedAmount: 300, estimatedAmount: null });
  assert.equal(totals.procedureSubtotal, 300);
  assert.equal(totals.proposalTotal, 300);
  assert.equal(totals.totalFromCase, true);
  assert.equal(totals.amountsDiffer, false);
});

await test('case amount differs from the procedure subtotal → amountsDiffer is true, both values preserved', () => {
  const totals = calculateProposalTotals([PROC_100, PROC_200], { acceptedAmount: 1000, estimatedAmount: null });
  assert.equal(totals.procedureSubtotal, 300);
  assert.equal(totals.proposalTotal, 1000);
  assert.equal(totals.amountsDiffer, true);
  // The procedure subtotal must never be silently relabeled as the case total.
  assert.notEqual(totals.procedureSubtotal, totals.proposalTotal);
});

await test('cancelled procedures are excluded from the subtotal used by calculateProposalTotals', () => {
  const totals = calculateProposalTotals([PROC_100, PROC_200, PROC_CANCELLED_9999], {});
  assert.equal(totals.procedureSubtotal, 300);
});

await test('decimal rounding: minor-unit rounding applies to the case-level amount the same way it does to the subtotal', () => {
  const totals = calculateProposalTotals(
    [{ toothFdi: 11, procedureName: 'A', status: 'planned', estimatedCost: 10.005 }],
    { acceptedAmount: 99.999, estimatedAmount: null },
  );
  assert.equal(totals.procedureSubtotal, 10.01); // sumMoney rounds 10.005 -> 10.01 (Math.round half-up)
  assert.equal(totals.proposalTotal, 100); // sumMoney rounds 99.999 -> 100.00
});

await test('zero values: acceptedAmount of 0 is a valid canonical amount, not treated as absent', () => {
  // acceptedAmount ?? estimatedAmount — nullish coalescing only skips null/undefined, so an
  // explicit 0 (e.g. a fully-waived case) must win over a non-zero estimatedAmount.
  const totals = calculateProposalTotals([PROC_100], { acceptedAmount: 0, estimatedAmount: 500 });
  assert.equal(totals.totalFromCase, true);
  assert.equal(totals.proposalTotal, 0);
  assert.equal(totals.amountsDiffer, true);
});

await test('zero values: procedure subtotal of 0 (all null estimatedCost) with no case amount → proposalTotal is 0, not NaN', () => {
  const totals = calculateProposalTotals(
    [{ toothFdi: 11, procedureName: 'A', status: 'planned', estimatedCost: null }],
    { acceptedAmount: null, estimatedAmount: null },
  );
  assert.equal(totals.procedureSubtotal, 0);
  assert.equal(totals.proposalTotal, 0);
  assert.equal(totals.totalFromCase, false);
});

await test('generateTreatmentProposalPdf shows a single total when case amounts are absent (backward-compatible with the pre-fix single-total rendering)', async () => {
  const data = baseData({ procedures: [PROC_100, PROC_200] });
  const buf = await generateTreatmentProposalPdf(data);
  assert.equal(buf.subarray(0, 4).toString('ascii'), '%PDF');
});

await test('generateTreatmentProposalPdf renders without error when acceptedAmount/estimatedAmount differ from the procedure subtotal', async () => {
  const data = baseData({
    procedures: [PROC_100, PROC_200],
    treatmentCase: { title: 'Root canal plan', stage: 'accepted', practitionerName: 'Dr. Test', currency: 'USD', acceptedAmount: 1000, estimatedAmount: 900 },
  });
  const buf = await generateTreatmentProposalPdf(data);
  assert.equal(buf.subarray(0, 4).toString('ascii'), '%PDF');
  assert.ok(buf.length > 0);
});

console.log('\n=== Table row layout: measured heights, not fixed moveDown() bookkeeping (blocking finding 1) ===');

/** A throwaway PDFKit document used purely for heightOfString() measurement in these tests. */
function measurementDoc(): PDFKit.PDFDocument {
  return new PDFDocument({ size: 'A4', margin: 50, autoFirstPage: true });
}

const SHORT_NAME = 'Filling';
const LONG_NAME =
  'Comprehensive full-mouth rehabilitation including bilateral sinus lift augmentation, ' +
  'staged implant placement across all four quadrants, provisional fixed prosthetics, and ' +
  'a custom-milled zirconia final restoration plan';

await test('a short row and a multi-line (wrapped) row produce different measured heights', () => {
  const doc = measurementDoc();
  doc.fontSize(9);
  const shortCells: ProposalTableRowCells = { tooth: '11', procedure: SHORT_NAME, status: 'planned', amount: '$100.00' };
  const longCells: ProposalTableRowCells = { tooth: '12', procedure: LONG_NAME, status: 'planned', amount: '$100.00' };
  const shortHeight = computeProposalRowHeight(doc, shortCells);
  const longHeight = computeProposalRowHeight(doc, longCells);
  assert.ok(longHeight > shortHeight, `expected wrapped row (${longHeight}) taller than short row (${shortHeight})`);
});

await test('computeProposalRowHeight is the max across all four cells, not just the procedure cell', () => {
  const doc = measurementDoc();
  doc.fontSize(9);
  // A long STATUS value (not procedure) must also be able to drive the row height.
  const longStatus = 'waiting_patient_decision waiting_patient_decision waiting_patient_decision';
  const cellsShortStatus: ProposalTableRowCells = { tooth: '11', procedure: SHORT_NAME, status: 'x', amount: '$1' };
  const cellsLongStatus: ProposalTableRowCells = { tooth: '11', procedure: SHORT_NAME, status: longStatus, amount: '$1' };
  assert.ok(computeProposalRowHeight(doc, cellsLongStatus) > computeProposalRowHeight(doc, cellsShortStatus));
});

await test('truncateCellText leaves short text untouched and bounds hostile long values with a single ellipsis', () => {
  assert.equal(truncateCellText('Filling', 240), 'Filling');
  const hostile = 'X'.repeat(5000);
  const truncated = truncateCellText(hostile, 240);
  assert.equal(truncated.length, 240);
  assert.ok(truncated.endsWith('…'));
});

await test('layoutProposalTableRows: the following row starts after the wrapped row ends (no overlap)', () => {
  const doc = measurementDoc();
  const colX = { tooth: 50, procedure: 120, status: 350, amount: 445 };
  const rows: ProposalTableRowCells[] = [
    { tooth: '11', procedure: LONG_NAME, status: 'planned', amount: '$9,999.00' },
    { tooth: '12', procedure: SHORT_NAME, status: 'planned', amount: '$100.00' },
  ];
  let headerCalls = 0;
  const placements = layoutProposalTableRows(doc, rows, {
    colX,
    pageBottom: 792 - 50,
    fontFamily: 'Helvetica', // built-in AFM font — no registerFont() needed on this throwaway doc
    drawHeader: () => { headerCalls++; },
  });
  assert.equal(placements.length, 2);
  assert.ok(placements[0].height > 20, 'the wrapped row must measure as multi-line (taller than a single-line floor)');
  // The core overlap-prevention invariant from the blocking finding: row N+1 starts at or
  // after row N's real bottom edge (top + measured height) when both are on the same page.
  assert.ok(
    placements[1].top >= placements[0].top + placements[0].height,
    `row 2 (top=${placements[1].top}) must start after row 1's real bottom edge (${placements[0].top + placements[0].height})`,
  );
  assert.equal(headerCalls, 0, 'no page break needed for 2 short rows — header must not be redrawn');
});

await test('layoutProposalTableRows: page breaks occur before a row would exceed the available page area, and the header repeats', () => {
  const doc = measurementDoc();
  const colX = { tooth: 50, procedure: 120, status: 350, amount: 445 };
  // A tiny page-bottom (relative to doc.y after the first row) forces a page break on row 2.
  const rows: ProposalTableRowCells[] = [
    { tooth: '11', procedure: SHORT_NAME, status: 'planned', amount: '$100.00' },
    { tooth: '12', procedure: SHORT_NAME, status: 'planned', amount: '$100.00' },
    { tooth: '13', procedure: SHORT_NAME, status: 'planned', amount: '$100.00' },
  ];
  let headerCalls = 0;
  const startY = doc.y;
  // Match the fontSize layoutProposalTableRows will actually render with (its TABLE_FONT_SIZE
  // default is 9), so this prediction and the real measured height agree.
  doc.font('Helvetica').fontSize(9);
  const oneRowHeight = computeProposalRowHeight(doc, rows[0]);
  // Just enough room for exactly 1 row before the bottom margin.
  const tightPageBottom = startY + oneRowHeight + 2;

  const placements = layoutProposalTableRows(doc, rows, {
    colX,
    pageBottom: tightPageBottom,
    fontFamily: 'Helvetica',
    drawHeader: () => { headerCalls++; },
  });

  assert.equal(placements[0].page, 0, 'row 1 fits on the starting page');
  assert.ok(placements[1].page >= 1, 'row 2 must page-break rather than exceed the available page area');
  assert.ok(headerCalls >= 1, 'the table header must be redrawn after each page break');
  // No row was allowed to start past the requested page-bottom boundary it was measured against.
  for (const p of placements) {
    assert.ok(p.top + p.height <= tightPageBottom + oneRowHeight + 2, 'a row must not be started if it cannot fit before the next page break');
  }
});

await test('layoutProposalTableRows: an extremely long (hostile) procedure name is bounded — pre-truncated input still produces a finite, single row', () => {
  const doc = measurementDoc();
  const colX = { tooth: 50, procedure: 120, status: 350, amount: 445 };
  const hostileName = truncateCellText('A'.repeat(10000), 240);
  const rows: ProposalTableRowCells[] = [{ tooth: '11', procedure: hostileName, status: 'planned', amount: '$1.00' }];
  const placements = layoutProposalTableRows(doc, rows, { colX, pageBottom: 792 - 50, fontFamily: 'Helvetica', drawHeader: () => {} });
  assert.equal(placements.length, 1);
  // Bounded: even the longest allowed cell text must fit within a single A4 page's usable height.
  assert.ok(placements[0].height < 792 - 50 - 50, 'a single (truncated) row must never exceed the printable page height');
});

await test('generateTreatmentProposalPdf: many procedures with long names page-break and repeat the header (real PDF, page count)', async () => {
  const manyLongProcedures: TreatmentProposalProcedureLine[] = Array.from({ length: 25 }, (_, i) => ({
    toothFdi: 11 + (i % 32),
    procedureName: `${LONG_NAME} (variant ${i})`,
    status: i % 5 === 0 ? 'completed' : 'planned',
    estimatedCost: 100 + i,
  }));
  const data = baseData({ procedures: manyLongProcedures });
  const buf = await generateTreatmentProposalPdf(data);
  assert.equal(buf.subarray(0, 4).toString('ascii'), '%PDF');
  const pageCount = countPdfPages(buf);
  assert.ok(pageCount > 1, `25 multi-line procedure rows must overflow a single page (got ${pageCount} page(s))`);
});

await test('PROPOSAL_TABLE_COL_WIDTHS sums within the A4 content width used by the table', () => {
  const { tooth, procedure, status, amount } = PROPOSAL_TABLE_COL_WIDTHS;
  assert.ok(tooth + procedure + status + amount <= 495, 'column widths must fit within the 495pt table content width (545 - 50 margin)');
});

console.log('\n=== buildProposalPdfFilename: safe, ASCII, no patient data ===');

await test('produces an ASCII-safe, .pdf-suffixed filename from case id + date', () => {
  const filename = buildProposalPdfFilename('a1b2c3d4-e5f6-7890-abcd-ef1234567890', new Date('2026-03-05T00:00:00Z'));
  assert.match(filename, /^[a-zA-Z0-9._-]+\.pdf$/);
  assert.ok(filename.endsWith('.pdf'));
  assert.ok(filename.includes('20260305'));
});

await test('strips path traversal / unsafe characters from a hostile case id', () => {
  const hostileId = '../../etc/passwd";attacker-injected"';
  const filename = buildProposalPdfFilename(hostileId, new Date('2026-03-05T00:00:00Z'));
  assert.match(filename, /^[a-zA-Z0-9._-]+\.pdf$/);
  assert.ok(!filename.includes('/'));
  assert.ok(!filename.includes('"'));
  assert.ok(!filename.includes('..'));
});

await test('filename never contains patient name (function has no patient input at all)', () => {
  const filename = buildProposalPdfFilename('case-123', new Date('2026-03-05T00:00:00Z'));
  assert.ok(!filename.toLowerCase().includes('patient'));
});

console.log('\n=== Route-logic simulation (mirrors GET /treatment-cases/:id/proposal-pdf) ===');

type SimUser = {
  id: string;
  normalizedRole: 'OWNER' | 'ORG_ADMIN' | 'CLINIC_MANAGER' | 'DENTIST' | 'RECEPTIONIST' | 'BILLING' | 'ASSISTANT';
  allowedClinicIds: string[];
  canAccessAllClinics: boolean;
};

type MockTreatmentCase = {
  id: string;
  clinicId: string;
  practitionerId: string | null;
  title: string;
  stage: string;
  currency: string;
  patient: { firstName: string; lastName: string };
  practitioner: { firstName: string; lastName: string } | null;
  clinic: { name: string; address: string | null; phone: string | null; currency: string; defaultLanguage: string };
  procedures: Array<{ toothFdi: number | null; procedureName: string; status: string; estimatedCost: number | null }>;
};

const ALLOWED_ROLES = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST'];

async function getAccessibleClinicIds(user: SimUser, orgClinics: string[]): Promise<string[]> {
  if (user.canAccessAllClinics) return orgClinics;
  return user.allowedClinicIds;
}

async function simulateProposalPdfRoute(
  user: SimUser,
  caseId: string,
  db: { orgClinics: string[]; cases: MockTreatmentCase[] },
  opts: { forceGeneratorFailure?: boolean } = {},
) {
  if (!ALLOWED_ROLES.includes(user.normalizedRole)) {
    return { status: 403 as const, body: { error: 'Forbidden' } };
  }

  const accessibleIds = await getAccessibleClinicIds(user, db.orgClinics);
  if (accessibleIds.length === 0) return { status: 403 as const, body: { error: 'No clinic access' } };

  const tc = db.cases.find((c) => c.id === caseId && accessibleIds.includes(c.clinicId));
  if (!tc) return { status: 404 as const, body: { error: 'Treatment case not found' } };

  if (user.normalizedRole === 'DENTIST' && tc.practitionerId !== user.id) {
    return { status: 403 as const, body: { error: 'Forbidden' } };
  }

  if (tc.procedures.length > MAX_PROPOSAL_PROCEDURES) {
    return { status: 400 as const, body: { error: 'Too many procedures for a proposal PDF export' } };
  }

  try {
    if (opts.forceGeneratorFailure) {
      // Mirrors a real generator failure (e.g. corrupt font asset) without leaking
      // patient data — this exercises the exact catch-path the real route takes.
      throw new Error(`ENOENT: font asset missing at /internal/secret/path/${tc.patient.firstName}`);
    }

    const generatedAt = new Date('2026-01-15T10:00:00Z');
    const pdfBuffer = await generateTreatmentProposalPdf({
      locale: 'en',
      clinic: { name: tc.clinic.name, address: tc.clinic.address, phone: tc.clinic.phone },
      patient: { fullName: `${tc.patient.firstName} ${tc.patient.lastName}` },
      treatmentCase: {
        title: tc.title,
        stage: tc.stage,
        practitionerName: tc.practitioner ? `${tc.practitioner.firstName} ${tc.practitioner.lastName}` : null,
        currency: tc.currency || tc.clinic.currency,
      },
      procedures: tc.procedures,
      generatedAt,
    });

    const filename = buildProposalPdfFilename(tc.id, generatedAt);
    return {
      status: 200 as const,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
      body: pdfBuffer,
    };
  } catch (err) {
    // Real route logs only safeErrorFields(err) + caseId — never err.message/stack — and
    // always responds with this fixed generic message regardless of what the error contains.
    return { status: 500 as const, body: { error: 'Failed to generate proposal PDF' } };
  }
}

const db = {
  orgClinics: ['clinic-A', 'clinic-B'],
  cases: [
    {
      id: 'tc-A-1',
      clinicId: 'clinic-A',
      practitionerId: 'dentist-1',
      title: 'Implant plan',
      stage: 'quote_sent',
      currency: 'USD',
      patient: { firstName: 'Jane', lastName: 'Doe' },
      practitioner: { firstName: 'Alice', lastName: 'Dentist' },
      clinic: { name: 'Clinic A', address: '1 Main St', phone: '555-0100', currency: 'USD', defaultLanguage: 'en' },
      procedures: [{ toothFdi: 11, procedureName: 'Implant', status: 'planned', estimatedCost: 1200 }],
    },
    {
      id: 'tc-B-1',
      clinicId: 'clinic-B',
      practitionerId: 'dentist-2',
      title: 'Other clinic case',
      stage: 'new',
      currency: 'USD',
      patient: { firstName: 'John', lastName: 'Smith' },
      practitioner: null,
      clinic: { name: 'Clinic B', address: null, phone: null, currency: 'USD', defaultLanguage: 'en' },
      procedures: [],
    },
  ],
};

await test('authorized same-clinic user → 200, application/pdf, attachment, non-empty body, %PDF magic bytes', async () => {
  const user: SimUser = { id: 'owner-1', normalizedRole: 'OWNER', allowedClinicIds: ['clinic-A'], canAccessAllClinics: false };
  const res = await simulateProposalPdfRoute(user, 'tc-A-1', db);
  assert.equal(res.status, 200);
  assert.equal((res as any).headers['Content-Type'], 'application/pdf');
  assert.match((res as any).headers['Content-Disposition'], /^attachment; filename="[a-zA-Z0-9._-]+\.pdf"$/);
  assert.equal((res as any).headers['Cache-Control'], 'private, no-store');
  assert.equal((res as any).headers['X-Content-Type-Options'], 'nosniff');
  const body = (res as any).body as Buffer;
  assert.ok(body.length > 0);
  assert.equal(body.subarray(0, 4).toString('ascii'), '%PDF');
});

await test('cross-clinic user cannot access the proposal (404, never leaks existence)', async () => {
  const user: SimUser = { id: 'owner-1', normalizedRole: 'OWNER', allowedClinicIds: ['clinic-A'], canAccessAllClinics: false };
  const res = await simulateProposalPdfRoute(user, 'tc-B-1', db);
  assert.equal(res.status, 404);
});

await test('unauthorized role (BILLING) is rejected', async () => {
  const user: SimUser = { id: 'billing-1', normalizedRole: 'BILLING', allowedClinicIds: ['clinic-A'], canAccessAllClinics: false };
  const res = await simulateProposalPdfRoute(user, 'tc-A-1', db);
  assert.equal(res.status, 403);
});

await test('DENTIST not assigned to the case → 403 Forbidden', async () => {
  const user: SimUser = { id: 'dentist-2', normalizedRole: 'DENTIST', allowedClinicIds: ['clinic-A'], canAccessAllClinics: false };
  const res = await simulateProposalPdfRoute(user, 'tc-A-1', db);
  assert.equal(res.status, 403);
});

await test('DENTIST assigned to the case → 200', async () => {
  const user: SimUser = { id: 'dentist-1', normalizedRole: 'DENTIST', allowedClinicIds: ['clinic-A'], canAccessAllClinics: false };
  const res = await simulateProposalPdfRoute(user, 'tc-A-1', db);
  assert.equal(res.status, 200);
});

await test('missing/unknown treatment case id → 404', async () => {
  const user: SimUser = { id: 'owner-1', normalizedRole: 'OWNER', allowedClinicIds: ['clinic-A'], canAccessAllClinics: false };
  const res = await simulateProposalPdfRoute(user, 'tc-does-not-exist', db);
  assert.equal(res.status, 404);
});

await test('generator failure → safe generic 500, no patient data or internal paths leaked', async () => {
  const user: SimUser = { id: 'owner-1', normalizedRole: 'OWNER', allowedClinicIds: ['clinic-A'], canAccessAllClinics: false };
  const res = await simulateProposalPdfRoute(user, 'tc-A-1', db, { forceGeneratorFailure: true });
  assert.equal(res.status, 500);
  const bodyText = JSON.stringify(res.body);
  assert.equal(bodyText, JSON.stringify({ error: 'Failed to generate proposal PDF' }));
  assert.ok(!bodyText.includes('Jane'), 'must not leak patient first name');
  assert.ok(!bodyText.includes('/internal/'), 'must not leak internal file paths');
  assert.ok(!bodyText.includes('ENOENT'), 'must not leak raw error text');
});

console.log(`\n${'─'.repeat(50)}`);
console.log(`Toplam: ${passed + failed} test | Geçen: ${passed} | Başarısız: ${failed}`);
if (failed > 0) {
  console.error(`\n${failed} test başarısız!`);
  process.exit(1);
} else {
  console.log('\nTüm treatment proposal PDF testleri geçti!');
}

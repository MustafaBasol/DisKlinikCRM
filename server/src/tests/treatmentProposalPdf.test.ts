/**
 * treatmentProposalPdf.test.ts — US-02.2 Phase 1: treatment proposal PDF
 *
 * Run with: cd server && npx tsx src/tests/treatmentProposalPdf.test.ts
 * No external test framework — uses node:assert/strict (repo convention).
 *
 * Scope: this exercises the REAL PDF generation service (services/treatmentProposalPdf.ts)
 * and money helper (utils/money.ts) directly — genuine PDFKit output, not simulated.
 * Authorization/clinic-scope/DENTIST-ownership is verified via a route-logic simulation
 * mirroring the exact sequence in routes/treatmentCases.ts GET /:id/proposal-pdf
 * (same style as treatmentCaseClinicScope.test.ts / billingFinancialTreatmentCaseSelect.test.ts —
 * this repo has no live Express/supertest harness anywhere, by established convention).
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
 *  ── buildProposalPdfFilename ─────────────────────────────────────────────
 *  10. ASCII-safe, ".pdf" suffixed, never contains patient name
 *  11. Strips path traversal / unsafe characters from a hostile case id
 *
 *  ── Route-logic simulation (mirrors routes/treatmentCases.ts) ───────────
 *  12. Authorized same-clinic user → 200, application/pdf, attachment disposition, non-empty body, %PDF magic bytes
 *  13. Cross-clinic user → 404 (never leaks existence)
 *  14. Unauthorized role (BILLING) → rejected by authorize()
 *  15. DENTIST not assigned to the case → 403 Forbidden
 *  16. DENTIST assigned to the case → 200
 *  17. Missing/unknown treatment case id → 404
 *  18. Generator failure → safe generic 500, no patient data or internal paths leaked
 */

import assert from 'node:assert/strict';
import { sumMoney } from '../utils/money.js';
import {
  generateTreatmentProposalPdf,
  calculateProposalTotal,
  buildProposalPdfFilename,
  MAX_PROPOSAL_PROCEDURES,
  type TreatmentProposalData,
} from '../services/treatmentProposalPdf.js';

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

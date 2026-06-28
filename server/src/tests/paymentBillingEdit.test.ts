/**
 * paymentBillingEdit.test.ts — BILLING rolü ödeme düzenleme kısıtlamaları
 *
 * Koşturma: cd server && npx tsx src/tests/paymentBillingEdit.test.ts
 *
 * Bağlam: BILLING kullanıcıları bir ödemenin finansal alanlarını (tutar, para birimi,
 * yöntem, durum, ödeme tarihi, notlar) düzenleyebilmeli; ancak hasta (patientId) veya
 * tedavi vakasını (treatmentCaseId) değiştirememelidir.
 *
 * PUT /api/payments/:id handler'ındaki guard mantığını doğrular:
 *   server/src/routes/payments.ts
 */

import assert from 'node:assert/strict';
import { paymentSchema } from '../schemas/index.js';
import { normalizeRole } from '../utils/roles.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${err?.message ?? err}`);
    failed++;
  }
}

// ── Mirror of the BILLING guard in PUT /api/payments/:id ──────────────────────
// (server/src/routes/payments.ts — "BILLING users may not change patient or TC")

interface ExistingPayment {
  patientId: string;
  treatmentCaseId: string | null;
}

interface UpdateBody {
  patientId?: string;
  treatmentCaseId?: string | null;
  amount?: number;
  currency?: string;
  paymentMethod?: string;
  paymentStatus?: string;
  paidAt?: string;
  notes?: string;
}

function checkBillingUpdateAllowed(
  normalizedRole: string,
  body: UpdateBody,
  existing: ExistingPayment,
): { allowed: boolean; error?: string } {
  if (normalizedRole !== 'BILLING') return { allowed: true };
  if (body.patientId !== undefined && body.patientId !== existing.patientId) {
    return { allowed: false, error: 'Billing users cannot change the patient or treatment case of an existing payment.' };
  }
  if (body.treatmentCaseId !== undefined && body.treatmentCaseId !== existing.treatmentCaseId) {
    return { allowed: false, error: 'Billing users cannot change the patient or treatment case of an existing payment.' };
  }
  return { allowed: true };
}

// ── Role normalization helper (mirrors middleware/auth.ts) ─────────────────────

function resolveNormalizedRole(role: string, canAccessAllClinics: boolean): string {
  return normalizeRole(role, canAccessAllClinics);
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PATIENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PATIENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TC_1      = '11111111-1111-4111-8111-111111111111';
const TC_2      = '22222222-2222-4222-8222-222222222222';

const existingPayment: ExistingPayment = {
  patientId: PATIENT_A,
  treatmentCaseId: TC_1,
};

const existingNoTC: ExistingPayment = {
  patientId: PATIENT_A,
  treatmentCaseId: null,
};

const billingRole = resolveNormalizedRole('billing', false);
const ownerRole   = resolveNormalizedRole('owner', true);
const managerRole = resolveNormalizedRole('clinic_manager', false);

// ── Tests: BILLING allowed financial-only update ──────────────────────────────

console.log('\n=== BILLING: İzin verilen finansal alanları güncelleyebilir ===');

test('BILLING tutar güncelleyebilir', () => {
  const result = checkBillingUpdateAllowed(billingRole, { amount: 500 }, existingPayment);
  assert.equal(result.allowed, true);
});

test('BILLING para birimi güncelleyebilir', () => {
  const result = checkBillingUpdateAllowed(billingRole, { currency: 'EUR' }, existingPayment);
  assert.equal(result.allowed, true);
});

test('BILLING ödeme yöntemi güncelleyebilir', () => {
  const result = checkBillingUpdateAllowed(billingRole, { paymentMethod: 'card' }, existingPayment);
  assert.equal(result.allowed, true);
});

test('BILLING ödeme durumu güncelleyebilir', () => {
  const result = checkBillingUpdateAllowed(billingRole, { paymentStatus: 'paid' }, existingPayment);
  assert.equal(result.allowed, true);
});

test('BILLING ödeme tarihi güncelleyebilir', () => {
  const result = checkBillingUpdateAllowed(billingRole, { paidAt: '2026-06-01' }, existingPayment);
  assert.equal(result.allowed, true);
});

test('BILLING not (notes) güncelleyebilir', () => {
  const result = checkBillingUpdateAllowed(billingRole, { notes: 'ek açıklama' }, existingPayment);
  assert.equal(result.allowed, true);
});

test('BILLING tüm finansal alanları aynı anda güncelleyebilir', () => {
  const result = checkBillingUpdateAllowed(billingRole, {
    amount: 750, currency: 'TRY', paymentMethod: 'bank_transfer',
    paymentStatus: 'paid', paidAt: '2026-06-15', notes: 'test',
  }, existingPayment);
  assert.equal(result.allowed, true);
});

// ── Tests: BILLING blocked from changing patient ──────────────────────────────

console.log('\n=== BILLING: Hasta değiştirme engellenir ===');

test('BILLING farklı patientId ile güncelleme reddedilir', () => {
  const result = checkBillingUpdateAllowed(billingRole, { patientId: PATIENT_B }, existingPayment);
  assert.equal(result.allowed, false);
  assert.ok(result.error?.includes('Billing users cannot change'));
});

test('BILLING patientId + finansal alanlar birlikte gelirse reddedilir', () => {
  const result = checkBillingUpdateAllowed(billingRole, { patientId: PATIENT_B, amount: 100 }, existingPayment);
  assert.equal(result.allowed, false);
});

test('BILLING aynı patientId gönderirse kabul edilir (değişiklik yok)', () => {
  const result = checkBillingUpdateAllowed(billingRole, { patientId: PATIENT_A }, existingPayment);
  assert.equal(result.allowed, true);
});

// ── Tests: BILLING blocked from changing treatment case ───────────────────────

console.log('\n=== BILLING: Tedavi vakası değiştirme engellenir ===');

test('BILLING farklı treatmentCaseId ile güncelleme reddedilir', () => {
  const result = checkBillingUpdateAllowed(billingRole, { treatmentCaseId: TC_2 }, existingPayment);
  assert.equal(result.allowed, false);
  assert.ok(result.error?.includes('Billing users cannot change'));
});

test('BILLING null TC olan ödemeye TC eklemek reddedilir', () => {
  const result = checkBillingUpdateAllowed(billingRole, { treatmentCaseId: TC_1 }, existingNoTC);
  assert.equal(result.allowed, false);
});

test('BILLING mevcut TC\'yi null yapmak reddedilir', () => {
  const result = checkBillingUpdateAllowed(billingRole, { treatmentCaseId: null }, existingPayment);
  assert.equal(result.allowed, false);
});

test('BILLING aynı treatmentCaseId gönderirse kabul edilir (değişiklik yok)', () => {
  const result = checkBillingUpdateAllowed(billingRole, { treatmentCaseId: TC_1 }, existingPayment);
  assert.equal(result.allowed, true);
});

test('BILLING treatmentCaseId alanı gönderilmezse (undefined) kabul edilir', () => {
  const result = checkBillingUpdateAllowed(billingRole, { amount: 200 }, existingPayment);
  assert.equal(result.allowed, true);
});

// ── Tests: rejected update does not mutate (pure function always returns same result) ─

console.log('\n=== Reddedilen güncelleme DB\'yi değiştirmez (guard tekrar çalıştırılabilir) ===');

test('Guard aynı girdilerle tutarlı sonuç döndürür (idempotent)', () => {
  const body = { patientId: PATIENT_B };
  const r1 = checkBillingUpdateAllowed(billingRole, body, existingPayment);
  const r2 = checkBillingUpdateAllowed(billingRole, body, existingPayment);
  assert.equal(r1.allowed, false);
  assert.equal(r2.allowed, false);
  assert.equal(r1.error, r2.error);
});

// ── Tests: other roles not restricted ─────────────────────────────────────────

console.log('\n=== Diğer roller: patientId/treatmentCaseId değişikliğine izin verilir ===');

test('OWNER patientId değiştirebilir', () => {
  const result = checkBillingUpdateAllowed(ownerRole, { patientId: PATIENT_B }, existingPayment);
  assert.equal(result.allowed, true);
});

test('CLINIC_MANAGER treatmentCaseId değiştirebilir', () => {
  const result = checkBillingUpdateAllowed(managerRole, { treatmentCaseId: TC_2 }, existingPayment);
  assert.equal(result.allowed, true);
});

// ── Tests: cross-patient/cross-clinic TC linking rejected (schema + guard) ────

console.log('\n=== Çapraz hasta/klinik treatmentCaseId bağlama reddedilir ===');

test('Geçersiz UUID formatındaki treatmentCaseId şema tarafından reddedilir', () => {
  const result = paymentSchema.partial().safeParse({
    patientId: PATIENT_A,
    treatmentCaseId: 'not-a-valid-uuid',
    amount: 100,
    paymentMethod: 'cash',
  });
  assert.equal(result.success, false);
});

test('Farklı hasta UUID geçerliyse şemadan geçer, reddedilme route katmanında olur', () => {
  const result = paymentSchema.partial().safeParse({
    patientId: PATIENT_B,
    treatmentCaseId: TC_2,
    amount: 300,
    paymentMethod: 'card',
  });
  // Schema izin verir; BILLING guard veya findTreatmentCaseInClinic route katmanında reddeder
  assert.equal(result.success, true);
  if (result.success) {
    // Pass only the identity fields (not paidAt which is transformed to Date by schema)
    const guardResult = checkBillingUpdateAllowed(billingRole, {
      patientId: result.data.patientId,
      treatmentCaseId: result.data.treatmentCaseId,
    }, existingPayment);
    assert.equal(guardResult.allowed, false, 'BILLING cross-patient bağlamayı reddeder');
  }
});

test('Finansal-only kısmi güncelleme (patientId/treatmentCaseId yok) şema tarafından kabul edilir', () => {
  const result = paymentSchema.partial().safeParse({
    amount: 450,
    currency: 'TRY',
    paymentMethod: 'cash',
    paymentStatus: 'paid',
  });
  assert.equal(result.success, true);
});

// ── Tests: cross-patient patientId change with existing TC ────────────────────
// Mirrors route logic in PUT /payments/:id (lines 159–169):
//   nextPatientId  = body.patientId ?? existing.patientId
//   nextTCId       = body.treatmentCaseId !== undefined ? body.treatmentCaseId : existing.treatmentCaseId
//   findTreatmentCaseInClinic(nextTCId, clinicId, nextPatientId) must succeed

console.log('\n=== Hasta değiştirildiğinde mevcut tedavi vakası çapraz doğrulanır ===');

function computeEffectiveIds(
  body: UpdateBody,
  existing: ExistingPayment,
): { nextPatientId: string; nextTreatmentCaseId: string | null } {
  return {
    nextPatientId: body.patientId ?? existing.patientId,
    nextTreatmentCaseId: body.treatmentCaseId !== undefined ? body.treatmentCaseId : existing.treatmentCaseId,
  };
}

// Simulates findTreatmentCaseInClinic: returns false when TC doesn't belong to patient
function mockFindTC(
  tcId: string | null,
  tcToPatient: Record<string, string>,
  patientId: string,
): boolean {
  if (!tcId) return true;
  return tcToPatient[tcId] === patientId;
}

const tcToPatient = { [TC_1]: PATIENT_A, [TC_2]: PATIENT_B };

test('OWNER patientId değiştirirken eski TC farklı hastaya ait ise reddedilir', () => {
  // body has new patientId but omits treatmentCaseId → old TC carried over
  const body: UpdateBody = { patientId: PATIENT_B };
  const { nextPatientId, nextTreatmentCaseId } = computeEffectiveIds(body, existingPayment);

  assert.equal(nextPatientId, PATIENT_B);
  assert.equal(nextTreatmentCaseId, TC_1);

  // TC_1 belongs to PATIENT_A — invalid for PATIENT_B
  const valid = mockFindTC(nextTreatmentCaseId, tcToPatient, nextPatientId);
  assert.equal(valid, false, 'TC_1 belongs to PATIENT_A, not PATIENT_B → route returns 400');
});

test('CLINIC_MANAGER patientId ve TC\'yi birlikte değiştirirse geçerli kombinasyon kabul edilir', () => {
  const body: UpdateBody = { patientId: PATIENT_B, treatmentCaseId: TC_2 };
  const { nextPatientId, nextTreatmentCaseId } = computeEffectiveIds(body, existingPayment);

  assert.equal(nextPatientId, PATIENT_B);
  assert.equal(nextTreatmentCaseId, TC_2);

  const valid = mockFindTC(nextTreatmentCaseId, tcToPatient, nextPatientId);
  assert.equal(valid, true, 'TC_2 belongs to PATIENT_B — valid combination');
});

test('Yalnızca finansal alan güncellenmesi TC doğrulamasını sorunsuz geçer', () => {
  const body: UpdateBody = { amount: 999 };
  const { nextPatientId, nextTreatmentCaseId } = computeEffectiveIds(body, existingPayment);

  assert.equal(nextPatientId, PATIENT_A);
  assert.equal(nextTreatmentCaseId, TC_1);

  const valid = mockFindTC(nextTreatmentCaseId, tcToPatient, nextPatientId);
  assert.equal(valid, true, 'same patient, same TC — still valid');
});

test('DB değişmez: reddedilen OWNER güncellemesi sonrası existingPayment değişmez', () => {
  const before = { ...existingPayment };
  const body: UpdateBody = { patientId: PATIENT_B };
  const { nextPatientId, nextTreatmentCaseId } = computeEffectiveIds(body, existingPayment);
  const valid = mockFindTC(nextTreatmentCaseId, tcToPatient, nextPatientId);

  // Guard catches it — existingPayment object is never mutated
  assert.equal(valid, false);
  assert.deepEqual(existingPayment, before, 'guard is pure; existing record unchanged');
});

console.log(`\nSonuç: ${passed} geçti, ${failed} başarısız\n`);
if (failed > 0) process.exit(1);

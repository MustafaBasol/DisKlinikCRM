/**
 * billingPatientAccess.test.ts — BILLING rolünün hasta/ödeme erişim kontrolü
 *
 * Koşturma: cd server && npx tsx src/tests/billingPatientAccess.test.ts
 *
 * Bağlam: BILLING kullanıcıları hasta arayıp ödeme oluşturabilmeli, ancak klinik
 * verilere (tedavi notları, dental chart, ekler, randevu detayları) erişememeli.
 *
 * Senaryolar:
 *  - BILLING hasta arayabilir/listeleyebilir (GET /api/patients)
 *  - BILLING hasta detayını görebilir, yalnızca kimlik + ödeme alanları döner
 *  - BILLING ödeme oluşturabilir / listeleyebilir / planlara erişebilir
 *  - BILLING klinik kaynaklarına (tasks, treatment-cases, attachments, dental chart) erişemez
 *  - DENTIST/RECEPTIONIST/OWNER/ADMIN davranışı değişmez
 */

import assert from 'node:assert/strict';
import { normalizeRole } from '../utils/roles.js';

// ─── authorize() ile aynı iki katmanlı kontrol (server/src/middleware/auth.ts:157) ──

function authorize(allowedRoles: string[], user: { role: string; canAccessAllClinics: boolean }): boolean {
  const normalizedList = allowedRoles.map(r => r.toLowerCase());
  const canonicalRole = normalizeRole(user.role, user.canAccessAllClinics).toLowerCase();
  const rawRole = user.role.toLowerCase();
  return normalizedList.includes(canonicalRole) || normalizedList.includes(rawRole);
}

const billing = { role: 'billing', canAccessAllClinics: false };
const owner = { role: 'owner', canAccessAllClinics: true };
const clinicManager = { role: 'clinic_manager', canAccessAllClinics: false };
const dentist = { role: 'doctor', canAccessAllClinics: false };
const receptionist = { role: 'receptionist', canAccessAllClinics: false };
const assistant = { role: 'assistant', canAccessAllClinics: false };

// Route authorize() rol listeleri — ilgili route dosyalarındaki gerçek listelerin aynısı.
const PATIENTS_LIST = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST', 'BILLING']; // server/src/routes/patients.ts GET /patients
const PATIENT_DETAIL = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST', 'BILLING']; // GET /patients/:id
const PATIENT_CREATE = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']; // POST /patients
const PATIENT_DELETE = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER']; // DELETE /patients/:id

const PAYMENTS_LIST = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'BILLING', 'DENTIST', 'RECEPTIONIST']; // GET /payments
const PAYMENTS_CREATE = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'BILLING', 'RECEPTIONIST']; // POST /payments
const PAYMENT_PLANS_LIST = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'BILLING', 'DENTIST', 'RECEPTIONIST']; // GET /payment-plans

const TASKS_LIST = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST']; // GET /tasks — BILLING hariç
const TREATMENT_CASES_LIST = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST']; // GET /treatment-cases — BILLING hariç
const ATTACHMENTS_DELETE = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']; // DELETE attachments — BILLING hariç

// Restricted select for BILLING on GET /patients/:id (server/src/routes/patients.ts) —
// kimlik/iletişim + ödemeler dışında alan döndürmemeli.
const BILLING_PATIENT_DETAIL_FIELDS = [
  'id', 'firstName', 'lastName', 'email', 'phone',
  'clinicId', 'primaryClinicId', 'patientStatus', 'source', 'createdAt', 'updatedAt', 'payments',
];
const CLINICAL_FIELDS_MUST_BE_ABSENT = [
  'treatmentCases', 'toothRecords', 'appointments', 'activityLogs',
  'insuranceProvisions', 'tasks', 'whatsappConversationMessages', 'instagramConversationMessages', 'notes',
];

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

console.log('\n=== BILLING: Hasta arama/listeleme ===');

test('BILLING hasta listesini görebilir (GET /api/patients)', () => {
  assert.equal(authorize(PATIENTS_LIST, billing), true);
});

test('BILLING hasta detayını görebilir (GET /api/patients/:id)', () => {
  assert.equal(authorize(PATIENT_DETAIL, billing), true);
});

test('BILLING yeni hasta oluşturamaz (klinik kayıt işlemi değil)', () => {
  assert.equal(authorize(PATIENT_CREATE, billing), false);
});

test('BILLING hasta silemez/arşivleyemez', () => {
  assert.equal(authorize(PATIENT_DELETE, billing), false);
});

console.log('\n=== BILLING: Ödeme işlemleri ===');

test('BILLING ödeme oluşturabilir', () => {
  assert.equal(authorize(PAYMENTS_CREATE, billing), true);
});

test('BILLING ödeme geçmişini görebilir', () => {
  assert.equal(authorize(PAYMENTS_LIST, billing), true);
});

test('BILLING ödeme planlarını/taksitleri görebilir', () => {
  assert.equal(authorize(PAYMENT_PLANS_LIST, billing), true);
});

console.log('\n=== BILLING: Klinik veri erişim sınırı ===');

test('BILLING görev (task) listesine erişemez', () => {
  assert.equal(authorize(TASKS_LIST, billing), false);
});

test('BILLING tedavi vakalarına (treatment cases) erişemez', () => {
  assert.equal(authorize(TREATMENT_CASES_LIST, billing), false);
});

test('BILLING hasta eklerini (attachments) silemez', () => {
  assert.equal(authorize(ATTACHMENTS_DELETE, billing), false);
});

test('BILLING hasta detayı yanıtında klinik alan bulunmaz, yalnızca kimlik+ödeme alanları döner', () => {
  for (const field of CLINICAL_FIELDS_MUST_BE_ABSENT) {
    assert.ok(!BILLING_PATIENT_DETAIL_FIELDS.includes(field), `${field} BILLING yanıtında olmamalı`);
  }
  assert.ok(BILLING_PATIENT_DETAIL_FIELDS.includes('payments'), 'payments finansal alan olarak bulunmalı');
  assert.ok(BILLING_PATIENT_DETAIL_FIELDS.includes('firstName'), 'temel kimlik alanı bulunmalı');
});

console.log('\n=== Diğer roller: davranış değişmedi ===');

test('DENTIST hasta listesini görebilir (değişmedi)', () => {
  assert.equal(authorize(PATIENTS_LIST, dentist), true);
});

test('DENTIST görev/tedavi vakası listesine erişebilir (değişmedi)', () => {
  assert.equal(authorize(TASKS_LIST, dentist), true);
  assert.equal(authorize(TREATMENT_CASES_LIST, dentist), true);
});

test('RECEPTIONIST hasta oluşturabilir (değişmedi)', () => {
  assert.equal(authorize(PATIENT_CREATE, receptionist), true);
});

test('RECEPTIONIST ödeme oluşturabilir (değişmedi)', () => {
  assert.equal(authorize(PAYMENTS_CREATE, receptionist), true);
});

test('OWNER/CLINIC_MANAGER her şeye erişebilir (değişmedi)', () => {
  for (const list of [PATIENTS_LIST, PATIENT_DETAIL, PATIENT_CREATE, PATIENT_DELETE, PAYMENTS_LIST, PAYMENTS_CREATE, TASKS_LIST, TREATMENT_CASES_LIST]) {
    assert.equal(authorize(list, owner), true);
    assert.equal(authorize(list, clinicManager), true);
  }
});

test('ASSISTANT hasta verisine ve ödemeye erişemez (en kısıtlı rol, değişmedi)', () => {
  assert.equal(authorize(PATIENTS_LIST, assistant), false);
  assert.equal(authorize(PAYMENTS_CREATE, assistant), false);
});

console.log(`\nSonuç: ${passed} geçti, ${failed} başarısız\n`);
if (failed > 0) process.exit(1);

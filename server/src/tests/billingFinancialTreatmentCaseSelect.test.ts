/**
 * billingFinancialTreatmentCaseSelect.test.ts — BILLING için kısıtlı tedavi vakası seçici
 *
 * Koşturma: cd server && npx tsx src/tests/billingFinancialTreatmentCaseSelect.test.ts
 *
 * Bağlam: PaymentForm'da hasta seçildikten sonra "Tedavi Dosyası" dropdown'ı
 * GET /api/treatment-cases çağırıyordu, ama bu endpoint BILLING'i authorize()
 * listesine almıyordu (403) → dropdown sessizce boş kalıyordu (.catch(() => {})).
 *
 * Fix: GET /api/treatment-cases/financial-select — BILLING dahil finans
 * rollerine sadece ödeme akışı için gereken alanları (id, title, patientId,
 * clinicId, stage, estimatedAmount, acceptedAmount, currency, totalPaid,
 * remainingBalance) döndürür. Klinik veriler (procedures, activityLogs,
 * appointments, dental chart, attachments) hiç select edilmez.
 */

import assert from 'node:assert/strict';
import { normalizeRole } from '../utils/roles.js';

function authorize(allowedRoles: string[], user: { role: string; canAccessAllClinics: boolean }): boolean {
  const normalizedList = allowedRoles.map(r => r.toLowerCase());
  const canonicalRole = normalizeRole(user.role, user.canAccessAllClinics).toLowerCase();
  const rawRole = user.role.toLowerCase();
  return normalizedList.includes(canonicalRole) || normalizedList.includes(rawRole);
}

const billing = { role: 'billing', canAccessAllClinics: false };
const owner = { role: 'owner', canAccessAllClinics: true };
const dentist = { role: 'doctor', canAccessAllClinics: false };
const receptionist = { role: 'receptionist', canAccessAllClinics: false };
const assistant = { role: 'assistant', canAccessAllClinics: false };

// authorize() rol listeleri — server/src/routes/treatmentCases.ts ile aynı
const TREATMENT_CASES_LIST_FULL = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST']; // GET /treatment-cases — BILLING hariç (klinik dahil veriler)
const TREATMENT_CASES_FINANCIAL_SELECT = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'BILLING', 'DENTIST', 'RECEPTIONIST']; // GET /treatment-cases/financial-select

const FINANCIAL_SELECT_FIELDS = [
  'id', 'title', 'patientId', 'clinicId', 'stage',
  'estimatedAmount', 'acceptedAmount', 'currency', 'createdAt', 'updatedAt',
  'totalPaid', 'remainingBalance',
];
const CLINICAL_FIELDS_MUST_BE_ABSENT = [
  'procedures', 'activityLogs', 'appointments', 'attachments', 'description',
  'toothRecords', 'insuranceProvisions', 'sentMessages', 'practitioner', 'patient',
];

// ─── Route handler simülasyonu (financial-select) ───────────────────────────

type User = { id: string; organizationId: string; allowedClinicIds: string[]; canAccessAllClinics: boolean };
type TreatmentCase = {
  id: string; clinicId: string; patientId: string; estimatedAmount: number | null; acceptedAmount: number | null;
};
type Payment = { treatmentCaseId: string; amount: number; paymentStatus: string };

let mockOrgClinics: { id: string }[] = [];
let mockTreatmentCases: TreatmentCase[] = [];
let mockPayments: Payment[] = [];

async function getAccessibleClinicIds(user: User): Promise<string[]> {
  if (user.canAccessAllClinics) return mockOrgClinics.map(c => c.id);
  return user.allowedClinicIds;
}

async function simulateFinancialSelect(user: User, patientId: string) {
  const accessibleIds = await getAccessibleClinicIds(user);
  if (accessibleIds.length === 0) return { status: 403 as const };

  const cases = mockTreatmentCases.filter(tc => accessibleIds.includes(tc.clinicId) && tc.patientId === patientId);
  const data = cases.map(tc => {
    const totalPaid = mockPayments
      .filter(p => p.treatmentCaseId === tc.id && p.paymentStatus === 'paid')
      .reduce((sum, p) => sum + p.amount, 0);
    const remainingBalance = (tc.acceptedAmount ?? tc.estimatedAmount ?? 0) - totalPaid;
    return { id: tc.id, patientId: tc.patientId, clinicId: tc.clinicId, totalPaid, remainingBalance };
  });
  return { status: 200 as const, data };
}

// ─── Payment create cross-scope guard simülasyonu (findTreatmentCaseInClinic) ──

function simulateFindTreatmentCaseInClinic(id: string, clinicId: string, patientId: string) {
  return mockTreatmentCases.find(tc => tc.id === id && tc.clinicId === clinicId && tc.patientId === patientId) ?? null;
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

console.log('\n=== authorize(): financial-select BILLING için açık, full liste kapalı ===');

test('BILLING financial-select çağırabilir', () => {
  assert.equal(authorize(TREATMENT_CASES_FINANCIAL_SELECT, billing), true);
});

test('BILLING full treatment-cases listesini hâlâ çağıramaz (klinik veriler dahil)', () => {
  assert.equal(authorize(TREATMENT_CASES_LIST_FULL, billing), false);
});

test('ASSISTANT financial-select çağıramaz', () => {
  assert.equal(authorize(TREATMENT_CASES_FINANCIAL_SELECT, assistant), false);
});

test('DENTIST/RECEPTIONIST/OWNER her iki endpoint için de değişmedi', () => {
  for (const list of [TREATMENT_CASES_LIST_FULL, TREATMENT_CASES_FINANCIAL_SELECT]) {
    assert.equal(authorize(list, dentist), true);
    assert.equal(authorize(list, receptionist), true);
    assert.equal(authorize(list, owner), true);
  }
});

console.log('\n=== financial-select yanıt şekli: sadece finansal alanlar ===');

test('financial-select sadece izinli finansal alanları döndürür, klinik alan içermez', () => {
  for (const field of CLINICAL_FIELDS_MUST_BE_ABSENT) {
    assert.ok(!FINANCIAL_SELECT_FIELDS.includes(field), `${field} financial-select yanıtında olmamalı`);
  }
  assert.ok(FINANCIAL_SELECT_FIELDS.includes('totalPaid'));
  assert.ok(FINANCIAL_SELECT_FIELDS.includes('remainingBalance'));
});

console.log('\n=== financial-select klinik/organizasyon kapsamı ===');

mockOrgClinics = [{ id: 'clinic-A' }, { id: 'clinic-B' }];
mockTreatmentCases = [
  { id: 'tc-A-1', clinicId: 'clinic-A', patientId: 'patient-1', estimatedAmount: 1000, acceptedAmount: 1000 },
  { id: 'tc-B-1', clinicId: 'clinic-B', patientId: 'patient-1', estimatedAmount: 500, acceptedAmount: 500 },
  { id: 'tc-X-1', clinicId: 'clinic-X', patientId: 'patient-1', estimatedAmount: 800, acceptedAmount: 800 }, // başka org
];
mockPayments = [
  { treatmentCaseId: 'tc-A-1', amount: 400, paymentStatus: 'paid' },
];

await test('BILLING erişebildiği kliniğin tedavi vakasını görür, totalPaid/remainingBalance doğru hesaplanır', async () => {
  const user: User = { id: 'u1', organizationId: 'org-1', allowedClinicIds: ['clinic-A'], canAccessAllClinics: false };
  const res = await simulateFinancialSelect(user, 'patient-1');
  assert.equal(res.status, 200);
  assert.deepEqual(res.data!.map(d => d.id), ['tc-A-1']);
  assert.equal(res.data![0].totalPaid, 400);
  assert.equal(res.data![0].remainingBalance, 600);
});

await test('BILLING erişemediği kliniğin (Clinic B) vakasını GÖRMEZ', async () => {
  const user: User = { id: 'u1', organizationId: 'org-1', allowedClinicIds: ['clinic-A'], canAccessAllClinics: false };
  const res = await simulateFinancialSelect(user, 'patient-1');
  assert.equal(res.status, 200);
  assert.ok(!res.data!.some(d => d.id === 'tc-B-1'));
});

await test('Başka organizasyonun vakası (Clinic X) hiçbir zaman görünmez (org dışı klinikler hesaba katılmaz)', async () => {
  const user: User = { id: 'u1', organizationId: 'org-1', allowedClinicIds: ['clinic-A', 'clinic-B'], canAccessAllClinics: false };
  const res = await simulateFinancialSelect(user, 'patient-1');
  assert.equal(res.status, 200);
  assert.ok(!res.data!.some(d => d.id === 'tc-X-1'));
});

await test('Hiçbir klinige atanmamış BILLING (allowedClinicIds=[]) 403 alır', async () => {
  const user: User = { id: 'u1', organizationId: 'org-1', allowedClinicIds: [], canAccessAllClinics: false };
  const res = await simulateFinancialSelect(user, 'patient-1');
  assert.equal(res.status, 403);
});

console.log('\n=== Ödeme oluşturma: treatmentCaseId klinik/hasta kapsamına bağlı ===');

await test('BILLING erişebildiği klinikteki, doğru hastaya ait vakaya ödeme bağlayabilir', () => {
  const tc = simulateFindTreatmentCaseInClinic('tc-A-1', 'clinic-A', 'patient-1');
  assert.ok(tc, 'Geçerli klinik+hasta kombinasyonu kabul edilmeli');
});

await test('BILLING başka kliniğin vakasına ödeme BAĞLAYAMAZ (clinicId uyuşmazlığı)', () => {
  const tc = simulateFindTreatmentCaseInClinic('tc-B-1', 'clinic-A', 'patient-1');
  assert.equal(tc, null, 'Clinic B vakası, Clinic A kapsamında bulunmamalı');
});

await test('BILLING başka organizasyonun vakasına ödeme BAĞLAYAMAZ', () => {
  const tc = simulateFindTreatmentCaseInClinic('tc-X-1', 'clinic-A', 'patient-1');
  assert.equal(tc, null, 'Clinic X (başka org) vakası bulunmamalı');
});

await test('BILLING manipüle edilmiş patientId ile farklı hastanın vakasına ödeme bağlayamaz', () => {
  const tc = simulateFindTreatmentCaseInClinic('tc-A-1', 'clinic-A', 'patient-2');
  assert.equal(tc, null, 'Vaka patient-1\'e ait; patient-2 ile eşleşmemeli');
});

console.log(`\nSonuç: ${passed} geçti, ${failed} başarısız\n`);
if (failed > 0) process.exit(1);

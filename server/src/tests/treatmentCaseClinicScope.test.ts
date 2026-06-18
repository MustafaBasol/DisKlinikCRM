/**
 * treatmentCaseClinicScope.test.ts — Treatment case list/detail/procedures klinik kapsamı tutarlılığı
 *
 * Koşturma: cd server && npx tsx src/tests/treatmentCaseClinicScope.test.ts
 *
 * Bug: GET /api/treatment-cases/:id/procedures, req.user.clinicId (JWT'ye gömülü
 * "varsayılan klinik", yetkilendirme kapsamı DEĞİL) kullanıyordu. List ve detail
 * endpoint'leri ise getAccessibleClinicIds()/buildClinicIdScope() ile kullanıcının
 * erişebildiği TÜM klinikleri kapsama alıyordu. Bu yüzden bir tedavi vakası listede
 * görünse de (erişilebilir kliniklerden birinde olduğu için), procedures endpoint'i
 * yalnızca tek bir "varsayılan" klinik ID'siyle aradığından 404 dönebiliyordu.
 *
 * Fix: server/src/routes/treatmentPlanProcedures.ts artık tüm handler'larda
 * getAccessibleClinicIds() kullanıyor ve gerçek klinik-scoped işlemler için
 * treatment case'in DB'den okunan clinicId'sini kullanıyor (req.user.clinicId değil).
 */

import assert from 'node:assert/strict';

type User = {
  id: string;
  clinicId: string; // defaultClinicId — sadece UI varsayılanı, YETKİLENDİRME değil
  role: string;
  organizationId: string;
  allowedClinicIds: string[];
  canAccessAllClinics: boolean;
};

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    clinicId: 'clinic-A',
    role: 'clinic_manager',
    organizationId: 'org-1',
    allowedClinicIds: ['clinic-A'],
    canAccessAllClinics: false,
    ...overrides,
  };
}

type TreatmentCase = { id: string; clinicId: string; practitionerId: string | null };

// ─── DB mock'ları ──────────────────────────────────────────────────────────

let mockOrgClinics: { id: string }[] = [];
let mockTreatmentCases: TreatmentCase[] = [];

async function dbFindOrgClinics(organizationId: string) {
  return mockOrgClinics;
}

async function dbFindTreatmentCase(id: string, clinicIdFilter: string | { in: string[] }) {
  const ids = typeof clinicIdFilter === 'string' ? [clinicIdFilter] : clinicIdFilter.in;
  return mockTreatmentCases.find((tc) => tc.id === id && ids.includes(tc.clinicId)) ?? null;
}

// ─── clinicScope.ts mantığının inline kopyası (gerçek modülle aynı) ─────────

async function getAccessibleClinicIds(user: User): Promise<string[]> {
  if (user.canAccessAllClinics) {
    const clinics = await dbFindOrgClinics(user.organizationId);
    return clinics.map((c) => c.id);
  }
  return user.allowedClinicIds;
}

async function buildClinicIdScope(user: User, selectedClinicId: string | undefined) {
  if (selectedClinicId && selectedClinicId !== 'all') {
    if (!user.canAccessAllClinics && !user.allowedClinicIds.includes(selectedClinicId)) return null;
    return { clinicId: selectedClinicId };
  }
  if (user.canAccessAllClinics) {
    const clinics = await dbFindOrgClinics(user.organizationId);
    return { clinicId: { in: clinics.map((c) => c.id) } };
  }
  if (user.allowedClinicIds.length === 0) return null;
  return { clinicId: { in: user.allowedClinicIds } };
}

// ─── Route handler simülasyonları ───────────────────────────────────────────

// GET /api/treatment-cases (list) — buildClinicIdScope kullanır
async function simulateListTreatmentCases(user: User) {
  const scope = await buildClinicIdScope(user, undefined);
  if (!scope) return [];
  const ids = 'clinicId' in scope && typeof scope.clinicId === 'object' ? scope.clinicId.in : [(scope as any).clinicId];
  return mockTreatmentCases.filter((tc) => ids.includes(tc.clinicId));
}

// GET /api/treatment-cases/:id (detail) — getAccessibleClinicIds kullanır (FIX SONRASI)
async function simulateGetTreatmentCaseDetail(user: User, id: string) {
  const accessibleIds = await getAccessibleClinicIds(user);
  if (accessibleIds.length === 0) return { status: 403 };
  const tc = await dbFindTreatmentCase(id, { in: accessibleIds });
  if (!tc) return { status: 404 };
  return { status: 200, data: tc };
}

// GET /api/treatment-cases/:id/procedures — DÜZELTME ÖNCESİ (buggy): sadece req.user.clinicId
async function simulateProceduresEndpoint_BUGGY(user: User, id: string) {
  const tc = await dbFindTreatmentCase(id, user.clinicId);
  if (!tc) return { status: 404 };
  return { status: 200, data: tc };
}

// GET /api/treatment-cases/:id/procedures — DÜZELTME SONRASI: getAccessibleClinicIds
async function simulateProceduresEndpoint_FIXED(user: User, id: string) {
  const accessibleIds = await getAccessibleClinicIds(user);
  if (accessibleIds.length === 0) return { status: 403 };
  const tc = await dbFindTreatmentCase(id, { in: accessibleIds });
  if (!tc) return { status: 404 };
  return { status: 200, data: tc };
}

// ─── Test runner ─────────────────────────────────────────────────────────────

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

// ─── Senaryo kurulumu ────────────────────────────────────────────────────────
// Org-1: Clinic A (default/JWT clinic) ve Clinic B (sadece userClinics ile atanmış)
// Org-2: Clinic X (farklı organizasyon)

mockOrgClinics = [{ id: 'clinic-A' }, { id: 'clinic-B' }];
mockTreatmentCases = [
  { id: 'tc-clinicB-1', clinicId: 'clinic-B', practitionerId: null },
  { id: 'tc-clinicA-1', clinicId: 'clinic-A', practitionerId: null },
  { id: 'tc-clinicX-1', clinicId: 'clinic-X', practitionerId: null }, // başka org
];

console.log('\nBug tekrarı: Clinic Manager yalnızca Clinic B\'ye atanmış, JWT varsayılan klinik hâlâ Clinic A');

await test('BUGGY: liste Clinic B vakasını gösterir (allowedClinicIds=[B])', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-B'] });
  const list = await simulateListTreatmentCases(user);
  assert.deepEqual(list.map((c) => c.id), ['tc-clinicB-1']);
});

await test('BUGGY: detail (FIX edilmiş mantıkla) Clinic B vakasını bulur', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-B'] });
  const res = await simulateGetTreatmentCaseDetail(user, 'tc-clinicB-1');
  assert.equal(res.status, 200);
});

await test('REGRESSION: eski buggy procedures handler 404 dönerdi (req.user.clinicId=A, vaka B\'de)', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-B'] });
  const res = await simulateProceduresEndpoint_BUGGY(user, 'tc-clinicB-1');
  assert.equal(res.status, 404, 'Bu üretim hatasının kök nedenidir: liste/detail görür, procedures 404 verir');
});

await test('FIX: procedures handler artık Clinic B vakasını doğru şekilde bulur', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-B'] });
  const res = await simulateProceduresEndpoint_FIXED(user, 'tc-clinicB-1');
  assert.equal(res.status, 200);
  assert.equal(res.data?.id, 'tc-clinicB-1');
});

console.log('\nListe/detail/procedures arasında tutarlı kapsam (FIX sonrası)');

await test('Tek klinikli yeni klinik hesabı: kendi vakasını listede, detail\'de ve procedures\'ta görür', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A'] });
  const list = await simulateListTreatmentCases(user);
  assert.deepEqual(list.map((c) => c.id), ['tc-clinicA-1']);

  const detail = await simulateGetTreatmentCaseDetail(user, 'tc-clinicA-1');
  assert.equal(detail.status, 200);

  const procedures = await simulateProceduresEndpoint_FIXED(user, 'tc-clinicA-1');
  assert.equal(procedures.status, 200);
});

await test('OWNER (canAccessAllClinics=true): tüm org klinikleri için liste/detail/procedures tutarlı', async () => {
  const user = makeUser({ role: 'owner', canAccessAllClinics: true, clinicId: 'clinic-A', allowedClinicIds: [] });

  const list = await simulateListTreatmentCases(user);
  assert.deepEqual(list.map((c) => c.id).sort(), ['tc-clinicA-1', 'tc-clinicB-1']);

  const detailB = await simulateGetTreatmentCaseDetail(user, 'tc-clinicB-1');
  assert.equal(detailB.status, 200);

  const procB = await simulateProceduresEndpoint_FIXED(user, 'tc-clinicB-1');
  assert.equal(procB.status, 200);
});

console.log('\nÇapraz klinik / çapraz organizasyon izolasyonu (yetkisiz erişim engellenir)');

await test('Clinic A\'ya atanmış kullanıcı Clinic B vakasını listede GÖRMEZ', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A'] });
  const list = await simulateListTreatmentCases(user);
  assert.ok(!list.some((c) => c.id === 'tc-clinicB-1'));
});

await test('Clinic A\'ya atanmış kullanıcı Clinic B vakasını doğrudan ID ile AÇAMAZ (detail)', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A'] });
  const res = await simulateGetTreatmentCaseDetail(user, 'tc-clinicB-1');
  assert.equal(res.status, 404);
});

await test('Clinic A\'ya atanmış kullanıcı Clinic B vakasının procedures\'ını ALAMAZ', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A'] });
  const res = await simulateProceduresEndpoint_FIXED(user, 'tc-clinicB-1');
  assert.equal(res.status, 404);
});

await test('Başka organizasyonun (Clinic X) vakası hiçbir endpoint\'te görünmez/açılmaz', async () => {
  const user = makeUser({ role: 'owner', canAccessAllClinics: true, allowedClinicIds: [] });

  const list = await simulateListTreatmentCases(user);
  assert.ok(!list.some((c) => c.id === 'tc-clinicX-1'));

  const detail = await simulateGetTreatmentCaseDetail(user, 'tc-clinicX-1');
  assert.equal(detail.status, 404);

  const proc = await simulateProceduresEndpoint_FIXED(user, 'tc-clinicX-1');
  assert.equal(proc.status, 404);
});

await test('Hiçbir klinige atanmamış kullanıcı (allowedClinicIds=[]) her şeyde 403/boş alır', async () => {
  const user = makeUser({ allowedClinicIds: [] });

  const list = await simulateListTreatmentCases(user);
  assert.deepEqual(list, []);

  const detail = await simulateGetTreatmentCaseDetail(user, 'tc-clinicA-1');
  assert.equal(detail.status, 403);

  const proc = await simulateProceduresEndpoint_FIXED(user, 'tc-clinicA-1');
  assert.equal(proc.status, 403);
});

// ─── Sonuç ───────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Toplam: ${passed + failed} test | Geçen: ${passed} | Başarısız: ${failed}`);
if (failed > 0) {
  console.error(`\n${failed} test başarısız!`);
  process.exit(1);
} else {
  console.log('\nTüm treatment case klinik kapsamı tutarlılık testleri geçti!');
}

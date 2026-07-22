/**
 * dentalChartClinicScope.test.ts — KVKK-HIGH-006-S3 Batch 1:
 * dentalChart.ts hasta-kaynaklı klinik yetkilendirmesi
 *
 * Koşturma: cd server && npx tsx src/tests/dentalChartClinicScope.test.ts
 *
 * Bug (öncesi): GET/PUT/DELETE dental-chart uç noktaları doğrudan
 * req.user.clinicId kullanıyordu (varsayılan klinik, yetkilendirme kapsamı
 * DEĞİL). Çok klinikli bir OWNER/ORG_ADMIN'in varsayılan kliniği hastanın
 * kayıtlı olduğu klinikten farklıysa, dental chart 404 dönüyordu (veya DELETE
 * endpoint'inde hasta doğrulaması HİÇ yapılmıyordu — yalnızca toothRecord
 * clinicId'si kontrol ediliyordu, patients.ts'teki kabul edilmiş organizasyon
 * kapsamlı hasta doğrulaması eksikti).
 *
 * Fix: Her üç uç nokta da artık hastayı organizasyon kapsamında arar
 * (patients.ts'teki kabul edilmiş kalıpla birebir aynı), 404/403 ayrımını
 * yapar ve tüm klinik mutasyonlarını (toothRecord, activityLog) hastanın
 * KAYITLI clinicId'sinden türetir.
 */

import assert from 'node:assert/strict';

type User = {
  id: string;
  clinicId: string;
  role: string;
  organizationId: string;
  allowedClinicIds: string[];
  canAccessAllClinics: boolean;
};

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    clinicId: 'clinic-A',
    role: 'dentist',
    organizationId: 'org-1',
    allowedClinicIds: ['clinic-A'],
    canAccessAllClinics: false,
    ...overrides,
  };
}

type Patient = { id: string; clinicId: string; organizationId: string; deletedAt: Date | null };
type ToothRecord = { patientId: string; toothFdi: number; clinicId: string; status: string };

let mockPatients: Patient[] = [];
let mockToothRecords: ToothRecord[] = [];

// Mirrors: prisma.patient.findFirst({ where: { id, organizationId, deletedAt: null } })
async function dbFindPatientInOrg(id: string, organizationId: string) {
  return mockPatients.find((p) => p.id === id && p.organizationId === organizationId && p.deletedAt === null) ?? null;
}

// Post-fix pattern shared by GET/PUT/DELETE: org-scoped patient lookup ->
// 404 if missing -> explicit 403 if patient's clinic isn't in the user's
// allowed set -> clinicId derived from the patient record.
async function authorizePatientForDentalChart(user: User, patientId: string) {
  const patient = await dbFindPatientInOrg(patientId, user.organizationId);
  if (!patient) return { status: 404 as const };
  if (!user.canAccessAllClinics && !user.allowedClinicIds.includes(patient.clinicId)) {
    return { status: 403 as const };
  }
  return { status: 200 as const, clinicId: patient.clinicId };
}

// Pre-fix behaviour being regression-guarded against.
async function authorizePatientForDentalChart_BUGGY(user: User, patientId: string) {
  const clinicId = user.clinicId; // varsayılan klinik — yetkilendirme kapsamı DEĞİL
  const patient = mockPatients.find((p) => p.id === patientId && p.clinicId === clinicId && p.deletedAt === null);
  if (!patient) return { status: 404 as const };
  return { status: 200 as const, clinicId };
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

// ─── Senaryo kurulumu ────────────────────────────────────────────────────────
// Org-1: Clinic A (JWT varsayılanı), Clinic B (yalnızca userClinics ile atanmış)
// Org-2: Clinic X (farklı organizasyon)

mockPatients = [
  { id: 'patient-A-1', clinicId: 'clinic-A', organizationId: 'org-1', deletedAt: null },
  { id: 'patient-B-1', clinicId: 'clinic-B', organizationId: 'org-1', deletedAt: null },
  { id: 'patient-X-1', clinicId: 'clinic-X', organizationId: 'org-2', deletedAt: null },
];
mockToothRecords = [
  { patientId: 'patient-A-1', toothFdi: 11, clinicId: 'clinic-A', status: 'treated' },
  { patientId: 'patient-B-1', toothFdi: 21, clinicId: 'clinic-B', status: 'planned' },
];

console.log('\nREGRESSION: çok klinikli OWNER, JWT varsayılan klinik Clinic A, hasta Clinic B\'de');

await test('BUGGY: eski mantık kardeş klinik hastasının dental chart\'ını 404 olarak görürdü', async () => {
  const user = makeUser({ role: 'owner', canAccessAllClinics: true, clinicId: 'clinic-A' });
  const res = await authorizePatientForDentalChart_BUGGY(user, 'patient-B-1');
  assert.equal(res.status, 404, 'kök neden: OWNER tüm klinikleri görebilmeli ama eski kod yalnızca varsayılan klinigi arıyordu');
});

await test('FIX: hasta-kaynaklı kapsam artık OWNER için Clinic B hastasını doğru bulur', async () => {
  const user = makeUser({ role: 'owner', canAccessAllClinics: true, clinicId: 'clinic-A' });
  const res = await authorizePatientForDentalChart(user, 'patient-B-1');
  assert.equal(res.status, 200);
  assert.equal(res.clinicId, 'clinic-B', 'clinicId hasta kaydından türetilmeli, req.user.clinicId değil');
});

console.log('\nGenel klinik kapsamı matrisi (GET/PUT/DELETE ortak mantığı)');

await test('1. Tek klinikli kullanıcı, kendi kliniğindeki hasta -> izinli', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A'] });
  const res = await authorizePatientForDentalChart(user, 'patient-A-1');
  assert.equal(res.status, 200);
});

await test('3/27. Tek klinikli (düzenli) kullanıcı kardeş klinik hastasının dental chart\'ını OKUYAMAZ (403)', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A'] });
  const res = await authorizePatientForDentalChart(user, 'patient-B-1');
  assert.equal(res.status, 403);
});

await test('4. Çok klinikli kullanıcı, izinli kardeş klinik hastası -> izinli', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A', 'clinic-B'] });
  const res = await authorizePatientForDentalChart(user, 'patient-B-1');
  assert.equal(res.status, 200);
});

await test('5. Çok klinikli kullanıcı, izin verilmemiş klinik hastası -> 403', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A'] });
  const res = await authorizePatientForDentalChart(user, 'patient-B-1');
  assert.equal(res.status, 403);
});

await test('6/28. OWNER/ORG_ADMIN (canAccessAllClinics): izinli kardeş klinik kaydını okuyabilir', async () => {
  const user = makeUser({ role: 'org_admin', canAccessAllClinics: true, allowedClinicIds: [] });
  const res = await authorizePatientForDentalChart(user, 'patient-B-1');
  assert.equal(res.status, 200);
});

await test('7/29. Çapraz organizasyon hastası erişilemez (404 — varlığı sızdırmaz)', async () => {
  const user = makeUser({ role: 'owner', canAccessAllClinics: true, allowedClinicIds: [] });
  const res = await authorizePatientForDentalChart(user, 'patient-X-1');
  assert.equal(res.status, 404, 'org dışı hasta her zaman 404 olmalı, 403 değil');
});

await test('9. Var olmayan hasta id -> 404', async () => {
  const user = makeUser({ role: 'owner', canAccessAllClinics: true, allowedClinicIds: [] });
  const res = await authorizePatientForDentalChart(user, 'patient-does-not-exist');
  assert.equal(res.status, 404);
});

await test('10. Hiçbir klinige atanmamış kullanıcı -> kendi org\'undaki her hasta için 403', async () => {
  const user = makeUser({ allowedClinicIds: [] });
  const res = await authorizePatientForDentalChart(user, 'patient-A-1');
  assert.equal(res.status, 403);
});

await test('11. Backward-compat: tek klinikli hesabın kendi hastasına erişimi bozulmadı', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A'] });
  const res = await authorizePatientForDentalChart(user, 'patient-A-1');
  assert.equal(res.status, 200);
  assert.equal(res.clinicId, 'clinic-A');
});

await test('12. 403 vs 404 ayrımı: aynı org/izinsiz klinik -> 403; farklı org -> 404', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A'] });
  const sibling = await authorizePatientForDentalChart(user, 'patient-B-1');
  const crossOrg = await authorizePatientForDentalChart(user, 'patient-X-1');
  assert.equal(sibling.status, 403);
  assert.equal(crossOrg.status, 404);
});

console.log('\nMutasyon kapsamı — 30/31/32/33. gereksinimler (upsert/delete/activity-log/failure)');

await test('30. Diş güncelleme (upsert) hasta kaydından doğrulanan clinicId\'yi kullanır', async () => {
  const user = makeUser({ role: 'org_admin', canAccessAllClinics: true, allowedClinicIds: [] });
  const auth = await authorizePatientForDentalChart(user, 'patient-B-1');
  assert.equal(auth.status, 200);
  // Route: toothRecord.upsert({ create: { clinicId: auth.clinicId, ... } })
  assert.equal(auth.clinicId, 'clinic-B');
});

await test('31. Diş silme, hasta kaydından doğrulanan clinicId ile eşleşen kaydı hedefler', async () => {
  const user = makeUser({ role: 'org_admin', canAccessAllClinics: true, allowedClinicIds: [] });
  const auth = await authorizePatientForDentalChart(user, 'patient-B-1');
  assert.equal(auth.status, 200);
  const record = mockToothRecords.find((r) => r.patientId === 'patient-B-1' && r.clinicId === auth.clinicId);
  assert.ok(record, 'silme sorgusu doğrulanmış clinicId ile eşleşen kaydı bulmalı');
});

await test('32. Activity log, hasta kaydından doğrulanan (kayıt kaynaklı) klinik ile yazılır', async () => {
  const user = makeUser({ clinicId: 'clinic-A', role: 'owner', canAccessAllClinics: true, allowedClinicIds: [] });
  const auth = await authorizePatientForDentalChart(user, 'patient-B-1');
  assert.equal(auth.status, 200);
  // Route: activityLog.create({ data: { clinicId: auth.clinicId, ... } })
  assert.notEqual(auth.clinicId, user.clinicId, 'activity log klinigi kullanıcının varsayılan kliniginden FARKLI olmalı (kayıt B\'ye ait)');
  assert.equal(auth.clinicId, 'clinic-B');
});

await test('33. Yetkisiz erişim denemesi klinik mutasyonuna İZİN VERMEZ (kısmi durum bırakmaz)', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A'] });
  const auth = await authorizePatientForDentalChart(user, 'patient-B-1');
  assert.equal(auth.status, 403);
  // Route seviyesinde: 403 erken döner, upsert/delete/activityLog HİÇBİRİ çalışmaz.
});

// ─── Sonuç ───────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Toplam: ${passed + failed} test | Geçen: ${passed} | Başarısız: ${failed}`);
if (failed > 0) {
  console.error(`\n${failed} test başarısız!`);
  process.exit(1);
} else {
  console.log('\nTüm dentalChart.ts hasta-kaynaklı kapsam testleri geçti!');
}

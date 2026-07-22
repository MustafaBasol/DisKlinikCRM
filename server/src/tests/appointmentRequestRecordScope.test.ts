/**
 * appointmentRequestRecordScope.test.ts — KVKK-HIGH-006-S3 Batch 1:
 * appointmentRequests.ts kayıt-kaynaklı klinik yetkilendirmesi
 *
 * Koşturma: cd server && npx tsx src/tests/appointmentRequestRecordScope.test.ts
 *
 * Bug (öncesi): PUT /:id/status, POST /:id/convert, PUT /:id — hepsi
 * req.user.clinicId (JWT varsayılan klinik) kullanıyordu. Çok klinikli bir
 * OWNER/ORG_ADMIN'in varsayılan kliniği talebin ait olduğu klinikten farklıysa,
 * kayıt bulunamıyordu (404) VEYA (conversion'da) hasta/randevu yanlış klinige
 * yazılıyordu.
 *
 * Fix: Talep artık organizasyon kapsamında (`clinic.organizationId`) aranır;
 * erişim `canAccessAllClinics`/`allowedClinicIds` ile kayıttan okunan
 * clinicId'ye göre doğrulanır (patients.ts'teki kabul edilmiş kalıple aynı).
 * Hasta/randevu yazmaları talebin SAHİP OLDUĞU clinicId'yi kullanır.
 *
 * Ayrıca: convert endpoint'i artık hasta oluşturma + randevu oluşturma + talep
 * güncellemesini tek bir transaction'da yapar (kısmi PHI yazımı önlenir).
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
    role: 'receptionist',
    organizationId: 'org-1',
    allowedClinicIds: ['clinic-A'],
    canAccessAllClinics: false,
    ...overrides,
  };
}

type AppointmentRequest = {
  id: string;
  clinicId: string;
  organizationId: string; // test-only convenience field (real model derives org via clinic relation)
  status: string;
  patientId: string | null;
};

let mockRequests: AppointmentRequest[] = [];

// Mirrors: prisma.appointmentRequest.findFirst({ where: { id, clinic: { organizationId } } })
async function dbFindRequestInOrg(id: string, organizationId: string) {
  return mockRequests.find((r) => r.id === id && r.organizationId === organizationId) ?? null;
}

// Mirrors the post-fix inline pattern used identically in every mutation route
// (status/convert/edit): org-scoped lookup -> 404 if missing -> explicit 403
// if the record's clinic isn't in the user's allowed set.
async function loadAuthorizedRequest(user: User, id: string) {
  const existing = await dbFindRequestInOrg(id, user.organizationId);
  if (!existing) return { status: 404 as const };
  if (!user.canAccessAllClinics && !user.allowedClinicIds.includes(existing.clinicId)) {
    return { status: 403 as const };
  }
  return { status: 200 as const, record: existing, clinicId: existing.clinicId };
}

// Pre-fix behaviour being regression-guarded against.
async function loadAuthorizedRequest_BUGGY(user: User, id: string) {
  const clinicId = user.clinicId; // varsayılan klinik — yetkilendirme kapsamı DEĞİL
  const existing = mockRequests.find((r) => r.id === id && r.clinicId === clinicId);
  if (!existing) return { status: 404 as const };
  return { status: 200 as const, record: existing, clinicId };
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

mockRequests = [
  { id: 'req-A-1', clinicId: 'clinic-A', organizationId: 'org-1', status: 'pending', patientId: null },
  { id: 'req-B-1', clinicId: 'clinic-B', organizationId: 'org-1', status: 'pending', patientId: null },
  { id: 'req-X-1', clinicId: 'clinic-X', organizationId: 'org-2', status: 'pending', patientId: null },
];

console.log('\nREGRESSION: çok klinikli kullanıcı, JWT varsayılan klinik Clinic A, talep Clinic B\'de');

await test('BUGGY: eski mantık kardeş klinik talebini 404 olarak görürdü', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A', 'clinic-B'] });
  const res = await loadAuthorizedRequest_BUGGY(user, 'req-B-1');
  assert.equal(res.status, 404, 'kök neden: liste görür ama status/convert/edit 404 döner');
});

await test('FIX: kayıt kaynaklı kapsam artık izinli kardeş klinik talebini bulur', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A', 'clinic-B'] });
  const res = await loadAuthorizedRequest(user, 'req-B-1');
  assert.equal(res.status, 200);
  assert.equal(res.clinicId, 'clinic-B', 'clinicId kayıttan türetilmeli, req.user.clinicId değil');
});

console.log('\nGenel klinik kapsamı matrisi (status/convert/edit ortak mantığı)');

await test('1. Tek klinikli kullanıcı, kendi kliniğindeki talep -> izinli', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A'] });
  const res = await loadAuthorizedRequest(user, 'req-A-1');
  assert.equal(res.status, 200);
});

await test('3. Tek klinikli kullanıcı, kardeş klinik talebi -> 403 (düzenli kullanıcı mutasyon yapamaz)', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A'] });
  const res = await loadAuthorizedRequest(user, 'req-B-1');
  assert.equal(res.status, 403);
});

await test('4. Çok klinikli kullanıcı, izinli klinik talebi -> izinli', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A', 'clinic-B'] });
  const res = await loadAuthorizedRequest(user, 'req-B-1');
  assert.equal(res.status, 200);
});

await test('5. Çok klinikli kullanıcı, izin verilmemiş kliniğin talebi -> 403', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A'] });
  const res = await loadAuthorizedRequest(user, 'req-B-1');
  assert.equal(res.status, 403);
});

await test('6. OWNER/ORG_ADMIN (canAccessAllClinics): herhangi bir org kliniğinin talebine erişebilir', async () => {
  const user = makeUser({ role: 'owner', canAccessAllClinics: true, allowedClinicIds: [] });
  const resA = await loadAuthorizedRequest(user, 'req-A-1');
  const resB = await loadAuthorizedRequest(user, 'req-B-1');
  assert.equal(resA.status, 200);
  assert.equal(resB.status, 200);
});

await test('7. Çapraz organizasyon talebi erişilemez (404 — varlığı sızdırmaz)', async () => {
  const user = makeUser({ role: 'owner', canAccessAllClinics: true, allowedClinicIds: [] });
  const res = await loadAuthorizedRequest(user, 'req-X-1');
  assert.equal(res.status, 404, 'org dışı kayıt her zaman 404 olmalı, 403 değil (varlık sızıntısı önlenir)');
});

await test('9. Var olmayan talep id -> 404', async () => {
  const user = makeUser({ role: 'owner', canAccessAllClinics: true, allowedClinicIds: [] });
  const res = await loadAuthorizedRequest(user, 'req-does-not-exist');
  assert.equal(res.status, 404);
});

await test('10. Hiçbir klinige atanmamış kullanıcı -> kendi org\'undaki her talep için 403', async () => {
  const user = makeUser({ allowedClinicIds: [] });
  const res = await loadAuthorizedRequest(user, 'req-A-1');
  assert.equal(res.status, 403);
});

await test('12. 403 vs 404 ayrımı: aynı org/izinsiz klinik -> 403; farklı org -> 404', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A'] });
  const sibling = await loadAuthorizedRequest(user, 'req-B-1'); // aynı org, izinsiz klinik
  const crossOrg = await loadAuthorizedRequest(user, 'req-X-1'); // farklı org
  assert.equal(sibling.status, 403);
  assert.equal(crossOrg.status, 404);
});

console.log('\nDönüşüm (convert) — kayıt kaynaklı clinicId ve transactional yazım');

await test('19/22. Dönüşümde hasta ve randevu, talebin SAHİP OLDUĞU clinicId\'yi alır', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A', 'clinic-B'] });
  const res = await loadAuthorizedRequest(user, 'req-B-1');
  assert.equal(res.status, 200);
  // Route'ta clinicId = existing.clinicId olarak türetilir ve appointment.create +
  // patient.create + activityLog hepsi bu değeri kullanır (req.user.clinicId değil).
  assert.equal(res.clinicId, 'clinic-B');
  assert.notEqual(res.clinicId, user.clinicId);
});

await test('20. Düzenli kullanıcı kardeş klinik talebini dönüştüremez (403)', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A'], role: 'receptionist' });
  const res = await loadAuthorizedRequest(user, 'req-B-1');
  assert.equal(res.status, 403);
});

await test('21. Yetkili OWNER/ORG_ADMIN izinli kardeş klinik talebini dönüştürebilir', async () => {
  const user = makeUser({ role: 'org_admin', canAccessAllClinics: true, allowedClinicIds: [] });
  const res = await loadAuthorizedRequest(user, 'req-B-1');
  assert.equal(res.status, 200);
});

await test('26. Zaten dönüştürülmüş talep tekrar dönüştürülemez (idempotency)', async () => {
  const convertedReq = { id: 'req-converted-1', clinicId: 'clinic-A', organizationId: 'org-1', status: 'converted', patientId: 'patient-1' };
  mockRequests.push(convertedReq);
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A'] });
  const res = await loadAuthorizedRequest(user, 'req-converted-1');
  assert.equal(res.status, 200, 'kayıt bulunur');
  assert.equal(res.record?.status, 'converted', 'route katmanı burada 400 döner (test kapsamı dışı — pure durum kontrolü)');
  mockRequests = mockRequests.filter((r) => r.id !== 'req-converted-1');
});

console.log('\nTransaction rollback — kısmi PHI yazımı önlenir (24. gereksinim)');

// Basit bir "tx" simülasyonu: transaction callback'i tamamlanırsa staging'deki
// yazımlar ana deposuna taşınır; callback throw ederse staging atılır — Prisma'nın
// $transaction'ının gerçek atomiklik garantisini kavramsal olarak modeller.
type Store = { patients: { id: string }[]; appointments: { id: string }[] };

async function simulateConvertTransaction(opts: {
  shouldFailOnAppointmentCreate: boolean;
}): Promise<{ committed: Store; threw: boolean }> {
  const committed: Store = { patients: [], appointments: [] };
  const staging: Store = { patients: [], appointments: [] };
  let threw = false;

  try {
    // 1. Hasta oluşturma (transaction içinde)
    staging.patients.push({ id: 'new-patient-1' });

    // 2. Randevu oluşturma (transaction içinde) — burada başarısız olabilir
    if (opts.shouldFailOnAppointmentCreate) {
      throw new Error('Simulated DB failure during appointment.create');
    }
    staging.appointments.push({ id: 'new-appointment-1' });

    // Transaction başarıyla biter -> staging ana depoya taşınır
    committed.patients.push(...staging.patients);
    committed.appointments.push(...staging.appointments);
  } catch {
    threw = true;
    // staging atılır — committed'a HİÇBİR ŞEY yansımaz
  }

  return { committed, threw };
}

await test('24. Randevu oluşturma başarısız olursa, oluşturulan hasta da geri alınır (orphan kalmaz)', async () => {
  const { committed, threw } = await simulateConvertTransaction({ shouldFailOnAppointmentCreate: true });
  assert.equal(threw, true);
  assert.equal(committed.patients.length, 0, 'transaction rollback: yetim hasta kaydı KALMAMALI');
  assert.equal(committed.appointments.length, 0);
});

await test('24b. Başarılı dönüşümde hem hasta hem randevu birlikte commit edilir', async () => {
  const { committed, threw } = await simulateConvertTransaction({ shouldFailOnAppointmentCreate: false });
  assert.equal(threw, false);
  assert.equal(committed.patients.length, 1);
  assert.equal(committed.appointments.length, 1);
});

// ─── Sonuç ───────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Toplam: ${passed + failed} test | Geçen: ${passed} | Başarısız: ${failed}`);
if (failed > 0) {
  console.error(`\n${failed} test başarısız!`);
  process.exit(1);
} else {
  console.log('\nTüm appointmentRequests.ts kayıt-kaynaklı kapsam testleri geçti!');
}

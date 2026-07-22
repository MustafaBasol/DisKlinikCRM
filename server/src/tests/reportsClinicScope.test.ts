/**
 * reportsClinicScope.test.ts — KVKK-HIGH-006-S3 Batch 1: reports.ts kapsam düzeltmesi
 *
 * Koşturma: cd server && npx tsx src/tests/reportsClinicScope.test.ts
 *
 * Kapsam:
 *   1. GET /reports/revenue — byPeriod ham SQL'i artık scope'taki TÜM klinik
 *      id'lerini kullanır (ANY($1::text[])); `all` seçiliyken req.user.clinicId'ye
 *      sessizce daraltılmaz (KVKK-HIGH-006-S3 fix, reports.ts satır ~71-89).
 *   2. GET /reports/no-show-analysis — artık validateAndGetClinicIdScope
 *      kullanır (öncesinde doğrudan req.user.clinicId; hiçbir seçici desteği
 *      yoktu, satır ~404-510).
 *
 * clinicIdsFromScope gerçek modülden import edilir (saf fonksiyon, DB'ye
 * bağımlı değil). buildClinicIdScope, mevcut testlerdeki (treatmentCaseClinicScope,
 * multiBranchAccess) kabul edilmiş inline-mock kalıbıyla simüle edilir — gerçek
 * sürüm prisma.clinic sorguları yapar.
 */

import assert from 'node:assert/strict';
import { clinicIdsFromScope } from '../utils/clinicScope.js';

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
    role: 'clinic_manager',
    organizationId: 'org-1',
    allowedClinicIds: ['clinic-A'],
    canAccessAllClinics: false,
    ...overrides,
  };
}

let mockOrgClinics: { id: string; organizationId: string }[] = [];

async function dbFindClinic(id: string, organizationId: string) {
  return mockOrgClinics.find((c) => c.id === id && c.organizationId === organizationId) ?? null;
}

async function dbFindOrgClinics(organizationId: string) {
  return mockOrgClinics.filter((c) => c.organizationId === organizationId);
}

// Inline mirror of buildClinicIdScope (server/src/utils/clinicScope.ts) —
// identical branching to the real (DB-backed) implementation.
async function buildClinicIdScope(user: User, selectedClinicId: string | undefined) {
  const orgId = user.organizationId;
  if (selectedClinicId && selectedClinicId !== 'all') {
    const clinic = await dbFindClinic(selectedClinicId, orgId);
    if (!clinic) return null;
    if (!user.canAccessAllClinics && !user.allowedClinicIds.includes(selectedClinicId)) return null;
    return { clinicId: selectedClinicId };
  }
  if (user.canAccessAllClinics) {
    const clinics = await dbFindOrgClinics(orgId);
    return { clinicId: { in: clinics.map((c) => c.id) } };
  }
  if (user.allowedClinicIds.length === 0) return null;
  return { clinicId: { in: user.allowedClinicIds } };
}

// Simulates reports.ts's post-fix pattern: scope resolved once, then
// clinicIdsFromScope() feeds BOTH the Prisma `where` and the raw-SQL array param.
async function simulateReportEndpoint(user: User, selectedClinicId: string | undefined) {
  const scope = await buildClinicIdScope(user, selectedClinicId);
  if (!scope) return { status: 403 as const };
  const scopedClinicIds = clinicIdsFromScope(scope as any);
  return { status: 200 as const, scope, scopedClinicIds };
}

// Pre-fix behaviour being regression-guarded against: raw SQL fell back to
// req.user.clinicId whenever the Prisma scope had no single clinicId (i.e.
// org-wide `all` scope) — silently narrowing the "by period" breakdown to
// the user's own default clinic while summary/byMethod/byPractitioner used
// the full org-wide scope.
function simulateRevenueByPeriod_BUGGY(user: User, scope: { clinicId: string } | { clinicId: { in: string[] } }) {
  const rawClinicId = ('clinicId' in scope && typeof (scope as any).clinicId === 'string')
    ? (scope as any).clinicId
    : user.clinicId;
  return [rawClinicId];
}

function simulateRevenueByPeriod_FIXED(scope: { clinicId: string } | { clinicId: { in: string[] } }) {
  return clinicIdsFromScope(scope as any);
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

mockOrgClinics = [
  { id: 'clinic-A', organizationId: 'org-1' },
  { id: 'clinic-B', organizationId: 'org-1' },
  { id: 'clinic-X', organizationId: 'org-2' }, // farklı organizasyon
];

console.log('\nclinicIdsFromScope — saf fonksiyon (gerçek modül)');

await test('single clinicId scope -> [clinicId]', () => {
  assert.deepEqual(clinicIdsFromScope({ clinicId: 'clinic-A' }), ['clinic-A']);
});

await test('multi clinicId scope -> in-array olduğu gibi döner', () => {
  assert.deepEqual(clinicIdsFromScope({ clinicId: { in: ['clinic-A', 'clinic-B'] } }), ['clinic-A', 'clinic-B']);
});

console.log('\nREGRESSION: revenue byPeriod ham SQL — `all` sessizce req.user.clinicId\'ye daralmamalı');

await test('BUGGY: OWNER `all` istediğinde byPeriod yalnızca user.clinicId (varsayılan klinik) kullanır', async () => {
  const user = makeUser({ role: 'owner', canAccessAllClinics: true, clinicId: 'clinic-A', allowedClinicIds: [] });
  const scope = await buildClinicIdScope(user, 'all');
  assert.ok(scope && 'clinicId' in scope && typeof scope.clinicId === 'object', 'org-wide scope beklenir (in-array)');
  const buggyIds = simulateRevenueByPeriod_BUGGY(user, scope as any);
  assert.deepEqual(buggyIds, ['clinic-A'], 'kök neden: Clinic B verisi ham SQL\'de KAYBOLUR');
});

await test('FIX: OWNER `all` istediğinde byPeriod scope\'taki TÜM klinikleri kullanır', async () => {
  const user = makeUser({ role: 'owner', canAccessAllClinics: true, clinicId: 'clinic-A', allowedClinicIds: [] });
  const scope = await buildClinicIdScope(user, 'all');
  const fixedIds = simulateRevenueByPeriod_FIXED(scope as any);
  assert.deepEqual(fixedIds.sort(), ['clinic-A', 'clinic-B']);
});

await test('FIX: Prisma toplamı (summary) ve ham SQL (byPeriod) aynı scope\'u paylaşır', async () => {
  const user = makeUser({ role: 'owner', canAccessAllClinics: true, clinicId: 'clinic-A', allowedClinicIds: [] });
  const scope = await buildClinicIdScope(user, 'all');
  const prismaWhereClinicIds = clinicIdsFromScope(scope as any); // Prisma'nın {in:[...]} olarak kullanacağı aynı liste
  const rawSqlClinicIds = simulateRevenueByPeriod_FIXED(scope as any);
  assert.deepEqual(prismaWhereClinicIds.sort(), rawSqlClinicIds.sort());
});

await test('FIX: tek klinik seçildiğinde (backward-compat) byPeriod yalnızca o klinigi kapsar', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A'] });
  const scope = await buildClinicIdScope(user, undefined); // seçici yok — geriye dönük uyumluluk
  const ids = simulateRevenueByPeriod_FIXED(scope as any);
  assert.deepEqual(ids, ['clinic-A']);
});

console.log('\nno-show-analysis — artık diğer rapor uç noktalarıyla aynı seçici semantiğini destekler');

await test('1. Tek klinikli kullanıcı, seçici yok -> kendi klinigi', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A'] });
  const res = await simulateReportEndpoint(user, undefined);
  assert.equal(res.status, 200);
  assert.deepEqual(res.scopedClinicIds, ['clinic-A']);
});

await test('2. Tek klinikli kullanıcı, kendi kliniğini açıkça seçer -> izinli', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A'] });
  const res = await simulateReportEndpoint(user, 'clinic-A');
  assert.equal(res.status, 200);
});

await test('3. Tek klinikli kullanıcı, kardeş klinik seçer -> 403', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A'] });
  const res = await simulateReportEndpoint(user, 'clinic-B');
  assert.equal(res.status, 403);
});

await test('4. Çok klinikli kullanıcı, izinli klinik seçer -> izinli', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A', 'clinic-B'] });
  const res = await simulateReportEndpoint(user, 'clinic-B');
  assert.equal(res.status, 200);
  assert.deepEqual(res.scopedClinicIds, ['clinic-B']);
});

await test('5. Çok klinikli kullanıcı, izinsiz klinik seçer -> 403', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A', 'clinic-B'] });
  const res = await simulateReportEndpoint(user, 'clinic-X'); // farklı org
  assert.equal(res.status, 403);
});

await test('6. OWNER/ORG_ADMIN: `all` -> organizasyon genelinde tüm klinikler', async () => {
  const user = makeUser({ role: 'owner', canAccessAllClinics: true, allowedClinicIds: [] });
  const res = await simulateReportEndpoint(user, 'all');
  assert.equal(res.status, 200);
  assert.deepEqual((res.scopedClinicIds ?? []).sort(), ['clinic-A', 'clinic-B']);
});

await test('7. Çapraz organizasyon klinik seçimi reddedilir', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A'] });
  const res = await simulateReportEndpoint(user, 'clinic-X');
  assert.equal(res.status, 403);
});

await test('8. Seçici eksik davranışı -> kullanıcının kendi kapsamına düşer (403 değil)', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A'] });
  const res = await simulateReportEndpoint(user, undefined);
  assert.equal(res.status, 200);
});

await test('9. Geçersiz (var olmayan) klinik seçimi -> 403', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A'] });
  const res = await simulateReportEndpoint(user, 'clinic-does-not-exist');
  assert.equal(res.status, 403);
});

await test('10. Hiçbir klinige atanmamış kullanıcı (allowedClinicIds=[]) -> 403', async () => {
  const user = makeUser({ allowedClinicIds: [] });
  const res = await simulateReportEndpoint(user, undefined);
  assert.equal(res.status, 403);
});

await test('11. Backward-compat: eski istemci (seçici göndermeyen) tek-klinik davranışı bozulmadı', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A'] });
  const res = await simulateReportEndpoint(user, undefined);
  assert.deepEqual(res.scopedClinicIds, ['clinic-A']);
});

console.log(`\n${'─'.repeat(50)}`);
console.log(`Toplam: ${passed + failed} test | Geçen: ${passed} | Başarısız: ${failed}`);
if (failed > 0) {
  console.error(`\n${failed} test başarısız!`);
  process.exit(1);
} else {
  console.log('\nTüm reports.ts klinik kapsamı testleri geçti!');
}

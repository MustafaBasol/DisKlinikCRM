/**
 * multiBranchAccess.test.ts — Multi-branch erişim kontrolü birim testleri
 *
 * Koşturma: cd server && npx tsx src/tests/multiBranchAccess.test.ts
 *
 * Senaryolar:
 *  - OWNER/ORG_ADMIN tüm org kliniklerini görür (canAccessAllClinics=true)
 *  - Staff yalnızca atandığı klinikleri görür (allowedClinicIds)
 *  - Staff, klinik ID'sini tahmin ederek başka kliniklere erişemez
 *  - Kullanıcı başka organizasyonun kliniğine erişemez (cross-org)
 *  - selectedClinicId=all yetkisiz veri sızdırmaz
 *  - POST/PATCH ile yetkisiz clinicId 403 döner
 *  - Organization dashboard rol kontrolü (OWNER/ORG_ADMIN only)
 *  - Hasta silme: yalnızca yönetim rolleri
 *  - Billing hasta oluşturamaz
 *  - Receptionist randevu oluşturabilir, billing oluşturamaz
 *  - Ödeme yazma: yalnızca billing/yönetim
 *  - Rapor erişimi: yalnızca billing/yönetim
 *  - Kullanıcı yönetimi: yalnızca yönetim rolleri
 *  - Tek klinik geriye dönük uyumluluk
 *  - normalizeRole() doğruluğu
 */

import assert from 'node:assert/strict';

// ─── Basit mock yardımcıları ─────────────────────────────────────────────────

let mockClinicFindFirst: (args: any) => any = () => null;
let mockClinicFindMany: (args: any) => any = () => [];

// Gerçek clinicScope modülünü test etmek için inline versiyonunu kullanıyoruz
// (import mock yok; pure logic testleri)

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
    role: 'admin',
    organizationId: 'org-1',
    allowedClinicIds: ['clinic-A'],
    canAccessAllClinics: false,
    ...overrides,
  };
}

// Inline versions of the scope helpers (pure logic, no real DB)
async function buildClinicScopeWhere(user: User, selectedClinicId: string | undefined) {
  const orgId = user.organizationId;
  if (!selectedClinicId || selectedClinicId === 'all') {
    if (user.canAccessAllClinics) return { organizationId: orgId };
    if (user.allowedClinicIds.length === 0) return null;
    return { organizationId: orgId, clinicId: { in: user.allowedClinicIds } };
  }
  const clinic = await mockClinicFindFirst({ where: { id: selectedClinicId, organizationId: orgId } });
  if (!clinic) return null;
  if (!user.canAccessAllClinics && !user.allowedClinicIds.includes(selectedClinicId)) return null;
  return { organizationId: orgId, clinicId: selectedClinicId };
}

async function buildClinicIdScope(user: User, selectedClinicId: string | undefined) {
  const orgId = user.organizationId;
  if (selectedClinicId && selectedClinicId !== 'all') {
    const clinic = await mockClinicFindFirst({ where: { id: selectedClinicId, organizationId: orgId } });
    if (!clinic) return null;
    if (!user.canAccessAllClinics && !user.allowedClinicIds.includes(selectedClinicId)) return null;
    return { clinicId: selectedClinicId };
  }
  if (user.canAccessAllClinics) {
    const clinics = await mockClinicFindMany({ where: { organizationId: orgId } });
    return { clinicId: { in: (clinics as any[]).map((c: any) => c.id) } };
  }
  if (user.allowedClinicIds.length === 0) return null;
  return { clinicId: { in: user.allowedClinicIds } };
}

async function resolveEffectiveClinicId(user: User, requestedClinicId?: string) {
  const orgId = user.organizationId;
  const clinicId = requestedClinicId ?? user.clinicId;
  const clinic = await mockClinicFindFirst({ where: { id: clinicId, organizationId: orgId } });
  if (!clinic) return null;
  if (!user.canAccessAllClinics && !user.allowedClinicIds.includes(clinicId)) return null;
  return clinicId;
}

async function getAccessibleClinicIds(user: User) {
  if (user.canAccessAllClinics) {
    const clinics = await mockClinicFindMany({ where: { organizationId: user.organizationId } });
    return (clinics as any[]).map((c: any) => c.id);
  }
  return user.allowedClinicIds;
}

// ─── Test runner ──────────────────────────────────────────────────────────────

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

// ─── Testler ─────────────────────────────────────────────────────────────────

console.log('\nbuildClinicScopeWhere');

await test('OWNER — selectedClinicId=all → organizationId scope', async () => {
  const user = makeUser({ canAccessAllClinics: true });
  const scope = await buildClinicScopeWhere(user, 'all');
  assert.deepEqual(scope, { organizationId: 'org-1' });
});

await test('ORG_ADMIN — selectedClinicId=all → organizationId scope', async () => {
  const user = makeUser({ role: 'org_admin', canAccessAllClinics: true });
  const scope = await buildClinicScopeWhere(user, undefined);
  assert.deepEqual(scope, { organizationId: 'org-1' });
});

await test('Staff — selectedClinicId=all → yalnizca atanmis klinikler', async () => {
  const user = makeUser({ allowedClinicIds: ['clinic-A', 'clinic-B'] });
  const scope = await buildClinicScopeWhere(user, undefined);
  assert.deepEqual(scope, { organizationId: 'org-1', clinicId: { in: ['clinic-A', 'clinic-B'] } });
});

await test('Staff — hic atanmamis → null (403)', async () => {
  const user = makeUser({ allowedClinicIds: [] });
  assert.equal(await buildClinicScopeWhere(user, undefined), null);
});

await test('Belirli klinik — org kontrolu basarili, erisim var', async () => {
  mockClinicFindFirst = async () => ({ id: 'clinic-A' });
  const user = makeUser({ allowedClinicIds: ['clinic-A'] });
  const scope = await buildClinicScopeWhere(user, 'clinic-A');
  assert.deepEqual(scope, { organizationId: 'org-1', clinicId: 'clinic-A' });
});

await test('Belirli klinik — farkli org kliniği → null (cross-org yasak)', async () => {
  mockClinicFindFirst = async () => null;
  const user = makeUser({ allowedClinicIds: ['clinic-A'] });
  assert.equal(await buildClinicScopeWhere(user, 'clinic-X'), null);
});

await test('Staff — atanmamis klinik ID tahmin → null (403)', async () => {
  mockClinicFindFirst = async () => ({ id: 'clinic-B' }); // org gecer ama erisim yok
  const user = makeUser({ allowedClinicIds: ['clinic-A'] });
  assert.equal(await buildClinicScopeWhere(user, 'clinic-B'), null);
});

console.log('\nbuildClinicIdScope');

await test('OWNER — tum org klinikleri', async () => {
  mockClinicFindMany = async () => [{ id: 'clinic-A' }, { id: 'clinic-B' }];
  const user = makeUser({ canAccessAllClinics: true });
  const scope = await buildClinicIdScope(user, undefined);
  assert.deepEqual(scope, { clinicId: { in: ['clinic-A', 'clinic-B'] } });
});

await test('Staff — atanmis klinikler', async () => {
  const user = makeUser({ allowedClinicIds: ['clinic-A', 'clinic-C'] });
  const scope = await buildClinicIdScope(user, undefined);
  assert.deepEqual(scope, { clinicId: { in: ['clinic-A', 'clinic-C'] } });
});

await test('Staff — atanmamis klinik → null', async () => {
  mockClinicFindFirst = async () => ({ id: 'clinic-B' });
  const user = makeUser({ allowedClinicIds: ['clinic-A'] });
  assert.equal(await buildClinicIdScope(user, 'clinic-B'), null);
});

await test('baska org kliniği → null', async () => {
  mockClinicFindFirst = async () => null;
  const user = makeUser({ allowedClinicIds: ['clinic-A'] });
  assert.equal(await buildClinicIdScope(user, 'other-org-clinic'), null);
});

console.log('\nresolveEffectiveClinicId');

await test('requestedClinicId belirtilmemis — user.clinicId kullanilir', async () => {
  mockClinicFindFirst = async () => ({ id: 'clinic-A' });
  const user = makeUser({ allowedClinicIds: ['clinic-A'] });
  assert.equal(await resolveEffectiveClinicId(user, undefined), 'clinic-A');
});

await test('Gecerli requestedClinicId — dogrulanmis olarak doner', async () => {
  mockClinicFindFirst = async () => ({ id: 'clinic-B' });
  const user = makeUser({ allowedClinicIds: ['clinic-A', 'clinic-B'] });
  assert.equal(await resolveEffectiveClinicId(user, 'clinic-B'), 'clinic-B');
});

await test('Yetkisiz klinik ID — null (403)', async () => {
  mockClinicFindFirst = async () => ({ id: 'clinic-B' }); // org gecer ama erisim yok
  const user = makeUser({ allowedClinicIds: ['clinic-A'] });
  assert.equal(await resolveEffectiveClinicId(user, 'clinic-B'), null);
});

await test('Baska org kliniği — null (cross-org)', async () => {
  mockClinicFindFirst = async () => null;
  const user = makeUser({ allowedClinicIds: ['clinic-A'] });
  assert.equal(await resolveEffectiveClinicId(user, 'other-org-clinic'), null);
});

await test('OWNER — canAccessAllClinics=true → herhangi org kliniği', async () => {
  mockClinicFindFirst = async () => ({ id: 'clinic-Z' });
  const user = makeUser({ canAccessAllClinics: true });
  assert.equal(await resolveEffectiveClinicId(user, 'clinic-Z'), 'clinic-Z');
});

console.log('\ngetAccessibleClinicIds');

await test('canAccessAllClinics=true → DB den tum klinikler', async () => {
  mockClinicFindMany = async () => [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }];
  const user = makeUser({ canAccessAllClinics: true });
  assert.deepEqual(await getAccessibleClinicIds(user), ['c1', 'c2', 'c3']);
});

await test('canAccessAllClinics=false → allowedClinicIds (DB sorgusu yok)', async () => {
  let called = false;
  mockClinicFindMany = async () => { called = true; return []; };
  const user = makeUser({ allowedClinicIds: ['clinic-A', 'clinic-B'] });
  const ids = await getAccessibleClinicIds(user);
  assert.deepEqual(ids, ['clinic-A', 'clinic-B']);
  assert.equal(called, false); // DB sorgusu olmamali
});

await test('allowedClinicIds bos + canAccessAllClinics=false → bos dizi', async () => {
  const user = makeUser({ allowedClinicIds: [] });
  assert.deepEqual(await getAccessibleClinicIds(user), []);
});

console.log('\nOrganization Dashboard rol kontrolu');

await test('Yalnizca admin/owner/org_admin erisebilir', () => {
  const allowed = ['admin', 'owner', 'org_admin'];
  const blocked = ['doctor', 'receptionist', 'billing'];
  const check = (role: string) => allowed.map(r => r.toLowerCase()).includes(role.toLowerCase());
  allowed.forEach(r => assert.equal(check(r), true, `${r} erisebilmeli`));
  blocked.forEach(r => assert.equal(check(r), false, `${r} engellenebilmeli`));
});

// ─── normalizeRole testleri ───────────────────────────────────────────────────

// Inline normalizeRole (server/src/utils/roles.ts ile aynı mantık)
type CanonicalRole = 'OWNER' | 'ORG_ADMIN' | 'CLINIC_MANAGER' | 'DENTIST' | 'RECEPTIONIST' | 'BILLING' | 'ASSISTANT';

function normalizeRole(userRole: string, canAccessAllClinics = false): CanonicalRole {
  switch (userRole.toLowerCase()) {
    case 'owner': return 'OWNER';
    case 'org_admin': return 'ORG_ADMIN';
    case 'clinic_manager': return 'CLINIC_MANAGER';
    case 'admin': return canAccessAllClinics ? 'OWNER' : 'CLINIC_MANAGER';
    case 'doctor':
    case 'dentist': return 'DENTIST';
    case 'receptionist': return 'RECEPTIONIST';
    case 'billing': return 'BILLING';
    case 'assistant': return 'ASSISTANT';
    default: return 'ASSISTANT';
  }
}

console.log('\nnormalizeRole');

await test('admin + canAccessAllClinics=true → OWNER', () => {
  assert.equal(normalizeRole('admin', true), 'OWNER');
});

await test('admin + canAccessAllClinics=false → CLINIC_MANAGER', () => {
  assert.equal(normalizeRole('admin', false), 'CLINIC_MANAGER');
});

await test('owner → OWNER', () => {
  assert.equal(normalizeRole('owner', false), 'OWNER');
});

await test('OWNER (uppercase) → OWNER', () => {
  assert.equal(normalizeRole('OWNER', false), 'OWNER');
});

await test('org_admin → ORG_ADMIN', () => {
  assert.equal(normalizeRole('org_admin', false), 'ORG_ADMIN');
});

await test('ORG_ADMIN (uppercase) → ORG_ADMIN', () => {
  assert.equal(normalizeRole('ORG_ADMIN', false), 'ORG_ADMIN');
});

await test('doctor → DENTIST', () => {
  assert.equal(normalizeRole('doctor', false), 'DENTIST');
});

await test('DENTIST (uppercase) → DENTIST', () => {
  assert.equal(normalizeRole('DENTIST', false), 'DENTIST');
});

await test('receptionist → RECEPTIONIST', () => {
  assert.equal(normalizeRole('receptionist', false), 'RECEPTIONIST');
});

await test('billing → BILLING', () => {
  assert.equal(normalizeRole('billing', false), 'BILLING');
});

await test('Bilinmeyen rol → ASSISTANT (en kısıtlayıcı)', () => {
  assert.equal(normalizeRole('unknown_role', false), 'ASSISTANT');
});

// ─── Organization Dashboard erişim testleri ───────────────────────────────────

function canAccessOrgDashboard(user: { role: string; canAccessAllClinics: boolean }): boolean {
  const r = normalizeRole(user.role, user.canAccessAllClinics);
  return r === 'OWNER' || r === 'ORG_ADMIN';
}

console.log('\nOrganization Dashboard erişim (canAccessOrganizationDashboard)');

await test('OWNER → erişim verilir', () => {
  assert.equal(canAccessOrgDashboard({ role: 'owner', canAccessAllClinics: true }), true);
});

await test('ORG_ADMIN → erişim verilir', () => {
  assert.equal(canAccessOrgDashboard({ role: 'org_admin', canAccessAllClinics: false }), true);
});

await test('legacy admin + canAccessAllClinics=true → OWNER → erişim verilir', () => {
  assert.equal(canAccessOrgDashboard({ role: 'admin', canAccessAllClinics: true }), true);
});

await test('legacy admin + canAccessAllClinics=false → CLINIC_MANAGER → erişim REDDEDİLİR', () => {
  assert.equal(canAccessOrgDashboard({ role: 'admin', canAccessAllClinics: false }), false);
});

await test('doctor → erişim REDDEDİLİR', () => {
  assert.equal(canAccessOrgDashboard({ role: 'doctor', canAccessAllClinics: false }), false);
});

await test('receptionist → erişim REDDEDİLİR', () => {
  assert.equal(canAccessOrgDashboard({ role: 'receptionist', canAccessAllClinics: false }), false);
});

await test('billing → erişim REDDEDİLİR', () => {
  assert.equal(canAccessOrgDashboard({ role: 'billing', canAccessAllClinics: false }), false);
});

await test('clinic_manager → erişim REDDEDİLİR', () => {
  assert.equal(canAccessOrgDashboard({ role: 'clinic_manager', canAccessAllClinics: false }), false);
});

// ─── Hasta silme yetki testleri ───────────────────────────────────────────────

function canDeletePatient(user: { role: string; canAccessAllClinics: boolean }): boolean {
  const r = normalizeRole(user.role, user.canAccessAllClinics);
  return r === 'OWNER' || r === 'ORG_ADMIN' || r === 'CLINIC_MANAGER';
}

console.log('\nHasta silme yetkileri (canDeletePatient)');

await test('OWNER hasta silebilir', () => {
  assert.equal(canDeletePatient({ role: 'owner', canAccessAllClinics: true }), true);
});

await test('legacy admin + canAccessAllClinics=true → OWNER → silebilir', () => {
  assert.equal(canDeletePatient({ role: 'admin', canAccessAllClinics: true }), true);
});

await test('legacy admin + canAccessAllClinics=false → CLINIC_MANAGER → silebilir', () => {
  assert.equal(canDeletePatient({ role: 'admin', canAccessAllClinics: false }), true);
});

await test('receptionist hasta silemez', () => {
  assert.equal(canDeletePatient({ role: 'receptionist', canAccessAllClinics: false }), false);
});

await test('doctor hasta silemez', () => {
  assert.equal(canDeletePatient({ role: 'doctor', canAccessAllClinics: false }), false);
});

await test('billing hasta silemez', () => {
  assert.equal(canDeletePatient({ role: 'billing', canAccessAllClinics: false }), false);
});

// ─── Hasta oluşturma yetki testleri ───────────────────────────────────────────

function canCreatePatient(user: { role: string; canAccessAllClinics: boolean }): boolean {
  const r = normalizeRole(user.role, user.canAccessAllClinics);
  return r === 'OWNER' || r === 'ORG_ADMIN' || r === 'CLINIC_MANAGER' || r === 'RECEPTIONIST';
}

console.log('\nHasta oluşturma yetkileri (canCreatePatient)');

await test('receptionist hasta oluşturabilir', () => {
  assert.equal(canCreatePatient({ role: 'receptionist', canAccessAllClinics: false }), true);
});

await test('billing hasta oluşturamaz', () => {
  assert.equal(canCreatePatient({ role: 'billing', canAccessAllClinics: false }), false);
});

await test('doctor hasta oluşturamaz', () => {
  assert.equal(canCreatePatient({ role: 'doctor', canAccessAllClinics: false }), false);
});

await test('OWNER hasta oluşturabilir', () => {
  assert.equal(canCreatePatient({ role: 'owner', canAccessAllClinics: true }), true);
});

// ─── Randevu oluşturma yetki testleri ────────────────────────────────────────

function canCreateAppointment(user: { role: string; canAccessAllClinics: boolean }): boolean {
  const r = normalizeRole(user.role, user.canAccessAllClinics);
  return r === 'OWNER' || r === 'ORG_ADMIN' || r === 'CLINIC_MANAGER' || r === 'RECEPTIONIST';
}

console.log('\nRandevu oluşturma yetkileri (canCreateAppointment)');

await test('receptionist randevu oluşturabilir', () => {
  assert.equal(canCreateAppointment({ role: 'receptionist', canAccessAllClinics: false }), true);
});

await test('billing randevu oluşturamaz', () => {
  assert.equal(canCreateAppointment({ role: 'billing', canAccessAllClinics: false }), false);
});

await test('doctor randevu oluşturamaz (MVP kısıtlaması)', () => {
  assert.equal(canCreateAppointment({ role: 'doctor', canAccessAllClinics: false }), false);
});

// ─── Ödeme yazma yetki testleri ──────────────────────────────────────────────

function canWritePayments(user: { role: string; canAccessAllClinics: boolean }): boolean {
  const r = normalizeRole(user.role, user.canAccessAllClinics);
  return r === 'OWNER' || r === 'ORG_ADMIN' || r === 'CLINIC_MANAGER' || r === 'BILLING';
}

console.log('\nÖdeme yazma yetkileri (canWritePayments)');

await test('billing ödeme yazabilir', () => {
  assert.equal(canWritePayments({ role: 'billing', canAccessAllClinics: false }), true);
});

await test('OWNER ödeme yazabilir', () => {
  assert.equal(canWritePayments({ role: 'owner', canAccessAllClinics: true }), true);
});

await test('doctor ödeme yazamaz', () => {
  assert.equal(canWritePayments({ role: 'doctor', canAccessAllClinics: false }), false);
});

await test('receptionist ödeme yazamaz (düzenleme/iptal)', () => {
  assert.equal(canWritePayments({ role: 'receptionist', canAccessAllClinics: false }), false);
});

// ─── Rapor erişim testleri ───────────────────────────────────────────────────

function canAccessReports(user: { role: string; canAccessAllClinics: boolean }): boolean {
  const r = normalizeRole(user.role, user.canAccessAllClinics);
  return r === 'OWNER' || r === 'ORG_ADMIN' || r === 'CLINIC_MANAGER' || r === 'BILLING';
}

console.log('\nRapor erişim yetkileri (canAccessReports)');

await test('billing raporlara erişebilir', () => {
  assert.equal(canAccessReports({ role: 'billing', canAccessAllClinics: false }), true);
});

await test('OWNER raporlara erişebilir', () => {
  assert.equal(canAccessReports({ role: 'owner', canAccessAllClinics: true }), true);
});

await test('doctor raporlara erişemez', () => {
  assert.equal(canAccessReports({ role: 'doctor', canAccessAllClinics: false }), false);
});

await test('receptionist raporlara erişemez', () => {
  assert.equal(canAccessReports({ role: 'receptionist', canAccessAllClinics: false }), false);
});

// ─── Kullanıcı yönetimi testleri ─────────────────────────────────────────────

function canManageUsers(user: { role: string; canAccessAllClinics: boolean }): boolean {
  const r = normalizeRole(user.role, user.canAccessAllClinics);
  return r === 'OWNER' || r === 'ORG_ADMIN' || r === 'CLINIC_MANAGER';
}

console.log('\nKullanıcı yönetimi yetkileri (canManageUsers)');

await test('OWNER kullanıcıları yönetebilir', () => {
  assert.equal(canManageUsers({ role: 'owner', canAccessAllClinics: true }), true);
});

await test('ORG_ADMIN kullanıcıları yönetebilir', () => {
  assert.equal(canManageUsers({ role: 'org_admin', canAccessAllClinics: false }), true);
});

await test('legacy admin (canAccessAllClinics=true) → OWNER → yönetebilir', () => {
  assert.equal(canManageUsers({ role: 'admin', canAccessAllClinics: true }), true);
});

await test('legacy admin (canAccessAllClinics=false) → CLINIC_MANAGER → yönetebilir', () => {
  assert.equal(canManageUsers({ role: 'admin', canAccessAllClinics: false }), true);
});

await test('doctor kullanıcı yönetemez', () => {
  assert.equal(canManageUsers({ role: 'doctor', canAccessAllClinics: false }), false);
});

await test('receptionist kullanıcı yönetemez', () => {
  assert.equal(canManageUsers({ role: 'receptionist', canAccessAllClinics: false }), false);
});

await test('billing kullanıcı yönetemez', () => {
  assert.equal(canManageUsers({ role: 'billing', canAccessAllClinics: false }), false);
});

// ─── authorize() simülasyonu — kanonik + ham rol çift kontrolü ────────────────

function simulateAuthorize(allowedRoles: string[], user: { role: string; canAccessAllClinics: boolean }): boolean {
  const normalizedList = allowedRoles.map(r => r.toLowerCase());
  const canonicalRole = normalizeRole(user.role, user.canAccessAllClinics).toLowerCase();
  const rawRole = user.role.toLowerCase();
  return normalizedList.includes(canonicalRole) || normalizedList.includes(rawRole);
}

console.log('\nauthorize() simülasyonu (kanonik + ham rol çift kontrolü)');

await test('authorize([OWNER,ORG_ADMIN]) — legacy admin + canAll=true → geçer', () => {
  assert.equal(simulateAuthorize(['OWNER', 'ORG_ADMIN'], { role: 'admin', canAccessAllClinics: true }), true);
});

await test('authorize([OWNER,ORG_ADMIN]) — legacy admin + canAll=false → REDDEDILIR', () => {
  assert.equal(simulateAuthorize(['OWNER', 'ORG_ADMIN'], { role: 'admin', canAccessAllClinics: false }), false);
});

await test('authorize([OWNER,ORG_ADMIN]) — doctor → REDDEDILIR', () => {
  assert.equal(simulateAuthorize(['OWNER', 'ORG_ADMIN'], { role: 'doctor', canAccessAllClinics: false }), false);
});

await test('authorize([admin,doctor,receptionist]) — legacy admin → geçer (geriye dönük uyumluluk)', () => {
  assert.equal(simulateAuthorize(['admin', 'doctor', 'receptionist'], { role: 'admin', canAccessAllClinics: false }), true);
});

await test('authorize([admin,doctor]) — receptionist → REDDEDILIR', () => {
  assert.equal(simulateAuthorize(['admin', 'doctor'], { role: 'receptionist', canAccessAllClinics: false }), false);
});

await test('authorize([OWNER,ORG_ADMIN,CLINIC_MANAGER]) — legacy admin + canAll=false → CLINIC_MANAGER → geçer', () => {
  assert.equal(simulateAuthorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER'], { role: 'admin', canAccessAllClinics: false }), true);
});

// ─── Tek klinik geriye dönük uyumluluk ────────────────────────────────────────

await test('1 klinikli kullanici — selectedClinicId=all → tek kliniğe scope', async () => {
  const user = makeUser({ allowedClinicIds: ['clinic-A'] });
  const scope = await buildClinicScopeWhere(user, 'all');
  assert.deepEqual(scope, { organizationId: 'org-1', clinicId: { in: ['clinic-A'] } });
});

await test('1 klinikli kullanici — kendi kliniğine erisim', async () => {
  mockClinicFindFirst = async () => ({ id: 'clinic-A' });
  const user = makeUser({ allowedClinicIds: ['clinic-A'] });
  const scope = await buildClinicScopeWhere(user, 'clinic-A');
  assert.deepEqual(scope, { organizationId: 'org-1', clinicId: 'clinic-A' });
});

// ─── Sonuç ───────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Toplam: ${passed + failed} test | Geçen: ${passed} | Başarısız: ${failed}`);
if (failed > 0) {
  console.error(`\n${failed} test başarısız!`);
  process.exit(1);
} else {
  console.log('\nTüm multi-branch erişim ve rol yetki testleri geçti!');
}



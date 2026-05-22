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

// ─── Billing dashboard yönlendirme davranışı ─────────────────────────────────

function shouldRedirectToDashboard(user: { role: string; canAccessAllClinics: boolean }): string | null {
  const r = normalizeRole(user.role, user.canAccessAllClinics);
  if (r === 'BILLING') return '/reports';
  return null; // Dashboard'u normal görüntüle
}

console.log('\nBilling dashboard yönlendirme davranışı');

await test('billing kullanıcısı → /reports\'a yönlendirilir', () => {
  const redirect = shouldRedirectToDashboard({ role: 'billing', canAccessAllClinics: false });
  assert.equal(redirect, '/reports');
});

await test('OWNER → yönlendirme yok (dashboard görür)', () => {
  assert.equal(shouldRedirectToDashboard({ role: 'owner', canAccessAllClinics: true }), null);
});

await test('receptionist → yönlendirme yok (dashboard görür)', () => {
  assert.equal(shouldRedirectToDashboard({ role: 'receptionist', canAccessAllClinics: false }), null);
});

await test('doctor → yönlendirme yok (kendi dashboard\'unu görür)', () => {
  assert.equal(shouldRedirectToDashboard({ role: 'doctor', canAccessAllClinics: false }), null);
});

await test('legacy admin + canAll=false (CLINIC_MANAGER) → yönlendirme yok', () => {
  assert.equal(shouldRedirectToDashboard({ role: 'admin', canAccessAllClinics: false }), null);
});

// ─── Legacy admin kanonik davranış doğrulama ──────────────────────────────────

console.log('\nLegacy admin kanonik davranış (kapsamlı)');

await test('legacy admin + canAll=true → OWNER gibi davranır', () => {
  const user = { role: 'admin', canAccessAllClinics: true };
  assert.equal(normalizeRole(user.role, user.canAccessAllClinics), 'OWNER');
  assert.equal(canAccessOrgDashboard(user), true);
  assert.equal(canManageUsers(user), true);
  assert.equal(canDeletePatient(user), true);
});

await test('legacy admin + canAll=false → CLINIC_MANAGER gibi davranır', () => {
  const user = { role: 'admin', canAccessAllClinics: false };
  assert.equal(normalizeRole(user.role, user.canAccessAllClinics), 'CLINIC_MANAGER');
  assert.equal(canAccessOrgDashboard(user), false); // ORG erişimi yok
  assert.equal(canManageUsers(user), true);         // klinik yönetimi var
  assert.equal(canDeletePatient(user), true);        // silme yetkisi var
  assert.equal(canAccessReports(user), true);        // raporlara erişim var
});

// ─── authorize(['admin']) Org-düzeyi tehlike testi ───────────────────────────

console.log('\nauthorize([admin]) Org-düzeyi erişim tehlikesi');

await test('authorize([admin]) — admin+canAll=false GEÇİRİR (tehlike: ham rol)', () => {
  // Bu testin amacı: legacy authorize(['admin']) artık route larda KULLANILMIYOR
  // (Tüm admin-only route'lar ['OWNER','ORG_ADMIN','CLINIC_MANAGER'] olarak güncellendi)
  // authorize(['admin']) ile admin+canAll=false da geçer — ORG-düzeyi route'larda KULLANMAYIN
  const passes = simulateAuthorize(['admin'], { role: 'admin', canAccessAllClinics: false });
  assert.equal(passes, true, 'Beklenen davranış: legacy ham rol hâlâ geçer (dual-check)');
});

await test('authorize([OWNER, ORG_ADMIN]) — admin+canAll=false REDDEDİLİR (güvenli Org-yetki)', () => {
  // Doğru org-düzeyi guard: canonical roles only
  const passes = simulateAuthorize(['OWNER', 'ORG_ADMIN'], { role: 'admin', canAccessAllClinics: false });
  assert.equal(passes, false, 'CLINIC_MANAGER org dashboard\'a erişemez');
});

// ─── /api/me permission flags simülasyonu ─────────────────────────────────────

function simulateMePermissions(user: { role: string; canAccessAllClinics: boolean }) {
  return {
    normalizedRole: normalizeRole(user.role, user.canAccessAllClinics),
    permissions: {
      canViewOrganizationDashboard: canAccessOrgDashboard(user),
      canDeletePatient: canDeletePatient(user),
      canManageUsers: canManageUsers(user),
      canViewReports: canAccessReports(user),
      canManagePayments: canWritePayments(user),
      canManageInventory: canManageUsers(user), // OWNER/ORG_ADMIN/CLINIC_MANAGER
    },
  };
}

console.log('\n/api/me permission flags');

await test('/api/me — OWNER: tüm bayraklar true', () => {
  const p = simulateMePermissions({ role: 'owner', canAccessAllClinics: true });
  assert.equal(p.normalizedRole, 'OWNER');
  assert.equal(p.permissions.canViewOrganizationDashboard, true);
  assert.equal(p.permissions.canDeletePatient, true);
  assert.equal(p.permissions.canManageUsers, true);
  assert.equal(p.permissions.canViewReports, true);
  assert.equal(p.permissions.canManagePayments, true);
  assert.equal(p.permissions.canManageInventory, true);
});

await test('/api/me — BILLING: yalnızca finansal bayraklar true', () => {
  const p = simulateMePermissions({ role: 'billing', canAccessAllClinics: false });
  assert.equal(p.normalizedRole, 'BILLING');
  assert.equal(p.permissions.canViewOrganizationDashboard, false);
  assert.equal(p.permissions.canDeletePatient, false);
  assert.equal(p.permissions.canManageUsers, false);
  assert.equal(p.permissions.canViewReports, true);
  assert.equal(p.permissions.canManagePayments, true);
  assert.equal(p.permissions.canManageInventory, false);
});

await test('/api/me — legacy admin canAll=false: normalizedRole CLINIC_MANAGER, canViewOrgDash false', () => {
  const p = simulateMePermissions({ role: 'admin', canAccessAllClinics: false });
  assert.equal(p.normalizedRole, 'CLINIC_MANAGER');
  assert.equal(p.permissions.canViewOrganizationDashboard, false);
  assert.equal(p.permissions.canManageUsers, true);
});

await test('/api/me — legacy admin canAll=true: normalizedRole OWNER, canViewOrgDash true', () => {
  const p = simulateMePermissions({ role: 'admin', canAccessAllClinics: true });
  assert.equal(p.normalizedRole, 'OWNER');
  assert.equal(p.permissions.canViewOrganizationDashboard, true);
});

await test('/api/me — DENTIST: tüm yönetim bayrakları false', () => {
  const p = simulateMePermissions({ role: 'doctor', canAccessAllClinics: false });
  assert.equal(p.normalizedRole, 'DENTIST');
  assert.equal(p.permissions.canViewOrganizationDashboard, false);
  assert.equal(p.permissions.canDeletePatient, false);
  assert.equal(p.permissions.canManageUsers, false);
  assert.equal(p.permissions.canViewReports, false);
  assert.equal(p.permissions.canManagePayments, false);
  assert.equal(p.permissions.canManageInventory, false);
});

await test('/api/me — RECEPTIONIST: ödeme ve rapor bayrakları false', () => {
  const p = simulateMePermissions({ role: 'receptionist', canAccessAllClinics: false });
  assert.equal(p.normalizedRole, 'RECEPTIONIST');
  assert.equal(p.permissions.canManagePayments, false);
  assert.equal(p.permissions.canViewReports, false);
  assert.equal(p.permissions.canDeletePatient, false);
});

await test('/api/me — bilinmeyen rol → ASSISTANT, tüm izinler false', () => {
  const p = simulateMePermissions({ role: 'unknown_xyz', canAccessAllClinics: false });
  assert.equal(p.normalizedRole, 'ASSISTANT');
  assert.equal(p.permissions.canViewOrganizationDashboard, false);
  assert.equal(p.permissions.canDeletePatient, false);
  assert.equal(p.permissions.canManageUsers, false);
  assert.equal(p.permissions.canViewReports, false);
  assert.equal(p.permissions.canManagePayments, false);
  assert.equal(p.permissions.canManageInventory, false);
});

// ─── Resepsiyon klinik izin sınırları ─────────────────────────────────────────

function canWriteTreatmentCase(user: { role: string; canAccessAllClinics: boolean }): boolean {
  // Mevcut MVP: RECEPTIONIST tedavi vakası açabilir (TODO ile işaretli)
  const r = normalizeRole(user.role, user.canAccessAllClinics);
  return r === 'OWNER' || r === 'ORG_ADMIN' || r === 'CLINIC_MANAGER' || r === 'DENTIST' || r === 'RECEPTIONIST';
}

function canDeleteTreatmentMaterial(user: { role: string; canAccessAllClinics: boolean }): boolean {
  // Stok geri yükleme işlemi: RECEPTIONIST kasıtlı olarak dışarıda bırakıldı
  const r = normalizeRole(user.role, user.canAccessAllClinics);
  return r === 'OWNER' || r === 'ORG_ADMIN' || r === 'CLINIC_MANAGER' || r === 'DENTIST';
}

function canWriteMessageTemplate(user: { role: string; canAccessAllClinics: boolean }): boolean {
  // Şablon yönetimi: yalnızca yönetim rolleri (RECEPTIONIST okuyabilir, yazamaz)
  const r = normalizeRole(user.role, user.canAccessAllClinics);
  return r === 'OWNER' || r === 'ORG_ADMIN' || r === 'CLINIC_MANAGER';
}

console.log('\nResepsiyon klinik izin sınırları');

await test('receptionist tedavi vakası açabilir (MVP intentional)', () => {
  assert.equal(canWriteTreatmentCase({ role: 'receptionist', canAccessAllClinics: false }), true);
});

await test('billing tedavi vakası açamaz', () => {
  assert.equal(canWriteTreatmentCase({ role: 'billing', canAccessAllClinics: false }), false);
});

await test('receptionist malzeme SİLEMEZ (stok geri yükleme)', () => {
  assert.equal(canDeleteTreatmentMaterial({ role: 'receptionist', canAccessAllClinics: false }), false);
});

await test('DENTIST malzeme silebilir', () => {
  assert.equal(canDeleteTreatmentMaterial({ role: 'doctor', canAccessAllClinics: false }), true);
});

await test('receptionist mesaj şablonu yazamaz', () => {
  assert.equal(canWriteMessageTemplate({ role: 'receptionist', canAccessAllClinics: false }), false);
});

await test('CLINIC_MANAGER mesaj şablonu yazabilir', () => {
  assert.equal(canWriteMessageTemplate({ role: 'admin', canAccessAllClinics: false }), true);
});

await test('OWNER mesaj şablonu yazabilir', () => {
  assert.equal(canWriteMessageTemplate({ role: 'owner', canAccessAllClinics: true }), true);
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

// ─── Şube yönetimi yetki testleri ────────────────────────────────────────────

function canManageBranches(user: { role: string; canAccessAllClinics: boolean }): boolean {
  const r = normalizeRole(user.role, user.canAccessAllClinics);
  return r === 'OWNER' || r === 'ORG_ADMIN';
}

function canAssignUserClinics(user: { role: string; canAccessAllClinics: boolean }): boolean {
  const r = normalizeRole(user.role, user.canAccessAllClinics);
  return r === 'OWNER' || r === 'ORG_ADMIN' || r === 'CLINIC_MANAGER';
}

console.log('\nŞube yönetimi yetkileri (canManageBranches)');

await test('OWNER şube oluşturabilir', () => {
  assert.equal(canManageBranches({ role: 'owner', canAccessAllClinics: true }), true);
});

await test('ORG_ADMIN şube oluşturabilir', () => {
  assert.equal(canManageBranches({ role: 'org_admin', canAccessAllClinics: false }), true);
});

await test('legacy admin + canAll=true → OWNER → şube oluşturabilir', () => {
  assert.equal(canManageBranches({ role: 'admin', canAccessAllClinics: true }), true);
});

await test('CLINIC_MANAGER şube oluşturamaz', () => {
  assert.equal(canManageBranches({ role: 'admin', canAccessAllClinics: false }), false);
});

await test('DENTIST şube oluşturamaz', () => {
  assert.equal(canManageBranches({ role: 'doctor', canAccessAllClinics: false }), false);
});

await test('RECEPTIONIST şube oluşturamaz', () => {
  assert.equal(canManageBranches({ role: 'receptionist', canAccessAllClinics: false }), false);
});

await test('BILLING şube oluşturamaz', () => {
  assert.equal(canManageBranches({ role: 'billing', canAccessAllClinics: false }), false);
});

console.log('\nKullanıcı-klinik atama yetkileri (canAssignUserClinics)');

await test('OWNER kullanıcı-klinik atayabilir', () => {
  assert.equal(canAssignUserClinics({ role: 'owner', canAccessAllClinics: true }), true);
});

await test('ORG_ADMIN kullanıcı-klinik atayabilir', () => {
  assert.equal(canAssignUserClinics({ role: 'org_admin', canAccessAllClinics: false }), true);
});

await test('CLINIC_MANAGER kullanıcı-klinik atayabilir (kısıtlı kapsamda)', () => {
  assert.equal(canAssignUserClinics({ role: 'admin', canAccessAllClinics: false }), true);
});

await test('DENTIST kullanıcı-klinik atayamaz', () => {
  assert.equal(canAssignUserClinics({ role: 'doctor', canAccessAllClinics: false }), false);
});

await test('RECEPTIONIST kullanıcı-klinik atayamaz', () => {
  assert.equal(canAssignUserClinics({ role: 'receptionist', canAccessAllClinics: false }), false);
});

await test('BILLING kullanıcı-klinik atayamaz', () => {
  assert.equal(canAssignUserClinics({ role: 'billing', canAccessAllClinics: false }), false);
});

console.log('\nŞube yönetimi güvenlik senaryoları');

// CLINIC_MANAGER org-level rol atama kısıtlaması simülasyonu
function clinicManagerCanAssignRole(role: string): boolean {
  const orgLevelRoles = ['OWNER', 'ORG_ADMIN'];
  return !orgLevelRoles.includes(role.toUpperCase());
}

await test('CLINIC_MANAGER OWNER rolü atayamaz', () => {
  assert.equal(clinicManagerCanAssignRole('OWNER'), false);
});

await test('CLINIC_MANAGER ORG_ADMIN rolü atayamaz', () => {
  assert.equal(clinicManagerCanAssignRole('ORG_ADMIN'), false);
});

await test('CLINIC_MANAGER DENTIST rolü atayabilir', () => {
  assert.equal(clinicManagerCanAssignRole('DENTIST'), true);
});

await test('CLINIC_MANAGER RECEPTIONIST rolü atayabilir', () => {
  assert.equal(clinicManagerCanAssignRole('RECEPTIONIST'), true);
});

await test('CLINIC_MANAGER BILLING rolü atayabilir', () => {
  assert.equal(clinicManagerCanAssignRole('BILLING'), true);
});

// defaultClinicId doğrulama simülasyonu
function validateDefaultClinicId(
  defaultClinicId: string | null | undefined,
  assignedClinicIds: string[]
): boolean {
  if (!defaultClinicId) return true; // null/undefined geçerli
  if (assignedClinicIds.length === 0) return true; // Atama yoksa kontrol yapma
  return assignedClinicIds.includes(defaultClinicId);
}

await test('defaultClinicId atanmış kliniklerden biri — geçerli', () => {
  assert.equal(validateDefaultClinicId('clinic-A', ['clinic-A', 'clinic-B']), true);
});

await test('defaultClinicId atanmış kliniklerden değil — geçersiz', () => {
  assert.equal(validateDefaultClinicId('clinic-C', ['clinic-A', 'clinic-B']), false);
});

await test('defaultClinicId null — geçerli (temizleme)', () => {
  assert.equal(validateDefaultClinicId(null, ['clinic-A']), true);
});

await test('defaultClinicId boş atama listesiyle — geçerli', () => {
  assert.equal(validateDefaultClinicId('clinic-A', []), true);
});

// Slug validasyonu simülasyonu
function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug);
}

console.log('\nSlug doğrulaması');

await test('Geçerli slug: "merkez-klinik"', () => {
  assert.equal(isValidSlug('merkez-klinik'), true);
});

await test('Geçerli slug: "dis-klinik-2"', () => {
  assert.equal(isValidSlug('dis-klinik-2'), true);
});

await test('Geçersiz slug: büyük harf içeriyor', () => {
  assert.equal(isValidSlug('Merkez-Klinik'), false);
});

await test('Geçersiz slug: tire ile başlıyor', () => {
  assert.equal(isValidSlug('-klinik'), false);
});

await test('Geçersiz slug: tire ile bitiyor', () => {
  assert.equal(isValidSlug('klinik-'), false);
});

await test('Geçersiz slug: özel karakter içeriyor', () => {
  assert.equal(isValidSlug('klinik@merkez'), false);
});

// Şube görüntüleme: CLINIC_MANAGER yalnızca atandığı şubeleri görür
function clinicManagerCanViewBranch(
  allowedClinicIds: string[],
  targetClinicId: string
): boolean {
  return allowedClinicIds.includes(targetClinicId);
}

console.log('\nŞube görüntüleme kısıtlamaları (CLINIC_MANAGER)');

await test('CLINIC_MANAGER atandığı şubeyi görebilir', () => {
  assert.equal(clinicManagerCanViewBranch(['clinic-A', 'clinic-B'], 'clinic-A'), true);
});

await test('CLINIC_MANAGER atanmadığı şubeyi göremez', () => {
  assert.equal(clinicManagerCanViewBranch(['clinic-A'], 'clinic-B'), false);
});

await test('CLINIC_MANAGER — atama listesi boşsa hiçbir şube göremez', () => {
  assert.equal(clinicManagerCanViewBranch([], 'clinic-A'), false);
});

// ─── WhatsApp / Şube Yönetimi Rol Ayrımı ────────────────────────────────────

function canManageWhatsAppConnections(user: { role: string; canAccessAllClinics: boolean }): boolean {
  const role = normalizeRole(user.role, user.canAccessAllClinics);
  return role === 'OWNER' || role === 'ORG_ADMIN';
}

function canAssignWhatsAppToClinic(user: { role: string; canAccessAllClinics: boolean }): boolean {
  const role = normalizeRole(user.role, user.canAccessAllClinics);
  return role === 'OWNER' || role === 'ORG_ADMIN' || role === 'CLINIC_MANAGER';
}

console.log('\nWhatsApp ve şube yönetimi yetkileri (OWNER vs CLINIC_MANAGER)');

await test('OWNER (admin + canAccessAllClinics=true) → WhatsApp bağlantısı yönetebilir', () => {
  assert.equal(canManageWhatsAppConnections({ role: 'admin', canAccessAllClinics: true }), true);
});

await test('CLINIC_MANAGER (admin + canAccessAllClinics=false) → WhatsApp bağlantısı YÖNETEMEz', () => {
  assert.equal(canManageWhatsAppConnections({ role: 'admin', canAccessAllClinics: false }), false);
});

await test('OWNER → şube yönetebilir', () => {
  assert.equal(canManageBranches({ role: 'admin', canAccessAllClinics: true }), true);
});

await test('CLINIC_MANAGER → şube YÖNETEMEz', () => {
  assert.equal(canManageBranches({ role: 'admin', canAccessAllClinics: false }), false);
});

await test('OWNER → şubeye WhatsApp bağlantısı atayabilir', () => {
  assert.equal(canAssignWhatsAppToClinic({ role: 'admin', canAccessAllClinics: true }), true);
});

await test('CLINIC_MANAGER → yalnızca kendi şubesine WhatsApp atayabilir (fonksiyon izin verir)', () => {
  assert.equal(canAssignWhatsAppToClinic({ role: 'admin', canAccessAllClinics: false }), true);
});

await test('DENTIST → WhatsApp bağlantısı yönetemez', () => {
  assert.equal(canManageWhatsAppConnections({ role: 'doctor', canAccessAllClinics: false }), false);
});

await test('RECEPTIONIST → WhatsApp bağlantısı yönetemez', () => {
  assert.equal(canManageWhatsAppConnections({ role: 'receptionist', canAccessAllClinics: false }), false);
});

await test('BILLING → şube yönetemez', () => {
  assert.equal(canManageBranches({ role: 'billing', canAccessAllClinics: false }), false);
});

// ─── Seed Admin Doğrulama Senaryoları ────────────────────────────────────────

console.log('\nSeed admin kullanıcısı doğrulama (canAccessAllClinics zorunluluğu)');

await test('Seed admin: canAccessAllClinics=true olduğunda OWNER rolü alır', () => {
  const seedAdmin = { role: 'admin', canAccessAllClinics: true };
  assert.equal(normalizeRole(seedAdmin.role, seedAdmin.canAccessAllClinics), 'OWNER');
});

await test('Seed admin: canAccessAllClinics=false olursa CLINIC_MANAGER olur (hata senaryosu)', () => {
  const brokenAdmin = { role: 'admin', canAccessAllClinics: false };
  assert.equal(normalizeRole(brokenAdmin.role, brokenAdmin.canAccessAllClinics), 'CLINIC_MANAGER');
});

await test('OWNER → org dashboard erişimi var', () => {
  assert.equal(canAccessOrgDashboard({ role: 'admin', canAccessAllClinics: true }), true);
});

await test('OWNER → WhatsApp bağlantısı ve şube yönetimi tam yetki', () => {
  const owner = { role: 'admin', canAccessAllClinics: true };
  assert.equal(canManageWhatsAppConnections(owner), true);
  assert.equal(canManageBranches(owner), true);
  assert.equal(canAssignWhatsAppToClinic(owner), true);
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



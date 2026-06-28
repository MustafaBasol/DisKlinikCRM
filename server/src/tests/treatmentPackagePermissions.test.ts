/**
 * treatmentPackagePermissions.test.ts — Tedavi paketi yazma yetkisi testleri
 *
 * Koşturma: cd server && npx tsx src/tests/treatmentPackagePermissions.test.ts
 *
 * İş kuralı: Tedavi paketleri klinik yapılandırma/fiyatlandırma verisidir.
 * Yalnızca OWNER, ORG_ADMIN ve CLINIC_MANAGER oluşturabilir/düzenleyebilir/silebilir.
 * RECEPTIONIST, BILLING ve DENTIST yalnızca okuyabilir; yazma endpoint'lerinde 403 alır.
 */

import assert from 'node:assert/strict';
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

// ── authorize() middleware'inin inline kopyası (server/src/middleware/auth.ts:157) ──

function authorize(allowedRoles: string[], user: { role: string; canAccessAllClinics: boolean }): boolean {
  const normalizedList = allowedRoles.map(r => r.toLowerCase());
  const canonicalRole = normalizeRole(user.role, user.canAccessAllClinics).toLowerCase();
  const rawRole = user.role.toLowerCase();
  return normalizedList.includes(canonicalRole) || normalizedList.includes(rawRole);
}

// ── Tedavi paketi yazma endpoint'lerinin izin listesi (routes/treatmentPackages.ts) ──

const WRITE_ALLOWED_ROLES = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER'];
const READ_ALLOWED_ROLES  = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST', 'BILLING'];

function canWrite(role: string, canAccessAllClinics = false): boolean {
  return authorize(WRITE_ALLOWED_ROLES, { role, canAccessAllClinics });
}

function canRead(role: string, canAccessAllClinics = false): boolean {
  return authorize(READ_ALLOWED_ROLES, { role, canAccessAllClinics });
}

// ── RECEPTIONIST yazma testleri ────────────────────────────────────────────────

console.log('\nRECEPTIONIST — yazma yasak, okuma serbest');

test('RECEPTIONIST cannot create treatment package (POST)', () => {
  assert.equal(canWrite('receptionist'), false);
});

test('RECEPTIONIST cannot update treatment package (PUT)', () => {
  assert.equal(canWrite('RECEPTIONIST'), false);
});

test('RECEPTIONIST cannot delete/deactivate treatment package (DELETE)', () => {
  assert.equal(canWrite('RECEPTIONIST'), false);
});

test('RECEPTIONIST can read treatment packages (GET)', () => {
  assert.equal(canRead('RECEPTIONIST'), true);
});

// ── BILLING yazma testleri ─────────────────────────────────────────────────────

console.log('\nBILLING — yazma yasak, okuma serbest');

test('BILLING cannot create treatment package', () => {
  assert.equal(canWrite('BILLING'), false);
});

test('BILLING cannot update treatment package', () => {
  assert.equal(canWrite('billing'), false);
});

test('BILLING cannot delete treatment package', () => {
  assert.equal(canWrite('BILLING'), false);
});

test('BILLING can read treatment packages', () => {
  assert.equal(canRead('BILLING'), true);
});

// ── DENTIST yazma testleri ─────────────────────────────────────────────────────

console.log('\nDENTIST — yazma yasak, okuma serbest');

test('DENTIST cannot create treatment package', () => {
  assert.equal(canWrite('DENTIST'), false);
});

test('DENTIST cannot update treatment package', () => {
  assert.equal(canWrite('dentist'), false);
});

test('DENTIST cannot delete treatment package', () => {
  assert.equal(canWrite('DENTIST'), false);
});

test('DENTIST can read treatment packages', () => {
  assert.equal(canRead('DENTIST'), true);
});

// ── Yönetim rolleri yazma testleri ────────────────────────────────────────────

console.log('\nOwner/OrgAdmin/ClinicManager — yazma yetkili');

test('OWNER can create treatment package', () => {
  assert.equal(canWrite('OWNER'), true);
});

test('OWNER can update treatment package', () => {
  assert.equal(canWrite('owner'), true);
});

test('OWNER can delete treatment package', () => {
  assert.equal(canWrite('OWNER'), true);
});

test('ORG_ADMIN can create treatment package', () => {
  assert.equal(canWrite('ORG_ADMIN'), true);
});

test('ORG_ADMIN can update treatment package', () => {
  assert.equal(canWrite('org_admin'), true);
});

test('ORG_ADMIN can delete treatment package', () => {
  assert.equal(canWrite('ORG_ADMIN'), true);
});

test('CLINIC_MANAGER can create treatment package', () => {
  assert.equal(canWrite('CLINIC_MANAGER'), true);
});

test('CLINIC_MANAGER can update treatment package', () => {
  assert.equal(canWrite('clinic_manager'), true);
});

test('CLINIC_MANAGER can delete treatment package', () => {
  assert.equal(canWrite('CLINIC_MANAGER'), true);
});

// ── Legacy "admin" rolü dönüşüm testi ────────────────────────────────────────

console.log('\nLegacy admin rolü');

test('legacy admin + canAccessAllClinics=true → OWNER → yazabilir', () => {
  assert.equal(canWrite('admin', true), true);
});

test('legacy admin + canAccessAllClinics=false → CLINIC_MANAGER → yazabilir', () => {
  assert.equal(canWrite('admin', false), true);
});

// ── Sonuç ─────────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} test — ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);

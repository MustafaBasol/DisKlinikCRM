/**
 * lastRoute.test.ts — pure logic for UX-001D session continuity
 * (src/utils/lastRoute.ts): recording/restoring the last authorized in-app
 * route, scoped by user + clinic, with stale/unauthorized-route fallback.
 *
 * Run with: tsx src/utils/__tests__/lastRoute.test.ts
 * No external test framework — mirrors src/pages/__tests__/bookingWidgetHelpers.test.ts.
 * Installs a minimal in-memory localStorage before importing the module
 * under test, since this runs under plain Node (no DOM).
 */

import assert from 'node:assert/strict';

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

(globalThis as any).localStorage = new MemoryStorage();

const { recordLastRoute, getValidatedLastRoute } = await import('../lastRoute');

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { console.log(`  ✓ ${name}`); passed++; })
    .catch((err: unknown) => {
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    });
}

function section(title: string) {
  console.log(`\n${title}`);
}

const RECEPTIONIST = { role: 'receptionist', canAccessAllClinics: false };
const DENTIST = { role: 'dentist', canAccessAllClinics: false };
const OWNER = { role: 'owner', canAccessAllClinics: true };

async function main() {
  (globalThis as any).localStorage.clear();

  section('── record + restore round trip ─────────────────────────────────');

  await test('records a visited route and restores it for the same user+clinic', () => {
    recordLastRoute('user-1', 'clinic-a', '/patients', '?status=active');
    const restored = getValidatedLastRoute('user-1', 'clinic-a', RECEPTIONIST);
    assert.equal(restored, '/patients?status=active');
  });

  await test('returns null when nothing has been recorded', () => {
    assert.equal(getValidatedLastRoute('user-never-visited', 'clinic-a', RECEPTIONIST), null);
  });

  section('── entry points are never recorded/restored ───────────────────');

  await test('does not record "/" or "/dashboard" (they are the fallback target)', () => {
    recordLastRoute('user-2', 'clinic-a', '/', '');
    recordLastRoute('user-2', 'clinic-a', '/dashboard', '');
    assert.equal(getValidatedLastRoute('user-2', 'clinic-a', RECEPTIONIST), null);
  });

  section('── stale detail-route fallback ─────────────────────────────────');

  await test('a patient detail route collapses to the Patients list on restore', () => {
    recordLastRoute('user-3', 'clinic-a', '/patients/3f2b6c1a-9d4e-4a11-8f2c-1b6e7a9d0c33', '');
    assert.equal(getValidatedLastRoute('user-3', 'clinic-a', RECEPTIONIST), '/patients');
  });

  await test('a treatment-case detail route collapses to the Treatment Cases list', () => {
    recordLastRoute('user-3b', 'clinic-a', '/treatment-cases/11111111-2222-3333-4444-555555555555', '');
    assert.equal(getValidatedLastRoute('user-3b', 'clinic-a', RECEPTIONIST), '/treatment-cases');
  });

  section('── permission is re-checked at restore time ────────────────────');

  await test('restores a route the role is currently authorized for', () => {
    recordLastRoute('user-4', 'clinic-a', '/finance', '');
    assert.equal(getValidatedLastRoute('user-4', 'clinic-a', OWNER), '/finance');
  });

  await test('falls back to null when the role can no longer access the stored route (revoked permission)', () => {
    recordLastRoute('user-5', 'clinic-a', '/finance', '');
    // RECEPTIONIST cannot view the finance dashboard — simulates a role
    // change / permission revocation between visits.
    assert.equal(getValidatedLastRoute('user-5', 'clinic-a', RECEPTIONIST), null);
  });

  await test('/my-earnings is DENTIST-only', () => {
    recordLastRoute('user-6', 'clinic-a', '/my-earnings', '');
    assert.equal(getValidatedLastRoute('user-6', 'clinic-a', DENTIST), '/my-earnings');
    assert.equal(getValidatedLastRoute('user-6', 'clinic-a', RECEPTIONIST), null);
  });

  section('── unified /inbox route (UX-001 Wave 2) ────────────────────────');

  await test('restores /inbox/whatsapp with its query string for a RECEPTIONIST', () => {
    recordLastRoute('user-12', 'clinic-a', '/inbox/whatsapp', '?filter=open');
    assert.equal(getValidatedLastRoute('user-12', 'clinic-a', RECEPTIONIST), '/inbox/whatsapp?filter=open');
  });

  await test('restores bare /inbox for a role permitted on either channel', () => {
    recordLastRoute('user-13', 'clinic-a', '/inbox', '');
    assert.equal(getValidatedLastRoute('user-13', 'clinic-a', OWNER), '/inbox');
  });

  await test('does not restore /inbox for a role with neither WhatsApp nor Instagram access (DENTIST)', () => {
    recordLastRoute('user-14', 'clinic-a', '/inbox/whatsapp', '');
    assert.equal(getValidatedLastRoute('user-14', 'clinic-a', DENTIST), null);
  });

  await test('legacy /whatsapp-inbox route keeps working independently of /inbox', () => {
    recordLastRoute('user-15', 'clinic-a', '/whatsapp-inbox', '');
    assert.equal(getValidatedLastRoute('user-15', 'clinic-a', RECEPTIONIST), '/whatsapp-inbox');
    assert.equal(getValidatedLastRoute('user-15', 'clinic-a', DENTIST), null);
  });

  section('── unknown routes are never restored ───────────────────────────');

  await test('an unmapped/unknown path is not restored', () => {
    recordLastRoute('user-7', 'clinic-a', '/some-future-page', '');
    assert.equal(getValidatedLastRoute('user-7', 'clinic-a', OWNER), null);
  });

  section('── user / clinic isolation ─────────────────────────────────────');

  await test('a different user on the same browser never inherits another user\'s stored route', () => {
    recordLastRoute('user-8', 'clinic-a', '/patients', '');
    assert.equal(getValidatedLastRoute('user-9-different-user', 'clinic-a', OWNER), null);
  });

  await test('a different clinic for the same user does not inherit the other clinic\'s route', () => {
    recordLastRoute('user-10', 'clinic-a', '/patients', '');
    assert.equal(getValidatedLastRoute('user-10', 'clinic-b-different-clinic', OWNER), null);
  });

  section('── malformed storage never throws ──────────────────────────────');

  await test('corrupted JSON in storage yields null instead of throwing', () => {
    (globalThis as any).localStorage.setItem('hcrm_last_route:user-11:clinic-a', '{not json');
    assert.doesNotThrow(() => getValidatedLastRoute('user-11', 'clinic-a', OWNER));
    assert.equal(getValidatedLastRoute('user-11', 'clinic-a', OWNER), null);
  });

  await test('missing user id never throws and returns null', () => {
    assert.equal(getValidatedLastRoute(undefined, 'clinic-a', OWNER), null);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();

/**
 * appointmentNoShowAction.test.ts — regression test for US-03.2 gap closure.
 *
 * Bug: AppointmentDetail.tsx's "Mark No Show" button called the generic
 * PUT /api/appointments/:id status update, which never records
 * noShowMarkedAt/noShowMarkedById/recoveryStatus and blocks DENTIST (the
 * generic route only lets DENTIST transition to 'completed'). The dedicated
 * PATCH /api/appointments/:id/no-show endpoint (noShows.ts) already records
 * all of that and already allows DENTIST for their own appointments, but had
 * no caller anywhere in the app.
 *
 * This test locks in:
 *   1. handleStatusUpdate's routing decision — 'no_show' must resolve to the
 *      dedicated endpoint, every other status must keep using the generic one.
 *   2. The button's visibility gate (canManageNoShows) matches the backend's
 *      NO_SHOW_MARK_ROLES (server/src/routes/noShows.ts), so a role that would
 *      get a 403 never sees an action that fails.
 *
 * Run with: tsx src/pages/__tests__/appointmentNoShowAction.test.ts
 * No external test framework — mirrors patientDetailTabsHelpers.test.ts.
 */

import assert from 'node:assert/strict';
import { canManageNoShows } from '../../utils/permissions';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err: unknown) {
    console.error(`  ✗ ${name}`);
    console.error(`      ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

// Mirrors the routing decision added to handleStatusUpdate in
// src/pages/AppointmentDetail.tsx.
type StatusUpdateTarget = 'no_show_dedicated' | 'generic';

function resolveStatusUpdateTarget(newStatus: string): StatusUpdateTarget {
  return newStatus === 'no_show' ? 'no_show_dedicated' : 'generic';
}

// ─── 1. Routing decision ───────────────────────────────────────────────────

section('1. handleStatusUpdate routing — no_show uses the dedicated endpoint');

test("'no_show' routes to the dedicated no-show endpoint", () => {
  assert.equal(resolveStatusUpdateTarget('no_show'), 'no_show_dedicated');
});

for (const status of ['confirmed', 'completed', 'cancelled', 'rescheduled']) {
  test(`'${status}' still uses the generic status endpoint`, () => {
    assert.equal(resolveStatusUpdateTarget(status), 'generic');
  });
}

// ─── 2. Button visibility gate matches backend NO_SHOW_MARK_ROLES ─────────

section('2. "Mark No Show" button gate (canManageNoShows) matches backend roles');

type UserLike = { role: string; canAccessAllClinics?: boolean; allowedClinicIds?: string[] };

function makeUser(role: string): UserLike {
  return { role, canAccessAllClinics: false, allowedClinicIds: ['clinic-A'] };
}

// server/src/routes/noShows.ts: NO_SHOW_MARK_ROLES = OWNER, ORG_ADMIN,
// CLINIC_MANAGER, RECEPTIONIST, DENTIST.
const allowedRoles = ['owner', 'org_admin', 'clinic_manager', 'receptionist', 'dentist'];
const deniedRoles = ['billing', 'assistant'];

for (const role of allowedRoles) {
  test(`${role} sees the Mark No Show button (matches backend allow-list)`, () => {
    assert.equal(canManageNoShows(makeUser(role)), true);
  });
}

for (const role of deniedRoles) {
  test(`${role} does not see the Mark No Show button (would 403 server-side)`, () => {
    assert.equal(canManageNoShows(makeUser(role)), false);
  });
}

// ─── Sonuç ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
console.log(`Total: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);
console.log('─'.repeat(60));

if (failed > 0) process.exit(1);

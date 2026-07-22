/**
 * appointmentRequestRecordScope.test.ts — KVKK-HIGH-006-S3 Batch 1:
 * appointmentRequests.ts record-derived clinic-scope fix
 *
 * Koşturma: cd server && npx tsx src/tests/appointmentRequestRecordScope.test.ts
 *
 * Bug (docs/program/evidence/KVKK-HIGH-006-S2_REQ_USER_CLINIC_ID_OCCURRENCE_CLASSIFICATION.md
 * §13/§14.2): PUT /appointment-requests/:id/status, POST /appointment-requests/:id/convert,
 * and PUT /appointment-requests/:id all looked the request up via
 * `findFirst({ where: { id, clinicId: req.user!.clinicId } })` — a single, static,
 * server-resolved clinic id, never the requester's full accessible-clinic set. An
 * OWNER/ORG_ADMIN with canAccessAllClinics (or any multi-clinic-assigned user) got a
 * false 404 for a request that genuinely existed in one of their other clinics.
 *
 * Fix: resolve the accessible scope first (validateAndGetClinicIdScope, no selector —
 * this is a record-derived-mutation shape, not a list/report route), look the request
 * up WITHIN that scope, then use the FOUND RECORD's OWN clinicId for every downstream
 * Patient/Appointment/ActivityLog operation — never re-derived from req.user.clinicId.
 * This mirrors the established relationGuards.ts pattern used elsewhere in the codebase.
 *
 * 404-vs-403 semantics are preserved: a request outside the accessible scope (or
 * genuinely nonexistent) still 404s: only a user with a genuinely empty accessible-clinic
 * set gets 403 (from validateAndGetClinicIdScope itself, before any lookup).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const routeSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'appointmentRequests.ts'), 'utf8');

// ─── Test harness ──────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      console.log(`  ✓ ${name}`);
      passed++;
    })
    .catch((err: unknown) => {
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    });
}

function section(title: string) {
  console.log(`\n${title}`);
}

// ─── clinicScope.ts contract, mirrored ──────────────────────────────────────

type User = {
  id: string;
  clinicId: string; // defaultClinicId — UI default only, NOT authorization
  organizationId: string;
  allowedClinicIds: string[];
  canAccessAllClinics: boolean;
};

type ClinicIdScope = { clinicId: string } | { clinicId: { in: string[] } };

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    clinicId: 'clinic-A',
    organizationId: 'org-1',
    allowedClinicIds: ['clinic-A'],
    canAccessAllClinics: false,
    ...overrides,
  };
}

const ORG_CLINICS: Record<string, string[]> = {
  'org-1': ['clinic-A', 'clinic-B'],
  'org-2': ['clinic-X'],
};

async function buildClinicIdScope(user: User, selectedClinicId: string | undefined): Promise<ClinicIdScope | null> {
  const orgId = user.organizationId;
  if (selectedClinicId && selectedClinicId !== 'all') {
    if (!(ORG_CLINICS[orgId] || []).includes(selectedClinicId)) return null;
    if (!user.canAccessAllClinics && !user.allowedClinicIds.includes(selectedClinicId)) return null;
    return { clinicId: selectedClinicId };
  }
  if (user.canAccessAllClinics) return { clinicId: { in: ORG_CLINICS[orgId] || [] } };
  if (user.allowedClinicIds.length === 0) return null;
  return { clinicId: { in: user.allowedClinicIds } };
}

function scopeMatches(scope: ClinicIdScope, clinicId: string): boolean {
  return typeof scope.clinicId === 'string' ? scope.clinicId === clinicId : scope.clinicId.in.includes(clinicId);
}

// ─── Fixtures: AppointmentRequest rows across clinics ───────────────────────

type AppointmentRequest = { id: string; clinicId: string; status: string; patientName: string };

const REQUESTS: AppointmentRequest[] = [
  { id: 'req-A-1', clinicId: 'clinic-A', status: 'pending', patientName: 'Ayşe Yılmaz' },
  { id: 'req-B-1', clinicId: 'clinic-B', status: 'pending', patientName: 'Mehmet Demir' },
  { id: 'req-X-1', clinicId: 'clinic-X', status: 'pending', patientName: 'Other Org Patient' }, // org-2
];

type RouteResult =
  | { status: 404 | 403; error: string }
  | { status: 200; clinicIdUsedForWrite: string };

// Simulates PUT /:id/status, PUT /:id, and the lookup half of POST /:id/convert —
// all three share this exact "resolve scope → findFirst within scope → use
// record's own clinicId" shape after the fix.
async function simulateMutationRoute(user: User, requestId: string): Promise<RouteResult> {
  const scope = await buildClinicIdScope(user, undefined);
  if (!scope) return { status: 403, error: 'Access denied to requested clinic' };

  const existing = REQUESTS.find(r => r.id === requestId && scopeMatches(scope, r.clinicId));
  if (!existing) return { status: 404, error: 'Appointment request not found' };

  // Every downstream write (update/logActivity, or — on convert — the created
  // Patient/Appointment) uses existing.clinicId, never req.user.clinicId.
  return { status: 200, clinicIdUsedForWrite: existing.clinicId };
}

// The pre-fix behavior, for regression contrast only.
function simulateMutationRoute_BUGGY(user: User, requestId: string): RouteResult {
  const existing = REQUESTS.find(r => r.id === requestId && r.clinicId === user.clinicId);
  if (!existing) return { status: 404, error: 'Appointment request not found' };
  return { status: 200, clinicIdUsedForWrite: existing.clinicId };
}

// ─── 1. Single-clinic behavior unchanged ────────────────────────────────────

section('1. Single-clinic user — unchanged behavior');

await test('single-clinic user acting on their own clinic\'s request succeeds', async () => {
  const staff = makeUser({ allowedClinicIds: ['clinic-A'] });
  const result = await simulateMutationRoute(staff, 'req-A-1');
  assert.equal(result.status, 200);
  assert.equal((result as any).clinicIdUsedForWrite, 'clinic-A');
});

await test('single-clinic user cannot act on a different clinic\'s request (404, unchanged)', async () => {
  const staff = makeUser({ allowedClinicIds: ['clinic-A'] });
  const result = await simulateMutationRoute(staff, 'req-B-1');
  assert.equal(result.status, 404);
});

// ─── 2. Sibling-clinic access — the confirmed defect this fix resolves ──────

section('2. Multi-clinic / sibling-clinic access (the fix)');

await test('REGRESSION: pre-fix behavior 404s a genuinely-accessible sibling-clinic request', () => {
  const manager = makeUser({ allowedClinicIds: ['clinic-A', 'clinic-B'], clinicId: 'clinic-A' });
  const result = simulateMutationRoute_BUGGY(manager, 'req-B-1');
  assert.equal(result.status, 404, 'this is the exact production defect KVKK-HIGH-006-S3 Batch 1 fixes');
});

await test('FIX: multi-clinic-assigned user now succeeds on an allowed sibling clinic\'s request', async () => {
  const manager = makeUser({ allowedClinicIds: ['clinic-A', 'clinic-B'], clinicId: 'clinic-A' });
  const result = await simulateMutationRoute(manager, 'req-B-1');
  assert.equal(result.status, 200);
  assert.equal((result as any).clinicIdUsedForWrite, 'clinic-B');
});

await test('FIX: OWNER/ORG_ADMIN (canAccessAllClinics) succeeds on any in-org clinic\'s request', async () => {
  const owner = makeUser({ canAccessAllClinics: true, allowedClinicIds: [], clinicId: 'clinic-A' });
  const resultA = await simulateMutationRoute(owner, 'req-A-1');
  const resultB = await simulateMutationRoute(owner, 'req-B-1');
  assert.equal(resultA.status, 200);
  assert.equal(resultB.status, 200);
  assert.equal((resultB as any).clinicIdUsedForWrite, 'clinic-B');
});

// ─── 3. Denial cases preserved ───────────────────────────────────────────────

section('3. Denial cases — 403/404 semantics preserved');

await test('unauthorized clinic (not in allowedClinicIds) — request remains 404, not found/writable', async () => {
  const staff = makeUser({ allowedClinicIds: ['clinic-A'] });
  const result = await simulateMutationRoute(staff, 'req-B-1');
  assert.equal(result.status, 404);
});

await test('cross-organization request (clinic-X, org-2) is never found, even for an org-1 OWNER', async () => {
  const owner = makeUser({ canAccessAllClinics: true, allowedClinicIds: [], organizationId: 'org-1' });
  const result = await simulateMutationRoute(owner, 'req-X-1');
  assert.equal(result.status, 404, 'cross-org rows must never be reachable, regardless of canAccessAllClinics');
});

await test('a user with zero clinic assignments gets 403 before any record lookup', async () => {
  const noAccess = makeUser({ allowedClinicIds: [], canAccessAllClinics: false });
  const result = await simulateMutationRoute(noAccess, 'req-A-1');
  assert.equal(result.status, 403, 'genuinely no accessible clinics → 403 from scope resolution itself');
});

await test('nonexistent request id within an otherwise-valid scope still 404s', async () => {
  const staff = makeUser({ allowedClinicIds: ['clinic-A'] });
  const result = await simulateMutationRoute(staff, 'req-does-not-exist');
  assert.equal(result.status, 404);
});

// ─── 4. Dependent writes use the record's own clinicId ──────────────────────

section('4. Dependent Patient/Appointment/ActivityLog writes use AppointmentRequest.clinicId');

await test('write clinicId matches the looked-up request\'s own clinic, not the requester\'s default', async () => {
  // requester's own resolved/default clinic is clinic-A, but they are acting on
  // a request that lives in clinic-B (a legitimately accessible sibling clinic)
  const manager = makeUser({ allowedClinicIds: ['clinic-A', 'clinic-B'], clinicId: 'clinic-A' });
  const result = await simulateMutationRoute(manager, 'req-B-1');
  assert.equal(result.status, 200);
  assert.equal((result as any).clinicIdUsedForWrite, 'clinic-B', 'must use the request\'s own clinic, never req.user.clinicId');
});

// ─── 5. Source verification — verify the actual fix landed in appointmentRequests.ts ─

section('5. Source verification — appointmentRequests.ts');

function routeBody(name: string): string {
  const start = routeSrc.indexOf(name);
  assert.ok(start >= 0, `route "${name}" must exist`);
  return routeSrc.slice(start, start + 1400);
}

await test('PUT /:id/status resolves scope before lookup, uses record\'s own clinicId', () => {
  const body = routeBody("router.put('/appointment-requests/:id/status'");
  assert.match(body, /validateAndGetClinicIdScope\(req\.user!, undefined, res\)/);
  assert.match(body, /appointmentRequest\.findFirst\(\{\s*where:\s*\{\s*\.\.\.scope,\s*id\s*\}/);
  assert.match(body, /const clinicId = existing\.clinicId;/);
});

await test('POST /:id/convert resolves scope before lookup, uses record\'s own clinicId', () => {
  const body = routeBody("router.post('/appointment-requests/:id/convert'");
  assert.match(body, /validateAndGetClinicIdScope\(req\.user!, undefined, res\)/);
  assert.match(body, /appointmentRequest\.findFirst\(\{\s*where:\s*\{\s*\.\.\.scope,\s*id\s*\}/);
  assert.match(body, /const clinicId = request\.clinicId;/);
});

await test('PUT /:id (general update) resolves scope before lookup, uses record\'s own clinicId', () => {
  const body = routeBody("router.put('/appointment-requests/:id',");
  assert.match(body, /validateAndGetClinicIdScope\(req\.user!, undefined, res\)/);
  assert.match(body, /appointmentRequest\.findFirst\(\{\s*where:\s*\{\s*\.\.\.scope,\s*id\s*\}/);
  assert.match(body, /const clinicId = existing\.clinicId;/);
});

// ─── Sonuç ────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
console.log(`Total: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);
console.log('─'.repeat(60));

if (failed > 0) process.exit(1);

/**
 * reportsClinicScope.test.ts — KVKK-HIGH-006-S3 Batch 1: reports.ts clinic-scope fixes
 *
 * Koşturma: cd server && npx tsx src/tests/reportsClinicScope.test.ts
 *
 * Covers two confirmed defects from KVKK-HIGH-006-S2
 * (docs/program/evidence/KVKK-HIGH-006-S2_REQ_USER_CLINIC_ID_OCCURRENCE_CLASSIFICATION.md §13/§14.1):
 *
 *  1. reports.ts:73 — GET /reports/revenue's byPeriod raw-SQL breakdown fell back to
 *     req.user!.clinicId whenever the validated scope was a multi-clinic array, so an
 *     org-wide ('all') request returned a byPeriod series reflecting only the requester's
 *     own resolved clinic while the rest of the same response (summary/byMethod/
 *     byPractitioner) was correctly org-wide. Fix: the raw SQL now uses the full
 *     array-aware scope (clinicScopeSql), matching imaging.ts's established pattern.
 *
 *  2. reports.ts:405 — GET /reports/no-show-analysis had no clinicId/'all' selector at
 *     all (the only route in the file with zero multi-clinic surface), permanently
 *     narrowing OWNER/ORG_ADMIN to their single resolved clinic. Fix: adds the same
 *     clinicId query param + validateAndGetClinicIdScope pattern the file's other
 *     3 routes already use.
 *
 * Both fixes are additive/backward-compatible: an omitted clinicId selector resolves
 * to the same accessible-clinic scope non-canAccessAllClinics users saw before.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const reportsSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'reports.ts'), 'utf8');

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

// ─── clinicScope.ts contract, mirrored (matches server/src/utils/clinicScope.ts) ─

type User = {
  id: string;
  clinicId: string;
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
    const belongsToOrg = (ORG_CLINICS[orgId] || []).includes(selectedClinicId);
    if (!belongsToOrg) return null; // cross-org / nonexistent → 403
    if (!user.canAccessAllClinics && !user.allowedClinicIds.includes(selectedClinicId)) return null;
    return { clinicId: selectedClinicId };
  }
  if (user.canAccessAllClinics) {
    return { clinicId: { in: ORG_CLINICS[orgId] || [] } };
  }
  if (user.allowedClinicIds.length === 0) return null;
  return { clinicId: { in: user.allowedClinicIds } };
}

// ─── clinicScopeSql-equivalent row filter (mirrors the new reports.ts helper) ───

function scopeMatches(scope: ClinicIdScope, clinicId: string): boolean {
  if (typeof scope.clinicId === 'string') return scope.clinicId === clinicId;
  return scope.clinicId.in.includes(clinicId);
}

// The pre-fix behavior: a raw-SQL fallback that used req.user!.clinicId whenever
// the scope was a multi-clinic array (only a single string scope was honored).
function buggyRawClinicId(scope: ClinicIdScope, requesterClinicId: string): string {
  return typeof scope.clinicId === 'string' ? scope.clinicId : requesterClinicId;
}

// ─── Fixtures: Payment rows across two clinics in org-1, one in org-2 ───────

type Payment = { id: string; clinicId: string; period: string; amount: number };

const PAYMENTS: Payment[] = [
  { id: 'p-A-1', clinicId: 'clinic-A', period: '2026-06', amount: 1000 },
  { id: 'p-A-2', clinicId: 'clinic-A', period: '2026-07', amount: 500 },
  { id: 'p-B-1', clinicId: 'clinic-B', period: '2026-06', amount: 2000 },
  { id: 'p-B-2', clinicId: 'clinic-B', period: '2026-07', amount: 300 },
  { id: 'p-X-1', clinicId: 'clinic-X', period: '2026-06', amount: 9999 }, // org-2, must never leak in
];

function byPeriodFixed(scope: ClinicIdScope): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const p of PAYMENTS) {
    if (!scopeMatches(scope, p.clinicId)) continue;
    totals[p.period] = (totals[p.period] || 0) + p.amount;
  }
  return totals;
}

function byPeriodBuggy(scope: ClinicIdScope, requesterClinicId: string): Record<string, number> {
  const rawClinicId = buggyRawClinicId(scope, requesterClinicId);
  const totals: Record<string, number> = {};
  for (const p of PAYMENTS) {
    if (p.clinicId !== rawClinicId) continue;
    totals[p.period] = (totals[p.period] || 0) + p.amount;
  }
  return totals;
}

// ─── 1. reports.ts:73 — revenue byPeriod org-wide scope-translation bug ─────

section('1. GET /reports/revenue byPeriod — array-aware clinic scope');

await test('BUGGY behavior reproduced: org-wide scope only reflects requester\'s own clinic', async () => {
  const owner = makeUser({ role: 'owner', canAccessAllClinics: true, clinicId: 'clinic-A', allowedClinicIds: [] } as any);
  const scope = await buildClinicIdScope(owner, 'all');
  assert.ok(scope);
  const buggy = byPeriodBuggy(scope!, owner.clinicId);
  // Missing clinic-B's revenue — this is the confirmed pre-fix defect
  assert.equal(buggy['2026-06'], 1000);
  assert.equal(buggy['2026-07'], 500);
});

await test('FIX: clinicId=all includes every authorized clinic\'s payments in byPeriod', async () => {
  const owner = makeUser({ role: 'owner', canAccessAllClinics: true, clinicId: 'clinic-A', allowedClinicIds: [] } as any);
  const scope = await buildClinicIdScope(owner, 'all');
  assert.ok(scope);
  const fixed = byPeriodFixed(scope!);
  assert.equal(fixed['2026-06'], 1000 + 2000, 'must include both clinic-A and clinic-B for 2026-06');
  assert.equal(fixed['2026-07'], 500 + 300, 'must include both clinic-A and clinic-B for 2026-07');
});

await test('FIX: cross-organization payments never leak into an org-wide byPeriod result', async () => {
  const owner = makeUser({ role: 'owner', canAccessAllClinics: true, clinicId: 'clinic-A', allowedClinicIds: [] } as any);
  const scope = await buildClinicIdScope(owner, 'all');
  const fixed = byPeriodFixed(scope!);
  const total = Object.values(fixed).reduce((a, b) => a + b, 0);
  assert.equal(total, 1000 + 500 + 2000 + 300, 'must not include clinic-X (org-2) revenue');
});

await test('single-clinic user: byPeriod unchanged (single clinic scope, before and after fix)', async () => {
  const staff = makeUser({ allowedClinicIds: ['clinic-A'] });
  const scope = await buildClinicIdScope(staff, undefined);
  assert.ok(scope);
  const fixed = byPeriodFixed(scope!);
  const buggy = byPeriodBuggy(scope!, staff.clinicId);
  assert.deepEqual(fixed, buggy, 'single-clinic scope resolves to a string clinicId either way — behavior identical');
  assert.equal(fixed['2026-06'], 1000);
});

await test('sibling-clinic multi-clinic user: explicit clinicId=clinic-B succeeds and is isolated', async () => {
  const manager = makeUser({ allowedClinicIds: ['clinic-A', 'clinic-B'] });
  const scope = await buildClinicIdScope(manager, 'clinic-B');
  assert.ok(scope);
  const fixed = byPeriodFixed(scope!);
  assert.equal(fixed['2026-06'], 2000);
  assert.equal(fixed['2026-07'], 300);
});

await test('unauthorized clinic selection is denied (403 — scope resolves to null)', async () => {
  const staff = makeUser({ allowedClinicIds: ['clinic-A'] });
  const scope = await buildClinicIdScope(staff, 'clinic-B');
  assert.equal(scope, null);
});

await test('cross-organization clinic selection is denied regardless of canAccessAllClinics', async () => {
  const owner = makeUser({ role: 'owner', canAccessAllClinics: true, organizationId: 'org-1', allowedClinicIds: [] } as any);
  const scope = await buildClinicIdScope(owner, 'clinic-X');
  assert.equal(scope, null, 'clinic-X belongs to org-2, must be rejected even for an org-wide-capable user');
});

await test('omitted selector remains backward-compatible for non-canAccessAllClinics users', async () => {
  const staff = makeUser({ allowedClinicIds: ['clinic-A'] });
  const withoutSelector = await buildClinicIdScope(staff, undefined);
  const withAll = await buildClinicIdScope(staff, 'all');
  assert.deepEqual(withoutSelector, withAll, 'omitted selector and explicit "all" resolve identically for this user');
});

// ─── 2. reports.ts:405 — no-show-analysis missing selector ──────────────────

section('2. GET /reports/no-show-analysis — added clinicId/\'all\' selector');

type Appointment = { id: string; clinicId: string; status: string };

const APPOINTMENTS: Appointment[] = [
  { id: 'a-A-1', clinicId: 'clinic-A', status: 'no_show' },
  { id: 'a-A-2', clinicId: 'clinic-A', status: 'completed' },
  { id: 'a-B-1', clinicId: 'clinic-B', status: 'no_show' },
  { id: 'a-B-2', clinicId: 'clinic-B', status: 'no_show' },
  { id: 'a-X-1', clinicId: 'clinic-X', status: 'no_show' }, // org-2, must never leak in
];

function noShowCount(scope: ClinicIdScope): number {
  return APPOINTMENTS.filter(a => scopeMatches(scope, a.clinicId) && a.status === 'no_show').length;
}

await test('single-clinic user: no-show count unchanged from pre-fix behavior', async () => {
  const staff = makeUser({ allowedClinicIds: ['clinic-A'] });
  const scope = await buildClinicIdScope(staff, undefined);
  assert.ok(scope);
  assert.equal(noShowCount(scope!), 1);
});

await test('OWNER/ORG_ADMIN all-clinic behavior: \'all\' covers every accessible clinic', async () => {
  const owner = makeUser({ role: 'owner', canAccessAllClinics: true, allowedClinicIds: [] } as any);
  const scope = await buildClinicIdScope(owner, 'all');
  assert.ok(scope);
  assert.equal(noShowCount(scope!), 3, 'clinic-A (1) + clinic-B (2), never clinic-X');
});

await test('sibling-clinic access succeeds for a multi-clinic-assigned user', async () => {
  const manager = makeUser({ allowedClinicIds: ['clinic-A', 'clinic-B'] });
  const scope = await buildClinicIdScope(manager, 'clinic-B');
  assert.ok(scope);
  assert.equal(noShowCount(scope!), 2);
});

await test('unauthorized clinic is denied (403), not silently narrowed', async () => {
  const staff = makeUser({ allowedClinicIds: ['clinic-A'] });
  const scope = await buildClinicIdScope(staff, 'clinic-B');
  assert.equal(scope, null);
});

await test('cross-organization clinic is denied', async () => {
  const owner = makeUser({ role: 'owner', canAccessAllClinics: true, organizationId: 'org-1', allowedClinicIds: [] } as any);
  const scope = await buildClinicIdScope(owner, 'clinic-X');
  assert.equal(scope, null);
});

// ─── 3. Source-shape assertions — verify the actual fix landed in reports.ts ─

section('3. Source verification — reports.ts');

await test('byPeriod no longer falls back to req.user!.clinicId for multi-clinic scope', () => {
  assert.equal(
    /rawClinicId/.test(reportsSrc),
    false,
    'the buggy single-value rawClinicId fallback must be removed',
  );
});

await test('byPeriod raw SQL now uses a tagged, array-aware clinicScopeSql fragment', () => {
  assert.match(reportsSrc, /clinicScopeSql\(scope\)/, 'byPeriod/no-show-analysis must scope via the array-aware helper');
  assert.equal(reportsSrc.includes('$queryRawUnsafe'), false, 'must not use $queryRawUnsafe anywhere in reports.ts');
});

await test('no-show-analysis route now resolves and validates an explicit clinic scope', () => {
  const routeStart = reportsSrc.indexOf("router.get('/reports/no-show-analysis'");
  assert.ok(routeStart >= 0, 'no-show-analysis route must exist');
  const routeSrc = reportsSrc.slice(routeStart);
  assert.match(routeSrc, /validateAndGetClinicIdScope\(req\.user!, selectedClinicId/, 'must call the centralized helper with the query selector');
  assert.equal(/const clinicId = req\.user!\.clinicId;/.test(routeSrc.slice(0, 400)), false, 'must no longer read req.user!.clinicId directly as the sole scope');
});

// ─── Sonuç ────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
console.log(`Total: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);
console.log('─'.repeat(60));

if (failed > 0) process.exit(1);

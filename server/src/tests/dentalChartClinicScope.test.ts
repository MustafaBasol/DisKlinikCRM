/**
 * dentalChartClinicScope.test.ts — KVKK-HIGH-006-S3 Batch 1: dentalChart.ts clinic-scope fix
 *
 * Koşturma: cd server && npx tsx src/tests/dentalChartClinicScope.test.ts
 *
 * Bug (docs/program/evidence/KVKK-HIGH-006-S2_REQ_USER_CLINIC_ID_OCCURRENCE_CLASSIFICATION.md
 * §13/§14.3): all three dental-chart routes (list/upsert/delete tooth records) gated
 * every patient/record lookup on the single, static req.user!.clinicId instead of the
 * requester's full accessible-clinic set — silently narrowing a legitimately
 * multi-clinic-authorized user (OWNER/ORG_ADMIN/CLINIC_MANAGER with a sibling clinic
 * assignment) to only their one resolved default clinic.
 *
 * Fix: resolve the accessible scope (validateAndGetClinicIdScope, no selector), locate
 * the patient (or, for delete, the tooth record) WITHIN that scope, then use the FOUND
 * RECORD's OWN clinicId for the ToothRecord/ActivityLog write — mirroring
 * relationGuards.findPatientInClinic's pattern used elsewhere in the codebase.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const routeSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'dentalChart.ts'), 'utf8');

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

// ─── Fixtures: Patient + ToothRecord rows across clinics ────────────────────

type Patient = { id: string; clinicId: string; deletedAt: Date | null };
type ToothRecord = { patientId: string; toothFdi: number; clinicId: string; status: string };

const PATIENTS: Patient[] = [
  { id: 'pat-A-1', clinicId: 'clinic-A', deletedAt: null },
  { id: 'pat-B-1', clinicId: 'clinic-B', deletedAt: null },
  { id: 'pat-X-1', clinicId: 'clinic-X', deletedAt: null }, // org-2
  { id: 'pat-A-deleted', clinicId: 'clinic-A', deletedAt: new Date() },
];

const TOOTH_RECORDS: ToothRecord[] = [
  { patientId: 'pat-A-1', toothFdi: 11, clinicId: 'clinic-A', status: 'treated' },
  { patientId: 'pat-B-1', toothFdi: 21, clinicId: 'clinic-B', status: 'planned' },
];

// Simulates the fixed GET (list) handler.
async function simulateList(user: User, patientId: string): Promise<{ status: 200 | 404 | 403; records?: ToothRecord[] }> {
  const scope = await buildClinicIdScope(user, undefined);
  if (!scope) return { status: 403 };
  const patient = PATIENTS.find(p => p.id === patientId && scopeMatches(scope, p.clinicId) && !p.deletedAt);
  if (!patient) return { status: 404 };
  const records = TOOTH_RECORDS.filter(r => r.patientId === patientId && r.clinicId === patient.clinicId);
  return { status: 200, records };
}

// Simulates the fixed PUT (upsert) handler — returns the clinicId that WOULD be
// stamped on a newly-created ToothRecord/ActivityLog row.
async function simulateUpsert(user: User, patientId: string): Promise<{ status: 200 | 404 | 403; clinicIdUsedForWrite?: string }> {
  const scope = await buildClinicIdScope(user, undefined);
  if (!scope) return { status: 403 };
  const patient = PATIENTS.find(p => p.id === patientId && scopeMatches(scope, p.clinicId) && !p.deletedAt);
  if (!patient) return { status: 404 };
  return { status: 200, clinicIdUsedForWrite: patient.clinicId };
}

// Simulates the fixed DELETE handler.
async function simulateDelete(user: User, patientId: string, toothFdi: number): Promise<{ status: 200 | 404 | 403; clinicIdUsedForWrite?: string }> {
  const scope = await buildClinicIdScope(user, undefined);
  if (!scope) return { status: 403 };
  const record = TOOTH_RECORDS.find(r => r.patientId === patientId && r.toothFdi === toothFdi && scopeMatches(scope, r.clinicId));
  if (!record) return { status: 404 };
  return { status: 200, clinicIdUsedForWrite: record.clinicId };
}

// The pre-fix behavior, for regression contrast (single static clinicId).
function simulateList_BUGGY(user: User, patientId: string) {
  const patient = PATIENTS.find(p => p.id === patientId && p.clinicId === user.clinicId && !p.deletedAt);
  return patient ? { status: 200 } : { status: 404 };
}

// ─── 1. Single-clinic behavior unchanged ────────────────────────────────────

section('1. Single-clinic user — unchanged behavior');

await test('single-clinic user lists their own clinic\'s patient chart', async () => {
  const staff = makeUser({ allowedClinicIds: ['clinic-A'] });
  const result = await simulateList(staff, 'pat-A-1');
  assert.equal(result.status, 200);
  assert.equal(result.records!.length, 1);
});

await test('single-clinic user cannot list a different clinic\'s patient chart (404, unchanged)', async () => {
  const staff = makeUser({ allowedClinicIds: ['clinic-A'] });
  const result = await simulateList(staff, 'pat-B-1');
  assert.equal(result.status, 404);
});

// ─── 2. Sibling-clinic access — the confirmed defect this fix resolves ──────

section('2. Multi-clinic / sibling-clinic dental-chart access (the fix)');

await test('REGRESSION: pre-fix behavior 404s a genuinely-accessible sibling-clinic patient', () => {
  const manager = makeUser({ allowedClinicIds: ['clinic-A', 'clinic-B'], clinicId: 'clinic-A' });
  const result = simulateList_BUGGY(manager, 'pat-B-1');
  assert.equal(result.status, 404, 'this is the exact production defect KVKK-HIGH-006-S3 Batch 1 fixes');
});

await test('FIX: sibling-clinic dental-chart list access succeeds for a multi-clinic user', async () => {
  const manager = makeUser({ allowedClinicIds: ['clinic-A', 'clinic-B'], clinicId: 'clinic-A' });
  const result = await simulateList(manager, 'pat-B-1');
  assert.equal(result.status, 200);
  assert.equal(result.records![0].clinicId, 'clinic-B');
});

await test('FIX: sibling-clinic upsert succeeds and stamps the patient\'s own clinicId', async () => {
  const manager = makeUser({ allowedClinicIds: ['clinic-A', 'clinic-B'], clinicId: 'clinic-A' });
  const result = await simulateUpsert(manager, 'pat-B-1');
  assert.equal(result.status, 200);
  assert.equal(result.clinicIdUsedForWrite, 'clinic-B', 'must use the patient\'s own clinic, never req.user.clinicId');
});

await test('FIX: sibling-clinic delete succeeds and uses the record\'s own clinicId', async () => {
  const manager = makeUser({ allowedClinicIds: ['clinic-A', 'clinic-B'], clinicId: 'clinic-A' });
  const result = await simulateDelete(manager, 'pat-B-1', 21);
  assert.equal(result.status, 200);
  assert.equal(result.clinicIdUsedForWrite, 'clinic-B');
});

await test('FIX: OWNER (canAccessAllClinics) can access any in-org clinic\'s dental chart', async () => {
  const owner = makeUser({ canAccessAllClinics: true, allowedClinicIds: [], clinicId: 'clinic-A' });
  const resultA = await simulateList(owner, 'pat-A-1');
  const resultB = await simulateList(owner, 'pat-B-1');
  assert.equal(resultA.status, 200);
  assert.equal(resultB.status, 200);
});

// ─── 3. Denial / inaccessible-patient cases preserved ───────────────────────

section('3. Inaccessible / cross-organization access remains denied');

await test('inaccessible clinic\'s patient chart access fails (404), never returns data', async () => {
  const staff = makeUser({ allowedClinicIds: ['clinic-A'] });
  const result = await simulateList(staff, 'pat-B-1');
  assert.equal(result.status, 404);
});

await test('cross-organization patient (clinic-X, org-2) is never reachable, even for an org-1 OWNER', async () => {
  const owner = makeUser({ canAccessAllClinics: true, allowedClinicIds: [], organizationId: 'org-1' });
  const result = await simulateList(owner, 'pat-X-1');
  assert.equal(result.status, 404);
});

await test('a user with zero clinic assignments gets 403 before any patient lookup', async () => {
  const noAccess = makeUser({ allowedClinicIds: [], canAccessAllClinics: false });
  const result = await simulateList(noAccess, 'pat-A-1');
  assert.equal(result.status, 403);
});

await test('soft-deleted patient remains inaccessible regardless of clinic scope', async () => {
  const owner = makeUser({ canAccessAllClinics: true, allowedClinicIds: [] });
  const result = await simulateList(owner, 'pat-A-deleted');
  assert.equal(result.status, 404);
});

await test('inaccessible-clinic patient\'s chart cannot be mutated (upsert 404s, no write occurs)', async () => {
  const staff = makeUser({ allowedClinicIds: ['clinic-A'] });
  const result = await simulateUpsert(staff, 'pat-B-1');
  assert.equal(result.status, 404);
  assert.equal(result.clinicIdUsedForWrite, undefined, 'no write path should be reached');
});

await test('inaccessible-clinic tooth record cannot be deleted', async () => {
  const staff = makeUser({ allowedClinicIds: ['clinic-A'] });
  const result = await simulateDelete(staff, 'pat-B-1', 21);
  assert.equal(result.status, 404);
});

// ─── 4. Source verification — verify the actual fix landed in dentalChart.ts ─

section('4. Source verification — dentalChart.ts');

function routeBody(marker: string): string {
  const start = routeSrc.indexOf(marker);
  assert.ok(start >= 0, `route marker "${marker}" must exist`);
  return routeSrc.slice(start, start + 1600);
}

await test('list route resolves scope, looks patient up within it, uses patient\'s own clinicId', () => {
  const body = routeBody("'/patients/:patientId/dental-chart',");
  assert.match(body, /validateAndGetClinicIdScope\(req\.user!, undefined, res\)/);
  assert.match(body, /patient\.findFirst\(\{\s*where:\s*\{\s*id:\s*patientId,\s*\.\.\.scope/);
  assert.match(body, /clinicId:\s*patient\.clinicId/);
});

await test('upsert route resolves scope, looks patient up within it, uses patient\'s own clinicId', () => {
  const body = routeBody("'/patients/:patientId/dental-chart/:toothFdi'");
  assert.match(body, /validateAndGetClinicIdScope\(req\.user!, undefined, res\)/);
  assert.match(body, /const clinicId = patient\.clinicId;/);
});

await test('delete route resolves scope, looks record up within it, uses record\'s own clinicId', () => {
  const start = routeSrc.lastIndexOf("router.delete(");
  const body = routeSrc.slice(start, start + 900);
  assert.match(body, /validateAndGetClinicIdScope\(req\.user!, undefined, res\)/);
  assert.match(body, /toothRecord\.findFirst\(\{\s*where:\s*\{\s*patientId,\s*toothFdi,\s*\.\.\.scope/);
  assert.match(body, /const clinicId = record\.clinicId;/);
});

await test('no route reads req.user!.clinicId directly anymore', () => {
  assert.equal(/req\.user!\.clinicId/.test(routeSrc), false, 'dentalChart.ts must no longer read req.user!.clinicId directly');
});

// ─── Sonuç ────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
console.log(`Total: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);
console.log('─'.repeat(60));

if (failed > 0) process.exit(1);

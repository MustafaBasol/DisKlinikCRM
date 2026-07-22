/**
 * planLimitsTargetClinicFix.test.ts — KVKK-HIGH-006 Batch 4 Option 2 fix proof
 *
 * Confirmed defect (docs/program/evidence/
 * KVKK-HIGH-006-BATCH4_CHARACTERIZATION_AND_PRODUCT_DECISION.md §6-7):
 * checkUserLimit/checkPatientLimit ran BEFORE the route handler resolved the
 * explicit creation-target clinic (?clinicId=), so for a no-plan organization
 * the quota check evaluated req.user!.clinicId (the requester's own default
 * clinic) instead of the actual clinic the record was about to be created in.
 * This could fail in either direction: false-allow (default clinic has room,
 * real target is full) or false-block (default clinic is full, real target
 * has room).
 *
 * Fix (server/src/middleware/planLimits.ts): checkUserLimit/checkPatientLimit
 * now call the same centrally-validated resolveEffectiveClinicId(user,
 * req.query.clinicId) the route handlers already trusted for the actual
 * creation, and check quota against ITS result, storing it on
 * req.targetClinicId so the route handler reuses it instead of re-resolving.
 *
 * This file does NOT import server/src/middleware/planLimits.ts or
 * server/src/utils/clinicScope.ts directly — both transitively import
 * server/src/db.ts, which opens a live pg Pool at import time (requires
 * DATABASE_URL). Following the established convention in this test suite
 * (src/tests/multiBranchAccess.test.ts, src/tests/treatmentCaseClinicScope.test.ts,
 * src/tests/planLimitsNoPlanFallbackCharacterization.test.ts), this file
 * mirrors the exact logic of both modules verbatim against disposable local
 * fixtures — no real database, no production access.
 *
 * Run: cd server && npx tsx src/tests/planLimitsTargetClinicFix.test.ts
 */

import assert from 'node:assert/strict';

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
      console.error(`    ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    });
}

function section(title: string) {
  console.log(`\n${title}`);
}

// ─── Fixtures ────────────────────────────────────────────────────────────

type User = {
  id: string;
  clinicId: string; // defaultClinicId — UI default only, NOT authorization
  organizationId: string;
  allowedClinicIds: string[];
  canAccessAllClinics: boolean;
};

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

type LimitEntry = { maxUsers: number; maxPatients: number; userCount: number; patientCount: number };

// clinicId -> owning organizationId, mirrors the Clinic table for the
// prisma.clinic.findFirst({ where: { id, organizationId } }) cross-org check
// inside resolveEffectiveClinicId (clinicScope.ts:147-167).
let clinicOrgMap: Record<string, string> = {};

async function mockClinicFindFirst(id: string, organizationId: string): Promise<{ id: string } | null> {
  return clinicOrgMap[id] === organizationId ? { id } : null;
}

// ─── Verbatim mirror of clinicScope.ts:147-167 ──────────────────────────────

async function resolveEffectiveClinicId(user: User, requestedClinicId?: string): Promise<string | null> {
  const orgId = user.organizationId;
  const clinicId = requestedClinicId ?? user.clinicId;

  const clinic = await mockClinicFindFirst(clinicId, orgId);
  if (!clinic) return null;

  if (!user.canAccessAllClinics && !user.allowedClinicIds.includes(clinicId)) {
    return null;
  }

  return clinicId;
}

// ─── getOrgLimits / getClinicLimits mocks (planLimits.ts:11-58) ────────────

async function mockGetOrgLimits(organizationId: string, orgHasPlan: boolean): Promise<LimitEntry | null> {
  if (!orgHasPlan) return null;
  return { maxUsers: 10, maxPatients: 500, userCount: 1, patientCount: 1 };
}

async function mockGetClinicLimits(clinicId: string, clinicCounts: Record<string, LimitEntry>): Promise<LimitEntry | null> {
  return clinicCounts[clinicId] ?? null;
}

// ─── BEFORE the fix: mirrors planLimits.ts:62-65 on origin/main ────────────
// (checkUserLimit/checkPatientLimit read req.user!.clinicId directly,
// never the explicit ?clinicId= creation target)

async function checkLimitBefore(
  user: User,
  orgHasPlan: boolean,
  clinicCounts: Record<string, LimitEntry>,
): Promise<{ rejected: boolean; limits: LimitEntry | null }> {
  const organizationId = user.organizationId;
  const limits = organizationId
    ? (await mockGetOrgLimits(organizationId, orgHasPlan)) ?? (await mockGetClinicLimits(user.clinicId, clinicCounts))
    : await mockGetClinicLimits(user.clinicId, clinicCounts);
  return { rejected: false, limits };
}

// ─── AFTER the fix: mirrors the new checkUserLimit/checkPatientLimit ───────
// (server/src/middleware/planLimits.ts:69-93, :95-119 in this worktree)

async function checkLimitAfter(
  user: User,
  requestedClinicId: string | undefined,
  orgHasPlan: boolean,
  clinicCounts: Record<string, LimitEntry>,
): Promise<{ rejected: boolean; targetClinicId: string | null; limits: LimitEntry | null }> {
  const targetClinicId = await resolveEffectiveClinicId(user, requestedClinicId);
  if (!targetClinicId) return { rejected: true, targetClinicId: null, limits: null };

  const organizationId = user.organizationId;
  const limits = organizationId
    ? (await mockGetOrgLimits(organizationId, orgHasPlan)) ?? (await mockGetClinicLimits(targetClinicId, clinicCounts))
    : await mockGetClinicLimits(targetClinicId, clinicCounts);
  return { rejected: false, targetClinicId, limits };
}

// ─── Scenario setup shared by the false-allow / false-block cases ──────────

const multiClinicUser = makeUser({
  id: 'owner-1',
  clinicId: 'clinic-A', // requester's own resolved default clinic
  allowedClinicIds: ['clinic-A', 'clinic-B'],
  canAccessAllClinics: false,
});

clinicOrgMap = {
  'clinic-A': 'org-1',
  'clinic-B': 'org-1',
  'clinic-cross-org': 'org-2',
};

section('False-allow: default clinic has room, real target clinic is full');

const fullTargetCounts: Record<string, LimitEntry> = {
  'clinic-A': { maxUsers: 10, maxPatients: 10, userCount: 1, patientCount: 1 }, // requester's own — far from limit
  'clinic-B': { maxUsers: 10, maxPatients: 10, userCount: 10, patientCount: 10 }, // real creation target — AT limit
};

await test('BEFORE fix: middleware wrongly evaluates the requester\'s own (non-full) clinic, not the full target', async () => {
  const before = await checkLimitBefore(multiClinicUser, false, fullTargetCounts);
  assert.equal(before.limits?.userCount, 1, 'evaluated clinic-A, not clinic-B');
  assert.ok((before.limits?.userCount ?? 0) < (before.limits?.maxUsers ?? 0), 'would incorrectly ALLOW creation');
});

await test('AFTER fix: quota check evaluates the actual target clinic-B and blocks creation (bug fixed)', async () => {
  const after = await checkLimitAfter(multiClinicUser, 'clinic-B', false, fullTargetCounts);
  assert.equal(after.rejected, false, 'target clinic is accessible, not access-denied');
  assert.equal(after.targetClinicId, 'clinic-B');
  assert.equal(after.limits?.userCount, 10, 'evaluated clinic-B, the real target');
  assert.ok((after.limits!.userCount) >= (after.limits!.maxUsers), 'a full sibling target is correctly recognized as full');
});

section('False-block: default clinic is full, real target clinic has room');

const fullDefaultCounts: Record<string, LimitEntry> = {
  'clinic-A': { maxUsers: 10, maxPatients: 10, userCount: 10, patientCount: 10 }, // requester's own — AT limit
  'clinic-B': { maxUsers: 10, maxPatients: 10, userCount: 1, patientCount: 1 }, // real creation target — far from limit
};

await test('BEFORE fix: middleware wrongly evaluates the requester\'s own (full) clinic and would block a valid creation', async () => {
  const before = await checkLimitBefore(multiClinicUser, false, fullDefaultCounts);
  assert.equal(before.limits?.userCount, 10, 'evaluated clinic-A, not clinic-B');
  assert.ok((before.limits?.userCount ?? 0) >= (before.limits?.maxUsers ?? 0), 'would incorrectly BLOCK creation in clinic-B');
});

await test('AFTER fix: quota check evaluates the actual target clinic-B and allows creation (bug fixed)', async () => {
  const after = await checkLimitAfter(multiClinicUser, 'clinic-B', false, fullDefaultCounts);
  assert.equal(after.rejected, false);
  assert.equal(after.targetClinicId, 'clinic-B');
  assert.equal(after.limits?.userCount, 1, 'evaluated clinic-B, the real target');
  assert.ok((after.limits!.userCount) < (after.limits!.maxUsers), 'a sibling target with remaining capacity is correctly allowed, not blocked by the full default clinic');
});

section('Requirement 8 — cross-organization / inaccessible target is rejected');

await test('explicit target belonging to a different organization is rejected before any quota check', async () => {
  const after = await checkLimitAfter(multiClinicUser, 'clinic-cross-org', false, fullTargetCounts);
  assert.equal(after.rejected, true);
  assert.equal(after.targetClinicId, null);
  assert.equal(after.limits, null, 'no quota data leaked for a rejected cross-org target');
});

await test('explicit target within the same org but NOT in allowedClinicIds (no canAccessAllClinics) is rejected', async () => {
  const restrictedUser = makeUser({
    clinicId: 'clinic-A',
    allowedClinicIds: ['clinic-A'], // clinic-B not assigned
    canAccessAllClinics: false,
  });
  const after = await checkLimitAfter(restrictedUser, 'clinic-B', false, fullDefaultCounts);
  assert.equal(after.rejected, true);
  assert.equal(after.targetClinicId, null);
});

await test('canAccessAllClinics=true user CAN target an org sibling clinic they are not explicitly assigned to', async () => {
  const orgWideUser = makeUser({
    clinicId: 'clinic-A',
    allowedClinicIds: [],
    canAccessAllClinics: true,
  });
  const after = await checkLimitAfter(orgWideUser, 'clinic-B', false, fullDefaultCounts);
  assert.equal(after.rejected, false);
  assert.equal(after.targetClinicId, 'clinic-B');
});

section('Requirement 3/4/6 — no explicit target preserves current safe default / single-clinic behavior');

await test('no clinicId supplied → falls back to the requester\'s own resolved default clinic, unchanged', async () => {
  const after = await checkLimitAfter(multiClinicUser, undefined, false, fullDefaultCounts);
  assert.equal(after.rejected, false);
  assert.equal(after.targetClinicId, 'clinic-A', 'defaults to req.user!.clinicId exactly as before the fix');
  assert.equal(after.limits?.userCount, 10);
});

const singleClinicUser = makeUser({
  clinicId: 'clinic-A',
  allowedClinicIds: ['clinic-A'],
  canAccessAllClinics: false,
});

await test('single-clinic user, no explicit target → behavior byte-identical to before the fix', async () => {
  const before = await checkLimitBefore(singleClinicUser, false, fullTargetCounts);
  const after = await checkLimitAfter(singleClinicUser, undefined, false, fullTargetCounts);
  assert.equal(after.targetClinicId, singleClinicUser.clinicId);
  assert.deepEqual(after.limits, before.limits);
});

await test('single-clinic user explicitly re-supplying their own clinicId → identical result, unchanged', async () => {
  const after = await checkLimitAfter(singleClinicUser, 'clinic-A', false, fullTargetCounts);
  assert.equal(after.rejected, false);
  assert.equal(after.targetClinicId, 'clinic-A');
});

section('Requirement 9 — normal organization-plan behavior is unaffected by the target clinic');

await test('org WITH an assigned plan uses org-wide limits regardless of which clinic is targeted', async () => {
  const afterDefault = await checkLimitAfter(multiClinicUser, undefined, true, fullDefaultCounts);
  const afterSibling = await checkLimitAfter(multiClinicUser, 'clinic-B', true, fullDefaultCounts);
  assert.equal(afterDefault.limits?.maxUsers, 10);
  assert.deepEqual(afterDefault.limits, afterSibling.limits, 'org-level quota result identical no matter which accessible clinic is the creation target');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

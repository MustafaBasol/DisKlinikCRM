/**
 * patientMedicalHistoryVersionConcurrency.test.ts — US-01.1-P1.
 *
 * Proves, against a REAL disposable PostgreSQL instance, that medical-history
 * version allocation is concurrency-safe:
 *  - two genuinely concurrent POSTs for the SAME patient (Promise.all, driven
 *    through the REAL route handler chain via getFullChain — same convention
 *    as dbVerification/patientEmergencyContactsPrimaryConcurrency.test.ts)
 *    both succeed and receive distinct, sequential version numbers — unlike
 *    the emergency-contact single-primary race, there is no "loser": both
 *    requests are legitimate history entries, they just need non-colliding
 *    version numbers.
 *  - the database-level @@unique([patientId, version]) constraint rejects a
 *    duplicate pair even when the per-patient advisory lock is bypassed
 *    entirely (a direct two-write race against raw Prisma, with no lock and
 *    no route in between) — proving the DB constraint is a real backstop,
 *    not just documentation.
 *  - concurrent version creation for DIFFERENT patients (including different
 *    organizations) never interferes with each other.
 *
 * JavaScript's single-threaded execution cannot simulate a real database
 * race, so these scenarios MUST run against real Postgres — no mocked Prisma.
 *
 * Run: npx tsx src/tests/dbVerification/patientMedicalHistoryVersionConcurrency.test.ts
 * Requires DATABASE_URL to point at a disposable Postgres before import.
 */

import assert from 'node:assert/strict';
import patientMedicalHistoryRouter from '../../routes/patientMedicalHistory.js';
import {
  createSuite,
  getFullChain,
  runChain,
  mockResponse,
  authRequest,
  createClinicFixtureSet,
  createStaffUser,
  createTestPatient,
  cleanupAllFixtures,
  prisma,
  type ClinicFixtureSet,
} from './dbVerificationHarness.js';

const { section, test, summary } = createSuite('patientMedicalHistoryVersionConcurrency');

const CREATE_CHAIN = getFullChain(patientMedicalHistoryRouter as any, 'post', '/patients/:patientId/medical-history');

// OWNER, not DENTIST: the route's resolvePatientScope() adds an extra
// appointment/treatment-case ownership filter for DENTIST (see
// routes/patientMedicalHistory.ts), which these synthetic fixture patients
// deliberately have none of. Using OWNER isolates the version-allocation
// concurrency behavior under test from that unrelated scoping rule — same
// convention as patientEmergencyContactsPrimaryConcurrency.test.ts's ownerUser().
async function ownerUser(fixtures: ClinicFixtureSet, clinicId: string = fixtures.defaultClinicId) {
  const owner = await createStaffUser({
    organizationId: fixtures.orgId,
    clinicId,
    role: 'OWNER',
    canAccessAllClinics: true,
  });
  return {
    user: owner,
    req: authRequest({
      id: owner.id,
      organizationId: fixtures.orgId,
      clinicId,
      role: 'OWNER',
      canAccessAllClinics: true,
    }),
  };
}

async function callCreate(patientId: string, req: ReturnType<typeof authRequest>, body: Record<string, unknown>) {
  const fullReq = { ...req, params: { patientId }, body } as any;
  const res = mockResponse();
  await runChain(CREATE_CHAIN, fullReq, res);
  return res;
}

function historyBody(overrides: Record<string, unknown> = {}) {
  return {
    noKnownConditions: true,
    conditions: [],
    pregnancyStatus: 'unknown',
    ...overrides,
  };
}

async function versionsFor(patientId: string) {
  return prisma.patientMedicalHistory.findMany({ where: { patientId }, orderBy: { version: 'asc' } });
}

// ─── 1. Two concurrent creates for the same patient ────────────────────────

async function scenarioConcurrentCreatesSamePatient() {
  section('1. Two concurrent CREATEs for the same patient both succeed with distinct, sequential versions');
  const fixtures = await createClinicFixtureSet('mh-concurrent-create');
  const patient = await createTestPatient({ organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId });
  const { req } = await ownerUser(fixtures);

  await test('both concurrent creates return 201 with versions {1, 2} — no duplicate, no unhandled 500', async () => {
    const [resA, resB] = await Promise.all([
      callCreate(patient.id, req, historyBody({ allergies: 'Penicillin' })),
      callCreate(patient.id, req, historyBody({ allergies: 'Latex' })),
    ]);

    assert.equal(resA.statusCode, 201, `create A must succeed, got ${resA.statusCode} ${JSON.stringify(resA.body)}`);
    assert.equal(resB.statusCode, 201, `create B must succeed, got ${resB.statusCode} ${JSON.stringify(resB.body)}`);

    const versions = [resA.body.version, resB.body.version].sort((a, b) => a - b);
    assert.deepEqual(versions, [1, 2], `both requests must land on distinct sequential versions, got ${JSON.stringify(versions)}`);

    const rows = await versionsFor(patient.id);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map(r => r.version), [1, 2]);
  });
}

// ─── 2. Stress: repeated rounds, must be deterministic every round ─────────

async function scenarioConcurrentCreatesStress() {
  const ROUNDS = 15;
  section(`2. Stress: ${ROUNDS} independent rounds of 2 concurrent creates on a fresh patient — always exactly versions {1,2}, never a duplicate`);
  const fixtures = await createClinicFixtureSet('mh-concurrent-stress');
  const { req } = await ownerUser(fixtures);

  await test(`all ${ROUNDS} rounds produce two 201s with distinct sequential versions`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const patient = await createTestPatient({ organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId });

      const [resA, resB] = await Promise.all([
        callCreate(patient.id, req, historyBody()),
        callCreate(patient.id, req, historyBody()),
      ]);

      assert.equal(resA.statusCode, 201, `round ${round}: create A must succeed, got ${resA.statusCode} ${JSON.stringify(resA.body)}`);
      assert.equal(resB.statusCode, 201, `round ${round}: create B must succeed, got ${resB.statusCode} ${JSON.stringify(resB.body)}`);

      const versions = [resA.body.version, resB.body.version].sort((a, b) => a - b);
      assert.deepEqual(versions, [1, 2], `round ${round}: expected versions {1,2}, got ${JSON.stringify(versions)}`);

      const rows = await versionsFor(patient.id);
      assert.equal(rows.length, 2, `round ${round}: exactly 2 rows must exist, got ${rows.length}`);
    }
  });
}

// ─── 3. Higher concurrency: 5 simultaneous creates for one patient ─────────

async function scenarioHigherConcurrency() {
  section('3. 5 simultaneous creates for the same patient all succeed with versions {1..5}, no duplicates');
  const fixtures = await createClinicFixtureSet('mh-concurrent-5way');
  const patient = await createTestPatient({ organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId });
  const { req } = await ownerUser(fixtures);

  await test('5 concurrent creates all succeed and produce exactly versions 1 through 5', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => callCreate(patient.id, req, historyBody())));

    for (const res of results) {
      assert.equal(res.statusCode, 201, `every concurrent create must succeed, got ${res.statusCode} ${JSON.stringify(res.body)}`);
    }

    const versions = results.map(r => r.body.version).sort((a, b) => a - b);
    assert.deepEqual(versions, [1, 2, 3, 4, 5]);

    const rows = await versionsFor(patient.id);
    assert.equal(rows.length, 5);
    const uniqueVersions = new Set(rows.map(r => r.version));
    assert.equal(uniqueVersions.size, 5, 'no duplicate version may exist among the 5 rows');
  });
}

// ─── 4. No cross-patient/tenant interference ───────────────────────────────

async function scenarioNoCrossPatientInterference() {
  section('4. Concurrent version creation on two DIFFERENT patients (different tenants) must not interfere');
  const fixturesX = await createClinicFixtureSet('mh-tenant-x');
  const fixturesY = await createClinicFixtureSet('mh-tenant-y');
  const patientX = await createTestPatient({ organizationId: fixturesX.orgId, clinicId: fixturesX.defaultClinicId });
  const patientY = await createTestPatient({ organizationId: fixturesY.orgId, clinicId: fixturesY.defaultClinicId });
  const { req: reqX } = await ownerUser(fixturesX);
  const { req: reqY } = await ownerUser(fixturesY);

  await test('two unrelated patients (different organizations) each concurrently get version 1 independently', async () => {
    const [resX, resY] = await Promise.all([
      callCreate(patientX.id, reqX, historyBody()),
      callCreate(patientY.id, reqY, historyBody()),
    ]);

    assert.equal(resX.statusCode, 201);
    assert.equal(resY.statusCode, 201);
    assert.equal(resX.body.version, 1);
    assert.equal(resY.body.version, 1);

    const rowX = await prisma.patientMedicalHistory.findUnique({ where: { id: resX.body.id } });
    const rowY = await prisma.patientMedicalHistory.findUnique({ where: { id: resY.body.id } });
    assert.equal(rowX!.organizationId, fixturesX.orgId);
    assert.equal(rowY!.organizationId, fixturesY.orgId);
    assert.notEqual(rowX!.patientId, rowY!.patientId);
  });
}

// ─── 5. Database-level duplicate-version constraint (lock bypassed) ───────

async function scenarioDatabaseConstraintBackstop() {
  section('5. Database-level @@unique([patientId, version]) rejects a duplicate pair even with the advisory lock bypassed entirely');
  const fixtures = await createClinicFixtureSet('mh-db-constraint');
  const patient = await createTestPatient({ organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId });
  const staff = await createStaffUser({ organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId, role: 'DENTIST', canAccessAllClinics: true });

  await test('a second raw insert at the same (patientId, version) — with no lock, no route — fails with P2002', async () => {
    await prisma.patientMedicalHistory.create({
      data: {
        patientId: patient.id,
        clinicId: fixtures.defaultClinicId,
        organizationId: fixtures.orgId,
        version: 1,
        recordedById: staff.id,
        noKnownConditions: true,
      },
    });

    await assert.rejects(
      () =>
        prisma.patientMedicalHistory.create({
          data: {
            patientId: patient.id,
            clinicId: fixtures.defaultClinicId,
            organizationId: fixtures.orgId,
            version: 1, // same version — must collide
            recordedById: staff.id,
            noKnownConditions: true,
          },
        }),
      (err: any) => {
        assert.equal(err.code, 'P2002', `expected a P2002 unique-constraint violation, got ${err.code ?? err.message}`);
        return true;
      },
    );

    const rows = await versionsFor(patient.id);
    assert.equal(rows.length, 1, 'only the first insert may have persisted');
  });
}

// ─── Run ──────────────────────────────────────────────────────────────────

async function main() {
  await scenarioConcurrentCreatesSamePatient();
  await scenarioConcurrentCreatesStress();
  await scenarioHigherConcurrency();
  await scenarioNoCrossPatientInterference();
  await scenarioDatabaseConstraintBackstop();

  const ok = summary();
  await cleanupAllFixtures();
  await prisma.$disconnect();
  process.exit(ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error('FATAL:', err);
  await cleanupAllFixtures().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});

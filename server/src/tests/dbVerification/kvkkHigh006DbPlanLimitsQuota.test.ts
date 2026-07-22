/**
 * kvkkHigh006DbPlanLimitsQuota.test.ts — KVKK-HIGH-006 disposable-Postgres
 * DB-backed verification, scenarios 19-23 (plan-limit / quota target-clinic
 * behavior). This is the one area where NO prior test in this repository
 * exercised the real middleware against a real database — the existing
 * planLimitsTargetClinicFix.test.ts explicitly mirrors the logic in-memory
 * because no live database was reachable at the time it was written. This
 * file runs the REAL authorize() + checkUserLimit/checkPatientLimit +
 * route-handler chain (server/src/middleware/planLimits.ts,
 * server/src/routes/users.ts, server/src/routes/patients.ts) against a real
 * disposable Postgres database.
 *
 *  19. User creation false-allow case: default clinic has capacity, sibling
 *      target is full → request must be BLOCKED
 *  20. User creation false-block case: default clinic is full, sibling target
 *      has capacity → request must be ALLOWED
 *  21. Patient creation equivalents for both directions
 *  22. Invalid/cross-org explicit target rejected before creation
 *  23. req.targetClinicId is the clinic actually used by the created record
 *
 * Both organizations in every fixture here have NO Plan assigned (planId is
 * left null), so getOrgLimits() returns null and the middleware falls
 * through to CLINIC-level limits (Clinic.maxUsers/maxPatients) — this is
 * the exact branch the Batch-4 fix targeted.
 *
 * Run: cd server && npx tsx src/tests/dbVerification/kvkkHigh006DbPlanLimitsQuota.test.ts
 * Requires DATABASE_URL to point at a disposable Postgres.
 */

import assert from 'node:assert/strict';
import usersRouter from '../../routes/users.js';
import patientsRouter from '../../routes/patients.js';
import {
  createSuite,
  createClinicFixtureSet,
  createStaffUser,
  cleanupAllFixtures,
  authRequest,
  mockResponse,
  getFullChain,
  runChain,
  prisma,
} from './dbVerificationHarness.js';

const { section, test, summary } = createSuite('DB-Plan-Limits-Quota');

async function main() {
  // ── Scenario 19: user creation false-allow, fixed → target-full is blocked ──
  section('19. User creation false-allow case: default clinic has capacity, sibling target is full → BLOCKED');
  {
    const fx = await createClinicFixtureSet('quota-19-user');
    await prisma.clinic.update({ where: { id: fx.defaultClinicId }, data: { maxUsers: 10 } }); // requester's own clinic: plenty of room
    await prisma.clinic.update({ where: { id: fx.siblingClinicId }, data: { maxUsers: 1 } }); // real creation target: capacity 1

    const managerRecord = await createStaffUser({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, role: 'CLINIC_MANAGER', allowedClinicIds: [fx.defaultClinicId, fx.siblingClinicId] });
    // Fill the sibling clinic's single seat with an unrelated active membership.
    const fillerUser = await createStaffUser({ organizationId: fx.orgId, clinicId: fx.siblingClinicId, role: 'RECEPTIONIST', allowedClinicIds: [fx.siblingClinicId] });
    void fillerUser;

    const manager = { id: managerRecord.id, clinicId: fx.defaultClinicId, role: 'CLINIC_MANAGER', normalizedRole: 'CLINIC_MANAGER', organizationId: fx.orgId, allowedClinicIds: [fx.defaultClinicId, fx.siblingClinicId], canAccessAllClinics: false };
    const chain = getFullChain(usersRouter as any, 'post', '/users');
    const req = authRequest(manager, {
      query: { clinicId: fx.siblingClinicId },
      body: { firstName: 'New', lastName: 'Hire', email: `new-hire-19-${Date.now()}@example.invalid`, role: 'receptionist', password: 'SuperSecret123' },
    });
    const res = mockResponse();
    await runChain(chain, req, res);

    await test('user creation targeting the FULL sibling clinic is blocked (402), even though the requester\'s own default clinic has room', () => {
      assert.equal(res.statusCode, 402, JSON.stringify(res.body));
    });
    await test('req.targetClinicId was resolved to the real target (sibling), proving the check evaluated the correct clinic, not the default', () => {
      assert.equal(req.targetClinicId, fx.siblingClinicId);
    });
    await test('no user row was created in the sibling clinic as a result of the blocked request', async () => {
      const count = await prisma.user.count({ where: { clinicId: fx.siblingClinicId, email: { contains: 'new-hire-19-' } } });
      assert.equal(count, 0);
    });
  }

  // ── Scenario 20: user creation false-block, fixed → target-with-room is allowed ──
  section('20. User creation false-block case: default clinic is full, sibling target has capacity → ALLOWED');
  {
    const fx = await createClinicFixtureSet('quota-20-user');
    await prisma.clinic.update({ where: { id: fx.defaultClinicId }, data: { maxUsers: 1 } }); // requester's own clinic: AT capacity
    await prisma.clinic.update({ where: { id: fx.siblingClinicId }, data: { maxUsers: 10 } }); // real creation target: plenty of room

    const managerRecord = await createStaffUser({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, role: 'CLINIC_MANAGER', allowedClinicIds: [fx.defaultClinicId, fx.siblingClinicId] });
    // Fill the default clinic's single seat (with the manager's own membership).

    const manager = { id: managerRecord.id, clinicId: fx.defaultClinicId, role: 'CLINIC_MANAGER', normalizedRole: 'CLINIC_MANAGER', organizationId: fx.orgId, allowedClinicIds: [fx.defaultClinicId, fx.siblingClinicId], canAccessAllClinics: false };
    const chain = getFullChain(usersRouter as any, 'post', '/users');
    const email = `new-hire-20-${Date.now()}@example.invalid`;
    const req = authRequest(manager, {
      query: { clinicId: fx.siblingClinicId },
      body: { firstName: 'New', lastName: 'Hire', email, role: 'receptionist', password: 'SuperSecret123!' },
    });
    const res = mockResponse();
    await runChain(chain, req, res);

    await test('user creation targeting the sibling clinic (which has room) is ALLOWED (201), even though the requester\'s own default clinic is full', () => {
      assert.equal(res.statusCode, 201, JSON.stringify(res.body));
    });
    await test('req.targetClinicId equals the sibling clinic', () => {
      assert.equal(req.targetClinicId, fx.siblingClinicId);
    });
    await test('the created user row is actually stored under the sibling clinic in Postgres (scenario 23 for users)', async () => {
      const row = await prisma.user.findFirst({ where: { email: email.toLowerCase() } });
      assert.ok(row);
      assert.equal(row!.clinicId, fx.siblingClinicId);
      assert.equal(row!.clinicId, req.targetClinicId);
    });
  }

  // ── Scenario 21: patient creation equivalents ──
  section('21. Patient creation false-allow (target full) → BLOCKED');
  {
    const fx = await createClinicFixtureSet('quota-21a-patient');
    await prisma.clinic.update({ where: { id: fx.defaultClinicId }, data: { maxPatients: 10 } });
    await prisma.clinic.update({ where: { id: fx.siblingClinicId }, data: { maxPatients: 1 } });
    // Pre-fill the sibling clinic's single patient seat.
    await prisma.patient.create({ data: { organizationId: fx.orgId, clinicId: fx.siblingClinicId, firstName: 'Filler', lastName: 'Patient', phone: '+905551110000' } });

    const receptionistRecord = await createStaffUser({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, role: 'RECEPTIONIST', allowedClinicIds: [fx.defaultClinicId, fx.siblingClinicId] });
    const receptionist = { id: receptionistRecord.id, clinicId: fx.defaultClinicId, role: 'RECEPTIONIST', normalizedRole: 'RECEPTIONIST', organizationId: fx.orgId, allowedClinicIds: [fx.defaultClinicId, fx.siblingClinicId], canAccessAllClinics: false };
    const chain = getFullChain(patientsRouter as any, 'post', '/patients');
    const req = authRequest(receptionist, { query: { clinicId: fx.siblingClinicId }, body: { firstName: 'Blocked', lastName: 'Patient' } });
    const res = mockResponse();
    await runChain(chain, req, res);

    await test('patient creation targeting the FULL sibling clinic is blocked (402)', () => {
      assert.equal(res.statusCode, 402, JSON.stringify(res.body));
    });
    await test('no extra patient row exists in the sibling clinic beyond the pre-existing filler', async () => {
      const count = await prisma.patient.count({ where: { clinicId: fx.siblingClinicId } });
      assert.equal(count, 1);
    });
  }

  section('21. Patient creation false-block (target has room) → ALLOWED');
  {
    const fx = await createClinicFixtureSet('quota-21b-patient');
    await prisma.clinic.update({ where: { id: fx.defaultClinicId }, data: { maxPatients: 1 } });
    await prisma.clinic.update({ where: { id: fx.siblingClinicId }, data: { maxPatients: 10 } });
    // Fill the default clinic's single patient seat.
    await prisma.patient.create({ data: { organizationId: fx.orgId, clinicId: fx.defaultClinicId, firstName: 'Filler', lastName: 'Patient', phone: '+905551110001' } });

    const receptionistRecord = await createStaffUser({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, role: 'RECEPTIONIST', allowedClinicIds: [fx.defaultClinicId, fx.siblingClinicId] });
    const receptionist = { id: receptionistRecord.id, clinicId: fx.defaultClinicId, role: 'RECEPTIONIST', normalizedRole: 'RECEPTIONIST', organizationId: fx.orgId, allowedClinicIds: [fx.defaultClinicId, fx.siblingClinicId], canAccessAllClinics: false };
    const chain = getFullChain(patientsRouter as any, 'post', '/patients');
    const req = authRequest(receptionist, { query: { clinicId: fx.siblingClinicId }, body: { firstName: 'Allowed', lastName: 'Patient' } });
    const res = mockResponse();
    await runChain(chain, req, res);

    await test('patient creation targeting the sibling clinic (with room) is ALLOWED (200/201), even though the default clinic is full', () => {
      assert.ok(res.statusCode === 200 || res.statusCode === 201, JSON.stringify(res.body));
    });
    await test('the created patient is stored under the sibling clinic, matching req.targetClinicId (scenario 23 for patients)', async () => {
      const row = await prisma.patient.findFirst({ where: { clinicId: fx.siblingClinicId, firstName: 'Allowed' } });
      assert.ok(row);
      assert.equal(row!.clinicId, req.targetClinicId);
    });
  }

  // ── Scenario 22: invalid/cross-org explicit target rejected before creation ──
  section('22. Invalid/cross-org explicit target rejected before creation (users & patients)');
  {
    const fx = await createClinicFixtureSet('quota-22-crossorg');
    const managerRecord = await createStaffUser({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, role: 'CLINIC_MANAGER', allowedClinicIds: [fx.defaultClinicId, fx.siblingClinicId] });
    const manager = { id: managerRecord.id, clinicId: fx.defaultClinicId, role: 'CLINIC_MANAGER', normalizedRole: 'CLINIC_MANAGER', organizationId: fx.orgId, allowedClinicIds: [fx.defaultClinicId, fx.siblingClinicId], canAccessAllClinics: false };

    const userChain = getFullChain(usersRouter as any, 'post', '/users');
    const email = `cross-org-22-${Date.now()}@example.invalid`;
    const userReq = authRequest(manager, { query: { clinicId: fx.crossOrgClinicId }, body: { firstName: 'Cross', lastName: 'Org', email, role: 'receptionist', password: 'SuperSecret123' } });
    const userRes = mockResponse();
    await runChain(userChain, userReq, userRes);
    await test('user creation: explicit cross-org target → 403 before any quota check or row creation', async () => {
      assert.equal(userRes.statusCode, 403);
      assert.equal(userReq.targetClinicId, undefined, 'targetClinicId must never be set for a rejected cross-org target');
      const leaked = await prisma.user.findFirst({ where: { email: email.toLowerCase() } });
      assert.equal(leaked, null);
    });

    const patientChain = getFullChain(patientsRouter as any, 'post', '/patients');
    const patientReq = authRequest(manager, { query: { clinicId: fx.crossOrgClinicId }, body: { firstName: 'CrossOrgPatient', lastName: 'Rejected' } });
    const patientRes = mockResponse();
    await runChain(patientChain, patientReq, patientRes);
    await test('patient creation: explicit cross-org target → 403 before any quota check or row creation', async () => {
      assert.equal(patientRes.statusCode, 403);
      const leaked = await prisma.patient.findFirst({ where: { firstName: 'CrossOrgPatient' } });
      assert.equal(leaked, null);
    });

    const unauthReq = authRequest(manager, { query: { clinicId: fx.unauthorizedClinicId }, body: { firstName: 'UnauthPatient', lastName: 'Rejected' } });
    const unauthRes = mockResponse();
    await runChain(patientChain, unauthReq, unauthRes);
    await test('patient creation: explicit unauthorized same-org target (never assigned) → 403, no row created', async () => {
      assert.equal(unauthRes.statusCode, 403);
      const leaked = await prisma.patient.findFirst({ where: { firstName: 'UnauthPatient' } });
      assert.equal(leaked, null);
    });
  }

  await cleanupAllFixtures();
  const ok = summary();
  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal error in kvkkHigh006DbPlanLimitsQuota.test.ts:', err);
  process.exit(1);
});

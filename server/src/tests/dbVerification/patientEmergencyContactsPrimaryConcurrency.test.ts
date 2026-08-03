/**
 * patientEmergencyContactsPrimaryConcurrency.test.ts — US-01.2 AI-review
 * blocker fix; extended for F1-004-P1.
 *
 * The "at most one isPrimary=true PatientEmergencyContact per patient"
 * invariant is enforced by a per-patient PostgreSQL advisory transaction
 * lock combined with an optimistic snapshot check (claimPrimaryContactSlot,
 * server/src/services/patientEmergencyContactPrimaryLock.ts), backed by a
 * database-level partial unique index (PatientEmergencyContact_
 * one_primary_per_patient, WHERE isPrimary = true — see migration
 * 20260803120000_add_patient_emergency_contacts/migration.sql) as a
 * physical backstop.
 *
 * F1-004-P1: scenario 2 below (concurrent UPDATEs of different existing
 * contacts) previously failed deterministically in CI (run 30813103465,
 * both attempts) with A=200 B=200 — the unique index alone does not stop a
 * second transaction's reset-then-set from clearing the first transaction's
 * already-committed primary and setting its own row, since that sequence
 * never itself collides with the index. See the lock helper's file header
 * for the full root-cause analysis and docs/program/evidence/F1-004-P1_*
 * for the CI evidence and forced-interleaving local reproduction.
 *
 * This suite proves the invariant against a REAL disposable PostgreSQL
 * instance, driving genuinely concurrent Promise.all() calls into the REAL
 * Express route handlers (authorize() + the handler, extracted via
 * getFullChain — same convention as
 * dbVerification/appointmentRequestConversionAtomicity.test.ts). No mocked
 * Prisma, no in-memory simulation of the race itself — JavaScript's
 * single-threaded execution cannot simulate a real database race, so the
 * concurrency scenarios below MUST run against real Postgres.
 *
 * Run: npx tsx src/tests/dbVerification/patientEmergencyContactsPrimaryConcurrency.test.ts
 * Requires DATABASE_URL to point at a disposable Postgres before import.
 */

import assert from 'node:assert/strict';
import patientEmergencyContactsRouter from '../../routes/patientEmergencyContacts.js';
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

const { section, test, summary } = createSuite('patientEmergencyContactsPrimaryConcurrency');

const CREATE_CHAIN = getFullChain(patientEmergencyContactsRouter as any, 'post', '/patients/:patientId/emergency-contacts');
const UPDATE_CHAIN = getFullChain(patientEmergencyContactsRouter as any, 'put', '/patients/:patientId/emergency-contacts/:contactId');

async function ownerUser(fixtures: ClinicFixtureSet, clinicId: string = fixtures.defaultClinicId) {
  const owner = await createStaffUser({
    organizationId: fixtures.orgId,
    clinicId,
    role: 'OWNER',
    canAccessAllClinics: true,
  });
  return authRequest({
    id: owner.id,
    organizationId: fixtures.orgId,
    clinicId,
    role: 'OWNER',
    canAccessAllClinics: true,
  });
}

async function callCreate(patientId: string, user: ReturnType<typeof authRequest>, body: Record<string, unknown>) {
  const req = { ...user, params: { patientId }, body } as any;
  const res = mockResponse();
  await runChain(CREATE_CHAIN, req, res);
  return res;
}

async function callUpdate(patientId: string, contactId: string, user: ReturnType<typeof authRequest>, body: Record<string, unknown>) {
  const req = { ...user, params: { patientId, contactId }, body } as any;
  const res = mockResponse();
  await runChain(UPDATE_CHAIN, req, res);
  return res;
}

let contactCounter = 0;
function contactBody(overrides: Record<string, unknown> = {}) {
  contactCounter += 1;
  return {
    contactType: 'PARENT',
    fullName: `Concurrency Contact ${contactCounter}`,
    phone: `+90555${String(contactCounter).padStart(7, '0')}`,
    isPrimary: false,
    isLegalDecisionMaker: false,
    ...overrides,
  };
}

async function primaryCount(patientId: string) {
  return prisma.patientEmergencyContact.count({ where: { patientId, isPrimary: true } });
}

async function allContacts(patientId: string) {
  return prisma.patientEmergencyContact.findMany({ where: { patientId }, orderBy: { createdAt: 'asc' } });
}

function isConflict(res: { statusCode: number; body: any }) {
  return res.statusCode === 409 && res.body?.code === 'PRIMARY_CONTACT_CONFLICT';
}

// ─── 1. Two concurrent creates for the same patient, both isPrimary=true ────

async function scenarioConcurrentCreatesSamePatient() {
  section('1. Two concurrent CREATEs for the same patient, both requesting isPrimary=true');
  const fixtures = await createClinicFixtureSet('ec-concurrent-create');
  const patient = await createTestPatient({ organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId });
  const user = await ownerUser(fixtures);

  await test('exactly one of two truly concurrent creates succeeds as primary; the loser gets a controlled 409 PRIMARY_CONTACT_CONFLICT, never a 500', async () => {
    const [resA, resB] = await Promise.all([
      callCreate(patient.id, user, contactBody({ isPrimary: true })),
      callCreate(patient.id, user, contactBody({ isPrimary: true })),
    ]);

    const successCount = [resA, resB].filter(r => r.statusCode === 201).length;
    assert.equal(successCount, 1, `exactly one concurrent create must succeed as primary — got A=${resA.statusCode} B=${resB.statusCode}`);

    const loser = resA.statusCode === 201 ? resB : resA;
    assert.ok(isConflict(loser), `loser must get the documented controlled 409 PRIMARY_CONTACT_CONFLICT, got ${loser.statusCode} ${JSON.stringify(loser.body)}`);
    assert.equal(typeof loser.body.error, 'string');
    assert.ok(!/prisma|postgres|constraint|P2002/i.test(loser.body.error), 'the 409 message must not leak internal DB details');

    // Scenario 3: after the race, no more than one primary contact exists.
    assert.equal(await primaryCount(patient.id), 1, 'no more than one primary contact may exist after the race');

    // The loser's create must not have silently persisted a second primary
    // (and, since it failed, must not have persisted at all).
    const contacts = await allContacts(patient.id);
    assert.equal(contacts.length, 1, 'the losing create must not leave behind a non-primary orphan row either — the whole transaction rolled back');
  });
}

// ─── 2. Two concurrent updates of different contacts, both isPrimary=true ───

async function scenarioConcurrentUpdatesDifferentContacts() {
  section('2. Two concurrent UPDATEs of DIFFERENT existing contacts, both requesting isPrimary=true');
  const fixtures = await createClinicFixtureSet('ec-concurrent-update');
  const patient = await createTestPatient({ organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId });
  const user = await ownerUser(fixtures);

  const createA = await callCreate(patient.id, user, contactBody({ isPrimary: false }));
  const createB = await callCreate(patient.id, user, contactBody({ isPrimary: false }));
  assert.equal(createA.statusCode, 201);
  assert.equal(createB.statusCode, 201);
  const contactAId = createA.body.id;
  const contactBId = createB.body.id;

  await test('exactly one of two concurrent updates (different contacts, both -> isPrimary=true) wins; the other gets 409 PRIMARY_CONTACT_CONFLICT; at most one primary afterwards', async () => {
    const [resA, resB] = await Promise.all([
      callUpdate(patient.id, contactAId, user, { isPrimary: true }),
      callUpdate(patient.id, contactBId, user, { isPrimary: true }),
    ]);

    const successCount = [resA, resB].filter(r => r.statusCode === 200).length;
    assert.equal(successCount, 1, `exactly one concurrent update must succeed as primary — got A=${resA.statusCode} B=${resB.statusCode}`);

    const loser = resA.statusCode === 200 ? resB : resA;
    assert.ok(isConflict(loser), `loser must get the documented controlled 409 PRIMARY_CONTACT_CONFLICT, got ${loser.statusCode} ${JSON.stringify(loser.body)}`);

    assert.equal(await primaryCount(patient.id), 1, 'no more than one primary contact may exist after the race');

    // The losing update must not have mutated its target row at all (whole transaction rolled back).
    const loserContactId = resA.statusCode === 200 ? contactBId : contactAId;
    const loserRow = await prisma.patientEmergencyContact.findUnique({ where: { id: loserContactId } });
    assert.equal(loserRow!.isPrimary, false, 'the losing update must have left its target row untouched (isPrimary still false)');
  });
}

// ─── 5. No unrelated patient or tenant contact is modified by the race ──────

async function scenarioNoCrossPatientInterference() {
  section('5. Concurrent primary races on two DIFFERENT patients (different tenants) must not interfere with each other');
  const fixturesX = await createClinicFixtureSet('ec-tenant-x');
  const fixturesY = await createClinicFixtureSet('ec-tenant-y');
  const patientX = await createTestPatient({ organizationId: fixturesX.orgId, clinicId: fixturesX.defaultClinicId });
  const patientY = await createTestPatient({ organizationId: fixturesY.orgId, clinicId: fixturesY.defaultClinicId });
  const userX = await ownerUser(fixturesX);
  const userY = await ownerUser(fixturesY);

  await test('two unrelated patients (different organizations) each concurrently getting a primary contact both succeed independently — no cross-tenant blocking, no cross-tenant row touched', async () => {
    const [resX, resY] = await Promise.all([
      callCreate(patientX.id, userX, contactBody({ isPrimary: true })),
      callCreate(patientY.id, userY, contactBody({ isPrimary: true })),
    ]);

    assert.equal(resX.statusCode, 201, `patient X's create must succeed independently, got ${resX.statusCode} ${JSON.stringify(resX.body)}`);
    assert.equal(resY.statusCode, 201, `patient Y's create must succeed independently, got ${resY.statusCode} ${JSON.stringify(resY.body)}`);

    assert.equal(await primaryCount(patientX.id), 1);
    assert.equal(await primaryCount(patientY.id), 1);

    const contactsX = await allContacts(patientX.id);
    const contactsY = await allContacts(patientY.id);
    assert.equal(contactsX.length, 1, 'patient X must have exactly its own one contact, untouched by patient Y\'s race');
    assert.equal(contactsY.length, 1, 'patient Y must have exactly its own one contact, untouched by patient X\'s race');
    assert.notEqual(contactsX[0].id, contactsY[0].id);
    assert.equal(contactsX[0].organizationId, fixturesX.orgId);
    assert.equal(contactsY[0].organizationId, fixturesY.orgId);
  });
}

// ─── 6. Multiple isPrimary=false rows remain allowed (no false-positive lock) ─

async function scenarioMultipleNonPrimaryRowsAllowed() {
  section('6. Multiple concurrent isPrimary=false contacts for the same patient must all persist (the partial index must never block non-primary rows)');
  const fixtures = await createClinicFixtureSet('ec-multi-non-primary');
  const patient = await createTestPatient({ organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId });
  const user = await ownerUser(fixtures);

  await test('5 concurrent non-primary creates for the same patient all succeed with 201', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => callCreate(patient.id, user, contactBody({ isPrimary: false }))),
    );

    for (const res of results) {
      assert.equal(res.statusCode, 201, `every non-primary create must succeed, got ${res.statusCode} ${JSON.stringify(res.body)}`);
    }

    const contacts = await allContacts(patient.id);
    assert.equal(contacts.length, 5, 'all 5 non-primary contacts must be persisted — the partial unique index only restricts isPrimary=true rows');
    assert.equal(await primaryCount(patient.id), 0);
  });
}

// ─── 7. Multiple legal decision-makers remain allowed under concurrency ─────

async function scenarioMultipleLegalDecisionMakersAllowed() {
  section('7. Multiple concurrent legal-decision-maker contacts for the same patient must all persist (isLegalDecisionMaker is never deduplicated)');
  const fixtures = await createClinicFixtureSet('ec-multi-legal-dm');
  const patient = await createTestPatient({ organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId });
  const user = await ownerUser(fixtures);

  await test('2 concurrent isLegalDecisionMaker=true, isPrimary=false creates both succeed and both retain the flag', async () => {
    const [resA, resB] = await Promise.all([
      callCreate(patient.id, user, contactBody({ isLegalDecisionMaker: true, isPrimary: false })),
      callCreate(patient.id, user, contactBody({ isLegalDecisionMaker: true, isPrimary: false })),
    ]);

    assert.equal(resA.statusCode, 201, `first legal-decision-maker create must succeed, got ${resA.statusCode} ${JSON.stringify(resA.body)}`);
    assert.equal(resB.statusCode, 201, `second legal-decision-maker create must succeed, got ${resB.statusCode} ${JSON.stringify(resB.body)}`);

    const contacts = await allContacts(patient.id);
    assert.equal(contacts.length, 2);
    assert.ok(contacts.every(c => c.isLegalDecisionMaker === true), 'both contacts must retain isLegalDecisionMaker=true — never deduplicated');
    assert.equal(await primaryCount(patient.id), 0, 'neither was requested as primary, so none should be');
  });
}

// ─── 8. Two different patients in the SAME clinic must not cross-block ──────

async function scenarioSameClinicDifferentPatientsNoCrossBlocking() {
  section('8. Concurrent primary races on two DIFFERENT patients in the SAME clinic must not interfere with each other');
  const fixtures = await createClinicFixtureSet('ec-same-clinic-two-patients');
  const patient1 = await createTestPatient({ organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId });
  const patient2 = await createTestPatient({ organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId });
  const user = await ownerUser(fixtures);

  await test('two patients sharing the same clinic each concurrently getting a primary contact both succeed independently — the per-patient lock key does not collide within a clinic', async () => {
    const [res1, res2] = await Promise.all([
      callCreate(patient1.id, user, contactBody({ isPrimary: true })),
      callCreate(patient2.id, user, contactBody({ isPrimary: true })),
    ]);

    assert.equal(res1.statusCode, 201, `patient 1's create must succeed independently, got ${res1.statusCode} ${JSON.stringify(res1.body)}`);
    assert.equal(res2.statusCode, 201, `patient 2's create must succeed independently, got ${res2.statusCode} ${JSON.stringify(res2.body)}`);

    assert.equal(await primaryCount(patient1.id), 1);
    assert.equal(await primaryCount(patient2.id), 1);
  });
}

// ─── 9. Sequential primary replacement remains backward compatible ─────────

async function scenarioSequentialPrimaryReplacementBackwardCompatible() {
  section('9. Sequential (non-racing) primary reassignment must keep working exactly as before the fix');
  const fixtures = await createClinicFixtureSet('ec-sequential-replace');
  const patient = await createTestPatient({ organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId });
  const user = await ownerUser(fixtures);

  const createA = await callCreate(patient.id, user, contactBody({ isPrimary: false }));
  const createB = await callCreate(patient.id, user, contactBody({ isPrimary: false }));
  assert.equal(createA.statusCode, 201);
  assert.equal(createB.statusCode, 201);
  const contactAId = createA.body.id;
  const contactBId = createB.body.id;

  await test('setting contact A primary, then (fully sequentially, no overlap) switching to contact B, succeeds both times and ends with exactly B primary', async () => {
    const resA = await callUpdate(patient.id, contactAId, user, { isPrimary: true });
    assert.equal(resA.statusCode, 200, `sequential first promotion must succeed, got ${resA.statusCode} ${JSON.stringify(resA.body)}`);
    assert.equal(await primaryCount(patient.id), 1);

    const resB = await callUpdate(patient.id, contactBId, user, { isPrimary: true });
    assert.equal(resB.statusCode, 200, `sequential reassignment to a different contact must succeed (not treated as a race), got ${resB.statusCode} ${JSON.stringify(resB.body)}`);

    assert.equal(await primaryCount(patient.id), 1, 'exactly one primary after the sequential reassignment');
    const [rowA, rowB] = await Promise.all([
      prisma.patientEmergencyContact.findUnique({ where: { id: contactAId } }),
      prisma.patientEmergencyContact.findUnique({ where: { id: contactBId } }),
    ]);
    assert.equal(rowA!.isPrimary, false, 'A must have been demoted by the sequential switch to B');
    assert.equal(rowB!.isPrimary, true, 'B must now be the sole primary contact');
  });
}

// ─── 10. Repeated race loop: determinism across many rounds ────────────────

async function scenarioRepeatedConcurrentUpdateRaceLoop() {
  section('10. Repeated concurrent-UPDATE race, many rounds — determinism, not a one-off pass');
  const ROUNDS = 15; // bounded: each round is two in-process concurrent handler calls against real Postgres
  const fixtures = await createClinicFixtureSet('ec-repeated-race-loop');
  const patient = await createTestPatient({ organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId });
  const user = await ownerUser(fixtures);

  await test(`${ROUNDS} repeated rounds of the concurrent-UPDATE-to-primary race each resolve to exactly one 200 winner and one 409 loser, never both/neither`, async () => {
    for (let round = 1; round <= ROUNDS; round += 1) {
      const createA = await callCreate(patient.id, user, contactBody({ isPrimary: false }));
      const createB = await callCreate(patient.id, user, contactBody({ isPrimary: false }));
      assert.equal(createA.statusCode, 201);
      assert.equal(createB.statusCode, 201);

      const [resA, resB] = await Promise.all([
        callUpdate(patient.id, createA.body.id, user, { isPrimary: true }),
        callUpdate(patient.id, createB.body.id, user, { isPrimary: true }),
      ]);

      const successCount = [resA, resB].filter(r => r.statusCode === 200).length;
      assert.equal(successCount, 1, `round ${round}: exactly one concurrent update must succeed — got A=${resA.statusCode} B=${resB.statusCode}`);
      const loser = resA.statusCode === 200 ? resB : resA;
      assert.ok(isConflict(loser), `round ${round}: loser must get the controlled 409 PRIMARY_CONTACT_CONFLICT, got ${loser.statusCode} ${JSON.stringify(loser.body)}`);
      assert.equal(await primaryCount(patient.id), 1, `round ${round}: at most one primary contact after the race`);

      // Reset for the next round: clear the current primary via a plain sequential update.
      const winnerId = resA.statusCode === 200 ? createA.body.id : createB.body.id;
      const clear = await callUpdate(patient.id, winnerId, user, { isPrimary: false });
      assert.equal(clear.statusCode, 200, `round ${round}: resetting the winner back to non-primary must succeed`);
    }
  });
}

// ─── Run ──────────────────────────────────────────────────────────────────

async function main() {
  await scenarioConcurrentCreatesSamePatient();
  await scenarioConcurrentUpdatesDifferentContacts();
  await scenarioNoCrossPatientInterference();
  await scenarioMultipleNonPrimaryRowsAllowed();
  await scenarioMultipleLegalDecisionMakersAllowed();
  await scenarioSameClinicDifferentPatientsNoCrossBlocking();
  await scenarioSequentialPrimaryReplacementBackwardCompatible();
  await scenarioRepeatedConcurrentUpdateRaceLoop();

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

/**
 * patientEmergencyContactsPrimaryConcurrency.test.ts — US-01.2 AI-review
 * blocker fix.
 *
 * The "at most one isPrimary=true PatientEmergencyContact per patient"
 * invariant used to be enforced only by an application-level
 * prisma.$transaction() reset-then-set sequence in server/src/routes/
 * patientEmergencyContacts.ts, which cannot by itself stop two genuinely
 * concurrent requests from each completing with their own primary row. It is
 * now additionally enforced by a database-level partial unique index
 * (PatientEmergencyContact_one_primary_per_patient, WHERE isPrimary = true —
 * see migration 20260803120000_add_patient_emergency_contacts/migration.sql).
 *
 * This suite proves that invariant against a REAL disposable PostgreSQL
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

// ─── 2b. Stress: same UPDATE race, run repeatedly to demonstrate determinism ─

async function scenarioConcurrentUpdatesStress() {
  const ROUNDS = 25;
  section(`2b. Stress: ${ROUNDS} independent rounds of the DIFFERENT-contacts UPDATE race, each on a fresh patient — must be deterministic every round`);
  const fixtures = await createClinicFixtureSet('ec-concurrent-update-stress');
  const user = await ownerUser(fixtures);

  let onePassOneConflict = 0;
  let exactlyOnePrimaryAfter = 0;

  await test(`all ${ROUNDS} rounds produce exactly one 200 + one 409 PRIMARY_CONTACT_CONFLICT, and exactly one primary contact afterwards`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const patient = await createTestPatient({ organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId });

      const createA = await callCreate(patient.id, user, contactBody({ isPrimary: false }));
      const createB = await callCreate(patient.id, user, contactBody({ isPrimary: false }));
      assert.equal(createA.statusCode, 201, `round ${round}: setup create A must succeed`);
      assert.equal(createB.statusCode, 201, `round ${round}: setup create B must succeed`);

      const [resA, resB] = await Promise.all([
        callUpdate(patient.id, createA.body.id, user, { isPrimary: true }),
        callUpdate(patient.id, createB.body.id, user, { isPrimary: true }),
      ]);

      const successCount = [resA, resB].filter(r => r.statusCode === 200).length;
      const loser = resA.statusCode === 200 ? resB : resA;
      const winner = resA.statusCode === 200 ? resA : resB;

      assert.equal(
        successCount,
        1,
        `round ${round}: exactly one concurrent update must succeed — got A=${resA.statusCode} B=${resB.statusCode} bodies=${JSON.stringify(resA.body)} / ${JSON.stringify(resB.body)}`,
      );
      assert.ok(
        isConflict(loser),
        `round ${round}: the loser must get the documented controlled 409 PRIMARY_CONTACT_CONFLICT, got ${loser.statusCode} ${JSON.stringify(loser.body)}`,
      );
      assert.equal(winner.statusCode, 200, `round ${round}: the winner must get 200`);
      onePassOneConflict++;

      const finalPrimaryCount = await primaryCount(patient.id);
      assert.equal(finalPrimaryCount, 1, `round ${round}: exactly one primary contact must exist after the race, got ${finalPrimaryCount}`);
      exactlyOnePrimaryAfter++;
    }

    console.log(`    [stress summary] rounds=${ROUNDS} one-200-one-409=${onePassOneConflict}/${ROUNDS} exactly-one-primary=${exactlyOnePrimaryAfter}/${ROUNDS}`);
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

// ─── Run ──────────────────────────────────────────────────────────────────

async function main() {
  await scenarioConcurrentCreatesSamePatient();
  await scenarioConcurrentUpdatesDifferentContacts();
  await scenarioConcurrentUpdatesStress();
  await scenarioNoCrossPatientInterference();
  await scenarioMultipleNonPrimaryRowsAllowed();
  await scenarioMultipleLegalDecisionMakersAllowed();

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

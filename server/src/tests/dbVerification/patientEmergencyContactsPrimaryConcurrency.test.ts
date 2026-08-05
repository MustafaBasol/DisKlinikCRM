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

// ─── Stress round configuration (Copilot review, PR #325) ──────────────────
//
// CI must always exercise the full committed defaults below. Neither
// ci-layers.yml/ci-pr.yml nor server:test:disposable-db ever set
// PATIENT_EMERGENCY_CONTACT_{CREATE,UPDATE}_RACE_ROUNDS, so every CI run
// resolves to exactly 100 / 150 rounds regardless of this mechanism's
// existence. The two env vars below exist ONLY so a developer can dial the
// round count down (or up) for a local diagnostic run without editing this
// file. An explicitly-provided override is strictly validated — never
// silently coerced, clamped, or ignored on failure — so a typo or bad value
// fails loudly (throws at import time, before any DB work) instead of
// quietly changing what "the full stress suite" actually exercised.
export const DEFAULT_CREATE_RACE_ROUNDS = 100;
export const DEFAULT_UPDATE_RACE_ROUNDS = 150;

const LOCAL_FAST_MODE_ENV_VAR = 'PATIENT_EMERGENCY_CONTACT_RACE_LOCAL_FAST_MODE';
// A round count below this is too low to meaningfully "stress" anything —
// only local-fast-mode (a separate, explicit opt-in) may go lower, and even
// then never below 1.
const MIN_ROUNDS_WITHOUT_FAST_MODE = 10;
const MAX_ROUNDS = 100_000;

/**
 * Validates and resolves a single round-count override. Exported so the
 * config-validation tests in section 0 below can exercise every rejection
 * path directly, without ever mutating real process.env (which would risk
 * affecting the rest of this file's own module-scope resolution below).
 */
export function parseRaceRoundOverride(
  envVarName: string,
  rawValue: string | undefined,
  defaultValue: number,
  fastModeEnabled: boolean,
): number {
  if (rawValue === undefined) return defaultValue;

  const trimmed = rawValue.trim();
  if (trimmed.length === 0) {
    throw new Error(
      `${envVarName} is set but empty — remove the variable to use the default (${defaultValue}), or provide a bounded positive integer.`,
    );
  }
  if (!/^[0-9]+$/.test(trimmed)) {
    throw new Error(
      `${envVarName}="${rawValue}" is not a valid bounded positive integer (digits only — no sign, decimal point, or other characters).`,
    );
  }

  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${envVarName}="${rawValue}" is not a safe integer.`);
  }
  if (value === 0) {
    throw new Error(`${envVarName}="${rawValue}" must be a positive integer greater than zero (0 is not allowed).`);
  }

  const minAllowed = fastModeEnabled ? 1 : MIN_ROUNDS_WITHOUT_FAST_MODE;
  if (value < minAllowed) {
    throw new Error(
      `${envVarName}="${rawValue}" is below the minimum of ${minAllowed} round(s). ` +
        `Set ${LOCAL_FAST_MODE_ENV_VAR}=true to allow values as low as 1 for local diagnostic runs only.`,
    );
  }
  if (value > MAX_ROUNDS) {
    throw new Error(`${envVarName}="${rawValue}" exceeds the maximum of ${MAX_ROUNDS} rounds.`);
  }

  return value;
}

function resolveRaceRounds(envVarName: string, defaultValue: number): { rounds: number; source: 'default' | 'env-override' } {
  const rawValue = process.env[envVarName];
  const fastModeEnabled = process.env[LOCAL_FAST_MODE_ENV_VAR] === 'true';
  const rounds = parseRaceRoundOverride(envVarName, rawValue, defaultValue, fastModeEnabled);
  return { rounds, source: rawValue === undefined ? 'default' : 'env-override' };
}

const createRoundsConfig = resolveRaceRounds('PATIENT_EMERGENCY_CONTACT_CREATE_RACE_ROUNDS', DEFAULT_CREATE_RACE_ROUNDS);
const updateRoundsConfig = resolveRaceRounds('PATIENT_EMERGENCY_CONTACT_UPDATE_RACE_ROUNDS', DEFAULT_UPDATE_RACE_ROUNDS);

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

// ─── 0. Stress-round configuration is validated, never silently defaulted ──

async function scenarioStressRoundConfiguration() {
  section('0. Stress-round configuration: env overrides are validated (bounded positive integers), never silently defaulted');

  await test('variables absent -> defaults 100 (create) / 150 (update)', () => {
    assert.equal(parseRaceRoundOverride('PATIENT_EMERGENCY_CONTACT_CREATE_RACE_ROUNDS', undefined, DEFAULT_CREATE_RACE_ROUNDS, false), 100);
    assert.equal(parseRaceRoundOverride('PATIENT_EMERGENCY_CONTACT_UPDATE_RACE_ROUNDS', undefined, DEFAULT_UPDATE_RACE_ROUNDS, false), 150);
  });

  await test('a valid integer override is accepted (and, only under local-fast-mode, may go as low as 1)', () => {
    assert.equal(parseRaceRoundOverride('PATIENT_EMERGENCY_CONTACT_CREATE_RACE_ROUNDS', '25', 100, false), 25);
    assert.equal(parseRaceRoundOverride('PATIENT_EMERGENCY_CONTACT_UPDATE_RACE_ROUNDS', '40', 150, false), 40);
    assert.equal(parseRaceRoundOverride('PATIENT_EMERGENCY_CONTACT_CREATE_RACE_ROUNDS', '1', 100, true), 1);
  });

  await test('zero is rejected', () => {
    assert.throws(
      () => parseRaceRoundOverride('PATIENT_EMERGENCY_CONTACT_CREATE_RACE_ROUNDS', '0', 100, false),
      /must be a positive integer greater than zero/,
    );
  });

  await test('a negative value is rejected', () => {
    assert.throws(
      () => parseRaceRoundOverride('PATIENT_EMERGENCY_CONTACT_CREATE_RACE_ROUNDS', '-5', 100, false),
      /not a valid bounded positive integer/,
    );
  });

  await test('a decimal value is rejected', () => {
    assert.throws(
      () => parseRaceRoundOverride('PATIENT_EMERGENCY_CONTACT_CREATE_RACE_ROUNDS', '12.5', 100, false),
      /not a valid bounded positive integer/,
    );
  });

  await test('a non-numeric / malformed value is rejected', () => {
    assert.throws(() => parseRaceRoundOverride('PATIENT_EMERGENCY_CONTACT_CREATE_RACE_ROUNDS', 'abc', 100, false), /not a valid bounded positive integer/);
    assert.throws(() => parseRaceRoundOverride('PATIENT_EMERGENCY_CONTACT_CREATE_RACE_ROUNDS', 'NaN', 100, false), /not a valid bounded positive integer/);
    assert.throws(() => parseRaceRoundOverride('PATIENT_EMERGENCY_CONTACT_CREATE_RACE_ROUNDS', '1e5', 100, false), /not a valid bounded positive integer/);
    assert.throws(() => parseRaceRoundOverride('PATIENT_EMERGENCY_CONTACT_CREATE_RACE_ROUNDS', '   ', 100, false), /is set but empty/);
  });

  await test('a below-minimum override is rejected without local-fast-mode, but accepted once local-fast-mode is explicitly enabled', () => {
    assert.throws(
      () => parseRaceRoundOverride('PATIENT_EMERGENCY_CONTACT_CREATE_RACE_ROUNDS', '3', 100, false),
      /below the minimum.*PATIENT_EMERGENCY_CONTACT_RACE_LOCAL_FAST_MODE/s,
    );
    assert.equal(parseRaceRoundOverride('PATIENT_EMERGENCY_CONTACT_CREATE_RACE_ROUNDS', '3', 100, true), 3);
  });

  await test('an explicitly-invalid value is never silently coerced to the default', () => {
    assert.throws(() => parseRaceRoundOverride('PATIENT_EMERGENCY_CONTACT_CREATE_RACE_ROUNDS', 'not-a-number', 100, false));
  });

  await test('the committed defaults are 100 (create) / 150 (update), and the default CI path (no overrides set) executes exactly those counts', () => {
    assert.equal(DEFAULT_CREATE_RACE_ROUNDS, 100, 'the committed CREATE default must stay 100 rounds');
    assert.equal(DEFAULT_UPDATE_RACE_ROUNDS, 150, 'the committed UPDATE default must stay 150 rounds');
    if (process.env.PATIENT_EMERGENCY_CONTACT_CREATE_RACE_ROUNDS === undefined) {
      assert.equal(createRoundsConfig.rounds, 100, 'without an override, this run must exercise exactly 100 CREATE rounds');
      assert.equal(createRoundsConfig.source, 'default');
    }
    if (process.env.PATIENT_EMERGENCY_CONTACT_UPDATE_RACE_ROUNDS === undefined) {
      assert.equal(updateRoundsConfig.rounds, 150, 'without an override, this run must exercise exactly 150 UPDATE rounds');
      assert.equal(updateRoundsConfig.source, 'default');
    }
  });

  console.log(
    `    [stress config] CREATE_RACE_ROUNDS=${createRoundsConfig.rounds} (${createRoundsConfig.source}) ` +
      `UPDATE_RACE_ROUNDS=${updateRoundsConfig.rounds} (${updateRoundsConfig.source})`,
  );
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

// ─── 1b. Stress: same CREATE race, run repeatedly to demonstrate determinism ─

async function scenarioConcurrentCreatesStress() {
  const ROUNDS = createRoundsConfig.rounds;
  section(
    `1b. Stress: ${ROUNDS} independent rounds of the CREATE race, each on a fresh patient — must be deterministic every round ` +
      `(${createRoundsConfig.source === 'default' ? 'committed default' : 'PATIENT_EMERGENCY_CONTACT_CREATE_RACE_ROUNDS override'})`,
  );
  const fixtures = await createClinicFixtureSet('ec-concurrent-create-stress');
  const user = await ownerUser(fixtures);

  let onePassOneConflict = 0;
  let exactlyOnePrimaryAfter = 0;

  await test(`all ${ROUNDS} rounds produce exactly one 201 + one 409 PRIMARY_CONTACT_CONFLICT, and exactly one primary contact afterwards`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const patient = await createTestPatient({ organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId });

      const [resA, resB] = await Promise.all([
        callCreate(patient.id, user, contactBody({ isPrimary: true })),
        callCreate(patient.id, user, contactBody({ isPrimary: true })),
      ]);

      const successCount = [resA, resB].filter(r => r.statusCode === 201).length;
      const loser = resA.statusCode === 201 ? resB : resA;

      assert.equal(
        successCount,
        1,
        `round ${round}: exactly one concurrent create must succeed — got A=${resA.statusCode} B=${resB.statusCode} bodies=${JSON.stringify(resA.body)} / ${JSON.stringify(resB.body)}`,
      );
      assert.ok(
        isConflict(loser),
        `round ${round}: the loser must get the documented controlled 409 PRIMARY_CONTACT_CONFLICT, got ${loser.statusCode} ${JSON.stringify(loser.body)}`,
      );
      onePassOneConflict++;

      const finalPrimaryCount = await primaryCount(patient.id);
      assert.equal(finalPrimaryCount, 1, `round ${round}: exactly one primary contact must exist after the race, got ${finalPrimaryCount}`);
      exactlyOnePrimaryAfter++;
    }

    console.log(
      `    [stress summary] rounds=${ROUNDS} source=${createRoundsConfig.source} one-201-one-409=${onePassOneConflict}/${ROUNDS} exactly-one-primary=${exactlyOnePrimaryAfter}/${ROUNDS}`,
    );
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

// ─── 2c. Same contact, concurrent idempotent/no-op updates must never conflict ─

async function scenarioSameContactConcurrentUpdate() {
  section('2c. Concurrent updates of the SAME already-primary contact must never conflict with each other (idempotent — no promotion is happening)');
  const fixtures = await createClinicFixtureSet('ec-same-contact-update');
  const patient = await createTestPatient({ organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId });
  const user = await ownerUser(fixtures);

  const created = await callCreate(patient.id, user, contactBody({ isPrimary: true }));
  assert.equal(created.statusCode, 201);
  const contactId = created.body.id;

  await test('5 concurrent isPrimary:true updates of the SAME already-primary contact all succeed with 200 — no PRIMARY_CONTACT_CONFLICT', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => callUpdate(patient.id, contactId, user, { isPrimary: true, fullName: `Same Contact ${i}` })),
    );
    for (const res of results) {
      assert.equal(res.statusCode, 200, `idempotent same-contact update must never conflict, got ${res.statusCode} ${JSON.stringify(res.body)}`);
    }
    assert.equal(await primaryCount(patient.id), 1, 'still exactly one primary contact');
  });
}

// ─── 2b. Stress: same UPDATE race, run repeatedly to demonstrate determinism ─

async function scenarioConcurrentUpdatesStress() {
  const ROUNDS = updateRoundsConfig.rounds;
  section(
    `2b. Stress: ${ROUNDS} independent rounds of the DIFFERENT-contacts UPDATE race, each on a fresh patient — must be deterministic every round ` +
      `(${updateRoundsConfig.source === 'default' ? 'committed default' : 'PATIENT_EMERGENCY_CONTACT_UPDATE_RACE_ROUNDS override'})`,
  );
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

    console.log(
      `    [stress summary] rounds=${ROUNDS} source=${updateRoundsConfig.source} one-200-one-409=${onePassOneConflict}/${ROUNDS} exactly-one-primary=${exactlyOnePrimaryAfter}/${ROUNDS}`,
    );
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
  await scenarioStressRoundConfiguration();
  await scenarioConcurrentCreatesSamePatient();
  await scenarioConcurrentCreatesStress();
  await scenarioConcurrentUpdatesDifferentContacts();
  await scenarioSameContactConcurrentUpdate();
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

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
 *
 * F2-CT-32-R3-R1 (test-contract reconciliation): this suite proves TWO
 * distinct contracts (see patientEmergencyContactsConcurrency.ts's header
 * comment for the full architecture rationale):
 *   - TOKEN-PROTECTED (expectedCurrentPrimaryContactId supplied) — the
 *     GUARANTEED contract. Scenarios 1c/2d keep strict "exactly one success"
 *     assertions across 500+500=1000 contested rounds, zero dual-success
 *     tolerated.
 *   - LEGACY/unprotected (no precondition) — a BEST-EFFORT-ONLY contract.
 *     Scenarios 1/1b/2/2b do NOT assert "exactly one HTTP success": CI
 *     evidence (PR #351 exact head, run 31335917295) proved that invariant
 *     is not achievable under natural scheduling without a client-supplied
 *     precondition — 2 of 251 unprotected contested rounds dual-succeeded
 *     (round 45/100 CREATE, round 140/150 UPDATE), both DB-consistent
 *     (exactly one primary persisted either way). These scenarios instead
 *     assert the actual legacy contract: no 500, no leaked DB internals,
 *     tenant-scope correctness, exactly one primary in the DB afterwards,
 *     and — whenever test instrumentation observes pg_try_advisory_xact_lock
 *     returning false — that the contending request received 409
 *     PRIMARY_CONTACT_CONFLICT. Diagnostic data (statuses, ids, isPrimary
 *     values, final DB rows/primary count, lock-contention observation) is
 *     captured every round BEFORE any assertion that could abort the round —
 *     the historical CI failures never got to record final primaryCount
 *     directly, because the old "exactly one success" assertion threw
 *     first; that gap is closed here, not by claiming those historical
 *     rounds were directly observed at primaryCount=1.
 */

import assert from 'node:assert/strict';
import patientEmergencyContactsRouter from '../../routes/patientEmergencyContacts.js';
import { installEmergencyContactRaceTestHooks } from '../../services/patientEmergencyContactsConcurrency.js';
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

// ─── F2-CT-32-R3-R1: LEGACY (unprotected) race diagnostics + invariants ────
//
// Real-time observation of whether THIS round's pg_try_advisory_xact_lock
// call ever returned false for either contender (server/src/services/
// patientEmergencyContactsConcurrency.ts's onLockContention hook). Installed
// once for the whole suite — it is a no-op read of a module-scope flag and
// never alters production behavior; token-protected mode never triggers it
// (it uses the blocking acquire, not the try-lock), so it is harmless there.
let lockContentionObserved = false;
installEmergencyContactRaceTestHooks({
  onLockContention: () => {
    lockContentionObserved = true;
  },
});

function resetLockContentionObserved(): void {
  lockContentionObserved = false;
}

type LegacyRaceDiagnostics = {
  patientId: string;
  resA: { statusCode: number; body: any };
  resB: { statusCode: number; body: any };
  finalPrimaryCount: number;
  finalPrimaryIds: string[];
  lockContentionObserved: boolean;
  expectedClinicId: string;
  expectedOrganizationId: string;
};

/**
 * Captures every observable BEFORE any assertion runs — statuses, bodies,
 * final DB primary rows/count, and whether lock contention was observed.
 * This ordering is the point: the pre-reconciliation version of this suite
 * asserted "exactly one success" first, so a dual-success round threw before
 * the final-DB-state query ever executed, and the historical CI failures
 * were never directly observed at a measured primaryCount. Capturing first
 * means every subsequent assertion failure's message already carries the
 * full round state, and — more importantly — the final DB state is always
 * actually measured, every round, whether or not an assertion later throws.
 */
async function captureLegacyRaceDiagnostics(params: {
  patientId: string;
  resA: { statusCode: number; body: any };
  resB: { statusCode: number; body: any };
  expectedClinicId: string;
  expectedOrganizationId: string;
}): Promise<LegacyRaceDiagnostics> {
  const observedLockContention = lockContentionObserved;
  const finalContacts = await allContacts(params.patientId);
  const finalPrimaries = finalContacts.filter((c) => c.isPrimary);
  return {
    patientId: params.patientId,
    resA: params.resA,
    resB: params.resB,
    finalPrimaryCount: finalPrimaries.length,
    finalPrimaryIds: finalPrimaries.map((c) => c.id),
    lockContentionObserved: observedLockContention,
    expectedClinicId: params.expectedClinicId,
    expectedOrganizationId: params.expectedOrganizationId,
  };
}

/**
 * Semantic invariants for the LEGACY (no-precondition, best-effort-only)
 * primary-promotion contract — see this file's header comment and
 * patientEmergencyContactsConcurrency.ts's header comment for why "exactly
 * one HTTP success" is deliberately NOT asserted here. Dual HTTP success is
 * a documented, DB-consistent, characterized outcome of this contract under
 * natural scheduling (CI run 31335917295), not a defect this test polices.
 */
function assertLegacyRaceInvariants(d: LegacyRaceDiagnostics, label: string): void {
  for (const [side, res] of [['A', d.resA], ['B', d.resB]] as const) {
    assert.notEqual(res.statusCode, 500, `${label}: side ${side} must never return 500, got ${res.statusCode} ${JSON.stringify(res.body)}`);
    if (res.statusCode >= 400) {
      const msg = String(res.body?.error ?? '');
      assert.ok(!/prisma|postgres|constraint|P2002/i.test(msg), `${label}: side ${side}'s error response must not leak internal DB details: ${msg}`);
    }
    if (res.statusCode === 200 || res.statusCode === 201) {
      assert.equal(res.body.patientId, d.patientId, `${label}: side ${side}'s returned contact must belong to the expected patient`);
      assert.equal(res.body.clinicId, d.expectedClinicId, `${label}: side ${side}'s returned contact must belong to the expected clinic`);
      assert.equal(res.body.organizationId, d.expectedOrganizationId, `${label}: side ${side}'s returned contact must belong to the expected organization`);
    }
  }

  // The hard DB invariant (PatientEmergencyContact_one_primary_per_patient
  // partial unique index, plus the fact that whichever side actually
  // acquires the try-lock always ends up either the sole writer or a
  // legitimate demote-then-replace) — exactly one primary, never zero,
  // never two, every round, regardless of the HTTP-layer outcome shape.
  assert.equal(
    d.finalPrimaryCount,
    1,
    `${label}: DB must contain exactly one primary after the race (never zero, never two) — got ${d.finalPrimaryCount} (ids=${JSON.stringify(d.finalPrimaryIds)}) A=${d.resA.statusCode} B=${d.resB.statusCode}`,
  );

  if (d.lockContentionObserved) {
    const hasConflict = isConflict(d.resA) || isConflict(d.resB);
    assert.ok(
      hasConflict,
      `${label}: instrumentation observed pg_try_advisory_xact_lock returning false for a contender, so that exact request MUST have received 409 PRIMARY_CONTACT_CONFLICT — got A=${d.resA.statusCode} B=${d.resB.statusCode}`,
    );
  }
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
  section('1. Two concurrent CREATEs for the same patient, both requesting isPrimary=true (LEGACY best-effort contract — F2-CT-32-R3-R1)');
  const fixtures = await createClinicFixtureSet('ec-concurrent-create');
  const patient = await createTestPatient({ organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId });
  const user = await ownerUser(fixtures);

  await test('legacy CREATE race is DB-consistent (exactly one primary persists), never 500s, never leaks DB internals, and reports 409 whenever real lock contention is observed — dual HTTP success is a documented characterized outcome, not asserted against', async () => {
    resetLockContentionObserved();
    const [resA, resB] = await Promise.all([
      callCreate(patient.id, user, contactBody({ isPrimary: true })),
      callCreate(patient.id, user, contactBody({ isPrimary: true })),
    ]);

    const diagnostics = await captureLegacyRaceDiagnostics({
      patientId: patient.id,
      resA,
      resB,
      expectedClinicId: fixtures.defaultClinicId,
      expectedOrganizationId: fixtures.orgId,
    });

    assertLegacyRaceInvariants(diagnostics, 'scenario 1');
  });
}

// ─── 1b. Stress: same CREATE race, run repeatedly to demonstrate determinism ─

async function scenarioConcurrentCreatesStress() {
  const ROUNDS = createRoundsConfig.rounds;
  section(
    `1b. Stress: ${ROUNDS} independent rounds of the CREATE race, each on a fresh patient — LEGACY best-effort contract: measures the actual DB-consistent invariants every round (F2-CT-32-R3-R1) ` +
      `(${createRoundsConfig.source === 'default' ? 'committed default' : 'PATIENT_EMERGENCY_CONTACT_CREATE_RACE_ROUNDS override'})`,
  );
  const fixtures = await createClinicFixtureSet('ec-concurrent-create-stress');
  const user = await ownerUser(fixtures);

  let dualHttpSuccessRounds = 0;
  let singleSuccessPlusConflictRounds = 0;
  let lockContentionRounds = 0;
  let exactlyOnePrimaryAfter = 0;

  await test(
    `all ${ROUNDS} rounds are DB-consistent (exactly one primary persists), never 500, never leak DB internals, and report 409 whenever real lock contention is observed — dual HTTP success is a documented characterized LEGACY-mode outcome, not asserted against`,
    async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const patient = await createTestPatient({ organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId });

        resetLockContentionObserved();
        const [resA, resB] = await Promise.all([
          callCreate(patient.id, user, contactBody({ isPrimary: true })),
          callCreate(patient.id, user, contactBody({ isPrimary: true })),
        ]);

        // Diagnostic-first (F2-CT-32-R3-R1): capture every observable —
        // including the final DB primary count — BEFORE any assertion that
        // could abort this round. The pre-reconciliation version of this
        // test asserted "exactly one success" first, so a dual-success round
        // threw before the final-DB-state query below ever ran.
        const diagnostics = await captureLegacyRaceDiagnostics({
          patientId: patient.id,
          resA,
          resB,
          expectedClinicId: fixtures.defaultClinicId,
          expectedOrganizationId: fixtures.orgId,
        });

        if (resA.statusCode === 201 && resB.statusCode === 201) dualHttpSuccessRounds++;
        else singleSuccessPlusConflictRounds++;
        if (diagnostics.lockContentionObserved) lockContentionRounds++;

        assertLegacyRaceInvariants(diagnostics, `round ${round}`);
        exactlyOnePrimaryAfter++;
      }

      console.log(
        `    [stress summary] rounds=${ROUNDS} source=${createRoundsConfig.source} dual-http-success=${dualHttpSuccessRounds}/${ROUNDS} ` +
          `single-success-plus-409=${singleSuccessPlusConflictRounds}/${ROUNDS} lock-contention-observed=${lockContentionRounds}/${ROUNDS} ` +
          `exactly-one-primary=${exactlyOnePrimaryAfter}/${ROUNDS}`,
      );
    },
  );
}

// ─── 1c. Stress: token-protected CREATE race — F1-004-P1-R2-R3 ────────────
//
// Same shape as 1b, but both concurrent creates supply
// expectedCurrentPrimaryContactId: null (both callers correctly believe, at
// request-formation time, that the fresh patient has no primary yet). This
// exercises the actual fix for the CI-observed A=201/B=201 failure (run
// 31020654709 attempt 1) — see patientEmergencyContactsCreateRaceForcedInterleaving.test.ts
// for the deterministic forced-interleaving proof that this mode is airtight
// against the exact mechanism scenario 1b's legacy (no-token) path cannot
// close. 500 rounds — this task's minimum required CREATE round count.

async function scenarioConcurrentCreatesStressTokenProtected() {
  const ROUNDS = 500;
  section(`1c. Stress: ${ROUNDS} independent rounds of the TOKEN-PROTECTED CREATE race (expectedCurrentPrimaryContactId: null), each on a fresh patient — must be deterministic every round`);
  const fixtures = await createClinicFixtureSet('ec-concurrent-create-stress-token');
  const user = await ownerUser(fixtures);

  let onePassOneConflict = 0;
  let exactlyOnePrimaryAfter = 0;

  await test(`all ${ROUNDS} token-protected rounds produce exactly one 201 + one 409 PRIMARY_CONTACT_CONFLICT, and exactly one primary contact afterwards`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const patient = await createTestPatient({ organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId });

      const [resA, resB] = await Promise.all([
        callCreate(patient.id, user, contactBody({ isPrimary: true, expectedCurrentPrimaryContactId: null })),
        callCreate(patient.id, user, contactBody({ isPrimary: true, expectedCurrentPrimaryContactId: null })),
      ]);

      const successCount = [resA, resB].filter(r => r.statusCode === 201).length;
      const loser = resA.statusCode === 201 ? resB : resA;

      assert.equal(
        successCount,
        1,
        `round ${round}: exactly one token-protected concurrent create must succeed — got A=${resA.statusCode} B=${resB.statusCode} bodies=${JSON.stringify(resA.body)} / ${JSON.stringify(resB.body)}`,
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

    console.log(`    [stress summary] rounds=${ROUNDS} token-protected one-201-one-409=${onePassOneConflict}/${ROUNDS} exactly-one-primary=${exactlyOnePrimaryAfter}/${ROUNDS}`);
  });
}

// ─── 2. Two concurrent updates of different contacts, both isPrimary=true ───

async function scenarioConcurrentUpdatesDifferentContacts() {
  section('2. Two concurrent UPDATEs of DIFFERENT existing contacts, both requesting isPrimary=true (LEGACY best-effort contract — F2-CT-32-R3-R1)');
  const fixtures = await createClinicFixtureSet('ec-concurrent-update');
  const patient = await createTestPatient({ organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId });
  const user = await ownerUser(fixtures);

  const createA = await callCreate(patient.id, user, contactBody({ isPrimary: false }));
  const createB = await callCreate(patient.id, user, contactBody({ isPrimary: false }));
  assert.equal(createA.statusCode, 201);
  assert.equal(createB.statusCode, 201);
  const contactAId = createA.body.id;
  const contactBId = createB.body.id;

  await test('legacy UPDATE race is DB-consistent (exactly one primary persists), never 500s, never leaks DB internals, and reports 409 whenever real lock contention is observed — dual HTTP success is a documented characterized outcome, not asserted against', async () => {
    resetLockContentionObserved();
    const [resA, resB] = await Promise.all([
      callUpdate(patient.id, contactAId, user, { isPrimary: true }),
      callUpdate(patient.id, contactBId, user, { isPrimary: true }),
    ]);

    const diagnostics = await captureLegacyRaceDiagnostics({
      patientId: patient.id,
      resA,
      resB,
      expectedClinicId: fixtures.defaultClinicId,
      expectedOrganizationId: fixtures.orgId,
    });

    assertLegacyRaceInvariants(diagnostics, 'scenario 2');
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
    `2b. Stress: ${ROUNDS} independent rounds of the DIFFERENT-contacts UPDATE race, each on a fresh patient — LEGACY best-effort contract: measures the actual DB-consistent invariants every round (F2-CT-32-R3-R1) ` +
      `(${updateRoundsConfig.source === 'default' ? 'committed default' : 'PATIENT_EMERGENCY_CONTACT_UPDATE_RACE_ROUNDS override'})`,
  );
  const fixtures = await createClinicFixtureSet('ec-concurrent-update-stress');
  const user = await ownerUser(fixtures);

  let dualHttpSuccessRounds = 0;
  let singleSuccessPlusConflictRounds = 0;
  let lockContentionRounds = 0;
  let exactlyOnePrimaryAfter = 0;

  await test(
    `all ${ROUNDS} rounds are DB-consistent (exactly one primary persists), never 500, never leak DB internals, and report 409 whenever real lock contention is observed — dual HTTP success is a documented characterized LEGACY-mode outcome, not asserted against`,
    async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const patient = await createTestPatient({ organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId });

        const createA = await callCreate(patient.id, user, contactBody({ isPrimary: false }));
        const createB = await callCreate(patient.id, user, contactBody({ isPrimary: false }));
        assert.equal(createA.statusCode, 201, `round ${round}: setup create A must succeed`);
        assert.equal(createB.statusCode, 201, `round ${round}: setup create B must succeed`);

        resetLockContentionObserved();
        const [resA, resB] = await Promise.all([
          callUpdate(patient.id, createA.body.id, user, { isPrimary: true }),
          callUpdate(patient.id, createB.body.id, user, { isPrimary: true }),
        ]);

        // Diagnostic-first (F2-CT-32-R3-R1): capture every observable —
        // including the final DB primary count — BEFORE any assertion that
        // could abort this round.
        const diagnostics = await captureLegacyRaceDiagnostics({
          patientId: patient.id,
          resA,
          resB,
          expectedClinicId: fixtures.defaultClinicId,
          expectedOrganizationId: fixtures.orgId,
        });

        if (resA.statusCode === 200 && resB.statusCode === 200) dualHttpSuccessRounds++;
        else singleSuccessPlusConflictRounds++;
        if (diagnostics.lockContentionObserved) lockContentionRounds++;

        assertLegacyRaceInvariants(diagnostics, `round ${round}`);
        exactlyOnePrimaryAfter++;
      }

      console.log(
        `    [stress summary] rounds=${ROUNDS} source=${updateRoundsConfig.source} dual-http-success=${dualHttpSuccessRounds}/${ROUNDS} ` +
          `single-success-plus-409=${singleSuccessPlusConflictRounds}/${ROUNDS} lock-contention-observed=${lockContentionRounds}/${ROUNDS} ` +
          `exactly-one-primary=${exactlyOnePrimaryAfter}/${ROUNDS}`,
      );
    },
  );
}

// ─── 2d. Stress: token-protected UPDATE race — F1-004-P1-R2-R3 ────────────
//
// Same shape as 2b, but both concurrent promoting updates supply
// expectedCurrentPrimaryContactId: null (both callers correctly believe
// neither of the two freshly-created, non-primary contacts is primary yet).
// 500 rounds — this task's minimum required UPDATE round count.

async function scenarioConcurrentUpdatesStressTokenProtected() {
  const ROUNDS = 500;
  section(`2d. Stress: ${ROUNDS} independent rounds of the TOKEN-PROTECTED DIFFERENT-contacts UPDATE race (expectedCurrentPrimaryContactId: null), each on a fresh patient — must be deterministic every round`);
  const fixtures = await createClinicFixtureSet('ec-concurrent-update-stress-token');
  const user = await ownerUser(fixtures);

  let onePassOneConflict = 0;
  let exactlyOnePrimaryAfter = 0;

  await test(`all ${ROUNDS} token-protected rounds produce exactly one 200 + one 409 PRIMARY_CONTACT_CONFLICT, and exactly one primary contact afterwards`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const patient = await createTestPatient({ organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId });

      const createA = await callCreate(patient.id, user, contactBody({ isPrimary: false }));
      const createB = await callCreate(patient.id, user, contactBody({ isPrimary: false }));
      assert.equal(createA.statusCode, 201, `round ${round}: setup create A must succeed`);
      assert.equal(createB.statusCode, 201, `round ${round}: setup create B must succeed`);

      const [resA, resB] = await Promise.all([
        callUpdate(patient.id, createA.body.id, user, { isPrimary: true, expectedCurrentPrimaryContactId: null }),
        callUpdate(patient.id, createB.body.id, user, { isPrimary: true, expectedCurrentPrimaryContactId: null }),
      ]);

      const successCount = [resA, resB].filter(r => r.statusCode === 200).length;
      const loser = resA.statusCode === 200 ? resB : resA;
      const winner = resA.statusCode === 200 ? resA : resB;

      assert.equal(
        successCount,
        1,
        `round ${round}: exactly one token-protected concurrent update must succeed — got A=${resA.statusCode} B=${resB.statusCode} bodies=${JSON.stringify(resA.body)} / ${JSON.stringify(resB.body)}`,
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

    console.log(`    [stress summary] rounds=${ROUNDS} token-protected one-200-one-409=${onePassOneConflict}/${ROUNDS} exactly-one-primary=${exactlyOnePrimaryAfter}/${ROUNDS}`);
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
  await scenarioConcurrentCreatesStressTokenProtected();
  await scenarioConcurrentUpdatesDifferentContacts();
  await scenarioSameContactConcurrentUpdate();
  await scenarioConcurrentUpdatesStress();
  await scenarioConcurrentUpdatesStressTokenProtected();
  await scenarioNoCrossPatientInterference();
  await scenarioMultipleNonPrimaryRowsAllowed();
  await scenarioMultipleLegalDecisionMakersAllowed();

  const ok = summary();
  installEmergencyContactRaceTestHooks(null);
  await cleanupAllFixtures();
  await prisma.$disconnect();
  process.exit(ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error('FATAL:', err);
  installEmergencyContactRaceTestHooks(null);
  await cleanupAllFixtures().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});

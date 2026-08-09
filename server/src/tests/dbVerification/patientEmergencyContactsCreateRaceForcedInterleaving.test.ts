/**
 * patientEmergencyContactsCreateRaceForcedInterleaving.test.ts — F1-004-P1-R2-R3,
 * F2-CT-32-R3.
 *
 * A NATURAL Promise.all() race (patientEmergencyContactsPrimaryConcurrency.test.ts)
 * cannot be forced to hit a specific interleaving on demand: the CREATE-race
 * bug this file exists to characterize reproduced on GitHub Actions CI twice
 * under R2 — run 31020654709 attempt 1 (round 0/100) and again post-R2, main
 * run 31330815502 (round 0 of the single-race scenario) — but did NOT
 * reproduce in hundreds of independent local rounds against a low-latency
 * local disposable Postgres either time. This suite uses the real,
 * production test-only synchronization hooks
 * (installEmergencyContactRaceTestHooks — server/src/services/
 * patientEmergencyContactsConcurrency.ts) wired into the REAL route handlers
 * (POST/PUT patientEmergencyContacts.ts via resolvePrimaryPromotion) to force
 * a SPECIFIC, deterministic interleaving — request B's entire promoting
 * critical section (from its very first statement) is held back until
 * request A's whole transaction has committed — every run, not hoping timing
 * jitter lands on it.
 *
 * Proves two things, both against a REAL disposable Postgres (no mocked
 * Prisma, no in-memory simulation):
 *
 *  1. Token-protected mode (client sends expectedCurrentPrimaryContactId) is
 *     airtight against EXACTLY this mechanism — the same forced interleaving
 *     that produces A=201/B=201 in legacy mode always yields exactly one 201
 *     + one 409 in token mode, because the comparison is against the
 *     client's own observed belief, never against a same-request timing
 *     signal that can be delayed by scheduling.
 *
 *  2. Legacy mode (no precondition — an un-updated client), as of F2-CT-32-R3,
 *     no longer exhibits this race under NATURAL scheduling (see
 *     patientEmergencyContactsPrimaryConcurrency.test.ts's scenario 1/1b,
 *     500 real-Postgres rounds) — R3 replaced the "prior read vs current
 *     read" value comparison with a non-blocking advisory-lock attempt
 *     (tryAcquireEmergencyContactPrimaryLock), so contention is now decided
 *     by Postgres's own atomic lock arbitration, not by comparing two
 *     independently-timed reads. Under THIS file's artificial FULL
 *     serialization (B does not even attempt the lock until after A's
 *     transaction has already committed and released it), legacy mode still
 *     exhibits the race — this is retained deliberately as a
 *     characterization test, NOT a regression to fix: it documents that this
 *     one specific, non-naturally-occurring edge is knowingly not closeable
 *     (see resolvePrimaryPromotion's header comment for the proof that no
 *     purely server-side signal can close it), and it protects against
 *     silently losing the forced-interleaving mechanism itself (if this ever
 *     stopped reproducing, the gate/hook wiring would need re-verification
 *     before trusting test 1's guarantee).
 *
 * Run: DATABASE_URL=... npx tsx src/tests/dbVerification/patientEmergencyContactsCreateRaceForcedInterleaving.test.ts
 */

import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import patientEmergencyContactsRouter from '../../routes/patientEmergencyContacts.js';
import { installEmergencyContactRaceTestHooks, type EmergencyContactRaceTestHooks } from '../../services/patientEmergencyContactsConcurrency.js';
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
} from './dbVerificationHarness.js';

const { section, test, summary } = createSuite('patientEmergencyContactsCreateRaceForcedInterleaving');

const CREATE_CHAIN = getFullChain(patientEmergencyContactsRouter as any, 'post', '/patients/:patientId/emergency-contacts');
const als = new AsyncLocalStorage<{ label: 'A' | 'B' }>();

type Observation = {
  label: string;
  event: string;
  tMs: number;
  detail?: Record<string, unknown>;
};

async function callCreate(
  patientId: string,
  user: ReturnType<typeof authRequest>,
  body: Record<string, unknown>,
  label: 'A' | 'B',
) {
  return als.run({ label }, async () => {
    const req = { ...user, params: { patientId }, body } as any;
    const res = mockResponse();
    await runChain(CREATE_CHAIN, req, res);
    return res;
  });
}

/**
 * Builds hooks that force request B's critical section to begin only after
 * request A's has fully committed, gated at `gateAt`. Also records the
 * "Required observations per request" the diagnostic-harness task calls for:
 * backend PID (via a same-transaction raw query — safe, read-only,
 * test-only), lock-acquired timestamp, current-primary-seen id, and commit
 * completion — all timestamped relative to a shared t0 per round.
 */
function buildForcedHooks(gateAt: keyof EmergencyContactRaceTestHooks, observations: Observation[], t0: number) {
  let aCommittedResolve: () => void;
  const aCommittedPromise = new Promise<void>((res) => { aCommittedResolve = res; });
  let aCommitted = false;

  const record = async (label: string, event: string, tx: any, detail?: Record<string, unknown>) => {
    let pid: number | undefined;
    if (tx) {
      try {
        const rows: any[] = await tx.$queryRaw`SELECT pg_backend_pid() as pid`;
        pid = Number(rows[0]?.pid);
      } catch {
        // best-effort only — never fail the test over an observability query
      }
    }
    observations.push({ label, event, tMs: Math.round((performance.now() - t0) * 100) / 100, detail: { ...detail, pid } });
  };

  const hooks: EmergencyContactRaceTestHooks = {
    beforeLock: async (ctx) => {
      const label = als.getStore()?.label ?? '?';
      await record(label, 'beforeLock', ctx.tx);
      if (gateAt === 'beforeLock' && label === 'B') {
        await aCommittedPromise;
      }
    },
    afterLock: async (ctx) => {
      const label = als.getStore()?.label ?? '?';
      await record(label, 'afterLock (lock acquired)', ctx.tx);
      if (gateAt === 'afterLock' && label === 'B') {
        await aCommittedPromise;
      }
    },
    onLockContention: async (ctx) => {
      const label = als.getStore()?.label ?? '?';
      await record(label, 'onLockContention (legacy try-lock found it held)', ctx.tx);
    },
    afterCurrentRead: async (ctx) => {
      const label = als.getStore()?.label ?? '?';
      await record(label, 'afterCurrentRead', ctx.tx, { currentPrimaryId: ctx.currentPrimaryId });
    },
    beforeInsert: async (ctx) => {
      const label = als.getStore()?.label ?? '?';
      await record(label, 'beforeInsert', ctx.tx);
      if (gateAt === 'beforeInsert' && label === 'B') {
        await aCommittedPromise;
      }
    },
    afterCommit: async (ctx) => {
      const label = als.getStore()?.label ?? '?';
      await record(label, 'afterCommit', null);
      if (label === 'A') {
        aCommitted = true;
        aCommittedResolve();
      }
    },
  };

  return { hooks, isACommitted: () => aCommitted };
}

async function runForcedRound(opts: {
  gateAt: keyof EmergencyContactRaceTestHooks;
  aToken: string | null | undefined; // undefined = omit (legacy)
  bToken: string | null | undefined;
}) {
  const observations: Observation[] = [];
  const t0 = performance.now();
  const { hooks } = buildForcedHooks(opts.gateAt, observations, t0);
  installEmergencyContactRaceTestHooks(hooks);

  const fixtures = await createClinicFixtureSet('ec-create-race-forced');
  const owner = await createStaffUser({ organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId, role: 'OWNER', canAccessAllClinics: true });
  const user = authRequest({ id: owner.id, organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId, role: 'OWNER', canAccessAllClinics: true });
  const patient = await createTestPatient({ organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId });

  const bodyA: Record<string, unknown> = { contactType: 'PARENT', fullName: 'A', phone: '+905550000001', isPrimary: true };
  if (opts.aToken !== undefined) bodyA.expectedCurrentPrimaryContactId = opts.aToken;
  const bodyB: Record<string, unknown> = { contactType: 'PARENT', fullName: 'B', phone: '+905550000002', isPrimary: true };
  if (opts.bToken !== undefined) bodyB.expectedCurrentPrimaryContactId = opts.bToken;

  const tHttpStart = performance.now();
  const [resA, resB] = await Promise.all([
    callCreate(patient.id, user, bodyA, 'A'),
    callCreate(patient.id, user, bodyB, 'B'),
  ]);
  observations.push({ label: 'A', event: 'http-response', tMs: Math.round((performance.now() - t0) * 100) / 100, detail: { status: resA.statusCode } });
  observations.push({ label: 'B', event: 'http-response', tMs: Math.round((performance.now() - t0) * 100) / 100, detail: { status: resB.statusCode } });

  const finalPrimaryCount = await prisma.patientEmergencyContact.count({ where: { patientId: patient.id, isPrimary: true } });

  installEmergencyContactRaceTestHooks(null);
  await cleanupAllFixtures();

  return { resA, resB, finalPrimaryCount, observations, httpDispatchedAtMs: Math.round((tHttpStart - t0) * 100) / 100 };
}

// ── 1. Token-protected mode is airtight against the exact CI mechanism ─────

async function scenarioTokenProtectedForcedInterleaving() {
  section('1. Token-protected CREATE: forced full-serialization (B\'s critical section forced to start after A\'s commit) still yields exactly one 201 + one 409 — every round');

  // Only "beforeLock" is a safe gate point for this specific pattern: once a
  // request has acquired the REAL pg_advisory_xact_lock, artificially
  // blocking it there (or later, e.g. beforeInsert) while it still holds
  // that lock can deadlock against the OTHER request, which then needs the
  // same lock to ever reach its own afterCommit and release the gate — a
  // self-inflicted test deadlock, not a product bug. Gating strictly before
  // lock acquisition is deadlock-free and is also the only point that
  // actually varies what this test is proving (once locked, nothing else
  // can be racing, so later gate points wouldn't exercise anything new).
  const GATE_POINTS: Array<keyof EmergencyContactRaceTestHooks> = ['beforeLock'];
  for (const gateAt of GATE_POINTS) {
    const ROUNDS = 20;
    let allCorrect = true;
    let lastObservations: Observation[] = [];
    for (let i = 0; i < ROUNDS; i++) {
      const { resA, resB, finalPrimaryCount, observations } = await runForcedRound({ gateAt, aToken: null, bToken: null });
      const statuses = [resA.statusCode, resB.statusCode].sort();
      const oneWinnerOneConflict = statuses[0] === 201 && statuses[1] === 409;
      if (!oneWinnerOneConflict || finalPrimaryCount !== 1) {
        allCorrect = false;
        lastObservations = observations;
      }
    }
    await test(`gated at "${String(gateAt)}": ${ROUNDS}/${ROUNDS} forced rounds produce exactly one 201 + one 409, exactly one committed primary`, () => {
      assert.ok(allCorrect, `a forced round failed at gate "${String(gateAt)}". Observations from the last failing round: ${JSON.stringify(lastObservations, null, 2)}`);
    });
  }
}

// ── 2. Legacy (no precondition) mode: F2-CT-32-R3 closes the natural-race gap,
//      documents the (unavoidable, non-naturally-reproducing) forced-full-
//      serialization edge that still cannot be closed without a token ──────

async function scenarioLegacyModeForcedInterleavingCharacterization() {
  section('2. Legacy CREATE (no expectedCurrentPrimaryContactId): F2-CT-32-R3 closes the natural race; only forced FULL serialization (B never even attempts the lock until after A commits) can still produce it — documents why the token remains the only airtight option for that edge');

  await test('legacy mode: forced full-serialization at beforeLock still reproduces A=201/B=201 deterministically (the one edge no server-side signal can close without a client precondition — see resolvePrimaryPromotion header comment)', async () => {
    // Gates at beforeLock: F2-CT-32-R3 removed the separate "prior" read
    // entirely (see patientEmergencyContactsConcurrency.ts's header comment)
    // — legacy mode's very FIRST database statement is now the non-blocking
    // try-lock attempt itself. Forcing B to wait at beforeLock means B does
    // not even ATTEMPT the lock until after A's afterCommit hook fires,
    // which only fires after A's real transaction has already committed and
    // released the lock — so B's try-lock finds it free, acquires
    // uncontended, and legitimately proceeds as what Postgres itself sees as
    // a fully sequential replacement. This is the one edge R3 does not (and,
    // per the header comment's proof, cannot) close without a client
    // precondition — it requires an entire competing transaction's round
    // trip of delay, not just a lagging read, which is why it no longer
    // reproduces under the NATURAL Promise.all() race in
    // patientEmergencyContactsPrimaryConcurrency.test.ts's scenario 1/1b,
    // only under this artificial full-serialization gate.
    const { resA, resB, finalPrimaryCount, observations } = await runForcedRound({ gateAt: 'beforeLock', aToken: undefined, bToken: undefined });
    const bothSucceeded = resA.statusCode === 201 && resB.statusCode === 201;
    assert.ok(
      bothSucceeded,
      `expected the legacy path's residual full-serialization edge to reproduce under forced full-serialization (proving the mechanism this file exists to characterize) — got A=${resA.statusCode} B=${resB.statusCode}. ` +
        `If this assertion starts failing, the forced-interleaving mechanism itself may be broken — re-verify before trusting scenario 1's guarantee. Observations: ${JSON.stringify(observations)}`,
    );
    // Even in the known-bad legacy case, exactly one row ends up primary in
    // the DATABASE (B's demote-then-insert is still a real, valid Postgres
    // transaction) — the product bug is that BOTH callers were told 201, not
    // that the database itself ends up inconsistent.
    assert.equal(finalPrimaryCount, 1, 'even under the legacy race, the database itself must never end up with two committed primaries');
  });
}

// ── 3. Precondition-mismatch scenarios (no forcing needed — pure correctness) ─

async function scenarioPreconditionMismatches() {
  section('3. Precondition mismatches: null-vs-UUID, UUID-vs-different-UUID, stale frontend state — all correctly rejected with 409, never silently accepted');

  await test('client believes no primary exists (expected: null) but a primary already exists (UUID) -> 409, no demotion, no insert', async () => {
    const fixtures = await createClinicFixtureSet('ec-precondition-null-vs-uuid');
    const owner = await createStaffUser({ organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId, role: 'OWNER', canAccessAllClinics: true });
    const user = authRequest({ id: owner.id, organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId, role: 'OWNER', canAccessAllClinics: true });
    const patient = await createTestPatient({ organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId });

    const first = await callCreate(patient.id, user, { contactType: 'PARENT', fullName: 'First', phone: '+905550000001', isPrimary: true, expectedCurrentPrimaryContactId: null }, 'A');
    assert.equal(first.statusCode, 201);

    const second = await callCreate(patient.id, user, { contactType: 'PARENT', fullName: 'Second', phone: '+905550000002', isPrimary: true, expectedCurrentPrimaryContactId: null }, 'B');
    assert.equal(second.statusCode, 409);
    assert.equal(second.body?.code, 'PRIMARY_CONTACT_CONFLICT');

    const contacts = await prisma.patientEmergencyContact.findMany({ where: { patientId: patient.id } });
    assert.equal(contacts.length, 1, 'the rejected second create must not have persisted a row');
    assert.equal(contacts[0].id, first.body.id);
    assert.equal(contacts[0].isPrimary, true, 'the original primary must remain untouched — no demotion occurred');

    await cleanupAllFixtures();
  });

  await test('client believes a DIFFERENT contact is primary (wrong UUID) -> 409, current primary untouched', async () => {
    const fixtures = await createClinicFixtureSet('ec-precondition-uuid-vs-uuid');
    const owner = await createStaffUser({ organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId, role: 'OWNER', canAccessAllClinics: true });
    const user = authRequest({ id: owner.id, organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId, role: 'OWNER', canAccessAllClinics: true });
    const patient = await createTestPatient({ organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId });

    const first = await callCreate(patient.id, user, { contactType: 'PARENT', fullName: 'First', phone: '+905550000001', isPrimary: true, expectedCurrentPrimaryContactId: null }, 'A');
    assert.equal(first.statusCode, 201);

    const bogusId = '00000000-0000-4000-8000-000000000000';
    const wrongBelief = await callCreate(patient.id, user, { contactType: 'PARENT', fullName: 'Second', phone: '+905550000002', isPrimary: true, expectedCurrentPrimaryContactId: bogusId }, 'B');
    assert.equal(wrongBelief.statusCode, 409);
    assert.equal(wrongBelief.body?.code, 'PRIMARY_CONTACT_CONFLICT');

    const primaryAfter = await prisma.patientEmergencyContact.findFirst({ where: { patientId: patient.id, isPrimary: true } });
    assert.equal(primaryAfter?.id, first.body.id, 'the actual current primary must be unaffected by a request carrying a stale/wrong belief');

    await cleanupAllFixtures();
  });

  await test('stale frontend state: client loaded the list before someone else set a primary, then submits with an outdated (null) belief -> 409, not silently overwritten', async () => {
    const fixtures = await createClinicFixtureSet('ec-precondition-stale-frontend');
    const owner = await createStaffUser({ organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId, role: 'OWNER', canAccessAllClinics: true });
    const user = authRequest({ id: owner.id, organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId, role: 'OWNER', canAccessAllClinics: true });
    const patient = await createTestPatient({ organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId });

    // Simulates: client A loaded the (empty) contact list, formed its belief
    // (expectedCurrentPrimaryContactId: null), then — before A submits —
    // an unrelated staff member (client C) already created and committed a
    // primary contact through a completely separate request.
    const concurrentOtherStaff = await callCreate(patient.id, user, { contactType: 'PARENT', fullName: 'SetByOtherStaff', phone: '+905550000009', isPrimary: true, expectedCurrentPrimaryContactId: null }, 'A');
    assert.equal(concurrentOtherStaff.statusCode, 201);

    const staleClient = await callCreate(patient.id, user, { contactType: 'PARENT', fullName: 'StaleClient', phone: '+905550000002', isPrimary: true, expectedCurrentPrimaryContactId: null }, 'B');
    assert.equal(staleClient.statusCode, 409, 'a client submitting a stale "no primary" belief must be told to refresh and retry, never silently overwrite');

    await cleanupAllFixtures();
  });

  await test('matching precondition (correct UUID) succeeds and legitimately replaces the primary — sequential replacement is preserved', async () => {
    const fixtures = await createClinicFixtureSet('ec-precondition-sequential-replace');
    const owner = await createStaffUser({ organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId, role: 'OWNER', canAccessAllClinics: true });
    const user = authRequest({ id: owner.id, organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId, role: 'OWNER', canAccessAllClinics: true });
    const patient = await createTestPatient({ organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId });

    const first = await callCreate(patient.id, user, { contactType: 'PARENT', fullName: 'First', phone: '+905550000001', isPrimary: true, expectedCurrentPrimaryContactId: null }, 'A');
    assert.equal(first.statusCode, 201);

    // A completely separate, later, non-overlapping request — the client
    // re-fetched the list first and correctly observed the current primary.
    const replacement = await callCreate(patient.id, user, { contactType: 'PARENT', fullName: 'Second', phone: '+905550000002', isPrimary: true, expectedCurrentPrimaryContactId: first.body.id }, 'B');
    assert.equal(replacement.statusCode, 201, 'a correctly-informed sequential replacement must still succeed');

    const primaryAfter = await prisma.patientEmergencyContact.findFirst({ where: { patientId: patient.id, isPrimary: true } });
    assert.equal(primaryAfter?.id, replacement.body.id);
    const firstAfter = await prisma.patientEmergencyContact.findUnique({ where: { id: first.body.id } });
    assert.equal(firstAfter?.isPrimary, false, 'the replaced contact must have been demoted');

    await cleanupAllFixtures();
  });

  await test('cross-tenant: two different patients (different organizations), both token-protected, never block or interfere with each other', async () => {
    const fixturesX = await createClinicFixtureSet('ec-precondition-tenant-x');
    const fixturesY = await createClinicFixtureSet('ec-precondition-tenant-y');
    const ownerX = await createStaffUser({ organizationId: fixturesX.orgId, clinicId: fixturesX.defaultClinicId, role: 'OWNER', canAccessAllClinics: true });
    const ownerY = await createStaffUser({ organizationId: fixturesY.orgId, clinicId: fixturesY.defaultClinicId, role: 'OWNER', canAccessAllClinics: true });
    const userX = authRequest({ id: ownerX.id, organizationId: fixturesX.orgId, clinicId: fixturesX.defaultClinicId, role: 'OWNER', canAccessAllClinics: true });
    const userY = authRequest({ id: ownerY.id, organizationId: fixturesY.orgId, clinicId: fixturesY.defaultClinicId, role: 'OWNER', canAccessAllClinics: true });
    const patientX = await createTestPatient({ organizationId: fixturesX.orgId, clinicId: fixturesX.defaultClinicId });
    const patientY = await createTestPatient({ organizationId: fixturesY.orgId, clinicId: fixturesY.defaultClinicId });

    const [resX, resY] = await Promise.all([
      callCreate(patientX.id, userX, { contactType: 'PARENT', fullName: 'X', phone: '+905550000001', isPrimary: true, expectedCurrentPrimaryContactId: null }, 'A'),
      callCreate(patientY.id, userY, { contactType: 'PARENT', fullName: 'Y', phone: '+905550000002', isPrimary: true, expectedCurrentPrimaryContactId: null }, 'B'),
    ]);
    assert.equal(resX.statusCode, 201, 'different-tenant token-protected creates must never block each other');
    assert.equal(resY.statusCode, 201, 'different-tenant token-protected creates must never block each other');

    await cleanupAllFixtures();
  });
}

async function main() {
  await scenarioTokenProtectedForcedInterleaving();
  await scenarioLegacyModeForcedInterleavingCharacterization();
  await scenarioPreconditionMismatches();

  installEmergencyContactRaceTestHooks(null);
  const ok = summary();
  await prisma.$disconnect();
  if (!ok) process.exit(1);
}

main().catch(async (err) => {
  console.error('FATAL', err);
  installEmergencyContactRaceTestHooks(null);
  await cleanupAllFixtures().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});

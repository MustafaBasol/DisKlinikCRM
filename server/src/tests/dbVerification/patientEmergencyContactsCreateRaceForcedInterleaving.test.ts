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
 * Proves three things, all against a REAL disposable Postgres (no mocked
 * Prisma, no in-memory simulation) — F2-CT-32-R3-R1 reconciliation:
 *
 *  1. Token-protected mode (client sends expectedCurrentPrimaryContactId) —
 *     the GUARANTEED contract — is airtight against EXACTLY this mechanism:
 *     the same forced interleaving that produces A=201/B=201 in legacy mode
 *     always yields exactly one 201 + one 409 in token mode, because the
 *     comparison is against the client's own observed belief, never against
 *     a same-request timing signal that can be delayed by scheduling.
 *
 *  2. Legacy mode (no precondition — an un-updated client) — a BEST-EFFORT
 *     ONLY contract — under CASE 1, REAL LOCK OVERLAP (contender B's
 *     pg_try_advisory_xact_lock attempt happens while contender A still
 *     holds the same patient-scoped advisory lock): B's try-lock
 *     deterministically returns false, B conflicts immediately with 409, and
 *     the DB ends with exactly one primary. This is the class of gap
 *     F2-CT-32-R3 actually closes.
 *
 *  3. Legacy mode under CASE 2, FULL DB-LEVEL NON-OVERLAP (B's very FIRST
 *     database statement — the try-lock call itself — is forced to occur
 *     only after A's entire transaction has committed and released its
 *     lock): B's try-lock succeeds uncontended, B legitimately sees A's
 *     committed row as current state and may replace it — both HTTP
 *     operations can return success at their own commit time. This is
 *     retained deliberately as a CHARACTERIZATION, NOT a regression to fix:
 *     no purely server-side signal can distinguish this from a deliberate
 *     sequential replacement without a client-supplied precondition (see
 *     resolvePrimaryPromotion's header comment for the proof; SERIALIZABLE/
 *     SSI cannot close it either — if B's whole transaction commits before
 *     A's — or here A's before B's — first statement even begins, Postgres
 *     correctly sees a valid serial order). It is exercised here under an
 *     artificial full-serialization gate for determinism, but — contrary to
 *     an earlier draft of this file's own claim — it is NOT confined to
 *     forced interleaving: the same PR head reproduced it under genuinely
 *     NATURAL Promise.all() scheduling too (CI run 31335917295: round
 *     45/100 of the unprotected CREATE stress, round 140/150 of the
 *     unprotected UPDATE stress — see
 *     patientEmergencyContactsPrimaryConcurrency.test.ts's scenarios 1/1b/2/2b,
 *     which assert the legacy contract's actual semantic invariants for
 *     that reason instead of an unachievable "exactly one HTTP success").
 *     This test still exists to deterministically pin the mechanism down
 *     and to protect against silently losing the forced-interleaving
 *     wiring itself (if this ever stopped reproducing, the gate/hook wiring
 *     would need re-verification before trusting test 1's guarantee).
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

/**
 * Builds hooks for CASE 1 — REAL LOCK OVERLAP (F2-CT-32-R3-R1): forces
 * request B's pg_try_advisory_xact_lock attempt to happen while request A's
 * real Postgres transaction is still open and still holding that same
 * patient-scoped advisory lock. Sequencing:
 *   1. B is held at beforeLock until A confirms (via afterLock) that it has
 *      actually acquired the real lock — otherwise B might race ahead and
 *      acquire it itself, which would not exercise overlap at all.
 *   2. A is then held at afterLock — transaction still open, lock still
 *      held — until B's onLockContention hook fires, proving B's try-lock
 *      call has actually executed against Postgres and found the lock
 *      genuinely contended.
 *   3. Only then is A released to finish its critical section and commit.
 * This is real overlap, not scheduled-to-look-like overlap: B's try-lock
 * statement executes on its own connection while A's transaction (and thus
 * A's advisory lock) is still open on a separate connection.
 */
function buildLockOverlapHooks(observations: Observation[], t0: number) {
  let aLockAcquiredResolve: () => void;
  const aLockAcquiredPromise = new Promise<void>((res) => { aLockAcquiredResolve = res; });
  let bAttemptedResolve: () => void;
  const bAttemptedPromise = new Promise<void>((res) => { bAttemptedResolve = res; });

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
      if (label === 'B') {
        await aLockAcquiredPromise;
      }
    },
    afterLock: async (ctx) => {
      const label = als.getStore()?.label ?? '?';
      await record(label, 'afterLock (lock acquired)', ctx.tx);
      if (label === 'A') {
        aLockAcquiredResolve();
        await bAttemptedPromise;
      }
    },
    onLockContention: async (ctx) => {
      const label = als.getStore()?.label ?? '?';
      await record(label, 'onLockContention (legacy try-lock found it held)', ctx.tx);
      if (label === 'B') {
        bAttemptedResolve();
      }
    },
    afterCurrentRead: async (ctx) => {
      const label = als.getStore()?.label ?? '?';
      await record(label, 'afterCurrentRead', ctx.tx, { currentPrimaryId: ctx.currentPrimaryId });
    },
    beforeInsert: async (ctx) => {
      const label = als.getStore()?.label ?? '?';
      await record(label, 'beforeInsert', ctx.tx);
    },
    afterCommit: async (ctx) => {
      const label = als.getStore()?.label ?? '?';
      await record(label, 'afterCommit', null);
    },
  };

  return { hooks };
}

async function runLockOverlapRound() {
  const observations: Observation[] = [];
  const t0 = performance.now();
  const { hooks } = buildLockOverlapHooks(observations, t0);
  installEmergencyContactRaceTestHooks(hooks);

  const fixtures = await createClinicFixtureSet('ec-create-race-lock-overlap');
  const owner = await createStaffUser({ organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId, role: 'OWNER', canAccessAllClinics: true });
  const user = authRequest({ id: owner.id, organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId, role: 'OWNER', canAccessAllClinics: true });
  const patient = await createTestPatient({ organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId });

  const bodyA: Record<string, unknown> = { contactType: 'PARENT', fullName: 'A', phone: '+905550000001', isPrimary: true };
  const bodyB: Record<string, unknown> = { contactType: 'PARENT', fullName: 'B', phone: '+905550000002', isPrimary: true };

  const [resA, resB] = await Promise.all([
    callCreate(patient.id, user, bodyA, 'A'),
    callCreate(patient.id, user, bodyB, 'B'),
  ]);
  observations.push({ label: 'A', event: 'http-response', tMs: Math.round((performance.now() - t0) * 100) / 100, detail: { status: resA.statusCode } });
  observations.push({ label: 'B', event: 'http-response', tMs: Math.round((performance.now() - t0) * 100) / 100, detail: { status: resB.statusCode } });

  const finalPrimaryCount = await prisma.patientEmergencyContact.count({ where: { patientId: patient.id, isPrimary: true } });

  installEmergencyContactRaceTestHooks(null);
  await cleanupAllFixtures();

  return { resA, resB, finalPrimaryCount, observations };
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

// ── 2. Legacy CASE 1 — REAL LOCK OVERLAP: the class of gap F2-CT-32-R3
//      actually closes ──────────────────────────────────────────────────

async function scenarioLegacyModeRealLockOverlap() {
  section(
    '2. Legacy CREATE, CASE 1 — REAL LOCK OVERLAP: contender B\'s pg_try_advisory_xact_lock attempt is forced to occur while contender A still holds the same patient-scoped advisory lock — this is the class of gap F2-CT-32-R3 actually closes',
  );

  const ROUNDS = 10;
  await test(
    `${ROUNDS}/${ROUNDS} forced rounds: B's try-lock deterministically finds the lock held, B conflicts immediately with 409 (no primary read/write), A succeeds with 201, and exactly one primary is ever committed`,
    async () => {
      for (let i = 0; i < ROUNDS; i++) {
        const { resA, resB, finalPrimaryCount, observations } = await runLockOverlapRound();

        assert.equal(
          resA.statusCode,
          201,
          `round ${i}: A (the real lock holder) must succeed — got ${resA.statusCode} ${JSON.stringify(resA.body)}. Observations: ${JSON.stringify(observations)}`,
        );
        assert.equal(
          resB.statusCode,
          409,
          `round ${i}: B (genuinely contended while A holds the lock) must get 409 — got ${resB.statusCode} ${JSON.stringify(resB.body)}. Observations: ${JSON.stringify(observations)}`,
        );
        assert.equal(resB.body?.code, 'PRIMARY_CONTACT_CONFLICT', `round ${i}: B's 409 must carry the documented conflict code`);
        assert.equal(finalPrimaryCount, 1, `round ${i}: exactly one primary must be committed — got ${finalPrimaryCount}`);

        // B must never reach the read/write portion of the critical section
        // — losing the try-lock must be its only DB interaction beyond the
        // try-lock statement itself.
        const bPerformedReadOrWrite = observations.some(
          (o) => o.label === 'B' && (o.event === 'afterCurrentRead' || o.event === 'beforeInsert' || o.event === 'afterCommit'),
        );
        assert.ok(
          !bPerformedReadOrWrite,
          `round ${i}: B must not perform any primary read/write after losing the try-lock. Observations: ${JSON.stringify(observations)}`,
        );

        const bObservedContention = observations.some((o) => o.label === 'B' && o.event.startsWith('onLockContention'));
        assert.ok(
          bObservedContention,
          `round ${i}: B's onLockContention hook must have fired, proving pg_try_advisory_xact_lock genuinely observed contention (not a coincidental 409 from another path). Observations: ${JSON.stringify(observations)}`,
        );
      }
    },
  );
}

// ── 3. Legacy CASE 2 — FULL DB-LEVEL NON-OVERLAP: a characterization of the
//      BEST-EFFORT-ONLY legacy contract, not a regression ─────────────────

async function scenarioLegacyModeFullNonOverlapCharacterization() {
  section(
    '3. Legacy CREATE, CASE 2 — FULL DB-LEVEL NON-OVERLAP: B\'s very first database statement is forced to occur only after A\'s entire transaction has committed and released its lock — a documented characterization of the LEGACY BEST-EFFORT contract, not a regression',
  );

  await test('legacy mode: forced full-serialization at beforeLock reproduces A=201/B=201 deterministically — B\'s try-lock succeeds uncontended and legitimately replaces A\'s committed row, exactly as PostgreSQL itself sees a valid serial order (see resolvePrimaryPromotion header comment)', async () => {
    // Gates at beforeLock: F2-CT-32-R3 removed the separate "prior" read
    // entirely (see patientEmergencyContactsConcurrency.ts's header comment)
    // — legacy mode's very FIRST database statement is now the non-blocking
    // try-lock attempt itself. Forcing B to wait at beforeLock means B does
    // not even ATTEMPT the lock until after A's afterCommit hook fires,
    // which only fires after A's real transaction has already committed and
    // released the lock — so B's try-lock finds it free, acquires
    // uncontended, and legitimately proceeds as what Postgres itself sees as
    // a fully sequential replacement. F2-CT-32-R3-R1: this is not confined
    // to this artificial gate — the same PR head reproduced the identical
    // mechanism under genuinely NATURAL Promise.all() scheduling too (CI run
    // 31335917295: round 45/100 of the unprotected CREATE stress, round
    // 140/150 of the unprotected UPDATE stress in
    // patientEmergencyContactsPrimaryConcurrency.test.ts). This gate exists
    // to pin the mechanism down deterministically, not because it is the
    // only way this outcome can occur.
    const { resA, resB, finalPrimaryCount, observations } = await runForcedRound({ gateAt: 'beforeLock', aToken: undefined, bToken: undefined });
    const bothSucceeded = resA.statusCode === 201 && resB.statusCode === 201;
    assert.ok(
      bothSucceeded,
      `expected the legacy path's characterized full-non-overlap edge to reproduce under forced full-serialization (proving the mechanism this file exists to characterize) — got A=${resA.statusCode} B=${resB.statusCode}. ` +
        `If this assertion starts failing, the forced-interleaving mechanism itself may be broken — re-verify before trusting scenario 1's guarantee. Observations: ${JSON.stringify(observations)}`,
    );
    // This is a documented, expected outcome of the LEGACY BEST-EFFORT
    // contract (F2-CT-32-R3-R1 architecture decision), not a bug: the
    // database itself always ends up with exactly one primary (B's
    // demote-then-insert is a single valid Postgres transaction) — both
    // HTTP callers legitimately received success at their own commit time,
    // because from PostgreSQL's point of view A and B were genuinely
    // sequential (B -> A never overlapped), and no purely server-side
    // signal is entitled to recover the client's request-formation-time
    // belief after the fact without a supplied precondition.
    assert.equal(finalPrimaryCount, 1, 'even under this characterized legacy case, the database itself must never end up with two committed primaries');
  });
}

// ── 4. Precondition-mismatch scenarios (no forcing needed — pure correctness) ─

async function scenarioPreconditionMismatches() {
  section('4. Precondition mismatches: null-vs-UUID, UUID-vs-different-UUID, stale frontend state — all correctly rejected with 409, never silently accepted');

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
  await scenarioLegacyModeRealLockOverlap();
  await scenarioLegacyModeFullNonOverlapCharacterization();
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

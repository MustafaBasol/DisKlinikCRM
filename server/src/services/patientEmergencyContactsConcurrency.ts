/**
 * patientEmergencyContactsConcurrency.ts — US-01.2-FU / F1-004-P1-R2: closes
 * the emergency-contact primary-promotion race that the database-level
 * partial unique index (PatientEmergencyContact_one_primary_per_patient —
 * see migration 20260803120000_add_patient_emergency_contacts) does not
 * fully cover on its own.
 *
 * Why the unique index alone is not enough:
 *   The index only rejects a write when two transactions' primary-setting
 *   statements are BOTH still in flight and physically overlap at the
 *   index-insert step — Postgres's standard unique-constraint wait/recheck
 *   protocol. Two requests dispatched together (e.g. Promise.all) do not
 *   have to overlap at that precise step: if the first transaction's whole
 *   reset-then-set sequence (BEGIN, clear-other-primaries, write, COMMIT)
 *   finishes before the second transaction even opens — a completely normal
 *   outcome under connection-pool/event-loop scheduling, more likely under
 *   CI runner contention than on a quiet local box — the second transaction
 *   freshly (and correctly, from Postgres's point of view) observes the
 *   first transaction's now-committed primary, clears it, and writes its own
 *   row as the new primary. No unique violation ever occurs, because by the
 *   time the second write lands only one row is trying to hold
 *   isPrimary=true. Both requests then observe HTTP 200, silently
 *   overwriting each other, even though only one caller's intent should have
 *   won and the other should have been told about the conflict.
 *
 * F1-004-P1-R2: an earlier fix (PR #310) closed the above by re-reading the
 * current primary under a per-patient advisory lock and comparing it to a
 * "prior primary" id captured via a SEPARATE, unlocked query issued before
 * the transaction even opened. That query and the transaction's own
 * connection checkout are two independent events competing for the same pg
 * pool (server/src/db.ts, default max 10) — under real contention, the
 * "prior" read for the losing request could itself be delayed until AFTER
 * the winning request's entire transaction had already committed, at which
 * point it silently absorbed the winner's committed row as its own "prior"
 * belief and the in-lock recheck found no discrepancy. That gap reproduced
 * the exact A=200/B=200 failure (main CI run 31002888303) despite the lock.
 *
 * Fix (R2):
 *   The promoting transaction still reads the current primary, acquires the
 *   per-patient advisory lock, and re-checks the current primary — but now
 *   BOTH reads (the "prior" one before the lock and the "current" one after
 *   it) run on the SAME prisma.$transaction (same pg connection) as each
 *   other, instead of the "prior" read being a separate, unlocked query
 *   issued before the transaction even opened. The only gap between the two
 *   reads is the lock-wait itself — never a second, independently-poolable
 *   database round trip that connection-pool scheduling could reorder
 *   relative to a competing request's entire transaction. If the two reads
 *   disagree (something else became/stopped being primary while this
 *   request waited for the lock), PrimaryContactConflictError is thrown —
 *   exactly PR #310's original algorithm, minus the one decoupled query
 *   that broke it.
 *
 *   Alternative considered and rejected — SERIALIZABLE isolation: an
 *   earlier version of this fix ran the whole transaction at
 *   ISOLATION LEVEL SERIALIZABLE and dropped the manual prior/current
 *   comparison entirely, relying on PostgreSQL's own predicate-lock
 *   conflict detection (SQLSTATE 40001 / Prisma P2034) to abort one side of
 *   any genuine conflict. Verified empirically (raw-SQL probe, no Prisma)
 *   that this DOES correctly abort one transaction when two promotions
 *   genuinely overlap in time. It was rejected because it also produced
 *   FALSE-POSITIVE conflicts between completely unrelated patients: on a
 *   small/sparse PatientEmergencyContact table (as in every fresh test
 *   database, and plausibly in a lightly-loaded production table too),
 *   PostgreSQL's query planner favors a sequential scan over the
 *   patientId/clinicId/organizationId index for the "current primary" read,
 *   and SERIALIZABLE's predicate locks are then taken at page/table
 *   granularity rather than scoped to the matching rows — so two
 *   concurrent promotions for two DIFFERENT patients could spuriously abort
 *   each other. That is an unacceptable cross-tenant interference
 *   regression (violates this task's own "different patients/clinics/
 *   organizations must never block each other" requirement) for a class of
 *   race (full DB-level non-overlap, see the evidence doc's root-cause
 *   section for the exact boundary this does and does not close) that
 *   SERIALIZABLE could not fully close anyway.
 *
 *   The per-patient advisory lock (pg_advisory_xact_lock — same primitive
 *   already used by server/src/services/appointmentRequestSafety.ts and
 *   patientMedicalHistoryConcurrency.ts) remains what actually serializes
 *   promotion attempts for a given patient into "one at a time," so the
 *   prior/current comparison only ever needs to reason about a single
 *   competing transaction, not an unbounded pile-up. Different patients
 *   (including different organizations/clinics) never contend: patientId is
 *   already globally unique in this schema (see the route file's own
 *   comment on the same point), and the lock is only ever acquired for
 *   isPrimary=true writes — concurrent isPrimary=false writes and unrelated
 *   field updates never touch it.
 *
 * F2-CT-32-R3 (this revision): R2's own "prior vs current" comparison is
 * itself still a value-read comparison, and — as its own proof above and
 * resolvePrimaryPromotion's header comment both already document — a
 * DELAYED READ can still land after a competing transaction has fully
 * committed, at which point "prior" (read late) and "current" (read a
 * moment later, under the lock) observe the SAME already-settled winner and
 * silently agree with each other. This reproduced live (main CI run
 * 31330815502, Layer 3 disposable-Postgres job, round 0 of the CREATE race)
 * as A=201/B=201 even under R2. The DB itself never ends up with two
 * primaries (the loser's demote-then-insert is a real, valid, single-row
 * transaction) — the bug is that BOTH callers were told 201, even though
 * only one of them actually raced; the other's "win" silently overwrote the
 * first without notice.
 *
 * Fix (R3), legacy (no-precondition) mode only: replace the entire
 * "prior read (before lock) vs current read (after lock)" comparison with a
 * single NON-BLOCKING advisory-lock attempt, pg_try_advisory_xact_lock
 * (tryAcquireEmergencyContactPrimaryLock below). It atomically reports
 * whether *this* call was the one that acquired the per-patient lock:
 *   - Acquired (true): no other transaction holds this patient's lock at
 *     this exact instant, in real time, as arbitrated by Postgres itself —
 *     not by comparing two independently-timed reads. This request is
 *     either the sole contender or the previous holder already committed
 *     and released before this one even asked. Either way it proceeds
 *     exactly as before: read the current primary once, under the lock (the
 *     lock's own success already proves nothing else can be changing it),
 *     demote it if present, and let the caller insert/update. No separate
 *     "prior" read is taken or needed any more.
 *   - Not acquired (false): another transaction is holding this patient's
 *     primary-promotion lock RIGHT NOW — unambiguous, real-time proof of
 *     genuine concurrent contention, not a timing-dependent inference. This
 *     request conflicts immediately (PrimaryContactConflictError) — no
 *     wait, no retry, no read.
 * This closes the gap for a delayed READ (the mechanism that reproduced in
 * CI run 31330815502): the earliest a legacy request now touches the
 * database at all is the try-lock attempt itself, so a competitor can no
 * longer "silently agree" via two reads that each separately lagged into
 * the post-commit window. The provably-unclosable edge this does NOT change
 * (see resolvePrimaryPromotion's header and
 * patientEmergencyContactsCreateRaceForcedInterleaving.test.ts's scenario 2)
 * is a request whose very FIRST database statement — the try-lock call
 * itself — does not begin until strictly after a competitor's entire
 * transaction (lock, read, demote, insert, COMMIT) has already finished:
 * at that point the two are, from Postgres's own point of view, genuinely
 * sequential, not concurrent, and no server-side signal (this one included)
 * can or should distinguish that from a deliberate replacement without a
 * client-supplied precondition.
 *
 * F2-CT-32-R3-R1 (reconciliation): the paragraph above's residual window is
 * real, and — contrary to this revision's own original PR description —
 * it is NOT confined to the forced-interleaving suite's artificial gate.
 * The exact same PR head (commit 8ce06ba3, CI run 31335917295, Layer 3
 * disposable-Postgres job) reproduced it twice under genuinely NATURAL
 * Promise.all() scheduling, no forcing involved: unprotected CREATE stress
 * round 45/100 and unprotected UPDATE stress round 140/150 each returned
 * A=201/B=201 (create) and A=200/B=200 (update). The database itself never
 * ended up with two committed primaries in either case (this file's
 * demote-then-write sequence is still a single valid transaction) — but
 * both HTTP callers were told success, exactly the class of gap this
 * whole file exists to narrow. R3's fix is real and correctly narrows the
 * window (it eliminated the much larger, frequently-reproducing R2 gap
 * proven by CI run 31330815502's round 0), but no purely server-side
 * signal can shrink it to zero without a client-supplied precondition —
 * see this file's own SERIALIZABLE/SSI rejection above: if a competitor's
 * entire transaction commits before this request's first statement even
 * begins, PostgreSQL correctly sees a valid serial order, and no isolation
 * level is entitled to override that. This is why legacy (no-precondition)
 * mode is a LEGACY BEST-EFFORT compatibility contract, never a GUARANTEED
 * one — see resolvePrimaryPromotion's header comment below for the exact
 * two-contract split, and patientEmergencyContactsPrimaryConcurrency.test.ts
 * for the reconciled tests that assert the legacy path's actual semantic
 * invariants (DB-consistent, no 500, no leaked internal errors) instead of
 * an unachievable "exactly one HTTP success" guarantee.
 *
 * Token-protected mode is untouched by this revision: its comparison is
 * against the client's own request-formation-time belief, not a
 * same-request timing signal, so it was never subject to this class of gap
 * (proven by patientEmergencyContactsCreateRaceForcedInterleaving.test.ts's
 * scenario 1, and by 1000/1000 zero-failure token-protected contested
 * rounds in patientEmergencyContactsPrimaryConcurrency.test.ts) and needs
 * no change here. This is the GUARANTEED concurrency contract: the sole
 * production caller (src/components/PatientEmergencyContactForm.tsx, via
 * its observedCurrentPrimaryContactId prop — reverified F2-CT-32-R3-R1)
 * always supplies expectedCurrentPrimaryContactId on every isPrimary:true
 * submission, so this is the contract every real primary-promotion request
 * in this codebase actually runs under today.
 */

import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { PRIMARY_CONTACT_CONFLICT_CODE, type ExpectedPrimaryPrecondition } from './patientEmergencyContacts.js';

/**
 * Thrown when a primary-promotion loses the optimistic-concurrency re-check
 * performed under the per-patient advisory lock. Carries the same `code` as
 * a raw Prisma P2002 unique-constraint error so isPrimaryContactConflict()
 * (patientEmergencyContacts.ts) maps both to the identical 409
 * PRIMARY_CONTACT_CONFLICT response without the route needing to know which
 * of the two conflict sources actually fired.
 */
export class PrimaryContactConflictError extends Error {
  readonly code = PRIMARY_CONTACT_CONFLICT_CODE;

  constructor() {
    super('Another request just set a primary contact for this patient.');
    this.name = 'PrimaryContactConflictError';
  }
}

/**
 * Deterministic [int4, int4] pg_advisory_xact_lock key pair for a single
 * patient's emergency-contact primary-promotion critical section.
 * Domain-separated from every other advisory lock in this codebase (see
 * appointmentRequestSafety.ts's computeSlotLockKey /
 * computeAppointmentRequestConversionLockKey) by the
 * "patient-emergency-contact-primary:" prefix, even though all advisory
 * locks share PostgreSQL's single global (int4, int4) key space.
 *
 * Exported for unit testing only.
 */
export function computeEmergencyContactPrimaryLockKey(patientId: string): [number, number] {
  const hash = createHash('sha256').update(`patient-emergency-contact-primary:${patientId}`, 'utf8').digest();
  return [hash.readInt32BE(0), hash.readInt32BE(4)];
}

/**
 * Acquires a PostgreSQL advisory transaction lock scoped to a single
 * patient's emergency-contact primary-promotion critical section. Used by
 * TOKEN-PROTECTED mode, whose subsequent comparison is against the client's
 * own request-formation-time belief — the lock only needs to serialize
 * writes, not detect contention itself, so blocking until available is
 * correct here. pg_advisory_xact_lock blocks until the lock is available and
 * releases it automatically when the surrounding transaction ends (commit or
 * rollback) — never held across a network call or unrelated work. Different
 * patientId values never block each other.
 */
export async function acquireEmergencyContactPrimaryLock(
  tx: Prisma.TransactionClient,
  patientId: string,
): Promise<void> {
  const [key1, key2] = computeEmergencyContactPrimaryLockKey(patientId);
  // pg_advisory_xact_lock(int4,int4): explicit casts required — Prisma binds JS
  // numbers as int8 by default, but PostgreSQL has no (bigint,bigint) overload.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${key1}::int4, ${key2}::int4)`;
}

/**
 * Non-blocking variant used by LEGACY (no-precondition) mode (F2-CT-32-R3 —
 * see this file's header comment). Returns `true` iff THIS call was the one
 * that acquired the per-patient lock, atomically and in real time, as
 * arbitrated by Postgres itself — never blocks. `false` means another
 * transaction holds this patient's primary-promotion lock at this exact
 * instant: unambiguous, real-time proof of genuine concurrent contention,
 * safe to treat as an immediate conflict without reading anything. Same key
 * space as acquireEmergencyContactPrimaryLock (pg_try_advisory_xact_lock and
 * pg_advisory_xact_lock share the same underlying lock table, so a
 * try-acquire here and a blocking acquire from token-protected mode for the
 * same patient are still mutually exclusive with each other).
 */
export async function tryAcquireEmergencyContactPrimaryLock(
  tx: Prisma.TransactionClient,
  patientId: string,
): Promise<boolean> {
  const [key1, key2] = computeEmergencyContactPrimaryLockKey(patientId);
  const rows = await tx.$queryRaw<Array<{ acquired: boolean }>>`
    SELECT pg_try_advisory_xact_lock(${key1}::int4, ${key2}::int4) AS acquired
  `;
  return rows[0]?.acquired === true;
}

/**
 * TEST-ONLY deterministic synchronization hooks for the primary-promotion
 * critical section (POST/PUT in server/src/routes/patientEmergencyContacts.ts).
 * Every hook is a no-op (`activeHooks` is `null`) unless a test explicitly
 * installs one via installEmergencyContactRaceTestHooks — normal request
 * handling never sets this, so production behavior and the hot path's cost
 * are unaffected beyond one `null` check per call site.
 *
 * These exist because a NATURAL Promise.all() race cannot be forced to hit a
 * specific interleaving on demand: it reproduced on GitHub Actions CI (run
 * 31020654709 attempt 1, round 0/100) but did not reproduce in 500 local
 * rounds against a low-latency local disposable Postgres (see F1-004-P1-R2-R3
 * evidence) — this codebase's own concurrency suites (this file, plus
 * appointmentRequestSafety.ts / patientMedicalHistoryConcurrency.ts's
 * disposable-DB tests) rely on real, un-mocked Promise.all() races precisely
 * because JavaScript's single-threaded execution cannot fake a real database
 * race — but proving or disproving a SPECIFIC hypothesized interleaving
 * (e.g. "does request B's very first read, not just its lock wait, need to
 * be delayed past request A's commit to reproduce the bug") requires forcing
 * that exact schedule deterministically, every run, not hoping timing jitter
 * lands on it.
 *
 * Every hook except afterCommit fires from INSIDE resolvePrimaryPromotion's
 * transaction and receives that transaction's own client as `tx` — a test
 * may use it to run read-only diagnostic queries on the exact same
 * connection (e.g. `SELECT pg_backend_pid()`) without affecting the
 * transaction's outcome. afterCommit fires from the route AFTER
 * prisma.$transaction has already resolved, so no `tx` is available there.
 *
 * F2-CT-32-R3: legacy mode no longer performs a separate "prior" read (see
 * this file's header comment) — beforeLock/afterLock now bracket the
 * try-acquire itself, and onLockContention fires instead of afterLock when
 * the try-acquire finds the lock already held by another transaction.
 */
type HookCtxBase = { patientId: string; op: 'create' | 'update'; tx: Prisma.TransactionClient };

export interface EmergencyContactRaceTestHooks {
  beforeLock?: (ctx: HookCtxBase) => Promise<void> | void;
  afterLock?: (ctx: HookCtxBase) => Promise<void> | void;
  /** Legacy mode only: fires instead of afterLock when pg_try_advisory_xact_lock finds the lock already held — this request conflicts immediately, no read taken. */
  onLockContention?: (ctx: HookCtxBase) => Promise<void> | void;
  beforeCurrentRead?: (ctx: HookCtxBase) => Promise<void> | void;
  afterCurrentRead?: (ctx: HookCtxBase & { currentPrimaryId: string | null }) => Promise<void> | void;
  beforeInsert?: (ctx: HookCtxBase) => Promise<void> | void;
  afterCommit?: (ctx: { patientId: string; op: 'create' | 'update' }) => Promise<void> | void;
}

let activeHooks: EmergencyContactRaceTestHooks | null = null;

/** TEST-ONLY. Never call outside a disposable-Postgres test process. */
export function installEmergencyContactRaceTestHooks(hooks: EmergencyContactRaceTestHooks | null): void {
  activeHooks = hooks;
}

export async function invokeEmergencyContactRaceHook<K extends keyof EmergencyContactRaceTestHooks>(
  name: K,
  ctx: Parameters<NonNullable<EmergencyContactRaceTestHooks[K]>>[0],
): Promise<void> {
  const hook = activeHooks?.[name];
  if (hook) await hook(ctx as any);
}

/**
 * F1-004-P1-R2-R3: resolves the primary-promotion critical section shared by
 * POST (create-as-primary) and PUT (promote-to-primary) — acquires the
 * per-patient advisory lock, determines the canonical current primary under
 * that lock, and either throws PrimaryContactConflictError or demotes the
 * previous primary (leaving the caller to perform its own create/update).
 * Does NOT perform the create/update itself — the two callers differ there
 * (create vs update, and update's WHERE additionally excludes the contact
 * being promoted).
 *
 * Two mutually exclusive comparison modes, selected by `precondition` — and
 * two mutually exclusive CONTRACTS (F2-CT-32-R3-R1 reconciliation):
 *
 *  - precondition.provided === true — TOKEN-PROTECTED mode, the GUARANTEED
 *    contract: the caller supplied `expectedCurrentPrimaryContactId`,
 *    capturing what IT observed as the current primary before forming this
 *    request. The canonical current-primary read (taken under the lock,
 *    therefore always a fully committed, unambiguous fact) is compared
 *    directly against that client-supplied belief. This is true
 *    optimistic-concurrency control: it is airtight regardless of how
 *    connection-pool or event-loop scheduling happens to interleave this
 *    transaction relative to a competing one, because it never depends on
 *    when THIS request's own reads execute relative to a competitor's
 *    commit — only on whether reality (now, under the lock) still matches
 *    what the client last saw. Proven zero-dual-success across 1000/1000
 *    contested rounds (patientEmergencyContactsPrimaryConcurrency.test.ts,
 *    scenarios 1c + 2d) plus forced full-serialization
 *    (patientEmergencyContactsCreateRaceForcedInterleaving.test.ts, scenario
 *    1). Every real production caller uses this mode exclusively (see this
 *    file's header comment) — it is the contract that matters in practice.
 *
 *  - precondition.provided === false — LEGACY (no-precondition) mode, a
 *    BEST-EFFORT-ONLY compatibility contract, kept for an older/non-updated
 *    client and unreachable from any current production caller. Attempts a
 *    NON-BLOCKING advisory-lock acquire (tryAcquireEmergencyContactPrimaryLock);
 *    if another transaction holds this patient's lock at this exact instant,
 *    that is unambiguous, real-time proof of genuine concurrent contention
 *    and this request conflicts immediately (no read, no wait). If acquired,
 *    this request is either the sole contender or arrived strictly after the
 *    previous holder already committed and released — either way, the
 *    current primary is read once, under the lock, as the sole source of
 *    truth (no separate "prior" read/comparison is needed or taken). This
 *    closes the much larger gap proven in F1-004-P1-R2-R3 (CI run
 *    31020654709) and again in R2 (CI run 31330815502) for any request
 *    whose database engagement begins before a competitor's entire
 *    transaction has finished. The edge this mode still cannot close — a
 *    request whose very FIRST statement (the try-lock call itself) does not
 *    begin until strictly after a competitor's whole transaction has already
 *    committed — is, at that point, genuinely sequential from PostgreSQL's
 *    own point of view, not concurrent; no server-side signal can or should
 *    distinguish that from a deliberate replacement without a
 *    client-supplied precondition. That residual DOES still occur under
 *    natural (unforced) scheduling, not only the forced-interleaving suite's
 *    artificial gate — reconfirmed on this exact PR head, CI run 31335917295:
 *    2 of 251 unprotected contested rounds (round 45/100 CREATE, round
 *    140/150 UPDATE) — see
 *    patientEmergencyContactsCreateRaceForcedInterleaving.test.ts's scenario
 *    2 for the deterministic characterization of the same mechanism. This
 *    mode is therefore knowingly NOT provably race-free, is NOT the
 *    guaranteed contract, and every caller of this function MUST NOT claim
 *    it closes the race the way token-protected mode does — only that the
 *    database itself never durably holds two primaries (the partial unique
 *    index remains the hard backstop) and that a genuine same-instant lock
 *    conflict is always reported as 409, never silently absorbed.
 */
export async function resolvePrimaryPromotion(
  tx: Prisma.TransactionClient,
  params: {
    patientId: string;
    clinicId: string;
    organizationId: string;
    /** Excluded from every primary-lookup WHERE — set for UPDATE (the promoting row itself must never be compared against/demoted). Omit for CREATE (no existing row). */
    excludeContactId?: string;
    precondition: ExpectedPrimaryPrecondition;
    op: 'create' | 'update';
  },
): Promise<void> {
  const { patientId, clinicId, organizationId, excludeContactId, precondition, op } = params;
  const primaryWhere = {
    patientId,
    clinicId,
    organizationId,
    isPrimary: true,
    ...(excludeContactId ? { id: { not: excludeContactId } } : {}),
  };

  await invokeEmergencyContactRaceHook('beforeLock', { patientId, op, tx });

  if (!precondition.provided) {
    // Legacy best-effort mode (F2-CT-32-R3) — see this function's header
    // comment. Contention is decided by the lock itself, in real time, never
    // by comparing two independently-timed reads.
    const acquired = await tryAcquireEmergencyContactPrimaryLock(tx, patientId);
    if (!acquired) {
      await invokeEmergencyContactRaceHook('onLockContention', { patientId, op, tx });
      throw new PrimaryContactConflictError();
    }
    await invokeEmergencyContactRaceHook('afterLock', { patientId, op, tx });

    await invokeEmergencyContactRaceHook('beforeCurrentRead', { patientId, op, tx });
    const currentPrimary = await tx.patientEmergencyContact.findFirst({ where: primaryWhere, select: { id: true } });
    await invokeEmergencyContactRaceHook('afterCurrentRead', { patientId, op, tx, currentPrimaryId: currentPrimary?.id ?? null });

    if (currentPrimary) {
      await tx.patientEmergencyContact.updateMany({ where: primaryWhere, data: { isPrimary: false } });
    }
    await invokeEmergencyContactRaceHook('beforeInsert', { patientId, op, tx });
    return;
  }

  // Token-protected mode — unchanged (F1-004-P1-R2-R3): blocking acquire,
  // compare the canonical current-primary read against the client's own
  // request-formation-time belief.
  await acquireEmergencyContactPrimaryLock(tx, patientId);
  await invokeEmergencyContactRaceHook('afterLock', { patientId, op, tx });

  await invokeEmergencyContactRaceHook('beforeCurrentRead', { patientId, op, tx });
  const currentPrimary = await tx.patientEmergencyContact.findFirst({ where: primaryWhere, select: { id: true } });
  await invokeEmergencyContactRaceHook('afterCurrentRead', { patientId, op, tx, currentPrimaryId: currentPrimary?.id ?? null });

  if ((currentPrimary?.id ?? null) !== precondition.expectedCurrentPrimaryContactId) {
    throw new PrimaryContactConflictError();
  }

  if (currentPrimary) {
    await tx.patientEmergencyContact.updateMany({ where: primaryWhere, data: { isPrimary: false } });
  }
  await invokeEmergencyContactRaceHook('beforeInsert', { patientId, op, tx });
}

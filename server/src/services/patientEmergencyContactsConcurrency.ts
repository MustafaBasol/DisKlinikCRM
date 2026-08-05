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
 * patient's emergency-contact primary-promotion critical section.
 *
 * MUST be called AFTER the promoting prisma.$transaction callback's "prior"
 * read of the current primary contact, and BEFORE the "current" re-check
 * read and the reset-then-set writes — all three (prior read, lock, current
 * read) on the same `tx`. Calling this before the "prior" read would
 * reintroduce a decoupled-query-shaped gap (see this file's header
 * comment): the whole point of doing the "prior" read first is that it and
 * the "current" read are separated by nothing except this lock's wait,
 * never an independently-scheduled database round trip. pg_advisory_xact_lock
 * blocks until the lock is available and releases it automatically when the
 * surrounding transaction ends (commit or rollback) — never held across a
 * network call or unrelated work. Different patientId values never block
 * each other.
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
 */
type HookCtxBase = { patientId: string; op: 'create' | 'update'; tx: Prisma.TransactionClient };

export interface EmergencyContactRaceTestHooks {
  beforePriorRead?: (ctx: HookCtxBase) => Promise<void> | void;
  afterPriorRead?: (ctx: HookCtxBase & { priorPrimaryId: string | null }) => Promise<void> | void;
  beforeLock?: (ctx: HookCtxBase) => Promise<void> | void;
  afterLock?: (ctx: HookCtxBase) => Promise<void> | void;
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
 * Two mutually exclusive comparison modes, selected by `precondition`:
 *
 *  - precondition.provided === true (token-protected mode): the caller
 *    supplied `expectedCurrentPrimaryContactId`, capturing what IT observed
 *    as the current primary before forming this request. The canonical
 *    current-primary read (taken under the lock, therefore always a fully
 *    committed, unambiguous fact) is compared directly against that
 *    client-supplied belief. This is true optimistic-concurrency control: it
 *    is airtight regardless of how connection-pool or event-loop scheduling
 *    happens to interleave this transaction relative to a competing one,
 *    because it never depends on when THIS request's own reads execute
 *    relative to a competitor's commit — only on whether reality (now, under
 *    the lock) still matches what the client last saw.
 *
 *  - precondition.provided === false (legacy best-effort mode): no
 *    precondition was supplied (an older/non-updated client). Falls back to
 *    F1-004-P1-R2's design — a "prior" read taken before the lock is
 *    compared against the "current" read taken after it, both on the same
 *    transaction/connection so the only gap between them is the lock wait
 *    itself. This closes the specific gap PR #310 had (the prior read being
 *    a separate, independently-poolable query) but NOT the gap proven in
 *    F1-004-P1-R2-R3 (CI run 31020654709 attempt 1): if this transaction's
 *    own FIRST statement — the "prior" read — does not begin until AFTER a
 *    competing transaction has already committed, both reads observe
 *    identical, already-settled state and no conflict is detected, because
 *    at that point the two transactions are — from PostgreSQL's own point of
 *    view — genuinely, unambiguously sequential, not concurrent. No signal
 *    visible only from inside this transaction (however early it runs, in
 *    whatever order its statements are arranged) can distinguish that from a
 *    deliberate, temporally-separated replacement; only information the
 *    client captured at its own request-formation time — outside this
 *    transaction, outside the database entirely — can. This mode is
 *    therefore knowingly NOT race-free; it is retained only for backward
 *    compatibility with clients that have not yet been updated to send the
 *    precondition, and every caller of this function MUST NOT claim it
 *    closes the race the way token-protected mode does.
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

  let priorPrimaryId: string | null = null;
  if (!precondition.provided) {
    // Legacy best-effort mode only — MUST run before the lock; see this
    // function's header comment and acquireEmergencyContactPrimaryLock's.
    await invokeEmergencyContactRaceHook('beforePriorRead', { patientId, op, tx });
    const priorPrimary = await tx.patientEmergencyContact.findFirst({ where: primaryWhere, select: { id: true } });
    await invokeEmergencyContactRaceHook('afterPriorRead', { patientId, op, tx, priorPrimaryId: priorPrimary?.id ?? null });
    priorPrimaryId = priorPrimary?.id ?? null;
  }

  await invokeEmergencyContactRaceHook('beforeLock', { patientId, op, tx });
  await acquireEmergencyContactPrimaryLock(tx, patientId);
  await invokeEmergencyContactRaceHook('afterLock', { patientId, op, tx });

  await invokeEmergencyContactRaceHook('beforeCurrentRead', { patientId, op, tx });
  const currentPrimary = await tx.patientEmergencyContact.findFirst({ where: primaryWhere, select: { id: true } });
  await invokeEmergencyContactRaceHook('afterCurrentRead', { patientId, op, tx, currentPrimaryId: currentPrimary?.id ?? null });

  const expectedPrimaryId = precondition.provided ? precondition.expectedCurrentPrimaryContactId : priorPrimaryId;
  if ((currentPrimary?.id ?? null) !== expectedPrimaryId) {
    throw new PrimaryContactConflictError();
  }

  if (currentPrimary) {
    await tx.patientEmergencyContact.updateMany({ where: primaryWhere, data: { isPrimary: false } });
  }
  await invokeEmergencyContactRaceHook('beforeInsert', { patientId, op, tx });
}

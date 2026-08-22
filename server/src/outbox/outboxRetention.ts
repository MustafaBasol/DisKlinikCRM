/**
 * outboxRetention.ts — F5-2R. Which outbox rows may be deleted, and which may
 * never be, whatever their age.
 *
 * WHY THIS LIVES IN `outbox/` AND NOT IN THE RETENTION JOB
 * -------------------------------------------------------
 * `jobs/dataRetentionCleanupJob.ts` owns HOW cleanup runs: batching, dry-run,
 * the environment kill switch, the runtime kill switch, the shared job lock,
 * and continuing past a failing category. That machinery is proven and is
 * reused unchanged — F5-2R adds no second cleanup framework.
 *
 * What that job cannot own is WHICH outbox rows are safe to delete, because
 * that question is answered by outbox lifecycle semantics: leases, replay,
 * and the consumer idempotency ledger. Those rules belong next to the code
 * that creates and consumes the rows, so a future change to the dispatcher or
 * to replay is made in sight of the retention rule it would break.
 *
 * THE THREE CATEGORIES
 * --------------------
 *   1. `OutboxEvent` where status = 'processed'  — a DISCHARGED obligation.
 *   2. `OutboxEvent` where status = 'dead'       — an UNDISCHARGED obligation
 *      that is still replayable.
 *   3. `OutboxConsumerExecution` where status = 'completed' — the duplicate
 *      suppression record for a side effect that has already happened.
 *
 * WHAT IS NEVER ELIGIBLE, AT ANY AGE
 * ----------------------------------
 *   - `pending` events. An undelivered obligation. Deleting one loses a
 *     patient's confirmation permanently with no record that it was ever owed
 *     — precisely the failure the outbox was built to prevent. Age is not
 *     evidence of anything here: a row can sit `pending` for weeks behind a
 *     provider outage and still be owed.
 *   - `claimed` events, live lease or expired. An expired lease is NOT an
 *     abandoned row; it is the crash-recovery mechanism (outboxConfig.ts
 *     `getOutboxLeaseMs`), and the dispatcher's `reclaimExpiredOutboxLeases`
 *     will pick it up on its next tick. Deleting one deletes work in flight.
 *   - `in_progress` consumer executions. The marker is committed BEFORE the
 *     side effect. An expired one is upgraded to `ambiguous` by
 *     `beginConsumerExecution`; until then it still means "a side effect may
 *     be happening right now". Deleting it would let a retry re-send.
 *   - `ambiguous` consumer executions. This is an open operator question —
 *     "did the patient get this message?" — that only a human checking the
 *     provider can close. Deleting it answers the question by forgetting it,
 *     and un-blocks a replay that `outboxReplay.ts` was deliberately refusing.
 *
 * These are enforced by the WHERE clauses below, not by convention: every
 * builder here pins `status` to a terminal value, so widening the sweep to a
 * protected state would require editing this file.
 *
 * WHERE THE SAFETY CHECK ACTUALLY HAPPENS (F5-2R-R1)
 * ---------------------------------------------------
 * A protection like "no event still holds this idempotency key" is a statement
 * about ANOTHER table, and it is only true at an instant. The first cut of this
 * module loaded the protected keys into a JavaScript array, built a Prisma
 * `notIn` from it, selected candidates, and then reused that same array in the
 * delete. Re-using a snapshot is not re-checking: between the load and the
 * delete a replay or a producer can commit a `pending` event for a key the
 * snapshot recorded as free, and the delete — carrying the stale `notIn` —
 * removes the ledger row that was the only thing suppressing a duplicate
 * message to a patient. The same shape of hole existed for a dead event that
 * acquires an ambiguity or an in-flight replay child mid-sweep.
 *
 * So the FINAL DELETE never consults application memory for safety. Each
 * guarded category deletes through ONE statement whose `WHERE` re-derives the
 * status, the age threshold AND every protection as correlated `NOT EXISTS`
 * subqueries against the live tables. PostgreSQL evaluates that statement's
 * predicate and removes the rows in the same statement, under one snapshot
 * taken when the statement begins — so no row can be deleted whose protection
 * had committed before the delete started. The candidate id list produced by
 * the bounded batch select is still passed in, but it can only ever NARROW the
 * statement: it decides how MANY rows may go, never WHICH rows are safe.
 *
 * The Prisma predicate builders below therefore have exactly one job now:
 * choosing a bounded, cheap batch of candidates (and, through the guard sets,
 * refusing to run at all during an incident). They are no longer the safety
 * check, and a change to them cannot widen what the delete will remove.
 *
 * NO PAYLOADS. Nothing in this module reads, returns or logs `payload`. Every
 * query selects `id` (plus `idempotencyKey`, which is a contract-derived
 * identifier string, for the guards) and nothing else.
 */

import type { Prisma } from '@prisma/client';
import prisma from '../db.js';
import { runWithAuditedRawSql } from '../tenancy/auditedRawSql.js';

/**
 * Ceiling on how many protected keys/ids a guard may load before the sweep
 * refuses to act on that category.
 *
 * The guard sets are bounded by the size of the UNDELIVERED backlog, the
 * dead-letter queue, and the open ambiguity list. Each of those being small is
 * a property of a healthy system, so a set this large is not a scale problem to
 * be paginated around — it is an incident. And the single worst moment to prune
 * an idempotency ledger is during an incident that has filled the DLQ.
 *
 * So the category fails CLOSED: it deletes nothing, reports itself skipped with
 * a stable reason, and the next run tries again. Nothing is lost by waiting.
 */
export const OUTBOX_RETENTION_GUARD_SET_LIMIT = 10_000;

/** Why a category refused to run. Stable codes; never free text, never PII. */
export type OutboxRetentionSkipReason = 'GUARD_SET_LIMIT_EXCEEDED';

export class OutboxRetentionGuardLimitError extends Error {
  readonly reason: OutboxRetentionSkipReason = 'GUARD_SET_LIMIT_EXCEEDED';

  constructor(guard: string) {
    super(
      `outboxRetention: the "${guard}" protection set exceeds ` +
        `${OUTBOX_RETENTION_GUARD_SET_LIMIT} rows. Refusing to delete anything in this ` +
        'category — a backlog or dead-letter queue that large is an incident, and pruning ' +
        'idempotency evidence during an incident is exactly what must not happen. The next ' +
        'scheduled run will retry.',
    );
    this.name = 'OutboxRetentionGuardLimitError';
  }
}

/**
 * Event statuses that can still cause a side effect to be performed:
 *
 *   - `pending` / `claimed` — the dispatcher will deliver them.
 *   - `dead`               — an operator can replay them (outboxReplay.ts).
 *
 * `processed` is deliberately absent: a processed event is not replayable
 * (`replayDeadOutboxEvent` refuses it with `NOT_TERMINAL`) and its side effect
 * has already been recorded, so it cannot cause a second one. Including it
 * would pin the ledger to the larger `processed` population for no safety gain.
 */
const EVENT_STATUSES_THAT_CAN_STILL_ACT: readonly string[] = Object.freeze([
  'pending',
  'claimed',
  'dead',
]);

/**
 * A replay child in one of these states is still in flight, so its dead parent
 * is still the only explanation of why the child exists. Shared by the guard
 * loader and by the guarded delete so the two can never disagree about what
 * "in flight" means.
 */
const REPLAY_CHILD_STATUSES_IN_FLIGHT: readonly string[] = Object.freeze(['pending', 'claimed']);

/** The one open, human-only consumer-execution state. */
const EXECUTION_STATUS_AMBIGUOUS = 'ambiguous';

/**
 * Test-only seam, and deliberately a parameter rather than module state.
 *
 * The whole point of the guarded delete is what happens to a row that becomes
 * protected AFTER it was selected as a candidate. That window cannot be
 * observed from outside, so the concurrency tests need a place to commit the
 * competing write while a real sweep is suspended between its two steps.
 *
 * `dataRetentionCleanupJob.ts` calls these functions through
 * `DataRetentionCategoryDeps.executeCleanupBatch`, whose signature is
 * `(threshold, batchSize)` — so production has no way to pass a hook, and the
 * seam cannot be left switched on by a forgotten global.
 */
export interface OutboxRetentionBatchHooks {
  /**
   * Awaited after the bounded candidate select and BEFORE the guarded delete.
   * Receives the candidate ids only — never a payload, never a business key.
   */
  readonly afterCandidateSelection?: (candidateIds: readonly string[]) => Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Guard loaders. Each returns a bounded set, or throws OutboxRetentionGuardLimitError.
// ─────────────────────────────────────────────────────────────────────────────

async function takeBounded<T>(
  guard: string,
  load: (take: number) => Promise<T[]>,
): Promise<T[]> {
  // limit + 1: the extra row is how "at the ceiling" is distinguished from
  // "exactly at the ceiling and fine".
  const rows = await load(OUTBOX_RETENTION_GUARD_SET_LIMIT + 1);
  if (rows.length > OUTBOX_RETENTION_GUARD_SET_LIMIT) {
    throw new OutboxRetentionGuardLimitError(guard);
  }
  return rows;
}

/**
 * Business idempotency keys held by an event that can still act. A `completed`
 * consumer-execution row carrying one of these keys is the ONLY thing
 * suppressing a duplicate side effect for it, and is therefore not deletable at
 * any age.
 */
export async function loadIdempotencyKeysStillHeldByEvents(): Promise<string[]> {
  const rows = await takeBounded('events-that-can-still-act', (take) =>
    prisma.outboxEvent.groupBy({
      by: ['idempotencyKey'],
      where: { status: { in: [...EVENT_STATUSES_THAT_CAN_STILL_ACT] } },
      orderBy: { idempotencyKey: 'asc' },
      take,
    }),
  );
  return rows.map((r) => r.idempotencyKey);
}

/**
 * Idempotency keys with an UNRESOLVED ambiguity. The dead event carrying such a
 * key is the operator's only handle on "did this message actually go out?", so
 * it is protected until a human resolves the ambiguity — by replaying with an
 * explicit acknowledgement, which deletes the ambiguous marker, or by the
 * consumer completing it.
 *
 * Matched on `idempotencyKey` alone rather than on `(consumerKey,
 * idempotencyKey)`: resolving the consumer key would mean re-deriving it from
 * the contract registry per row, and an event whose contract is no longer
 * registered would then silently lose its protection. Over-protecting is the
 * only acceptable direction of error here.
 */
export async function loadAmbiguousExecutionIdempotencyKeys(): Promise<string[]> {
  const rows = await takeBounded('ambiguous-consumer-executions', (take) =>
    prisma.outboxConsumerExecution.groupBy({
      by: ['idempotencyKey'],
      where: { status: EXECUTION_STATUS_AMBIGUOUS },
      orderBy: { idempotencyKey: 'asc' },
      take,
    }),
  );
  return rows.map((r) => r.idempotencyKey);
}

/**
 * Dead events that a still-live replay descends from.
 *
 * Replay creates a NEW event with `causationId` pointing at the dead parent, and
 * the parent stays dead as evidence. While that child is `pending` or `claimed`
 * the parent is the only explanation of why the child exists, and
 * `replayDeadOutboxEvent`'s own `REPLAY_IN_FLIGHT` refusal reads exactly this
 * relationship. Deleting the parent mid-replay would break both.
 */
export async function loadDeadEventIdsWithLiveReplay(): Promise<string[]> {
  const rows = await takeBounded('in-flight-replay-parents', (take) =>
    prisma.outboxEvent.groupBy({
      by: ['causationId'],
      where: { status: { in: [...REPLAY_CHILD_STATUSES_IN_FLIGHT] }, causationId: { not: null } },
      orderBy: { causationId: 'asc' },
      take,
    }),
  );
  return rows
    .map((r) => r.causationId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// WHERE builders — CANDIDATE SELECTION and dry-run counting.
//
// Shared by countEligible (dry-run) and by the batch select inside
// executeCleanupBatch, so the number an operator sees in a dry run is produced
// by the same rule the sweep then acts on.
//
// What they are NOT is the safety check. Every guard they express as a `notIn`
// is re-derived from the live tables by the guarded delete (see
// `deleteGuardedDeadOutboxEvents` / `deleteGuardedCompletedConsumerExecutions`),
// which is where a protection that appeared mid-sweep is actually caught. The
// snapshot here can only exclude rows that were ALREADY protected when it was
// taken — it can never admit one the delete would refuse.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `processed` events past the window.
 *
 * Aged on `processedAt`, not `createdAt`: an event published months ago and
 * finally delivered yesterday is fresh evidence of a recent delivery, and
 * ageing it on creation would discard it immediately.
 *
 * NO GUARD IS NEEDED HERE, and that is worth stating rather than assuming:
 *   - a processed event is not replayable (`NOT_TERMINAL`), so deleting it
 *     cannot cause a second side effect;
 *   - it may itself be the replay CHILD of a dead parent, but the parent keeps
 *     its own `replayCount`, and the AuditLog row for the replay is never
 *     deleted by this job, so the trail survives;
 *   - deleting it frees its `dedupeKey` (producer-side "do not publish this
 *     fact twice" suppression). That is safe because the *business* protection
 *     is the consumer ledger, which outlives every event window by
 *     construction — and because the one registered producer publishes only
 *     inside the conversion transaction of an AppointmentRequest that is
 *     already marked `converted`, so the fact cannot recur anyway.
 */
export function buildProcessedEventRetentionWhere(threshold: Date): Prisma.OutboxEventWhereInput {
  return {
    status: 'processed',
    processedAt: { not: null, lt: threshold },
  };
}

/**
 * `dead` events past the window, minus the two protected sets.
 *
 * Aged on `deadLetteredAt` — when the obligation was declared lost — which is
 * when the operator clock actually starts.
 */
export function buildDeadEventRetentionWhere(
  threshold: Date,
  guards: { readonly liveReplayParentIds: readonly string[]; readonly ambiguousIdempotencyKeys: readonly string[] },
): Prisma.OutboxEventWhereInput {
  const where: Prisma.OutboxEventWhereInput = {
    status: 'dead',
    deadLetteredAt: { not: null, lt: threshold },
  };

  // Empty `notIn` arrays are omitted rather than passed: an empty NOT IN is a
  // needless clause at best and connector-dependent at worst.
  if (guards.liveReplayParentIds.length > 0) {
    where.id = { notIn: [...guards.liveReplayParentIds] };
  }
  if (guards.ambiguousIdempotencyKeys.length > 0) {
    where.idempotencyKey = { notIn: [...guards.ambiguousIdempotencyKeys] };
  }

  return where;
}

/**
 * `completed` consumer executions past the window, minus every key still held
 * by an event that can act.
 *
 * This is THE invariant of F5-2R, expressed as a predicate rather than as a
 * comment: a ledger row is deletable only once nothing remains that could ask
 * it "has this already happened?".
 */
export function buildCompletedExecutionRetentionWhere(
  threshold: Date,
  guards: { readonly idempotencyKeysStillHeldByEvents: readonly string[] },
): Prisma.OutboxConsumerExecutionWhereInput {
  const where: Prisma.OutboxConsumerExecutionWhereInput = {
    status: 'completed',
    completedAt: { not: null, lt: threshold },
  };

  if (guards.idempotencyKeysStillHeldByEvents.length > 0) {
    where.idempotencyKey = { notIn: [...guards.idempotencyKeysStillHeldByEvents] };
  }

  return where;
}

// ─────────────────────────────────────────────────────────────────────────────
// Category operations, in the shape dataRetentionCleanupJob.ts already consumes.
// ─────────────────────────────────────────────────────────────────────────────

export async function countEligibleProcessedOutboxEvents(threshold: Date): Promise<number> {
  return prisma.outboxEvent.count({ where: buildProcessedEventRetentionWhere(threshold) });
}

/**
 * The one category with NO cross-row protection, and therefore the one that
 * needs no guarded statement: `status` and `processedAt` are columns of the row
 * being deleted, so re-stating them in the `deleteMany` already re-evaluates
 * them in the database, at delete time, against the row's current values. There
 * is no second table whose state could change underneath it.
 */
export async function deleteProcessedOutboxEventBatch(
  threshold: Date,
  batchSize: number,
  hooks?: OutboxRetentionBatchHooks,
): Promise<number> {
  const where = buildProcessedEventRetentionWhere(threshold);
  const ids = await selectCandidateEventIds(where, batchSize);
  if (ids.length === 0) return 0;

  await hooks?.afterCandidateSelection?.(ids);

  const { count } = await prisma.outboxEvent.deleteMany({
    where: { AND: [where, { id: { in: [...ids] } }] },
  });
  return count;
}

export async function countEligibleDeadOutboxEvents(threshold: Date): Promise<number> {
  const where = buildDeadEventRetentionWhere(threshold, {
    liveReplayParentIds: await loadDeadEventIdsWithLiveReplay(),
    ambiguousIdempotencyKeys: await loadAmbiguousExecutionIdempotencyKeys(),
  });
  return prisma.outboxEvent.count({ where });
}

export async function deleteDeadOutboxEventBatch(
  threshold: Date,
  batchSize: number,
  hooks?: OutboxRetentionBatchHooks,
): Promise<number> {
  const where = buildDeadEventRetentionWhere(threshold, {
    liveReplayParentIds: await loadDeadEventIdsWithLiveReplay(),
    ambiguousIdempotencyKeys: await loadAmbiguousExecutionIdempotencyKeys(),
  });

  const ids = await selectCandidateEventIds(where, batchSize);
  if (ids.length === 0) return 0;

  await hooks?.afterCandidateSelection?.(ids);

  return deleteGuardedDeadOutboxEvents(ids, threshold);
}

export async function countEligibleCompletedConsumerExecutions(threshold: Date): Promise<number> {
  const where = buildCompletedExecutionRetentionWhere(threshold, {
    idempotencyKeysStillHeldByEvents: await loadIdempotencyKeysStillHeldByEvents(),
  });
  return prisma.outboxConsumerExecution.count({ where });
}

export async function deleteCompletedConsumerExecutionBatch(
  threshold: Date,
  batchSize: number,
  hooks?: OutboxRetentionBatchHooks,
): Promise<number> {
  const where = buildCompletedExecutionRetentionWhere(threshold, {
    idempotencyKeysStillHeldByEvents: await loadIdempotencyKeysStillHeldByEvents(),
  });

  const rows = await prisma.outboxConsumerExecution.findMany({
    where,
    select: { id: true },
    take: batchSize,
  });
  if (rows.length === 0) return 0;
  const ids = rows.map((r) => r.id);

  await hooks?.afterCandidateSelection?.(ids);

  return deleteGuardedCompletedConsumerExecutions(ids, threshold);
}

// ─────────────────────────────────────────────────────────────────────────────
// Bounded candidate selection, then the guarded delete.
//
// Deliberately NOT one unbounded `DELETE ... WHERE <predicate>`: that takes row
// locks proportional to the whole eligible set in a single transaction, which is
// the long-lock behaviour the retention design forbids. Partial progress is safe
// and a rerun picks up where this left off, because a deleted row can never be
// selected again — and a row the guarded delete REFUSED is simply offered again
// on the next run, by which time the protection may have been resolved.
// ─────────────────────────────────────────────────────────────────────────────

async function selectCandidateEventIds(
  where: Prisma.OutboxEventWhereInput,
  batchSize: number,
): Promise<string[]> {
  const rows = await prisma.outboxEvent.findMany({ where, select: { id: true }, take: batchSize });
  return rows.map((r) => r.id);
}

/**
 * THE GUARDED DEAD-EVENT DELETE.
 *
 * One statement. Its `WHERE` re-derives, in PostgreSQL, at delete time:
 *
 *   - the terminal status and the age threshold, from the row's own columns;
 *   - that NO consumer execution is currently `ambiguous` for the row's
 *     idempotency key — an unresolved "did the patient actually get this?"
 *     that only a human can close, and whose dead event is the operator's only
 *     handle on it;
 *   - that NO event currently in flight names the row as its `causationId` —
 *     an in-flight replay whose parent is the evidence of what it is replaying.
 *
 * `candidateIds` is the ONLY thing carried over from the batch select, and it
 * can only narrow: a row that acquired either protection after being selected
 * is still in the array and is still refused, because both `NOT EXISTS`
 * subqueries read the live tables under this statement's own snapshot.
 *
 * Raw because Prisma cannot express a correlated `NOT EXISTS`: `OutboxEvent` has
 * no declared relation either to `OutboxConsumerExecution` (they meet on a
 * business `idempotencyKey`, not a foreign key) or to itself through
 * `causationId`, so `deleteMany` has no way to say "and nothing over there
 * refers to me". Expressing it as a loaded `notIn` is exactly the stale-snapshot
 * bug this replaces.
 */
async function deleteGuardedDeadOutboxEvents(
  candidateIds: readonly string[],
  threshold: Date,
): Promise<number> {
  const ids = [...candidateIds];
  const ambiguous = EXECUTION_STATUS_AMBIGUOUS;
  const inFlight = [...REPLAY_CHILD_STATUSES_IN_FLIGHT];

  return runWithAuditedRawSql(
    {
      registryKey: 'outbox/outboxRetention',
      justification:
        'Cross-tenant by design: a retention sweep that could see one organization could not clean ' +
        'the table. Reachable only from dataRetentionCleanupJob.ts under the shared job lock (which ' +
        'runs its callback as system) or from the platform-admin manual-run route, neither of which ' +
        'is tenant execution. The statement carries no tenant predicate and returns no rows at all — ' +
        'only an affected-row count. Every value is parameterized.',
    },
    async () =>
      prisma.$executeRaw`
        DELETE FROM "OutboxEvent" AS e
        WHERE e."id" = ANY(${ids}::text[])
          AND e."status" = 'dead'
          AND e."deadLetteredAt" IS NOT NULL
          AND e."deadLetteredAt" < ${threshold}
          AND NOT EXISTS (
            SELECT 1
            FROM "OutboxConsumerExecution" x
            WHERE x."idempotencyKey" = e."idempotencyKey"
              AND x."status" = ${ambiguous}
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "OutboxEvent" c
            WHERE c."causationId" = e."id"
              AND c."status" = ANY(${inFlight}::text[])
          )
      `,
  );
}

/**
 * THE GUARDED LEDGER DELETE — the highest-consequence statement in F5-2R.
 *
 * A `completed` consumer execution is the record that suppresses a duplicate
 * side effect. Deleting one while any event that can still act carries its key
 * does not lose an audit row: it re-arms a message to a patient, months later,
 * silently. So the protection is re-derived here, in the same statement that
 * removes the row, from the live `OutboxEvent` table.
 *
 * `processed` is deliberately NOT in the protected set (see
 * `EVENT_STATUSES_THAT_CAN_STILL_ACT`).
 */
async function deleteGuardedCompletedConsumerExecutions(
  candidateIds: readonly string[],
  threshold: Date,
): Promise<number> {
  const ids = [...candidateIds];
  const stillActing = [...EVENT_STATUSES_THAT_CAN_STILL_ACT];

  return runWithAuditedRawSql(
    {
      registryKey: 'outbox/outboxRetention',
      justification:
        'Cross-tenant by design, and necessarily so: an idempotency key is pinned by an event in ANY ' +
        'organization that carries it, so a per-tenant predicate would make the ledger guard weaker, ' +
        'not safer. Reachable only from dataRetentionCleanupJob.ts under the shared job lock or from ' +
        'the platform-admin manual-run route — neither is tenant execution. Returns an affected-row ' +
        'count and no rows. Every value is parameterized.',
    },
    async () =>
      prisma.$executeRaw`
        DELETE FROM "OutboxConsumerExecution" AS x
        WHERE x."id" = ANY(${ids}::text[])
          AND x."status" = 'completed'
          AND x."completedAt" IS NOT NULL
          AND x."completedAt" < ${threshold}
          AND NOT EXISTS (
            SELECT 1
            FROM "OutboxEvent" e
            WHERE e."idempotencyKey" = x."idempotencyKey"
              AND e."status" = ANY(${stillActing}::text[])
          )
      `,
  );
}

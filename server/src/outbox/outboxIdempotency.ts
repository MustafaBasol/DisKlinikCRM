/**
 * outboxIdempotency.ts — F5-2 consumer-side business idempotency.
 *
 * WHY THE OUTBOX ROW ID IS NOT ENOUGH
 * -----------------------------------
 * The dispatcher guarantees AT-LEAST-ONCE delivery. That is not a bug to be
 * engineered away; it is the price of durability, and any design that claims
 * exactly-once across a process boundary and an external provider is lying
 * about one of the two.
 *
 * So duplicates WILL happen, and the outbox row id cannot suppress them,
 * because the duplicate is not a duplicate ROW — it is a second ATTEMPT at the
 * same row, or a replay, or a producer that legitimately published the same
 * business fact twice. Suppression has to be keyed on the BUSINESS fact
 * (`idempotencyKey` from the contract), which is why this ledger is keyed on
 * `(consumerKey, idempotencyKey)` with a real UNIQUE constraint rather than an
 * application-level "check then act".
 *
 * THE PROTOCOL, AND THE WINDOW IT CANNOT CLOSE
 * --------------------------------------------
 *   1. `begin()` COMMITS an `in_progress` marker with a lease, BEFORE the side
 *      effect. Committed, not held in an open transaction: a marker inside the
 *      transaction that also performs the side effect would be rolled back by
 *      the very crash it exists to detect.
 *   2. the consumer performs the side effect.
 *   3. `complete()` marks it `completed`.
 *
 * Between 2 and 3 there is a window that NO amount of design closes without a
 * transactional external system, and WhatsApp is not one. A retry that finds an
 * expired `in_progress` marker genuinely cannot know whether the patient
 * received the message.
 *
 * This implementation refuses to guess. It does not re-send (which would mean
 * every dispatcher crash duplicates a patient message) and it does not silently
 * drop (which would mean a missing confirmation with no trace). It records the
 * execution `ambiguous` and tells the dispatcher to dead-letter the event with
 * `AMBIGUOUS_SIDE_EFFECT`, where an operator can see it, check the provider,
 * and replay deliberately if the message really did not arrive.
 *
 * F5-1P E04 measured the same shape and got "2 attempts, 1 side effect".
 *
 * EXECUTION CONTEXT: every function here is called from the dispatcher, which
 * already runs under `runAsSystem({ reason: 'background-job' })` for the claim
 * and narrows to `runAsTenant` per event. Nothing here establishes a context of
 * its own; doing so would let a consumer widen its own privilege.
 */

import prisma from '../db.js';
import { getOutboxConsumerLeaseMs } from './outboxConfig.js';

export type OutboxExecutionStatus = 'in_progress' | 'completed' | 'ambiguous';

/** What `beginConsumerExecution` decided. Exhaustive on purpose. */
export type BeginExecutionResult =
  /** No prior execution: the caller owns this one and MUST perform the side effect. */
  | { readonly decision: 'PROCEED'; readonly executionId: string }
  /** Already applied. The caller must NOT perform the side effect; the event is done. */
  | { readonly decision: 'ALREADY_COMPLETED'; readonly executionId: string }
  /**
   * Another dispatcher holds a LIVE lease on this business key. Not an error —
   * the correct response is to release the event back to `pending` with a short
   * delay and let the owner finish.
   */
  | { readonly decision: 'IN_FLIGHT_ELSEWHERE'; readonly executionId: string; readonly leaseExpiresAt: Date }
  /**
   * A previous attempt committed "about to do it" and never came back. Whether
   * the side effect happened is unknowable. Terminal, and visible.
   */
  | { readonly decision: 'AMBIGUOUS'; readonly executionId: string };

export interface BeginConsumerExecutionArgs {
  readonly consumerKey: string;
  readonly idempotencyKey: string;
  readonly organizationId: string;
  readonly clinicId: string | null;
  readonly executedBy: string;
  readonly now?: Date;
}

/**
 * Claim the right to perform a side effect exactly once for this business key.
 *
 * The insert is attempted FIRST and its unique-constraint violation is the
 * concurrency control — not a `findFirst` followed by a `create`, which has a
 * TOCTOU window that two dispatchers hit exactly when it matters most.
 */
export async function beginConsumerExecution(
  args: BeginConsumerExecutionArgs,
): Promise<BeginExecutionResult> {
  const now = args.now ?? new Date();
  const leaseExpiresAt = new Date(now.getTime() + getOutboxConsumerLeaseMs());

  try {
    const created = await prisma.outboxConsumerExecution.create({
      data: {
        consumerKey: args.consumerKey,
        idempotencyKey: args.idempotencyKey,
        organizationId: args.organizationId,
        clinicId: args.clinicId,
        status: 'in_progress',
        executedBy: args.executedBy,
        leaseExpiresAt,
        startedAt: now,
      },
      select: { id: true },
    });
    return { decision: 'PROCEED', executionId: created.id };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
  }

  // Someone got there first. Read what they left behind.
  const existing = await prisma.outboxConsumerExecution.findUnique({
    where: {
      consumerKey_idempotencyKey: {
        consumerKey: args.consumerKey,
        idempotencyKey: args.idempotencyKey,
      },
    },
    select: { id: true, status: true, leaseExpiresAt: true },
  });

  if (!existing) {
    // The row was deleted between the failed insert and this read — only a
    // retention sweep or a manual operation can do that. Treat it as a
    // transient race rather than inventing a decision: the dispatcher's own
    // retry will call this again against a now-clean state.
    throw new OutboxIdempotencyRaceError(args.consumerKey);
  }

  if (existing.status === 'completed') {
    return { decision: 'ALREADY_COMPLETED', executionId: existing.id };
  }
  if (existing.status === 'ambiguous') {
    return { decision: 'AMBIGUOUS', executionId: existing.id };
  }

  // in_progress: live lease, or an abandoned one?
  const leaseExpiresAtValue = existing.leaseExpiresAt;
  if (leaseExpiresAtValue && leaseExpiresAtValue.getTime() > now.getTime()) {
    return {
      decision: 'IN_FLIGHT_ELSEWHERE',
      executionId: existing.id,
      leaseExpiresAt: leaseExpiresAtValue,
    };
  }

  // Expired in_progress. Record the ambiguity durably — guarded on the status
  // we observed, so two dispatchers reaching this line together do not both
  // "discover" it and neither clobbers a `completed` written in between.
  await prisma.outboxConsumerExecution.updateMany({
    where: { id: existing.id, status: 'in_progress' },
    data: { status: 'ambiguous', outcomeCode: 'AMBIGUOUS_SIDE_EFFECT', updatedAt: now },
  });

  const settled = await prisma.outboxConsumerExecution.findUnique({
    where: { id: existing.id },
    select: { status: true },
  });
  if (settled?.status === 'completed') {
    // The original owner finished after all, in the gap above. Its success wins.
    return { decision: 'ALREADY_COMPLETED', executionId: existing.id };
  }
  return { decision: 'AMBIGUOUS', executionId: existing.id };
}

/**
 * Mark the side effect applied. Guarded on `in_progress` so a marker some other
 * path already resolved (to `ambiguous`, or to `completed`) is never
 * overwritten.
 */
export async function completeConsumerExecution(args: {
  executionId: string;
  outcomeCode: string;
  now?: Date;
}): Promise<void> {
  const now = args.now ?? new Date();
  await prisma.outboxConsumerExecution.updateMany({
    where: { id: args.executionId, status: 'in_progress' },
    data: { status: 'completed', completedAt: now, outcomeCode: args.outcomeCode, updatedAt: now },
  });
}

/**
 * Release a marker taken for an attempt that failed BEFORE the side effect was
 * performed.
 *
 * This is the one case where deleting the marker is correct rather than
 * dangerous: the consumer knows, positively, that nothing external happened —
 * it failed while validating, or resolving a connection, or before the provider
 * call was made. Leaving an `in_progress` marker behind would turn a clean,
 * retryable failure into a fake ambiguity on the next attempt.
 *
 * A consumer must NEVER call this after a provider call has been ISSUED, even
 * if it appeared to fail: a timeout is exactly the case where the message may
 * still have been delivered.
 */
export async function releaseUnstartedConsumerExecution(executionId: string): Promise<void> {
  await prisma.outboxConsumerExecution.deleteMany({
    where: { id: executionId, status: 'in_progress' },
  });
}

/** Read-only view for operator/DLQ inspection and tests. */
export async function findConsumerExecution(args: {
  consumerKey: string;
  idempotencyKey: string;
}): Promise<{
  id: string;
  status: OutboxExecutionStatus;
  outcomeCode: string | null;
  executedBy: string | null;
} | null> {
  const row = await prisma.outboxConsumerExecution.findUnique({
    where: {
      consumerKey_idempotencyKey: {
        consumerKey: args.consumerKey,
        idempotencyKey: args.idempotencyKey,
      },
    },
    select: { id: true, status: true, outcomeCode: true, executedBy: true },
  });
  if (!row) return null;
  return {
    id: row.id,
    status: row.status as OutboxExecutionStatus,
    outcomeCode: row.outcomeCode,
    executedBy: row.executedBy,
  };
}

export class OutboxIdempotencyRaceError extends Error {
  constructor(consumerKey: string) {
    super(
      `Idempotency marker for consumer "${consumerKey}" vanished between a unique-constraint ` +
        'violation and the follow-up read. Treated as transient.',
    );
    this.name = 'OutboxIdempotencyRaceError';
  }
}

/**
 * Prisma's unique-constraint error. Matched on `code === 'P2002'` rather than
 * `instanceof PrismaClientKnownRequestError`, which is the convention already
 * used in `clinicBulkExportPackage.ts` and survives a client regeneration.
 */
function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === 'P2002';
}

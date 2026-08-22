/**
 * outboxDispatcher.ts — F5-2 claim, execute, finalise.
 *
 * WHY THE CLAIM IS ONE RAW STATEMENT
 * ----------------------------------
 * `clinicBulkExportPackage.claimQueuedClinicBulkExportJobs()` is this
 * repository's proven claim pattern: read candidates, then a guarded per-row
 * `updateMany` where only one of N replicas can win. It is correct, and F5-1P
 * E16 measured it correct under four concurrent dispatchers (60 claims, 60
 * distinct).
 *
 * This dispatcher uses `FOR UPDATE SKIP LOCKED` instead — E16b, equally 60/60 —
 * for two reasons that are specific to an outbox rather than to a per-clinic
 * export queue:
 *
 *   1. VOLUME SHAPE. A bulk export claims at most two rows a minute. An outbox
 *      claims a batch per tick, per replica, forever. The guarded-update pattern
 *      costs one SELECT plus one UPDATE PER ROW, and the losers of each race pay
 *      a write to discover they lost. `SKIP LOCKED` claims the whole batch in a
 *      single statement and contending readers never touch a locked row at all.
 *   2. FAIRNESS HAS TO BE POSSIBLE LATER. F5-1P section 6 measured a naive
 *      post-claim per-tenant cap making quiet-tenant p50 latency FIVE TIMES
 *      WORSE (292ms -> 1,962ms), because the dispatcher claimed rows only to
 *      write them back. The conclusion was that fairness must act at SELECTION
 *      time. A `SKIP LOCKED` subquery is the shape that can later become a
 *      per-tenant lateral join without touching anything else in this file; a
 *      candidate-scan-then-guarded-update cannot.
 *
 * NO FAIRNESS IS IMPLEMENTED TODAY, deliberately. See section 6 of the F5-2
 * evidence document: at first-customer volume there is no measured contention
 * to be fair about, the trigger is not currently measurable (no production
 * observability — ADR-012 is DEFERRED), and F5-1P proved that adding a fairness
 * mechanism speculatively made things worse. `getOutboxBacklogMetrics()` exposes
 * per-tenant backlog precisely so the trigger becomes measurable.
 *
 * THE RAW SQL IS AUDITED. It is registered in `tenancy/rawSqlAuditRegistry.ts`
 * as SYSTEM_ONLY and executed inside `runWithAuditedRawSql`. It reads no tenant
 * rows and carries no tenant predicate BY DESIGN — a dispatcher that could only
 * see one organization could not drain the queue — which is exactly the case
 * the SYSTEM_ONLY classification exists for.
 *
 * ATTEMPTS ARE COUNTED AT CLAIM, NOT AT FAILURE
 * ---------------------------------------------
 * Counting on failure looks tidier and is wrong: a consumer that reliably kills
 * the PROCESS never reaches its own failure handler, so its attempt is never
 * counted, so the row is reclaimed after lease expiry forever. Incrementing
 * inside the claim statement means a crash loop is bounded by exactly the same
 * `maxAttempts` as an ordinary failure.
 */

import { Prisma } from '@prisma/client';
import prisma from '../db.js';
import { logger } from '../utils/logger.js';
import { safeErrorFields } from '../utils/safeError.js';
import { runAsTenant, type ExecutionActor } from '../tenancy/tenantContext.js';
import { runWithAuditedRawSql } from '../tenancy/auditedRawSql.js';
import {
  resolveContract,
  validatePayload,
  type OutboxEventContract,
} from './outboxEventRegistry.js';
import { getOutboxConsumer, type OutboxConsumerContext } from './outboxConsumerRegistry.js';
import {
  classifyConsumerFailure,
  computeBackoffMs,
  isRetryableCategory,
  type OutboxErrorCode,
} from './outboxErrors.js';
import {
  getOutboxClaimBatchSize,
  getOutboxLeaseMs,
  buildOutboxDispatcherId,
} from './outboxConfig.js';

/** Actor for dispatcher-driven tenant execution. Never a real user. */
const DISPATCHER_ACTOR: ExecutionActor = Object.freeze({ kind: 'SERVICE', id: null });

/** The columns the claim statement returns. Kept narrow — no `payload` bloat beyond what is needed. */
interface ClaimedOutboxRow {
  id: string;
  organizationId: string;
  clinicId: string | null;
  eventType: string;
  eventVersion: number;
  aggregateId: string;
  payload: unknown;
  idempotencyKey: string;
  correlationId: string | null;
  attemptCount: number;
}

export interface DispatchTickResult {
  readonly reclaimed: number;
  readonly claimed: number;
  readonly processed: number;
  readonly retried: number;
  readonly deadLettered: number;
  readonly deferred: number;
}

const EMPTY_TICK: DispatchTickResult = Object.freeze({
  reclaimed: 0,
  claimed: 0,
  processed: 0,
  retried: 0,
  deadLettered: 0,
  deferred: 0,
});

/**
 * Return rows whose lease has expired to `pending`.
 *
 * Guarded on `status = 'claimed'` so a row a live dispatcher finalised in the
 * same instant is never resurrected. `attemptCount` is NOT touched here: it was
 * already incremented when the row was claimed, which is what bounds a crash
 * loop.
 */
export async function reclaimExpiredOutboxLeases(now: Date = new Date()): Promise<number> {
  const result = await prisma.outboxEvent.updateMany({
    where: { status: 'claimed', leaseExpiresAt: { lt: now } },
    data: {
      status: 'pending',
      claimedAt: null,
      claimedBy: null,
      leaseExpiresAt: null,
      lastErrorCode: 'TRANSIENT',
      // Available immediately: a lost lease usually means a replica died, and
      // the work is already late. Backing off here would punish the event for
      // the dispatcher's failure.
      availableAt: now,
    },
  });
  return result.count;
}

/**
 * Claim up to `limit` dispatchable rows for this dispatcher, atomically.
 *
 * One statement: the inner `SELECT ... FOR UPDATE SKIP LOCKED` picks rows no
 * other transaction currently holds, and the outer `UPDATE ... RETURNING`
 * transitions and hands them back. Two dispatchers therefore cannot receive the
 * same row, without any advisory lock and without either of them blocking.
 */
export async function claimOutboxEvents(args: {
  dispatcherId: string;
  limit: number;
  leaseMs: number;
  now?: Date;
}): Promise<ClaimedOutboxRow[]> {
  const now = args.now ?? new Date();
  const leaseExpiresAt = new Date(now.getTime() + args.leaseMs);

  return runWithAuditedRawSql(
    {
      registryKey: 'outbox/outboxDispatcher',
      justification:
        'Cross-tenant by design: the dispatcher drains every organization\'s outbox. Runs only ' +
        'under runAsSystem({ reason: background-job }) from outboxDispatcherJob.ts. The statement ' +
        'selects on status/availableAt only and returns identifiers plus the contract-validated ' +
        'payload; per-row tenant context is established from the row\'s own server-written ' +
        'organizationId/clinicId before any consumer runs.',
    },
    async () =>
      prisma.$queryRaw<ClaimedOutboxRow[]>(Prisma.sql`
        UPDATE "OutboxEvent" AS e
        SET "status"         = 'claimed',
            "claimedAt"      = ${now},
            "claimedBy"      = ${args.dispatcherId},
            "leaseExpiresAt" = ${leaseExpiresAt},
            "attemptCount"   = e."attemptCount" + 1,
            "lastAttemptAt"  = ${now},
            "updatedAt"      = ${now}
        WHERE e."id" IN (
          SELECT c."id"
          FROM "OutboxEvent" c
          WHERE c."status" = 'pending'
            AND c."availableAt" <= ${now}
          ORDER BY c."availableAt" ASC, c."occurredAt" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ${args.limit}
        )
        RETURNING e."id",
                  e."organizationId",
                  e."clinicId",
                  e."eventType",
                  e."eventVersion",
                  e."aggregateId",
                  e."payload",
                  e."idempotencyKey",
                  e."correlationId",
                  e."attemptCount"
      `),
  );
}

/** Terminal success. Guarded so a reclaim that raced us cannot be overwritten. */
async function markProcessed(eventId: string, now: Date): Promise<void> {
  await prisma.outboxEvent.updateMany({
    where: { id: eventId, status: 'claimed' },
    data: {
      status: 'processed',
      processedAt: now,
      claimedAt: null,
      claimedBy: null,
      leaseExpiresAt: null,
      lastErrorCode: null,
    },
  });
}

/** Terminal failure. `code` is a stable classification; never free text, never a provider body. */
async function markDead(eventId: string, code: OutboxErrorCode, now: Date): Promise<void> {
  await prisma.outboxEvent.updateMany({
    where: { id: eventId, status: 'claimed' },
    data: {
      status: 'dead',
      deadLetteredAt: now,
      deadLetterCode: code,
      lastErrorCode: code,
      claimedAt: null,
      claimedBy: null,
      leaseExpiresAt: null,
    },
  });
}

/** Back to `pending`, not before `availableAt`. */
async function markRetry(
  eventId: string,
  code: OutboxErrorCode,
  availableAt: Date,
): Promise<void> {
  await prisma.outboxEvent.updateMany({
    where: { id: eventId, status: 'claimed' },
    data: {
      status: 'pending',
      availableAt,
      lastErrorCode: code,
      claimedAt: null,
      claimedBy: null,
      leaseExpiresAt: null,
    },
  });
}

/**
 * Release a claim WITHOUT counting it against the event.
 *
 * Used for two cases that are not the event's fault: another dispatcher owns
 * the business key right now, and this process is shutting down. The attempt
 * was already counted at claim time, so this is deliberately generous — but the
 * generosity is bounded, because the count still stands.
 */
async function releaseClaim(eventId: string, availableAt: Date): Promise<void> {
  await prisma.outboxEvent.updateMany({
    where: { id: eventId, status: 'claimed' },
    data: {
      status: 'pending',
      availableAt,
      claimedAt: null,
      claimedBy: null,
      leaseExpiresAt: null,
    },
  });
}

type EventDisposition = 'processed' | 'retried' | 'dead' | 'deferred';

/**
 * Execute ONE claimed event end to end.
 *
 * Order is load-bearing:
 *   1. resolve the contract  — an unregistered/unsupported pair is POISON, dead
 *      at attempt 1, and must never reach a consumer;
 *   2. re-validate the payload — a row written by an older application version,
 *      or by hand, is dead-lettered rather than handed over (F5-1P E20);
 *   3. resolve the consumer;
 *   4. only then establish tenant context and hand over.
 *
 * Steps 1-3 are infrastructure judgements about a malformed event and are
 * deliberately made OUTSIDE tenant execution — there is nothing tenant-scoped
 * about refusing to interpret a row.
 */
async function executeClaimedEvent(row: ClaimedOutboxRow): Promise<EventDisposition> {
  const now = new Date();

  const resolved = resolveContract(row.eventType, row.eventVersion);
  if (!resolved.ok) {
    const code: OutboxErrorCode =
      resolved.violation.kind === 'UNREGISTERED_EVENT' ? 'UNREGISTERED_EVENT' : 'UNSUPPORTED_VERSION';
    logger.error(
      { eventId: row.id, eventType: row.eventType, eventVersion: row.eventVersion, code },
      'outbox-dispatcher: refusing an event with no registered contract',
    );
    await markDead(row.id, code, now);
    return 'dead';
  }
  const contract = resolved.contract;

  // Bounded retry. Checked here rather than only after a failure so that a row
  // which reached the ceiling through repeated LEASE EXPIRY (a crash loop, where
  // no failure handler ever ran) is still terminated.
  if (row.attemptCount > contract.maxAttempts) {
    logger.error(
      { eventId: row.id, eventType: row.eventType, attemptCount: row.attemptCount, maxAttempts: contract.maxAttempts },
      'outbox-dispatcher: attempt ceiling reached, dead-lettering',
    );
    await markDead(row.id, 'MAX_ATTEMPTS_EXCEEDED', now);
    return 'dead';
  }

  const payloadCheck = validatePayload(contract, row.payload);
  if (!payloadCheck.ok) {
    logger.error(
      {
        eventId: row.id,
        eventType: row.eventType,
        eventVersion: row.eventVersion,
        // `reason` names FIELDS, never values — see validatePayload.
        reason: payloadCheck.violation.kind === 'MALFORMED_PAYLOAD' ? payloadCheck.violation.reason : 'unknown',
      },
      'outbox-dispatcher: payload violates its registered contract, dead-lettering',
    );
    await markDead(row.id, 'MALFORMED_PAYLOAD', now);
    return 'dead';
  }

  const consumer = getOutboxConsumer(contract.consumerKey);
  if (!consumer) {
    logger.error(
      { eventId: row.id, eventType: row.eventType, consumerKey: contract.consumerKey },
      'outbox-dispatcher: no consumer registered for this contract',
    );
    await markDead(row.id, 'NO_CONSUMER', now);
    return 'dead';
  }

  const ctx: OutboxConsumerContext = Object.freeze({
    eventId: row.id,
    eventType: row.eventType,
    eventVersion: row.eventVersion,
    organizationId: row.organizationId,
    clinicId: row.clinicId,
    aggregateId: row.aggregateId,
    payload: Object.freeze({ ...(row.payload as Record<string, string>) }),
    idempotencyKey: row.idempotencyKey,
    correlationId: row.correlationId,
    attemptCount: row.attemptCount,
    contract,
  });

  try {
    // Tenant context reconstructed from the row's OWN server-written ownership
    // columns — never from the payload, which the registry's field allowlist
    // makes incapable of carrying a tenant id in the first place (F5-1P T5).
    const outcome = await runAsTenant(
      {
        organizationId: row.organizationId,
        clinicScope: row.clinicId
          ? { kind: 'EXPLICIT', clinicIds: [row.clinicId] }
          : { kind: 'ORGANIZATION_WIDE' },
        actor: DISPATCHER_ACTOR,
        correlationId: row.correlationId ?? undefined,
      },
      () => consumer.handle(ctx),
    );

    await markProcessed(row.id, new Date());
    logger.info(
      { eventId: row.id, eventType: row.eventType, result: outcome.result, outcomeCode: outcome.outcomeCode },
      'outbox-dispatcher: event finalised',
    );
    return 'processed';
  } catch (err) {
    return finaliseFailure(row, contract, err);
  }
}

/**
 * `OutboxDeferError` is not a failure — it is a consumer saying "someone else
 * owns this business key right now". Kept distinct so it never consumes the
 * retry budget's error classification or pollutes failure metrics.
 */
export class OutboxDeferError extends Error {
  readonly retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super('Outbox event deferred: the business key is in flight elsewhere.');
    this.name = 'OutboxDeferError';
    this.retryAfterMs = retryAfterMs;
  }
}

async function finaliseFailure(
  row: ClaimedOutboxRow,
  contract: OutboxEventContract,
  err: unknown,
): Promise<EventDisposition> {
  const now = new Date();

  if (err instanceof OutboxDeferError) {
    await releaseClaim(row.id, new Date(now.getTime() + err.retryAfterMs));
    return 'deferred';
  }

  const { category, code, retryAfterMs } = classifyConsumerFailure(err);

  // Only the classification is logged. `safeErrorFields` gives name+code and
  // nothing else — no message, no provider body, no patient data.
  logger.error(
    {
      eventId: row.id,
      eventType: row.eventType,
      eventVersion: row.eventVersion,
      attemptCount: row.attemptCount,
      category,
      code,
      ...safeErrorFields(err),
    },
    'outbox-dispatcher: dispatch attempt failed',
  );

  if (!isRetryableCategory(category)) {
    await markDead(row.id, code, now);
    return 'dead';
  }

  if (row.attemptCount >= contract.maxAttempts) {
    await markDead(row.id, 'MAX_ATTEMPTS_EXCEEDED', now);
    return 'dead';
  }

  const backoffMs = computeBackoffMs(category, row.attemptCount, { retryAfterMs });
  await markRetry(row.id, code, new Date(now.getTime() + backoffMs));
  return 'retried';
}

// ─────────────────────────────────────────────────────────────────────────────
// Tick
// ─────────────────────────────────────────────────────────────────────────────

let shuttingDown = false;

/** Exported for the job wrapper and tests; production callers go through the job. */
export function setOutboxDispatcherShuttingDown(value: boolean): void {
  shuttingDown = value;
}

export function isOutboxDispatcherShuttingDown(): boolean {
  return shuttingDown;
}

/**
 * One dispatcher tick: reclaim abandoned leases, claim a batch, run it with
 * bounded concurrency.
 *
 * Bounded by construction rather than by a semaphore: `claimOutboxEvents` never
 * returns more than `limit` rows, so `Promise.all` over the result is already
 * capped. That is the same reasoning `clinicBulkExportWorker.runTick` records.
 *
 * MUST be called from inside a system execution context — `outboxDispatcherJob`
 * establishes it. This function does not establish one itself, deliberately: a
 * library function that silently grants itself system privilege is how a
 * defence-in-depth layer becomes decorative.
 */
export async function runOutboxDispatchTick(options?: {
  dispatcherId?: string;
  limit?: number;
  leaseMs?: number;
}): Promise<DispatchTickResult> {
  if (shuttingDown) return EMPTY_TICK;

  const dispatcherId = options?.dispatcherId ?? buildOutboxDispatcherId();
  const limit = options?.limit ?? getOutboxClaimBatchSize();
  const leaseMs = options?.leaseMs ?? getOutboxLeaseMs();

  const reclaimed = await reclaimExpiredOutboxLeases();
  if (shuttingDown) return { ...EMPTY_TICK, reclaimed };

  const rows = await claimOutboxEvents({ dispatcherId, limit, leaseMs });
  if (rows.length === 0) return { ...EMPTY_TICK, reclaimed };

  if (shuttingDown) {
    // Shutdown began while the claim was in flight. These rows were already
    // transitioned to `claimed`; hand them straight back so no row is left
    // stuck in `claimed` waiting out a five-minute lease (F5-1P E22).
    const releaseAt = new Date();
    await Promise.allSettled(rows.map((r) => releaseClaim(r.id, releaseAt)));
    return { ...EMPTY_TICK, reclaimed, deferred: rows.length };
  }

  const dispositions = await Promise.all(
    rows.map((row) =>
      executeClaimedEvent(row).catch(async (err): Promise<EventDisposition> => {
        // A throw from executeClaimedEvent itself (a database failure while
        // finalising, not a consumer failure) must never strand the row in
        // `claimed` for a whole lease period.
        logger.error(
          { eventId: row.id, ...safeErrorFields(err) },
          'outbox-dispatcher: dispatch loop failed outside the consumer; releasing the claim',
        );
        await releaseClaim(row.id, new Date()).catch(() => {});
        return 'deferred';
      }),
    ),
  );

  return {
    reclaimed,
    claimed: rows.length,
    processed: dispositions.filter((d) => d === 'processed').length,
    retried: dispositions.filter((d) => d === 'retried').length,
    deadLettered: dispositions.filter((d) => d === 'dead').length,
    deferred: dispositions.filter((d) => d === 'deferred').length,
  };
}

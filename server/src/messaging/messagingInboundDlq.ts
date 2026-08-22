/**
 * messagingInboundDlq.ts — F5-3 terminal state, inspection and metrics for the
 * inbound messaging ledger.
 *
 * WHAT THIS DOES NOT DO, DELIBERATELY
 * -----------------------------------
 * It does not create a second ledger. F5-1/F5-1P established that
 * `MessagingInboundEvent` already provides durable acceptance, DB-enforced
 * provider dedupe, tenant references and bounded retry state across Meta
 * WhatsApp, Instagram and Evolution WhatsApp, and that a queue placed after
 * that point cannot improve the guarantee (F5-1P M1/section 7). Copying failed
 * rows into a DLQ table would duplicate message content — including
 * `rawPayload`, which carries the patient's actual message — into a second
 * retention surface for no guarantee gained.
 *
 * So the "DLQ" is a **state on the existing row**, plus a read model that is
 * safe to put in front of an operator.
 *
 * THE GAP THIS CLOSES
 * -------------------
 * At the F5-3 baseline, `status` is `received | processing | processed |
 * failed`, and `failed` means four completely different things that nothing can
 * tell apart:
 *
 *   1. a transient failure that WILL be retried;
 *   2. one that hit `attempts >= 3` and never will be;
 *   3. one that aged past the six-hour retry window and never will be, even
 *      though `attempts` is still 1 — the most misleading of the four, because
 *      the row looks retryable forever;
 *   4. an Evolution or Instagram event, which the retry job never selects at
 *      all because it filters `provider: 'meta_cloud_api'`.
 *
 * Cases 2-4 are terminal and nothing said so. `status = 'dead'` plus a stable
 * `lastErrorCode` and `deadLetteredAt` makes the distinction real, queryable,
 * and alarmable.
 *
 * KVKK
 * ----
 * `MessagingInboundEvent.rawPayload` is the patient's message and
 * `errorMessage` may hold a raw exception string written by the pre-F5-3
 * writer. **Neither is ever selected here.** The read model returns
 * identifiers, stable codes, counts and timestamps — enough to diagnose,
 * nothing to disclose.
 */

import prisma from '../db.js';
import { runAsSystem } from '../tenancy/tenantContext.js';
import type { MessagingFailureCode } from './messagingFailureClassification.js';

/**
 * `MessagingInboundEvent` is one of the five models F3-1 classified
 * `EXPLICIT_REVIEW_REQUIRED`, and the F3-2 decision made it system-owned with
 * the narrow `inbound-webhook-envelope` reason. Everything in this module reads
 * or writes that model, so it runs under the same reason
 * `messagingInboundIdempotency.ts` already uses. **No new system-context reason
 * is introduced by F5-3.**
 *
 * Tenant scoping is not weakened by system execution: every caller-facing
 * function below takes a REQUIRED `organizationId` and applies it as a
 * predicate. System execution is what lets the row be read at all; the
 * predicate is what keeps it the caller's row.
 */
const asInboundLedgerSystem = <T>(fn: () => Promise<T>): Promise<T> =>
  runAsSystem({ reason: 'inbound-webhook-envelope', detail: 'messaging-dlq' }, fn);

export const MESSAGING_INBOUND_TERMINAL_STATUS = 'dead' as const;

/**
 * Move one event to the terminal state.
 *
 * Guarded on the statuses a terminal transition may come FROM, so a row a
 * concurrent processor has already moved to `processed` is never clobbered — a
 * late-arriving success beats a late-arriving giving-up.
 */
export async function deadLetterInboundEvent(args: {
  eventId: string;
  code: MessagingFailureCode;
  now?: Date;
}): Promise<{ transitioned: boolean }> {
  const now = args.now ?? new Date();
  const result = await asInboundLedgerSystem(() =>
    prisma.messagingInboundEvent.updateMany({
      where: { id: args.eventId, status: { in: ['failed', 'processing', 'received'] } },
      data: {
        status: MESSAGING_INBOUND_TERMINAL_STATUS,
        lastErrorCode: args.code,
        deadLetteredAt: now,
        nextAttemptAt: null,
        // `errorMessage` is deliberately NOT written here. The stable code is
        // the diagnosis; a free-text field is how provider bodies got into an
        // operational column in the first place.
      },
    }),
  );
  return { transitioned: result.count > 0 };
}

export interface DeadInboundEventView {
  id: string;
  channel: string;
  provider: string;
  connectionId: string | null;
  clinicId: string | null;
  /** The provider's own message id. Needed to correlate with the provider's console. */
  providerMessageId: string;
  attempts: number;
  lastErrorCode: string | null;
  deadLetteredAt: Date | null;
  createdAt: Date;
  /** Derived, so an operator sees "how long has this been broken" without arithmetic. */
  ageMs: number;
  replayCount: number;
}

/**
 * Tenant-scoped dead-letter listing.
 *
 * `organizationId` is REQUIRED and applied as a predicate — there is
 * deliberately no "all organizations" mode. An operator view that defaults to
 * every tenant is one forgotten parameter away from a cross-tenant disclosure;
 * a genuine platform-wide view is a separate, separately authorized contract,
 * not this function with an optional argument.
 *
 * Returns NO `rawPayload` and NO `errorMessage`. `fromPhone`/`toPhone` are also
 * withheld: a phone number is the patient's identifier, and `providerMessageId`
 * plus `connectionId` is enough to find the conversation in the provider's own
 * console without putting a patient identifier on an operator's screen.
 */
export async function listDeadInboundEvents(args: {
  organizationId: string;
  clinicId?: string | null;
  channel?: string;
  provider?: string;
  limit?: number;
  now?: Date;
}): Promise<DeadInboundEventView[]> {
  const now = args.now ?? new Date();
  const take = Math.min(Math.max(1, Math.floor(args.limit ?? 50)), 200);

  const rows = await asInboundLedgerSystem(() =>
    prisma.messagingInboundEvent.findMany({
      where: {
        organizationId: args.organizationId,
        status: MESSAGING_INBOUND_TERMINAL_STATUS,
        ...(args.clinicId ? { clinicId: args.clinicId } : {}),
        ...(args.channel ? { channel: args.channel } : {}),
        ...(args.provider ? { provider: args.provider } : {}),
      },
      orderBy: { deadLetteredAt: 'desc' },
      take,
      select: {
        id: true,
        channel: true,
        provider: true,
        connectionId: true,
        clinicId: true,
        providerMessageId: true,
        attempts: true,
        lastErrorCode: true,
        deadLetteredAt: true,
        createdAt: true,
        replayCount: true,
        // rawPayload, errorMessage, fromPhone, toPhone: deliberately absent.
      },
    }),
  );

  return rows.map((r) => ({
    ...r,
    ageMs: Math.max(0, now.getTime() - r.createdAt.getTime()),
  }));
}

export interface MessagingInboundMetrics {
  readonly received: number;
  readonly processing: number;
  readonly processed: number;
  readonly failed: number;
  readonly dead: number;
  /** Failed rows whose backoff has elapsed — genuinely waiting on the retry job. */
  readonly retryDue: number;
  /** Failed rows still in backoff. Waiting by design. */
  readonly retryScheduled: number;
  /** Age of the oldest row not yet processed or dead. THE backlog alarm. */
  readonly oldestUnresolvedAgeMs: number | null;
  readonly oldestDeadAgeMs: number | null;
  /** Failure shape by stable code — never a message. */
  readonly deadByCode: Readonly<Record<string, number>>;
  /** Bounded by channel/provider count (three today), never by clinic or patient. */
  readonly byChannelProvider: ReadonlyArray<{
    channel: string;
    provider: string;
    failed: number;
    dead: number;
  }>;
  readonly measuredAt: Date;
}

/**
 * Platform-wide operational snapshot.
 *
 * Cross-tenant BY DESIGN — "is messaging healthy" is not a tenant question, and
 * the whole point is to see a provider outage that affects every clinic at
 * once. It is therefore an engineer/platform-operator signal, and its
 * dimensions are bounded accordingly: status, channel and provider only. There
 * is no per-clinic or per-patient slice, because that would be unbounded
 * cardinality AND a KVKK surface, and it would not answer the question anyway.
 */
export async function getMessagingInboundMetrics(
  now: Date = new Date(),
): Promise<MessagingInboundMetrics> {
  const [byStatus, retryDue, retryScheduled, oldestUnresolved, oldestDead, deadByCodeRows, byChannel] =
    await asInboundLedgerSystem(() =>
      Promise.all([
        prisma.messagingInboundEvent.groupBy({ by: ['status'], _count: { _all: true } }),
        prisma.messagingInboundEvent.count({
          where: {
            status: 'failed',
            OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
          },
        }),
        prisma.messagingInboundEvent.count({
          where: { status: 'failed', nextAttemptAt: { gt: now } },
        }),
        prisma.messagingInboundEvent.aggregate({
          where: { status: { in: ['received', 'processing', 'failed'] } },
          _min: { createdAt: true },
        }),
        prisma.messagingInboundEvent.aggregate({
          where: { status: MESSAGING_INBOUND_TERMINAL_STATUS },
          _min: { deadLetteredAt: true },
        }),
        prisma.messagingInboundEvent.groupBy({
          by: ['lastErrorCode'],
          where: { status: MESSAGING_INBOUND_TERMINAL_STATUS },
          _count: { _all: true },
        }),
        prisma.messagingInboundEvent.groupBy({
          by: ['channel', 'provider', 'status'],
          where: { status: { in: ['failed', MESSAGING_INBOUND_TERMINAL_STATUS] } },
          _count: { _all: true },
        }),
      ]),
    );

  const statusCount = (status: string): number =>
    byStatus.find((r) => r.status === status)?._count._all ?? 0;

  const deadByCode: Record<string, number> = {};
  for (const row of deadByCodeRows) {
    deadByCode[row.lastErrorCode ?? 'UNCLASSIFIED'] = row._count._all;
  }

  const channelMap = new Map<string, { channel: string; provider: string; failed: number; dead: number }>();
  for (const row of byChannel) {
    const key = `${row.channel}|${row.provider}`;
    const entry = channelMap.get(key) ?? { channel: row.channel, provider: row.provider, failed: 0, dead: 0 };
    if (row.status === 'failed') entry.failed = row._count._all;
    else entry.dead = row._count._all;
    channelMap.set(key, entry);
  }

  const oldestUnresolvedAt = oldestUnresolved._min.createdAt;
  const oldestDeadAt = oldestDead._min.deadLetteredAt;

  return {
    received: statusCount('received'),
    processing: statusCount('processing'),
    processed: statusCount('processed'),
    failed: statusCount('failed'),
    dead: statusCount(MESSAGING_INBOUND_TERMINAL_STATUS),
    retryDue,
    retryScheduled,
    oldestUnresolvedAgeMs: oldestUnresolvedAt
      ? Math.max(0, now.getTime() - oldestUnresolvedAt.getTime())
      : null,
    oldestDeadAgeMs: oldestDeadAt ? Math.max(0, now.getTime() - oldestDeadAt.getTime()) : null,
    deadByCode: Object.freeze(deadByCode),
    byChannelProvider: Object.freeze(
      [...channelMap.values()].sort(
        (a, b) => b.dead - a.dead || a.channel.localeCompare(b.channel) || a.provider.localeCompare(b.provider),
      ),
    ),
    measuredAt: now,
  };
}

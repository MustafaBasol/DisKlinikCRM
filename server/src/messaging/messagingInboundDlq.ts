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

import type { Prisma } from '@prisma/client';
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

// ─────────────────────────────────────────────────────────────────────────────
// F5-3R — the operator contract: bounded pagination, an authorization-scoped
// clinic predicate, and an organization-scoped metrics view.
//
// WHY THESE ARE SEPARATE FROM THE F5-3 FUNCTIONS ABOVE
// ---------------------------------------------------
// `listDeadInboundEvents` takes ONE optional `clinicId` — an operator's own
// choice of filter. An HTTP route needs something different and stricter: the
// set of clinics the caller is ALLOWED to see, which is not a filter the caller
// may widen. Conflating "what you asked for" with "what you may have" is the
// classic way a scoped list becomes an unscoped one after a refactor, so the
// two are distinct parameters here and the authorization one has no "all"
// value: `null` means organization-wide *because the caller is organization-
// wide*, and it is the route's job to prove that before passing it.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The caller's authorized clinic reach, in the same vocabulary
 * `messagingInboundReplay.ts` and `TenantClinicScope` use.
 *
 * `EXPLICIT` with an empty list reaches NOTHING. An empty array never means
 * "all" anywhere in this repository, and this is one of the places where
 * getting that backwards would be a cross-clinic disclosure.
 */
export type MessagingClinicScope =
  | { readonly kind: 'ORGANIZATION_WIDE' }
  | { readonly kind: 'EXPLICIT'; readonly clinicIds: readonly string[] };

export const MESSAGING_DLQ_MAX_PAGE_SIZE = 100;
export const MESSAGING_DLQ_DEFAULT_PAGE_SIZE = 25;

/**
 * The one predicate builder both the page and its total use.
 *
 * Sharing it is the point: a listing whose count is computed from a different
 * WHERE than its rows reports a total the operator can never page to, and — far
 * worse — invites the two to drift apart on the clinic predicate.
 */
function buildDeadInboundEventWhere(args: {
  organizationId: string;
  scope: MessagingClinicScope;
  clinicId?: string | null;
  channel?: string;
  provider?: string;
}): Prisma.MessagingInboundEventWhereInput {
  const where: Prisma.MessagingInboundEventWhereInput = {
    organizationId: args.organizationId,
    status: MESSAGING_INBOUND_TERMINAL_STATUS,
  };

  if (args.scope.kind === 'EXPLICIT') {
    // An UNROUTED event (clinicId null) is deliberately absent from a
    // clinic-scoped view: routing never resolved a clinic, so no clinic-scoped
    // operator can legitimately claim it. Same rule `isClinicWithinScope`
    // applies to replay, so a clinic operator can never see a row they would
    // then be refused permission to act on.
    where.clinicId = { in: [...args.scope.clinicIds] };
  }

  // The caller's own narrowing, applied ON TOP of the scope rather than
  // instead of it. The route validates it against the scope first and refuses
  // rather than silently ignoring, but the intersection here means even a
  // mistake at the call site cannot widen the result.
  if (args.clinicId) {
    where.AND = [{ clinicId: args.clinicId }];
  }
  if (args.channel) where.channel = args.channel;
  if (args.provider) where.provider = args.provider;

  return where;
}

export interface DeadInboundEventPage {
  readonly rows: DeadInboundEventView[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

/**
 * One page of the dead-letter queue, scoped to the caller's authorization.
 *
 * DETERMINISTIC SORT. `deadLetteredAt DESC` alone is not a total order — rows
 * dead-lettered in the same sweep share a timestamp to the millisecond, and a
 * non-total order means paging can show one row twice and skip another. `id`
 * breaks the tie.
 *
 * Returns exactly the fields `listDeadInboundEvents` returns: no `rawPayload`,
 * no `errorMessage`, no `fromPhone`/`toPhone`.
 */
export async function listDeadInboundEventPage(args: {
  organizationId: string;
  scope: MessagingClinicScope;
  clinicId?: string | null;
  channel?: string;
  provider?: string;
  page?: number;
  pageSize?: number;
  now?: Date;
}): Promise<DeadInboundEventPage> {
  const now = args.now ?? new Date();
  const pageSize = clampPageSize(args.pageSize);
  const page = clampPage(args.page);
  const where = buildDeadInboundEventWhere(args);

  const [total, rows] = await asInboundLedgerSystem(() =>
    Promise.all([
      prisma.messagingInboundEvent.count({ where }),
      prisma.messagingInboundEvent.findMany({
        where,
        orderBy: [{ deadLetteredAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
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
    ]),
  );

  return {
    rows: rows.map((r) => ({ ...r, ageMs: Math.max(0, now.getTime() - r.createdAt.getTime()) })),
    total,
    page,
    pageSize,
  };
}

/**
 * Clamp rather than reject.
 *
 * A `limit=100000` is far more likely to be a careless client than an attack,
 * and a 400 there teaches a client nothing it can act on. What must never
 * happen is the value being HONOURED, and clamping guarantees that. A
 * syntactically invalid value (`limit=abc`, `limit=-1`, `limit=1e9`) collapses
 * to the default by the same route, because `Number.isFinite` fails or the
 * floor lands below 1.
 */
function clampPageSize(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw)) return MESSAGING_DLQ_DEFAULT_PAGE_SIZE;
  const floored = Math.floor(raw);
  if (floored < 1) return MESSAGING_DLQ_DEFAULT_PAGE_SIZE;
  return Math.min(floored, MESSAGING_DLQ_MAX_PAGE_SIZE);
}

function clampPage(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw)) return 1;
  return Math.max(1, Math.floor(raw));
}

/**
 * Organization-scoped reliability metrics.
 *
 * WHY THIS EXISTS RATHER THAN REUSING `getMessagingInboundMetrics`
 * ---------------------------------------------------------------
 * That function is cross-tenant BY DESIGN — it answers "is messaging healthy
 * across the platform", which is a platform-operator question. Handing it to a
 * clinic operator would disclose how many messages every OTHER organization is
 * failing to process. Not catastrophic, and precisely the kind of small
 * cross-tenant leak that is never noticed and never justified.
 *
 * So a tenant asks a tenant-shaped question, with the organization predicate
 * required and the clinic scope applied the same way the DLQ listing applies
 * it.
 *
 * CARDINALITY. Status counts, two ages, failure counts by stable code, and a
 * channel/provider breakdown bounded by the three real channel/provider pairs.
 * **No per-clinic, per-patient, per-connection or per-message dimension** — a
 * metric dimension that grows with patient count is a KVKK problem and an
 * operational one, and it would not answer the question anyway.
 */
export interface OrganizationMessagingMetrics {
  readonly organizationId: string;
  readonly received: number;
  readonly processing: number;
  readonly processed: number;
  readonly failed: number;
  readonly dead: number;
  readonly retryDue: number;
  readonly retryScheduled: number;
  readonly oldestUnresolvedAgeMs: number | null;
  readonly oldestDeadAgeMs: number | null;
  readonly deadByCode: Readonly<Record<string, number>>;
  readonly byChannelProvider: ReadonlyArray<{
    channel: string;
    provider: string;
    failed: number;
    dead: number;
  }>;
  readonly measuredAt: Date;
}

export async function getOrganizationMessagingMetrics(args: {
  organizationId: string;
  scope: MessagingClinicScope;
  now?: Date;
}): Promise<OrganizationMessagingMetrics> {
  const now = args.now ?? new Date();

  const tenantWhere: Prisma.MessagingInboundEventWhereInput = {
    organizationId: args.organizationId,
    ...(args.scope.kind === 'EXPLICIT' ? { clinicId: { in: [...args.scope.clinicIds] } } : {}),
  };

  const [byStatus, retryDue, retryScheduled, oldestUnresolved, oldestDead, deadByCodeRows, byChannel] =
    await asInboundLedgerSystem(() =>
      Promise.all([
        prisma.messagingInboundEvent.groupBy({
          by: ['status'],
          where: tenantWhere,
          _count: { _all: true },
        }),
        prisma.messagingInboundEvent.count({
          where: {
            ...tenantWhere,
            status: 'failed',
            OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
          },
        }),
        prisma.messagingInboundEvent.count({
          where: { ...tenantWhere, status: 'failed', nextAttemptAt: { gt: now } },
        }),
        prisma.messagingInboundEvent.aggregate({
          where: { ...tenantWhere, status: { in: ['received', 'processing', 'failed'] } },
          _min: { createdAt: true },
        }),
        prisma.messagingInboundEvent.aggregate({
          where: { ...tenantWhere, status: MESSAGING_INBOUND_TERMINAL_STATUS },
          _min: { deadLetteredAt: true },
        }),
        prisma.messagingInboundEvent.groupBy({
          by: ['lastErrorCode'],
          where: { ...tenantWhere, status: MESSAGING_INBOUND_TERMINAL_STATUS },
          _count: { _all: true },
        }),
        prisma.messagingInboundEvent.groupBy({
          by: ['channel', 'provider', 'status'],
          where: { ...tenantWhere, status: { in: ['failed', MESSAGING_INBOUND_TERMINAL_STATUS] } },
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
    organizationId: args.organizationId,
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

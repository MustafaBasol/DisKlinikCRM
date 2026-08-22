/**
 * outboxMetrics.ts — F5-2 backlog observability.
 *
 * WHY THIS SHIPS WITH THE DISPATCHER AND NOT LATER
 * ------------------------------------------------
 * Every deferral in this phase is justified by "no measured trigger exists".
 * ADR-007 defers BullMQ until claim contention is measured. Section 6 of the
 * F5-2 evidence document defers tenant fairness until a noisy tenant is
 * measured. F5-1P section 6 proved fairness added speculatively made latency
 * five times worse.
 *
 * A deferral whose trigger cannot be measured is not a deferral, it is a
 * decision never to do the thing. So the measurements that make those triggers
 * real ship in the same change as the mechanism they judge:
 *
 *   - `oldestPendingAgeMs` — the single best backlog alarm. Rising means the
 *     dispatcher is not keeping up, whatever the counts say.
 *   - `byOrganization` — the fairness trigger. One organization holding most of
 *     the pending backlog while others wait IS the noisy-neighbour condition,
 *     and until it appears there is nothing to be fair about.
 *   - `dead` / `oldestDeadAgeMs` — the DLQ alarm.
 *   - `staleLeases` — dispatcher health. Non-zero means replicas are dying
 *     mid-flight.
 *
 * CARDINALITY. `byOrganization` is bounded by the number of ORGANIZATIONS (tens,
 * at this stage), never by clinic, patient, appointment or event id. A metric
 * dimension that grows with patient count is a KVKK problem and an operational
 * one; there is deliberately no per-patient or per-clinic slice here.
 *
 * NO PAYLOADS, ANYWHERE. Nothing in this module reads `payload`. Counts, ages
 * and stable codes only.
 */

import prisma from '../db.js';

export interface OutboxOrganizationBacklog {
  readonly organizationId: string;
  readonly pending: number;
  readonly dead: number;
}

export interface OutboxBacklogMetrics {
  readonly pending: number;
  readonly claimed: number;
  readonly processed: number;
  readonly dead: number;
  /** Pending rows already past `availableAt` — i.e. genuinely waiting on a dispatcher. */
  readonly dispatchable: number;
  /** Pending rows still in backoff. Waiting by design, not a backlog problem. */
  readonly delayed: number;
  /** Claimed rows whose lease has expired: a dispatcher died holding them. */
  readonly staleLeases: number;
  /** Age of the oldest dispatchable row, or null when there is none. */
  readonly oldestPendingAgeMs: number | null;
  readonly oldestDeadAgeMs: number | null;
  /** Bounded by organization count. Only organizations with a non-zero backlog appear. */
  readonly byOrganization: readonly OutboxOrganizationBacklog[];
  /** Failure shape by stable code — never a message. */
  readonly deadByCode: Readonly<Record<string, number>>;
  readonly measuredAt: Date;
}

/**
 * Snapshot the outbox.
 *
 * Uses `groupBy`/`count`/`aggregate` rather than raw SQL: the numbers are small
 * and infrequent, and keeping this out of the raw-SQL inventory means the one
 * audited raw statement in this feature stays the claim, which is the one that
 * genuinely needs it.
 *
 * MUST run under a system execution context (it aggregates across every
 * tenant). The platform-admin/operator route that eventually exposes it is NOT
 * part of F5-2 — the function is what an operator's tooling, a readiness probe
 * or an alert job calls.
 */
export async function getOutboxBacklogMetrics(now: Date = new Date()): Promise<OutboxBacklogMetrics> {
  const [byStatus, dispatchable, delayed, staleLeases, oldestPending, oldestDead, byOrgPending, byOrgDead, deadByCodeRows] =
    await Promise.all([
      prisma.outboxEvent.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.outboxEvent.count({ where: { status: 'pending', availableAt: { lte: now } } }),
      prisma.outboxEvent.count({ where: { status: 'pending', availableAt: { gt: now } } }),
      prisma.outboxEvent.count({ where: { status: 'claimed', leaseExpiresAt: { lt: now } } }),
      prisma.outboxEvent.aggregate({
        where: { status: 'pending', availableAt: { lte: now } },
        _min: { occurredAt: true },
      }),
      prisma.outboxEvent.aggregate({
        where: { status: 'dead' },
        _min: { deadLetteredAt: true },
      }),
      prisma.outboxEvent.groupBy({
        by: ['organizationId'],
        where: { status: 'pending' },
        _count: { _all: true },
      }),
      prisma.outboxEvent.groupBy({
        by: ['organizationId'],
        where: { status: 'dead' },
        _count: { _all: true },
      }),
      prisma.outboxEvent.groupBy({
        by: ['deadLetterCode'],
        where: { status: 'dead' },
        _count: { _all: true },
      }),
    ]);

  const statusCount = (status: string): number =>
    byStatus.find((r) => r.status === status)?._count._all ?? 0;

  const orgMap = new Map<string, { pending: number; dead: number }>();
  for (const row of byOrgPending) {
    orgMap.set(row.organizationId, { pending: row._count._all, dead: 0 });
  }
  for (const row of byOrgDead) {
    const existing = orgMap.get(row.organizationId) ?? { pending: 0, dead: 0 };
    existing.dead = row._count._all;
    orgMap.set(row.organizationId, existing);
  }

  const deadByCode: Record<string, number> = {};
  for (const row of deadByCodeRows) {
    deadByCode[row.deadLetterCode ?? 'UNKNOWN'] = row._count._all;
  }

  const oldestPendingAt = oldestPending._min.occurredAt;
  const oldestDeadAt = oldestDead._min.deadLetteredAt;

  return {
    pending: statusCount('pending'),
    claimed: statusCount('claimed'),
    processed: statusCount('processed'),
    dead: statusCount('dead'),
    dispatchable,
    delayed,
    staleLeases,
    oldestPendingAgeMs: oldestPendingAt ? Math.max(0, now.getTime() - oldestPendingAt.getTime()) : null,
    oldestDeadAgeMs: oldestDeadAt ? Math.max(0, now.getTime() - oldestDeadAt.getTime()) : null,
    byOrganization: Object.freeze(
      [...orgMap.entries()]
        .map(([organizationId, counts]) => ({ organizationId, ...counts }))
        .sort((a, b) => b.pending - a.pending || a.organizationId.localeCompare(b.organizationId)),
    ),
    deadByCode: Object.freeze(deadByCode),
    measuredAt: now,
  };
}

/**
 * Dead-letter inspection, tenant-scoped.
 *
 * `organizationId` is REQUIRED and is applied as a predicate, not as a filter
 * the caller may omit. There is deliberately no "all organizations" mode: an
 * operator-facing DLQ view that defaults to every tenant is one forgotten
 * parameter away from a cross-tenant disclosure, and the platform-level view
 * (which does exist as a legitimate need) must be a separate, separately
 * authorized contract rather than this function with an optional argument.
 *
 * Returns NO payload and NO message content — identifiers, stable codes,
 * timestamps and counts, exactly the F5-1P section 8 / E14 shape.
 */
export async function listDeadOutboxEvents(args: {
  organizationId: string;
  clinicId?: string | null;
  limit?: number;
}): Promise<
  Array<{
    id: string;
    eventType: string;
    eventVersion: number;
    aggregateType: string;
    aggregateId: string;
    clinicId: string | null;
    attemptCount: number;
    deadLetterCode: string | null;
    deadLetteredAt: Date | null;
    occurredAt: Date;
    replayCount: number;
    correlationId: string | null;
  }>
> {
  const take = Math.min(Math.max(1, Math.floor(args.limit ?? 50)), 200);
  return prisma.outboxEvent.findMany({
    where: {
      organizationId: args.organizationId,
      status: 'dead',
      ...(args.clinicId ? { clinicId: args.clinicId } : {}),
    },
    orderBy: { deadLetteredAt: 'desc' },
    take,
    select: {
      id: true,
      eventType: true,
      eventVersion: true,
      aggregateType: true,
      aggregateId: true,
      clinicId: true,
      attemptCount: true,
      deadLetterCode: true,
      deadLetteredAt: true,
      occurredAt: true,
      replayCount: true,
      correlationId: true,
      // `payload` is deliberately absent.
    },
  });
}

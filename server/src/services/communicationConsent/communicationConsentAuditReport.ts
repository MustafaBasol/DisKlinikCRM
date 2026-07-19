/**
 * communicationConsentAuditReport.ts — Bounded audit-summary reporting for
 * KVKK-HIGH-007 audit-mode observability (Workstream 3).
 *
 * Every query here is scoped by organization/clinic and a MANDATORY bounded
 * date range directly in the SQL WHERE clause, and every aggregation happens
 * in Postgres (groupBy / raw SQL with GROUP BY) — never an unbounded row
 * fetch into Node memory. Breakdown rows are capped (top 50 per dimension).
 *
 * Sampled OperationalEvent rows may span multiple historically-different
 * (samplingRate, samplingVersion) configurations within one queried range —
 * the summary breaks totals down PER combination rather than blending them,
 * and never assumes the currently-configured rate applied to past rows.
 * Sampled counts are always reported as sampled, never extrapolated to an
 * estimated total.
 *
 * Conflict figures come from CommunicationConsentConflictBucket, which never
 * stores a patient identifier — the summary reports aggregate bucket/
 * occurrence counts, explicitly never a unique-patient count (no such count
 * is possible or claimed).
 */

import { Prisma } from '@prisma/client';
import prisma from '../../db.js';

export class CommunicationConsentAuditReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommunicationConsentAuditReportError';
  }
}

const DEFAULT_RANGE_DAYS = 7;
const MAX_RANGE_DAYS = 90;
const MAX_BREAKDOWN_ROWS = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

export type CommunicationConsentAuditSummaryArgs = {
  organizationId: string;
  clinicId?: string;
  since?: Date;
  until?: Date;
};

export type SamplingRateVersionBreakdown = {
  samplingRate: number | null;
  samplingVersion: number | null;
  totalEvaluated: number;
  wouldBlockCount: number;
};

export type CommunicationConsentAuditSummary = {
  organizationId: string;
  clinicId: string | null;
  since: string;
  until: string;
  evaluatedEvents: {
    /** Per (samplingRate, samplingVersion) combination present in range — never blended. */
    bySamplingRateAndVersion: SamplingRateVersionBreakdown[];
    byReasonCode: Array<{ reasonCode: string | null; count: number }>;
    byChannelPurpose: Array<{ channel: string | null; purpose: string | null; count: number }>;
    byClinic: Array<{ clinicId: string | null; count: number }>;
    warning: string;
  };
  conflicts: {
    bucketCount: number;
    totalOccurrences: number;
    firstDetectedAt: string | null;
    lastDetectedAt: string | null;
    note: string;
  };
};

function validateRange(since: Date, until: Date): void {
  if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime())) {
    throw new CommunicationConsentAuditReportError('since/until must be valid dates');
  }
  if (until.getTime() <= since.getTime()) {
    throw new CommunicationConsentAuditReportError('until must be after since');
  }
  const spanDays = (until.getTime() - since.getTime()) / DAY_MS;
  if (spanDays > MAX_RANGE_DAYS) {
    throw new CommunicationConsentAuditReportError(`date range must not exceed ${MAX_RANGE_DAYS} days`);
  }
}

export async function getCommunicationConsentAuditSummary(
  args: CommunicationConsentAuditSummaryArgs,
): Promise<CommunicationConsentAuditSummary> {
  const until = args.until ?? new Date();
  const since = args.since ?? new Date(until.getTime() - DEFAULT_RANGE_DAYS * DAY_MS);
  validateRange(since, until);

  const clinicFilter = args.clinicId ? Prisma.sql`AND "clinicId" = ${args.clinicId}` : Prisma.empty;

  const [bySamplingRateAndVersion, byReasonCode, byChannelPurpose, byClinicRaw, conflictAgg] = await Promise.all([
    prisma.$queryRaw<Array<{ samplingRate: number | null; samplingVersion: number | null; totalEvaluated: bigint; wouldBlockCount: bigint }>>(
      Prisma.sql`
        SELECT
          (metadata->>'samplingRate')::float8 AS "samplingRate",
          (metadata->>'samplingVersion')::int AS "samplingVersion",
          COUNT(*)::bigint AS "totalEvaluated",
          COUNT(*) FILTER (WHERE (metadata->>'wouldBlock')::boolean IS TRUE)::bigint AS "wouldBlockCount"
        FROM "OperationalEvent"
        WHERE source = 'communication_consent'
          AND "organizationId" = ${args.organizationId}
          ${clinicFilter}
          AND "createdAt" >= ${since} AND "createdAt" < ${until}
        GROUP BY 1, 2
        ORDER BY "totalEvaluated" DESC
        LIMIT ${MAX_BREAKDOWN_ROWS}
      `,
    ),
    prisma.$queryRaw<Array<{ reasonCode: string | null; count: bigint }>>(
      Prisma.sql`
        SELECT metadata->>'reasonCode' AS "reasonCode", COUNT(*)::bigint AS count
        FROM "OperationalEvent"
        WHERE source = 'communication_consent'
          AND "organizationId" = ${args.organizationId}
          ${clinicFilter}
          AND "createdAt" >= ${since} AND "createdAt" < ${until}
        GROUP BY 1
        ORDER BY count DESC
        LIMIT ${MAX_BREAKDOWN_ROWS}
      `,
    ),
    prisma.$queryRaw<Array<{ channel: string | null; purpose: string | null; count: bigint }>>(
      Prisma.sql`
        SELECT metadata->>'channel' AS channel, metadata->>'purpose' AS purpose, COUNT(*)::bigint AS count
        FROM "OperationalEvent"
        WHERE source = 'communication_consent'
          AND "organizationId" = ${args.organizationId}
          ${clinicFilter}
          AND "createdAt" >= ${since} AND "createdAt" < ${until}
        GROUP BY 1, 2
        ORDER BY count DESC
        LIMIT ${MAX_BREAKDOWN_ROWS}
      `,
    ),
    prisma.operationalEvent.groupBy({
      by: ['clinicId'],
      where: {
        source: 'communication_consent',
        organizationId: args.organizationId,
        clinicId: args.clinicId,
        createdAt: { gte: since, lt: until },
      },
      _count: { _all: true },
      orderBy: { _count: { clinicId: 'desc' } },
      take: MAX_BREAKDOWN_ROWS,
    }),
    prisma.communicationConsentConflictBucket.aggregate({
      where: {
        organizationId: args.organizationId,
        clinicId: args.clinicId,
        bucketStartedAt: { gte: since, lt: until },
      },
      _count: { _all: true },
      _sum: { occurrenceCount: true },
      _min: { firstDetectedAt: true },
      _max: { lastDetectedAt: true },
    }),
  ]);

  const anyMultipleRateVersions = bySamplingRateAndVersion.length > 1;

  return {
    organizationId: args.organizationId,
    clinicId: args.clinicId ?? null,
    since: since.toISOString(),
    until: until.toISOString(),
    evaluatedEvents: {
      bySamplingRateAndVersion: bySamplingRateAndVersion.map((r) => ({
        samplingRate: r.samplingRate,
        samplingVersion: r.samplingVersion,
        totalEvaluated: Number(r.totalEvaluated),
        wouldBlockCount: Number(r.wouldBlockCount),
      })),
      byReasonCode: byReasonCode.map((r) => ({ reasonCode: r.reasonCode, count: Number(r.count) })),
      byChannelPurpose: byChannelPurpose.map((r) => ({ channel: r.channel, purpose: r.purpose, count: Number(r.count) })),
      byClinic: byClinicRaw.map((r) => ({ clinicId: r.clinicId, count: r._count._all })),
      warning: anyMultipleRateVersions
        ? 'This range spans more than one sampling rate/version — counts are broken down per (samplingRate, samplingVersion) and are NOT exact totals. Do not sum across groups as if they were directly comparable.'
        : 'Counts reflect sampled events only and are NOT exact totals unless the reported samplingRate is 1. Never extrapolated to an estimated total.',
    },
    conflicts: {
      bucketCount: conflictAgg._count._all,
      totalOccurrences: conflictAgg._sum.occurrenceCount ?? 0,
      firstDetectedAt: conflictAgg._min.firstDetectedAt?.toISOString() ?? null,
      lastDetectedAt: conflictAgg._max.lastDetectedAt?.toISOString() ?? null,
      note: 'bucketCount/totalOccurrences are aggregate occurrence counts across deduplicated hourly buckets — NOT a unique-patient count. Patient identifiers are intentionally never persisted in this table, so no such count is possible or claimed.',
    },
  };
}

/**
 * revenueByPeriodQuery.ts — shared data loader for the revenue "byPeriod" breakdown.
 *
 * Extracted from server/src/routes/reports.ts (US-07.3-P1) so the JSON report
 * response (GET /reports/revenue) and the central report-export foundation
 * (GET /reports/export/revenue-by-period) call the exact same query — never
 * two independently-maintained copies of the same business logic.
 *
 * clinicScopeSql is array-aware clinic scope for raw SQL, so an org-wide
 * ('all') scope reaches every accessible clinic instead of only the
 * requester's own resolved clinic. `alias` scopes the "clinicId" column to a
 * specific table alias — required once a query joins another table (e.g.
 * TreatmentCase) that also has a clinicId column, to avoid an
 * ambiguous-column error/silent misscope. (Same shape as imaging.ts's
 * clinicScopeSql — kept as separate copies per that file's own convention;
 * this module is reports.ts's copy, now shared within the reports domain.)
 */

import { Prisma } from '@prisma/client';
import prisma from '../../db.js';
import type { ClinicIdScopeWhere } from '../../utils/clinicScope.js';

export function clinicScopeSql(scope: ClinicIdScopeWhere, alias?: string): Prisma.Sql {
  const col = alias ? Prisma.raw(`"${alias}"."clinicId"`) : Prisma.raw('"clinicId"');
  if (typeof scope.clinicId === 'string') {
    return Prisma.sql`${col} = ${scope.clinicId}`;
  }
  const ids = scope.clinicId.in;
  if (ids.length === 0) return Prisma.sql`1 = 0`;
  return Prisma.sql`${col} IN (${Prisma.join(ids)})`;
}

export type RevenueGroupBy = 'day' | 'week' | 'month';

export interface RevenueByPeriodFilters {
  scope: ClinicIdScopeWhere;
  groupBy: RevenueGroupBy;
  from: Date;
  to: Date;
  practitionerId?: string;
  paymentMethod?: string;
  /**
   * Optional bounded fetch cap. When set, the query applies `LIMIT limit` —
   * used by the synchronous export path so it never loads unbounded rows
   * into memory while checking the row-limit contract. The JSON report route
   * omits this (undefined) to keep its existing unbounded behavior unchanged.
   */
  limit?: number;
}

export interface RevenueByPeriodRow {
  period: string;
  revenue: number;
  count: number;
}

// By period — raw SQL for DATE_TRUNC (validated groupBy, parameterized values,
// full array-aware scope so an 'all'/multi-clinic selection covers every
// accessible clinic, not just the requester's own resolved clinic).
//
// DATE_TRUNC is computed exactly once in the CTE as `period_start`. Each
// template-literal interpolation of groupBy becomes its own bound parameter,
// so repeating DATE_TRUNC(${groupBy}, "paidAt") in SELECT/GROUP BY/ORDER BY
// produces syntactically distinct expressions from Postgres's point of
// view — it can't prove they're equal at parse time, so it falls back to
// requiring "paidAt" itself in GROUP BY and raises 42803. Grouping/ordering
// by the single computed `period_start` column (and formatting with TO_CHAR
// only in the outer SELECT) avoids the repeated interpolation entirely.
//
// practitionerId/paymentMethod mirror the JSON route's baseWhere exactly so
// byPeriod stays consistent with summary/byMethod/byPractitioner for the
// same request.
export async function getRevenueByPeriodRows(filters: RevenueByPeriodFilters): Promise<RevenueByPeriodRow[]> {
  const { scope, groupBy, from, to, practitionerId, paymentMethod, limit } = filters;

  const practitionerFilterSql = practitionerId
    ? Prisma.sql`AND tc."practitionerId" = ${practitionerId}`
    : Prisma.empty;
  const paymentMethodFilterSql = paymentMethod
    ? Prisma.sql`AND p."paymentMethod" = ${paymentMethod}`
    : Prisma.empty;
  const limitSql = typeof limit === 'number' ? Prisma.sql`LIMIT ${limit}` : Prisma.empty;

  return prisma.$queryRaw<RevenueByPeriodRow[]>`
    WITH scoped_payments AS (
      SELECT
        DATE_TRUNC(${groupBy}, p."paidAt") AS period_start,
        p.amount AS amount
      FROM "Payment" p
      LEFT JOIN "TreatmentCase" tc ON tc.id = p."treatmentCaseId"
      WHERE ${clinicScopeSql(scope, 'p')}
        AND p."paymentStatus" IN ('paid', 'partial')
        AND p."paidAt" >= ${from}
        AND p."paidAt" <= ${to}
        ${paymentMethodFilterSql}
        ${practitionerFilterSql}
    )
    SELECT
      TO_CHAR(period_start, 'YYYY-MM-DD') as period,
      COALESCE(SUM(amount), 0)::float as revenue,
      COUNT(*)::int as count
    FROM scoped_payments
    GROUP BY period_start
    ORDER BY period_start
    ${limitSql}
  `;
}

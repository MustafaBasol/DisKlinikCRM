/**
 * registry.ts — US-07.3-P1 central report-export registry.
 *
 * Server-owned, allow-listed map of `reportKey -> ReportDefinition`. Adding a
 * new exportable report means adding one entry here — never accepting a
 * client-provided data source, column selector, or query.
 *
 * Pilot report (US-07.3-P1): `revenue-by-period`, the byPeriod breakdown of
 * GET /api/reports/revenue (server/src/routes/reports.ts). Selected over
 * doctor-performance/no-show-analysis/patient-sources because:
 *  - It has no patient-detail dependency and no row-level patient PII (rows
 *    are period/revenue/count aggregates only).
 *  - It reuses the exact same data loader as the JSON report
 *    (getRevenueByPeriodRows — see services/reports/revenueByPeriodQuery.ts)
 *    so the export can never drift from the on-screen report.
 *  - It naturally exercises date, currency, and number column types in one
 *    report — exactly what the type-handling contract needs validated.
 *  - Doctor-performance and no-show-analysis are flagged as
 *    employee-monitoring-adjacent and under active review in
 *    docs/architecture/reviews/US-07-4_OPERATIONAL_ANALYTICS_ARCHITECTURE.md;
 *    revenue/financial reports are explicitly out of that document's scope,
 *    so this pilot has minimal overlap with that ongoing work.
 */

import {
  getRevenueByPeriodRows,
  type RevenueByPeriodRow,
  type RevenueGroupBy,
} from '../reports/revenueByPeriodQuery.js';
import type { ReportDefinition, ReportFilterParseResult } from './types.js';

export interface RevenueByPeriodExportFilters {
  dateFrom: Date;
  dateTo: Date;
  groupBy: RevenueGroupBy;
  practitionerId?: string;
  paymentMethod?: string;
}

const GROUP_BY_VALUES: RevenueGroupBy[] = ['day', 'week', 'month'];

/**
 * Mirrors GET /api/reports/revenue's own filter validation exactly (same
 * required fields, same date parsing, same groupBy whitelist-with-fallback)
 * so the export can never diverge from what the on-screen report considers
 * valid. See server/src/routes/reports.ts.
 */
function parseRevenueByPeriodFilters(
  query: Record<string, unknown>,
): ReportFilterParseResult<RevenueByPeriodExportFilters> {
  const { dateFrom, dateTo, groupBy: rawGroupBy, practitionerId, paymentMethod } = query;

  if (!dateFrom || !dateTo) {
    return { ok: false, error: 'dateFrom and dateTo are required' };
  }

  const from = new Date(String(dateFrom));
  const to = new Date(String(dateTo));
  to.setHours(23, 59, 59, 999);

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return { ok: false, error: 'Invalid date format' };
  }

  const groupBy = GROUP_BY_VALUES.includes(String(rawGroupBy) as RevenueGroupBy)
    ? (String(rawGroupBy) as RevenueGroupBy)
    : 'month';

  const practitionerIdValue = typeof practitionerId === 'string' && practitionerId.length > 0 ? practitionerId : undefined;
  const paymentMethodValue = typeof paymentMethod === 'string' && paymentMethod.length > 0 ? paymentMethod : undefined;

  return {
    ok: true,
    filters: { dateFrom: from, dateTo: to, groupBy, practitionerId: practitionerIdValue, paymentMethod: paymentMethodValue },
  };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export const revenueByPeriodDefinition: ReportDefinition<RevenueByPeriodRow, RevenueByPeriodExportFilters> = {
  key: 'revenue-by-period',
  title: {
    en: 'Revenue by Period',
    tr: 'Döneme Göre Gelir',
    fr: 'Revenu par période',
    de: 'Umsatz nach Zeitraum',
  },
  // Identical to the authorize([...]) array on GET /api/reports/revenue —
  // never a superset of the source report's access rights.
  allowedRoles: ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'BILLING'],
  pii: false,
  maxSyncRows: 2000,
  filenamePrefix: 'revenue-by-period',
  columns: [
    {
      key: 'period',
      type: 'date',
      header: { en: 'Period', tr: 'Dönem', fr: 'Période', de: 'Zeitraum' },
    },
    {
      key: 'revenue',
      type: 'currency',
      header: { en: 'Revenue', tr: 'Gelir', fr: 'Revenu', de: 'Umsatz' },
    },
    {
      key: 'count',
      type: 'number',
      header: { en: 'Payment Count', tr: 'Ödeme Sayısı', fr: 'Nombre de paiements', de: 'Zahlungsanzahl' },
    },
  ],
  parseFilters: parseRevenueByPeriodFilters,
  async loadRows({ scope, filters, limit }) {
    return getRevenueByPeriodRows({
      scope,
      groupBy: filters.groupBy,
      from: filters.dateFrom,
      to: filters.dateTo,
      practitionerId: filters.practitionerId,
      paymentMethod: filters.paymentMethod,
      limit,
    });
  },
  toColumnValues(row) {
    return { period: row.period, revenue: row.revenue, count: row.count };
  },
  filterSummary(filters) {
    const summary: Record<string, string> = {
      dateFrom: isoDate(filters.dateFrom),
      dateTo: isoDate(filters.dateTo),
      groupBy: filters.groupBy,
    };
    if (filters.practitionerId) summary.practitionerId = filters.practitionerId;
    if (filters.paymentMethod) summary.paymentMethod = filters.paymentMethod;
    return summary;
  },
};

// A Map (not a plain object) so a client-supplied key like "__proto__" or
// "constructor" can never resolve to Object.prototype/a built-in instead of
// undefined — the allow-list lookup must fail closed for any key it didn't
// explicitly register.
const REPORT_DEFINITIONS_MAP = new Map<string, ReportDefinition<any, any>>([
  [revenueByPeriodDefinition.key, revenueByPeriodDefinition],
]);

export const REPORT_DEFINITIONS: Record<string, ReportDefinition<any, any>> = Object.fromEntries(REPORT_DEFINITIONS_MAP);

export function getReportDefinition(reportKey: string): ReportDefinition<any, any> | undefined {
  return REPORT_DEFINITIONS_MAP.get(reportKey);
}

/**
 * types.ts — US-07.3-P1 central report-export foundation contract.
 *
 * A server-owned, allow-listed registry of exportable reports. The client may
 * only request a stable `reportKey` + a validated filter query string — never
 * SQL, a Prisma query, a data-source name, a column selector, a formatter
 * function, or a report definition. Everything else (roles, PII
 * classification, columns, data loading, filename strategy, row cap) is
 * decided entirely server-side by the definition looked up from `reportKey`.
 */

import type { ClinicIdScopeWhere } from '../../utils/clinicScope.js';

export type SupportedExportLocale = 'tr' | 'en' | 'fr' | 'de';

export function resolveExportLocale(raw: unknown): SupportedExportLocale {
  return raw === 'tr' || raw === 'en' || raw === 'fr' || raw === 'de' ? raw : 'en';
}

export type ReportExportFormat = 'xlsx' | 'pdf';

export const SUPPORTED_EXPORT_FORMATS: ReportExportFormat[] = ['xlsx', 'pdf'];

export type ReportColumnType = 'text' | 'number' | 'currency' | 'date' | 'datetime' | 'boolean';

export interface ReportColumnDefinition {
  /** Key into the plain row object returned by `loadRows`/`toRowValues`. */
  key: string;
  type: ReportColumnType;
  header: Record<SupportedExportLocale, string>;
}

/**
 * A single, structured export-error outcome. Routes translate this into a
 * stable HTTP status + a flat (never nested/non-renderable) JSON body.
 */
export type ReportExportErrorCode =
  | 'UNSUPPORTED_REPORT'
  | 'UNSUPPORTED_FORMAT'
  | 'INVALID_FILTERS'
  | 'UNAUTHORIZED_ROLE'
  | 'INACCESSIBLE_CLINIC'
  | 'ROW_LIMIT_EXCEEDED'
  | 'NO_DATA'
  | 'GENERATION_FAILED';

export class ReportExportError extends Error {
  code: ReportExportErrorCode;
  details?: Record<string, unknown>;

  constructor(code: ReportExportErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export interface ReportFilterParseResult<TFilters> {
  ok: boolean;
  filters?: TFilters;
  error?: string;
}

export interface ReportDataLoaderParams<TFilters> {
  scope: ClinicIdScopeWhere;
  filters: TFilters;
  /** Bounded fetch cap (maxSyncRows + 1) — the loader must never return more than this many rows. */
  limit: number;
}

/**
 * A safe, non-sensitive summary of the applied filters — used both for the
 * XLSX metadata section and the AuditLog `metadata` field. Implementations
 * must never place patient names, phone numbers, emails, or other row-level
 * data here — only filter *criteria* (date ranges, enum values, ids).
 */
export type ReportFilterSummary = Record<string, string>;

export interface ReportDefinition<TRow = Record<string, unknown>, TFilters = Record<string, unknown>> {
  /** Stable, allow-listed key. Never derived from client input. */
  key: string;
  title: Record<SupportedExportLocale, string>;
  /** Canonical/raw role strings accepted by the SAME source report (never a superset). */
  allowedRoles: string[];
  /** PII/sensitive classification — drives the AuditLog decision (see auditDecision.ts). */
  pii: boolean;
  /** Conservative synchronous export row cap — enforced server-side, never silently truncated. */
  maxSyncRows: number;
  columns: ReportColumnDefinition[];
  /** Short, filesystem/URL-safe prefix used by the sanitized filename builder. */
  filenamePrefix: string;
  /** Validates raw (already-clinic-scope-independent) query params into typed filters. */
  parseFilters(query: Record<string, unknown>): ReportFilterParseResult<TFilters>;
  /** Loads at most `limit` rows for the given, already-authorized clinic scope. */
  loadRows(params: ReportDataLoaderParams<TFilters>): Promise<TRow[]>;
  /** Maps a row to column-key -> raw value (text/number/currency/date/datetime/boolean). */
  toColumnValues(row: TRow): Record<string, unknown>;
  /** Non-sensitive filter summary for XLSX metadata + AuditLog. */
  filterSummary(filters: TFilters): ReportFilterSummary;
}

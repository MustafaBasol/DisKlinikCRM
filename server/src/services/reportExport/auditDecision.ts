/**
 * auditDecision.ts — US-07.3-P1 PII-classification-driven audit decision.
 *
 * Every report definition classifies itself as `pii: true` (PII/sensitive) or
 * `pii: false` (non-PII, aggregate). ONLY pii:true definitions write an
 * AuditLog entry for an export — the audit decision is a pure function of
 * that single field, so it is trivial to test and impossible for a route to
 * accidentally skip for a sensitive report.
 *
 * AuditLog metadata NEVER contains patient names, phone numbers, emails,
 * row-level data, or raw export contents — only the report key, format,
 * a non-sensitive filter summary (date ranges / enum values / ids, never
 * free text), the exported row count, and the resolved clinic-scope
 * descriptor (see auditScope.ts — clinic ids only, never clinic names).
 * `createdAt` (schema default) supplies the timestamp; this module never
 * invents its own.
 */

import { writeAuditLog } from '../../utils/auditLog.js';
import type { ReportFilterSummary } from './types.js';
import type { ReportExportAuditScope } from './auditScope.js';

export function shouldAuditReportExport(definition: { pii: boolean }): boolean {
  return definition.pii === true;
}

export interface ReportExportAuditParams {
  definition: { key: string; pii: boolean };
  organizationId: string;
  // The ALREADY-RESOLVED export scope (see auditScope.ts) — never the raw
  // user.clinicId, which may differ from the clinic(s) actually exported.
  auditScope: ReportExportAuditScope;
  actorUserId: string;
  actorRole: string;
  format: string;
  filterSummary: ReportFilterSummary;
  rowCount: number;
  success: boolean;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function recordReportExportAudit(params: ReportExportAuditParams): Promise<void> {
  if (!shouldAuditReportExport(params.definition)) return;

  await writeAuditLog({
    organizationId: params.organizationId,
    clinicId: params.auditScope.clinicId,
    actorUserId: params.actorUserId,
    actorRole: params.actorRole,
    action: params.success ? 'report_export_succeeded' : 'report_export_failed',
    entityType: 'ReportExport',
    entityId: params.definition.key,
    description: null,
    metadata: {
      reportKey: params.definition.key,
      format: params.format,
      filters: params.filterSummary,
      rowCount: params.rowCount,
      success: params.success,
      scopeType: params.auditScope.scopeType,
      clinicCount: params.auditScope.clinicCount,
      ...(params.auditScope.clinicIds ? { clinicIds: params.auditScope.clinicIds } : {}),
    },
    ipAddress: params.ipAddress ?? null,
    userAgent: params.userAgent ?? null,
  });
}

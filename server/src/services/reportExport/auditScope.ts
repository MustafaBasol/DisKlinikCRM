/**
 * auditScope.ts — US-07.3-P1 audit-safe clinic-scope descriptor.
 *
 * Converts the ALREADY-RESOLVED `ClinicIdScopeWhere` (from
 * validateAndGetClinicIdScope) into a shape safe to persist on an AuditLog
 * row. This is deliberately built from the resolved scope — never from
 * `user.clinicId` — so the audit record reflects what was actually exported
 * (an explicitly selected accessible clinic different from the user's
 * default clinic, or an org-wide/multi-clinic export), not the user's
 * unrelated default/JWT clinic.
 *
 * Single-clinic scope -> a concrete clinicId (AuditLog.clinicId column).
 * Multi-clinic ("all"/org-wide) scope -> AuditLog.clinicId is null (a single
 * export cannot be attributed to one clinic), and the clinic count (plus,
 * optionally, the clinic id list — ids are internal identifiers, never
 * names) is recorded in metadata instead.
 */

import type { ClinicIdScopeWhere } from '../../utils/clinicScope.js';
import { clinicIdsFromScope } from '../../utils/clinicScope.js';

export type ReportExportAuditScopeType = 'single_clinic' | 'multi_clinic';

export interface ReportExportAuditScope {
  clinicId: string | null;
  scopeType: ReportExportAuditScopeType;
  clinicCount: number;
  clinicIds?: string[];
}

export function resolveReportExportAuditScope(scope: ClinicIdScopeWhere): ReportExportAuditScope {
  const clinicIds = clinicIdsFromScope(scope);

  if (clinicIds.length === 1) {
    return { clinicId: clinicIds[0], scopeType: 'single_clinic', clinicCount: 1 };
  }

  return { clinicId: null, scopeType: 'multi_clinic', clinicCount: clinicIds.length, clinicIds };
}

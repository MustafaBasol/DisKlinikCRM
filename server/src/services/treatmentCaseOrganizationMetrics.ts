/**
 * treatmentCaseOrganizationMetrics.ts — Treatment Case domain's public read
 * contract for the organization dashboard (F2-ORG-DASH-METRICS-CONTRACT).
 *
 * Extracted from server/src/routes/organizationDashboard.ts, which read
 * `prisma.treatmentCase` directly (a cross-domain access — organizationDashboard
 * is owned by core-org-clinic-membership per ADR-F2-ORG-DASH-OWNERSHIP, while
 * TreatmentCase is owned by clinical-treatment-cases). This module is the
 * accepted target-end-state (ADR Option D) contract closing that gap for the
 * treatment-case metric family.
 *
 * Contract properties (per the F2-GUARDRAIL-PREP-010-C reference template):
 * - Owner domain: clinical-treatment-cases (owns the TreatmentCase model).
 * - Tenant context: `clinicId` is a required, leading parameter. Callers must
 *   supply an already-authorized clinic id; this function performs no
 *   authorization of its own.
 * - Output DTO: `OrganizationTreatmentCaseMetrics`, a purpose-built aggregate
 *   — no Prisma `TreatmentCase` record or field is returned.
 * - No raw Prisma leakage: every query is a `count()`.
 * - Audit ownership: none — pure read, no audit entry expected.
 * - Transaction ownership: none — two independent counts, no `$transaction`.
 * - Backward compatibility: additive; zero prior callers.
 * - Rollback: delete this file and revert its one call site.
 */

import prisma from '../db.js';

export interface OrganizationTreatmentCaseMetricsRange {
  from: Date;
  to: Date;
}

export interface OrganizationTreatmentCaseMetrics {
  activeTreatmentPlans: number;
  completedTreatments: number;
}

export async function getOrganizationTreatmentCaseMetrics(
  clinicId: string,
  range: OrganizationTreatmentCaseMetricsRange
): Promise<OrganizationTreatmentCaseMetrics> {
  const [activeTreatmentPlans, completedTreatments] = await Promise.all([
    prisma.treatmentCase.count({
      where: { clinicId, stage: { notIn: ['completed', 'lost'] } },
    }),
    prisma.treatmentCase.count({
      where: { clinicId, stage: 'completed', closedAt: { gte: range.from, lte: range.to } },
    }),
  ]);

  return { activeTreatmentPlans, completedTreatments };
}

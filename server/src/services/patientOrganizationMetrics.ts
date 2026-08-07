/**
 * patientOrganizationMetrics.ts — Patient domain's public read contract for
 * the organization dashboard (F2-ORG-DASH-METRICS-CONTRACT).
 *
 * Extracted from server/src/routes/organizationDashboard.ts, which read
 * `prisma.patient` directly (a cross-domain access — organizationDashboard is
 * owned by core-org-clinic-membership per ADR-F2-ORG-DASH-OWNERSHIP, while
 * Patient is owned by clinical-patients). This module is the accepted
 * target-end-state (ADR Option D) contract closing that gap for the patient
 * metric family.
 *
 * Contract properties (per the F2-GUARDRAIL-PREP-010-C reference template):
 * - Owner domain: clinical-patients (owns the Patient model).
 * - Tenant context: `clinicId` is a required, leading parameter, matched
 *   against `Patient.primaryClinicId` exactly as the pre-refactor handler
 *   did. Callers must supply an already-authorized clinic id; this function
 *   performs no authorization of its own.
 * - Output DTO: `OrganizationPatientMetrics`, a purpose-built aggregate — no
 *   Prisma `Patient` record or per-patient field (name, contact info, KVKK
 *   fields) is returned, so this contract exposes no new patient-level PII.
 * - No raw Prisma leakage: every query is a `count()`.
 * - Audit ownership: none — pure read, no audit entry expected.
 * - Transaction ownership: none — two independent counts, no `$transaction`.
 * - Backward compatibility: additive; zero prior callers.
 * - Rollback: delete this file and revert its one call site.
 */

import prisma from '../db.js';

export interface OrganizationPatientMetricsRange {
  from: Date;
  to: Date;
}

export interface OrganizationPatientMetrics {
  newPatients: number;
  totalPatients: number;
}

export async function getOrganizationPatientMetrics(
  clinicId: string,
  range: OrganizationPatientMetricsRange
): Promise<OrganizationPatientMetrics> {
  const [newPatients, totalPatients] = await Promise.all([
    prisma.patient.count({
      where: { primaryClinicId: clinicId, createdAt: { gte: range.from, lte: range.to }, deletedAt: null },
    }),
    prisma.patient.count({
      where: { primaryClinicId: clinicId, deletedAt: null },
    }),
  ]);

  return { newPatients, totalPatients };
}

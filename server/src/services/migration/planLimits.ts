/**
 * planLimits.ts — F3-DATA-MIG-TODAY-001
 *
 * Commercial plan limits for a migration run.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: a migration must not silently bypass a
 * commercial limit. Importing 14,890 patients into a clinic whose plan allows
 * 500 is a billing decision, not a technical detail, and it belongs to the
 * program owner.
 *
 * The migration writes patients through Prisma rather than through
 * POST /api/patients, so `middleware/planLimits.ts`'s `checkPatientLimit`
 * never runs for it. That is the correct architecture — a per-row HTTP
 * middleware cannot express a bulk decision — but it means the cap would
 * otherwise be silently absent. So this module RE-IMPLEMENTS the same
 * resolution and the same counting rule, reports the outcome in the dry run,
 * and BLOCKS execution when the cap would be exceeded.
 *
 * NO HIDDEN BYPASS EXISTS HERE. There is no override flag, no grace factor and
 * no "platform admin may exceed" branch. When the cap blocks, the dry run says
 * so and names the existing, already-audited Platform Admin route that raises
 * it. Raising a customer's limit stays a deliberate, attributable act.
 *
 * Counting rule, mirrored EXACTLY from middleware/planLimits.ts so the two
 * cannot disagree: a patient counts when `deletedAt IS NULL` AND
 * `patientStatus <> 'archived'`. Archived patients do not consume quota —
 * which matters here, because the source's soft-delete flag maps to
 * `archived`, so those rows are imported without consuming the customer's plan.
 */

import prisma from '../../db.js';
import type { PlanLimitReport } from './contracts.js';

/**
 * How an authorized operator raises the cap. Named explicitly so the blocker
 * is actionable rather than a dead end — and so nobody is tempted to invent a
 * bypass because the UI did not say what to do instead.
 */
export const PLAN_LIMIT_OVERRIDE_MECHANISM =
  'Raise the limit through the existing audited Platform Admin routes before executing: ' +
  'PATCH /api/platform/organizations/:id/plan (organization plan) or ' +
  'PATCH /api/platform/clinics/:id/plan (per-clinic maxPatients). ' +
  'This migration deliberately implements no bypass of its own.';

export interface PlanLimitInput {
  organizationId: string;
  clinicId: string;
  /**
   * Source rows that would become NON-archived patients. Archived rows are
   * excluded by the caller, mirroring the product's counting rule.
   */
  sourceActivePatientCount: number;
  /**
   * Rows that will MATCH an existing patient via provenance rather than create
   * one. They already exist in the destination, so they must not be counted
   * twice against the cap — counting them would block a rerun of an import
   * that fit perfectly the first time.
   */
  expectedReuseCount: number;
}

export async function buildPlanLimitReport(input: PlanLimitInput): Promise<PlanLimitReport> {
  const { organizationId, clinicId, sourceActivePatientCount, expectedReuseCount } = input;

  const [organization, clinic, destinationCurrentCount] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, plan: { select: { maxPatients: true } } },
    }),
    prisma.clinic.findUnique({
      where: { id: clinicId },
      select: { id: true, maxPatients: true },
    }),
    // Counted org-wide, exactly as middleware/planLimits.ts counts it for the
    // organization cap. Using a clinic-scoped count here would understate
    // consumption for a multi-branch organization and let an import push the
    // organization past its plan while each individual clinic looked fine.
    prisma.patient.count({
      where: { organizationId, deletedAt: null, patientStatus: { not: 'archived' } },
    }),
  ]);

  const organizationPatientCap = organization?.plan?.maxPatients ?? null;
  const clinicPatientCap = clinic?.maxPatients ?? null;

  // Resolution order mirrors getOrgLimits() ?? getClinicLimits(): the
  // organization plan wins whenever the organization has one, and the clinic
  // column is only the fallback. A per-clinic override therefore has NO effect
  // for an org-scoped tenant — a real and easily-missed property of the
  // product that an operator needs to see before they "fix" the wrong number.
  let effectiveCap: number | null;
  let effectiveCapSource: PlanLimitReport['effectiveCapSource'];
  if (organizationPatientCap !== null) {
    effectiveCap = organizationPatientCap;
    effectiveCapSource = 'organization_plan';
  } else if (clinicPatientCap !== null) {
    effectiveCap = clinicPatientCap;
    effectiveCapSource = 'clinic_column';
  } else {
    effectiveCap = null;
    effectiveCapSource = 'none';
  }

  const netNewPatients = Math.max(0, sourceActivePatientCount - expectedReuseCount);
  const expectedResultingCount = destinationCurrentCount + netNewPatients;

  const allowed = effectiveCap === null ? true : expectedResultingCount <= effectiveCap;

  return {
    sourceActivePatientCount,
    destinationCurrentCount,
    expectedResultingCount,
    organizationPatientCap,
    clinicPatientCap,
    effectiveCap,
    effectiveCapSource,
    allowed,
    overrideMechanism: PLAN_LIMIT_OVERRIDE_MECHANISM,
  };
}

/**
 * The human-readable blocker text shown when the cap would be exceeded.
 * Counts only — no tenant names, no patient data.
 */
export function planLimitBlockerMessage(report: PlanLimitReport): string {
  return (
    `Importing would take this organization to ${report.expectedResultingCount} active patients, ` +
    `above its cap of ${report.effectiveCap} (from the ${
      report.effectiveCapSource === 'organization_plan' ? 'organization plan' : 'clinic setting'
    }). ` +
    `Current: ${report.destinationCurrentCount}. ${report.overrideMechanism}`
  );
}

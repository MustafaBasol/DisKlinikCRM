/**
 * paymentOrganizationMetrics.ts — Payment domain's public read contract for
 * the organization dashboard (F2-ORG-DASH-METRICS-CONTRACT).
 *
 * Extracted from server/src/routes/organizationDashboard.ts, which read
 * `prisma.payment` directly (a cross-domain access — organizationDashboard is
 * owned by core-org-clinic-membership per ADR-F2-ORG-DASH-OWNERSHIP, while
 * Payment is owned by clinical-basic-payments). This module is the accepted
 * target-end-state (ADR Option D) contract closing that gap for the payment
 * metric family.
 *
 * Contract properties (per the F2-GUARDRAIL-PREP-010-C reference template):
 * - Owner domain: clinical-basic-payments (owns the Payment model).
 * - Tenant context: `clinicId` is a required, leading parameter. Callers must
 *   supply an already-authorized clinic id; this function performs no
 *   authorization of its own.
 * - Output DTO: `OrganizationPaymentMetrics`, a purpose-built aggregate — no
 *   Prisma `Payment` record or field is returned.
 * - No raw Prisma leakage: every query is an `aggregate()` reduced to a
 *   single numeric sum.
 * - Audit ownership: none — pure read, no audit entry expected.
 * - Transaction ownership: none — two independent aggregates, no `$transaction`.
 * - Backward compatibility: additive; zero prior callers.
 * - Rollback: delete this file and revert its one call site.
 *
 * `outstandingBalance` is deliberately not date-filtered — it reflects all
 * pending balance regardless of the requested period, matching the
 * pre-refactor handler's "tüm zamanlar" (all-time) behavior byte-for-byte.
 */

import prisma from '../db.js';

export interface OrganizationPaymentMetricsRange {
  from: Date;
  to: Date;
}

export interface OrganizationPaymentMetrics {
  /** Collected (paid/partial) amount within the requested date range. */
  revenue: number;
  /** Pending balance, all-time (not date-filtered). */
  outstandingBalance: number;
}

export async function getOrganizationPaymentMetrics(
  clinicId: string,
  range: OrganizationPaymentMetricsRange
): Promise<OrganizationPaymentMetrics> {
  const [revenueAgg, outstandingAgg] = await Promise.all([
    prisma.payment.aggregate({
      where: { clinicId, paymentStatus: { in: ['paid', 'partial'] }, paidAt: { gte: range.from, lte: range.to } },
      _sum: { amount: true },
    }),
    prisma.payment.aggregate({
      where: { clinicId, paymentStatus: 'pending' },
      _sum: { amount: true },
    }),
  ]);

  return {
    revenue: Number(revenueAgg._sum.amount) || 0,
    outstandingBalance: Number(outstandingAgg._sum.amount) || 0,
  };
}

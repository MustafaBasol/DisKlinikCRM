/**
 * financeDashboard.ts — Sprint 12: Finance / Billing Dashboard
 *
 * GET /api/finance/dashboard?clinicId=all|<id>&range=today|this_week|this_month|last_30_days|custom&from=&to=
 *
 * Access: OWNER, ORG_ADMIN, CLINIC_MANAGER, BILLING
 * Denied: DENTIST, RECEPTIONIST, ASSISTANT
 *
 * Security rules:
 *  - All queries scoped to req.user.organizationId (via clinic.organizationId join)
 *  - BILLING / CLINIC_MANAGER scoped to allowedClinicIds
 *  - clinicId query param validated server-side against allowedClinicIds
 *  - No cross-organization leakage
 */

import express from 'express';
import prisma from '../db.js';
import { authorize } from '../middleware/auth.js';
import type { AuthRequest } from '../middleware/auth.js';
import { normalizeRole } from '../utils/roles.js';
import { getDateRange } from './organizationDashboard.js';

const router = express.Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Resolve allowed clinic IDs for the current user within their organization.
 * Returns null for error with message, or { clinicIds, clinicMap } on success.
 */
async function resolveClinicScope(
  user: NonNullable<AuthRequest['user']>,
  requestedClinicId?: string,
): Promise<{ clinicIds: string[]; clinicMap: Map<string, string> } | { error: string }> {
  const role = normalizeRole(user.role, user.canAccessAllClinics);
  const orgId = user.organizationId;

  // Get all clinics in this org
  const orgClinics = await prisma.clinic.findMany({
    where: { organizationId: orgId },
    select: { id: true, name: true },
  });
  const orgClinicIdSet = new Set(orgClinics.map(c => c.id));
  const clinicMap = new Map(orgClinics.map(c => [c.id, c.name]));

  // Determine which clinics the user can access
  let allowedIds: string[];
  if (role === 'OWNER' || role === 'ORG_ADMIN') {
    allowedIds = [...orgClinicIdSet];
  } else {
    // BILLING, CLINIC_MANAGER: scope to assigned clinics within org
    const userAllowed = user.allowedClinicIds ?? [];
    allowedIds = userAllowed.filter(id => orgClinicIdSet.has(id));
  }

  // Validate the requested clinic filter
  if (requestedClinicId && requestedClinicId !== 'all') {
    if (!allowedIds.includes(requestedClinicId)) {
      return { error: 'Forbidden: No access to this clinic' };
    }
    return { clinicIds: [requestedClinicId], clinicMap };
  }

  return { clinicIds: allowedIds, clinicMap };
}

function safeSum(agg: { _sum: { amount?: number | null } } | null): number {
  return agg?._sum?.amount ?? 0;
}

// ─── GET /api/finance/dashboard ───────────────────────────────────────────────

router.get(
  '/finance/dashboard',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'BILLING']),
  async (req: AuthRequest, res) => {
    const user = req.user!;
    const {
      clinicId: clinicIdParam,
      range = 'this_month',
      from: fromParam,
      to: toParam,
    } = req.query;

    // ── Date range ───────────────────────────────────────────────────────────
    let dateRange: { from: Date; to: Date };
    try {
      dateRange = getDateRange(
        String(range),
        fromParam ? String(fromParam) : undefined,
        toParam ? String(toParam) : undefined,
      );
    } catch {
      return res.status(400).json({ error: 'Invalid date range parameters' });
    }

    // ── Clinic scope ─────────────────────────────────────────────────────────
    const scopeResult = await resolveClinicScope(
      user,
      clinicIdParam ? String(clinicIdParam) : undefined,
    );
    if ('error' in scopeResult) {
      return res.status(403).json({ error: scopeResult.error });
    }
    const { clinicIds, clinicMap } = scopeResult;

    if (clinicIds.length === 0) {
      return res.json(EMPTY_RESPONSE);
    }

    // ── Today boundaries ─────────────────────────────────────────────────────
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    // ── Parallel data fetch ──────────────────────────────────────────────────
    try {
      const [
        collectedTodayAgg,
        collectedInRangeAgg,
        outstandingAgg,
        cancelledAgg,
        overdueInstallmentsAgg,
        pendingInstallmentsCount,
        overdueInstallmentsCount,
        earningsDueAgg,
        earningsPaidAgg,
        collectionsByMethod,
        recentPayments,
        upcomingInstallments,
      ] = await Promise.all([
        // collectedToday: paidAt today, status=paid
        prisma.payment.aggregate({
          where: { clinicId: { in: clinicIds }, paymentStatus: 'paid', paidAt: { gte: todayStart, lte: todayEnd } },
          _sum: { amount: true },
        }),

        // collectedInRange: paidAt in range, status=paid
        prisma.payment.aggregate({
          where: { clinicId: { in: clinicIds }, paymentStatus: 'paid', paidAt: { gte: dateRange.from, lte: dateRange.to } },
          _sum: { amount: true },
        }),

        // outstandingBalance: pending/partial (all time)
        prisma.payment.aggregate({
          where: { clinicId: { in: clinicIds }, paymentStatus: { in: ['pending', 'partial'] } },
          _sum: { amount: true },
        }),

        // cancelledPayments in range
        prisma.payment.aggregate({
          where: { clinicId: { in: clinicIds }, paymentStatus: 'cancelled', updatedAt: { gte: dateRange.from, lte: dateRange.to } },
          _sum: { amount: true },
        }),

        // overdueAmount: sum of overdue installments
        prisma.paymentPlanInstallment.aggregate({
          where: { status: 'overdue', plan: { clinicId: { in: clinicIds } } },
          _sum: { amount: true },
        }),

        // pendingInstallments count
        prisma.paymentPlanInstallment.count({
          where: { status: 'pending', plan: { clinicId: { in: clinicIds } } },
        }),

        // overdueInstallments count
        prisma.paymentPlanInstallment.count({
          where: { status: 'overdue', plan: { clinicId: { in: clinicIds } } },
        }),

        // practitionerPayoutsDue: earnings pending/approved
        prisma.practitionerEarning.aggregate({
          where: { clinicId: { in: clinicIds }, status: { in: ['pending', 'approved'] } },
          _sum: { earningAmount: true },
        }),

        // practitionerPayoutsPaid: earnings paid in range
        prisma.practitionerEarning.aggregate({
          where: { clinicId: { in: clinicIds }, status: 'paid', paidAt: { gte: dateRange.from, lte: dateRange.to } },
          _sum: { earningAmount: true },
        }),

        // collectionsByMethod: groupBy paymentMethod in range
        prisma.payment.groupBy({
          by: ['paymentMethod'],
          where: { clinicId: { in: clinicIds }, paymentStatus: 'paid', paidAt: { gte: dateRange.from, lte: dateRange.to } },
          _sum: { amount: true },
          _count: { id: true },
        }),

        // recentPayments: last 10 paid in range
        prisma.payment.findMany({
          where: { clinicId: { in: clinicIds }, paymentStatus: 'paid', paidAt: { gte: dateRange.from, lte: dateRange.to } },
          include: {
            patient: { select: { firstName: true, lastName: true } },
            clinic: { select: { name: true } },
          },
          orderBy: { paidAt: 'desc' },
          take: 10,
        }),

        // upcomingInstallments: pending/overdue, due within next 30 days
        prisma.paymentPlanInstallment.findMany({
          where: {
            status: { in: ['pending', 'overdue'] },
            plan: { clinicId: { in: clinicIds } },
            dueDate: { lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
          },
          include: {
            plan: {
              include: {
                patient: { select: { firstName: true, lastName: true } },
                clinic: { select: { name: true } },
              },
            },
          },
          orderBy: { dueDate: 'asc' },
          take: 20,
        }),
      ]);

      // ── Branch breakdown ─────────────────────────────────────────────────
      const branchBreakdown = await Promise.all(
        clinicIds.map(async (cid) => {
          const [collected, outstanding, overdueAmt, pendingCount] = await Promise.all([
            prisma.payment.aggregate({
              where: { clinicId: cid, paymentStatus: 'paid', paidAt: { gte: dateRange.from, lte: dateRange.to } },
              _sum: { amount: true },
            }),
            prisma.payment.aggregate({
              where: { clinicId: cid, paymentStatus: { in: ['pending', 'partial'] } },
              _sum: { amount: true },
            }),
            prisma.paymentPlanInstallment.aggregate({
              where: { status: 'overdue', plan: { clinicId: cid } },
              _sum: { amount: true },
            }),
            prisma.paymentPlanInstallment.count({
              where: { status: 'pending', plan: { clinicId: cid } },
            }),
          ]);
          return {
            clinicId: cid,
            clinicName: clinicMap.get(cid) ?? cid,
            collected: collected._sum.amount ?? 0,
            outstanding: outstanding._sum.amount ?? 0,
            overdue: overdueAmt._sum.amount ?? 0,
            pendingInstallments: pendingCount,
          };
        }),
      );

      // ── Build response ───────────────────────────────────────────────────
      const summary = {
        collectedToday: safeSum(collectedTodayAgg),
        collectedInRange: safeSum(collectedInRangeAgg),
        outstandingBalance: safeSum(outstandingAgg),
        overdueAmount: overdueInstallmentsAgg._sum.amount ?? 0,
        pendingInstallments: pendingInstallmentsCount,
        overdueInstallments: overdueInstallmentsCount,
        cancelledPayments: safeSum(cancelledAgg),
        practitionerPayoutsDue: earningsDueAgg._sum.earningAmount ?? 0,
        practitionerPayoutsPaid: earningsPaidAgg._sum.earningAmount ?? 0,
      };

      const byMethod = collectionsByMethod.map(g => ({
        method: g.paymentMethod,
        amount: g._sum.amount ?? 0,
        count: g._count.id,
      }));

      const recentPaymentsMapped = recentPayments.map(p => ({
        id: p.id,
        patientName: p.patient ? `${p.patient.firstName} ${p.patient.lastName}` : '—',
        clinicName: p.clinic.name,
        amount: p.amount,
        method: p.paymentMethod,
        paidAt: p.paidAt,
        status: p.paymentStatus,
      }));

      const upcomingMapped = upcomingInstallments.map(inst => ({
        id: inst.id,
        planId: inst.planId,
        patientName: inst.plan.patient
          ? `${inst.plan.patient.firstName} ${inst.plan.patient.lastName}`
          : '—',
        clinicName: inst.plan.clinic.name,
        amount: inst.amount,
        dueDate: inst.dueDate,
        status: inst.status,
      }));

      return res.json({
        summary,
        collectionsByMethod: byMethod,
        branchBreakdown,
        recentPayments: recentPaymentsMapped,
        upcomingInstallments: upcomingMapped,
      });
    } catch (error) {
      console.error('[finance-dashboard] error', error);
      return res.status(500).json({ error: 'Failed to load finance dashboard' });
    }
  },
);

// ─── Empty response for empty clinic list ────────────────────────────────────

const EMPTY_RESPONSE = {
  summary: {
    collectedToday: 0,
    collectedInRange: 0,
    outstandingBalance: 0,
    overdueAmount: 0,
    pendingInstallments: 0,
    overdueInstallments: 0,
    cancelledPayments: 0,
    practitionerPayoutsDue: 0,
    practitionerPayoutsPaid: 0,
  },
  collectionsByMethod: [],
  branchBreakdown: [],
  recentPayments: [],
  upcomingInstallments: [],
};

export default router;

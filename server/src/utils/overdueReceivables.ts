/**
 * overdueReceivables.ts — shared "overdue receivables" definition combining
 * BOTH overdue payment-plan installments and standalone (non-installment)
 * overdue payments. This is the single source of truth for:
 *  - the dashboard's "Gecikmiş Tahsilatlar" card (server/src/routes/dashboard.ts)
 *  - the Finance Dashboard's summary.overdueAmount (server/src/routes/financeDashboard.ts,
 *    which previously filtered on the literal PaymentPlanInstallment.status === 'overdue'
 *    — a value nothing ever writes, so that card was always 0)
 *  - the unified overdue view on src/pages/PaymentPlans.tsx (?overdueOnly=true)
 *
 * Two disjoint receivable sources (no double-counting):
 *  - PaymentPlanInstallment: status === 'pending' && dueDate < now
 *    (see overdueInstallments.ts).
 *  - Payment: paymentStatus === 'pending'. A Payment row is only ever created
 *    for an installment at the moment it is PAID — the pay-installment route
 *    (server/src/routes/paymentPlans.ts) always writes paymentStatus: 'paid'.
 *    So a pending Payment can never be installment-linked; `installment: null`
 *    is kept as defense-in-depth documentation of that invariant, not as a
 *    load-bearing filter. Payment has no dueDate field — a Payment record only
 *    exists once a collection point has already occurred, so a pending Payment
 *    is always already due.
 */

import { overdueInstallmentWhere } from './overdueInstallments.js';

export function overduePaymentWhere(clinicIdWhere: Record<string, any>): Record<string, any> {
  return { ...clinicIdWhere, paymentStatus: 'pending', installment: null };
}

export interface OverdueReceivablesTotal {
  installmentAmount: number;
  installmentCount: number;
  paymentAmount: number;
  total: number;
}

function normalizeClinicScope(
  scope: Record<string, any> | string[],
): Record<string, any> {
  if (Array.isArray(scope)) {
    return { clinicId: { in: scope } };
  }
  return scope;
}

export async function overdueReceivablesAmount(
  prisma: any,
  clinicScope: Record<string, any> | string[],
  now: Date = new Date(),
): Promise<OverdueReceivablesTotal> {
  const clinicIdWhere = normalizeClinicScope(clinicScope);

  const [installmentAgg, installmentCount, paymentAgg] = await Promise.all([
    prisma.paymentPlanInstallment.aggregate({
      where: overdueInstallmentWhere(clinicIdWhere, now),
      _sum: { amount: true },
    }),
    prisma.paymentPlanInstallment.count({
      where: overdueInstallmentWhere(clinicIdWhere, now),
    }),
    prisma.payment.aggregate({
      where: overduePaymentWhere(clinicIdWhere),
      _sum: { amount: true },
    }),
  ]);

  const installmentAmount = installmentAgg._sum.amount ?? 0;
  const paymentAmount = paymentAgg._sum.amount ?? 0;

  return {
    installmentAmount,
    installmentCount,
    paymentAmount,
    total: installmentAmount + paymentAmount,
  };
}

export interface OverdueReceivableItem {
  id: string;
  type: 'installment' | 'standalone';
  patientId: string;
  patientName: string;
  amount: number;
  currency: string;
  dueDate: Date;
  status: string;
  planId: string | null;
  installmentId: string | null;
  paymentId: string | null;
}

/**
 * Row-level list backing the unified overdue collections view — one entry per
 * overdue installment plus one per standalone overdue payment, sorted oldest
 * due date first. Standalone payments have no due date of their own, so
 * createdAt is used as the closest available proxy for "how long overdue".
 */
export async function overdueReceivablesList(
  prisma: any,
  clinicIds: string[],
  now: Date = new Date(),
): Promise<OverdueReceivableItem[]> {
  const clinicIdWhere = { clinicId: { in: clinicIds } };
  const installmentWhere = overdueInstallmentWhere(clinicIdWhere, now);

  const [installments, payments] = await Promise.all([
    prisma.paymentPlanInstallment.findMany({
      where: installmentWhere,
      include: {
        plan: {
          include: { patient: { select: { id: true, firstName: true, lastName: true } } },
        },
      },
    }),
    prisma.payment.findMany({
      where: { clinicId: { in: clinicIds }, paymentStatus: 'pending', installment: null },
      include: { patient: { select: { id: true, firstName: true, lastName: true } } },
    }),
  ]);

  const installmentItems: OverdueReceivableItem[] = installments.map((inst: any) => ({
    id: inst.id,
    type: 'installment' as const,
    patientId: inst.plan.patient?.id ?? '',
    patientName: inst.plan.patient ? `${inst.plan.patient.firstName} ${inst.plan.patient.lastName}` : '—',
    amount: inst.amount,
    currency: inst.plan.currency,
    dueDate: inst.dueDate,
    status: inst.status,
    planId: inst.planId,
    installmentId: inst.id,
    paymentId: null,
  }));

  const paymentItems: OverdueReceivableItem[] = payments.map((p: any) => ({
    id: p.id,
    type: 'standalone' as const,
    patientId: p.patient?.id ?? '',
    patientName: p.patient ? `${p.patient.firstName} ${p.patient.lastName}` : '—',
    amount: p.amount,
    currency: p.currency,
    dueDate: p.createdAt,
    status: p.paymentStatus,
    planId: null,
    installmentId: null,
    paymentId: p.id,
  }));

  return [...installmentItems, ...paymentItems].sort(
    (a, b) => a.dueDate.getTime() - b.dueDate.getTime(),
  );
}

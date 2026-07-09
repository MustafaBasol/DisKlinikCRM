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
  paymentAmount: number;
  total: number;
}

export async function overdueReceivablesAmount(
  prisma: any,
  clinicIdWhere: Record<string, any>,
  now: Date = new Date(),
): Promise<OverdueReceivablesTotal> {
  const [installmentAgg, paymentAgg] = await Promise.all([
    prisma.paymentPlanInstallment.aggregate({
      where: overdueInstallmentWhere(clinicIdWhere, now),
      _sum: { amount: true },
    }),
    prisma.payment.aggregate({
      where: overduePaymentWhere(clinicIdWhere),
      _sum: { amount: true },
    }),
  ]);
  const installmentAmount = installmentAgg._sum.amount ?? 0;
  const paymentAmount = paymentAgg._sum.amount ?? 0;
  return { installmentAmount, paymentAmount, total: installmentAmount + paymentAmount };
}

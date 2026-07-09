/**
 * overdueReceivables.ts — shared "total overdue receivables" computation.
 *
 * Overdue receivables come from two disjoint sources:
 *  - PaymentPlanInstallment rows matching overdueInstallmentWhere() (installment amount)
 *  - standalone Payment rows (paymentStatus='pending', not linked to any installment)
 *
 * A Payment is only ever created (always paymentStatus='paid') at the moment an
 * installment is paid, so a pending Payment with installment=null cannot also be
 * counted by the installment aggregate — no double-counting between the two sums.
 */

import { overdueInstallmentWhere } from './overdueInstallments.js';

export interface OverdueReceivables {
  installmentAmount: number;
  installmentCount: number;
  paymentAmount: number;
  total: number;
}

export async function overdueReceivablesAmount(
  prisma: any,
  clinicIds: string[],
  now: Date = new Date(),
): Promise<OverdueReceivables> {
  const installmentWhere = {
    ...overdueInstallmentWhere(now),
    plan: { clinicId: { in: clinicIds } },
  };

  const [installmentAgg, installmentCount, paymentAgg] = await Promise.all([
    prisma.paymentPlanInstallment.aggregate({
      where: installmentWhere,
      _sum: { amount: true },
    }),
    prisma.paymentPlanInstallment.count({
      where: installmentWhere,
    }),
    prisma.payment.aggregate({
      where: { clinicId: { in: clinicIds }, paymentStatus: 'pending', installment: null },
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

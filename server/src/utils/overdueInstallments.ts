/**
 * overdueInstallments.ts — shared "overdue payment plan installment" definition.
 *
 * There is no background job that ever writes PaymentPlanInstallment.status = 'overdue';
 * the only place "overdue" is real is status === 'pending' && dueDate < now (see
 * src/pages/PaymentPlans.tsx isOverdue). The dashboard's "Gecikmiş Tahsilatlar" card
 * uses this same definition so its sum matches what /payment-plans shows when filtered
 * to overdue installments.
 */

export function overdueInstallmentWhere(
  clinicIdWhere: Record<string, any>,
  now: Date = new Date(),
): Record<string, any> {
  return {
    status: 'pending',
    dueDate: { lt: now },
    plan: { ...clinicIdWhere },
  };
}

export function isInstallmentOverdue(dueDate: Date | string, status: string, now: Date = new Date()): boolean {
  return status === 'pending' && new Date(dueDate) < now;
}

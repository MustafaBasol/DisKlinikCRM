/**
 * overdueInstallments.ts — shared definition of "overdue installment".
 *
 * status can be 'pending' (normal, not-yet-flagged) or the legacy 'overdue'
 * value that some rows were written with directly (see PaymentPlanInstallment
 * schema comment: "pending, paid, overdue"). Either status counts as overdue
 * once dueDate has passed. paymentId must be null — an installment that has
 * already been linked to a Payment is paid, regardless of what its status
 * column still says, and must never be counted as overdue.
 */

export function overdueInstallmentWhere(now: Date = new Date()) {
  return {
    status: { in: ['pending', 'overdue'] },
    dueDate: { lt: now },
    paymentId: null,
  };
}

export function isInstallmentOverdue(
  status: string,
  dueDate: Date | string,
  now: Date = new Date(),
  paymentId: string | null = null,
): boolean {
  if (paymentId) return false;
  if (status !== 'pending' && status !== 'overdue') return false;
  return new Date(dueDate) < now;
}

/**
 * Shared overdue payment-plan installment definition.
 *
 * Production contains both representations:
 * - pending installments whose dueDate has passed
 * - legacy/persisted installments explicitly marked overdue
 *
 * A linked paymentId means the installment has already been settled and must
 * never be counted as overdue, even if its status was not updated correctly.
 */

export function overdueInstallmentWhere(
  clinicIdWhere: Record<string, any>,
  now: Date = new Date(),
): Record<string, any> {
  return {
    status: { in: ['pending', 'overdue'] },
    dueDate: { lt: now },
    paymentId: null,
    plan: { ...clinicIdWhere },
  };
}

export function isInstallmentOverdue(
  dueDate: Date | string,
  status: string,
  now: Date = new Date(),
  paymentId?: string | null,
): boolean {
  return (
    ['pending', 'overdue'].includes(status) &&
    !paymentId &&
    new Date(dueDate) < now
  );
}

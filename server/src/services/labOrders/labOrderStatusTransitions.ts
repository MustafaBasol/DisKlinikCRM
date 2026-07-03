/**
 * labOrderStatusTransitions.ts — Status-flow rules for LabWorkOrder, shared by
 * the route layer, the dashboard summary, and the overdue-notification job so
 * "what's a valid transition" and "what counts as overdue" are each defined
 * exactly once.
 *
 * Flow: pending -> impression_taken -> sent_to_lab -> in_progress ->
 *   received_from_lab -> fitting_or_trial -> revision_requested (loops back
 *   to sent_to_lab for a remake) -> completed. `cancelled` is reachable from
 *   any non-terminal status and is itself terminal.
 */

import { LAB_WORK_ORDER_STATUSES } from '../../schemas/index.js';

export type LabWorkOrderStatus = (typeof LAB_WORK_ORDER_STATUSES)[number];

/** Statuses before the lab has returned the case — the only ones that can be "overdue from lab". */
export const PRE_RECEIPT_STATUSES: readonly LabWorkOrderStatus[] = [
  'pending',
  'impression_taken',
  'sent_to_lab',
  'in_progress',
];

const TERMINAL_STATUSES: readonly LabWorkOrderStatus[] = ['completed', 'cancelled'];

export const ALLOWED_TRANSITIONS: Record<LabWorkOrderStatus, LabWorkOrderStatus[]> = {
  pending: ['impression_taken', 'cancelled'],
  impression_taken: ['sent_to_lab', 'cancelled'],
  sent_to_lab: ['in_progress', 'cancelled'],
  in_progress: ['received_from_lab', 'cancelled'],
  received_from_lab: ['fitting_or_trial', 'cancelled'],
  fitting_or_trial: ['revision_requested', 'completed', 'cancelled'],
  revision_requested: ['sent_to_lab', 'cancelled'],
  completed: [],
  cancelled: [],
};

export type StatusTransitionResult =
  | { ok: true }
  | { ok: false; code: 'invalid_transition' | 'already_terminal'; message: string };

export function validateStatusTransition(
  from: LabWorkOrderStatus,
  to: LabWorkOrderStatus,
): StatusTransitionResult {
  if (TERMINAL_STATUSES.includes(from)) {
    return { ok: false, code: 'already_terminal', message: `Lab work order is already ${from} and cannot change status.` };
  }
  if (!ALLOWED_TRANSITIONS[from]?.includes(to)) {
    return { ok: false, code: 'invalid_transition', message: `Cannot move a lab work order from ${from} to ${to}.` };
  }
  return { ok: true };
}

/** True when a transition re-enters the lab (a remake loop-back), used to bump revisionCount. */
export function isRevisionLoopBack(from: LabWorkOrderStatus, to: LabWorkOrderStatus): boolean {
  return from === 'revision_requested' && to === 'sent_to_lab';
}

export type OverdueCheckInput = {
  status: string;
  expectedReturnDate: Date | string | null;
};

export function isOverdue(order: OverdueCheckInput, now: Date = new Date()): boolean {
  if (!order.expectedReturnDate) return false;
  if (!(PRE_RECEIPT_STATUSES as readonly string[]).includes(order.status)) return false;
  const expected = order.expectedReturnDate instanceof Date ? order.expectedReturnDate : new Date(order.expectedReturnDate);
  return expected.getTime() < now.getTime();
}

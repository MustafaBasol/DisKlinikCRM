/**
 * labOrderSummary.ts — Pure dashboard bucket aggregation for LabWorkOrder
 * lists, reused by the dashboard endpoint so its counts always match the
 * per-row `isOverdue` flag and the notification job's overdue query.
 */

import { isOverdue, type OverdueCheckInput } from './labOrderStatusTransitions.js';

export type LabOrderSummaryInput = OverdueCheckInput & { status: string };

export type LabOrderDashboardSummary = {
  pending: number;
  received: number;
  fittingPending: number;
  revisionRequested: number;
  overdue: number;
  completed: number;
  cancelled: number;
  total: number;
};

export function buildDashboardSummary(
  orders: LabOrderSummaryInput[],
  now: Date = new Date(),
): LabOrderDashboardSummary {
  const summary: LabOrderDashboardSummary = {
    pending: 0,
    received: 0,
    fittingPending: 0,
    revisionRequested: 0,
    overdue: 0,
    completed: 0,
    cancelled: 0,
    total: orders.length,
  };

  for (const order of orders) {
    switch (order.status) {
      case 'pending':
      case 'impression_taken':
      case 'sent_to_lab':
      case 'in_progress':
        summary.pending += 1;
        break;
      case 'received_from_lab':
        summary.received += 1;
        break;
      case 'fitting_or_trial':
        summary.fittingPending += 1;
        break;
      case 'revision_requested':
        summary.revisionRequested += 1;
        break;
      case 'completed':
        summary.completed += 1;
        break;
      case 'cancelled':
        summary.cancelled += 1;
        break;
    }
    if (isOverdue(order, now)) {
      summary.overdue += 1;
    }
  }

  return summary;
}

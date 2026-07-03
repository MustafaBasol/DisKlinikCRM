// Mirrors server/src/services/labOrders/labOrderStatusTransitions.ts and
// server/src/schemas/index.ts (LAB_WORK_ORDER_STATUSES / LAB_WORK_TYPES).
// Kept as a small duplicated constant on the frontend since there is no
// existing pattern in this app for the client to fetch backend-owned enums.

export const LAB_WORK_ORDER_STATUSES = [
  'pending',
  'impression_taken',
  'sent_to_lab',
  'in_progress',
  'received_from_lab',
  'fitting_or_trial',
  'revision_requested',
  'completed',
  'cancelled',
] as const;

export type LabWorkOrderStatus = (typeof LAB_WORK_ORDER_STATUSES)[number];

export const LAB_WORK_TYPES = [
  'crown',
  'bridge',
  'denture_full',
  'denture_partial',
  'implant_prosthetic',
  'night_guard',
  'aligner',
  'retainer',
  'repair',
  'temp_prosthetic',
  'other',
] as const;

export type LabWorkType = (typeof LAB_WORK_TYPES)[number];

/** Statuses before the lab has returned the case — the only ones that can be "overdue from lab". */
export const PRE_RECEIPT_STATUSES: readonly LabWorkOrderStatus[] = [
  'pending',
  'impression_taken',
  'sent_to_lab',
  'in_progress',
];

export const ALLOWED_STATUS_TRANSITIONS: Record<LabWorkOrderStatus, LabWorkOrderStatus[]> = {
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

// Deliberately distinct colors for received / fitting-pending / revision-requested /
// completed so those buckets are never confusable at a glance — overdue is rendered
// as a separate red pill layered on top of the status badge, not a status value itself.
export const LAB_ORDER_STATUS_BADGE: Record<LabWorkOrderStatus, string> = {
  pending: 'bg-gray-100 text-gray-700 dark:bg-gray-700/40 dark:text-gray-300',
  impression_taken: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
  sent_to_lab: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  in_progress: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  received_from_lab: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
  fitting_or_trial: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  revision_requested: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  completed: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

export function isOverdue(order: { status: string; expectedReturnDate: string | Date | null }, now: Date = new Date()): boolean {
  if (!order.expectedReturnDate) return false;
  if (!(PRE_RECEIPT_STATUSES as readonly string[]).includes(order.status)) return false;
  const expected = order.expectedReturnDate instanceof Date ? order.expectedReturnDate : new Date(order.expectedReturnDate);
  return expected.getTime() < now.getTime();
}

export type ToothStatus =
  | 'planned'
  | 'in_progress'
  | 'treated'
  | 'issue'
  | 'missing'
  | 'crown'
  | 'implant';

export type ProcedureStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled';
export type ToothShape = 'molar' | 'premolar' | 'canine' | 'incisor';

export interface ToothRecord {
  id: string;
  toothFdi: number;
  status: ToothStatus;
  note?: string | null;
  createdBy?: { firstName: string; lastName: string };
  createdAt?: string;
  updatedAt?: string;
}

export interface TreatmentProcedure {
  id: string;
  toothFdi?: number | null;
  procedureName: string;
  status: ProcedureStatus;
  notes?: string | null;
  estimatedCost?: number | null;
  scheduledDate?: string | null;
  completedAt?: string | null;
  treatmentCase?: { id: string; title: string; stage: string };
  service?: { id: string; name: string };
  createdAt: string;
}

export interface ToothStatusMeta {
  fallback: string;
  badge: string;
  soft: string;
  text: string;
  border: string;
  dot: string;
  stroke: string;
  fill: string;
  ring: string;
}

export interface ProcedureStatusMeta {
  fallback: string;
  dot: string;
  text: string;
  bg: string;
  border: string;
}

export const TOOTH_STATUSES: ToothStatus[] = [
  'planned',
  'in_progress',
  'treated',
  'issue',
  'missing',
  'crown',
  'implant',
];

export const TOOTH_STATUS_META: Record<ToothStatus, ToothStatusMeta> = {
  planned: {
    fallback: 'Planned',
    badge: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-200 dark:border-amber-800',
    soft: 'bg-amber-50/80 dark:bg-amber-900/10',
    text: 'text-amber-700 dark:text-amber-200',
    border: 'border-amber-300 dark:border-amber-700',
    dot: 'bg-amber-400',
    stroke: 'stroke-amber-500 dark:stroke-amber-300',
    fill: 'fill-amber-50 dark:fill-amber-900/20',
    ring: 'ring-amber-200 dark:ring-amber-700/60',
  },
  in_progress: {
    fallback: 'In Progress',
    badge: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-200 dark:border-blue-800',
    soft: 'bg-blue-50/80 dark:bg-blue-900/10',
    text: 'text-blue-700 dark:text-blue-200',
    border: 'border-blue-300 dark:border-blue-700',
    dot: 'bg-blue-500',
    stroke: 'stroke-blue-500 dark:stroke-blue-300',
    fill: 'fill-blue-50 dark:fill-blue-900/20',
    ring: 'ring-blue-200 dark:ring-blue-700/60',
  },
  treated: {
    fallback: 'Treated',
    badge: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-200 dark:border-emerald-800',
    soft: 'bg-emerald-50/80 dark:bg-emerald-900/10',
    text: 'text-emerald-700 dark:text-emerald-200',
    border: 'border-emerald-300 dark:border-emerald-700',
    dot: 'bg-emerald-500',
    stroke: 'stroke-emerald-500 dark:stroke-emerald-300',
    fill: 'fill-emerald-100 dark:fill-emerald-900/30',
    ring: 'ring-emerald-200 dark:ring-emerald-700/60',
  },
  issue: {
    fallback: 'Issue',
    badge: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-200 dark:border-red-800',
    soft: 'bg-red-50/80 dark:bg-red-900/10',
    text: 'text-red-700 dark:text-red-200',
    border: 'border-red-300 dark:border-red-700',
    dot: 'bg-red-500',
    stroke: 'stroke-red-500 dark:stroke-red-300',
    fill: 'fill-red-50 dark:fill-red-900/20',
    ring: 'ring-red-200 dark:ring-red-700/60',
  },
  missing: {
    fallback: 'Missing',
    badge: 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600',
    soft: 'bg-gray-50/80 dark:bg-gray-800/60',
    text: 'text-gray-600 dark:text-gray-200',
    border: 'border-gray-300 dark:border-gray-600',
    dot: 'bg-gray-400',
    stroke: 'stroke-gray-300 dark:stroke-gray-500',
    fill: 'fill-transparent',
    ring: 'ring-gray-200 dark:ring-gray-600',
  },
  crown: {
    fallback: 'Crown',
    badge: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-900/20 dark:text-indigo-200 dark:border-indigo-800',
    soft: 'bg-indigo-50/80 dark:bg-indigo-900/10',
    text: 'text-indigo-700 dark:text-indigo-200',
    border: 'border-indigo-300 dark:border-indigo-700',
    dot: 'bg-indigo-500',
    stroke: 'stroke-indigo-500 dark:stroke-indigo-300',
    fill: 'fill-indigo-50 dark:fill-indigo-900/20',
    ring: 'ring-indigo-200 dark:ring-indigo-700/60',
  },
  implant: {
    fallback: 'Implant',
    badge: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/20 dark:text-purple-200 dark:border-purple-800',
    soft: 'bg-purple-50/80 dark:bg-purple-900/10',
    text: 'text-purple-700 dark:text-purple-200',
    border: 'border-purple-300 dark:border-purple-700',
    dot: 'bg-purple-500',
    stroke: 'stroke-purple-500 dark:stroke-purple-300',
    fill: 'fill-purple-50 dark:fill-purple-900/20',
    ring: 'ring-purple-200 dark:ring-purple-700/60',
  },
};

export const PROCEDURE_STATUS_META: Record<ProcedureStatus, ProcedureStatusMeta> = {
  planned: {
    fallback: 'Planned',
    dot: 'bg-amber-400',
    text: 'text-amber-700 dark:text-amber-200',
    bg: 'bg-amber-50 dark:bg-amber-900/20',
    border: 'border-amber-100 dark:border-amber-800',
  },
  in_progress: {
    fallback: 'In Progress',
    dot: 'bg-blue-500',
    text: 'text-blue-700 dark:text-blue-200',
    bg: 'bg-blue-50 dark:bg-blue-900/20',
    border: 'border-blue-100 dark:border-blue-800',
  },
  completed: {
    fallback: 'Completed',
    dot: 'bg-emerald-500',
    text: 'text-emerald-700 dark:text-emerald-200',
    bg: 'bg-emerald-50 dark:bg-emerald-900/20',
    border: 'border-emerald-100 dark:border-emerald-800',
  },
  cancelled: {
    fallback: 'Cancelled',
    dot: 'bg-gray-400',
    text: 'text-gray-500 dark:text-gray-300',
    bg: 'bg-gray-50 dark:bg-gray-700/60',
    border: 'border-gray-100 dark:border-gray-600',
  },
};

export const UPPER_RIGHT = [18, 17, 16, 15, 14, 13, 12, 11];
export const UPPER_LEFT = [21, 22, 23, 24, 25, 26, 27, 28];
export const LOWER_RIGHT = [48, 47, 46, 45, 44, 43, 42, 41];
export const LOWER_LEFT = [31, 32, 33, 34, 35, 36, 37, 38];

export function getToothShape(fdi: number): ToothShape {
  const position = fdi % 10;
  if (position >= 6) return 'molar';
  if (position >= 4) return 'premolar';
  if (position === 3) return 'canine';
  return 'incisor';
}

export function isToothStatus(status: string): status is ToothStatus {
  return TOOTH_STATUSES.includes(status as ToothStatus);
}

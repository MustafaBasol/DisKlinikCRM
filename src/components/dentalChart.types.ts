export type ToothStatus =
  | 'planned'
  | 'in_progress'
  | 'treated'
  | 'issue'
  | 'missing'
  | 'crown'
  | 'implant';

export type ProcedureStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled';

// ToothShape/Dentition are owned by toothGeometry.ts (the module that actually
// draws them) and re-exported here so every existing `from './dentalChart.types'`
// import site keeps working unchanged.
export type { ToothShape, Dentition } from './toothGeometry';
import type { ToothShape, Dentition } from './toothGeometry';

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

// ─── Primary (deciduous) dentition — DENTAL-CHART-UX-001 ────────────────────
//
// FDI quadrants 5-8 are the deciduous arch, five teeth per quadrant
// (central incisor, lateral incisor, canine, first molar, second molar).
//
// WHY NO MIGRATION IS NEEDED: FDI numbering is disjoint between dentitions —
// permanent teeth occupy 11-48, primary teeth 51-85, and no integer is valid
// in both. ToothRecord.toothFdi is a plain `Int` column with a
// (patientId, toothFdi) unique key and NO database-level range constraint
// (server/prisma/migrations/20260518120000_add_tooth_records/migration.sql),
// so a primary tooth is simply another integer in the same column. That also
// means a mixed-dentition patient can hold permanent AND primary records at
// the same time without any ambiguity about which tooth a row refers to.
// The only gate that had to move is the server's VALID_FDI allowlist.
export const UPPER_RIGHT_PRIMARY = [55, 54, 53, 52, 51];
export const UPPER_LEFT_PRIMARY = [61, 62, 63, 64, 65];
export const LOWER_RIGHT_PRIMARY = [85, 84, 83, 82, 81];
export const LOWER_LEFT_PRIMARY = [71, 72, 73, 74, 75];

export const PERMANENT_FDI: readonly number[] = [
  ...UPPER_RIGHT, ...UPPER_LEFT, ...LOWER_RIGHT, ...LOWER_LEFT,
];
export const PRIMARY_FDI: readonly number[] = [
  ...UPPER_RIGHT_PRIMARY, ...UPPER_LEFT_PRIMARY, ...LOWER_RIGHT_PRIMARY, ...LOWER_LEFT_PRIMARY,
];

const PERMANENT_FDI_SET = new Set(PERMANENT_FDI);
const PRIMARY_FDI_SET = new Set(PRIMARY_FDI);

/** True for a well-formed deciduous FDI number (51-55, 61-65, 71-75, 81-85). */
export function isPrimaryToothFdi(fdi: number): boolean {
  return PRIMARY_FDI_SET.has(fdi);
}

/** True for a well-formed permanent FDI number (11-18, 21-28, 31-38, 41-48). */
export function isPermanentToothFdi(fdi: number): boolean {
  return PERMANENT_FDI_SET.has(fdi);
}

/** True for any FDI number this chart can render or persist. */
export function isValidToothFdi(fdi: number): boolean {
  return isPermanentToothFdi(fdi) || isPrimaryToothFdi(fdi);
}

/**
 * Which dentition an FDI number belongs to. Because the two ranges are
 * disjoint (see above) this is total for valid input and never guesses;
 * anything outside both ranges is reported as 'permanent' so legacy/unknown
 * values keep rendering on the adult chart exactly as they did before.
 */
export function getToothDentition(fdi: number): Dentition {
  return isPrimaryToothFdi(fdi) ? 'primary' : 'permanent';
}

/**
 * Anatomical crown form for an FDI number.
 *
 * Permanent: positions 6-8 are molars, 4-5 premolars, 3 canine, 1-2 incisors.
 * Primary:   there are NO premolars — positions 4-5 are the first and second
 *            deciduous MOLARS. Getting this wrong would have drawn every
 *            child's molars as premolars, which is the single most visible
 *            way a paediatric chart can look wrong to a dentist.
 *
 * Behaviour for permanent FDI numbers is byte-for-byte what it was before.
 */
export function getToothShape(fdi: number): ToothShape {
  const position = fdi % 10;

  if (isPrimaryToothFdi(fdi)) {
    if (position >= 4) return 'molar';
    if (position === 3) return 'canine';
    return 'incisor';
  }

  if (position >= 6) return 'molar';
  if (position >= 4) return 'premolar';
  if (position === 3) return 'canine';
  return 'incisor';
}

export function isToothStatus(status: string): status is ToothStatus {
  return TOOTH_STATUSES.includes(status as ToothStatus);
}

/**
 * Picks which chart to open on first render. Deliberately ordered so that
 * RECORDED DATA BEATS THE AGE HEURISTIC: if a clinician has already charted
 * one dentition and not the other, that is a far stronger signal than a date
 * of birth (which is frequently missing, and is plain wrong for a returning
 * adult patient whose childhood records were migrated in). Only when the
 * chart is empty, or genuinely mixed, does age decide.
 *
 * The user can always override with the explicit dentition switch — this only
 * chooses the initial view, and never restricts what can be charted.
 */
export function resolveInitialDentition(input: {
  dateOfBirth?: string | Date | null;
  hasPermanentRecords: boolean;
  hasPrimaryRecords: boolean;
  now?: Date;
}): Dentition {
  const { dateOfBirth, hasPermanentRecords, hasPrimaryRecords, now = new Date() } = input;

  if (hasPrimaryRecords && !hasPermanentRecords) return 'primary';
  if (hasPermanentRecords && !hasPrimaryRecords) return 'permanent';

  const age = toothChartAgeInYears(dateOfBirth, now);
  // Under 6 the arch is still entirely deciduous. From 6 onwards the first
  // permanent molars are erupting, so the adult chart is the more useful
  // default even though the patient is in mixed dentition.
  if (age !== null && age < 6) return 'primary';
  return 'permanent';
}

/**
 * Whole years between `dateOfBirth` and `now`, or null when the date is
 * absent/unparseable. Kept local to the chart rather than reusing
 * patientDetailTabsHelpers.isMinorPatient because that helper answers a
 * different question (under-18 for the legal-guardian warning) and coupling
 * the two would mean a change to either could silently move the other.
 */
export function toothChartAgeInYears(
  dateOfBirth: string | Date | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!dateOfBirth) return null;
  const dob = typeof dateOfBirth === 'string' ? new Date(dateOfBirth) : dateOfBirth;
  if (Number.isNaN(dob.getTime())) return null;
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

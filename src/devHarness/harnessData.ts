/**
 * harnessData.ts — DENTAL-CHART-UX-001-R2 visual evidence harness
 *
 * Deterministic fixtures for the odontogram screenshot harness. No network, no
 * auth, no clock: every value here is fixed so two runs produce byte-identical
 * screenshots and a visual regression is a real regression.
 *
 * This is TEST TOOLING, not application code. Nothing under src/components or
 * src/pages may import it.
 */

import type { ToothRecord, ToothStatus, TreatmentProcedure } from '../components/dentalChart.types';
import {
  LOWER_LEFT,
  LOWER_LEFT_PRIMARY,
  LOWER_RIGHT,
  LOWER_RIGHT_PRIMARY,
  UPPER_LEFT,
  UPPER_LEFT_PRIMARY,
  UPPER_RIGHT,
  UPPER_RIGHT_PRIMARY,
} from '../components/dentalChart.types';

const FIXED_TIMESTAMP = '2026-08-21T09:30:00.000Z';

export function makeRecord(toothFdi: number, status: ToothStatus, note?: string): ToothRecord {
  return {
    id: `harness-${toothFdi}`,
    toothFdi,
    status,
    note: note ?? null,
    createdBy: { firstName: 'Ada', lastName: 'Yilmaz' },
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
  };
}

export function recordMap(entries: [number, ToothStatus, string?][]): Map<number, ToothRecord> {
  const map = new Map<number, ToothRecord>();
  for (const [fdi, status, note] of entries) map.set(fdi, makeRecord(fdi, status, note));
  return map;
}

/** Empty chart — the "no statuses" evidence shots. */
export const NO_RECORDS = new Map<number, ToothRecord>();

/**
 * One representative tooth per status in each arch and on each side, so a
 * single screenshot proves every status renders in every orientation.
 */
export const PERMANENT_RECORDS = recordMap([
  [18, 'missing'],
  [16, 'crown', 'Zirkonya kuron, 2025-11.'],
  [14, 'implant'],
  [12, 'treated'],
  [11, 'planned', 'Kompozit dolgu planlandi.'],
  [23, 'in_progress'],
  [25, 'issue', 'Perkusyona hassas.'],
  [27, 'treated'],
  [28, 'missing'],
  [48, 'missing'],
  [46, 'implant'],
  [44, 'crown'],
  [41, 'issue'],
  [31, 'planned'],
  [33, 'treated'],
  [36, 'in_progress', 'Kanal tedavisi 2. seans.'],
  [38, 'missing'],
]);

export const PRIMARY_RECORDS = recordMap([
  [55, 'crown', 'Paslanmaz celik kuron.'],
  [54, 'treated'],
  [52, 'issue'],
  [51, 'planned'],
  [61, 'in_progress'],
  [63, 'treated'],
  [65, 'missing'],
  [85, 'treated'],
  [84, 'crown'],
  [82, 'planned'],
  [71, 'issue'],
  [74, 'missing'],
  [75, 'in_progress'],
]);

/** Crown / implant / missing close-up fixture — adjacent teeth, same quadrant. */
export const RESTORATION_RECORDS = recordMap([
  [16, 'crown', 'Tam seramik kuron.'],
  [15, 'missing'],
  [14, 'implant', 'Implant + ust yapi.'],
  [46, 'crown'],
  [45, 'missing'],
  [44, 'implant'],
]);

export const PROCEDURES: TreatmentProcedure[] = [
  {
    id: 'proc-1',
    toothFdi: 16,
    procedureName: 'Zirkonya kuron',
    status: 'completed',
    notes: 'Simantasyon tamamlandi.',
    estimatedCost: 8500,
    scheduledDate: '2026-07-14T09:00:00.000Z',
    completedAt: '2026-07-14T10:20:00.000Z',
    treatmentCase: { id: 'case-1', title: 'Ust sag restorasyon', stage: 'treatment' },
    service: { id: 'svc-1', name: 'Protez' },
    createdAt: '2026-06-30T08:00:00.000Z',
  },
  {
    id: 'proc-2',
    toothFdi: 16,
    procedureName: 'Kanal tedavisi',
    status: 'completed',
    notes: null,
    estimatedCost: 4200,
    scheduledDate: '2026-06-02T11:00:00.000Z',
    completedAt: '2026-06-02T12:10:00.000Z',
    treatmentCase: { id: 'case-1', title: 'Ust sag restorasyon', stage: 'treatment' },
    service: { id: 'svc-2', name: 'Endodonti' },
    createdAt: '2026-05-28T08:00:00.000Z',
  },
  {
    id: 'proc-3',
    toothFdi: 16,
    procedureName: 'Kontrol randevusu',
    status: 'planned',
    notes: 'Alti ay sonra kontrol.',
    estimatedCost: 0,
    scheduledDate: '2027-01-12T09:00:00.000Z',
    completedAt: null,
    treatmentCase: { id: 'case-1', title: 'Ust sag restorasyon', stage: 'followup' },
    service: { id: 'svc-3', name: 'Muayene' },
    createdAt: '2026-07-14T10:30:00.000Z',
  },
  {
    id: 'proc-4',
    toothFdi: 36,
    procedureName: 'Kanal tedavisi',
    status: 'in_progress',
    notes: 'Ikinci seans.',
    estimatedCost: 4200,
    scheduledDate: '2026-08-24T14:00:00.000Z',
    completedAt: null,
    treatmentCase: { id: 'case-2', title: 'Alt sol endodonti', stage: 'treatment' },
    service: { id: 'svc-2', name: 'Endodonti' },
    createdAt: '2026-08-10T08:00:00.000Z',
  },
];

export function procedureMapFrom(procedures: TreatmentProcedure[]): Map<number, TreatmentProcedure[]> {
  const map = new Map<number, TreatmentProcedure[]>();
  for (const procedure of procedures) {
    if (!procedure.toothFdi) continue;
    const list = map.get(procedure.toothFdi) ?? [];
    list.push(procedure);
    map.set(procedure.toothFdi, list);
  }
  return map;
}

/** Full FDI order per dentition, used by the morphology matrix shots. */
export const PERMANENT_ORDER = [
  ...UPPER_RIGHT, ...UPPER_LEFT, ...LOWER_RIGHT, ...LOWER_LEFT,
];
export const PRIMARY_ORDER = [
  ...UPPER_RIGHT_PRIMARY, ...UPPER_LEFT_PRIMARY, ...LOWER_RIGHT_PRIMARY, ...LOWER_LEFT_PRIMARY,
];

/** Fixed formatters so screenshots never drift with locale or clock. */
export const formatDateTime = (value: string): string => {
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getUTCDate())}.${pad(date.getUTCMonth() + 1)}.${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
};

export const formatCurrency = (amount: number): string =>
  `${amount.toLocaleString('tr-TR')} ₺`;

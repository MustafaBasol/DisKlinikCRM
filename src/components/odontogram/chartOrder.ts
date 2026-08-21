/**
 * chartOrder.ts — DENTAL-CHART-UX-001-R2 (Lane A refinement pass)
 *
 * The one place that turns a `Dentition` into the four quadrant arrays and
 * the two screen-left-to-right rows built from them. Shared by
 * `Odontogram.tsx` (arch layout + arrow-key navigation) and
 * `DentalChart.tsx` (prev/next-tooth buttons + jump-to-FDI), so the notion
 * of "chart order" only exists in one place.
 */
import {
  Dentition,
  LOWER_LEFT,
  LOWER_LEFT_PRIMARY,
  LOWER_RIGHT,
  LOWER_RIGHT_PRIMARY,
  UPPER_LEFT,
  UPPER_LEFT_PRIMARY,
  UPPER_RIGHT,
  UPPER_RIGHT_PRIMARY,
} from '../dentalChart.types';

export interface ArchTeeth {
  upperRight: number[];
  upperLeft: number[];
  lowerRight: number[];
  lowerLeft: number[];
}

const ARCH_BY_DENTITION: Record<Dentition, ArchTeeth> = {
  permanent: {
    upperRight: UPPER_RIGHT,
    upperLeft: UPPER_LEFT,
    lowerRight: LOWER_RIGHT,
    lowerLeft: LOWER_LEFT,
  },
  primary: {
    upperRight: UPPER_RIGHT_PRIMARY,
    upperLeft: UPPER_LEFT_PRIMARY,
    lowerRight: LOWER_RIGHT_PRIMARY,
    lowerLeft: LOWER_LEFT_PRIMARY,
  },
};

export function getArchTeeth(dentition: Dentition): ArchTeeth {
  return ARCH_BY_DENTITION[dentition];
}

/** Screen left-to-right: patient's right quadrant first, then patient's left. */
export function getUpperRow(dentition: Dentition): number[] {
  const arch = ARCH_BY_DENTITION[dentition];
  return [...arch.upperRight, ...arch.upperLeft];
}

export function getLowerRow(dentition: Dentition): number[] {
  const arch = ARCH_BY_DENTITION[dentition];
  return [...arch.lowerRight, ...arch.lowerLeft];
}

/** Full linear chart order (upper row, then lower row) — for prev/next-tooth stepping. */
export function getChartOrder(dentition: Dentition): number[] {
  return [...getUpperRow(dentition), ...getLowerRow(dentition)];
}

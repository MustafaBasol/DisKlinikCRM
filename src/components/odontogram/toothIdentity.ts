/**
 * toothIdentity.ts — DENTAL-CHART-UX-001-R2
 *
 * One FDI number in, everything the renderer needs out.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * R1 resolved a tooth to a coarse four-value `ToothShape` (molar / premolar /
 * canine / incisor). That is enough to draw four blobs and not enough to draw a
 * chart: a first molar and a third molar are not the same tooth, an upper
 * central incisor is twice the width of a lateral, and the mesial half of a
 * crown is not the distal half. Every one of those distinctions is what makes a
 * dentist read a drawing as anatomy instead of as an icon.
 *
 * `ToothIdentity` is therefore the single lookup that the anatomy registries,
 * the glyph renderer and the detail panel all key off. Nothing downstream is
 * allowed to re-derive arch/side/family from the raw number with its own
 * modulo arithmetic — that is how the primary-premolar class of bug gets
 * reintroduced.
 *
 * NO DATA CONTRACT CHANGES HERE. `ToothRecord.toothFdi` stays authoritative and
 * is only ever read.
 */

import {
  getToothDentition,
  getToothShape,
  isPrimaryToothFdi,
} from '../dentalChart.types';
import type { Dentition, ToothShape } from '../toothGeometry';

/** Which jaw the tooth sits in. */
export type ToothArch = 'upper' | 'lower';

/**
 * The PATIENT's right or left, which is the only side that means anything
 * clinically. FDI quadrants 1/4/5/8 are the patient's right, 2/3/6/7 the left.
 * On screen the patient's right is drawn on the viewer's LEFT (the chart is
 * read as if facing the patient) — that inversion is the layout's business,
 * never this module's.
 */
export type ToothSide = 'right' | 'left';

export type ToothQuadrant = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/**
 * The anatomical tooth family. This is the level of detail the artwork is
 * authored at.
 *
 * PRIMARY DENTITION HAS NO PREMOLARS. Deciduous positions 4 and 5 are the
 * FIRST and SECOND PRIMARY MOLARS, so they map to `first_molar` /
 * `second_molar` and are drawn with molar morphology. `first_premolar` and
 * `second_premolar` are unreachable for any FDI in 51-85, and
 * `toothIdentity.test` pins that.
 */
export type ToothFamily =
  | 'central_incisor'
  | 'lateral_incisor'
  | 'canine'
  | 'first_premolar'
  | 'second_premolar'
  | 'first_molar'
  | 'second_molar'
  | 'third_molar';

export interface ToothIdentity {
  /** The FDI number exactly as stored. Never rewritten. */
  fdi: number;
  dentition: Dentition;
  arch: ToothArch;
  side: ToothSide;
  quadrant: ToothQuadrant;
  /** Position within the quadrant, counting from the midline. 1-8 / 1-5. */
  position: number;
  family: ToothFamily;
  /**
   * The coarse R1 category, still derived by `getToothShape` so that any
   * existing caller (and the old i18n `toothShape.*` keys) keeps behaving
   * identically. New code should prefer `family`.
   */
  shape: ToothShape;
  /** True for permanent 6/7/8 and premolars, and for primary 4/5. */
  isPosterior: boolean;
}

const PERMANENT_FAMILY_BY_POSITION: Record<number, ToothFamily> = {
  1: 'central_incisor',
  2: 'lateral_incisor',
  3: 'canine',
  4: 'first_premolar',
  5: 'second_premolar',
  6: 'first_molar',
  7: 'second_molar',
  8: 'third_molar',
};

/** Deciduous arch: five teeth, positions 4 and 5 are MOLARS, never premolars. */
const PRIMARY_FAMILY_BY_POSITION: Record<number, ToothFamily> = {
  1: 'central_incisor',
  2: 'lateral_incisor',
  3: 'canine',
  4: 'first_molar',
  5: 'second_molar',
};

const UPPER_QUADRANTS = new Set<number>([1, 2, 5, 6]);
const RIGHT_QUADRANTS = new Set<number>([1, 4, 5, 8]);

/**
 * Resolves one FDI number into everything the chart needs.
 *
 * Out-of-range input is not thrown on: the chart has always rendered unknown
 * numbers on the adult arch rather than crashing a patient page, and that
 * behaviour is preserved. An unrecognised position falls back to the closest
 * sane family so a stray value still draws something tooth-shaped.
 */
export function getToothIdentity(fdi: number): ToothIdentity {
  const dentition = getToothDentition(fdi);
  const quadrantDigit = Math.floor(fdi / 10);
  const position = fdi % 10;

  const arch: ToothArch = UPPER_QUADRANTS.has(quadrantDigit) ? 'upper' : 'lower';
  const side: ToothSide = RIGHT_QUADRANTS.has(quadrantDigit) ? 'right' : 'left';

  const table = isPrimaryToothFdi(fdi)
    ? PRIMARY_FAMILY_BY_POSITION
    : PERMANENT_FAMILY_BY_POSITION;
  const family =
    table[position] ??
    (dentition === 'primary' ? 'second_molar' : 'third_molar');

  const shape = getToothShape(fdi);

  return {
    fdi,
    dentition,
    arch,
    side,
    quadrant: (quadrantDigit >= 1 && quadrantDigit <= 8
      ? quadrantDigit
      : 1) as ToothQuadrant,
    position,
    family,
    shape,
    isPosterior: shape === 'molar' || shape === 'premolar',
  };
}

/** Families that actually occur in a given dentition, in mesial-to-distal order. */
export const PERMANENT_FAMILIES: readonly ToothFamily[] = [
  'central_incisor',
  'lateral_incisor',
  'canine',
  'first_premolar',
  'second_premolar',
  'first_molar',
  'second_molar',
  'third_molar',
];

export const PRIMARY_FAMILIES: readonly ToothFamily[] = [
  'central_incisor',
  'lateral_incisor',
  'canine',
  'first_molar',
  'second_molar',
];

export function familiesForDentition(dentition: Dentition): readonly ToothFamily[] {
  return dentition === 'primary' ? PRIMARY_FAMILIES : PERMANENT_FAMILIES;
}

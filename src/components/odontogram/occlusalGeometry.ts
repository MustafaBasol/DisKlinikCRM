/**
 * occlusalGeometry.ts — DENTAL-CHART-UX-001-R2
 *
 * SEED IMPLEMENTATION — OWNED BY LANE C, WHICH REPLACES THIS FILE WHOLESALE.
 *
 * Generates a placeholder occlusal view per family so the dual-view layout can
 * be assembled and screenshotted before the real artwork exists. The five
 * surface regions are real closed paths that tile the outline, so the
 * addressability contract (data-surface targets, future surface charting) is
 * already exercised end to end — only the shapes are provisional.
 *
 * Canonical orientation, per anatomy.types.ts: buccal at small y, lingual at
 * large y, mesial at large x. Authored for the patient's RIGHT side.
 */

import type {
  AnatomyKey,
  AnatomyRegistry,
  OcclusalToothArt,
} from './anatomy.types';
import { allAnatomyKeys, anatomyKeyFor } from './anatomy.types';
import type { ToothFamily, ToothIdentity } from './toothIdentity';

/** Half-width / half-depth of the crown table for each family, in view units. */
const FOOTPRINT: Record<ToothFamily, { halfWidth: number; halfDepth: number }> = {
  central_incisor: { halfWidth: 15, halfDepth: 7 },
  lateral_incisor: { halfWidth: 12, halfDepth: 6.5 },
  canine: { halfWidth: 12.5, halfDepth: 9 },
  first_premolar: { halfWidth: 12, halfDepth: 12 },
  second_premolar: { halfWidth: 12, halfDepth: 12 },
  first_molar: { halfWidth: 17, halfDepth: 15 },
  second_molar: { halfWidth: 16, halfDepth: 14.5 },
  third_molar: { halfWidth: 15, halfDepth: 13 },
};

const CENTRE = 32;

function rect(x0: number, y0: number, x1: number, y1: number): string {
  return `M${x0} ${y0} L${x1} ${y0} L${x1} ${y1} L${x0} ${y1} Z`;
}

function seedEntry(key: AnatomyKey): OcclusalToothArt {
  const family = key.split(':')[2] as ToothFamily;
  const { halfWidth, halfDepth } = FOOTPRINT[family] ?? FOOTPRINT.first_molar;

  const left = CENTRE - halfWidth;
  const right = CENTRE + halfWidth;
  const top = CENTRE - halfDepth;
  const bottom = CENTRE + halfDepth;

  // Inset that separates the four peripheral surfaces from the central table.
  const inset = Math.min(halfWidth, halfDepth) * 0.42;

  return {
    outline: rect(left, top, right, bottom),
    surfaces: {
      // Mesial is at LARGE x by the canonical convention.
      mesial: rect(right - inset, top, right, bottom),
      distal: rect(left, top, left + inset, bottom),
      buccal: rect(left + inset, top, right - inset, top + inset),
      lingual: rect(left + inset, bottom - inset, right - inset, bottom),
      central: rect(left + inset, top + inset, right - inset, bottom - inset),
    },
    detail: `M${left + inset} ${CENTRE} H${right - inset}`,
    sideStrategy: 'symmetric',
    simplification:
      'SEED: rectangular placeholder footprint; no cusp outline or fissure pattern yet.',
  };
}

export const OCCLUSAL_ART: AnatomyRegistry<OcclusalToothArt> = Object.fromEntries(
  allAnatomyKeys().map((key) => [key, seedEntry(key)]),
) as AnatomyRegistry<OcclusalToothArt>;

export function getOcclusalArt(identity: ToothIdentity): OcclusalToothArt {
  return OCCLUSAL_ART[anatomyKeyFor(identity)];
}

/**
 * lateralGeometry.ts — DENTAL-CHART-UX-001-R2
 *
 * SEED IMPLEMENTATION — OWNED BY LANE B, WHICH REPLACES THIS FILE WHOLESALE.
 *
 * This adapter exists so that the layout, glyph and detail-panel lanes can be
 * built and screenshotted against the real registry contract while the
 * anatomical artwork is still being drawn. It re-keys the R1 four-category
 * geometry onto the new per-family AnatomyKey, so it is correct but coarse:
 * every incisor family shares one outline, every molar family shares one, and
 * nothing is mesiodistally asymmetric yet.
 *
 * Consumers must import only getLateralArt / LATERAL_ART. Nothing may reach
 * past this module into toothGeometry.ts.
 */

import { getToothGeometry } from '../toothGeometry';
import type {
  AnatomyKey,
  AnatomyRegistry,
  LateralToothArt,
} from './anatomy.types';
import { allAnatomyKeys, anatomyKeyFor } from './anatomy.types';
import type { ToothArch, ToothFamily, ToothIdentity } from './toothIdentity';
import type { ToothShape } from '../toothGeometry';

const SHAPE_BY_FAMILY: Record<ToothFamily, ToothShape> = {
  central_incisor: 'incisor',
  lateral_incisor: 'incisor',
  canine: 'canine',
  first_premolar: 'premolar',
  second_premolar: 'premolar',
  first_molar: 'molar',
  second_molar: 'molar',
  third_molar: 'molar',
};

/**
 * Relative mesiodistal crown widths, 1.0 = permanent upper central incisor.
 * These are already close to real average widths (Wheeler) because column
 * width is what stops the arch reading as a uniform icon strip, and it costs
 * nothing to get right before the artwork lands.
 */
const WIDTH_RATIO: Record<string, number> = {
  'permanent:upper:central_incisor': 1.0,
  'permanent:upper:lateral_incisor': 0.78,
  'permanent:upper:canine': 0.89,
  'permanent:upper:first_premolar': 0.83,
  'permanent:upper:second_premolar': 0.83,
  'permanent:upper:first_molar': 1.19,
  'permanent:upper:second_molar': 1.13,
  'permanent:upper:third_molar': 1.06,
  'permanent:lower:central_incisor': 0.63,
  'permanent:lower:lateral_incisor': 0.69,
  'permanent:lower:canine': 0.85,
  'permanent:lower:first_premolar': 0.85,
  'permanent:lower:second_premolar': 0.89,
  'permanent:lower:first_molar': 1.31,
  'permanent:lower:second_molar': 1.25,
  'permanent:lower:third_molar': 1.19,
  'primary:upper:central_incisor': 0.79,
  'primary:upper:lateral_incisor': 0.66,
  'primary:upper:canine': 0.85,
  'primary:upper:first_molar': 0.90,
  'primary:upper:second_molar': 1.16,
  'primary:lower:central_incisor': 0.53,
  'primary:lower:lateral_incisor': 0.63,
  'primary:lower:canine': 0.72,
  'primary:lower:first_molar': 0.98,
  'primary:lower:second_molar': 1.22,
};

function seedEntry(key: AnatomyKey): LateralToothArt {
  const [dentitionPart, archPart, familyPart] = key.split(':');
  const dentition = dentitionPart === 'primary' ? 'primary' : 'permanent';
  const arch = archPart as ToothArch;
  const family = familyPart as ToothFamily;
  const geometry = getToothGeometry(
    SHAPE_BY_FAMILY[family],
    dentition,
    arch === 'upper',
  );

  return {
    crown: geometry.crown,
    roots: geometry.roots,
    surface: geometry.surface,
    cervical: geometry.cervical,
    widthRatio: WIDTH_RATIO[key] ?? 1,
    // The R1 forms are symmetric about x=32, so declaring 'mirror' would be a
    // lie that the left/right regression test is meant to catch.
    sideStrategy: 'symmetric',
    simplification:
      'SEED: R1 four-category geometry re-keyed per family; no mesiodistal asymmetry yet.',
  };
}

export const LATERAL_ART: AnatomyRegistry<LateralToothArt> = Object.fromEntries(
  allAnatomyKeys().map((key) => [key, seedEntry(key)]),
) as AnatomyRegistry<LateralToothArt>;

export function getLateralArt(identity: ToothIdentity): LateralToothArt {
  return LATERAL_ART[anatomyKeyFor(identity)];
}

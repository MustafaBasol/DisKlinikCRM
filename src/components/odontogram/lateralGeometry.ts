/**
 * lateralGeometry.ts — DENTAL-CHART-UX-001-R2 (Lane B)
 *
 * Anatomical LATERAL (buccal-view) artwork registry. Replaces the R1-derived
 * seed wholesale: every family/arch/dentition combination now has its own
 * hand-authored crown, root(s), surface detail and cervical line instead of
 * sharing one of four generic blobs.
 *
 * AUTHORING ORIENTATION (see anatomy.types.ts for the full rationale) —
 *   - viewBox "0 0 64 88", crown at the TOP (small y), root apices at the
 *     BOTTOM (large y); this is lower-jaw orientation for every entry,
 *     including upper teeth. The renderer flips upper teeth; this module
 *     must not pre-flip.
 *   - MESIAL is at LARGE x, DISTAL at small x. Every tooth below is authored
 *     for the patient's RIGHT side, and the mesial/distal contours are drawn
 *     deliberately different so that `sideStrategy: 'mirror'` produces a
 *     genuinely different left quadrant instead of a relabelled copy of the
 *     right one (the defect this task exists to fix — see R1 postmortem in
 *     anatomy.types.ts).
 *   - Root order: the palatal/lingual root is listed FIRST wherever a tooth
 *     has a buccal/palatal root split (upper molars, upper first premolar,
 *     primary upper molars), so the renderer's paint order lets the buccal
 *     roots overlap it and the furcation reads as depth.
 *
 * Every `simplification` string is a genuine, specific admission of where
 * this 2D schematic departs from textbook morphology — not boilerplate.
 * Entries with an empty string (permanent/primary canines) are the forms
 * whose lateral silhouette needs no such admission beyond the universal "this
 * is a small flat schematic, not a scan" caveat that applies to all 26.
 *
 * Consumers must import only `getLateralArt` / `LATERAL_ART`. Nothing may
 * reach past this module into `toothGeometry.ts` (superseded by this file)
 * or re-derive geometry procedurally.
 */

import type {
  AnatomyRegistry,
  LateralToothArt,
} from './anatomy.types';
import { anatomyKeyFor } from './anatomy.types';
import type { ToothIdentity } from './toothIdentity';

import { PERMANENT_UPPER_LATERAL } from './lateral/permanentUpper';
import { PERMANENT_LOWER_LATERAL } from './lateral/permanentLower';
import { PRIMARY_LATERAL } from './lateral/primary';

export const LATERAL_ART: AnatomyRegistry<LateralToothArt> = {
  ...PERMANENT_UPPER_LATERAL,
  ...PERMANENT_LOWER_LATERAL,
  ...PRIMARY_LATERAL,
};

export function getLateralArt(identity: ToothIdentity): LateralToothArt {
  return LATERAL_ART[anatomyKeyFor(identity)];
}

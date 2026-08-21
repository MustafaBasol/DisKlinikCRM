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

export const LATERAL_ART: AnatomyRegistry<LateralToothArt> = {
  // ── PERMANENT UPPER ───────────────────────────────────────────────────

  // Mesioincisal angle sharp/square (mesial = large x, right side of the
  // path); distoincisal angle rounded and the distal contour's height of
  // contour sits low, close to the cervical line, per the task brief.
  'permanent:upper:central_incisor': {
    crown:
      'M43 7 C40 5.3 36 5 33 6.3 C30 7.6 26 7.4 23 8.8 ' +
      'C20.3 10 18 12.5 17 16.5 C16.2 20 16.6 24 18 27.5 ' +
      'C19.2 30.5 20.3 32.5 22 34 L38 34.3 C40.3 32 41.8 28.5 42.6 24 ' +
      'C43.4 19.5 43.5 14.5 43.5 10.5 C43.5 9.2 43.3 8 43 7 Z',
    roots: [
      'M26.5 34 C27.8 46 29.3 58.5 31 69.5 C31.3 70.4 31.7 70.4 32 69.5 ' +
        'C33.7 58.5 35.2 46 37.5 34 C35.5 32.3 28.5 32.3 26.5 34 Z',
    ],
    surface: 'M23 9.5 V16 M32 6.5 V14 M40 8 V15',
    cervical: 'M20 33.5 C25 35.8 36 35.8 41 32.5',
    widthRatio: 1.0,
    sideStrategy: 'mirror',
    simplification:
      'Mamelon ridges simplified to three short straight grooves rather ' +
      'than the real, subtly curved developmental lobes; the root apex is ' +
      'drawn with a small rounded cap rather than a mathematically sharp ' +
      'point.',
  },

  // Same distal/mesial contour logic as the central, but smaller and more
  // rounded overall, as a lateral incisor genuinely is.
  'permanent:upper:lateral_incisor': {
    crown:
      'M40 8 C37.5 6.5 33.5 6.3 31 7.5 C28.5 8.6 25.5 8.4 23 10 ' +
      'C20.8 11.4 19.3 13.8 19 17 C18.7 20 19.3 23.3 20.6 26.5 ' +
      'C21.6 28.8 22.5 30.5 24 32 L35.5 32.3 C37.4 30.2 38.6 27.2 39.3 23.3 ' +
      'C40 19.5 40.2 15 40.2 11.3 C40.2 10.1 40.1 9 40 8 Z',
    roots: [
      'M25 32 C26.2 42 28 53 30 63 C30.3 63.8 30.7 63.8 31 63 ' +
        'C33 53 34.8 42 35 32 C33 30.6 27 30.6 25 32 Z',
    ],
    surface: 'M24 11 L24 17 M31 7.5 V14.5 M37 10 L37 16',
    cervical: 'M22.5 31.5 C27 33.6 33.5 33.6 37.5 30.8',
    widthRatio: 0.78,
    sideStrategy: 'mirror',
    simplification:
      'Root tapers smoothly toward the apex but on an essentially straight ' +
      'axis; the slight distal curvature real lateral incisor roots often ' +
      'show near the apex is not modelled, and the apex itself is capped ' +
      'slightly rounded rather than a sharp point.',
  },

  // Cusp tip displaced mesially (x=36, off the x=32 crown midline). Mesial
  // slope (tip to x=44) is spatially shorter than the distal slope (tip to
  // x=18), matching the brief. Root apex leans distally (toward small x) —
  // the longest root in the arch.
  'permanent:upper:canine': {
    crown:
      'M36 5 C38.3 6.3 41 10.5 42.3 15.5 C43.3 19.5 43.3 24.5 42.7 29 ' +
      'C42.2 32.3 41.2 34.3 40 35.2 L23 35.2 C21 33.3 19.5 30 18.8 26 ' +
      'C18 21.5 18.3 16.5 20.3 12.3 C22.5 7.8 29 5.3 36 5 Z',
    roots: [
      'M24 35 C25.5 50 27 65 28.5 78.3 C28.8 79.2 29.2 79.2 29.5 78.3 ' +
        'C31.5 65 33.5 50 36 35 C33.5 33 26.5 33 24 35 Z',
    ],
    surface: 'M36 5 V15 M27 11 L36 5 L40 14',
    cervical: 'M21 34.3 C26.5 36.8 38.5 36.8 41 32.8',
    widthRatio: 0.89,
    sideStrategy: 'mirror',
    simplification:
      'Root apex is drawn with a small rounded cap rather than tapering to ' +
      'an anatomically fine point, so it reads as rounded rather than ' +
      'spiky at chart size.',
  },

  // The task calls this one out explicitly: bifurcated (buccal + palatal)
  // roots, palatal first. Angular mesial marginal-ridge notch (the zig-zag
  // at the bottom of the crown, mesial/large-x side) stands in for the
  // developmental groove that crosses onto the root.
  'permanent:upper:first_premolar': {
    crown:
      'M41.8 22 C41.6 16.5 39 12 35.3 10.2 C33.4 9.3 32.3 10.4 32 13 ' +
      'C31.7 10.4 30 9.2 28 10.1 C24.2 11.8 21.1 16.3 20.2 22 ' +
      'C19.5 26.3 19.7 30.3 20.9 33.7 C21.9 36.5 23.5 38.4 25.5 39.2 ' +
      'L30 38.6 L32.5 36.5 L35 38.6 L38.5 39.4 C40.2 38.2 41.2 35.7 41.7 32 ' +
      'C42.2 28.7 42.1 25 41.8 22 Z',
    roots: [
      // palatal — centred, tallest, drawn first so the buccal root overpaints it
      'M28 38.5 L36 38.5 C36.7 45 36.2 52.5 34.5 59.5 C33.6 63.3 32.6 65.7 32 66.3 ' +
        'C31.4 65.7 30.4 63.3 29.5 59.5 C27.8 52.5 27.3 45 28 38.5 Z',
      // buccal — shorter, offset, forms the visible bifurcation
      'M25 38.5 C22.5 43.5 21 49 21.8 55 C22.3 58.8 23.6 61.5 25.2 62.3 ' +
        'C26.8 61.5 27.9 58.8 28.1 55 C28.5 49 27.7 43.5 25.8 38.5 Z',
    ],
    surface:
      'M32 13 V19 M28 10.5 L32 13 L35.3 10.5 M37.5 34 C37.7 38 37 42 36.5 46',
    cervical: 'M21 37.5 C25 40.3 39 40.3 41 35.5',
    widthRatio: 0.83,
    sideStrategy: 'mirror',
    simplification:
      'Buccal and palatal roots drawn as a simple two-root V rather than a ' +
      'shared root trunk that bifurcates partway down, and the mesial ' +
      'marginal developmental groove is a single line rather than a true ' +
      'fissure.',
  },

  // Single root, mesial outline deliberately smoother/rounder than the first
  // premolar's — the second premolar genuinely has less mesiodistal
  // asymmetry, but still real asymmetry, so 'mirror' is still correct.
  'permanent:upper:second_premolar': {
    crown:
      'M41 22 C40.6 16.5 38 12.3 34.5 10.5 C33 9.7 32.2 10.5 32 12.8 ' +
      'C31.8 10.5 31 9.7 29.5 10.5 C26 12.3 23.2 16.5 22.6 22 ' +
      'C22 26.5 22.3 30.7 23.5 34 C24.6 37 26.3 38.9 28.5 39.4 ' +
      'L35.5 39.2 C37.6 38.6 39.2 36.6 40.2 33.5 C41.3 30.2 41.5 26.2 41 22 Z',
    roots: [
      'M25.5 38.7 C24.3 46 24.5 54.5 26.5 62 C27.7 66.3 29.3 69 30.7 69.6 ' +
        'C32 69 33.4 66.3 34.4 62 C36.2 54.5 36.3 46 35 38.7 Z',
    ],
    surface: 'M32 12.8 V20 M28.5 11 L32 12.8 L35 11',
    cervical: 'M23.5 38 C27.5 40.5 37 40.5 39.5 36.5',
    widthRatio: 0.83,
    sideStrategy: 'mirror',
    simplification:
      'Mesial and distal outlines drawn with only mild asymmetry, matching ' +
      'this tooth genuinely being more symmetric than the first premolar; ' +
      'no mesial developmental groove is shown since it is not a defining ' +
      'feature here.',
  },

  // Three roots, palatal first. Mesial (large-x) crown contour drawn
  // straighter, distal (small-x) more rounded/bulging. Root apices drift
  // toward smaller x than their crown bases — the classic distally-inclined
  // "leaning back" molar.
  'permanent:upper:first_molar': {
    crown:
      'M47 24 C46.7 18 44 13.5 40.5 11.5 C38.2 10.2 36.5 11 35.8 13.3 ' +
      'C35 16 33.5 17.3 32 17.3 C30.5 17.3 29 16 28.2 13.3 ' +
      'C27.4 10.6 25 9.7 22 11.3 C18 13.4 15.3 18 15 24 ' +
      'C14.8 28.5 15.5 32.7 17 36 C18.5 39 20.7 40.6 23.5 40.9 L40 40.6 ' +
      'C43 40 45.3 38 46.3 34.5 C47.3 31 47.3 27.3 47 24 Z',
    roots: [
      // palatal — centred, apex drifts distal
      'M28 40 L36 40 C36.9 47.5 36.3 56 34.3 64 C33.4 68.2 31.8 71 30.3 71.3 ' +
        'C28.9 71 27.6 68.2 27 64 C25.8 56 25.9 47.5 28 40 Z',
      // mesiobuccal — base mesial (large x), apex leans distal
      'M37 40.5 C40 46 41 52.5 39.5 59 C38.6 63 36.5 66 34.3 65.5 ' +
        'C32.3 65 30.8 61.5 30.3 57 C29.7 51 31.5 45 34.5 40.5 Z',
      // distobuccal — base distal (small x), shorter/straighter
      'M20 40.5 C17 46 15.8 51.5 17 57 C17.7 60.3 19.3 62.5 21 62 ' +
        'C22.7 61.5 23.7 58.5 23.6 54.5 C23.5 49 22.3 44 20.8 40.5 Z',
    ],
    surface: 'M22 13 L24.5 19 M40.5 13 L38 19 M32 17.3 V25 M28 17 L32 20.5 L36 17',
    cervical: 'M17 39 C24 42 40 42 45 37.5',
    widthRatio: 1.19,
    sideStrategy: 'mirror',
    simplification:
      'Three roots drawn as a stylised trifurcation (palatal centred, ' +
      'mesiobuccal/distobuccal divergent) rather than a true tapering root ' +
      'trunk; individual buccal/palatal occlusal cusps are only hinted at ' +
      'through the surface ridge lines, not separately outlined.',
  },

  // Same trifurcated logic, slightly smaller, roots drawn closer together —
  // second molar roots are commonly closer/more nearly fused than the
  // first's.
  'permanent:upper:second_molar': {
    crown:
      'M45.5 25 C45.2 19.3 42.7 15 39.5 13 C37.4 11.7 35.8 12.5 35.1 14.7 ' +
      'C34.3 17 33 18.2 32 18.2 C31 18.2 29.7 17 28.9 14.7 ' +
      'C28.2 12.4 26 11.6 23.5 13.2 C20 15.4 17.6 19.6 17.2 25 ' +
      'C17 29 17.6 32.8 19 35.8 C20.4 38.5 22.5 40 25 40.3 L39 40 ' +
      'C41.7 39.4 43.8 37.5 44.7 34.2 C45.6 31 45.8 27.7 45.5 25 Z',
    roots: [
      'M28.5 39.7 L35.5 39.7 C36.2 46.5 35.8 54 34.3 60.7 ' +
        'C33.5 64.3 32.2 66.7 31 67 C29.8 66.7 28.6 64.3 27.8 60.7 ' +
        'C26.3 54 26 46.5 28.5 39.7 Z',
      'M36 40 C38.3 45 39.2 50.5 38 56 C37.2 59.6 35.4 62 33.6 61.5 ' +
        'C32 61 31.2 58 31.3 54 C31.4 48.5 33 43.5 35 40 Z',
      'M20.5 40 C18 45 17 50 18 55 C18.6 58.3 20.1 60.3 21.7 59.8 ' +
        'C23.2 59.3 24 56.5 23.9 53 C23.7 48 22.5 43.5 21 40 Z',
    ],
    surface: 'M23.5 14.5 L26 20 M40 14.5 L37.5 20 M32 18.2 V26 M28.5 18 L32 21.3 L35.5 18',
    cervical: 'M18.5 39.5 C25 42.3 39 42.3 44 38',
    widthRatio: 1.13,
    sideStrategy: 'mirror',
    simplification:
      "Second molar's three roots drawn shorter and closer together than " +
      "the first molar's to reflect their common proximity/near-fusion, " +
      'but true partial root fusion (frequent in this tooth) is not ' +
      'modelled as a single fused mass.',
  },

  // Visibly smaller and more irregular, per the brief. Kept at 3 roots
  // (rather than the anatomically-variable 2-4) so upper-molar root count
  // stays consistent, but drawn compact/tightly fused rather than splayed.
  'permanent:upper:third_molar': {
    crown:
      'M43.5 27 C43.2 21.5 40.8 17.5 37.8 15.7 C35.9 14.6 34.5 15.4 33.8 17.3 ' +
      'C33.1 19 32.3 19.6 31.8 19.6 C31 19.6 30 18.8 29.3 16.8 ' +
      'C28.5 14.6 26.5 14 24.3 15.5 C21.2 17.6 19 21.7 18.7 27 ' +
      'C18.5 30.5 19 33.8 20.2 36.3 C21.4 38.6 23.2 39.9 25.3 40.1 L38 39.8 ' +
      'C40.3 39.2 42 37.4 42.8 34.5 C43.6 31.7 43.7 29.2 43.5 27 Z',
    roots: [
      'M28.5 39.5 L35 39.5 C35.6 44.5 35.1 49.7 33.6 54.3 ' +
        'C32.9 56.5 32 57.5 31.7 57.5 C31.4 57.5 30.6 56.5 30 54.3 ' +
        'C28.6 49.7 28 44.5 28.5 39.5 Z',
      'M35.5 40 C37.3 44 37.8 47.7 36.7 51.3 C36.1 53.3 34.8 54.5 33.6 54 ' +
        'C32.5 53.5 32 51.3 32.3 48.5 C32.7 45 34 42 35.5 40 Z',
      'M23 40 C21.3 44 20.9 47.7 22 51 C22.7 53 23.9 54.2 25.1 53.7 ' +
        'C26.3 53.2 26.8 51 26.5 48.3 C26.1 45 24.7 42 23 40 Z',
    ],
    surface: 'M24.5 16 L27 21 M38 16 L35.5 21 M31.8 19.6 V26',
    cervical: 'M20 38.5 C26 41 38 41 42 37',
    widthRatio: 1.06,
    sideStrategy: 'mirror',
    simplification:
      'Root complex drawn as a compact, largely fused three-root mass ' +
      'rather than the highly variable 2-4 root morphology real third ' +
      'molars show; the crown outline is deliberately more irregular than ' +
      'the other molars but still schematic.',
  },

  // ── PERMANENT LOWER ───────────────────────────────────────────────────

  // Narrowest tooth in the arch and the most nearly symmetric — but genuine
  // (small) asymmetry is still drawn so mirroring stays meaningful.
  'permanent:lower:central_incisor': {
    crown:
      'M38 9 C36 7.8 32.5 7.6 30.5 8.5 C28.5 9.3 26.3 9.2 25 10.5 ' +
      'C23.8 11.6 23 13.5 23 16 C23 18.7 23.7 21.3 25 24 ' +
      'C25.9 26 26.7 28 27.8 29.5 L36.5 30 C37.5 28.3 38.2 25.8 38.6 22.5 ' +
      'C39 19 39.1 15.3 38.9 12.3 C38.8 11 38.5 9.9 38 9 Z',
    roots: [
      'M27 30 C27.9 38 29 47 30.2 55.6 C30.5 56.3 30.9 56.3 31.2 55.6 ' +
        'C32.9 47 34 38 34.5 30 C32.7 28.8 28.8 28.8 27 30 Z',
    ],
    surface: 'M26.5 10.5 L37 10 M30.5 8.5 V13.5 M34.5 9.3 V13.7',
    cervical: 'M24.5 29.3 C28.5 31.3 34 31.3 37.5 28.5',
    widthRatio: 0.63,
    sideStrategy: 'mirror',
    simplification:
      'Drawn with only mild mesiodistal asymmetry, matching this tooth ' +
      'genuinely being the most nearly symmetric in the arch; a fully ' +
      'symmetric silhouette was deliberately avoided so left/right ' +
      'mirroring stays meaningful at chart scale. Narrowest root in the ' +
      'arch, drawn with a straight-axis taper and a small rounded apex cap ' +
      'rather than a true fine point.',
  },

  'permanent:lower:lateral_incisor': {
    crown:
      'M39.5 9 C37.3 7.7 33.5 7.5 31.3 8.5 C29 9.4 26.5 9.4 25 11 ' +
      'C23.6 12.4 22.8 14.5 22.9 17.3 C23 20.3 23.9 23.3 25.5 26.3 ' +
      'C26.6 28.3 27.5 30 28.5 31 L37 31.3 C38.2 29.4 39 26.7 39.5 23.3 ' +
      'C40 19.8 40.1 15.8 39.9 12.5 C39.8 11.1 39.6 9.9 39.5 9 Z',
    roots: [
      'M26.5 31 C27.7 40 29 50 30.2 59.6 C30.5 60.3 30.9 60.3 31.2 59.6 ' +
        'C32.9 50 34.3 40 35.5 31 C33.5 29.6 28.5 29.6 26.5 31 Z',
    ],
    surface: 'M26 11.5 L38.5 11 M31 8.5 V13.7 M35.5 9.3 V14',
    cervical: 'M24.5 30.3 C29 32.5 34.5 32.5 38.5 29',
    widthRatio: 0.69,
    sideStrategy: 'mirror',
    simplification:
      "Real lower lateral incisors often show a slight distal twist of the " +
      "incisal edge relative to the root axis; that rotation is not " +
      'modelled, only mesiodistal contour and proportion. Root taper is ' +
      'drawn on a straight axis with a small rounded apex cap rather than ' +
      'a true fine point.',
  },

  // Cusp displaced mesially (x=34), short mesial slope / long distal slope,
  // long root whose apex drifts distal — narrower version of the upper
  // canine's asymmetry.
  'permanent:lower:canine': {
    crown:
      'M34.5 6 C36.7 7.3 39.3 11.3 40.3 15.8 C41.1 19.5 41 24 40.2 28 ' +
      'C39.7 30.7 38.8 32.4 37.7 33.2 L23 33.2 C21.1 31.4 19.7 28.3 19 24.5 ' +
      'C18.2 20.3 18.5 15.7 20.5 11.8 C22.6 7.7 28.7 6.2 34.5 6 Z',
    roots: [
      'M23 33 C24.3 47 26 60 27.8 72.3 C28.1 73.2 28.9 73.2 29.2 72.3 ' +
        'C31 60 32.7 47 35 33 C32.5 31.3 25.5 31.3 23 33 Z',
    ],
    surface: 'M34.5 6 V15 M26.5 10.5 L34.5 6 L38 13.5',
    cervical: 'M20.5 32.3 C26 34.6 35.5 34.6 38.5 30.8',
    widthRatio: 0.85,
    sideStrategy: 'mirror',
    simplification:
      'Root apex is capped slightly rounded rather than tapering to a ' +
      'true fine point, and its axis is drawn straight rather than with ' +
      'the mid-root mesial curvature some mandibular canine roots show.',
  },

  // Single root. Dominant buccal cusp (x=33) with only a hinted, much
  // smaller lingual cusp (x=27) — the lower first premolar's most
  // distinctive lateral-view trait.
  'permanent:lower:first_premolar': {
    crown:
      'M40.5 22 C40.2 16.5 37.5 12 34 10.5 C32.8 10 32.2 11 32 13.5 ' +
      'C31.8 14.7 31 15.3 30 15 C28.5 14.5 27.7 13 27.2 11.5 ' +
      'C25 12 22.5 15.7 21.3 20.5 C20.3 24.5 20.3 28.7 21.3 32.3 ' +
      'C22.3 35.7 24 38 26.3 39 L36 38.7 C38.2 37.5 39.7 34.7 40.3 31 ' +
      'C40.9 27.7 40.8 24.5 40.5 22 Z',
    roots: [
      'M24.5 38.7 C23.3 46 23.5 54.5 25.5 62.5 C26.7 67 28.3 70 30 70.7 ' +
        'C31.6 70 33.2 67 34.3 62.5 C36.1 54.5 36.2 46 34.8 38.7 Z',
    ],
    surface: 'M32 13.5 V20 M28 14 L32 13.5',
    cervical: 'M22.5 38 C27 40.5 35.5 40.5 39 36.5',
    widthRatio: 0.85,
    sideStrategy: 'mirror',
    simplification:
      'Lingual cusp is hinted at only as a small secondary bump in the ' +
      'occlusal outline rather than fully modelled, since it is barely ' +
      'visible from a pure buccal aspect.',
  },

  'permanent:lower:second_premolar': {
    crown:
      'M41 23 C40.7 17 38 12.5 34.3 11 C32.9 10.4 32.1 11.4 31.9 13.8 ' +
      'C31.7 15.3 31 16 30 15.8 C28.7 15.5 27.8 14.2 27.2 12.5 ' +
      'C24.7 13.3 22 17 20.8 22 C19.9 25.8 20 29.8 21 33.2 ' +
      'C22 36.5 23.8 38.8 26.2 39.6 L36.3 39.3 C38.5 38 40 35 40.6 31 ' +
      'C41.2 28 41.2 25.3 41 23 Z',
    roots: [
      'M25 39 C23.7 46.5 24 55 26.2 63 C27.5 67.5 29.2 70.5 31 71 ' +
        'C32.7 70.5 34.4 67.5 35.5 63 C37.4 55 37.5 46.5 36 39 Z',
    ],
    surface: 'M31.9 13.8 V20.5 M27.5 13 L31.9 13.8 L35 12.3 M28 22 L36 22',
    cervical: 'M23 38.5 C28 41 34.5 41 39.3 37',
    widthRatio: 0.89,
    sideStrategy: 'mirror',
    simplification:
      'The true three-cusp (two-lingual) variant seen in a minority of ' +
      'lower second premolars is not modelled; only the common two-cusp ' +
      'form is drawn.',
  },

  // Widest tooth in the mouth. Mesial (large-x) contour straighter, distal
  // more rounded. Two roots: mesial broader, apex curves distally; distal
  // narrower and more vertical.
  'permanent:lower:first_molar': {
    crown:
      'M50 25 C49.6 19 46.7 14.3 43 12.3 C40.5 11 38.5 12 37.7 14.5 ' +
      'C36.8 17.3 34.7 18.7 32 18.7 C29.5 18.7 27.3 17.2 26.3 14.3 ' +
      'C25.3 11.5 22.8 10.6 20 12.2 C16 14.5 13 19.3 12.5 25 ' +
      'C12.1 29.5 12.8 33.7 14.3 37 C15.8 40 18.2 41.6 21 41.9 L40 41.5 ' +
      'C43.5 40.8 46.2 38.5 47.5 34.8 C48.8 31 49 27.7 50 25 Z',
    roots: [
      // mesial — broad, apex curves distally (toward smaller x than its base)
      'M42 41.3 C44.5 46.5 45 52.5 43 58.5 C41.5 63 38.5 66.7 35.3 67.5 ' +
        'C32.7 66.8 31 63.5 30.6 59 C30 52.5 31.8 46 35 41.3 Z',
      'M22 41.5 C19.5 47 18.7 53 20 58.5 C20.8 62 22.7 64.7 24.8 65 ' +
        'C26.8 64.5 27.9 61.5 27.7 57.5 C27.4 51.5 25.5 46 22.8 41.5 Z',
    ],
    surface: 'M20.5 14.5 L23.5 20 M43.5 14.5 L40.5 20 M32 18.7 V27 M27 19 L32 23 L37 19',
    cervical: 'M14 40 C22 43 42 43 48 38.5',
    widthRatio: 1.31,
    sideStrategy: 'mirror',
    simplification:
      "The mesial root's classic distal curvature is exaggerated slightly " +
      'for legibility at chart size; the two-root trunk is drawn fully ' +
      'separate rather than partially fused near the cervix, which is ' +
      'common in real specimens.',
  },

  // Same layout, smaller, roots drawn closer/more parallel — second molar
  // roots are commonly closer to fused than the first's.
  'permanent:lower:second_molar': {
    crown:
      'M48 26 C47.6 20.3 44.8 15.8 41.3 13.8 C39 12.5 37.1 13.4 36.2 15.8 ' +
      'C35.3 18.3 33.7 19.5 32 19.5 C30.3 19.5 28.7 18.2 27.8 15.8 ' +
      'C26.9 13.3 24.6 12.4 22.2 13.9 C18.6 16 15.8 20.5 15.3 26 ' +
      'C15 30 15.6 33.8 17 36.8 C18.4 39.6 20.6 41.2 23.2 41.5 L39 41.1 ' +
      'C42.2 40.4 44.6 38.2 45.9 34.8 C47.2 31.3 47.7 28.5 48 26 Z',
    roots: [
      'M40 41.2 C42 46 42.3 51 40.8 56 C39.8 59.5 37.5 62.3 34.8 62.8 ' +
        'C32.7 62.2 31.3 59.5 31.2 56 C31 50.5 32.5 45 35 41.2 Z',
      'M23.5 41.5 C21.3 46 20.8 51 22.2 55.7 C23.1 58.8 25.2 61.2 27.5 61.5 ' +
        'C29.5 61 30.5 58.5 30.3 55.2 C30 50 28.3 45 25.8 41.5 Z',
    ],
    surface: 'M22.5 15.5 L25.5 21 M41.5 15.5 L38.5 21 M32 19.5 V27.5 M27.5 19.7 L32 24 L36.5 19.7',
    cervical: 'M17 40 C24 43 40 43 46 38.5',
    widthRatio: 1.25,
    sideStrategy: 'mirror',
    simplification:
      "Roots drawn closer together than the first molar's to reflect their " +
      'common near-fusion, but a true single fused C-shaped root — a ' +
      'frequent finding, especially in the mandibular second molar — is ' +
      'not modelled.',
  },

  // Smaller, more irregular/crowded crown outline; two short, closely-fused
  // tapering roots.
  'permanent:lower:third_molar': {
    crown:
      'M44.5 27.5 C44.1 22 41.5 17.8 38.2 15.8 C36.1 14.5 34.3 15.4 33.4 17.7 ' +
      'C32.6 19.8 31.3 21 30 20.7 C28.5 20.3 27.3 18.7 26.6 16.3 ' +
      'C25.7 13.7 23.3 13 21.1 14.7 C17.9 17.1 15.5 21.5 15.1 26.8 ' +
      'C14.8 30.5 15.4 34 16.8 36.8 C18.2 39.3 20.3 40.8 22.7 41.1 L37.5 40.6 ' +
      'C40.3 39.9 42.4 37.8 43.5 34.7 C44.6 31.5 44.9 29.2 44.5 27.5 Z',
    roots: [
      'M36.5 40.8 C38.3 44.5 38.6 48.3 37.2 52 C36.3 54.5 34.3 56.5 32.3 56.7 ' +
        'C30.7 56.2 29.7 54 29.7 51 C29.7 47 31.2 43.3 33.5 40.8 Z',
      'M23 41 C21.2 44.5 20.8 48.3 22 51.7 C22.8 54 24.6 55.8 26.4 55.9 ' +
        'C27.9 55.4 28.8 53.3 28.7 50.5 C28.5 46.7 27 43.2 25 41 Z',
    ],
    surface: 'M21.5 16.5 L24 21.5 M38 16.5 L35.5 21.5 M30 20.7 V27 M26.5 21 L30 25 L34 21',
    cervical: 'M16.5 40 C22.5 42.5 38 42.5 43 38',
    widthRatio: 1.19,
    sideStrategy: 'mirror',
    simplification:
      'Crown outline exaggerates crowding/irregularity for visual ' +
      'identification; the two roots are drawn short and closely ' +
      'fused-tapering rather than modelling the highly variable root count ' +
      'and fusion patterns real mandibular third molars show.',
  },

  // ── PRIMARY UPPER ─────────────────────────────────────────────────────
  //
  // Every primary crown below carries the two cues that read as "primary"
  // at a glance: a bulbous crown that narrows sharply just above the
  // cervical line (pronounced cervical constriction), and a visibly shorter
  // root than the permanent equivalent. Primary molars additionally splay
  // their roots wide (markedly divergent) to straddle the developing
  // permanent premolar.

  'primary:upper:central_incisor': {
    crown:
      'M41 8.5 C40.8 7 38.5 6.3 35.5 6.5 L29 6.8 C25.8 7.2 23.5 8.5 22.7 11 ' +
      'C21.9 13.5 22.3 16.3 23.5 19 C24.2 20.6 24.5 22.2 25.5 23.5 ' +
      'C26.6 25 27.9 26.2 29.5 26.7 L37.5 26.5 C39 25.8 40.1 24.3 40.9 22.3 ' +
      'C41.7 20.2 42.1 17.7 42.1 15 C42.1 12.5 41.7 10.2 41 8.5 Z',
    roots: [
      'M25.5 27 C26.8 35 28.3 43 30 50.6 C30.3 51.3 30.7 51.3 31 50.6 ' +
        'C32.7 43 34.5 35 36.5 27 C34 25.6 28 25.6 25.5 27 Z',
    ],
    surface: 'M25 12 L38 11.5 M29 7.5 V13 M35.5 7.3 V13.3',
    cervical: 'M23 26.3 C27.5 28.5 34.5 28.5 40 25',
    widthRatio: 0.79,
    sideStrategy: 'mirror',
    simplification:
      'Cervical constriction is exaggerated beyond real proportions so it ' +
      'reads clearly at chart size; mamelon ridges are simplified to two ' +
      'straight grooves; the root apex is capped slightly rounded rather ' +
      'than a true point.',
  },

  'primary:upper:lateral_incisor': {
    crown:
      'M37.5 8.5 C37.3 7 35.3 6.3 32.7 6.5 L27.5 6.8 C24.8 7.2 22.8 8.5 22.1 10.8 ' +
      'C21.4 13 21.8 15.5 22.8 18 C23.4 19.5 23.7 21 24.6 22.2 ' +
      'C25.6 23.6 26.7 24.6 28.1 25.1 L34.9 24.9 C36.2 24.3 37.1 23 37.8 21.2 ' +
      'C38.5 19.3 38.8 17 38.8 14.6 C38.8 12.4 38.4 10.3 37.5 8.5 Z',
    roots: [
      'M25.5 26 C26.6 32.7 28 39.7 29.3 46.6 C29.6 47.2 30 47.2 30.3 46.6 ' +
        'C31.7 39.7 33.2 32.7 34.5 26 C32.3 24.7 27.7 24.7 25.5 26 Z',
    ],
    surface: 'M25 11.5 L34.5 11 M27.7 7.3 V12 M32.7 7.1 V12.3',
    cervical: 'M23 25.3 C27 27.3 32 27.3 36.3 24',
    widthRatio: 0.66,
    sideStrategy: 'mirror',
    simplification:
      'Root apex drawn with a small rounded cap rather than the slight ' +
      'curvature real primary lateral incisor roots often show near a ' +
      'genuinely fine tip.',
  },

  'primary:upper:canine': {
    crown:
      'M34.5 6.5 C36.5 7.7 38.7 10.5 39.7 13.5 C40.5 15.9 40.6 18.2 40 20.3 ' +
      'C39.4 19.2 38.3 18.7 37.2 19.4 C36 20.2 36 22.2 36.9 24.3 ' +
      'C37.5 25.7 37.4 26.9 36.6 27.7 C35.6 28.6 34.2 29 32.7 29.1 L24.5 28.9 ' +
      'C23 28.5 22 27.4 21.5 25.7 C21 24 21.3 22.3 22.3 21.1 ' +
      'C21.2 20.4 20.5 19 20.9 17 C21.5 14.3 23.3 11.5 25.7 9.7 ' +
      'C28.1 7.9 31.7 6.7 34.5 6.5 Z',
    roots: [
      'M22.5 28 C23.7 39 25.2 50 27 59.4 C27.3 60.1 27.7 60.1 28 59.4 ' +
        'C29.8 50 31.3 39 34.5 28 C31.5 26.4 25.5 26.4 22.5 28 Z',
    ],
    surface: 'M34.5 6.5 V15 M27 10.5 L34.5 6.5 L37.5 13.5',
    cervical: 'M21 27.3 C26 29.5 33 29.5 39 25.8',
    widthRatio: 0.85,
    sideStrategy: 'mirror',
    simplification:
      'Root apex is capped slightly rounded rather than tapering to a ' +
      'true fine point.',
  },

  // Three roots, palatal first, splayed markedly wide.
  'primary:upper:first_molar': {
    crown:
      'M45 19 C44.8 13.8 41.5 10 37 9.3 C34.8 9 33.3 10.5 32.7 12.8 ' +
      'C32.3 14.3 32 14.5 32 14.5 C32 14.5 31.7 14.3 31.3 12.8 ' +
      'C30.7 10.5 29.2 8.9 27 9.2 C22.5 9.9 19.2 13.8 19 19 ' +
      'C18.8 22.7 19.8 26 21.7 28.5 C22.4 26.3 23.8 25.2 25.5 25.7 ' +
      'C27.3 26.2 27.7 28.5 26.7 31 C26.1 32.5 26.2 33.7 27.1 34.4 ' +
      'C28.2 33.7 29.4 33.3 30.7 33.4 L33.3 33.4 C34.6 33.3 35.8 33.7 36.9 34.4 ' +
      'C37.8 33.7 37.9 32.5 37.3 31 C36.3 28.5 36.7 26.2 38.5 25.7 ' +
      'C40.2 25.2 41.6 26.3 42.3 28.5 C44.2 26 45.2 22.7 45 19 Z',
    roots: [
      'M29 33.7 L35 33.7 C35.7 39 35.3 44.5 34 49.5 C33.3 52 32.4 53.3 32 53.3 ' +
        'C31.6 53.3 30.7 52 30 49.5 C28.7 44.5 28.3 39 29 33.7 Z',
      'M35.5 34 C38.5 38.5 41.5 43 42.5 48 C43 50.5 42 52.5 40.3 52.3 ' +
        'C38.7 51.8 37.5 49 36.8 45.5 C36 41.5 35.5 37.5 35.5 34 Z',
      'M28.5 34 C25.5 38.5 22.5 43 21.5 48 C21 50.5 22 52.5 23.7 52.3 ' +
        'C25.3 51.8 26.5 49 27.2 45.5 C28 41.5 28.5 37.5 28.5 34 Z',
    ],
    surface: 'M23 15 L26 20 M41 15 L38 20 M32 14.5 V22 M28 21 L32 24.5 L36 21',
    cervical: 'M20 33 C26 35.7 38 35.7 44 31.5',
    widthRatio: 0.9,
    sideStrategy: 'mirror',
    simplification:
      "The true primary upper first molar has an atypical, more " +
      'premolar-like occlusal cusp pattern; it is simplified here to a ' +
      'generic bulbous molar outline rather than its distinctive angular ' +
      'crown form.',
  },

  // Closely resembles a (smaller, shorter-rooted) permanent upper first
  // molar, as in real anatomy. Three roots, palatal first, markedly
  // divergent.
  'primary:upper:second_molar': {
    crown:
      'M48 21 C47.7 15 44 10.7 39 9.8 C36.5 9.3 34.7 10.7 33.9 13.2 ' +
      'C33.3 15 32.5 15.7 32 15.7 C31.5 15.7 30.7 15 30.1 13.2 ' +
      'C29.3 10.7 27.5 9.3 25 9.8 C20 10.7 16.3 15 16 21 ' +
      'C15.8 25 16.8 28.5 18.7 31.2 C19.6 28.7 21.2 27.3 23.2 27.9 ' +
      'C25.3 28.5 25.7 31 24.5 33.7 C23.8 35.3 24 36.6 25.1 37.3 ' +
      'C26.3 36.5 27.7 36 29.2 36.1 L34.8 36.1 C36.3 36 37.7 36.5 38.9 37.3 ' +
      'C40 36.6 40.2 35.3 39.5 33.7 C38.3 31 38.7 28.5 40.8 27.9 ' +
      'C42.8 27.3 44.4 28.7 45.3 31.2 C47.2 28.5 48.2 25 48 21 Z',
    roots: [
      'M29.5 36.4 L34.5 36.4 C35.3 42 34.8 48 33.4 53.3 ' +
        'C32.9 55.2 32.4 56.3 32 56.5 C31.6 56.3 31.1 55.2 30.6 53.3 ' +
        'C29.2 48 28.7 42 29.5 36.4 Z',
      'M36 36.7 C40 41 43 46 44.3 51.5 C44.9 54 44 56.2 42.2 56.2 ' +
        'C40.5 55.8 39 53 38 49 C36.9 44.5 36.2 40.5 36 36.7 Z',
      'M28 36.7 C24 41 21 46 19.7 51.5 C19.1 54 20 56.2 21.8 56.2 ' +
        'C23.5 55.8 25 53 26 49 C27.1 44.5 27.8 40.5 28 36.7 Z',
    ],
    surface: 'M25 15.5 L27.8 20.5 M39 15.5 L36.2 20.5 M32 15.7 V24 M27.5 24 L32 27.5 L36.5 24',
    cervical: 'M18 35 C25 38 39 38 46 33',
    widthRatio: 1.16,
    sideStrategy: 'mirror',
    simplification:
      'Closely resembles a permanent upper first molar in silhouette, as ' +
      'in real anatomy; its extra accessory cusps are simplified to the ' +
      'same ridge lines used for the permanent molar surface detail.',
  },

  // ── PRIMARY LOWER ─────────────────────────────────────────────────────

  'primary:lower:central_incisor': {
    crown:
      'M35.5 9.5 C35.3 8.2 33.5 7.5 31 7.6 L28 7.8 C25.6 8.1 23.8 9.2 23.2 11.1 ' +
      'C22.6 13 23 15.1 23.9 17.1 C24.4 18.3 24.7 19.5 25.5 20.4 ' +
      'C26.4 21.5 27.5 22.2 28.7 22.5 L33.5 22.3 C34.5 21.8 35.2 20.8 35.7 19.4 ' +
      'C36.2 17.9 36.4 16 36.4 14 C36.4 12.3 36.1 10.7 35.5 9.5 Z',
    roots: [
      'M27 23 C27.7 29 28.7 35 29.6 40.6 C29.9 41.1 30.1 41.1 30.4 40.6 ' +
        'C31.3 35 32.3 29 33 23 C31.3 22 28.7 22 27 23 Z',
    ],
    surface: 'M26.5 10.5 L34 10 M29 8 V12 M32.5 7.8 V12.2',
    cervical: 'M24.5 22.3 C27.5 23.9 31.5 23.9 34.5 21.3',
    widthRatio: 0.53,
    sideStrategy: 'mirror',
    simplification:
      'Smallest tooth in the arch; surface detail simplified to a single ' +
      'incisal ridge line, mamelons omitted as they are not visible at ' +
      'this scale; root apex capped slightly rounded rather than a true ' +
      'point.',
  },

  'primary:lower:lateral_incisor': {
    crown:
      'M37 9.5 C36.8 8.2 34.7 7.5 31.9 7.6 L28.5 7.8 C25.9 8.1 23.9 9.2 23.2 11.2 ' +
      'C22.5 13.1 22.9 15.3 23.9 17.4 C24.5 18.6 24.8 19.9 25.7 20.9 ' +
      'C26.6 22 27.9 22.7 29.2 23 L34.6 22.8 C35.7 22.3 36.6 21.2 37.1 19.7 ' +
      'C37.7 18.1 37.9 16.1 37.9 14 C37.9 12.2 37.6 10.6 37 9.5 Z',
    roots: [
      'M27 24 C27.9 31 29.1 37 30.5 43.6 C30.8 44.1 31.2 44.1 31.5 43.6 ' +
        'C32.9 37 34.1 31 35 24 C33 22.7 29 22.7 27 24 Z',
    ],
    surface: 'M26.5 11 L36 10.5 M29.5 8 V12.3 M34 7.8 V12.5',
    cervical: 'M24.5 23.3 C29 25.3 33.5 25.3 37.5 22.3',
    widthRatio: 0.63,
    sideStrategy: 'mirror',
    simplification:
      'Root apex drawn with a small rounded cap; only mesiodistal ' +
      'proportion and cervical constriction are otherwise modelled.',
  },

  'primary:lower:canine': {
    crown:
      'M33.5 6.5 C35.3 7.6 37.2 10.1 38.1 12.8 C38.8 15 38.9 17.1 38.3 19 ' +
      'C37.8 18 36.8 17.6 35.8 18.2 C34.7 18.9 34.7 20.7 35.5 22.6 ' +
      'C36 23.9 35.9 25 35.2 25.7 C34.3 26.5 33 26.9 31.7 27 L24.7 26.8 ' +
      'C23.4 26.4 22.5 25.4 22.1 23.9 C21.6 22.4 21.9 20.8 22.8 19.7 ' +
      'C21.8 19.1 21.2 17.8 21.5 16 C22 13.6 23.6 11.1 25.8 9.4 ' +
      'C28 7.7 31.1 6.6 33.5 6.5 Z',
    roots: [
      'M23 25 C24 34 25.5 43 27.4 51.4 C27.7 52 28.1 52 28.4 51.4 ' +
        'C30 43 31.5 34 33.5 25 C30.5 23.4 25.5 23.4 23 25 Z',
    ],
    surface: 'M33.5 6.5 V14.5 M26.5 10.5 L33.5 6.5 L36.5 13',
    cervical: 'M21.5 24.3 C26.5 26.5 32.5 26.5 38 22.8',
    widthRatio: 0.72,
    sideStrategy: 'mirror',
    simplification:
      'Root apex is capped slightly rounded rather than tapering to a ' +
      'true fine point.',
  },

  // Two roots, widely divergent — the mesiobuccal cusp bulge that makes this
  // tooth the least "adult-looking" of the primary set is simplified.
  'primary:lower:first_molar': {
    crown:
      'M46.5 21 C46.2 15.5 42.7 11.3 38 10.2 C35.3 9.6 33.3 11.3 32.7 14 ' +
      'C32.4 15.3 32 15.7 32 15.7 C32 15.7 31.4 15.2 30.7 13.5 ' +
      'C29.7 11 27.2 9.7 24 10.5 C19 11.8 15.6 16 15.3 21.5 ' +
      'C15.1 25.3 16.2 28.7 18.2 31.3 C19.3 26.5 21.5 24 24.2 24.8 ' +
      'C26.5 25.5 27.3 28.3 26.3 31.5 C25.7 33.3 25.9 34.7 27 35.4 ' +
      'C28.2 34.6 29.6 34.2 31.1 34.3 L33.6 34.3 C35 34.2 36.3 34.6 37.5 35.4 ' +
      'C38.6 34.7 38.8 33.3 38.2 31.5 C37.2 28.3 38 25.5 40.3 24.8 ' +
      'C42.5 24.1 44.4 26 45.4 29.5 C46.6 27 47 24 46.5 21 Z',
    roots: [
      'M35 34.6 C39 38.5 42 43 42.5 48 C42.8 50.7 41.7 52.7 39.9 52.5 ' +
        'C38.2 52 37 49.3 36.3 45.7 C35.5 41.7 35 37.8 35 34.6 Z',
      'M29 34.6 C25 38.5 22 43 21.5 48 C21.2 50.7 22.3 52.7 24.1 52.5 ' +
        'C25.8 52 27 49.3 27.7 45.7 C28.5 41.7 29 37.8 29 34.6 Z',
    ],
    surface: 'M22 16 L25 21 M40 16 L37 21 M32 15.7 V23.5 M27.5 23.5 L32 27 L36.5 23.5',
    cervical: 'M18.5 33.5 C25 36.3 39 36.3 45 31.5',
    widthRatio: 0.98,
    sideStrategy: 'mirror',
    simplification:
      'The distinctive mesiobuccal cusp bulge and prominent mesial ' +
      'marginal ridge of this tooth — its most atypical, least ' +
      'permanent-tooth-like feature — is simplified to a generally ' +
      'widened mesial crown outline rather than a separate cusp shape.',
  },

  // Closely resembles a (smaller, shorter-rooted) permanent lower first
  // molar, as in real anatomy. Two widely divergent roots.
  'primary:lower:second_molar': {
    crown:
      'M50 23 C49.6 17 46 12.5 41.3 11.2 C38.7 10.5 36.6 12 35.7 14.7 ' +
      'C35 16.7 33.6 17.7 32 17.7 C30.4 17.7 29 16.6 28.3 14.7 ' +
      'C27.4 12 25.3 10.5 22.7 11.2 C18 12.5 14.4 17 14 23 ' +
      'C13.7 27 14.6 30.7 16.4 33.7 C17.6 30 19.9 28 22.6 28.8 ' +
      'C24.9 29.5 25.5 32.2 24.3 35.3 C23.6 37 23.8 38.3 24.9 39 ' +
      'C26.3 38.1 27.9 37.6 29.6 37.7 L34.4 37.7 C36.1 37.6 37.7 38.1 39.1 39 ' +
      'C40.2 38.3 40.4 37 39.7 35.3 C38.5 32.2 39.1 29.5 41.4 28.8 ' +
      'C44.1 28 46.4 30 47.6 33.7 C49.4 30.7 50.3 27 50 23 Z',
    roots: [
      'M38 38 C42.5 42.5 45.5 47.5 46 53 C46.3 56 44.9 58.3 42.8 58 ' +
        'C40.8 57.4 39.3 54.3 38.3 50 C37.3 45.5 37.5 41.5 38 38 Z',
      'M26 38 C21.5 42.5 18.5 47.5 18 53 C17.7 56 19.1 58.3 21.2 58 ' +
        'C23.2 57.4 24.7 54.3 25.7 50 C26.7 45.5 26.5 41.5 26 38 Z',
    ],
    surface: 'M23 15.5 L26 21 M41 15.5 L38 21 M32 17.7 V26 M27 26 L32 29.5 L37 26',
    cervical: 'M17 37 C24.5 40 39.5 40 47 35',
    widthRatio: 1.22,
    sideStrategy: 'mirror',
    simplification:
      "This tooth's silhouette closely follows the permanent lower first " +
      'molar it precedes, as in real anatomy; occlusal groove pattern ' +
      'differences between the two teeth are not modelled at this scale.',
  },
};

export function getLateralArt(identity: ToothIdentity): LateralToothArt {
  return LATERAL_ART[anatomyKeyFor(identity)];
}

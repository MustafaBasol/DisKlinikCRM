/**
 * lateral/permanentUpper.ts — DENTAL-CHART-ASSET-R3
 *
 * One author-owned slice of the LATERAL_ART registry. Split out of the
 * single 700-line module so the R3 asset lanes can rewrite disjoint files in
 * parallel without conflicting. The orientation contract, the path-command
 * subset and the surface-tiling scheme are unchanged and are documented in
 * anatomy.types.ts and design/dental-chart/AUTHORING.md — read those before
 * touching a coordinate here.
 */

import type { PermanentUpperKey, LateralToothArt } from '../anatomy.types';

export const PERMANENT_UPPER_LATERAL: Readonly<Record<PermanentUpperKey, LateralToothArt>> = {
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
};

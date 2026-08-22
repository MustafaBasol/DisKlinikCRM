/**
 * lateral/permanentLower.ts — DENTAL-CHART-ASSET-R3
 *
 * One author-owned slice of the LATERAL_ART registry. Split out of the
 * single 700-line module so the R3 asset lanes can rewrite disjoint files in
 * parallel without conflicting. The orientation contract, the path-command
 * subset and the surface-tiling scheme are unchanged and are documented in
 * anatomy.types.ts and design/dental-chart/AUTHORING.md — read those before
 * touching a coordinate here.
 */

import type { PermanentLowerKey, LateralToothArt } from '../anatomy.types';

export const PERMANENT_LOWER_LATERAL: Readonly<Record<PermanentLowerKey, LateralToothArt>> = {

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
};

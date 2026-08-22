/**
 * lateral/permanentLower.ts — DENTAL-CHART-ASSET-R3 (Lane B rewrite)
 *
 * One author-owned slice of the LATERAL_ART registry. Split out of the
 * single 700-line module so the R3 asset lanes can rewrite disjoint files in
 * parallel without conflicting. The orientation contract, the path-command
 * subset and the surface-tiling scheme are unchanged and are documented in
 * anatomy.types.ts and design/dental-chart/AUTHORING.md — read those before
 * touching a coordinate here.
 *
 * R3 REWRITE — see permanentUpper.ts's header for the full rationale; the
 * same construction applies here: every CERVIX_Y / APEX_Y / crown-width
 * value is read verbatim from AUTHORING.md §2.1, every crown has a real
 * cervical constriction, every root holds the crown's own cervix width
 * through a 2-unit collar above CERVIX_Y before tapering to a flat
 * (2.6-3.4 unit) apex, and multi-rooted teeth (both lower molars) draw each
 * root as its own path sharing a cervical "trunk" chunk before diverging.
 */

import type { PermanentLowerKey, LateralToothArt } from '../anatomy.types';

export const PERMANENT_LOWER_LATERAL: Readonly<Record<PermanentLowerKey, LateralToothArt>> = {

  // ── PERMANENT LOWER ───────────────────────────────────────────────────

  // CERVIX_Y 30.0, APEX_Y 66.0, crown MD width 14.5 (root count 1) —
  // narrowest crown and root in the arch. Mesiodistal asymmetry is kept
  // deliberately small, matching this tooth genuinely being the most
  // nearly symmetric one, but a fully symmetric silhouette is avoided so
  // 'mirror' still produces a genuinely different left quadrant.
  'permanent:lower:central_incisor': {
    crown:
      'M27.0 4.0 L37.2 4.0 C37.2 4.0 39.6 7.0 39.7 10.8 ' +
      'C39.8 14.5 37.8 30.0 37.8 30.0 L26.8 30.0 ' +
      'C26.8 30.0 25.2 18.1 25.2 14.4 C25.2 10.7 27.0 4.0 27.0 4.0 Z',
    roots: [
      'M37.8 28.0 L37.8 30.0 L33.0 66.0 L30.4 66.0 ' +
        'L26.8 30.0 L26.8 28.0 L37.8 28.0 Z',
    ],
    surface: 'M28.5 6.0 V11.0 M32.0 5.3 V9.5 M35.5 6.3 V11.3',
    cervical: 'M26.8 29.2 C29.4 29.5 34.9 29.5 37.8 29.2',
    widthRatio: 0.59,
    sideStrategy: 'mirror',
    simplification:
      'Root apex is a flat ~2.6-unit cap rather than a true fine point, ' +
      'and its axis is drawn straight rather than with any real curvature; ' +
      'mesiodistal asymmetry is kept small on purpose, matching this being ' +
      'the most nearly symmetric tooth in the arch.',
  },

  // CERVIX_Y 31.5, APEX_Y 72.0, crown MD width 16.0 (root count 1).
  'permanent:lower:lateral_incisor': {
    crown:
      'M26.7 4.0 L37.5 4.0 C37.5 4.0 40.4 7.2 40.6 11.2 ' +
      'C40.7 15.1 38.5 31.5 38.5 31.5 L26.3 31.5 ' +
      'C26.3 31.5 24.5 19.5 24.6 15.6 C24.6 11.6 26.7 4.0 26.7 4.0 Z',
    roots: [
      'M38.5 29.5 L38.5 31.5 L33.0 72.0 L30.3 72.0 ' +
        'L26.3 31.5 L26.3 29.5 L38.5 29.5 Z',
    ],
    surface: 'M28.5 6.3 V11.3 M32.0 5.5 V10.0 M35.8 6.5 V11.8',
    cervical: 'M26.3 30.7 C29.2 31.0 35.3 31.0 38.5 30.7',
    widthRatio: 0.65,
    sideStrategy: 'mirror',
    simplification:
      'Root taper is drawn on an essentially straight axis with a flat ' +
      '~2.7-unit apex cap; the slight distal root curvature real lower ' +
      'lateral incisors sometimes show near the apex is not modelled, nor ' +
      'is the slight distal twist of the incisal edge some specimens show.',
  },

  // CERVIX_Y 36.0, APEX_Y 82.0, crown MD width 20.3 (root count 1). Same
  // mesially-displaced-cusp / short-mesial-slope / long-distal-slope /
  // distally-leaning-root logic as the upper canine, narrower.
  'permanent:lower:canine': {
    crown:
      'M37.6 4.0 C37.6 4.0 41.8 4.5 42.2 9.1 C42.5 13.7 40.0 36.0 40.0 36.0 ' +
      'L24.6 36.0 C24.6 36.0 20.0 23.3 21.9 18.7 C23.7 14.1 37.6 4.0 37.6 4.0 Z',
    roots: [
      'M40.0 34.0 L40.0 36.0 C40.0 36.0 40.0 56.2 39.0 61.3 ' +
        'C38.0 66.4 31.3 82.0 31.3 82.0 L28.3 82.0 ' +
        'C28.3 82.0 26.4 66.4 26.0 61.3 C25.6 56.2 24.6 36.0 24.6 36.0 ' +
        'L24.6 34.0 L40.0 34.0 Z',
    ],
    surface: 'M37.6 4.0 V13.5 M26.5 13.5 L37.6 4.0 L41.0 8.5',
    cervical: 'M24.6 35.2 C28.3 35.5 36.0 35.5 40.0 35.2',
    widthRatio: 0.83,
    sideStrategy: 'mirror',
    simplification:
      'Root leans distally via a single mid-root bend rather than ' +
      'continuous curvature, ending in a flat ~3-unit apex cap rather ' +
      'than a true fine point.',
  },

  // CERVIX_Y 28.5, APEX_Y 69.0, crown MD width 20.3 (root count 1).
  // Dominant buccal cusp with only a small hinted lingual cusp — the lower
  // first premolar's most distinctive lateral-view trait.
  'permanent:lower:first_premolar': {
    crown:
      'M25.6 4.0 L40.2 4.0 C40.2 4.0 43.1 15.6 43.2 18.7 ' +
      'C43.2 21.8 40.5 28.5 40.5 28.5 L25.1 28.5 ' +
      'C25.1 28.5 22.8 25.7 22.9 21.6 C22.9 17.6 25.6 4.0 25.6 4.0 Z',
    roots: [
      'M40.5 26.5 L40.5 28.5 L33.6 69.0 L30.4 69.0 ' +
        'L25.1 28.5 L25.1 26.5 L40.5 26.5 Z',
    ],
    surface: 'M32.0 8.0 V15.5 M29.0 9.5 L32.0 8.0',
    cervical: 'M25.1 27.7 C28.6 28.0 36.3 28.0 40.5 27.7',
    widthRatio: 0.83,
    sideStrategy: 'mirror',
    simplification:
      'Root apex is a flat ~3.2-unit cap; the lingual cusp is hinted only ' +
      'as a small secondary bump rather than fully modelled, since it is ' +
      'barely visible from a pure buccal aspect.',
  },

  // CERVIX_Y 27.0, APEX_Y 69.0, crown MD width 20.3 (root count 1).
  'permanent:lower:second_premolar': {
    crown:
      'M24.8 4.0 L39.8 4.0 C39.8 4.0 42.8 14.9 42.9 17.8 ' +
      'C42.9 20.7 40.2 27.0 40.2 27.0 L24.8 27.0 ' +
      'C24.8 27.0 22.6 24.4 22.6 20.6 C22.6 16.7 24.8 4.0 24.8 4.0 Z',
    roots: [
      'M40.2 25.0 L40.2 27.0 L33.7 69.0 L30.4 69.0 ' +
        'L24.8 27.0 L24.8 25.0 L40.2 25.0 Z',
    ],
    surface: 'M28.5 9.5 L32.0 8.5 L35.0 10.0 M32.0 8.5 V16.0',
    cervical: 'M24.8 26.2 C28.4 26.5 36.1 26.5 40.2 26.2',
    widthRatio: 0.83,
    sideStrategy: 'mirror',
    simplification:
      'Root apex is a flat ~3.3-unit cap; the true three-cusp (two-lingual) ' +
      'variant seen in a minority of lower second premolars is not ' +
      'modelled, only the common two-cusp form.',
  },

  // CERVIX_Y 26.0, APEX_Y 66.5, crown MD width 31.9, root count 2 — widest
  // tooth in the mouth. Mesial contour drawn straighter, distal more
  // rounded. Mesial root broader with its apex curving distally (toward
  // smaller x than its own shoulder); distal root narrower and straighter.
  'permanent:lower:first_molar': {
    crown:
      'M19.2 4.0 L44.8 4.0 C44.8 4.0 49.5 14.0 49.5 16.8 ' +
      'C49.6 19.5 45.3 26.0 45.3 26.0 L21.1 26.0 ' +
      'C21.1 26.0 18.0 23.1 17.6 19.4 C17.3 15.7 19.2 4.0 19.2 4.0 Z',
    roots: [
      // mesial — broad shoulder, apex curves distally via the furcation bend
      'M33.0 24.0 L33.0 26.0 C33.0 26.0 32.0 33.7 32.3 38.2 ' +
        'C32.5 42.7 35.0 66.5 35.0 66.5 L38.4 66.5 ' +
        'C38.4 66.5 43.8 42.7 44.6 38.2 C45.3 33.7 45.3 26.0 45.3 26.0 ' +
        'L45.3 24.0 L33.0 24.0 Z',
      // distal — narrower, straighter
      'M21.1 24.0 L21.1 26.0 C21.1 26.0 20.8 33.7 21.2 38.2 ' +
        'C21.7 42.7 25.0 66.5 25.0 66.5 L28.0 66.5 ' +
        'C28.0 66.5 30.8 42.7 31.1 38.2 C31.5 33.7 31.0 26.0 31.0 26.0 ' +
        'L31.0 24.0 L21.1 24.0 Z',
    ],
    surface:
      'M22.0 12.5 L24.5 18.0 M42.0 12.5 L39.5 18.0 M32.0 15.5 V23.0 ' +
      'M28.0 16.0 L32.0 19.5 L36.0 16.0',
    cervical: 'M21.1 25.2 C26.6 25.5 38.7 25.5 45.3 25.2',
    widthRatio: 1.3,
    sideStrategy: 'mirror',
    simplification:
      'The two roots are drawn as independently-tapering paths that share ' +
      'their cervical shoulder rather than a trunk that visibly forks; the ' +
      "mesial root's distal curvature is exaggerated slightly for " +
      'legibility at chart size, and both apices are flat caps (~3-3.4 ' +
      'units) rather than fine points.',
  },

  // CERVIX_Y 24.5, APEX_Y 62.0, crown MD width 30.5, root count 2. Same
  // layout, smaller, roots' apices drawn closer to the crown's own centre
  // than the first molar's — second-molar roots are commonly closer to
  // fused than the first's.
  'permanent:lower:second_molar': {
    crown:
      'M19.8 4.0 L44.2 4.0 C44.2 4.0 48.7 13.3 48.8 15.9 ' +
      'C48.8 18.5 44.8 24.5 44.8 24.5 L21.6 24.5 ' +
      'C21.6 24.5 18.6 21.8 18.3 18.4 C18.0 14.9 19.8 4.0 19.8 4.0 Z',
    roots: [
      'M33.0 22.5 L33.0 24.5 C33.0 24.5 32.2 31.6 32.5 35.8 ' +
        'C32.8 39.9 35.7 62.0 35.7 62.0 L38.9 62.0 ' +
        'C38.9 62.0 43.6 39.9 44.3 35.8 C44.9 31.6 44.8 24.5 44.8 24.5 ' +
        'L44.8 22.5 L33.0 22.5 Z',
      'M21.6 22.5 L21.6 24.5 C21.6 24.5 21.3 31.6 21.7 35.8 ' +
        'C22.1 39.9 25.3 62.0 25.3 62.0 L28.2 62.0 ' +
        'C28.2 62.0 30.8 39.9 31.2 35.8 C31.5 31.6 31.0 24.5 31.0 24.5 ' +
        'L31.0 22.5 L21.6 22.5 Z',
    ],
    surface:
      'M22.5 12.0 L25.0 17.0 M41.5 12.0 L39.0 17.0 M32.0 14.5 V21.5 ' +
      'M28.5 15.0 L32.0 18.0 L35.5 15.0',
    cervical: 'M21.6 23.7 C26.8 24.0 38.4 24.0 44.8 23.7',
    widthRatio: 1.24,
    sideStrategy: 'mirror',
    simplification:
      "Roots drawn closer to the crown's own centre than the first " +
      "molar's (a smaller lean) to reflect their common near-fusion, but " +
      'a true single fused C-shaped root — a frequent finding, especially ' +
      'in the mandibular second molar — is not modelled.',
  },

  // CERVIX_Y 24.5, APEX_Y 56.0, crown MD width 29.0, root count 2. Smaller,
  // more irregular/crowded crown outline; two short, closely-leaning roots.
  'permanent:lower:third_molar': {
    crown:
      'M20.4 4.0 L43.6 4.0 C43.6 4.0 47.9 13.3 48.0 15.9 ' +
      'C48.0 18.5 44.1 24.5 44.1 24.5 L22.1 24.5 ' +
      'C22.1 24.5 19.2 21.4 19.0 17.9 C18.7 14.5 20.4 4.0 20.4 4.0 Z',
    roots: [
      'M33.0 22.5 L33.0 24.5 C33.0 24.5 32.3 31.7 32.6 35.2 ' +
        'C32.9 38.7 35.8 56.0 35.8 56.0 L38.8 56.0 ' +
        'C38.8 56.0 43.1 38.7 43.7 35.2 C44.3 31.7 44.1 24.5 44.1 24.5 ' +
        'L44.1 22.5 L33.0 22.5 Z',
      'M22.1 22.5 L22.1 24.5 C22.1 24.5 21.9 31.7 22.3 35.2 ' +
        'C22.7 38.7 25.7 56.0 25.7 56.0 L28.5 56.0 ' +
        'C28.5 56.0 30.9 38.7 31.2 35.2 C31.5 31.7 31.0 24.5 31.0 24.5 ' +
        'L31.0 22.5 L22.1 22.5 Z',
    ],
    surface: 'M23.5 11.5 L25.5 16.0 M40.5 11.5 L38.5 16.0 M32.0 14.0 V19.5',
    cervical: 'M22.1 23.7 C27.1 24.0 38.1 24.0 44.1 23.7',
    widthRatio: 1.18,
    sideStrategy: 'mirror',
    simplification:
      'Crown outline is kept slightly more irregular than the other ' +
      'molars to read as a third molar at a glance; the two roots are ' +
      'drawn short and only lightly divergent rather than modelling the ' +
      'highly variable root count and fusion patterns real mandibular ' +
      'third molars show.',
  },
};

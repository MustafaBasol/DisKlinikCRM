/**
 * lateral/permanentLower.ts — DENTAL-CHART-ASSET-R3 (Lane B rewrite, rework pass)
 *
 * One author-owned slice of the LATERAL_ART registry. Split out of the
 * single 700-line module so the R3 asset lanes can rewrite disjoint files in
 * parallel without conflicting. The orientation contract, the path-command
 * subset and the surface-tiling scheme are unchanged and are documented in
 * anatomy.types.ts and design/dental-chart/AUTHORING.md — read those before
 * touching a coordinate here.
 *
 * REWORK PASS — see permanentUpper.ts's header for the full rationale: every
 * AUTHORING.md §2.1 number from the first R3 pass is unchanged, but crowns
 * are now 7-8 vertex, 100%-curve loops that visibly bow through the height
 * of contour, and roots are 12-vertex loops that taper as a continuously
 * curving cone into a small ROUNDED apex, with the crown's arrival and the
 * root's departure at the CEJ engineered to travel in the same near-
 * vertical direction. Both lower molars' mesial/distal roots now splay to
 * their widest separation around the middle third and curl their apices
 * back toward each other (a lyre/pincer), with the mesial root's curl-back
 * a large part of why the pair reads as anatomy rather than two prongs.
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
      'M27.0 4.0 C29.3 4.3 34.9 4.3 37.2 4.0 C38.3 4.6 39.5 7.3 39.7 10.8 ' +
      'C39.9 14.2 38.7 22.2 38.4 24.6 C38.2 26.8 38.0 28.1 37.8 30.0 ' +
      'C36.4 30.7 28.3 30.5 26.8 30.0 C26.6 28.5 26.4 27.4 26.2 25.6 ' +
      'C26.0 23.4 25.1 18.0 25.2 14.4 C25.4 9.0 26.5 7.1 27.0 4.0 Z',
    roots: [
      'M26.8 28.0 C26.8 28.6 26.8 28.4 26.8 30.0 C26.8 31.8 26.6 39.0 27.0 42.6 ' +
        'C27.3 46.2 28.8 52.2 29.2 55.2 C29.5 57.8 29.3 62.2 29.4 63.5 ' +
        'C29.6 64.7 30.2 65.8 30.4 66.0 C30.7 65.8 31.2 65.8 31.5 66.0 ' +
        'C31.7 65.8 32.3 64.7 32.4 63.5 C32.6 62.2 32.2 57.8 32.7 55.2 ' +
        'C33.2 52.2 35.6 46.2 36.3 42.6 C37.0 39.0 37.6 31.8 37.8 30.0 ' +
        'C38.0 28.4 37.8 28.6 37.8 28.0 C36.6 27.8 28.1 27.8 26.8 28.0 Z',
    ],
    surface: 'M28.5 6.0 V11.0 M32.0 5.3 V9.5 M35.5 6.3 V11.3',
    cervical: 'M26.8 29.2 C29.4 29.5 34.9 29.5 37.8 29.2',
    widthRatio: 0.59,
    sideStrategy: 'mirror',
    simplification:
      'Root apex is a small rounded cap about 3 units across rather than a ' +
      'true fine point; mesiodistal asymmetry is kept small on purpose, ' +
      'matching this being the most nearly symmetric tooth in the arch.',
  },

  // CERVIX_Y 31.5, APEX_Y 72.0, crown MD width 16.0 (root count 1).
  'permanent:lower:lateral_incisor': {
    crown:
      'M26.7 4.0 C29.1 4.3 35.2 4.3 37.5 4.0 C38.8 4.7 40.3 7.5 40.6 11.2 ' +
      'C40.8 14.8 39.4 23.3 39.1 25.8 C38.9 28.1 38.7 29.5 38.5 31.5 ' +
      'C36.9 32.2 27.9 32.1 26.3 31.5 C26.1 29.9 25.9 28.8 25.7 27.0 ' +
      'C25.5 24.8 24.4 19.4 24.6 15.6 C24.8 9.8 26.0 7.5 26.7 4.0 Z',
    roots: [
      'M26.3 29.5 C26.3 30.1 26.3 29.7 26.3 31.5 C26.3 33.5 26.1 41.6 26.4 45.7 ' +
        'C26.8 49.7 28.5 56.4 28.9 59.9 C29.2 62.8 29.2 68.0 29.3 69.5 ' +
        'C29.5 70.9 30.1 71.8 30.3 72.0 C30.6 71.8 31.1 71.8 31.4 72.0 ' +
        'C31.6 71.8 32.2 70.9 32.3 69.5 C32.5 68.0 32.2 62.8 32.8 59.9 ' +
        'C33.4 56.4 36.0 49.7 36.8 45.7 C37.6 41.6 38.3 33.5 38.5 31.5 ' +
        'C38.7 29.7 38.5 30.1 38.5 29.5 C37.2 29.3 27.7 29.3 26.3 29.5 Z',
    ],
    surface: 'M28.5 6.3 V11.3 M32.0 5.5 V10.0 M35.8 6.5 V11.8',
    cervical: 'M26.3 30.7 C29.2 31.0 35.3 31.0 38.5 30.7',
    widthRatio: 0.65,
    sideStrategy: 'mirror',
    simplification:
      'Root apex is a small rounded cap about 3 units across rather than a ' +
      'true fine point; the slight distal root curvature real lower lateral ' +
      'incisors sometimes show near the apex is not modelled beyond the ' +
      "tooth's own mild overall lean.",
  },

  // CERVIX_Y 36.0, APEX_Y 82.0, crown MD width 20.3 (root count 1). Same
  // mesially-displaced-cusp / short-mesial-slope / long-distal-slope /
  // distally-leaning-root logic as the upper canine, narrower.
  'permanent:lower:canine': {
    crown:
      'M37.6 4.0 C39.0 4.4 41.6 5.0 42.2 9.1 C42.7 13.2 40.9 25.1 40.6 28.5 ' +
      'C40.4 31.5 40.2 33.4 40.0 36.0 C38.0 36.9 26.6 36.6 24.6 36.0 ' +
      'C24.4 34.3 24.3 33.1 24.0 31.2 C23.6 28.7 19.6 23.2 21.9 18.7 ' +
      'C24.6 13.3 32.9 4.4 37.6 4.0 Z',
    roots: [
      'M24.6 34.0 C24.6 34.6 24.7 34.0 24.6 36.0 C24.5 38.3 23.6 47.5 23.8 52.1 ' +
        'C23.9 56.7 25.4 64.3 25.8 68.2 C26.2 71.6 26.6 77.8 26.8 79.5 ' +
        'C27.0 81.0 27.6 81.8 27.8 82.0 C28.0 81.8 28.6 81.8 28.9 82.0 ' +
        'C29.1 81.8 29.6 81.0 29.8 79.5 C30.0 77.8 29.9 71.6 30.8 68.2 ' +
        'C31.8 64.3 35.5 56.7 36.9 52.1 C38.2 47.5 39.6 38.3 40.0 36.0 ' +
        'C40.4 34.0 40.0 34.6 40.0 34.0 C38.3 33.8 26.3 33.8 24.6 34.0 Z',
    ],
    surface: 'M37.6 4.0 V13.5 M26.5 13.5 L37.6 4.0 L41.0 8.5',
    cervical: 'M24.6 35.2 C28.3 35.5 36.0 35.5 40.0 35.2',
    widthRatio: 0.83,
    sideStrategy: 'mirror',
    simplification:
      'Root leans distally continuously along its length rather than via a ' +
      'straight trunk with a curve concentrated near the apex, ending in a ' +
      'small rounded cap rather than a true fine point.',
  },

  // CERVIX_Y 28.5, APEX_Y 69.0, crown MD width 20.3 (root count 1).
  // Dominant buccal cusp with only a small hinted lingual cusp — the lower
  // first premolar's most distinctive lateral-view trait.
  'permanent:lower:first_premolar': {
    crown:
      'M25.6 4.0 C28.8 4.3 37.0 4.3 40.2 4.0 C42.7 6.1 43.0 15.6 43.2 18.7 ' +
      'C43.3 20.7 41.5 24.3 41.2 25.6 C40.9 26.6 40.7 27.5 40.5 28.5 ' +
      'C38.5 28.9 27.1 28.8 25.1 28.5 C24.8 27.8 24.6 27.2 24.4 26.4 ' +
      'C24.0 25.3 22.8 23.7 22.9 21.6 C23.1 17.2 24.8 9.3 25.6 4.0 Z',
    roots: [
      'M25.1 26.5 C25.1 27.1 25.0 26.7 25.1 28.5 C25.2 30.5 25.3 38.6 25.9 42.7 ' +
        'C26.6 46.7 29.0 53.4 29.7 56.9 C30.3 59.8 30.4 65.0 30.7 66.5 ' +
        'C30.9 67.9 31.4 68.8 31.6 69.0 C31.9 68.8 32.4 68.8 32.7 69.0 ' +
        'C32.9 68.8 33.5 67.9 33.7 66.5 C33.9 65.0 34.0 59.8 34.6 56.9 ' +
        'C35.4 53.4 38.2 46.7 39.0 42.7 C39.8 38.6 40.3 30.5 40.5 28.5 ' +
        'C40.6 26.7 40.5 27.1 40.5 26.5 C38.8 26.3 26.8 26.3 25.1 26.5 Z',
    ],
    surface: 'M32.0 8.0 V15.5 M29.0 9.5 L32.0 8.0',
    cervical: 'M25.1 27.7 C28.6 28.0 36.3 28.0 40.5 27.7',
    widthRatio: 0.83,
    sideStrategy: 'mirror',
    simplification:
      'Root apex is a small rounded cap about 3 units across; the lingual ' +
      'cusp is hinted only as a small secondary bump rather than fully ' +
      'modelled, since it is barely visible from a pure buccal aspect.',
  },

  // CERVIX_Y 27.0, APEX_Y 69.0, crown MD width 20.3 (root count 1).
  'permanent:lower:second_premolar': {
    crown:
      'M24.8 4.0 C28.1 4.3 36.5 4.3 39.8 4.0 C42.4 6.0 42.7 14.9 42.9 17.8 ' +
      'C43.0 19.6 41.3 23.1 40.9 24.2 C40.6 25.3 40.5 26.0 40.2 27.0 ' +
      'C38.2 27.3 26.9 27.2 24.8 27.0 C24.6 26.3 24.4 25.8 24.1 25.1 ' +
      'C23.8 24.0 22.5 22.5 22.6 20.6 C22.7 16.3 24.1 9.0 24.8 4.0 Z',
    roots: [
      'M24.8 25.0 C24.8 25.6 24.7 25.1 24.8 27.0 C24.9 29.1 25.0 37.5 25.7 41.7 ' +
        'C26.4 45.9 28.8 52.9 29.5 56.4 C30.1 59.5 30.2 64.9 30.4 66.5 ' +
        'C30.7 67.9 31.2 68.8 31.4 69.0 C31.7 68.8 32.2 68.8 32.5 69.0 ' +
        'C32.7 68.8 33.2 67.9 33.4 66.5 C33.7 64.9 33.7 59.5 34.4 56.4 ' +
        'C35.2 52.9 38.0 45.9 38.8 41.7 C39.6 37.5 40.1 29.1 40.2 27.0 ' +
        'C40.4 25.1 40.2 25.6 40.2 25.0 C38.5 24.8 26.6 24.8 24.8 25.0 Z',
    ],
    surface: 'M28.5 9.5 L32.0 8.5 L35.0 10.0 M32.0 8.5 V16.0',
    cervical: 'M24.8 26.2 C28.4 26.5 36.1 26.5 40.2 26.2',
    widthRatio: 0.83,
    sideStrategy: 'mirror',
    simplification:
      'Root apex is a small rounded cap about 3 units across; the true ' +
      'three-cusp (two-lingual) variant seen in a minority of lower second ' +
      'premolars is not modelled, only the common two-cusp form.',
  },

  // CERVIX_Y 26.0, APEX_Y 66.5, crown MD width 31.9, root count 2 — widest
  // tooth in the mouth. Mesial contour drawn straighter, distal more
  // rounded. The mesial root splays out further than the distal and hooks
  // sharply back toward it near the apex; the distal root stays narrower
  // and straighter — that hook is a large part of why the pair reads as
  // anatomy rather than two parallel prongs.
  'permanent:lower:first_molar': {
    crown:
      'M19.2 4.0 C24.9 4.3 39.1 4.3 44.8 4.0 C49.1 5.8 49.4 14.0 49.5 16.8 ' +
      'C49.7 18.5 46.5 22.1 46.0 23.2 C45.5 24.3 45.6 25.0 45.3 26.0 ' +
      'C42.2 26.3 24.2 26.2 21.1 26.0 C20.9 25.3 20.8 24.8 20.4 24.0 ' +
      'C19.8 22.9 17.8 21.2 17.6 19.4 C17.4 15.4 18.8 8.6 19.2 4.0 Z',
    roots: [
      // mesial — broad, splays out then hooks distally near its own apex;
      // mid-root excursion trimmed so the outer spread reads roughly the
      // crown's own MD width against the reference plates, without moving
      // the apex (the same hookFrac*leanMax as before)
      'M33.0 24.0 C33.0 24.6 32.5 24.2 33.0 26.0 C33.6 28.0 36.1 36.1 37.9 40.2 ' +
        'C39.6 44.2 44.9 50.9 45.1 54.4 C45.2 57.3 39.6 62.5 38.9 64.0 ' +
        'C38.3 65.4 39.7 66.3 39.9 66.5 C40.1 66.3 40.7 66.3 41.0 66.5 ' +
        'C41.2 66.3 41.0 65.4 41.9 64.0 C42.9 62.5 48.2 57.3 49.0 54.4 ' +
        'C49.9 50.9 48.9 44.2 48.3 40.2 C47.8 36.1 45.7 28.0 45.3 26.0 ' +
        'C45.0 24.2 45.3 24.6 45.3 24.0 C43.9 23.8 34.4 23.8 33.0 24.0 Z',
      // distal — narrower, straighter, only a mild curl back near the apex
      'M21.1 24.0 C21.1 24.6 21.4 24.2 21.1 26.0 C20.8 28.0 18.9 36.1 18.4 40.2 ' +
        'C17.9 44.2 17.3 50.9 17.6 54.4 C17.8 57.3 19.9 62.5 20.4 64.0 ' +
        'C20.8 65.4 21.2 66.3 21.4 66.5 C21.6 66.3 22.2 66.3 22.5 66.5 ' +
        'C22.7 66.3 23.6 65.4 23.4 64.0 C23.2 62.5 20.3 57.3 20.7 54.4 ' +
        'C21.2 50.9 25.3 44.2 26.8 40.2 C28.3 36.1 30.5 28.0 31.0 26.0 ' +
        'C31.5 24.2 31.0 24.6 31.0 24.0 C29.9 23.8 22.2 23.8 21.1 24.0 Z',
    ],
    surface:
      'M22.0 12.5 L24.5 18.0 M42.0 12.5 L39.5 18.0 M32.0 15.5 V23.0 ' +
      'M28.0 16.0 L32.0 19.5 L36.0 16.0',
    cervical: 'M21.1 25.2 C26.6 25.5 38.7 25.5 45.3 25.2',
    widthRatio: 1.3,
    sideStrategy: 'mirror',
    simplification:
      "The mesial root's splay-then-hook is exaggerated for legibility at " +
      'chart size versus the milder divergence most real specimens show; ' +
      'both apices are small rounded caps rather than fine points, and the ' +
      'two-root trunk is drawn fully separate rather than partially fused ' +
      'near the cervix, which is common in real specimens.',
  },

  // CERVIX_Y 24.5, APEX_Y 62.0, crown MD width 30.5, root count 2. Same
  // layout, smaller, with a shorter splay — second-molar roots are commonly
  // closer to fused than the first's.
  'permanent:lower:second_molar': {
    crown:
      'M19.8 4.0 C25.2 4.3 38.8 4.3 44.2 4.0 C48.3 5.7 48.6 13.3 48.8 15.9 ' +
      'C48.9 17.5 46.0 20.8 45.5 21.9 C45.0 22.9 45.0 23.6 44.8 24.5 ' +
      'C41.8 24.8 24.5 24.7 21.6 24.5 C21.3 23.9 21.2 23.3 20.9 22.7 ' +
      'C20.3 21.6 18.4 20.0 18.3 18.4 C18.1 14.6 19.3 8.3 19.8 4.0 Z',
    roots: [
      // mid-root excursion trimmed, same rationale as the first molar
      'M33.0 22.5 C33.0 23.1 32.5 22.8 33.0 24.5 C33.6 26.4 36.0 33.9 37.6 37.6 ' +
        'C39.3 41.4 44.4 47.6 44.5 50.8 C44.6 53.5 39.2 58.1 38.6 59.5 ' +
        'C38.0 60.8 39.3 61.8 39.5 62.0 C39.8 61.8 40.4 61.8 40.6 62.0 ' +
        'C40.8 61.8 40.7 60.8 41.6 59.5 C42.5 58.1 47.5 53.5 48.3 50.8 ' +
        'C49.1 47.6 48.1 41.4 47.6 37.6 C47.1 33.9 45.1 26.4 44.8 24.5 ' +
        'C44.4 22.8 44.8 23.1 44.8 22.5 C43.5 22.3 34.3 22.3 33.0 22.5 Z',
      'M21.6 22.5 C21.6 23.1 21.8 22.8 21.6 24.5 C21.2 26.4 19.5 33.9 19.0 37.6 ' +
        'C18.5 41.4 17.9 47.6 18.2 50.8 C18.4 53.5 20.4 58.1 20.8 59.5 ' +
        'C21.2 60.8 21.6 61.8 21.8 62.0 C22.0 61.8 22.6 61.8 22.9 62.0 ' +
        'C23.1 61.8 24.0 60.8 23.8 59.5 C23.6 58.1 20.8 53.5 21.2 50.8 ' +
        'C21.6 47.6 25.6 41.4 27.0 37.6 C28.4 33.9 30.5 26.4 31.0 24.5 ' +
        'C31.4 22.8 31.0 23.1 31.0 22.5 C30.0 22.3 22.6 22.3 21.6 22.5 Z',
    ],
    surface:
      'M22.5 12.0 L25.0 17.0 M41.5 12.0 L39.0 17.0 M32.0 14.5 V21.5 ' +
      'M28.5 15.0 L32.0 18.0 L35.5 15.0',
    cervical: 'M21.6 23.7 C26.8 24.0 38.4 24.0 44.8 23.7',
    widthRatio: 1.24,
    sideStrategy: 'mirror',
    simplification:
      "The mesial root's splay-then-hook is drawn shorter than the first " +
      "molar's to reflect their common near-fusion, but a true single " +
      'fused C-shaped root — a frequent finding, especially in the ' +
      'mandibular second molar — is not modelled.',
  },

  // CERVIX_Y 24.5, APEX_Y 56.0, crown MD width 29.0, root count 2. Smaller,
  // more irregular/crowded crown outline; the shortest, most compact
  // mesial-hook of the three lower molars.
  'permanent:lower:third_molar': {
    crown:
      'M20.4 4.0 C25.5 4.3 38.5 4.3 43.6 4.0 C47.5 5.7 47.8 13.3 48.0 15.9 ' +
      'C48.1 17.5 45.3 20.8 44.8 21.9 C44.4 22.9 44.3 23.6 44.1 24.5 ' +
      'C41.3 24.8 24.9 24.7 22.1 24.5 C21.9 23.8 21.8 23.3 21.4 22.5 ' +
      'C20.9 21.4 19.0 19.6 19.0 17.9 C18.8 14.2 20.0 8.2 20.4 4.0 Z',
    roots: [
      'M33.0 22.5 C33.0 23.1 32.4 23.1 33.0 24.5 C33.6 26.1 36.4 32.4 38.1 35.5 ' +
        'C39.9 38.7 45.4 44.0 45.4 46.6 C45.4 48.8 39.0 52.3 38.3 53.5 ' +
        'C37.6 54.6 39.0 55.8 39.2 56.0 C39.5 55.8 40.0 55.8 40.3 56.0 ' +
        'C40.5 55.8 40.3 54.6 41.3 53.5 C42.3 52.3 48.1 48.8 48.9 46.6 ' +
        'C49.8 44.0 48.3 38.7 47.6 35.5 C46.9 32.4 44.5 26.1 44.1 24.5 ' +
        'C43.7 23.1 44.1 23.1 44.1 22.5 C42.9 22.3 34.2 22.3 33.0 22.5 Z',
      'M22.1 22.5 C22.1 23.1 22.4 23.1 22.1 24.5 C21.7 26.1 19.7 32.4 19.1 35.5 ' +
        'C18.4 38.7 17.4 44.0 17.7 46.6 C18.0 48.8 20.9 52.3 21.5 53.5 ' +
        'C22.0 54.6 22.2 55.8 22.4 56.0 C22.7 55.8 23.3 55.8 23.5 56.0 ' +
        'C23.8 55.8 24.8 54.6 24.5 53.5 C24.1 52.3 20.3 48.8 20.6 46.6 ' +
        'C20.9 44.0 25.1 38.7 26.6 35.5 C28.1 32.4 30.5 26.1 31.0 24.5 ' +
        'C31.5 23.1 31.0 23.1 31.0 22.5 C30.0 22.3 23.1 22.3 22.1 22.5 Z',
    ],
    surface: 'M23.5 11.5 L25.5 16.0 M40.5 11.5 L38.5 16.0 M32.0 14.0 V19.5',
    cervical: 'M22.1 23.7 C27.1 24.0 38.1 24.0 44.1 23.7',
    widthRatio: 1.18,
    sideStrategy: 'mirror',
    simplification:
      'Crown outline is kept slightly more irregular than the other molars ' +
      'to read as a third molar at a glance; the mesial root keeps the ' +
      'splay-then-hook signature but shortest and most compact of the three ' +
      'lower molars, rather than modelling the highly variable root count ' +
      'and fusion patterns real mandibular third molars show.',
  },
};

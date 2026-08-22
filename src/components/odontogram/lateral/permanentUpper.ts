/**
 * lateral/permanentUpper.ts — DENTAL-CHART-ASSET-R3 (Lane B rewrite, rework pass)
 *
 * One author-owned slice of the LATERAL_ART registry. Split out of the
 * single 700-line module so the R3 asset lanes can rewrite disjoint files in
 * parallel without conflicting. The orientation contract, the path-command
 * subset and the surface-tiling scheme are unchanged and are documented in
 * anatomy.types.ts and design/dental-chart/AUTHORING.md — read those before
 * touching a coordinate here.
 *
 * REWORK PASS — the first R3 rewrite of this file got every AUTHORING.md
 * §2.1 number right (CERVIX_Y, APEX_Y, crown MD width, neck ratio, apex
 * width, crown/root continuity) but read as mechanical: crowns were
 * 6-segment rounded hexagons and every single-rooted tooth's root was a
 * straight-sided polygon (0 curve segments on its outer contour). This pass
 * keeps every one of those numbers and rebuilds the SILHOUETTE:
 *   - crowns are now 7-8 vertex loops, 100% cubic curves (no straight `L`
 *     anywhere), with a dedicated "flare" vertex per side so the mesial/
 *     distal contour visibly bows out through the height of contour and
 *     eases back in to the CEJ instead of jumping straight there;
 *   - roots are 12-vertex loops (shoulder/collar/belly/waist/pre-apex/apex,
 *     mirrored) that taper as a continuously curving, accelerating cone
 *     into a small ROUNDED apex cap (not a flat-capped polygon);
 *   - the crown's arrival at the CEJ and the root's departure from it are
 *     both engineered to travel in the same near-vertical direction, so the
 *     two-tone crown/root seam reads as continuous, not a step;
 *   - multi-rooted teeth (the upper first premolar and all three upper
 *     molars here) splay to their WIDEST separation around the middle third
 *     and then curve their apices back toward each other — a lyre/pincer,
 *     not a straight V, matching the plate references and measured against
 *     the coordinator's independently-measured ratios (widest separation
 *     0.85-1.05x crown MD width; apex separation 0.45-0.70x, strictly less
 *     than the widest separation).
 *
 * Multi-rooted teeth still draw each root as its own path that carries its
 * share of the cervical "trunk" width down before diverging, and the
 * palatal root is still listed FIRST in `roots` for all four multi-rooted
 * entries below, per the renderer's paint-order contract.
 */

import type { PermanentUpperKey, LateralToothArt } from '../anatomy.types';

export const PERMANENT_UPPER_LATERAL: Readonly<Record<PermanentUpperKey, LateralToothArt>> = {
  // ── PERMANENT UPPER ───────────────────────────────────────────────────

  // CERVIX_Y 34.5, APEX_Y 72.0, crown MD width 24.6 (root count 1).
  // Mesioincisal corner (top-mesial) is a tight, "sharp"-reading curve;
  // distoincisal corner (top-distal) is a loose, rounded one, and its
  // height of contour sits lower (closer to the CEJ) than the mesial one —
  // the classic incisor asymmetry, now visible in the curvature itself, not
  // just the numbers.
  'permanent:upper:central_incisor': {
    crown:
      'M24.2 4.0 C27.8 4.3 36.9 4.3 40.4 4.0 C42.3 4.7 44.8 7.9 45.2 11.9 ' +
      'C45.5 16.0 43.0 25.4 42.6 28.2 C42.3 30.7 42.2 32.3 42.0 34.5 ' +
      'C39.6 35.3 25.7 35.1 23.3 34.5 C23.1 32.7 23.0 31.4 22.7 29.4 ' +
      'C22.3 26.8 20.3 20.4 20.6 16.2 C20.9 9.9 23.1 7.7 24.2 4.0 Z',
    roots: [
      'M23.3 32.5 C23.3 33.1 23.2 32.8 23.3 34.5 C23.4 36.4 23.2 43.9 23.9 47.6 ' +
        'C24.6 51.4 27.3 57.6 28.1 60.8 C28.8 63.5 29.2 68.1 29.6 69.5 ' +
        'C29.8 70.8 30.3 71.8 30.5 72.0 C30.8 71.8 31.3 71.8 31.6 72.0 ' +
        'C31.8 71.8 32.3 70.8 32.6 69.5 C32.9 68.1 33.1 63.5 34.0 60.8 ' +
        'C35.1 57.6 38.7 51.4 39.8 47.6 C40.9 43.9 41.7 36.4 42.0 34.5 ' +
        'C42.2 32.8 42.0 33.1 42.0 32.5 C39.9 32.3 25.4 32.3 23.3 32.5 Z',
    ],
    surface: 'M27.5 6.5 V12.5 M32.5 5.5 V11.0 M37.5 6.5 V13.0',
    cervical: 'M23.3 33.7 C27.7 34.0 37.0 34.0 42.0 33.7',
    widthRatio: 1.0,
    sideStrategy: 'mirror',
    simplification:
      'Root apex is a small rounded cap about 3 units across (measured 2.5 ' +
      'units above the tip) rather than a mathematically fine point; mamelon ' +
      'ridges are reduced to three short verticals rather than the real, ' +
      'subtly curved developmental lobes.',
  },

  // CERVIX_Y 30.0, APEX_Y 68.0, crown MD width 18.9 (root count 1). Same
  // sharp-mesial/rounded-distal corner logic as the central, scaled down.
  'permanent:upper:lateral_incisor': {
    crown:
      'M26.2 4.0 C28.9 4.3 35.6 4.3 38.3 4.0 C39.7 4.6 41.8 7.3 42.1 10.8 ' +
      'C42.4 14.2 40.6 22.2 40.3 24.6 C40.0 26.8 39.9 28.1 39.7 30.0 ' +
      'C37.8 30.7 27.2 30.5 25.3 30.0 C25.1 28.5 24.9 27.5 24.7 25.8 ' +
      'C24.4 23.6 23.0 18.5 23.2 14.9 C23.6 9.5 25.3 7.3 26.2 4.0 Z',
    roots: [
      'M25.3 28.0 C25.3 28.6 25.3 28.3 25.3 30.0 C25.3 31.9 25.0 39.5 25.5 43.3 ' +
        'C25.9 47.1 27.9 53.4 28.4 56.6 C28.9 59.4 29.0 64.1 29.2 65.5 ' +
        'C29.4 66.8 29.9 67.8 30.2 68.0 C30.4 67.8 31.0 67.8 31.3 68.0 ' +
        'C31.5 67.8 32.0 66.8 32.2 65.5 C32.4 64.1 32.3 59.4 33.0 56.6 ' +
        'C33.8 53.4 36.8 47.1 37.7 43.3 C38.7 39.5 39.5 31.9 39.7 30.0 ' +
        'C39.9 28.3 39.7 28.6 39.7 28.0 C38.1 27.8 26.9 27.8 25.3 28.0 Z',
    ],
    surface: 'M28.5 6.5 V11.5 M32.5 5.8 V10.2 M36.0 7.0 V12.0',
    cervical: 'M25.3 29.2 C28.7 29.5 35.9 29.5 39.7 29.2',
    widthRatio: 0.77,
    sideStrategy: 'mirror',
    simplification:
      'Root apex is a small rounded cap about 3 units across rather than a ' +
      'true fine point; the slight distal root curvature real lateral ' +
      'incisor roots sometimes show near the apex is not modelled beyond ' +
      "the tooth's own mild overall lean.",
  },

  // CERVIX_Y 33.0, APEX_Y 82.0, crown MD width 21.8 (root count 1) — the
  // longest root in the arch. Cusp tip is displaced mesially off the x=32
  // crown midline; the mesial slope from the tip is spatially shorter than
  // the distal slope, and the root leans distally along its whole length,
  // easing into a rounded apex.
  'permanent:upper:canine': {
    crown:
      'M38.0 4.0 C39.5 4.4 42.4 4.9 42.9 8.6 C43.4 12.3 41.5 23.1 41.2 26.2 ' +
      'C41.0 28.9 40.8 30.6 40.6 33.0 C38.5 33.9 26.2 33.5 24.0 33.0 ' +
      'C23.8 31.5 23.8 30.4 23.4 28.6 C23.0 26.4 18.7 21.4 21.1 17.3 ' +
      'C24.0 12.4 32.9 4.4 38.0 4.0 Z',
    roots: [
      'M24.0 31.0 C24.0 31.6 24.1 30.9 24.0 33.0 C23.9 35.4 22.8 45.3 23.0 50.2 ' +
        'C23.1 55.1 24.6 63.1 25.1 67.3 C25.5 71.0 26.0 77.7 26.2 79.5 ' +
        'C26.5 81.1 27.0 81.8 27.2 82.0 C27.5 81.8 28.0 81.8 28.3 82.0 ' +
        'C28.5 81.8 29.0 81.1 29.2 79.5 C29.5 77.7 29.4 71.0 30.4 67.3 ' +
        'C31.5 63.1 35.6 55.1 37.1 50.2 C38.6 45.3 40.2 35.4 40.6 33.0 ' +
        'C41.0 30.9 40.6 31.6 40.6 31.0 C38.8 30.8 25.9 30.8 24.0 31.0 Z',
    ],
    surface: 'M38.0 4.0 V14.0 M27.0 14.0 L38.0 4.0 L42.0 8.5',
    cervical: 'M24.0 32.2 C28.0 32.5 36.3 32.5 40.6 32.2',
    widthRatio: 0.89,
    sideStrategy: 'mirror',
    simplification:
      'Root leans distally continuously along its length rather than via a ' +
      'more anatomically typical straight trunk with a curve concentrated ' +
      'near the apex, and ends in a small rounded cap rather than a true ' +
      'fine point.',
  },

  // CERVIX_Y 28.5, APEX_Y 69.0, crown MD width 20.3, root count 2 (palatal
  // FIRST). Buccal cusp tip sits distal of centre and a mesial marginal-
  // ridge developmental groove is hinted near the cervical third — both
  // upper-first-premolar-specific traits. The buccal root splays away from
  // the palatal root and curls back in near its own apex, reading as a
  // genuine bifurcation rather than two parallel prongs.
  'permanent:upper:first_premolar': {
    crown:
      'M22.9 4.0 C26.2 4.3 34.6 4.3 37.9 4.0 C40.8 6.1 42.6 15.6 43.1 18.7 ' +
      'C43.4 20.7 41.4 24.3 41.1 25.6 C40.8 26.6 40.6 27.5 40.4 28.5 ' +
      'C38.4 28.9 27.0 28.8 25.0 28.5 C24.7 27.8 24.5 27.2 24.3 26.4 ' +
      'C23.9 25.3 22.9 23.7 22.8 21.6 C22.5 17.2 22.9 9.3 22.9 4.0 Z',
    roots: [
      // palatal — centred, straighter and taller, drawn first so the buccal
      // root paints over it and the bifurcation reads as depth
      'M27.7 26.5 C27.7 27.1 27.6 26.7 27.7 28.5 C27.7 30.5 27.8 38.6 28.2 42.7 ' +
        'C28.5 46.7 29.9 53.4 30.2 56.9 C30.5 59.8 30.1 65.0 30.3 66.5 ' +
        'C30.4 67.9 31.0 68.8 31.2 69.0 C31.5 68.8 32.0 68.8 32.3 69.0 ' +
        'C32.5 68.8 33.1 67.9 33.3 66.5 C33.4 65.0 33.0 59.8 33.3 56.9 ' +
        'C33.6 53.4 35.3 46.7 35.8 42.7 C36.2 38.6 36.5 30.5 36.6 28.5 ' +
        'C36.7 26.7 36.6 27.1 36.6 26.5 C35.6 26.3 28.7 26.3 27.7 26.5 Z',
      // buccal — splays out, then curls back toward the palatal root near
      // its own (shallower) apex
      'M25.0 26.5 C25.0 27.1 25.0 27.0 25.0 28.5 C25.0 30.1 24.5 36.4 24.7 39.6 ' +
        'C25.0 42.7 26.1 48.0 26.8 50.6 C27.3 52.9 28.8 56.4 29.2 57.6 ' +
        'C29.6 58.6 30.0 59.8 30.2 60.1 C30.4 59.9 31.0 59.9 31.3 60.1 ' +
        'C31.5 59.8 32.2 58.6 32.2 57.6 C32.2 56.4 30.8 52.9 31.4 50.6 ' +
        'C32.1 48.0 35.8 42.7 37.1 39.6 C38.3 36.4 40.0 30.1 40.4 28.5 ' +
        'C40.8 27.0 40.4 27.1 40.4 26.5 C38.7 26.3 26.7 26.3 25.0 26.5 Z',
    ],
    surface: 'M30.0 11.0 L32.0 8.0 L34.5 11.5 M32.0 8.0 V16.0 M36.0 22.0 L38.5 25.5',
    cervical: 'M25.0 27.7 C28.5 28.0 36.2 28.0 40.4 27.7',
    widthRatio: 0.83,
    sideStrategy: 'mirror',
    simplification:
      "Buccal and palatal roots' outward splay and inward curl near the " +
      'apex is exaggerated for legibility at chart size versus the milder ' +
      'divergence most real specimens show; each apex is a small rounded ' +
      'cap rather than a fine point, and the mesial marginal-ridge groove ' +
      'is a single stroke rather than a true fissure.',
  },

  // CERVIX_Y 28.5, APEX_Y 70.5, crown MD width 20.3, root count 1. Mesial
  // and distal contours drawn with only mild difference in height of
  // contour — the second premolar genuinely has less mesiodistal asymmetry
  // than the first, but real (small) asymmetry is still present.
  'permanent:upper:second_premolar': {
    crown:
      'M24.4 4.0 C27.7 4.3 36.3 4.3 39.6 4.0 C42.3 6.2 42.7 16.1 42.9 19.2 ' +
      'C43.0 21.2 41.3 24.5 40.9 25.7 C40.6 26.7 40.5 27.5 40.2 28.5 ' +
      'C38.2 28.8 26.9 28.8 24.8 28.5 C24.6 27.8 24.4 27.2 24.1 26.4 ' +
      'C23.8 25.3 22.5 23.7 22.6 21.6 C22.6 17.2 23.8 9.3 24.4 4.0 Z',
    roots: [
      'M24.8 26.5 C24.8 27.1 24.7 26.6 24.8 28.5 C24.9 30.6 25.0 39.0 25.7 43.2 ' +
        'C26.4 47.4 28.8 54.4 29.5 57.9 C30.1 61.0 30.2 66.4 30.4 68.0 ' +
        'C30.7 69.4 31.2 70.3 31.4 70.5 C31.7 70.3 32.2 70.3 32.5 70.5 ' +
        'C32.7 70.3 33.2 69.4 33.4 68.0 C33.7 66.4 33.7 61.0 34.4 57.9 ' +
        'C35.2 54.4 38.0 47.4 38.8 43.2 C39.6 39.0 40.1 30.6 40.2 28.5 ' +
        'C40.4 26.6 40.2 27.1 40.2 26.5 C38.5 26.3 26.6 26.3 24.8 26.5 Z',
    ],
    surface: 'M30.5 11.5 L32.0 8.5 L34.0 12.0 M32.0 8.5 V16.5',
    cervical: 'M24.8 27.7 C28.4 28.0 36.1 28.0 40.2 27.7',
    widthRatio: 0.83,
    sideStrategy: 'mirror',
    simplification:
      'Root apex is a small rounded cap about 3 units across rather than a ' +
      'fine point; mesial and distal crown contours are drawn with only ' +
      "mild height-of-contour difference, matching this tooth's genuinely " +
      'more symmetric form relative to the first premolar. No mesial ' +
      'developmental groove is shown, since it is not a defining feature here.',
  },

  // CERVIX_Y 26.0, APEX_Y 64.0, crown MD width 29.0, root count 3 (palatal
  // FIRST). Crown tapers narrower toward the distal; the distal contour is
  // more rounded, the mesial nearer to flat. The mesiobuccal and
  // distobuccal roots splay apart to their widest separation around the
  // middle third and then curve their apices back toward each other (a
  // lyre, not a V) while the palatal root runs straighter and longer.
  'permanent:upper:first_molar': {
    crown:
      'M20.4 4.0 C25.5 4.3 38.5 4.3 43.6 4.0 C47.5 5.8 47.6 14.0 47.8 16.8 ' +
      'C47.9 18.5 45.2 22.1 44.7 23.2 C44.3 24.3 44.2 25.0 44.0 26.0 ' +
      'C41.2 26.3 24.8 26.2 22.0 26.0 C21.7 25.3 21.6 24.8 21.3 24.0 ' +
      'C20.8 22.9 18.9 21.2 18.8 19.4 C18.6 15.4 19.9 8.6 20.4 4.0 Z',
    roots: [
      // palatal — centred, drawn first, deepest apex of the three, minimal lean
      'M25.4 24.0 C25.4 24.6 25.3 24.3 25.4 26.0 C25.5 27.9 25.5 35.5 26.1 39.3 ' +
        'C26.7 43.1 28.9 49.4 29.4 52.6 C29.9 55.4 29.7 60.1 29.9 61.5 ' +
        'C30.1 62.8 30.7 63.8 30.9 64.0 C31.2 63.8 31.7 63.8 32.0 64.0 ' +
        'C32.2 63.8 32.8 62.8 32.9 61.5 C33.1 60.1 32.8 55.4 33.4 52.6 ' +
        'C34.0 49.4 36.6 43.1 37.3 39.3 C38.1 35.5 38.4 27.9 38.6 26.0 ' +
        'C38.7 24.3 38.6 24.6 38.6 24.0 C37.1 23.8 26.9 23.8 25.4 24.0 Z',
      // mesiobuccal — splays mesially through the middle third, then curls back
      'M35.3 24.0 C35.3 24.6 34.8 24.6 35.3 26.0 C35.8 27.6 38.1 33.6 39.6 36.6 ' +
        'C41.0 39.7 45.5 44.8 45.5 47.3 C45.4 49.4 39.8 52.8 39.2 53.9 ' +
        'C38.6 54.9 39.9 56.2 40.1 56.4 C40.4 56.2 40.9 56.2 41.2 56.4 ' +
        'C41.4 56.2 41.4 54.9 42.2 53.9 C43.0 52.8 47.6 49.4 48.2 47.3 ' +
        'C48.9 44.8 47.5 39.7 46.9 36.6 C46.3 33.6 44.4 27.6 44.0 26.0 ' +
        'C43.7 24.6 44.0 24.6 44.0 24.0 C43.0 23.8 36.3 23.8 35.3 24.0 Z',
      // distobuccal — mirrors the mesiobuccal splay/curl toward the distal
      'M22.0 24.0 C22.0 24.6 22.3 24.6 22.0 26.0 C21.6 27.6 19.6 33.6 18.9 36.6 ' +
        'C18.2 39.7 16.5 44.8 17.1 47.3 C17.6 49.4 22.0 52.8 22.8 53.9 ' +
        'C23.6 54.9 23.6 56.2 23.8 56.4 C24.1 56.2 24.6 56.2 24.9 56.4 ' +
        'C25.1 56.2 26.5 54.9 25.8 53.9 C25.1 52.8 19.4 49.4 19.2 47.3 ' +
        'C19.0 44.8 23.2 39.7 24.6 36.6 C26.0 33.6 28.2 27.6 28.7 26.0 ' +
        'C29.2 24.6 28.7 24.6 28.7 24.0 C28.0 23.8 22.7 23.8 22.0 24.0 Z',
    ],
    surface:
      'M22.0 12.5 L24.5 18.0 M40.0 12.5 L37.5 18.0 M32.0 15.0 V22.0 ' +
      'M28.0 15.5 L32.0 19.0 L36.0 15.5',
    cervical: 'M22.0 25.2 C27.0 25.5 38.0 25.5 44.0 25.2',
    widthRatio: 1.18,
    sideStrategy: 'mirror',
    simplification:
      "The mesiobuccal/distobuccal pincer's splay-then-curl is exaggerated " +
      'for legibility at chart size relative to the milder divergence most ' +
      'real specimens show; each apex is a small rounded cap rather than a ' +
      'fine point, and individual occlusal cusps are only hinted at through ' +
      'the surface ridge lines, not separately outlined.',
  },

  // CERVIX_Y 24.5, APEX_Y 59.0, crown MD width 26.1, root count 3 (palatal
  // FIRST). Same asymmetry and pincer logic as the first molar, slightly
  // smaller and with a shorter splay — second-molar roots are commonly
  // closer to fused than the first's.
  'permanent:upper:second_molar': {
    crown:
      'M21.6 4.0 C26.2 4.3 37.8 4.3 42.4 4.0 C46.0 5.7 46.2 13.3 46.4 15.9 ' +
      'C46.5 17.5 44.0 20.8 43.6 21.9 C43.2 22.9 43.1 23.6 42.9 24.5 ' +
      'C40.3 24.8 25.7 24.7 23.1 24.5 C22.8 23.9 22.7 23.3 22.4 22.7 ' +
      'C21.9 21.6 20.3 20.0 20.3 18.4 C20.1 14.6 21.2 8.3 21.6 4.0 Z',
    roots: [
      'M26.1 22.5 C26.1 23.1 26.0 22.9 26.1 24.5 C26.1 26.3 26.2 33.1 26.7 36.6 ' +
        'C27.2 40.0 29.2 45.8 29.7 48.7 C30.1 51.1 29.9 55.2 30.0 56.5 ' +
        'C30.2 57.7 30.8 58.8 31.0 59.0 C31.2 58.8 31.8 58.8 32.1 59.0 ' +
        'C32.3 58.8 32.9 57.7 33.0 56.5 C33.2 55.2 32.8 51.1 33.3 48.7 ' +
        'C33.8 45.8 36.1 40.0 36.8 36.6 C37.5 33.1 37.8 26.3 37.9 24.5 ' +
        'C38.1 22.9 37.9 23.1 37.9 22.5 C36.6 22.3 27.4 22.3 26.1 22.5 Z',
      'M35.0 22.5 C35.0 23.1 34.5 23.2 35.0 24.5 C35.5 26.0 37.5 31.4 38.8 34.2 ' +
        'C40.1 36.9 44.2 41.6 44.2 43.8 C44.1 45.8 38.9 48.6 38.3 49.6 ' +
        'C37.8 50.5 39.1 51.9 39.3 52.1 C39.6 51.9 40.1 51.9 40.4 52.1 ' +
        'C40.6 51.9 40.6 50.5 41.3 49.6 C42.1 48.6 46.2 45.8 46.7 43.8 ' +
        'C47.3 41.6 46.1 36.9 45.5 34.2 C45.0 31.4 43.2 26.0 42.9 24.5 ' +
        'C42.6 23.2 42.9 23.1 42.9 22.5 C42.0 22.3 35.9 22.3 35.0 22.5 Z',
      'M23.1 22.5 C23.1 23.1 23.4 23.2 23.1 24.5 C22.7 26.0 20.9 31.4 20.3 34.2 ' +
        'C19.6 36.9 18.1 41.6 18.6 43.8 C19.0 45.8 22.9 48.6 23.7 49.6 ' +
        'C24.3 50.5 24.4 51.9 24.6 52.1 C24.9 51.9 25.4 51.9 25.7 52.1 ' +
        'C25.9 51.9 27.2 50.5 26.7 49.6 C26.0 48.6 20.7 45.8 20.5 43.8 ' +
        'C20.3 41.6 24.1 36.9 25.3 34.2 C26.6 31.4 28.6 26.0 29.0 24.5 ' +
        'C29.4 23.2 29.0 23.1 29.0 22.5 C28.4 22.3 23.8 22.3 23.1 22.5 Z',
    ],
    surface:
      'M23.5 12.0 L26.0 17.0 M39.0 12.0 L36.5 17.0 M32.0 14.5 V21.0 ' +
      'M28.5 15.0 L32.0 18.0 L35.5 15.0',
    cervical: 'M23.1 23.7 C27.6 24.0 37.5 24.0 42.9 23.7',
    widthRatio: 1.06,
    sideStrategy: 'mirror',
    simplification:
      "Roots' splay is drawn shorter than the first molar's to reflect " +
      "their common near-proximity, but true partial root fusion (frequent " +
      'in this tooth) is not modelled as a single fused mass; each apex is ' +
      'a small rounded cap rather than a fine point.',
  },

  // CERVIX_Y 23.0, APEX_Y 55.0, crown MD width 24.7, root count 3 (palatal
  // FIRST). Visibly smaller and more irregular; roots kept at 3 for
  // registry consistency but with the shortest, most compact pincer of the
  // three upper molars.
  'permanent:upper:third_molar': {
    crown:
      'M22.1 4.0 C26.5 4.3 37.5 4.3 41.9 4.0 C45.2 5.6 45.4 12.6 45.6 15.0 ' +
      'C45.7 16.5 43.4 19.6 43.0 20.6 C42.7 21.5 42.6 22.2 42.3 23.0 ' +
      'C39.9 23.3 26.0 23.2 23.5 23.0 C23.3 22.4 23.1 21.9 22.8 21.2 ' +
      'C22.4 20.2 21.0 18.5 20.9 16.9 C20.7 13.5 21.7 7.9 22.1 4.0 Z',
    roots: [
      'M26.4 21.0 C26.4 21.6 26.3 21.5 26.4 23.0 C26.4 24.7 26.5 31.0 27.0 34.2 ' +
        'C27.4 37.4 29.4 42.8 29.8 45.4 C30.2 47.7 29.9 51.3 30.0 52.5 ' +
        'C30.2 53.6 30.8 54.8 31.0 55.0 C31.2 54.8 31.8 54.8 32.1 55.0 ' +
        'C32.3 54.8 32.9 53.6 33.0 52.5 C33.2 51.3 32.8 47.7 33.2 45.4 ' +
        'C33.7 42.8 35.9 37.4 36.5 34.2 C37.2 31.0 37.5 24.7 37.6 23.0 ' +
        'C37.8 21.5 37.6 21.6 37.6 21.0 C36.4 20.8 27.6 20.8 26.4 21.0 Z',
      'M34.8 21.0 C34.8 21.6 34.4 21.8 34.8 23.0 C35.3 24.3 37.2 29.2 38.4 31.7 ' +
        'C39.6 34.2 43.4 38.5 43.4 40.5 C43.3 42.2 38.5 44.5 37.9 45.5 ' +
        'C37.4 46.3 38.7 47.7 38.9 48.0 C39.1 47.8 39.7 47.8 40.0 48.0 ' +
        'C40.2 47.7 40.3 46.3 40.9 45.5 C41.6 44.5 45.3 42.2 45.8 40.5 ' +
        'C46.3 38.5 45.3 34.2 44.8 31.7 C44.3 29.2 42.6 24.3 42.3 23.0 ' +
        'C42.1 21.8 42.3 21.6 42.3 21.0 C41.5 20.8 35.7 20.8 34.8 21.0 Z',
      'M23.5 21.0 C23.5 21.6 23.8 21.8 23.5 23.0 C23.2 24.3 21.5 29.2 21.0 31.7 ' +
        'C20.4 34.2 19.0 38.5 19.5 40.5 C19.8 42.2 23.3 44.5 24.0 45.5 ' +
        'C24.6 46.3 24.8 47.7 25.0 48.0 C25.2 47.8 25.8 47.8 26.1 48.0 ' +
        'C26.3 47.7 27.6 46.3 27.0 45.5 C26.4 44.5 21.4 42.2 21.3 40.5 ' +
        'C21.1 38.5 24.6 34.2 25.8 31.7 C26.9 29.2 28.8 24.3 29.2 23.0 ' +
        'C29.6 21.8 29.2 21.6 29.2 21.0 C28.6 20.8 24.2 20.8 23.5 21.0 Z',
    ],
    surface: 'M23.5 11.5 L25.5 16.0 M38.5 11.5 L36.5 16.0 M32.0 14.0 V19.5',
    cervical: 'M23.5 22.2 C27.8 22.5 37.2 22.5 42.3 22.2',
    widthRatio: 1.0,
    sideStrategy: 'mirror',
    simplification:
      'Root complex kept at the full three roots for registry consistency ' +
      'but with the shortest, most compact pincer splay of the three upper ' +
      'molars, to suggest the often partially fused form real third molar ' +
      'roots show; the highly variable 2-4 root morphology is not modelled, ' +
      'and the crown outline is deliberately more irregular than the other ' +
      'molars but still schematic.',
  },
};

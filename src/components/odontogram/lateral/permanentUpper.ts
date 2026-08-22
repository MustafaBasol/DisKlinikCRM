/**
 * lateral/permanentUpper.ts — DENTAL-CHART-ASSET-R3 (Lane B rewrite)
 *
 * One author-owned slice of the LATERAL_ART registry. Split out of the
 * single 700-line module so the R3 asset lanes can rewrite disjoint files in
 * parallel without conflicting. The orientation contract, the path-command
 * subset and the surface-tiling scheme are unchanged and are documented in
 * anatomy.types.ts and design/dental-chart/AUTHORING.md — read those before
 * touching a coordinate here.
 *
 * R3 REWRITE — every entry below was rebuilt from AUTHORING.md §2.1's shared
 * coordinate table to fix the four R2 defects named in AUTHORING.md §0:
 *   1. every crown now has a real cervical constriction (widest at the
 *      contact points, pinched back in at the CEJ);
 *   2. the crown's width AT CERVIX_Y and each root's width AT CERVIX_Y are
 *      the same authored number (both derive from one shared `cervixW`
 *      value per tooth, and each root holds that exact width through a
 *      2-unit "collar" that starts above CERVIX_Y so the crown, painted on
 *      top, always overlaps the seam);
 *   3. roots are ~2/3 of total tooth length, continuously tapering, ending
 *      in a narrow flat cap (2.6-3.4 units) instead of a rounded club;
 *   4. every CERVIX_Y / APEX_Y / crown-width value below is read verbatim
 *      from the AUTHORING.md §2.1 table, not chosen to fill a box.
 *
 * Multi-rooted teeth (the upper first premolar and all three molars) draw
 * each root as its own path that carries its share of the cervical "trunk"
 * width down to a furcation point before diverging to its own apex — see
 * AUTHORING.md §3.2. The palatal root is listed FIRST in `roots` for all
 * four of these entries, as required, so the renderer paints the buccal
 * roots over it and the furcation reads as depth.
 */

import type { PermanentUpperKey, LateralToothArt } from '../anatomy.types';

export const PERMANENT_UPPER_LATERAL: Readonly<Record<PermanentUpperKey, LateralToothArt>> = {
  // ── PERMANENT UPPER ───────────────────────────────────────────────────

  // CERVIX_Y 34.5, APEX_Y 72.0, crown MD width 24.6 (root count 1).
  // Mesioincisal corner (top-mesial, x=40.4) is a real sharp/square corner;
  // distoincisal corner (top-distal, x=24.2) is rounded and its height of
  // contour sits lower (y=16.2) than the mesial one (y=11.9) — the classic
  // incisor asymmetry, and what keeps 'mirror' from being a no-op here.
  'permanent:upper:central_incisor': {
    crown:
      'M24.2 4.0 L40.4 4.0 C40.4 4.0 44.9 7.6 45.2 11.9 ' +
      'C45.4 16.3 42.0 34.5 42.0 34.5 L23.3 34.5 ' +
      'C23.3 34.5 20.4 20.6 20.6 16.2 C20.7 11.8 24.2 4.0 24.2 4.0 Z',
    roots: [
      'M42.0 32.5 L42.0 34.5 L33.3 72.0 L30.1 72.0 ' +
        'L23.3 34.5 L23.3 32.5 L42.0 32.5 Z',
    ],
    surface: 'M27.5 6.5 V12.5 M32.5 5.5 V11.0 M37.5 6.5 V13.0',
    cervical: 'M23.3 33.7 C27.7 34.0 37.0 34.0 42.0 33.7',
    widthRatio: 1.0,
    sideStrategy: 'mirror',
    simplification:
      'Root apex drawn as a flat 3.2-unit cap rather than tapering to an ' +
      'anatomically fine point; mamelon ridges reduced to three short ' +
      'verticals rather than the real, subtly curved developmental lobes.',
  },

  // CERVIX_Y 30.0, APEX_Y 68.0, crown MD width 18.9 (root count 1).
  // Same sharp-mesial/rounded-distal corner logic as the central, scaled
  // down; smaller and more rounded overall as a lateral incisor genuinely is.
  'permanent:upper:lateral_incisor': {
    crown:
      'M26.2 4.0 L38.3 4.0 C38.3 4.0 41.9 7.0 42.1 10.8 ' +
      'C42.3 14.5 39.7 30.0 39.7 30.0 L25.3 30.0 ' +
      'C25.3 30.0 23.1 18.6 23.2 14.9 C23.3 11.2 26.2 4.0 26.2 4.0 Z',
    roots: [
      'M39.7 28.0 L39.7 30.0 L33.0 68.0 L30.2 68.0 ' +
        'L25.3 30.0 L25.3 28.0 L39.7 28.0 Z',
    ],
    surface: 'M28.5 6.5 V11.5 M32.5 5.8 V10.2 M36.0 7.0 V12.0',
    cervical: 'M25.3 29.2 C28.7 29.5 35.9 29.5 39.7 29.2',
    widthRatio: 0.77,
    sideStrategy: 'mirror',
    simplification:
      'Root apex capped at a flat 2.8 units rather than a true fine point; ' +
      "the root's own mid-length curvature is simplified to a single " +
      'smooth taper rather than the subtle distal deflection real lateral ' +
      'incisor roots sometimes show near the apex.',
  },

  // CERVIX_Y 33.0, APEX_Y 82.0, crown MD width 21.8 (root count 1) — the
  // longest root in the arch, per the table. Cusp tip (x=38.0) is displaced
  // mesially off the x=32 crown midline; the mesial slope from the tip
  // (short, to the Wm contact point near x=42.9) is spatially shorter than
  // the distal slope (long, toward the Wd contact point near x=21.1), and
  // the root's apex leans distally via a single mid-root bend.
  'permanent:upper:canine': {
    crown:
      'M38.0 4.0 C38.0 4.0 42.5 4.5 42.9 8.6 C43.3 12.8 40.6 33.0 40.6 33.0 ' +
      'L24.0 33.0 C24.0 33.0 19.1 21.5 21.1 17.3 C23.1 13.2 38.0 4.0 38.0 4.0 Z',
    roots: [
      'M40.6 31.0 L40.6 33.0 C40.6 33.0 40.7 54.5 39.6 60.0 ' +
        'C38.6 65.4 31.0 82.0 31.0 82.0 L27.8 82.0 ' +
        'C27.8 82.0 26.0 65.4 25.5 60.0 C25.1 54.5 24.0 33.0 24.0 33.0 ' +
        'L24.0 31.0 L40.6 31.0 Z',
    ],
    surface: 'M38.0 4.0 V14.0 M27.0 14.0 L38.0 4.0 L42.0 8.5',
    cervical: 'M24.0 32.2 C28.0 32.5 36.3 32.5 40.6 32.2',
    widthRatio: 0.89,
    sideStrategy: 'mirror',
    simplification:
      "The root's lean toward the distal is modelled with a single " +
      'mid-root bend rather than continuous curvature, and it ends in a ' +
      'flat ~3-unit apex cap rather than tapering to a true fine point.',
  },

  // CERVIX_Y 28.5, APEX_Y 69.0, crown MD width 20.3, root count 2 (palatal
  // FIRST). Buccal cusp tip sits distal of centre (the crown's top edge is
  // shifted toward smaller x) and a mesial marginal-ridge developmental
  // groove is hinted near the cervical third — both upper-first-premolar-
  // specific traits called out in AUTHORING.md §3.3.
  'permanent:upper:first_premolar': {
    crown:
      'M22.9 4.0 L37.9 4.0 C37.9 4.0 42.8 15.6 43.1 18.7 ' +
      'C43.4 21.8 40.4 28.5 40.4 28.5 L25.0 28.5 ' +
      'C25.0 28.5 23.1 25.7 22.8 21.6 C22.4 17.6 22.9 4.0 22.9 4.0 Z',
    roots: [
      // palatal — centred trunk chunk, drawn first so the buccal root paints
      // over it and the bifurcation reads as depth
      'M27.7 26.5 L27.7 28.5 L30.4 69.0 L33.6 69.0 ' +
        'L36.6 28.5 L36.6 26.5 L27.7 26.5 Z',
      // buccal — spans the full cervical width, offset apex forms the
      // visible bifurcation against the palatal root behind it
      'M25.0 26.5 L25.0 28.5 L30.0 60.9 L33.0 60.9 ' +
        'L40.4 28.5 L40.4 26.5 L25.0 26.5 Z',
    ],
    surface: 'M30.0 11.0 L32.0 8.0 L34.5 11.5 M32.0 8.0 V16.0 M36.0 22.0 L38.5 25.5',
    cervical: 'M25.0 27.7 C28.5 28.0 36.2 28.0 40.4 27.7',
    widthRatio: 0.83,
    sideStrategy: 'mirror',
    simplification:
      'Buccal and palatal roots are drawn as two independently-tapering ' +
      'paths that share their cervical shoulder width, rather than a ' +
      'single trunk that visibly bifurcates lower down; each apex is a ' +
      'flat 3-unit cap. The mesial marginal-ridge developmental groove is ' +
      'hinted as a single stroke rather than a true fissure.',
  },

  // CERVIX_Y 28.5, APEX_Y 70.5, crown MD width 20.3, root count 1. Mesial
  // and distal contours drawn with only mild difference in height of
  // contour — the second premolar genuinely has less mesiodistal asymmetry
  // than the first, but real (small) asymmetry is still present so
  // 'mirror' stays meaningful.
  'permanent:upper:second_premolar': {
    crown:
      'M24.4 4.0 L39.6 4.0 C39.6 4.0 42.8 16.1 42.9 19.2 ' +
      'C42.9 22.3 40.2 28.5 40.2 28.5 L24.8 28.5 ' +
      'C24.8 28.5 22.6 25.7 22.6 21.6 C22.5 17.6 24.4 4.0 24.4 4.0 Z',
    roots: [
      'M40.2 26.5 L40.2 28.5 L33.7 70.5 L30.3 70.5 ' +
        'L24.8 28.5 L24.8 26.5 L40.2 26.5 Z',
    ],
    surface: 'M30.5 11.5 L32.0 8.5 L34.0 12.0 M32.0 8.5 V16.5',
    cervical: 'M24.8 27.7 C28.4 28.0 36.1 28.0 40.2 27.7',
    widthRatio: 0.83,
    sideStrategy: 'mirror',
    simplification:
      'Root apex is a flat ~3.4-unit cap rather than a fine point; mesial ' +
      'and distal crown contours are drawn with only mild height-of-' +
      "contour difference, matching this tooth's genuinely more symmetric " +
      'form relative to the first premolar. No mesial developmental ' +
      'groove is shown, since it is not a defining feature here.',
  },

  // CERVIX_Y 26.0, APEX_Y 64.0, crown MD width 29.0, root count 3 (palatal
  // FIRST). Crown tapers narrower toward the distal (small x); the distal
  // contour is more rounded, the mesial nearer to flat. Root apices drift
  // slightly toward the crown's own centre rather than staying under their
  // own shoulders — the "leaning back" molar silhouette.
  'permanent:upper:first_molar': {
    crown:
      'M20.4 4.0 L43.6 4.0 C43.6 4.0 47.8 14.0 47.8 16.8 ' +
      'C47.9 19.5 44.0 26.0 44.0 26.0 L22.0 26.0 ' +
      'C22.0 26.0 19.1 23.1 18.8 19.4 C18.5 15.7 20.4 4.0 20.4 4.0 Z',
    roots: [
      // palatal — centred, drawn first, deepest apex of the three
      'M25.4 24.0 L25.4 26.0 C25.4 26.0 24.7 33.2 25.2 37.4 ' +
        'C25.6 41.6 29.5 64.0 29.5 64.0 L32.9 64.0 ' +
        'C32.9 64.0 37.7 41.6 38.4 37.4 C39.0 33.2 38.6 26.0 38.6 26.0 ' +
        'L38.6 24.0 L25.4 24.0 Z',
      // mesiobuccal — base at the mesial shoulder, shorter than palatal
      'M35.3 24.0 L35.3 26.0 L38.7 57.2 L41.7 57.2 ' +
        'L44.0 26.0 L44.0 24.0 L35.3 24.0 Z',
      // distobuccal — base at the distal shoulder, shortest and straightest
      'M22.0 24.0 L22.0 26.0 L23.3 57.2 L26.1 57.2 ' +
        'L28.7 26.0 L28.7 24.0 L22.0 24.0 Z',
    ],
    surface:
      'M22.0 12.5 L24.5 18.0 M40.0 12.5 L37.5 18.0 M32.0 15.0 V22.0 ' +
      'M28.0 15.5 L32.0 19.0 L36.0 15.5',
    cervical: 'M22.0 25.2 C27.0 25.5 38.0 25.5 44.0 25.2',
    widthRatio: 1.18,
    sideStrategy: 'mirror',
    simplification:
      'The three roots are drawn as independently-tapering paths that ' +
      'share their cervical shoulder rather than a trunk that visibly ' +
      'forks partway down; the two buccal apices are simplified to flat ' +
      'caps under 3 units rather than the finer tapering real molar roots ' +
      'show, and individual occlusal cusps are only hinted at through the ' +
      'surface ridge lines, not separately outlined.',
  },

  // CERVIX_Y 24.5, APEX_Y 59.0, crown MD width 26.1, root count 3 (palatal
  // FIRST). Same asymmetry logic as the first molar, slightly smaller; roots
  // drawn with their buccal apices closer to the crown's own centre —
  // second-molar roots are commonly closer to fused than the first's.
  'permanent:upper:second_molar': {
    crown:
      'M21.6 4.0 L42.4 4.0 C42.4 4.0 46.3 13.3 46.4 15.9 ' +
      'C46.4 18.5 42.9 24.5 42.9 24.5 L23.1 24.5 ' +
      'C23.1 24.5 20.5 21.8 20.3 18.4 C20.0 14.9 21.6 4.0 21.6 4.0 Z',
    roots: [
      'M26.1 22.5 L26.1 24.5 C26.1 24.5 25.4 31.0 25.8 34.9 ' +
        'C26.2 38.7 29.6 59.0 29.6 59.0 L32.8 59.0 ' +
        'C32.8 59.0 37.1 38.7 37.7 34.9 C38.3 31.0 37.9 24.5 37.9 24.5 ' +
        'L37.9 22.5 L26.1 22.5 Z',
      'M35.0 22.5 L35.0 24.5 L38.1 52.8 L40.9 52.8 ' +
        'L42.9 24.5 L42.9 22.5 L35.0 22.5 Z',
      'M23.1 22.5 L23.1 24.5 L24.2 52.8 L26.8 52.8 ' +
        'L29.0 24.5 L29.0 22.5 L23.1 22.5 Z',
    ],
    surface:
      'M23.5 12.0 L26.0 17.0 M39.0 12.0 L36.5 17.0 M32.0 14.5 V21.0 ' +
      'M28.5 15.0 L32.0 18.0 L35.5 15.0',
    cervical: 'M23.1 23.7 C27.6 24.0 37.5 24.0 42.9 23.7',
    widthRatio: 1.06,
    sideStrategy: 'mirror',
    simplification:
      "Roots drawn shorter and their buccal apices set closer to the " +
      "crown's own centre than the first molar's, reflecting these roots' " +
      'common near-proximity, but true partial root fusion (frequent in ' +
      'this tooth) is not modelled as a single fused mass.',
  },

  // CERVIX_Y 23.0, APEX_Y 55.0, crown MD width 24.7, root count 3 (palatal
  // FIRST). Visibly smaller and more irregular per the brief; roots kept at
  // 3 for registry consistency but drawn short and only lightly divergent.
  'permanent:upper:third_molar': {
    crown:
      'M22.1 4.0 L41.9 4.0 C41.9 4.0 45.5 12.6 45.6 15.0 ' +
      'C45.6 17.4 42.3 23.0 42.3 23.0 L23.5 23.0 ' +
      'C23.5 23.0 21.1 20.1 20.9 16.9 C20.6 13.8 22.1 4.0 22.1 4.0 Z',
    roots: [
      'M26.4 21.0 L26.4 23.0 C26.4 23.0 25.7 30.3 26.1 33.9 ' +
        'C26.5 37.4 29.7 55.0 29.7 55.0 L32.7 55.0 ' +
        'C32.7 55.0 36.8 37.4 37.4 33.9 C37.9 30.3 37.6 23.0 37.6 23.0 ' +
        'L37.6 21.0 L26.4 21.0 Z',
      'M34.8 21.0 L34.8 23.0 L37.8 48.0 L40.5 48.0 ' +
        'L42.3 23.0 L42.3 21.0 L34.8 21.0 Z',
      'M23.5 21.0 L23.5 23.0 L24.5 48.0 L27.1 48.0 ' +
        'L29.2 23.0 L29.2 21.0 L23.5 21.0 Z',
    ],
    surface: 'M23.5 11.5 L25.5 16.0 M38.5 11.5 L36.5 16.0 M32.0 14.0 V19.5',
    cervical: 'M23.5 22.2 C27.8 22.5 37.2 22.5 42.3 22.2',
    widthRatio: 1.0,
    sideStrategy: 'mirror',
    simplification:
      'Root complex kept at the full three roots for registry consistency, ' +
      'but each is drawn short and only lightly divergent to suggest the ' +
      'compact, often partially fused form real third molar roots show; ' +
      'the highly variable 2-4 root morphology is not modelled, and the ' +
      'crown outline is deliberately more irregular than the other molars ' +
      'but still schematic.',
  },
};

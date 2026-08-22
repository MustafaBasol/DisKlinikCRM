/**
 * lateral/primary.ts — DENTAL-CHART-ASSET-R3 (Lane D)
 *
 * One author-owned slice of the LATERAL_ART registry. Split out of the
 * single 700-line module so the R3 asset lanes can rewrite disjoint files in
 * parallel without conflicting. The orientation contract, the path-command
 * subset and the surface-tiling scheme are unchanged and are documented in
 * anatomy.types.ts and design/dental-chart/AUTHORING.md — read those before
 * touching a coordinate here.
 *
 * R3 LANE D REWRITE — every entry below was redrawn from scratch against the
 * primary/deciduous reference plates (07-10) so a paediatric dentist would
 * not mistake any of these for a scaled-down permanent tooth. The deciduous
 * signature applied consistently to every entry:
 *   - a BULBOUS crown that pinches sharply into a genuinely tight neck at
 *     CERVIX_Y (crown and root share the exact same width there);
 *   - crowns that are WIDE relative to their height (short, squat) per the
 *     §2.1 table, not filled boxes;
 *   - a NARROW root trunk, visibly slimmer than the crown above it;
 *   - molars: a HIGH furcation (~0.15 of the CEJ-to-apex distance, versus
 *     ~0.3 on permanent molars) followed by widely divergent, slender roots
 *     that flare outside the crown's own outline — the single most
 *     recognisable deciduous trait, per reference plate 08;
 *   - every root tapering to a narrow (2.5-4 unit) blunt tip, never a club
 *     and never a mathematical point.
 */

import type { PrimaryAnatomyKey, LateralToothArt } from '../anatomy.types';

export const PRIMARY_LATERAL: Readonly<Record<PrimaryAnatomyKey, LateralToothArt>> = {

  // ── PRIMARY UPPER ─────────────────────────────────────────────────────

  'primary:upper:central_incisor': {
    crown:
      'M39.5 4.0 C40.6 4.1 41.8 4.6 42.3 5.5 C43.3 7.2 44.1 8.3 44.4 9.5 ' +
      'C44.6 13 44.3 19 44.0 23.0 C43.8 24.7 42.8 26.2 41.7 27.0 ' +
      'C37.5 28.2 27.4 28.2 23.2 27.0 C22.2 26.2 21.0 24.7 20.5 23.0 ' +
      'C20.2 19 19.9 16 19.8 13.5 C20.2 11 20.9 8.5 21.9 6.7 ' +
      'C22.9 5.2 23.9 4.5 25.0 4.3 C29.7 3.9 34.9 3.8 39.5 4.0 Z',
    roots: [
      'M23.2 25.0 C23.0 27.5 23.3 30.5 24.2 34.5 C25.7 41 27.6 49 29.2 56 ' +
        'C29.9 58.8 30.3 61.2 30.6 63.3 C30.9 64.5 31.4 65.0 32.0 65.0 ' +
        'C32.6 65.0 33.1 64.5 33.4 63.3 C33.7 61.2 34.1 58.8 34.8 56 ' +
        'C36.4 49 38.3 41 39.8 34.5 C40.7 30.5 41.0 27.5 41.7 25.0 ' +
        'C38.5 23.0 26.5 23.0 23.2 25.0 Z',
    ],
    surface: 'M24.5 10.5 L40 10 M28.5 4.5 V13 M37 4.3 V13.5',
    cervical: 'M22.5 26.3 C28 28.8 37 28.8 42.5 25.5',
    widthRatio: 1.0,
    sideStrategy: 'mirror',
    simplification:
      'Root apex flattened to a 2.6-unit blunt cap rather than a true fine ' +
      'point; incisal mamelon ridges simplified to two straight grooves. ' +
      'Cervical constriction is drawn tighter than a textbook mean so the ' +
      'bulbous-crown/narrow-neck signature reads clearly at chart size.',
  },

  'primary:upper:lateral_incisor': {
    crown:
      'M39.0 4.0 C39.8 4.1 40.5 4.5 40.8 5.1 C41.6 6.4 41.9 7.9 42.0 9.5 ' +
      'C42.2 13 42.0 18 41.7 21.5 C41.5 23.2 40.6 24.6 39.5 25.5 ' +
      'C36.5 26.3 28.5 26.3 24.9 25.5 C23.8 24.6 22.9 23.2 22.7 21.5 ' +
      'C22.5 19 22.5 15 22.6 13.0 C22.8 10.5 23.4 8.0 24.2 6.5 ' +
      'C25.2 5.2 26.0 4.5 27.0 4.3 C31.0 3.9 35.3 3.8 39.0 4.0 Z',
    roots: [
      'M24.9 23.5 C24.6 29 25.8 38 27.6 47 C29.3 55.5 30.4 62.5 30.8 67.5 ' +
        'C31.0 68.7 31.5 69.0 32.2 69.0 C32.9 69.0 33.4 68.7 33.6 67.5 ' +
        'C34.0 62.5 35.1 55.5 36.8 47 C38.6 38 39.8 29 39.5 23.5 Z',
    ],
    surface: 'M24 10.5 L41 10 M27.5 4.5 V13 M37 4.2 V13.5',
    cervical: 'M23.5 24.8 C28.5 27 35.5 27 40.5 23.8',
    widthRatio: 0.79,
    sideStrategy: 'mirror',
    simplification:
      'Root apex flattened to a 2.8-unit cap; distoincisal rounding ' +
      'simplified to a single smooth curve rather than the subtle ' +
      'double-curvature real primary lateral incisors show.',
  },

  'primary:upper:canine': {
    crown:
      'M36.0 4.0 C37.8 4.5 40.0 6.3 42.0 8.5 C43.4 9.9 44.2 10.5 44.4 11.0 ' +
      'C44.9 13.5 44.9 20 44.1 25.0 C43.7 26.9 43.1 28.2 42.5 29.0 ' +
      'C36.0 30.5 28.0 30.5 22.5 29.0 C21.1 27.4 19.9 26.0 18.5 25.0 ' +
      'C18.0 23 17.7 19 17.8 16.0 C17.4 12.5 18.4 8.6 21.0 6.3 ' +
      'C24.5 4.5 30.5 3.8 36.0 4.0 Z',
    roots: [
      'M22.5 27.0 C22.0 33 23.0 41 24.3 50 C25.8 60 26.9 71 26.7 78 ' +
        'C26.9 79.3 27.4 80.0 28.0 80.0 C28.6 80.0 29.1 79.3 29.3 78.0 ' +
        'C29.5 71 33.0 60 36.5 50 C39.0 41 40.5 33 42.5 27.0 Z',
    ],
    surface: 'M36 4.0 V16 M24 8.5 L36 4.0 L41 12.5',
    cervical: 'M20.5 28.3 C27 30.8 35 30.8 44.5 27',
    widthRatio: 1.08,
    sideStrategy: 'mirror',
    simplification:
      'Root apex flattened to a 3.0-unit cap rather than a true fine point; ' +
      'the mesial marginal-ridge accent real primary canines show is ' +
      'omitted at this scale. Root drawn leaning distally, per real ' +
      'primary canine anatomy.',
  },

  // Three roots, palatal FIRST (painted behind the two buccal roots so the
  // trifurcation reads as depth). Furcation sits ~0.15 of the way from the
  // CEJ to the apex — well above the ~0.3 mark used for permanent molars —
  // and the buccal roots flare outside the crown outline immediately below
  // it. This high furcation plus flare is the primary-molar signature.
  'primary:upper:first_molar': {
    crown:
      'M43.5 4.0 C41 3.6 37.5 4.4 34.8 6.8 C33.5 8.0 32.7 8.3 32.0 8.3 ' +
      'C31.3 8.3 30.5 8.0 29.2 6.8 C26.5 4.4 23 3.8 21 4.6 ' +
      'C17 6.3 15.2 11.8 16.5 17.5 C17.0 18.5 16.9 20 16.8 21.0 ' +
      'C17.2 22.2 19.2 23.1 21.6 23.5 C28 25.0 36 25.0 42.4 23.5 ' +
      'C43.0 23.1 43.4 22.2 43.7 21.0 C43.9 20 44.0 18.5 44.2 17.5 ' +
      'C45.2 12.5 44.5 7 43.5 4.0 Z',
    roots: [
      // Palatal — behind, centred, extends deepest (to APEX_Y). Mild bow so
      // it stays organically curved even though it is mostly hidden.
      'M26.0 21.5 C26.2 24.0 26.3 26.6 26.4 29.2 C26.2 34.5 26.0 40 26.8 47 ' +
        'C27.3 52 28.6 57 30.2 60.0 C30.6 61.1 31.2 61.5 32.0 61.5 ' +
        'C32.8 61.5 33.4 61.1 33.8 60.0 C35.4 57 36.7 52 37.2 47 ' +
        'C38.0 40 37.8 34.5 37.6 29.2 C37.7 26.6 37.8 24.0 38.0 21.5 Z',
      // Mesiobuccal — the divergence signature: the root stays fused with
      // its sibling (near-constant width) from the crown down to the
      // furcation (~29.2, 0.15 of the way to APEX_Y), separates sharply
      // there, reaches its widest spread in the middle third (well outside
      // the crown's own mesial edge of 44.2), then curves back IN toward
      // the midline for a rounded apex — never a straight taper to the tip.
      'M32.0 21.5 C34.0 21.4 41.0 21.3 42.4 21.5 C42.6 24.0 42.7 26.6 42.8 29.2 ' +
        'C44.5 34 46.5 38.5 47.3 43.0 C47.1 47 46.1 51.5 44.7 55.3 ' +
        'C44.0 57.6 43.6 59.0 43.8 60.0 C43.6 61.1 43.1 61.5 42.5 61.5 ' +
        'C41.9 61.5 41.4 61.1 41.2 60.0 C41.4 59.0 41.0 57.6 40.3 55.3 ' +
        'C41.5 51.5 42.5 47 43.5 43.0 C40.0 38.5 34.5 34 33.0 29.2 ' +
        'C33.1 26.6 33.2 24.0 32.0 21.5 Z',
      // Distobuccal — narrower and shallower than the mesiobuccal root, the
      // same fused-trunk-then-diverge pattern.
      'M32.0 21.5 C30.0 21.4 23.0 21.3 21.6 21.5 C21.4 24.0 21.3 26.6 21.2 29.2 ' +
        'C19.5 34 17.5 38.5 16.7 43.0 C16.9 47 17.9 51.5 19.3 55.3 ' +
        'C20.0 57.6 20.4 59.0 20.2 60.0 C20.4 61.1 20.9 61.5 21.5 61.5 ' +
        'C22.1 61.5 22.6 61.1 22.8 60.0 C22.6 59.0 23.0 57.6 23.7 55.3 ' +
        'C22.5 51.5 21.5 47 20.5 43.0 C24.0 38.5 29.5 34 31.0 29.2 ' +
        'C30.9 26.6 30.8 24.0 32.0 21.5 Z',
    ],
    surface: 'M21 4.6 L32 8.3 L43.5 4.0 M29.2 6.8 L32 8.3 L34.8 6.8',
    cervical: 'M20 22.8 C27 25.6 37 25.6 44 21.3',
    widthRatio: 1.13,
    sideStrategy: 'mirror',
    simplification:
      'The true primary upper first molar has an atypical, more ' +
      'premolar-like mesial marginal ridge and occlusal form; simplified ' +
      'here to a generic two-cusp buccal silhouette with a prominent ' +
      'mesiobuccal cervical bulge. Furcation drawn high (~0.15 of root ' +
      'length) with markedly divergent roots, per its deciduous signature.',
  },

  // Closely resembles a (smaller, shorter-rooted) permanent upper first
  // molar, as in real anatomy — but still keeps the high furcation and
  // divergent-root flare that no permanent molar shows. Three roots,
  // palatal first.
  'primary:upper:second_molar': {
    crown:
      'M45.5 4.0 C42.7 3.6 38.7 4.5 35.7 7.1 C34.3 8.4 33.4 8.7 32.0 8.7 ' +
      'C30.6 8.7 29.7 8.4 28.3 7.1 C25.0 4.5 21.0 3.7 18.5 4.7 ' +
      'C14.0 6.6 12.0 12.8 14.9 19.0 C15.3 20.5 15.6 22 15.7 23.0 ' +
      'C15.9 24.3 18.0 25.4 20.3 26.0 C27.5 28.0 36.5 28.0 43.7 26.0 ' +
      'C44.6 24.7 45.5 23.6 45.7 23.0 C45.9 22 46.0 20.5 46.1 19.0 ' +
      'C48.0 13.5 49.5 6.5 45.5 4.0 Z',
    roots: [
      // Palatal — behind, centred, extends deepest (to APEX_Y).
      'M27.0 24.0 C27.1 27.0 27.2 29.9 27.4 32.675 C27.0 38 26.5 44.5 27.2 52 ' +
        'C27.7 58 28.8 64 30.4 68.5 C30.7 69.7 31.3 70.5 32.0 70.5 ' +
        'C32.7 70.5 33.3 69.7 33.6 68.5 C35.2 64 36.3 58 36.8 52 ' +
        'C37.5 44.5 37.0 38 36.6 32.675 C36.8 29.9 36.9 27.0 37.0 24.0 Z',
      // Mesiobuccal — fused with its sibling through the furcation
      // (~32.675, 0.15 of the way to APEX_Y), then separates sharply,
      // reaches widest spread mid-root, then curves back in for a rounded
      // apex.
      'M32.0 24.0 C34.5 23.9 41.0 23.8 43.7 24.0 C43.8 27.0 43.9 29.9 43.9 32.675 ' +
        'C45.5 38 47.8 43 48.6 48.5 C48.3 53 47.0 60 44.8 68.0 ' +
        'C44.6 69.0 44.2 69.5 43.5 69.5 C42.8 69.5 42.4 69.0 42.2 68.0 ' +
        'C40.0 60 38.7 53 38.0 48.5 C38.8 43 36.5 38 33.5 32.675 ' +
        'C33.5 29.9 32.7 27.0 32.0 24.0 Z',
      // Distobuccal — mirrors the mesiobuccal divergence, slightly narrower.
      'M32.0 24.0 C29.5 23.9 23.0 23.8 20.3 24.0 C20.2 27.0 20.1 29.9 20.1 32.675 ' +
        'C18.5 38 16.2 43 15.4 48.5 C15.7 53 17.0 60 19.2 68.0 ' +
        'C19.4 69.0 19.8 69.5 20.5 69.5 C21.2 69.5 21.6 69.0 21.8 68.0 ' +
        'C24.0 60 25.3 53 26.0 48.5 C25.2 43 27.5 38 30.5 32.675 ' +
        'C30.5 29.9 31.3 27.0 32.0 24.0 Z',
    ],
    surface: 'M18.5 4.7 L32 8.7 L45.5 4.0 M28.3 7.1 L32 8.7 L35.7 7.1',
    cervical: 'M18 25.3 C26 28 38 28 46 24.3',
    widthRatio: 1.27,
    sideStrategy: 'mirror',
    simplification:
      'Closely resembles a smaller-scaled permanent upper first molar in ' +
      'silhouette, as in real anatomy; occlusal cusp/groove detail is ' +
      'simplified to the same two-cusp buccal ridge lines used for the ' +
      'surface stroke. Furcation drawn high (~0.15 of root length) with ' +
      'markedly divergent, slender roots flaring outside the crown outline.',
  },

  // ── PRIMARY LOWER ─────────────────────────────────────────────────────

  'primary:lower:central_incisor': {
    crown:
      'M36.0 4.0 C36.9 4.1 37.9 4.9 38.5 6.3 C39.7 7.6 40.1 7.9 40.3 8.5 ' +
      'C40.6 10.5 40.4 13.5 39.6 17.5 C38.9 20.3 38.2 22.0 38.0 23.0 ' +
      'C34.5 24.0 29.5 24.0 26.0 23.0 C25.7 21.7 25.1 19.7 24.6 17.0 ' +
      'C24.0 14.3 23.9 12.7 24.3 11.5 C24.9 9.5 25.9 6.9 27.0 5.5 ' +
      'C27.4 4.8 27.6 4.5 28.0 4.3 C30.5 3.9 33.5 3.8 36.0 4.0 Z',
    roots: [
      'M26.0 21.0 C25.7 25.5 26.5 31.5 27.8 38 C29.3 45.5 30.3 51.5 30.7 55.3 ' +
        'C31.1 56.6 31.5 57.0 32.0 57.0 C32.5 57.0 32.9 56.6 33.3 55.3 ' +
        'C33.7 51.5 34.7 45.5 36.2 38 C37.5 31.5 38.3 25.5 38.0 21.0 Z',
    ],
    surface: 'M25.5 9.5 L38.5 9 M29 4.5 V11 M35 4.2 V11.5',
    cervical: 'M24.5 22.3 C28.5 24.5 35.5 24.5 39.5 21.3',
    widthRatio: 0.65,
    sideStrategy: 'mirror',
    simplification:
      'Smallest tooth in the arch; surface detail simplified to a single ' +
      'incisal ridge line, mamelons omitted as they are not visible at ' +
      'this scale. Root apex flattened to a 2.6-unit cap rather than a ' +
      'true point.',
  },

  'primary:lower:lateral_incisor': {
    crown:
      'M36.5 4.0 C37.4 4.1 38.4 4.9 38.8 5.5 C40.0 7.0 40.6 8.0 40.8 9.0 ' +
      'C41.1 11 40.9 13 40.6 15.0 C39.6 19 38.6 22 37.9 24.0 ' +
      'C34.0 25.3 30.0 25.3 26.2 24.0 C25.5 22.0 25.5 20.0 25.4 18.0 ' +
      'C25.3 15.0 25.2 13.0 25.2 12.0 C25.6 9.5 26.6 7.5 27.2 6.0 ' +
      'C27.8 4.9 27.4 4.5 28.0 4.3 C30.7 3.9 34.1 3.8 36.5 4.0 Z',
    roots: [
      'M26.2 22.0 C25.9 27 26.7 33.5 28.0 40.5 C29.6 49 30.7 55.5 30.7 58.3 ' +
        'C31.0 59.5 31.6 60.0 32.05 60.0 C32.5 60.0 33.1 59.5 33.4 58.3 ' +
        'C33.4 55.5 34.5 49 36.1 40.5 C37.4 33.5 38.2 27 37.9 22.0 Z',
    ],
    surface: 'M25.5 10.5 L40 10 M28.5 4.5 V12 M36 4.2 V12.5',
    cervical: 'M24.5 23.3 C29 25.5 35.5 25.5 39.5 22.2',
    widthRatio: 0.63,
    sideStrategy: 'mirror',
    simplification:
      'Root apex flattened to a 2.8-unit cap; only mesiodistal proportion ' +
      'and cervical constriction are otherwise modelled at this scale.',
  },

  'primary:lower:canine': {
    crown:
      'M34.0 4.0 C35.9 4.6 38.0 5.9 39.5 7.2 C40.9 8.1 41.7 8.0 42.0 8.0 ' +
      'C42.5 9.7 42.6 11.7 42.4 13.5 C41.7 19 40.4 23.5 39.3 27.0 ' +
      'C34.5 28.5 29.5 28.5 25.0 27.0 C24.0 24 22.9 21.5 22.9 20.0 ' +
      'C22.7 17.5 22.6 15 23.0 13.0 C23.5 10.5 24.3 8.5 25.8 6.7 ' +
      'C27.6 5.3 30.1 4.4 34.0 4.0 Z',
    roots: [
      'M25.0 25.0 C24.2 32 25.0 41 26.4 50 C27.9 59 27.3 66 26.0 69.0 ' +
        'C26.2 70.3 26.8 71.0 27.5 71.0 C28.2 71.0 28.8 70.3 29.0 69.0 ' +
        'C29.7 66 34.0 59 36.5 50 C39.0 41 39.8 32 39.3 25.0 Z',
    ],
    surface: 'M34 4.0 V14 M26 8 L34 4.0 L38 11',
    cervical: 'M23.5 26.3 C28.5 28.7 35.5 28.7 41 24.8',
    widthRatio: 0.77,
    sideStrategy: 'mirror',
    simplification:
      'Root apex flattened to a 3.0-unit cap; the mesial marginal-ridge ' +
      'accent is omitted at this scale, consistent with the other primary ' +
      'canines in this registry. Root drawn leaning distally.',
  },

  // Two roots, widely divergent — the mesiobuccal cusp bulge that makes this
  // tooth the least "adult-looking" of the primary set is simplified to a
  // widened mesial outline, as in the R2 predecessor, but the furcation is
  // now drawn correctly high and the roots flare outside the crown.
  'primary:lower:first_molar': {
    crown:
      'M42.0 4.0 C39.5 3.6 35.8 4.5 33.0 7.0 C32.5 7.6 32.2 7.8 32.0 7.8 ' +
      'C31.8 7.8 31.5 7.6 31.0 7.0 C28.2 4.5 24.5 3.7 22.0 4.6 ' +
      'C17.5 6.4 15.2 11.8 17.7 17.0 C18.1 18.5 18.2 21 18.25 23.0 ' +
      'C18.3 24.5 19.7 26.0 21.35 27.0 C28 29.0 36 29.0 43.35 27.0 ' +
      'C44.0 26.0 45.4 24.5 46.45 23.0 C46.5 21 46.8 18.5 47.0 17.0 ' +
      'C48.4 11.8 46.3 6.4 42.0 4.0 Z',
    roots: [
      // Mesial — broader; stays fused with the distal root (near-constant
      // width) from the crown down to the furcation (~32.55, 0.15 of the
      // way to APEX_Y), then separates sharply, reaches its widest spread
      // mid-root, then curves sharply back in — the "distal curve at the
      // apex" real primary mesial roots show — to a rounded,
      // distally-leaning tip.
      'M32.35 25.0 C34.5 24.9 41.0 24.8 43.35 25.0 C43.4 27.5 43.45 30.0 43.5 32.55 ' +
        'C45.0 37 46.8 41.5 47.85 45.0 C47.6 49.5 46.4 55.5 44.5 61.0 ' +
        'C43.6 62.7 42.2 63.5 41.5 64.0 C40.9 63.5 40.2 62.7 40.5 61.0 ' +
        'C41.8 55.5 42.8 49.5 43.0 45.0 C41.9 41.5 40.1 37 33.0 32.55 ' +
        'C33.0 30.0 32.7 27.5 32.35 25.0 Z',
      // Distal — narrower, straighter, shallower apex; same fused-then-
      // diverge pattern at the high furcation.
      'M32.35 25.0 C30.2 24.9 23.7 24.8 21.35 25.0 C21.25 27.5 21.2 30.0 21.2 32.55 ' +
        'C19.0 37 17.2 41.5 16.85 45.0 C17.2 49.5 18.2 54.5 18.7 59.5 ' +
        'C18.9 60.3 19.4 61.0 20.0 61.0 C20.6 61.0 21.1 60.3 21.3 59.5 ' +
        'C21.8 54.5 22.8 49.5 23.15 45.0 C24.3 41.5 25.7 37 23.5 32.55 ' +
        'C23.5 30.0 27.8 27.5 32.35 25.0 Z',
    ],
    surface: 'M22 4.6 L32 7.8 L42 4.0 M31.0 7.0 L32 7.8 L33.0 7.0',
    cervical: 'M19.5 26.3 C27 28.8 37.5 28.8 45 25.3',
    widthRatio: 1.19,
    sideStrategy: 'mirror',
    simplification:
      'The distinctive mesiobuccal cusp bulge and prominent mesial ' +
      'marginal ridge of this tooth — its most atypical, least ' +
      'permanent-tooth-like feature — are simplified to a widened mesial ' +
      'crown outline rather than a separate cusp shape. Furcation drawn ' +
      'high (~0.15 of root length); the mesial root shows a slight distal ' +
      'curve at its apex, the distal root is narrower and straighter.',
  },

  // Closely resembles a (smaller, shorter-rooted) permanent lower first
  // molar, as in real anatomy — the widest tooth in the whole primary
  // registry. Two widely divergent roots.
  'primary:lower:second_molar': {
    crown:
      'M48.0 4.0 C45.0 3.6 40.0 4.7 36.5 7.6 C34.8 9.0 33.2 9.2 32.0 9.2 ' +
      'C30.8 9.2 29.2 9.0 27.5 7.6 C24.0 4.7 19.0 3.6 16.0 4.8 ' +
      'C11.0 6.9 10.4 12.8 13.2 18.0 C13.5 19.5 13.7 20.4 13.9 21.0 ' +
      'C14.1 22.5 15.8 24.2 17.9 25.0 C25 27.3 39 27.3 46.1 25.0 ' +
      'C46.9 23.2 48.7 22 50.1 21.0 C50.3 20.4 50.6 19.5 50.8 18.0 ' +
      'C53.6 12.8 53.0 6.9 48.0 4.0 Z',
    roots: [
      // Mesial — broadest root in the registry; stays fused with the
      // distal root through the furcation (~31.45, 0.15 of the way to
      // APEX_Y), separates sharply, reaches its widest spread mid-root well
      // outside the crown, then curves back in with a distal lean at its
      // rounded apex.
      'M32.0 23.0 C36.0 22.9 42.5 22.8 46.1 23.0 C46.15 25.8 46.2 28.6 46.3 31.45 ' +
        'C48.5 36 50.8 40 52.0 44.0 C51.5 50 49.8 57 48.5 63.0 ' +
        'C47.4 65.0 46.0 66.5 45.0 68.0 C44.0 66.5 43.4 65.0 44.5 63.0 ' +
        'C45.5 57 44.5 50 43.5 44.0 C42.3 40 39.9 36 33.5 31.45 ' +
        'C33.6 28.6 32.8 25.8 32.0 23.0 Z',
      // Distal — narrower, straighter, shallower apex; same fused-then-
      // diverge pattern.
      'M32.0 23.0 C28.0 22.9 21.5 22.8 17.9 23.0 C17.85 25.8 17.8 28.6 17.7 31.45 ' +
        'C15.5 36 13.2 40 12.0 44.0 C12.5 49.5 13.0 57 13.5 62.0 ' +
        'C13.7 63.2 14.3 64.0 15.0 64.0 C15.7 64.0 16.3 63.2 16.5 62.0 ' +
        'C17.0 57 17.5 49.5 20.0 44.0 C21.2 40 23.6 36 30.5 31.45 ' +
        'C30.4 28.6 31.2 25.8 32.0 23.0 Z',
    ],
    surface: 'M17 5 L32 9.2 L47 4 M25 7.6 L32 9.2 L37 7.5',
    cervical: 'M15.5 26.3 C25 29 39.5 29 47.5 25.3',
    widthRatio: 1.53,
    sideStrategy: 'mirror',
    simplification:
      "This tooth's silhouette closely follows the permanent lower first " +
      'molar it precedes, as in real anatomy; occlusal groove pattern ' +
      'differences between the two teeth are not modelled at this scale. ' +
      'Furcation drawn high (~0.15 of root length); the mesial root is ' +
      'broader with a slight distal curve at its apex, the distal root ' +
      'narrower and straighter.',
  },
};

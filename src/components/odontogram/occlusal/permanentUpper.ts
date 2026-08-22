/**
 * occlusal/permanentUpper.ts — DENTAL-CHART-ASSET-R3
 *
 * One author-owned slice of the OCCLUSAL_ART registry. Split out of the
 * single 700-line module so the R3 asset lanes can rewrite disjoint files in
 * parallel without conflicting. The orientation contract, the path-command
 * subset and the surface-tiling scheme are unchanged and are documented in
 * anatomy.types.ts and design/dental-chart/AUTHORING.md — read those before
 * touching a coordinate here.
 */

import type { PermanentUpperKey, OcclusalToothArt } from '../anatomy.types';

export const PERMANENT_UPPER_OCCLUSAL: Readonly<Record<PermanentUpperKey, OcclusalToothArt>> = {
  // ============================================================
  // PERMANENT — UPPER
  // ============================================================

  /**
   * Upper central incisor. Wide labiolingual wedge; mesioincisal angle
   * sharper (tighter distal-edge point) than the more rounded distoincisal
   * angle; pronounced lingual cingulum bulge. `central` = incisal-edge band.
   */
  'permanent:upper:central_incisor': {
    outline: 'M21 27 C23.5 25.2 29 23.3 33 23 C37 22.7 43.2 23.5 45 25 C46.8 26.5 44.3 29.8 44 32 C43.7 34.2 45.2 36 43 38 C40.8 40 35 43.7 31 44 C27 44.3 21.2 41.7 19 40 C16.8 38.3 17.7 36.2 18 34 C18.3 31.8 18.5 28.8 21 27 Z',
    surfaces: {
      mesial: 'M45 25 C46.8 26.5 44.3 29.8 44 32 C43.7 34.2 45.2 36 43 38 L38 35 L40 28 Z',
      distal: 'M19 40 C16.8 38.3 17.7 36.2 18 34 C18.3 31.8 18.5 28.8 21 27 L26 29 L25 36 Z',
      buccal: 'M21 27 C23.5 25.2 29 23.3 33 23 C37 22.7 43.2 23.5 45 25 L40 28 L26 29 Z',
      lingual: 'M43 38 C40.8 40 35 43.7 31 44 C27 44.3 21.2 41.7 19 40 L25 36 L38 35 Z',
      central: 'M26 29 L40 28 L38 35 L25 36 Z',
    },
    detail: 'M25 28 L41 27 M30 27 L30 29 M35 27 L35 29 M27 37 L31 42 L36 36',
    sideStrategy: 'mirror',
    simplification:
      'Mamelon ridges shown as two short marks rather than three distinct scallops; incisal edge drawn straight rather than with its slight natural curvature.',
  },

  /**
   * Upper lateral incisor. Same wedge/cingulum pattern as the central,
   * scaled down and narrowed — deliberately smaller than the central so the
   * pair is not just two copies of one shape.
   */
  'permanent:upper:lateral_incisor': {
    outline: 'M23 28 C25 26.3 29 25.3 32 25 C35 24.7 39.7 24.8 41 26 C42.3 27.2 40.3 30 40 32 C39.7 34 40.7 36 39 38 C37.3 40 33 43.5 30 44 C27 44.5 22.7 42.5 21 41 C19.3 39.5 19.7 37.2 20 35 C20.3 32.8 21 29.7 23 28 Z',
    surfaces: {
      mesial: 'M41 26 C42.3 27.2 40.3 30 40 32 C39.7 34 40.7 36 39 38 L35 35 L37 29 Z',
      distal: 'M21 41 C19.3 39.5 19.7 37.2 20 35 C20.3 32.8 21 29.7 23 28 L27 30 L26 37 Z',
      buccal: 'M23 28 C25 26.3 29 25.3 32 25 C35 24.7 39.7 24.8 41 26 L37 29 L27 30 Z',
      lingual: 'M39 38 C37.3 40 33 43.5 30 44 C27 44.5 22.7 42.5 21 41 L26 37 L35 35 Z',
      central: 'M27 30 L37 29 L35 35 L26 37 Z',
    },
    detail: 'M27 29 L37 28 M30 39 L32 41 L34 39',
    sideStrategy: 'mirror',
    simplification:
      'Lingual (cingulum) pit sketched as a shallow notch rather than a true pit; mamelon detail omitted, as laterals are usually charted with an already-smoothed incisal edge.',
  },

  /**
   * Upper canine. Diamond/rhomboid outline from the incisal aspect; cusp
   * tip (on the buccal edge) displaced toward mesial, giving a short mesial
   * cusp ridge and a longer distal one; lingual cingulum bulge.
   */
  'permanent:upper:canine': {
    outline: 'M22 30 C25.2 27.3 34 20.7 38 20 C42 19.3 44.8 23.8 46 26 C47.2 28.2 45.3 30.7 45 33 C44.7 35.3 46.2 37.8 44 40 C41.8 42.2 36 45.7 32 46 C28 46.3 22.2 43.7 20 42 C17.8 40.3 18.7 38 19 36 C19.3 34 18.8 32.7 22 30 Z',
    surfaces: {
      mesial: 'M46 26 C47.2 28.2 45.3 30.7 45 33 C44.7 35.3 46.2 37.8 44 40 L38 37 L39 29 Z',
      distal: 'M20 42 C17.8 40.3 18.7 38 19 36 C19.3 34 18.8 32.7 22 30 L27 32 L26 38 Z',
      buccal: 'M22 30 C25.2 27.3 34 20.7 38 20 C42 19.3 44.8 23.8 46 26 L39 29 L27 32 Z',
      lingual: 'M44 40 C41.8 42.2 36 45.7 32 46 C28 46.3 22.2 43.7 20 42 L26 38 L38 37 Z',
      central: 'M27 32 L39 29 L38 37 L26 38 Z',
    },
    detail: 'M38 20 L46 26 M38 20 L22 30 M32 30 L32 44',
    sideStrategy: 'mirror',
    simplification:
      'Cusp ridges drawn as straight facets; the lingual ridge dividing the mesial and distal lingual fossae simplified to a single straight stroke.',
  },

  /**
   * Upper first premolar. Oval, longer buccolingually than mesiodistally;
   * more angular/hexagonal outline than the second premolar; mesial
   * marginal groove shown as an indent on the mesial edge. 2 cusps (buccal
   * larger/sharper, palatal smaller), single mesiodistal central groove.
   */
  'permanent:upper:first_premolar': {
    outline: 'M21 20 C23.2 16.7 28.3 15.3 32 15 C35.7 14.7 41.7 14.8 43 18 C44.3 21.2 40.3 29 40 34 C39.7 39 42.7 45 41 48 C39.3 51 33.5 51.8 30 52 C26.5 52.2 21.8 51.8 20 49 C18.2 46.2 18.8 39.8 19 35 C19.2 30.2 18.8 23.3 21 20 Z',
    surfaces: {
      mesial: 'M43 18 C44.3 21.2 40.3 29 40 34 C39.7 39 42.7 45 41 48 L36 41 L38 25 Z',
      distal: 'M20 49 C18.2 46.2 18.8 39.8 19 35 C19.2 30.2 18.8 23.3 21 20 L25 26 L25 42 Z',
      buccal: 'M21 20 C23.2 16.7 28.3 15.3 32 15 C35.7 14.7 41.7 14.8 43 18 L38 25 L25 26 Z',
      lingual: 'M41 48 C39.3 51 33.5 51.8 30 52 C26.5 52.2 21.8 51.8 20 49 L25 42 L36 41 Z',
      central: 'M25 26 L38 25 L36 41 L25 42 Z',
    },
    detail: 'M40 33 L20 34 M40 33 L37 29 M20 34 L23 41',
    sideStrategy: 'mirror',
    simplification:
      'Cusp-ridge triangulation reduced to short marks; the crescentic mesial marginal groove is simplified to a single indent on the outline rather than a separate incised line.',
  },

  /**
   * Upper second premolar. Rounder/more oval than the first premolar, two
   * more evenly-sized cusps, simpler occlusal table.
   */
  'permanent:upper:second_premolar': {
    outline: 'M22 21 C24.2 17.8 29.5 17.2 33 17 C36.5 16.8 41.5 17.3 43 20 C44.5 22.7 42.3 28.5 42 33 C41.7 37.5 42.8 44.2 41 47 C39.2 49.8 34.3 49.8 31 50 C27.7 50.2 22.8 50.3 21 48 C19.2 45.7 19.8 40.5 20 36 C20.2 31.5 19.8 24.2 22 21 Z',
    surfaces: {
      mesial: 'M43 20 C44.5 22.7 42.3 28.5 42 33 C41.7 37.5 42.8 44.2 41 47 L36 41 L38 26 Z',
      distal: 'M21 48 C19.2 45.7 19.8 40.5 20 36 C20.2 31.5 19.8 24.2 22 21 L26 27 L26 42 Z',
      buccal: 'M22 21 C24.2 17.8 29.5 17.2 33 17 C36.5 16.8 41.5 17.3 43 20 L38 26 L26 27 Z',
      lingual: 'M41 47 C39.2 49.8 34.3 49.8 31 50 C27.7 50.2 22.8 50.3 21 48 L26 42 L36 41 Z',
      central: 'M26 27 L38 26 L36 41 L26 42 Z',
    },
    detail: 'M39 32 L22 33 M32 27 L32 29 M31 40 L31 42',
    sideStrategy: 'mirror',
    simplification:
      'Supplemental grooves omitted — drawn with a simple central groove and two pits only, consistent with its smoother, more oval occlusal table.',
  },

  /**
   * Upper first molar. Rhomboidal outline (4 corners, sharp at
   * mesiobuccal/distolingual, blunter at distobuccal/mesiolingual). 4 main
   * cusps + the oblique ridge (its signature feature, mesiobuccal to
   * distopalatal) crossing the central fossa; a minor accessory mark for
   * the cusp of Carabelli on the mesiopalatal cusp.
   */
  'permanent:upper:first_molar': {
    outline: 'M18 20 C20.3 17.3 23.3 17.7 27 16 C30.7 14.3 36.5 10.5 40 10 C43.5 9.5 47.3 9.5 48 13 C48.7 16.5 44.3 24.8 44 31 C43.7 37.2 46.7 46.2 46 50 C45.3 53.8 43.7 54.2 40 54 C36.3 53.8 28.2 50.7 24 49 C19.8 47.3 16.8 46.8 15 44 C13.2 41.2 12.5 36 13 32 C13.5 28 15.7 22.7 18 20 Z',
    surfaces: {
      mesial: 'M48 13 C48.7 16.5 44.3 24.8 44 31 C43.7 37.2 46.7 46.2 46 50 L40 44 L42 23 Z',
      distal: 'M15 44 C13.2 41.2 12.5 36 13 32 C13.5 28 15.7 22.7 18 20 L26 28 L25 40 Z',
      buccal: 'M18 20 C20.3 17.3 23.3 17.7 27 16 C30.7 14.3 36.5 10.5 40 10 C43.5 9.5 47.3 9.5 48 13 L42 23 L26 28 Z',
      lingual: 'M46 50 C45.3 53.8 43.7 54.2 40 54 C36.3 53.8 28.2 50.7 24 49 C19.8 47.3 16.8 46.8 15 44 L25 40 L40 44 Z',
      central: 'M26 28 L42 23 L40 44 L25 40 Z',
    },
    detail:
      'M40 12 L34 26 L27 44 M30 22 L36 40 M22 22 L27 27 M38 42 L43 47 M42 52 L44 50',
    sideStrategy: 'mirror',
    simplification:
      'Carabelli cusp rendered as one short accessory mark on the mesiolingual cusp rather than an added occlusal facet; fissure pattern idealised to four principal grooves instead of the full anastomosing pattern.',
  },

  /**
   * Upper second molar. Same rhomboidal family as the first molar but the
   * distolingual cusp is drawn much reduced (outline visibly more
   * heart-shaped/compressed on that corner); shorter, more crowded oblique
   * ridge.
   */
  'permanent:upper:second_molar': {
    outline: 'M19 22 C21 19.7 24.7 19.7 28 18 C31.3 16.3 36 12.5 39 12 C42 11.5 45.3 12 46 15 C46.7 18 43.3 24.5 43 30 C42.7 35.5 44.8 44.5 44 48 C43.2 51.5 41 51.2 38 51 C35 50.8 29.3 48 26 47 C22.7 46 19.7 47.5 18 45 C16.3 42.5 15.8 35.8 16 32 C16.2 28.2 17 24.3 19 22 Z',
    surfaces: {
      mesial: 'M46 15 C46.7 18 43.3 24.5 43 30 C42.7 35.5 44.8 44.5 44 48 L38 42 L40 24 Z',
      distal: 'M18 45 C16.3 42.5 15.8 35.8 16 32 C16.2 28.2 17 24.3 19 22 L26 29 L25 39 Z',
      buccal: 'M19 22 C21 19.7 24.7 19.7 28 18 C31.3 16.3 36 12.5 39 12 C42 11.5 45.3 12 46 15 L40 24 L26 29 Z',
      lingual: 'M44 48 C43.2 51.5 41 51.2 38 51 C35 50.8 29.3 48 26 47 C22.7 46 19.7 47.5 18 45 L25 39 L38 42 Z',
      central: 'M26 29 L40 24 L38 42 L25 39 Z',
    },
    detail: 'M39 14 L33 26 L27 40 M29 24 L34 38 M23 24 L28 28',
    sideStrategy: 'mirror',
    simplification:
      'Distolingual cusp drawn much reduced with no separate fissure branch, per typical second-molar morphology; overall fissure pattern simplified to three strokes.',
  },

  /**
   * Upper third molar. Markedly reduced, heart-shaped, rounder outline;
   * buccal cusps drawn fused rather than distinct; no coherent oblique
   * ridge; irregular fissure marks rather than a defined pattern.
   */
  'permanent:upper:third_molar': {
    outline: 'M23 26 C25 24 29.7 23 33 22 C36.3 21 41.7 18.3 43 20 C44.3 21.7 41.3 27.7 41 32 C40.7 36.3 42.5 43.2 41 46 C39.5 48.8 35.2 49.3 32 49 C28.8 48.7 23.8 46.5 22 44 C20.2 41.5 20.8 37 21 34 C21.2 31 21 28 23 26 Z',
    surfaces: {
      mesial: 'M43 20 C44.3 21.7 41.3 27.7 41 32 C40.7 36.3 42.5 43.2 41 46 L36 40 L37 27 Z',
      distal: 'M22 44 C20.2 41.5 20.8 37 21 34 C21.2 31 21 28 23 26 L28 30 L27 39 Z',
      buccal: 'M23 26 C25 24 29.7 23 33 22 C36.3 21 41.7 18.3 43 20 L37 27 L28 30 Z',
      lingual: 'M41 46 C39.5 48.8 35.2 49.3 32 49 C28.8 48.7 23.8 46.5 22 44 L27 39 L36 40 Z',
      central: 'M28 30 L37 27 L36 40 L27 39 Z',
    },
    detail: 'M33 25 L30 33 M36 30 L33 38 M28 35 L32 40',
    sideStrategy: 'mirror',
    simplification:
      'Crown drawn heart-shaped with fused, irregular cusps and no coherent oblique ridge, reflecting its typically reduced, variable morphology; fissure pattern is illustrative rather than a specific tooth.',
  },
};

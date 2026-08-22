/**
 * occlusal/permanentUpper.ts — DENTAL-CHART-ASSET-R3
 *
 * One author-owned slice of the OCCLUSAL_ART registry. Split out of the
 * single 700-line module so the R3 asset lanes can rewrite disjoint files in
 * parallel without conflicting. The orientation contract, the path-command
 * subset and the surface-tiling scheme are unchanged and are documented in
 * anatomy.types.ts and design/dental-chart/AUTHORING.md — read those before
 * touching a coordinate here.
 *
 * R3 LANE C REWRITE: every entry below was regenerated from the AUTHORING.md
 * §2.2 permanent occlusal footprint table (MD x-extent / BL y-extent) rather
 * than freehand — the R2 predecessor drew every tooth into roughly the same
 * ~24x18 box, so a central incisor and a first molar had almost the same
 * footprint once cropped by the shared renderer window. Each outline here is
 * built from four named outer corners (DB/MB/ML/DL — see occlusalGeometry.ts)
 * walked as a closed Catmull-Rom-to-Bezier loop, so the crown reads as an
 * actual family-specific silhouette (rhomboidal molar, oval premolar,
 * anterior wedge, etc.) instead of a rounded blob, and the five surfaces are
 * built from the SAME edge-curve strings as the outline (byte-identical), so
 * they tile it exactly with no gap or overlap.
 */

import type { PermanentUpperKey, OcclusalToothArt } from '../anatomy.types';

export const PERMANENT_UPPER_OCCLUSAL: Readonly<Record<PermanentUpperKey, OcclusalToothArt>> = {
  // ============================================================
  // PERMANENT — UPPER
  // ============================================================

  /**
   * Upper central incisor. Wide labiolingual wedge; mesioincisal angle
   * sharper (tighter distal-edge point) than the more rounded distoincisal
   * angle; pronounced lingual cingulum bulge, offset slightly mesial.
   * `central` = incisal-edge band.
   */
  'permanent:upper:central_incisor': {
    outline: 'M14.3 21.8 C16.8 18.4 26.5 17.8 32.5 17.4 C38.5 17.0 48.4 15.2 50.3 19.1 C52.2 23.0 46.8 36.2 44.0 40.9 C41.3 45.6 38.2 47.8 33.8 47.3 C29.4 46.8 21.0 42.3 17.7 38.0 C14.5 33.8 11.8 25.2 14.3 21.8 Z',
    surfaces: {
      mesial: 'M50.3 19.1 C52.2 23.0 46.8 36.2 44.0 40.9 L36.7 31.1 L38.6 23.3 Z',
      distal: 'M17.7 38.0 C14.5 33.8 11.8 25.2 14.3 21.8 L25.0 24.7 L26.4 30.1 Z',
      buccal: 'M14.3 21.8 C16.8 18.4 26.5 17.8 32.5 17.4 C38.5 17.0 48.4 15.2 50.3 19.1 L38.6 23.3 L25.0 24.7 Z',
      lingual: 'M44.0 40.9 C41.3 45.6 38.2 47.8 33.8 47.3 C29.4 46.8 21.0 42.3 17.7 38.0 L26.4 30.1 L36.7 31.1 Z',
      central: 'M25.0 24.7 L38.6 23.3 L36.7 31.1 L26.4 30.1 Z',
    },
    detail: 'M24.0 18.4 L42.3 17.6 M28.9 17.9 L28.9 22.3 M36.2 17.4 L36.2 21.8 M26.4 39.5 L31.3 45.4 L37.4 39.0',
    sideStrategy: 'mirror',
    simplification:
      'Mamelon ridges shown as two short marks rather than three distinct scallops; incisal edge drawn as a gentle single curve rather than with its slight natural scalloping.',
  },

  /**
   * Upper lateral incisor. Same wedge/cingulum family as the central, but
   * deliberately smaller and narrower on both axes so the pair reads as two
   * different teeth, not two copies of one shape.
   */
  'permanent:upper:lateral_incisor': {
    outline: 'M18.4 23.5 C20.3 20.6 27.8 19.9 32.4 19.5 C37.0 19.1 44.5 17.7 46.0 21.0 C47.5 24.4 43.3 35.6 41.2 39.6 C39.1 43.6 36.9 45.5 33.6 45.1 C30.3 44.7 23.8 40.7 21.3 37.1 C18.8 33.5 16.5 26.4 18.4 23.5 Z',
    surfaces: {
      mesial: 'M46.0 21.0 C47.5 24.4 43.3 35.6 41.2 39.6 L35.5 31.0 L37.2 24.7 Z',
      distal: 'M21.3 37.1 C18.8 33.5 16.5 26.4 18.4 23.5 L27.0 26.0 L28.2 30.5 Z',
      buccal: 'M18.4 23.5 C20.3 20.6 27.8 19.9 32.4 19.5 C37.0 19.1 44.5 17.7 46.0 21.0 L37.2 24.7 L27.0 26.0 Z',
      lingual: 'M41.2 39.6 C39.1 43.6 36.9 45.5 33.6 45.1 C30.3 44.7 23.8 40.7 21.3 37.1 L28.2 30.5 L35.5 31.0 Z',
      central: 'M27.0 26.0 L37.2 24.7 L35.5 31.0 L28.2 30.5 Z',
    },
    detail: 'M25.8 20.5 L40.1 20.0 M29.3 38.6 L32.9 43.1 L36.5 38.1',
    sideStrategy: 'mirror',
    simplification:
      'Lingual (cingulum) pit sketched as a shallow bulge rather than a true pit; mamelon detail omitted, as laterals are usually charted with an already-smoothed incisal edge.',
  },

  /**
   * Upper canine. Rounded diamond from the incisal aspect; labial cusp tip
   * displaced mesially off the crown midline (shorter mesial slope, longer
   * distal slope); lingual cingulum bulge.
   */
  'permanent:upper:canine': {
    outline: 'M16.6 27.6 C19.5 23.0 32.0 14.6 37.3 14.4 C42.6 14.2 47.2 21.4 48.3 26.3 C49.4 31.3 46.4 40.2 43.9 44.1 C41.4 48.0 37.0 49.9 33.0 49.6 C29.0 49.3 22.6 45.8 19.9 42.1 C17.2 38.4 13.7 32.2 16.6 27.6 Z',
    surfaces: {
      mesial: 'M48.3 26.3 C49.4 31.3 46.4 40.2 43.9 44.1 L36.7 37.3 L38.4 29.3 Z',
      distal: 'M19.9 42.1 C17.2 38.4 13.7 32.2 16.6 27.6 L26.2 30.2 L27.5 36.4 Z',
      buccal: 'M16.6 27.6 C19.5 23.0 32.0 14.6 37.3 14.4 C42.6 14.2 47.2 21.4 48.3 26.3 L38.4 29.3 L26.2 30.2 Z',
      lingual: 'M43.9 44.1 C41.4 48.0 37.0 49.9 33.0 49.6 C29.0 49.3 22.6 45.8 19.9 42.1 L27.5 36.4 L36.7 37.3 Z',
      central: 'M26.2 30.2 L38.4 29.3 L36.7 37.3 L27.5 36.4 Z',
    },
    detail: 'M37.3 14.4 L48.3 26.3 M37.3 14.4 L16.6 27.6 M31.9 27.6 L31.9 45.2',
    sideStrategy: 'mirror',
    simplification:
      'Cusp ridges drawn as straight facets to the corners; the lingual ridge dividing the mesial and distal lingual fossae simplified to a single straight stroke.',
  },

  /**
   * Upper first premolar. Oval, longer buccolingually than mesiodistally;
   * buccal cusp tip slightly distal of centre; mesial marginal-ridge
   * developmental groove shown as an inward notch on the mesial edge (this
   * premolar only). 2 cusps, single central groove.
   */
  'permanent:upper:first_premolar': {
    outline: 'M17.2 22.7 C18.8 16.6 24.9 12.0 29.9 12.2 C34.9 12.4 44.9 19.9 47.0 23.6 C49.1 27.3 43.2 30.2 42.5 34.2 C41.8 38.3 44.6 45.1 42.9 47.9 C41.2 50.7 36.0 51.0 32.2 51.1 C28.4 51.3 22.6 53.5 20.1 48.8 C17.6 44.1 15.6 28.8 17.2 22.7 Z',
    surfaces: {
      mesial: 'M47.0 23.6 C49.1 27.3 43.2 30.2 42.5 34.2 C41.8 38.3 44.6 45.1 42.9 47.9 L36.2 40.1 L37.6 27.8 Z',
      distal: 'M20.1 48.8 C17.6 44.1 15.6 28.8 17.2 22.7 L26.4 27.3 L27.3 40.6 Z',
      buccal: 'M17.2 22.7 C18.8 16.6 24.9 12.0 29.9 12.2 C34.9 12.4 44.9 19.9 47.0 23.6 L37.6 27.8 L26.4 27.3 Z',
      lingual: 'M42.9 47.9 C41.2 50.7 36.0 51.0 32.2 51.1 C28.4 51.3 22.6 53.5 20.1 48.8 L27.3 40.6 L36.2 40.1 Z',
      central: 'M26.4 27.3 L37.6 27.8 L36.2 40.1 L27.3 40.6 Z',
    },
    detail: 'M29.9 16.8 L32.2 47.0 M40.7 35.1 L23.7 34.2',
    sideStrategy: 'mirror',
    simplification:
      'Cusp-ridge triangulation reduced to short marks; the crescentic mesial marginal groove is simplified to a single indent on the outline rather than a separate incised line.',
  },

  /**
   * Upper second premolar. Rounder/more oval than the first premolar, two
   * more evenly-sized cusps (no marginal groove notch), simpler occlusal
   * table.
   */
  'permanent:upper:second_premolar': {
    outline: 'M17.9 22.2 C20.2 16.1 27.9 12.1 32.6 12.2 C37.3 12.3 44.3 16.7 46.3 22.7 C48.3 28.7 47.3 43.3 44.9 48.1 C42.5 52.9 36.2 51.2 31.9 51.3 C27.6 51.4 21.2 53.5 18.9 48.6 C16.6 43.8 15.6 28.3 17.9 22.2 Z',
    surfaces: {
      mesial: 'M46.3 22.7 C48.3 28.7 47.3 43.3 44.9 48.1 L37.0 40.4 L37.5 27.2 Z',
      distal: 'M18.9 48.6 C16.6 43.8 15.6 28.3 17.9 22.2 L26.8 26.8 L26.8 40.6 Z',
      buccal: 'M17.9 22.2 C20.2 16.1 27.9 12.1 32.6 12.2 C37.3 12.3 44.3 16.7 46.3 22.7 L37.5 27.2 L26.8 26.8 Z',
      lingual: 'M44.9 48.1 C42.5 52.9 36.2 51.2 31.9 51.3 C27.6 51.4 21.2 53.5 18.9 48.6 L26.8 40.6 L37.0 40.4 Z',
      central: 'M26.8 26.8 L37.5 27.2 L37.0 40.4 L26.8 40.6 Z',
    },
    detail: 'M32.6 17.0 L31.9 46.5 M23.7 32.9 L40.0 32.4',
    sideStrategy: 'mirror',
    simplification:
      'Supplemental grooves omitted — drawn with a simple central groove and two pits only, consistent with its smoother, more oval occlusal table.',
  },

  /**
   * Upper first molar. Rhomboidal outline: the four corners ARE the four
   * cusps (mesiobuccal at MB, distobuccal at DB, mesiolingual at ML,
   * distolingual at DL); MB and DL are drawn acute/protruding, DB and ML
   * obtuse/cut — the classic rhomboid. Oblique ridge runs mesiolingual-to-
   * distobuccal; small accessory mark for the cusp of Carabelli near the
   * mesiolingual cusp.
   */
  'permanent:upper:first_molar': {
    outline: 'M17.2 14.4 C23.8 7.6 47.4 5.1 52.1 11.2 C56.8 17.3 51.9 44.0 45.3 50.8 C38.7 57.6 17.0 58.0 12.3 51.9 C7.6 45.8 10.6 21.2 17.2 14.4 Z',
    surfaces: {
      mesial: 'M52.1 11.2 C56.8 17.3 51.9 44.0 45.3 50.8 L37.2 39.1 L39.5 24.1 Z',
      distal: 'M12.3 51.9 C7.6 45.8 10.6 21.2 17.2 14.4 L24.9 25.2 L24.4 40.1 Z',
      buccal: 'M17.2 14.4 C23.8 7.6 47.4 5.1 52.1 11.2 L39.5 24.1 L24.9 25.2 Z',
      lingual: 'M45.3 50.8 C38.7 57.6 17.0 58.0 12.3 51.9 L24.4 40.1 L37.2 39.1 Z',
      central: 'M24.9 25.2 L39.5 24.1 L37.2 39.1 L24.4 40.1 Z',
    },
    detail: 'M45.3 50.8 L31.7 32.2 L17.2 14.4 M25.9 27.3 L37.6 35.9 M39.5 23.0 L44.4 17.7',
    sideStrategy: 'mirror',
    simplification:
      'Carabelli cusp rendered as one short accessory mark on the mesiolingual cusp rather than an added occlusal facet; fissure pattern idealised to three principal strokes instead of the full anastomosing pattern.',
  },

  /**
   * Upper second molar. Same rhomboidal family as the first molar, but the
   * distolingual corner/cusp is drawn markedly reduced and pulled inward
   * (heart-shaped/compressed on that corner) with a compressing point on the
   * lingual edge; shorter, more crowded oblique ridge.
   */
  'permanent:upper:second_molar': {
    outline: 'M15.3 14.3 C21.1 7.7 45.4 5.0 50.2 11.7 C55.0 18.4 47.8 47.9 43.9 54.2 C40.0 60.5 31.5 50.0 26.7 49.6 C21.9 49.2 17.2 57.5 15.3 51.6 C13.4 45.7 9.5 21.0 15.3 14.3 Z',
    surfaces: {
      mesial: 'M50.2 11.7 C55.0 18.4 47.8 47.9 43.9 54.2 L35.4 41.3 L37.5 25.3 Z',
      distal: 'M15.3 51.6 C13.4 45.7 9.5 21.0 15.3 14.3 L23.7 26.4 L24.2 40.8 Z',
      buccal: 'M15.3 14.3 C21.1 7.7 45.4 5.0 50.2 11.7 L37.5 25.3 L23.7 26.4 Z',
      lingual: 'M43.9 54.2 C40.0 60.5 31.5 50.0 26.7 49.6 C21.9 49.2 17.2 57.5 15.3 51.6 L24.2 40.8 L35.4 41.3 Z',
      central: 'M23.7 26.4 L37.5 25.3 L35.4 41.3 L24.2 40.8 Z',
    },
    detail: 'M43.9 54.2 L29.0 33.6 L15.3 14.3 M34.3 25.9 L38.6 20.7',
    sideStrategy: 'mirror',
    simplification:
      'Distolingual cusp drawn much reduced with no separate fissure branch, per typical second-molar morphology; overall fissure pattern simplified to two strokes.',
  },

  /**
   * Upper third molar. Markedly reduced, heart-shaped, rounder outline than
   * the first/second molars; distolingual corner pulled well inward
   * (effectively three-cusped: mesiobuccal, mesiolingual, and a fused
   * disto-buccolingual mass); buccal cusps drawn fused via a single rounded
   * bulge rather than two distinct corners; no coherent oblique ridge.
   */
  'permanent:upper:third_molar': {
    outline: 'M14.3 15.8 C16.5 9.8 25.8 12.2 31.7 11.8 C37.7 11.4 47.9 7.0 50.0 13.5 C52.1 20.0 49.5 45.1 44.3 50.8 C39.1 56.6 23.6 53.8 18.6 48.0 C13.6 42.2 12.1 21.8 14.3 15.8 Z',
    surfaces: {
      mesial: 'M50.0 13.5 C52.1 20.0 49.5 45.1 44.3 50.8 L35.7 39.3 L37.4 25.3 Z',
      distal: 'M18.6 48.0 C13.6 42.2 12.1 21.8 14.3 15.8 L23.7 26.4 L24.8 38.2 Z',
      buccal: 'M14.3 15.8 C16.5 9.8 25.8 12.2 31.7 11.8 C37.7 11.4 47.9 7.0 50.0 13.5 L37.4 25.3 L23.7 26.4 Z',
      lingual: 'M44.3 50.8 C39.1 56.6 23.6 53.8 18.6 48.0 L24.8 38.2 L35.7 39.3 Z',
      central: 'M23.7 26.4 L37.4 25.3 L35.7 39.3 L24.8 38.2 Z',
    },
    detail: 'M31.4 18.6 L27.1 42.4 M38.6 27.0 L32.8 38.2',
    sideStrategy: 'mirror',
    simplification:
      'Crown drawn heart-shaped with fused, irregular cusps and no coherent oblique ridge, reflecting its typically reduced, variable morphology; fissure pattern is illustrative rather than a specific tooth.',
  },
};

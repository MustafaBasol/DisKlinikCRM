/**
 * occlusal/permanentLower.ts — DENTAL-CHART-ASSET-R3
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
 * footprint once cropped by the shared renderer window; a lower central
 * incisor is now genuinely about half the width of a lower first molar, as
 * the table demands. Each outline here is built from four named outer
 * corners (DB/MB/ML/DL — see occlusalGeometry.ts) walked as a closed
 * Catmull-Rom-to-Bezier loop, so the crown reads as an actual family-specific
 * silhouette (rectangular/pentagonal molar, round premolar, anterior wedge,
 * etc.) instead of a rounded blob, and the five surfaces are built from the
 * SAME edge-curve strings as the outline (byte-identical), so they tile it
 * exactly with no gap or overlap.
 */

import type { PermanentLowerKey, OcclusalToothArt } from '../anatomy.types';

export const PERMANENT_LOWER_OCCLUSAL: Readonly<Record<PermanentLowerKey, OcclusalToothArt>> = {

  // ============================================================
  // PERMANENT — LOWER
  // ============================================================

  /**
   * Lower central incisor. The narrowest tooth in the registry — real
   * mesiodistal asymmetry is minimal (least of any permanent tooth) — drawn
   * nearly, but not exactly, symmetric: the corner offsets differ by roughly
   * a unit so the mirrored left quadrant is not a pixel-identical no-op.
   */
  'permanent:lower:central_incisor': {
    outline: 'M21.4 22.0 C22.7 18.7 28.4 19.3 31.9 19.2 C35.5 19.1 41.4 17.7 42.7 21.2 C44.0 24.7 41.2 36.0 39.5 40.0 C37.8 44.0 35.0 45.4 32.4 45.2 C29.8 45.1 25.7 43.0 23.9 39.1 C22.1 35.2 20.1 25.3 21.4 22.0 Z',
    surfaces: {
      mesial: 'M42.7 21.2 C44.0 24.7 41.2 36.0 39.5 40.0 L34.4 31.3 L35.5 24.9 Z',
      distal: 'M23.9 39.1 C22.1 35.2 20.1 25.3 21.4 22.0 L27.9 25.8 L28.8 30.7 Z',
      buccal: 'M21.4 22.0 C22.7 18.7 28.4 19.3 31.9 19.2 C35.5 19.1 41.4 17.7 42.7 21.2 L35.5 24.9 L27.9 25.8 Z',
      lingual: 'M39.5 40.0 C37.8 44.0 35.0 45.4 32.4 45.2 C29.8 45.1 25.7 43.0 23.9 39.1 L28.8 30.7 L34.4 31.3 Z',
      central: 'M27.9 25.8 L35.5 24.9 L34.4 31.3 L28.8 30.7 Z',
    },
    detail: 'M27.5 20.3 L36.4 19.7 M31.5 20.0 L31.5 22.0',
    sideStrategy: 'mirror',
    simplification:
      'Drawn nearly symmetric mesiodistally, since the real crown has the least mesiodistal asymmetry of any tooth — but still broken so the mirrored left quadrant is not pixel-identical to the right. Mamelons shown as faint marks only.',
  },

  /**
   * Lower lateral incisor. Plain, slightly larger and slightly more
   * asymmetric version of the central incisor wedge.
   */
  'permanent:lower:lateral_incisor': {
    outline: 'M20.5 21.5 C22.0 17.9 28.0 18.3 31.9 18.1 C35.8 17.9 42.3 16.6 43.7 20.3 C45.2 24.1 42.5 36.3 40.6 40.6 C38.7 44.9 35.5 46.4 32.5 46.3 C29.5 46.2 24.7 43.9 22.7 39.8 C20.7 35.7 19.0 25.1 20.5 21.5 Z',
    surfaces: {
      mesial: 'M43.7 20.3 C45.2 24.1 42.5 36.3 40.6 40.6 L34.9 31.6 L36.0 24.0 Z',
      distal: 'M22.7 39.8 C20.7 35.7 19.0 25.1 20.5 21.5 L27.3 25.1 L28.1 31.1 Z',
      buccal: 'M20.5 21.5 C22.0 17.9 28.0 18.3 31.9 18.1 C35.8 17.9 42.3 16.6 43.7 20.3 L36.0 24.0 L27.3 25.1 Z',
      lingual: 'M40.6 40.6 C38.7 44.9 35.5 46.4 32.5 46.3 C29.5 46.2 24.7 43.9 22.7 39.8 L28.1 31.1 L34.9 31.6 Z',
      central: 'M27.3 25.1 L36.0 24.0 L34.9 31.6 L28.1 31.1 Z',
    },
    detail: 'M27.1 19.2 L37.1 18.6',
    sideStrategy: 'mirror',
    simplification:
      "Distal twist of the incisal edge relative to the root (a common lateral-incisor trait) is not modelled at this scale — outline drawn as a plain, slightly larger version of the lower central incisor's wedge.",
  },

  /**
   * Lower canine. Diamond outline, narrower overall than the upper canine;
   * cusp tip on the buccal edge displaced mesially (shorter mesial ridge,
   * longer distal ridge); modest lingual cingulum.
   */
  'permanent:lower:canine': {
    outline: 'M17.5 27.3 C20.1 22.9 31.2 15.7 36.1 15.5 C41.1 15.3 46.2 21.2 47.2 25.9 C48.2 30.6 44.6 40.0 42.1 43.8 C39.6 47.6 35.7 48.8 32.1 48.5 C28.6 48.2 23.2 45.6 20.8 42.1 C18.4 38.6 15.0 31.7 17.5 27.3 Z',
    surfaces: {
      mesial: 'M47.2 25.9 C48.2 30.6 44.6 40.0 42.1 43.8 L35.6 36.7 L37.5 29.2 Z',
      distal: 'M20.8 42.1 C18.4 38.6 15.0 31.7 17.5 27.3 L26.3 29.9 L27.5 36.0 Z',
      buccal: 'M17.5 27.3 C20.1 22.9 31.2 15.7 36.1 15.5 C41.1 15.3 46.2 21.2 47.2 25.9 L37.5 29.2 L26.3 29.9 Z',
      lingual: 'M42.1 43.8 C39.6 47.6 35.7 48.8 32.1 48.5 C28.6 48.2 23.2 45.6 20.8 42.1 L27.5 36.0 L35.6 36.7 Z',
      central: 'M26.3 29.9 L37.5 29.2 L35.6 36.7 L27.5 36.0 Z',
    },
    detail: 'M36.1 15.5 L47.2 25.9 M36.1 15.5 L17.5 27.3 M31.4 28.4 L31.4 43.8',
    sideStrategy: 'mirror',
    simplification:
      'Lingual ridge simplified to a single straight stroke; mesial and distal lingual fossae not drawn separately.',
  },

  /**
   * Lower first premolar. Distinctly asymmetric buccolingually — the lingual
   * cusp is much smaller than the buccal cusp, so the lingual edge/ML-DL
   * corners sit close to the central table instead of projecting out to
   * match the buccal cusp's prominence. Round overall silhouette.
   */
  'permanent:lower:first_premolar': {
    outline: 'M16.8 25.0 C18.1 19.9 27.3 15.4 32.4 15.5 C37.5 15.6 46.3 20.3 47.3 25.4 C48.3 30.5 41.2 42.3 38.6 46.0 C36.0 49.7 34.3 47.6 31.9 47.7 C29.5 47.8 26.9 50.2 24.4 46.4 C21.9 42.6 15.5 30.2 16.8 25.0 Z',
    surfaces: {
      mesial: 'M47.3 25.4 C48.3 30.5 41.2 42.3 38.6 46.0 L35.4 40.1 L37.7 29.2 Z',
      distal: 'M24.4 46.4 C21.9 42.6 15.5 30.2 16.8 25.0 L26.2 28.7 L28.0 40.5 Z',
      buccal: 'M16.8 25.0 C18.1 19.9 27.3 15.4 32.4 15.5 C37.5 15.6 46.3 20.3 47.3 25.4 L37.7 29.2 L26.2 28.7 Z',
      lingual: 'M38.6 46.0 C36.0 49.7 34.3 47.6 31.9 47.7 C29.5 47.8 26.9 50.2 24.4 46.4 L28.0 40.5 L35.4 40.1 Z',
      central: 'M26.2 28.7 L37.7 29.2 L35.4 40.1 L28.0 40.5 Z',
    },
    detail: 'M32.4 19.7 L31.9 42.8 M24.8 35.5 L36.3 36.5',
    sideStrategy: 'mirror',
    simplification:
      'Small mesiolingual groove wrapping the reduced lingual cusp simplified to one short stroke; the true crown tilt (occlusal table facing lingually because the lingual cusp is so much smaller than the buccal one) is implied only by cusp-size asymmetry, not by shading.',
  },

  /**
   * Lower second premolar. Squarer than the first premolar, with two
   * lingual cusps (mesiolingual + distolingual) drawn as two separate
   * bulges on the lingual edge — the classic Y-groove with a buccal cusp —
   * 3 cusps total.
   */
  'permanent:lower:second_premolar': {
    outline: 'M17.1 24.0 C19.0 18.5 27.0 14.3 32.0 14.4 C37.0 14.5 45.2 19.0 47.0 24.4 C48.8 29.8 44.6 42.7 42.8 46.7 C41.0 50.7 38.5 48.2 36.0 48.6 C33.5 49.0 30.3 49.2 27.8 49.0 C25.3 48.8 22.6 51.4 20.8 47.2 C19.0 43.0 15.2 29.5 17.1 24.0 Z',
    surfaces: {
      mesial: 'M47.0 24.4 C48.8 29.8 44.6 42.7 42.8 46.7 L36.2 40.8 L37.6 28.5 Z',
      distal: 'M20.8 47.2 C19.0 43.0 15.2 29.5 17.1 24.0 L26.0 28.1 L27.1 41.0 Z',
      buccal: 'M17.1 24.0 C19.0 18.5 27.0 14.3 32.0 14.4 C37.0 14.5 45.2 19.0 47.0 24.4 L37.6 28.5 L26.0 28.1 Z',
      lingual: 'M42.8 46.7 C41.0 50.7 38.5 48.2 36.0 48.6 C33.5 49.0 30.3 49.2 27.8 49.0 C25.3 48.8 22.6 51.4 20.8 47.2 L27.1 41.0 L36.2 40.8 Z',
      central: 'M26.0 28.1 L37.6 28.5 L36.2 40.8 L27.1 41.0 Z',
    },
    detail: 'M32.0 19.4 L32.0 33.1 M32.0 33.1 L27.8 44.5 M32.0 33.1 L36.0 44.0',
    sideStrategy: 'mirror',
    simplification:
      'Y-groove drawn as three straight branches from a single central pit rather than a curved trifurcation.',
  },

  /**
   * Lower first molar. Pentagonal/rectangular outline, wider mesiodistally
   * than buccolingually. 5 cusps: the extra distal (5th) cusp is drawn as a
   * distinct bulge on the buccal edge between DB and MB, biased toward the
   * distal side. Classic Y-shaped fissure forking from one central pit
   * toward the mesiobuccal groove, the lingual groove and the distal-cusp
   * groove.
   */
  'permanent:lower:first_molar': {
    outline: 'M12.5 13.3 C14.8 6.5 16.9 9.5 23.9 9.9 C30.9 10.3 50.4 8.8 54.4 15.5 C58.4 22.2 55.3 44.3 48.0 50.2 C40.7 56.1 16.3 57.1 10.4 50.9 C4.5 44.8 10.3 20.1 12.5 13.3 Z',
    surfaces: {
      mesial: 'M54.4 15.5 C58.4 22.2 55.3 44.3 48.0 50.2 L37.7 40.1 L40.5 25.6 Z',
      distal: 'M10.4 50.9 C4.5 44.8 10.3 20.1 12.5 13.3 L22.2 24.5 L21.8 40.8 Z',
      buccal: 'M12.5 13.3 C14.8 6.5 16.9 9.5 23.9 9.9 C30.9 10.3 50.4 8.8 54.4 15.5 L40.5 25.6 L22.2 24.5 Z',
      lingual: 'M48.0 50.2 C40.7 56.1 16.3 57.1 10.4 50.9 L21.8 40.8 L37.7 40.1 Z',
      central: 'M22.2 24.5 L40.5 25.6 L37.7 40.1 L21.8 40.8 Z',
    },
    detail: 'M32.9 32.3 L40.5 25.6 M32.9 32.3 L24.3 40.1 M32.9 32.3 L22.6 22.5',
    sideStrategy: 'mirror',
    simplification:
      'Classic Y-fissure idealised as three straight branches from one fork point; supplemental grooves on the distal (5th) cusp are omitted.',
  },

  /**
   * Lower second molar. 4 cusps, square-ish outline (no separate distal
   * cusp — DB/MB sit closer together than the first molar's), cross/+
   * shaped fissure branching from one central pit toward all four cusps.
   */
  'permanent:lower:second_molar': {
    outline: 'M12.9 13.8 C19.3 8.0 46.9 9.1 52.6 15.0 C58.3 20.9 53.3 43.4 46.9 49.2 C40.5 55.0 19.8 55.8 14.1 49.9 C8.4 44.0 6.5 19.6 12.9 13.8 Z',
    surfaces: {
      mesial: 'M52.6 15.0 C58.3 20.9 53.3 43.4 46.9 49.2 L37.9 39.1 L40.1 24.5 Z',
      distal: 'M14.1 49.9 C8.4 44.0 6.5 19.6 12.9 13.8 L22.9 24.0 L23.4 39.6 Z',
      buccal: 'M12.9 13.8 C19.3 8.0 46.9 9.1 52.6 15.0 L40.1 24.5 L22.9 24.0 Z',
      lingual: 'M46.9 49.2 C40.5 55.0 19.8 55.8 14.1 49.9 L23.4 39.6 L37.9 39.1 Z',
      central: 'M22.9 24.0 L40.1 24.5 L37.9 39.1 L23.4 39.6 Z',
    },
    detail: 'M31.1 31.5 L40.1 24.5 M31.1 31.5 L22.9 24.0 M31.1 31.5 L37.9 39.1 M31.1 31.5 L23.4 39.6',
    sideStrategy: 'mirror',
    simplification:
      'Fissure drawn as an idealised plus/cross from a single central point; the real anastomosing grooves and pits are simplified to four straight branches.',
  },

  /**
   * Lower third molar. Rounded, reduced outline; buccal and lingual cusps
   * drawn fused rather than distinct (no extra edge points — just rounder
   * corners than the first/second molar); irregular, non-repeating fissure
   * marks.
   */
  'permanent:lower:third_molar': {
    outline: 'M13.7 14.6 C19.8 9.1 46.3 10.4 51.7 16.0 C57.1 21.6 52.2 42.9 46.1 48.4 C40.0 53.9 20.5 54.6 15.1 49.0 C9.7 43.4 7.6 20.1 13.7 14.6 Z',
    surfaces: {
      mesial: 'M51.7 16.0 C57.1 21.6 52.2 42.9 46.1 48.4 L36.8 38.3 L39.0 25.3 Z',
      distal: 'M15.1 49.0 C9.7 43.4 7.6 20.1 13.7 14.6 L23.3 24.8 L24.4 38.6 Z',
      buccal: 'M13.7 14.6 C19.8 9.1 46.3 10.4 51.7 16.0 L39.0 25.3 L23.3 24.8 Z',
      lingual: 'M46.1 48.4 C40.0 53.9 20.5 54.6 15.1 49.0 L24.4 38.6 L36.8 38.3 Z',
      central: 'M23.3 24.8 L39.0 25.3 L36.8 38.3 L24.4 38.6 Z',
    },
    detail: 'M30.6 17.4 L25.0 40.0 M39.0 25.9 L33.4 38.6',
    sideStrategy: 'mirror',
    simplification:
      'Drawn rounded with fused, irregular cusps and no coherent fissure pattern, matching its typically variable, reduced morphology.',
  },
};

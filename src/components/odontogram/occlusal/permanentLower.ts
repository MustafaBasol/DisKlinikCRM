/**
 * occlusal/permanentLower.ts — DENTAL-CHART-ASSET-R3
 *
 * One author-owned slice of the OCCLUSAL_ART registry. Split out of the
 * single 700-line module so the R3 asset lanes can rewrite disjoint files in
 * parallel without conflicting. The orientation contract, the path-command
 * subset and the surface-tiling scheme are unchanged and are documented in
 * anatomy.types.ts and design/dental-chart/AUTHORING.md — read those before
 * touching a coordinate here.
 */

import type { PermanentLowerKey, OcclusalToothArt } from '../anatomy.types';

export const PERMANENT_LOWER_OCCLUSAL: Readonly<Record<PermanentLowerKey, OcclusalToothArt>> = {

  // ============================================================
  // PERMANENT — LOWER
  // ============================================================

  /**
   * Lower central incisor. The narrowest tooth in the registry — real
   * mesiodistal asymmetry is minimal (this tooth has the least of any
   * permanent tooth), so the outline is drawn nearly, but not exactly,
   * symmetric: the mesial/distal corners are offset by 1 unit so the
   * mirrored left quadrant is not a pixel-identical no-op.
   */
  'permanent:lower:central_incisor': {
    outline: 'M25 28 C26.3 27 29.8 26.2 32 26 C34.2 25.8 37.2 26 38 27 C38.8 28 37.2 30.5 37 32 C36.8 33.5 37.8 34.8 37 36 C36.2 37.2 33.8 38.8 32 39 C30.2 39.2 27.3 38.2 26 37 C24.7 35.8 24.2 33.5 24 32 C23.8 30.5 23.7 29 25 28 Z',
    surfaces: {
      mesial: 'M38 27 C38.8 28 37.2 30.5 37 32 C36.8 33.5 37.8 34.8 37 36 L34 33 L35 29 Z',
      distal: 'M26 37 C24.7 35.8 24.2 33.5 24 32 C23.8 30.5 23.7 29 25 28 L28 29 L29 34 Z',
      buccal: 'M25 28 C26.3 27 29.8 26.2 32 26 C34.2 25.8 37.2 26 38 27 L35 29 L28 29 Z',
      lingual: 'M37 36 C36.2 37.2 33.8 38.8 32 39 C30.2 39.2 27.3 38.2 26 37 L29 34 L34 33 Z',
      central: 'M28 29 L35 29 L34 33 L29 34 Z',
    },
    detail: 'M28 28 L34 27 M30 27 L30 28 M32 27 L32 28',
    sideStrategy: 'mirror',
    simplification:
      'Drawn nearly symmetric mesiodistally, since the real crown has the least mesiodistal asymmetry of any tooth — but still broken so the mirrored left quadrant is not pixel-identical to the right. Mamelons shown as faint marks only.',
  },

  /** Lower lateral incisor. Plain, slightly larger version of the central. */
  'permanent:lower:lateral_incisor': {
    outline: 'M24 27 C25.5 25.8 29.3 25.2 32 25 C34.7 24.8 38.8 24.8 40 26 C41.2 27.2 39.2 30.3 39 32 C38.8 33.7 40 34.5 39 36 C38 37.5 35.3 40.7 33 41 C30.7 41.3 26.7 39.5 25 38 C23.3 36.5 23.2 33.8 23 32 C22.8 30.2 22.5 28.2 24 27 Z',
    surfaces: {
      mesial: 'M40 26 C41.2 27.2 39.2 30.3 39 32 C38.8 33.7 40 34.5 39 36 L36 34 L37 28 Z',
      distal: 'M25 38 C23.3 36.5 23.2 33.8 23 32 C22.8 30.2 22.5 28.2 24 27 L27 28 L27 35 Z',
      buccal: 'M24 27 C25.5 25.8 29.3 25.2 32 25 C34.7 24.8 38.8 24.8 40 26 L37 28 L27 28 Z',
      lingual: 'M39 36 C38 37.5 35.3 40.7 33 41 C30.7 41.3 26.7 39.5 25 38 L27 35 L36 34 Z',
      central: 'M27 28 L37 28 L36 34 L27 35 Z',
    },
    detail: 'M27 27 L36 26',
    sideStrategy: 'mirror',
    simplification:
      "Distal twist of the incisal edge relative to the root (a common lateral-incisor trait) is not modelled — outline drawn as a plain, slightly larger version of the lower central incisor's wedge.",
  },

  /**
   * Lower canine. Diamond outline, cusp tip on the buccal edge displaced
   * mesially (shorter mesial ridge, longer distal ridge), modest lingual
   * cingulum — narrower overall than the upper canine.
   */
  'permanent:lower:canine': {
    outline: 'M25 26 C26.8 23.3 31.3 17.8 34 17 C36.7 16.2 39.8 19 41 21 C42.2 23 41.2 26.2 41 29 C40.8 31.8 41.5 35.7 40 38 C38.5 40.3 34.7 42.7 32 43 C29.3 43.3 25.5 41.7 24 40 C22.5 38.3 22.8 35.3 23 33 C23.2 30.7 23.2 28.7 25 26 Z',
    surfaces: {
      mesial: 'M41 21 C42.2 23 41.2 26.2 41 29 C40.8 31.8 41.5 35.7 40 38 L36 34 L37 25 Z',
      distal: 'M24 40 C22.5 38.3 22.8 35.3 23 33 C23.2 30.7 23.2 28.7 25 26 L29 28 L28 35 Z',
      buccal: 'M25 26 C26.8 23.3 31.3 17.8 34 17 C36.7 16.2 39.8 19 41 21 L37 25 L29 28 Z',
      lingual: 'M40 38 C38.5 40.3 34.7 42.7 32 43 C29.3 43.3 25.5 41.7 24 40 L28 35 L36 34 Z',
      central: 'M29 28 L37 25 L36 34 L28 35 Z',
    },
    detail: 'M34 17 L41 21 M34 17 L25 26 M32 27 L32 40',
    sideStrategy: 'mirror',
    simplification:
      'Lingual ridge simplified to a single straight stroke; mesial and distal lingual fossae not drawn separately.',
  },

  /**
   * Lower first premolar. Distinctly asymmetric buccolingually — the
   * lingual cusp is much smaller than the buccal cusp, so the lingual edge
   * sits close to the central table instead of projecting out to match the
   * buccal cusp's prominence.
   */
  'permanent:lower:first_premolar': {
    outline: 'M24 24 C25.5 22.2 30.2 18.7 33 18 C35.8 17.3 39.8 18.5 41 20 C42.2 21.5 40.3 24.7 40 27 C39.7 29.3 40.5 32.5 39 34 C37.5 35.5 33.3 35.8 31 36 C28.7 36.2 26.2 36.2 25 35 C23.8 33.8 24.2 30.8 24 29 C23.8 27.2 22.5 25.8 24 24 Z',
    surfaces: {
      mesial: 'M41 20 C42.2 21.5 40.3 24.7 40 27 C39.7 29.3 40.5 32.5 39 34 L35 31 L37 24 Z',
      distal: 'M25 35 C23.8 33.8 24.2 30.8 24 29 C23.8 27.2 22.5 25.8 24 24 L28 26 L28 32 Z',
      buccal: 'M24 24 C25.5 22.2 30.2 18.7 33 18 C35.8 17.3 39.8 18.5 41 20 L37 24 L28 26 Z',
      lingual: 'M39 34 C37.5 35.5 33.3 35.8 31 36 C28.7 36.2 26.2 36.2 25 35 L28 32 L35 31 Z',
      central: 'M28 26 L37 24 L35 31 L28 32 Z',
    },
    detail: 'M35 26 L29 28 M33 30 L31 33',
    sideStrategy: 'mirror',
    simplification:
      'Small mesiolingual groove wrapping the reduced lingual cusp simplified to one short stroke; the true crown tilt (occlusal table facing lingually because the lingual cusp is so much smaller than the buccal one) is implied only by cusp-size asymmetry, not by shading.',
  },

  /**
   * Lower second premolar. Two lingual cusps (mesiolingual + distolingual)
   * giving the classic Y-groove with a buccal cusp — 3 cusps total.
   */
  'permanent:lower:second_premolar': {
    outline: 'M23 23 C24.5 20.8 29 18.5 32 18 C35 17.5 39.7 18.2 41 20 C42.3 21.8 40.2 25.7 40 29 C39.8 32.3 40.8 37.5 40 40 C39.2 42.5 37 43.5 35 44 C33 44.5 29.8 43.3 28 43 C26.2 42.7 24.8 44 24 42 C23.2 40 23.2 34.2 23 31 C22.8 27.8 21.5 25.2 23 23 Z',
    surfaces: {
      mesial: 'M41 20 C42.3 21.8 40.2 25.7 40 29 C39.8 32.3 40.8 37.5 40 40 L36 36 L37 24 Z',
      distal: 'M24 42 C23.2 40 23.2 34.2 23 31 C22.8 27.8 21.5 25.2 23 23 L27 26 L27 37 Z',
      buccal: 'M23 23 C24.5 20.8 29 18.5 32 18 C35 17.5 39.7 18.2 41 20 L37 24 L27 26 Z',
      lingual: 'M40 40 C39.2 42.5 37 43.5 35 44 C33 44.5 29.8 43.3 28 43 C26.2 42.7 24.8 44 24 42 L27 37 L36 36 Z',
      central: 'M27 26 L37 24 L36 36 L27 37 Z',
    },
    detail: 'M32 30 L32 25 M32 30 L37 37 M32 30 L28 38',
    sideStrategy: 'mirror',
    simplification:
      'Y-groove drawn as three straight branches from a single central pit rather than a curved trifurcation.',
  },

  /**
   * Lower first molar. Pentagonal/rectangular outline with 5 cusps
   * (mesiobuccal, distobuccal, distal, mesiolingual, distolingual) — the
   * distal cusp bulges out on the distal edge between the buccal and
   * lingual cusp rows. Classic Y-shaped fissure forking from one central
   * pit.
   */
  'permanent:lower:first_molar': {
    outline: 'M20 20 C22.5 17.5 26 19.3 30 18 C34 16.7 41 12.3 44 12 C47 11.7 47.7 13.2 48 16 C48.3 18.8 46.5 23.7 46 29 C45.5 34.3 46 44.2 45 48 C44 51.8 43.2 51.8 40 52 C36.8 52.2 29.8 50 26 49 C22.2 48 18.8 48.7 17 46 C15.2 43.3 14.5 37.3 15 33 C15.5 28.7 17.5 22.5 20 20 Z',
    surfaces: {
      mesial: 'M48 16 C48.3 18.8 46.5 23.7 46 29 C45.5 34.3 46 44.2 45 48 L38 44 L41 22 Z',
      distal: 'M17 46 C15.2 43.3 14.5 37.3 15 33 C15.5 28.7 17.5 22.5 20 20 L25 26 L23 40 Z',
      buccal: 'M20 20 C22.5 17.5 26 19.3 30 18 C34 16.7 41 12.3 44 12 C47 11.7 47.7 13.2 48 16 L41 22 L25 26 Z',
      lingual: 'M45 48 C44 51.8 43.2 51.8 40 52 C36.8 52.2 29.8 50 26 49 C22.2 48 18.8 48.7 17 46 L23 40 L38 44 Z',
      central: 'M25 26 L41 22 L38 44 L23 40 Z',
    },
    detail: 'M40 20 L30 30 L20 32 M30 30 L26 42 M30 30 L38 40 M20 32 L16 33',
    sideStrategy: 'mirror',
    simplification:
      'Classic Y-fissure idealised as three straight branches from one fork point; supplemental grooves on the distal (5th) cusp are omitted.',
  },

  /**
   * Lower second molar. 4 cusps, square-ish outline (no separate distal
   * cusp), cross/+ shaped fissure branching from one central pit.
   */
  'permanent:lower:second_molar': {
    outline: 'M21 22 C22.5 19.7 25 20 28 19 C31 18 36.2 16 39 16 C41.8 16 44.2 16.7 45 19 C45.8 21.3 44.3 25.7 44 30 C43.7 34.3 44.2 42 43 45 C41.8 48 39.7 47.8 37 48 C34.3 48.2 29.8 46.7 27 46 C24.2 45.3 21.3 46.2 20 44 C18.7 41.8 18.8 36.7 19 33 C19.2 29.3 19.5 24.3 21 22 Z',
    surfaces: {
      mesial: 'M45 19 C45.8 21.3 44.3 25.7 44 30 C43.7 34.3 44.2 42 43 45 L36 41 L38 23 Z',
      distal: 'M20 44 C18.7 41.8 18.8 36.7 19 33 C19.2 29.3 19.5 24.3 21 22 L26 26 L25 39 Z',
      buccal: 'M21 22 C22.5 19.7 25 20 28 19 C31 18 36.2 16 39 16 C41.8 16 44.2 16.7 45 19 L38 23 L26 26 Z',
      lingual: 'M43 45 C41.8 48 39.7 47.8 37 48 C34.3 48.2 29.8 46.7 27 46 C24.2 45.3 21.3 46.2 20 44 L25 39 L36 41 Z',
      central: 'M26 26 L38 23 L36 41 L25 39 Z',
    },
    detail: 'M32 31 L33 20 M32 31 L31 43 M32 31 L22 30 M32 31 L41 32',
    sideStrategy: 'mirror',
    simplification:
      'Fissure drawn as an idealised plus/cross from a single central point; the real anastomosing grooves and pits are simplified to four straight branches.',
  },

  /**
   * Lower third molar. Rounded, reduced outline; buccal and lingual cusps
   * drawn fused rather than distinct; irregular, non-repeating fissure
   * marks.
   */
  'permanent:lower:third_molar': {
    outline: 'M24 25 C25.8 23 30 21.5 33 21 C36 20.5 40.7 20.3 42 22 C43.3 23.7 41.3 27.3 41 31 C40.7 34.7 41.5 41.3 40 44 C38.5 46.7 34.8 47.2 32 47 C29.2 46.8 24.7 45.3 23 43 C21.3 40.7 21.8 36 22 33 C22.2 30 22.2 27 24 25 Z',
    surfaces: {
      mesial: 'M42 22 C43.3 23.7 41.3 27.3 41 31 C40.7 34.7 41.5 41.3 40 44 L35 39 L37 27 Z',
      distal: 'M23 43 C21.3 40.7 21.8 36 22 33 C22.2 30 22.2 27 24 25 L28 29 L27 38 Z',
      buccal: 'M24 25 C25.8 23 30 21.5 33 21 C36 20.5 40.7 20.3 42 22 L37 27 L28 29 Z',
      lingual: 'M40 44 C38.5 46.7 34.8 47.2 32 47 C29.2 46.8 24.7 45.3 23 43 L27 38 L35 39 Z',
      central: 'M28 29 L37 27 L35 39 L27 38 Z',
    },
    detail: 'M30 26 L28 33 M36 29 L33 36 M28 39 L33 41',
    sideStrategy: 'mirror',
    simplification:
      'Drawn rounded with fused, irregular cusps and no coherent fissure pattern, matching its typically variable, reduced morphology.',
  },
};

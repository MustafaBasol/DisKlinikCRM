/**
 * occlusal/primary.ts — DENTAL-CHART-ASSET-R3
 *
 * One author-owned slice of the OCCLUSAL_ART registry. Split out of the
 * single 700-line module so the R3 asset lanes can rewrite disjoint files in
 * parallel without conflicting. The orientation contract, the path-command
 * subset and the surface-tiling scheme are unchanged and are documented in
 * anatomy.types.ts and design/dental-chart/AUTHORING.md — read those before
 * touching a coordinate here.
 */

import type { PrimaryAnatomyKey, OcclusalToothArt } from '../anatomy.types';

export const PRIMARY_OCCLUSAL: Readonly<Record<PrimaryAnatomyKey, OcclusalToothArt>> = {

  // ============================================================
  // PRIMARY — UPPER (no premolars; deciduous positions 4/5 are molars)
  // ============================================================

  /** Primary upper central incisor. Wide wedge, smooth incisal edge. */
  'primary:upper:central_incisor': {
    outline: 'M23 27 C24.8 25.5 28.8 24.3 32 24 C35.2 23.7 40.5 23.8 42 25 C43.5 26.2 41.2 29 41 31 C40.8 33 42.8 35.2 41 37 C39.2 38.8 33.2 41.7 30 42 C26.8 42.3 23.5 40.5 22 39 C20.5 37.5 20.8 35 21 33 C21.2 31 21.2 28.5 23 27 Z',
    surfaces: {
      mesial: 'M42 25 C43.5 26.2 41.2 29 41 31 C40.8 33 42.8 35.2 41 37 L36 34 L38 28 Z',
      distal: 'M22 39 C20.5 37.5 20.8 35 21 33 C21.2 31 21.2 28.5 23 27 L27 29 L26 35 Z',
      buccal: 'M23 27 C24.8 25.5 28.8 24.3 32 24 C35.2 23.7 40.5 23.8 42 25 L38 28 L27 29 Z',
      lingual: 'M41 37 C39.2 38.8 33.2 41.7 30 42 C26.8 42.3 23.5 40.5 22 39 L26 35 L36 34 Z',
      central: 'M27 29 L38 28 L36 34 L26 35 Z',
    },
    detail: 'M27 28 L38 27',
    sideStrategy: 'mirror',
    simplification:
      'No mamelon marks — primary incisors are drawn with a smooth incisal edge, consistent with minimal mamelon expression at this scale.',
  },

  /** Primary upper lateral incisor. Smaller, rounder version of the central. */
  'primary:upper:lateral_incisor': {
    outline: 'M25 29 C26.3 27.8 28.8 26.3 31 26 C33.2 25.7 37 26 38 27 C39 28 37.2 30.3 37 32 C36.8 33.7 38.2 35.5 37 37 C35.8 38.5 32.2 40.7 30 41 C27.8 41.3 25.2 40.3 24 39 C22.8 37.7 22.8 34.7 23 33 C23.2 31.3 23.7 30.2 25 29 Z',
    surfaces: {
      mesial: 'M38 27 C39 28 37.2 30.3 37 32 C36.8 33.7 38.2 35.5 37 37 L33 34 L34 29 Z',
      distal: 'M24 39 C22.8 37.7 22.8 34.7 23 33 C23.2 31.3 23.7 30.2 25 29 L28 30 L27 35 Z',
      buccal: 'M25 29 C26.3 27.8 28.8 26.3 31 26 C33.2 25.7 37 26 38 27 L34 29 L28 30 Z',
      lingual: 'M37 37 C35.8 38.5 32.2 40.7 30 41 C27.8 41.3 25.2 40.3 24 39 L27 35 L33 34 Z',
      central: 'M28 30 L34 29 L33 34 L27 35 Z',
    },
    detail: 'M28 29 L34 28',
    sideStrategy: 'mirror',
    simplification:
      'Drawn as a smaller, rounder version of the primary central incisor; no distinct cingulum pit.',
  },

  /**
   * Primary upper canine. Diamond outline, tip displaced mesially like its
   * permanent successor but drawn blunter/less sharply pointed.
   */
  'primary:upper:canine': {
    outline: 'M25 29 C27 26.7 31.5 20.8 34 20 C36.5 19.2 39 22.2 40 24 C41 25.8 40.2 28.7 40 31 C39.8 33.3 40.5 36 39 38 C37.5 40 33.7 42.7 31 43 C28.3 43.3 24.5 41.5 23 40 C21.5 38.5 21.7 35.8 22 34 C22.3 32.2 23 31.3 25 29 Z',
    surfaces: {
      mesial: 'M40 24 C41 25.8 40.2 28.7 40 31 C39.8 33.3 40.5 36 39 38 L35 35 L36 27 Z',
      distal: 'M23 40 C21.5 38.5 21.7 35.8 22 34 C22.3 32.2 23 31.3 25 29 L28 30 L27 36 Z',
      buccal: 'M25 29 C27 26.7 31.5 20.8 34 20 C36.5 19.2 39 22.2 40 24 L36 27 L28 30 Z',
      lingual: 'M39 38 C37.5 40 33.7 42.7 31 43 C28.3 43.3 24.5 41.5 23 40 L27 36 L35 35 Z',
      central: 'M28 30 L36 27 L35 35 L27 36 Z',
    },
    detail: 'M34 20 L40 24 M34 20 L25 29 M31 28 L31 40',
    sideStrategy: 'mirror',
    simplification:
      "Cusp tip drawn less sharply pointed than the permanent canine's, matching the primary canine's characteristically blunter incisal profile.",
  },

  /**
   * Primary upper first molar. The famously ATYPICAL member of the whole
   * registry: deliberately NOT modelled on a premolar or on a permanent
   * molar. Rounded, tapering toward a reduced distal region, with one
   * dominant mesiolingual cusp and fused, indistinct buccal cusps — the
   * closest thing dentistry has to a three-cusped occlusal outline.
   */
  'primary:upper:first_molar': {
    outline: 'M23 24 C24.8 22.2 29.7 20.8 33 20 C36.3 19.2 41.5 17.5 43 19 C44.5 20.5 42.3 24.7 42 29 C41.7 33.3 42.3 41.8 41 45 C39.7 48.2 36.8 48.8 34 48 C31.2 47.2 26 42.8 24 40 C22 37.2 22.2 33.7 22 31 C21.8 28.3 21.2 25.8 23 24 Z',
    surfaces: {
      mesial: 'M43 19 C44.5 20.5 42.3 24.7 42 29 C41.7 33.3 42.3 41.8 41 45 L36 39 L38 24 Z',
      distal: 'M24 40 C22 37.2 22.2 33.7 22 31 C21.8 28.3 21.2 25.8 23 24 L27 27 L27 36 Z',
      buccal: 'M23 24 C24.8 22.2 29.7 20.8 33 20 C36.3 19.2 41.5 17.5 43 19 L38 24 L27 27 Z',
      lingual: 'M41 45 C39.7 48.2 36.8 48.8 34 48 C31.2 47.2 26 42.8 24 40 L27 36 L36 39 Z',
      central: 'M27 27 L38 24 L36 39 L27 36 Z',
    },
    detail: 'M33 23 L30 30 M36 27 L34 36 M28 33 L32 38',
    sideStrategy: 'mirror',
    simplification:
      'Drawn as the atypical rounded/triangular form with one dominant mesiolingual cusp and fused, indistinct buccal cusps — deliberately NOT modelled on either a premolar or a permanent molar, per its well-documented irregular morphology; exact cusp count is idealised.',
  },

  /**
   * Primary upper second molar. Closely resembles the permanent upper first
   * molar of the same arch: rhomboidal outline, oblique ridge, 4 cusps.
   */
  'primary:upper:second_molar': {
    outline: 'M21 22 C22.8 20.2 26.3 20.3 29 19 C31.7 17.7 34.5 14.3 37 14 C39.5 13.7 43.3 14.5 44 17 C44.7 19.5 41.3 24.3 41 29 C40.7 33.7 42.8 41.8 42 45 C41.2 48.2 38.8 48.2 36 48 C33.2 47.8 27.7 45.2 25 44 C22.3 42.8 21.2 43.3 20 41 C18.8 38.7 17.8 33.2 18 30 C18.2 26.8 19.2 23.8 21 22 Z',
    surfaces: {
      mesial: 'M44 17 C44.7 19.5 41.3 24.3 41 29 C40.7 33.7 42.8 41.8 42 45 L36 40 L38 23 Z',
      distal: 'M20 41 C18.8 38.7 17.8 33.2 18 30 C18.2 26.8 19.2 23.8 21 22 L26 27 L24 37 Z',
      buccal: 'M21 22 C22.8 20.2 26.3 20.3 29 19 C31.7 17.7 34.5 14.3 37 14 C39.5 13.7 43.3 14.5 44 17 L38 23 L26 27 Z',
      lingual: 'M42 45 C41.2 48.2 38.8 48.2 36 48 C33.2 47.8 27.7 45.2 25 44 C22.3 42.8 21.2 43.3 20 41 L24 37 L36 40 Z',
      central: 'M26 27 L38 23 L36 40 L24 37 Z',
    },
    detail: 'M37 16 L31 26 L25 39 M28 22 L33 36',
    sideStrategy: 'mirror',
    simplification:
      "Modelled closely on the permanent upper first molar's oblique-ridge pattern, scaled down and without a Carabelli-cusp mark, per its documented close resemblance to that tooth.",
  },

  // ============================================================
  // PRIMARY — LOWER (no premolars; deciduous positions 4/5 are molars)
  // ============================================================

  /**
   * Primary lower central incisor. Smallest tooth in the whole registry;
   * real mesiodistal asymmetry is minimal, drawn with a 1-unit offset so
   * the mirror is not a no-op.
   */
  'primary:lower:central_incisor': {
    outline: 'M26 29 C27.2 28 30 27.2 32 27 C34 26.8 37.2 27.2 38 28 C38.8 28.8 37.2 30.7 37 32 C36.8 33.3 37.8 34.8 37 36 C36.2 37.2 33.7 38.8 32 39 C30.3 39.2 28.2 38 27 37 C25.8 36 25.2 34.3 25 33 C24.8 31.7 24.8 30 26 29 Z',
    surfaces: {
      mesial: 'M38 28 C38.8 28.8 37.2 30.7 37 32 C36.8 33.3 37.8 34.8 37 36 L33 33 L35 30 Z',
      distal: 'M27 37 C25.8 36 25.2 34.3 25 33 C24.8 31.7 24.8 30 26 29 L28 30 L29 34 Z',
      buccal: 'M26 29 C27.2 28 30 27.2 32 27 C34 26.8 37.2 27.2 38 28 L35 30 L28 30 Z',
      lingual: 'M37 36 C36.2 37.2 33.7 38.8 32 39 C30.3 39.2 28.2 38 27 37 L29 34 L33 33 Z',
      central: 'M28 30 L35 30 L33 33 L29 34 Z',
    },
    detail: 'M28 28 L34 27',
    sideStrategy: 'mirror',
    simplification:
      'Smallest tooth in the registry; drawn with minimal mesiodistal asymmetry since the real crown is nearly symmetric, but still broken so the mirror is not a no-op.',
  },

  /** Primary lower lateral incisor. Slightly larger, slightly more asymmetric than the central. */
  'primary:lower:lateral_incisor': {
    outline: 'M25 28 C26.3 27 29.7 26.2 32 26 C34.3 25.8 38 26 39 27 C40 28 38.2 30.5 38 32 C37.8 33.5 39 34.7 38 36 C37 37.3 34 39.7 32 40 C30 40.3 27.3 39.3 26 38 C24.7 36.7 24.2 33.7 24 32 C23.8 30.3 23.7 29 25 28 Z',
    surfaces: {
      mesial: 'M39 27 C40 28 38.2 30.5 38 32 C37.8 33.5 39 34.7 38 36 L35 34 L36 29 Z',
      distal: 'M26 38 C24.7 36.7 24.2 33.7 24 32 C23.8 30.3 23.7 29 25 28 L27 29 L27 35 Z',
      buccal: 'M25 28 C26.3 27 29.7 26.2 32 26 C34.3 25.8 38 26 39 27 L36 29 L27 29 Z',
      lingual: 'M38 36 C37 37.3 34 39.7 32 40 C30 40.3 27.3 39.3 26 38 L27 35 L35 34 Z',
      central: 'M27 29 L36 29 L35 34 L27 35 Z',
    },
    detail: 'M27 27 L36 26',
    sideStrategy: 'mirror',
    simplification:
      'Drawn as a slightly larger, slightly more asymmetric version of the primary central incisor.',
  },

  /** Primary lower canine. Diamond outline, blunter/more worn-looking cusp tip than the permanent canine. */
  'primary:lower:canine': {
    outline: 'M26 28 C27.7 25.8 31.7 20.8 34 20 C36.3 19.2 39 21.3 40 23 C41 24.7 40.2 27.7 40 30 C39.8 32.3 40.3 35 39 37 C37.7 39 34.3 41.7 32 42 C29.7 42.3 26.3 40.5 25 39 C23.7 37.5 23.8 34.8 24 33 C24.2 31.2 24.3 30.2 26 28 Z',
    surfaces: {
      mesial: 'M40 23 C41 24.7 40.2 27.7 40 30 C39.8 32.3 40.3 35 39 37 L35 34 L36 26 Z',
      distal: 'M25 39 C23.7 37.5 23.8 34.8 24 33 C24.2 31.2 24.3 30.2 26 28 L29 29 L28 35 Z',
      buccal: 'M26 28 C27.7 25.8 31.7 20.8 34 20 C36.3 19.2 39 21.3 40 23 L36 26 L29 29 Z',
      lingual: 'M39 37 C37.7 39 34.3 41.7 32 42 C29.7 42.3 26.3 40.5 25 39 L28 35 L35 34 Z',
      central: 'M29 29 L36 26 L35 34 L28 35 Z',
    },
    detail: 'M34 20 L40 23 M34 20 L26 28 M32 27 L32 39',
    sideStrategy: 'mirror',
    simplification:
      "Cusp tip drawn blunter than the permanent canine's, matching the primary canine's characteristic worn/rounded incisal profile.",
  },

  /**
   * Primary lower first molar. Elongated mesiodistally with a prominent
   * mesial marginal ridge bulging past the mesiobuccal corner — its single
   * most distinctive real trait, and (like its upper counterpart) not
   * modelled on either a premolar or the permanent molar it superficially
   * resembles.
   */
  'primary:lower:first_molar': {
    outline: 'M20 24 C21.7 22.5 25 23 28 22 C31 21 35 18.3 38 18 C41 17.7 44.5 18.5 46 20 C47.5 21.5 47.2 23.3 47 27 C46.8 30.7 46.5 39 45 42 C43.5 45 41.2 45.2 38 45 C34.8 44.8 29.2 41.8 26 41 C22.8 40.2 20.3 41.7 19 40 C17.7 38.3 17.8 33.7 18 31 C18.2 28.3 18.3 25.5 20 24 Z',
    surfaces: {
      mesial: 'M46 20 C47.5 21.5 47.2 23.3 47 27 C46.8 30.7 46.5 39 45 42 L38 38 L40 25 Z',
      distal: 'M19 40 C17.7 38.3 17.8 33.7 18 31 C18.2 28.3 18.3 25.5 20 24 L25 28 L24 36 Z',
      buccal: 'M20 24 C21.7 22.5 25 23 28 22 C31 21 35 18.3 38 18 C41 17.7 44.5 18.5 46 20 L40 25 L25 28 Z',
      lingual: 'M45 42 C43.5 45 41.2 45.2 38 45 C34.8 44.8 29.2 41.8 26 41 C22.8 40.2 20.3 41.7 19 40 L24 36 L38 38 Z',
      central: 'M25 28 L40 25 L38 38 L24 36 Z',
    },
    detail: 'M38 20 L31 28 L24 34 M30 24 L34 34',
    sideStrategy: 'mirror',
    simplification:
      'Prominent mesial marginal ridge drawn as an outward bulge on the mesial corner (its single most distinctive real trait); full cusp/fissure detail simplified to two strokes since this tooth is not modelled on either the premolar or the permanent molar it superficially resembles.',
  },

  /**
   * Primary lower second molar. Closely resembles the permanent lower first
   * molar of the same arch: 5-cusp Y-fissure pattern, scaled down.
   */
  'primary:lower:second_molar': {
    outline: 'M22 22 C24 20.2 26.7 21.2 30 20 C33.3 18.8 39.3 15.3 42 15 C44.7 14.7 45.5 15.8 46 18 C46.5 20.2 45.3 23.7 45 28 C44.7 32.3 45.2 40.8 44 44 C42.8 47.2 40.8 46.8 38 47 C35.2 47.2 30 45.8 27 45 C24 44.2 21.5 44.3 20 42 C18.5 39.7 17.7 34.3 18 31 C18.3 27.7 20 23.8 22 22 Z',
    surfaces: {
      mesial: 'M46 18 C46.5 20.2 45.3 23.7 45 28 C44.7 32.3 45.2 40.8 44 44 L37 40 L39 23 Z',
      distal: 'M20 42 C18.5 39.7 17.7 34.3 18 31 C18.3 27.7 20 23.8 22 22 L26 26 L24 37 Z',
      buccal: 'M22 22 C24 20.2 26.7 21.2 30 20 C33.3 18.8 39.3 15.3 42 15 C44.7 14.7 45.5 15.8 46 18 L39 23 L26 26 Z',
      lingual: 'M44 44 C42.8 47.2 40.8 46.8 38 47 C35.2 47.2 30 45.8 27 45 C24 44.2 21.5 44.3 20 42 L24 37 L37 40 Z',
      central: 'M26 26 L39 23 L37 40 L24 37 Z',
    },
    detail: 'M39 19 L30 28 L21 30 M30 28 L27 39 M30 28 L36 37',
    sideStrategy: 'mirror',
    simplification:
      "Modelled closely on the permanent lower first molar's five-cusp Y-fissure pattern, scaled down, per its documented close resemblance; the small fifth (distal) cusp is only lightly implied by the outline, not separately fissured.",
  },
};

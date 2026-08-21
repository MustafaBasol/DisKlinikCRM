/**
 * occlusalGeometry.ts — DENTAL-CHART-UX-001-R2
 *
 * OWNED BY LANE C. Real occlusal/incisal artwork, replacing the rectangular
 * seed wholesale. This is also the load-bearing half of the future
 * per-surface restorative charting contract: every crown is tiled into five
 * closed, individually addressable regions (mesial / distal / buccal /
 * lingual / central) that the renderer emits as separate `data-surface`
 * elements. No persisted surface state is added here — see anatomy.types.ts.
 *
 * ── CANONICAL ORIENTATION (do not change; see anatomy.types.ts) ────────────
 * viewBox 0 0 64 64. Buccal at small y (top), lingual/palatal at large y
 * (bottom). Mesial at large x (right), distal at small x (left). Authored
 * for the patient's RIGHT side; the renderer mirrors for the left side and
 * flips vertically for the lower arch. Nothing here pre-applies either
 * transform.
 *
 * ── HOW THE FIVE SURFACES TILE THE OUTLINE ──────────────────────────────
 * Every crown is built from four named OUTER corners —
 *   DB (distobuccal), MB (mesiobuccal), ML (mesiolingual), DL (distolingual)
 * — walked clockwise (DB→MB along the buccal edge, MB→ML along the mesial
 * edge, ML→DL along the lingual edge, DL→DB along the distal edge), each
 * edge optionally carrying extra points for cusp tips/marginal ridges/
 * cingulum bulges, plus four INNER corners (DBi/MBi/MLi/DLi, suffixed `i`)
 * that form a smaller quadrilateral — the occlusal table on posteriors, the
 * incisal-edge band on anteriors.
 *
 * `outline` is the outer corners/edges walked all the way round.
 * `central` is just the four inner corners walked round.
 * Each peripheral surface (`buccal`, `mesial`, `lingual`, `distal`) is its
 * outer edge (e.g. DB..MB for buccal) closed by cutting straight back in to
 * the two matching inner corners (MBi then DBi) and closing to the edge's
 * start point. Because every peripheral surface and `central` share their
 * corner vertices exactly, the five regions tile the outline with no gap and
 * no overlap by construction — verified for all 26 entries by comparing the
 * shoelace area of `outline` against the summed area of the five surfaces
 * (see the lane's scratch verification script; every entry matched to
 * within floating-point rounding).
 *
 * No family deviates from this scheme. `detail` (fissure/cusp-ridge strokes)
 * is drawn independently and is purely decorative — it is never used to
 * derive a surface boundary.
 */

import type { AnatomyRegistry, OcclusalToothArt } from './anatomy.types';
import { anatomyKeyFor } from './anatomy.types';
import type { ToothIdentity } from './toothIdentity';

export const OCCLUSAL_ART: AnatomyRegistry<OcclusalToothArt> = {
  // ============================================================
  // PERMANENT — UPPER
  // ============================================================

  /**
   * Upper central incisor. Wide labiolingual wedge; mesioincisal angle
   * sharper (tighter distal-edge point) than the more rounded distoincisal
   * angle; pronounced lingual cingulum bulge. `central` = incisal-edge band.
   */
  'permanent:upper:central_incisor': {
    outline: 'M21 27 L33 23 L45 25 L44 32 L43 38 L31 44 L19 40 L18 34 Z',
    surfaces: {
      mesial: 'M45 25 L44 32 L43 38 L38 35 L40 28 Z',
      distal: 'M19 40 L18 34 L21 27 L26 29 L25 36 Z',
      buccal: 'M21 27 L33 23 L45 25 L40 28 L26 29 Z',
      lingual: 'M43 38 L31 44 L19 40 L25 36 L38 35 Z',
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
    outline: 'M23 28 L32 25 L41 26 L40 32 L39 38 L30 44 L21 41 L20 35 Z',
    surfaces: {
      mesial: 'M41 26 L40 32 L39 38 L35 35 L37 29 Z',
      distal: 'M21 41 L20 35 L23 28 L27 30 L26 37 Z',
      buccal: 'M23 28 L32 25 L41 26 L37 29 L27 30 Z',
      lingual: 'M39 38 L30 44 L21 41 L26 37 L35 35 Z',
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
    outline: 'M22 30 L38 20 L46 26 L45 33 L44 40 L32 46 L20 42 L19 36 Z',
    surfaces: {
      mesial: 'M46 26 L45 33 L44 40 L38 37 L39 29 Z',
      distal: 'M20 42 L19 36 L22 30 L27 32 L26 38 Z',
      buccal: 'M22 30 L38 20 L46 26 L39 29 L27 32 Z',
      lingual: 'M44 40 L32 46 L20 42 L26 38 L38 37 Z',
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
    outline: 'M21 20 L32 15 L43 18 L40 34 L41 48 L30 52 L20 49 L19 35 Z',
    surfaces: {
      mesial: 'M43 18 L40 34 L41 48 L36 41 L38 25 Z',
      distal: 'M20 49 L19 35 L21 20 L25 26 L25 42 Z',
      buccal: 'M21 20 L32 15 L43 18 L38 25 L25 26 Z',
      lingual: 'M41 48 L30 52 L20 49 L25 42 L36 41 Z',
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
    outline: 'M22 21 L33 17 L43 20 L42 33 L41 47 L31 50 L21 48 L20 36 Z',
    surfaces: {
      mesial: 'M43 20 L42 33 L41 47 L36 41 L38 26 Z',
      distal: 'M21 48 L20 36 L22 21 L26 27 L26 42 Z',
      buccal: 'M22 21 L33 17 L43 20 L38 26 L26 27 Z',
      lingual: 'M41 47 L31 50 L21 48 L26 42 L36 41 Z',
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
    outline: 'M18 20 L27 16 L40 10 L48 13 L44 31 L46 50 L40 54 L24 49 L15 44 L13 32 Z',
    surfaces: {
      mesial: 'M48 13 L44 31 L46 50 L40 44 L42 23 Z',
      distal: 'M15 44 L13 32 L18 20 L26 28 L25 40 Z',
      buccal: 'M18 20 L27 16 L40 10 L48 13 L42 23 L26 28 Z',
      lingual: 'M46 50 L40 54 L24 49 L15 44 L25 40 L40 44 Z',
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
    outline: 'M19 22 L28 18 L39 12 L46 15 L43 30 L44 48 L38 51 L26 47 L18 45 L16 32 Z',
    surfaces: {
      mesial: 'M46 15 L43 30 L44 48 L38 42 L40 24 Z',
      distal: 'M18 45 L16 32 L19 22 L26 29 L25 39 Z',
      buccal: 'M19 22 L28 18 L39 12 L46 15 L40 24 L26 29 Z',
      lingual: 'M44 48 L38 51 L26 47 L18 45 L25 39 L38 42 Z',
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
    outline: 'M23 26 L33 22 L43 20 L41 32 L41 46 L32 49 L22 44 L21 34 Z',
    surfaces: {
      mesial: 'M43 20 L41 32 L41 46 L36 40 L37 27 Z',
      distal: 'M22 44 L21 34 L23 26 L28 30 L27 39 Z',
      buccal: 'M23 26 L33 22 L43 20 L37 27 L28 30 Z',
      lingual: 'M41 46 L32 49 L22 44 L27 39 L36 40 Z',
      central: 'M28 30 L37 27 L36 40 L27 39 Z',
    },
    detail: 'M33 25 L30 33 M36 30 L33 38 M28 35 L32 40',
    sideStrategy: 'mirror',
    simplification:
      'Crown drawn heart-shaped with fused, irregular cusps and no coherent oblique ridge, reflecting its typically reduced, variable morphology; fissure pattern is illustrative rather than a specific tooth.',
  },

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
    outline: 'M25 28 L32 26 L38 27 L37 32 L37 36 L32 39 L26 37 L24 32 Z',
    surfaces: {
      mesial: 'M38 27 L37 32 L37 36 L34 33 L35 29 Z',
      distal: 'M26 37 L24 32 L25 28 L28 29 L29 34 Z',
      buccal: 'M25 28 L32 26 L38 27 L35 29 L28 29 Z',
      lingual: 'M37 36 L32 39 L26 37 L29 34 L34 33 Z',
      central: 'M28 29 L35 29 L34 33 L29 34 Z',
    },
    detail: 'M28 28 L34 27 M30 27 L30 28 M32 27 L32 28',
    sideStrategy: 'mirror',
    simplification:
      'Drawn nearly symmetric mesiodistally, since the real crown has the least mesiodistal asymmetry of any tooth — but still broken so the mirrored left quadrant is not pixel-identical to the right. Mamelons shown as faint marks only.',
  },

  /** Lower lateral incisor. Plain, slightly larger version of the central. */
  'permanent:lower:lateral_incisor': {
    outline: 'M24 27 L32 25 L40 26 L39 32 L39 36 L33 41 L25 38 L23 32 Z',
    surfaces: {
      mesial: 'M40 26 L39 32 L39 36 L36 34 L37 28 Z',
      distal: 'M25 38 L23 32 L24 27 L27 28 L27 35 Z',
      buccal: 'M24 27 L32 25 L40 26 L37 28 L27 28 Z',
      lingual: 'M39 36 L33 41 L25 38 L27 35 L36 34 Z',
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
    outline: 'M25 26 L34 17 L41 21 L41 29 L40 38 L32 43 L24 40 L23 33 Z',
    surfaces: {
      mesial: 'M41 21 L41 29 L40 38 L36 34 L37 25 Z',
      distal: 'M24 40 L23 33 L25 26 L29 28 L28 35 Z',
      buccal: 'M25 26 L34 17 L41 21 L37 25 L29 28 Z',
      lingual: 'M40 38 L32 43 L24 40 L28 35 L36 34 Z',
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
    outline: 'M24 24 L33 18 L41 20 L40 27 L39 34 L31 36 L25 35 L24 29 Z',
    surfaces: {
      mesial: 'M41 20 L40 27 L39 34 L35 31 L37 24 Z',
      distal: 'M25 35 L24 29 L24 24 L28 26 L28 32 Z',
      buccal: 'M24 24 L33 18 L41 20 L37 24 L28 26 Z',
      lingual: 'M39 34 L31 36 L25 35 L28 32 L35 31 Z',
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
    outline: 'M23 23 L32 18 L41 20 L40 29 L40 40 L35 44 L28 43 L24 42 L23 31 Z',
    surfaces: {
      mesial: 'M41 20 L40 29 L40 40 L36 36 L37 24 Z',
      distal: 'M24 42 L23 31 L23 23 L27 26 L27 37 Z',
      buccal: 'M23 23 L32 18 L41 20 L37 24 L27 26 Z',
      lingual: 'M40 40 L35 44 L28 43 L24 42 L27 37 L36 36 Z',
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
    outline: 'M20 20 L30 18 L44 12 L48 16 L46 29 L45 48 L40 52 L26 49 L17 46 L15 33 Z',
    surfaces: {
      mesial: 'M48 16 L46 29 L45 48 L38 44 L41 22 Z',
      distal: 'M17 46 L15 33 L20 20 L25 26 L23 40 Z',
      buccal: 'M20 20 L30 18 L44 12 L48 16 L41 22 L25 26 Z',
      lingual: 'M45 48 L40 52 L26 49 L17 46 L23 40 L38 44 Z',
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
    outline: 'M21 22 L28 19 L39 16 L45 19 L44 30 L43 45 L37 48 L27 46 L20 44 L19 33 Z',
    surfaces: {
      mesial: 'M45 19 L44 30 L43 45 L36 41 L38 23 Z',
      distal: 'M20 44 L19 33 L21 22 L26 26 L25 39 Z',
      buccal: 'M21 22 L28 19 L39 16 L45 19 L38 23 L26 26 Z',
      lingual: 'M43 45 L37 48 L27 46 L20 44 L25 39 L36 41 Z',
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
    outline: 'M24 25 L33 21 L42 22 L41 31 L40 44 L32 47 L23 43 L22 33 Z',
    surfaces: {
      mesial: 'M42 22 L41 31 L40 44 L35 39 L37 27 Z',
      distal: 'M23 43 L22 33 L24 25 L28 29 L27 38 Z',
      buccal: 'M24 25 L33 21 L42 22 L37 27 L28 29 Z',
      lingual: 'M40 44 L32 47 L23 43 L27 38 L35 39 Z',
      central: 'M28 29 L37 27 L35 39 L27 38 Z',
    },
    detail: 'M30 26 L28 33 M36 29 L33 36 M28 39 L33 41',
    sideStrategy: 'mirror',
    simplification:
      'Drawn rounded with fused, irregular cusps and no coherent fissure pattern, matching its typically variable, reduced morphology.',
  },

  // ============================================================
  // PRIMARY — UPPER (no premolars; deciduous positions 4/5 are molars)
  // ============================================================

  /** Primary upper central incisor. Wide wedge, smooth incisal edge. */
  'primary:upper:central_incisor': {
    outline: 'M23 27 L32 24 L42 25 L41 31 L41 37 L30 42 L22 39 L21 33 Z',
    surfaces: {
      mesial: 'M42 25 L41 31 L41 37 L36 34 L38 28 Z',
      distal: 'M22 39 L21 33 L23 27 L27 29 L26 35 Z',
      buccal: 'M23 27 L32 24 L42 25 L38 28 L27 29 Z',
      lingual: 'M41 37 L30 42 L22 39 L26 35 L36 34 Z',
      central: 'M27 29 L38 28 L36 34 L26 35 Z',
    },
    detail: 'M27 28 L38 27',
    sideStrategy: 'mirror',
    simplification:
      'No mamelon marks — primary incisors are drawn with a smooth incisal edge, consistent with minimal mamelon expression at this scale.',
  },

  /** Primary upper lateral incisor. Smaller, rounder version of the central. */
  'primary:upper:lateral_incisor': {
    outline: 'M25 29 L31 26 L38 27 L37 32 L37 37 L30 41 L24 39 L23 33 Z',
    surfaces: {
      mesial: 'M38 27 L37 32 L37 37 L33 34 L34 29 Z',
      distal: 'M24 39 L23 33 L25 29 L28 30 L27 35 Z',
      buccal: 'M25 29 L31 26 L38 27 L34 29 L28 30 Z',
      lingual: 'M37 37 L30 41 L24 39 L27 35 L33 34 Z',
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
    outline: 'M25 29 L34 20 L40 24 L40 31 L39 38 L31 43 L23 40 L22 34 Z',
    surfaces: {
      mesial: 'M40 24 L40 31 L39 38 L35 35 L36 27 Z',
      distal: 'M23 40 L22 34 L25 29 L28 30 L27 36 Z',
      buccal: 'M25 29 L34 20 L40 24 L36 27 L28 30 Z',
      lingual: 'M39 38 L31 43 L23 40 L27 36 L35 35 Z',
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
    outline: 'M23 24 L33 20 L43 19 L42 29 L41 45 L34 48 L24 40 L22 31 Z',
    surfaces: {
      mesial: 'M43 19 L42 29 L41 45 L36 39 L38 24 Z',
      distal: 'M24 40 L22 31 L23 24 L27 27 L27 36 Z',
      buccal: 'M23 24 L33 20 L43 19 L38 24 L27 27 Z',
      lingual: 'M41 45 L34 48 L24 40 L27 36 L36 39 Z',
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
    outline: 'M21 22 L29 19 L37 14 L44 17 L41 29 L42 45 L36 48 L25 44 L20 41 L18 30 Z',
    surfaces: {
      mesial: 'M44 17 L41 29 L42 45 L36 40 L38 23 Z',
      distal: 'M20 41 L18 30 L21 22 L26 27 L24 37 Z',
      buccal: 'M21 22 L29 19 L37 14 L44 17 L38 23 L26 27 Z',
      lingual: 'M42 45 L36 48 L25 44 L20 41 L24 37 L36 40 Z',
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
    outline: 'M26 29 L32 27 L38 28 L37 32 L37 36 L32 39 L27 37 L25 33 Z',
    surfaces: {
      mesial: 'M38 28 L37 32 L37 36 L33 33 L35 30 Z',
      distal: 'M27 37 L25 33 L26 29 L28 30 L29 34 Z',
      buccal: 'M26 29 L32 27 L38 28 L35 30 L28 30 Z',
      lingual: 'M37 36 L32 39 L27 37 L29 34 L33 33 Z',
      central: 'M28 30 L35 30 L33 33 L29 34 Z',
    },
    detail: 'M28 28 L34 27',
    sideStrategy: 'mirror',
    simplification:
      'Smallest tooth in the registry; drawn with minimal mesiodistal asymmetry since the real crown is nearly symmetric, but still broken so the mirror is not a no-op.',
  },

  /** Primary lower lateral incisor. Slightly larger, slightly more asymmetric than the central. */
  'primary:lower:lateral_incisor': {
    outline: 'M25 28 L32 26 L39 27 L38 32 L38 36 L32 40 L26 38 L24 32 Z',
    surfaces: {
      mesial: 'M39 27 L38 32 L38 36 L35 34 L36 29 Z',
      distal: 'M26 38 L24 32 L25 28 L27 29 L27 35 Z',
      buccal: 'M25 28 L32 26 L39 27 L36 29 L27 29 Z',
      lingual: 'M38 36 L32 40 L26 38 L27 35 L35 34 Z',
      central: 'M27 29 L36 29 L35 34 L27 35 Z',
    },
    detail: 'M27 27 L36 26',
    sideStrategy: 'mirror',
    simplification:
      'Drawn as a slightly larger, slightly more asymmetric version of the primary central incisor.',
  },

  /** Primary lower canine. Diamond outline, blunter/more worn-looking cusp tip than the permanent canine. */
  'primary:lower:canine': {
    outline: 'M26 28 L34 20 L40 23 L40 30 L39 37 L32 42 L25 39 L24 33 Z',
    surfaces: {
      mesial: 'M40 23 L40 30 L39 37 L35 34 L36 26 Z',
      distal: 'M25 39 L24 33 L26 28 L29 29 L28 35 Z',
      buccal: 'M26 28 L34 20 L40 23 L36 26 L29 29 Z',
      lingual: 'M39 37 L32 42 L25 39 L28 35 L35 34 Z',
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
    outline: 'M20 24 L28 22 L38 18 L46 20 L47 27 L45 42 L38 45 L26 41 L19 40 L18 31 Z',
    surfaces: {
      mesial: 'M46 20 L47 27 L45 42 L38 38 L40 25 Z',
      distal: 'M19 40 L18 31 L20 24 L25 28 L24 36 Z',
      buccal: 'M20 24 L28 22 L38 18 L46 20 L40 25 L25 28 Z',
      lingual: 'M45 42 L38 45 L26 41 L19 40 L24 36 L38 38 Z',
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
    outline: 'M22 22 L30 20 L42 15 L46 18 L45 28 L44 44 L38 47 L27 45 L20 42 L18 31 Z',
    surfaces: {
      mesial: 'M46 18 L45 28 L44 44 L37 40 L39 23 Z',
      distal: 'M20 42 L18 31 L22 22 L26 26 L24 37 Z',
      buccal: 'M22 22 L30 20 L42 15 L46 18 L39 23 L26 26 Z',
      lingual: 'M44 44 L38 47 L27 45 L20 42 L24 37 L37 40 Z',
      central: 'M26 26 L39 23 L37 40 L24 37 Z',
    },
    detail: 'M39 19 L30 28 L21 30 M30 28 L27 39 M30 28 L36 37',
    sideStrategy: 'mirror',
    simplification:
      "Modelled closely on the permanent lower first molar's five-cusp Y-fissure pattern, scaled down, per its documented close resemblance; the small fifth (distal) cusp is only lightly implied by the outline, not separately fissured.",
  },
};

export function getOcclusalArt(identity: ToothIdentity): OcclusalToothArt {
  return OCCLUSAL_ART[anatomyKeyFor(identity)];
}

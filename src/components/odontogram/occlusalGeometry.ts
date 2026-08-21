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
 * REGRESSION ROUND (curved outer edges): the outer edges are drawn as cubic
 * Bezier curves (`C`) through the same corner/cusp points that used to be
 * straight `L` chords — a uniform Catmull-Rom → Bezier conversion around the
 * full closed loop — so the silhouette reads as an organic, convex crown
 * from the occlusal/incisal aspect instead of a faceted polygon. Every point
 * that was a feature before (cusp tip, marginal-ridge notch, cingulum bulge)
 * is still exactly on the curve; only the connective tissue between points
 * changed from a straight line to an arc. `central` and `detail` are
 * unchanged — `central` stays the straight-sided inner quadrilateral,
 * `detail` stays independent open strokes.
 *
 * `outline` is the outer corners/edges walked all the way round as one
 * continuous closed curve (`M` + a run of `C` commands per edge + `Z`).
 * `central` is just the four inner corners walked round with straight `L`s.
 * Each peripheral surface (`buccal`, `mesial`, `lingual`, `distal`) starts
 * at its edge's near corner, replays the IDENTICAL `C`-command string
 * `outline` uses for that edge (byte-for-byte — both are the same JS string
 * value, never independently re-curved), then cuts straight in to the two
 * matching inner corners (far one then near one) and closes. Because every
 * peripheral surface and `central` share their corner vertices AND their
 * curve segments exactly, the five regions still tile the outline with no
 * gap and no overlap — verified for all 26 entries by flattening every `C`
 * into line segments and comparing the shoelace area of `outline` against
 * the summed area of the five surfaces (see the lane's scratch verification
 * script; worst-case mismatch across all 26 entries was 0.0000%, since both
 * sides flatten the same string).
 *
 * No family deviates from this scheme, including the third molars and the
 * primary upper first molar — they curve too, but their control points were
 * never symmetric/regular to begin with, so they still read as the more
 * irregular forms real third molars and that atypical primary molar are.
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

export function getOcclusalArt(identity: ToothIdentity): OcclusalToothArt {
  return OCCLUSAL_ART[anatomyKeyFor(identity)];
}

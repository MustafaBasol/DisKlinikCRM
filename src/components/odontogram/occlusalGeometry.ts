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

import { PERMANENT_UPPER_OCCLUSAL } from './occlusal/permanentUpper';
import { PERMANENT_LOWER_OCCLUSAL } from './occlusal/permanentLower';
import { PRIMARY_OCCLUSAL } from './occlusal/primary';

export const OCCLUSAL_ART: AnatomyRegistry<OcclusalToothArt> = {
  ...PERMANENT_UPPER_OCCLUSAL,
  ...PERMANENT_LOWER_OCCLUSAL,
  ...PRIMARY_OCCLUSAL,
};

export function getOcclusalArt(identity: ToothIdentity): OcclusalToothArt {
  return OCCLUSAL_ART[anatomyKeyFor(identity)];
}

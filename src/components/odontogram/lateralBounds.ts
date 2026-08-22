/**
 * lateralBounds.ts — DENTAL-CHART-UX-001-R2 (Lane A refinement pass)
 *
 * Fixes the "teeth don't share a baseline" defect. Lane B's registry authors
 * every crown at a slightly different y (a canine cusp tip is genuinely
 * higher than a molar's occlusal table — real anatomy, not a bug), so
 * rendering every tooth through the same UNSHIFTED `viewBox="0 0 64 88"`
 * makes the incisal/occlusal edge land at a different pixel row per family.
 *
 * The fix: crop each tooth's viewBox, per tooth, so its own crown's outer
 * edge (the one nearest the occlusal midline once the render transform is
 * applied) always lands at the same fixed distance from the edge of its own
 * SVG box. Concretely — the renderer's `<g>` transform maps authored y to
 * `88 - y` for upper-arch teeth (see anatomy.types.ts), so the crown's
 * outer edge ends up near y≈88 for upper teeth and near y≈0 for lower teeth;
 * we crop the viewBox to sit flush against whichever end that is.
 *
 * The viewBox HEIGHT (in art units, decoupled from the rendered pixel
 * height via preserveAspectRatio="none") is one shared constant per
 * dentition, computed ONCE from the real registry — big enough to show the
 * longest root (the canine) without clipping any tooth in that dentition.
 * All parsing is memoised at module scope; nothing here runs per render.
 */

import type { AnatomyKey, LateralToothArt } from './anatomy.types';
import { allAnatomyKeys, anatomyKeyFor, dentitionOfKey } from './anatomy.types';
import { LATERAL_ART } from './lateralGeometry';
import type { ToothIdentity } from './toothIdentity';
import type { Dentition } from '../toothGeometry';
import { computePathBBox, computeUnionBBox, type PathBBox } from './pathBounds';

/** Authored viewBox width; unchanged — only the y-window is cropped. */
const VIEWBOX_WIDTH = 64;
/** Authored viewBox height every crown/root is drawn within. */
const AUTHORED_HEIGHT = 88;
/** Breathing room between the crop edge and the crown/root artwork. */
const PAD = 2.5;

interface LateralCrop {
  /** Full crown bounding box in authored (pre-transform) coordinates. */
  crownBBox: PathBBox;
  /** Authored (pre-transform) y of the crown's outer/incisal/occlusal edge. */
  crownTop: number;
  /** Authored (pre-transform) y of the deepest root apex. */
  rootBottom: number;
}

const cropCache = new Map<AnatomyKey, LateralCrop>();

function getCrop(key: AnatomyKey, art: LateralToothArt): LateralCrop {
  const cached = cropCache.get(key);
  if (cached) return cached;
  const crownBBox = computePathBBox(art.crown);
  const rootsBBox = computeUnionBBox(art.roots);
  const crop: LateralCrop = {
    crownBBox,
    crownTop: crownBBox.minY,
    rootBottom: Math.max(crownBBox.maxY, rootsBBox.maxY),
  };
  cropCache.set(key, crop);
  return crop;
}

const VIEWBOX_HEIGHT_BY_DENTITION: Record<Dentition, number> = (() => {
  const maxSpan: Record<Dentition, number> = { permanent: 0, primary: 0 };
  for (const key of allAnatomyKeys()) {
    const art = LATERAL_ART[key];
    if (!art) continue;
    const crop = getCrop(key, art);
    const span = crop.rootBottom - crop.crownTop;
    const dentition = dentitionOfKey(key);
    if (span > maxSpan[dentition]) maxSpan[dentition] = span;
  }
  return {
    permanent: maxSpan.permanent + PAD * 2,
    primary: maxSpan.primary + PAD * 2,
  };
})();

export function getLateralViewBoxHeight(dentition: Dentition): number {
  return VIEWBOX_HEIGHT_BY_DENTITION[dentition];
}

/**
 * width / height of the lateral viewBox for a dentition.
 *
 * Every tooth in a dentition shares this aspect (the window is always the full
 * authored 64 units wide and one constant cropped height tall), which is what
 * lets the renderer use a UNIFORM scale: pick the rendered height, derive the
 * rendered width from this ratio, and `preserveAspectRatio="xMidYMid meet"`
 * then scales x and y by exactly the same factor with no letterboxing.
 *
 * The earlier revision instead varied the rendered width per tooth and forced
 * the height with `preserveAspectRatio="none"`. That is a non-uniform scale:
 * it stretched narrow crowns sideways and squashed wide ones, so a central
 * incisor rendered as a fat lozenge. Tooth width must come from the ARTWORK —
 * Lane B already draws a molar wider than an incisor inside the shared box —
 * never from distorting the viewport.
 */
export function getLateralAspect(dentition: Dentition): number {
  return VIEWBOX_WIDTH / VIEWBOX_HEIGHT_BY_DENTITION[dentition];
}

/**
 * The per-tooth `viewBox` string. Crown's outer edge sits `PAD` units in
 * from whichever end of the box is adjacent to the occlusal view in the
 * finished stack (bottom for upper arch, top for lower arch) — see the
 * module doc comment for why that end differs by arch.
 */
export function getLateralViewBox(identity: ToothIdentity, art: LateralToothArt): string {
  const key = anatomyKeyFor(identity);
  const crop = getCrop(key, art);
  const H = VIEWBOX_HEIGHT_BY_DENTITION[identity.dentition];
  const isUpper = identity.arch === 'upper';
  // Where the crown's outer edge lands AFTER the renderer's <g> transform
  // (translate(0 88) scale(1 -1) for upper arch; identity for lower arch).
  const finalCrownEdge = isUpper ? AUTHORED_HEIGHT - crop.crownTop : crop.crownTop;
  const yStart = isUpper ? finalCrownEdge - H + PAD : finalCrownEdge - PAD;
  return `0 ${round(yStart)} ${VIEWBOX_WIDTH} ${round(H)}`;
}

/** Crown bounding box in AUTHORED coordinates — used to place the missing-tooth X mark. */
export function getLateralCrownBBox(identity: ToothIdentity, art: LateralToothArt): PathBBox {
  return getCrop(anatomyKeyFor(identity), art).crownBBox;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

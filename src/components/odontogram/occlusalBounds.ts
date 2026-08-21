/**
 * occlusalBounds.ts — DENTAL-CHART-UX-001-R2
 *
 * Sizes the occlusal view so it is legible without becoming the loudest thing
 * on the chart.
 *
 * TWO FAILURE MODES, ONE BETWEEN THEM
 * -----------------------------------
 * Lane C authored every occlusal outline at its TRUE relative footprint inside
 * the canonical 64x64 box. That is anatomically honest — a lower incisor's
 * occlusal footprint really is a small fraction of a first molar's — but it
 * fails at chart scale in both directions:
 *
 *   1. Render the raw 64x64 box and an incisor is a six-pixel speck.
 *   2. Crop to each tooth's OWN outline and every tooth fills its box equally,
 *      which blows the anteriors up to molar size, destroys the relative
 *      footprint information the artwork encodes, and makes the occlusal row
 *      visually dominate the lateral row it is supposed to support.
 *
 * The fix is a SHARED crop per dentition: one window, computed once from the
 * union of every outline in that dentition, used by every tooth in it. Zooming
 * is therefore uniform — anteriors become legible because the whole row is
 * magnified, while a molar still draws visibly larger than an incisor because
 * their footprints keep their real ratio inside a common frame.
 *
 * All parsing is memoised at module scope. Nothing here runs per render.
 */

import type { AnatomyKey } from './anatomy.types';
import { allAnatomyKeys, anatomyKeyFor, dentitionOfKey } from './anatomy.types';
import { OCCLUSAL_ART } from './occlusalGeometry';
import type { ToothIdentity } from './toothIdentity';
import type { Dentition } from '../toothGeometry';
import { computePathBBox, type PathBBox } from './pathBounds';

/** Breathing room around the union window so strokes never clip. */
const PAD = 2.5;

const bboxCache = new Map<AnatomyKey, PathBBox>();

function getBBox(key: AnatomyKey): PathBBox {
  const cached = bboxCache.get(key);
  if (cached) return cached;
  const art = OCCLUSAL_ART[key];
  const bbox = art
    ? computePathBBox(art.outline)
    : { minX: 0, minY: 0, maxX: 64, maxY: 64, width: 64, height: 64 };
  bboxCache.set(key, bbox);
  return bbox;
}

export interface OcclusalCrop {
  viewBox: string;
  /** height / width of the shared window — the aspect the rendered box keeps. */
  aspect: number;
}

/**
 * One window per dentition, spanning every outline in it. Computed eagerly at
 * module load (26 cheap path scans) rather than lazily per render.
 */
const SHARED_CROP_BY_DENTITION: Record<Dentition, OcclusalCrop> = (() => {
  const acc: Record<Dentition, { minX: number; minY: number; maxX: number; maxY: number }> = {
    permanent: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    primary: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  };

  for (const key of allAnatomyKeys()) {
    const bbox = getBBox(key);
    const dentition = dentitionOfKey(key);
    const box = acc[dentition];
    if (bbox.minX < box.minX) box.minX = bbox.minX;
    if (bbox.minY < box.minY) box.minY = bbox.minY;
    if (bbox.maxX > box.maxX) box.maxX = bbox.maxX;
    if (bbox.maxY > box.maxY) box.maxY = bbox.maxY;
  }

  const build = (dentition: Dentition): OcclusalCrop => {
    const box = acc[dentition];
    // The window must stay centred on the canonical box's x midline: the
    // renderer mirrors left-side teeth about x=32, and an off-centre window
    // would shift the mirrored art sideways relative to its own lateral view.
    const halfWidth = Math.max(32 - box.minX, box.maxX - 32) + PAD;
    const x = 32 - halfWidth;
    const w = halfWidth * 2;
    const y = box.minY - PAD;
    const h = box.maxY - box.minY + PAD * 2;
    return {
      viewBox: `${round(x)} ${round(y)} ${round(w)} ${round(h)}`,
      aspect: w > 0 ? h / w : 1,
    };
  };

  return { permanent: build('permanent'), primary: build('primary') };
})();

/**
 * The shared crop for this tooth's dentition. Takes an identity rather than a
 * dentition so call sites cannot accidentally mix the two windows.
 */
export function getOcclusalCrop(identity: ToothIdentity): OcclusalCrop {
  // anatomyKeyFor is called for its narrowing side effect on out-of-range FDI
  // numbers, keeping this consistent with the lateral path.
  anatomyKeyFor(identity);
  return SHARED_CROP_BY_DENTITION[identity.dentition];
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

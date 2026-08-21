/**
 * occlusalBounds.ts — DENTAL-CHART-UX-001-R2 (Lane A refinement pass)
 *
 * Fixes the "occlusal row is unreadable specks on anterior teeth" defect.
 * Lane C authored every occlusal outline at its true relative footprint
 * inside the 64x64 canonical box — anatomically honest (a lower incisor
 * really does occupy a small fraction of a molar's footprint), but useless
 * at chart scale if rendered through the raw, unshifted 64x64 viewBox.
 *
 * Fix: read each tooth's outline bounding box ONCE (memoised at module
 * scope, keyed by AnatomyKey — never re-parsed per render) and render it
 * through a per-tooth `viewBox` cropped to that box (plus a little padding),
 * so every occlusal view fills its rendered box regardless of family. The
 * COMPRESSED size difference between families then comes back in through
 * the *rendered* box's dimensions, driven by `LateralToothArt.widthRatio`
 * (the same ratio that sizes the lateral view and the arch column) rather
 * than by the raw footprint area — so a molar still reads as visibly bigger
 * than an incisor, just not as violently as the true area ratio would make
 * it.
 */

import type { AnatomyKey, OcclusalToothArt } from './anatomy.types';
import { anatomyKeyFor } from './anatomy.types';
import { OCCLUSAL_ART } from './occlusalGeometry';
import type { ToothIdentity } from './toothIdentity';
import { computePathBBox, type PathBBox } from './pathBounds';

const PAD = 3;

const bboxCache = new Map<AnatomyKey, PathBBox>();

function getBBox(key: AnatomyKey): PathBBox {
  const cached = bboxCache.get(key);
  if (cached) return cached;
  const art: OcclusalToothArt | undefined = OCCLUSAL_ART[key];
  const bbox = art ? computePathBBox(art.outline) : { minX: 0, minY: 0, maxX: 64, maxY: 64, width: 64, height: 64 };
  bboxCache.set(key, bbox);
  return bbox;
}

export interface OcclusalCrop {
  viewBox: string;
  /** height/width of the padded bounding box — the aspect ratio the rendered box should keep. */
  aspect: number;
}

export function getOcclusalCrop(identity: ToothIdentity): OcclusalCrop {
  const key = anatomyKeyFor(identity);
  const bbox = getBBox(key);
  const x = bbox.minX - PAD;
  const y = bbox.minY - PAD;
  const w = bbox.width + PAD * 2;
  const h = bbox.height + PAD * 2;
  return {
    viewBox: `${round(x)} ${round(y)} ${round(w)} ${round(h)}`,
    aspect: w > 0 ? h / w : 1,
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

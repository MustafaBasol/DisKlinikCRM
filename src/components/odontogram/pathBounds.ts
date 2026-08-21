/**
 * pathBounds.ts — DENTAL-CHART-UX-001-R2 (Lane A refinement pass)
 *
 * A tiny, dependency-free SVG path bounding-box reader. Lane B/C's registries
 * only ever use M/L/C/Z commands (no arcs, no relative commands), so every
 * coordinate pair in the `d` string — including bezier control points — can
 * be read with one regex pass. Using control points as well as on-curve
 * points means the computed box is a safe OVER-approximation of a curved
 * path's true bounds (a cubic bezier never leaves the convex hull of its
 * control points), which is exactly what we want for a render-time crop: it
 * never clips the artwork.
 *
 * Callers must memoise at module scope (a `Map` keyed by AnatomyKey) rather
 * than re-parsing on every render — see lateralBounds.ts / occlusalBounds.ts.
 */

export interface PathBBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

const EMPTY_BBOX: PathBBox = { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };

/** Parses every numeric coordinate out of a path `d` string and returns its bounds. */
export function computePathBBox(d: string): PathBBox {
  const nums = d.match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length < 2) return EMPTY_BBOX;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = Number(nums[i]);
    const y = Number(nums[i + 1]);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return EMPTY_BBOX;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/** Bounding box across several paths (e.g. a tooth's multiple roots). */
export function computeUnionBBox(paths: string[]): PathBBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const d of paths) {
    const b = computePathBBox(d);
    if (b.width === 0 && b.height === 0 && b.minX === 0 && b.minY === 0) continue;
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }

  if (!Number.isFinite(minX)) return EMPTY_BBOX;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

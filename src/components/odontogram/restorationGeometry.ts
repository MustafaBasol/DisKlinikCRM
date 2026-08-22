/**
 * restorationGeometry.ts — DENTAL-CHART-ASSET-R3
 *
 * Builds the two pieces of RESTORATION artwork — the implant fixture and the
 * full-coverage crown margin — from each tooth's own anatomy, instead of from
 * one fixed path shared by all 52 teeth.
 *
 * WHY THIS EXISTS
 * ---------------
 * `toothGeometry.ts` carries `IMPLANT_FIXTURE_PATH` (a screw drawn from
 * y = 39 to y = 77) and `CROWN_MARGIN_PATH` (a curve at y ≈ 33.5-36.5). Those
 * are literal coordinates chosen when every tooth in the chart shared one
 * generic outline whose cervical line happened to sit around y ≈ 34-40.
 *
 * R3 gives every tooth its own cervical line, spanning y = 23.0 (upper third
 * molar) to y = 36.0 (lower canine), and its own cervical width. A single
 * fixed path cannot meet all of them, and it visibly did not: an implanted
 * upper premolar rendered as a striped purple column floating in the gap above
 * a detached crown, and the crown margin landed off the tooth entirely on
 * short-crowned molars. Neither is a styling problem — the artwork was
 * anchored to coordinates that no longer exist.
 *
 * So both are now DERIVED: the fixture is seated on the tooth's real cervical
 * span and sunk to a depth proportional to its real root, and the margin is
 * drawn across that same span. A restoration is placed relative to the tooth
 * it restores, which is also how it works in a mouth.
 *
 * Everything is memoised per anatomy key at module scope — nothing here runs
 * per render, matching the discipline in lateralBounds.ts / occlusalBounds.ts.
 */

import type { AnatomyKey, LateralToothArt } from './anatomy.types';
import { anatomyKeyFor } from './anatomy.types';
import type { ToothIdentity } from './toothIdentity';
import { computePathBBox, computeUnionBBox } from './pathBounds';

/** The crown/root junction of one tooth, in authored coordinates. */
export interface CervicalSpan {
  /** y of the cervical line (the crown outline's deepest point). */
  y: number;
  minX: number;
  maxX: number;
  width: number;
  centerX: number;
  /** y of the deepest root apex — how far a fixture may be sunk. */
  apexY: number;
}

export interface ImplantArtwork {
  /** Closed outline of the fixture body. */
  body: string;
  /** Open horizontal strokes standing in for the thread pitch. */
  threads: string;
  /** Closed outline of the abutment collar between fixture and crown. */
  collar: string;
}

const spanCache = new Map<AnatomyKey, CervicalSpan>();
const implantCache = new Map<AnatomyKey, ImplantArtwork>();
const marginCache = new Map<AnatomyKey, string>();

/**
 * Width of a path at height `y`, by scanning its flattened segments.
 *
 * `computePathBBox` deliberately reads control points too, which makes it a
 * safe over-approximation for cropping but useless here: seating a fixture on
 * a control point that sits outside the tooth would put it back where it
 * started. This walks the curve itself.
 */
function scanWidthAt(d: string, y: number): { minX: number; maxX: number } | null {
  const points = flattenPath(d);
  let minX = Infinity;
  let maxX = -Infinity;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (a.y === b.y) continue;
    const lo = Math.min(a.y, b.y);
    const hi = Math.max(a.y, b.y);
    if (y < lo || y > hi) continue;
    const t = (y - a.y) / (b.y - a.y);
    const x = a.x + t * (b.x - a.x);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
  }
  return Number.isFinite(minX) && maxX > minX ? { minX, maxX } : null;
}

interface Pt {
  x: number;
  y: number;
}

const CUBIC_STEPS = 12;

/** Absolute M/L/H/V/C/Z only — the subset AUTHORING.md permits. */
function flattenPath(d: string): Pt[] {
  const tokens = d.match(/[MLHVCZ]|-?\d*\.?\d+/g) ?? [];
  const pts: Pt[] = [];
  let i = 0;
  let cx = 0;
  let cy = 0;
  let startX = 0;
  let startY = 0;
  let cmd = '';
  const num = () => Number(tokens[i++]);

  while (i < tokens.length) {
    if (/^[MLHVCZ]$/.test(tokens[i])) {
      cmd = tokens[i];
      i++;
      if (cmd === 'Z') {
        pts.push({ x: startX, y: startY });
        cx = startX;
        cy = startY;
        continue;
      }
    }
    switch (cmd) {
      case 'M':
        cx = num();
        cy = num();
        startX = cx;
        startY = cy;
        pts.push({ x: cx, y: cy });
        cmd = 'L';
        break;
      case 'L':
        cx = num();
        cy = num();
        pts.push({ x: cx, y: cy });
        break;
      case 'H':
        cx = num();
        pts.push({ x: cx, y: cy });
        break;
      case 'V':
        cy = num();
        pts.push({ x: cx, y: cy });
        break;
      case 'C': {
        const x1 = num();
        const y1 = num();
        const x2 = num();
        const y2 = num();
        const x = num();
        const y = num();
        const p0x = cx;
        const p0y = cy;
        for (let s = 1; s <= CUBIC_STEPS; s++) {
          const t = s / CUBIC_STEPS;
          const m = 1 - t;
          pts.push({
            x: m * m * m * p0x + 3 * m * m * t * x1 + 3 * m * t * t * x2 + t * t * t * x,
            y: m * m * m * p0y + 3 * m * m * t * y1 + 3 * m * t * t * y2 + t * t * t * y,
          });
        }
        cx = x;
        cy = y;
        break;
      }
      default:
        i++;
    }
  }
  return pts;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

/** The tooth's own crown/root junction. Memoised per anatomy key. */
export function getCervicalSpan(identity: ToothIdentity, art: LateralToothArt): CervicalSpan {
  const key = anatomyKeyFor(identity);
  const cached = spanCache.get(key);
  if (cached) return cached;

  const crownBox = computePathBBox(art.crown);
  const rootsBox = computeUnionBBox(art.roots);
  // Probe a little above the crown's lowest point: a scanline exactly on it
  // grazes the outline and yields a degenerate span.
  const probeY = crownBox.maxY - 1.5;
  const scan = scanWidthAt(art.crown, probeY);
  const minX = scan ? scan.minX : crownBox.minX;
  const maxX = scan ? scan.maxX : crownBox.maxX;

  const span: CervicalSpan = {
    y: crownBox.maxY,
    minX,
    maxX,
    width: maxX - minX,
    centerX: (minX + maxX) / 2,
    apexY: Math.max(crownBox.maxY, rootsBox.maxY),
  };
  spanCache.set(key, span);
  return span;
}

/**
 * An endosseous fixture seated on this tooth's cervical line.
 *
 * Proportions follow a real implant rather than the tooth it replaces: the
 * body is appreciably narrower than the natural root (a fixture does not fill
 * the socket), tapers slightly, and stops short of the natural apex.
 */
export function getImplantArtwork(identity: ToothIdentity, art: LateralToothArt): ImplantArtwork {
  const key = anatomyKeyFor(identity);
  const cached = implantCache.get(key);
  if (cached) return cached;

  const span = getCervicalSpan(identity, art);
  const rootLength = Math.max(span.apexY - span.y, 12);

  const collarHalf = round(Math.max(span.width * 0.34, 3.2));
  const topHalf = round(Math.max(span.width * 0.28, 2.8));
  const tipHalf = round(Math.max(topHalf * 0.62, 1.8));
  const depth = round(rootLength * 0.82);

  const cx = round(span.centerX);
  const top = round(span.y - 1.5);
  const collarBottom = round(span.y + 2.5);
  const tipY = round(span.y + depth);
  const shoulderY = round(span.y + depth * 0.86);

  // Collar: the transmucosal shoulder the crown sits on.
  const collar =
    `M${round(cx - collarHalf)} ${top} L${round(cx + collarHalf)} ${top} ` +
    `L${round(cx + topHalf)} ${collarBottom} L${round(cx - topHalf)} ${collarBottom} Z`;

  // Body: straight-walled to the shoulder, then a rounded apical tip.
  const body =
    `M${round(cx - topHalf)} ${collarBottom} L${round(cx + topHalf)} ${collarBottom} ` +
    `L${round(cx + tipHalf)} ${shoulderY} ` +
    `C${round(cx + tipHalf)} ${round(tipY - 0.5)} ${round(cx - tipHalf)} ${round(tipY - 0.5)} ` +
    `${round(cx - tipHalf)} ${shoulderY} Z`;

  // Threads: evenly pitched across the body, inset so they never touch the
  // outline. Count scales with depth so a short root does not get a smear of
  // lines and a long one does not get three lonely ones.
  const threadCount = Math.max(3, Math.min(7, Math.round(depth / 6)));
  const threadTop = collarBottom + 2;
  const threadSpan = shoulderY - threadTop;
  const threads: string[] = [];
  for (let i = 0; i < threadCount; i++) {
    const t = threadCount === 1 ? 0.5 : i / (threadCount - 1);
    const y = round(threadTop + threadSpan * t);
    const half = round((topHalf + (tipHalf - topHalf) * t) * 0.72);
    threads.push(`M${round(cx - half)} ${y} H${round(cx + half)}`);
  }

  const artwork: ImplantArtwork = { body, threads: threads.join(' '), collar };
  implantCache.set(key, artwork);
  return artwork;
}

/**
 * Preparation margin of a full-coverage crown, drawn across this tooth's own
 * cervical line and bowed slightly toward the root the way a real margin
 * follows the gingival contour.
 */
export function getCrownMarginPath(identity: ToothIdentity, art: LateralToothArt): string {
  const key = anatomyKeyFor(identity);
  const cached = marginCache.get(key);
  if (cached) return cached;

  const span = getCervicalSpan(identity, art);
  const inset = span.width * 0.06;
  const x1 = round(span.minX + inset);
  const x2 = round(span.maxX - inset);
  const y = round(span.y - 2.2);
  const bow = round(y + Math.max(span.width * 0.11, 1.6));
  const path =
    `M${x1} ${y} C${round(x1 + span.width * 0.3)} ${bow} ${round(x2 - span.width * 0.3)} ${bow} ${x2} ${y}`;

  marginCache.set(key, path);
  return path;
}

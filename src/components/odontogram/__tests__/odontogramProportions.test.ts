/**
 * odontogramProportions.test.ts — DENTAL-CHART-ASSET-R3
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The 52 artwork entries are authored by several people working in parallel on
 * disjoint files. `odontogramAnatomy.test.ts` already pins that each entry is
 * *structurally* valid — right root count, closed paths, genuinely asymmetric,
 * no NaN. It cannot see the failure mode that actually matters here: 52
 * individually plausible teeth that do not agree with each other about SCALE,
 * so the finished arch reads as a collage. A lower central incisor drawn as
 * wide as a first molar passes every existing assertion.
 *
 * So this file measures the GEOMETRY, not the strings, and holds it against
 * the single published coordinate table in `design/dental-chart/AUTHORING.md`.
 * The expected values below are a literal transcription of that table — an
 * independent oracle, deliberately NOT re-derived from the modules under test,
 * because an oracle computed from the code it checks proves nothing.
 *
 * It also pins the three silhouette rules that separate a clinical drawing
 * from an icon, all of which are invisible to a structural test:
 *   - the CERVICAL CONSTRICTION (a crown must pinch in at the neck);
 *   - crown and root being the SAME WIDTH at the CEJ (so the two-tone
 *     enamel/dentin fill reads as one tooth rather than a hat on a stick);
 *   - roots ending in a narrow blunt apex rather than a rounded club.
 *
 * Run with: tsx src/components/odontogram/__tests__/odontogramProportions.test.ts
 */

import assert from 'node:assert/strict';
import { LATERAL_ART } from '../lateralGeometry';
import { OCCLUSAL_ART } from '../occlusalGeometry';
import { allAnatomyKeys, type AnatomyKey } from '../anatomy.types';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { console.log(`  ✓ ${name}`); passed++; })
    .catch((err: unknown) => {
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    });
}

function section(title: string) {
  console.log(`\n${title}`);
}

// ── Path flattening ─────────────────────────────────────────────────────
//
// The existing anatomy test walks a path's CONTROL points, which is enough to
// prove asymmetry but is wrong for measurement: a cubic's control points sit
// off the curve, so a control-point bounding box is systematically too big and
// "width at y = 34.5" is not answerable from them at all. Here every C is
// subdivided into line segments, so the polyline we measure is the shape the
// browser actually paints, to within the sampling step.

interface Point { x: number; y: number }

const CUBIC_STEPS = 24;

function flattenPath(d: string): Point[] {
  const tokens = d.match(/[MLHVCZ]|-?\d*\.?\d+/gi) ?? [];
  const pts: Point[] = [];
  let i = 0;
  let cx = 0;
  let cy = 0;
  let startX = 0;
  let startY = 0;
  let cmd = '';

  const num = (): number => {
    const raw = tokens[i++];
    const v = Number(raw);
    if (!Number.isFinite(v)) {
      throw new Error(`non-numeric token "${raw}" in path`);
    }
    return v;
  };

  while (i < tokens.length) {
    const token = tokens[i];
    if (/^[MLHVCZ]$/.test(token)) {
      cmd = token;
      i++;
    } else if (/^[mlhvcz]$/.test(token)) {
      throw new Error(`relative command "${token}" is not permitted (AUTHORING.md §1)`);
    } else if (!cmd) {
      throw new Error('path does not start with a command');
    }

    switch (cmd) {
      case 'M': {
        cx = num(); cy = num();
        startX = cx; startY = cy;
        pts.push({ x: cx, y: cy });
        // A repeated coordinate pair after M is an implicit lineto.
        cmd = 'L';
        break;
      }
      case 'L': {
        cx = num(); cy = num();
        pts.push({ x: cx, y: cy });
        break;
      }
      case 'H': {
        cx = num();
        pts.push({ x: cx, y: cy });
        break;
      }
      case 'V': {
        cy = num();
        pts.push({ x: cx, y: cy });
        break;
      }
      case 'C': {
        const x1 = num(); const y1 = num();
        const x2 = num(); const y2 = num();
        const x = num(); const y = num();
        const p0x = cx; const p0y = cy;
        for (let s = 1; s <= CUBIC_STEPS; s++) {
          const t = s / CUBIC_STEPS;
          const mt = 1 - t;
          const a = mt * mt * mt;
          const b = 3 * mt * mt * t;
          const c = 3 * mt * t * t;
          const e = t * t * t;
          pts.push({
            x: a * p0x + b * x1 + c * x2 + e * x,
            y: a * p0y + b * y1 + c * y2 + e * y,
          });
        }
        cx = x; cy = y;
        break;
      }
      case 'Z': {
        pts.push({ x: startX, y: startY });
        cx = startX; cy = startY;
        break;
      }
      default:
        throw new Error(`unsupported command "${cmd}"`);
    }
  }
  return pts;
}

interface BBox { minX: number; minY: number; maxX: number; maxY: number }

function bbox(pts: Point[]): BBox {
  const box: BBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of pts) {
    if (p.x < box.minX) box.minX = p.x;
    if (p.y < box.minY) box.minY = p.y;
    if (p.x > box.maxX) box.maxX = p.x;
    if (p.y > box.maxY) box.maxY = p.y;
  }
  return box;
}

/**
 * Horizontal extent of a closed polyline at height `y`.
 *
 * Returns the distance between the leftmost and rightmost crossings of the
 * scanline, i.e. the OUTER width — not the summed width of the filled spans.
 * For a multi-rooted tooth measured below the furcation that is the correct
 * quantity: it is how far apart the roots have spread.
 */
function widthAtY(pts: Point[], y: number): number | null {
  const xs: number[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (a.y === b.y) continue;
    const lo = Math.min(a.y, b.y);
    const hi = Math.max(a.y, b.y);
    if (y < lo || y > hi) continue;
    const t = (y - a.y) / (b.y - a.y);
    xs.push(a.x + t * (b.x - a.x));
  }
  if (xs.length < 2) return null;
  return Math.max(...xs) - Math.min(...xs);
}

// ── The published table (AUTHORING.md §2.1 and §2.2), transcribed ────────

interface LateralExpectation {
  cervixY: number;
  apexY: number;
  crownWidth: number;
}

const LATERAL_EXPECTED: Record<AnatomyKey, LateralExpectation> = {
  'permanent:upper:central_incisor': { cervixY: 34.5, apexY: 72.0, crownWidth: 24.6 },
  'permanent:upper:lateral_incisor': { cervixY: 30.0, apexY: 68.0, crownWidth: 18.9 },
  'permanent:upper:canine': { cervixY: 33.0, apexY: 82.0, crownWidth: 21.8 },
  'permanent:upper:first_premolar': { cervixY: 28.5, apexY: 69.0, crownWidth: 20.3 },
  'permanent:upper:second_premolar': { cervixY: 28.5, apexY: 70.5, crownWidth: 20.3 },
  'permanent:upper:first_molar': { cervixY: 26.0, apexY: 64.0, crownWidth: 29.0 },
  'permanent:upper:second_molar': { cervixY: 24.5, apexY: 59.0, crownWidth: 26.1 },
  'permanent:upper:third_molar': { cervixY: 23.0, apexY: 55.0, crownWidth: 24.7 },
  'permanent:lower:central_incisor': { cervixY: 30.0, apexY: 66.0, crownWidth: 14.5 },
  'permanent:lower:lateral_incisor': { cervixY: 31.5, apexY: 72.0, crownWidth: 16.0 },
  'permanent:lower:canine': { cervixY: 36.0, apexY: 82.0, crownWidth: 20.3 },
  'permanent:lower:first_premolar': { cervixY: 28.5, apexY: 69.0, crownWidth: 20.3 },
  'permanent:lower:second_premolar': { cervixY: 27.0, apexY: 69.0, crownWidth: 20.3 },
  'permanent:lower:first_molar': { cervixY: 26.0, apexY: 66.5, crownWidth: 31.9 },
  'permanent:lower:second_molar': { cervixY: 24.5, apexY: 62.0, crownWidth: 30.5 },
  'permanent:lower:third_molar': { cervixY: 24.5, apexY: 56.0, crownWidth: 29.0 },
  'primary:upper:central_incisor': { cervixY: 27.0, apexY: 65.0, crownWidth: 24.7 },
  'primary:upper:lateral_incisor': { cervixY: 25.5, apexY: 69.0, crownWidth: 19.4 },
  'primary:upper:canine': { cervixY: 29.0, apexY: 80.0, crownWidth: 26.6 },
  'primary:upper:first_molar': { cervixY: 23.5, apexY: 61.5, crownWidth: 27.7 },
  'primary:upper:second_molar': { cervixY: 26.0, apexY: 70.5, crownWidth: 31.2 },
  'primary:lower:central_incisor': { cervixY: 23.0, apexY: 57.0, crownWidth: 16.0 },
  'primary:lower:lateral_incisor': { cervixY: 24.0, apexY: 60.0, crownWidth: 15.6 },
  'primary:lower:canine': { cervixY: 27.0, apexY: 71.0, crownWidth: 19.0 },
  'primary:lower:first_molar': { cervixY: 27.0, apexY: 64.0, crownWidth: 29.3 },
  'primary:lower:second_molar': { cervixY: 25.0, apexY: 68.0, crownWidth: 37.6 },
};

const OCCLUSAL_EXPECTED: Record<AnatomyKey, { md: number; bl: number }> = {
  'permanent:upper:central_incisor': { md: 37.4, bl: 30.8 },
  'permanent:upper:lateral_incisor': { md: 28.6, bl: 26.4 },
  'permanent:upper:canine': { md: 33.0, bl: 35.2 },
  'permanent:upper:first_premolar': { md: 30.8, bl: 39.6 },
  'permanent:upper:second_premolar': { md: 30.8, bl: 39.6 },
  'permanent:upper:first_molar': { md: 44.0, bl: 48.4 },
  'permanent:upper:second_molar': { md: 39.6, bl: 48.4 },
  'permanent:upper:third_molar': { md: 37.4, bl: 44.0 },
  'permanent:lower:central_incisor': { md: 22.0, bl: 26.4 },
  'permanent:lower:lateral_incisor': { md: 24.2, bl: 28.6 },
  'permanent:lower:canine': { md: 30.8, bl: 33.0 },
  'permanent:lower:first_premolar': { md: 30.8, bl: 33.0 },
  'permanent:lower:second_premolar': { md: 30.8, bl: 35.2 },
  'permanent:lower:first_molar': { md: 48.4, bl: 46.2 },
  'permanent:lower:second_molar': { md: 46.2, bl: 44.0 },
  'permanent:lower:third_molar': { md: 44.0, bl: 41.8 },
  'primary:upper:central_incisor': { md: 31.2, bl: 24.0 },
  'primary:upper:lateral_incisor': { md: 24.5, bl: 19.2 },
  'primary:upper:canine': { md: 33.6, bl: 33.6 },
  'primary:upper:first_molar': { md: 35.0, bl: 40.8 },
  'primary:upper:second_molar': { md: 39.4, bl: 48.0 },
  'primary:lower:central_incisor': { md: 20.2, bl: 19.2 },
  'primary:lower:lateral_incisor': { md: 19.7, bl: 19.2 },
  'primary:lower:canine': { md: 24.0, bl: 23.0 },
  'primary:lower:first_molar': { md: 37.0, bl: 33.6 },
  'primary:lower:second_molar': { md: 47.5, bl: 41.8 },
};

// ── Tolerances ──────────────────────────────────────────────────────────
//
// These are the numbers AUTHORING.md §5 asks authors to hit, widened only by
// the measurement error the flattening introduces (a sampled cubic's extreme
// can sit up to ~0.1 units inside the true one) and by the fact that a
// "width at the contact points" is a judgement call on a curve, not a vertex.
// They are NOT tuned until the suite went green: a tolerance chosen to admit
// whatever was drawn would assert nothing.

const TOL = {
  incisalY: 0.6,
  cervixY: 1.2,
  apexY: 1.5,
  crownWidth: 1.6,
  occlusalExtent: 2.0,
  /** crown width at the CEJ, as a fraction of the crown's widest point */
  neckRatioMin: 0.68,
  neckRatioMax: 0.86,
  /** how far the root's cervical width may differ from the crown's */
  cejContinuity: 2.5,
  apexWidthMin: 1.6,
  apexWidthMax: 6.0,
};

/**
 * Minimum curve segments on an outer contour.
 *
 * Not an aesthetic preference: the first R3 permanent lateral pass satisfied
 * every measurement in the table above and was still rejected on sight,
 * because its contours were straight chords between correctly-placed anchor
 * points. Its crowns had 4 curve segments and its single roots had ZERO. The
 * R2 artwork it replaced had 8-16 and 4-12 respectively, so on curve quality
 * it was a regression that no other assertion in this file could see.
 */
const MIN_CROWN_CURVES = 6;
const MIN_ROOT_CURVES = 4;

/**
 * Root separation, as a fraction of the tooth's own crown width.
 *
 * Measured off the reference plates, not assumed. Permanent: plate 06's lower
 * first molar spans ~0.93 of its crown width at the widest point of the roots
 * and ~0.54 between the apices. Primary: plate 08's upper first molar reaches
 * ~1.08 and ~0.75 — more divergent, which is the deciduous signature, but
 * nowhere near a 'roots splay outward all the way to the tips' caricature.
 */
const PERMANENT_SPREAD = { widestMin: 0.8, widestMax: 1.1, apexMin: 0.4, apexMax: 0.75 };
const PRIMARY_SPREAD = { widestMin: 0.9, widestMax: 1.25, apexMin: 0.6, apexMax: 1.0 };

function countCommand(d: string, command: string): number {
  let n = 0;
  for (const ch of d) if (ch === command) n++;
  return n;
}

interface RootSpread {
  /** Widest outer separation anywhere between the furcation and the apices. */
  widest: number;
  /** Outer separation measured across the root apices themselves. */
  apex: number;
}

/**
 * How far apart a multi-rooted tooth's roots actually get, and how far apart
 * their tips end up. Scanned rather than derived from control points, so a
 * root that curves outward and back is measured where it really is widest.
 */
function measureRootSpread(roots: string[], cervixY: number): RootSpread {
  const polylines = roots.map(flattenPath);
  const deepest = Math.max(...polylines.map((pts) => bbox(pts).maxY));
  let widest = 0;
  for (let y = cervixY + 2; y <= deepest; y += 0.5) {
    let minX = Infinity;
    let maxX = -Infinity;
    for (const pts of polylines) {
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        if (a.y === b.y) continue;
        const lo = Math.min(a.y, b.y);
        const hi = Math.max(a.y, b.y);
        if (y < lo || y > hi) continue;
        const t = (y - a.y) / (b.y - a.y);
        const x = a.x + t * (b.x - a.x);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
    if (Number.isFinite(minX) && maxX - minX > widest) widest = maxX - minX;
  }

  // Each root's own tip x, so 'apex separation' is between tips rather than
  // between whatever happens to be widest at the deepest scanline.
  const apexXs = polylines.map((pts) => pts.reduce((best, p) => (p.y > best.y ? p : best), pts[0]).x);
  const apex = apexXs.length > 1 ? Math.max(...apexXs) - Math.min(...apexXs) : 0;

  return { widest, apex };
}

const INCISAL_Y = 4.0;

interface LateralMeasurement {
  key: AnatomyKey;
  crownTop: number;
  crownBottom: number;
  crownWidth: number;
  neckWidth: number;
  rootCejWidth: number;
  apexY: number;
  apexWidth: number;
}

function measureLateral(key: AnatomyKey): LateralMeasurement {
  const art = LATERAL_ART[key];
  const crownPts = flattenPath(art.crown);
  const crownBox = bbox(crownPts);
  const rootPts = art.roots.map(flattenPath);

  const crownBottom = crownBox.maxY;
  // Probe just ABOVE the CEJ: a scanline exactly on the crown's lowest edge
  // grazes it and yields a meaningless extent.
  const neckWidth = widthAtY(crownPts, crownBottom - 1.5) ?? 0;
  // Probe just BELOW the CEJ, where the roots exist (authors start a root
  // ~2 units above the CEJ so the crown overlaps it) but have not yet split.
  const rootProbeY = crownBottom + 1.0;
  const rootWidths = rootPts
    .map((pts) => {
      const outer = widthAtY(pts, rootProbeY);
      return outer === null ? null : { pts, outer };
    })
    .filter((v): v is { pts: Point[]; outer: number } => v !== null);
  // Outer span across ALL roots at the CEJ — the root trunk's full width.
  let rootMinX = Infinity;
  let rootMaxX = -Infinity;
  for (const { pts } of rootWidths) {
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (a.y === b.y) continue;
      const lo = Math.min(a.y, b.y);
      const hi = Math.max(a.y, b.y);
      if (rootProbeY < lo || rootProbeY > hi) continue;
      const t = (rootProbeY - a.y) / (b.y - a.y);
      const x = a.x + t * (b.x - a.x);
      if (x < rootMinX) rootMinX = x;
      if (x > rootMaxX) rootMaxX = x;
    }
  }
  const rootCejWidth = Number.isFinite(rootMinX) ? rootMaxX - rootMinX : 0;

  const allRootPts = rootPts.flat();
  const apexY = allRootPts.length ? bbox(allRootPts).maxY : crownBottom;
  // Width of the deepest root a little way up from its own tip, which is what
  // "blunt but narrow" actually means; measured exactly at the tip it is 0 for
  // every shape by construction.
  const deepest = rootPts.reduce(
    (best, pts) => (bbox(pts).maxY > bbox(best).maxY ? pts : best),
    rootPts[0] ?? crownPts,
  );
  const apexWidth = widthAtY(deepest, bbox(deepest).maxY - 2.5) ?? 0;

  return {
    key,
    crownTop: crownBox.minY,
    crownBottom,
    crownWidth: crownBox.maxX - crownBox.minX,
    neckWidth,
    rootCejWidth,
    apexY,
    apexWidth,
  };
}

function near(actual: number, expected: number, tol: number): boolean {
  return Math.abs(actual - expected) <= tol;
}

function fmt(n: number): string {
  return n.toFixed(1).padStart(6);
}

async function main() {
  const measurements = new Map<AnatomyKey, LateralMeasurement>();
  for (const key of allAnatomyKeys()) {
    measurements.set(key, measureLateral(key));
  }

  section('Lateral proportions — every entry against the published AUTHORING.md table');

  await test('every crown starts at the shared incisal/occlusal reference line y = 4.0', () => {
    const bad: string[] = [];
    for (const key of allAnatomyKeys()) {
      const m = measurements.get(key)!;
      if (!near(m.crownTop, INCISAL_Y, TOL.incisalY)) {
        bad.push(`${key}: crown top ${m.crownTop.toFixed(1)} (expected ${INCISAL_Y})`);
      }
    }
    assert.equal(bad.length, 0, `\n      ${bad.join('\n      ')}`);
  });

  await test('every CEJ sits at its tabulated CERVIX_Y', () => {
    const bad: string[] = [];
    for (const key of allAnatomyKeys()) {
      const m = measurements.get(key)!;
      const want = LATERAL_EXPECTED[key].cervixY;
      if (!near(m.crownBottom, want, TOL.cervixY)) {
        bad.push(`${key}: CEJ ${m.crownBottom.toFixed(1)} (expected ${want} ±${TOL.cervixY})`);
      }
    }
    assert.equal(bad.length, 0, `\n      ${bad.join('\n      ')}`);
  });

  await test('every deepest root apex sits at its tabulated APEX_Y', () => {
    const bad: string[] = [];
    for (const key of allAnatomyKeys()) {
      const m = measurements.get(key)!;
      const want = LATERAL_EXPECTED[key].apexY;
      if (!near(m.apexY, want, TOL.apexY)) {
        bad.push(`${key}: apex ${m.apexY.toFixed(1)} (expected ${want} ±${TOL.apexY})`);
      }
    }
    assert.equal(bad.length, 0, `\n      ${bad.join('\n      ')}`);
  });

  await test('every crown is as mesiodistally wide as its published mean crown width', () => {
    const bad: string[] = [];
    for (const key of allAnatomyKeys()) {
      const m = measurements.get(key)!;
      const want = LATERAL_EXPECTED[key].crownWidth;
      if (!near(m.crownWidth, want, TOL.crownWidth)) {
        bad.push(`${key}: crown width ${m.crownWidth.toFixed(1)} (expected ${want} ±${TOL.crownWidth})`);
      }
    }
    assert.equal(bad.length, 0, `\n      ${bad.join('\n      ')}`);
  });

  section('Silhouette rules — the three things that separate a drawing from an icon');

  await test('every crown has a real cervical constriction (it pinches in at the neck)', () => {
    const bad: string[] = [];
    for (const key of allAnatomyKeys()) {
      const m = measurements.get(key)!;
      const ratio = m.crownWidth > 0 ? m.neckWidth / m.crownWidth : 0;
      if (ratio < TOL.neckRatioMin || ratio > TOL.neckRatioMax) {
        bad.push(
          `${key}: neck/contact-point width ratio ${ratio.toFixed(2)} ` +
            `(expected ${TOL.neckRatioMin}-${TOL.neckRatioMax}; ` +
            `neck ${m.neckWidth.toFixed(1)}, widest ${m.crownWidth.toFixed(1)})`,
        );
      }
    }
    assert.equal(bad.length, 0, `\n      ${bad.join('\n      ')}`);
  });

  await test('crown and root are the same width where they meet, so the CEJ is a junction and not a step', () => {
    const bad: string[] = [];
    for (const key of allAnatomyKeys()) {
      const m = measurements.get(key)!;
      if (!near(m.rootCejWidth, m.neckWidth, TOL.cejContinuity)) {
        bad.push(
          `${key}: root ${m.rootCejWidth.toFixed(1)} vs crown ${m.neckWidth.toFixed(1)} at the CEJ ` +
            `(max difference ${TOL.cejContinuity})`,
        );
      }
    }
    assert.equal(bad.length, 0, `\n      ${bad.join('\n      ')}`);
  });

  await test('every root ends in a narrow blunt apex rather than a club or a spike', () => {
    const bad: string[] = [];
    for (const key of allAnatomyKeys()) {
      const m = measurements.get(key)!;
      if (m.apexWidth < TOL.apexWidthMin || m.apexWidth > TOL.apexWidthMax) {
        bad.push(
          `${key}: apex width ${m.apexWidth.toFixed(1)} measured 2.5 units up from the tip ` +
            `(expected ${TOL.apexWidthMin}-${TOL.apexWidthMax})`,
        );
      }
    }
    assert.equal(bad.length, 0, `\n      ${bad.join('\n      ')}`);
  });

  section('Curve quality — a silhouette built from straight chords reads as CAD, not anatomy');

  await test('every crown outline is drawn predominantly with curves rather than facets', () => {
    // A tooth measured perfectly against the table can still be unshippable.
    // The first R3 permanent lateral pass hit every tabulated number and was
    // rejected on sight: its crowns were 4-curve/2-line loops, i.e. rounded
    // hexagons, and next to the reference plates they read as CAD output.
    // Curve count is a crude proxy for 'organic', but it is the one that
    // catches the specific regression that actually happened.
    const bad: string[] = [];
    for (const key of allAnatomyKeys()) {
      const curves = countCommand(LATERAL_ART[key].crown, 'C');
      if (curves < MIN_CROWN_CURVES) {
        bad.push(`${key}: crown has ${curves} curve segments (minimum ${MIN_CROWN_CURVES})`);
      }
    }
    assert.equal(bad.length, 0, `\n      ${bad.join('\n      ')}`);
  });

  await test('no root is a straight-sided polygon', () => {
    // The same rejected pass produced single roots with ZERO curve commands.
    // A straight-sided cone is the loudest 'this was generated, not drawn'
    // signal in the whole glyph — it is what made the incisor roots read as
    // carrots.
    const bad: string[] = [];
    for (const key of allAnatomyKeys()) {
      LATERAL_ART[key].roots.forEach((root, index) => {
        const curves = countCommand(root, 'C');
        if (curves < MIN_ROOT_CURVES) {
          bad.push(`${key} root[${index}]: ${curves} curve segments (minimum ${MIN_ROOT_CURVES})`);
        }
      });
    }
    assert.equal(bad.length, 0, `\n      ${bad.join('\n      ')}`);
  });

  section('Root divergence — multi-rooted teeth must read as a pincer, not as parallel prongs');

  await test('multi-rooted teeth separate at the furcation and converge again at the apices', () => {
    // Measured off the reference plates rather than assumed: on plate 06 the
    // lower first molar's crown is ~205px wide, its roots span ~190px at
    // their widest and only ~110px between the apices. A real multi-rooted
    // tooth is a lyre, not a letter V — and it is precisely the inward turn
    // near the apices that forces the roots to be curved.
    const bad: string[] = [];
    for (const key of allAnatomyKeys()) {
      const art = LATERAL_ART[key];
      if (art.roots.length < 2) continue;
      const m = measurements.get(key)!;
      const spread = measureRootSpread(art.roots, m.crownBottom);
      const limits = key.startsWith('primary:') ? PRIMARY_SPREAD : PERMANENT_SPREAD;
      const widestRatio = spread.widest / m.crownWidth;
      const apexRatio = spread.apex / m.crownWidth;

      if (widestRatio < limits.widestMin || widestRatio > limits.widestMax) {
        bad.push(
          `${key}: widest root separation ${widestRatio.toFixed(2)}x crown width ` +
            `(expected ${limits.widestMin}-${limits.widestMax})`,
        );
      }
      if (apexRatio < limits.apexMin || apexRatio > limits.apexMax) {
        bad.push(
          `${key}: apex separation ${apexRatio.toFixed(2)}x crown width ` +
            `(expected ${limits.apexMin}-${limits.apexMax})`,
        );
      }
      if (spread.apex >= spread.widest) {
        bad.push(
          `${key}: apices (${spread.apex.toFixed(1)}) are no closer together than the widest ` +
            `point of the roots (${spread.widest.toFixed(1)}) — the roots flare outward instead ` +
            `of curving back in`,
        );
      }
    }
    assert.equal(bad.length, 0, `\n      ${bad.join('\n      ')}`);
  });

  await test('primary molar roots are more divergent than their permanent counterparts', () => {
    for (const arch of ['upper', 'lower'] as const) {
      const primaryKey = `primary:${arch}:second_molar` as AnatomyKey;
      const permanentKey = `permanent:${arch}:first_molar` as AnatomyKey;
      const primary = measurements.get(primaryKey)!;
      const permanent = measurements.get(permanentKey)!;
      const primaryRatio =
        measureRootSpread(LATERAL_ART[primaryKey].roots, primary.crownBottom).widest /
        primary.crownWidth;
      const permanentRatio =
        measureRootSpread(LATERAL_ART[permanentKey].roots, permanent.crownBottom).widest /
        permanent.crownWidth;
      assert.ok(
        primaryRatio > permanentRatio,
        `${primaryKey} root spread ${primaryRatio.toFixed(2)}x should exceed ` +
          `${permanentKey} ${permanentRatio.toFixed(2)}x — divergent roots are the deciduous signature`,
      );
    }
  });

  section('Relative scale — the arch must not read as a collage');

  await test('a lower central incisor crown is genuinely narrower than a lower first molar crown', () => {
    const incisor = measurements.get('permanent:lower:central_incisor')!.crownWidth;
    const molar = measurements.get('permanent:lower:first_molar')!.crownWidth;
    const ratio = incisor / molar;
    assert.ok(
      ratio > 0.34 && ratio < 0.58,
      `lower central incisor is ${(ratio * 100).toFixed(0)}% of the lower first molar's ` +
        `crown width (expected 34-58%; ${incisor.toFixed(1)} vs ${molar.toFixed(1)})`,
    );
  });

  await test('the canines are the longest teeth in both dentitions', () => {
    for (const dentition of ['permanent', 'primary'] as const) {
      for (const arch of ['upper', 'lower'] as const) {
        const canine = measurements.get(`${dentition}:${arch}:canine` as AnatomyKey)!;
        for (const key of allAnatomyKeys()) {
          if (!key.startsWith(`${dentition}:${arch}:`)) continue;
          if (key.endsWith(':canine')) continue;
          const other = measurements.get(key)!;
          assert.ok(
            canine.apexY >= other.apexY,
            `${key} (apex ${other.apexY.toFixed(1)}) reaches deeper than the ` +
              `${dentition} ${arch} canine (apex ${canine.apexY.toFixed(1)})`,
          );
        }
      }
    }
  });

  await test('primary crowns are squatter than their permanent counterparts (bulbous, not tall)', () => {
    // Crown aspect = mesiodistal width / crown height. A deciduous crown is
    // short and wide; a permanent one is tall. This is the single measurement
    // that catches "the primary teeth are just small permanent teeth".
    const bad: string[] = [];
    const families = ['central_incisor', 'lateral_incisor', 'canine'] as const;
    for (const arch of ['upper', 'lower'] as const) {
      for (const family of families) {
        const primary = measurements.get(`primary:${arch}:${family}` as AnatomyKey)!;
        const permanent = measurements.get(`permanent:${arch}:${family}` as AnatomyKey)!;
        const primaryAspect = primary.crownWidth / (primary.crownBottom - primary.crownTop);
        const permanentAspect = permanent.crownWidth / (permanent.crownBottom - permanent.crownTop);
        if (primaryAspect <= permanentAspect) {
          bad.push(
            `primary:${arch}:${family} crown aspect ${primaryAspect.toFixed(2)} is not wider-for-its-height ` +
              `than permanent ${permanentAspect.toFixed(2)}`,
          );
        }
      }
    }
    assert.equal(bad.length, 0, `\n      ${bad.join('\n      ')}`);
  });

  section('Occlusal footprints — relative size is preserved by a shared crop and cannot be recovered later');

  await test('every occlusal outline matches its tabulated mesiodistal and buccolingual extent', () => {
    const bad: string[] = [];
    for (const key of allAnatomyKeys()) {
      const box = bbox(flattenPath(OCCLUSAL_ART[key].outline));
      const md = box.maxX - box.minX;
      const bl = box.maxY - box.minY;
      const want = OCCLUSAL_EXPECTED[key];
      if (!near(md, want.md, TOL.occlusalExtent)) {
        bad.push(`${key}: MD extent ${md.toFixed(1)} (expected ${want.md} ±${TOL.occlusalExtent})`);
      }
      if (!near(bl, want.bl, TOL.occlusalExtent)) {
        bad.push(`${key}: BL extent ${bl.toFixed(1)} (expected ${want.bl} ±${TOL.occlusalExtent})`);
      }
    }
    assert.equal(bad.length, 0, `\n      ${bad.join('\n      ')}`);
  });

  await test('upper premolars are deeper buccolingually than they are wide mesiodistally', () => {
    for (const family of ['first_premolar', 'second_premolar'] as const) {
      const box = bbox(flattenPath(OCCLUSAL_ART[`permanent:upper:${family}`].outline));
      const md = box.maxX - box.minX;
      const bl = box.maxY - box.minY;
      assert.ok(bl > md, `permanent:upper:${family}: BL ${bl.toFixed(1)} should exceed MD ${md.toFixed(1)}`);
    }
  });

  await test('lower molars are wider mesiodistally than they are deep buccolingually', () => {
    for (const family of ['first_molar', 'second_molar', 'third_molar'] as const) {
      const box = bbox(flattenPath(OCCLUSAL_ART[`permanent:lower:${family}`].outline));
      const md = box.maxX - box.minX;
      const bl = box.maxY - box.minY;
      assert.ok(md > bl, `permanent:lower:${family}: MD ${md.toFixed(1)} should exceed BL ${bl.toFixed(1)}`);
    }
  });

  await test('the occlusal footprint ordering is monotonic where anatomy says it must be', () => {
    // Within a quadrant the crown footprint grows from the lateral incisor
    // back to the first molar, then shrinks through the third molar. Pinning
    // the ordering (rather than each absolute number twice) is what catches a
    // single entry authored at the wrong scale.
    const area = (key: AnatomyKey): number => {
      const box = bbox(flattenPath(OCCLUSAL_ART[key].outline));
      return (box.maxX - box.minX) * (box.maxY - box.minY);
    };
    const growing: AnatomyKey[] = [
      'permanent:lower:lateral_incisor',
      'permanent:lower:canine',
      'permanent:lower:second_premolar',
      'permanent:lower:first_molar',
    ];
    for (let i = 1; i < growing.length; i++) {
      assert.ok(
        area(growing[i]) > area(growing[i - 1]),
        `${growing[i]} footprint should exceed ${growing[i - 1]}`,
      );
    }
    const shrinking: AnatomyKey[] = [
      'permanent:upper:first_molar',
      'permanent:upper:second_molar',
      'permanent:upper:third_molar',
    ];
    for (let i = 1; i < shrinking.length; i++) {
      assert.ok(
        area(shrinking[i]) < area(shrinking[i - 1]),
        `${shrinking[i]} footprint should be smaller than ${shrinking[i - 1]}`,
      );
    }
  });

  // ── Measured table, printed for the delivery report ───────────────────
  section('Measured lateral geometry (for the record)');
  console.log(
    '      key                                    top    CEJ   apex  width   neck  root@CEJ apexW',
  );
  for (const key of allAnatomyKeys()) {
    const m = measurements.get(key)!;
    console.log(
      `      ${key.padEnd(38)}${fmt(m.crownTop)}${fmt(m.crownBottom)}${fmt(m.apexY)}` +
        `${fmt(m.crownWidth)}${fmt(m.neckWidth)}${fmt(m.rootCejWidth)}${fmt(m.apexWidth)}`,
    );
  }

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();

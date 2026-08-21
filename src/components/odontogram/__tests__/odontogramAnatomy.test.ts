/**
 * odontogramAnatomy.test.ts — DENTAL-CHART-UX-001-R2 (Lane E)
 *
 * Pure-module coverage for the R2 odontogram anatomy layer: FDI-to-identity
 * resolution (`toothIdentity.ts`), the registry contract (`anatomy.types.ts`),
 * and the two hand-authored artwork registries (`lateralGeometry.ts`,
 * `LATERAL_ART`; `occlusalGeometry.ts`, `OCCLUSAL_ART`). No React, no DOM, no
 * import of `Odontogram.tsx` / `ToothGlyph.tsx` / `DentalChart.tsx` — those are
 * owned by another lane and are actively changing; this file only exercises
 * the stable pure layer underneath them.
 *
 * THE SINGLE MOST IMPORTANT REGRESSION THIS FILE GUARDS AGAINST: the primary
 * (deciduous) dentition has NO premolars. Deciduous FDI positions 4 and 5 are
 * the first and second PRIMARY MOLARS, not premolars. R1 already fixed this
 * once for the coarse `ToothShape` category (see dentalChartHelpers.test.ts);
 * this file pins the same invariant one level deeper, at the `ToothFamily`
 * and `AnatomyKey` level the R2 artwork is authored at. A primary premolar
 * key anywhere in either registry is the single most visible way a
 * paediatric odontogram can be wrong.
 *
 * Run with: tsx src/components/odontogram/__tests__/odontogramAnatomy.test.ts
 */

import assert from 'node:assert/strict';
import {
  getToothIdentity,
  PERMANENT_FAMILIES,
  PRIMARY_FAMILIES,
  type ToothArch,
  type ToothFamily,
} from '../toothIdentity';
import {
  allAnatomyKeys,
  OCCLUSAL_SURFACE_NAMES,
  type AnatomyKey,
} from '../anatomy.types';
import { LATERAL_ART, getLateralArt } from '../lateralGeometry';
import { OCCLUSAL_ART, getOcclusalArt } from '../occlusalGeometry';
import {
  getToothShape,
  PERMANENT_FDI,
  PRIMARY_FDI,
  TOOTH_STATUS_META,
  TOOTH_STATUSES,
} from '../../dentalChart.types';

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

// ── Shared path-point parser ────────────────────────────────────────────
//
// Understands the absolute subset of SVG path commands this repo's artwork
// is authored with: M, L, C, H, V, Z, with current-point tracking and
// implicit repeated-command coordinate pairs (e.g. extra number pairs after
// an M are implicit linetos, per the SVG spec). A naive number-scraper would
// treat every number in an H or V command as if it were an (x, y) pair,
// misaligning every coordinate after it — this parser tracks the current
// point explicitly so H only ever updates x and V only ever updates y.
// Lowercase (relative) commands are not supported and fail loudly rather
// than silently misparsing.

interface Point {
  x: number;
  y: number;
}

function parsePathPoints(d: string): Point[] {
  const points: Point[] = [];
  let curX = 0;
  let curY = 0;
  let startX = 0;
  let startY = 0;

  const commandPattern = /([MLCHVZ])([^MLCHVZ]*)/g;
  let match: RegExpExecArray | null;
  let consumed = 0;

  while ((match = commandPattern.exec(d))) {
    consumed += match[0].length;
    const letter = match[1];
    const nums = (match[2].match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number);

    if (letter === 'Z') {
      curX = startX;
      curY = startY;
      continue;
    }
    if (letter === 'H') {
      for (const x of nums) {
        curX = x;
        points.push({ x: curX, y: curY });
      }
      continue;
    }
    if (letter === 'V') {
      for (const y of nums) {
        curY = y;
        points.push({ x: curX, y: curY });
      }
      continue;
    }
    if (letter === 'M') {
      assert.equal(nums.length % 2, 0, `M command needs coordinate pairs: ${d.slice(0, 60)}`);
      assert.ok(nums.length >= 2, `M command needs at least one pair: ${d.slice(0, 60)}`);
      curX = nums[0];
      curY = nums[1];
      startX = curX;
      startY = curY;
      points.push({ x: curX, y: curY });
      for (let k = 2; k < nums.length; k += 2) {
        curX = nums[k];
        curY = nums[k + 1];
        points.push({ x: curX, y: curY });
      }
      continue;
    }
    if (letter === 'L') {
      assert.equal(nums.length % 2, 0, `L command needs coordinate pairs: ${d.slice(0, 60)}`);
      for (let k = 0; k < nums.length; k += 2) {
        curX = nums[k];
        curY = nums[k + 1];
        points.push({ x: curX, y: curY });
      }
      continue;
    }
    if (letter === 'C') {
      assert.equal(nums.length % 6, 0, `C command needs sextuples: ${d.slice(0, 60)}`);
      for (let k = 0; k < nums.length; k += 6) {
        points.push({ x: nums[k], y: nums[k + 1] });
        points.push({ x: nums[k + 2], y: nums[k + 3] });
        curX = nums[k + 4];
        curY = nums[k + 5];
        points.push({ x: curX, y: curY });
      }
      continue;
    }
    throw new Error(`unsupported path command "${letter}" in: ${d.slice(0, 60)}`);
  }

  assert.equal(consumed, d.trim().length, `path had unparsed trailing content: ${d.slice(0, 60)}`);
  return points;
}

/**
 * True if reflecting every x-coordinate about the 64-wide viewBox midline
 * (x -> 64 - x) produces a point set that is NOT the same (within a small
 * floating-point tolerance) as the original. A mesiodistally symmetric path
 * reflects onto itself, which is exactly the defect this task exists to fix
 * (see anatomy.types.ts): mirroring a symmetric form is a no-op, so the two
 * quadrants would render as the same picture.
 */
function isGenuinelyAsymmetric(d: string): boolean {
  const points = parsePathPoints(d);
  const reflected = points.map((p) => ({ x: 64 - p.x, y: p.y }));
  const byXY = (a: Point, b: Point) => a.x - b.x || a.y - b.y;
  const sortedOriginal = [...points].sort(byXY);
  const sortedReflected = [...reflected].sort(byXY);
  if (sortedOriginal.length !== sortedReflected.length) return true;
  const TOL = 1e-3;
  for (let i = 0; i < sortedOriginal.length; i++) {
    if (
      Math.abs(sortedOriginal[i].x - sortedReflected[i].x) > TOL ||
      Math.abs(sortedOriginal[i].y - sortedReflected[i].y) > TOL
    ) {
      return true;
    }
  }
  return false;
}

function hasBadToken(...paths: string[]): boolean {
  return paths.some((p) => /NaN|undefined/.test(p));
}

// ── Independent literal oracles (not re-derived from the modules under test) ──

/** Mirrors the instructions literally: permanent position 1-8 family order. */
const PERMANENT_FAMILY_BY_POSITION: ToothFamily[] = [
  'central_incisor',
  'lateral_incisor',
  'canine',
  'first_premolar',
  'second_premolar',
  'first_molar',
  'second_molar',
  'third_molar',
];

/** Deciduous arch: positions 4-5 are MOLARS, never premolars. */
const PRIMARY_FAMILY_BY_POSITION: ToothFamily[] = [
  'central_incisor',
  'lateral_incisor',
  'canine',
  'first_molar',
  'second_molar',
];

const UPPER_QUADRANTS = new Set([1, 2, 5, 6]);
const RIGHT_QUADRANTS = new Set([1, 4, 5, 8]);

/**
 * Expected root count per anatomy key, authored independently of the
 * registries under test from real dental anatomy: permanent upper molars and
 * the upper first premolar are multi-rooted (buccal + palatal), permanent
 * lower molars are two-rooted (mesial + distal), every primary molar keeps
 * its permanent-arch root count, and every incisor/canine/other premolar is
 * single-rooted.
 */
const EXPECTED_ROOT_COUNT: Record<AnatomyKey, number> = {
  'permanent:upper:central_incisor': 1,
  'permanent:upper:lateral_incisor': 1,
  'permanent:upper:canine': 1,
  'permanent:upper:first_premolar': 2,
  'permanent:upper:second_premolar': 1,
  'permanent:upper:first_molar': 3,
  'permanent:upper:second_molar': 3,
  'permanent:upper:third_molar': 3,
  'permanent:lower:central_incisor': 1,
  'permanent:lower:lateral_incisor': 1,
  'permanent:lower:canine': 1,
  'permanent:lower:first_premolar': 1,
  'permanent:lower:second_premolar': 1,
  'permanent:lower:first_molar': 2,
  'permanent:lower:second_molar': 2,
  'permanent:lower:third_molar': 2,
  'primary:upper:central_incisor': 1,
  'primary:upper:lateral_incisor': 1,
  'primary:upper:canine': 1,
  'primary:upper:first_molar': 3,
  'primary:upper:second_molar': 3,
  'primary:lower:central_incisor': 1,
  'primary:lower:lateral_incisor': 1,
  'primary:lower:canine': 1,
  'primary:lower:first_molar': 2,
  'primary:lower:second_molar': 2,
};

async function main() {
  // ── Identity mapping ────────────────────────────────────────────────
  section('getToothIdentity — arch/side/quadrant/position for every valid FDI');

  await test('every permanent FDI resolves to the correct arch/side/quadrant/position', () => {
    for (const fdi of PERMANENT_FDI) {
      const quadrantDigit = Math.floor(fdi / 10);
      const position = fdi % 10;
      const identity = getToothIdentity(fdi);
      assert.equal(identity.quadrant, quadrantDigit, `FDI ${fdi} quadrant`);
      assert.equal(identity.position, position, `FDI ${fdi} position`);
      assert.equal(
        identity.arch,
        UPPER_QUADRANTS.has(quadrantDigit) ? 'upper' : 'lower',
        `FDI ${fdi} arch`,
      );
      assert.equal(
        identity.side,
        RIGHT_QUADRANTS.has(quadrantDigit) ? 'right' : 'left',
        `FDI ${fdi} side`,
      );
    }
  });

  await test('every primary FDI resolves to the correct arch/side/quadrant/position', () => {
    for (const fdi of PRIMARY_FDI) {
      const quadrantDigit = Math.floor(fdi / 10);
      const position = fdi % 10;
      const identity = getToothIdentity(fdi);
      assert.equal(identity.quadrant, quadrantDigit, `FDI ${fdi} quadrant`);
      assert.equal(identity.position, position, `FDI ${fdi} position`);
      assert.equal(
        identity.arch,
        UPPER_QUADRANTS.has(quadrantDigit) ? 'upper' : 'lower',
        `FDI ${fdi} arch`,
      );
      assert.equal(
        identity.side,
        RIGHT_QUADRANTS.has(quadrantDigit) ? 'right' : 'left',
        `FDI ${fdi} side`,
      );
    }
  });

  section(
    'NO PRIMARY PREMOLAR — the single most important regression this file guards: ' +
      'deciduous FDI positions 4 and 5 are the first/second PRIMARY MOLARS, never premolars',
  );

  await test('no primary FDI ever resolves to a premolar family', () => {
    for (const fdi of PRIMARY_FDI) {
      const identity = getToothIdentity(fdi);
      assert.notEqual(identity.family, 'first_premolar', `FDI ${fdi} must not be a first premolar`);
      assert.notEqual(identity.family, 'second_premolar', `FDI ${fdi} must not be a second premolar`);
    }
  });

  await test('primary positions 4 and 5 map to first_molar / second_molar exactly', () => {
    for (const fdi of PRIMARY_FDI) {
      const position = fdi % 10;
      const identity = getToothIdentity(fdi);
      assert.equal(identity.family, PRIMARY_FAMILY_BY_POSITION[position - 1], `FDI ${fdi} family`);
    }
  });

  await test('permanent positions 1-8 map to the eight families in mesial-to-distal order', () => {
    for (const fdi of PERMANENT_FDI) {
      const position = fdi % 10;
      const identity = getToothIdentity(fdi);
      assert.equal(identity.family, PERMANENT_FAMILY_BY_POSITION[position - 1], `FDI ${fdi} family`);
    }
  });

  section('Backward compatibility — identity.shape must not have drifted from the persisted R1 category');

  await test('every permanent FDI: identity.shape === getToothShape(fdi)', () => {
    for (const fdi of PERMANENT_FDI) {
      const identity = getToothIdentity(fdi);
      assert.equal(identity.shape, getToothShape(fdi), `FDI ${fdi} shape must equal the R1 getToothShape value`);
    }
  });

  await test('every primary FDI: identity.shape === getToothShape(fdi) too', () => {
    for (const fdi of PRIMARY_FDI) {
      const identity = getToothIdentity(fdi);
      assert.equal(identity.shape, getToothShape(fdi), `FDI ${fdi} shape must equal getToothShape`);
    }
  });

  // ── Registry completeness and mapping ───────────────────────────────
  section('Registry completeness — exactly 26 keys, present in both registries, no primary premolars');

  await test('allAnatomyKeys() returns exactly 26 unique keys', () => {
    const keys = allAnatomyKeys();
    assert.equal(keys.length, 26, 'expected 16 permanent + 10 primary = 26 keys');
    assert.equal(new Set(keys).size, 26, 'allAnatomyKeys() must not contain duplicates');
  });

  await test('every key is present in both LATERAL_ART and OCCLUSAL_ART', () => {
    for (const key of allAnatomyKeys()) {
      assert.ok(key in LATERAL_ART, `LATERAL_ART is missing ${key}`);
      assert.ok(key in OCCLUSAL_ART, `OCCLUSAL_ART is missing ${key}`);
    }
  });

  await test('neither registry contains a primary premolar or primary third molar key', () => {
    const forbidden = /^primary:(upper|lower):(first_premolar|second_premolar|third_molar)$/;
    for (const key of Object.keys(LATERAL_ART)) {
      assert.ok(!forbidden.test(key), `LATERAL_ART must not contain ${key}`);
    }
    for (const key of Object.keys(OCCLUSAL_ART)) {
      assert.ok(!forbidden.test(key), `OCCLUSAL_ART must not contain ${key}`);
    }
  });

  await test('getLateralArt and getOcclusalArt return a defined entry for all 52 valid FDIs', () => {
    for (const fdi of [...PERMANENT_FDI, ...PRIMARY_FDI]) {
      const identity = getToothIdentity(fdi);
      assert.ok(getLateralArt(identity) !== undefined, `getLateralArt undefined for FDI ${fdi}`);
      assert.ok(getOcclusalArt(identity) !== undefined, `getOcclusalArt undefined for FDI ${fdi}`);
    }
    assert.equal(PERMANENT_FDI.length + PRIMARY_FDI.length, 52, 'sanity: 32 permanent + 20 primary = 52');
  });

  await test('upper and lower of the same family are genuinely different drawings (crown path differs)', () => {
    for (const [dentition, families] of [
      ['permanent', PERMANENT_FAMILIES],
      ['primary', PRIMARY_FAMILIES],
    ] as const) {
      for (const family of families) {
        const upperKey = `${dentition}:upper:${family}` as AnatomyKey;
        const lowerKey = `${dentition}:lower:${family}` as AnatomyKey;
        assert.notEqual(
          LATERAL_ART[upperKey].crown,
          LATERAL_ART[lowerKey].crown,
          `${dentition} upper/lower ${family} lateral crowns must differ`,
        );
        assert.notEqual(
          OCCLUSAL_ART[upperKey].outline,
          OCCLUSAL_ART[lowerKey].outline,
          `${dentition} upper/lower ${family} occlusal outlines must differ`,
        );
      }
    }
  });

  await test('different families in the same arch/dentition resolve to different crown/outline paths (per-family artwork, not reused blobs)', () => {
    const dentitions: Array<'permanent' | 'primary'> = ['permanent', 'primary'];
    const arches: ToothArch[] = ['upper', 'lower'];
    for (const dentition of dentitions) {
      for (const arch of arches) {
        const keys = allAnatomyKeys().filter((k) => k.startsWith(`${dentition}:${arch}:`));
        const crowns = keys.map((k) => LATERAL_ART[k].crown);
        const outlines = keys.map((k) => OCCLUSAL_ART[k].outline);
        assert.equal(new Set(crowns).size, crowns.length, `${dentition}/${arch} lateral crowns must all be distinct`);
        assert.equal(new Set(outlines).size, outlines.length, `${dentition}/${arch} occlusal outlines must all be distinct`);
      }
    }
  });

  // ── Lateral art invariants ──────────────────────────────────────────
  section('Lateral art invariants — shape, roots, no bad tokens (all 26 entries)');

  await test('every lateral entry has valid crown/roots/surface/cervical/widthRatio/sideStrategy/simplification', () => {
    for (const key of allAnatomyKeys()) {
      const art = LATERAL_ART[key];
      assert.ok(art.crown.length > 0, `${key} crown is empty`);
      assert.ok(art.crown.startsWith('M'), `${key} crown must start with M`);
      assert.ok(art.roots.length >= 1, `${key} must have at least one root`);
      for (const [i, root] of art.roots.entries()) {
        assert.ok(root.length > 0, `${key} root[${i}] is empty`);
      }
      assert.ok(art.surface.length > 0, `${key} surface is empty`);
      assert.ok(art.cervical.length > 0, `${key} cervical is empty`);
      assert.ok(Number.isFinite(art.widthRatio) && art.widthRatio > 0, `${key} widthRatio must be a finite positive number`);
      assert.ok(art.sideStrategy === 'mirror' || art.sideStrategy === 'symmetric', `${key} sideStrategy invalid`);
      assert.equal(typeof art.simplification, 'string', `${key} simplification must be a string`);
    }
  });

  await test('lateral root counts match real dental anatomy for every entry', () => {
    for (const key of allAnatomyKeys()) {
      const expected = EXPECTED_ROOT_COUNT[key];
      assert.equal(LATERAL_ART[key].roots.length, expected, `${key} expected ${expected} root(s)`);
    }
  });

  await test('no lateral path contains NaN or undefined', () => {
    for (const key of allAnatomyKeys()) {
      const art = LATERAL_ART[key];
      assert.ok(!hasBadToken(art.crown, art.surface, art.cervical, ...art.roots), `${key} contains a NaN/undefined token`);
    }
  });

  // ── Occlusal art invariants ─────────────────────────────────────────
  section('Occlusal art invariants — outline/surfaces/detail, no bad tokens (all 26 entries)');

  await test('every occlusal outline is non-empty, starts with M, ends with Z', () => {
    for (const key of allAnatomyKeys()) {
      const outline = OCCLUSAL_ART[key].outline;
      assert.ok(outline.length > 0, `${key} outline is empty`);
      assert.ok(outline.startsWith('M'), `${key} outline must start with M`);
      assert.ok(outline.trimEnd().endsWith('Z'), `${key} outline must be closed`);
    }
  });

  await test('all five OCCLUSAL_SURFACE_NAMES are present, non-empty, and closed for every entry', () => {
    for (const key of allAnatomyKeys()) {
      const surfaces = OCCLUSAL_ART[key].surfaces;
      for (const name of OCCLUSAL_SURFACE_NAMES) {
        const region = surfaces[name];
        assert.ok(typeof region === 'string' && region.length > 0, `${key}.surfaces.${name} is missing/empty`);
        assert.ok(region.trimEnd().endsWith('Z'), `${key}.surfaces.${name} must be closed`);
      }
    }
  });

  await test('detail and sideStrategy/simplification are valid for every occlusal entry', () => {
    for (const key of allAnatomyKeys()) {
      const art = OCCLUSAL_ART[key];
      assert.equal(typeof art.detail, 'string', `${key} detail must be a string`);
      assert.ok(art.detail.length > 0, `${key} detail must be present`);
      assert.ok(art.sideStrategy === 'mirror' || art.sideStrategy === 'symmetric', `${key} sideStrategy invalid`);
      assert.equal(typeof art.simplification, 'string', `${key} simplification must be a string`);
    }
  });

  await test('no occlusal path contains NaN or undefined', () => {
    for (const key of allAnatomyKeys()) {
      const art = OCCLUSAL_ART[key];
      const surfacePaths = OCCLUSAL_SURFACE_NAMES.map((name) => art.surfaces[name]);
      assert.ok(!hasBadToken(art.outline, art.detail, ...surfacePaths), `${key} contains a NaN/undefined token`);
    }
  });

  // ── Left/right strategy ─────────────────────────────────────────────
  section('Left/right strategy — mirror entries must be genuinely mesiodistally asymmetric');

  const symmetricEntries: string[] = [];

  await test('every entry with sideStrategy "mirror" has a genuinely asymmetric lateral crown', () => {
    for (const key of allAnatomyKeys()) {
      const art = LATERAL_ART[key];
      if (art.sideStrategy === 'symmetric') {
        symmetricEntries.push(`${key} (lateral)`);
        continue;
      }
      assert.ok(
        isGenuinelyAsymmetric(art.crown),
        `${key} lateral crown declares 'mirror' but is symmetric about x=32 — mirroring would be a no-op`,
      );
    }
  });

  await test('every entry with sideStrategy "mirror" has a genuinely asymmetric occlusal outline', () => {
    for (const key of allAnatomyKeys()) {
      const art = OCCLUSAL_ART[key];
      if (art.sideStrategy === 'symmetric') {
        symmetricEntries.push(`${key} (occlusal)`);
        continue;
      }
      assert.ok(
        isGenuinelyAsymmetric(art.outline),
        `${key} occlusal outline declares 'mirror' but is symmetric about x=32 — mirroring would be a no-op`,
      );
    }
  });

  await test('report any "symmetric" entries so a reviewer sees them', () => {
    if (symmetricEntries.length === 0) {
      console.log('      (none — every one of the 26 x 2 registry entries declares sideStrategy: "mirror")');
    } else {
      console.log(`      symmetric entries: ${symmetricEntries.join(', ')}`);
    }
    // Not a failure condition either way — 'symmetric' is a legitimate,
    // documented choice (see anatomy.types.ts). This test exists purely to
    // surface the list in the run output for review.
  });

  await test('anterior and posterior families both declare "mirror" (representative sample)', () => {
    const representative: AnatomyKey[] = [
      'permanent:upper:central_incisor', // anterior
      'permanent:lower:canine', // anterior
      'permanent:upper:first_molar', // posterior
      'permanent:lower:second_molar', // posterior
      'primary:upper:first_molar', // primary posterior
    ];
    for (const key of representative) {
      assert.equal(LATERAL_ART[key].sideStrategy, 'mirror', `${key} lateral expected to declare 'mirror'`);
      assert.equal(OCCLUSAL_ART[key].sideStrategy, 'mirror', `${key} occlusal expected to declare 'mirror'`);
    }
  });

  // ── Status compatibility ────────────────────────────────────────────
  section('Status compatibility — the eight-state contract is unchanged by the R2 artwork work');

  await test('TOOTH_STATUSES is still exactly the seven stored statuses ("no record" is the absence of a row)', () => {
    assert.deepEqual(TOOTH_STATUSES, [
      'planned',
      'in_progress',
      'treated',
      'issue',
      'missing',
      'crown',
      'implant',
    ]);
  });

  await test('TOOTH_STATUS_META has an entry for every status in TOOTH_STATUSES', () => {
    for (const status of TOOTH_STATUSES) {
      assert.ok(status in TOOTH_STATUS_META, `TOOTH_STATUS_META is missing "${status}"`);
      assert.ok(TOOTH_STATUS_META[status] !== undefined, `TOOTH_STATUS_META["${status}"] is undefined`);
    }
  });

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

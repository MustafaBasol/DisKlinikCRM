/**
 * toothSvgAssets.test.ts — DENTAL-CHART-ASSET-R3 (Lane G)
 *
 * Regression coverage for the standalone tooth SVG export
 * (`../exportToothSvgs.ts`) and for the 104 committed files under
 * `design/dental-chart/final-svg/`. Same house style as
 * `src/components/odontogram/__tests__/odontogramAnatomy.test.ts`: plain
 * `node:assert/strict`, a local `test()` helper, a pass/fail counter, and a
 * non-zero exit code on failure. No test framework, no DOM.
 *
 * What this file deliberately does NOT do: re-derive the expected FDI set by
 * importing `PERMANENT_FDI` / `PRIMARY_FDI` (the same constant the exporter
 * itself reads) or the exporter's own filename helper. An oracle built from
 * the code under test would pass even if that code silently dropped a tooth.
 * The expected FDI ranges below are the literal 11-18/21-28/31-38/41-48 and
 * 51-55/61-65/71-75/81-85 spans from the FDI numbering scheme itself.
 *
 * Run with: npm run test:dental-assets
 *           (== tsx scripts/dental-assets/__tests__/toothSvgAssets.test.ts)
 */

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { DEFAULT_OUTPUT_ROOT, generateAllToothSvgs } from '../exportToothSvgs';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      console.log(`  ✓ ${name}`);
      passed++;
    })
    .catch((err: unknown) => {
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    });
}

function section(title: string) {
  console.log(`\n${title}`);
}

// ── Independent FDI oracle ──────────────────────────────────────────────

function rangeInclusive(start: number, end: number): number[] {
  const out: number[] = [];
  for (let n = start; n <= end; n++) out.push(n);
  return out;
}

/** 11-18, 21-28, 31-38, 41-48 — the four permanent quadrants, literally. */
const EXPECTED_PERMANENT_FDI: number[] = [
  ...rangeInclusive(11, 18),
  ...rangeInclusive(21, 28),
  ...rangeInclusive(31, 38),
  ...rangeInclusive(41, 48),
];

/** 51-55, 61-65, 71-75, 81-85 — the four primary quadrants, literally. */
const EXPECTED_PRIMARY_FDI: number[] = [
  ...rangeInclusive(51, 55),
  ...rangeInclusive(61, 65),
  ...rangeInclusive(71, 75),
  ...rangeInclusive(81, 85),
];

function expectedRelativePaths(): Set<string> {
  const paths = new Set<string>();
  for (const fdi of EXPECTED_PERMANENT_FDI) {
    paths.add(`adult/lateral/tooth_${fdi}_adult_lateral.svg`);
    paths.add(`adult/occlusal/tooth_${fdi}_adult_occlusal.svg`);
  }
  for (const fdi of EXPECTED_PRIMARY_FDI) {
    paths.add(`primary/lateral/tooth_${fdi}_primary_lateral.svg`);
    paths.add(`primary/occlusal/tooth_${fdi}_primary_occlusal.svg`);
  }
  return paths;
}

/**
 * Contralateral pairs, built from the FDI quadrant layout itself (not from
 * any code under test): permanent upper Q1<->Q2, permanent lower Q4<->Q3,
 * primary upper Q5<->Q6, primary lower Q8<->Q7 — the patient's-right quadrant
 * paired with its mirror-image left quadrant at the same tooth position.
 */
interface ContralateralPair {
  right: number;
  left: number;
}

const CONTRALATERAL_PAIRS: ContralateralPair[] = [
  ...rangeInclusive(1, 8).map((p) => ({ right: 10 + p, left: 20 + p })),
  ...rangeInclusive(1, 8).map((p) => ({ right: 40 + p, left: 30 + p })),
  ...rangeInclusive(1, 5).map((p) => ({ right: 50 + p, left: 60 + p })),
  ...rangeInclusive(1, 5).map((p) => ({ right: 80 + p, left: 70 + p })),
];

// ── Disk / filesystem helpers ───────────────────────────────────────────

async function loadDiskFiles(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // directory does not exist yet — surfaced as empty via the map size assertions below
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
      } else {
        const rel = path.relative(root, abs).split(path.sep).join('/');
        files.set(rel, await readFile(abs, 'utf8'));
      }
    }
  }

  await walk(root);
  return files;
}

function fdiFromFilename(fileName: string): number {
  const match = fileName.match(/tooth_(\d+)_/);
  assert.ok(match, `cannot parse an FDI number out of filename "${fileName}"`);
  return Number(match![1]);
}

// ── SVG structural parsing (shared by the well-formedness and pairing checks) ──

/** All `d="..."` attribute values, in document order, from every <path>. */
function extractPathDs(svg: string): string[] {
  const out: string[] = [];
  const pattern = /<path\b[^>]*\bd="([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(svg))) out.push(match[1]);
  return out;
}

/** The transform attribute of the first <g>, or '' if it has none. */
function extractGroupTransform(svg: string): string {
  const match = svg.match(/<g(?:\s+transform="([^"]*)")?>/);
  assert.ok(match, 'expected exactly one <g> element wrapping the tooth artwork');
  return match![1] ?? '';
}

/**
 * Structural well-formedness: single <svg> root, balanced tags (ignoring
 * self-closing elements), no NaN/undefined leakage, no empty d="".
 */
function assertWellFormedSvg(content: string, label: string): void {
  const trimmed = content.trim();
  assert.ok(trimmed.startsWith('<svg'), `${label}: does not start with <svg`);
  assert.ok(trimmed.endsWith('</svg>'), `${label}: does not end with </svg>`);
  assert.ok(!content.includes('NaN'), `${label}: contains the literal string "NaN"`);
  assert.ok(!content.includes('undefined'), `${label}: contains the literal string "undefined"`);
  assert.ok(!/\sd=""/.test(content), `${label}: contains an empty d="" attribute`);

  const tagPattern = /<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  const stack: string[] = [];
  let rootClosed = false;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(content))) {
    const [, closing, name, , selfClose] = match;
    if (closing) {
      const top = stack.pop();
      assert.equal(top, name, `${label}: mismatched closing tag </${name}>, expected </${top}>`);
      if (stack.length === 0) rootClosed = true;
    } else if (selfClose) {
      assert.ok(!rootClosed, `${label}: self-closed <${name}/> found after the root </svg> closed`);
    } else {
      assert.ok(!rootClosed, `${label}: <${name}> found after the root </svg> closed`);
      stack.push(name);
    }
  }
  assert.equal(stack.length, 0, `${label}: unbalanced tags, still open: ${stack.join(', ')}`);
}

const OCCLUSAL_SURFACE_LITERAL_NAMES = ['mesial', 'distal', 'buccal', 'lingual', 'central'] as const;
const MIRROR_TRANSFORM = 'translate(64 0) scale(-1 1)';

async function main(): Promise<void> {
  section('Load committed assets');

  const diskFiles = await loadDiskFiles(DEFAULT_OUTPUT_ROOT);
  await test(`design/dental-chart/final-svg is readable and non-empty (found ${diskFiles.size} files)`, () => {
    assert.ok(diskFiles.size > 0, 'no files found — run "npm run assets:teeth" first');
  });

  // ── 1. Exactly the 104 expected files, at exactly the expected paths ──
  section('File inventory (104 files, exact paths, no extras)');

  await test('exactly 104 files exist under design/dental-chart/final-svg', () => {
    assert.equal(diskFiles.size, 104, `expected 104 files, found ${diskFiles.size}`);
  });

  await test('the set of files on disk matches the expected path set exactly (no missing, no extra)', () => {
    const expected = [...expectedRelativePaths()].sort();
    const actual = [...diskFiles.keys()].sort();
    assert.deepEqual(actual, expected);
  });

  // ── 2. No FDI missing, per directory, derived independently ──────────
  section('FDI coverage per directory (derived from the literal FDI ranges)');

  const directoryExpectations: Array<{ dir: string; expected: number[] }> = [
    { dir: 'adult/lateral', expected: EXPECTED_PERMANENT_FDI },
    { dir: 'adult/occlusal', expected: EXPECTED_PERMANENT_FDI },
    { dir: 'primary/lateral', expected: EXPECTED_PRIMARY_FDI },
    { dir: 'primary/occlusal', expected: EXPECTED_PRIMARY_FDI },
  ];

  for (const { dir, expected } of directoryExpectations) {
    await test(`${dir} contains exactly the expected ${expected.length} FDI numbers`, () => {
      const found = [...diskFiles.keys()]
        .filter((p) => p.startsWith(`${dir}/`))
        .map((p) => fdiFromFilename(path.basename(p)))
        .sort((a, b) => a - b);
      const expectedSorted = [...expected].sort((a, b) => a - b);
      assert.deepEqual(found, expectedSorted, `${dir}: FDI set mismatch`);
    });
  }

  // ── 3. Left/right pairing coherence ───────────────────────────────────
  section('Left/right pairing coherence (contralateral files are genuine mirrors)');

  for (const pair of CONTRALATERAL_PAIRS) {
    const dentitionDir = pair.right < 50 ? 'adult' : 'primary';
    for (const view of ['lateral', 'occlusal'] as const) {
      const rightPath = `${dentitionDir}/${view}/tooth_${pair.right}_${dentitionDir}_${view}.svg`;
      const leftPath = `${dentitionDir}/${view}/tooth_${pair.left}_${dentitionDir}_${view}.svg`;

      await test(`${pair.right}/${pair.left} ${view}: mirror pair is coherent`, () => {
        const rightContent = diskFiles.get(rightPath);
        const leftContent = diskFiles.get(leftPath);
        assert.ok(rightContent, `missing ${rightPath}`);
        assert.ok(leftContent, `missing ${leftPath}`);

        // The files must differ overall (different FDI, title, desc, ...).
        assert.notEqual(rightContent, leftContent, `${rightPath} and ${leftPath} are byte-identical`);

        // Geometry: the SAME path 'd' data in the SAME order — same anatomy
        // key, since arch/family don't depend on side (see anatomyKeyFor in
        // anatomy.types.ts) — the only thing allowed to differ is HOW that
        // geometry gets placed, via the <g transform>.
        const rightDs = extractPathDs(rightContent!);
        const leftDs = extractPathDs(leftContent!);
        assert.deepEqual(
          leftDs,
          rightDs,
          `${leftPath} path data differs from ${rightPath} beyond a mirror transform`,
        );

        // Placement: right side never carries the mirror snippet (mirroring
        // only ever applies to the LEFT side — see lateralTransform /
        // occlusalTransform in ToothGlyph.tsx). Left side either carries it
        // (sideStrategy: 'mirror') or, for a legitimately symmetric form
        // (sideStrategy: 'symmetric'), has the identical transform to the
        // right side. Either way the transform is what a horizontal mirror
        // about x=32 (via translate(64 0) scale(-1 1)) would produce.
        const rightTransform = extractGroupTransform(rightContent!);
        const leftTransform = extractGroupTransform(leftContent!);
        assert.ok(
          !rightTransform.includes(MIRROR_TRANSFORM),
          `${rightPath}: right-side file unexpectedly carries the mirror transform`,
        );
        if (leftTransform.includes(MIRROR_TRANSFORM)) {
          const stripped = leftTransform.replace(MIRROR_TRANSFORM, '').replace(/\s+/g, ' ').trim();
          assert.equal(
            stripped,
            rightTransform,
            `${leftPath}/${rightPath}: transforms differ by more than the mirror snippet`,
          );
        } else {
          assert.equal(
            leftTransform,
            rightTransform,
            `${leftPath}/${rightPath}: neither side is mirrored, but their transforms differ`,
          );
        }
      });
    }
  }

  // ── 4. Every file is well-formed SVG ──────────────────────────────────
  section('Well-formed SVG (single root, balanced tags, no NaN/undefined/empty d)');

  for (const [relPath, content] of diskFiles) {
    await test(`${relPath} is well-formed`, () => assertWellFormedSvg(content, relPath));
  }

  // ── 5. Every occlusal file carries all five data-surface regions ─────
  section('Occlusal files carry all five data-surface regions');

  const occlusalEntries = [...diskFiles.entries()].filter(([relPath]) => relPath.includes('/occlusal/'));
  await test(`found the expected ${52} occlusal files to check`, () => {
    assert.equal(occlusalEntries.length, 52, `expected 52 occlusal files, found ${occlusalEntries.length}`);
  });

  for (const [relPath, content] of occlusalEntries) {
    await test(`${relPath} has all five surface regions`, () => {
      for (const name of OCCLUSAL_SURFACE_LITERAL_NAMES) {
        assert.ok(content.includes(`data-surface="${name}"`), `${relPath} is missing data-surface="${name}"`);
      }
    });
  }

  // ── 6. Drift guard ─────────────────────────────────────────────────────
  section('Drift guard (committed assets match the live anatomy registries)');

  await test(
    'regenerating from the current registries reproduces the committed files byte-for-byte',
    () => {
      const regenerated = generateAllToothSvgs();
      const regeneratedByPath = new Map(regenerated.map((f) => [f.relativePath, f.content]));

      const regeneratedPaths = new Set(regeneratedByPath.keys());
      const diskPaths = new Set(diskFiles.keys());

      const missingFromDisk = [...regeneratedPaths].filter((p) => !diskPaths.has(p)).sort();
      const staleOnDisk = [...diskPaths].filter((p) => !regeneratedPaths.has(p)).sort();
      const RUN_HINT = 'run "npm run assets:teeth" and commit the result';

      assert.deepEqual(
        missingFromDisk,
        [],
        `the current registries produce files not present on disk — ${RUN_HINT}: ${missingFromDisk.join(', ')}`,
      );
      assert.deepEqual(
        staleOnDisk,
        [],
        `disk has files the current registries no longer produce (stale) — ${RUN_HINT}: ${staleOnDisk.join(', ')}`,
      );

      const mismatched = [...regeneratedByPath.keys()]
        .filter((relPath) => diskFiles.get(relPath) !== regeneratedByPath.get(relPath))
        .sort();
      assert.deepEqual(
        mismatched,
        [],
        `committed SVGs are stale relative to the current anatomy registries — ${RUN_HINT}: ${mismatched.join(', ')}`,
      );
    },
  );

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

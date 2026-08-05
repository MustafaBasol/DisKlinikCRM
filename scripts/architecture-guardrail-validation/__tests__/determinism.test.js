// F2-GUARDRAIL-VAL-001-R1 focused determinism/regression tests for
// ../buildSample.js. Exercises the real buildManifest() selection pipeline
// (not a reimplementation) against synthetic fixtures engineered to contain
// tied sort keys (equal-frequency edge families, duplicate-length ids), plus
// the checked-in raw report, to prove output is byte-identical regardless of
// input order — canonical, reversed, and 20 independently-seeded shuffles.
//
// Run: node --test scripts/architecture-guardrail-validation/__tests__/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManifest } from '../buildSample.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

// Deterministic PRNG (mulberry32) so "shuffled input" fixtures are
// reproducible across runs/machines — no Math.random, matching the
// no-randomness determinism guarantee buildSample.js itself makes.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seededShuffle(arr, seed) {
  const rng = mulberry32(seed);
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function makeFinding(overrides) {
  return {
    id: 'id0000000000000',
    callerPath: 'server/src/routes/example.ts',
    callerSymbol: 'exampleHandler',
    ownerDomain: 'core-billing',
    callerDomain: 'core-billing',
    targetModelOrSymbol: 'services/example.ts',
    accessKind: 'import',
    baselineStatus: 'NEW',
    baselineEdgeId: null,
    ...overrides,
  };
}

// Synthetic fixture engineered for ties:
//  - 3 "head" edge families with count=5 (guaranteed top-25 members).
//  - 30 "tied" edge families with count=2 each (33 families total > the
//    top-25 cutoff, so which 22 of the 30 tied families are kept depends
//    entirely on the equal-frequency (`b[1].length - a[1].length || ...`)
//    tie-break comparator).
//  - Two findings sharing an identical 15-char id (duplicate-key case),
//    which collapse to one sample via the `selected` Map — exercised here to
//    confirm that doesn't throw or destabilize output across permutations.
function buildFixtureFindings() {
  const findings = [];
  let n = 0;
  const nextId = () => `f${String(n++).padStart(14, '0')}`; // 15-char code-unit ids

  for (let g = 0; g < 3; g++) {
    for (let i = 0; i < 5; i++) {
      findings.push(makeFinding({
        id: nextId(),
        ownerDomain: ['messaging-sms', 'inventory', 'core-tenant-security'][g],
        callerDomain: 'core-billing',
        targetModelOrSymbol: `services/head${g}.ts`,
        accessKind: 'import',
        callerPath: `server/src/services/head${g}.ts`,
      }));
    }
  }
  for (let g = 0; g < 30; g++) {
    const domainLetter = String.fromCharCode(97 + (g % 26)) + (g >= 26 ? '2' : '');
    for (let i = 0; i < 2; i++) {
      findings.push(makeFinding({
        id: nextId(),
        ownerDomain: `zz-tied-${domainLetter}`,
        callerDomain: i === 0 ? 'core-tenant-security' : 'messaging-email',
        targetModelOrSymbol: `services/tied${g}.ts`,
        accessKind: 'call',
        callerPath: `server/src/${['routes', 'services', 'jobs', 'middleware', 'utils'][g % 5]}/tied${g}.ts`,
        baselineStatus: g === 0 ? 'EXISTING' : 'NEW',
        baselineEdgeId: g === 0 ? `base-${g}` : null,
      }));
    }
  }
  // Duplicate-id pair: identical length, identical key (id).
  const dupId = 'dup0000000000d';
  findings.push(makeFinding({ id: dupId, targetModelOrSymbol: 'services/dupA.ts', callerPath: 'server/src/jobs/dupA.ts' }));
  findings.push(makeFinding({ id: dupId, targetModelOrSymbol: 'services/dupA.ts', callerPath: 'server/src/jobs/dupA.ts' }));

  return findings;
}

test('buildManifest is byte-identical across canonical, reversed, and 20 seeded shuffles of a tie-laden fixture', () => {
  const canonical = buildFixtureFindings();
  const canonicalJson = JSON.stringify(buildManifest(canonical, 'fixture-sha'), null, 2);

  assert.ok(canonicalJson.includes('"actualSampleSize"'));

  const reversedJson = JSON.stringify(buildManifest([...canonical].reverse(), 'fixture-sha'), null, 2);
  assert.equal(reversedJson, canonicalJson, 'reversed-input manifest diverged from canonical');

  const REPEAT_COUNT = 20;
  for (let seed = 0; seed < REPEAT_COUNT; seed++) {
    const shuffled = seededShuffle(canonical, seed * 104729 + 7);
    const shuffledJson = JSON.stringify(buildManifest(shuffled, 'fixture-sha'), null, 2);
    assert.equal(shuffledJson, canonicalJson, `shuffle seed=${seed} manifest diverged from canonical`);
  }
});

test('buildManifest against the checked-in raw report is deterministic across repeated runs', () => {
  const reportPath = path.join(REPO_ROOT, 'docs/program/evidence/tooling/F2-GUARDRAIL-VAL-001_raw_scan_report.json');
  const r = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

  const run1 = JSON.stringify(buildManifest(r.findings, r.repositorySha), null, 2);
  const run2 = JSON.stringify(buildManifest(r.findings, r.repositorySha), null, 2);
  assert.equal(run1, run2);

  const reversedRun = JSON.stringify(buildManifest([...r.findings].reverse(), r.repositorySha), null, 2);
  assert.equal(reversedRun, run1, 'reversed real-report input diverged from canonical-order run');

  for (let seed = 0; seed < 20; seed++) {
    const shuffled = seededShuffle(r.findings, seed * 65537 + 3);
    const shuffledRun = JSON.stringify(buildManifest(shuffled, r.repositorySha), null, 2);
    assert.equal(shuffledRun, run1, `real-report shuffle seed=${seed} diverged from canonical`);
  }
});

test('real-report sample selection still yields exactly the 169 checked-in finding IDs', () => {
  const reportPath = path.join(REPO_ROOT, 'docs/program/evidence/tooling/F2-GUARDRAIL-VAL-001_raw_scan_report.json');
  const manifestPath = path.join(REPO_ROOT, 'docs/program/evidence/tooling/F2-GUARDRAIL-VAL-001_sample_manifest.json');
  const r = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const checkedInManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  const freshManifest = buildManifest(r.findings, r.repositorySha);

  const freshIds = freshManifest.samples.map((s) => s.findingId).sort();
  const checkedInIds = checkedInManifest.samples.map((s) => s.findingId).sort();

  assert.equal(freshIds.length, 169, `expected 169 selected findings, got ${freshIds.length}`);
  assert.deepEqual(
    freshIds,
    checkedInIds,
    'selected finding IDs changed vs. the checked-in manifest — the comparator fix must preserve current sample selection semantics',
  );
});

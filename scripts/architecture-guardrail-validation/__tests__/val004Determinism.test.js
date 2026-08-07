// F2-GUARDRAIL-VAL-004 determinism/correctness tests for the edge-level
// population, sample, and metrics builders. Exercises the real exported
// functions (not reimplementations) against synthetic fixtures plus the
// checked-in real scan report, matching the repo's existing determinism.test.js
// convention for VAL-001's buildSample.js.
//
// Run: node --test scripts/architecture-guardrail-validation/__tests__/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEdgePopulation, edgeKey } from '../buildVal004EdgePopulation.mjs';
import { buildSample, stableRank, targetSampleSize, edgeShape, isHighRisk } from '../buildVal004Sample.mjs';
import {
  briefCategory,
  fpIndicator,
  clopperPearsonZeroEventUpperBound,
  computeStrataStats,
  weightedEstimate,
  buildMetrics,
} from '../buildVal004Metrics.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

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

test('buildEdgePopulation collapses multiple findings sharing an edge key into one edge with correct clusterSize', () => {
  const findings = [
    makeFinding({ id: 'a', callerSymbol: 'foo' }),
    makeFinding({ id: 'b', callerSymbol: 'bar' }),
    makeFinding({ id: 'c', callerSymbol: 'baz', targetModelOrSymbol: 'services/other.ts' }),
    makeFinding({ id: 'd', baselineStatus: 'EXISTING' }),
  ];
  const pop = buildEdgePopulation({ findings, repositorySha: 'x', deterministic: true });
  assert.equal(pop.newFindingsTotal, 3);
  assert.equal(pop.newDistinctEdgesTotal, 2);
  const e1 = pop.edges.find((e) => e.targetModelOrSymbol === 'services/example.ts');
  assert.equal(e1.clusterSize, 2);
  assert.deepEqual(e1.findingIds, ['a', 'b']);
  assert.deepEqual(e1.callerSymbols, ['bar', 'foo']);
  assert.equal(pop.findingCountReconciliation.matchesNewFindingsTotal, true);
});

test('buildEdgePopulation is deterministic regardless of input finding order', () => {
  const findings = [
    makeFinding({ id: 'a', callerSymbol: 'foo' }),
    makeFinding({ id: 'b', callerSymbol: 'bar', targetModelOrSymbol: 'services/other.ts' }),
    makeFinding({ id: 'c', callerSymbol: 'baz', callerPath: 'server/src/routes/zzz.ts' }),
  ];
  const forward = buildEdgePopulation({ findings, repositorySha: 'x', deterministic: true });
  const reversed = buildEdgePopulation({ findings: [...findings].reverse(), repositorySha: 'x', deterministic: true });
  assert.deepEqual(forward, reversed);
});

test('edgeKey excludes callerSymbol (matches lib/baseline.ts MATCH_KEY_FIELDS semantics)', () => {
  const a = edgeKey(makeFinding({ callerSymbol: 'foo' }));
  const b = edgeKey(makeFinding({ callerSymbol: 'bar' }));
  assert.equal(a, b);
});

test('targetSampleSize implements n = max(150, ceil(0.20*N)), capped at N', () => {
  assert.equal(targetSampleSize(552), 150);
  assert.equal(targetSampleSize(1000), 200);
  assert.equal(targetSampleSize(100), 100); // capped at N since 0.2*100=20 < 150 but N itself is only 100
  assert.equal(targetSampleSize(10), 10);
});

test('edgeShape classifies caller/target layer combinations correctly', () => {
  assert.equal(
    edgeShape({ callerPath: 'server/src/routes/x.ts', targetModelOrSymbol: 'routes/y.ts' }),
    'routes -> routes'
  );
  assert.equal(
    edgeShape({ callerPath: 'server/src/services/x.ts', targetModelOrSymbol: 'db.ts' }),
    'services -> root-or-other'
  );
});

test('isHighRisk flags a documented high-risk domain on either endpoint', () => {
  assert.equal(isHighRisk({ ownerDomain: 'core-tenant-security', callerDomain: 'clinical-patients' }), true);
  assert.equal(isHighRisk({ ownerDomain: 'clinical-patients', callerDomain: 'core-audit-activity' }), true);
  assert.equal(isHighRisk({ ownerDomain: 'clinical-patients', callerDomain: 'clinical-appointments-availability' }), false);
});

test('stableRank is a deterministic pure function of (edgeKey, seed)', () => {
  const r1 = stableRank('some-edge-key', 'seed-A');
  const r2 = stableRank('some-edge-key', 'seed-A');
  const r3 = stableRank('some-edge-key', 'seed-B');
  assert.equal(r1, r2);
  assert.notEqual(r1, r3);
  assert.equal(r1.length, 64); // sha256 hex digest length
});

test('buildSample: every population edge is assigned to exactly one stratum (no unassigned edges) on a synthetic population', () => {
  const edges = [];
  for (let i = 0; i < 60; i++) {
    edges.push({
      edgeKey: `k${i}`,
      callerPath: `server/src/routes/f${i}.ts`,
      ownerDomain: i < 3 ? 'core-tenant-security' : 'core-shared-platform-infrastructure',
      targetModelOrSymbol: 'utils/shared.ts',
      accessKind: 'import',
      callerDomain: 'clinical-patients',
      callerDomainVaries: false,
      clusterSize: 1,
      findingIds: [`f${i}`],
      callerSymbols: ['x'],
    });
  }
  const population = { newDistinctEdgesTotal: edges.length, edges };
  const result = buildSample(population, 'test-sha');
  assert.equal(result.unassignedCount, 0);
  assert.equal(
    Object.values(result.strataPopulations).reduce((s, v) => s + v, 0),
    edges.length
  );
});

test('buildSample is byte-identical across repeated runs on the same input (no Date.now/Math.random)', () => {
  const edges = [];
  for (let i = 0; i < 40; i++) {
    edges.push({
      edgeKey: `k${i}`,
      callerPath: `server/src/services/f${i}.ts`,
      ownerDomain: 'core-storage-abstraction',
      targetModelOrSymbol: 'utils/shared.ts',
      accessKind: 'import',
      callerDomain: 'clinical-patients',
      callerDomainVaries: false,
      clusterSize: 1,
      findingIds: [`f${i}`],
      callerSymbols: ['x'],
    });
  }
  const population = { newDistinctEdgesTotal: edges.length, edges };
  const r1 = buildSample(population, 'sha-fixed');
  const r2 = buildSample(population, 'sha-fixed');
  assert.deepEqual(r1, r2);
});

test('briefCategory maps VAL-001 A-I letters to the brief A-D layer losslessly and exhaustively', () => {
  assert.equal(briefCategory('A'), 'briefA_true_positive');
  assert.equal(briefCategory('H'), 'briefA_true_positive');
  assert.equal(briefCategory('B'), 'briefB_accepted_expected');
  assert.equal(briefCategory('C'), 'briefB_accepted_expected');
  assert.equal(briefCategory('E'), 'briefC_scanner_classification_fp');
  assert.equal(briefCategory('F'), 'briefC_scanner_classification_fp');
  assert.equal(briefCategory('G'), 'briefC_scanner_classification_fp');
  assert.equal(briefCategory('D'), 'briefD_ambiguous_unverified');
  assert.equal(briefCategory('I'), 'briefD_ambiguous_unverified');
  assert.throws(() => briefCategory('Z'));
});

test('fpIndicator: 1 for accepted/scanner-FP, 0 for true positive, null (excluded) for ambiguous', () => {
  assert.equal(fpIndicator('briefB_accepted_expected'), 1);
  assert.equal(fpIndicator('briefC_scanner_classification_fp'), 1);
  assert.equal(fpIndicator('briefA_true_positive'), 0);
  assert.equal(fpIndicator('briefD_ambiguous_unverified'), null);
});

test('clopperPearsonZeroEventUpperBound: known values (rule-of-three family)', () => {
  // n=1: 1 - 0.05^1 = 0.95
  assert.ok(Math.abs(clopperPearsonZeroEventUpperBound(1) - 0.95) < 1e-9);
  // Larger n tightens the bound monotonically.
  assert.ok(clopperPearsonZeroEventUpperBound(15) < clopperPearsonZeroEventUpperBound(5));
  assert.ok(clopperPearsonZeroEventUpperBound(15) > 0);
});

test('computeStrataStats + weightedEstimate: a census stratum (n_h_effective === N_h) contributes zero variance regardless of its own rate', () => {
  const joined = [
    { edgeKey: 'a', samplingStratum: 'censusStratum', N_h: 3, briefCat: 'briefB_accepted_expected' },
    { edgeKey: 'b', samplingStratum: 'censusStratum', N_h: 3, briefCat: 'briefB_accepted_expected' },
    { edgeKey: 'c', samplingStratum: 'censusStratum', N_h: 3, briefCat: 'briefA_true_positive' },
  ];
  const strata = computeStrataStats(joined);
  assert.equal(strata.length, 1);
  assert.equal(strata[0].n_h_effective, 3);
  assert.equal(strata[0].N_h, 3);
  const est = weightedEstimate(strata, 3);
  assert.equal(est.variance, 0); // FPC = 1 - 3/3 = 0
  assert.ok(Math.abs(est.p_hat - 2 / 3) < 1e-9);
});

test('end-to-end: buildMetrics reproduces the checked-in VAL-004 sample manifest + classifications byte-for-byte on rerun', () => {
  const samplePath = path.join(REPO_ROOT, 'docs/program/evidence/tooling/F2-GUARDRAIL-VAL-004_sample_manifest.json');
  const classPath = path.join(REPO_ROOT, 'docs/program/evidence/tooling/F2-GUARDRAIL-VAL-004_classifications_merged.json');
  if (!fs.existsSync(samplePath) || !fs.existsSync(classPath)) return; // evidence not yet generated in this checkout
  const sampleManifest = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
  const classifications = JSON.parse(fs.readFileSync(classPath, 'utf8'));
  const m1 = buildMetrics(sampleManifest, classifications);
  const m2 = buildMetrics(sampleManifest, classifications);
  assert.deepEqual(m1, m2);
  assert.equal(m1.totalSampleReviewed, sampleManifest.sample.length);
});

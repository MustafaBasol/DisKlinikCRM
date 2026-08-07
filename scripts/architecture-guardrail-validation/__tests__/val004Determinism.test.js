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
import { buildSample, stableRank, targetSampleSize, edgeShape, isHighRisk, highRiskDomainKey } from '../buildVal004Sample.mjs';
import {
  briefCategory,
  fpIndicator,
  clopperPearsonZeroEventUpperBound,
  computeStrataStats,
  weightedEstimate,
  zeroEventSensitivityAnalysis,
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

// F2-GUARDRAIL-VAL-004-R1: regression tests for the symmetric (either-endpoint)
// high-risk sampling partition fix. Pre-fix, the census/oversample allocation
// was keyed only by ownerDomain, so a caller-side-only high-risk edge could
// fall into an ordinary standardProportional/smallCellCensus ownerDomain
// stratum instead of the approved high-risk sampling policy.

function makeEdge(overrides) {
  return {
    edgeKey: overrides.edgeKey,
    callerPath: overrides.callerPath || `server/src/routes/${overrides.edgeKey}.ts`,
    ownerDomain: overrides.ownerDomain,
    targetModelOrSymbol: overrides.targetModelOrSymbol || 'db.ts',
    accessKind: 'import',
    callerDomain: overrides.callerDomain,
    callerDomainVaries: false,
    clusterSize: overrides.clusterSize || 1,
    findingIds: overrides.findingIds || [`${overrides.edgeKey}-f`],
    callerSymbols: overrides.callerSymbols || ['default'],
  };
}

// A large non-high-risk ownerDomain stratum (population > SMALL_CELL_THRESHOLD
// and > HIGH_RISK_CENSUS_THRESHOLD's neighborhood is irrelevant here -- just
// needs to stay out of every census rule) so it is sampled as
// STANDARD_PROPORTIONAL rather than swallowed into a census rule, which
// would make the "did the caller-only edge leak into it" assertion vacuous.
function buildMixedHighRiskPopulation() {
  const edges = [];
  // 20 genuinely standard edges: non-high-risk owner AND caller.
  for (let i = 0; i < 20; i++) {
    edges.push(
      makeEdge({
        edgeKey: `standard-${i}`,
        ownerDomain: 'core-shared-platform-infrastructure',
        callerDomain: 'clinical-patients',
      })
    );
  }
  // 1 caller-side-only high-risk edge: non-high-risk owner, high-risk caller.
  edges.push(
    makeEdge({
      edgeKey: 'caller-only-high-risk',
      ownerDomain: 'core-shared-platform-infrastructure',
      callerDomain: 'core-tenant-security',
    })
  );
  // 1 owner-side-only high-risk edge: high-risk owner, non-high-risk caller.
  edges.push(
    makeEdge({
      edgeKey: 'owner-only-high-risk',
      ownerDomain: 'core-tenant-security',
      callerDomain: 'clinical-patients',
    })
  );
  // 1 both-sides-high-risk edge, two distinct high-risk categories.
  edges.push(
    makeEdge({
      edgeKey: 'both-sides-high-risk',
      ownerDomain: 'core-tenant-security',
      callerDomain: 'core-audit-activity',
    })
  );
  return { newDistinctEdgesTotal: edges.length, edges };
}

test('R1: caller-side-only high-risk edge cannot enter a standard proportional (or any non-high-risk) stratum', () => {
  const population = buildMixedHighRiskPopulation();
  const result = buildSample(population, 'r1-test-sha');
  const edge = result.sample.find((e) => e.edgeKey === 'caller-only-high-risk');
  assert.ok(edge, 'caller-only-high-risk edge must be present in the sample (it is high-risk, so inclusion is not probabilistic here)');
  assert.ok(
    edge.samplingStratum.startsWith('highRiskDomainCensus:') || edge.samplingStratum.startsWith('highRiskOversample:'),
    `expected a high-risk stratum, got ${edge.samplingStratum}`
  );
  assert.ok(!edge.samplingStratum.startsWith('standardProportional:'));
  assert.ok(!edge.samplingStratum.startsWith('smallCellCensus:'));
  // The edge's high-risk domain (caller-side) must be the stratum key, not
  // its non-high-risk ownerDomain.
  assert.ok(edge.samplingStratum.endsWith(':core-tenant-security'));
});

test('R1: owner-side-only high-risk edge gets high-risk census/oversample treatment', () => {
  const population = buildMixedHighRiskPopulation();
  const result = buildSample(population, 'r1-test-sha');
  const edge = result.sample.find((e) => e.edgeKey === 'owner-only-high-risk');
  assert.ok(edge);
  assert.ok(
    edge.samplingStratum.startsWith('highRiskDomainCensus:') || edge.samplingStratum.startsWith('highRiskOversample:')
  );
  assert.ok(edge.samplingStratum.endsWith(':core-tenant-security'));
});

test('R1: both-side-high-risk edge is included exactly once, under one deterministic stratum', () => {
  const population = buildMixedHighRiskPopulation();
  const result = buildSample(population, 'r1-test-sha');
  const matches = result.sample.filter((e) => e.edgeKey === 'both-sides-high-risk');
  assert.equal(matches.length, 1, 'edge must appear exactly once in the sample, not once per high-risk category/endpoint');
  const edge = matches[0];
  assert.deepEqual(edge.highRiskCategories, ['audit', 'tenancy']);
  assert.equal(
    highRiskDomainKey({ ownerDomain: edge.ownerDomain, callerDomain: edge.callerDomain }),
    'core-tenant-security',
    'ownerDomain must win the deterministic tie-break when both endpoints are high-risk'
  );
  assert.ok(
    edge.samplingStratum.startsWith('highRiskDomainCensus:') || edge.samplingStratum.startsWith('highRiskOversample:')
  );
});

test('R1: sampling partition accounts for exactly N edges on a mixed caller/owner high-risk population (no double counting, no gaps)', () => {
  const population = buildMixedHighRiskPopulation();
  const result = buildSample(population, 'r1-test-sha');
  assert.equal(result.N, 23);
  assert.equal(result.unassignedCount, 0);
  const strataPopSum = Object.values(result.strataPopulations).reduce((s, v) => s + v, 0);
  assert.equal(strataPopSum, result.N);
  // No edgeKey duplicated across strataSampleCounts/sample.
  const seen = new Set();
  for (const e of result.sample) {
    assert.ok(!seen.has(e.edgeKey), `duplicate edge in sample: ${e.edgeKey}`);
    seen.add(e.edgeKey);
  }
});

test('R1: buildSample reruns remain byte-identical on a mixed caller/owner high-risk population', () => {
  const population = buildMixedHighRiskPopulation();
  const r1 = buildSample(population, 'r1-test-sha');
  const r2 = buildSample(population, 'r1-test-sha');
  assert.deepEqual(r1, r2);
});

test('R1: zeroEventSensitivityAnalysis makes no formal confidence-coverage claim and uses non-ceiling field names', () => {
  const strata = [
    { stratum: 'a', N_h: 20, n_h_effective: 5, fp_h: 0, rate_h: 1, estimable: true },
    { stratum: 'b', N_h: 10, n_h_effective: 10, fp_h: 1, rate_h: 0.9, estimable: true },
  ];
  const result = zeroEventSensitivityAnalysis(strata, 30);
  assert.equal(result.hasConfidenceCoverage, false);
  assert.ok(typeof result.sensitivityViolationRate === 'number');
  assert.ok(typeof result.sensitivityAcceptedRate === 'number');
  assert.ok(!('p_hat_conservative_violation_rate_ceiling' in result));
  assert.ok(!('p_hat_conservative_accepted_rate' in result));
  assert.ok(/not.*confidence|no.*confidence/i.test(result.confidenceCoverageNote));
});

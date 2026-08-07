// F2-GUARDRAIL-VAL-004 deterministic NEW-edge population derivation.
//
// Per F2-GUARDRAIL-VAL-004-REVIEW-A (methodology revision addendum), the
// primary sampling/classification unit is the exact baseline-matcher edge
// key (callerPath, ownerDomain, targetModelOrSymbol, accessKind), NOT the
// raw scanner finding. The scanner emits one finding per imported symbol,
// while docs/program/evidence/tooling/F2-GUARDRAIL-PREP-010-A_cross_domain_access_inventory.json's
// match key (scripts/architecture-guardrail/lib/baseline.ts MATCH_KEY_FIELDS)
// intentionally excludes callerSymbol, so several findings can represent one
// underlying architectural boundary-crossing decision (see F2-GUARDRAIL-VAL-003:
// 88 explicit edges + 90 sibling findings = 178 flips).
//
// Pure function of a raw guardrail scan report. No Date.now()/Math.random().
//
// Usage (from repo root):
//   node scripts/architecture-guardrail-validation/buildVal004EdgePopulation.mjs <scanReportPath> <outPath>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const scanReportArg = process.argv[2] || 'docs/program/evidence/tooling/F2-GUARDRAIL-VAL-004_scan_run1.json';
const outArg = process.argv[3] || 'docs/program/evidence/tooling/F2-GUARDRAIL-VAL-004_edge_population.json';
const SCAN_REPORT_PATH = path.join(REPO_ROOT, scanReportArg);
const OUT_PATH = path.join(REPO_ROOT, outArg);

export function edgeKey(f) {
  return [f.callerPath, f.ownerDomain, f.targetModelOrSymbol, f.accessKind].join('␟');
}

export function compareCodeUnits(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function buildEdgePopulation(scanReport) {
  const allFindings = scanReport.findings;
  const newFindings = allFindings.filter((f) => f.baselineStatus === 'NEW');

  const edgeMap = new Map();
  for (const f of newFindings) {
    const k = edgeKey(f);
    if (!edgeMap.has(k)) {
      edgeMap.set(k, {
        edgeKey: k,
        callerPath: f.callerPath,
        ownerDomain: f.ownerDomain,
        targetModelOrSymbol: f.targetModelOrSymbol,
        accessKind: f.accessKind,
        callerDomain: f.callerDomain,
        findingIds: [],
        callerSymbols: new Set(),
      });
    }
    const e = edgeMap.get(k);
    e.findingIds.push(f.id);
    e.callerSymbols.add(f.callerSymbol);
    // callerDomain is expected constant per callerPath; record if it varies (would be a scanner defect).
    if (e.callerDomain !== f.callerDomain) e.callerDomainVaries = true;
  }

  const edges = [...edgeMap.values()]
    .map((e) => ({
      edgeKey: e.edgeKey,
      callerPath: e.callerPath,
      ownerDomain: e.ownerDomain,
      targetModelOrSymbol: e.targetModelOrSymbol,
      accessKind: e.accessKind,
      callerDomain: e.callerDomain,
      callerDomainVaries: e.callerDomainVaries === true,
      clusterSize: e.findingIds.length,
      findingIds: [...e.findingIds].sort(compareCodeUnits),
      callerSymbols: [...e.callerSymbols].sort(compareCodeUnits),
    }))
    .sort((a, b) => compareCodeUnits(a.edgeKey, b.edgeKey));

  const clusterSizes = edges.map((e) => e.clusterSize).sort((a, b) => a - b);
  const sum = clusterSizes.reduce((s, v) => s + v, 0);
  const mean = clusterSizes.length ? sum / clusterSizes.length : 0;
  const median = clusterSizes.length
    ? clusterSizes.length % 2 === 1
      ? clusterSizes[(clusterSizes.length - 1) / 2]
      : (clusterSizes[clusterSizes.length / 2 - 1] + clusterSizes[clusterSizes.length / 2]) / 2
    : 0;
  const max = clusterSizes.length ? clusterSizes[clusterSizes.length - 1] : 0;

  const clusterSizeBuckets = { size1: 0, size2to4: 0, size5plus: 0 };
  for (const s of clusterSizes) {
    if (s === 1) clusterSizeBuckets.size1++;
    else if (s >= 2 && s <= 4) clusterSizeBuckets.size2to4++;
    else clusterSizeBuckets.size5plus++;
  }

  const findingCountCheck = edges.reduce((s, e) => s + e.clusterSize, 0);

  return {
    repositorySha: scanReport.repositorySha,
    scanDeterministic: scanReport.deterministic,
    newFindingsTotal: newFindings.length,
    newDistinctEdgesTotal: edges.length,
    findingCountReconciliation: {
      sumOfClusterSizes: findingCountCheck,
      matchesNewFindingsTotal: findingCountCheck === newFindings.length,
    },
    clusterSizeStats: { mean, median, max, min: clusterSizes[0] ?? 0 },
    clusterSizeBuckets,
    edges,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const scanReport = JSON.parse(fs.readFileSync(SCAN_REPORT_PATH, 'utf8'));
  const population = buildEdgePopulation(scanReport);
  fs.writeFileSync(OUT_PATH, JSON.stringify(population, null, 2) + '\n');
  console.log(JSON.stringify({
    newFindingsTotal: population.newFindingsTotal,
    newDistinctEdgesTotal: population.newDistinctEdgesTotal,
    findingCountReconciliation: population.findingCountReconciliation,
    clusterSizeStats: population.clusterSizeStats,
    clusterSizeBuckets: population.clusterSizeBuckets,
  }, null, 2));
}

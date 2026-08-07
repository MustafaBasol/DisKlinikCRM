// F2-GUARDRAIL-VAL-004 deterministic stratified edge sample builder.
//
// Implements the F2-GUARDRAIL-VAL-004-REVIEW-A methodology addendum, as
// corrected by F2-GUARDRAIL-VAL-004-R1 (external architecture review on PR
// #332: the high-risk census/oversample partition was originally keyed only
// by ownerDomain, so a caller-side-only high-risk edge -- isHighRisk(e) is
// true via EITHER endpoint, see highRiskCategories()/isHighRisk() below --
// could silently fall into a standard, non-high-risk proportional stratum):
//   - sampling/classification unit = distinct baseline-matcher edge
//     (callerPath, ownerDomain, targetModelOrSymbol, accessKind), not raw
//     scanner findings (see buildVal004EdgePopulation.mjs)
//   - target sample size n = max(150, ceil(0.20 * N)), N = distinct NEW edges
//   - mandatory census strata (inclusion probability 1):
//       1. server/src/routes/organizationDashboard.ts caller edges (VAL-004
//          brief §9 special check)
//       2. route -> route cross-domain edges
//       3. edges with clusterSize >= 5
//       4. high-risk group (isHighRisk(e), either endpoint), keyed by
//          highRiskDomainKey(e) -- a deterministic, mutually-exclusive
//          per-edge key so both-endpoints-high-risk edges are counted once
//          -- strata with remaining population <= 15
//       5. any remaining ownerDomain stratum (guaranteed non-high-risk by
//          construction: every isHighRisk edge was already claimed by rule
//          4) with population <= 5
//   - high-risk-group non-census strata: oversampled at ~2x the base
//     sampling fraction, floor 15 edges (capped at stratum population)
//   - standard (non-high-risk) ownerDomain strata: proportional at the base
//     fraction, floor 1 edge per non-empty stratum
//   - selection within non-census strata: deterministic SHA-256 hash-ranked
//     pseudo-random selection, seed = "F2-GUARDRAIL-VAL-004|<baselineSha>|<edgeKey>",
//     ascending hash order, take the required count of lowest-ranked edges
//
// Pure function of the edge-population JSON plus the fixed rules below. No
// Date.now()/Math.random(). Re-running against the same population file
// reproduces a byte-identical sample manifest.
//
// Usage (from repo root):
//   node scripts/architecture-guardrail-validation/buildVal004Sample.mjs <edgePopulationPath> <baselineSha> <outPath>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const popArg = process.argv[2] || 'docs/program/evidence/tooling/F2-GUARDRAIL-VAL-004_edge_population.json';
const baselineSha = process.argv[3] || '81eab4cfb45e115f61d3a151c987d1de97a10cdc';
const outArg = process.argv[4] || 'docs/program/evidence/tooling/F2-GUARDRAIL-VAL-004_sample_manifest.json';
const scanReportArg = process.argv[5] || 'docs/program/evidence/tooling/F2-GUARDRAIL-VAL-004_scan_run1.json';
const POP_PATH = path.join(REPO_ROOT, popArg);
const OUT_PATH = path.join(REPO_ROOT, outArg);
const SCAN_REPORT_PATH = path.join(REPO_ROOT, scanReportArg);

export const SEED_PREFIX = 'F2-GUARDRAIL-VAL-004';

// High-risk domains: the task brief's named categories (tenancy, auth,
// privacy/KVKK, audit, storage, messaging, imaging, AI, integrations,
// finance-where-security-sensitive) plus a transparent, documented
// extension for three self-evidently security-critical domains the brief's
// category list did not name individually (crypto, secrets/config, and
// security-incident-detection) -- carried over from VAL-001's own
// HIGH_RISK_DOMAINS set (buildSample.js) for continuity where it already
// covered these.
export const HIGH_RISK_DOMAIN_CATEGORIES = {
  'core-tenant-security': ['tenancy'],
  'core-identity-access': ['auth'],
  'core-permissions-roles': ['auth'],
  'core-privacy-consent-retention-dsr': ['privacy-kvkk'],
  'core-audit-activity': ['audit'],
  'core-storage-abstraction': ['storage'],
  'core-platform-crypto': ['crypto-secrets (extension)'],
  'core-config-secrets': ['crypto-secrets (extension)'],
  'core-security-incident-detection': ['security-incident (extension)'],
  'messaging-ai-orchestration': ['messaging', 'ai'],
  'messaging-whatsapp': ['messaging'],
  'messaging-sms': ['messaging'],
  'messaging-email': ['messaging'],
  'messaging-instagram': ['messaging'],
  'messaging-shared-channel-infrastructure': ['messaging'],
  'messaging-automation-recall-followup': ['messaging'],
  'imaging-device-bridge': ['imaging'],
  'imaging-server-viewer': ['imaging'],
  'external-calendar-integration': ['integrations'],
  'finance-advanced-compensation': ['finance'],
  'clinical-basic-payments': ['finance'],
};

const CLUSTER_CENSUS_THRESHOLD = 5; // clusterSize >= this => census
const HIGH_RISK_CENSUS_THRESHOLD = 15; // domain remaining pop <= this => census
const SMALL_CELL_THRESHOLD = 5; // non-high-risk domain remaining pop <= this => census
const HIGH_RISK_FLOOR = 15;
const HIGH_RISK_OVERSAMPLE_MULTIPLIER = 2;
const ORG_DASH_CALLER_PATH = 'server/src/routes/organizationDashboard.ts';

export function compareCodeUnits(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function callerLayer(p) {
  const m = p.match(/server\/src\/(routes|services|jobs|middleware|utils)\//);
  return m ? m[1] : 'other';
}
export function targetLayer(t) {
  const m = t.match(/^(routes|services|jobs|middleware|utils)\//);
  return m ? m[1] : 'root-or-other';
}
export function edgeShape(e) {
  return `${callerLayer(e.callerPath)} -> ${targetLayer(e.targetModelOrSymbol)}`;
}
export function clusterSizeBucket(clusterSize) {
  if (clusterSize === 1) return '1';
  if (clusterSize >= 2 && clusterSize <= 4) return '2-4';
  return '5+';
}
export function highRiskCategories(e) {
  const cats = new Set();
  for (const cat of HIGH_RISK_DOMAIN_CATEGORIES[e.ownerDomain] || []) cats.add(cat);
  for (const cat of HIGH_RISK_DOMAIN_CATEGORIES[e.callerDomain] || []) cats.add(cat);
  return [...cats].sort(compareCodeUnits);
}
export function isHighRisk(e) {
  return highRiskCategories(e).length > 0;
}

// Deterministic, mutually-exclusive high-risk grouping key for an edge that
// satisfies isHighRisk(e). isHighRisk considers BOTH ownerDomain and
// callerDomain, so an edge can be high-risk via either endpoint (or both);
// this picks exactly one canonical domain per edge so census/oversample
// strata partition the high-risk population without ambiguity or double
// counting: ownerDomain wins when it is itself a high-risk domain (matching
// the pre-fix behavior for owner-side-high-risk edges, minimizing
// reclassification churn), otherwise callerDomain (guaranteed high-risk,
// since isHighRisk(e) is true and ownerDomain was not). Returns null for a
// non-high-risk edge -- callers must guard with isHighRisk(e)/e.highRisk.
export function highRiskDomainKey(e) {
  if ((HIGH_RISK_DOMAIN_CATEGORIES[e.ownerDomain] || []).length > 0) return e.ownerDomain;
  if ((HIGH_RISK_DOMAIN_CATEGORIES[e.callerDomain] || []).length > 0) return e.callerDomain;
  return null;
}

export function stableRank(edgeKey, seed) {
  return crypto.createHash('sha256').update(`${seed}|${edgeKey}`).digest('hex');
}

export function targetSampleSize(N) {
  const n = Math.max(150, Math.ceil(0.2 * N));
  return Math.min(n, N);
}

/**
 * @param {object} population - output of buildVal004EdgePopulation.buildEdgePopulation
 * @param {string} baselineSha
 * @param {Set<string>} existingCallerPaths - callerPaths that have >=1
 *   EXISTING (already-baselined) finding in the same scan, used to flag
 *   "partial baseline residue" edges (addendum §D.4): this exact edge is
 *   still NEW while its caller file already has at least one accepted edge.
 */
export function buildSample(population, baselineShaArg, existingCallerPaths = new Set()) {
  const N = population.newDistinctEdgesTotal;
  const n = targetSampleSize(N);
  const seed = `${SEED_PREFIX}|${baselineShaArg}`;

  const edges = population.edges.map((e) => ({
    ...e,
    edgeShape: edgeShape(e),
    clusterSizeBucket: clusterSizeBucket(e.clusterSize),
    highRisk: isHighRisk(e),
    highRiskCategories: highRiskCategories(e),
    partialBaselineResidue: existingCallerPaths.has(e.callerPath),
  }));
  const byKey = new Map(edges.map((e) => [e.edgeKey, e]));

  const included = new Map(); // edgeKey -> {reason, stratum}
  function markCensus(list, reason, stratum) {
    for (const e of list) {
      if (!included.has(e.edgeKey)) included.set(e.edgeKey, { reason, stratum, inclusionProbability: 1 });
    }
  }

  const remaining = () => edges.filter((e) => !included.has(e.edgeKey));

  // 1. organizationDashboard.ts caller census (VAL-004 brief section 9 special check)
  markCensus(
    edges.filter((e) => e.callerPath === ORG_DASH_CALLER_PATH),
    'CENSUS_ORG_DASH_CALLER',
    'orgDashCallerCensus'
  );

  // 2. route -> route cross-domain census
  markCensus(
    remaining().filter((e) => e.edgeShape === 'routes -> routes'),
    'CENSUS_ROUTE_TO_ROUTE',
    'routeToRouteCensus'
  );

  // 3. clusterSize >= 5 census
  markCensus(
    remaining().filter((e) => e.clusterSize >= CLUSTER_CENSUS_THRESHOLD),
    'CENSUS_CLUSTER_5PLUS',
    'cluster5PlusCensus'
  );

  // 4. high-risk group (by highRiskDomainKey, EITHER endpoint) census where
  //    remaining pop <= 15. Every edge with isHighRisk(e) true -- whether
  //    the high-risk domain is the owner, the caller, or both -- is grouped
  //    here exactly once via highRiskDomainKey(e), so a caller-side-only
  //    high-risk edge can never fall through to the standard/small-cell
  //    strata below (the pre-fix defect: those strata were keyed on
  //    ownerDomain alone and missed caller-only high-risk edges).
  const remainingByHighRiskKey = new Map();
  for (const e of remaining()) {
    if (!e.highRisk) continue;
    const key = highRiskDomainKey(e);
    if (!remainingByHighRiskKey.has(key)) remainingByHighRiskKey.set(key, []);
    remainingByHighRiskKey.get(key).push(e);
  }
  const highRiskOversampleDomains = [];
  for (const d of [...remainingByHighRiskKey.keys()].sort(compareCodeUnits)) {
    const pool = remainingByHighRiskKey.get(d);
    if (pool.length <= HIGH_RISK_CENSUS_THRESHOLD) {
      markCensus(pool, 'CENSUS_HIGH_RISK_DOMAIN_SMALL', `highRiskDomainCensus:${d}`);
    } else {
      highRiskOversampleDomains.push(d);
    }
  }

  // 5. small-cell census: remaining ownerDomain strata (guaranteed
  //    non-high-risk by construction -- every isHighRisk edge was already
  //    routed to step 4 above, census or oversample-pending) with remaining
  //    pop <= 5.
  const remainingByOwnerDomain2 = new Map();
  for (const e of remaining()) {
    if (e.highRisk) continue; // already routed to the high-risk track in step 4
    if (!remainingByOwnerDomain2.has(e.ownerDomain)) remainingByOwnerDomain2.set(e.ownerDomain, []);
    remainingByOwnerDomain2.get(e.ownerDomain).push(e);
  }
  const standardDomains = [];
  for (const [d, pool] of remainingByOwnerDomain2) {
    if (pool.length <= SMALL_CELL_THRESHOLD) {
      markCensus(pool, 'CENSUS_SMALL_CELL', `smallCellCensus:${d}`);
    } else {
      standardDomains.push(d);
    }
  }

  const mandatoryCensusCount = included.size;
  const remainingBudget = Math.max(0, n - mandatoryCensusCount);
  const remainingPop = remaining().length;
  const baseFraction = remainingPop > 0 ? remainingBudget / remainingPop : 0;

  const strataAllocation = [];

  // High-risk oversample strata (2x base fraction, floor 15, capped at pop)
  for (const d of highRiskOversampleDomains.sort(compareCodeUnits)) {
    const pool = remaining().filter((e) => e.highRisk && highRiskDomainKey(e) === d);
    const rawTarget = Math.round(HIGH_RISK_OVERSAMPLE_MULTIPLIER * baseFraction * pool.length);
    const target = Math.min(pool.length, Math.max(HIGH_RISK_FLOOR, rawTarget));
    strataAllocation.push({ domain: d, kind: 'HIGH_RISK_OVERSAMPLE', population: pool.length, target });
  }

  // Standard proportional strata (base fraction, floor 1). !e.highRisk is
  // required here even though standardDomains only contains non-high-risk
  // ownerDomain names: remaining() at this point still includes
  // highRiskOversample-pending edges (not yet added to `included`, only
  // counted), and a caller-side-only high-risk edge can share its
  // (non-high-risk) ownerDomain with genuinely standard edges -- without
  // this guard such an edge would be silently re-absorbed into the
  // standard stratum's population/selection pool, reproducing the exact
  // partition defect this rework fixes.
  for (const d of standardDomains.sort(compareCodeUnits)) {
    const pool = remaining().filter((e) => !e.highRisk && e.ownerDomain === d);
    const rawTarget = Math.round(baseFraction * pool.length);
    const target = Math.min(pool.length, Math.max(1, rawTarget));
    strataAllocation.push({ domain: d, kind: 'STANDARD_PROPORTIONAL', population: pool.length, target });
  }

  for (const alloc of strataAllocation) {
    const pool = remaining()
      .filter((e) =>
        alloc.kind === 'HIGH_RISK_OVERSAMPLE'
          ? e.highRisk && highRiskDomainKey(e) === alloc.domain
          : !e.highRisk && e.ownerDomain === alloc.domain
      )
      .map((e) => ({ e, rank: stableRank(e.edgeKey, seed) }));
    // Deterministic pseudo-random selection: ascending SHA-256 hash-rank
    // order, tie-broken by edgeKey (ties are not expected in practice).
    pool.sort((a, b) => compareCodeUnits(a.rank, b.rank) || compareCodeUnits(a.e.edgeKey, b.e.edgeKey));
    const chosen = pool.slice(0, alloc.target);
    const reason = alloc.kind === 'HIGH_RISK_OVERSAMPLE' ? 'SAMPLED_HIGH_RISK_OVERSAMPLE' : 'SAMPLED_STANDARD_PROPORTIONAL';
    for (const { e } of chosen) {
      included.set(e.edgeKey, {
        reason,
        stratum: `${alloc.kind === 'HIGH_RISK_OVERSAMPLE' ? 'highRiskOversample' : 'standardProportional'}:${alloc.domain}`,
        inclusionProbability: alloc.target / alloc.population,
      });
    }
  }

  const sampleEdgeKeys = [...included.keys()].sort(compareCodeUnits);
  const sample = sampleEdgeKeys.map((k) => {
    const e = byKey.get(k);
    const inc = included.get(k);
    return { ...e, selectionReason: inc.reason, samplingStratum: inc.stratum, inclusionProbability: inc.inclusionProbability };
  });

  // Stratum population/sample sizes for weighting (section I). Primary
  // weighting stratum h = the samplingStratum string -- a strict partition
  // of the full N-edge population (every edge belongs to exactly one
  // stratum whether or not it was itself selected for review).
  //
  // Census strata: population == sample count (every member was marked
  // included above with inclusionProbability 1), so both counts come
  // directly from `included`. Oversample/standard strata: population comes
  // from `strataAllocation[*].population` (computed over the FULL
  // post-census remaining pool for that domain, before the target-sized
  // subset was chosen) -- NOT from `included`, which only holds the chosen
  // subset for those strata.
  const strataPopulations = new Map();
  const strataSampleCounts = new Map();

  for (const inc of included.values()) {
    if (inc.reason.startsWith('CENSUS_')) {
      strataPopulations.set(inc.stratum, (strataPopulations.get(inc.stratum) || 0) + 1);
      strataSampleCounts.set(inc.stratum, (strataSampleCounts.get(inc.stratum) || 0) + 1);
    }
  }
  for (const alloc of strataAllocation) {
    const stratum = `${alloc.kind === 'HIGH_RISK_OVERSAMPLE' ? 'highRiskOversample' : 'standardProportional'}:${alloc.domain}`;
    strataPopulations.set(stratum, alloc.population);
    strataSampleCounts.set(stratum, alloc.target);
  }

  const totalPopulationAccountedFor = [...strataPopulations.values()].reduce((s, v) => s + v, 0);
  const unassignedCount = N - totalPopulationAccountedFor;

  return {
    baselineSha: baselineShaArg,
    seed,
    seedFormula: 'sha256(`${SEED_PREFIX}|${baselineSha}|${edgeKey}`) hex digest, ascending sort = selection rank',
    N,
    n,
    mandatoryCensusCount,
    remainingBudget,
    remainingPop,
    baseFraction,
    strataAllocation,
    unassignedCount,
    totalPopulationAccountedFor,
    strataPopulations: Object.fromEntries([...strataPopulations.entries()].sort()),
    strataSampleCounts: Object.fromEntries([...strataSampleCounts.entries()].sort()),
    sampleSize: sample.length,
    sample,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const population = JSON.parse(fs.readFileSync(POP_PATH, 'utf8'));
  const scanReport = JSON.parse(fs.readFileSync(SCAN_REPORT_PATH, 'utf8'));
  const existingCallerPaths = new Set(
    scanReport.findings.filter((f) => f.baselineStatus === 'EXISTING').map((f) => f.callerPath)
  );
  const result = buildSample(population, baselineSha, existingCallerPaths);
  fs.writeFileSync(OUT_PATH, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({
    N: result.N,
    n: result.n,
    mandatoryCensusCount: result.mandatoryCensusCount,
    remainingBudget: result.remainingBudget,
    remainingPop: result.remainingPop,
    baseFraction: result.baseFraction,
    sampleSize: result.sampleSize,
    unassignedCount: result.unassignedCount,
    strataAllocation: result.strataAllocation,
  }, null, 2));
}

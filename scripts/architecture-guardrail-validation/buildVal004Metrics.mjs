// F2-GUARDRAIL-VAL-004 signal-quality metrics: weighted population FP
// estimate, raw as-sampled rate, stratified analytic CI (finite-population
// correction), and a deterministic stratified bootstrap CI.
//
// Implements F2-GUARDRAIL-VAL-004-REVIEW-A section I/J.
//
// Taxonomy: preserves VAL-001's original A-I categories verbatim (see each
// classified-edge record's `classification` field) and maps them losslessly
// to the VAL-004 brief's simplified A-D reporting layer:
//   brief-A TRUE_POSITIVE_BOUNDARY_VIOLATION      = VAL-001 A (REAL_BOUNDARY_VIOLATION)
//                                                    + H (LEGACY_TECHNICAL_DEBT -- a
//                                                      genuine violation, just pre-existing;
//                                                      documented methodological choice, not
//                                                      a silent merge)
//   brief-B ACCEPTED_EXPECTED_EDGE                = VAL-001 B (EXPECTED_PUBLIC_CONTRACT_EDGE)
//                                                    + C (EXPECTED_PLATFORM_SHARED_EDGE)
//   brief-C SCANNER_OR_CLASSIFICATION_FALSE_POSITIVE = VAL-001 E (PARSER_FALSE_POSITIVE)
//                                                    + F (DOMAIN_CLASSIFICATION_FALSE_POSITIVE)
//                                                    + G (GENERATED_OR_TOOLING_NOISE)
//   brief-D AMBIGUOUS_OR_UNVERIFIED                = VAL-001 D (DATA_OWNERSHIP_REVIEW_REQUIRED)
//                                                    + I (SECURITY_OR_TENANT_HIGH_RISK, primary)
//
// The false-positive indicator y_i used for the weighted estimate is 1 for
// brief-B or brief-C classifications, 0 for brief-A (true positive), and
// EXCLUDED (complete-case) for brief-D (ambiguous/unverified) -- consistent
// with the original brief's own `classified_non_ambiguous` denominator
// convention. A stratum whose every reviewed member is ambiguous
// (n_h_effective = 0) is excluded from the weighted sum and flagged.
//
// Deterministic bootstrap: seed = "F2-GUARDRAIL-VAL-004-BOOTSTRAP-v1",
// hashed via SHA-256 to a 32-bit mulberry32 seed. No Math.random()/Date.now().
//
// Usage (from repo root):
//   node scripts/architecture-guardrail-validation/buildVal004Metrics.mjs <sampleManifestPath> <classificationsPath> <outPath>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const sampleArg = process.argv[2] || 'docs/program/evidence/tooling/F2-GUARDRAIL-VAL-004_sample_manifest.json';
const classArg = process.argv[3] || 'docs/program/evidence/tooling/F2-GUARDRAIL-VAL-004_classifications_merged.json';
const outArg = process.argv[4] || 'docs/program/evidence/tooling/F2-GUARDRAIL-VAL-004_metrics.json';
const SAMPLE_PATH = path.join(REPO_ROOT, sampleArg);
const CLASS_PATH = path.join(REPO_ROOT, classArg);
const OUT_PATH = path.join(REPO_ROOT, outArg);

const BRIEF_MAP = {
  A: 'briefA_true_positive',
  H: 'briefA_true_positive',
  B: 'briefB_accepted_expected',
  C: 'briefB_accepted_expected',
  E: 'briefC_scanner_classification_fp',
  F: 'briefC_scanner_classification_fp',
  G: 'briefC_scanner_classification_fp',
  D: 'briefD_ambiguous_unverified',
  I: 'briefD_ambiguous_unverified',
};

export function briefCategory(val001Cat) {
  const b = BRIEF_MAP[val001Cat];
  if (!b) throw new Error(`Unknown VAL-001 classification letter: ${val001Cat}`);
  return b;
}

// y_i: false-positive/expected-edge indicator for the weighted estimate.
// 1 = brief-B or brief-C (the guardrail flagged something that isn't a real
// violation). 0 = brief-A (true positive). null = brief-D (ambiguous,
// excluded complete-case).
export function fpIndicator(briefCat) {
  if (briefCat === 'briefB_accepted_expected' || briefCat === 'briefC_scanner_classification_fp') return 1;
  if (briefCat === 'briefA_true_positive') return 0;
  return null; // briefD_ambiguous_unverified
}

function mulberry32(seedInt) {
  let a = seedInt >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seedFromString(str) {
  const hash = crypto.createHash('sha256').update(str).digest();
  return hash.readUInt32BE(0);
}

export function computeStrataStats(joined) {
  // joined: array of { edgeKey, samplingStratum, N_h (stratum population), briefCat }
  const byStratum = new Map();
  for (const j of joined) {
    if (!byStratum.has(j.samplingStratum)) byStratum.set(j.samplingStratum, { N_h: j.N_h, items: [] });
    byStratum.get(j.samplingStratum).items.push(j);
  }
  const strata = [];
  for (const [stratum, { N_h, items }] of byStratum) {
    const nonAmbiguous = items.filter((i) => fpIndicator(i.briefCat) !== null);
    const n_h_effective = nonAmbiguous.length;
    const fp_h = nonAmbiguous.filter((i) => fpIndicator(i.briefCat) === 1).length;
    const rate_h = n_h_effective > 0 ? fp_h / n_h_effective : null;
    strata.push({
      stratum,
      N_h,
      n_h_reviewed: items.length,
      n_h_ambiguous: items.length - n_h_effective,
      n_h_effective,
      fp_h,
      rate_h,
      estimable: n_h_effective > 0,
    });
  }
  return strata.sort((a, b) => (a.stratum < b.stratum ? -1 : a.stratum > b.stratum ? 1 : 0));
}

export function weightedEstimate(strata, N) {
  const estimableStrata = strata.filter((s) => s.estimable);
  const excludedStrata = strata.filter((s) => !s.estimable);
  const coveredN = estimableStrata.reduce((s, st) => s + st.N_h, 0);
  const excludedN = excludedStrata.reduce((s, st) => s + st.N_h, 0);
  // Renormalize weights over the covered population so weights sum to 1
  // (excluded strata's population share is reported separately, not
  // silently dropped from the denominator).
  let p_hat = 0;
  for (const s of estimableStrata) {
    p_hat += (s.N_h / coveredN) * s.rate_h;
  }
  // Analytic stratified variance with finite population correction.
  // s_h^2 (sample variance of the 0/1 indicator) = n/(n-1) * p*(1-p) for n>1;
  // singleton strata (n_h_effective === 1) contribute 0 to Var (no internal
  // variance estimable from a single observation) -- documented limitation.
  let variance = 0;
  const singletonStrata = [];
  for (const s of estimableStrata) {
    const w_h = s.N_h / coveredN;
    if (s.n_h_effective <= 1) {
      if (s.n_h_effective === 1) singletonStrata.push(s.stratum);
      continue;
    }
    const fpc = 1 - s.n_h_effective / s.N_h;
    const s2_h = (s.n_h_effective / (s.n_h_effective - 1)) * s.rate_h * (1 - s.rate_h);
    variance += w_h * w_h * fpc * (s2_h / s.n_h_effective);
  }
  const se = Math.sqrt(variance);
  const z = 1.96;
  return {
    p_hat,
    variance,
    se,
    ci95_analytic: [Math.max(0, p_hat - z * se), Math.min(1, p_hat + z * se)],
    coveredN,
    excludedN,
    excludedStrata: excludedStrata.map((s) => ({ stratum: s.stratum, N_h: s.N_h, n_h_reviewed: s.n_h_reviewed })),
    singletonStrataNoVariance: singletonStrata,
  };
}

// Exact Clopper-Pearson one-sided 95% upper bound on a binomial proportion
// when zero "successes" (here: true-positive violations) are observed in n
// trials: p_upper = 1 - alpha^(1/n). Standard "rule of three"-family exact
// bound, used here as a documented robustness check because several large
// non-census strata (e.g. highRiskOversample:core-audit-activity, n=15 of
// N=62, 0 violations observed) produced a naive analytic/bootstrap variance
// of exactly zero -- a well-known degeneracy of Wald-type and parametric
// bootstrap estimators at/near a 0-or-1 observed proportion, not a defect in
// either computation. This bound gives a defensible, non-degenerate ceiling
// on how much true-violation risk could still be hiding in each such
// stratum's unobserved remainder.
export function clopperPearsonZeroEventUpperBound(n, alpha = 0.05) {
  if (n <= 0) return 1;
  return 1 - Math.pow(alpha, 1 / n);
}

export function conservativeWeightedUpperBound(strata, coveredN) {
  // For each estimable, non-census (n_h_effective < N_h) stratum with 0
  // observed violations (fp_h === n_h_effective, i.e. rate_h === 1, meaning
  // 0 true positives among reviewed items), substitute the exact
  // Clopper-Pearson zero-event upper bound on the TRUE violation rate for
  // that stratum in place of the naive "0 violations observed" plug-in.
  // Strata with >=1 observed violation, or that are a full census
  // (n_h_effective === N_h, no unobserved remainder), keep their own
  // directly-observed rate (a census has no extrapolation uncertainty; a
  // stratum with an observed violation already demonstrates non-zero risk
  // and doesn't need this particular correction).
  const detail = [];
  let p_hat_conservative = 0;
  for (const s of strata) {
    if (!s.estimable) continue;
    const isCensus = s.n_h_effective >= s.N_h;
    const zeroViolationsObserved = s.fp_h === s.n_h_effective; // rate_h === 1
    let violationRateUsed = 1 - s.rate_h;
    let corrected = false;
    if (!isCensus && zeroViolationsObserved && s.n_h_effective > 0) {
      violationRateUsed = clopperPearsonZeroEventUpperBound(s.n_h_effective);
      corrected = true;
    }
    const w_h = s.N_h / coveredN;
    p_hat_conservative += w_h * (1 - violationRateUsed);
    detail.push({ stratum: s.stratum, N_h: s.N_h, n_h_effective: s.n_h_effective, isCensus, corrected, violationRateUsed });
  }
  return { p_hat_conservative_accepted_rate: p_hat_conservative, p_hat_conservative_violation_rate_ceiling: 1 - p_hat_conservative, detail: detail.filter((d) => d.corrected) };
}

export function bootstrapCI(strata, N, seedStr, iterations = 2000) {
  const estimableStrata = strata.filter((s) => s.estimable);
  const coveredN = estimableStrata.reduce((s, st) => s + st.N_h, 0);
  const rng = mulberry32(seedFromString(seedStr));
  const estimates = [];
  for (let iter = 0; iter < iterations; iter++) {
    let p_hat_boot = 0;
    for (const s of estimableStrata) {
      // Resample n_h_effective draws with replacement from a Bernoulli(rate_h)
      // population implied by this stratum's own observed fp_h/n_h_effective
      // (equivalent to resampling the 0/1 indicator vector with replacement).
      let successes = 0;
      for (let k = 0; k < s.n_h_effective; k++) {
        if (rng() < s.rate_h) successes++;
      }
      const w_h = s.N_h / coveredN;
      p_hat_boot += w_h * (successes / s.n_h_effective);
    }
    estimates.push(p_hat_boot);
  }
  estimates.sort((a, b) => a - b);
  const lo = estimates[Math.floor(0.025 * iterations)];
  const hi = estimates[Math.min(iterations - 1, Math.ceil(0.975 * iterations) - 1)];
  return { iterations, seed: seedStr, ci95_percentile: [lo, hi], meanEstimate: estimates.reduce((s, v) => s + v, 0) / iterations };
}

export function buildMetrics(sampleManifest, classifications) {
  const N = sampleManifest.N;
  const byEdgeKey = new Map(sampleManifest.sample.map((s) => [s.edgeKey, s]));
  const classByEdgeKey = new Map(classifications.map((c) => [c.edgeKey, c]));

  const joined = sampleManifest.sample.map((s) => {
    const cls = classByEdgeKey.get(s.edgeKey);
    if (!cls) throw new Error(`Missing classification for edge ${s.edgeKey}`);
    return {
      edgeKey: s.edgeKey,
      samplingStratum: s.samplingStratum,
      N_h: sampleManifest.strataPopulations[s.samplingStratum],
      val001Classification: cls.classification,
      briefCat: briefCategory(cls.classification),
      highRisk: s.highRisk,
      highRiskCategories: s.highRiskCategories,
      edgeShape: s.edgeShape,
      clusterSizeBucket: s.clusterSizeBucket,
      partialBaselineResidue: s.partialBaselineResidue,
      ownerDomain: s.ownerDomain,
      clusterSize: s.clusterSize,
    };
  });

  const totalSample = joined.length;
  const val001Tally = {};
  const briefTally = {};
  for (const j of joined) {
    val001Tally[j.val001Classification] = (val001Tally[j.val001Classification] || 0) + 1;
    briefTally[j.briefCat] = (briefTally[j.briefCat] || 0) + 1;
  }
  const classifiedNonAmbiguous = totalSample - (briefTally.briefD_ambiguous_unverified || 0);
  const rawMetrics = {
    truePositivePrecision: (briefTally.briefA_true_positive || 0) / classifiedNonAmbiguous,
    falsePositiveRate: ((briefTally.briefB_accepted_expected || 0) + (briefTally.briefC_scanner_classification_fp || 0)) / classifiedNonAmbiguous,
    acceptedExpectedRate: (briefTally.briefB_accepted_expected || 0) / classifiedNonAmbiguous,
    scannerClassificationDefectRate: (briefTally.briefC_scanner_classification_fp || 0) / classifiedNonAmbiguous,
    ambiguityRate: (briefTally.briefD_ambiguous_unverified || 0) / totalSample,
  };

  const strata = computeStrataStats(joined);
  const weighted = weightedEstimate(strata, N);
  const bootstrap = bootstrapCI(strata, N, 'F2-GUARDRAIL-VAL-004-BOOTSTRAP-v1', 2000);
  const ciWidthAnalytic = weighted.ci95_analytic[1] - weighted.ci95_analytic[0];
  const ciWidthBootstrap = bootstrap.ci95_percentile[1] - bootstrap.ci95_percentile[0];
  const degenerateNarrowCI = ciWidthAnalytic < 0.01 && ciWidthBootstrap < 0.02;
  const ciAgreement = degenerateNarrowCI
    ? 'DEGENERATE_NARROW_BOTH_METHODS_SEE_CONSERVATIVE_BOUND'
    : Math.abs(weighted.ci95_analytic[0] - bootstrap.ci95_percentile[0]) < 0.1
        && Math.abs(weighted.ci95_analytic[1] - bootstrap.ci95_percentile[1]) < 0.1
      ? 'CONSISTENT' : 'FLAG_FOR_REVIEW_MATERIAL_DISAGREEMENT';
  const conservativeBound = conservativeWeightedUpperBound(strata, weighted.coveredN);

  // High-risk-only subset metrics
  const hrJoined = joined.filter((j) => j.highRisk);
  const hrNonAmbiguous = hrJoined.filter((j) => j.briefCat !== 'briefD_ambiguous_unverified');
  const hrMetrics = {
    n: hrJoined.length,
    classifiedNonAmbiguous: hrNonAmbiguous.length,
    truePositiveCount: hrNonAmbiguous.filter((j) => j.briefCat === 'briefA_true_positive').length,
    falsePositiveRate: hrNonAmbiguous.length
      ? hrNonAmbiguous.filter((j) => j.briefCat !== 'briefA_true_positive').length / hrNonAmbiguous.length
      : null,
    ambiguityRate: hrJoined.length ? (hrJoined.length - hrNonAmbiguous.length) / hrJoined.length : null,
  };

  // By edge-shape family
  const byShape = {};
  for (const j of joined) {
    if (!byShape[j.edgeShape]) byShape[j.edgeShape] = [];
    byShape[j.edgeShape].push(j);
  }
  const shapeMetrics = Object.entries(byShape)
    .map(([shape, items]) => {
      const na = items.filter((j) => j.briefCat !== 'briefD_ambiguous_unverified');
      return {
        edgeShape: shape,
        n: items.length,
        classifiedNonAmbiguous: na.length,
        truePositiveCount: na.filter((j) => j.briefCat === 'briefA_true_positive').length,
        falsePositiveRate: na.length ? na.filter((j) => j.briefCat !== 'briefA_true_positive').length / na.length : null,
      };
    })
    .sort((a, b) => b.n - a.n);

  // By caller layer (derived from edgeShape's left side)
  const byCallerLayer = {};
  for (const j of joined) {
    const layer = j.edgeShape.split(' -> ')[0];
    if (!byCallerLayer[layer]) byCallerLayer[layer] = [];
    byCallerLayer[layer].push(j);
  }
  const callerLayerMetrics = Object.entries(byCallerLayer)
    .map(([layer, items]) => {
      const na = items.filter((j) => j.briefCat !== 'briefD_ambiguous_unverified');
      return {
        callerLayer: layer,
        n: items.length,
        classifiedNonAmbiguous: na.length,
        truePositiveCount: na.filter((j) => j.briefCat === 'briefA_true_positive').length,
        falsePositiveRate: na.length ? na.filter((j) => j.briefCat !== 'briefA_true_positive').length / na.length : null,
      };
    })
    .sort((a, b) => b.n - a.n);

  // By cluster-size bucket
  const byCluster = {};
  for (const j of joined) {
    if (!byCluster[j.clusterSizeBucket]) byCluster[j.clusterSizeBucket] = [];
    byCluster[j.clusterSizeBucket].push(j);
  }
  const clusterMetrics = Object.entries(byCluster).map(([bucket, items]) => {
    const na = items.filter((j) => j.briefCat !== 'briefD_ambiguous_unverified');
    return {
      clusterSizeBucket: bucket,
      n: items.length,
      classifiedNonAmbiguous: na.length,
      truePositiveCount: na.filter((j) => j.briefCat === 'briefA_true_positive').length,
      falsePositiveRate: na.length ? na.filter((j) => j.briefCat !== 'briefA_true_positive').length / na.length : null,
    };
  });

  // Underlying finding counts represented by reviewed edges
  const totalFindingsRepresented = sampleManifest.sample.reduce((s, e) => s + e.clusterSize, 0);

  return {
    N,
    n: sampleManifest.n,
    totalSampleReviewed: totalSample,
    totalFindingsRepresentedBySample: totalFindingsRepresented,
    sampleFractionAtEdgeLevel: totalSample / N,
    val001Tally,
    briefTally,
    classifiedNonAmbiguous,
    rawAsSampledMetrics: rawMetrics,
    strata,
    weightedEstimate: weighted,
    bootstrapCI: bootstrap,
    ciAgreement,
    conservativeBound,
    highRiskMetrics: hrMetrics,
    byEdgeShape: shapeMetrics,
    byCallerLayer: callerLayerMetrics,
    byClusterSizeBucket: clusterMetrics,
    joined,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sampleManifest = JSON.parse(fs.readFileSync(SAMPLE_PATH, 'utf8'));
  const classifications = JSON.parse(fs.readFileSync(CLASS_PATH, 'utf8'));
  const metrics = buildMetrics(sampleManifest, classifications);
  fs.writeFileSync(OUT_PATH, JSON.stringify(metrics, null, 2) + '\n');
  console.log(JSON.stringify({
    N: metrics.N,
    n: metrics.n,
    totalSampleReviewed: metrics.totalSampleReviewed,
    val001Tally: metrics.val001Tally,
    briefTally: metrics.briefTally,
    rawAsSampledMetrics: metrics.rawAsSampledMetrics,
    weightedEstimate: {
      p_hat: metrics.weightedEstimate.p_hat,
      ci95_analytic: metrics.weightedEstimate.ci95_analytic,
      coveredN: metrics.weightedEstimate.coveredN,
      excludedN: metrics.weightedEstimate.excludedN,
      excludedStrata: metrics.weightedEstimate.excludedStrata,
      singletonStrataNoVariance: metrics.weightedEstimate.singletonStrataNoVariance,
    },
    bootstrapCI: metrics.bootstrapCI,
    ciAgreement: metrics.ciAgreement,
    conservativeBound: metrics.conservativeBound,
    highRiskMetrics: metrics.highRiskMetrics,
  }, null, 2));
}

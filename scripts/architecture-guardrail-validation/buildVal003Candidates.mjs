// F2-GUARDRAIL-VAL-003 — ad hoc, checked-in-for-reproducibility script.
// Cross-references VAL-001's classified sample (B/C = expected edges) against
// the current deterministic scan to determine exactly which findings remain
// NEW, and why, by direct inspection of the baseline JSON.
import { readFileSync, writeFileSync } from 'node:fs';

const sample = JSON.parse(
  readFileSync('docs/program/evidence/tooling/F2-GUARDRAIL-VAL-001_classified_sample.json', 'utf8'),
);
const currentScan = JSON.parse(
  readFileSync('docs/program/evidence/tooling/F2-GUARDRAIL-VAL-003_before_scan_run1.json', 'utf8'),
);
const baseline = JSON.parse(
  readFileSync('docs/program/evidence/F2-GUARDRAIL-PREP-010-A_cross_domain_access_inventory.json', 'utf8'),
);

const bcFindings = sample.classifications.filter((c) => c.classification === 'B' || c.classification === 'C');
console.log('VAL-001 B/C sample size:', bcFindings.length);

const currentById = new Map(currentScan.findings.map((f) => [f.id, f]));

const stillPresentSameId = [];
const idChanged = [];
for (const c of bcFindings) {
  const cur = currentById.get(c.findingId);
  if (cur) {
    stillPresentSameId.push({ sample: c, current: cur });
  } else {
    idChanged.push(c);
  }
}
console.log('Same finding ID still present in current scan:', stillPresentSameId.length);
console.log('Finding ID changed since VAL-001 (domain relabel etc.):', idChanged.length);

const stillNew = stillPresentSameId.filter((x) => x.current.baselineStatus === 'NEW');
const nowExisting = stillPresentSameId.filter((x) => x.current.baselineStatus === 'EXISTING');
console.log('Of same-ID findings: NEW =', stillNew.length, ' EXISTING =', nowExisting.length);

// For each still-NEW finding, look at baseline.json edges directly to see WHY no match:
// - is there ANY baseline entry with same ownerDomain+target+accessKind but different callerPath?
// - is there a baseline entry with EXACT callerPath match but different ownerDomain/target/accessKind?
// - or no related baseline entry at all?
function analyze(finding) {
  const edges = baseline.edges.filter((e) => e.proposedEnforcementKey);
  const exactCallerPathMatch = edges.filter(
    (e) => e.proposedEnforcementKey.callerPath === finding.callerPath,
  );
  const sameOwnerTargetAccess = edges.filter(
    (e) =>
      e.proposedEnforcementKey.ownerDomain === finding.ownerDomain &&
      e.proposedEnforcementKey.targetModelOrSymbol === finding.targetModelOrSymbol &&
      e.proposedEnforcementKey.accessKind === finding.accessKind,
  );
  let reason;
  if (exactCallerPathMatch.length > 0) {
    reason = 'CALLERPATH_MATCHES_BUT_OWNER_TARGET_ACCESS_DIFFERS';
  } else if (sameOwnerTargetAccess.length > 0) {
    reason = 'OWNER_TARGET_ACCESS_MATCHES_BUT_NO_BASELINE_ENTRY_FOR_THIS_CALLERPATH';
  } else {
    reason = 'NO_RELATED_BASELINE_ENTRY_AT_ALL';
  }
  return { reason, exactCallerPathMatch, sameOwnerTargetAccess };
}

const analyzed = stillNew.map((x) => {
  const a = analyze(x.current);
  return {
    findingId: x.current.id,
    callerPath: x.current.callerPath,
    callerSymbol: x.current.callerSymbol,
    ownerDomain: x.current.ownerDomain,
    targetModelOrSymbol: x.current.targetModelOrSymbol,
    accessKind: x.current.accessKind,
    valClassification: x.sample.classification,
    acceptedContractOrAdrReference: x.sample.acceptedContractOrAdrReference,
    reason: a.reason,
    relatedBaselineIds: [...new Set([...a.exactCallerPathMatch, ...a.sameOwnerTargetAccess].map((e) => e.id))],
  };
});

const reasonCounts = {};
for (const a of analyzed) reasonCounts[a.reason] = (reasonCounts[a.reason] ?? 0) + 1;
console.log('Reason breakdown:', JSON.stringify(reasonCounts, null, 2));

// Exclude organizationDashboard per parallel-isolation rule.
const excludingOrgDash = analyzed.filter(
  (a) => !a.callerPath.includes('organizationDashboard') && !a.targetModelOrSymbol.includes('organizationDashboard'),
);
console.log('Excluding organizationDashboard-involved:', analyzed.length - excludingOrgDash.length, 'removed,', excludingOrgDash.length, 'remain');

writeFileSync(
  'docs/program/evidence/tooling/F2-GUARDRAIL-VAL-003_candidate_analysis.json',
  JSON.stringify({ totalStillNew: stillNew.length, reasonCounts, candidates: excludingOrgDash }, null, 2),
);
console.log('Wrote candidate_analysis.json with', excludingOrgDash.length, 'candidates');

// F2-GUARDRAIL-VAL-003 — verifies the full before/after delta: every finding
// that flipped NEW->EXISTING must be attributable to one of the 88 newly
// added baseline entries (by exact callerPath+ownerDomain+target+accessKind),
// must not involve organizationDashboard, and no actionable finding may have
// been swept in.
import { readFileSync, writeFileSync } from 'node:fs';

const before = JSON.parse(readFileSync('docs/program/evidence/tooling/F2-GUARDRAIL-VAL-003_before_scan_run1.json', 'utf8'));
const after = JSON.parse(readFileSync('docs/program/evidence/tooling/F2-GUARDRAIL-VAL-003_after_scan_run1.json', 'utf8'));
const newEntries = JSON.parse(
  readFileSync('docs/program/evidence/tooling/F2-GUARDRAIL-VAL-003_accepted_baseline_entries.json', 'utf8'),
).entries;

const beforeById = new Map(before.findings.map((f) => [f.id, f]));
const afterById = new Map(after.findings.map((f) => [f.id, f]));

if (before.findings.length !== after.findings.length) {
  throw new Error(`Total findings changed: ${before.findings.length} -> ${after.findings.length}`);
}
for (const f of before.findings) {
  if (!afterById.has(f.id)) throw new Error(`Finding ${f.id} disappeared after change`);
}

const flipped = [];
for (const f of before.findings) {
  const b = beforeById.get(f.id);
  const a = afterById.get(f.id);
  if (b.baselineStatus === 'NEW' && a.baselineStatus === 'EXISTING') flipped.push({ before: b, after: a });
}
console.log('Findings flipped NEW -> EXISTING:', flipped.length);

const newEntryKey = (e) =>
  [e.proposedEnforcementKey.callerPath, e.proposedEnforcementKey.ownerDomain, e.proposedEnforcementKey.targetModelOrSymbol, e.proposedEnforcementKey.accessKind].join('|');
const newEntryKeys = new Set(newEntries.map(newEntryKey));

const findingKey = (f) => [f.callerPath, f.ownerDomain, f.targetModelOrSymbol, f.accessKind].join('|');

let allAttributable = true;
let orgDashInvolved = 0;
const unattributed = [];
for (const { after: f } of flipped) {
  if (f.callerPath.includes('organizationDashboard') || f.targetModelOrSymbol.includes('organizationDashboard')) {
    orgDashInvolved += 1;
  }
  if (!newEntryKeys.has(findingKey(f))) {
    allAttributable = false;
    unattributed.push(f);
  }
}
console.log('All flips attributable to one of the 88 new entries (by callerPath+ownerDomain+target+accessKind):', allAttributable);
console.log('organizationDashboard-involved flips:', orgDashInvolved);
if (unattributed.length) console.log('UNATTRIBUTED (investigate):', JSON.stringify(unattributed, null, 2));

// Findings sharing an exact key with one of the 88 explicit candidates, minus the 88 themselves = "swept in" siblings.
const explicit88Ids = new Set(newEntries.map((e) => e.sourceEdgeIds[0].replace('F2-GUARDRAIL-VAL-001:', '')));
const explicitFindingIds = new Set(
  JSON.parse(readFileSync('docs/program/evidence/tooling/F2-GUARDRAIL-VAL-003_candidate_classification.json', 'utf8')).classifications.map(
    (c) => c.findingId,
  ),
);
const sweptIn = flipped.filter(({ after: f }) => !explicitFindingIds.has(f.id));
console.log('Explicitly verified (the 88):', flipped.length - sweptIn.length);
console.log('Swept-in siblings (same key, different callerSymbol, NOT individually classified):', sweptIn.length);

// Group swept-in by the (callerPath,ownerDomain,target) key to inspect concretely.
const sweptGrouped = {};
for (const { after: f } of sweptIn) {
  const k = findingKey(f);
  (sweptGrouped[k] ??= []).push(f.callerSymbol);
}
writeFileSync(
  'docs/program/evidence/tooling/F2-GUARDRAIL-VAL-003_swept_in_siblings.json',
  JSON.stringify(
    {
      totalFlipped: flipped.length,
      explicitlyVerified: flipped.length - sweptIn.length,
      sweptInCount: sweptIn.length,
      sweptInByEdgeGroup: sweptGrouped,
      sweptInFindings: sweptIn.map(({ before: b, after: a }) => ({
        findingId: a.id,
        callerPath: a.callerPath,
        callerSymbol: a.callerSymbol,
        ownerDomain: a.ownerDomain,
        targetModelOrSymbol: a.targetModelOrSymbol,
        matchedBaselineEdgeId: a.baselineEdgeId,
      })),
    },
    null,
    2,
  ) + '\n',
);
console.log('Wrote swept_in_siblings.json');

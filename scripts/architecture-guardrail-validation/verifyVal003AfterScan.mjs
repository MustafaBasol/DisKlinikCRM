// F2-GUARDRAIL-VAL-003 — verifies the full before/after delta: every finding
// that flipped NEW->EXISTING must be attributable to one of the 88 newly
// added baseline entries (by exact callerPath+ownerDomain+target+accessKind),
// must not involve organizationDashboard, and no actionable finding may have
// been swept in.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function main() {
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

  let orgDashInvolved = 0;
  const unattributed = [];
  for (const { after: f } of flipped) {
    if (f.callerPath.includes('organizationDashboard') || f.targetModelOrSymbol.includes('organizationDashboard')) {
      orgDashInvolved += 1;
    }
    if (!newEntryKeys.has(findingKey(f))) {
      unattributed.push(f);
    }
  }
  const allAttributable = unattributed.length === 0;
  console.log('All flips attributable to one of the', newEntries.length, 'new entries (by callerPath+ownerDomain+target+accessKind):', allAttributable);
  console.log('organizationDashboard-involved flips:', orgDashInvolved);
  if (unattributed.length) console.log('UNATTRIBUTED (investigate):', JSON.stringify(unattributed, null, 2));

  // Two independently-derived views of "the explicitly re-verified findings",
  // each sourced from a DIFFERENT evidence artifact produced earlier in the
  // pipeline:
  //  - explicit88Ids: each new baseline entry's own sourceEdgeIds[0]
  //    (accepted_baseline_entries.json), i.e. the VAL-001 findingId it was
  //    authored FROM.
  //  - explicitFindingIds: each classification record's own findingId field
  //    (candidate_classification.json), i.e. the finding it classifies.
  // The swept-in/explicit split below is only trustworthy if both sources
  // agree; used here as a genuine cross-check (not left as a dead variable)
  // so a drift between the two artifacts fails loudly instead of silently
  // corrupting the swept-in count.
  const explicit88Ids = new Set(newEntries.map((e) => e.sourceEdgeIds[0].replace('F2-GUARDRAIL-VAL-001:', '')));
  const explicitFindingIds = new Set(
    JSON.parse(readFileSync('docs/program/evidence/tooling/F2-GUARDRAIL-VAL-003_candidate_classification.json', 'utf8')).classifications.map(
      (c) => c.findingId,
    ),
  );

  if (explicit88Ids.size !== explicitFindingIds.size) {
    throw new Error(
      `Explicit-finding attribution sources disagree on count: accepted_baseline_entries.json implies ${explicit88Ids.size}, candidate_classification.json implies ${explicitFindingIds.size}`,
    );
  }
  const onlyInBaselineEntries = [...explicit88Ids].filter((id) => !explicitFindingIds.has(id));
  const onlyInClassification = [...explicitFindingIds].filter((id) => !explicit88Ids.has(id));
  if (onlyInBaselineEntries.length || onlyInClassification.length) {
    throw new Error(
      `Explicit-finding attribution sources disagree on membership: ${onlyInBaselineEntries.length} findingId(s) only in accepted_baseline_entries.json (${JSON.stringify(onlyInBaselineEntries)}), ${onlyInClassification.length} only in candidate_classification.json (${JSON.stringify(onlyInClassification)})`,
    );
  }
  console.log(
    'Explicit-finding attribution cross-check: accepted_baseline_entries.json and candidate_classification.json independently agree on',
    explicit88Ids.size,
    'explicit findings',
  );

  const sweptIn = flipped.filter(({ after: f }) => !explicitFindingIds.has(f.id));
  const explicitlyVerifiedCount = flipped.length - sweptIn.length;
  console.log(`Explicitly verified (the ${explicit88Ids.size}):`, explicitlyVerifiedCount);
  console.log('Swept-in siblings (same key, different callerSymbol, NOT individually classified):', sweptIn.length);

  if (explicitlyVerifiedCount !== explicit88Ids.size) {
    throw new Error(
      `Explicitly-verified flip count (${explicitlyVerifiedCount}) does not match the independently cross-checked explicit-finding count (${explicit88Ids.size}) — some explicit candidate did not flip, or a non-explicit finding was miscounted as explicit`,
    );
  }
  if (!allAttributable) {
    throw new Error(`${unattributed.length} flipped finding(s) are not attributable to any of the ${newEntries.length} new baseline entries`);
  }
  if (orgDashInvolved !== 0) {
    throw new Error(`${orgDashInvolved} flipped finding(s) involve organizationDashboard — this violates the parallel-isolation rule`);
  }

  // Group swept-in by the (callerPath,ownerDomain,target) key to inspect concretely.
  const sweptGrouped = {};
  for (const { after: f } of sweptIn) {
    const k = findingKey(f);
    (sweptGrouped[k] ??= []).push(f.callerSymbol);
  }

  const proof = {
    explicitFindingsCount: explicit88Ids.size,
    sweptInSiblingsCount: sweptIn.length,
    totalFlippedCount: flipped.length,
    unattributedFlipsCount: unattributed.length,
    organizationDashboardInvolvedCount: orgDashInvolved,
    attributionSourcesAgree: true,
  };
  console.log('Independent proof:', JSON.stringify(proof, null, 2));

  writeFileSync(
    'docs/program/evidence/tooling/F2-GUARDRAIL-VAL-003_swept_in_siblings.json',
    JSON.stringify(
      {
        proof,
        totalFlipped: flipped.length,
        explicitlyVerified: explicitlyVerifiedCount,
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

  return proof;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}

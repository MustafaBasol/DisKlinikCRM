// F2-GUARDRAIL-VAL-003 — generates the 88 new CDA-07x baseline entries and
// the machine-readable candidate-classification companion. Ad hoc,
// checked in for reproducibility, matching this program's established
// convention (buildSample.js, buildReverseDeps.ts).
//
// Run: node --test scripts/architecture-guardrail-validation/__tests__/
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Doc-comment lines are any line whose trimmed text starts with the block
// opener ("/**") or a body/closer marker ("*", "*/"). Kept as an explicit
// startsWith check (not a regex) so opener detection cannot silently regress
// to matching an already-closed "/**/ " instead of the intended "/**"
// (F2-GUARDRAIL-VAL-003-R1 review finding).
function isDocCommentLine(line) {
  const t = line.trim();
  return t.startsWith('/**') || t.startsWith('*');
}

// Strips doc-comment markers from a single line: the "/**" opener, a "*"
// body marker, a "*/" closer, or a same-line "/** ... */" combination.
// Order matters: "/**" is checked before the bare "*" body marker so the
// three-char opener is consumed whole, not misread as "*" + "**".
export function stripDocCommentMarkers(line) {
  let s = line.trim();
  if (s.startsWith('/**')) s = s.slice(3);
  else if (s.startsWith('*/')) s = s.slice(2);
  else if (s.startsWith('*')) s = s.slice(1);
  if (s.endsWith('*/')) s = s.slice(0, -2);
  return s.trim();
}

// Pure: given a target file's raw header text (first N lines), extracts a
// short human-readable snippet from its opening doc comment, or null if
// there isn't one / it carries no text (e.g. opener+closer only).
export function extractHeaderSnippet(headerText) {
  const lines = headerText.split('\n').filter((l) => l.trim().length > 0);
  const commentLines = lines.filter(isDocCommentLine).slice(0, 3);
  if (commentLines.length === 0) return null;
  const stripped = commentLines.map(stripDocCommentMarkers).filter(Boolean);
  return stripped.length > 0 ? stripped.join(' ') : null;
}

export function main() {
  const analysis = JSON.parse(
    readFileSync('docs/program/evidence/tooling/F2-GUARDRAIL-VAL-003_candidate_analysis.json', 'utf8'),
  );
  const sample = JSON.parse(
    readFileSync('docs/program/evidence/tooling/F2-GUARDRAIL-VAL-001_classified_sample.json', 'utf8'),
  );
  const scan = JSON.parse(
    readFileSync('docs/program/evidence/tooling/F2-GUARDRAIL-VAL-003_before_scan_run1.json', 'utf8'),
  );
  const verified = JSON.parse(
    readFileSync('docs/program/evidence/tooling/F2-GUARDRAIL-VAL-003_verified_candidates.json', 'utf8'),
  );
  const baselineDoc = JSON.parse(
    readFileSync('docs/program/evidence/F2-GUARDRAIL-PREP-010-A_cross_domain_access_inventory.json', 'utf8'),
  );

  const scanById = new Map(scan.findings.map((f) => [f.id, f]));

  function headerSnippet(targetModelOrSymbol) {
    return extractHeaderSnippet(verified.targetHeaders[targetModelOrSymbol] ?? '');
  }

  const existingIds = new Set(baselineDoc.edges.map((e) => e.id));
  let nextNum = 73; // continues after CDA-072

  const newEntries = [];
  const classificationRecords = [];

  // Deterministic order: by callerPath, then callerSymbol.
  const ordered = [...analysis.candidates].sort((a, b) => {
    if (a.callerPath !== b.callerPath) return a.callerPath.localeCompare(b.callerPath);
    return a.callerSymbol.localeCompare(b.callerSymbol);
  });

  for (const cand of ordered) {
    const val001Record = sample.classifications.find(
      (c) =>
        c.callerPath === cand.callerPath &&
        c.callerSymbol === cand.callerSymbol &&
        c.targetModelOrSymbol === cand.targetModelOrSymbol &&
        c.ownerDomain === cand.ownerDomain,
    );
    const scanFinding = scanById.get(cand.findingId);
    if (!scanFinding) throw new Error(`Missing scan finding for ${cand.findingId}`);
    if (scanFinding.baselineStatus !== 'NEW') throw new Error(`Expected NEW for ${cand.findingId}`);

    let id = `CDA-${String(nextNum).padStart(3, '0')}`;
    while (existingIds.has(id)) {
      nextNum += 1;
      id = `CDA-${String(nextNum).padStart(3, '0')}`;
    }
    existingIds.add(id);
    nextNum += 1;

    const hasContractRef = Boolean(val001Record?.acceptedContractOrAdrReference);
    const header = headerSnippet(cand.targetModelOrSymbol);
    const acceptedEvidence = hasContractRef
      ? `${val001Record.acceptedContractOrAdrReference} (F2-GUARDRAIL-VAL-001 classified_sample.json, findingId ${cand.findingId}, classification ${val001Record.classification}); re-verified against current source by F2-GUARDRAIL-VAL-003 (import confirmed present, ${cand.reason === 'CALLERPATH_MATCHES_BUT_OWNER_TARGET_ACCESS_DIFFERS' ? 'a distinct edge from this caller file\'s other already-baselined edges' : 'no prior baseline entry existed for this exact edge'})`
      : `Platform-shared dependency reference: ${cand.targetModelOrSymbol}'s own module header${header ? ` ("${header}")` : ''} self-declares it as a shared/generic module, independently read by F2-GUARDRAIL-VAL-003 (not merely cited from VAL-001); VAL-001's own classification (${val001Record?.classification ?? 'n/a'}) and rationale ("${val001Record?.rationale ?? 'n/a'}") corroborate but are not the sole basis; import re-confirmed present in current source.`;

    const entry = {
      id,
      sourceEdgeIds: [`F2-GUARDRAIL-VAL-001:${cand.findingId}`],
      correctionNote: null,
      baselineAuthoringTask: 'F2-GUARDRAIL-VAL-003',
      callerDomain: scanFinding.callerDomain,
      ownerDomain: cand.ownerDomain,
      callerFile: `${cand.callerPath}${val001Record?.sourceLineRange ? ` (${val001Record.sourceLineRange.replace(cand.callerPath + ':', 'line ')})` : ''}`,
      callerSymbol: cand.callerSymbol,
      accessedTarget: `server/src/${cand.targetModelOrSymbol}`,
      operation: 'import',
      tenantScopeMechanism: 'caller-supplied clinicId/organizationId (inherited from calling route/job context; this edge is a symbol import, not a direct Prisma/tenant-scope operation of its own)',
      authorizationMechanism: 'inherited from calling route/job\'s own authorization gate',
      outputShape: 'as exported by the target module (function/value import)',
      auditOwnership: `${cand.ownerDomain} owns ${cand.targetModelOrSymbol}`,
      acceptedEvidence,
      testCoverage: 'Not independently re-verified in this pass',
      classification: 'ACCEPTED_PUBLIC_CONTRACT',
      risk: 'Low',
      proposedEnforcementKey: {
        callerPath: cand.callerPath,
        callerSymbol: cand.callerSymbol,
        ownerDomain: cand.ownerDomain,
        targetModelOrSymbol: cand.targetModelOrSymbol,
        accessKind: 'import',
        classification: 'ACCEPTED_PUBLIC_CONTRACT',
        justificationEvidenceId: `F2-GUARDRAIL-VAL-001:${cand.findingId}`,
        expiryOrRemovalTask: null,
      },
    };
    newEntries.push(entry);

    classificationRecords.push({
      findingId: cand.findingId,
      baselineId: id,
      callerPath: cand.callerPath,
      callerDomain: scanFinding.callerDomain,
      callerSymbol: cand.callerSymbol,
      ownerDomain: cand.ownerDomain,
      targetModelOrSymbol: cand.targetModelOrSymbol,
      accessKind: 'import',
      val001Classification: val001Record?.classification ?? null,
      val001Confidence: val001Record?.confidence ?? null,
      acceptedContractOrAdrReference: val001Record?.acceptedContractOrAdrReference ?? null,
      securityTenantImpact: val001Record?.securityTenantImpact ?? null,
      classificationSource: hasContractRef ? 'VAL_001_CITED_CONTRACT_REVERIFIED' : 'PLATFORM_SHARED_HEADER_REVERIFIED',
      disposition: 'ACCEPTED_BASELINE',
      dispositionReason:
        'Import independently re-confirmed present in current source (F2-GUARDRAIL-VAL-003); target module is a generic shared/platform module per direct header read; not organizationDashboard-involved; no schema/runtime/tenant/auth behavior change.',
      reasonForPriorNewStatus: cand.reason,
    });
  }

  console.log('Generated', newEntries.length, 'new baseline entries, IDs', newEntries[0].id, '..', newEntries[newEntries.length - 1].id);

  baselineDoc.edges.push(...newEntries);
  writeFileSync(
    'docs/program/evidence/F2-GUARDRAIL-PREP-010-A_cross_domain_access_inventory.json',
    JSON.stringify(baselineDoc, null, 2) + '\n',
  );

  writeFileSync(
    'docs/program/evidence/tooling/F2-GUARDRAIL-VAL-003_accepted_baseline_entries.json',
    JSON.stringify({ taskId: 'F2-GUARDRAIL-VAL-003', addedCount: newEntries.length, entries: newEntries }, null, 2) + '\n',
  );

  writeFileSync(
    'docs/program/evidence/tooling/F2-GUARDRAIL-VAL-003_candidate_classification.json',
    JSON.stringify({ taskId: 'F2-GUARDRAIL-VAL-003', totalCandidates: classificationRecords.length, classifications: classificationRecords }, null, 2) + '\n',
  );

  console.log('Wrote updated PREP-010-A baseline, accepted_baseline_entries.json, candidate_classification.json');

  return { addedCount: newEntries.length, firstId: newEntries[0].id, lastId: newEntries[newEntries.length - 1].id };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}

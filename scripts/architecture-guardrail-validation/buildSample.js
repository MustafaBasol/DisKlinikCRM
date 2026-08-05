// F2-GUARDRAIL-VAL-001 deterministic stratified sample builder.
//
// Pure function of the raw guardrail scan report content plus the fixed
// selection rules below. No Date.now()/Math.random()/timestamp is used, so
// re-running this script against the same input report byte-for-byte
// reproduces an identical sample manifest.
//
// Usage (from repo root):
//   node scripts/architecture-guardrail-validation/buildSample.js
//
// Reads:  docs/program/evidence/tooling/F2-GUARDRAIL-VAL-001_raw_scan_report.json
// Writes: docs/program/evidence/tooling/F2-GUARDRAIL-VAL-001_sample_manifest.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const REPORT_PATH = path.join(REPO_ROOT, 'docs/program/evidence/tooling/F2-GUARDRAIL-VAL-001_raw_scan_report.json');
const OUT_PATH = path.join(REPO_ROOT, 'docs/program/evidence/tooling/F2-GUARDRAIL-VAL-001_sample_manifest.json');

const HIGH_RISK_DOMAINS = new Set([
  'core-tenant-security',
  'core-identity-access',
  'core-permissions-roles',
  'core-security-incident-detection',
  'core-config-secrets',
  'core-audit-activity',
  'core-privacy-consent-retention-dsr',
]);
const TARGET_SECTOR_DOMAINS = [
  'messaging-whatsapp', 'messaging-sms', 'messaging-email', 'messaging-instagram',
  'messaging-ai-orchestration', 'messaging-automation-recall-followup',
  'imaging-server-viewer', 'imaging-device-bridge',
  'finance-advanced-compensation', 'clinical-basic-payments',
  'inventory', 'reporting-analytics',
  'core-privacy-consent-retention-dsr',
];

function pathFamily(p) {
  const m = p.match(/server\/src\/(routes|services|jobs|middleware|utils)\//);
  return m ? m[1] : 'other';
}
function edgeKey(x) { return x.ownerDomain + '|' + x.targetModelOrSymbol + '|' + x.accessKind; }

// Locale-independent, total-order string comparator. Array.prototype.sort
// requires comparators to return 0 for equal keys; a two-way ternary that
// only ever returns -1 or 1 violates that contract on a === b and, per spec,
// permits engine-dependent ordering on ties, undermining byte-identical
// determinism.
export function compareCodeUnits(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
export function compareByIdAsc(a, b) { return compareCodeUnits(a.id, b.id); }

export function buildManifest(findings, repositorySha) {
  const groups = new Map();
  for (const f of findings) {
    const k = edgeKey(f);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(f);
  }
  const groupList = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || compareCodeUnits(a[0], b[0]));
  for (const [, arr] of groupList) arr.sort(compareByIdAsc);

  const selected = new Map(); // id -> {finding, reasons:Set}
  function add(f, reason) {
    if (!selected.has(f.id)) selected.set(f.id, { finding: f, reasons: new Set() });
    selected.get(f.id).reasons.add(reason);
  }

  // 1. All EXISTING findings (baseline-matched) - small, important stratum.
  for (const f of findings) {
    if (f.baselineStatus === 'EXISTING') add(f, 'ALL_EXISTING_BASELINE_MATCHED');
  }

  // 2. The 4 declared true ownership-collision target files (F0-003 multi-domain,
  //    see config/generateDomainMap.ts's ambiguousFilesMappedToUnresolved) - up to 3 samples each.
  const COLLISION_TARGETS = [
    'routes/organizationDashboard.ts',
    'services/treatmentStockDeduction.ts',
    'utils/encryption.ts',
    'utils/secrets.ts',
  ];
  for (const t of COLLISION_TARGETS) {
    const members = findings.filter((f) => f.ownerDomain === 'UNRESOLVED' && f.targetModelOrSymbol === t)
      .sort(compareByIdAsc);
    for (const f of members.slice(0, 3)) add(f, `DECLARED_OWNERSHIP_COLLISION:${t}`);
  }

  // 3. Top 25 highest-frequency edge families - first/middle/last member each
  //    (these 25 families explain 76.3% of all 1,031 findings).
  const top25 = groupList.slice(0, 25);
  for (const [k, arr] of top25) {
    const picks = arr.length <= 3 ? arr : [arr[0], arr[Math.floor(arr.length / 2)], arr[arr.length - 1]];
    for (const f of picks) add(f, `HIGH_FREQUENCY_EDGE_FAMILY:${k}`);
  }

  // 4. Long tail: every edge family with <=3 members that involves a high-risk
  //    or named-sector domain on either caller or owner side - take 1 each.
  const tail = groupList.filter(([, arr]) => arr.length <= 3);
  for (const [k, arr] of tail) {
    const f = arr[0];
    const risky = HIGH_RISK_DOMAINS.has(f.ownerDomain) || HIGH_RISK_DOMAINS.has(f.callerDomain)
      || TARGET_SECTOR_DOMAINS.includes(f.ownerDomain) || TARGET_SECTOR_DOMAINS.includes(f.callerDomain);
    if (risky) add(f, `LOW_FREQUENCY_HIGH_RISK_EDGE_FAMILY:${k}`);
  }

  // 5. Ensure every caller path family (routes/services/jobs/middleware/utils) has >=8 samples.
  for (const fam of ['routes', 'services', 'jobs', 'middleware', 'utils']) {
    const already = [...selected.values()].filter((s) => pathFamily(s.finding.callerPath) === fam).length;
    if (already < 8) {
      const candidates = findings.filter((f) => pathFamily(f.callerPath) === fam && !selected.has(f.id))
        .sort(compareByIdAsc);
      for (const f of candidates.slice(0, 8 - already)) add(f, `CALLER_PATH_FAMILY_COVERAGE:${fam}`);
    }
  }

  // 6. Ensure every distinct ownerDomain (target domain) with >=1 finding has at least 1 sample.
  const ownerDomains = [...new Set(findings.map((f) => f.ownerDomain))];
  for (const dom of ownerDomains) {
    const already = [...selected.values()].some((s) => s.finding.ownerDomain === dom);
    if (!already) {
      const f = findings.filter((x) => x.ownerDomain === dom).sort(compareByIdAsc)[0];
      add(f, `OWNER_DOMAIN_COVERAGE:${dom}`);
    }
  }

  // 7. Ensure every distinct callerDomain with >=1 finding has at least 1 sample.
  const callerDomains = [...new Set(findings.map((f) => f.callerDomain))];
  for (const dom of callerDomains) {
    const already = [...selected.values()].some((s) => s.finding.callerDomain === dom);
    if (!already) {
      const f = findings.filter((x) => x.callerDomain === dom).sort(compareByIdAsc)[0];
      add(f, `CALLER_DOMAIN_COVERAGE:${dom}`);
    }
  }

  // 8. Named sector domains (messaging/imaging/finance/inventory/reporting/privacy): ensure >=4 each.
  for (const dom of TARGET_SECTOR_DOMAINS) {
    const already = [...selected.values()].filter((s) => s.finding.ownerDomain === dom || s.finding.callerDomain === dom).length;
    if (already < 4) {
      const candidates = findings.filter((f) => (f.ownerDomain === dom || f.callerDomain === dom) && !selected.has(f.id))
        .sort(compareByIdAsc);
      for (const f of candidates.slice(0, 4 - already)) add(f, `NAMED_SECTOR_COVERAGE:${dom}`);
    }
  }

  const finalList = [...selected.values()].sort((a, b) => compareCodeUnits(a.finding.id, b.finding.id));

  return {
    schemaVersion: '1.0.0',
    taskId: 'F2-GUARDRAIL-VAL-001',
    sourceReport: 'docs/program/evidence/tooling/F2-GUARDRAIL-VAL-001_raw_scan_report.json',
    sourceReportRepositorySha: repositorySha,
    selectionMethod: 'Deterministic, reproducible, rule-based stratified selection (no randomness, no timestamp). Re-running buildSample.js against the same raw report byte-for-byte reproduces an identical sample manifest.',
    requiredMinimumSampleSize: 120,
    actualSampleSize: finalList.length,
    strataRules: [
      'ALL_EXISTING_BASELINE_MATCHED: every one of the 13 EXISTING findings included',
      'DECLARED_OWNERSHIP_COLLISION:<target>: up to 3 findings per each of the 4 F0-003-declared multi-domain files',
      'HIGH_FREQUENCY_EDGE_FAMILY:<key>: first/middle/last member of each of the top 25 (ownerDomain,target,accessKind) families by finding count (76.3% of all findings)',
      'LOW_FREQUENCY_HIGH_RISK_EDGE_FAMILY:<key>: first member of every family with <=3 findings where either side touches a high-risk or named-sector domain',
      'CALLER_PATH_FAMILY_COVERAGE:<routes|services|jobs|middleware|utils>: topped up to >=8 samples per caller path family',
      'OWNER_DOMAIN_COVERAGE:<domain>: at least 1 sample per distinct target-owning domain (incl. UNRESOLVED)',
      'CALLER_DOMAIN_COVERAGE:<domain>: at least 1 sample per distinct caller-owning domain (incl. UNRESOLVED)',
      'NAMED_SECTOR_COVERAGE:<domain>: topped up to >=4 samples per messaging/imaging/finance/inventory/reporting/privacy domain',
    ],
    samples: finalList.map((s) => ({
      findingId: s.finding.id,
      callerPath: s.finding.callerPath,
      callerSymbol: s.finding.callerSymbol,
      ownerDomain: s.finding.ownerDomain,
      callerDomain: s.finding.callerDomain,
      targetModelOrSymbol: s.finding.targetModelOrSymbol,
      accessKind: s.finding.accessKind,
      baselineStatus: s.finding.baselineStatus,
      baselineEdgeId: s.finding.baselineEdgeId,
      selectionReasons: [...s.reasons].sort(),
    })),
  };
}

function main() {
  const r = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
  const manifest = buildManifest(r.findings, r.repositorySha);
  fs.writeFileSync(OUT_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`Sample size: ${manifest.actualSampleSize} (required minimum: 120)`);
  console.log(`Written: ${OUT_PATH}`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}

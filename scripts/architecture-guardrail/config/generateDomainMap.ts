#!/usr/bin/env node
/**
 * F2-GUARDRAIL-IMPL-001 — one-time/occasional regeneration tool for
 * config/domain-map.json.
 *
 * This is NOT part of the guardrail CLI's runtime path (cli.ts never imports
 * this file). It is a small, re-runnable provenance tool: it mechanically
 * derives a `filePath -> domainId` map from the already-accepted, repository-
 * evidenced domain-ownership inventory at
 * docs/program/evidence/F0-003_module_ownership_inventory.json (F0-003,
 * "MODULE_MAP.md" authoritative source), restricted to the five scan roots
 * this guardrail is authorized to analyze
 * (server/src/{routes,services,jobs,middleware,utils} — see
 * config/scan-roots.json). No domain assignment is invented here; every
 * entry traces back to F0-003's own `backend.{routes,services,middleware,
 * jobs,utils}` file lists.
 *
 * Re-run manually (from repo root) whenever F0-003 is amended and the
 * guardrail's domain map should be refreshed:
 *   npx tsx scripts/architecture-guardrail/config/generateDomainMap.ts
 *
 * The output is committed (config/domain-map.json) so the guardrail's own
 * CI run never depends on parsing docs/program/evidence/** at scan time —
 * that keeps "configuration" and "evidence" as separate, independently
 * reviewable concerns.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');
const SOURCE_PATH = resolve(
  REPO_ROOT,
  'docs/program/evidence/F0-003_module_ownership_inventory.json',
);
const OUTPUT_PATH = resolve(import.meta.dirname, 'domain-map.json');

const SCAN_ROOT_PREFIXES = [
  'server/src/routes/',
  'server/src/services/',
  'server/src/jobs/',
  'server/src/middleware/',
  'server/src/utils/',
];

interface F0003Domain {
  id: string;
  name: string;
  backend?: {
    routes?: string[];
    services?: string[];
    middleware?: string[];
    jobs?: string[];
    utils?: string[];
  };
}

interface F0003Inventory {
  generated_from_commit: string;
  domains: F0003Domain[];
}

function isInScanRoot(filePath: string): boolean {
  return SCAN_ROOT_PREFIXES.some((prefix) => filePath.startsWith(prefix));
}

function main(): void {
  const raw = readFileSync(SOURCE_PATH, 'utf8');
  const inventory: F0003Inventory = JSON.parse(raw);

  const fileToDomains = new Map<string, Set<string>>();

  for (const domain of inventory.domains) {
    const backend = domain.backend ?? {};
    const files = [
      ...(backend.routes ?? []),
      ...(backend.services ?? []),
      ...(backend.middleware ?? []),
      ...(backend.jobs ?? []),
      ...(backend.utils ?? []),
    ];
    for (const filePath of files) {
      if (!isInScanRoot(filePath)) continue;
      const set = fileToDomains.get(filePath) ?? new Set<string>();
      set.add(domain.id);
      fileToDomains.set(filePath, set);
    }
  }

  // F0-003 is a narrative evidence document, not a disjoint-partition
  // dataset: a small number of files are legitimately cross-referenced
  // under more than one domain's own backend.* evidence (e.g. a shared
  // infra util cited by the domain that owns it AND by a domain whose
  // evidence discussion mentions it, or a file PREP-010-A itself already
  // flags as an unresolved-ownership cross-domain caller). Inventing a
  // single winner here would be an ownership *decision* this generation
  // tool is not authorized to make. Ambiguous files are mapped to the
  // UNRESOLVED sentinel instead — the same convention F2-GUARDRAIL-PREP-
  // 010-A already uses for UNRESOLVED_OWNERSHIP edges — and the collision
  // is recorded in the output's provenance for human review.
  const collisions: Array<{ filePath: string; domains: string[] }> = [];
  const fileToDomain = new Map<string, string>();
  for (const [filePath, domains] of fileToDomains) {
    if (domains.size > 1) {
      const sortedDomains = [...domains].sort();
      collisions.push({ filePath, domains: sortedDomains });
      fileToDomain.set(filePath, 'UNRESOLVED');
    } else {
      fileToDomain.set(filePath, [...domains][0]);
    }
  }
  collisions.sort((a, b) => a.filePath.localeCompare(b.filePath));

  const sortedEntries = [...fileToDomain.entries()].sort(([a], [b]) => a.localeCompare(b));

  const output = {
    schemaVersion: '1.0.0',
    provenance: {
      generatedBy: 'scripts/architecture-guardrail/config/generateDomainMap.ts',
      sourceFile: 'docs/program/evidence/F0-003_module_ownership_inventory.json',
      sourceCommit: inventory.generated_from_commit,
      note:
        'Mechanically derived — every filePath->domainId entry traces to F0-003 backend.{routes,services,middleware,jobs,utils}. Files under the scan roots absent from this map are classified ownerDomain=UNRESOLVED at scan time, never guessed.',
      ambiguousFilesMappedToUnresolved: collisions,
    },
    scanRootPrefixes: SCAN_ROOT_PREFIXES,
    fileCount: sortedEntries.length,
    files: Object.fromEntries(sortedEntries),
  };

  writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${sortedEntries.length} file->domain entries to ${OUTPUT_PATH}`);
}

main();

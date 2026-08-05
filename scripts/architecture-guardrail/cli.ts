#!/usr/bin/env node
/**
 * F2-GUARDRAIL-IMPL-001 — Exact-Edge Architecture Guardrail (report-only).
 *
 * Repository-only, report-only, non-blocking static drift detector for
 * cross-domain symbol imports within the five explicitly authorized scan
 * roots (server/src/{routes,services,jobs,middleware,utils}). See
 * docs/program/evidence/F2-GUARDRAIL-IMPL-001_* for full scope, algorithm,
 * limitations, and the authorization chain
 * (F2-GUARDRAIL-PREP-010-A/B/C/D -> F2-SEC-003 section 6).
 *
 * Usage (from repo root):
 *   npx tsx scripts/architecture-guardrail/cli.ts [options]
 *
 * Options:
 *   --repo-root=<path>       Repository root to scan from (default: cwd)
 *   --scan-roots=<path>      scan-roots.json config (default: scripts/architecture-guardrail/config/scan-roots.json)
 *   --domain-map=<path>      domain-map.json config (default: scripts/architecture-guardrail/config/domain-map.json)
 *   --baseline=<path>        F2-GUARDRAIL-PREP-010-A baseline JSON (default: docs/program/evidence/F2-GUARDRAIL-PREP-010-A_cross_domain_access_inventory.json)
 *   --no-baseline            Skip baseline comparison entirely (report findings with no EXISTING/NEW classification)
 *   --repo-sha=<sha>         Recorded verbatim in the report as repositorySha (not verified by this tool)
 *   --deterministic          Omit generatedAt/durationMs so two runs over the same commit produce byte-identical findings/summary/baselineComparison for comparison
 *   --out=<path>             Write the JSON report to this file (always also printed to stdout)
 *
 * Exit codes:
 *   0 — scan executed, regardless of finding count (architectural findings
 *       never cause a non-zero exit).
 *   1 — genuine tool/configuration/internal execution failure: malformed or
 *       unreadable scan-roots/domain-map/baseline config, or a configured
 *       scan root missing/unreadable on disk. A single unreadable/malformed
 *       *source* file within an otherwise-present scan root does NOT cause
 *       a non-zero exit — it is recorded in the report's errors[] array.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigError, loadDomainMap, loadScanRoots } from './lib/configLoader.js';
import { discoverSourceFiles } from './lib/sourceDiscovery.js';
import { extractEdges } from './lib/edgeExtraction.js';
import {
  BaselineError,
  buildBaselineComparisonSummary,
  computeResolvedBaselineEdgeIds,
  findMatchingBaselineEntry,
  loadBaselineEntries,
} from './lib/baseline.js';
import { buildReport } from './lib/report.js';
import type { ExactEdgeTuple, ReportError } from './lib/types.js';
import { toRepoRelativePosix } from './lib/normalization.js';

export const TOOL_VERSION = '1.0.0';

interface CliOptions {
  repoRoot: string;
  scanRootsPath: string;
  domainMapPath: string;
  baselinePath: string | null;
  repoSha: string | null;
  deterministic: boolean;
  outPath: string | null;
}

export function parseArgs(argv: string[], defaultRepoRoot: string): CliOptions {
  const options: CliOptions = {
    repoRoot: defaultRepoRoot,
    scanRootsPath: resolve(import.meta.dirname, 'config/scan-roots.json'),
    domainMapPath: resolve(import.meta.dirname, 'config/domain-map.json'),
    baselinePath: resolve(
      defaultRepoRoot,
      'docs/program/evidence/F2-GUARDRAIL-PREP-010-A_cross_domain_access_inventory.json',
    ),
    repoSha: null,
    deterministic: false,
    outPath: null,
  };

  for (const arg of argv) {
    if (arg === '--no-baseline') {
      options.baselinePath = null;
    } else if (arg === '--deterministic') {
      options.deterministic = true;
    } else if (arg.startsWith('--repo-root=')) {
      options.repoRoot = resolve(arg.slice('--repo-root='.length));
    } else if (arg.startsWith('--scan-roots=')) {
      options.scanRootsPath = resolve(arg.slice('--scan-roots='.length));
    } else if (arg.startsWith('--domain-map=')) {
      options.domainMapPath = resolve(arg.slice('--domain-map='.length));
    } else if (arg.startsWith('--baseline=')) {
      options.baselinePath = resolve(arg.slice('--baseline='.length));
    } else if (arg.startsWith('--repo-sha=')) {
      options.repoSha = arg.slice('--repo-sha='.length);
    } else if (arg.startsWith('--out=')) {
      options.outPath = resolve(arg.slice('--out='.length));
    } else {
      throw new ConfigError(`Unrecognized argument: "${arg}"`);
    }
  }

  return options;
}

export function runGuardrail(options: CliOptions): { report: ReturnType<typeof buildReport>; exitCode: number } {
  const startedAt = Date.now();

  const scanRoots = loadScanRoots(options.scanRootsPath);
  const domainMap = loadDomainMap(options.domainMapPath);

  const discovery = discoverSourceFiles(options.repoRoot, scanRoots);
  const extraction = extractEdges(options.repoRoot, discovery.files, domainMap);

  const combinedErrors: ReportError[] = [...discovery.errors, ...extraction.errors];

  const baselineStatusById = new Map<string, { status: 'EXISTING' | 'NEW'; baselineEdgeId: string | null }>();
  let baselineComparison = null as ReturnType<typeof buildBaselineComparisonSummary> | null;

  if (options.baselinePath) {
    const baselineEntries = loadBaselineEntries(options.baselinePath);
    const currentTuples: ExactEdgeTuple[] = extraction.findings.map((f) => ({
      callerPath: f.callerPath,
      callerSymbol: f.callerSymbol,
      ownerDomain: f.ownerDomain,
      targetModelOrSymbol: f.targetModelOrSymbol,
      accessKind: f.accessKind,
    }));

    let newCount = 0;
    let existingCount = 0;
    for (const finding of extraction.findings) {
      const match = findMatchingBaselineEntry(baselineEntries, finding);
      if (match) {
        existingCount += 1;
        baselineStatusById.set(finding.id, { status: 'EXISTING', baselineEdgeId: match.baselineEdgeId });
      } else {
        newCount += 1;
        baselineStatusById.set(finding.id, { status: 'NEW', baselineEdgeId: null });
      }
    }

    const resolvedIds = computeResolvedBaselineEdgeIds(baselineEntries, currentTuples);
    let baselineSourceLabel: string;
    try {
      baselineSourceLabel = toRepoRelativePosix(options.repoRoot, options.baselinePath);
    } catch {
      baselineSourceLabel = '(baseline source outside repository root — path omitted)';
    }
    baselineComparison = buildBaselineComparisonSummary(
      baselineSourceLabel,
      baselineEntries,
      newCount,
      existingCount,
      resolvedIds,
    );
  } else {
    for (const finding of extraction.findings) {
      baselineStatusById.set(finding.id, { status: 'NEW', baselineEdgeId: null });
    }
  }

  const durationMs = Date.now() - startedAt;

  const report = buildReport({
    generatedAt: options.deterministic ? null : new Date().toISOString(),
    repositorySha: options.repoSha,
    scanRoots: scanRoots.roots,
    excludePatterns: scanRoots.excludePatterns,
    toolVersion: TOOL_VERSION,
    rawFindings: extraction.findings,
    baselineStatusById,
    baselineComparison,
    errors: combinedErrors,
    warnings: extraction.warnings,
    executionMetadata: {
      scanRootsUsed: scanRoots.roots,
      filesDiscovered: discovery.files.length,
      filesParsed: extraction.filesParsed,
      filesSkipped: extraction.filesSkipped,
      codeGraphUsed: false,
      codeGraphLimitationNote:
        'No CodeGraph tool was available in this environment (consistent with F2-GUARDRAIL-PREP-010-A, which recorded the same limitation). Targeted TypeScript-compiler-API source parsing over the explicitly configured scan roots was used instead; no whole-repository or whole-project exploration was performed.',
      durationMs: options.deterministic ? 0 : durationMs,
    },
  });

  // "unreadable/missing configured path" (a scan root itself, not an
  // individual source file) is a genuine configuration failure — the tool
  // did not cover its promised/authorized scope. It is still reported (see
  // report.errors above) so the cause is diagnosable, but it also makes the
  // exit code non-zero, distinct from architectural findings which never do.
  const exitCode = discovery.errors.length > 0 ? 1 : 0;

  return { report, exitCode };
}

async function main(): Promise<void> {
  const defaultRepoRoot = resolve(import.meta.dirname, '..', '..');
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2), defaultRepoRoot);
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    process.exitCode = 1;
    return;
  }

  try {
    const { report, exitCode } = runGuardrail(options);
    const json = `${JSON.stringify(report, null, 2)}\n`;
    process.stdout.write(json);
    if (options.outPath) {
      writeFileSync(options.outPath, json, 'utf8');
    }
    process.exitCode = exitCode;
  } catch (err) {
    if (err instanceof ConfigError || err instanceof BaselineError) {
      process.stderr.write(`${err.name}: ${err.message}\n`);
    } else {
      process.stderr.write(`Unexpected internal failure: ${(err as Error).stack ?? (err as Error).message}\n`);
    }
    process.exitCode = 1;
  }
}

const isDirectRun = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isDirectRun) {
  void main();
}

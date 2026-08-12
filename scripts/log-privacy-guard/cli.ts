#!/usr/bin/env node
/**
 * F3-IMPL-007 — Sensitive Runtime Logging Regression Guard.
 *
 * Deterministic, repository-only, AST-based static scanner that fails when
 * a NEW sensitive-runtime-logging pattern (raw caught error, error.message/
 * stack/cause, raw message content, raw email/phone) is introduced into a
 * logging sink (`console.*`/`logger.*`) within server/src/{routes,services,
 * jobs,middleware,utils}. See docs/program/evidence/
 * F3-IMPL-007_SENSITIVE_RUNTIME_LOGGING_REGRESSION_GUARD.md for full design,
 * rule list, and false-positive-control reasoning. This does NOT re-review
 * or re-fix any existing site — see that doc's "scope" section.
 *
 * Usage (from repo root):
 *   npx tsx scripts/log-privacy-guard/cli.ts [options]
 *
 * Options:
 *   --repo-root=<path>     Repository root to scan from (default: cwd)
 *   --scan-roots=<path>    scan-roots.json (default: scripts/log-privacy-guard/config/scan-roots.json)
 *   --baseline=<path>      baseline-exceptions.json (default: scripts/log-privacy-guard/config/baseline-exceptions.json)
 *   --no-baseline          Treat every violation as new (ignore the baseline file)
 *   --strict-baseline      Also fail (exit 1) if any baseline exception is stale (unused)
 *   --json                 Print the JSON report instead of the human report
 *   --out=<path>           Additionally write the JSON report to this file
 *
 * Exit codes:
 *   0 — no new violations, no stale-baseline failure (if --strict-baseline), no internal errors.
 *   1 — new violation(s) found, OR a baseline-config error, OR a file could
 *       not be read/parsed (fail-closed — never silently skips a file).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverSourceFiles } from './lib/sourceDiscovery.js';
import { scanFile } from './lib/scanner.js';
import { applyBaseline, BaselineConfigError, validateBaselineEntries } from './lib/baseline.js';
import { formatHumanReport, computeExitCode } from './lib/report.js';
import type {
  BaselineExceptionEntry,
  FileScanError,
  ScanResult,
  ScanRootsConfig,
  SuppressedViolation,
  Violation,
} from './lib/types.js';

export const TOOL_VERSION = '1.0.0';

interface CliOptions {
  repoRoot: string;
  scanRootsPath: string;
  baselinePath: string | null;
  strictBaseline: boolean;
  json: boolean;
  outPath: string | null;
}

function parseArgs(argv: string[], cwd: string): CliOptions {
  // Two passes: --repo-root changes the base that scan-roots/baseline
  // defaults resolve against, so it must be known before computing them,
  // regardless of its position in argv.
  const repoRootArg = argv.find((a) => a.startsWith('--repo-root='));
  const repoRoot = repoRootArg ? resolve(repoRootArg.slice('--repo-root='.length)) : cwd;

  const options: CliOptions = {
    repoRoot,
    scanRootsPath: resolve(repoRoot, 'scripts/log-privacy-guard/config/scan-roots.json'),
    baselinePath: resolve(repoRoot, 'scripts/log-privacy-guard/config/baseline-exceptions.json'),
    strictBaseline: false,
    json: false,
    outPath: null,
  };
  for (const arg of argv) {
    if (arg.startsWith('--repo-root=')) continue; // already applied above
    else if (arg.startsWith('--scan-roots=')) options.scanRootsPath = resolve(arg.slice('--scan-roots='.length));
    else if (arg.startsWith('--baseline=')) options.baselinePath = resolve(arg.slice('--baseline='.length));
    else if (arg === '--no-baseline') options.baselinePath = null;
    else if (arg === '--strict-baseline') options.strictBaseline = true;
    else if (arg === '--json') options.json = true;
    else if (arg.startsWith('--out=')) options.outPath = resolve(arg.slice('--out='.length));
  }
  return options;
}

function loadScanRootsConfig(path: string): ScanRootsConfig {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(`Could not read scan-roots config at ${path}: ${(err as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Could not parse scan-roots config at ${path}: ${(err as Error).message}`);
  }
  const cfg = parsed as Partial<ScanRootsConfig>;
  if (!Array.isArray(cfg.roots) || !Array.isArray(cfg.fileExtensions) || !Array.isArray(cfg.excludePatterns)) {
    throw new Error(`scan-roots config at ${path} is missing roots/fileExtensions/excludePatterns`);
  }
  return cfg as ScanRootsConfig;
}

function loadBaselineEntries(path: string | null): BaselineExceptionEntry[] {
  if (!path) return [];
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new BaselineConfigError(`Could not read baseline exceptions file at ${path}: ${(err as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new BaselineConfigError(`Could not parse baseline exceptions file at ${path}: ${(err as Error).message}`);
  }
  return validateBaselineEntries(parsed);
}

export function runScan(options: CliOptions): ScanResult {
  const started = Date.now();
  const scanRootsConfig = loadScanRootsConfig(options.scanRootsPath);
  const files = discoverSourceFiles(options.repoRoot, scanRootsConfig);

  const allViolations: Violation[] = [];
  const suppressed: SuppressedViolation[] = [];
  const errors: FileScanError[] = [];

  for (const file of files) {
    try {
      const text = readFileSync(file.absPath, 'utf8');
      const outcome = scanFile(file.absPath, file.relPosixPath, text);
      allViolations.push(...outcome.violations);
      suppressed.push(...outcome.suppressed);
    } catch (err) {
      errors.push({ file: file.relPosixPath, message: (err as Error).message });
    }
  }

  let baselineEntries: BaselineExceptionEntry[] = [];
  let duplicateExceptions: BaselineExceptionEntry[] = [];
  try {
    baselineEntries = loadBaselineEntries(options.baselinePath);
  } catch (err) {
    if (err instanceof BaselineConfigError) {
      errors.push({ file: options.baselinePath ?? '(baseline)', message: err.message });
    } else {
      throw err;
    }
  }

  const { newViolations, grandfathered, staleExceptions } = applyBaseline(allViolations, baselineEntries);

  return {
    violations: newViolations,
    grandfathered,
    suppressed,
    staleExceptions,
    duplicateExceptions,
    filesScanned: files.length,
    errors,
    durationMs: Date.now() - started,
  };
}

function main() {
  const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  if (!isMain) return;

  const repoRootDefault = process.cwd();
  const options = parseArgs(process.argv.slice(2), repoRootDefault);

  let result: ScanResult;
  try {
    result = runScan(options);
  } catch (err) {
    console.error(`log-privacy-guard: internal error — ${(err as Error).message}`);
    process.exit(1);
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatHumanReport(result));
  }
  if (options.outPath) {
    writeFileSync(options.outPath, JSON.stringify(result, null, 2), 'utf8');
  }

  process.exit(computeExitCode(result, options.strictBaseline));
}

main();

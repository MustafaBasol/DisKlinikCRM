#!/usr/bin/env node
/**
 * F3-CI-OPT-001 — CLI wrapper around classify.ts for GitHub Actions.
 *
 * Usage (from repo root):
 *   npx tsx scripts/ci-classify/cli.ts [options]
 *
 * Options:
 *   --files-from=<path>    Newline-delimited changed-file list (required
 *                          unless --files is given; blank lines ignored)
 *   --files=<a,b,c>        Comma-separated changed-file list (mainly for
 *                          quick manual invocation; CI uses --files-from)
 *   --github-output=<path> Append `key=value` lines here (normally
 *                          $GITHUB_OUTPUT). If omitted, outputs are only
 *                          printed to stdout, never written anywhere.
 *   --step-summary=<path>  Append a human-readable Markdown table here
 *                          (normally $GITHUB_STEP_SUMMARY). Optional.
 *
 * Never fails on a classification result — a failing exit code here would
 * make the classify job itself red, which (by design) forces the PR Gate
 * aggregator to require every downstream job, i.e. it fails CLOSED
 * (conservative), never open. See classify.ts's module doc and
 * docs/program/evidence/F3-CI-OPT-001_RISK_BASED_PATH_AWARE_PR_CI.md,
 * section "Required-check safety", for the full fail-safe argument.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify, type ClassificationResult, type DeepGateFlags } from './classify.js';

interface CliOptions {
  filesFromPath: string | null;
  filesInline: string[] | null;
  githubOutputPath: string | null;
  stepSummaryPath: string | null;
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    filesFromPath: null,
    filesInline: null,
    githubOutputPath: null,
    stepSummaryPath: null,
  };

  for (const arg of argv) {
    if (arg.startsWith('--files-from=')) {
      options.filesFromPath = arg.slice('--files-from='.length);
    } else if (arg.startsWith('--files=')) {
      const raw = arg.slice('--files='.length);
      options.filesInline = raw.length === 0 ? [] : raw.split(',');
    } else if (arg.startsWith('--github-output=')) {
      options.githubOutputPath = arg.slice('--github-output='.length);
    } else if (arg.startsWith('--step-summary=')) {
      options.stepSummaryPath = arg.slice('--step-summary='.length);
    } else {
      throw new Error(`Unrecognized argument: "${arg}"`);
    }
  }

  if (options.filesFromPath === null && options.filesInline === null) {
    throw new Error('One of --files-from=<path> or --files=<a,b,c> is required');
  }

  return options;
}

function loadFiles(options: CliOptions): string[] {
  if (options.filesInline !== null) return options.filesInline;
  const raw = readFileSync(options.filesFromPath as string, 'utf8');
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function boolStr(value: boolean): 'true' | 'false' {
  return value ? 'true' : 'false';
}

export function toGithubOutputLines(result: ClassificationResult): string[] {
  const f: DeepGateFlags = result.flags;
  return [
    `docs_only=${boolStr(result.docsOnly)}`,
    `categories_present=${result.categoriesPresent.join(',')}`,
    `run_backend_general=${boolStr(f.runBackendGeneral)}`,
    `run_postgres=${boolStr(f.runPostgres)}`,
    `run_storage=${boolStr(f.runStorage)}`,
    `run_frontend_full_suite=${boolStr(f.runFrontendFullSuite)}`,
    `run_legacy_backend=${boolStr(f.runLegacyBackend)}`,
  ];
}

export function toStepSummaryMarkdown(result: ClassificationResult): string {
  const lines: string[] = [];
  lines.push('### F3-CI-OPT-001 changed-path classification');
  lines.push('');
  lines.push(`${result.files.length} changed file(s); docs-only: **${result.docsOnly}**`);
  lines.push('');
  lines.push('| Category | Files |');
  lines.push('| --- | ---: |');
  const counts = new Map<string, number>();
  for (const category of Object.values(result.fileCategories)) {
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  for (const category of result.categoriesPresent) {
    lines.push(`| ${category} | ${counts.get(category) ?? 0} |`);
  }
  lines.push('');
  lines.push('| Deep-gate layer | Runs |');
  lines.push('| --- | --- |');
  lines.push(`| Layer 2 (non-disposable backend) | ${result.flags.runBackendGeneral} |`);
  lines.push(`| Layer 3 (disposable PostgreSQL) | ${result.flags.runPostgres} |`);
  lines.push(`| Layer 4 (PostgreSQL + MinIO storage) | ${result.flags.runStorage} |`);
  lines.push(`| Layer 5a (frontend full-suite fail-safe) | ${result.flags.runFrontendFullSuite} |`);
  lines.push(`| Layer 5b (backend legacy DB-required fail-safe) | ${result.flags.runLegacyBackend} |`);
  lines.push('');
  return lines.join('\n');
}

export function main(argv: string[]): number {
  let options: CliOptions;
  try {
    options = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    return 1;
  }

  const files = loadFiles(options);
  const result = classify(files);

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

  if (options.githubOutputPath) {
    const lines = toGithubOutputLines(result);
    appendFileSync(options.githubOutputPath, `${lines.join('\n')}\n`, 'utf8');
  }

  if (options.stepSummaryPath) {
    appendFileSync(options.stepSummaryPath, `${toStepSummaryMarkdown(result)}\n`, 'utf8');
  }

  return 0;
}

const isDirectRun = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isDirectRun) {
  process.exitCode = main(process.argv.slice(2));
}

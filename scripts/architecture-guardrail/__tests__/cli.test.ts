/**
 * Covers requirements 15 (architectural findings -> exit 0) and 16 (real
 * execution/config failure -> non-zero exit), exercised both as pure
 * function calls (runGuardrail) and as a true child-process invocation of
 * cli.ts, so the documented exit-code contract is verified end-to-end, not
 * only at the unit level.
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import type { Harness } from './testHarness.js';
import { parseArgs, runGuardrail } from '../cli.js';
import {
  FIXTURE_BASELINE_VALID,
  FIXTURE_DOMAIN_MAP,
  FIXTURE_REPO_ROOT,
  FIXTURE_SCAN_ROOTS,
  FIXTURE_SCAN_ROOTS_MISSING_PATH,
} from './fixturePaths.js';

const CLI_ENTRY = resolve(import.meta.dirname, '..', 'cli.ts');
// Resolved directly (not via `npx`/shell) so array arguments containing
// spaces (this repository's own path does, on this machine) are passed to
// the OS as single arguments rather than being shell-word-split.
// tsx's own package.json "exports" map does not expose "./dist/cli.mjs" to
// require.resolve() directly, so its package.json (which IS exported) is
// resolved first and the bin script path derived from its directory.
const TSX_CLI_ENTRY = resolve(dirname(createRequire(import.meta.url).resolve('tsx/package.json')), 'dist/cli.mjs');

function spawnCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [TSX_CLI_ENTRY, CLI_ENTRY, ...args], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

export function registerCliTests(h: Harness): void {
  h.section('cli: exit-code contract (pure function)');

  h.test('a scan that finds architectural findings still reports exitCode 0', () => {
    const { report, exitCode } = runGuardrail({
      repoRoot: FIXTURE_REPO_ROOT,
      scanRootsPath: FIXTURE_SCAN_ROOTS,
      domainMapPath: FIXTURE_DOMAIN_MAP,
      baselinePath: FIXTURE_BASELINE_VALID,
      repoSha: null,
      deterministic: true,
      outPath: null,
    });
    h.assert(report.findings.length > 0, 'sanity: fixture repo must produce findings');
    h.assertEqual(exitCode, 0, 'architectural findings must never cause a non-zero exit');
  });

  h.test('a scan with zero findings (baseline disabled, narrow scope) also reports exitCode 0', () => {
    const { report, exitCode } = runGuardrail({
      repoRoot: FIXTURE_REPO_ROOT,
      scanRootsPath: FIXTURE_SCAN_ROOTS,
      domainMapPath: FIXTURE_DOMAIN_MAP,
      baselinePath: null,
      repoSha: null,
      deterministic: true,
      outPath: null,
    });
    h.assert(report.baselineComparison === null, 'baseline disabled via --no-baseline equivalent');
    h.assertEqual(exitCode, 0, 'zero or many findings both exit 0');
  });

  h.test('a configured scan root missing on disk causes exitCode 1 (genuine configuration failure)', () => {
    const { exitCode, report } = runGuardrail({
      repoRoot: FIXTURE_REPO_ROOT,
      scanRootsPath: FIXTURE_SCAN_ROOTS_MISSING_PATH,
      domainMapPath: FIXTURE_DOMAIN_MAP,
      baselinePath: null,
      repoSha: null,
      deterministic: true,
      outPath: null,
    });
    h.assertEqual(exitCode, 1, 'missing scan root is a real configuration failure, not an architectural finding');
    h.assert(report.errors.length > 0, 'the failure must still be diagnosable from the report');
  });

  h.section('cli: argument parsing');

  h.test('unrecognized argument throws (fails fast rather than silently ignoring a typo)', () => {
    h.assertThrows(() => parseArgs(['--not-a-real-flag'], FIXTURE_REPO_ROOT), 'unknown flag must throw');
  });

  h.test('--no-baseline nulls out the baseline path', () => {
    const options = parseArgs(['--no-baseline'], FIXTURE_REPO_ROOT);
    h.assertEqual(options.baselinePath, null, '--no-baseline must disable baseline comparison');
  });

  h.section('cli: real process invocation (spawned subprocess)');

  h.test('spawned cli.ts against the fixture repo exits 0 despite findings, and stdout is valid JSON', () => {
    const result = spawnCli([
      `--repo-root=${FIXTURE_REPO_ROOT}`,
      `--scan-roots=${FIXTURE_SCAN_ROOTS}`,
      `--domain-map=${FIXTURE_DOMAIN_MAP}`,
      `--baseline=${FIXTURE_BASELINE_VALID}`,
      '--deterministic',
    ]);
    h.assertEqual(result.status, 0, `expected exit 0, got ${result.status}; stderr: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    h.assert(Array.isArray(parsed.findings) && parsed.findings.length > 0, 'stdout must be the JSON report with findings');
  });

  h.test('spawned cli.ts with an unrecognized flag exits non-zero', () => {
    const result = spawnCli(['--this-flag-does-not-exist']);
    h.assert(result.status !== 0, `expected non-zero exit for an unrecognized flag, got ${result.status}`);
  });
}

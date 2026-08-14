/**
 * recoveryStatusFileContract.test.ts — F4-FCR-001
 *
 * Pins the contract seam between the application and the host monitor.
 *
 * `server/src/services/recoveryStatusFile.ts` writes an operational status
 * document; `scripts/noramedi-opscheck.sh` reads it with a no-jq regex parser
 * in its `filebackup` and `drill` checks. Those two live in different
 * languages, different processes, and different deploy artifacts, so a shape
 * change on either side would otherwise be caught only in production — and
 * caught in the worst possible direction, because a document the parser
 * cannot read must fail closed and page an operator.
 *
 * This test therefore does NOT assert against a hand-written fixture. It runs
 * the REAL mapper and the REAL serializer, then feeds the bytes to the REAL
 * shell script, and asserts the exit-code bits the F4-FCR-001 contract
 * defines: filebackup=8, drill=16, ping=32, config=64.
 *
 * No DB and no network required — the mapper is pure and the script runs with
 * --dry-run so it never pings anything.
 *
 * Run with: tsx src/tests/recoveryStatusFileContract.test.ts
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  mapRecoveryStatusDocument,
  serializeRecoveryStatusDocument,
  RECOVERY_STATUS_SCHEMA_VERSION,
  type RecoveryStatusDrillInput,
  type RecoveryStatusFileBackupInput,
} from '../services/recoveryStatusFile.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { console.log(`  ✓ ${name}`); passed++; })
    .catch((err: unknown) => {
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
      failed++;
    });
}

function section(title: string) {
  console.log(`\n${title}`);
}

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(THIS_DIR, '..', '..', '..');
const OPSCHECK = path.join(REPO_ROOT, 'scripts', 'noramedi-opscheck.sh');

// Exit-code bits defined by the F4-FCR-001 revision of the opscheck contract.
const BIT_FILEBACKUP = 8;
const BIT_DRILL = 16;

/**
 * Resolves a bash that can actually SEE the repository.
 *
 * On Windows a bare `bash` frequently resolves to WSL's `/bin/bash`, which
 * runs in a Linux filesystem namespace and cannot open `E:/...` paths — it
 * fails with exit 127, indistinguishable at a glance from a broken script.
 * Each candidate is therefore probed by asking it to stat the real script,
 * not merely to start. Returns null when no usable bash exists.
 */
function resolveBash(): string | null {
  const candidates = [
    process.env.NORAMEDI_TEST_BASH,
    'C:/Program Files/Git/bin/bash.exe',
    'C:/Program Files (x86)/Git/bin/bash.exe',
    'bash',
  ].filter((c): c is string => typeof c === 'string' && c.length > 0);

  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['-c', `test -f "${toPosixPath(OPSCHECK)}"`], { stdio: 'ignore' });
    if (!probe.error && probe.status === 0) return candidate;
  }
  return null;
}

let BASH: string = 'bash';

/**
 * Git Bash accepts a drive-lettered path as long as the separators are
 * forward slashes (`E:/a/b`). It does NOT need — and must not be given — an
 * `/e/a/b` style mount path, which fails to resolve. Linux/macOS paths pass
 * through untouched.
 */
function toPosixPath(p: string): string {
  return p.replace(/\\/g, '/');
}

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60_000);
}

function healthyFileBackup(): RecoveryStatusFileBackupInput {
  return {
    enabled: true,
    destinationOffHost: true,
    lastTerminalRun: {
      status: 'completed',
      startedAt: minutesAgo(70),
      finishedAt: minutesAgo(60),
      filesFailed: 0,
      filesMissing: 0,
    },
  };
}

function healthyDrill(): RecoveryStatusDrillInput {
  return {
    lastTerminalRehearsal: {
      status: 'passed',
      kind: 'file_restore_rehearsal',
      startedAt: minutesAgo(60 * 24),
    },
  };
}

/**
 * Writes a real serialized document and runs the real script over it.
 * Returns the script's exit code.
 */
function runOpscheck(
  fileBackup: RecoveryStatusFileBackupInput,
  drills: RecoveryStatusDrillInput,
): number {
  const doc = mapRecoveryStatusDocument(fileBackup, drills);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noramedi-recovery-contract-'));
  const statusFile = path.join(dir, 'recovery-status.json');
  try {
    fs.writeFileSync(statusFile, serializeRecoveryStatusDocument(doc), { mode: 0o600 });
    return runOpscheckOnFile(statusFile);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function invokeOpscheck(statusFile: string): { code: number; output: string } {
  const result = spawnSync(
    BASH,
    [toPosixPath(OPSCHECK), '--dry-run', '--check', 'filebackup', '--check', 'drill'],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        NORAMEDI_OPSCHECK_RECOVERY_STATUS_FILE: toPosixPath(statusFile),
      },
    },
  );
  if (result.error) throw result.error;
  const code = result.status ?? -1;
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  // 126/127 mean the shell never executed the script (not found / not
  // executable). Those must be a hard error, NOT a value the fail-closed
  // assertions below can accidentally satisfy — `assert.notEqual(code, 0)`
  // would otherwise pass on a broken invocation and report false confidence.
  if (code === 126 || code === 127) {
    throw new Error(`opscheck did not execute (exit ${code}). ${output}`);
  }
  return { code, output };
}

function runOpscheckOnFile(statusFile: string): number {
  return invokeOpscheck(statusFile).code;
}

async function main() {
  if (!fs.existsSync(OPSCHECK)) {
    console.error(`FATAL: opscheck script not found at ${OPSCHECK}`);
    process.exit(1);
  }

  const resolved = resolveBash();
  if (!resolved) {
    // FAIL, do not skip. An earlier version returned here and exited 0, so a
    // CI image whose bash could not see the checkout would have turned this
    // whole gate green while executing zero end-to-end assertions — the exact
    // false-confidence failure this test exists to prevent elsewhere.
    console.error('\n!! FAIL: no bash able to read this repository was found.');
    console.error('!! This contract test cannot be skipped — it is the only thing pinning the');
    console.error('!! recoveryStatusFile.ts <-> noramedi-opscheck.sh contract.');
    console.error('!! Install Git Bash, or set NORAMEDI_TEST_BASH to a usable bash.\n');
    process.exit(1);
  }
  BASH = resolved;

  section('Document shape — the parser contract the shell side depends on');

  await test('schemaVersion appears exactly once in the serialized document', () => {
    const text = serializeRecoveryStatusDocument(
      mapRecoveryStatusDocument(healthyFileBackup(), healthyDrill()),
    );
    const occurrences = text.split('"schemaVersion"').length - 1;
    assert.equal(occurrences, 1, 'the shell parser requires exactly one schemaVersion occurrence');
  });

  await test('schemaVersion value matches the version the shell parser accepts', () => {
    assert.equal(RECOVERY_STATUS_SCHEMA_VERSION, 1);
  });

  await test('fileBackup and drill are flat objects (a nested object fails the parser closed)', () => {
    const doc = mapRecoveryStatusDocument(healthyFileBackup(), healthyDrill());
    for (const key of ['fileBackup', 'drill'] as const) {
      for (const [field, value] of Object.entries(doc[key])) {
        assert.notEqual(
          typeof value,
          'object',
          `${key}.${field} must be a scalar — the shell parser matches [^{}]* inside the block`,
        );
      }
    }
  });

  await test('every emitted timestamp is ISO-8601 ending in Z', () => {
    const doc = mapRecoveryStatusDocument(healthyFileBackup(), healthyDrill());
    const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
    assert.match(doc.generatedAt, iso);
    assert.match(String(doc.fileBackup.lastRunAt), iso);
    assert.match(String(doc.drill.lastRunAt), iso);
  });

  await test('absent history OMITS lastRunAt rather than inventing a placeholder', () => {
    const doc = mapRecoveryStatusDocument(
      { enabled: true, destinationOffHost: true, lastTerminalRun: null },
      { lastTerminalRehearsal: null },
    );
    assert.equal('lastRunAt' in doc.fileBackup, false);
    assert.equal('lastRunAt' in doc.drill, false);
  });

  await test('a terminal row missing finishedAt falls back to startedAt (defensive)', () => {
    const started = minutesAgo(30);
    const doc = mapRecoveryStatusDocument(
      { enabled: true, destinationOffHost: true, lastTerminalRun: { status: 'completed', startedAt: started, finishedAt: null, filesFailed: 0, filesMissing: 0 } },
      healthyDrill(),
    );
    assert.equal(doc.fileBackup.lastRunAt, started.toISOString());
  });

  await test('destinationOffHost is carried into the document (the monitor cannot see it otherwise)', () => {
    const doc = mapRecoveryStatusDocument(
      { enabled: true, destinationOffHost: false, lastTerminalRun: null },
      healthyDrill(),
    );
    assert.equal(doc.fileBackup.destinationOffHost, false);
  });

  section('End-to-end — real writer output through the real shell consumer');

  await test('REGRESSION (H1): an in-flight sweep does not page the operator', () => {
    // The document reports the last TERMINAL run, so a sweep running right now
    // is simply invisible to the monitor. Reporting the newest row verbatim
    // would emit status:"running", which both checks treat as failure — every
    // nightly sweep would have /fail-pinged the dead-man's switch.
    assert.equal(runOpscheck(healthyFileBackup(), healthyDrill()), 0);
  });

  await test('REGRESSION (H5): same-host destination fails the filebackup check (exit 8)', () => {
    const fb = healthyFileBackup();
    fb.destinationOffHost = false;
    assert.equal(runOpscheck(fb, healthyDrill()), BIT_FILEBACKUP);
  });

  await test('REGRESSION (H5): same-host destination passes only with an explicit opt-out', () => {
    const fb = healthyFileBackup();
    fb.destinationOffHost = false;
    const doc = mapRecoveryStatusDocument(fb, healthyDrill());
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noramedi-recovery-contract-'));
    const statusFile = path.join(dir, 'recovery-status.json');
    try {
      fs.writeFileSync(statusFile, serializeRecoveryStatusDocument(doc), { mode: 0o600 });
      const result = spawnSync(
        BASH,
        [toPosixPath(OPSCHECK), '--dry-run', '--check', 'filebackup'],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            NORAMEDI_OPSCHECK_RECOVERY_STATUS_FILE: toPosixPath(statusFile),
            NORAMEDI_OPSCHECK_FILEBACKUP_REQUIRE_OFFHOST: 'false',
          },
        },
      );
      assert.equal(result.status, 0, 'explicit opt-out should pass');
      assert.match(`${result.stdout ?? ''}${result.stderr ?? ''}`, /WARNING/, 'opt-out must still warn');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('REGRESSION (H3): a stale writer fails the DRILL check too, not just filebackup', () => {
    // generatedAt is validated in the shared loader. Before the fix it lived
    // only in check_filebackup, so `--check drill` reported OK off a status
    // file that had not been refreshed for weeks — a dead worker keeping a
    // dead-man's switch green.
    const staleWriterNow = minutesAgo(60 * 24 * 20); // 20 days ago
    const doc = mapRecoveryStatusDocument(healthyFileBackup(), healthyDrill(), staleWriterNow);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noramedi-recovery-contract-'));
    const statusFile = path.join(dir, 'recovery-status.json');
    try {
      fs.writeFileSync(statusFile, serializeRecoveryStatusDocument(doc), { mode: 0o600 });
      const result = spawnSync(
        BASH,
        [toPosixPath(OPSCHECK), '--dry-run', '--check', 'drill'],
        {
          encoding: 'utf8',
          env: { ...process.env, NORAMEDI_OPSCHECK_RECOVERY_STATUS_FILE: toPosixPath(statusFile) },
        },
      );
      assert.equal(result.status, BIT_DRILL, 'a stale status file must fail the drill check');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('healthy document passes both checks (exit 0)', () => {
    assert.equal(runOpscheck(healthyFileBackup(), healthyDrill()), 0);
  });

  await test('file backup disabled -> filebackup bit only (exit 8)', () => {
    assert.equal(runOpscheck({ enabled: false, destinationOffHost: true, lastTerminalRun: null }, healthyDrill()), BIT_FILEBACKUP);
  });

  await test('file backup status "failed" -> filebackup bit (exit 8)', () => {
    const fb = healthyFileBackup();
    fb.lastTerminalRun!.status = 'failed';
    assert.equal(runOpscheck(fb, healthyDrill()), BIT_FILEBACKUP);
  });

  await test('filesFailed > 0 on an otherwise completed run -> filebackup bit (exit 8)', () => {
    const fb = healthyFileBackup();
    fb.lastTerminalRun!.filesFailed = 3;
    assert.equal(runOpscheck(fb, healthyDrill()), BIT_FILEBACKUP);
  });

  await test('filesMissing > 0 -> filebackup bit (exit 8)', () => {
    const fb = healthyFileBackup();
    fb.lastTerminalRun!.filesMissing = 1;
    assert.equal(runOpscheck(fb, healthyDrill()), BIT_FILEBACKUP);
  });

  await test('stale file backup (older than default 30h) -> filebackup bit (exit 8)', () => {
    const fb = healthyFileBackup();
    fb.lastTerminalRun!.finishedAt = minutesAgo(60 * 31);
    fb.lastTerminalRun!.startedAt = minutesAgo(60 * 31);
    assert.equal(runOpscheck(fb, healthyDrill()), BIT_FILEBACKUP);
  });

  await test('never-run file backup (no lastRun) -> filebackup bit (exit 8)', () => {
    assert.equal(runOpscheck({ enabled: true, destinationOffHost: true, lastTerminalRun: null }, healthyDrill()), BIT_FILEBACKUP);
  });

  await test('drill status not "passed" -> drill bit only (exit 16)', () => {
    const d = healthyDrill();
    d.lastTerminalRehearsal!.status = 'failed';
    assert.equal(runOpscheck(healthyFileBackup(), d), BIT_DRILL);
  });

  await test('stale drill (older than default 192h) -> drill bit (exit 16)', () => {
    const d = healthyDrill();
    d.lastTerminalRehearsal!.startedAt = minutesAgo(60 * 200);
    assert.equal(runOpscheck(healthyFileBackup(), d), BIT_DRILL);
  });

  await test('never-run drill -> drill bit (exit 16)', () => {
    assert.equal(runOpscheck(healthyFileBackup(), { lastTerminalRehearsal: null }), BIT_DRILL);
  });

  await test('both unhealthy -> both bits set (exit 24)', () => {
    assert.equal(
      runOpscheck({ enabled: false, destinationOffHost: true, lastTerminalRun: null }, { lastTerminalRehearsal: null }),
      BIT_FILEBACKUP | BIT_DRILL,
    );
  });

  section('Fail-closed behavior on an unreadable document');

  await test('missing status file fails both checks, never passes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noramedi-recovery-contract-'));
    try {
      const code = runOpscheckOnFile(path.join(dir, 'does-not-exist.json'));
      assert.notEqual(code, 0, 'a missing status file must never read as healthy');
      assert.equal(code & BIT_FILEBACKUP, BIT_FILEBACKUP);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('malformed JSON fails closed, never passes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noramedi-recovery-contract-'));
    const f = path.join(dir, 'recovery-status.json');
    try {
      fs.writeFileSync(f, '{ this is not json at all', { mode: 0o600 });
      const code = runOpscheckOnFile(f);
      assert.notEqual(code, 0, 'a malformed status file must never read as healthy');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('empty file fails closed, never passes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noramedi-recovery-contract-'));
    const f = path.join(dir, 'recovery-status.json');
    try {
      fs.writeFileSync(f, '', { mode: 0o600 });
      assert.notEqual(runOpscheckOnFile(f), 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('status file never leaks its contents into script output', () => {
    const doc = mapRecoveryStatusDocument(healthyFileBackup(), healthyDrill());
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noramedi-recovery-contract-'));
    const f = path.join(dir, 'recovery-status.json');
    try {
      fs.writeFileSync(f, serializeRecoveryStatusDocument(doc), { mode: 0o600 });
      // Goes through the same guarded runner as every other case, so a bash
      // that never executed the script cannot make this assertion pass
      // vacuously on empty output.
      const { code, output } = invokeOpscheck(f);
      assert.equal(code, 0, 'precondition: this fixture is healthy, so the script must have run and passed');
      assert.equal(output.includes('"schemaVersion"'), false, 'raw document must not be echoed');
      assert.equal(output.includes('file_restore_rehearsal'), false, 'raw field values must not be echoed');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  section('Summary');
  console.log('\n─────────────────────────────────────────');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);

  // Floor assertion: without it, a future refactor that skipped or silently
  // dropped cases would still print "0 passed, 0 failed" and exit 0. The gate
  // must be able to tell "everything passed" from "nothing ran".
  const MIN_EXPECTED = 25;
  if (passed < MIN_EXPECTED) {
    console.error(`\nFAIL: only ${passed} assertions ran, expected at least ${MIN_EXPECTED}.`);
    console.error('Cases were skipped or dropped — this gate cannot report green on a partial run.');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});

/**
 * pitrStatusContract.test.ts — F4-FCR-002
 *
 * Pins the THREE-WAY contract around /var/lib/noramedi/pitr-status.json, which
 * nothing else pins:
 *
 *      scripts/noramedi-pgbackrest-status.sh   (writer, bash + node -e)
 *                     |
 *                     v
 *      +--------------+--------------+
 *      |                             |
 *   pitrStatusFile.ts            noramedi-opscheck.sh
 *   (reader, TypeScript)         (monitor, bash grep/sed)
 *
 * All three must agree on: exactly one `schemaVersion`, a known version
 * number, ISO-8601-with-Z timestamps, and — critically — **flat** `archive`
 * and `repo` objects, because the monitor extracts them with a regex that
 * matches `\{[^{}]*\}` and simply fails on nesting.
 *
 * Two of the three sides are shell and one is TypeScript, so a drift here
 * cannot be caught by tsc, by the shell suites (which test each side against
 * its own fixtures), or by the unit tests (which test the reader against
 * hand-written JSON). Only running the REAL writer and feeding its ACTUAL
 * bytes to BOTH real consumers proves they still agree.
 *
 * The writer runs here against a host with no pgbackrest and no psql, which
 * is not a limitation — it is exactly production's current state
 * (archive_mode=off, pgBackRest not installed), and therefore the single most
 * important case to get right. A healthy document is also asserted, built to
 * the same contract.
 *
 * Run with: tsx src/tests/pitrStatusContract.test.ts
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parsePitrStatusDocument, PITR_STATUS_SCHEMA_VERSION } from '../services/pitrStatusFile.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const OPSCHECK = path.join(REPO_ROOT, 'scripts', 'noramedi-opscheck.sh');
const STATUS_WRITER = path.join(REPO_ROOT, 'scripts', 'noramedi-pgbackrest-status.sh');

/** Exit bit for the pitr check. Must match noramedi-opscheck.sh. */
const BIT_PITR = 128;
/** Startup configuration error. Must match noramedi-opscheck.sh. */
const CONFIG_ERROR_EXIT_CODE = 64;

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(`    ${(err as Error).message}`);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

function toPosixPath(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Same resolution strategy as recoveryStatusFileContract.test.ts: a bare
 * `bash` on Windows often resolves to WSL, which cannot open `E:/...` paths
 * and fails with 127 — indistinguishable at a glance from a broken script.
 * Each candidate is probed by asking it to stat a real file.
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

let BASH = 'bash';

/** Runs the REAL status writer and returns exactly what it would publish. */
function runStatusWriter(extraEnv: Record<string, string> = {}): { code: number; stdout: string; stderr: string } {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pitr-state-'));
  try {
    const result = spawnSync(
      BASH,
      [toPosixPath(STATUS_WRITER), '--stdout', '--no-check'],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          NORAMEDI_PGBACKREST_STATE_DIR: toPosixPath(stateDir),
          NORAMEDI_PGBACKREST_CONF: toPosixPath(path.join(stateDir, 'no-such-pgbackrest.conf')),
          ...extraEnv,
        },
      },
    );
    if (result.error) throw result.error;
    const code = result.status ?? -1;
    // 126/127 mean the shell never ran the script. Those must be hard errors,
    // never a value a fail-closed assertion could accidentally satisfy.
    if (code === 126 || code === 127) {
      throw new Error(`status writer did not execute (exit ${code}). ${result.stderr ?? ''}`);
    }
    return { code, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
}

/** Feeds a document to the REAL opscheck pitr check. */
function runOpscheckPitr(document: string, extraEnv: Record<string, string> = {}): { code: number; output: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pitr-doc-'));
  const file = path.join(dir, 'pitr-status.json');
  try {
    fs.writeFileSync(file, document, { mode: 0o600 });
    const result = spawnSync(
      BASH,
      [toPosixPath(OPSCHECK), '--dry-run', '--check', 'pitr'],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          NORAMEDI_OPSCHECK_PITR_STATUS_FILE: toPosixPath(file),
          ...extraEnv,
        },
      },
    );
    if (result.error) throw result.error;
    const code = result.status ?? -1;
    if (code === 126 || code === 127) {
      throw new Error(`opscheck did not execute (exit ${code}). ${result.stderr ?? ''}`);
    }
    return { code, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** A fully healthy, fully activated document, built to the published contract. */
function healthyDocument(): string {
  const iso = (minutesAgo: number) =>
    new Date(Date.now() - minutesAgo * 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return JSON.stringify(
    {
      schemaVersion: PITR_STATUS_SCHEMA_VERSION,
      generatedAt: iso(1),
      archive: {
        mode: 'on',
        commandOk: true,
        walLevel: 'replica',
        timeoutSeconds: 300,
        failedCount: 0,
        archivedCount: 128,
        lastArchivedAt: iso(3),
        lastArchivedAgeMinutes: 3,
      },
      repo: {
        installed: true,
        stanza: 'noramedi',
        statusOk: true,
        version: '2.54.2',
        cipherType: 'aes-256-cbc',
        checkStatus: 'ok',
        checkAt: iso(30),
        checkAgeMinutes: 30,
        lastBackupAt: iso(570),
        lastBackupAgeMinutes: 570,
        lastBackupType: 'full',
        backupCount: 7,
        walMin: '000000010000000000000002',
        walMax: '0000000100000000000000A7',
        offHost: 'yes',
        tier: 'T2',
        offHostReason: 'RESTORE_PROVEN_FROM_REPO2',
      },
    },
    null,
    2,
  ) + '\n';
}

async function main() {
  for (const [label, p] of [['opscheck', OPSCHECK], ['status writer', STATUS_WRITER]] as const) {
    if (!fs.existsSync(p)) {
      console.error(`FATAL: ${label} not found at ${p}`);
      process.exit(1);
    }
  }

  const resolved = resolveBash();
  if (!resolved) {
    // FAIL, never skip. A silent skip would turn this gate green while
    // executing zero end-to-end assertions — the exact false-confidence
    // failure the whole task is about.
    console.error('\n!! FAIL: no bash able to read this repository was found.');
    console.error('!! This contract test cannot be skipped — it is the only thing pinning the');
    console.error('!! noramedi-pgbackrest-status.sh <-> pitrStatusFile.ts <-> noramedi-opscheck.sh contract.');
    console.error('!! Install Git Bash, or set NORAMEDI_TEST_BASH to a usable bash.\n');
    process.exit(1);
  }
  BASH = resolved;

  // ── The real writer, on a host with no pgbackrest ──────────────────────
  section('Real writer output — the "nothing configured" case (production today)');

  const written = runStatusWriter();

  await test('the writer exits 0 even with no pgbackrest and no psql on the host', () => {
    // Exit 0 means "status successfully COLLECTED", not "PITR is healthy".
    // Conflating those is how a monitor reports false green.
    assert.equal(written.code, 0, `writer exited ${written.code}: ${written.stderr}`);
  });

  await test('the writer emits parseable JSON', () => {
    assert.doesNotThrow(() => JSON.parse(written.stdout), `not JSON: ${written.stdout.slice(0, 300)}`);
  });

  await test('exactly one "schemaVersion" appears in the whole document', () => {
    // The monitor counts occurrences and fails on anything but 1, so a nested
    // or duplicated version field would break it while still being valid JSON.
    const occurrences = (written.stdout.match(/"schemaVersion"/g) ?? []).length;
    assert.equal(occurrences, 1, `found ${occurrences} occurrences`);
  });

  await test('archive and repo are FLAT objects (the monitor regex cannot match nesting)', () => {
    // Mirrors json_object_body's `\{[^{}]*\}` against the same
    // whitespace-collapsed form the monitor builds.
    const flat = written.stdout.replace(/[\n\r\t ]+/g, ' ');
    for (const key of ['archive', 'repo']) {
      const re = new RegExp(`"${key}"\\s*:\\s*\\{[^{}]*\\}`);
      assert.ok(re.test(flat), `'${key}' is nested or unmatched — the monitor would fail closed on it`);
    }
  });

  await test('the TypeScript reader accepts the real writer output', () => {
    const status = parsePitrStatusDocument(written.stdout, new Date(), '/test/pitr-status.json');
    assert.equal(status.available, true, `reader rejected the writer output: ${JSON.stringify(status)}`);
  });

  await test('the reader carries repo2 (off-host) backup freshness through, separately from repo1', () => {
    // These fields exist because a single aggregate backup age cannot express
    // "repo1 is fresh AND the off-host copy is starving" — the state that
    // would otherwise sit behind a 30-day-valid offHost='yes' proof marker.
    const doc = JSON.parse(healthyDocument()) as Record<string, unknown>;
    const repo = doc.repo as Record<string, unknown>;
    repo.repo2BackupCount = 3;
    repo.repo2LastBackupAgeMinutes = 20160;
    repo.repo2LastBackupAt = new Date(Date.now() - 20160 * 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');

    const status = parsePitrStatusDocument(JSON.stringify(doc), new Date(), '/test/pitr-status.json');
    assert.equal(status.available, true, `reader rejected a document carrying repo2 fields: ${JSON.stringify(status)}`);
    assert.equal(status.repo?.repo2BackupCount, 3, 'repo2BackupCount was dropped by the reader');
    assert.equal(status.repo?.repo2LastBackupAgeMinutes, 20160, 'repo2LastBackupAgeMinutes was dropped by the reader');
    assert.equal(status.repo?.lastBackupAgeMinutes, 570, 'the repo1 age must be unaffected by the repo2 fields');
  });

  await test('a document with no repo2 fields still parses (single-repository hosts)', () => {
    const status = parsePitrStatusDocument(healthyDocument(), new Date(), '/test/pitr-status.json');
    assert.equal(status.available, true, 'reader rejected a single-repository document');
    assert.equal(status.repo?.repo2BackupCount, undefined, 'repo2BackupCount must be absent, not defaulted to 0');
  });

  await test('with nothing configured, the reader reports pitrActive = false', () => {
    const status = parsePitrStatusDocument(written.stdout, new Date(), '/test/pitr-status.json');
    assert.equal(status.available, true);
    if (!status.available) return;
    assert.equal(status.pitrActive, false, 'an unconfigured host must never report PITR as active');
    assert.equal(status.repo.installed, false);
    assert.equal(status.repo.encrypted, false, 'no configured cipher must never read as encrypted');
    assert.equal(status.repo.offHost, 'no', 'no repo2 configured must never read as off-host');
  });

  await test('the monitor FAILS on the real writer output, naming archive_mode', () => {
    const { code, output } = runOpscheckPitr(written.stdout);
    assert.equal(code & BIT_PITR, BIT_PITR, `expected bit ${BIT_PITR}, got ${code}: ${output}`);
    assert.ok(/archive_mode/.test(output), `diagnostic did not name archive_mode: ${output}`);
    // The failure must be a real assertion about state, not a parse error —
    // otherwise a malformed document would masquerade as a healthy diagnosis.
    assert.ok(!/unparseable|not a JSON object|schemaVersion/.test(output), `monitor failed on PARSING, not on state: ${output}`);
  });

  // ── The healthy document, through both consumers ───────────────────────
  section('Healthy document — both consumers agree it is healthy');

  const healthy = healthyDocument();

  await test('the TypeScript reader accepts it and reports PITR active', () => {
    const status = parsePitrStatusDocument(healthy, new Date(), '/test/pitr-status.json');
    assert.equal(status.available, true);
    if (!status.available) return;
    assert.equal(status.pitrActive, true);
    assert.equal(status.repo.encrypted, true);
    assert.equal(status.repo.offHost, 'yes');
  });

  await test('the monitor passes it with exit 0', () => {
    const { code, output } = runOpscheckPitr(healthy);
    assert.equal(code, 0, `expected exit 0, got ${code}: ${output}`);
    assert.ok(/pitr check: OK/.test(output), `no OK line: ${output}`);
  });

  section('Both consumers fail closed on the SAME inputs');

  const cases: Array<{ label: string; mutate: (doc: Record<string, unknown>) => void }> = [
    {
      label: 'an unknown schemaVersion',
      mutate: d => { d.schemaVersion = 99; },
    },
    {
      label: 'a future-dated generatedAt (clock skew)',
      mutate: d => { d.generatedAt = new Date(Date.now() + 3 * 3600_000).toISOString().replace(/\.\d{3}Z$/, 'Z'); },
    },
    {
      label: 'a stale generatedAt (the writer has died)',
      mutate: d => { d.generatedAt = new Date(Date.now() - 6 * 3600_000).toISOString().replace(/\.\d{3}Z$/, 'Z'); },
    },
  ];

  for (const c of cases) {
    await test(`${c.label} — rejected by BOTH the reader and the monitor`, () => {
      const doc = JSON.parse(healthy) as Record<string, unknown>;
      c.mutate(doc);
      const serialized = JSON.stringify(doc, null, 2) + '\n';

      const status = parsePitrStatusDocument(serialized, new Date(), '/test/pitr-status.json');
      assert.equal(status.available, false, 'the TypeScript reader accepted it');

      const { code, output } = runOpscheckPitr(serialized);
      assert.equal(code & BIT_PITR, BIT_PITR, `the monitor accepted it (exit ${code}): ${output}`);
    });
  }

  await test('a nested object inside repo is rejected by the monitor (the reason flatness is required)', () => {
    const doc = JSON.parse(healthy) as Record<string, unknown>;
    (doc.repo as Record<string, unknown>).nested = { anything: 1 };
    const serialized = JSON.stringify(doc, null, 2) + '\n';
    const { code, output } = runOpscheckPitr(serialized);
    assert.equal(code & BIT_PITR, BIT_PITR, `the monitor accepted a nested repo object (exit ${code}): ${output}`);
  });

  // ── WAL backlog (F4-FCR-003-R1) ────────────────────────────────────────
  // Gate 0 proved an unreachable repo2 suspends the ENTIRE archive chain and
  // turns the outage into pg_wal growth. These two fields are the only ones in
  // the document that measure VOLUME rather than time, and they must cross the
  // same three-way boundary as everything else: writer -> reader -> monitor.
  section('WAL backlog — the volume signals repo2 activation depends on');

  const withBacklog = (readyCount?: number, walBytes?: number): string => {
    const doc = JSON.parse(healthy) as Record<string, unknown>;
    const archive = doc.archive as Record<string, unknown>;
    if (readyCount !== undefined) archive.readyCount = readyCount;
    if (walBytes !== undefined) archive.walBytes = walBytes;
    return JSON.stringify(doc, null, 2) + '\n';
  };

  await test('the reader carries walBytes and readyCount through', () => {
    const status = parsePitrStatusDocument(withBacklog(2, 335544320), new Date(), '/test/pitr-status.json');
    assert.equal(status.available, true, `reader rejected a document carrying backlog fields: ${JSON.stringify(status)}`);
    assert.equal(status.archive?.readyCount, 2, 'readyCount was dropped by the reader');
    assert.equal(status.archive?.walBytes, 335544320, 'walBytes was dropped by the reader');
  });

  await test('absent backlog fields stay ABSENT, never defaulted to 0', () => {
    // 0 would read as "no backlog" during exactly the outage these fields
    // exist to detect, so "not measured" must remain distinguishable.
    const status = parsePitrStatusDocument(healthy, new Date(), '/test/pitr-status.json');
    assert.equal(status.available, true);
    assert.equal(status.archive?.readyCount, undefined, 'readyCount was defaulted rather than omitted');
    assert.equal(status.archive?.walBytes, undefined, 'walBytes was defaulted rather than omitted');
  });

  await test('BACKWARD COMPATIBLE: a pre-R1 document with no backlog fields still passes the monitor', () => {
    // The deployment order is writer-then-monitor or monitor-then-writer, and
    // neither may break production. With no limit configured — the default —
    // the absence of these fields must change nothing at all.
    const { code, output } = runOpscheckPitr(healthy);
    assert.equal(code, 0, `a document without backlog fields was rejected by default (exit ${code}): ${output}`);
  });

  await test('a backlog within the configured limit passes, and the OK line reports it', () => {
    const { code, output } = runOpscheckPitr(withBacklog(2, 335544320), {
      NORAMEDI_OPSCHECK_PITR_MAX_WAL_READY_COUNT: '32',
      NORAMEDI_OPSCHECK_PITR_MAX_WAL_BYTES: '1073741824',
    });
    assert.equal(code, 0, `expected exit 0, got ${code}: ${output}`);
    assert.ok(/waiting-to-archive=2/.test(output), `the OK line did not report the backlog: ${output}`);
  });

  await test('a .ready backlog OVER the limit fails, naming the un-archived segments', () => {
    const { code, output } = runOpscheckPitr(withBacklog(40, 335544320), {
      NORAMEDI_OPSCHECK_PITR_MAX_WAL_READY_COUNT: '32',
    });
    assert.equal(code & BIT_PITR, BIT_PITR, `the monitor accepted a 40-segment backlog (exit ${code}): ${output}`);
    assert.ok(/waiting to be archived/.test(output), `diagnostic did not name the backlog: ${output}`);
  });

  await test('pg_wal OVER the byte limit fails', () => {
    const { code, output } = runOpscheckPitr(withBacklog(2, 2147483648), {
      NORAMEDI_OPSCHECK_PITR_MAX_WAL_BYTES: '1073741824',
    });
    assert.equal(code & BIT_PITR, BIT_PITR, `the monitor accepted a 2 GiB pg_wal against a 1 GiB limit (exit ${code}): ${output}`);
    assert.ok(/pg_wal holds/.test(output), `diagnostic did not name pg_wal: ${output}`);
  });

  await test('FAIL CLOSED: a configured limit with NO measurement in the document fails', () => {
    // The whole point. An operator who switched the limit on must not be told
    // "healthy" because the writer could not take the measurement — that is
    // the silent-green this document exists to prevent.
    const { code, output } = runOpscheckPitr(healthy, {
      NORAMEDI_OPSCHECK_PITR_MAX_WAL_READY_COUNT: '32',
    });
    assert.equal(code & BIT_PITR, BIT_PITR, `an unmeasurable backlog passed while a limit was configured (exit ${code}): ${output}`);
    assert.ok(/readyCount/.test(output), `diagnostic did not name the missing field: ${output}`);
  });

  await test('ACTIVATION GATE: REQUIRE_WAL_BACKLOG=true with unset limits refuses to start', () => {
    // Enforced at startup, not at check time: activating repo2 with a monitor
    // that cannot see WAL backlog is a configuration error, and a refusal to
    // start is louder than a failing check and cannot be read as transient.
    const { code, output } = runOpscheckPitr(healthy, {
      NORAMEDI_OPSCHECK_PITR_REQUIRE_WAL_BACKLOG: 'true',
    });
    assert.equal(code, CONFIG_ERROR_EXIT_CODE, `expected the config-error exit ${CONFIG_ERROR_EXIT_CODE}, got ${code}: ${output}`);
    assert.ok(/REQUIRE_WAL_BACKLOG/.test(output), `diagnostic did not name the gate: ${output}`);
  });

  await test('ACTIVATION GATE: REQUIRE_WAL_BACKLOG=true with limits set and both signals present passes', () => {
    const { code, output } = runOpscheckPitr(withBacklog(1, 268435456), {
      NORAMEDI_OPSCHECK_PITR_REQUIRE_WAL_BACKLOG: 'true',
      NORAMEDI_OPSCHECK_PITR_MAX_WAL_READY_COUNT: '32',
      NORAMEDI_OPSCHECK_PITR_MAX_WAL_BYTES: '1073741824',
    });
    assert.equal(code, 0, `expected exit 0, got ${code}: ${output}`);
  });

  await test('ACTIVATION GATE: REQUIRE_WAL_BACKLOG=true with limits set but signals ABSENT fails', () => {
    const { code, output } = runOpscheckPitr(healthy, {
      NORAMEDI_OPSCHECK_PITR_REQUIRE_WAL_BACKLOG: 'true',
      NORAMEDI_OPSCHECK_PITR_MAX_WAL_READY_COUNT: '32',
      NORAMEDI_OPSCHECK_PITR_MAX_WAL_BYTES: '1073741824',
    });
    assert.equal(code & BIT_PITR, BIT_PITR, `repo2 activation was allowed to proceed blind (exit ${code}): ${output}`);
  });

  await test('a backlog-bearing document is still FLAT (the monitor regex cannot match nesting)', () => {
    const flat = withBacklog(2, 335544320).replace(/[\n\r\t ]+/g, ' ');
    const re = /"archive"\s*:\s*\{[^{}]*\}/;
    assert.ok(re.test(flat), 'the archive object stopped being flat once the backlog fields were added');
  });

  section('The writer never leaks the repository passphrase');

  await test('a cipher passphrase in pgbackrest.conf never reaches the writer output', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pitr-conf-'));
    const conf = path.join(dir, 'pgbackrest.conf');
    const CANARY = 'cipherpass-CONTRACT-CANARY-do-not-print';
    try {
      fs.writeFileSync(
        conf,
        `[global]\nrepo1-path=/var/lib/pgbackrest\nrepo1-cipher-type=aes-256-cbc\nrepo1-cipher-pass=${CANARY}\n`,
        { mode: 0o600 },
      );
      const result = runStatusWriter({ NORAMEDI_PGBACKREST_CONF: toPosixPath(conf) });
      const combined = `${result.stdout}${result.stderr}`;
      assert.ok(!combined.includes(CANARY), 'THE REPOSITORY PASSPHRASE LEAKED into the status document');
      // It must still report the cipher TYPE — that is the security signal.
      assert.ok(/aes-256-cbc/.test(result.stdout), `cipherType was not reported: ${result.stdout.slice(0, 300)}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  section('Summary');
  console.log('\n─────────────────────────────────────────');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  // Floor assertion: a partial run must not be able to report green.
  const MIN_EXPECTED = 25;
  if (passed + failed < MIN_EXPECTED) {
    console.error(`Expected at least ${MIN_EXPECTED} tests, ran ${passed + failed}`);
    process.exit(1);
  }
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});

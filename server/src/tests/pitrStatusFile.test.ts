/**
 * pitrStatusFile.test.ts — F4-FCR-002
 *
 * Proves the PITR status reader's fail-closed contract.
 *
 * This document is written by a ROOT-OWNED SHELL SCRIPT and read by the
 * application — the reverse of every other status file in this program. That
 * makes it untrusted input arriving over a filesystem boundary, so the
 * properties under test are:
 *
 *  1. FAIL CLOSED — missing, unreadable, malformed, wrong-version, stale and
 *     future-dated all resolve to `available: false` with a bounded reason.
 *     There is no input for which an absent or broken document reads as
 *     healthy. "We could not tell" must never render as "it is fine".
 *  2. NO UNVALIDATED PASSTHROUGH — every string that crosses the HTTP boundary
 *     is shape-checked. A corrupted or hostile file cannot push arbitrary text
 *     into the Platform Admin API.
 *  3. TRI-STATE off-host — 'unproven' never collapses into 'yes' or 'no', and
 *     an unrecognised value degrades to the SAFEST state, not the most
 *     optimistic one.
 *  4. pitrActive REQUIRES BOTH archive_mode AND an intact archive_command —
 *     the green-but-broken state must not report as active.
 *
 * Pure functions only: no filesystem, no network, no database, and every time
 * assertion injects `now`.
 *
 * Run with: tsx src/tests/pitrStatusFile.test.ts
 */

import assert from 'node:assert/strict';
import {
  parsePitrStatusDocument,
  resolvePitrStatusFilePath,
  PITR_STATUS_SCHEMA_VERSION,
  DEFAULT_PITR_STATUS_FILE,
  DEFAULT_PITR_STATUS_MAX_AGE_MINUTES,
  type PitrStatus,
} from '../services/pitrStatusFile.js';

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

const NOW = new Date('2026-08-15T12:00:00.000Z');
const FILE = '/var/lib/noramedi/pitr-status.json';

function healthyDoc(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: 1,
    generatedAt: '2026-08-15T11:55:00Z',
    archive: {
      mode: 'on',
      commandOk: true,
      walLevel: 'replica',
      timeoutSeconds: 300,
      failedCount: 0,
      archivedCount: 128,
      lastArchivedAt: '2026-08-15T11:57:00Z',
      lastArchivedAgeMinutes: 3,
    },
    repo: {
      installed: true,
      stanza: 'noramedi',
      statusOk: true,
      version: '2.54.2',
      cipherType: 'aes-256-cbc',
      checkStatus: 'ok',
      checkAt: '2026-08-15T11:30:00Z',
      checkAgeMinutes: 30,
      lastBackupAt: '2026-08-15T02:30:00Z',
      lastBackupAgeMinutes: 570,
      lastBackupType: 'full',
      backupCount: 7,
      walMin: '000000010000000000000002',
      walMax: '0000000100000000000000A7',
      offHost: 'no',
      tier: 'T1',
      offHostReason: 'NO_REPO2_CONFIGURED',
      ...(overrides.repo as object ?? {}),
    },
    ...overrides,
  });
}

function parse(raw: string, now: Date = NOW): PitrStatus {
  return parsePitrStatusDocument(raw, now, FILE);
}

async function main() {
  section('Path resolution');

  await test('defaults to /var/lib/noramedi/pitr-status.json', () => {
    assert.equal(resolvePitrStatusFilePath({} as NodeJS.ProcessEnv), DEFAULT_PITR_STATUS_FILE);
  });

  await test('an override is honoured; whitespace-only is treated as unset', () => {
    assert.equal(resolvePitrStatusFilePath({ NORAMEDI_PITR_STATUS_FILE: '/tmp/x.json' } as NodeJS.ProcessEnv), '/tmp/x.json');
    assert.equal(resolvePitrStatusFilePath({ NORAMEDI_PITR_STATUS_FILE: '   ' } as NodeJS.ProcessEnv), DEFAULT_PITR_STATUS_FILE);
  });

  section('Happy path');

  await test('a healthy document parses and reports every field', () => {
    const s = parse(healthyDoc());
    assert.equal(s.available, true);
    if (!s.available) return;
    assert.equal(s.archive.mode, 'on');
    assert.equal(s.archive.commandOk, true);
    assert.equal(s.archive.lastArchivedAgeMinutes, 3);
    assert.equal(s.repo.cipherType, 'aes-256-cbc');
    assert.equal(s.repo.encrypted, true);
    assert.equal(s.repo.walMax, '0000000100000000000000A7');
    assert.equal(s.ageMinutes, 5);
    assert.equal(s.pitrActive, true);
  });

  section('Fail closed — the document cannot be used');

  await test('malformed JSON -> available:false, reason malformed', () => {
    const s = parse('}{ not json');
    assert.equal(s.available, false);
    if (s.available) return;
    assert.equal(s.reason, 'malformed');
  });

  await test('a JSON array (not an object) is malformed, not silently indexed', () => {
    const s = parse('[]');
    assert.equal(s.available, false);
  });

  await test('null parses as JSON but is not a usable document', () => {
    const s = parse('null');
    assert.equal(s.available, false);
  });

  await test('an unknown schemaVersion is never interpreted on a guess', () => {
    const s = parse(healthyDoc({ schemaVersion: 2 }));
    assert.equal(s.available, false);
    if (s.available) return;
    assert.equal(s.reason, 'unsupported_schema_version');
  });

  await test('a missing schemaVersion is rejected', () => {
    const doc = JSON.parse(healthyDoc()) as Record<string, unknown>;
    delete doc.schemaVersion;
    const s = parse(JSON.stringify(doc));
    assert.equal(s.available, false);
  });

  await test('a stale document is rejected even though every field inside reads healthy', () => {
    // The writer died three hours ago. Its last contents still say
    // "archive_mode=on, WAL 3 minutes old" and will say so forever.
    const s = parse(healthyDoc({ generatedAt: '2026-08-15T08:00:00Z' }));
    assert.equal(s.available, false);
    if (s.available) return;
    assert.equal(s.reason, 'stale');
    assert.equal(s.ageMinutes, 240);
  });

  await test('a document exactly AT the staleness bound is still usable (strict >)', () => {
    const at = new Date(NOW.getTime() - DEFAULT_PITR_STATUS_MAX_AGE_MINUTES * 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const s = parse(healthyDoc({ generatedAt: at }));
    assert.equal(s.available, true);
  });

  await test('one minute past the bound is stale', () => {
    const past = new Date(NOW.getTime() - (DEFAULT_PITR_STATUS_MAX_AGE_MINUTES + 1) * 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const s = parse(healthyDoc({ generatedAt: past }));
    assert.equal(s.available, false);
  });

  await test('a FUTURE generatedAt fails closed as clock_skew, never as the freshest possible document', () => {
    const s = parse(healthyDoc({ generatedAt: '2026-08-15T18:00:00Z' }));
    assert.equal(s.available, false);
    if (s.available) return;
    assert.equal(s.reason, 'clock_skew');
  });

  await test('a non-ISO generatedAt is malformed (date parsers accept "now"/"yesterday")', () => {
    for (const bad of ['now', 'yesterday', '2026-08-15', '2026-08-15 11:55:00', '']) {
      const s = parse(healthyDoc({ generatedAt: bad }));
      assert.equal(s.available, false, `accepted a non-ISO generatedAt: ${JSON.stringify(bad)}`);
    }
  });

  await test('a missing archive or repo object is malformed', () => {
    const a = JSON.parse(healthyDoc()) as Record<string, unknown>;
    delete a.archive;
    assert.equal(parse(JSON.stringify(a)).available, false);
    const b = JSON.parse(healthyDoc()) as Record<string, unknown>;
    delete b.repo;
    assert.equal(parse(JSON.stringify(b)).available, false);
  });

  section('pitrActive requires BOTH archive_mode and an intact archive_command');

  // Built by mutating the parsed object rather than by string-replacing the
  // serialized form: a replace that silently fails to match would leave the
  // fixture healthy and the assertion would pass for the wrong reason.
  function withArchive(patch: Record<string, unknown>): PitrStatus {
    const doc = JSON.parse(healthyDoc()) as Record<string, unknown>;
    Object.assign(doc.archive as Record<string, unknown>, patch);
    return parse(JSON.stringify(doc));
  }

  await test("archive_mode=off -> pitrActive false (today's real production state)", () => {
    const s = withArchive({ mode: 'off' });
    assert.equal(s.available, true);
    if (!s.available) return;
    assert.equal(s.archive.mode, 'off');
    assert.equal(s.pitrActive, false);
  });

  await test('archive_mode=always is accepted as active', () => {
    const s = withArchive({ mode: 'always' });
    assert.equal(s.available, true);
    if (!s.available) return;
    assert.equal(s.pitrActive, true);
  });

  await test('archive_mode=on but commandOk=false -> pitrActive FALSE (the green-but-broken state)', () => {
    // PostgreSQL marks segments archived and recycles them while nothing
    // reaches the repository. Reporting this as "PITR active" would be the
    // single most dangerous claim this module could make.
    const s = withArchive({ commandOk: false });
    assert.equal(s.available, true);
    if (!s.available) return;
    assert.equal(s.archive.commandOk, false);
    assert.equal(s.pitrActive, false);
  });

  await test('an unrecognised archive_mode does not report active', () => {
    for (const mode of ['unknown', '', 'ON', 'enabled']) {
      const s = withArchive({ mode });
      assert.equal(s.available, true);
      if (!s.available) return;
      assert.equal(s.pitrActive, false, `mode ${JSON.stringify(mode)} reported active`);
    }
  });

  await test('a missing commandOk defaults to false, not true', () => {
    const doc = JSON.parse(healthyDoc()) as Record<string, unknown>;
    delete (doc.archive as Record<string, unknown>).commandOk;
    const s = parse(JSON.stringify(doc));
    assert.equal(s.available, true);
    if (!s.available) return;
    assert.equal(s.archive.commandOk, false);
    assert.equal(s.pitrActive, false);
  });

  section('Off-host is tri-state and degrades to the safest value');

  for (const [input, expected] of [
    ['no', 'no'],
    ['unproven', 'unproven'],
    ['yes', 'yes'],
  ] as const) {
    await test(`offHost '${input}' is preserved exactly`, () => {
      const doc = JSON.parse(healthyDoc()) as Record<string, unknown>;
      (doc.repo as Record<string, unknown>).offHost = input;
      const s = parse(JSON.stringify(doc));
      assert.equal(s.available, true);
      if (!s.available) return;
      assert.equal(s.repo.offHost, expected);
    });
  }

  for (const bad of ['YES', 'true', true, 1, null, undefined, 'maybe', '']) {
    await test(`an unrecognised offHost ${JSON.stringify(bad)} degrades to 'no', never to 'yes'`, () => {
      const doc = JSON.parse(healthyDoc()) as Record<string, unknown>;
      (doc.repo as Record<string, unknown>).offHost = bad;
      const s = parse(JSON.stringify(doc));
      assert.equal(s.available, true);
      if (!s.available) return;
      assert.equal(s.repo.offHost, 'no');
    });
  }

  section('Encryption is derived, not trusted');

  await test('cipherType none -> encrypted false', () => {
    const doc = JSON.parse(healthyDoc()) as Record<string, unknown>;
    (doc.repo as Record<string, unknown>).cipherType = 'none';
    const s = parse(JSON.stringify(doc));
    assert.equal(s.available, true);
    if (!s.available) return;
    assert.equal(s.repo.encrypted, false);
  });

  await test('a missing cipherType defaults to none/unencrypted, not to encrypted', () => {
    const doc = JSON.parse(healthyDoc()) as Record<string, unknown>;
    delete (doc.repo as Record<string, unknown>).cipherType;
    const s = parse(JSON.stringify(doc));
    assert.equal(s.available, true);
    if (!s.available) return;
    assert.equal(s.repo.cipherType, 'none');
    assert.equal(s.repo.encrypted, false);
  });

  await test('an unrecognised cipher name is not treated as encrypted', () => {
    const doc = JSON.parse(healthyDoc()) as Record<string, unknown>;
    (doc.repo as Record<string, unknown>).cipherType = 'rot13';
    const s = parse(JSON.stringify(doc));
    assert.equal(s.available, true);
    if (!s.available) return;
    assert.equal(s.repo.encrypted, false);
  });

  section('Untrusted input cannot push arbitrary text through the API');

  await test('an over-long or non-identifier token is DROPPED, not truncated and surfaced', () => {
    const doc = JSON.parse(healthyDoc()) as Record<string, unknown>;
    (doc.repo as Record<string, unknown>).stanza = 'x'.repeat(500);
    (doc.repo as Record<string, unknown>).lastBackupType = '<script>alert(1)</script>';
    (doc.repo as Record<string, unknown>).walMax = 'DROP TABLE "Patient";';
    const s = parse(JSON.stringify(doc));
    assert.equal(s.available, true);
    if (!s.available) return;
    assert.equal(s.repo.stanza, undefined);
    assert.equal(s.repo.lastBackupType, undefined);
    assert.equal(s.repo.walMax, undefined);
  });

  await test('a non-integer or negative count is dropped rather than coerced', () => {
    const doc = JSON.parse(healthyDoc()) as Record<string, unknown>;
    (doc.archive as Record<string, unknown>).failedCount = -5;
    (doc.archive as Record<string, unknown>).archivedCount = 1.5;
    (doc.repo as Record<string, unknown>).backupCount = '7';
    const s = parse(JSON.stringify(doc));
    assert.equal(s.available, true);
    if (!s.available) return;
    assert.equal(s.archive.failedCount, undefined);
    assert.equal(s.archive.archivedCount, undefined);
    assert.equal(s.repo.backupCount, undefined);
  });

  await test('statusMessage is bounded and stripped of control characters', () => {
    const doc = JSON.parse(healthyDoc()) as Record<string, unknown>;
    (doc.repo as Record<string, unknown>).statusOk = false;
    (doc.repo as Record<string, unknown>).statusMessage = `bad news\n${'z'.repeat(400)}`;
    const s = parse(JSON.stringify(doc));
    assert.equal(s.available, true);
    if (!s.available) return;
    assert.ok((s.repo.statusMessage ?? '').length <= 120, 'statusMessage was not length-bounded');
    assert.ok(!(s.repo.statusMessage ?? '').includes(' '), 'a control character survived');
    assert.ok(!(s.repo.statusMessage ?? '').includes('\n'), 'a newline survived');
  });

  await test('a non-string statusMessage is omitted entirely', () => {
    const doc = JSON.parse(healthyDoc()) as Record<string, unknown>;
    (doc.repo as Record<string, unknown>).statusMessage = { evil: true };
    const s = parse(JSON.stringify(doc));
    assert.equal(s.available, true);
    if (!s.available) return;
    assert.equal(s.repo.statusMessage, undefined);
  });

  section('Constants agree with the shell consumer');

  await test('schema version is 1 and INDEPENDENT of the recovery status file version', () => {
    assert.equal(PITR_STATUS_SCHEMA_VERSION, 1);
  });

  await test('the staleness bound matches NORAMEDI_OPSCHECK_PITR_STATUS_MAX_AGE_HOURS=2', () => {
    // The admin page and the monitor must not disagree about "stale": an
    // operator comparing a green page against a red alert believes the page.
    assert.equal(DEFAULT_PITR_STATUS_MAX_AGE_MINUTES, 120);
  });

  section('Summary');
  console.log('\n─────────────────────────────────────────');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  // Floor assertion: a partial run must not be able to report green.
  const MIN_EXPECTED = 34;
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

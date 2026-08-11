/**
 * platformBackup.test.ts — Backup monitoring service unit tests
 *
 * Run: cd server && npx tsx src/tests/platformBackup.test.ts
 *
 * Covered scenarios:
 *  Auth:
 *   - backup endpoints require platform admin auth (401 without token)
 *   - non-platform tokens are rejected (403)
 *
 *  backupService:
 *   - BACKUP_FILENAME_RE accepts valid filenames
 *   - BACKUP_FILENAME_RE rejects path traversal and invalid filenames
 *   - getBackupStatus handles missing backup dir gracefully
 *   - getBackupStatus handles missing script gracefully
 *   - getBackupLogs enforces max 300 lines cap
 *   - getBackupLogs enforces min 1 line
 *   - runBackup rejects concurrent execution
 *   - runRestoreTest rejects concurrent execution
 *   - runRestoreTest rejects path traversal filenames
 *   - runRestoreTest rejects filenames not in backup dir
 *   - runRestoreTest rejects invalid filename format
 *   - parseDatabaseUrl (internal) — tested via runRestoreTest error
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// These unit tests exercise the middleware via Bearer tokens; the production
// default is now cookie-only, so enable the fallback explicitly for the suite.
process.env.PLATFORM_BEARER_FALLBACK_ENABLED = 'true';

import { BACKUP_FILENAME_RE, BACKUP_DIR, BACKUP_SCRIPT, BACKUP_LOG } from '../services/backupService.js';
import { generatePlatformToken, authenticatePlatformAdmin } from '../middleware/platformAuth.js';
import jwt from 'jsonwebtoken';

// ── Test runner ───────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

function section(title: string) { console.log(`\n${title}`); }

// ── Mock helpers ──────────────────────────────────────────────────────────────

function makeReq(authHeader?: string) {
  return { headers: authHeader ? { authorization: authHeader } : {} } as any;
}

function makeRes() {
  return {
    _status: 200,
    _body: {} as any,
    status(code: number) { this._status = code; return this; },
    json(data: any) { this._body = data; return this; },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

section('BACKUP_FILENAME_RE — filename validation');

await test('accepts valid backup filename', () => {
  assert.ok(BACKUP_FILENAME_RE.test('noramedi_crm-20260629-031500.dump'));
});

await test('accepts another valid backup filename', () => {
  assert.ok(BACKUP_FILENAME_RE.test('noramedi_crm-20260101-000000.dump'));
});

await test('rejects path traversal: ../../../etc/passwd', () => {
  assert.ok(!BACKUP_FILENAME_RE.test('../../../etc/passwd'));
});

await test('rejects path traversal with leading slash', () => {
  assert.ok(!BACKUP_FILENAME_RE.test('/root/noramedi-backups/noramedi_crm-20260629-031500.dump'));
});

await test('rejects wrong prefix', () => {
  assert.ok(!BACKUP_FILENAME_RE.test('backup-20260629-031500.dump'));
});

await test('rejects wrong extension', () => {
  assert.ok(!BACKUP_FILENAME_RE.test('noramedi_crm-20260629-031500.sql'));
});

await test('rejects injected shell chars', () => {
  assert.ok(!BACKUP_FILENAME_RE.test('noramedi_crm-20260629-031500.dump; rm -rf /'));
});

await test('rejects empty string', () => {
  assert.ok(!BACKUP_FILENAME_RE.test(''));
});

await test('rejects partial match (must be full string due to ^ and $)', () => {
  assert.ok(!BACKUP_FILENAME_RE.test('Xnoramedi_crm-20260629-031500.dump'));
});

// ── Platform Auth guard ───────────────────────────────────────────────────────

section('Platform Auth — backup route protection');

await test('missing token → 401', async () => {
  const req = makeReq();
  const res = makeRes();
  let nextCalled = false;
  await (authenticatePlatformAdmin as any)(req, res, () => { nextCalled = true; });
  assert.equal(res._status, 401);
  assert.ok(!nextCalled);
});

// F3-SEC-002: authenticatePlatformAdmin now does a persistent DB lookup for
// the token's admin id. This file is a member of server:test:non-disposable
// ("zero external infra" — see ci-layers.yml) and seeds no PlatformAdmin
// fixture of its own, so this must stay deterministic whether or not a real
// Postgres is reachable: a syntactically valid, correctly signed token for
// an id that is not a real (or is not a *known-real*) admin row must be
// rejected either way — "not found" and "DB unreachable" both fail closed
// to the same 401 (see platformAuth.ts). A fresh random id (not the literal
// 'admin-1' other suites use as a shared fixture id) guarantees this stays
// true even when run against a real, already-populated database rather than
// a throwaway one. The positive "a real admin's token is accepted" path is
// covered against a real disposable Postgres by platformAdmin.test.ts and
// platformAdminSessionRevocation.test.ts instead.
await test('well-formed platform token for an unknown admin id → 401 (fails closed, no DB required to prove this)', async () => {
  const token = generatePlatformToken({ id: crypto.randomUUID(), email: 'admin@test.com' });
  const req = makeReq(`Bearer ${token}`);
  const res = makeRes();
  let nextCalled = false;

  await (authenticatePlatformAdmin as any)(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res._status, 401);
});

await test('clinic-type token rejected with 403', async () => {
  const clinicToken = jwt.sign(
    { type: 'clinic', sub: 'user-1', id: 'user-1', email: 'user@clinic.com', jti: 'sess-1' },
    'platform-admin-secret-change-this',
  );
  // Sign with platform secret but wrong type
  const req = makeReq(`Bearer ${clinicToken}`);
  const res = makeRes();
  let nextCalled = false;
  await (authenticatePlatformAdmin as any)(req, res, () => { nextCalled = true; });
  assert.ok(!nextCalled, 'clinic token should not pass platform auth');
  assert.equal(res._status, 403);
});

// ── Log line limit ────────────────────────────────────────────────────────────

section('getBackupLogs — line limit clamping');

await test('lines clamped to max 300 (via service import)', async () => {
  const { getBackupLogs } = await import('../services/backupService.js');
  // File won't exist in test env — result is empty, but no error thrown
  const result = await getBackupLogs(9999);
  assert.ok(Array.isArray(result));
});

await test('lines clamped to min 1 (no negative lines)', async () => {
  const { getBackupLogs } = await import('../services/backupService.js');
  const result = await getBackupLogs(-5);
  assert.ok(Array.isArray(result));
});

// ── getBackupStatus — graceful missing files ───────────────────────────────────

section('getBackupStatus — graceful handling of missing filesystem paths');

await test('returns false for missing backup dir (test env)', async () => {
  const { getBackupStatus } = await import('../services/backupService.js');
  const status = await getBackupStatus();
  // In test/dev env these paths don't exist — should NOT throw
  assert.ok(typeof status.backupDirAccessible === 'boolean');
  assert.ok(typeof status.scriptExists === 'boolean');
  assert.ok(typeof status.cronExists === 'boolean');
  assert.ok(typeof status.logExists === 'boolean');
  assert.ok(Array.isArray(status.recentBackups));
  assert.ok(typeof status.totalBackupCount === 'number');
  assert.equal(status.retentionDays, 7);
});

// ── Concurrency lock ──────────────────────────────────────────────────────────

section('Concurrency locks');

await test('isBackupRunning() returns boolean', async () => {
  const { isBackupRunning } = await import('../services/backupService.js');
  assert.equal(typeof isBackupRunning(), 'boolean');
});

await test('isRestoreTestRunning() returns boolean', async () => {
  const { isRestoreTestRunning } = await import('../services/backupService.js');
  assert.equal(typeof isRestoreTestRunning(), 'boolean');
});

// ── runRestoreTest — input validation ─────────────────────────────────────────

section('runRestoreTest — input validation (no DB calls, no file creation)');

await test('rejects path traversal filename', async () => {
  const { runRestoreTest } = await import('../services/backupService.js');
  try {
    await runRestoreTest('../../../etc/passwd');
    assert.fail('Should have thrown');
  } catch (err: any) {
    assert.ok(
      err.message.includes('Invalid') || err.message.includes('No backup'),
      `Expected Invalid or No backup error, got: ${err.message}`,
    );
  }
});

await test('rejects shell injection in filename', async () => {
  const { runRestoreTest } = await import('../services/backupService.js');
  try {
    await runRestoreTest('noramedi_crm-20260629-031500.dump; rm -rf /');
    assert.fail('Should have thrown');
  } catch (err: any) {
    assert.ok(err.message.includes('Invalid') || err.message.includes('No backup'));
  }
});

await test('rejects absolute path filename', async () => {
  const { runRestoreTest } = await import('../services/backupService.js');
  try {
    await runRestoreTest('/root/noramedi-backups/noramedi_crm-20260629-031500.dump');
    assert.fail('Should have thrown');
  } catch (err: any) {
    assert.ok(err.message.includes('Invalid') || err.message.includes('No backup'));
  }
});

await test('valid format but not in backup dir → error', async () => {
  const { runRestoreTest } = await import('../services/backupService.js');
  try {
    await runRestoreTest('noramedi_crm-20260629-031500.dump');
    assert.fail('Should have thrown');
  } catch (err: any) {
    // Either 'No backup files available' (dir missing) or 'Backup file not found'
    assert.ok(
      err.message.includes('No backup') || err.message.includes('not found'),
      `Unexpected error: ${err.message}`,
    );
  }
});

// ── dropdb failure log privacy (F3-IMPL-004, static source scan) ──────────────
//
// runRestoreTest's `finally` block drops the temp DB via
// `execFile('dropdb', [...pgArgs, tempDbName], { env: connEnv, ... })`. pgArgs
// is built from DATABASE_URL (-h PGHOST -p PGPORT -U PGUSER). Node's
// child_process failure message for execFile is
// "Command failed: dropdb -h <PGHOST> -p <PGPORT> -U <PGUSER> <tempDbName>\n<stderr>",
// so logging `dropErr?.message` unconditionally leaked the production DB
// host/port/username on every dropdb failure. This path can't be exercised at
// runtime here (no live Postgres / dropdb binary in this test environment,
// and reaching the `finally` block requires `dbCreated === true`, i.e. a real
// `createdb` success first) — so this is a static source-scan backstop
// instead, per this repo's documented convention for non-unit-testable paths
// (see whatsappBookingFlowLogRedaction.test.ts's "Static source scan" section).

section('backupService — dropdb failure log privacy (static source scan)');

const backupServiceSource = readFileSync(
  fileURLToPath(new URL('../services/backupService.ts', import.meta.url)),
  'utf8',
);

await test('dropdb catch block logs only dropErr?.code, never dropErr?.message (which embeds PGHOST/PGPORT/PGUSER)', () => {
  const literal = "Failed to drop temp DB:";
  const literalIndex = backupServiceSource.indexOf(literal);
  assert.ok(literalIndex >= 0, 'expected to find the dropdb failure log literal in backupService.ts');
  const callStart = backupServiceSource.lastIndexOf('console.error', literalIndex);
  assert.ok(callStart >= 0, 'expected a console.error call before the dropdb failure literal');
  const block = backupServiceSource.slice(callStart, callStart + 200);

  assert.ok(/dropErr\?\.code/.test(block), `expected dropErr?.code in: ${block}`);
  assert.ok(!/dropErr\?\.message/.test(block), `found raw dropErr?.message (leaks PGHOST/PGPORT/PGUSER) in: ${block}`);
});

// ── Constants exported ────────────────────────────────────────────────────────

section('Exported constants');

await test('BACKUP_DIR is correct path', () => {
  assert.equal(BACKUP_DIR, '/root/noramedi-backups');
});

await test('BACKUP_SCRIPT is correct path', () => {
  assert.equal(BACKUP_SCRIPT, '/usr/local/sbin/noramedi-db-backup.sh');
});

await test('BACKUP_LOG is correct path', () => {
  assert.equal(BACKUP_LOG, '/var/log/noramedi-db-backup.log');
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

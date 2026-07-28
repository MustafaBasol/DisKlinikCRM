/**
 * fileBackupService.test.ts — FILE-BACKUP-COVERAGE-001 unit tests.
 *
 * Run: cd server && npx tsx src/tests/fileBackupService.test.ts
 *
 * This environment has no live Postgres connection available (same
 * documented limitation as other recent tasks in this program — see
 * docs/program/evidence/FILE_BACKUP_COVERAGE_001.md §"Testing"). Coverage
 * here is therefore scoped to what is genuinely DB-independent:
 *
 *   - fileBackupDestination.ts's local-mode round trip (write → read →
 *     checksum → exists), which is real filesystem I/O against a disposable
 *     temp directory, not a mock.
 *   - Fail-closed env-driven gates in fileBackupService.ts (disabled by
 *     default, refuses to run with no destination configured, refuses to
 *     restore into primary storage) — these all return/throw before any
 *     Prisma call, so they are exercised for real, not mocked.
 *
 * A disposable-PostgreSQL DB-backed pass (mirroring this program's existing
 * convention, e.g. KVKK-HIGH-006's PR #203) remains a documented follow-up
 * for the run/entry-ledger/restore-rehearsal paths that do need a database —
 * see the evidence doc's honest status section.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

// ── fileBackupDestination.ts: local-mode round trip ─────────────────────────

section('fileBackupDestination — local-mode destination');

const localDestRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'file-backup-dest-test-'));
process.env.FILE_BACKUP_LOCAL_DIR = localDestRoot;
delete process.env.FILE_BACKUP_S3_BUCKET;

const dest = await import('../services/fileBackupDestination.js');

await test('getFileBackupDestinationKind returns "local" when FILE_BACKUP_LOCAL_DIR is set', () => {
  assert.equal(dest.getFileBackupDestinationKind(), 'local');
});

await test('isFileBackupDestinationConfigured is true in local mode', () => {
  assert.equal(dest.isFileBackupDestinationConfigured(), true);
});

await test('isFileBackupDestinationOffHost is false in local mode', () => {
  assert.equal(dest.isFileBackupDestinationOffHost(), false);
});

await test('buildBackupDestinationKey is deterministic per (domain, clinicId, recordId)', () => {
  const key1 = dest.buildBackupDestinationKey('attachments', 'clinic-1', 'record-1');
  const key2 = dest.buildBackupDestinationKey('attachments', 'clinic-1', 'record-1');
  assert.equal(key1, key2);
  assert.equal(key1, 'file-backups/attachments/clinic-1/record-1.bin');
});

await test('write → open → checksum round trip matches source content', async () => {
  const content = Buffer.from('hello file backup coverage test content', 'utf8');
  const expectedSha = crypto.createHash('sha256').update(content).digest('hex');
  const key = dest.buildBackupDestinationKey('imaging', 'clinic-2', 'image-1');

  const { Readable } = await import('node:stream');
  const written = await dest.writeToBackupDestination(key, Readable.from([content]));
  assert.equal(written.sha256, expectedSha);
  assert.equal(written.bytes, content.length);

  const exists = await dest.backupDestinationObjectExists(key);
  assert.equal(exists, true);

  const readBack = await dest.openBackupDestinationStream(key);
  assert.ok(readBack, 'expected a readable stream back');
  const chunks: Buffer[] = [];
  for await (const chunk of readBack!) chunks.push(chunk as Buffer);
  const roundTripped = Buffer.concat(chunks);
  assert.equal(roundTripped.toString('utf8'), content.toString('utf8'));
  const roundTrippedSha = crypto.createHash('sha256').update(roundTripped).digest('hex');
  assert.equal(roundTrippedSha, expectedSha);
});

await test('openBackupDestinationStream returns null for a key that was never written', async () => {
  const stream = await dest.openBackupDestinationStream('file-backups/attachments/clinic-9/never-written.bin');
  assert.equal(stream, null);
});

await test('backupDestinationObjectExists returns false for a key that was never written', async () => {
  const exists = await dest.backupDestinationObjectExists('file-backups/attachments/clinic-9/never-written.bin');
  assert.equal(exists, false);
});

await test('writeBackupManifest writes a readable JSON object to the destination', async () => {
  const manifestKey = 'file-backups/manifests/test-run.json';
  const ok = await dest.writeBackupManifest(manifestKey, { runId: 'test-run', filesScanned: 3 });
  assert.equal(ok, true);
  const raw = await fs.readFile(path.join(localDestRoot, manifestKey), 'utf8');
  const parsed = JSON.parse(raw);
  assert.equal(parsed.runId, 'test-run');
  assert.equal(parsed.filesScanned, 3);
});

await test('getFileBackupDestinationKind returns "none" when nothing is configured', () => {
  const savedLocal = process.env.FILE_BACKUP_LOCAL_DIR;
  delete process.env.FILE_BACKUP_LOCAL_DIR;
  try {
    assert.equal(dest.getFileBackupDestinationKind(), 'none');
    assert.equal(dest.isFileBackupDestinationConfigured(), false);
  } finally {
    process.env.FILE_BACKUP_LOCAL_DIR = savedLocal;
  }
});

// ── fileBackupService.ts: fail-closed gates (DB-independent) ────────────────

section('fileBackupService — fail-closed gates');

const svc = await import('../services/fileBackupService.js');

await test('isFileBackupEnabled defaults to false', () => {
  delete process.env.FILE_BACKUP_ENABLED;
  assert.equal(svc.isFileBackupEnabled(), false);
});

await test('isFileBackupEnabled is true only when explicitly "true"', () => {
  process.env.FILE_BACKUP_ENABLED = 'yes';
  assert.equal(svc.isFileBackupEnabled(), false);
  process.env.FILE_BACKUP_ENABLED = 'true';
  assert.equal(svc.isFileBackupEnabled(), true);
  delete process.env.FILE_BACKUP_ENABLED;
});

await test('runFileBackup refuses to run when disabled (never reaches a DB call)', async () => {
  delete process.env.FILE_BACKUP_ENABLED;
  await assert.rejects(() => svc.runFileBackup(), /disabled/i);
});

await test('runFileBackup refuses to run with no destination configured', async () => {
  process.env.FILE_BACKUP_ENABLED = 'true';
  delete process.env.FILE_BACKUP_LOCAL_DIR;
  delete process.env.FILE_BACKUP_S3_BUCKET;
  try {
    await assert.rejects(() => svc.runFileBackup(), /destination/i);
  } finally {
    delete process.env.FILE_BACKUP_ENABLED;
  }
});

await test('restoreFileToPath refuses to write inside the primary uploads directory', async () => {
  const primaryUploadDir = path.resolve(process.cwd(), 'uploads');
  const insidePrimary = path.join(primaryUploadDir, 'sneaky-restore-target');
  const result = await svc.restoreFileToPath({
    sourceModel: 'PatientAttachment',
    sourceRecordId: 'irrelevant-because-this-should-be-rejected-before-any-db-call',
    outputDir: insidePrimary,
  });
  assert.equal(result.success, false);
  assert.match(result.error ?? '', /primary storage/i);
});

await test('restoreFileToPath accepts an output directory outside primary storage (fails later at the DB lookup, not at the safety check)', async () => {
  const safeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'file-backup-restore-safe-'));
  // No live DB in this environment — once the safe-output-dir check passes,
  // the call either returns an error from the Prisma lookup or throws one
  // (e.g. connection refused). Either is acceptable here; what this test
  // asserts is that it is NOT the primary-storage safety rejection, proving
  // the safe-path check let it through correctly.
  // Exact-string check, not a substring/regex match: Prisma's own error
  // formatter can quote surrounding source lines (including this very
  // safety-check's error string, which sits right above the DB call in
  // fileBackupService.ts) — a loose /primary storage/i match against that
  // formatted output would false-positive. The safety check's own return
  // value is this exact literal string, so an exact-equality check is the
  // only way to distinguish "the safety check fired" from "Prisma's error
  // message happened to quote nearby source code."
  const SAFETY_CHECK_ERROR = 'Refusing to restore into primary storage upload directory';
  let observedMessage = '';
  try {
    const result = await svc.restoreFileToPath({
      sourceModel: 'PatientAttachment',
      sourceRecordId: 'no-such-record',
      outputDir: safeDir,
    });
    observedMessage = result.error ?? '';
  } catch (err) {
    observedMessage = err instanceof Error ? err.message : String(err);
  }
  assert.notEqual(observedMessage, SAFETY_CHECK_ERROR);
});

// ── Summary ───────────────────────────────────────────────────────────────

await fs.rm(localDestRoot, { recursive: true, force: true }).catch(() => {});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;

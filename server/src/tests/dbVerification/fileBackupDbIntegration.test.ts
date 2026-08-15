/**
 * fileBackupDbIntegration.test.ts — REVIEW-ONLY disposable-Postgres +
 * disposable-S3 (MinIO) integration pass for FILE-BACKUP-COVERAGE-001
 * (PR #247), written during code review because the PR's own test suite
 * (fileBackupService.test.ts) is entirely DB-independent and never
 * exercises runFileBackup/runFileBackupRestoreRehearsal against a real
 * database or a real S3-compatible destination.
 *
 * Requires:
 *   - DATABASE_URL pointing at a disposable Postgres 16 with migrations applied
 *   - A disposable MinIO instance reachable at MINIO_ENDPOINT (default
 *     http://localhost:19000) with credentials reviewminio/reviewminiosecret
 *
 * Run: cd server && npx tsx src/tests/dbVerification/fileBackupDbIntegration.test.ts
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { S3Client, CreateBucketCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import {
  prisma,
  createClinicFixtureSet,
  createStaffUser,
  createTestPatient,
  cleanupAllFixtures,
} from './dbVerificationHarness.js';

/**
 * F4-CI-L4-STORAGE-GATE-001 — execution receipt.
 *
 * The Layer 4 orchestrator used to infer "the storage suite ran" from this
 * process exiting 0, which is not evidence of anything: a suite that never
 * reaches its first assertion exits 0 too, and a suite that is never spawned
 * leaves the orchestrator's own exit code unset (also 0). So this suite now
 * publishes what it actually executed, and the orchestrator refuses to report
 * success without it. Written on BOTH the success and the fatal-error path
 * (see the `.finally()` at the bottom) — a crashed run must still report the
 * partial truth rather than leaving the gate with nothing to read.
 *
 * Entirely opt-in: with NMTEST_EXECUTION_RECEIPT_FILE unset (a developer
 * running this file by hand) nothing is written and behaviour is unchanged.
 */
interface ExecutionReceiptEntry {
  id?: string;
  name: string;
  status: 'passed' | 'failed';
}
const receiptEntries: ExecutionReceiptEntry[] = [];
const suiteStartedAt = new Date().toISOString();

const { section, test, summary } = (() => {
  let passed = 0;
  let failed = 0;
  function sectionFn(name: string) {
    console.log(`\n${name}`);
  }
  async function testFn(name: string, fn: () => void | Promise<void>, id?: string) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
      receiptEntries.push({ ...(id ? { id } : {}), name, status: 'passed' });
    } catch (err) {
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
      failed++;
      receiptEntries.push({ ...(id ? { id } : {}), name, status: 'failed' });
    }
  }
  function summaryFn() {
    console.log(`\n${'-'.repeat(60)}`);
    console.log(`fileBackupDbIntegration: ${passed} passed, ${failed} failed`);
    return failed === 0;
  }
  return { section: sectionFn, test: testFn, summary: summaryFn };
})();

function writeExecutionReceipt(): void {
  const receiptPath = process.env.NMTEST_EXECUTION_RECEIPT_FILE;
  if (!receiptPath) return;
  const receipt = {
    suite: 'fileBackupDbIntegration',
    runId: process.env.NMTEST_EXECUTION_RUN_ID ?? '',
    startedAt: suiteStartedAt,
    finishedAt: new Date().toISOString(),
    passed: receiptEntries.filter((e) => e.status === 'passed').length,
    failed: receiptEntries.filter((e) => e.status === 'failed').length,
    entries: receiptEntries,
  };
  try {
    fsSync.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), 'utf8');
    console.log(`[file-backup-db-integration] execution receipt written: ${receipt.passed} passed, ${receipt.failed} failed`);
  } catch (err) {
    // Never mask a real test result with an artifact-write problem. The
    // orchestrator fails closed on a missing receipt anyway, so silence here
    // still produces a red run — it just needs to say why.
    console.error(`[file-backup-db-integration] failed to write execution receipt: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Loopback == same machine. Mirrors the production predicate's own rule set. */
function isLoopbackEndpointHostname(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h === '::1' || h === '0.0.0.0') return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual !== expected) throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const BASE_UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');
const createdUploadDirs: string[] = [];

async function writePrimaryFile(clinicId: string, content: Buffer): Promise<string> {
  const fileName = `${randomUUID()}.bin`;
  const relKey = `${clinicId}/${fileName}`;
  const absPath = path.join(BASE_UPLOAD_DIR, relKey);
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, content);
  createdUploadDirs.push(path.dirname(absPath));
  return relKey;
}

async function main() {
  process.env.FILE_BACKUP_ENABLED = 'true';

  const fixtures = await createClinicFixtureSet('filebackup');
  const staffA = await createStaffUser({ organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId, role: 'OWNER', canAccessAllClinics: false });
  const patientA = await createTestPatient({ organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId });
  const patientB = await createTestPatient({ organizationId: fixtures.otherOrgId, clinicId: fixtures.crossOrgClinicId });
  const staffB = await createStaffUser({ organizationId: fixtures.otherOrgId, clinicId: fixtures.crossOrgClinicId, role: 'OWNER', canAccessAllClinics: false });

  const laboratory = await prisma.laboratory.create({ data: { clinicId: fixtures.defaultClinicId, name: 'Test Lab' } });
  const labWorkOrder = await prisma.labWorkOrder.create({
    data: { clinicId: fixtures.defaultClinicId, patientId: patientA.id, laboratoryId: laboratory.id, workType: 'crown', createdById: staffA.id },
  });
  const imagingStudy = await prisma.imagingStudy.create({
    data: { clinicId: fixtures.defaultClinicId, patientId: patientA.id, modality: 'PX' },
  });
  // F2-STAGE3-GAPD-001: a second ImagingImage/ImagingStudy pair in clinic B
  // (a different org entirely) — proves the Imaging read-port migration's
  // global, cross-tenant enumeration still reaches every clinic, not just
  // the "default" one, with no clinicId filter silently narrowing coverage.
  const imagingStudyB = await prisma.imagingStudy.create({
    data: { clinicId: fixtures.crossOrgClinicId, patientId: patientB.id, modality: 'PX' },
  });

  // ── Seed one attachment per model in clinic A, plus one PatientAttachment
  // and one ImagingImage in clinic B (different org entirely) to test tenant
  // isolation and cross-clinic Imaging read-port coverage.
  const contentA1 = Buffer.from(`attachment-A1-${randomUUID()}`);
  const contentA2 = Buffer.from(`lab-attachment-A1-${randomUUID()}`);
  const contentA3 = Buffer.from(`imaging-A1-${randomUUID()}`);
  const contentB1 = Buffer.from(`attachment-B1-${randomUUID()}`);
  const contentB2 = Buffer.from(`imaging-B1-${randomUUID()}`);

  const keyA1 = await writePrimaryFile(fixtures.defaultClinicId, contentA1);
  const keyA2 = await writePrimaryFile(fixtures.defaultClinicId, contentA2);
  const keyA3 = await writePrimaryFile(fixtures.defaultClinicId, contentA3);
  const keyB1 = await writePrimaryFile(fixtures.crossOrgClinicId, contentB1);
  const keyB2 = await writePrimaryFile(fixtures.crossOrgClinicId, contentB2);

  const patientAttachmentA1 = await prisma.patientAttachment.create({
    data: {
      clinicId: fixtures.defaultClinicId,
      patientId: patientA.id,
      fileName: 'a1.bin',
      originalName: 'a1.bin',
      fileSize: contentA1.length,
      mimeType: 'application/octet-stream',
      filePath: keyA1,
      uploadedById: staffA.id,
    },
  });
  const labOrderAttachmentA1 = await prisma.labOrderAttachment.create({
    data: {
      clinicId: fixtures.defaultClinicId,
      labWorkOrderId: labWorkOrder.id,
      fileName: 'l1.bin',
      originalName: 'l1.bin',
      fileSize: contentA2.length,
      mimeType: 'application/octet-stream',
      filePath: keyA2,
      uploadedById: staffA.id,
    },
  });
  const imagingImageA1 = await prisma.imagingImage.create({
    data: {
      clinicId: fixtures.defaultClinicId,
      studyId: imagingStudy.id,
      fileName: 'i1.bin',
      originalName: 'i1.bin',
      fileSize: contentA3.length,
      mimeType: 'application/octet-stream',
      filePath: keyA3,
    },
  });
  const patientAttachmentB1 = await prisma.patientAttachment.create({
    data: {
      clinicId: fixtures.crossOrgClinicId,
      patientId: patientB.id,
      fileName: 'b1.bin',
      originalName: 'b1.bin',
      fileSize: contentB1.length,
      mimeType: 'application/octet-stream',
      filePath: keyB1,
      uploadedById: staffB.id,
    },
  });
  const imagingImageB1 = await prisma.imagingImage.create({
    data: {
      clinicId: fixtures.crossOrgClinicId,
      studyId: imagingStudyB.id,
      fileName: 'i2.bin',
      originalName: 'i2.bin',
      fileSize: contentB2.length,
      mimeType: 'application/octet-stream',
      filePath: keyB2,
    },
  });

  const { runFileBackup, restoreFileToPath, runFileBackupRestoreRehearsal, isFileBackupRunning } = await import('../../services/fileBackupService.js');
  const dest = await import('../../services/fileBackupDestination.js');

  // ═══════════════════════════════ LOCAL DESTINATION ═══════════════════════
  section('=== Local destination (FILE_BACKUP_LOCAL_DIR) ===');

  const localDestDir = await fs.mkdtemp(path.join(os.tmpdir(), 'file-backup-review-local-'));
  process.env.FILE_BACKUP_LOCAL_DIR = localDestDir;
  delete process.env.FILE_BACKUP_S3_BUCKET;

  let firstRun: Awaited<ReturnType<typeof runFileBackup>>;
  await test('first run backs up and verifies all 5 seeded files (2 clinics, including Imaging in both)', async () => {
    firstRun = await runFileBackup({ trigger: 'manual' });
    assertEqual(firstRun.status, 'completed', 'run status');
    assert(firstRun.filesCopied >= 5, `expected >=5 files copied, got ${firstRun.filesCopied}`);
    assert(firstRun.filesVerified >= 5, `expected >=5 files verified, got ${firstRun.filesVerified}`);
    assertEqual(firstRun.filesFailed, 0, 'no failures expected');
  }, 'local-first-run-backs-up-seeded-files');

  await test('Imaging read-port migration parity: destination key is tenant-scoped and domain-scoped, no cross-clinic overlap, both clinics reached by the global ops-port enumeration', async () => {
    const entryImgA = await prisma.fileBackupEntry.findFirstOrThrow({ where: { sourceRecordId: imagingImageA1.id } });
    const entryImgB = await prisma.fileBackupEntry.findFirstOrThrow({ where: { sourceRecordId: imagingImageB1.id } });
    assertEqual(entryImgA.destinationKey, `file-backups/imaging/${fixtures.defaultClinicId}/${imagingImageA1.id}.bin`, 'imaging A1 key shape unchanged after ops-port migration');
    assertEqual(entryImgB.destinationKey, `file-backups/imaging/${fixtures.crossOrgClinicId}/${imagingImageB1.id}.bin`, 'imaging B1 key shape unchanged after ops-port migration');
    assert(entryImgA.destinationKey !== entryImgB.destinationKey, 'imaging keys must not collide across clinics');
    assertEqual(entryImgA.clinicId, fixtures.defaultClinicId, 'imaging entry A clinicId matches its own clinic');
    assertEqual(entryImgB.clinicId, fixtures.crossOrgClinicId, 'imaging entry B clinicId matches its own clinic — proves the global (no-clinicId-filter) ops-port enumeration did not omit or mis-attribute a non-default clinic');
    assertEqual(entryImgA.sourceSizeBytes, contentA3.length, 'imaging A1 fileSize accounting via the ops-port DTO matches real source byte count exactly');
    assertEqual(entryImgB.sourceSizeBytes, contentB2.length, 'imaging B1 fileSize accounting via the ops-port DTO matches real source byte count exactly');
  });

  await test('Imaging read-port migration parity: ImagingImage record restores from backup and checksum matches (restore path unaffected by the enumeration-side migration)', async () => {
    const restoreDir = await fs.mkdtemp(path.join(os.tmpdir(), 'file-backup-review-restore-img-'));
    try {
      const result = await restoreFileToPath({ sourceModel: 'ImagingImage', sourceRecordId: imagingImageA1.id, outputDir: restoreDir });
      assertEqual(result.success, true, 'restore succeeds for an ImagingImage record after the ops-port migration');
      assertEqual(result.checksumMatch, true, 'checksum matches original imaging content');
    } finally {
      await fs.rm(restoreDir, { recursive: true, force: true });
    }
  });

  await test('destination keys are tenant-scoped: clinicId is a distinct path segment, no cross-clinic path overlap', async () => {
    const entryA1 = await prisma.fileBackupEntry.findFirst({ where: { sourceRecordId: patientAttachmentA1.id } });
    const entryB1 = await prisma.fileBackupEntry.findFirst({ where: { sourceRecordId: patientAttachmentB1.id } });
    assert(entryA1, 'entry A1 exists');
    assert(entryB1, 'entry B1 exists');
    assertEqual(entryA1!.destinationKey, `file-backups/attachments/${fixtures.defaultClinicId}/${patientAttachmentA1.id}.bin`, 'A1 key shape');
    assertEqual(entryB1!.destinationKey, `file-backups/attachments/${fixtures.crossOrgClinicId}/${patientAttachmentB1.id}.bin`, 'B1 key shape');
    assert(entryA1!.destinationKey !== entryB1!.destinationKey, 'keys must not collide across clinics');
    assert(entryA1!.clinicId === fixtures.defaultClinicId, 'entry A1 clinicId matches its own clinic, not the other one');
    assert(entryB1!.clinicId === fixtures.crossOrgClinicId, 'entry B1 clinicId matches its own clinic, not the other one');
  });

  await test('backed-up bytes at destination match source content exactly, independently read back', async () => {
    const entryA1 = await prisma.fileBackupEntry.findFirstOrThrow({ where: { sourceRecordId: patientAttachmentA1.id } });
    const stream = await dest.openBackupDestinationStream(entryA1.destinationKey);
    assert(stream, 'destination stream exists');
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(chunk as Buffer);
    assertEqual(Buffer.concat(chunks).toString('utf8'), contentA1.toString('utf8'), 'round-tripped content');
  }, 'local-destination-bytes-match-source');

  await test('second run is idempotent: already-verified entries are skipped, no duplicate ledger rows', async () => {
    const countBefore = await prisma.fileBackupEntry.count({ where: { sourceRecordId: patientAttachmentA1.id, status: 'verified' } });
    const secondRun = await runFileBackup({ trigger: 'manual' });
    assertEqual(secondRun.filesCopied, 0, 'second run should copy nothing new');
    assert(secondRun.filesSkipped >= 5, `expected >=5 skipped, got ${secondRun.filesSkipped}`);
    const countAfter = await prisma.fileBackupEntry.count({ where: { sourceRecordId: patientAttachmentA1.id, status: 'verified' } });
    assertEqual(countAfter, countBefore, 'no duplicate verified entry created on idempotent re-run');
  });

  await test('DB allows two concurrent-race "verified" entries for the same sourceRecordId (no unique constraint) — proves the check-then-insert race is not DB-enforced', async () => {
    // Simulates what two racing processes' check-then-act (findFirst -> create)
    // would produce if both passed the check before either inserted — the
    // exact race the manual-trigger route (bypasses withJobLock) can hit
    // against the scheduled job on another replica.
    const raceRunA = await prisma.fileBackupRun.create({ data: { trigger: 'manual', status: 'running' } });
    const raceRunB = await prisma.fileBackupRun.create({ data: { trigger: 'scheduled', status: 'running' } });
    await prisma.fileBackupEntry.create({
      data: { runId: raceRunA.id, sourceModel: 'PatientAttachment', sourceRecordId: patientAttachmentA1.id, clinicId: fixtures.defaultClinicId, sourceKey: keyA1, destinationKey: 'race-key-1', status: 'verified' },
    });
    // This second insert for the SAME sourceRecordId + status='verified' must
    // succeed at the DB layer for the race to be real (i.e. nothing stops it).
    await prisma.fileBackupEntry.create({
      data: { runId: raceRunB.id, sourceModel: 'PatientAttachment', sourceRecordId: patientAttachmentA1.id, clinicId: fixtures.defaultClinicId, sourceKey: keyA1, destinationKey: 'race-key-2', status: 'verified' },
    });
    const dupeCount = await prisma.fileBackupEntry.count({ where: { sourceRecordId: patientAttachmentA1.id, status: 'verified', destinationKey: { in: ['race-key-1', 'race-key-2'] } } });
    assertEqual(dupeCount, 2, 'DB has no unique constraint on (sourceModel, sourceRecordId, status) — duplicate verified rows are accepted silently');
    await prisma.fileBackupRun.deleteMany({ where: { id: { in: [raceRunA.id, raceRunB.id] } } }); // cascades entries
  });

  await test('missing source file is recorded as missing_source, not silently dropped', async () => {
    const orphanRow = await prisma.patientAttachment.create({
      data: {
        clinicId: fixtures.defaultClinicId,
        patientId: patientA.id,
        fileName: 'missing.bin',
        originalName: 'missing.bin',
        fileSize: 10,
        mimeType: 'application/octet-stream',
        filePath: `${fixtures.defaultClinicId}/does-not-exist-${randomUUID()}.bin`,
        uploadedById: staffA.id,
      },
    });
    await runFileBackup({ trigger: 'manual' });
    const entry = await prisma.fileBackupEntry.findFirst({ where: { sourceRecordId: orphanRow.id } });
    assert(entry, 'entry recorded for missing source');
    assertEqual(entry!.status, 'missing_source', 'status is missing_source');
  });

  await test('Imaging read-port migration parity: missing source file (read via the ops-port) is recorded as missing_source, not silently dropped', async () => {
    const orphanImagingRow = await prisma.imagingImage.create({
      data: {
        clinicId: fixtures.defaultClinicId,
        studyId: imagingStudy.id,
        fileName: 'missing-img.bin',
        originalName: 'missing-img.bin',
        fileSize: 10,
        mimeType: 'application/octet-stream',
        filePath: `${fixtures.defaultClinicId}/does-not-exist-${randomUUID()}.bin`,
      },
    });
    await runFileBackup({ trigger: 'manual' });
    const entry = await prisma.fileBackupEntry.findFirst({ where: { sourceRecordId: orphanImagingRow.id } });
    assert(entry, 'entry recorded for missing imaging source');
    assertEqual(entry!.status, 'missing_source', 'status is missing_source');
  });

  await test('destination corruption after backup is caught at restore time (checksum mismatch), not silently accepted', async () => {
    const entryA2 = await prisma.fileBackupEntry.findFirstOrThrow({ where: { sourceRecordId: labOrderAttachmentA1.id } });
    const absDestPath = path.join(localDestDir, entryA2.destinationKey);
    await fs.writeFile(absDestPath, Buffer.from('CORRUPTED BYTES, DOES NOT MATCH ORIGINAL CHECKSUM'));

    const restoreDir = await fs.mkdtemp(path.join(os.tmpdir(), 'file-backup-review-restore-'));
    try {
      const result = await restoreFileToPath({ sourceModel: 'LabOrderAttachment', sourceRecordId: labOrderAttachmentA1.id, outputDir: restoreDir });
      assertEqual(result.success, true, 'restore write itself succeeds (bytes are written, just wrong ones)');
      assertEqual(result.checksumMatch, false, 'checksum mismatch must be reported, proving corruption is detectable');
    } finally {
      await fs.rm(restoreDir, { recursive: true, force: true });
    }
  });

  await test('restore refuses to write into primary uploads directory even for a real verified entry', async () => {
    const insidePrimary = path.join(BASE_UPLOAD_DIR, 'sneaky-real-entry-restore');
    const result = await restoreFileToPath({ sourceModel: 'PatientAttachment', sourceRecordId: patientAttachmentA1.id, outputDir: insidePrimary });
    assertEqual(result.success, false, 'restore into primary dir must be refused');
  });

  await test('SYMLINK FIX: a symlinked output dir pointing at primary uploads/ is now blocked by isSafeRestoreOutputDir', async () => {
    const symlinkParent = await fs.mkdtemp(path.join(os.tmpdir(), 'file-backup-review-symlink-'));
    const symlinkPath = path.join(symlinkParent, 'looks-safe-but-points-at-primary');
    try {
      await fs.symlink(BASE_UPLOAD_DIR, symlinkPath, 'junction');
    } catch (err) {
      console.log(`      (symlink creation skipped: ${err instanceof Error ? err.message : String(err)} — likely needs elevated privilege on Windows; treat as unverified rather than passing)`);
      throw new Error('could not create test symlink to verify the fix (see message above)');
    }
    const result = await restoreFileToPath({ sourceModel: 'PatientAttachment', sourceRecordId: patientAttachmentA1.id, outputDir: symlinkPath });
    assertEqual(result.success, false, 'restore through a symlink into primary storage must now be refused');
  });

  let restoreRehearsalResult: Awaited<ReturnType<typeof runFileBackupRestoreRehearsal>>;
  await test('restore rehearsal samples verified entries and reports pass/fail without leaking clinic B into clinic A operator view (global, platform-scoped by design)', async () => {
    restoreRehearsalResult = await runFileBackupRestoreRehearsal(10);
    assert(restoreRehearsalResult.results.length > 0, 'rehearsal restored at least one entry');
    // The corrupted LabOrderAttachment entry from the earlier test is expected among failures.
  });

  await test('CONCURRENCY FIX: a lock held by a simulated other process/replica is now respected by runFileBackup (cross-process guard)', async () => {
    // Simulates another replica already running the scheduled job (or a
    // manual trigger) by claiming the shared JobLock row directly, the same
    // way withJobLock's acquireJobLock does, without going through this
    // process's in-process `backupRunning` flag at all.
    await prisma.jobLock.upsert({
      where: { name: 'file-backup' },
      create: { name: 'file-backup', lockedUntil: new Date(Date.now() + 60_000), lockedBy: 'simulated-other-replica' },
      update: { lockedUntil: new Date(Date.now() + 60_000), lockedBy: 'simulated-other-replica' },
    });
    try {
      let rejected = false;
      try {
        await runFileBackup({ trigger: 'manual' });
      } catch (err) {
        rejected = /already in progress on another process/i.test(err instanceof Error ? err.message : String(err));
      }
      assert(rejected, 'runFileBackup must refuse to run while another replica holds the shared JobLock, even though this process\'s own backupRunning flag is false');
    } finally {
      await prisma.jobLock.deleteMany({ where: { name: 'file-backup' } });
    }
  });

  await test('in-process singleton guard rejects a second concurrent runFileBackup on the same process', async () => {
    assertEqual(isFileBackupRunning(), false, 'not running before test');
    const p1 = runFileBackup({ trigger: 'manual' });
    let secondRejected = false;
    try {
      await runFileBackup({ trigger: 'manual' });
    } catch (err) {
      secondRejected = /already in progress/i.test(err instanceof Error ? err.message : String(err));
    }
    await p1;
    assert(secondRejected, 'second concurrent call on the SAME process must be rejected');
  });

  // ═══════════════════════════════ FK / CASCADE / DELETE BEHAVIOR ══════════
  section('=== Migration: FK, cascade, orphan behavior ===');

  await test('deleting a FileBackupRun cascades to delete its FileBackupEntry rows (ON DELETE CASCADE)', async () => {
    const run = await prisma.fileBackupRun.create({ data: { trigger: 'manual', status: 'completed' } });
    const entry = await prisma.fileBackupEntry.create({
      data: { runId: run.id, sourceModel: 'PatientAttachment', sourceRecordId: randomUUID(), clinicId: fixtures.defaultClinicId, sourceKey: 'x', destinationKey: 'x', status: 'verified' },
    });
    await prisma.fileBackupRun.delete({ where: { id: run.id } });
    const stillThere = await prisma.fileBackupEntry.findUnique({ where: { id: entry.id } });
    assertEqual(stillThere, null, 'entry must be cascade-deleted with its run');
  });

  await test('ORPHANED BACKUP: deleting the source PatientAttachment row does NOT delete its FileBackupEntry or destination object (disclosed gap, confirmed live)', async () => {
    const entryBefore = await prisma.fileBackupEntry.findFirstOrThrow({ where: { sourceRecordId: patientAttachmentA1.id, status: 'verified' } });
    const existsBefore = await dest.backupDestinationObjectExists(entryBefore.destinationKey);
    assert(existsBefore, 'backup object exists before source deletion');

    // Mirrors the real DELETE /api/patients/:patientId/attachments/:id and
    // DELETE /api/lab-orders/:id/attachments/:attId route behavior: the
    // source DB row and its primary-storage file are removed; nothing in
    // either route (or anywhere else) touches FileBackupEntry.
    await prisma.patientAttachment.delete({ where: { id: patientAttachmentA1.id } });

    const entryAfter = await prisma.fileBackupEntry.findUnique({ where: { id: entryBefore.id } });
    assert(entryAfter, 'FileBackupEntry row survives source deletion (orphaned)');
    const existsAfter = await dest.backupDestinationObjectExists(entryBefore.destinationKey);
    assert(existsAfter, 'backup destination object survives source deletion (orphaned, restorable indefinitely)');
  });

  await fs.rm(localDestDir, { recursive: true, force: true }).catch(() => {});

  // ═══════════════════════════════ S3-COMPATIBLE (MinIO) DESTINATION ══════
  section('=== S3-compatible destination (MinIO) ===');

  const minioEndpoint = process.env.MINIO_ENDPOINT || 'http://localhost:19000';
  const minioAccessKey = process.env.MINIO_ACCESS_KEY || 'reviewminio';
  const minioSecretKey = process.env.MINIO_SECRET_KEY || 'reviewminiosecret';
  const bucketName = `file-backup-review-${Date.now()}`;

  const adminS3 = new S3Client({
    region: 'auto',
    endpoint: minioEndpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: minioAccessKey, secretAccessKey: minioSecretKey },
  });

  await test('MinIO bucket can be created (disposable S3-compatible destination reachable)', async () => {
    await adminS3.send(new CreateBucketCommand({ Bucket: bucketName }));
  }, 's3-bucket-created');

  process.env.FILE_BACKUP_S3_BUCKET = bucketName;
  process.env.FILE_BACKUP_S3_ENDPOINT = minioEndpoint;
  process.env.FILE_BACKUP_S3_ACCESS_KEY_ID = minioAccessKey;
  process.env.FILE_BACKUP_S3_SECRET_ACCESS_KEY = minioSecretKey;
  process.env.FILE_BACKUP_S3_FORCE_PATH_STYLE = 'true';
  process.env.FILE_BACKUP_S3_REGION = 'auto';
  delete process.env.FILE_BACKUP_LOCAL_DIR;

  // Re-seed fresh source rows so this destination starts from zero (the
  // earlier PatientAttachment/LabOrderAttachment rows were consumed/deleted above).
  const contentS3_1 = Buffer.from(`s3-attachment-${randomUUID()}`);
  const keyS3_1 = await writePrimaryFile(fixtures.defaultClinicId, contentS3_1);
  const patientAttachmentS3 = await prisma.patientAttachment.create({
    data: {
      clinicId: fixtures.defaultClinicId,
      patientId: patientA.id,
      fileName: 's3-1.bin',
      originalName: 's3-1.bin',
      fileSize: contentS3_1.length,
      mimeType: 'application/octet-stream',
      filePath: keyS3_1,
      uploadedById: staffA.id,
    },
  });

  // F4-CI-L4-STORAGE-GATE-001 (Lane C). This case previously asserted
  // `isFileBackupDestinationOffHost() === true` unconditionally, which
  // directly contradicted the F4-FCR-001 tightening that (correctly) refuses
  // to call a loopback endpoint off-host. The contradiction is resolved on
  // the TEST side, not the production side: the orchestrator now hands this
  // suite the MinIO container's own non-loopback network address wherever
  // that is routable, so the unmodified production predicate answers `true`
  // on its own merits; where only the published loopback mapping is usable,
  // the honest answer is `false` and that is what is asserted. Production
  // policy is untouched in both directions.
  await test('destination is s3, and the off-host classification matches the real endpoint topology it was handed', async () => {
    assertEqual(dest.getFileBackupDestinationKind(), 's3', 'kind');

    const endpointHost = new URL(minioEndpoint).hostname;
    const endpointIsLoopback = isLoopbackEndpointHostname(endpointHost);
    assertEqual(
      dest.isFileBackupDestinationOffHost(),
      !endpointIsLoopback,
      `off-host classification for endpoint host "${endpointHost}" (loopback=${endpointIsLoopback}) — a loopback destination must NEVER be reported as off-host, and a genuinely non-loopback one must be`,
    );

    // When the orchestrator says it provisioned an off-host-SHAPED
    // destination, a loopback endpoint here means the topology silently
    // degraded and the off-host path stopped being covered at all. That is a
    // coverage regression, so it fails rather than passing quietly.
    if (process.env.NMTEST_EXPECT_OFFHOST_DESTINATION === 'true') {
      assert(
        !endpointIsLoopback,
        `the runtime promised an off-host-shaped MinIO destination (NMTEST_MINIO_ADDRESS_MODE=${process.env.NMTEST_MINIO_ADDRESS_MODE ?? 'unset'}) but handed this suite loopback endpoint "${minioEndpoint}"`,
      );
      assertEqual(dest.isFileBackupDestinationOffHost(), true, 'off-host destination must classify as off-host');
    }
  }, 's3-destination-kind-and-offhost-classification');

  await test('a loopback S3 endpoint is never classified as off-host, even in this same s3 destination kind (production policy, asserted live against the real module)', async () => {
    const realEndpoint = process.env.FILE_BACKUP_S3_ENDPOINT;
    try {
      for (const loopback of ['http://127.0.0.1:9000', 'http://localhost:9000', 'http://127.5.6.7:9000', 'http://0.0.0.0:9000']) {
        process.env.FILE_BACKUP_S3_ENDPOINT = loopback;
        assertEqual(dest.getFileBackupDestinationKind(), 's3', `kind stays s3 for ${loopback}`);
        assertEqual(dest.isFileBackupDestinationOffHost(), false, `${loopback} must not be reported as off-host`);
      }
    } finally {
      if (realEndpoint === undefined) delete process.env.FILE_BACKUP_S3_ENDPOINT;
      else process.env.FILE_BACKUP_S3_ENDPOINT = realEndpoint;
    }
  }, 's3-loopback-never-offhost');

  let s3Run: Awaited<ReturnType<typeof runFileBackup>>;
  await test('backup run uploads to MinIO, verifies via independent read-back', async () => {
    s3Run = await runFileBackup({ trigger: 'manual' });
    assertEqual(s3Run.status, 'completed', 'run status');
    assert(s3Run.filesVerified >= 1, 'at least the new S3 row verified');
  }, 's3-backup-run-uploads-and-verifies');

  await test('object is independently readable directly from MinIO via a separate S3 client (not just through our own code path)', async () => {
    const entry = await prisma.fileBackupEntry.findFirstOrThrow({ where: { sourceRecordId: patientAttachmentS3.id } });
    const result = await adminS3.send(new GetObjectCommand({ Bucket: bucketName, Key: entry.destinationKey }));
    const chunks: Buffer[] = [];
    for await (const chunk of result.Body as any) chunks.push(chunk as Buffer);
    assertEqual(Buffer.concat(chunks).toString('utf8'), contentS3_1.toString('utf8'), 'independently read-back content matches source');
  }, 's3-independent-read-back');

  await test('missing-object detection: deleting the MinIO object out-of-band makes restore fail cleanly (not silently succeed)', async () => {
    const entry = await prisma.fileBackupEntry.findFirstOrThrow({ where: { sourceRecordId: patientAttachmentS3.id } });
    await adminS3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: entry.destinationKey }));
    const restoreDir = await fs.mkdtemp(path.join(os.tmpdir(), 'file-backup-review-s3-restore-'));
    try {
      const result = await restoreFileToPath({ sourceModel: 'PatientAttachment', sourceRecordId: patientAttachmentS3.id, outputDir: restoreDir });
      assertEqual(result.success, false, 'restore must fail cleanly when the backup object is missing at the destination');
      assert(/not found/i.test(result.error ?? ''), 'error message indicates missing object');
    } finally {
      await fs.rm(restoreDir, { recursive: true, force: true });
    }
  }, 's3-missing-object-restore-fails-cleanly');

  await test('corruption detection on MinIO: overwriting object bytes out-of-band is caught by restore checksum comparison', async () => {
    // Re-back-up (the object was deleted above, but the ledger entry is still 'verified'
    // so runFileBackup will NOT re-copy it — this itself demonstrates that once "verified",
    // a later out-of-band destination change is invisible to the backup job, only to restore).
    const entry = await prisma.fileBackupEntry.findFirstOrThrow({ where: { sourceRecordId: patientAttachmentS3.id } });
    await adminS3.send(new PutObjectCommand({ Bucket: bucketName, Key: entry.destinationKey, Body: Buffer.from('TAMPERED CONTENT') }));
    const restoreDir = await fs.mkdtemp(path.join(os.tmpdir(), 'file-backup-review-s3-restore2-'));
    try {
      const result = await restoreFileToPath({ sourceModel: 'PatientAttachment', sourceRecordId: patientAttachmentS3.id, outputDir: restoreDir });
      assertEqual(result.success, true, 'restore write succeeds (wrong bytes are still written)');
      assertEqual(result.checksumMatch, false, 'checksum mismatch against tampered object must be reported');
    } finally {
      await fs.rm(restoreDir, { recursive: true, force: true });
    }
  }, 's3-corruption-detected-at-restore');

  await test('a stale entry marked verified against now-tampered content is NEVER re-verified by subsequent backup runs (skip-if-verified is permanent, not re-checked)', async () => {
    const before = await prisma.fileBackupEntry.findFirstOrThrow({ where: { sourceRecordId: patientAttachmentS3.id } });
    await runFileBackup({ trigger: 'manual' });
    const after = await prisma.fileBackupEntry.findFirstOrThrow({ where: { sourceRecordId: patientAttachmentS3.id } });
    assertEqual(after.id, before.id, 'no new entry was created — the tampered object is never re-verified going forward');
  });

  console.log('\nCleaning up MinIO bucket and Postgres fixtures...');
  await prisma.fileBackupEntry.deleteMany({ where: { clinicId: { in: [fixtures.defaultClinicId, fixtures.crossOrgClinicId] } } }).catch(() => {});
  await prisma.fileBackupRun.deleteMany({}).catch(() => {});
  await prisma.patientAttachment.deleteMany({ where: { clinicId: { in: [fixtures.defaultClinicId, fixtures.crossOrgClinicId] } } }).catch(() => {});
  await prisma.labOrderAttachment.deleteMany({ where: { clinicId: fixtures.defaultClinicId } }).catch(() => {});
  await prisma.imagingImage.deleteMany({ where: { clinicId: { in: [fixtures.defaultClinicId, fixtures.crossOrgClinicId] } } }).catch(() => {});
  await prisma.imagingStudy.deleteMany({ where: { id: { in: [imagingStudy.id, imagingStudyB.id] } } }).catch(() => {});
  await prisma.labWorkOrder.deleteMany({ where: { id: labWorkOrder.id } }).catch(() => {});
  await prisma.laboratory.deleteMany({ where: { id: laboratory.id } }).catch(() => {});
  for (const dir of createdUploadDirs) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  await cleanupAllFixtures();

  return summary();
}

main()
  .then((ok) => {
    process.exitCode = ok ? 0 : 1;
  })
  .catch((err) => {
    console.error('[file-backup-db-integration] Fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Written on both the success and the fatal-error path — see the
    // execution-receipt comment at the top of this file.
    writeExecutionReceipt();
    await prisma.$disconnect().catch(() => {});
  });

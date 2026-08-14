/**
 * recoveryDrillLedger.test.ts — F4-FCR-001 disposable-PostgreSQL verification
 * of the RecoveryDrillRun evidence ledger and of the restore-rehearsal
 * sampling strategies.
 *
 * The companion unit suite (src/tests/recoveryDrillService.test.ts) proves the
 * arithmetic and the never-throw discipline against an in-memory fake. This
 * file proves the parts a fake structurally cannot: that the migration's
 * columns/defaults actually exist, that `updateMany`-based reapers really do
 * transition rows in Postgres, and that `orderBy createdAt asc` genuinely
 * selects the OLDEST backup entries (the bit-rot-detecting sample a
 * newest-only rehearsal can never reach).
 *
 * Requires:
 *   - DATABASE_URL pointing at a disposable Postgres with migrations applied
 *     (including 20260814120000_add_recovery_drill_run)
 *   - No external S3/MinIO: the rehearsal runs against a local-mode
 *     FILE_BACKUP_LOCAL_DIR destination in a temp directory
 *
 * Run: cd server && npx tsx src/tests/dbVerification/recoveryDrillLedger.test.ts
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { prisma } from './dbVerificationHarness.js';

const { section, test, summary } = (() => {
  let passed = 0;
  let failed = 0;
  function sectionFn(name: string) {
    console.log(`\n${name}`);
  }
  async function testFn(name: string, fn: () => void | Promise<void>) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
      failed++;
    }
  }
  function summaryFn() {
    console.log(`\n${'-'.repeat(60)}`);
    console.log(`recoveryDrillLedger: ${passed} passed, ${failed} failed`);
    return failed === 0;
  }
  return { section: sectionFn, test: testFn, summary: summaryFn };
})();

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual !== expected) throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// Synthetic, non-tenant clinic label. FileBackupEntry.clinicId has no FK to
// Clinic (see 20260728120000_add_file_backup_coverage), so this suite needs no
// organization/clinic fixtures at all — and touches no patient data.
const SYNTHETIC_CLINIC_ID = `synthetic-clinic-${randomUUID()}`;

async function main() {
  const localDestDir = await fs.mkdtemp(path.join(os.tmpdir(), 'recovery-drill-dest-'));
  process.env.FILE_BACKUP_LOCAL_DIR = localDestDir;
  delete process.env.FILE_BACKUP_S3_BUCKET;
  process.env.FILE_BACKUP_ENABLED = 'true';

  // Deterministic starting point: this is a disposable database, and the
  // rehearsal selects across ALL verified entries globally, so leftover rows
  // from another suite would silently change which entries get sampled.
  await prisma.recoveryDrillRun.deleteMany({});
  await prisma.fileBackupEntry.deleteMany({});
  await prisma.fileBackupRun.deleteMany({});

  const drill = await import('../../services/recoveryDrillService.js');
  const fileBackup = await import('../../services/fileBackupService.js');

  // ═══════════════════════════ LEDGER LIFECYCLE ═════════════════════════════
  section('=== RecoveryDrillRun ledger lifecycle (start -> finish) ===');

  let lifecycleDrillId = '';
  await test('startRecoveryDrill persists a running row with RPO evidence derived from sourceArtifactAt', async () => {
    const artifactAt = new Date(Date.now() - 90 * MINUTE);
    lifecycleDrillId = await drill.startRecoveryDrill({
      kind: 'file_restore_rehearsal',
      trigger: 'manual',
      sourceArtifactAt: artifactAt,
    });
    const row = await prisma.recoveryDrillRun.findUniqueOrThrow({ where: { id: lifecycleDrillId } });
    assertEqual(row.status, 'running', 'fresh drill status');
    assertEqual(row.kind, 'file_restore_rehearsal', 'kind persisted');
    assertEqual(row.trigger, 'manual', 'trigger persisted');
    assertEqual(row.finishedAt, null, 'not finished yet');
    assertEqual(row.durationMs, null, 'no duration yet');
    assert(row.sourceArtifactAt !== null, 'sourceArtifactAt persisted');
    assert(row.sourceArtifactAgeMinutes !== null, 'RPO age computed');
    // Range, never equality against a live clock.
    assert(row.sourceArtifactAgeMinutes! >= 90 && row.sourceArtifactAgeMinutes! <= 95, `RPO age out of range: ${row.sourceArtifactAgeMinutes}`);
    // Migration defaults must actually be present in Postgres, not just in the schema file.
    assertEqual(row.samplesAttempted, 0, 'samplesAttempted defaults to 0');
    assertEqual(row.cleanupVerified, false, 'cleanupVerified defaults to false');
  });

  await test('finishRecoveryDrill stamps finishedAt, a measured durationMs (RTO), counts and cleanup state', async () => {
    // Backdate startedAt so a known minimum elapsed time exists without sleeping.
    await prisma.recoveryDrillRun.update({
      where: { id: lifecycleDrillId },
      data: { startedAt: new Date(Date.now() - 7_000) },
    });

    await drill.finishRecoveryDrill({
      id: lifecycleDrillId,
      status: 'passed',
      samplesAttempted: 4,
      samplesPassed: 4,
      samplesFailed: 0,
      cleanupVerified: true,
    });

    const row = await prisma.recoveryDrillRun.findUniqueOrThrow({ where: { id: lifecycleDrillId } });
    assertEqual(row.status, 'passed', 'finished status');
    assert(row.finishedAt !== null, 'finishedAt stamped');
    assert(row.durationMs !== null, 'durationMs recorded');
    assert(row.durationMs! >= 7_000, `expected >=7000ms RTO evidence, got ${row.durationMs}`);
    assert(row.durationMs! < 10 * MINUTE, `expected a sane RTO measurement, got ${row.durationMs}`);
    assertEqual(row.samplesAttempted, 4, 'samplesAttempted persisted');
    assertEqual(row.samplesPassed, 4, 'samplesPassed persisted');
    assertEqual(row.cleanupVerified, true, 'cleanupVerified persisted');
    assertEqual(row.errorCode, null, 'no error code on a passing drill');
  });

  // ═══════════════════════════ CRASH-RECOVERY REAPERS ═══════════════════════
  section('=== Reapers: abandoned rows reach a terminal state ===');

  await test('reapStaleRecoveryDrills transitions an abandoned running drill to failed/drill_abandoned', async () => {
    const abandoned = await prisma.recoveryDrillRun.create({
      data: { kind: 'db_restore_test', trigger: 'scheduled', status: 'running', startedAt: new Date(Date.now() - 4 * HOUR) },
    });
    const inFlight = await prisma.recoveryDrillRun.create({
      data: { kind: 'db_restore_test', trigger: 'scheduled', status: 'running', startedAt: new Date(Date.now() - 3 * MINUTE) },
    });

    const reaped = await drill.reapStaleRecoveryDrills();
    assert(reaped >= 1, `expected at least one reaped row, got ${reaped}`);

    const abandonedAfter = await prisma.recoveryDrillRun.findUniqueOrThrow({ where: { id: abandoned.id } });
    assertEqual(abandonedAfter.status, 'failed', 'abandoned drill is now failed');
    assertEqual(abandonedAfter.errorCode, 'drill_abandoned', 'abandoned drill carries the fixed reaper label');
    assert(abandonedAfter.finishedAt !== null, 'reaped drill gets a finishedAt');
    // Nobody observed this run finish, so there is no honest RTO to record.
    assertEqual(abandonedAfter.durationMs, null, 'reaped drill records no fabricated duration');

    const inFlightAfter = await prisma.recoveryDrillRun.findUniqueOrThrow({ where: { id: inFlight.id } });
    assertEqual(inFlightAfter.status, 'running', 'a genuinely in-flight drill must not be reaped');
    await prisma.recoveryDrillRun.delete({ where: { id: inFlight.id } });
  });

  await test('reapStaleFileBackupRuns transitions an abandoned running FileBackupRun to failed/run_abandoned', async () => {
    const abandonedRun = await prisma.fileBackupRun.create({
      data: { trigger: 'scheduled', status: 'running', startedAt: new Date(Date.now() - 5 * HOUR) },
    });
    const freshRun = await prisma.fileBackupRun.create({
      data: { trigger: 'manual', status: 'running', startedAt: new Date(Date.now() - 2 * MINUTE) },
    });

    const reaped = await fileBackup.reapStaleFileBackupRuns();
    assert(reaped >= 1, `expected at least one reaped backup run, got ${reaped}`);

    const after = await prisma.fileBackupRun.findUniqueOrThrow({ where: { id: abandonedRun.id } });
    assertEqual(after.status, 'failed', 'abandoned backup run is now failed');
    assertEqual(after.errorSummary, 'run_abandoned', 'abandoned backup run carries the fixed reaper label');
    assert(after.finishedAt !== null, 'reaped backup run gets a finishedAt — no longer perpetually in flight');

    const freshAfter = await prisma.fileBackupRun.findUniqueOrThrow({ where: { id: freshRun.id } });
    assertEqual(freshAfter.status, 'running', 'a genuinely in-flight backup run must not be reaped');

    await prisma.fileBackupRun.deleteMany({ where: { id: { in: [abandonedRun.id, freshRun.id] } } });
  });

  // ═══════════════════════════ STATUS SURFACE ═══════════════════════════════
  section('=== getRecoveryDrillStatus over real rows ===');

  await test('surfaces a residual artifact label (leaked temp database name) an operator can act on', async () => {
    const leakedName = `noramedi_restore_test_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const failedDrill = await prisma.recoveryDrillRun.create({
      data: { kind: 'db_restore_test', trigger: 'scheduled', status: 'running', startedAt: new Date(Date.now() - 30 * MINUTE) },
    });
    await drill.finishRecoveryDrill({
      id: failedDrill.id,
      status: 'failed',
      cleanupVerified: false,
      residualArtifact: leakedName,
      errorCode: 'ECONNRESET',
    });

    const status = await drill.getRecoveryDrillStatus();
    const surfaced = status.residualArtifacts.find((entry) => entry.id === failedDrill.id);
    assert(surfaced, 'the failed drill appears in residualArtifacts');
    assertEqual(surfaced!.residualArtifact, leakedName, 'residual label is preserved verbatim for manual cleanup');
    assertEqual(surfaced!.cleanupVerified, false, 'cleanup is not claimed as verified');
    assertEqual(status.lastDbRestoreTest?.id, failedDrill.id, 'newest db_restore_test is the one just recorded');
    assert(status.staleThresholdHours > 0, 'a staleness threshold is reported');
  });

  await test('a drill older than the staleness threshold is reported stale, a fresh one is not', async () => {
    const original = process.env.RECOVERY_DRILL_MAX_AGE_HOURS;
    try {
      process.env.RECOVERY_DRILL_MAX_AGE_HOURS = '168';
      // lastFileRestoreRehearsal is the lifecycle drill from the first section
      // (started seconds ago), so it must read as fresh.
      const status = await drill.getRecoveryDrillStatus();
      assertEqual(status.staleThresholdHours, 168, 'threshold honoured from env');
      assertEqual(status.fileRestoreRehearsalStale, false, 'a drill run seconds ago is not stale');

      await prisma.recoveryDrillRun.update({
        where: { id: lifecycleDrillId },
        data: { startedAt: new Date(Date.now() - 200 * HOUR) },
      });
      const staleStatus = await drill.getRecoveryDrillStatus();
      assertEqual(staleStatus.fileRestoreRehearsalStale, true, 'a drill older than 168h is stale');
    } finally {
      if (original === undefined) delete process.env.RECOVERY_DRILL_MAX_AGE_HOURS;
      else process.env.RECOVERY_DRILL_MAX_AGE_HOURS = original;
    }
  });

  // ═══════════════════════════ REHEARSAL SAMPLING ═══════════════════════════
  section('=== Restore rehearsal sampling strategies over real ledger rows ===');

  // Six verified entries with strictly increasing createdAt, each backed by a
  // real destination object whose bytes hash to the recorded checksum, so the
  // rehearsal genuinely restores and checksum-verifies rather than short-
  // circuiting on a missing object.
  const sampleRun = await prisma.fileBackupRun.create({ data: { trigger: 'manual', status: 'completed' } });
  const orderedRecordIds: string[] = [];
  for (let i = 0; i < 6; i++) {
    const sourceRecordId = randomUUID();
    orderedRecordIds.push(sourceRecordId);
    const content = Buffer.from(`recovery-drill-sample-${i}-${sourceRecordId}`);
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');
    const destinationKey = `file-backups/attachments/${SYNTHETIC_CLINIC_ID}/${sourceRecordId}.bin`;
    const absPath = path.join(localDestDir, destinationKey);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, content);

    // createdAt spaced one hour apart, oldest first (index 0 = oldest).
    const createdAt = new Date(Date.now() - (6 - i) * HOUR);
    await prisma.fileBackupEntry.create({
      data: {
        runId: sampleRun.id,
        sourceModel: 'PatientAttachment',
        sourceRecordId,
        clinicId: SYNTHETIC_CLINIC_ID,
        sourceKey: `${SYNTHETIC_CLINIC_ID}/${sourceRecordId}.bin`,
        destinationKey,
        sourceChecksumSha256: sha256,
        destinationChecksumSha256: sha256,
        sourceSizeBytes: content.length,
        status: 'verified',
        copiedAt: createdAt,
        verifiedAt: createdAt,
        createdAt,
      },
    });
  }
  const oldestTwo = orderedRecordIds.slice(0, 2);
  const newestTwo = orderedRecordIds.slice(-2);

  await test("strategy 'oldest' selects the OLDEST entries — the bit-rot sample newest-only sampling can never reach", async () => {
    const sample = await fileBackup.selectRestoreRehearsalSample({ sampleSize: 2, strategy: 'oldest' });
    assertEqual(sample.length, 2, 'sample size honoured');
    const ids = sample.map((entry) => entry.sourceRecordId).sort();
    assertEqual(JSON.stringify(ids), JSON.stringify([...oldestTwo].sort()), 'the two oldest verified entries were chosen');
  });

  await test("strategy 'newest' still selects the NEWEST entries (original behavior preserved)", async () => {
    const sample = await fileBackup.selectRestoreRehearsalSample({ sampleSize: 2, strategy: 'newest' });
    const ids = sample.map((entry) => entry.sourceRecordId).sort();
    assertEqual(JSON.stringify(ids), JSON.stringify([...newestTwo].sort()), 'the two newest verified entries were chosen');
  });

  await test("strategy 'mixed' (the default) spans both ends and deduplicates by entry id", async () => {
    const sample = await fileBackup.selectRestoreRehearsalSample({ sampleSize: 4, strategy: 'mixed' });
    const ids = sample.map((entry) => entry.sourceRecordId);
    assertEqual(new Set(ids).size, ids.length, 'no duplicate entries in a mixed sample');
    assert(ids.includes(orderedRecordIds[0]!), 'mixed sample includes the oldest entry');
    assert(ids.includes(orderedRecordIds[orderedRecordIds.length - 1]!), 'mixed sample includes the newest entry');

    // With fewer verified entries than requested, the two halves overlap and
    // dedupe must still yield a bounded, duplicate-free set.
    const oversized = await fileBackup.selectRestoreRehearsalSample({ sampleSize: 100, strategy: 'mixed' });
    const oversizedIds = oversized.map((entry) => entry.sourceRecordId);
    assertEqual(new Set(oversizedIds).size, oversizedIds.length, 'oversized mixed sample is still duplicate-free');
    assert(oversizedIds.length <= 6, `expected at most the 6 available entries, got ${oversizedIds.length}`);
  });

  await test("runFileBackupRestoreRehearsal with strategy 'oldest' actually restores the oldest entries and reports timing", async () => {
    const result = await fileBackup.runFileBackupRestoreRehearsal({ sampleSize: 2, strategy: 'oldest' });
    assertEqual(result.strategy, 'oldest', 'strategy echoed back');
    assertEqual(result.sampleSize, 2, 'two entries exercised');
    assertEqual(result.passed, 2, 'both restored bytes checksum-match');
    assertEqual(result.failed, 0, 'no failures');
    assertEqual(result.success, true, 'rehearsal succeeded');
    const exercised = result.results.map((entry) => entry.sourceRecordId).sort();
    assertEqual(JSON.stringify(exercised), JSON.stringify([...oldestTwo].sort()), 'the OLDEST entries are the ones that were actually restored');
    assert(typeof result.durationMs === 'number' && result.durationMs >= 0, 'durationMs recorded');
    assert(result.oldestSampledAt !== null && result.newestSampledAt !== null, 'sampled createdAt window reported');
    assert(
      new Date(result.oldestSampledAt!).getTime() <= new Date(result.newestSampledAt!).getTime(),
      'oldestSampledAt is not after newestSampledAt',
    );
  });

  await test('the backward-compatible bare-number signature still works (platform-admin route / operator CLI)', async () => {
    const result = await fileBackup.runFileBackupRestoreRehearsal(3);
    assertEqual(result.strategy, 'mixed', 'bare-number calls get the default mixed strategy');
    assert(result.sampleSize > 0 && result.sampleSize <= 3, `expected 1..3 entries, got ${result.sampleSize}`);
    assertEqual(result.failed, 0, 'all sampled entries restore cleanly');
  });

  await test('getLatestVerifiedBackupArtifactAt returns the newest verified copiedAt (the RPO input a drill records)', async () => {
    const latest = await fileBackup.getLatestVerifiedBackupArtifactAt();
    assert(latest !== null, 'a verified artifact timestamp is available');
    const newestEntry = await prisma.fileBackupEntry.findFirstOrThrow({
      where: { status: 'verified', copiedAt: { not: null } },
      orderBy: { copiedAt: 'desc' },
    });
    assertEqual(latest!.getTime(), newestEntry.copiedAt!.getTime(), 'matches the newest verified entry copiedAt');
  });

  // ═══════════════════════════ CLEANUP ══════════════════════════════════════
  console.log('\nCleaning up recovery drill and file backup fixtures...');
  await prisma.fileBackupEntry.deleteMany({ where: { clinicId: SYNTHETIC_CLINIC_ID } }).catch(() => {});
  await prisma.fileBackupRun.deleteMany({ where: { id: sampleRun.id } }).catch(() => {});
  await prisma.recoveryDrillRun.deleteMany({}).catch(() => {});
  await fs.rm(localDestDir, { recursive: true, force: true }).catch(() => {});

  return summary();
}

main()
  .then((ok) => {
    process.exitCode = ok ? 0 : 1;
  })
  .catch((err) => {
    console.error('[recovery-drill-ledger] Fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });

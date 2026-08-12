/**
 * fileBackupJob.ts — scheduled off-host backup sweep for filesystem-backed
 * clinical artifacts (FILE-BACKUP-COVERAGE-001).
 *
 * Singleton, cluster-wide execution IS the intent (mirrors
 * clinicBulkExportCleanupJob.ts, not clinicBulkExportWorker.ts): this job
 * only copies/verifies already-existing files, so two replicas racing to
 * run it concurrently would just be wasted duplicate work, not a
 * correctness problem.
 *
 * The cross-process guard (withJobLock) lives INSIDE
 * fileBackupService.ts's runFileBackup() itself, not here — every caller
 * (this cron tick, the manual POST /file-backups/run admin route, and any
 * future caller) shares that one lock/TTL, so a manual trigger on one
 * replica can never run concurrently with the scheduled job (or another
 * manual trigger) on a different replica. Do not re-wrap the call below in
 * its own withJobLock — that would double-acquire the same named lock and
 * make every scheduled run fail with "already in progress on another
 * process/replica" against itself.
 *
 * FILE_BACKUP_ENABLED defaults to false (fail-closed) — the job is not even
 * scheduled unless explicitly turned on, mirroring
 * CLINIC_BULK_EXPORT_ENABLED's existing convention in this codebase.
 */

import cron from 'node-cron';
import { isFileBackupEnabled, runFileBackup } from '../services/fileBackupService.js';
import { isFileBackupDestinationConfigured } from '../services/fileBackupDestination.js';
import { safeErrorFields } from '../utils/safeError.js';

function getCronSchedule(): string {
  return process.env.FILE_BACKUP_CRON?.trim() || '0 3 * * *'; // daily, 03:00 local
}

export function startFileBackupJob(): void {
  if (!isFileBackupEnabled()) {
    console.log('[file-backup] Job disabled (FILE_BACKUP_ENABLED=false).');
    return;
  }
  if (!isFileBackupDestinationConfigured()) {
    console.error(
      '[file-backup] FILE_BACKUP_ENABLED=true but no destination is configured ' +
        '(set FILE_BACKUP_S3_BUCKET or FILE_BACKUP_LOCAL_DIR). Job will not be scheduled.',
    );
    return;
  }

  const schedule = getCronSchedule();
  cron.schedule(schedule, () => {
    runFileBackup({ trigger: 'scheduled' })
      .then((summary) => {
        console.log(
          `[file-backup] run=${summary.runId} status=${summary.status} scanned=${summary.filesScanned} ` +
            `copied=${summary.filesCopied} verified=${summary.filesVerified} skipped=${summary.filesSkipped} ` +
            `failed=${summary.filesFailed} missing=${summary.filesMissing} bytes=${summary.bytesCopied}`,
        );
      })
      .catch((err: unknown) => {
        // Includes the expected, benign case where another replica (or a
        // manual trigger) already holds the lock — logged, not thrown,
        // since a missed tick here just means tomorrow's tick tries again.
        console.error('[file-backup] Run skipped or failed:', safeErrorFields(err));
      });
  });

  console.log(`[file-backup] Scheduled backup job cron="${schedule}".`);
}

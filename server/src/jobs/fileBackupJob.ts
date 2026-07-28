/**
 * fileBackupJob.ts — scheduled off-host backup sweep for filesystem-backed
 * clinical artifacts (FILE-BACKUP-COVERAGE-001).
 *
 * Singleton, cluster-wide execution IS the intent (mirrors
 * clinicBulkExportCleanupJob.ts, not clinicBulkExportWorker.ts): this job
 * only copies/verifies already-existing files, so two replicas racing to
 * run it concurrently would just be wasted duplicate work, not a
 * correctness problem — withJobLock avoids that waste for free.
 *
 * FILE_BACKUP_ENABLED defaults to false (fail-closed) — the job is not even
 * scheduled unless explicitly turned on, mirroring
 * CLINIC_BULK_EXPORT_ENABLED's existing convention in this codebase.
 */

import cron from 'node-cron';
import { withJobLock } from '../utils/jobLock.js';
import { isFileBackupEnabled, runFileBackup } from '../services/fileBackupService.js';
import { isFileBackupDestinationConfigured } from '../services/fileBackupDestination.js';

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
    withJobLock('file-backup', 60 * 60 * 1000, async () => {
      const summary = await runFileBackup({ trigger: 'scheduled' });
      console.log(
        `[file-backup] run=${summary.runId} status=${summary.status} scanned=${summary.filesScanned} ` +
          `copied=${summary.filesCopied} verified=${summary.filesVerified} skipped=${summary.filesSkipped} ` +
          `failed=${summary.filesFailed} missing=${summary.filesMissing} bytes=${summary.bytesCopied}`,
      );
    }).catch((err: unknown) => {
      console.error(`[file-backup] Unhandled error: ${err instanceof Error ? err.message : String(err)}`);
    });
  });

  console.log(`[file-backup] Scheduled backup job cron="${schedule}".`);
}

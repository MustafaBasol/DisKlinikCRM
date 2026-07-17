/**
 * clinicBulkExportCleanupJob.ts — KVKK-HIGH-004 cleanup sweep
 * (docs/compliance/54-kvkk-secure-clinic-bulk-export.md).
 *
 * Singleton, cluster-wide execution IS the intent here (unlike
 * clinicBulkExportWorker.ts's per-tick generation, which deliberately does
 * NOT use withJobLock) — this job only sweeps/reconciles state, so running
 * it more than once concurrently would just be wasted duplicate work, not a
 * correctness problem, but withJobLock avoids that waste for free.
 *
 * CLINIC_BULK_EXPORT_CLEANUP_ENABLED is a deliberately SEPARATE flag from
 * CLINIC_BULK_EXPORT_ENABLED — expired artifacts/rows and abandoned
 * queued/generating rows keep being swept even while creation is disabled.
 */

import cron from 'node-cron';
import { withJobLock } from '../utils/jobLock.js';
import { isClinicBulkExportCleanupEnabled } from '../services/privacy/clinicBulkExportConfig.js';
import {
  cleanupExpiredClinicBulkExportArchives,
} from '../services/privacy/clinicBulkExportPackage.js';
import { cleanupStaleClinicBulkExportPasswordAttempts } from '../services/privacy/clinicBulkExportPasswordAttempts.js';
import { cleanupStaleLocalExportPartialFiles } from '../services/fileStorage.js';

/**
 * Any local-mode `*.partial-*` export artifact surviving this long can only
 * be the result of a crash between saveFileFromPath creating it and
 * promoting it to its final name (that promotion is a near-instant rename)
 * — never a legitimately in-progress write. Comfortably above the cleanup
 * cron's own 15-minute cadence so a normal run never races a write that
 * happens to still be mid-flight for an unrelated reason.
 */
const STALE_PARTIAL_FILE_MAX_AGE_MS = 30 * 60 * 1000;

export function startClinicBulkExportCleanupJob(): void {
  if (!isClinicBulkExportCleanupEnabled()) {
    console.log('[clinic-bulk-export-cleanup] Cleanup job disabled (CLINIC_BULK_EXPORT_CLEANUP_ENABLED=false).');
    return;
  }

  cron.schedule('*/15 * * * *', () => {
    withJobLock('clinic-bulk-export-cleanup', 15 * 60 * 1000, async () => {
      const result = await cleanupExpiredClinicBulkExportArchives();
      const deletedAttempts = await cleanupStaleClinicBulkExportPasswordAttempts();
      // Local-mode-only (no-op under S3 storage — see the function's own doc
      // comment for why remote storage relies on a bucket lifecycle rule
      // instead): sweeps orphaned exports/<clinicId>/*.partial-<uuid> files
      // left behind by a process crash between saveFileFromPath creating one
      // and promoting it to its final name.
      const deletedPartials = await cleanupStaleLocalExportPartialFiles(STALE_PARTIAL_FILE_MAX_AGE_MS);
      if (result.expired > 0 || result.deleted > 0 || result.sweptAbandoned > 0 || deletedAttempts > 0 || deletedPartials > 0) {
        console.log(
          `[clinic-bulk-export-cleanup] expired=${result.expired} deleted=${result.deleted} ` +
            `sweptAbandoned=${result.sweptAbandoned} deletedAttempts=${deletedAttempts} deletedPartials=${deletedPartials}`,
        );
      }
    }).catch((err: unknown) => {
      console.error(`[clinic-bulk-export-cleanup] Unhandled error: ${err instanceof Error ? err.message : String(err)}`);
    });
  });

  console.log('[clinic-bulk-export-cleanup] Scheduled cleanup job cron="*/15 * * * *".');
}

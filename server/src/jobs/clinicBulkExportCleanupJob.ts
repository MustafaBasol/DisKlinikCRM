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

export function startClinicBulkExportCleanupJob(): void {
  if (!isClinicBulkExportCleanupEnabled()) {
    console.log('[clinic-bulk-export-cleanup] Cleanup job disabled (CLINIC_BULK_EXPORT_CLEANUP_ENABLED=false).');
    return;
  }

  cron.schedule('*/15 * * * *', () => {
    withJobLock('clinic-bulk-export-cleanup', 15 * 60 * 1000, async () => {
      const result = await cleanupExpiredClinicBulkExportArchives();
      const deletedAttempts = await cleanupStaleClinicBulkExportPasswordAttempts();
      if (result.expired > 0 || result.deleted > 0 || result.sweptAbandoned > 0 || deletedAttempts > 0) {
        console.log(
          `[clinic-bulk-export-cleanup] expired=${result.expired} deleted=${result.deleted} ` +
            `sweptAbandoned=${result.sweptAbandoned} deletedAttempts=${deletedAttempts}`,
        );
      }
    }).catch((err: unknown) => {
      console.error(`[clinic-bulk-export-cleanup] Unhandled error: ${err instanceof Error ? err.message : String(err)}`);
    });
  });

  console.log('[clinic-bulk-export-cleanup] Scheduled cleanup job cron="*/15 * * * *".');
}

/**
 * patientPrivacyExportCleanupJob.ts — Expired PatientPrivacyExportArchive
 * cleanup (docs/compliance/53-kvkk-attachment-imaging-lifecycle.md).
 *
 * Deletes export-package ZIP rows (and their physical files) once expiresAt
 * has passed, regardless of downloadedAt — these are short-lived transfer
 * artifacts, not audit records. The durable record of a download is the
 * AuditLog entry written by the download route. Mirrors
 * publicBookingNoticeEvidenceCleanupJob.ts exactly (dedicated job per
 * feature, node-cron + withJobLock, so this never touches
 * dataRetentionCleanupJob.ts's existing dependency-injected unit tests).
 */

import cron from 'node-cron';
import { cleanupExpiredExportArchives } from '../services/privacy/patientPrivacyExportPackage.js';
import { withJobLock } from '../utils/jobLock.js';

export function startPatientPrivacyExportCleanupJob(): void {
  cron.schedule('*/15 * * * *', () => {
    withJobLock('patient-privacy-export-cleanup', 15 * 60 * 1000, async () => {
      const deleted = await cleanupExpiredExportArchives();
      if (deleted > 0) {
        console.log(`[privacy-export-cleanup] deleted=${deleted}`);
      }
    }).catch((err: unknown) => {
      console.error(
        `[privacy-export-cleanup] Unhandled error: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  });

  console.log('[privacy-export-cleanup] Scheduled cleanup job cron="*/15 * * * *".');
}

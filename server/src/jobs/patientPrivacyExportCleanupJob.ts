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
 *
 * Env kill-switch: PATIENT_PRIVACY_EXPORT_CLEANUP_ENABLED (default: enabled,
 * i.e. `!== 'false'`). This is a DELIBERATELY SEPARATE toggle from
 * DATA_RETENTION_CLEANUP_ENABLED — export-archive cleanup is its own
 * dedicated job (one job per feature, per the convention established by
 * publicBookingNoticeEvidenceCleanupJob.ts), not a bypass of the general
 * retention runtime toggle. Unlike dataRetentionCleanupJob.ts, this job does
 * NOT also check a PlatformSetting runtime override — an env var is
 * considered sufficient for this low-risk, non-medical, short-TTL (1 hour)
 * cleanup. That is a deliberate scope decision for this PR, not an
 * oversight; a PlatformSetting override can be added later if operational
 * experience shows it's needed.
 */

import cron from 'node-cron';
import { cleanupExpiredExportArchives } from '../services/privacy/patientPrivacyExportPackage.js';
import { withJobLock } from '../utils/jobLock.js';

export function isPatientPrivacyExportCleanupEnabled(): boolean {
  return process.env.PATIENT_PRIVACY_EXPORT_CLEANUP_ENABLED !== 'false';
}

export function startPatientPrivacyExportCleanupJob(): void {
  if (!isPatientPrivacyExportCleanupEnabled()) {
    console.log('[privacy-export-cleanup] Cleanup job disabled (PATIENT_PRIVACY_EXPORT_CLEANUP_ENABLED=false).');
    return;
  }

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

/**
 * publicBookingNoticeEvidenceCleanupJob.ts — Orphaned public-booking notice
 * evidence cleanup (KVKK-CRIT-001a).
 *
 * Deletes PublicBookingNoticeEvidence rows that were never linked to a
 * booking request (visitor loaded the widget but never submitted) once
 * their TTL has passed. Rows already linked to an AppointmentRequest are
 * never touched — see cleanupExpiredNoticeEvidence in
 * services/publicBookingNoticeEvidence.ts.
 */

import cron from 'node-cron';
import { cleanupExpiredNoticeEvidence } from '../services/publicBookingNoticeEvidence.js';
import { withJobLock } from '../utils/jobLock.js';

export function startPublicBookingNoticeEvidenceCleanupJob(): void {
  cron.schedule('0 * * * *', () => {
    // Paylaşımlı kilit: birden fazla replika/worker aynı anda temizlik koşturmasın.
    withJobLock('public-booking-notice-evidence-cleanup', 30 * 60 * 1000, async () => {
      const deleted = await cleanupExpiredNoticeEvidence();
      if (deleted > 0) {
        console.log(`[notice-evidence-cleanup] deleted=${deleted}`);
      }
    }).catch((err: unknown) => {
      console.error(
        `[notice-evidence-cleanup] Unhandled error: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  });

  console.log('[notice-evidence-cleanup] Scheduled cleanup job cron="0 * * * *".');
}

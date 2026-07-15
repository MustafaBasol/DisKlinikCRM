/**
 * startBackgroundJobs.ts — Tüm cron job'ların tek noktadan başlatılması.
 *
 * Hem API süreci (varsayılan tek-süreç kurulum) hem de ayrı worker süreci
 * (src/worker.ts) aynı fonksiyonu kullanır; hangi sürecin job koşturacağı
 * RUN_BACKGROUND_JOBS ortam değişkeniyle seçilir (docs/45 Faz 3 #10).
 * Job'lar JobLock lease kilidi kullandığı için ikisi yanlışlıkla birlikte
 * açılsa bile aynı job iki kez koşmaz.
 */

import { startReminderJobs } from './reminders.js';
import { startMetaTemplateSyncJob } from './metaTemplateSyncJob.js';
import { startDataRetentionCleanupJob } from './dataRetentionCleanupJob.js';
import { startInboundEventRetryJob } from './inboundEventRetryJob.js';
import { startImagingBridgeOfflineJob } from './imagingBridgeOfflineJob.js';
import { startPublicBookingNoticeEvidenceCleanupJob } from './publicBookingNoticeEvidenceCleanupJob.js';

export function startBackgroundJobs(): void {
  startReminderJobs();
  startMetaTemplateSyncJob();
  startDataRetentionCleanupJob();
  startInboundEventRetryJob();
  startImagingBridgeOfflineJob();
  startPublicBookingNoticeEvidenceCleanupJob();
}

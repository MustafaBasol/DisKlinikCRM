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
import { startPatientPrivacyExportCleanupJob } from './patientPrivacyExportCleanupJob.js';
import { startClinicBulkExportWorker } from './clinicBulkExportWorker.js';
import { startClinicBulkExportCleanupJob } from './clinicBulkExportCleanupJob.js';
import { startFileBackupJob } from './fileBackupJob.js';
import { startRestoreRehearsalJob } from './restoreRehearsalJob.js';
import { startRecoveryStatusJob } from './recoveryStatusJob.js';
import { startExternalCalendarInboundRetryJob } from './externalCalendarInboundRetryJob.js';
import { startExternalCalendarOutboundSyncJob } from './externalCalendarOutboundSyncJob.js';
import { startOutboxDispatcherJob } from './outboxDispatcherJob.js';
import { registerOutboxConsumers } from '../outbox/startOutbox.js';

export function startBackgroundJobs(): void {
  startReminderJobs();
  startMetaTemplateSyncJob();
  startDataRetentionCleanupJob();
  startInboundEventRetryJob();
  startImagingBridgeOfflineJob();
  startPublicBookingNoticeEvidenceCleanupJob();
  startPatientPrivacyExportCleanupJob();
  startClinicBulkExportWorker();
  startClinicBulkExportCleanupJob();
  startFileBackupJob();
  startRestoreRehearsalJob();
  startRecoveryStatusJob();
  startExternalCalendarInboundRetryJob();
  startExternalCalendarOutboundSyncJob();

  // F5-2 — outbox. Registration is unconditional and inert (it schedules
  // nothing); startOutboxDispatcherJob() is a no-op unless
  // OUTBOX_DISPATCH_ENABLED is exactly 'true'. See outbox/outboxConfig.ts for
  // why the dispatcher and the producer have separate flags and why the
  // rollout order between them matters.
  registerOutboxConsumers();
  startOutboxDispatcherJob();
}

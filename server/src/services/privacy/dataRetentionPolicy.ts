/**
 * dataRetentionPolicy.ts — Data retention configuration for privacy/KVKK/GDPR readiness.
 *
 * Defines defaults and reads optional environment overrides.
 * Invalid values fall back to defaults; values below the minimum are also rejected.
 *
 * What is cleaned (see dataRetentionCleanupJob.ts for execution):
 *   - WhatsAppConversationMessage rows (raw inbound/outbound text)
 *   - WhatsAppConversationState rows (AI assistant session state, shared with Instagram)
 *   - MessagingInboundEvent rows (idempotency deduplication ledger)
 *   - OperationalEvent rows (integration failure / webhook error events)
 *   - ContactRequest PII fields (phone, name, note, lastMessage) — resolved/closed only
 *   - WhatsAppInboxEntry.lastMessageText / rawPayload — resolved entries only (row kept)
 *
 * What is NOT cleaned:
 *   - Patient, Appointment, Treatment, Payment, Insurance, Attachment records
 *   - AuditLog (immutable compliance trail — requires legal sign-off before deletion)
 *   - ActivityLog (FK-linked to appointments/patients — retain for clinic history)
 *   - Pending or in-progress ContactRequest rows
 *   - SentMessage records (outbound message log — may be needed for billing/audit)
 *   - PatientAttachment / ImagingStudy / ImagingImage physical files and rows —
 *     retained indefinitely by design pending the legal retention-period
 *     decisions tracked in docs/compliance/53-kvkk-attachment-imaging-lifecycle.md
 *     ("Remaining legal decisions"). Anonymization (patientAnonymization.ts)
 *     redacts their metadata but never deletes the underlying files.
 *   - PatientPrivacyExportArchive rows/files — these ARE cleaned, but by a
 *     separate dedicated job (patientPrivacyExportCleanupJob.ts, mirroring
 *     publicBookingNoticeEvidenceCleanupJob.ts) rather than this one, so that
 *     this job's existing dependency-injected unit tests are never touched
 *     by unrelated feature work.
 *
 * Environment variables:
 *   DATA_RETENTION_CLEANUP_ENABLED          true|false (default: true)
 *   DATA_RETENTION_CLEANUP_CRON             cron expression (default: 0 3 * * *)
 *   DATA_RETENTION_CONVERSATION_MESSAGES_DAYS  integer ≥ 30 (default: 365)
 *   DATA_RETENTION_CONVERSATION_STATE_DAYS     integer ≥ 30 (default: 90)
 *   DATA_RETENTION_OPERATIONAL_EVENTS_DAYS     integer ≥ 30 (default: 180)
 *   DATA_RETENTION_INBOUND_EVENT_DAYS          integer ≥ 30 (default: 90)
 *   DATA_RETENTION_RESOLVED_CONTACT_REQUEST_DAYS  integer ≥ 30 (default: 365)
 *   DATA_RETENTION_BATCH_SIZE               integer 1–1000 (default: 500)
 *   DATA_RETENTION_CONSENT_CONFLICT_BUCKETS_DAYS  integer ≥ 30 (default: 180) —
 *     CommunicationConsentConflictBucket rows (KVKK-HIGH-007 legacy/central
 *     conflict aggregates — already PII-free, but bounded like every other
 *     category so it doesn't grow unbounded either).
 */

export type DataRetentionConfig = {
  enabled: boolean;
  cronSchedule: string;
  conversationMessagesDays: number;
  conversationStateDays: number;
  operationalEventsDays: number;
  inboundEventDays: number;
  resolvedContactRequestDays: number;
  communicationConsentConflictBucketsDays: number;
  batchSize: number;
};

export const DATA_RETENTION_MIN_DAYS = 30;
export const DATA_RETENTION_MAX_BATCH_SIZE = 1000;

const DEFAULTS = {
  conversationMessagesDays: 365,
  conversationStateDays: 90,
  operationalEventsDays: 180,
  inboundEventDays: 90,
  resolvedContactRequestDays: 365,
  communicationConsentConflictBucketsDays: 180,
  batchSize: 500,
} as const;

function parseSafeDays(envVar: string, defaultDays: number): number {
  const raw = process.env[envVar];
  if (!raw) return defaultDays;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed) || parsed < DATA_RETENTION_MIN_DAYS) return defaultDays;
  return parsed;
}

function parseSafeBatchSize(): number {
  const raw = process.env['DATA_RETENTION_BATCH_SIZE'];
  if (!raw) return DEFAULTS.batchSize;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed) || parsed < 1) return DEFAULTS.batchSize;
  return Math.min(parsed, DATA_RETENTION_MAX_BATCH_SIZE);
}

export function loadDataRetentionConfig(): DataRetentionConfig {
  return {
    enabled: process.env.DATA_RETENTION_CLEANUP_ENABLED !== 'false',
    cronSchedule: process.env.DATA_RETENTION_CLEANUP_CRON ?? '0 3 * * *',
    conversationMessagesDays: parseSafeDays('DATA_RETENTION_CONVERSATION_MESSAGES_DAYS', DEFAULTS.conversationMessagesDays),
    conversationStateDays: parseSafeDays('DATA_RETENTION_CONVERSATION_STATE_DAYS', DEFAULTS.conversationStateDays),
    operationalEventsDays: parseSafeDays('DATA_RETENTION_OPERATIONAL_EVENTS_DAYS', DEFAULTS.operationalEventsDays),
    inboundEventDays: parseSafeDays('DATA_RETENTION_INBOUND_EVENT_DAYS', DEFAULTS.inboundEventDays),
    resolvedContactRequestDays: parseSafeDays('DATA_RETENTION_RESOLVED_CONTACT_REQUEST_DAYS', DEFAULTS.resolvedContactRequestDays),
    communicationConsentConflictBucketsDays: parseSafeDays('DATA_RETENTION_CONSENT_CONFLICT_BUCKETS_DAYS', DEFAULTS.communicationConsentConflictBucketsDays),
    batchSize: parseSafeBatchSize(),
  };
}

export { DEFAULTS as DATA_RETENTION_DEFAULTS };

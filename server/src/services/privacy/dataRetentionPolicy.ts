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
 *   - ExternalCalendarInboundEvent rows (DigiDentiS webhook idempotency
 *     ledger — rawPayload carries patient PII echoed back by the provider,
 *     e.g. appointment.created's nested patient{first_name,last_name,phone,
 *     email}; cleaned on the same DATA_RETENTION_INBOUND_EVENT_DAYS schedule
 *     as MessagingInboundEvent, its sibling idempotency ledger)
 *   - OperationalEvent rows (integration failure / webhook error events)
 *   - ContactRequest PII fields (phone, name, note, lastMessage) — resolved/closed only
 *   - WhatsAppInboxEntry.lastMessageText / rawPayload — resolved entries only (row kept)
 *   - MigrationPreservedSourceValue rows (F3-DATA-MIG-TODAY-001-R10 — raw
 *     legacy values preserved verbatim from a clinic's PREVIOUS system
 *     because they had no canonical destination: parents' names, extra phone
 *     numbers, free text. Import EVIDENCE, never current clinical truth, and
 *     nothing in the product may branch on them — so unlike Patient/
 *     Appointment/Payment records there is no operational reason to hold them
 *     forever, and "forever" is not a retention period KVKK recognises for
 *     raw PII. Deleted outright once past the window, on `importedAt`.)
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
 *   DATA_RETENTION_MIGRATION_PRESERVED_SOURCE_DAYS  integer ≥ 30 (default: 3650)
 *     MigrationPreservedSourceValue rows (F3-DATA-MIG-TODAY-001-R10).
 *
 *     WHY 10 YEARS, AND WHY NOT SHORTER. The purpose of a preserved value is
 *     to answer, later, "what did the old system actually hold for this
 *     patient?" — a question that arises exactly when a historical clinical,
 *     billing or consent record is disputed. In Turkey the general
 *     prescription period for contractual claims (Türk Borçlar Kanunu m.146)
 *     is 10 years, so a shorter window would routinely destroy the evidence
 *     while the claim it answers is still live. 10 years is therefore the
 *     shortest defensible default, not a generous one.
 *
 *     WHY NOT LONGER / INDEFINITE. These rows are raw legacy PII with no
 *     operational consumer; "keep forever" is the thing this category exists
 *     to prevent. A clinic with a genuine longer statutory duty raises the
 *     env var deliberately rather than inheriting an unbounded default.
 *
 *     NOT the patient-record retention period. Ministry-of-Health-style
 *     retention duties attach to the CLINICAL record (Patient, Appointment,
 *     medical history), which this job never touches — see "What is NOT
 *     cleaned" above. Migration evidence is not a clinical record.
 *
 *     Independent of anonymization: patientAnonymization.ts hard-deletes a
 *     patient's preserved values immediately on an anonymization request,
 *     regardless of this window. This category is the backstop for the rows
 *     nobody ever files a request about.
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
  /** F3-DATA-MIG-TODAY-001-R10 — MigrationPreservedSourceValue rows. */
  migrationPreservedSourceDays: number;
  batchSize: number;
};

export const DATA_RETENTION_MIN_DAYS = 30;
export const DATA_RETENTION_MAX_BATCH_SIZE = 1000;

/** PlatformSetting key for the runtime kill switch — checked by both the
 * scheduled cron (dataRetentionCleanupJob.ts) and the platform-admin manual
 * run endpoint (routes/platformAdmin.ts), so both paths agree on the same
 * on/off state. */
export const DATA_RETENTION_RUNTIME_SETTING_KEY = 'privacy.dataRetention.runtimeEnabled';

const DEFAULTS = {
  conversationMessagesDays: 365,
  conversationStateDays: 90,
  operationalEventsDays: 180,
  inboundEventDays: 90,
  resolvedContactRequestDays: 365,
  communicationConsentConflictBucketsDays: 180,
  // 10 years — see the DATA_RETENTION_MIGRATION_PRESERVED_SOURCE_DAYS block
  // in this file's header for the full reasoning.
  migrationPreservedSourceDays: 3650,
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
    migrationPreservedSourceDays: parseSafeDays('DATA_RETENTION_MIGRATION_PRESERVED_SOURCE_DAYS', DEFAULTS.migrationPreservedSourceDays),
    batchSize: parseSafeBatchSize(),
  };
}

export { DEFAULTS as DATA_RETENTION_DEFAULTS };

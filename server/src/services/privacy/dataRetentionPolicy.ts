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
 *   - OutboxEvent rows in a TERMINAL state only (F5-2R): `processed` past
 *     DATA_RETENTION_OUTBOX_PROCESSED_EVENT_DAYS, and `dead` past
 *     DATA_RETENTION_OUTBOX_DEAD_EVENT_DAYS. `pending` and `claimed` rows are
 *     UNDELIVERED OBLIGATIONS and are never eligible at any age.
 *   - OutboxConsumerExecution rows that are `completed` only, and only once no
 *     OutboxEvent still carries their idempotencyKey (F5-2R — see
 *     outbox/outboxRetention.ts for the invariant this protects).
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
 *   - OutboxEvent rows in `pending` or `claimed` (an undelivered obligation —
 *     deleting one loses a patient's confirmation with no trace), and
 *     OutboxConsumerExecution rows in `in_progress` or `ambiguous` (deleting
 *     one re-opens the duplicate-side-effect hole the ledger exists to close).
 *     Enforced structurally in outbox/outboxRetention.ts, not by convention.
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
 *   DATA_RETENTION_OUTBOX_PROCESSED_EVENT_DAYS  integer ≥ 30 (default: 180) —
 *     OutboxEvent rows whose status is `processed`, aged on `processedAt`
 *     (F5-2R). A processed event is a DISCHARGED obligation: the side effect
 *     happened and the consumer ledger recorded it. What remains is
 *     operational diagnostics — "did this confirmation actually go out, and
 *     when" — which is the same question OperationalEvent answers, so it
 *     inherits the same 180-day window rather than inventing a new one. The
 *     durable OUTBOUND record is `SentMessage`, which this job never touches,
 *     so 180 days destroys no delivery evidence.
 *
 *   DATA_RETENTION_OUTBOX_DEAD_EVENT_DAYS  integer ≥ 30 (default: 365) —
 *     OutboxEvent rows whose status is `dead`, aged on `deadLetteredAt`
 *     (F5-2R). LONGER than the processed window, deliberately: a dead row is
 *     the record of an obligation that was NOT discharged — a patient who may
 *     never have learned their appointment was approved — and it is also the
 *     only object a replay can be issued against (outbox/outboxReplay.ts).
 *     365 days matches the one-year family already used for
 *     WhatsAppConversationMessage and resolved ContactRequest rows, and
 *     comfortably exceeds any operational triage horizon.
 *
 *     NOT configurable below the minimum, and never zero: a dead-letter queue
 *     that empties itself is a dead-letter queue nobody can audit.
 *
 *   (no env var) outboxConsumerExecutionDays — DERIVED, not configured.
 *     max(outboxProcessedEventDays, outboxDeadEventDays). See
 *     deriveOutboxConsumerExecutionDays() below for why this one knob is
 *     deliberately withheld from operators.
 *
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
  /** F5-2R — OutboxEvent rows in `processed`, aged on `processedAt`. */
  outboxProcessedEventDays: number;
  /** F5-2R — OutboxEvent rows in `dead`, aged on `deadLetteredAt`. */
  outboxDeadEventDays: number;
  /**
   * F5-2R — OutboxConsumerExecution rows in `completed`, aged on `completedAt`.
   * DERIVED from the two windows above; there is no environment variable for it
   * on purpose (deriveOutboxConsumerExecutionDays).
   */
  outboxConsumerExecutionDays: number;
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
  // F5-2R. See the env-var block in this file's header for the reasoning
  // behind each number and for why the consumer-execution window is derived
  // rather than configured.
  outboxProcessedEventDays: 180,
  outboxDeadEventDays: 365,
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

/**
 * F5-2R — the consumer-execution retention window, DERIVED from the event
 * windows rather than configured independently.
 *
 * THE INVARIANT THIS EXISTS TO ENFORCE
 * ------------------------------------
 * `OutboxConsumerExecution` is the ONLY thing standing between a replay (or a
 * redelivery, or a second event asserting the same business fact) and a second
 * WhatsApp message to a patient. `outboxReplay.ts` refuses a replay with
 * `ALREADY_APPLIED` by reading that ledger row — not the event row, because an
 * event can be `dead` with the side effect already performed (that is exactly
 * what `AMBIGUOUS_SIDE_EFFECT` means).
 *
 * So there must be NO supported state in which an event still exists but its
 * business idempotency protection has already been deleted. If the ledger window
 * were shorter than the dead-event window, a dead event replayed on day 200
 * against a ledger pruned on day 180 would re-send a message the patient already
 * received — and nothing in the system would notice.
 *
 * WHY THIS IS NOT AN ENVIRONMENT VARIABLE
 * ---------------------------------------
 * Every other window in this file is a policy choice an operator may legitimately
 * tune. This one is not: a lower value is not a shorter retention period, it is a
 * silent duplicate-patient-message defect with a several-month fuse. Deriving it
 * makes the wrong value unrepresentable rather than merely discouraged.
 *
 * `outboxRetention.ts` additionally guards each individual deletion on "no
 * OutboxEvent still carries this idempotencyKey", so the invariant survives even
 * a hand-edited database or a category that errored out mid-sweep. This
 * derivation is the policy layer of that same rule, not a substitute for it.
 */
export function deriveOutboxConsumerExecutionDays(
  outboxProcessedEventDays: number,
  outboxDeadEventDays: number,
): number {
  return Math.max(outboxProcessedEventDays, outboxDeadEventDays);
}

export function loadDataRetentionConfig(): DataRetentionConfig {
  const outboxProcessedEventDays = parseSafeDays(
    'DATA_RETENTION_OUTBOX_PROCESSED_EVENT_DAYS',
    DEFAULTS.outboxProcessedEventDays,
  );
  const outboxDeadEventDays = parseSafeDays(
    'DATA_RETENTION_OUTBOX_DEAD_EVENT_DAYS',
    DEFAULTS.outboxDeadEventDays,
  );

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
    outboxProcessedEventDays,
    outboxDeadEventDays,
    outboxConsumerExecutionDays: deriveOutboxConsumerExecutionDays(
      outboxProcessedEventDays,
      outboxDeadEventDays,
    ),
    batchSize: parseSafeBatchSize(),
  };
}

export { DEFAULTS as DATA_RETENTION_DEFAULTS };

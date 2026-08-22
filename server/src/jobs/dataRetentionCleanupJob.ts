/**
 * dataRetentionCleanupJob.ts — Scheduled data retention cleanup for privacy/KVKK/GDPR.
 *
 * Runs on a configurable cron schedule (default: daily at 03:00).
 * Processes each cleanup category in batches and continues if one fails.
 *
 * Safety rules:
 *   - Never deletes Patient, Appointment, Treatment, Payment, Insurance, Attachment rows.
 *   - Never deletes AuditLog rows (immutable compliance trail).
 *   - Never deletes ActivityLog rows (FK-linked operational history).
 *   - Never deletes pending or in-progress ContactRequest rows.
 *   - Never deletes pending or claimed OutboxEvent rows (undelivered
 *     obligations), nor in_progress/ambiguous OutboxConsumerExecution rows
 *     (the duplicate-side-effect protection) - see outbox/outboxRetention.ts.
 *   - Prefers anonymization over deletion for ContactRequest PII.
 *   - Never logs raw phone numbers, names, message text, or tokens.
 *   - Idempotent — safe to run multiple times.
 *
 * Run with: startDataRetentionCleanupJob()
 * Test with: runDataRetentionCleanup({ dryRun: true })
 */

import cron from 'node-cron';
import { Prisma } from '@prisma/client';
import prisma from '../db.js';
import {
  loadDataRetentionConfig,
  DATA_RETENTION_RUNTIME_SETTING_KEY,
  type DataRetentionConfig,
} from '../services/privacy/dataRetentionPolicy.js';
import { getPlatformSetting } from '../services/platformSettings.js';
import { withJobLock } from '../utils/jobLock.js';
import { safeErrorFields } from '../utils/safeError.js';
import {
  countEligibleProcessedOutboxEvents,
  deleteProcessedOutboxEventBatch,
  countEligibleDeadOutboxEvents,
  deleteDeadOutboxEventBatch,
  countEligibleCompletedConsumerExecutions,
  deleteCompletedConsumerExecutionBatch,
} from '../outbox/outboxRetention.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type DataRetentionSummary = {
  deletedConversationMessages: number;
  deletedConversationStates: number;
  deletedOperationalEvents: number;
  deletedInboundEvents: number;
  deletedExternalCalendarInboundEvents: number;
  anonymizedContactRequests: number;
  redactedInboxEntries: number;
  deletedCommunicationConsentConflictBuckets: number;
  deletedMigrationPreservedSourceValues: number;
  /** F5-2R — OutboxEvent rows in `processed`. Never `pending` or `claimed`. */
  deletedOutboxProcessedEvents: number;
  /** F5-2R — OutboxEvent rows in `dead`, past the longer dead-letter window. */
  deletedOutboxDeadEvents: number;
  /** F5-2R — OutboxConsumerExecution rows in `completed` with no event left holding their key. */
  deletedOutboxConsumerExecutions: number;
  skippedCategories: string[];
  errors: string[];
  dryRun: boolean;
};

/**
 * Injectable per-category deps.
 * countEligible: returns row count without side effects (used for dry-run).
 * executeCleanupBatch: deletes or anonymizes one batch, returns affected row count.
 */
export type DataRetentionCategoryDeps = {
  countEligible: (threshold: Date) => Promise<number>;
  executeCleanupBatch: (threshold: Date, batchSize: number) => Promise<number>;
};

export type DataRetentionDeps = {
  conversationMessages: DataRetentionCategoryDeps;
  conversationStates: DataRetentionCategoryDeps;
  operationalEvents: DataRetentionCategoryDeps;
  inboundEvents: DataRetentionCategoryDeps;
  externalCalendarInboundEvents: DataRetentionCategoryDeps;
  contactRequests: DataRetentionCategoryDeps;
  inboxEntries: DataRetentionCategoryDeps;
  communicationConsentConflictBuckets: DataRetentionCategoryDeps;
  migrationPreservedSourceValues: DataRetentionCategoryDeps;
  outboxProcessedEvents: DataRetentionCategoryDeps;
  outboxDeadEvents: DataRetentionCategoryDeps;
  outboxConsumerExecutions: DataRetentionCategoryDeps;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

const CONTACT_REQUEST_TERMINAL_STATUSES = ['resolved', 'closed'];

// ── Production Prisma deps ────────────────────────────────────────────────────

function makeConversationMessagesDeps(): DataRetentionCategoryDeps {
  return {
    countEligible: (threshold) =>
      prisma.whatsAppConversationMessage.count({ where: { createdAt: { lt: threshold } } }),
    executeCleanupBatch: async (threshold, batchSize) => {
      const rows = await prisma.whatsAppConversationMessage.findMany({
        where: { createdAt: { lt: threshold } },
        select: { id: true },
        take: batchSize,
      });
      if (rows.length === 0) return 0;
      const { count } = await prisma.whatsAppConversationMessage.deleteMany({
        where: { id: { in: rows.map(r => r.id) } },
      });
      return count;
    },
  };
}

function makeConversationStatesDeps(): DataRetentionCategoryDeps {
  return {
    countEligible: (threshold) =>
      prisma.whatsAppConversationState.count({ where: { updatedAt: { lt: threshold } } }),
    executeCleanupBatch: async (threshold, batchSize) => {
      const rows = await prisma.whatsAppConversationState.findMany({
        where: { updatedAt: { lt: threshold } },
        select: { id: true },
        take: batchSize,
      });
      if (rows.length === 0) return 0;
      const { count } = await prisma.whatsAppConversationState.deleteMany({
        where: { id: { in: rows.map(r => r.id) } },
      });
      return count;
    },
  };
}

function makeOperationalEventsDeps(): DataRetentionCategoryDeps {
  return {
    countEligible: (threshold) =>
      prisma.operationalEvent.count({ where: { createdAt: { lt: threshold } } }),
    executeCleanupBatch: async (threshold, batchSize) => {
      const rows = await prisma.operationalEvent.findMany({
        where: { createdAt: { lt: threshold } },
        select: { id: true },
        take: batchSize,
      });
      if (rows.length === 0) return 0;
      const { count } = await prisma.operationalEvent.deleteMany({
        where: { id: { in: rows.map(r => r.id) } },
      });
      return count;
    },
  };
}

function makeInboundEventsDeps(): DataRetentionCategoryDeps {
  return {
    countEligible: (threshold) =>
      prisma.messagingInboundEvent.count({ where: { createdAt: { lt: threshold } } }),
    executeCleanupBatch: async (threshold, batchSize) => {
      const rows = await prisma.messagingInboundEvent.findMany({
        where: { createdAt: { lt: threshold } },
        select: { id: true },
        take: batchSize,
      });
      if (rows.length === 0) return 0;
      const { count } = await prisma.messagingInboundEvent.deleteMany({
        where: { id: { in: rows.map(r => r.id) } },
      });
      return count;
    },
  };
}

/** ExternalCalendarInboundEvent — DigiDentiS webhook idempotency ledger,
 *  sibling to MessagingInboundEvent above. rawPayload carries patient PII
 *  the provider echoes back (appointment.created's nested patient
 *  first/last name, phone, email) — cleaned on the same
 *  DATA_RETENTION_INBOUND_EVENT_DAYS schedule. */
function makeExternalCalendarInboundEventsDeps(): DataRetentionCategoryDeps {
  return {
    countEligible: (threshold) =>
      prisma.externalCalendarInboundEvent.count({ where: { createdAt: { lt: threshold } } }),
    executeCleanupBatch: async (threshold, batchSize) => {
      const rows = await prisma.externalCalendarInboundEvent.findMany({
        where: { createdAt: { lt: threshold } },
        select: { id: true },
        take: batchSize,
      });
      if (rows.length === 0) return 0;
      const { count } = await prisma.externalCalendarInboundEvent.deleteMany({
        where: { id: { in: rows.map(r => r.id) } },
      });
      return count;
    },
  };
}

function contactRequestPiiFilter() {
  return {
    OR: [
      { phone: { not: null } },
      { name: { not: null } },
      { note: { not: null } },
      { lastMessage: { not: null } },
      { externalSenderId: { not: null } },
    ],
  };
}

function makeContactRequestsDeps(): DataRetentionCategoryDeps {
  return {
    countEligible: (threshold) =>
      prisma.contactRequest.count({
        where: {
          status: { in: CONTACT_REQUEST_TERMINAL_STATUSES },
          updatedAt: { lt: threshold },
          ...contactRequestPiiFilter(),
        },
      }),
    executeCleanupBatch: async (threshold, batchSize) => {
      const rows = await prisma.contactRequest.findMany({
        where: {
          status: { in: CONTACT_REQUEST_TERMINAL_STATUSES },
          updatedAt: { lt: threshold },
          ...contactRequestPiiFilter(),
        },
        select: { id: true },
        take: batchSize,
      });
      if (rows.length === 0) return 0;
      const { count } = await prisma.contactRequest.updateMany({
        where: { id: { in: rows.map(r => r.id) } },
        data: {
          phone: null,
          name: null,
          note: null,
          lastMessage: null,
          externalSenderId: null,
        },
      });
      return count;
    },
  };
}

function makeCommunicationConsentConflictBucketsDeps(): DataRetentionCategoryDeps {
  return {
    countEligible: (threshold) =>
      prisma.communicationConsentConflictBucket.count({ where: { bucketStartedAt: { lt: threshold } } }),
    executeCleanupBatch: async (threshold, batchSize) => {
      const rows = await prisma.communicationConsentConflictBucket.findMany({
        where: { bucketStartedAt: { lt: threshold } },
        select: { id: true },
        take: batchSize,
      });
      if (rows.length === 0) return 0;
      const { count } = await prisma.communicationConsentConflictBucket.deleteMany({
        where: { id: { in: rows.map(r => r.id) } },
      });
      return count;
    },
  };
}

/** MigrationPreservedSourceValue — F3-DATA-MIG-TODAY-001-R10.
 *
 *  Raw legacy values preserved verbatim from a clinic's previous system
 *  because they had no canonical destination (parents' names, extra phone
 *  numbers, free text). Import EVIDENCE, never current clinical truth: no
 *  clinical, messaging, billing or matching code path reads them, so there is
 *  nothing operational to keep and the rows are DELETED, not redacted —
 *  redaction would leave provenance pointing at nothing.
 *
 *  Aged on `importedAt` (the row is immutable after the migration run wrote
 *  it, so there is no meaningful `updatedAt`). Window is
 *  DATA_RETENTION_MIGRATION_PRESERVED_SOURCE_DAYS, default 10 years — see the
 *  reasoning block in dataRetentionPolicy.ts.
 *
 *  Deliberately NOT filtered by `sensitivity`: RESTRICTED rows are the ones
 *  it matters most to age out, and a filter here would keep exactly the wrong
 *  half forever. */
function makeMigrationPreservedSourceValuesDeps(): DataRetentionCategoryDeps {
  return {
    countEligible: (threshold) =>
      prisma.migrationPreservedSourceValue.count({ where: { importedAt: { lt: threshold } } }),
    executeCleanupBatch: async (threshold, batchSize) => {
      const rows = await prisma.migrationPreservedSourceValue.findMany({
        where: { importedAt: { lt: threshold } },
        select: { id: true },
        take: batchSize,
      });
      if (rows.length === 0) return 0;
      const { count } = await prisma.migrationPreservedSourceValue.deleteMany({
        where: { id: { in: rows.map(r => r.id) } },
      });
      return count;
    },
  };
}

/** F5-2R — outbox lifecycle categories.
 *
 *  Which rows are eligible is decided by outbox/outboxRetention.ts, next to the
 *  dispatcher, lease and replay code whose semantics define it. This job keeps
 *  what it already owns: batching, dry-run, the two kill switches and the shared
 *  job lock. That split is deliberate — a future change to replay must be made
 *  in sight of the retention rule it would break, not three directories away.
 *
 *  THREE CATEGORIES, NOT ONE, because `processed` and `dead` events have
 *  genuinely different windows (a discharged obligation vs. a lost one that is
 *  still replayable) and the runner takes exactly one threshold per category. */
function makeOutboxProcessedEventsDeps(): DataRetentionCategoryDeps {
  return {
    countEligible: (threshold) => countEligibleProcessedOutboxEvents(threshold),
    executeCleanupBatch: (threshold, batchSize) =>
      deleteProcessedOutboxEventBatch(threshold, batchSize),
  };
}

function makeOutboxDeadEventsDeps(): DataRetentionCategoryDeps {
  return {
    countEligible: (threshold) => countEligibleDeadOutboxEvents(threshold),
    executeCleanupBatch: (threshold, batchSize) =>
      deleteDeadOutboxEventBatch(threshold, batchSize),
  };
}

function makeOutboxConsumerExecutionsDeps(): DataRetentionCategoryDeps {
  return {
    countEligible: (threshold) => countEligibleCompletedConsumerExecutions(threshold),
    executeCleanupBatch: (threshold, batchSize) =>
      deleteCompletedConsumerExecutionBatch(threshold, batchSize),
  };
}

function makeInboxEntriesDeps(): DataRetentionCategoryDeps {
  return {
    countEligible: (threshold) =>
      prisma.whatsAppInboxEntry.count({
        where: {
          status: 'resolved',
          updatedAt: { lt: threshold },
          lastMessageText: { not: null },
        },
      }),
    executeCleanupBatch: async (threshold, batchSize) => {
      const rows = await prisma.whatsAppInboxEntry.findMany({
        where: {
          status: 'resolved',
          updatedAt: { lt: threshold },
          lastMessageText: { not: null },
        },
        select: { id: true },
        take: batchSize,
      });
      if (rows.length === 0) return 0;
      const { count } = await prisma.whatsAppInboxEntry.updateMany({
        where: { id: { in: rows.map(r => r.id) } },
        data: {
          lastMessageText: null,
          rawPayload: Prisma.DbNull,
        },
      });
      return count;
    },
  };
}

function defaultDeps(): DataRetentionDeps {
  return {
    conversationMessages: makeConversationMessagesDeps(),
    conversationStates: makeConversationStatesDeps(),
    operationalEvents: makeOperationalEventsDeps(),
    inboundEvents: makeInboundEventsDeps(),
    externalCalendarInboundEvents: makeExternalCalendarInboundEventsDeps(),
    contactRequests: makeContactRequestsDeps(),
    inboxEntries: makeInboxEntriesDeps(),
    communicationConsentConflictBuckets: makeCommunicationConsentConflictBucketsDeps(),
    migrationPreservedSourceValues: makeMigrationPreservedSourceValuesDeps(),
    outboxProcessedEvents: makeOutboxProcessedEventsDeps(),
    outboxDeadEvents: makeOutboxDeadEventsDeps(),
    outboxConsumerExecutions: makeOutboxConsumerExecutionsDeps(),
  };
}

// ── Core runner ───────────────────────────────────────────────────────────────

async function runCategory(
  label: string,
  threshold: Date,
  config: DataRetentionConfig,
  deps: DataRetentionCategoryDeps,
  dryRun: boolean,
  summary: DataRetentionSummary,
): Promise<number> {
  try {
    if (dryRun) {
      return await deps.countEligible(threshold);
    }
    return await deps.executeCleanupBatch(threshold, config.batchSize);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    summary.errors.push(`${label}: ${msg}`);
    summary.skippedCategories.push(label);
    console.error(`[data-retention] category=${label}`, safeErrorFields(err));
    return 0;
  }
}

export async function runDataRetentionCleanup(
  options?: { dryRun?: boolean; config?: DataRetentionConfig },
  deps?: Partial<DataRetentionDeps>,
): Promise<DataRetentionSummary> {
  const dryRun = options?.dryRun ?? false;
  const config = options?.config ?? loadDataRetentionConfig();
  const resolved = { ...defaultDeps(), ...deps };

  const summary: DataRetentionSummary = {
    deletedConversationMessages: 0,
    deletedConversationStates: 0,
    deletedOperationalEvents: 0,
    deletedInboundEvents: 0,
    deletedExternalCalendarInboundEvents: 0,
    anonymizedContactRequests: 0,
    redactedInboxEntries: 0,
    deletedCommunicationConsentConflictBuckets: 0,
    deletedMigrationPreservedSourceValues: 0,
    deletedOutboxProcessedEvents: 0,
    deletedOutboxDeadEvents: 0,
    deletedOutboxConsumerExecutions: 0,
    skippedCategories: [],
    errors: [],
    dryRun,
  };

  console.log(`[data-retention] Starting cleanup dryRun=${dryRun} batchSize=${config.batchSize}`);

  summary.deletedConversationMessages = await runCategory(
    'conversationMessages',
    daysAgo(config.conversationMessagesDays),
    config,
    resolved.conversationMessages,
    dryRun,
    summary,
  );

  summary.deletedConversationStates = await runCategory(
    'conversationStates',
    daysAgo(config.conversationStateDays),
    config,
    resolved.conversationStates,
    dryRun,
    summary,
  );

  summary.deletedOperationalEvents = await runCategory(
    'operationalEvents',
    daysAgo(config.operationalEventsDays),
    config,
    resolved.operationalEvents,
    dryRun,
    summary,
  );

  summary.deletedInboundEvents = await runCategory(
    'inboundEvents',
    daysAgo(config.inboundEventDays),
    config,
    resolved.inboundEvents,
    dryRun,
    summary,
  );

  summary.deletedExternalCalendarInboundEvents = await runCategory(
    'externalCalendarInboundEvents',
    daysAgo(config.inboundEventDays),
    config,
    resolved.externalCalendarInboundEvents,
    dryRun,
    summary,
  );

  summary.anonymizedContactRequests = await runCategory(
    'contactRequests',
    daysAgo(config.resolvedContactRequestDays),
    config,
    resolved.contactRequests,
    dryRun,
    summary,
  );

  summary.redactedInboxEntries = await runCategory(
    'inboxEntries',
    daysAgo(config.conversationMessagesDays),
    config,
    resolved.inboxEntries,
    dryRun,
    summary,
  );

  summary.deletedCommunicationConsentConflictBuckets = await runCategory(
    'communicationConsentConflictBuckets',
    daysAgo(config.communicationConsentConflictBucketsDays),
    config,
    resolved.communicationConsentConflictBuckets,
    dryRun,
    summary,
  );

  summary.deletedMigrationPreservedSourceValues = await runCategory(
    'migrationPreservedSourceValues',
    daysAgo(config.migrationPreservedSourceDays),
    config,
    resolved.migrationPreservedSourceValues,
    dryRun,
    summary,
  );

  // ── F5-2R: outbox lifecycle ─────────────────────────────────────────────────
  //
  // THE ORDER OF THESE THREE IS PART OF THE SAFETY ARGUMENT, not cosmetic.
  //
  // Events are swept BEFORE the consumer-execution ledger, so that within a
  // single run every event that is going to disappear has already disappeared
  // by the time the ledger category asks "is any event still holding this
  // key?". Reversing them would not corrupt anything — the per-batch guard in
  // outboxRetention.ts refuses on the same condition either way — but it would
  // make the ledger lag a full day behind for no reason.
  //
  // Processed before dead is likewise deliberate: processed rows are the bulk
  // of the table and the cheapest to remove, so a batch-limited run spends its
  // budget on them first and leaves the small, guarded dead-letter set for a
  // run with headroom.
  summary.deletedOutboxProcessedEvents = await runCategory(
    'outboxProcessedEvents',
    daysAgo(config.outboxProcessedEventDays),
    config,
    resolved.outboxProcessedEvents,
    dryRun,
    summary,
  );

  summary.deletedOutboxDeadEvents = await runCategory(
    'outboxDeadEvents',
    daysAgo(config.outboxDeadEventDays),
    config,
    resolved.outboxDeadEvents,
    dryRun,
    summary,
  );

  summary.deletedOutboxConsumerExecutions = await runCategory(
    'outboxConsumerExecutions',
    daysAgo(config.outboxConsumerExecutionDays),
    config,
    resolved.outboxConsumerExecutions,
    dryRun,
    summary,
  );

  console.log(
    `[data-retention] Complete dryRun=${dryRun}` +
    ` messages=${summary.deletedConversationMessages}` +
    ` states=${summary.deletedConversationStates}` +
    ` operationalEvents=${summary.deletedOperationalEvents}` +
    ` inboundEvents=${summary.deletedInboundEvents}` +
    ` externalCalendarInboundEvents=${summary.deletedExternalCalendarInboundEvents}` +
    ` contactRequests=${summary.anonymizedContactRequests}` +
    ` inboxEntries=${summary.redactedInboxEntries}` +
    ` consentConflictBuckets=${summary.deletedCommunicationConsentConflictBuckets}` +
    ` migrationPreservedSourceValues=${summary.deletedMigrationPreservedSourceValues}` +
    // Counts only. An idempotencyKey is a contract-derived identifier and a
    // payload is never read by this job at all, so there is nothing here that
    // could carry patient content into a log line.
    ` outboxProcessedEvents=${summary.deletedOutboxProcessedEvents}` +
    ` outboxDeadEvents=${summary.deletedOutboxDeadEvents}` +
    ` outboxConsumerExecutions=${summary.deletedOutboxConsumerExecutions}` +
    (summary.errors.length ? ` errors=${summary.errors.length}` : ''),
  );

  return summary;
}

// ── Cron scheduler ────────────────────────────────────────────────────────────

export type DataRetentionJobOverrides = {
  getRuntimeEnabled?: () => Promise<boolean>;
};

// Shared lease-lock identity for live cleanup execution — used by BOTH the
// scheduled cron below and the platform-admin manual run route
// (routes/platformAdmin.ts), so a manual live run and a scheduled tick (or
// two concurrent manual runs) can never execute their delete/anonymize
// batches against the same tables at the same time. Lease 2 hours — large
// cleanups can run long; a shorter lease risks a second runner starting
// mid-batch.
export const DATA_RETENTION_JOB_LOCK_NAME = 'data-retention-cleanup';
export const DATA_RETENTION_JOB_LOCK_TTL_MS = 2 * 60 * 60 * 1000;

export function startDataRetentionCleanupJob(overrides?: DataRetentionJobOverrides): void {
  const config = loadDataRetentionConfig();

  if (!config.enabled) {
    console.log('[data-retention] Cleanup job disabled (DATA_RETENTION_CLEANUP_ENABLED=false).');
    return;
  }

  const getRuntimeEnabled = overrides?.getRuntimeEnabled ?? (async () => {
    const val = await getPlatformSetting(DATA_RETENTION_RUNTIME_SETTING_KEY);
    return val === 'true';
  });

  cron.schedule(config.cronSchedule, async () => {
    try {
      const runtimeEnabled = await getRuntimeEnabled();
      if (!runtimeEnabled) {
        console.log('[data-retention] Skipping scheduled cleanup: runtime toggle is disabled.');
        return;
      }
      // Paylaşımlı kilit: birden fazla replika/worker temizliği aynı anda
      // koşturmasın (docs/45 Faz 3 #9-10), ve platform-admin panelinden
      // tetiklenen manuel bir live run ile de çakışmasın (aynı kilit adı
      // routes/platformAdmin.ts tarafından da kullanılıyor).
      await withJobLock(DATA_RETENTION_JOB_LOCK_NAME, DATA_RETENTION_JOB_LOCK_TTL_MS, async () => {
        await runDataRetentionCleanup({ config });
      });
    } catch (err: unknown) {
      console.error('[data-retention] Unhandled error in cleanup job:', safeErrorFields(err));
    }
  });

  console.log(`[data-retention] Scheduled cleanup job cron="${config.cronSchedule}".`);
}

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
  type DataRetentionConfig,
} from '../services/privacy/dataRetentionPolicy.js';
import { getPlatformSetting } from '../services/platformSettings.js';
import { withJobLock } from '../utils/jobLock.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type DataRetentionSummary = {
  deletedConversationMessages: number;
  deletedConversationStates: number;
  deletedOperationalEvents: number;
  deletedInboundEvents: number;
  anonymizedContactRequests: number;
  redactedInboxEntries: number;
  deletedCommunicationConsentConflictBuckets: number;
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
  contactRequests: DataRetentionCategoryDeps;
  inboxEntries: DataRetentionCategoryDeps;
  communicationConsentConflictBuckets: DataRetentionCategoryDeps;
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
    contactRequests: makeContactRequestsDeps(),
    inboxEntries: makeInboxEntriesDeps(),
    communicationConsentConflictBuckets: makeCommunicationConsentConflictBucketsDeps(),
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
    console.error(`[data-retention] category=${label} error=${msg}`);
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
    anonymizedContactRequests: 0,
    redactedInboxEntries: 0,
    deletedCommunicationConsentConflictBuckets: 0,
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

  console.log(
    `[data-retention] Complete dryRun=${dryRun}` +
    ` messages=${summary.deletedConversationMessages}` +
    ` states=${summary.deletedConversationStates}` +
    ` operationalEvents=${summary.deletedOperationalEvents}` +
    ` inboundEvents=${summary.deletedInboundEvents}` +
    ` contactRequests=${summary.anonymizedContactRequests}` +
    ` inboxEntries=${summary.redactedInboxEntries}` +
    ` consentConflictBuckets=${summary.deletedCommunicationConsentConflictBuckets}` +
    (summary.errors.length ? ` errors=${summary.errors.length}` : ''),
  );

  return summary;
}

// ── Cron scheduler ────────────────────────────────────────────────────────────

export type DataRetentionJobOverrides = {
  getRuntimeEnabled?: () => Promise<boolean>;
};

export function startDataRetentionCleanupJob(overrides?: DataRetentionJobOverrides): void {
  const config = loadDataRetentionConfig();

  if (!config.enabled) {
    console.log('[data-retention] Cleanup job disabled (DATA_RETENTION_CLEANUP_ENABLED=false).');
    return;
  }

  const getRuntimeEnabled = overrides?.getRuntimeEnabled ?? (async () => {
    const val = await getPlatformSetting('privacy.dataRetention.runtimeEnabled');
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
      // koşturmasın (docs/45 Faz 3 #9-10). Lease 2 saat — büyük temizlikler
      // uzun sürebilir.
      await withJobLock('data-retention-cleanup', 2 * 60 * 60 * 1000, async () => {
        await runDataRetentionCleanup({ config });
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[data-retention] Unhandled error in cleanup job: ${msg}`);
    }
  });

  console.log(`[data-retention] Scheduled cleanup job cron="${config.cronSchedule}".`);
}

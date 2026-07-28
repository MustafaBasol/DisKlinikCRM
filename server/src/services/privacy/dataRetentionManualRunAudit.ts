/**
 * dataRetentionManualRunAudit.ts — RETENTION-MANUAL-RUN-AUDIT-001
 *
 * Durable, two-phase audit trail for POST /api/platform/privacy/data-retention/run
 * (routes/platformAdmin.ts). A destructive *live* retention run (dryRun=false,
 * cleanup actually enabled) must never begin deleting/anonymizing rows without
 * a durable trace already having been written — otherwise a crash between
 * "decided to run" and "wrote the outcome" would leave a destructive run with
 * zero evidence.
 *
 * Model (all rows are PlatformAdminAuditEvent — action/outcome are free-form
 * strings and safeMetadata is JSON, so no schema migration is required):
 *
 *   1. STARTED  — action="data_retention.manual_run_started", outcome="started",
 *      safeMetadata.runId=<uuid>. Written in its own committed transaction
 *      BEFORE the job lock is attempted and before any delete/anonymize call.
 *      If this write itself fails, the caller (platformAdmin.ts) must not
 *      execute cleanup at all — see recordManualRunStarted() below.
 *
 *   2. TERMINAL — exactly one of:
 *        action="data_retention.manual_run_completed"       outcome="success"
 *        action="data_retention.manual_run_partial_failure"  outcome="partial_failure"
 *        action="data_retention.manual_run_failed"           outcome="error"
 *        action="data_retention.manual_run_blocked"          outcome="blocked"
 *      sharing the same safeMetadata.runId as its STARTED row. Written in a
 *      separate transaction after the attempt concludes. Because STARTED was
 *      already committed in its own transaction, a failure while writing the
 *      TERMINAL row can never roll back or otherwise corrupt the STARTED row
 *      — the two are independent, immutable inserts. Neither row is ever
 *      updated or deleted by this module.
 *
 * Two attempt shapes never get a STARTED precursor — a single TERMINAL event
 * (still carrying its own runId, for consistent tooling/reconciliation) is
 * correct and sufficient for both, because neither ever reaches a lock
 * acquisition or a mutation, so there is no crash window to protect against:
 *   - Dry runs (dryRun=true) — read-only counts only, never contends for the
 *     live-execution job lock, never deletes/anonymizes anything.
 *   - The policy-gate rejection (env kill switch or runtime toggle disabled)
 *     — rejected synchronously before any lock attempt; nothing was ever
 *     going to run.
 *   Both cases call recordManualRunTerminalOnly() directly.
 *
 * Reconciliation: an incomplete run — a STARTED row with no matching TERMINAL
 * row sharing its runId — indicates the process died mid-run (between the
 * pre-run audit write and the outcome write, most likely while the live
 * cleanup batches themselves were executing). There is no dedicated
 * scheduled job wired up to page on this yet; findIncompleteManualRuns()
 * below is the documented detection query an operator (or a future
 * reconciliation job/alert) runs to surface it.
 *
 * PII discipline: every field ever written here is one of — a config value,
 * a boolean, a fixed category/error-code label, a numeric row count, a
 * random correlation UUID, or a platform-admin actor id (the platform admin
 * who clicked "run", not a patient/clinic identifier). Never a patient id,
 * clinic id, name, phone, email, or raw row content. This job is
 * platform-scoped (spans all tenants), so a clinicId/organizationId/patientId
 * key must never appear in safeMetadata — see the tests in
 * retentionManualRunAudit.test.ts asserting exactly this.
 */

import { randomUUID } from 'node:crypto';
import prisma from '../../db.js';
import { writePlatformAdminAuditEventInTx } from '../platformAdminAudit.js';
import type { DataRetentionConfig } from './dataRetentionPolicy.js';

export const DATA_RETENTION_MANUAL_RUN_STARTED_ACTION = 'data_retention.manual_run_started';
export const DATA_RETENTION_MANUAL_RUN_COMPLETED_ACTION = 'data_retention.manual_run_completed';
export const DATA_RETENTION_MANUAL_RUN_PARTIAL_FAILURE_ACTION = 'data_retention.manual_run_partial_failure';
export const DATA_RETENTION_MANUAL_RUN_FAILED_ACTION = 'data_retention.manual_run_failed';
export const DATA_RETENTION_MANUAL_RUN_BLOCKED_ACTION = 'data_retention.manual_run_blocked';

const DATA_RETENTION_MANUAL_RUN_RESOURCE_TYPE = 'data_retention';
const DATA_RETENTION_MANUAL_RUN_RESOURCE_KEY = 'manual_run';

export type DataRetentionManualRunTerminalOutcome = 'success' | 'partial_failure' | 'blocked' | 'error';

const TERMINAL_ACTION_BY_OUTCOME: Record<DataRetentionManualRunTerminalOutcome, string> = {
  success: DATA_RETENTION_MANUAL_RUN_COMPLETED_ACTION,
  partial_failure: DATA_RETENTION_MANUAL_RUN_PARTIAL_FAILURE_ACTION,
  error: DATA_RETENTION_MANUAL_RUN_FAILED_ACTION,
  blocked: DATA_RETENTION_MANUAL_RUN_BLOCKED_ACTION,
};

/** Every action this audit trail can ever emit — used by findIncompleteManualRuns(). */
export const DATA_RETENTION_MANUAL_RUN_ALL_ACTIONS = [
  DATA_RETENTION_MANUAL_RUN_STARTED_ACTION,
  ...Object.values(TERMINAL_ACTION_BY_OUTCOME),
];

export type CleanupEnabledSource = 'env_disabled' | 'runtime_disabled' | 'enabled';

type EffectiveConfigMetadata = {
  envCleanupEnabled: boolean;
  cronSchedule: string;
  conversationMessagesDays: number;
  conversationStateDays: number;
  operationalEventsDays: number;
  inboundEventDays: number;
  resolvedContactRequestDays: number;
  communicationConsentConflictBucketsDays: number;
  batchSize: number;
};

function buildEffectiveConfigMetadata(config: DataRetentionConfig): EffectiveConfigMetadata {
  return {
    envCleanupEnabled: config.enabled,
    cronSchedule: config.cronSchedule,
    conversationMessagesDays: config.conversationMessagesDays,
    conversationStateDays: config.conversationStateDays,
    operationalEventsDays: config.operationalEventsDays,
    inboundEventDays: config.inboundEventDays,
    resolvedContactRequestDays: config.resolvedContactRequestDays,
    communicationConsentConflictBucketsDays: config.communicationConsentConflictBucketsDays,
    batchSize: config.batchSize,
  };
}

type SharedGateContext = {
  actorPlatformAdminId: string | null;
  config: DataRetentionConfig;
  runtimeCleanupEnabled: boolean;
  effectiveCleanupEnabled: boolean;
  cleanupEnabledSource: CleanupEnabledSource;
};

/**
 * Writes the STARTED row for a genuine live-run attempt (dryRun=false,
 * effectiveCleanupEnabled=true) BEFORE the job lock is attempted. Generates
 * and returns the runId the caller must thread through to the matching
 * terminal write via recordManualRunTerminal().
 *
 * Throws on persistence failure — callers must catch this, refuse to run
 * cleanup, and respond 500 (see platformAdmin.ts). A transaction is used
 * purely for symmetry with writePlatformAdminAuditEventInTx's signature;
 * there is nothing else to roll back alongside a single insert.
 */
export async function recordManualRunStarted(ctx: SharedGateContext): Promise<{ runId: string }> {
  const runId = randomUUID();
  await prisma.$transaction(async (tx) => {
    await writePlatformAdminAuditEventInTx(tx, {
      actorPlatformAdminId: ctx.actorPlatformAdminId,
      action: DATA_RETENTION_MANUAL_RUN_STARTED_ACTION,
      resourceType: DATA_RETENTION_MANUAL_RUN_RESOURCE_TYPE,
      resourceKey: DATA_RETENTION_MANUAL_RUN_RESOURCE_KEY,
      outcome: 'started',
      safeMetadata: {
        runId,
        dryRun: false,
        effectiveConfig: buildEffectiveConfigMetadata(ctx.config),
        runtimeCleanupEnabled: ctx.runtimeCleanupEnabled,
        effectiveCleanupEnabled: ctx.effectiveCleanupEnabled,
        cleanupEnabledSource: ctx.cleanupEnabledSource,
      },
    });
  });
  return { runId };
}

/**
 * Writes the single TERMINAL row that shares `runId` with a previously
 * committed STARTED row. Never mutates or removes the STARTED row — this is
 * always a brand-new insert. Throws on persistence failure; the caller
 * decides how to surface that (the STARTED row remains valid evidence that
 * an attempt was made, even if this write fails — see platformAdmin.ts'
 * tryRecordAudit()).
 */
export async function recordManualRunTerminal(
  ctx: SharedGateContext & {
    runId: string;
    dryRun: boolean;
    outcome: DataRetentionManualRunTerminalOutcome;
    errorCategory?: string;
    resultCounts?: Record<string, number>;
    skippedCategories?: string[];
  },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await writePlatformAdminAuditEventInTx(tx, {
      actorPlatformAdminId: ctx.actorPlatformAdminId,
      action: TERMINAL_ACTION_BY_OUTCOME[ctx.outcome],
      resourceType: DATA_RETENTION_MANUAL_RUN_RESOURCE_TYPE,
      resourceKey: DATA_RETENTION_MANUAL_RUN_RESOURCE_KEY,
      outcome: ctx.outcome,
      safeMetadata: {
        runId: ctx.runId,
        dryRun: ctx.dryRun,
        effectiveConfig: buildEffectiveConfigMetadata(ctx.config),
        runtimeCleanupEnabled: ctx.runtimeCleanupEnabled,
        effectiveCleanupEnabled: ctx.effectiveCleanupEnabled,
        cleanupEnabledSource: ctx.cleanupEnabledSource,
        ...(ctx.resultCounts ? { resultCounts: ctx.resultCounts } : {}),
        ...(ctx.skippedCategories?.length ? { skippedCategories: ctx.skippedCategories } : {}),
        ...(ctx.errorCategory ? { errorCategory: ctx.errorCategory } : {}),
      },
    });
  });
}

/**
 * Writes a single, self-contained TERMINAL row with no STARTED precursor —
 * for dry runs and for the policy-gate ("blocked") rejection, neither of
 * which ever reach a lock acquisition or a mutation (see module docstring).
 * Still carries its own fresh runId so every manual-run audit row —
 * started or terminal-only — uniformly has one, keeping tooling/queries
 * (including findIncompleteManualRuns()) simple.
 */
export async function recordManualRunTerminalOnly(
  ctx: SharedGateContext & {
    dryRun: boolean;
    outcome: DataRetentionManualRunTerminalOutcome;
    errorCategory?: string;
    resultCounts?: Record<string, number>;
    skippedCategories?: string[];
  },
): Promise<void> {
  const runId = randomUUID();
  await recordManualRunTerminal({ ...ctx, runId });
}

export type IncompleteManualRun = {
  runId: string;
  startedAt: Date;
  actorPlatformAdminId: string | null;
};

/**
 * Reconciliation query: finds STARTED rows with no matching TERMINAL row
 * sharing the same runId, i.e. live runs whose real outcome was never
 * durably recorded — almost always because the process died mid-run. Only
 * considers STARTED rows older than `graceMs` (default 15 minutes) so a run
 * that is still genuinely in flight is never misreported as incomplete.
 *
 * No PII: returns only the correlation id, timestamp, and platform-admin
 * actor id (never a patient/clinic identifier).
 *
 * Not currently wired to a scheduled job or alert — this is the documented
 * detection query an operator (or a future cron) runs against
 * PlatformAdminAuditEvent to surface an unfinished live retention run.
 */
export async function findIncompleteManualRuns(options?: {
  graceMs?: number;
}): Promise<IncompleteManualRun[]> {
  const graceMs = options?.graceMs ?? 15 * 60 * 1000;
  const cutoff = new Date(Date.now() - graceMs);

  const startedEvents = await prisma.platformAdminAuditEvent.findMany({
    where: { action: DATA_RETENTION_MANUAL_RUN_STARTED_ACTION, createdAt: { lt: cutoff } },
    orderBy: { createdAt: 'asc' },
  });
  if (startedEvents.length === 0) return [];

  const terminalActions = Object.values(TERMINAL_ACTION_BY_OUTCOME);
  const terminalEvents = await prisma.platformAdminAuditEvent.findMany({
    where: { action: { in: terminalActions } },
    select: { safeMetadata: true },
  });
  const terminalRunIds = new Set<string>();
  for (const ev of terminalEvents) {
    const runId = (ev.safeMetadata as { runId?: unknown } | null)?.runId;
    if (typeof runId === 'string') terminalRunIds.add(runId);
  }

  const incomplete: IncompleteManualRun[] = [];
  for (const ev of startedEvents) {
    const runId = (ev.safeMetadata as { runId?: unknown } | null)?.runId;
    if (typeof runId !== 'string' || terminalRunIds.has(runId)) continue;
    incomplete.push({ runId, startedAt: ev.createdAt, actorPlatformAdminId: ev.actorPlatformAdminId });
  }
  return incomplete;
}

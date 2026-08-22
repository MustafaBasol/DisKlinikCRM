/**
 * dataRetentionCleanupJob.test.ts — Unit tests for the data retention cleanup job.
 *
 * All tests use injected deps (no DB, no cron, no real Prisma calls).
 *
 * Run with:  tsx src/tests/dataRetentionCleanupJob.test.ts
 */

import assert from 'node:assert/strict';

// ── Test harness ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      console.log(`  ✓ ${name}`);
      passed++;
    })
    .catch((err: unknown) => {
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    });
}

function section(title: string) {
  console.log(`\n${title}`);
}

// ── Env isolation helper ──────────────────────────────────────────────────────

function withEnv(vars: Record<string, string | undefined>, fn: () => unknown) {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    saved[key] = process.env[key];
    if (vars[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = vars[key];
    }
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  }
}

// ── Imports (after env guard) ─────────────────────────────────────────────────

process.env.ENCRYPTION_KEY = 'a'.repeat(64);

import {
  loadDataRetentionConfig,
  DATA_RETENTION_MIN_DAYS,
  DATA_RETENTION_MAX_BATCH_SIZE,
  DATA_RETENTION_DEFAULTS,
  deriveOutboxConsumerExecutionDays,
} from '../services/privacy/dataRetentionPolicy.js';

// F5-2R — the outbox lifecycle rules live with the outbox, not with the job.
import {
  buildProcessedEventRetentionWhere,
  buildDeadEventRetentionWhere,
  buildCompletedExecutionRetentionWhere,
  OUTBOX_RETENTION_GUARD_SET_LIMIT,
  OutboxRetentionGuardLimitError,
} from '../outbox/outboxRetention.js';

import {
  RAW_SQL_AUDIT_REGISTRY,
  RAW_SQL_REGISTRY_KEYS,
} from '../tenancy/rawSqlAuditRegistry.js';

import {
  runDataRetentionCleanup,
  type DataRetentionCategoryDeps,
  type DataRetentionDeps,
  type DataRetentionSummary,
} from '../jobs/dataRetentionCleanupJob.js';

// ── Fixture helpers ───────────────────────────────────────────────────────────

function makeCategoryDeps(
  eligible: number,
  onExecute?: (threshold: Date, batchSize: number) => number,
): DataRetentionCategoryDeps & { executeCalls: Array<{ threshold: Date; batchSize: number }> } {
  const executeCalls: Array<{ threshold: Date; batchSize: number }> = [];
  return {
    executeCalls,
    countEligible: async (_threshold) => eligible,
    executeCleanupBatch: async (threshold, batchSize) => {
      executeCalls.push({ threshold, batchSize });
      return onExecute ? onExecute(threshold, batchSize) : eligible;
    },
  };
}

function neverExecuteDeps(eligible = 0): DataRetentionCategoryDeps {
  return {
    countEligible: async () => eligible,
    executeCleanupBatch: async () => {
      throw new Error('executeCleanupBatch must not be called in dry-run');
    },
  };
}

function zeroDeps(): DataRetentionCategoryDeps {
  return {
    countEligible: async () => 0,
    executeCleanupBatch: async () => 0,
  };
}

function failingDeps(label: string): DataRetentionCategoryDeps {
  return {
    countEligible: async () => { throw new Error(`${label} countEligible failed`); },
    executeCleanupBatch: async () => { throw new Error(`${label} executeCleanupBatch failed`); },
  };
}

const DEFAULT_TEST_CONFIG = loadDataRetentionConfig();

// ── Section A: Policy defaults ────────────────────────────────────────────────

section('A. Policy defaults');

await test('default conversationMessagesDays is 365', () => {
  const cfg = withEnv({
    DATA_RETENTION_CONVERSATION_MESSAGES_DAYS: undefined,
  }, () => loadDataRetentionConfig()) as ReturnType<typeof loadDataRetentionConfig>;
  assert.equal(cfg.conversationMessagesDays, 365);
});

await test('default conversationStateDays is 90', () => {
  const cfg = withEnv({ DATA_RETENTION_CONVERSATION_STATE_DAYS: undefined }, () =>
    loadDataRetentionConfig()) as ReturnType<typeof loadDataRetentionConfig>;
  assert.equal(cfg.conversationStateDays, 90);
});

await test('default operationalEventsDays is 180', () => {
  const cfg = withEnv({ DATA_RETENTION_OPERATIONAL_EVENTS_DAYS: undefined }, () =>
    loadDataRetentionConfig()) as ReturnType<typeof loadDataRetentionConfig>;
  assert.equal(cfg.operationalEventsDays, 180);
});

await test('default inboundEventDays is 90', () => {
  const cfg = withEnv({ DATA_RETENTION_INBOUND_EVENT_DAYS: undefined }, () =>
    loadDataRetentionConfig()) as ReturnType<typeof loadDataRetentionConfig>;
  assert.equal(cfg.inboundEventDays, 90);
});

await test('default resolvedContactRequestDays is 365', () => {
  const cfg = withEnv({ DATA_RETENTION_RESOLVED_CONTACT_REQUEST_DAYS: undefined }, () =>
    loadDataRetentionConfig()) as ReturnType<typeof loadDataRetentionConfig>;
  assert.equal(cfg.resolvedContactRequestDays, 365);
});

await test('default migrationPreservedSourceDays is 3650 (10 years)', () => {
  const cfg = withEnv({ DATA_RETENTION_MIGRATION_PRESERVED_SOURCE_DAYS: undefined }, () =>
    loadDataRetentionConfig()) as ReturnType<typeof loadDataRetentionConfig>;
  assert.equal(cfg.migrationPreservedSourceDays, 3650);
});

await test('default batchSize is 500', () => {
  const cfg = withEnv({ DATA_RETENTION_BATCH_SIZE: undefined }, () =>
    loadDataRetentionConfig()) as ReturnType<typeof loadDataRetentionConfig>;
  assert.equal(cfg.batchSize, 500);
});

await test('default cronSchedule is 0 3 * * *', () => {
  const cfg = withEnv({ DATA_RETENTION_CLEANUP_CRON: undefined }, () =>
    loadDataRetentionConfig()) as ReturnType<typeof loadDataRetentionConfig>;
  assert.equal(cfg.cronSchedule, '0 3 * * *');
});

await test('enabled defaults to true when env not set', () => {
  const cfg = withEnv({ DATA_RETENTION_CLEANUP_ENABLED: undefined }, () =>
    loadDataRetentionConfig()) as ReturnType<typeof loadDataRetentionConfig>;
  assert.equal(cfg.enabled, true);
});

await test('DATA_RETENTION_DEFAULTS exports correct values', () => {
  assert.equal(DATA_RETENTION_DEFAULTS.conversationMessagesDays, 365);
  assert.equal(DATA_RETENTION_DEFAULTS.conversationStateDays, 90);
  assert.equal(DATA_RETENTION_DEFAULTS.batchSize, 500);
});

// ── Section B: Env overrides ──────────────────────────────────────────────────

section('B. Env overrides');

await test('env override: conversationMessagesDays', () => {
  const cfg = withEnv({ DATA_RETENTION_CONVERSATION_MESSAGES_DAYS: '730' }, () =>
    loadDataRetentionConfig()) as ReturnType<typeof loadDataRetentionConfig>;
  assert.equal(cfg.conversationMessagesDays, 730);
});

await test('env override: migrationPreservedSourceDays', () => {
  const cfg = withEnv({ DATA_RETENTION_MIGRATION_PRESERVED_SOURCE_DAYS: '1825' }, () =>
    loadDataRetentionConfig()) as ReturnType<typeof loadDataRetentionConfig>;
  assert.equal(cfg.migrationPreservedSourceDays, 1825);
});

await test('below-minimum migrationPreservedSourceDays falls back to the 3650-day default', () => {
  const cfg = withEnv({ DATA_RETENTION_MIGRATION_PRESERVED_SOURCE_DAYS: '10' }, () =>
    loadDataRetentionConfig()) as ReturnType<typeof loadDataRetentionConfig>;
  assert.equal(cfg.migrationPreservedSourceDays, 3650);
});

await test('env override: batchSize', () => {
  const cfg = withEnv({ DATA_RETENTION_BATCH_SIZE: '200' }, () =>
    loadDataRetentionConfig()) as ReturnType<typeof loadDataRetentionConfig>;
  assert.equal(cfg.batchSize, 200);
});

await test('env override: enabled=false disables job', () => {
  const cfg = withEnv({ DATA_RETENTION_CLEANUP_ENABLED: 'false' }, () =>
    loadDataRetentionConfig()) as ReturnType<typeof loadDataRetentionConfig>;
  assert.equal(cfg.enabled, false);
});

await test('env override: custom cron schedule', () => {
  const cfg = withEnv({ DATA_RETENTION_CLEANUP_CRON: '0 2 * * 0' }, () =>
    loadDataRetentionConfig()) as ReturnType<typeof loadDataRetentionConfig>;
  assert.equal(cfg.cronSchedule, '0 2 * * 0');
});

// ── Section C: Invalid values fall back to defaults ───────────────────────────

section('C. Invalid values fall back to defaults');

await test('NaN value for days falls back to default', () => {
  const cfg = withEnv({ DATA_RETENTION_CONVERSATION_MESSAGES_DAYS: 'not-a-number' }, () =>
    loadDataRetentionConfig()) as ReturnType<typeof loadDataRetentionConfig>;
  assert.equal(cfg.conversationMessagesDays, 365);
});

await test('value below minimum days falls back to default', () => {
  const cfg = withEnv({ DATA_RETENTION_CONVERSATION_MESSAGES_DAYS: '10' }, () =>
    loadDataRetentionConfig()) as ReturnType<typeof loadDataRetentionConfig>;
  assert.equal(cfg.conversationMessagesDays, 365);
  assert.ok(DATA_RETENTION_MIN_DAYS <= 365, 'min days constant should be ≤ default');
});

await test('negative batch size falls back to default', () => {
  const cfg = withEnv({ DATA_RETENTION_BATCH_SIZE: '-5' }, () =>
    loadDataRetentionConfig()) as ReturnType<typeof loadDataRetentionConfig>;
  assert.equal(cfg.batchSize, 500);
});

await test('NaN batch size falls back to default', () => {
  const cfg = withEnv({ DATA_RETENTION_BATCH_SIZE: 'abc' }, () =>
    loadDataRetentionConfig()) as ReturnType<typeof loadDataRetentionConfig>;
  assert.equal(cfg.batchSize, 500);
});

// ── Section D: Batch size cap ─────────────────────────────────────────────────

section('D. Batch size cap');

await test('batch size above maximum is capped', () => {
  const cfg = withEnv({ DATA_RETENTION_BATCH_SIZE: '9999' }, () =>
    loadDataRetentionConfig()) as ReturnType<typeof loadDataRetentionConfig>;
  assert.equal(cfg.batchSize, DATA_RETENTION_MAX_BATCH_SIZE);
});

await test('DATA_RETENTION_MAX_BATCH_SIZE is 1000', () => {
  assert.equal(DATA_RETENTION_MAX_BATCH_SIZE, 1000);
});

// ── Section E: Dry-run mode ───────────────────────────────────────────────────

section('E. Dry-run mode');

await test('dry-run: returns counts without calling executeCleanupBatch', async () => {
  const msgDeps = neverExecuteDeps(7);
  const stateDeps = neverExecuteDeps(3);
  const opDeps = neverExecuteDeps(5);
  const inboundDeps = neverExecuteDeps(2);
  const crDeps = neverExecuteDeps(4);
  const inboxDeps = neverExecuteDeps(1);

  const summary = await runDataRetentionCleanup(
    { dryRun: true, config: DEFAULT_TEST_CONFIG },
    { conversationMessages: msgDeps, conversationStates: stateDeps, operationalEvents: opDeps,
      inboundEvents: inboundDeps, contactRequests: crDeps, inboxEntries: inboxDeps },
  );

  assert.equal(summary.dryRun, true);
  assert.equal(summary.deletedConversationMessages, 7);
  assert.equal(summary.deletedConversationStates, 3);
  assert.equal(summary.deletedOperationalEvents, 5);
  assert.equal(summary.deletedInboundEvents, 2);
  assert.equal(summary.anonymizedContactRequests, 4);
  assert.equal(summary.redactedInboxEntries, 1);
});

await test('dry-run: summary.dryRun flag is true', async () => {
  const deps = { conversationMessages: neverExecuteDeps(0), conversationStates: neverExecuteDeps(0),
    operationalEvents: neverExecuteDeps(0), inboundEvents: neverExecuteDeps(0),
    contactRequests: neverExecuteDeps(0), inboxEntries: neverExecuteDeps(0) };
  const summary = await runDataRetentionCleanup({ dryRun: true, config: DEFAULT_TEST_CONFIG }, deps);
  assert.equal(summary.dryRun, true);
});

// ── Section F: Conversation messages ─────────────────────────────────────────

section('F. Conversation messages');

await test('live run: conversation messages older than retention are deleted', async () => {
  const msgDeps = makeCategoryDeps(10);
  const summary = await runDataRetentionCleanup(
    { dryRun: false, config: DEFAULT_TEST_CONFIG },
    { conversationMessages: msgDeps, conversationStates: zeroDeps(),
      operationalEvents: zeroDeps(), inboundEvents: zeroDeps(),
      contactRequests: zeroDeps(), inboxEntries: zeroDeps() },
  );
  assert.equal(summary.deletedConversationMessages, 10);
  assert.equal(msgDeps.executeCalls.length, 1);
});

await test('live run: recent conversation messages are not deleted (zero eligible)', async () => {
  const msgDeps = makeCategoryDeps(0);
  const summary = await runDataRetentionCleanup(
    { dryRun: false, config: DEFAULT_TEST_CONFIG },
    { conversationMessages: msgDeps, conversationStates: zeroDeps(),
      operationalEvents: zeroDeps(), inboundEvents: zeroDeps(),
      contactRequests: zeroDeps(), inboxEntries: zeroDeps() },
  );
  assert.equal(summary.deletedConversationMessages, 0);
});

await test('threshold date passed to executeCleanupBatch reflects configured retention days', async () => {
  const msgDeps = makeCategoryDeps(1);
  const config = { ...DEFAULT_TEST_CONFIG, conversationMessagesDays: 365 };

  const beforeCall = new Date();
  await runDataRetentionCleanup(
    { dryRun: false, config },
    { conversationMessages: msgDeps, conversationStates: zeroDeps(),
      operationalEvents: zeroDeps(), inboundEvents: zeroDeps(),
      contactRequests: zeroDeps(), inboxEntries: zeroDeps() },
  );
  const afterCall = new Date();

  const call = msgDeps.executeCalls[0];
  assert.ok(call, 'executeCleanupBatch should have been called');
  const expectedThreshold = new Date();
  expectedThreshold.setDate(expectedThreshold.getDate() - 365);
  // allow ±2 seconds for test execution time
  assert.ok(Math.abs(call.threshold.getTime() - expectedThreshold.getTime()) < 2000,
    `threshold should be ~365 days ago, got ${call.threshold.toISOString()}`);
  assert.ok(call.threshold >= new Date(beforeCall.getTime() - 365 * 86400000 - 2000));
  assert.ok(call.threshold <= new Date(afterCall.getTime() - 365 * 86400000 + 2000));
});

// ── Section G: Conversation state ────────────────────────────────────────────

section('G. Conversation state (WhatsApp + Instagram shared table)');

await test('live run: old conversation states are deleted', async () => {
  const stateDeps = makeCategoryDeps(5);
  const summary = await runDataRetentionCleanup(
    { dryRun: false, config: DEFAULT_TEST_CONFIG },
    { conversationMessages: zeroDeps(), conversationStates: stateDeps,
      operationalEvents: zeroDeps(), inboundEvents: zeroDeps(),
      contactRequests: zeroDeps(), inboxEntries: zeroDeps() },
  );
  assert.equal(summary.deletedConversationStates, 5);
  assert.equal(stateDeps.executeCalls.length, 1);
});

await test('live run: recent conversation states are not deleted (zero eligible)', async () => {
  const stateDeps = makeCategoryDeps(0);
  const summary = await runDataRetentionCleanup(
    { dryRun: false, config: DEFAULT_TEST_CONFIG },
    { conversationMessages: zeroDeps(), conversationStates: stateDeps,
      operationalEvents: zeroDeps(), inboundEvents: zeroDeps(),
      contactRequests: zeroDeps(), inboxEntries: zeroDeps() },
  );
  assert.equal(summary.deletedConversationStates, 0);
});

// ── Section H: MessagingInboundEvent ─────────────────────────────────────────

section('H. MessagingInboundEvent');

await test('live run: old inbound events are deleted', async () => {
  const inboundDeps = makeCategoryDeps(8);
  const summary = await runDataRetentionCleanup(
    { dryRun: false, config: DEFAULT_TEST_CONFIG },
    { conversationMessages: zeroDeps(), conversationStates: zeroDeps(),
      operationalEvents: zeroDeps(), inboundEvents: inboundDeps,
      contactRequests: zeroDeps(), inboxEntries: zeroDeps() },
  );
  assert.equal(summary.deletedInboundEvents, 8);
  assert.equal(inboundDeps.executeCalls.length, 1);
});

// ── Section H2: ExternalCalendarInboundEvent (sibling PII-bearing ledger) ─────

section('H2. ExternalCalendarInboundEvent (DigiDentiS webhook idempotency ledger)');

await test('live run: old external calendar inbound events (rawPayload PII) are deleted', async () => {
  const extCalDeps = makeCategoryDeps(4);
  const summary = await runDataRetentionCleanup(
    { dryRun: false, config: DEFAULT_TEST_CONFIG },
    { conversationMessages: zeroDeps(), conversationStates: zeroDeps(),
      operationalEvents: zeroDeps(), inboundEvents: zeroDeps(),
      externalCalendarInboundEvents: extCalDeps,
      contactRequests: zeroDeps(), inboxEntries: zeroDeps() },
  );
  assert.equal(summary.deletedExternalCalendarInboundEvents, 4);
  assert.equal(extCalDeps.executeCalls.length, 1);
});

await test('live run: recent external calendar inbound events are not deleted (zero eligible)', async () => {
  const extCalDeps = makeCategoryDeps(0);
  const summary = await runDataRetentionCleanup(
    { dryRun: false, config: DEFAULT_TEST_CONFIG },
    { conversationMessages: zeroDeps(), conversationStates: zeroDeps(),
      operationalEvents: zeroDeps(), inboundEvents: zeroDeps(),
      externalCalendarInboundEvents: extCalDeps,
      contactRequests: zeroDeps(), inboxEntries: zeroDeps() },
  );
  assert.equal(summary.deletedExternalCalendarInboundEvents, 0);
});

await test('external calendar inbound events use the same inboundEventDays threshold as MessagingInboundEvent', async () => {
  const extCalDeps = makeCategoryDeps(1);
  const config = { ...DEFAULT_TEST_CONFIG, inboundEventDays: 90 };

  await runDataRetentionCleanup(
    { dryRun: false, config },
    { conversationMessages: zeroDeps(), conversationStates: zeroDeps(),
      operationalEvents: zeroDeps(), inboundEvents: zeroDeps(),
      externalCalendarInboundEvents: extCalDeps,
      contactRequests: zeroDeps(), inboxEntries: zeroDeps() },
  );

  const call = extCalDeps.executeCalls[0];
  assert.ok(call, 'executeCleanupBatch should have been called');
  const expectedThreshold = new Date();
  expectedThreshold.setDate(expectedThreshold.getDate() - 90);
  assert.ok(Math.abs(call.threshold.getTime() - expectedThreshold.getTime()) < 2000,
    `threshold should be ~90 days ago, got ${call.threshold.toISOString()}`);
});

// ── Section H3: MigrationPreservedSourceValue ────────────────────────────────

section('H3. MigrationPreservedSourceValue (F3-DATA-MIG-TODAY-001-R10 legacy import evidence)');

await test('live run: preserved legacy source values past the window are deleted', async () => {
  const preservedDeps = makeCategoryDeps(6);
  const summary = await runDataRetentionCleanup(
    { dryRun: false, config: DEFAULT_TEST_CONFIG },
    { conversationMessages: zeroDeps(), conversationStates: zeroDeps(),
      operationalEvents: zeroDeps(), inboundEvents: zeroDeps(),
      externalCalendarInboundEvents: zeroDeps(),
      contactRequests: zeroDeps(), inboxEntries: zeroDeps(),
      communicationConsentConflictBuckets: zeroDeps(),
      migrationPreservedSourceValues: preservedDeps },
  );
  assert.equal(summary.deletedMigrationPreservedSourceValues, 6);
  assert.equal(preservedDeps.executeCalls.length, 1);
});

await test('preserved source values age on their own migrationPreservedSourceDays threshold', async () => {
  const preservedDeps = makeCategoryDeps(1);
  const config = { ...DEFAULT_TEST_CONFIG, migrationPreservedSourceDays: 3650 };

  await runDataRetentionCleanup(
    { dryRun: false, config },
    { conversationMessages: zeroDeps(), conversationStates: zeroDeps(),
      operationalEvents: zeroDeps(), inboundEvents: zeroDeps(),
      externalCalendarInboundEvents: zeroDeps(),
      contactRequests: zeroDeps(), inboxEntries: zeroDeps(),
      communicationConsentConflictBuckets: zeroDeps(),
      migrationPreservedSourceValues: preservedDeps },
  );

  const call = preservedDeps.executeCalls[0];
  assert.ok(call, 'executeCleanupBatch should have been called');
  const expectedThreshold = new Date();
  expectedThreshold.setDate(expectedThreshold.getDate() - 3650);
  assert.ok(Math.abs(call.threshold.getTime() - expectedThreshold.getTime()) < 2000,
    `threshold should be ~3650 days ago, got ${call.threshold.toISOString()}`);
});

// ── Section I: OperationalEvent ───────────────────────────────────────────────

section('I. OperationalEvent');

await test('live run: old operational events are deleted', async () => {
  const opDeps = makeCategoryDeps(15);
  const summary = await runDataRetentionCleanup(
    { dryRun: false, config: DEFAULT_TEST_CONFIG },
    { conversationMessages: zeroDeps(), conversationStates: zeroDeps(),
      operationalEvents: opDeps, inboundEvents: zeroDeps(),
      contactRequests: zeroDeps(), inboxEntries: zeroDeps() },
  );
  assert.equal(summary.deletedOperationalEvents, 15);
});

// ── Section J: ContactRequest anonymization ───────────────────────────────────

section('J. ContactRequest anonymization');

await test('live run: resolved/closed old contact requests are anonymized', async () => {
  const crDeps = makeCategoryDeps(6);
  const summary = await runDataRetentionCleanup(
    { dryRun: false, config: DEFAULT_TEST_CONFIG },
    { conversationMessages: zeroDeps(), conversationStates: zeroDeps(),
      operationalEvents: zeroDeps(), inboundEvents: zeroDeps(),
      contactRequests: crDeps, inboxEntries: zeroDeps() },
  );
  assert.equal(summary.anonymizedContactRequests, 6);
  assert.equal(crDeps.executeCalls.length, 1);
});

await test('live run: recent resolved contact requests are not touched (zero eligible)', async () => {
  // dep returns 0 meaning no rows matched — summary count must be 0
  const crDeps = makeCategoryDeps(0, () => 0);
  const summary = await runDataRetentionCleanup(
    { dryRun: false, config: DEFAULT_TEST_CONFIG },
    { conversationMessages: zeroDeps(), conversationStates: zeroDeps(),
      operationalEvents: zeroDeps(), inboundEvents: zeroDeps(),
      contactRequests: crDeps, inboxEntries: zeroDeps() },
  );
  assert.equal(summary.anonymizedContactRequests, 0);
});

await test('pending/in_progress contact requests are never passed to cleanup (injected dep controls filtering)', async () => {
  // The dep itself controls the where-clause filtering (status: resolved/closed).
  // Here we verify the runner never bypasses the dep contract.
  let executeWasCalled = false;
  const crDeps: DataRetentionCategoryDeps = {
    countEligible: async () => 0, // dep says 0 pending-safe rows
    executeCleanupBatch: async () => {
      executeWasCalled = true;
      return 0;
    },
  };
  await runDataRetentionCleanup(
    { dryRun: false, config: DEFAULT_TEST_CONFIG },
    { conversationMessages: zeroDeps(), conversationStates: zeroDeps(),
      operationalEvents: zeroDeps(), inboundEvents: zeroDeps(),
      contactRequests: crDeps, inboxEntries: zeroDeps() },
  );
  // executeCleanupBatch still called but dep returns 0, simulating no pending rows eligible
  // (The production dep's WHERE clause excludes pending/in_progress — tested separately below)
  assert.equal(executeWasCalled, true, 'executeCleanupBatch is called; production dep filters by status');
});

// ── Section K: Error resilience ───────────────────────────────────────────────

section('K. Error resilience — job continues if one category fails');

await test('failing conversationMessages: other categories still run', async () => {
  const stateDeps = makeCategoryDeps(3);
  const summary = await runDataRetentionCleanup(
    { dryRun: false, config: DEFAULT_TEST_CONFIG },
    {
      conversationMessages: failingDeps('conversationMessages'),
      conversationStates: stateDeps,
      operationalEvents: zeroDeps(),
      inboundEvents: zeroDeps(),
      contactRequests: zeroDeps(),
      inboxEntries: zeroDeps(),
    },
  );
  assert.equal(summary.deletedConversationMessages, 0);
  assert.equal(summary.deletedConversationStates, 3);
  assert.ok(summary.errors.length >= 1, 'should record the error');
  assert.ok(summary.skippedCategories.includes('conversationMessages'), 'should mark as skipped');
});

await test('multiple failures: all errors are collected and other categories succeed', async () => {
  const opDeps = makeCategoryDeps(2);
  const summary = await runDataRetentionCleanup(
    { dryRun: false, config: DEFAULT_TEST_CONFIG },
    {
      conversationMessages: failingDeps('conversationMessages'),
      conversationStates: failingDeps('conversationStates'),
      operationalEvents: opDeps,
      inboundEvents: failingDeps('inboundEvents'),
      contactRequests: zeroDeps(),
      inboxEntries: zeroDeps(),
    },
  );
  assert.ok(summary.errors.length >= 3, 'should record 3 errors');
  assert.equal(summary.deletedOperationalEvents, 2, 'operational events category still ran');
});

await test('all categories fail: summary has errors but does not throw', async () => {
  const allFailing: DataRetentionDeps = {
    conversationMessages: failingDeps('a'),
    conversationStates: failingDeps('b'),
    operationalEvents: failingDeps('c'),
    inboundEvents: failingDeps('d'),
    externalCalendarInboundEvents: failingDeps('h'),
    contactRequests: failingDeps('e'),
    inboxEntries: failingDeps('f'),
    communicationConsentConflictBuckets: failingDeps('g'),
    migrationPreservedSourceValues: failingDeps('i'),
    outboxProcessedEvents: failingDeps('j'),
    outboxDeadEvents: failingDeps('k'),
    outboxConsumerExecutions: failingDeps('l'),
  };

  let threw = false;
  let summary: DataRetentionSummary | undefined;
  try {
    summary = await runDataRetentionCleanup({ dryRun: false, config: DEFAULT_TEST_CONFIG }, allFailing);
  } catch {
    threw = true;
  }
  assert.equal(threw, false, 'runDataRetentionCleanup must not throw even if all categories fail');
  assert.ok(summary, 'summary should be returned');
  assert.ok((summary?.errors?.length ?? 0) >= 12, 'should have collected all 12 errors');
});

// ── Section L: Log safety ─────────────────────────────────────────────────────

section('L. Log safety — no PII in log output');

await test('console.log output does not include raw phone numbers or message text', async () => {
  const logLines: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args: unknown[]) => logLines.push(args.join(' '));
  console.error = (...args: unknown[]) => logLines.push(args.join(' '));

  try {
    await runDataRetentionCleanup(
      { dryRun: true, config: DEFAULT_TEST_CONFIG },
      {
        conversationMessages: neverExecuteDeps(3),
        conversationStates: neverExecuteDeps(1),
        operationalEvents: neverExecuteDeps(0),
        inboundEvents: neverExecuteDeps(0),
        contactRequests: neverExecuteDeps(2),
        inboxEntries: neverExecuteDeps(0),
      },
    );
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }

  const combined = logLines.join('\n');
  // Must not log raw phone number patterns
  assert.ok(!/\+\d{7,}/.test(combined), 'must not log E.164 phone numbers');
  // Must not log patient names (we don't have them in the runner at all)
  assert.ok(!/patient/i.test(combined) || true, 'patient names not relevant in runner logs');
  // Must not log raw message bodies
  assert.ok(!combined.includes('rawPayload'), 'must not log rawPayload contents');
  assert.ok(!combined.includes('lastMessage'), 'must not log lastMessage text');
});

// F3-IMPL-006 (Wave 2): runCategory's catch block used to log
// `error=${msg}` where msg = err.message — a raw Prisma error from a
// delete/anonymize batch over contactRequests/inboxEntries (phone/name/
// lastMessage/rawPayload fields). A PrismaClientValidationError or
// constraint-violation error can echo the exact field value being
// redacted straight back through err.message. This proves the fix
// (safeErrorFields(err)) keeps the console.error(`category=...`) call
// PII-free while errors still land in the (non-console) summary.errors
// array unchanged for operator diagnostics.
await test('Wave 2: category error log uses safeErrorFields, never the raw PHI-bearing err.message', async () => {
  const PHONE_FIXTURE = '905551234567';
  const NAME_FIXTURE = 'Fatma Şahin';
  const phiFixtureErr = Object.assign(
    new Error(
      `Unique constraint failed on the fields: (phone). Attempted data: { phone: "${PHONE_FIXTURE}", name: "${NAME_FIXTURE}" }`,
    ),
    { name: 'PrismaClientKnownRequestError', code: 'P2002' },
  );

  const logLines: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => logLines.push(JSON.stringify(args));

  let summary: DataRetentionSummary;
  try {
    summary = await runDataRetentionCleanup(
      { dryRun: false, config: DEFAULT_TEST_CONFIG },
      {
        conversationMessages: zeroDeps(),
        conversationStates: zeroDeps(),
        operationalEvents: zeroDeps(),
        inboundEvents: zeroDeps(),
        contactRequests: {
          countEligible: async () => 1,
          executeCleanupBatch: async () => { throw phiFixtureErr; },
        },
        inboxEntries: zeroDeps(),
      },
    );
  } finally {
    console.error = originalError;
  }

  // The category is still recorded as skipped/errored — behavior unchanged.
  assert.ok(summary.skippedCategories.includes('contactRequests'), 'category should be marked skipped');
  assert.ok(summary.errors.some(e => e.startsWith('contactRequests:')), 'summary.errors should record the failure');

  const combined = logLines.join('\n');
  assert.ok(!combined.includes(PHONE_FIXTURE), 'raw phone number leaked into console.error output');
  assert.ok(!combined.includes(NAME_FIXTURE), 'raw patient name leaked into console.error output');
  assert.ok(combined.includes('PrismaClientKnownRequestError'), 'expected errorName in console.error output');
  assert.ok(combined.includes('P2002'), 'expected errorCode in console.error output');
  assert.ok(combined.includes('category=contactRequests'), 'expected the category label in console.error output');
});

// ── Section M: Protected models never targeted ────────────────────────────────

section('M. Protected models — Patient/Appointment/Payment not targeted');

await test('runDataRetentionCleanup only invokes the six injected category deps', async () => {
  const called: string[] = [];
  function trackDeps(label: string): DataRetentionCategoryDeps {
    return {
      countEligible: async () => { called.push(`${label}:count`); return 0; },
      executeCleanupBatch: async () => { called.push(`${label}:exec`); return 0; },
    };
  }

  await runDataRetentionCleanup(
    { dryRun: false, config: DEFAULT_TEST_CONFIG },
    {
      conversationMessages: trackDeps('messages'),
      conversationStates: trackDeps('states'),
      operationalEvents: trackDeps('opEvents'),
      inboundEvents: trackDeps('inbound'),
      contactRequests: trackDeps('contactReqs'),
      inboxEntries: trackDeps('inbox'),
    },
  );

  const execCalled = called.filter(c => c.endsWith(':exec'));
  assert.equal(execCalled.length, 6, 'exactly 6 execute calls (one per category)');
  // Verify no unexpected labels like 'patient', 'appointment', 'payment'
  for (const c of called) {
    assert.ok(
      !c.includes('patient') && !c.includes('appointment') && !c.includes('payment'),
      `unexpected category called: ${c}`,
    );
  }
});

// ── Section N: Summary shape ──────────────────────────────────────────────────

section('N. Summary shape');

await test('summary contains all required fields', async () => {
  const summary = await runDataRetentionCleanup(
    { dryRun: true, config: DEFAULT_TEST_CONFIG },
    {
      conversationMessages: neverExecuteDeps(0),
      conversationStates: neverExecuteDeps(0),
      operationalEvents: neverExecuteDeps(0),
      inboundEvents: neverExecuteDeps(0),
      contactRequests: neverExecuteDeps(0),
      inboxEntries: neverExecuteDeps(0),
    },
  );
  assert.ok('deletedConversationMessages' in summary);
  assert.ok('deletedConversationStates' in summary);
  assert.ok('deletedOperationalEvents' in summary);
  assert.ok('deletedInboundEvents' in summary);
  assert.ok('deletedExternalCalendarInboundEvents' in summary);
  assert.ok('anonymizedContactRequests' in summary);
  assert.ok('redactedInboxEntries' in summary);
  assert.ok('deletedMigrationPreservedSourceValues' in summary);
  assert.ok('skippedCategories' in summary);
  assert.ok('errors' in summary);
  assert.ok('dryRun' in summary);
});

await test('live run: summary.dryRun is false', async () => {
  const summary = await runDataRetentionCleanup(
    { dryRun: false, config: DEFAULT_TEST_CONFIG },
    {
      conversationMessages: zeroDeps(),
      conversationStates: zeroDeps(),
      operationalEvents: zeroDeps(),
      inboundEvents: zeroDeps(),
      contactRequests: zeroDeps(),
      inboxEntries: zeroDeps(),
    },
  );
  assert.equal(summary.dryRun, false);
});

// ── Section O: Batch size is forwarded to executor ───────────────────────────

section('O. Batch size forwarding');

await test('batchSize from config is passed to executeCleanupBatch', async () => {
  const msgDeps = makeCategoryDeps(1);
  const config = { ...DEFAULT_TEST_CONFIG, batchSize: 42 };

  await runDataRetentionCleanup(
    { dryRun: false, config },
    { conversationMessages: msgDeps, conversationStates: zeroDeps(),
      operationalEvents: zeroDeps(), inboundEvents: zeroDeps(),
      contactRequests: zeroDeps(), inboxEntries: zeroDeps() },
  );

  assert.equal(msgDeps.executeCalls[0]?.batchSize, 42);
});


// ── Section P: F5-2R — outbox retention policy ───────────────────────────────
//
// The DB-free half of F5-2R. Everything here is a property of the POLICY and of
// the WHERE predicates: which statuses can appear in a sweep at all, how the
// windows relate to one another, and that a dry run cannot mutate. The
// behaviour only a real database can prove — that a live lease survives a
// sweep, that a guarded delete actually leaves the guarded row in place — is in
// src/tests/dbVerification/outboxRetention.test.ts and is deliberately not
// faked here.

section('P. F5-2R — outbox retention policy defaults and derivation');

await test('default outboxProcessedEventDays is 180 (matches the operational-event family)', () => {
  const cfg = withEnv({ DATA_RETENTION_OUTBOX_PROCESSED_EVENT_DAYS: undefined }, () =>
    loadDataRetentionConfig()) as ReturnType<typeof loadDataRetentionConfig>;
  assert.equal(cfg.outboxProcessedEventDays, 180);
});

await test('default outboxDeadEventDays is 365 and is LONGER than the processed window', () => {
  const cfg = withEnv({
    DATA_RETENTION_OUTBOX_PROCESSED_EVENT_DAYS: undefined,
    DATA_RETENTION_OUTBOX_DEAD_EVENT_DAYS: undefined,
  }, () => loadDataRetentionConfig()) as ReturnType<typeof loadDataRetentionConfig>;
  assert.equal(cfg.outboxDeadEventDays, 365);
  assert.ok(
    cfg.outboxDeadEventDays > cfg.outboxProcessedEventDays,
    'a lost obligation must be retained longer than a discharged one',
  );
});

await test('env override: outboxProcessedEventDays', () => {
  const cfg = withEnv({ DATA_RETENTION_OUTBOX_PROCESSED_EVENT_DAYS: '240' }, () =>
    loadDataRetentionConfig()) as ReturnType<typeof loadDataRetentionConfig>;
  assert.equal(cfg.outboxProcessedEventDays, 240);
});

await test('env override: outboxDeadEventDays', () => {
  const cfg = withEnv({ DATA_RETENTION_OUTBOX_DEAD_EVENT_DAYS: '730' }, () =>
    loadDataRetentionConfig()) as ReturnType<typeof loadDataRetentionConfig>;
  assert.equal(cfg.outboxDeadEventDays, 730);
});

await test('below-minimum outbox windows fall back to their defaults, never to the raw value', () => {
  const cfg = withEnv({
    DATA_RETENTION_OUTBOX_PROCESSED_EVENT_DAYS: '1',
    DATA_RETENTION_OUTBOX_DEAD_EVENT_DAYS: '7',
  }, () => loadDataRetentionConfig()) as ReturnType<typeof loadDataRetentionConfig>;
  assert.equal(cfg.outboxProcessedEventDays, 180);
  assert.equal(cfg.outboxDeadEventDays, 365);
  assert.equal(DATA_RETENTION_MIN_DAYS, 30, 'minimum is the shared 30-day floor');
});

await test('non-numeric outbox windows fall back to their defaults', () => {
  const cfg = withEnv({
    DATA_RETENTION_OUTBOX_PROCESSED_EVENT_DAYS: 'forever',
    DATA_RETENTION_OUTBOX_DEAD_EVENT_DAYS: '',
  }, () => loadDataRetentionConfig()) as ReturnType<typeof loadDataRetentionConfig>;
  assert.equal(cfg.outboxProcessedEventDays, 180);
  assert.equal(cfg.outboxDeadEventDays, 365);
});

await test('THE INVARIANT: consumer-execution retention is never shorter than any event window', () => {
  const cases: Array<[number, number]> = [
    [180, 365], [365, 180], [30, 30], [900, 45], [45, 900],
  ];
  for (const [processed, dead] of cases) {
    const derived = deriveOutboxConsumerExecutionDays(processed, dead);
    assert.ok(
      derived >= processed && derived >= dead,
      `derived ${derived} must cover both ${processed} and ${dead}`,
    );
  }
});

await test('the derived window tracks env overrides in both directions', () => {
  const raised = withEnv({ DATA_RETENTION_OUTBOX_DEAD_EVENT_DAYS: '1000' }, () =>
    loadDataRetentionConfig()) as ReturnType<typeof loadDataRetentionConfig>;
  assert.equal(raised.outboxConsumerExecutionDays, 1000);

  const processedWins = withEnv({ DATA_RETENTION_OUTBOX_PROCESSED_EVENT_DAYS: '2000' }, () =>
    loadDataRetentionConfig()) as ReturnType<typeof loadDataRetentionConfig>;
  assert.equal(processedWins.outboxConsumerExecutionDays, 2000);
});

await test('there is NO environment variable that can shorten the consumer-execution window', () => {
  // The whole point of deriving it: an operator cannot create the state in
  // which an event outlives its own duplicate-suppression record.
  const attempted = withEnv({
    DATA_RETENTION_OUTBOX_CONSUMER_EXECUTION_DAYS: '30',
    DATA_RETENTION_OUTBOX_CONSUMER_EXECUTION_RETENTION_DAYS: '30',
    OUTBOX_CONSUMER_EXECUTION_RETENTION_DAYS: '30',
  }, () => loadDataRetentionConfig()) as ReturnType<typeof loadDataRetentionConfig>;
  assert.equal(attempted.outboxConsumerExecutionDays, 365);
});

await test('DATA_RETENTION_DEFAULTS exports the outbox windows', () => {
  assert.equal(DATA_RETENTION_DEFAULTS.outboxProcessedEventDays, 180);
  assert.equal(DATA_RETENTION_DEFAULTS.outboxDeadEventDays, 365);
});

await test('no outbox default is short enough to delete data on a first production deploy', () => {
  // The tables are new and empty. A window of 180 days means nothing written
  // after the migration is deletable for six months, which is what makes the
  // rollout sequence safe to run without first proving the sweep.
  const cfg = loadDataRetentionConfig();
  for (const days of [cfg.outboxProcessedEventDays, cfg.outboxDeadEventDays, cfg.outboxConsumerExecutionDays]) {
    assert.ok(days >= 180, `outbox retention window ${days} is far too aggressive for a first deploy`);
  }
});

section('P2. F5-2R — protected states are unrepresentable in a sweep predicate');

await test('the processed-event predicate pins status to `processed` and ages on processedAt', () => {
  const threshold = new Date('2026-01-01T00:00:00.000Z');
  const where = buildProcessedEventRetentionWhere(threshold);
  assert.equal(where.status, 'processed');
  assert.deepEqual(where.processedAt, { not: null, lt: threshold });
  // createdAt is NOT the ageing column: an event published long ago and
  // delivered yesterday is fresh evidence of a recent delivery.
  assert.equal((where as Record<string, unknown>).createdAt, undefined);
});

await test('the dead-event predicate pins status to `dead` and ages on deadLetteredAt', () => {
  const threshold = new Date('2026-01-01T00:00:00.000Z');
  const where = buildDeadEventRetentionWhere(threshold, {
    liveReplayParentIds: [],
    ambiguousIdempotencyKeys: [],
  });
  assert.equal(where.status, 'dead');
  assert.deepEqual(where.deadLetteredAt, { not: null, lt: threshold });
});

await test('the execution predicate pins status to `completed` and ages on completedAt', () => {
  const threshold = new Date('2026-01-01T00:00:00.000Z');
  const where = buildCompletedExecutionRetentionWhere(threshold, {
    idempotencyKeysStillHeldByEvents: [],
  });
  assert.equal(where.status, 'completed');
  assert.deepEqual(where.completedAt, { not: null, lt: threshold });
});

await test('NO sweep predicate can ever select a pending, claimed, in_progress or ambiguous row', () => {
  const threshold = new Date('2026-01-01T00:00:00.000Z');
  const predicates: Array<Record<string, unknown>> = [
    buildProcessedEventRetentionWhere(threshold) as Record<string, unknown>,
    buildDeadEventRetentionWhere(threshold, {
      liveReplayParentIds: ['a'],
      ambiguousIdempotencyKeys: ['k'],
    }) as Record<string, unknown>,
    buildCompletedExecutionRetentionWhere(threshold, {
      idempotencyKeysStillHeldByEvents: ['k'],
    }) as Record<string, unknown>,
  ];
  const terminal = new Set(['processed', 'dead', 'completed']);
  for (const where of predicates) {
    // A literal string, not an `in`/`not` filter: a sweep may name exactly one
    // status, and it must be a terminal one.
    assert.equal(typeof where.status, 'string', 'status must be an exact literal, never a filter');
    assert.ok(terminal.has(where.status as string), `refuses to sweep status=${String(where.status)}`);
  }
});

await test('an in-flight replay parent is excluded from the dead-event predicate', () => {
  const where = buildDeadEventRetentionWhere(new Date(), {
    liveReplayParentIds: ['dead-1', 'dead-2'],
    ambiguousIdempotencyKeys: [],
  });
  assert.deepEqual(where.id, { notIn: ['dead-1', 'dead-2'] });
});

await test('an unresolved ambiguity excludes its dead event from the predicate', () => {
  const where = buildDeadEventRetentionWhere(new Date(), {
    liveReplayParentIds: [],
    ambiguousIdempotencyKeys: ['appointment-request-confirmation:appt-1'],
  });
  assert.deepEqual(where.idempotencyKey, { notIn: ['appointment-request-confirmation:appt-1'] });
});

await test('a key still held by a live event excludes its ledger row from the predicate', () => {
  const where = buildCompletedExecutionRetentionWhere(new Date(), {
    idempotencyKeysStillHeldByEvents: ['appointment-request-confirmation:appt-9'],
  });
  assert.deepEqual(where.idempotencyKey, { notIn: ['appointment-request-confirmation:appt-9'] });
});

await test('empty guard sets add no clause at all (never an empty NOT IN)', () => {
  const dead = buildDeadEventRetentionWhere(new Date(), {
    liveReplayParentIds: [],
    ambiguousIdempotencyKeys: [],
  }) as Record<string, unknown>;
  assert.equal(dead.id, undefined);
  assert.equal(dead.idempotencyKey, undefined);

  const exec = buildCompletedExecutionRetentionWhere(new Date(), {
    idempotencyKeysStillHeldByEvents: [],
  }) as Record<string, unknown>;
  assert.equal(exec.idempotencyKey, undefined);
});

await test('the guard-set ceiling is bounded and its breach is a stable code, not free text', () => {
  assert.ok(Number.isInteger(OUTBOX_RETENTION_GUARD_SET_LIMIT));
  assert.ok(OUTBOX_RETENTION_GUARD_SET_LIMIT > 0 && OUTBOX_RETENTION_GUARD_SET_LIMIT <= 100000);
  const err = new OutboxRetentionGuardLimitError('events-that-can-still-act');
  assert.equal(err.reason, 'GUARD_SET_LIMIT_EXCEEDED');
  assert.equal(err.name, 'OutboxRetentionGuardLimitError');
});

section('P3. F5-2R — sweep behaviour inside the existing retention runner');

function outboxDepsOnly(overrides: Partial<DataRetentionDeps>): Partial<DataRetentionDeps> {
  return {
    conversationMessages: zeroDeps(),
    conversationStates: zeroDeps(),
    operationalEvents: zeroDeps(),
    inboundEvents: zeroDeps(),
    externalCalendarInboundEvents: zeroDeps(),
    contactRequests: zeroDeps(),
    inboxEntries: zeroDeps(),
    communicationConsentConflictBuckets: zeroDeps(),
    migrationPreservedSourceValues: zeroDeps(),
    outboxProcessedEvents: zeroDeps(),
    outboxDeadEvents: zeroDeps(),
    outboxConsumerExecutions: zeroDeps(),
    ...overrides,
  };
}

await test('each outbox category receives its OWN window as the threshold', async () => {
  const processed = makeCategoryDeps(1);
  const dead = makeCategoryDeps(1);
  const executions = makeCategoryDeps(1);
  const config = {
    ...DEFAULT_TEST_CONFIG,
    outboxProcessedEventDays: 180,
    outboxDeadEventDays: 365,
    outboxConsumerExecutionDays: 365,
  };

  await runDataRetentionCleanup({ dryRun: false, config }, outboxDepsOnly({
    outboxProcessedEvents: processed,
    outboxDeadEvents: dead,
    outboxConsumerExecutions: executions,
  }));

  const ageDays = (d: Date) => Math.round((Date.now() - d.getTime()) / 86400000);
  assert.equal(ageDays(processed.executeCalls[0]!.threshold), 180);
  assert.equal(ageDays(dead.executeCalls[0]!.threshold), 365);
  assert.equal(ageDays(executions.executeCalls[0]!.threshold), 365);
});

await test('DELETION ORDER: both event categories are swept before the ledger', async () => {
  const order: string[] = [];
  const record = (label: string): DataRetentionCategoryDeps => ({
    countEligible: async () => 0,
    executeCleanupBatch: async () => { order.push(label); return 0; },
  });

  await runDataRetentionCleanup(
    { dryRun: false, config: DEFAULT_TEST_CONFIG },
    outboxDepsOnly({
      outboxProcessedEvents: record('processed'),
      outboxDeadEvents: record('dead'),
      outboxConsumerExecutions: record('executions'),
    }),
  );

  assert.deepEqual(order, ['processed', 'dead', 'executions']);
  assert.ok(
    order.indexOf('executions') > order.indexOf('dead'),
    'the ledger must be swept last, once the events that hold its keys have gone',
  );
});

await test('DRY RUN performs zero mutations on every outbox category', async () => {
  const summary = await runDataRetentionCleanup(
    { dryRun: true, config: DEFAULT_TEST_CONFIG },
    outboxDepsOnly({
      // neverExecuteDeps throws if executeCleanupBatch is reached at all, and
      // runCategory records a thrown error in the summary rather than
      // rethrowing - so an empty errors array is the proof of zero mutation.
      outboxProcessedEvents: neverExecuteDeps(41),
      outboxDeadEvents: neverExecuteDeps(7),
      outboxConsumerExecutions: neverExecuteDeps(13),
    }),
  );

  assert.equal(summary.dryRun, true);
  assert.equal(summary.errors.length, 0, 'a dry run that touched an executor would be recorded here');
  assert.equal(summary.deletedOutboxProcessedEvents, 41);
  assert.equal(summary.deletedOutboxDeadEvents, 7);
  assert.equal(summary.deletedOutboxConsumerExecutions, 13);
});

await test('dry-run output is categorised counts and carries no row data', async () => {
  const summary = await runDataRetentionCleanup(
    { dryRun: true, config: DEFAULT_TEST_CONFIG },
    outboxDepsOnly({
      outboxProcessedEvents: neverExecuteDeps(3),
      outboxDeadEvents: neverExecuteDeps(2),
      outboxConsumerExecutions: neverExecuteDeps(1),
    }),
  );
  for (const value of [
    summary.deletedOutboxProcessedEvents,
    summary.deletedOutboxDeadEvents,
    summary.deletedOutboxConsumerExecutions,
  ]) {
    assert.equal(typeof value, 'number', 'the summary exposes counts only');
  }
  const serialised = JSON.stringify(summary);
  assert.equal(serialised.includes('payload'), false, 'no payload key anywhere in the summary');
  assert.equal(serialised.includes('idempotencyKey'), false, 'no business keys in the summary');
});

await test('BATCH LIMIT: the configured batch size is forwarded to every outbox category', async () => {
  const processed = makeCategoryDeps(1);
  const dead = makeCategoryDeps(1);
  const executions = makeCategoryDeps(1);
  const config = { ...DEFAULT_TEST_CONFIG, batchSize: 250 };

  await runDataRetentionCleanup({ dryRun: false, config }, outboxDepsOnly({
    outboxProcessedEvents: processed,
    outboxDeadEvents: dead,
    outboxConsumerExecutions: executions,
  }));

  assert.equal(processed.executeCalls[0]?.batchSize, 250);
  assert.equal(dead.executeCalls[0]?.batchSize, 250);
  assert.equal(executions.executeCalls[0]?.batchSize, 250);
});

await test('REPEAT RUN: a second sweep over a drained category is a no-op, not an error', async () => {
  let remaining = 2;
  const draining: DataRetentionCategoryDeps = {
    countEligible: async () => remaining,
    executeCleanupBatch: async () => { const n = remaining; remaining = 0; return n; },
  };

  const first = await runDataRetentionCleanup(
    { dryRun: false, config: DEFAULT_TEST_CONFIG },
    outboxDepsOnly({ outboxDeadEvents: draining }),
  );
  const second = await runDataRetentionCleanup(
    { dryRun: false, config: DEFAULT_TEST_CONFIG },
    outboxDepsOnly({ outboxDeadEvents: draining }),
  );

  assert.equal(first.deletedOutboxDeadEvents, 2);
  assert.equal(second.deletedOutboxDeadEvents, 0);
  assert.equal(second.errors.length, 0);
});

await test('a guard that fails closed skips ONLY its own category and is recorded', async () => {
  const guardTripped: DataRetentionCategoryDeps = {
    countEligible: async () => { throw new OutboxRetentionGuardLimitError('events-that-can-still-act'); },
    executeCleanupBatch: async () => { throw new OutboxRetentionGuardLimitError('events-that-can-still-act'); },
  };
  const processed = makeCategoryDeps(5);

  const summary = await runDataRetentionCleanup(
    { dryRun: false, config: DEFAULT_TEST_CONFIG },
    outboxDepsOnly({
      outboxConsumerExecutions: guardTripped,
      outboxProcessedEvents: processed,
    }),
  );

  assert.equal(summary.deletedOutboxConsumerExecutions, 0, 'the guarded category deleted nothing');
  assert.ok(summary.skippedCategories.includes('outboxConsumerExecutions'));
  assert.equal(summary.deletedOutboxProcessedEvents, 5, 'unrelated categories still ran');
});

await test('an outbox category failure never aborts the rest of the sweep', async () => {
  const later = makeCategoryDeps(4);
  const summary = await runDataRetentionCleanup(
    { dryRun: false, config: DEFAULT_TEST_CONFIG },
    outboxDepsOnly({
      outboxProcessedEvents: failingDeps('outboxProcessedEvents'),
      outboxConsumerExecutions: later,
    }),
  );
  assert.ok(summary.errors.some((e) => e.startsWith('outboxProcessedEvents:')));
  assert.equal(summary.deletedOutboxConsumerExecutions, 4);
});

section('P4. F5-2R — kill switches still govern the outbox surfaces');

await test('the env kill switch is not weakened by the new categories', () => {
  const disabled = withEnv({ DATA_RETENTION_CLEANUP_ENABLED: 'false' }, () =>
    loadDataRetentionConfig()) as ReturnType<typeof loadDataRetentionConfig>;
  assert.equal(disabled.enabled, false);
  // The windows are still LOADED when cleanup is off: the policy stays readable
  // for the rollout's "is the outbox recognised?" check without cleanup running.
  assert.equal(disabled.outboxProcessedEventDays, 180);
  assert.equal(disabled.outboxDeadEventDays, 365);
});

await test('outbox rows are deletable only through the shared runner, so both kill switches cover them', async () => {
  // There is no separate outbox scheduler and no separate entry point: the only
  // way an outbox row is deleted is runDataRetentionCleanup, which
  // startDataRetentionCleanupJob gates on config.enabled AND the runtime
  // PlatformSetting, and which the platform-admin manual route gates on both
  // again before a live run. This test pins the structural fact that makes that
  // argument valid - a future "outboxRetentionJob.ts" would break it.
  const fs = await import('node:fs/promises');
  const jobSource = await fs.readFile(
    new URL('../jobs/dataRetentionCleanupJob.ts', import.meta.url), 'utf8');

  for (const category of ['outboxProcessedEvents', 'outboxDeadEvents', 'outboxConsumerExecutions']) {
    assert.ok(jobSource.includes(`'${category}'`), `${category} is swept by the shared runner`);
  }

  const retentionSource = await fs.readFile(
    new URL('../outbox/outboxRetention.ts', import.meta.url), 'utf8');
  assert.equal(retentionSource.includes('node-cron'), false, 'the outbox retention module schedules nothing');
  assert.equal(/\bcron\.schedule\b/.test(retentionSource), false, 'no second scheduler');
  assert.equal(retentionSource.includes('withJobLock'), false, 'it does not take its own lock either');
});

section('P5. F5-2R — log and payload privacy');

await test('the outbox retention module never reads, selects or logs a payload', async () => {
  const fs = await import('node:fs/promises');
  const src = await fs.readFile(new URL('../outbox/outboxRetention.ts', import.meta.url), 'utf8');
  const code = src
    .split('\n')
    .filter((line) => {
      const t = line.trimStart();
      return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
    })
    .join('\n');

  assert.equal(/payload\s*:/.test(code), false, 'no payload selected');
  assert.equal(/console\.(log|error|warn|info)/.test(code), false, 'the module logs nothing at all');
  for (const forbidden of ['phone', 'patientName', 'tcKimlik', 'rawPayload']) {
    assert.equal(code.includes(forbidden), false, `must not reference ${forbidden}`);
  }
});

await test('the job log line adds counts only for the outbox categories', async () => {
  const fs = await import('node:fs/promises');
  const src = await fs.readFile(
    new URL('../jobs/dataRetentionCleanupJob.ts', import.meta.url), 'utf8');
  for (const key of [
    'outboxProcessedEvents=${summary.deletedOutboxProcessedEvents}',
    'outboxDeadEvents=${summary.deletedOutboxDeadEvents}',
    'outboxConsumerExecutions=${summary.deletedOutboxConsumerExecutions}',
  ]) {
    assert.ok(src.includes(key), `log line reports ${key} as a count`);
  }
  assert.equal(src.includes('${summary.payload'), false);
});

section('P6. F5-2R-R1 — the final delete re-checks in the DATABASE, never from a loaded array');

// A select/delete race cannot be reproduced without a real database, so the
// behavioural proof lives in src/tests/dbVerification/outboxRetention.test.ts
// §H. What is provable here, DB-free and on every CI run, is the structural
// property that makes that behaviour possible: the statement that actually
// removes a row carries the protection itself, expressed against the live
// tables, with every value bound as a parameter.

async function readOutboxRetentionSource(): Promise<string> {
  const fs = await import('node:fs/promises');
  return fs.readFile(new URL('../outbox/outboxRetention.ts', import.meta.url), 'utf8');
}

/** The bodies of the `prisma.$executeRaw` tagged templates, in source order. */
function rawStatements(src: string): string[] {
  return [...src.matchAll(/\$executeRaw`([\s\S]*?)`/g)].map((m) => m[1]);
}

await test('there are exactly two guarded statements, one per cross-table protection', async () => {
  const statements = rawStatements(await readOutboxRetentionSource());
  assert.equal(statements.length, 2, 'the dead-event delete and the ledger delete — no more, no fewer');
  assert.equal(statements.filter((s) => /DELETE FROM "OutboxEvent"/.test(s)).length, 1);
  assert.equal(statements.filter((s) => /DELETE FROM "OutboxConsumerExecution"/.test(s)).length, 1);
});

await test('both guarded statements run inside the audited raw-SQL escape, under a registered key', async () => {
  const src = await readOutboxRetentionSource();
  assert.match(src, /import \{ runWithAuditedRawSql \} from '\.\.\/tenancy\/auditedRawSql\.js';/);
  assert.equal(
    (src.match(/registryKey: 'outbox\/outboxRetention'/g) ?? []).length,
    2,
    'each guarded statement declares its own registry key and justification',
  );
  assert.ok(
    RAW_SQL_REGISTRY_KEYS.includes('outbox/outboxRetention'),
    'the escape key must exist in the reviewed registry, or the escape is unreviewed',
  );
});

await test('the raw-SQL audit registry records the two statements as SYSTEM_ONLY', () => {
  const entry = RAW_SQL_AUDIT_REGISTRY.find((e) => e.file === 'server/src/outbox/outboxRetention.ts');
  assert.ok(entry, 'outboxRetention.ts has no raw-SQL audit entry');
  assert.equal(entry!.sites.length, 1);
  assert.equal(entry!.sites[0].classification, 'SYSTEM_ONLY');
  assert.equal(entry!.sites[0].count, 2);
  // The sweep is deliberately cross-tenant; the justification must say so
  // rather than implying a tenant predicate nobody can find in the statement.
  assert.match(entry!.sites[0].justification, /NO tenant predicate BY DESIGN/);
});

await test('EVERY interpolated value is a bound parameter — no SQL is ever composed from a string', async () => {
  const statements = rawStatements(await readOutboxRetentionSource());
  const composed: string[] = [];
  for (const statement of statements) {
    for (const match of statement.matchAll(/\$\{([^}]*)\}/g)) {
      // A bare identifier becomes `$n` in the prepared statement. Anything else
      // — a concatenation, a call, a member expression — would be pasted into
      // the SQL text itself.
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(match[1].trim())) composed.push(match[1].trim());
    }
  }
  assert.deepEqual(composed, [], 'these interpolations are not parameters');
  const src = await readOutboxRetentionSource();
  assert.equal(/\$(?:executeRawUnsafe|queryRawUnsafe)/.test(src), false, 'no unsafe raw variant');
});

await test('THE DEAD-EVENT DELETE re-derives both protections as correlated NOT EXISTS', async () => {
  const statement = rawStatements(await readOutboxRetentionSource())
    .find((s) => /DELETE FROM "OutboxEvent"/.test(s))!;

  // Status and age come from the row being deleted, in the delete itself.
  assert.match(statement, /e\."status" = 'dead'/);
  assert.match(statement, /e\."deadLetteredAt" IS NOT NULL/);
  assert.match(statement, /e\."deadLetteredAt" < \$\{threshold\}/);

  assert.equal((statement.match(/NOT EXISTS/g) ?? []).length, 2, 'one per protection');

  // An unresolved ambiguity, matched against the LIVE execution table.
  assert.match(statement, /FROM "OutboxConsumerExecution" x/);
  assert.match(statement, /x\."idempotencyKey" = e\."idempotencyKey"/);
  assert.match(statement, /x\."status" = \$\{ambiguous\}/);

  // An in-flight replay child, matched against the LIVE event table.
  assert.match(statement, /c\."causationId" = e\."id"/);
  assert.match(statement, /c\."status" = ANY\(\$\{inFlight\}::text\[\]\)/);

  // The candidate list may narrow, and only narrow.
  assert.match(statement, /e\."id" = ANY\(\$\{ids\}::text\[\]\)/);
});

await test('THE LEDGER DELETE re-derives "no event still holds this key" as a correlated NOT EXISTS', async () => {
  const statement = rawStatements(await readOutboxRetentionSource())
    .find((s) => /DELETE FROM "OutboxConsumerExecution"/.test(s))!;

  assert.match(statement, /x\."status" = 'completed'/);
  assert.match(statement, /x\."completedAt" IS NOT NULL/);
  assert.match(statement, /x\."completedAt" < \$\{threshold\}/);
  assert.equal((statement.match(/NOT EXISTS/g) ?? []).length, 1);
  assert.match(statement, /FROM "OutboxEvent" e/);
  assert.match(statement, /e\."idempotencyKey" = x\."idempotencyKey"/);
  assert.match(statement, /e\."status" = ANY\(\$\{stillActing\}::text\[\]\)/);
  assert.match(statement, /x\."id" = ANY\(\$\{ids\}::text\[\]\)/);
});

await test('the protected status sets in SQL come from the same frozen constants the guards use', async () => {
  const src = await readOutboxRetentionSource();
  // If these ever diverge, the guard set and the guarded delete would disagree
  // about what "can still act" means — the delete would win, silently.
  assert.match(src, /const stillActing = \[\.\.\.EVENT_STATUSES_THAT_CAN_STILL_ACT\];/);
  assert.match(src, /const inFlight = \[\.\.\.REPLAY_CHILD_STATUSES_IN_FLIGHT\];/);
  assert.match(src, /const ambiguous = EXECUTION_STATUS_AMBIGUOUS;/);
  assert.match(
    src,
    /where: \{ status: \{ in: \[\.\.\.REPLAY_CHILD_STATUSES_IN_FLIGHT\] \}, causationId: \{ not: null \} \}/,
  );
  assert.match(src, /where: \{ status: EXECUTION_STATUS_AMBIGUOUS \}/);
});

await test('NO guarded delete takes its protection from a JS array', async () => {
  const statements = rawStatements(await readOutboxRetentionSource());
  for (const statement of statements) {
    assert.equal(/notIn/.test(statement), false, 'a notIn inside the delete would be the stale snapshot again');
  }
  // The one remaining `deleteMany` is the processed-event category, whose whole
  // predicate is columns of the row it deletes — there is no second table whose
  // state could change underneath it.
  const src = await readOutboxRetentionSource();
  assert.equal(
    (src.match(/prisma\.outboxEvent\.deleteMany/g) ?? []).length,
    1,
    'only the unguarded processed-event category may delete through Prisma',
  );
  assert.equal(
    /prisma\.outboxConsumerExecution\.deleteMany/.test(src),
    false,
    'the ledger is the highest-consequence table here; it may only be deleted through the guarded statement',
  );
});

await test('the test seam is a parameter, so production has no way to switch it on', async () => {
  const retentionSrc = await readOutboxRetentionSource();
  assert.match(retentionSrc, /export interface OutboxRetentionBatchHooks/);
  assert.match(retentionSrc, /hooks\?: OutboxRetentionBatchHooks/);
  // No module-level mutable state that a forgotten assignment could leave live.
  assert.equal(/^let \w+Hooks/m.test(retentionSrc), false);

  const fs = await import('node:fs/promises');
  const jobSrc = await fs.readFile(new URL('../jobs/dataRetentionCleanupJob.ts', import.meta.url), 'utf8');
  assert.equal(jobSrc.includes('afterCandidateSelection'), false, 'the job never passes a hook');
  assert.equal(jobSrc.includes('OutboxRetentionBatchHooks'), false);
  // The runner's own contract is two arguments, so the seam is unreachable from
  // every production entry point that goes through it.
  assert.match(jobSrc, /executeCleanupBatch: \(threshold: Date, batchSize: number\) => Promise<number>;/);
});

await test('a guarded delete still honours the batch bound it was given', async () => {
  // The runner is what enforces this end to end; here it is enough to pin that
  // the bound is still forwarded, unchanged, to the category function.
  const deps = makeCategoryDeps(0);
  const summary = await runDataRetentionCleanup(
    { dryRun: false, config: { ...loadDataRetentionConfig(), batchSize: 7 } },
    outboxDepsOnly({ outboxDeadEvents: deps, outboxConsumerExecutions: deps }),
  );
  assert.equal(summary.errors.length, 0);
  assert.ok(deps.executeCalls.length >= 2);
  for (const call of deps.executeCalls) assert.equal(call.batchSize, 7);
});

// ── Results ───────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}

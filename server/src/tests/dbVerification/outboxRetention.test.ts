/**
 * outboxRetention.test.ts — F5-2R against a REAL PostgreSQL.
 *
 * The contract layer (policy defaults, the derived consumer-execution window,
 * the shape of every WHERE predicate, dry-run/batch/kill-switch behaviour
 * through the shared runner) is proved DB-free in
 * `tests/dataRetentionCleanupJob.test.ts` and is deliberately not repeated.
 *
 * What is here is everything that a predicate object cannot prove:
 *
 *   - that a `pending` or `claimed` row genuinely survives a sweep at ANY age,
 *     against the real table the sweep runs on;
 *   - that the two event windows are genuinely different, by putting one row in
 *     the gap between them and watching it stay;
 *   - THE REPLAY INVARIANT: that there is no reachable state in which an
 *     OutboxEvent still exists while its business idempotency record has been
 *     deleted. That is a claim about two tables interacting under a real
 *     sweep, and a mock cannot falsify it;
 *   - that a dry run over a populated table mutates nothing;
 *   - that a batch-limited sweep makes bounded, resumable progress.
 *
 * Run: npx tsx src/tests/dbVerification/outboxRetention.test.ts
 * Requires DATABASE_URL to point at a disposable Postgres before import.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import {
  createSuite,
  createClinicFixtureSet,
  cleanupAllFixtures,
  prisma,
  type ClinicFixtureSet,
} from './dbVerificationHarness.js';

import {
  countEligibleProcessedOutboxEvents,
  deleteProcessedOutboxEventBatch,
  countEligibleDeadOutboxEvents,
  deleteDeadOutboxEventBatch,
  countEligibleCompletedConsumerExecutions,
  deleteCompletedConsumerExecutionBatch,
} from '../../outbox/outboxRetention.js';

import { loadDataRetentionConfig } from '../../services/privacy/dataRetentionPolicy.js';
import { runDataRetentionCleanup, type DataRetentionCategoryDeps } from '../../jobs/dataRetentionCleanupJob.js';

const { section, test, summary } = createSuite('outboxRetention');

const EVENT_TYPE = 'appointment_request.confirmation_requested';
const EVENT_VERSION = 1;
const CONSUMER_KEY = 'appointment-request-confirmation';

let fixtures: ClinicFixtureSet;

const CONFIG = loadDataRetentionConfig();

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/** Threshold the job would compute for each category, from the real defaults. */
function thresholds() {
  return {
    processed: daysAgo(CONFIG.outboxProcessedEventDays),
    dead: daysAgo(CONFIG.outboxDeadEventDays),
    executions: daysAgo(CONFIG.outboxConsumerExecutionDays),
  };
}

/**
 * Every test starts from an empty outbox for THIS fixture's organizations. The
 * sweep is global by design — a retention job that could only see one tenant
 * could not clean the table — so tests assert on specific row ids rather than
 * on table-wide counts, and clear their own rows between scenarios.
 */
async function resetOutboxTables(): Promise<void> {
  const orgIds = [fixtures.orgId, fixtures.otherOrgId];
  await prisma.outboxEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.outboxConsumerExecution.deleteMany({ where: { organizationId: { in: orgIds } } });
}

interface MakeEventArgs {
  status: 'pending' | 'claimed' | 'processed' | 'dead';
  ageDays: number;
  organizationId?: string;
  clinicId?: string | null;
  idempotencyKey?: string;
  causationId?: string | null;
  leaseExpiresAt?: Date | null;
}

/**
 * A row written directly rather than through the producer: retention reasons
 * about STORED lifecycle state, and driving a row into `dead` via the real
 * dispatcher would prove the dispatcher, which `outboxDispatcher.test.ts`
 * already does.
 *
 * The payload is a real, contract-valid identifier-only payload so that the
 * "nothing ever reads or returns a payload" assertions have something that
 * WOULD be visible if the claim were false.
 */
async function makeEvent(args: MakeEventArgs): Promise<string> {
  const at = daysAgo(args.ageDays);
  const organizationId = args.organizationId ?? fixtures.orgId;
  const appointmentId = randomUUID();

  const row = await prisma.outboxEvent.create({
    data: {
      organizationId,
      clinicId: args.clinicId === undefined ? fixtures.defaultClinicId : args.clinicId,
      eventType: EVENT_TYPE,
      eventVersion: EVENT_VERSION,
      aggregateType: 'AppointmentRequest',
      aggregateId: randomUUID(),
      payload: { appointmentRequestId: randomUUID(), appointmentId },
      idempotencyKey: args.idempotencyKey ?? `${CONSUMER_KEY}:${appointmentId}`,
      dedupeKey: null,
      causationId: args.causationId ?? null,
      status: args.status,
      occurredAt: at,
      availableAt: at,
      processedAt: args.status === 'processed' ? at : null,
      deadLetteredAt: args.status === 'dead' ? at : null,
      deadLetterCode: args.status === 'dead' ? 'MAX_ATTEMPTS_EXCEEDED' : null,
      claimedAt: args.status === 'claimed' ? at : null,
      claimedBy: args.status === 'claimed' ? 'outbox-dispatcher:test:0' : null,
      leaseExpiresAt: args.leaseExpiresAt ?? null,
    },
    select: { id: true },
  });
  return row.id;
}

async function makeExecution(args: {
  status: 'in_progress' | 'completed' | 'ambiguous';
  ageDays: number;
  idempotencyKey: string;
  organizationId?: string;
}): Promise<string> {
  const at = daysAgo(args.ageDays);
  const row = await prisma.outboxConsumerExecution.create({
    data: {
      consumerKey: CONSUMER_KEY,
      idempotencyKey: args.idempotencyKey,
      organizationId: args.organizationId ?? fixtures.orgId,
      clinicId: fixtures.defaultClinicId,
      status: args.status,
      startedAt: at,
      completedAt: args.status === 'completed' ? at : null,
      outcomeCode: args.status === 'completed' ? 'SENT' : args.status === 'ambiguous' ? 'AMBIGUOUS_SIDE_EFFECT' : null,
      leaseExpiresAt: args.status === 'in_progress' ? daysAgo(args.ageDays) : null,
    },
    select: { id: true },
  });
  return row.id;
}

async function eventExists(id: string): Promise<boolean> {
  return (await prisma.outboxEvent.count({ where: { id } })) === 1;
}

async function executionExists(id: string): Promise<boolean> {
  return (await prisma.outboxConsumerExecution.count({ where: { id } })) === 1;
}

/** Sweep every outbox category to exhaustion, in the job's documented order. */
async function sweepAllOutboxCategories(batchSize = CONFIG.batchSize): Promise<void> {
  const t = thresholds();
  for (let i = 0; i < 50; i++) {
    const n = await deleteProcessedOutboxEventBatch(t.processed, batchSize);
    if (n === 0) break;
  }
  for (let i = 0; i < 50; i++) {
    const n = await deleteDeadOutboxEventBatch(t.dead, batchSize);
    if (n === 0) break;
  }
  for (let i = 0; i < 50; i++) {
    const n = await deleteCompletedConsumerExecutionBatch(t.executions, batchSize);
    if (n === 0) break;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

async function scenarioProtectedStates(): Promise<void> {
  section('A. Protected states are never eligible, at any age');

  await test('a `pending` event ten years old is neither counted nor deleted', async () => {
    await resetOutboxTables();
    const id = await makeEvent({ status: 'pending', ageDays: 3650 });

    const t = thresholds();
    assert.equal(await countEligibleProcessedOutboxEvents(t.processed), 0);
    assert.equal(await countEligibleDeadOutboxEvents(t.dead), 0);
    await sweepAllOutboxCategories();

    assert.equal(await eventExists(id), true, 'an undelivered obligation survives every sweep');
    const after = await prisma.outboxEvent.findUniqueOrThrow({ where: { id }, select: { status: true } });
    assert.equal(after.status, 'pending', 'and is not silently transitioned either');
  });

  await test('a `claimed` event with a LIVE lease is not deleted', async () => {
    await resetOutboxTables();
    const id = await makeEvent({
      status: 'claimed',
      ageDays: 3650,
      leaseExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    await sweepAllOutboxCategories();
    assert.equal(await eventExists(id), true);
  });

  await test('a `claimed` event with an EXPIRED lease is not deleted either', async () => {
    // An expired lease is not an abandoned row: it is the crash-recovery
    // mechanism, and reclaimExpiredOutboxLeases will pick it up. Deleting it
    // would destroy work the dispatcher is about to resume.
    await resetOutboxTables();
    const id = await makeEvent({
      status: 'claimed',
      ageDays: 3650,
      leaseExpiresAt: daysAgo(3649),
    });

    await sweepAllOutboxCategories();
    assert.equal(await eventExists(id), true);
  });

  await test('an `in_progress` consumer execution ten years old is not deleted', async () => {
    await resetOutboxTables();
    const key = `${CONSUMER_KEY}:${randomUUID()}`;
    const id = await makeExecution({ status: 'in_progress', ageDays: 3650, idempotencyKey: key });

    const t = thresholds();
    assert.equal(await countEligibleCompletedConsumerExecutions(t.executions), 0);
    await sweepAllOutboxCategories();

    assert.equal(await executionExists(id), true, 'a side effect may be in flight');
  });

  await test('an `ambiguous` consumer execution is not deleted — it is an open operator question', async () => {
    await resetOutboxTables();
    const key = `${CONSUMER_KEY}:${randomUUID()}`;
    const id = await makeExecution({ status: 'ambiguous', ageDays: 3650, idempotencyKey: key });

    await sweepAllOutboxCategories();
    assert.equal(await executionExists(id), true);
  });
}

async function scenarioWindows(): Promise<void> {
  section('B. Terminal states age out on their own window');

  await test('a `processed` event past the processed window is counted and deleted', async () => {
    await resetOutboxTables();
    const id = await makeEvent({ status: 'processed', ageDays: CONFIG.outboxProcessedEventDays + 20 });

    assert.equal(await countEligibleProcessedOutboxEvents(thresholds().processed), 1);
    assert.equal(await deleteProcessedOutboxEventBatch(thresholds().processed, CONFIG.batchSize), 1);
    assert.equal(await eventExists(id), false);
  });

  await test('a `processed` event inside the window is retained', async () => {
    await resetOutboxTables();
    const id = await makeEvent({ status: 'processed', ageDays: 10 });

    assert.equal(await countEligibleProcessedOutboxEvents(thresholds().processed), 0);
    await sweepAllOutboxCategories();
    assert.equal(await eventExists(id), true);
  });

  await test('a `dead` event past the DEAD window is counted and deleted', async () => {
    await resetOutboxTables();
    const id = await makeEvent({ status: 'dead', ageDays: CONFIG.outboxDeadEventDays + 20 });

    assert.equal(await countEligibleDeadOutboxEvents(thresholds().dead), 1);
    assert.equal(await deleteDeadOutboxEventBatch(thresholds().dead, CONFIG.batchSize), 1);
    assert.equal(await eventExists(id), false);
  });

  await test('THE TWO WINDOWS ARE GENUINELY DIFFERENT: a dead event in the gap survives', async () => {
    // Older than the processed window, younger than the dead window. If the two
    // categories shared a threshold — or if the dead sweep matched on status
    // loosely — this row would disappear. It must not: a lost obligation is
    // retained longer than a discharged one, on purpose.
    await resetOutboxTables();
    const gapAge = Math.floor((CONFIG.outboxProcessedEventDays + CONFIG.outboxDeadEventDays) / 2);
    assert.ok(
      gapAge > CONFIG.outboxProcessedEventDays && gapAge < CONFIG.outboxDeadEventDays,
      'the defaults must actually leave a gap for this test to mean anything',
    );
    const id = await makeEvent({ status: 'dead', ageDays: gapAge });

    assert.equal(await countEligibleDeadOutboxEvents(thresholds().dead), 0);
    await sweepAllOutboxCategories();
    assert.equal(await eventExists(id), true);
  });

  await test('a `completed` execution past its window, with no event left, is deleted', async () => {
    await resetOutboxTables();
    const key = `${CONSUMER_KEY}:${randomUUID()}`;
    const id = await makeExecution({
      status: 'completed',
      ageDays: CONFIG.outboxConsumerExecutionDays + 20,
      idempotencyKey: key,
    });

    assert.equal(await countEligibleCompletedConsumerExecutions(thresholds().executions), 1);
    assert.equal(await deleteCompletedConsumerExecutionBatch(thresholds().executions, CONFIG.batchSize), 1);
    assert.equal(await executionExists(id), false);
  });

  await test('a `completed` execution inside its window is retained', async () => {
    await resetOutboxTables();
    const key = `${CONSUMER_KEY}:${randomUUID()}`;
    const id = await makeExecution({ status: 'completed', ageDays: 10, idempotencyKey: key });

    assert.equal(await countEligibleCompletedConsumerExecutions(thresholds().executions), 0);
    await sweepAllOutboxCategories();
    assert.equal(await executionExists(id), true);
  });
}

async function scenarioReplayInvariant(): Promise<void> {
  section('C. THE REPLAY INVARIANT — an event never outlives its own idempotency record');

  for (const holder of ['pending', 'claimed', 'dead'] as const) {
    await test(`a ledger row is NOT deleted while a \`${holder}\` event still holds its key`, async () => {
      await resetOutboxTables();
      const key = `${CONSUMER_KEY}:${randomUUID()}`;

      // Both far past their windows. Age alone would make the ledger row
      // eligible; the guard is the only thing keeping it.
      const executionId = await makeExecution({
        status: 'completed',
        ageDays: CONFIG.outboxConsumerExecutionDays + 500,
        idempotencyKey: key,
      });
      await makeEvent({
        status: holder,
        ageDays: 3650,
        idempotencyKey: key,
        leaseExpiresAt: holder === 'claimed' ? new Date(Date.now() + 60_000) : null,
      });

      assert.equal(
        await countEligibleCompletedConsumerExecutions(thresholds().executions),
        0,
        'the dry-run count must agree with the delete, or an operator is told a lie',
      );
      assert.equal(await deleteCompletedConsumerExecutionBatch(thresholds().executions, CONFIG.batchSize), 0);
      assert.equal(await executionExists(executionId), true);
    });
  }

  await test('a `processed` event does NOT pin the ledger — it can no longer cause a side effect', async () => {
    await resetOutboxTables();
    const key = `${CONSUMER_KEY}:${randomUUID()}`;
    const executionId = await makeExecution({
      status: 'completed',
      ageDays: CONFIG.outboxConsumerExecutionDays + 500,
      idempotencyKey: key,
    });
    // Young enough that the event sweep will not remove it: the ledger row must
    // become deletable because of the event's STATUS, not because the event
    // happens to have been cleaned up first.
    const eventId = await makeEvent({ status: 'processed', ageDays: 5, idempotencyKey: key });

    assert.equal(await countEligibleCompletedConsumerExecutions(thresholds().executions), 1);
    assert.equal(await deleteCompletedConsumerExecutionBatch(thresholds().executions, CONFIG.batchSize), 1);
    assert.equal(await executionExists(executionId), false);
    assert.equal(await eventExists(eventId), true, 'and the processed event itself is untouched');
  });

  await test('END TO END: the dead event goes first, and only then does its ledger row become eligible', async () => {
    // This is the invariant stated as a sequence. If the ledger were swept
    // first, there would be a window — a whole day, in production — during
    // which a replay of the still-present dead event would re-send a message
    // the patient already received, with nothing to stop it.
    await resetOutboxTables();
    const key = `${CONSUMER_KEY}:${randomUUID()}`;
    const executionId = await makeExecution({
      status: 'completed',
      ageDays: CONFIG.outboxConsumerExecutionDays + 500,
      idempotencyKey: key,
    });
    const deadId = await makeEvent({
      status: 'dead',
      ageDays: CONFIG.outboxDeadEventDays + 500,
      idempotencyKey: key,
    });

    // Step 1: the ledger sweep, run FIRST and out of order on purpose.
    assert.equal(await deleteCompletedConsumerExecutionBatch(thresholds().executions, CONFIG.batchSize), 0);
    assert.equal(await executionExists(executionId), true, 'the guard refuses even when asked out of order');
    assert.equal(await eventExists(deadId), true);

    // Step 2: the dead event ages out.
    assert.equal(await deleteDeadOutboxEventBatch(thresholds().dead, CONFIG.batchSize), 1);
    assert.equal(await eventExists(deadId), false);

    // Step 3: nothing can ask the ledger anything any more, so it may go.
    assert.equal(await deleteCompletedConsumerExecutionBatch(thresholds().executions, CONFIG.batchSize), 1);
    assert.equal(await executionExists(executionId), false);
  });
}

async function scenarioDeadEventGuards(): Promise<void> {
  section('D. A dead event with unresolved operator work is protected past its window');

  await test('an UNRESOLVED ambiguity keeps its dead event alive past the dead window', async () => {
    await resetOutboxTables();
    const key = `${CONSUMER_KEY}:${randomUUID()}`;
    const deadId = await makeEvent({
      status: 'dead',
      ageDays: CONFIG.outboxDeadEventDays + 500,
      idempotencyKey: key,
    });
    const ambiguousId = await makeExecution({ status: 'ambiguous', ageDays: 3650, idempotencyKey: key });

    assert.equal(await countEligibleDeadOutboxEvents(thresholds().dead), 0);
    await sweepAllOutboxCategories();

    assert.equal(await eventExists(deadId), true, 'the operator still needs this row to act on');
    assert.equal(await executionExists(ambiguousId), true);
  });

  await test('once the ambiguity is resolved, the dead event ages out normally', async () => {
    await resetOutboxTables();
    const key = `${CONSUMER_KEY}:${randomUUID()}`;
    const deadId = await makeEvent({
      status: 'dead',
      ageDays: CONFIG.outboxDeadEventDays + 500,
      idempotencyKey: key,
    });
    // Resolution, exactly as replayDeadOutboxEvent performs it: the ambiguous
    // marker is deleted when an operator acknowledges it.
    const ambiguousId = await makeExecution({ status: 'ambiguous', ageDays: 3650, idempotencyKey: key });
    await prisma.outboxConsumerExecution.delete({ where: { id: ambiguousId } });

    assert.equal(await countEligibleDeadOutboxEvents(thresholds().dead), 1);
    assert.equal(await deleteDeadOutboxEventBatch(thresholds().dead, CONFIG.batchSize), 1);
    assert.equal(await eventExists(deadId), false);
  });

  await test('an IN-FLIGHT replay keeps its dead parent alive past the dead window', async () => {
    await resetOutboxTables();
    const key = `${CONSUMER_KEY}:${randomUUID()}`;
    const deadId = await makeEvent({
      status: 'dead',
      ageDays: CONFIG.outboxDeadEventDays + 500,
      idempotencyKey: key,
    });
    const replayId = await makeEvent({
      status: 'pending',
      ageDays: 0,
      idempotencyKey: key,
      causationId: deadId,
    });

    assert.equal(await countEligibleDeadOutboxEvents(thresholds().dead), 0);
    await sweepAllOutboxCategories();

    assert.equal(await eventExists(deadId), true, 'the causation chain must stay readable while the replay runs');
    assert.equal(await eventExists(replayId), true);
  });

  await test('a SETTLED replay child no longer pins its dead parent', async () => {
    await resetOutboxTables();
    const key = `${CONSUMER_KEY}:${randomUUID()}`;
    const deadId = await makeEvent({
      status: 'dead',
      ageDays: CONFIG.outboxDeadEventDays + 500,
      idempotencyKey: key,
    });
    // Processed, not pending: the replay finished. Young, so the event sweep
    // will not remove the child and change the answer for the wrong reason.
    await makeEvent({ status: 'processed', ageDays: 1, idempotencyKey: key, causationId: deadId });

    assert.equal(await countEligibleDeadOutboxEvents(thresholds().dead), 1);
    assert.equal(await deleteDeadOutboxEventBatch(thresholds().dead, CONFIG.batchSize), 1);
    assert.equal(await eventExists(deadId), false);
  });
}

async function scenarioDryRunAndBatching(): Promise<void> {
  section('E. Dry run, batching, and repeat runs');

  await test('a DRY RUN over a populated table mutates nothing and still reports honestly', async () => {
    await resetOutboxTables();
    const processedIds = [
      await makeEvent({ status: 'processed', ageDays: CONFIG.outboxProcessedEventDays + 5 }),
      await makeEvent({ status: 'processed', ageDays: CONFIG.outboxProcessedEventDays + 6 }),
    ];
    const deadId = await makeEvent({ status: 'dead', ageDays: CONFIG.outboxDeadEventDays + 5 });
    const pendingId = await makeEvent({ status: 'pending', ageDays: 3650 });

    const zero: DataRetentionCategoryDeps = { countEligible: async () => 0, executeCleanupBatch: async () => 0 };
    const beforeEvents = await prisma.outboxEvent.count({
      where: { organizationId: { in: [fixtures.orgId, fixtures.otherOrgId] } },
    });

    const result = await runDataRetentionCleanup(
      { dryRun: true, config: CONFIG },
      {
        // Only the outbox categories hit the real database here: the rest are
        // stubbed so this suite cannot delete another suite's leftovers.
        conversationMessages: zero,
        conversationStates: zero,
        operationalEvents: zero,
        inboundEvents: zero,
        externalCalendarInboundEvents: zero,
        contactRequests: zero,
        inboxEntries: zero,
        communicationConsentConflictBuckets: zero,
        migrationPreservedSourceValues: zero,
      },
    );

    assert.equal(result.dryRun, true);
    assert.equal(result.errors.length, 0);
    assert.ok(result.deletedOutboxProcessedEvents >= 2, 'the dry run sees the eligible processed rows');
    assert.ok(result.deletedOutboxDeadEvents >= 1);

    assert.equal(
      await prisma.outboxEvent.count({ where: { organizationId: { in: [fixtures.orgId, fixtures.otherOrgId] } } }),
      beforeEvents,
      'a dry run must not delete a single row',
    );
    for (const id of [...processedIds, deadId, pendingId]) {
      assert.equal(await eventExists(id), true);
    }

    // A dry run reports counts. Nothing that could identify a patient, a
    // clinic or a message leaves the sweep.
    const serialised = JSON.stringify(result);
    assert.equal(serialised.includes('appointmentId'), false);
    assert.equal(serialised.includes(CONSUMER_KEY), false);
    assert.equal(serialised.includes(fixtures.orgId), false);
    assert.equal(serialised.includes(fixtures.defaultClinicId), false);
  });

  await test('BATCHING: a batch-limited sweep makes bounded, resumable progress', async () => {
    await resetOutboxTables();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(await makeEvent({ status: 'processed', ageDays: CONFIG.outboxProcessedEventDays + 10 + i }));
    }

    const t = thresholds().processed;
    assert.equal(await deleteProcessedOutboxEventBatch(t, 2), 2, 'never more than the batch size');
    assert.equal(await deleteProcessedOutboxEventBatch(t, 2), 2);
    assert.equal(await deleteProcessedOutboxEventBatch(t, 2), 1, 'the remainder, not a fifth phantom row');
    assert.equal(await deleteProcessedOutboxEventBatch(t, 2), 0, 'and then it is a clean no-op');

    for (const id of ids) assert.equal(await eventExists(id), false);
  });

  await test('REPEAT RUN: sweeping twice reaches the same state, with no error and no over-deletion', async () => {
    await resetOutboxTables();
    const doomed = await makeEvent({ status: 'processed', ageDays: CONFIG.outboxProcessedEventDays + 30 });
    const kept = await makeEvent({ status: 'pending', ageDays: 3650 });
    const keptYoung = await makeEvent({ status: 'processed', ageDays: 3 });

    await sweepAllOutboxCategories();
    const afterFirst = {
      doomed: await eventExists(doomed),
      kept: await eventExists(kept),
      keptYoung: await eventExists(keptYoung),
    };

    await sweepAllOutboxCategories();
    assert.deepEqual(
      { doomed: await eventExists(doomed), kept: await eventExists(kept), keptYoung: await eventExists(keptYoung) },
      afterFirst,
      'the sweep is idempotent',
    );
    assert.equal(afterFirst.doomed, false);
    assert.equal(afterFirst.kept, true);
    assert.equal(afterFirst.keptYoung, true);
  });
}

async function scenarioTenantBehaviour(): Promise<void> {
  section('F. Tenant behaviour of a deliberately global sweep');

  await test('one organization ageing out does not disturb another organization\'s protected rows', async () => {
    await resetOutboxTables();
    const doomedA = await makeEvent({
      status: 'processed',
      ageDays: CONFIG.outboxProcessedEventDays + 40,
      organizationId: fixtures.orgId,
    });
    const protectedB = await makeEvent({
      status: 'pending',
      ageDays: 3650,
      organizationId: fixtures.otherOrgId,
      clinicId: fixtures.crossOrgClinicId,
    });
    const youngB = await makeEvent({
      status: 'processed',
      ageDays: 2,
      organizationId: fixtures.otherOrgId,
      clinicId: fixtures.crossOrgClinicId,
    });

    await sweepAllOutboxCategories();

    assert.equal(await eventExists(doomedA), false);
    assert.equal(await eventExists(protectedB), true);
    assert.equal(await eventExists(youngB), true);
  });

  await test('a ledger row is pinned by an event in ANY organization holding the same key', async () => {
    // Business idempotency keys are derived from an appointment id, so a
    // collision across organizations is not a realistic scenario — but the
    // guard must be safe rather than merely usually-right, and a key-scoped
    // guard that silently became organization-scoped would be a duplicate
    // patient message waiting to happen.
    await resetOutboxTables();
    const key = `${CONSUMER_KEY}:${randomUUID()}`;
    const executionId = await makeExecution({
      status: 'completed',
      ageDays: CONFIG.outboxConsumerExecutionDays + 500,
      idempotencyKey: key,
      organizationId: fixtures.orgId,
    });
    await makeEvent({
      status: 'dead',
      ageDays: 1,
      idempotencyKey: key,
      organizationId: fixtures.otherOrgId,
      clinicId: fixtures.crossOrgClinicId,
    });

    assert.equal(await deleteCompletedConsumerExecutionBatch(thresholds().executions, CONFIG.batchSize), 0);
    assert.equal(await executionExists(executionId), true);
  });
}

async function scenarioPayloadPrivacy(): Promise<void> {
  section('G. Payloads are neither read nor altered');

  await test('a retained row keeps its payload byte-for-byte across a full sweep', async () => {
    await resetOutboxTables();
    const id = await makeEvent({ status: 'pending', ageDays: 3650 });
    const before = await prisma.outboxEvent.findUniqueOrThrow({ where: { id }, select: { payload: true } });

    await sweepAllOutboxCategories();

    const after = await prisma.outboxEvent.findUniqueOrThrow({ where: { id }, select: { payload: true } });
    assert.deepEqual(after.payload, before.payload, 'retention deletes rows; it never edits them');
  });

  await test('every eligibility count is a number, computed without returning a payload', async () => {
    await resetOutboxTables();
    await makeEvent({ status: 'processed', ageDays: CONFIG.outboxProcessedEventDays + 3 });
    await makeEvent({ status: 'dead', ageDays: CONFIG.outboxDeadEventDays + 3 });
    const key = `${CONSUMER_KEY}:${randomUUID()}`;
    await makeExecution({ status: 'completed', ageDays: CONFIG.outboxConsumerExecutionDays + 3, idempotencyKey: key });

    const t = thresholds();
    for (const value of [
      await countEligibleProcessedOutboxEvents(t.processed),
      await countEligibleDeadOutboxEvents(t.dead),
      await countEligibleCompletedConsumerExecutions(t.executions),
    ]) {
      assert.equal(typeof value, 'number');
      assert.ok(value >= 1);
    }
  });
}

async function main(): Promise<void> {
  fixtures = await createClinicFixtureSet('outbox-retention');

  await scenarioProtectedStates();
  await scenarioWindows();
  await scenarioReplayInvariant();
  await scenarioDeadEventGuards();
  await scenarioDryRunAndBatching();
  await scenarioTenantBehaviour();
  await scenarioPayloadPrivacy();

  const ok = summary();
  await resetOutboxTables();
  await cleanupAllFixtures();
  await prisma.$disconnect();
  process.exit(ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error('FATAL:', err);
  await cleanupAllFixtures().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});

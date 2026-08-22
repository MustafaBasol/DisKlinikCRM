/**
 * outboxDispatcher.test.ts — F5-2 against a REAL PostgreSQL.
 *
 * Everything here is a guarantee that cannot honestly be proved without a
 * database. Transactional atomicity is a property of a transaction, not of a
 * mock. "Two dispatchers cannot claim the same row" is a property of
 * `FOR UPDATE SKIP LOCKED` under genuine concurrent connections — a
 * single-threaded JavaScript test against a fake client proves only that
 * JavaScript is single-threaded. A unique constraint is either enforced by
 * Postgres or it is a comment.
 *
 * The contract layer (registry, payload allowlist, retry policy, flag
 * semantics, structural guards) is proved DB-free in `tests/outboxContracts.test.ts`
 * and is deliberately not repeated here.
 *
 * Run: npx tsx src/tests/dbVerification/outboxDispatcher.test.ts
 * Requires DATABASE_URL to point at a disposable Postgres before import.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import {
  createSuite,
  createClinicFixtureSet,
  createStaffUser,
  createTestPatient,
  cleanupAllFixtures,
  prisma,
  type ClinicFixtureSet,
} from './dbVerificationHarness.js';

import { runAsSystem, getTenantContext } from '../../tenancy/tenantContext.js';
import { publishOutboxEventInTx, OutboxPublishError } from '../../outbox/outboxProducer.js';
import {
  runOutboxDispatchTick,
  claimOutboxEvents,
  reclaimExpiredOutboxLeases,
  setOutboxDispatcherShuttingDown,
} from '../../outbox/outboxDispatcher.js';
import {
  registerOutboxConsumer,
  resetOutboxConsumersForTest,
  type OutboxConsumerContext,
  type OutboxConsumerOutcome,
} from '../../outbox/outboxConsumerRegistry.js';
import { OutboxConsumerError } from '../../outbox/outboxErrors.js';
import {
  beginConsumerExecution,
  completeConsumerExecution,
  findConsumerExecution,
} from '../../outbox/outboxIdempotency.js';
import { replayDeadOutboxEvent, MAX_REPLAYS_PER_EVENT } from '../../outbox/outboxReplay.js';
import { getOutboxBacklogMetrics, listDeadOutboxEvents } from '../../outbox/outboxMetrics.js';
import {
  APPOINTMENT_REQUEST_CONFIRMATION_CONSUMER_KEY,
  buildAppointmentConfirmationIdempotencyKey,
  registerAppointmentRequestConfirmationConsumer,
} from '../../outbox/consumers/appointmentRequestConfirmationConsumer.js';

const { section, test, summary } = createSuite('outboxDispatcher');

const EVENT_TYPE = 'appointment_request.confirmation_requested';
const EVENT_VERSION = 1;

let fixtures: ClinicFixtureSet;

/** Everything the dispatcher/consumer needs for one realistic converted appointment. */
interface ConvertedAppointmentFixture {
  clinicId: string;
  organizationId: string;
  appointmentId: string;
  appointmentRequestId: string;
  idempotencyKey: string;
}

let slotCounter = 0;
function nextSlot() {
  slotCounter += 1;
  const start = new Date(Date.UTC(2026, 8, 1, 8, 0) + slotCounter * 60 * 60 * 1000);
  return { startTime: start, endTime: new Date(start.getTime() + 30 * 60 * 1000) };
}

async function createConvertedAppointment(clinicId: string, organizationId: string): Promise<ConvertedAppointmentFixture> {
  const practitioner = await createStaffUser({ organizationId, clinicId, role: 'DENTIST' });
  const appointmentType = await prisma.appointmentType.create({
    data: { clinicId, name: 'Checkup', durationMinutes: 30, isActive: true },
  });
  const patient = await createTestPatient({ organizationId, clinicId });
  const { startTime, endTime } = nextSlot();

  const appointment = await prisma.appointment.create({
    data: {
      clinicId,
      patientId: patient.id,
      practitionerId: practitioner.id,
      appointmentTypeId: appointmentType.id,
      startTime,
      endTime,
      status: 'scheduled',
    },
  });

  const request = await prisma.appointmentRequest.create({
    data: {
      clinicId,
      patientName: 'Synthetic Requester',
      // No WhatsApp/Instagram connection exists in this fixture set, so the
      // real notification service short-circuits before any network call —
      // the same offline convention the other dbVerification suites use.
      phone: '+905551234567',
      appointmentTypeId: appointmentType.id,
      practitionerId: practitioner.id,
      preferredStartTime: startTime,
      source: 'whatsapp',
      status: 'converted',
      patientId: patient.id,
      convertedAppointmentId: appointment.id,
    },
  });

  return {
    clinicId,
    organizationId,
    appointmentId: appointment.id,
    appointmentRequestId: request.id,
    idempotencyKey: buildAppointmentConfirmationIdempotencyKey(appointment.id),
  };
}

/** Publish through the REAL producer, inside a real transaction. */
async function publish(
  f: ConvertedAppointmentFixture,
  overrides?: { dedupeKey?: string | null; availableAt?: Date; correlationId?: string },
): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const { id } = await publishOutboxEventInTx(tx, {
      eventType: EVENT_TYPE,
      eventVersion: EVENT_VERSION,
      organizationId: f.organizationId,
      clinicId: f.clinicId,
      aggregateId: f.appointmentRequestId,
      payload: { appointmentRequestId: f.appointmentRequestId, appointmentId: f.appointmentId },
      idempotencyKey: f.idempotencyKey,
      dedupeKey: overrides?.dedupeKey === undefined ? `dedupe:${randomUUID()}` : overrides.dedupeKey,
      availableAt: overrides?.availableAt,
      correlationId: overrides?.correlationId ?? null,
    });
    return id;
  });
}

/** Register a stub consumer in place of the real one, and observe what it saw. */
function useStubConsumer(handle: (ctx: OutboxConsumerContext) => Promise<OutboxConsumerOutcome>) {
  resetOutboxConsumersForTest();
  registerOutboxConsumer({
    consumerKey: APPOINTMENT_REQUEST_CONFIRMATION_CONSUMER_KEY,
    description: 'test stub',
    handle,
  });
}

/** One dispatcher tick, under the system context the production job establishes. */
function tick(options?: { dispatcherId?: string; limit?: number; leaseMs?: number }) {
  return runAsSystem({ reason: 'background-job', detail: 'outbox-dispatcher-test' }, () =>
    runOutboxDispatchTick(options),
  );
}

async function readEvent(id: string) {
  const row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id } });
  return row;
}

// ─────────────────────────────────────────────────────────────────────────────

async function scenarioAtomicity() {
  section('A. Transactional atomicity — the one property a queue cannot have');
  const f = await createConvertedAppointment(fixtures.defaultClinicId, fixtures.orgId);

  await test('ROLLBACK leaves neither the business row nor the event (F5-1P E11)', async () => {
    const marker = `rollback-${randomUUID().slice(0, 8)}`;
    await assert.rejects(
      prisma.$transaction(async (tx) => {
        await tx.appointmentRequest.update({ where: { id: f.appointmentRequestId }, data: { notes: marker } });
        await publishOutboxEventInTx(tx, {
          eventType: EVENT_TYPE,
          eventVersion: EVENT_VERSION,
          organizationId: f.organizationId,
          clinicId: f.clinicId,
          aggregateId: f.appointmentRequestId,
          payload: { appointmentRequestId: f.appointmentRequestId, appointmentId: f.appointmentId },
          idempotencyKey: f.idempotencyKey,
          dedupeKey: marker,
        });
        throw new Error('forced rollback after both writes');
      }),
      /forced rollback/,
    );

    const request = await prisma.appointmentRequest.findUniqueOrThrow({ where: { id: f.appointmentRequestId } });
    assert.notEqual(request.notes, marker, 'the business mutation survived a rolled-back transaction');
    const events = await prisma.outboxEvent.count({ where: { dedupeKey: marker } });
    assert.equal(events, 0, 'the outbox event survived a rolled-back transaction — this is the orphan-event failure');
  });

  await test('COMMIT persists both, atomically (F5-1P E11b)', async () => {
    const marker = `commit-${randomUUID().slice(0, 8)}`;
    await prisma.$transaction(async (tx) => {
      await tx.appointmentRequest.update({ where: { id: f.appointmentRequestId }, data: { notes: marker } });
      await publishOutboxEventInTx(tx, {
        eventType: EVENT_TYPE,
        eventVersion: EVENT_VERSION,
        organizationId: f.organizationId,
        clinicId: f.clinicId,
        aggregateId: f.appointmentRequestId,
        payload: { appointmentRequestId: f.appointmentRequestId, appointmentId: f.appointmentId },
        idempotencyKey: f.idempotencyKey,
        dedupeKey: marker,
      });
    });

    const request = await prisma.appointmentRequest.findUniqueOrThrow({ where: { id: f.appointmentRequestId } });
    assert.equal(request.notes, marker);
    assert.equal(await prisma.outboxEvent.count({ where: { dedupeKey: marker } }), 1);
    await prisma.outboxEvent.deleteMany({ where: { dedupeKey: marker } });
  });

  await test('a contract violation ROLLS BACK the business change rather than losing the obligation', async () => {
    const marker = `violation-${randomUUID().slice(0, 8)}`;
    await assert.rejects(
      prisma.$transaction(async (tx) => {
        await tx.appointmentRequest.update({ where: { id: f.appointmentRequestId }, data: { notes: marker } });
        await publishOutboxEventInTx(tx, {
          eventType: EVENT_TYPE,
          eventVersion: 99,
          organizationId: f.organizationId,
          clinicId: f.clinicId,
          aggregateId: f.appointmentRequestId,
          payload: { appointmentRequestId: f.appointmentRequestId, appointmentId: f.appointmentId },
          idempotencyKey: f.idempotencyKey,
        });
      }),
      (err: unknown) => err instanceof OutboxPublishError,
    );
    const request = await prisma.appointmentRequest.findUniqueOrThrow({ where: { id: f.appointmentRequestId } });
    assert.notEqual(request.notes, marker);
  });

  await test('a PHI-bearing payload is refused at publish, by a real transaction (F5-1P E20)', async () => {
    await assert.rejects(
      prisma.$transaction(async (tx) =>
        publishOutboxEventInTx(tx, {
          eventType: EVENT_TYPE,
          eventVersion: EVENT_VERSION,
          organizationId: f.organizationId,
          clinicId: f.clinicId,
          aggregateId: f.appointmentRequestId,
          payload: {
            appointmentRequestId: f.appointmentRequestId,
            appointmentId: f.appointmentId,
            patientName: 'Ayşe Yılmaz',
          } as Record<string, string>,
          idempotencyKey: f.idempotencyKey,
        }),
      ),
      (err: unknown) => err instanceof OutboxPublishError && /unexpected field/.test(err.message),
    );
  });

  await test('dedupeKey is a REAL unique constraint, not an application convention', async () => {
    const key = `unique-${randomUUID().slice(0, 8)}`;
    await publish(f, { dedupeKey: key });
    await assert.rejects(publish(f, { dedupeKey: key }), (err: unknown) => (err as { code?: string })?.code === 'P2002');
    await prisma.outboxEvent.deleteMany({ where: { dedupeKey: key } });
  });

  await test('a CLINIC_OWNED contract refuses to publish without a clinicId', async () => {
    await assert.rejects(
      prisma.$transaction(async (tx) =>
        publishOutboxEventInTx(tx, {
          eventType: EVENT_TYPE,
          eventVersion: EVENT_VERSION,
          organizationId: f.organizationId,
          clinicId: null,
          aggregateId: f.appointmentRequestId,
          payload: { appointmentRequestId: f.appointmentRequestId, appointmentId: f.appointmentId },
          idempotencyKey: f.idempotencyKey,
        }),
      ),
      (err: unknown) => err instanceof OutboxPublishError && /CLINIC_OWNED/.test(err.message),
    );
  });
}

async function scenarioClaim() {
  section('B. Claim semantics under real concurrency');
  const f = await createConvertedAppointment(fixtures.siblingClinicId, fixtures.orgId);

  await test('two dispatchers claiming at once never receive the same row (F5-1P E16b)', async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 12; i++) ids.add(await publish(f));

    const [a, b, c] = await Promise.all([
      claimOutboxEvents({ dispatcherId: 'disp-a', limit: 12, leaseMs: 60_000 }),
      claimOutboxEvents({ dispatcherId: 'disp-b', limit: 12, leaseMs: 60_000 }),
      claimOutboxEvents({ dispatcherId: 'disp-c', limit: 12, leaseMs: 60_000 }),
    ]);

    const claimed = [...a, ...b, ...c].map((r) => r.id).filter((id) => ids.has(id));
    assert.equal(claimed.length, 12, `expected all 12 rows claimed exactly once, got ${claimed.length}`);
    assert.equal(new Set(claimed).size, 12, 'a row was claimed by more than one dispatcher');

    for (const id of ids) {
      const row = await readEvent(id);
      assert.equal(row.status, 'claimed');
      assert.equal(row.attemptCount, 1, 'the attempt must be counted AT CLAIM, so a crash loop stays bounded');
      assert.ok(row.claimedBy && ['disp-a', 'disp-b', 'disp-c'].includes(row.claimedBy));
      assert.ok(row.leaseExpiresAt && row.leaseExpiresAt.getTime() > Date.now());
    }
    await prisma.outboxEvent.deleteMany({ where: { id: { in: [...ids] } } });
  });

  await test('a row whose availableAt is in the future is NOT claimed', async () => {
    const id = await publish(f, { availableAt: new Date(Date.now() + 10 * 60 * 1000) });
    const claimed = await claimOutboxEvents({ dispatcherId: 'disp-a', limit: 10, leaseMs: 60_000 });
    assert.ok(!claimed.some((r) => r.id === id), 'a delayed row was claimed before its time');
    assert.equal((await readEvent(id)).status, 'pending');
    await prisma.outboxEvent.delete({ where: { id } });
  });

  await test('the batch limit is honoured', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await publish(f));
    const claimed = await claimOutboxEvents({ dispatcherId: 'disp-a', limit: 2, leaseMs: 60_000 });
    assert.equal(claimed.length, 2);
    await prisma.outboxEvent.deleteMany({ where: { id: { in: ids } } });
  });

  await test('an EXPIRED lease is reclaimed; a live one is left alone (F5-1P E03/E17)', async () => {
    const stale = await publish(f);
    const live = await publish(f);
    await claimOutboxEvents({ dispatcherId: 'disp-dead', limit: 10, leaseMs: 60_000 });

    // Simulate a dispatcher that died holding `stale`.
    await prisma.outboxEvent.update({
      where: { id: stale },
      data: { leaseExpiresAt: new Date(Date.now() - 1000) },
    });

    const reclaimed = await reclaimExpiredOutboxLeases();
    assert.ok(reclaimed >= 1, 'the expired lease was not reclaimed');

    const staleRow = await readEvent(stale);
    assert.equal(staleRow.status, 'pending', 'a crashed dispatcher must not hold a row forever');
    assert.equal(staleRow.claimedBy, null);
    assert.equal(staleRow.attemptCount, 1, 'reclaim must NOT reset the attempt count — that is what bounds a crash loop');

    assert.equal((await readEvent(live)).status, 'claimed', 'a live lease was stolen');
    await prisma.outboxEvent.deleteMany({ where: { id: { in: [stale, live] } } });
  });
}

async function scenarioDispatchOutcomes() {
  section('C. Dispatch outcomes: success, retry, dead-letter');
  const f = await createConvertedAppointment(fixtures.unauthorizedClinicId, fixtures.orgId);

  await test('a successful consumer finalises the event as processed', async () => {
    useStubConsumer(async () => ({ result: 'APPLIED', outcomeCode: 'OK' }));
    const id = await publish(f);
    const result = await tick();
    assert.ok(result.processed >= 1);
    const row = await readEvent(id);
    assert.equal(row.status, 'processed');
    assert.ok(row.processedAt);
    assert.equal(row.claimedBy, null, 'a finalised row must not keep its claim');
    assert.equal(row.lastErrorCode, null);
    await prisma.outboxEvent.delete({ where: { id } });
  });

  await test('a RETRYABLE failure returns the event to pending, delayed, with a stable code', async () => {
    useStubConsumer(async () => {
      throw new OutboxConsumerError('PROVIDER_OUTAGE', 'provider is down');
    });
    const id = await publish(f);
    const before = Date.now();
    await tick();
    const row = await readEvent(id);
    assert.equal(row.status, 'pending');
    assert.equal(row.lastErrorCode, 'PROVIDER_OUTAGE');
    assert.equal(row.attemptCount, 1);
    assert.ok(row.availableAt.getTime() >= before, 'a retry must be delayed, not immediately re-claimable');
    assert.equal(row.deadLetterCode, null);
    await prisma.outboxEvent.delete({ where: { id } });
  });

  await test('a PERMANENT failure is dead at attempt 1 — the retry budget is not burned (F5-1P E12)', async () => {
    useStubConsumer(async () => {
      throw new OutboxConsumerError('AUTH_CONFIGURATION', 'credentials revoked');
    });
    const id = await publish(f);
    await tick();
    const row = await readEvent(id);
    assert.equal(row.status, 'dead');
    assert.equal(row.deadLetterCode, 'AUTH_CONFIGURATION');
    assert.equal(row.attemptCount, 1, 'a poison/permanent failure must not consume repeated attempts');
    assert.ok(row.deadLetteredAt);
    await prisma.outboxEvent.delete({ where: { id } });
  });

  await test('a persistently retryable failure reaches the attempt ceiling and stops (F5-1P E13)', async () => {
    let calls = 0;
    useStubConsumer(async () => {
      calls++;
      throw new OutboxConsumerError('TRANSIENT', 'blip');
    });
    const id = await publish(f);
    // maxAttempts for this contract is 5. Drive ticks, clearing the backoff each
    // time so the test does not have to wait out real jitter.
    for (let i = 0; i < 8; i++) {
      const row = await readEvent(id);
      if (row.status !== 'pending') break;
      await prisma.outboxEvent.update({ where: { id }, data: { availableAt: new Date(Date.now() - 1000) } });
      await tick();
    }
    const row = await readEvent(id);
    assert.equal(row.status, 'dead');
    assert.equal(row.deadLetterCode, 'MAX_ATTEMPTS_EXCEEDED');
    assert.equal(row.attemptCount, 5, `expected exactly maxAttempts attempts, got ${row.attemptCount}`);
    assert.equal(calls, 5, `the consumer must be called exactly maxAttempts times, was called ${calls}`);
    await prisma.outboxEvent.delete({ where: { id } });
  });

  await test('an UNSUPPORTED version written directly to the table is dead-lettered, never dispatched (F5-1P E21)', async () => {
    let called = false;
    useStubConsumer(async () => {
      called = true;
      return { result: 'APPLIED', outcomeCode: 'OK' };
    });
    const id = await publish(f);
    // Exactly what a row written by a newer application version looks like to
    // an older deployment — bypasses the producer on purpose.
    await prisma.outboxEvent.update({ where: { id }, data: { eventVersion: 99 } });
    await tick();
    const row = await readEvent(id);
    assert.equal(row.status, 'dead');
    assert.equal(row.deadLetterCode, 'UNSUPPORTED_VERSION');
    assert.equal(called, false, 'an uninterpretable event must never reach a consumer');
    await prisma.outboxEvent.delete({ where: { id } });
  });

  await test('a MALFORMED payload written directly to the table is dead-lettered, never dispatched', async () => {
    let called = false;
    useStubConsumer(async () => {
      called = true;
      return { result: 'APPLIED', outcomeCode: 'OK' };
    });
    const id = await publish(f);
    await prisma.outboxEvent.update({
      where: { id },
      data: { payload: { appointmentId: 'x', patientName: 'Ayşe Yılmaz', tcKimlik: '12345678901' } },
    });
    await tick();
    const row = await readEvent(id);
    assert.equal(row.status, 'dead');
    assert.equal(row.deadLetterCode, 'MALFORMED_PAYLOAD');
    assert.equal(called, false, 'a PHI-bearing payload must be refused at consume, not merely at publish');
    await prisma.outboxEvent.delete({ where: { id } });
  });

  await test('an UNREGISTERED event type is dead-lettered', async () => {
    useStubConsumer(async () => ({ result: 'APPLIED', outcomeCode: 'OK' }));
    const id = await publish(f);
    await prisma.outboxEvent.update({ where: { id }, data: { eventType: 'invented.event' } });
    await tick();
    const row = await readEvent(id);
    assert.equal(row.status, 'dead');
    assert.equal(row.deadLetterCode, 'UNREGISTERED_EVENT');
    await prisma.outboxEvent.delete({ where: { id } });
  });

  await test('an event whose contract has NO registered consumer is dead-lettered, not left pending forever', async () => {
    resetOutboxConsumersForTest();
    const id = await publish(f);
    await tick();
    const row = await readEvent(id);
    assert.equal(row.status, 'dead');
    assert.equal(row.deadLetterCode, 'NO_CONSUMER');
    await prisma.outboxEvent.delete({ where: { id } });
  });

  await test('SKIPPED is a success: the obligation no longer applies and is not retried', async () => {
    useStubConsumer(async () => ({ result: 'SKIPPED', outcomeCode: 'APPOINTMENT_NOT_FOUND' }));
    const id = await publish(f);
    await tick();
    const row = await readEvent(id);
    assert.equal(row.status, 'processed');
    await prisma.outboxEvent.delete({ where: { id } });
  });
}

async function scenarioTenantContext() {
  section('D. Tenant context is reconstructed from the ROW, per event');
  const own = await createConvertedAppointment(fixtures.defaultClinicId, fixtures.orgId);
  const cross = await createConvertedAppointment(fixtures.crossOrgClinicId, fixtures.otherOrgId);

  await test('each consumer call runs under its own row\'s tenant, not the dispatcher\'s (F5-1P T1)', async () => {
    const seen: Array<{ organizationId: string; clinicIds: string[] }> = [];
    useStubConsumer(async () => {
      const ctx = getTenantContext();
      assert.ok(ctx, 'the consumer ran with NO tenant context — the guard would refuse every tenant model');
      seen.push({
        organizationId: ctx.organizationId,
        clinicIds: ctx.clinicScope.kind === 'EXPLICIT' ? [...ctx.clinicScope.clinicIds] : ['ORGANIZATION_WIDE'],
      });
      return { result: 'APPLIED', outcomeCode: 'OK' };
    });

    const ownId = await publish(own);
    const crossId = await publish(cross);
    await tick({ limit: 10 });

    assert.equal(seen.length, 2, 'both events should have been dispatched in one tick');
    const ownCtx = seen.find((s) => s.organizationId === own.organizationId);
    const crossCtx = seen.find((s) => s.organizationId === cross.organizationId);
    assert.ok(ownCtx, 'no consumer call ran as the first organization');
    assert.ok(crossCtx, 'no consumer call ran as the second organization');
    assert.deepEqual(ownCtx!.clinicIds, [own.clinicId]);
    assert.deepEqual(crossCtx!.clinicIds, [cross.clinicId]);

    await prisma.outboxEvent.deleteMany({ where: { id: { in: [ownId, crossId] } } });
  });

  await test('a consumer cannot read the tenant from the payload — the allowlist forbids the field', async () => {
    await assert.rejects(
      prisma.$transaction(async (tx) =>
        publishOutboxEventInTx(tx, {
          eventType: EVENT_TYPE,
          eventVersion: EVENT_VERSION,
          organizationId: own.organizationId,
          clinicId: own.clinicId,
          aggregateId: own.appointmentRequestId,
          payload: {
            appointmentRequestId: own.appointmentRequestId,
            appointmentId: own.appointmentId,
            organizationId: cross.organizationId,
          } as Record<string, string>,
          idempotencyKey: own.idempotencyKey,
        }),
      ),
      (err: unknown) => err instanceof OutboxPublishError && /unexpected field/.test(err.message),
    );
  });

  return { own, cross };
}

async function scenarioIdempotency() {
  section('E. Business idempotency — at-least-once delivery, exactly-once effect');
  const f = await createConvertedAppointment(fixtures.siblingClinicId, fixtures.orgId);

  await test('the ledger is a REAL unique constraint on (consumerKey, idempotencyKey)', async () => {
    const key = `idem-unique-${randomUUID().slice(0, 8)}`;
    const first = await beginConsumerExecution({
      consumerKey: 'test-consumer',
      idempotencyKey: key,
      organizationId: f.organizationId,
      clinicId: f.clinicId,
      executedBy: 'a',
    });
    assert.equal(first.decision, 'PROCEED');
    const second = await beginConsumerExecution({
      consumerKey: 'test-consumer',
      idempotencyKey: key,
      organizationId: f.organizationId,
      clinicId: f.clinicId,
      executedBy: 'b',
    });
    assert.equal(second.decision, 'IN_FLIGHT_ELSEWHERE', 'a live lease must not be stolen');

    await completeConsumerExecution({ executionId: first.executionId, outcomeCode: 'DONE' });
    const third = await beginConsumerExecution({
      consumerKey: 'test-consumer',
      idempotencyKey: key,
      organizationId: f.organizationId,
      clinicId: f.clinicId,
      executedBy: 'c',
    });
    assert.equal(third.decision, 'ALREADY_COMPLETED');
    await prisma.outboxConsumerExecution.deleteMany({ where: { idempotencyKey: key } });
  });

  await test('an EXPIRED in-progress marker is AMBIGUOUS — never a silent re-send, never a silent drop', async () => {
    const key = `idem-ambig-${randomUUID().slice(0, 8)}`;
    const first = await beginConsumerExecution({
      consumerKey: 'test-consumer',
      idempotencyKey: key,
      organizationId: f.organizationId,
      clinicId: f.clinicId,
      executedBy: 'crashed',
    });
    // The dispatcher died between the side effect and finalisation.
    await prisma.outboxConsumerExecution.update({
      where: { id: first.executionId },
      data: { leaseExpiresAt: new Date(Date.now() - 1000) },
    });
    const retry = await beginConsumerExecution({
      consumerKey: 'test-consumer',
      idempotencyKey: key,
      organizationId: f.organizationId,
      clinicId: f.clinicId,
      executedBy: 'survivor',
    });
    assert.equal(retry.decision, 'AMBIGUOUS');
    const row = await findConsumerExecution({ consumerKey: 'test-consumer', idempotencyKey: key });
    assert.equal(row?.status, 'ambiguous');
    assert.equal(row?.outcomeCode, 'AMBIGUOUS_SIDE_EFFECT');
    await prisma.outboxConsumerExecution.deleteMany({ where: { idempotencyKey: key } });
  });

  await test('crash AFTER the side effect, retry: the effect happens exactly once (F5-1P E04)', async () => {
    let sideEffects = 0;
    useStubConsumer(async (ctx) => {
      const begin = await beginConsumerExecution({
        consumerKey: APPOINTMENT_REQUEST_CONFIRMATION_CONSUMER_KEY,
        idempotencyKey: ctx.idempotencyKey,
        organizationId: ctx.organizationId,
        clinicId: ctx.clinicId,
        executedBy: `attempt-${ctx.attemptCount}`,
      });
      if (begin.decision === 'ALREADY_COMPLETED') return { result: 'SKIPPED', outcomeCode: 'DUPLICATE_SUPPRESSED' };
      if (begin.decision === 'AMBIGUOUS') {
        throw new OutboxConsumerError('PERMANENT_VALIDATION', 'ambiguous', { code: 'AMBIGUOUS_SIDE_EFFECT' });
      }
      sideEffects++;
      if (ctx.attemptCount === 1) {
        // The process "dies" here: the side effect happened, the ledger was
        // never finalised, the event was never finalised.
        throw new OutboxConsumerError('TRANSIENT', 'crashed after the side effect');
      }
      await completeConsumerExecution({ executionId: begin.executionId, outcomeCode: 'DONE' });
      return { result: 'APPLIED', outcomeCode: 'DONE' };
    });

    const id = await publish(f);
    await tick();
    assert.equal(sideEffects, 1, 'the first attempt should have performed the side effect');

    // Expire the abandoned marker exactly as a real crash would, then retry.
    await prisma.outboxConsumerExecution.updateMany({
      where: { idempotencyKey: f.idempotencyKey, status: 'in_progress' },
      data: { leaseExpiresAt: new Date(Date.now() - 1000) },
    });
    await prisma.outboxEvent.update({ where: { id }, data: { availableAt: new Date(Date.now() - 1000) } });
    await tick();

    assert.equal(sideEffects, 1, 'the retry re-performed a side effect that may already have happened');
    const row = await readEvent(id);
    assert.equal(row.status, 'dead');
    assert.equal(row.deadLetterCode, 'AMBIGUOUS_SIDE_EFFECT', 'the ambiguity must be visible to an operator');
    await prisma.outboxEvent.delete({ where: { id } });
    await prisma.outboxConsumerExecution.deleteMany({ where: { idempotencyKey: f.idempotencyKey } });
  });

  await test('a DUPLICATE delivery of an already-applied key performs no second side effect (F5-1P E01)', async () => {
    let sideEffects = 0;
    useStubConsumer(async (ctx) => {
      const begin = await beginConsumerExecution({
        consumerKey: APPOINTMENT_REQUEST_CONFIRMATION_CONSUMER_KEY,
        idempotencyKey: ctx.idempotencyKey,
        organizationId: ctx.organizationId,
        clinicId: ctx.clinicId,
        executedBy: 'dup-test',
      });
      if (begin.decision !== 'PROCEED') return { result: 'SKIPPED', outcomeCode: 'DUPLICATE_SUPPRESSED' };
      sideEffects++;
      await completeConsumerExecution({ executionId: begin.executionId, outcomeCode: 'DONE' });
      return { result: 'APPLIED', outcomeCode: 'DONE' };
    });

    // Two distinct events asserting the SAME business fact.
    const a = await publish(f);
    const b = await publish(f);
    await tick({ limit: 10 });

    assert.equal(sideEffects, 1, `two deliveries produced ${sideEffects} side effects`);
    assert.equal((await readEvent(a)).status, 'processed');
    assert.equal((await readEvent(b)).status, 'processed');
    await prisma.outboxEvent.deleteMany({ where: { id: { in: [a, b] } } });
    await prisma.outboxConsumerExecution.deleteMany({ where: { idempotencyKey: f.idempotencyKey } });
  });

  return f;
}

async function scenarioReplay() {
  section('F. Replay is explicit, authorized, audited and idempotent');
  const f = await createConvertedAppointment(fixtures.defaultClinicId, fixtures.orgId);

  const orgWideAuth = {
    organizationId: f.organizationId,
    clinicScope: { kind: 'ORGANIZATION_WIDE' as const },
    actorUserId: null,
    actorRole: 'OWNER',
  };

  async function makeDeadEvent(correlationId?: string): Promise<string> {
    useStubConsumer(async () => {
      throw new OutboxConsumerError('PERMANENT_VALIDATION', 'permanently broken');
    });
    const id = await publish(f, { correlationId });
    await tick();
    assert.equal((await readEvent(id)).status, 'dead');
    return id;
  }

  await test('replaying a dead event creates a NEW event and leaves the original dead as evidence', async () => {
    const correlationId = `corr-${randomUUID().slice(0, 8)}`;
    const deadId = await makeDeadEvent(correlationId);

    const result = await replayDeadOutboxEvent({ eventId: deadId, authorization: orgWideAuth });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const original = await readEvent(deadId);
    assert.equal(original.status, 'dead', 'the original must stay dead — it is the only record of the failure');
    assert.equal(original.replayCount, 1);
    assert.ok(original.lastReplayedAt);

    const replay = await readEvent(result.replayEventId);
    assert.equal(replay.status, 'pending');
    assert.equal(replay.causationId, deadId, 'the replay must point back at what caused it');
    assert.equal(replay.correlationId, correlationId, 'correlation must be preserved across a replay');
    assert.equal(replay.idempotencyKey, original.idempotencyKey, 'a replay reusing a NEW key would duplicate the effect');
    assert.equal(replay.attemptCount, 0);
    assert.equal(replay.dedupeKey, null, 'copying dedupeKey would make the unique constraint block a deliberate replay');

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'outbox_event_replayed', entityId: deadId },
    });
    assert.ok(audit, 'a replay must be audited');
    assert.equal(audit!.organizationId, f.organizationId);
    const metadata = audit!.metadata as Record<string, unknown>;
    assert.equal(metadata.replayEventId, result.replayEventId);

    await prisma.auditLog.deleteMany({ where: { action: 'outbox_event_replayed', entityId: deadId } });
    await prisma.outboxEvent.deleteMany({ where: { id: { in: [deadId, result.replayEventId] } } });
  });

  await test('a second replay while the first is still in flight is refused', async () => {
    const deadId = await makeDeadEvent();
    const first = await replayDeadOutboxEvent({ eventId: deadId, authorization: orgWideAuth });
    assert.equal(first.ok, true);
    const second = await replayDeadOutboxEvent({ eventId: deadId, authorization: orgWideAuth });
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.refusal, 'REPLAY_IN_FLIGHT');

    await prisma.auditLog.deleteMany({ where: { action: 'outbox_event_replayed', entityId: deadId } });
    await prisma.outboxEvent.deleteMany({ where: { OR: [{ id: deadId }, { causationId: deadId }] } });
  });

  await test('a NON-terminal event cannot be replayed', async () => {
    useStubConsumer(async () => ({ result: 'APPLIED', outcomeCode: 'OK' }));
    const id = await publish(f);
    const result = await replayDeadOutboxEvent({ eventId: id, authorization: orgWideAuth });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.refusal, 'NOT_TERMINAL');
    await prisma.outboxEvent.delete({ where: { id } });
  });

  await test('an event whose side effect is recorded APPLIED cannot be replayed', async () => {
    const deadId = await makeDeadEvent();
    const begin = await beginConsumerExecution({
      consumerKey: APPOINTMENT_REQUEST_CONFIRMATION_CONSUMER_KEY,
      idempotencyKey: f.idempotencyKey,
      organizationId: f.organizationId,
      clinicId: f.clinicId,
      executedBy: 'earlier',
    });
    await completeConsumerExecution({ executionId: begin.executionId, outcomeCode: 'DONE' });

    const result = await replayDeadOutboxEvent({ eventId: deadId, authorization: orgWideAuth });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.refusal, 'ALREADY_APPLIED');

    await prisma.outboxConsumerExecution.deleteMany({ where: { idempotencyKey: f.idempotencyKey } });
    await prisma.outboxEvent.delete({ where: { id: deadId } });
  });

  await test('an AMBIGUOUS side effect needs an explicit operator acknowledgement', async () => {
    const deadId = await makeDeadEvent();
    const begin = await beginConsumerExecution({
      consumerKey: APPOINTMENT_REQUEST_CONFIRMATION_CONSUMER_KEY,
      idempotencyKey: f.idempotencyKey,
      organizationId: f.organizationId,
      clinicId: f.clinicId,
      executedBy: 'crashed',
    });
    await prisma.outboxConsumerExecution.update({
      where: { id: begin.executionId },
      data: { status: 'ambiguous', outcomeCode: 'AMBIGUOUS_SIDE_EFFECT' },
    });

    const refused = await replayDeadOutboxEvent({ eventId: deadId, authorization: orgWideAuth });
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.equal(refused.refusal, 'AMBIGUOUS_REQUIRES_ACKNOWLEDGEMENT');

    const accepted = await replayDeadOutboxEvent({
      eventId: deadId,
      authorization: orgWideAuth,
      acknowledgeAmbiguousSideEffect: true,
    });
    assert.equal(accepted.ok, true);
    const ledger = await findConsumerExecution({
      consumerKey: APPOINTMENT_REQUEST_CONFIRMATION_CONSUMER_KEY,
      idempotencyKey: f.idempotencyKey,
    });
    assert.equal(ledger, null, 'an acknowledged replay must clear the ambiguity so the consumer can proceed');

    await prisma.auditLog.deleteMany({ where: { action: 'outbox_event_replayed', entityId: deadId } });
    await prisma.outboxEvent.deleteMany({ where: { OR: [{ id: deadId }, { causationId: deadId }] } });
  });

  await test('the replay ceiling is enforced', async () => {
    const deadId = await makeDeadEvent();
    await prisma.outboxEvent.update({ where: { id: deadId }, data: { replayCount: MAX_REPLAYS_PER_EVENT } });
    const result = await replayDeadOutboxEvent({ eventId: deadId, authorization: orgWideAuth });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.refusal, 'REPLAY_LIMIT_EXCEEDED');
    await prisma.outboxEvent.delete({ where: { id: deadId } });
  });

  await test('a CROSS-ORGANIZATION replay is NOT_FOUND, not "forbidden" (no id oracle)', async () => {
    const deadId = await makeDeadEvent();
    const result = await replayDeadOutboxEvent({
      eventId: deadId,
      authorization: { ...orgWideAuth, organizationId: fixtures.otherOrgId },
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.refusal, 'NOT_FOUND');
    await prisma.outboxEvent.delete({ where: { id: deadId } });
  });

  await test('a SIBLING-clinic replay outside the caller\'s clinic scope is refused (F5-1P T2)', async () => {
    const deadId = await makeDeadEvent();
    const result = await replayDeadOutboxEvent({
      eventId: deadId,
      authorization: {
        ...orgWideAuth,
        clinicScope: { kind: 'EXPLICIT', clinicIds: [fixtures.siblingClinicId] },
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.refusal, 'CROSS_CLINIC_REFUSED');

    // The same caller WITH the right clinic in scope succeeds — proving the
    // refusal above was the scope, not an unrelated precondition.
    const allowed = await replayDeadOutboxEvent({
      eventId: deadId,
      authorization: { ...orgWideAuth, clinicScope: { kind: 'EXPLICIT', clinicIds: [f.clinicId] } },
    });
    assert.equal(allowed.ok, true);

    await prisma.auditLog.deleteMany({ where: { action: 'outbox_event_replayed', entityId: deadId } });
    await prisma.outboxEvent.deleteMany({ where: { OR: [{ id: deadId }, { causationId: deadId }] } });
  });

  await test('a refused replay leaves the database untouched', async () => {
    const deadId = await makeDeadEvent();
    const before = await readEvent(deadId);
    const eventCountBefore = await prisma.outboxEvent.count();
    await replayDeadOutboxEvent({
      eventId: deadId,
      authorization: { ...orgWideAuth, organizationId: fixtures.otherOrgId },
    });
    const after = await readEvent(deadId);
    assert.equal(after.replayCount, before.replayCount);
    assert.equal(await prisma.outboxEvent.count(), eventCountBefore, 'a refused replay created a row');
    await prisma.outboxEvent.delete({ where: { id: deadId } });
  });

  await test('a replayed event that succeeds suppresses the duplicate via the SAME idempotency key (F5-1P E15)', async () => {
    let sideEffects = 0;
    const deadId = await makeDeadEvent();
    const replay = await replayDeadOutboxEvent({ eventId: deadId, authorization: orgWideAuth });
    assert.equal(replay.ok, true);
    if (!replay.ok) return;

    useStubConsumer(async (ctx) => {
      const begin = await beginConsumerExecution({
        consumerKey: APPOINTMENT_REQUEST_CONFIRMATION_CONSUMER_KEY,
        idempotencyKey: ctx.idempotencyKey,
        organizationId: ctx.organizationId,
        clinicId: ctx.clinicId,
        executedBy: 'replay-test',
      });
      if (begin.decision !== 'PROCEED') return { result: 'SKIPPED', outcomeCode: 'DUPLICATE_SUPPRESSED' };
      sideEffects++;
      await completeConsumerExecution({ executionId: begin.executionId, outcomeCode: 'DONE' });
      return { result: 'APPLIED', outcomeCode: 'DONE' };
    });
    await tick();
    assert.equal((await readEvent(replay.replayEventId)).status, 'processed');
    assert.equal(sideEffects, 1);

    // A second replay is now refused because the effect is recorded applied.
    const second = await replayDeadOutboxEvent({ eventId: deadId, authorization: orgWideAuth });
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.refusal, 'ALREADY_APPLIED');

    await prisma.auditLog.deleteMany({ where: { action: 'outbox_event_replayed', entityId: deadId } });
    await prisma.outboxConsumerExecution.deleteMany({ where: { idempotencyKey: f.idempotencyKey } });
    await prisma.outboxEvent.deleteMany({ where: { OR: [{ id: deadId }, { causationId: deadId }] } });
  });
}

async function scenarioShutdown() {
  section('G. Graceful shutdown leaves no row stuck claimed (F5-1P E22)');
  const f = await createConvertedAppointment(fixtures.siblingClinicId, fixtures.orgId);

  await test('a tick that begins while shutting down claims nothing', async () => {
    useStubConsumer(async () => ({ result: 'APPLIED', outcomeCode: 'OK' }));
    const id = await publish(f);
    setOutboxDispatcherShuttingDown(true);
    const result = await tick();
    setOutboxDispatcherShuttingDown(false);
    assert.equal(result.claimed, 0);
    assert.equal((await readEvent(id)).status, 'pending');
    await prisma.outboxEvent.delete({ where: { id } });
  });

  await test('shutdown DURING a tick releases the rows it had just claimed, leaving 0 in claimed', async () => {
    // The consumer flips the flag mid-tick, exactly as a SIGTERM arriving
    // between the claim and the execution would.
    useStubConsumer(async () => {
      setOutboxDispatcherShuttingDown(true);
      return { result: 'APPLIED', outcomeCode: 'OK' };
    });
    const ids = [await publish(f), await publish(f), await publish(f)];
    await tick({ limit: 10 });
    setOutboxDispatcherShuttingDown(false);

    const stuck = await prisma.outboxEvent.count({ where: { id: { in: ids }, status: 'claimed' } });
    assert.equal(stuck, 0, 'a row left in `claimed` waits out a full lease before anyone can retry it');
    await prisma.outboxEvent.deleteMany({ where: { id: { in: ids } } });
  });
}

async function scenarioMetrics() {
  section('H. Backlog metrics make the deferral triggers measurable');
  const f = await createConvertedAppointment(fixtures.defaultClinicId, fixtures.orgId);

  await test('metrics separate dispatchable from delayed, and report the oldest pending age', async () => {
    const ready = await publish(f);
    const delayed = await publish(f, { availableAt: new Date(Date.now() + 60 * 60 * 1000) });
    await prisma.outboxEvent.update({
      where: { id: ready },
      data: { occurredAt: new Date(Date.now() - 5 * 60 * 1000) },
    });

    const metrics = await getOutboxBacklogMetrics();
    assert.ok(metrics.dispatchable >= 1);
    assert.ok(metrics.delayed >= 1);
    assert.ok(metrics.oldestPendingAgeMs !== null && metrics.oldestPendingAgeMs >= 5 * 60 * 1000 - 5_000);
    const org = metrics.byOrganization.find((o) => o.organizationId === f.organizationId);
    assert.ok(org, 'the per-organization backlog is the fairness trigger and must be present');
    assert.ok(org!.pending >= 2);

    await prisma.outboxEvent.deleteMany({ where: { id: { in: [ready, delayed] } } });
  });

  await test('a stale lease is visible as dispatcher-health signal', async () => {
    const id = await publish(f);
    await claimOutboxEvents({ dispatcherId: 'disp-dead', limit: 10, leaseMs: 60_000 });
    await prisma.outboxEvent.update({ where: { id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });
    const metrics = await getOutboxBacklogMetrics();
    assert.ok(metrics.staleLeases >= 1);
    await prisma.outboxEvent.delete({ where: { id } });
  });

  await test('the dead-letter listing is tenant-scoped and carries no payload or message content', async () => {
    useStubConsumer(async () => {
      throw new OutboxConsumerError('PERMANENT_VALIDATION', 'broken');
    });
    const id = await publish(f);
    await tick();

    const own = await listDeadOutboxEvents({ organizationId: f.organizationId });
    const found = own.find((e) => e.id === id);
    assert.ok(found, 'the dead event is not visible to its own organization');
    assert.equal(found!.deadLetterCode, 'PERMANENT_VALIDATION');
    assert.ok(!('payload' in found!), 'the DLQ view must not expose the payload (F5-1P E14)');

    const other = await listDeadOutboxEvents({ organizationId: fixtures.otherOrgId });
    assert.ok(!other.some((e) => e.id === id), 'a dead event leaked across organizations');

    const metrics = await getOutboxBacklogMetrics();
    assert.ok((metrics.deadByCode.PERMANENT_VALIDATION ?? 0) >= 1, 'failures must be sliceable by stable code');

    await prisma.outboxEvent.delete({ where: { id } });
  });
}

async function scenarioRealConsumer() {
  section('I. The real consumer, end to end');
  const f = await createConvertedAppointment(fixtures.defaultClinicId, fixtures.orgId);

  await test('the registered production consumer dispatches a real event to completion', async () => {
    resetOutboxConsumersForTest();
    registerAppointmentRequestConfirmationConsumer();

    const id = await publish(f);
    await tick();

    const row = await readEvent(id);
    assert.equal(row.status, 'processed', `expected processed, got ${row.status}/${row.deadLetterCode}`);

    const ledger = await findConsumerExecution({
      consumerKey: APPOINTMENT_REQUEST_CONFIRMATION_CONSUMER_KEY,
      idempotencyKey: f.idempotencyKey,
    });
    assert.ok(ledger, 'the real consumer must record its execution');
    assert.equal(ledger!.status, 'completed');
    assert.equal(ledger!.outcomeCode, 'CONFIRMATION_SENT');

    await prisma.outboxEvent.delete({ where: { id } });
  });

  await test('a duplicate delivery to the real consumer is suppressed by the ledger', async () => {
    resetOutboxConsumersForTest();
    registerAppointmentRequestConfirmationConsumer();

    const id = await publish(f);
    await tick();
    const row = await readEvent(id);
    assert.equal(row.status, 'processed');
    const ledger = await findConsumerExecution({
      consumerKey: APPOINTMENT_REQUEST_CONFIRMATION_CONSUMER_KEY,
      idempotencyKey: f.idempotencyKey,
    });
    // Still exactly one ledger row for the business key, from the first test.
    assert.ok(ledger);
    assert.equal(
      await prisma.outboxConsumerExecution.count({ where: { idempotencyKey: f.idempotencyKey } }),
      1,
      'a duplicate delivery created a second ledger row',
    );
    await prisma.outboxEvent.delete({ where: { id } });
  });

  await test('the real consumer SKIPS (never dead-letters) when the appointment has gone away', async () => {
    resetOutboxConsumersForTest();
    registerAppointmentRequestConfirmationConsumer();

    const gone = await createConvertedAppointment(fixtures.defaultClinicId, fixtures.orgId);
    const id = await publish(gone);
    await prisma.appointmentRequest.update({ where: { id: gone.appointmentRequestId }, data: { convertedAppointmentId: null } });
    await prisma.appointment.delete({ where: { id: gone.appointmentId } });

    await tick();
    const row = await readEvent(id);
    assert.equal(row.status, 'processed', 'a vanished obligation must not sit in the DLQ as a false alarm');
    await prisma.outboxEvent.delete({ where: { id } });
  });
}

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  fixtures = await createClinicFixtureSet('outbox');

  await scenarioAtomicity();
  await scenarioClaim();
  await scenarioDispatchOutcomes();
  await scenarioTenantContext();
  await scenarioIdempotency();
  await scenarioReplay();
  await scenarioShutdown();
  await scenarioMetrics();
  await scenarioRealConsumer();

  const ok = summary();
  resetOutboxConsumersForTest();
  await prisma.auditLog.deleteMany({ where: { organizationId: { in: [fixtures.orgId, fixtures.otherOrgId] } } });
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

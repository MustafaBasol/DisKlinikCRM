/**
 * externalCalendarIdempotency.test.ts — inbound webhook idempotency and
 * duplicate-delivery handling for ExternalCalendarInboundEvent.
 *
 * Mirrors the in-memory unique-constraint simulation technique used
 * elsewhere in this repo (e.g. whatsappConversationPersistence.test.ts):
 * the fake prisma.externalCalendarInboundEvent.create() enforces the same
 * @@unique([provider, connectionId, providerEventId]) constraint declared
 * in schema.prisma and throws a P2002-coded error on violation, so
 * createExternalCalendarInboundEventOrDetectDuplicate() is exercised
 * against the real "insert, catch P2002" logic — not a reimplementation.
 *
 * Run with: npx tsx src/tests/externalCalendarIdempotency.test.ts
 */

import assert from 'node:assert/strict';
import prisma from '../db.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { console.log(`  ✓ ${name}`); passed++; })
    .catch((err: unknown) => {
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
      failed++;
    });
}

function section(title: string) {
  console.log(`\n${title}`);
}

type EventRow = {
  id: string;
  provider: string;
  connectionId: string | null;
  clinicId: string | null;
  organizationId: string | null;
  eventType: string;
  providerEventId: string;
  externalAppointmentId: string | null;
  rawPayload: unknown;
  status: string;
  errorMessage: string | null;
  attempts: number;
  processedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

let rows: EventRow[] = [];
let seq = 0;

(prisma as any).externalCalendarInboundEvent = {
  async create({ data }: any) {
    const dup = rows.some(
      (r) => r.provider === data.provider && r.connectionId === data.connectionId && r.providerEventId === data.providerEventId,
    );
    if (dup) {
      const err = new Error('Unique constraint failed') as Error & { code: string };
      err.code = 'P2002';
      throw err;
    }
    const row: EventRow = {
      id: `evt-${++seq}`,
      provider: data.provider,
      connectionId: data.connectionId ?? null,
      clinicId: data.clinicId ?? null,
      organizationId: data.organizationId ?? null,
      eventType: data.eventType,
      providerEventId: data.providerEventId,
      externalAppointmentId: data.externalAppointmentId ?? null,
      rawPayload: data.rawPayload ?? null,
      status: data.status ?? 'processing',
      errorMessage: null,
      attempts: 0,
      processedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    rows.push(row);
    return { id: row.id };
  },
  async update({ where, data }: any) {
    const row = rows.find((r) => r.id === where.id);
    if (!row) throw new Error('not found');
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === 'object' && 'increment' in (value as any)) {
        (row as any)[key] += (value as any).increment;
      } else {
        (row as any)[key] = value;
      }
    }
    row.updatedAt = new Date();
    return row;
  },
};

const {
  createExternalCalendarInboundEventOrDetectDuplicate,
  markExternalCalendarEventProcessed,
  markExternalCalendarEventIgnored,
  markExternalCalendarEventFailed,
} = await import('../services/externalCalendar/externalCalendarIdempotency.js');

section('Idempotent creation');

await test('first delivery of an event is created', async () => {
  const result = await createExternalCalendarInboundEventOrDetectDuplicate({
    provider: 'digidentis',
    connectionId: 'conn-1',
    clinicId: 'clinic-A',
    organizationId: 'org-1',
    eventType: 'appointment.created',
    providerEventId: 'evt-abc-123',
  });
  assert.equal(result.status, 'created');
});

section('Duplicate webhook delivery');

await test('a redelivered event with the same providerEventId is detected as a duplicate, not created twice', async () => {
  const first = await createExternalCalendarInboundEventOrDetectDuplicate({
    provider: 'digidentis',
    connectionId: 'conn-1',
    eventType: 'appointment.cancelled',
    providerEventId: 'evt-redelivered',
  });
  assert.equal(first.status, 'created');

  const second = await createExternalCalendarInboundEventOrDetectDuplicate({
    provider: 'digidentis',
    connectionId: 'conn-1',
    eventType: 'appointment.cancelled',
    providerEventId: 'evt-redelivered',
  });
  assert.equal(second.status, 'duplicate');

  const matching = rows.filter((r) => r.providerEventId === 'evt-redelivered');
  assert.equal(matching.length, 1, 'exactly one row should exist for a duplicate delivery');
});

await test('the same providerEventId on a different connection is not a duplicate', async () => {
  const a = await createExternalCalendarInboundEventOrDetectDuplicate({
    provider: 'digidentis', connectionId: 'conn-shared-id', eventType: 'appointment.created', providerEventId: 'shared-id',
  });
  const b = await createExternalCalendarInboundEventOrDetectDuplicate({
    provider: 'digidentis', connectionId: 'conn-other', eventType: 'appointment.created', providerEventId: 'shared-id',
  });
  assert.equal(a.status, 'created');
  assert.equal(b.status, 'created');
});

section('Skip conditions (never provide false idempotency)');

await test('missing providerEventId is skipped, not silently created', async () => {
  const result = await createExternalCalendarInboundEventOrDetectDuplicate({
    provider: 'digidentis', connectionId: 'conn-1', eventType: 'unknown', providerEventId: '',
  });
  assert.deepEqual(result, { status: 'skipped', reason: 'missing_provider_event_id' });
});

await test('missing connectionId is skipped — null cannot dedupe reliably in Postgres', async () => {
  const result = await createExternalCalendarInboundEventOrDetectDuplicate({
    provider: 'digidentis', connectionId: null, eventType: 'unknown', providerEventId: 'evt-no-conn',
  });
  assert.deepEqual(result, { status: 'skipped', reason: 'missing_connection_id' });
});

section('Status transitions');

await test('markExternalCalendarEventProcessed sets status=processed and processedAt', async () => {
  const created = await createExternalCalendarInboundEventOrDetectDuplicate({
    provider: 'digidentis', connectionId: 'conn-status', eventType: 'appointment.created', providerEventId: 'evt-status-1',
  });
  assert.equal(created.status, 'created');
  await markExternalCalendarEventProcessed((created as any).eventId);
  const row = rows.find((r) => r.id === (created as any).eventId)!;
  assert.equal(row.status, 'processed');
  assert.ok(row.processedAt);
});

await test('markExternalCalendarEventIgnored records a reason without treating it as failed', async () => {
  const created = await createExternalCalendarInboundEventOrDetectDuplicate({
    provider: 'digidentis', connectionId: 'conn-status', eventType: 'patient.updated', providerEventId: 'evt-status-2',
  });
  await markExternalCalendarEventIgnored((created as any).eventId, 'Reserved event type');
  const row = rows.find((r) => r.id === (created as any).eventId)!;
  assert.equal(row.status, 'ignored');
  assert.equal(row.errorMessage, 'Reserved event type');
});

await test('markExternalCalendarEventFailed increments attempts', async () => {
  const created = await createExternalCalendarInboundEventOrDetectDuplicate({
    provider: 'digidentis', connectionId: 'conn-status', eventType: 'appointment.created', providerEventId: 'evt-status-3',
  });
  await markExternalCalendarEventFailed((created as any).eventId, new Error('boom'));
  const row = rows.find((r) => r.id === (created as any).eventId)!;
  assert.equal(row.status, 'failed');
  assert.equal(row.attempts, 1);
  assert.equal(row.errorMessage, 'boom');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;

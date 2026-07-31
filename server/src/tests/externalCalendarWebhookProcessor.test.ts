/**
 * externalCalendarWebhookProcessor.test.ts — end-to-end (mocked-DB) coverage
 * of: DigiDentiS webhook signature verification tied to an encrypted
 * per-clinic secret, event-type parsing/normalization, and the "store
 * reserved/unknown events without applying unsupported domain changes"
 * phase boundary.
 *
 * Run with: npx tsx src/tests/externalCalendarWebhookProcessor.test.ts
 */

process.env.ENCRYPTION_KEY = 'b'.repeat(64);

import assert from 'node:assert/strict';
import { createHmac } from 'crypto';
import prisma from '../db.js';
import { encryptSecret } from '../utils/encryption.js';

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
    Object.assign(row, data, { updatedAt: new Date() });
    return row;
  },
};

const { DigiDentisProvider } = await import('../services/externalCalendar/digidentis/DigiDentisProvider.js');
const { processExternalCalendarWebhookEvent } = await import(
  '../services/externalCalendar/externalCalendarWebhookProcessor.js'
);

const provider = new DigiDentisProvider();
const webhookSecretPlain = 'clinic-a-webhook-secret';
const connection = {
  id: 'conn-A',
  clinicId: 'clinic-A',
  organizationId: 'org-1',
  provider: 'digidentis',
  clientId: 'client-a',
  clientSecretEncrypted: encryptSecret('secret-a'),
  webhookSecretEncrypted: encryptSecret(webhookSecretPlain),
  externalCompanyId: null,
  externalClinicId: 'ext-clinic-a',
  apiBaseUrl: null,
};

function sign(body: Buffer): string {
  return createHmac('sha256', webhookSecretPlain).update(body).digest('hex');
}

section('Webhook signature verification (encrypted secret round-trip)');

await test('a correctly signed payload verifies against the encrypted webhook secret', () => {
  const body = Buffer.from(JSON.stringify({ type: 'appointment.created', id: 'evt-1' }));
  const signature = sign(body);
  const valid = provider.verifyWebhookSignature(connection, body, { 'x-webhook-signature': signature });
  assert.equal(valid, true);
});

await test('a payload signed with the WRONG clinic secret is rejected', () => {
  const body = Buffer.from(JSON.stringify({ type: 'appointment.created', id: 'evt-2' }));
  const wrongSignature = createHmac('sha256', 'someone-elses-secret').update(body).digest('hex');
  const valid = provider.verifyWebhookSignature(connection, body, { 'x-webhook-signature': wrongSignature });
  assert.equal(valid, false);
});

await test('a connection with no webhook secret configured always rejects', () => {
  const noSecretConnection = { ...connection, webhookSecretEncrypted: null };
  const body = Buffer.from('{}');
  const valid = noSecretConnection.webhookSecretEncrypted
    ? true
    : provider.verifyWebhookSignature(noSecretConnection as any, body, {
        'x-webhook-signature': sign(body),
      });
  assert.equal(valid, false);
});

section('Event type parsing/normalization');

await test('appointment.created is recognized as an active event type', () => {
  const parsed = provider.parseWebhook({ type: 'appointment.created', id: 'evt-3', data: { appointmentId: 'ext-appt-1' } });
  assert.equal(parsed.eventType, 'appointment.created');
  assert.equal(parsed.externalAppointmentId, 'ext-appt-1');
});

await test('US-spelling "canceled" is normalized to "cancelled" without inventing a new type', () => {
  const parsed = provider.parseWebhook({ type: 'appointment.canceled', id: 'evt-4' });
  assert.equal(parsed.eventType, 'appointment.cancelled');
  assert.equal(parsed.rawEventType, 'appointment.canceled');
});

await test('an unrecognized event type is classified as unknown, raw type preserved verbatim', () => {
  const parsed = provider.parseWebhook({ type: 'patient.merged', id: 'evt-5' });
  assert.equal(parsed.eventType, 'unknown');
  assert.equal(parsed.rawEventType, 'patient.merged');
});

await test('a missing event id falls back to a deterministic hash of the payload (dedupe-safe)', () => {
  const payload = { type: 'appointment.created', appointmentId: 'ext-appt-9' };
  const a = provider.parseWebhook(payload);
  const b = provider.parseWebhook(payload);
  assert.equal(a.providerEventId, b.providerEventId);
  assert.ok(a.providerEventId.length > 0);
});

section('Reserved/unknown events are safely stored without domain action');

await test('an active event type is stored and marked processed', async () => {
  const parsed = provider.parseWebhook({ type: 'appointment.created', id: 'evt-active-1' });
  const result = await processExternalCalendarWebhookEvent({
    provider: 'digidentis', connectionId: 'conn-A', clinicId: 'clinic-A', organizationId: 'org-1', parsed,
  });
  assert.equal(result.outcome, 'stored');
  const row = rows.find((r) => r.id === result.eventId)!;
  assert.equal(row.status, 'processed');
});

await test('a reserved/unknown event type is stored with status=ignored, not dropped', async () => {
  const parsed = provider.parseWebhook({ type: 'patient.merged', id: 'evt-reserved-1' });
  const result = await processExternalCalendarWebhookEvent({
    provider: 'digidentis', connectionId: 'conn-A', clinicId: 'clinic-A', organizationId: 'org-1', parsed,
  });
  assert.equal(result.outcome, 'stored');
  const row = rows.find((r) => r.id === result.eventId)!;
  assert.equal(row.status, 'ignored');
  assert.ok(row.errorMessage?.includes('patient.merged'));
});

section('Duplicate delivery at the processor level');

await test('redelivering the same event is reported as a duplicate, no second row created', async () => {
  const parsed = provider.parseWebhook({ type: 'appointment.rescheduled', id: 'evt-dup-1' });
  const first = await processExternalCalendarWebhookEvent({
    provider: 'digidentis', connectionId: 'conn-A', clinicId: 'clinic-A', organizationId: 'org-1', parsed,
  });
  const second = await processExternalCalendarWebhookEvent({
    provider: 'digidentis', connectionId: 'conn-A', clinicId: 'clinic-A', organizationId: 'org-1', parsed,
  });
  assert.equal(first.outcome, 'stored');
  assert.equal(second.outcome, 'duplicate');
  assert.equal(rows.filter((r) => r.providerEventId === 'evt-dup-1').length, 1);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;

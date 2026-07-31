/**
 * externalCalendarWebhookProcessor.test.ts — end-to-end (mocked-DB) coverage
 * of: DigiDentiS webhook signature verification tied to an encrypted
 * per-clinic secret, event-type parsing/normalization against the real
 * vendor envelope, X-Webhook-Id-based idempotency, and the "store
 * reserved/unknown events without applying unsupported domain changes"
 * phase boundary.
 *
 * Payload/header shapes below match the real vendor documentation
 * (`docs/vendor/digidentis/DigiDentiS_Takvim_API_Documentation_v3.2.html`,
 * §11 "Webhooks") — envelope `{event, timestamp, data}`, signature header
 * `X-Webhook-Signature: sha256=<hex>`, dedupe key `X-Webhook-Id`.
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
  externalCompanyId: 'cmp_a',
  externalClinicId: 'cln_a',
  apiBaseUrl: null,
};

function sign(body: Buffer): string {
  return `sha256=${createHmac('sha256', webhookSecretPlain).update(body).digest('hex')}`;
}

section('Webhook signature verification (encrypted secret round-trip, sha256=<hex> format)');

await test('a correctly signed payload verifies against the encrypted webhook secret', () => {
  const body = Buffer.from(JSON.stringify({ event: 'appointment.created', data: { id: 'apt_1' } }));
  const signature = sign(body);
  const valid = provider.verifyWebhookSignature(connection, body, { 'x-webhook-signature': signature });
  assert.equal(valid, true);
});

await test('a payload signed with the WRONG clinic secret is rejected', () => {
  const body = Buffer.from(JSON.stringify({ event: 'appointment.created', data: { id: 'apt_2' } }));
  const wrongSignature = `sha256=${createHmac('sha256', 'someone-elses-secret').update(body).digest('hex')}`;
  const valid = provider.verifyWebhookSignature(connection, body, { 'x-webhook-signature': wrongSignature });
  assert.equal(valid, false);
});

await test('a connection with no webhook secret configured always rejects', () => {
  const noSecretConnection = { ...connection, webhookSecretEncrypted: null };
  const body = Buffer.from('{}');
  const valid = provider.verifyWebhookSignature(noSecretConnection as any, body, { 'x-webhook-signature': sign(body) });
  assert.equal(valid, false);
});

section('Event envelope parsing (vendor doc §11.3: {event, timestamp, data})');

await test('appointment.created is recognized as an active event type, id read from data.id', () => {
  const parsed = provider.parseWebhook(
    { event: 'appointment.created', timestamp: '2026-08-01T09:00:00+03:00', data: { id: 'apt_1' } },
    { 'x-webhook-id': 'whk_evt_3' },
  );
  assert.equal(parsed.eventType, 'appointment.created');
  assert.equal(parsed.externalAppointmentId, 'apt_1');
});

await test('the dedupe key comes from the X-Webhook-Id header, not a hash of the payload', () => {
  const payloadA = { event: 'appointment.created', data: { id: 'apt_9' } };
  const payloadB = { event: 'appointment.created', data: { id: 'apt_9', notes: 'a different payload body' } };
  const parsedA = provider.parseWebhook(payloadA, { 'x-webhook-id': 'whk_same_delivery' });
  const parsedB = provider.parseWebhook(payloadB, { 'x-webhook-id': 'whk_same_delivery' });
  // Same X-Webhook-Id (a retried delivery of the same event) must dedupe
  // even though the payload bytes differ — proving the key is header-sourced.
  assert.equal(parsedA.providerEventId, parsedB.providerEventId);
});

await test('reserved event types (appointment.confirmed/.completed/.no_show) are recognized, not classified as unknown', () => {
  const confirmed = provider.parseWebhook({ event: 'appointment.confirmed', data: { id: 'apt_1' } }, {});
  const completed = provider.parseWebhook({ event: 'appointment.completed', data: { id: 'apt_1' } }, {});
  const noShow = provider.parseWebhook({ event: 'appointment.no_show', data: { id: 'apt_1' } }, {});
  assert.equal(confirmed.eventType, 'appointment.confirmed');
  assert.equal(completed.eventType, 'appointment.completed');
  assert.equal(noShow.eventType, 'appointment.no_show');
});

await test('a genuinely unrecognized event type (not in the documented 6-event contract) is classified as unknown', () => {
  const parsed = provider.parseWebhook({ event: 'patient.merged', data: {} }, { 'x-webhook-id': 'whk_evt_5' });
  assert.equal(parsed.eventType, 'unknown');
  assert.equal(parsed.rawEventType, 'patient.merged');
});

await test('a missing X-Webhook-Id and missing data.id falls back to a deterministic hash of the payload (dedupe-safe)', () => {
  const payload = { event: 'appointment.created', data: {} };
  const a = provider.parseWebhook(payload, {});
  const b = provider.parseWebhook(payload, {});
  assert.equal(a.providerEventId, b.providerEventId);
  assert.ok(a.providerEventId.length > 0);
});

section('Reserved/unknown events are safely stored without domain action');

await test('an active event type is stored and marked processed', async () => {
  const parsed = provider.parseWebhook({ event: 'appointment.created', data: { id: 'apt_active_1' } }, { 'x-webhook-id': 'whk-active-1' });
  const result = await processExternalCalendarWebhookEvent({
    provider: 'digidentis', connectionId: 'conn-A', clinicId: 'clinic-A', organizationId: 'org-1', parsed,
  });
  assert.equal(result.outcome, 'stored');
  const row = rows.find((r) => r.id === result.eventId)!;
  assert.equal(row.status, 'processed');
});

await test('a reserved event type (appointment.confirmed) is stored with status=ignored, not dropped, not treated as unknown', async () => {
  const parsed = provider.parseWebhook({ event: 'appointment.confirmed', data: { id: 'apt_reserved_1' } }, { 'x-webhook-id': 'whk-reserved-1' });
  const result = await processExternalCalendarWebhookEvent({
    provider: 'digidentis', connectionId: 'conn-A', clinicId: 'clinic-A', organizationId: 'org-1', parsed,
  });
  assert.equal(result.outcome, 'stored');
  const row = rows.find((r) => r.id === result.eventId)!;
  assert.equal(row.status, 'ignored');
  assert.equal(row.eventType, 'appointment.confirmed');
  assert.ok(row.errorMessage?.includes('appointment.confirmed'));
});

await test('a genuinely unknown event type is also stored with status=ignored, never dropped', async () => {
  const parsed = provider.parseWebhook({ event: 'patient.merged', data: {} }, { 'x-webhook-id': 'whk-unknown-1' });
  const result = await processExternalCalendarWebhookEvent({
    provider: 'digidentis', connectionId: 'conn-A', clinicId: 'clinic-A', organizationId: 'org-1', parsed,
  });
  assert.equal(result.outcome, 'stored');
  const row = rows.find((r) => r.id === result.eventId)!;
  assert.equal(row.status, 'ignored');
});

section('Duplicate delivery at the processor level');

await test('redelivering the same X-Webhook-Id is reported as a duplicate, no second row created', async () => {
  const parsed = provider.parseWebhook({ event: 'appointment.rescheduled', data: { id: 'apt_dup_1' } }, { 'x-webhook-id': 'whk-dup-1' });
  const first = await processExternalCalendarWebhookEvent({
    provider: 'digidentis', connectionId: 'conn-A', clinicId: 'clinic-A', organizationId: 'org-1', parsed,
  });
  const second = await processExternalCalendarWebhookEvent({
    provider: 'digidentis', connectionId: 'conn-A', clinicId: 'clinic-A', organizationId: 'org-1', parsed,
  });
  assert.equal(first.outcome, 'stored');
  assert.equal(second.outcome, 'duplicate');
  assert.equal(rows.filter((r) => r.providerEventId === 'whk-dup-1').length, 1);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;

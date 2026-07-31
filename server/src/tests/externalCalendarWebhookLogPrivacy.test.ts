/**
 * externalCalendarWebhookLogPrivacy.test.ts — regression test for the
 * externalCalendarWebhook.ts top-level unexpected-error path.
 *
 * That path used to do `console.error('[external-calendar-webhook] handler
 * error:', err)` — a raw, unstructured dump of whatever was thrown. This
 * route runs after the raw webhook body has been read and the provider
 * payload parsed (patient name/phone/email, appointment details), so a
 * thrown value that carries that payload as a property (a downstream bug,
 * or a library that rejects with `{ ...context }`) would have printed it
 * verbatim to the log stream. It's now routed through logUnhandledError
 * (server/src/utils/logger.ts), which coerces any thrown value to
 * type/message/stack only — see safeErrorLog — and redacts message/stack in
 * production.
 *
 * This test forces that catch block to fire with a thrown value that
 * deliberately carries the sensitive payload as a property, and asserts:
 *   - console.error is never called (no raw dump path left).
 *   - Nothing routed through logger.error contains the raw signature,
 *     the raw body bytes, or the sensitive payload fields (patient name,
 *     phone, email).
 *   - The route's HTTP behavior (always 200, body unread by caller) is
 *     unchanged.
 *
 * Run with: npx tsx src/tests/externalCalendarWebhookLogPrivacy.test.ts
 */

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'e'.repeat(64);

import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express from 'express';
import prisma from '../db.js';
import { encryptSecret } from '../utils/encryption.js';
import { logger } from '../utils/logger.js';

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

// ── Sentinel values (synthetic only) ────────────────────────────────────────

const SENTINEL = {
  patientFirstName: 'Ahmet-Sentinel',
  patientLastName: 'Yilmaz-Sentinel',
  phone: '+905559998877',
  email: 'sentinel-patient@example-test.invalid',
  webhookSecret: 'sentinel-webhook-secret-do-not-log',
};

const receiverKey = randomUUID();
const connectionId = 'conn-sentinel-1';
const clinicId = 'clinic-sentinel-1';
const organizationId = 'org-sentinel-1';

const connectionRow = {
  id: connectionId,
  clinicId,
  organizationId,
  provider: 'digidentis',
  clientId: 'client-sentinel',
  clientSecretEncrypted: encryptSecret('client-secret-sentinel'),
  webhookSecretEncrypted: encryptSecret(SENTINEL.webhookSecret),
  externalCompanyId: 'cmp_sentinel',
  externalClinicId: 'cln_sentinel',
  apiBaseUrl: null,
  webhookReceiverKey: receiverKey,
  enabled: true,
  status: 'connected',
};

// ── Stub Prisma: resolve the connection by receiver key, then force the
// inbound-event write to reject with a value carrying the raw payload as a
// property — the worst case a raw console.error(err) would have printed.

(prisma as any).externalCalendarIntegration = {
  async findUnique({ where }: any) {
    if (where?.webhookReceiverKey === receiverKey) return connectionRow;
    return null;
  },
};

let capturedThrow: unknown;
(prisma as any).externalCalendarInboundEvent = {
  async create({ data }: any) {
    // Simulate a buggy/adversarial rejection that carries the full
    // payload as a property rather than a plain Error message — this is
    // the class of leak a raw console.error(err) would print in full.
    const leak = { message: 'insert failed', rawPayload: data.rawPayload };
    capturedThrow = leak;
    throw leak;
  },
};

const externalCalendarWebhookRoutes = (await import('../routes/externalCalendarWebhook.js')).default;

// ── Minimal app mirroring index.ts's exact /api/public mounting ────────────

const app = express();
app.use(
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = Buffer.from(buf);
    },
  }),
);
app.use('/api/public', externalCalendarWebhookRoutes);

const httpServer = app.listen(0);
await new Promise<void>((resolve) => httpServer.once('listening', () => resolve()));
const port = (httpServer.address() as AddressInfo).port;
const webhookUrl = `http://127.0.0.1:${port}/api/public/external-calendar/digidentis/${receiverKey}/webhook`;

function sign(body: Buffer, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

function sensitivePayload(): Buffer {
  return Buffer.from(
    JSON.stringify({
      event: 'appointment.created',
      timestamp: new Date().toISOString(),
      data: {
        id: `apt-${randomUUID()}`,
        doctor_id: 'doc_1',
        clinic_id: 'cln_1',
        date: '2026-08-05',
        start_time: '10:30',
        patient: {
          first_name: SENTINEL.patientFirstName,
          last_name: SENTINEL.patientLastName,
          phone: SENTINEL.phone,
          email: SENTINEL.email,
        },
        status: 'confirmed',
      },
    }),
  );
}

// ── Capture everything routed through the structured logger ────────────────

const loggedCalls: unknown[] = [];
const originalLoggerError = logger.error.bind(logger);
(logger as any).error = (...args: unknown[]) => {
  loggedCalls.push(args);
  return undefined;
};

const consoleErrorCalls: unknown[] = [];
const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  consoleErrorCalls.push(args);
};

async function settle(ms = 300) {
  await new Promise((r) => setTimeout(r, ms));
}

section('externalCalendarWebhook.ts unexpected-error path never logs raw sensitive payload data');

await test('a webhook whose downstream processing throws still responds 200 immediately', async () => {
  const bodyBuf = sensitivePayload();
  const signature = sign(bodyBuf, SENTINEL.webhookSecret);
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Signature': signature,
      'X-Webhook-Id': `whk-${randomUUID()}`,
    },
    body: bodyBuf as unknown as BodyInit,
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.deepEqual(json, { status: 'ok' });
  await settle();
});

await test('the forced failure actually reached the catch block (sanity check on the harness)', () => {
  assert.ok(capturedThrow, 'expected the stubbed prisma.create to have been invoked and to have thrown');
});

await test('console.error was never called for the handler error (no raw dump path remains)', () => {
  assert.equal(consoleErrorCalls.length, 0, `expected no console.error calls, got: ${JSON.stringify(consoleErrorCalls)}`);
});

await test('logger.error was called exactly once via the structured path', () => {
  assert.equal(loggedCalls.length, 1);
});

await test('the logged object never contains the raw signature, secret, or patient name/phone/email', () => {
  const serialized = JSON.stringify(loggedCalls);
  const signature = sign(sensitivePayload(), SENTINEL.webhookSecret);
  const forbidden = [
    SENTINEL.webhookSecret,
    signature,
    SENTINEL.patientFirstName,
    SENTINEL.patientLastName,
    SENTINEL.phone,
    SENTINEL.email,
    'rawPayload',
    'doctor_id',
  ];
  for (const needle of forbidden) {
    assert.ok(
      !serialized.includes(needle),
      `logged output must not contain "${needle}" — got: ${serialized}`,
    );
  }
});

await test('the logged object only carries the allowlisted structured fields', () => {
  const [[logObject, msg]] = loggedCalls as [[Record<string, unknown>, string]];
  assert.equal(msg, 'unhandled error');
  const allowedKeys = new Set(['reqId', 'route', 'status', 'errType', 'errMessage', 'errStack']);
  for (const key of Object.keys(logObject)) {
    assert.ok(allowedKeys.has(key), `unexpected field "${key}" in logged object: ${JSON.stringify(logObject)}`);
  }
  assert.equal(logObject.status, 200, 'route always responds 200 before processing, per its documented contract');
});

console.error = originalConsoleError;
(logger as any).error = originalLoggerError;

await new Promise<void>((resolve) => httpServer.close(() => resolve()));

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;

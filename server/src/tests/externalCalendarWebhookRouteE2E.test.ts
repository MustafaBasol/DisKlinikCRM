/**
 * externalCalendarWebhookRouteE2E.test.ts — real-HTTP end-to-end coverage of
 * the actual `routes/externalCalendarWebhook.ts` Express router (mounted
 * exactly as production does, at `/api/public`, see index.ts:184), verified
 * against `docs/vendor/digidentis/DigiDentiS_Takvim_API_Documentation_v3.2.html`
 * §11 "Webhooks".
 *
 * Existing coverage (externalCalendarWebhookProcessor.test.ts) calls
 * `provider.verifyWebhookSignature`/`parseWebhook`/
 * `processExternalCalendarWebhookEvent` directly — it never spins up the
 * route itself. This suite does: a real `express()` app mounting the real,
 * unmodified router on `app.listen(0)`, driven with real `node:http`
 * requests (mirroring httpRequestLogPrivacy.test.ts's withServer/issueRequest
 * pattern) carrying the exact documented `X-Webhook-Signature: sha256=<hex>`
 * / `X-Webhook-Id` headers a real DigiDentiS delivery would send.
 *
 * Harness: no live Postgres in this environment (same documented constraint
 * as externalCalendarConnectionService.test.ts / externalCalendarWebhookProcessor.test.ts)
 * — prisma's model delegates are swapped for small in-memory fakes for the
 * duration of this process, and the router/services are dynamically
 * imported AFTER that swap so every prisma call they make hits the fakes.
 *
 * Run with: npx tsx src/tests/externalCalendarWebhookRouteE2E.test.ts
 */

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? 'e'.repeat(64);

import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac, randomUUID } from 'node:crypto';
import express from 'express';
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

// ── In-memory Prisma fakes (same shape/convention as
// externalCalendarConnectionService.test.ts and
// externalCalendarWebhookProcessor.test.ts) ─────────────────────────────────

type ClinicRow = { id: string; organizationId: string };
type IntegrationRow = {
  id: string;
  clinicId: string;
  organizationId: string;
  provider: string;
  enabled: boolean;
  status: string;
  clientId: string | null;
  clientSecretEncrypted: string | null;
  webhookSecretEncrypted: string | null;
  webhookReceiverKey: string;
  externalCompanyId: string | null;
  externalClinicId: string | null;
  apiBaseUrl: string | null;
  lastSuccessfulCheckAt: Date | null;
  lastCheckedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};
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

const clinics = new Map<string, ClinicRow>([
  ['clinic-A', { id: 'clinic-A', organizationId: 'org-A' }],
  ['clinic-B', { id: 'clinic-B', organizationId: 'org-B' }],
]);
let integrations: IntegrationRow[] = [];
let events: EventRow[] = [];
const auditEvents: Array<Record<string, unknown>> = [];
let integrationSeq = 0;
let eventSeq = 0;

function findIntegrationByClinic(clinicId: string) {
  return integrations.find((r) => r.clinicId === clinicId) ?? null;
}

(prisma as any).clinic = {
  async findUnique({ where }: any) {
    return clinics.get(where.id) ?? null;
  },
};

(prisma as any).externalCalendarIntegration = {
  async findUnique({ where }: any) {
    if (where.clinicId) return findIntegrationByClinic(where.clinicId);
    if (where.id) return integrations.find((r) => r.id === where.id) ?? null;
    if (where.webhookReceiverKey) return integrations.find((r) => r.webhookReceiverKey === where.webhookReceiverKey) ?? null;
    return null;
  },
  async upsert({ where, create, update }: any) {
    const existing = findIntegrationByClinic(where.clinicId);
    if (existing) {
      Object.assign(existing, update, { updatedAt: new Date() });
      return existing;
    }
    const row: IntegrationRow = {
      id: `conn-${++integrationSeq}`,
      clinicId: where.clinicId,
      organizationId: create.organizationId,
      provider: create.provider ?? 'digidentis',
      enabled: false,
      status: create.status ?? 'not_configured',
      clientId: create.clientId ?? null,
      clientSecretEncrypted: create.clientSecretEncrypted ?? null,
      webhookSecretEncrypted: create.webhookSecretEncrypted ?? null,
      webhookReceiverKey: create.webhookReceiverKey,
      externalCompanyId: create.externalCompanyId ?? null,
      externalClinicId: create.externalClinicId ?? null,
      apiBaseUrl: create.apiBaseUrl ?? null,
      lastSuccessfulCheckAt: null,
      lastCheckedAt: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    integrations.push(row);
    return row;
  },
};

/**
 * A providerEventId matching this sentinel forces `create` to throw a
 * generic (non-P2002) error — simulating an unexpected DB failure so the
 * route handler's outer `catch` block (`console.error('[external-calendar-webhook]
 * handler error:', err)` in routes/externalCalendarWebhook.ts) actually
 * fires. Used by the "structured webhook error logging" regression test
 * below.
 */
const FORCE_HANDLER_ERROR_WEBHOOK_ID = 'whk_force_handler_error_regression';

(prisma as any).externalCalendarInboundEvent = {
  async create({ data }: any) {
    if (data.providerEventId === FORCE_HANDLER_ERROR_WEBHOOK_ID) {
      throw new Error('synthetic forced failure for handler-error regression test');
    }
    const dup = events.some(
      (r) => r.provider === data.provider && r.connectionId === data.connectionId && r.providerEventId === data.providerEventId,
    );
    if (dup) {
      const err = new Error('Unique constraint failed') as Error & { code: string };
      err.code = 'P2002';
      throw err;
    }
    const row: EventRow = {
      id: `evt-${++eventSeq}`,
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
    events.push(row);
    return { id: row.id };
  },
  async update({ where, data }: any) {
    const row = events.find((r) => r.id === where.id);
    if (!row) throw new Error('not found');
    Object.assign(row, data, { updatedAt: new Date() });
    return row;
  },
};

(prisma as any).auditLog = {
  async create({ data }: any) {
    auditEvents.push(data);
    return data;
  },
};

// ── Imports that depend on the mocked prisma above (must come after it) ────

const { upsertExternalCalendarIntegration } = await import(
  '../services/externalCalendar/externalCalendarConnectionService.js'
);
const externalCalendarWebhookRoutes = (await import('../routes/externalCalendarWebhook.js')).default;

// ── Test app — mounts the REAL router at the REAL production path ─────────

function buildApp() {
  const app = express();
  app.use('/api/public', externalCalendarWebhookRoutes);
  return app;
}

async function withServer(fn: (port: number) => Promise<void>) {
  const app = buildApp();
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a TCP port');
  try {
    await fn(address.port);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function postWebhook(
  port: number,
  receiverKey: string,
  bodyBuffer: Buffer,
  headers: Record<string, string> = {},
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: `/api/public/external-calendar/digidentis/${encodeURIComponent(receiverKey)}/webhook`,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(bodyBuffer),
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.on('error', reject);
    req.write(bodyBuffer);
    req.end();
  });
}

function sign(body: Buffer, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

function webhookPayload(event: string, data: Record<string, unknown>) {
  return Buffer.from(JSON.stringify({ event, timestamp: new Date().toISOString(), data }));
}

// ── Fixture clinics — two tenants, each with its own secret + receiver key ─

const CLINIC_A_WEBHOOK_SECRET = 'clinic-A-webhook-secret-sentinel';
const CLINIC_B_WEBHOOK_SECRET = 'clinic-B-webhook-secret-sentinel';

const SENTINEL_PATIENT_NAME = 'Sentinel Webhook Patient';
const SENTINEL_PATIENT_PHONE = '+905557778888';

let clinicASummary: Awaited<ReturnType<typeof upsertExternalCalendarIntegration>>;
let clinicBSummary: Awaited<ReturnType<typeof upsertExternalCalendarIntegration>>;

async function main() {
  clinicASummary = await upsertExternalCalendarIntegration('clinic-A', {
    clientId: 'client-a',
    clientSecret: 'client-a-api-secret',
    webhookSecret: CLINIC_A_WEBHOOK_SECRET,
    externalClinicId: 'ext-clinic-a',
  });
  clinicBSummary = await upsertExternalCalendarIntegration('clinic-B', {
    clientId: 'client-b',
    clientSecret: 'client-b-api-secret',
    webhookSecret: CLINIC_B_WEBHOOK_SECRET,
    externalClinicId: 'ext-clinic-b',
  });

  const receiverKeyA = clinicASummary.webhookReceiverKey;
  const receiverKeyB = clinicBSummary.webhookReceiverKey;
  assert.notEqual(receiverKeyA, receiverKeyB, 'sanity: fixtures must have distinct receiver keys');

  section('Documented delivery format — X-Webhook-Signature (sha256=<hex>) + X-Webhook-Id (§11.2/§11.4)');

  await withServer(async (port) => {
    await test('a correctly signed appointment.created delivery is accepted (HTTP 200) and durably recorded as processed', async () => {
      const body = webhookPayload('appointment.created', { id: 'apt_created_1' });
      const res = await postWebhook(port, receiverKeyA, body, {
        'x-webhook-signature': sign(body, CLINIC_A_WEBHOOK_SECRET),
        'x-webhook-id': `whk_${randomUUID()}`,
      });
      assert.equal(res.statusCode, 200);
      await new Promise((r) => setTimeout(r, 20)); // processing happens after the 200 is sent
      const row = events.find((e) => e.externalAppointmentId === 'apt_created_1');
      assert.ok(row, 'expected the event to be durably recorded');
      assert.equal(row!.status, 'processed');
      assert.equal(row!.clinicId, 'clinic-A');
    });
  });

  section('Invalid signature (§11.4) — rejected, nothing recorded, always still HTTP 200 (never reveals validity)');

  await withServer(async (port) => {
    await test('a delivery with an invalid signature is dropped: no event row, but the route still returns 200', async () => {
      const body = webhookPayload('appointment.created', { id: 'apt_bad_sig_1' });
      const before = events.length;
      const res = await postWebhook(port, receiverKeyA, body, {
        'x-webhook-signature': 'sha256=' + '0'.repeat(64),
        'x-webhook-id': `whk_${randomUUID()}`,
      });
      assert.equal(res.statusCode, 200, 'the route must never leak validity via status code');
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(events.length, before, 'an invalid signature must never produce a stored event');
      assert.ok(!events.some((e) => e.externalAppointmentId === 'apt_bad_sig_1'));
    });
  });

  section('Duplicate delivery (§11.5) — same X-Webhook-Id redelivered is a no-op, not a second row');

  await withServer(async (port) => {
    const webhookId = `whk_dup_${randomUUID()}`;
    const body = webhookPayload('appointment.rescheduled', { id: 'apt_dup_route_1' });
    const headers = { 'x-webhook-signature': sign(body, CLINIC_A_WEBHOOK_SECRET), 'x-webhook-id': webhookId };

    await test('first delivery of a webhook id is stored', async () => {
      const res = await postWebhook(port, receiverKeyA, body, headers);
      assert.equal(res.statusCode, 200);
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(events.filter((e) => e.providerEventId === webhookId).length, 1);
    });

    await test('redelivering the exact same X-Webhook-Id does not create a second row', async () => {
      const res = await postWebhook(port, receiverKeyA, body, headers);
      assert.equal(res.statusCode, 200);
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(events.filter((e) => e.providerEventId === webhookId).length, 1, 'duplicate delivery must not double-record');
    });
  });

  section('Documented event types (§11.1) — active events processed, reserved/unknown stored but ignored, never dropped');

  await withServer(async (port) => {
    const cases: Array<[string, string, string]> = [
      ['appointment.created', 'processed', 'apt_evt_created'],
      ['appointment.cancelled', 'processed', 'apt_evt_cancelled'],
      ['appointment.rescheduled', 'processed', 'apt_evt_rescheduled'],
      ['appointment.confirmed', 'ignored', 'apt_evt_confirmed_reserved'],
      ['patient.merged', 'ignored', 'apt_evt_unknown'],
    ];
    for (const [eventType, expectedStatus, dataId] of cases) {
      await test(`${eventType} → stored with status="${expectedStatus}"`, async () => {
        const body = webhookPayload(eventType, { id: dataId });
        const res = await postWebhook(port, receiverKeyA, body, {
          'x-webhook-signature': sign(body, CLINIC_A_WEBHOOK_SECRET),
          'x-webhook-id': `whk_${randomUUID()}`,
        });
        assert.equal(res.statusCode, 200);
        await new Promise((r) => setTimeout(r, 20));
        const row = events.find((e) => e.externalAppointmentId === dataId);
        assert.ok(row, `expected ${eventType} to be recorded, never dropped`);
        assert.equal(row!.status, expectedStatus);
      });
    }
  });

  section('Opaque receiver key resolves the correct clinic and cannot cross tenant boundaries');

  await withServer(async (port) => {
    await test('a delivery to clinic A\'s receiver key is attributed to clinic A, never clinic B', async () => {
      const body = webhookPayload('appointment.created', { id: 'apt_tenant_a_1' });
      await postWebhook(port, receiverKeyA, body, {
        'x-webhook-signature': sign(body, CLINIC_A_WEBHOOK_SECRET),
        'x-webhook-id': `whk_${randomUUID()}`,
      });
      await new Promise((r) => setTimeout(r, 20));
      const row = events.find((e) => e.externalAppointmentId === 'apt_tenant_a_1')!;
      assert.equal(row.clinicId, 'clinic-A');
      assert.equal(row.organizationId, 'org-A');
    });

    await test('a payload whose body claims a different clinic/company id is still attributed to the URL-resolved clinic, never the body', async () => {
      const body = webhookPayload('appointment.created', {
        id: 'apt_tenant_spoof_1',
        clinic_id: 'ext-clinic-b',
        company_id: 'attacker-supplied-company',
      });
      await postWebhook(port, receiverKeyA, body, {
        'x-webhook-signature': sign(body, CLINIC_A_WEBHOOK_SECRET),
        'x-webhook-id': `whk_${randomUUID()}`,
      });
      await new Promise((r) => setTimeout(r, 20));
      const row = events.find((e) => e.externalAppointmentId === 'apt_tenant_spoof_1')!;
      assert.equal(row.clinicId, 'clinic-A', 'clinicId must come from the resolved connection row, never the request body');
    });

    await test('a signature valid for clinic B is rejected on clinic A\'s receiver key (cross-tenant forgery is impossible)', async () => {
      const body = webhookPayload('appointment.created', { id: 'apt_cross_tenant_1' });
      const before = events.length;
      const res = await postWebhook(port, receiverKeyA, body, {
        // Signed with clinic B's real webhook secret, but delivered to A's URL.
        'x-webhook-signature': sign(body, CLINIC_B_WEBHOOK_SECRET),
        'x-webhook-id': `whk_${randomUUID()}`,
      });
      assert.equal(res.statusCode, 200);
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(events.length, before);
      assert.ok(!events.some((e) => e.externalAppointmentId === 'apt_cross_tenant_1'));
    });

    await test('the same X-Webhook-Id delivered to two different clinics\' receiver keys records two independent events, not a false dedupe across tenants', async () => {
      const sharedWebhookId = `whk_shared_${randomUUID()}`;
      const bodyA = webhookPayload('appointment.created', { id: 'apt_shared_id_a' });
      const bodyB = webhookPayload('appointment.created', { id: 'apt_shared_id_b' });

      await postWebhook(port, receiverKeyA, bodyA, {
        'x-webhook-signature': sign(bodyA, CLINIC_A_WEBHOOK_SECRET),
        'x-webhook-id': sharedWebhookId,
      });
      await postWebhook(port, receiverKeyB, bodyB, {
        'x-webhook-signature': sign(bodyB, CLINIC_B_WEBHOOK_SECRET),
        'x-webhook-id': sharedWebhookId,
      });
      await new Promise((r) => setTimeout(r, 20));

      const rowA = events.find((e) => e.externalAppointmentId === 'apt_shared_id_a');
      const rowB = events.find((e) => e.externalAppointmentId === 'apt_shared_id_b');
      assert.ok(rowA && rowB, 'both tenants\' deliveries must be recorded independently');
      assert.equal(rowA!.clinicId, 'clinic-A');
      assert.equal(rowB!.clinicId, 'clinic-B');
      assert.notEqual(rowA!.id, rowB!.id);
    });

    await test('an unknown receiver key is silently dropped: HTTP 200, no event, no clinic ever resolved', async () => {
      const body = webhookPayload('appointment.created', { id: 'apt_unknown_key_1' });
      const before = events.length;
      const res = await postWebhook(port, 'not-a-real-receiver-key', body, {
        'x-webhook-signature': sign(body, CLINIC_A_WEBHOOK_SECRET),
        'x-webhook-id': `whk_${randomUUID()}`,
      });
      assert.equal(res.statusCode, 200);
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(events.length, before);
    });
  });

  section('Privacy — secrets, signatures, and patient PII never appear in the audit log or captured console output');

  const consoleLines: string[] = [];
  const originalConsoleLog = console.log.bind(console);
  const originalConsoleError = console.error.bind(console);
  console.log = (...args: unknown[]) => { consoleLines.push(args.map(String).join(' ')); originalConsoleLog(...args); };
  console.error = (...args: unknown[]) => { consoleLines.push(args.map(String).join(' ')); originalConsoleError(...args); };

  await withServer(async (port) => {
    await test('a delivery embedding a full patient name/phone in the payload never leaks those values into the audit log', async () => {
      const body = webhookPayload('appointment.created', {
        id: 'apt_pii_1',
        patient_name: SENTINEL_PATIENT_NAME,
        patient_phone: SENTINEL_PATIENT_PHONE,
      });
      await postWebhook(port, receiverKeyA, body, {
        'x-webhook-signature': sign(body, CLINIC_A_WEBHOOK_SECRET),
        'x-webhook-id': `whk_${randomUUID()}`,
      });
      await new Promise((r) => setTimeout(r, 20));
      const auditText = JSON.stringify(auditEvents);
      assert.ok(!auditText.includes(SENTINEL_PATIENT_NAME), 'patient name leaked into audit log');
      assert.ok(!auditText.includes(SENTINEL_PATIENT_PHONE), 'patient phone leaked into audit log');
    });

    await test('an invalid-signature attempt is audit-logged without ever including the webhook secret or the attempted signature value', async () => {
      const body = webhookPayload('appointment.created', { id: 'apt_pii_2' });
      const forgedSignature = sign(body, 'a-completely-wrong-secret-value');
      await postWebhook(port, receiverKeyA, body, {
        'x-webhook-signature': forgedSignature,
        'x-webhook-id': `whk_${randomUUID()}`,
      });
      await new Promise((r) => setTimeout(r, 20));
      const auditText = JSON.stringify(auditEvents);
      assert.ok(!auditText.includes(CLINIC_A_WEBHOOK_SECRET), 'clinic A webhook secret leaked into audit log');
      assert.ok(!auditText.includes(forgedSignature.replace('sha256=', '')), 'attempted signature value leaked into audit log');
    });

    // Regression: routes/externalCalendarWebhook.ts's outer catch
    // (`console.error('[external-calendar-webhook] handler error:', err)`)
    // must keep firing with its structured tag on any unexpected processing
    // failure — never crash the response, and never let the logged error
    // carry the request's secrets/PII (see FORCE_HANDLER_ERROR_WEBHOOK_ID
    // above, which forces the DB write inside processExternalCalendarWebhookEvent
    // to throw a genuine, non-duplicate error).
    await test('an unexpected processing error is caught, logged with the structured handler-error tag, and never surfaces as a non-200 or leaks secrets/PII', async () => {
      const body = webhookPayload('appointment.created', {
        id: 'apt_force_handler_error',
        patient_name: SENTINEL_PATIENT_NAME,
        patient_phone: SENTINEL_PATIENT_PHONE,
      });
      const res = await postWebhook(port, receiverKeyA, body, {
        'x-webhook-signature': sign(body, CLINIC_A_WEBHOOK_SECRET),
        'x-webhook-id': FORCE_HANDLER_ERROR_WEBHOOK_ID,
      });
      assert.equal(res.statusCode, 200, 'an unexpected processing error must never surface as a non-200 to the provider');
      await new Promise((r) => setTimeout(r, 20));

      const loggedLine = consoleLines.find((l) => l.includes('[external-calendar-webhook] handler error:'));
      assert.ok(loggedLine, 'expected the outer catch to log with its structured "[external-calendar-webhook] handler error:" tag');
      assert.ok(!loggedLine!.includes(CLINIC_A_WEBHOOK_SECRET), 'clinic A webhook secret leaked into the handler-error log line');
      assert.ok(!loggedLine!.includes(SENTINEL_PATIENT_NAME), 'patient name leaked into the handler-error log line');
      assert.ok(!loggedLine!.includes(SENTINEL_PATIENT_PHONE), 'patient phone leaked into the handler-error log line');
      assert.ok(
        !events.some((e) => e.externalAppointmentId === 'apt_force_handler_error'),
        'a request that failed before the DB write completed must never leave a stored event row behind',
      );
    });
  });

  console.log = originalConsoleLog;
  console.error = originalConsoleError;

  await test('neither webhook secret, nor any captured signature, nor sentinel patient PII appears anywhere in this run\'s console output', () => {
    const fullText = consoleLines.join('\n');
    const forbidden: Record<string, string> = {
      clinicASecret: CLINIC_A_WEBHOOK_SECRET,
      clinicBSecret: CLINIC_B_WEBHOOK_SECRET,
      patientName: SENTINEL_PATIENT_NAME,
      patientPhone: SENTINEL_PATIENT_PHONE,
    };
    for (const [label, value] of Object.entries(forbidden)) {
      assert.ok(!fullText.includes(value), `${label} leaked into console output`);
    }
  });

  await test('the ExternalCalendarIntegrationSummary DTO for either clinic never carries the raw webhook secret', () => {
    const jsonA = JSON.stringify(clinicASummary);
    const jsonB = JSON.stringify(clinicBSummary);
    assert.ok(!jsonA.includes(CLINIC_A_WEBHOOK_SECRET));
    assert.ok(!jsonB.includes(CLINIC_B_WEBHOOK_SECRET));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});

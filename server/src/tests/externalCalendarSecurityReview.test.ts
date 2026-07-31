/**
 * externalCalendarSecurityReview.test.ts — real-database, real-HTTP coverage
 * for the two properties the rest of the external-calendar test suite can't
 * exercise with a mocked Prisma object:
 *
 *   1. True concurrent duplicate webhook deliveries dedupe to exactly one
 *      stored row, relying on the actual Postgres unique constraint
 *      (@@unique([provider, connectionId, providerEventId])) rather than
 *      any in-process check.
 *   2. Cross-clinic isolation holds under real rows in a real database:
 *      receiver-key resolution, webhook signature scoping, provider-event-id
 *      collisions between two different clinics, and mapping IDOR attempts.
 *
 * Requires a real, disposable Postgres reachable at DATABASE_URL (schema
 * already migrated via `prisma migrate deploy`). This is deliberately NOT
 * wired into `npm test` — the rest of this repo's suite runs against a
 * mocked Prisma object with no live database, and this file's whole point
 * is to test the one thing that mocking can't: real concurrent writes
 * against a real unique index.
 *
 * Run with a live Postgres:
 *   DATABASE_URL=postgresql://user:pass@host:port/db \
 *     npx tsx src/tests/externalCalendarSecurityReview.test.ts
 */

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'd'.repeat(64);

import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'crypto';
import express from 'express';
import type { AddressInfo } from 'node:net';

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
      console.error(`      ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
      failed++;
    });
}

function section(title: string) {
  console.log(`\n${title}`);
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set — this test requires a real, disposable Postgres database.');
  process.exit(1);
}

const prismaModule = await import('../db.js');
const prisma = prismaModule.default;
const { encryptSecret } = await import('../utils/encryption.js');
const externalCalendarWebhookRoutes = (await import('../routes/externalCalendarWebhook.js')).default;
const {
  getExternalCalendarConnectionRecordByReceiverKey,
} = await import('../services/externalCalendar/externalCalendarConnectionService.js');
const {
  upsertExternalCalendarMapping,
  deactivateExternalCalendarMapping,
  listExternalCalendarMappings,
  ExternalCalendarMappingLocalEntityInvalidError,
} = await import('../services/externalCalendar/externalCalendarMappingService.js');

// ── Seed two independent clinics/orgs, each with its own integration row ──────

type SeededClinic = {
  org: { id: string };
  clinic: { id: string };
  dentist: { id: string };
  integration: { id: string };
  receiverKey: string;
  webhookSecretPlain: string;
};

async function seedClinic(label: string): Promise<SeededClinic> {
  const suffix = randomUUID();
  const org = await prisma.organization.create({
    data: { name: `Review Org ${label}`, slug: `review-org-${label.toLowerCase()}-${suffix}` },
  });
  const clinic = await prisma.clinic.create({
    data: { name: `Review Clinic ${label}`, slug: `review-clinic-${label.toLowerCase()}-${suffix}`, organizationId: org.id },
  });
  const dentist = await prisma.user.create({
    data: {
      clinicId: clinic.id,
      organizationId: org.id,
      firstName: 'Dr',
      lastName: label,
      email: `dentist-${label.toLowerCase()}-${suffix}@example.test`,
      role: 'DENTIST',
      passwordHash: 'not-a-real-hash',
      isActive: true,
    },
  });

  const receiverKey = randomBytes(32).toString('base64url');
  const webhookSecretPlain = `webhook-secret-${label}-${suffix}`;
  const integration = await prisma.externalCalendarIntegration.create({
    data: {
      clinicId: clinic.id,
      organizationId: org.id,
      provider: 'digidentis',
      status: 'configured',
      enabled: false,
      webhookReceiverKey: receiverKey,
      webhookSecretEncrypted: encryptSecret(webhookSecretPlain),
      clientId: `client-${label}`,
      clientSecretEncrypted: encryptSecret(`client-secret-${label}`),
      externalClinicId: `ext-cln-${label}`,
      externalCompanyId: `ext-cmp-${label}`,
    },
  });

  return { org, clinic, dentist, integration, receiverKey, webhookSecretPlain };
}

const clinicA = await seedClinic('A');
const clinicB = await seedClinic('B');

function sign(body: Buffer, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

// ── Minimal Express app mirroring index.ts's exact /api/public mounting ───────
// (app-level express.json() with a `verify` callback that stashes the raw
// bytes on req.rawBody — the webhook route's signature check reads that,
// not a re-serialization, so this harness must reproduce it exactly.)

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
const baseUrl = `http://127.0.0.1:${port}`;

function webhookUrl(receiverKey: string): string {
  return `${baseUrl}/api/public/external-calendar/digidentis/${receiverKey}/webhook`;
}

async function postWebhook(receiverKey: string, bodyBuf: Buffer, signature: string, webhookId: string) {
  return fetch(webhookUrl(receiverKey), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Signature': signature,
      'X-Webhook-Id': webhookId,
    },
    body: bodyBuf as unknown as BodyInit,
  });
}

function appointmentCreatedPayload(): Buffer {
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
        patient: { first_name: 'Ahmet', last_name: 'Yilmaz', phone: '+905551234567', email: 'ahmet@example.test' },
        status: 'confirmed',
      },
    }),
  );
}

async function settle(ms = 500) {
  await new Promise((r) => setTimeout(r, ms));
}

// ── A. Real concurrent duplicate webhook delivery ──────────────────────────────

section('A. Real-DB concurrency: identical webhook deliveries dedupe to exactly one row');

await test('20 truly concurrent, identically-signed webhook POSTs -> exactly 1 stored row, no duplicates', async () => {
  const webhookId = `whk-concurrency-${randomUUID()}`;
  const bodyBuf = appointmentCreatedPayload();
  const signature = sign(bodyBuf, clinicA.webhookSecretPlain);

  const CONCURRENCY = 20;
  const responses = await Promise.all(
    Array.from({ length: CONCURRENCY }, () => postWebhook(clinicA.receiverKey, bodyBuf, signature, webhookId)),
  );
  assert.ok(
    responses.every((r) => r.status === 200),
    'every delivery gets a 200 regardless of dedupe outcome (never reveals validity)',
  );

  // Poll until the async processing settles, then wait a further beat to
  // catch any late-arriving duplicate row before asserting the final count.
  const deadline = Date.now() + 5000;
  let rows: unknown[] = [];
  while (Date.now() < deadline) {
    rows = await prisma.externalCalendarInboundEvent.findMany({
      where: { connectionId: clinicA.integration.id, providerEventId: webhookId },
    });
    if (rows.length > 0) break;
    await settle(100);
  }
  await settle(500);

  const finalRows = await prisma.externalCalendarInboundEvent.findMany({
    where: { connectionId: clinicA.integration.id, providerEventId: webhookId },
  });
  assert.equal(finalRows.length, 1, `expected exactly 1 row after ${CONCURRENCY} concurrent identical deliveries, got ${finalRows.length}`);
  assert.equal(finalRows[0].status, 'processed');
  assert.equal(finalRows[0].clinicId, clinicA.clinic.id);
});

// ── B. Cross-clinic isolation ───────────────────────────────────────────────────

section('B. Cross-clinic isolation (real rows, real signatures)');

await test('receiver key resolves only its own clinic connection', async () => {
  const a = await getExternalCalendarConnectionRecordByReceiverKey(clinicA.receiverKey);
  const b = await getExternalCalendarConnectionRecordByReceiverKey(clinicB.receiverKey);
  assert.equal(a?.clinicId, clinicA.clinic.id);
  assert.equal(b?.clinicId, clinicB.clinic.id);
  assert.notEqual(a?.id, b?.id);
});

await test('a payload signed with clinic A\'s secret is rejected on clinic B\'s webhook URL (no row created)', async () => {
  const webhookId = `whk-crossclinic-sig-${randomUUID()}`;
  const bodyBuf = appointmentCreatedPayload();
  const signedWithWrongSecret = sign(bodyBuf, clinicA.webhookSecretPlain);

  const res = await postWebhook(clinicB.receiverKey, bodyBuf, signedWithWrongSecret, webhookId);
  assert.equal(res.status, 200); // still 200 — never reveals validity
  await settle();

  const rows = await prisma.externalCalendarInboundEvent.findMany({ where: { providerEventId: webhookId } });
  assert.equal(rows.length, 0, 'a cross-clinic signature must never be accepted');
});

await test('the SAME providerEventId delivered to two different clinics concurrently does not dedupe across clinics', async () => {
  const webhookId = `whk-cross-collide-${randomUUID()}`;
  const bodyBuf = appointmentCreatedPayload();
  const sigA = sign(bodyBuf, clinicA.webhookSecretPlain);
  const sigB = sign(bodyBuf, clinicB.webhookSecretPlain);

  await Promise.all([
    postWebhook(clinicA.receiverKey, bodyBuf, sigA, webhookId),
    postWebhook(clinicB.receiverKey, bodyBuf, sigB, webhookId),
  ]);
  await settle();

  const rowsA = await prisma.externalCalendarInboundEvent.findMany({
    where: { connectionId: clinicA.integration.id, providerEventId: webhookId },
  });
  const rowsB = await prisma.externalCalendarInboundEvent.findMany({
    where: { connectionId: clinicB.integration.id, providerEventId: webhookId },
  });
  assert.equal(rowsA.length, 1, 'clinic A must get its own stored row');
  assert.equal(rowsB.length, 1, 'clinic B must get its own stored row, not deduped against A');
  assert.equal(rowsA[0].clinicId, clinicA.clinic.id);
  assert.equal(rowsB[0].clinicId, clinicB.clinic.id);
});

section('C. Cross-clinic mapping IDOR attempts (real rows)');

await test('a mapping created under clinic A cannot be deactivated by passing clinic B\'s id', async () => {
  const mapping = await upsertExternalCalendarMapping(clinicA.integration.id, clinicA.clinic.id, clinicA.org.id, {
    mappingType: 'practitioner',
    localId: clinicA.dentist.id,
    externalId: 'doc_ext_a',
  });

  await deactivateExternalCalendarMapping(mapping.id, clinicB.clinic.id); // wrong clinic — must be a no-op

  const stillActive = await prisma.externalCalendarMapping.findUnique({ where: { id: mapping.id } });
  assert.equal(stillActive?.isActive, true, 'cross-clinic deactivation attempt must not affect another clinic\'s mapping');
});

await test('listing clinic A\'s connection mappings while scoped to clinic B returns nothing', async () => {
  const rows = await listExternalCalendarMappings(clinicA.integration.id, clinicB.clinic.id);
  assert.equal(rows.length, 0);
});

await test('mapping clinic A\'s connection to clinic B\'s practitioner id is rejected', async () => {
  await assert.rejects(
    () =>
      upsertExternalCalendarMapping(clinicA.integration.id, clinicA.clinic.id, clinicA.org.id, {
        mappingType: 'practitioner',
        localId: clinicB.dentist.id,
        externalId: 'doc_ext_x',
      }),
    ExternalCalendarMappingLocalEntityInvalidError,
  );
});

// ── Cleanup ──────────────────────────────────────────────────────────────────

await new Promise<void>((resolve) => httpServer.close(() => resolve()));
await prisma.$disconnect();

console.log(`\n${'─'.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;

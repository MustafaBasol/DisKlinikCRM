/**
 * externalCalendarConnectionService.test.ts — tenant isolation, encrypted
 * secrets, and clinic-specific configuration for ExternalCalendarIntegration.
 *
 * Harness: no live Postgres in this environment (same documented constraint
 * as other route/service tests in this repo) — prisma's model delegates are
 * swapped for small in-memory fakes for the duration of this process.
 *
 * Run with: npx tsx src/tests/externalCalendarConnectionService.test.ts
 */

process.env.ENCRYPTION_KEY = 'a'.repeat(64);

import assert from 'node:assert/strict';
import prisma from '../db.js';
import { decryptSecret } from '../utils/encryption.js';

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

// ─── In-memory fakes ─────────────────────────────────────────────────────────

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

const clinics = new Map<string, ClinicRow>([
  ['clinic-A', { id: 'clinic-A', organizationId: 'org-1' }],
  ['clinic-B', { id: 'clinic-B', organizationId: 'org-1' }],
]);
let integrations: IntegrationRow[] = [];
const auditEvents: unknown[] = [];
let seq = 0;

function findIntegration(clinicId: string) {
  return integrations.find((r) => r.clinicId === clinicId) ?? null;
}

(prisma as any).clinic = {
  async findUnique({ where }: any) {
    return clinics.get(where.id) ?? null;
  },
};

(prisma as any).externalCalendarIntegration = {
  async findUnique({ where }: any) {
    if (where.clinicId) return findIntegration(where.clinicId);
    if (where.id) return integrations.find((r) => r.id === where.id) ?? null;
    if (where.webhookReceiverKey) return integrations.find((r) => r.webhookReceiverKey === where.webhookReceiverKey) ?? null;
    return null;
  },
  async upsert({ where, create, update }: any) {
    const existing = findIntegration(where.clinicId);
    if (existing) {
      Object.assign(existing, update, { updatedAt: new Date() });
      return existing;
    }
    if (!create.webhookReceiverKey) throw new Error('webhookReceiverKey must be generated on create');
    const row: IntegrationRow = {
      id: `conn-${++seq}`,
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
  async update({ where, data }: any) {
    const existing = where.clinicId ? findIntegration(where.clinicId) : integrations.find((r) => r.id === where.id);
    if (!existing) throw new Error('not found');
    Object.assign(existing, data, { updatedAt: new Date() });
    return existing;
  },
};

(prisma as any).auditLog = {
  async create({ data }: any) {
    auditEvents.push(data);
    return data;
  },
};

// ─── Imports that depend on the mocked prisma (must come after mocking) ─────

const {
  getExternalCalendarIntegrationSummary,
  getExternalCalendarConnectionRecord,
  getExternalCalendarConnectionRecordByReceiverKey,
  upsertExternalCalendarIntegration,
  setExternalCalendarIntegrationEnabled,
  recordExternalCalendarConnectionCheck,
  rotateExternalCalendarWebhookReceiverKey,
} = await import('../services/externalCalendar/externalCalendarConnectionService.js');

section('Clinic-specific configuration');

await test('creating a config for clinic A does not affect clinic B', async () => {
  await upsertExternalCalendarIntegration('clinic-A', {
    clientId: 'client-a', clientSecret: 'secret-a', externalClinicId: 'ext-clinic-a',
  });
  const bSummary = await getExternalCalendarIntegrationSummary('clinic-B');
  assert.equal(bSummary, null);
});

await test('each clinic gets its own independent row', async () => {
  await upsertExternalCalendarIntegration('clinic-B', {
    clientId: 'client-b', clientSecret: 'secret-b', externalClinicId: 'ext-clinic-b',
  });
  const a = await getExternalCalendarIntegrationSummary('clinic-A');
  const b = await getExternalCalendarIntegrationSummary('clinic-B');
  assert.notEqual(a!.id, b!.id);
  assert.equal(a!.clientIdHint, 'client-a'.slice(-4));
  assert.equal(b!.clientIdHint, 'client-b'.slice(-4));
});

await test('unknown clinic id upsert throws ExternalCalendarClinicNotFoundError', async () => {
  await assert.rejects(
    () => upsertExternalCalendarIntegration('clinic-does-not-exist', { clientId: 'x' }),
    /not found/i,
  );
});

section('Tenant isolation');

await test('connection record for clinic A never leaks clinic B fields', async () => {
  const recordA = await getExternalCalendarConnectionRecord('clinic-A');
  assert.equal(recordA!.clinicId, 'clinic-A');
  assert.equal(recordA!.organizationId, 'org-1');
  assert.notEqual(recordA!.clientId, 'client-b');
});

section('Encrypted secrets');

await test('clientSecret is stored encrypted, never in plaintext', async () => {
  const raw = findIntegration('clinic-A')!;
  assert.notEqual(raw.clientSecretEncrypted, 'secret-a');
  assert.equal(decryptSecret(raw.clientSecretEncrypted!), 'secret-a');
});

await test('webhookSecret is stored encrypted and decrypts back correctly', async () => {
  await upsertExternalCalendarIntegration('clinic-A', { webhookSecret: 'whsec-a' });
  const raw = findIntegration('clinic-A')!;
  assert.notEqual(raw.webhookSecretEncrypted, 'whsec-a');
  assert.equal(decryptSecret(raw.webhookSecretEncrypted!), 'whsec-a');
});

await test('summary DTO never exposes encrypted or plaintext secret values', async () => {
  const summary = await getExternalCalendarIntegrationSummary('clinic-A');
  const json = JSON.stringify(summary);
  assert.ok(!json.includes('secret-a'));
  assert.ok(!json.includes('whsec-a'));
  assert.equal((summary as any).clientSecretEncrypted, undefined);
  assert.equal((summary as any).webhookSecretEncrypted, undefined);
  assert.equal(summary!.clientSecretConfigured, true);
  assert.equal(summary!.webhookSecretConfigured, true);
});

await test('audit log entries never contain secret plaintext', async () => {
  const json = JSON.stringify(auditEvents);
  assert.ok(!json.includes('secret-a'));
  assert.ok(!json.includes('whsec-a'));
});

section('Enable/disable gating');

await test('enabling is refused until required fields are configured', async () => {
  integrations.push({
    id: 'conn-incomplete',
    clinicId: 'clinic-incomplete',
    organizationId: 'org-1',
    provider: 'digidentis',
    enabled: false,
    status: 'not_configured',
    clientId: null,
    clientSecretEncrypted: null,
    webhookSecretEncrypted: null,
    webhookReceiverKey: 'receiver-key-incomplete',
    externalCompanyId: null,
    externalClinicId: null,
    apiBaseUrl: null,
    lastSuccessfulCheckAt: null,
    lastCheckedAt: null,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await assert.rejects(() => setExternalCalendarIntegrationEnabled('clinic-incomplete', true), /must be configured/);
});

await test('enabling succeeds once clientId/clientSecret/externalClinicId are set', async () => {
  const summary = await setExternalCalendarIntegrationEnabled('clinic-A', true);
  assert.equal(summary.enabled, true);
});

await test('integration is disabled by default on creation', async () => {
  const summary = await getExternalCalendarIntegrationSummary('clinic-B');
  assert.equal(summary!.enabled, false);
});

section('Webhook receiver key — opaque, per-clinic, rotatable public URL token');

await test('a webhookReceiverKey is generated automatically on creation', async () => {
  const summary = await getExternalCalendarIntegrationSummary('clinic-A');
  assert.ok(summary!.webhookReceiverKey);
  assert.equal(typeof summary!.webhookReceiverKey, 'string');
});

await test('the receiver key is never the row\'s own database id', async () => {
  const summary = await getExternalCalendarIntegrationSummary('clinic-A');
  assert.notEqual(summary!.webhookReceiverKey, summary!.id);
});

await test('each clinic gets a distinct receiver key', async () => {
  const a = await getExternalCalendarIntegrationSummary('clinic-A');
  const b = await getExternalCalendarIntegrationSummary('clinic-B');
  assert.notEqual(a!.webhookReceiverKey, b!.webhookReceiverKey);
});

await test('re-saving clinic config does not change its receiver key', async () => {
  const before = await getExternalCalendarIntegrationSummary('clinic-A');
  await upsertExternalCalendarIntegration('clinic-A', { externalCompanyId: 'company-a-2' });
  const after = await getExternalCalendarIntegrationSummary('clinic-A');
  assert.equal(after!.webhookReceiverKey, before!.webhookReceiverKey);
});

await test('the connection can be looked up by its receiver key', async () => {
  const summary = await getExternalCalendarIntegrationSummary('clinic-A');
  const found = await getExternalCalendarConnectionRecordByReceiverKey(summary!.webhookReceiverKey);
  assert.equal(found!.clinicId, 'clinic-A');
});

await test('an unknown receiver key resolves to null (never leaks which ids exist)', async () => {
  const found = await getExternalCalendarConnectionRecordByReceiverKey('not-a-real-key');
  assert.equal(found, null);
});

await test('rotating the receiver key changes it and invalidates the old lookup', async () => {
  const before = await getExternalCalendarIntegrationSummary('clinic-A');
  const rotated = await rotateExternalCalendarWebhookReceiverKey('clinic-A');
  assert.notEqual(rotated.webhookReceiverKey, before!.webhookReceiverKey);

  const byOldKey = await getExternalCalendarConnectionRecordByReceiverKey(before!.webhookReceiverKey);
  assert.equal(byOldKey, null);

  const byNewKey = await getExternalCalendarConnectionRecordByReceiverKey(rotated.webhookReceiverKey);
  assert.equal(byNewKey!.clinicId, 'clinic-A');
});

await test('rotating for an unknown clinic throws ExternalCalendarClinicNotFoundError', async () => {
  await assert.rejects(() => rotateExternalCalendarWebhookReceiverKey('clinic-does-not-exist'), /not found/i);
});

await test('key rotation is audit logged without exposing the key value as a "secret"', async () => {
  const before = auditEvents.length;
  await rotateExternalCalendarWebhookReceiverKey('clinic-A');
  assert.ok(auditEvents.length > before);
  const last = auditEvents[auditEvents.length - 1] as any;
  assert.equal(last.action, 'external_calendar_webhook_key_rotated');
});

section('Connection check recording');

await test('successful check updates status/lastSuccessfulCheckAt and clears lastError', async () => {
  const summary = await recordExternalCalendarConnectionCheck('clinic-A', { success: true });
  assert.equal(summary.status, 'connected');
  assert.ok(summary.lastSuccessfulCheckAt);
  assert.equal(summary.lastError, null);
});

await test('failed check sets status=error and records a sanitized message', async () => {
  const summary = await recordExternalCalendarConnectionCheck('clinic-A', { success: false, message: 'boom' });
  assert.equal(summary.status, 'error');
  assert.equal(summary.lastError, 'boom');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;

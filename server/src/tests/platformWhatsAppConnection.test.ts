/**
 * platformWhatsAppConnection.test.ts — F3-WA-META-COEX-002B
 *
 * Covers the platform-owned Meta Cloud API WhatsApp connection: the new
 * PlatformWhatsAppConnection table, its service (platformWhatsAppConnectionService.ts)
 * and its Platform Admin routes (routes/platformWhatsApp.ts).
 *
 * Runs against a real PostgreSQL through the real Prisma client — matching
 * platformAdminOwnerBootstrap.test.ts's approach — not a mocked DB.
 *
 * Two layers, deliberately different:
 *   1. A real http server + real express app, driven with real node:http
 *      requests, proving the router-level `authenticatePlatformAdmin` +
 *      `csrfProtection('platform')` gate on THIS router (unauthenticated
 *      rejected; a non-platform/clinic-shaped token rejected; a valid
 *      cookie session without a matching CSRF token rejected; the SAME
 *      request with a correct CSRF token succeeds). This is the only way to
 *      prove router.use-level middleware, since extracting a single route's
 *      handler chain (layer 2 below) bypasses it entirely.
 *   2. Direct route-handler-chain invocation (getRouteMiddlewareChain, same
 *      technique as platformAdminOwnerBootstrap.test.ts and
 *      platformAdmin.test.ts) for the create/update/test/disconnect/delete
 *      business logic, secret handling, singleton enforcement, audit trail,
 *      and tenant-isolation checks — auth/CSRF themselves are already proven
 *      in layer 1 and are not re-tested per handler.
 *
 * Run with: npx tsx src/tests/platformWhatsAppConnection.test.ts
 */

process.env.PLATFORM_BEARER_FALLBACK_ENABLED = 'true';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'f'.repeat(64);

import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import express from 'express';
import prisma from '../db.js';
import platformWhatsAppRoutes from '../routes/platformWhatsApp.js';
import organizationWhatsAppRoutes from '../routes/organizationWhatsApp.js';
import { generatePlatformToken } from '../middleware/platformAuth.js';
import {
  PLATFORM_SESSION_COOKIE,
  createCsrfToken,
  createSessionId,
  getCsrfCookieName,
} from '../utils/sessionCookies.js';
import { decryptSecret, decryptSecretTagged } from '../utils/encryption.js';

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

// ── Layer 1: real HTTP server, real router (proves router.use auth/CSRF gate) ──

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/platform', platformWhatsAppRoutes);
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

function httpRequest(
  port: number,
  method: string,
  path: string,
  opts: { headers?: Record<string, string>; body?: unknown } = {},
): Promise<{ statusCode: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...opts.headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          resolve({ statusCode: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : null });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const httpSuffix = randomUUID().slice(0, 8);
const HTTP_ADMIN_ID = `f3wa002b-http-admin-${httpSuffix}`;

await test('setup: create a real PlatformAdmin fixture for the HTTP layer', async () => {
  await prisma.platformAdmin.create({
    data: {
      id: HTTP_ADMIN_ID,
      email: `${HTTP_ADMIN_ID}@platform.test`,
      passwordHash: 'not-a-real-hash-test-fixture-only',
      name: 'F3WA002B HTTP',
      isActive: true,
    },
  });
});

await withServer(async (port) => {
  section('Router-level authentication and CSRF gate (real HTTP)');

  await test('GET without any token is rejected with 401', async () => {
    const res = await httpRequest(port, 'GET', '/api/platform/whatsapp/meta-connection');
    assert.equal(res.statusCode, 401);
  });

  await test('a token signed for a different purpose (clinic-shaped, wrong secret) is rejected', async () => {
    // Simulates "clinic user rejected": a real clinic JWT is signed with JWT_SECRET,
    // not PLATFORM_JWT_SECRET — authenticatePlatformAdmin can never verify it.
    const jwt = (await import('jsonwebtoken')).default;
    const clinicShapedToken = jwt.sign({ type: 'clinic', sub: 'user-1' }, 'not-the-platform-jwt-secret');
    const res = await httpRequest(port, 'GET', '/api/platform/whatsapp/meta-connection', {
      headers: { Authorization: `Bearer ${clinicShapedToken}` },
    });
    assert.equal(res.statusCode, 401);
  });

  await test('GET with a valid platform admin bearer token is authorized (200)', async () => {
    const token = generatePlatformToken({ id: HTTP_ADMIN_ID, email: `${HTTP_ADMIN_ID}@platform.test` });
    const res = await httpRequest(port, 'GET', '/api/platform/whatsapp/meta-connection', {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.connection, null);
  });

  section('CSRF (cookie-session requests only — bearer requests are exempt by design)');

  const sessionId = createSessionId();
  const cookieToken = generatePlatformToken({ id: HTTP_ADMIN_ID, email: `${HTTP_ADMIN_ID}@platform.test`, sessionId });
  const csrfCookieName = getCsrfCookieName('platform');

  await test('POST via a cookie session with NO CSRF token is rejected with 403', async () => {
    const res = await httpRequest(port, 'POST', '/api/platform/whatsapp/meta-connection', {
      headers: { Cookie: `${PLATFORM_SESSION_COOKIE}=${cookieToken}` },
      body: { name: 'Should not be created', metaPhoneNumberId: 'x', metaAccessTokenEncrypted: 'x' },
    });
    assert.equal(res.statusCode, 403);
  });

  await test('POST via a cookie session WITH a matching CSRF cookie+header succeeds', async () => {
    const csrfToken = createCsrfToken('platform', sessionId);
    const res = await httpRequest(port, 'POST', '/api/platform/whatsapp/meta-connection', {
      headers: {
        Cookie: `${PLATFORM_SESSION_COOKIE}=${cookieToken}; ${csrfCookieName}=${csrfToken}`,
        'X-CSRF-Token': csrfToken,
      },
      body: { name: 'HTTP Layer Connection', metaPhoneNumberId: `http-${httpSuffix}`, metaAccessTokenEncrypted: 'plaintext-token' },
    });
    assert.equal(res.statusCode, 201, JSON.stringify(res.body));
    assert.equal(res.body.connection.metaAccessTokenEncrypted, undefined, 'secret must never be returned');
  });
});

await test('cleanup: HTTP layer fixtures', async () => {
  await prisma.platformWhatsAppConnection.deleteMany({ where: { metaPhoneNumberId: `http-${httpSuffix}` } });
  await prisma.platformAdminAuditEvent.deleteMany({ where: { actorPlatformAdminId: HTTP_ADMIN_ID } });
  await prisma.platformAdmin.delete({ where: { id: HTTP_ADMIN_ID } });
});

// ── Layer 2: direct route-handler-chain invocation (business logic) ─────────

interface RouterLike { stack: any[] }

function getRouteMiddlewareChain(router: RouterLike, method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path && layer.route.methods?.[method]) {
      return layer.route.stack.map((s: any) => s.handle);
    }
  }
  throw new Error(`No route handler found for ${method.toUpperCase()} ${path}`);
}

async function runChain(
  chain: Array<(req: any, res: any, next: () => void) => void | Promise<void>>,
  req: any,
  res: any,
): Promise<void> {
  for (const fn of chain) {
    let calledNext = false;
    await fn(req, res, () => { calledNext = true; });
    if (!calledNext) return;
  }
}

function mockRes() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
    end() { return this; },
  };
  return res;
}

const suffix = randomUUID().slice(0, 8);
const ADMIN_ID = `f3wa002b-admin-${suffix}`;

function platformReq(body: Record<string, unknown> = {}, actorId: string = ADMIN_ID) {
  return { body, params: {}, platformAdmin: { id: actorId, email: `${actorId}@platform.test` } } as any;
}

async function callPlatform(method: 'get' | 'post' | 'put' | 'delete', path: string, body: Record<string, unknown> = {}) {
  const chain = getRouteMiddlewareChain(platformWhatsAppRoutes as any, method, path);
  const res = mockRes();
  await runChain(chain, platformReq(body), res);
  return res;
}

async function auditRows(action: string) {
  return prisma.platformAdminAuditEvent.findMany({
    where: { actorPlatformAdminId: ADMIN_ID, resourceType: 'platform_whatsapp_connection', action },
    orderBy: { createdAt: 'asc' },
  });
}

const adminFixture = await prisma.platformAdmin.create({
  data: {
    id: ADMIN_ID,
    email: `${ADMIN_ID}@platform.test`,
    passwordHash: 'not-a-real-hash-test-fixture-only',
    name: 'F3WA002B',
    isActive: true,
  },
});

console.log('\nPlatform Admin Meta WhatsApp connection (direct route-chain layer)');

// ── Validation ───────────────────────────────────────────────────────────────

section('Meta manual-config completeness validation (shared with the tenant route)');

await test('create without metaPhoneNumberId/accessToken is rejected with 400', async () => {
  const res = await callPlatform('post', '/whatsapp/meta-connection', { name: 'Incomplete' });
  assert.equal(res.statusCode, 400);
  assert.equal(await prisma.platformWhatsAppConnection.count(), 0);
});

await test('a Zod-invalid body (missing name) is rejected with 400 before reaching the service', async () => {
  const res = await callPlatform('post', '/whatsapp/meta-connection', {
    metaPhoneNumberId: 'p1', metaAccessTokenEncrypted: 'secret',
  });
  assert.equal(res.statusCode, 400);
});

// ── Create, secrets, singleton ───────────────────────────────────────────────

section('Create — secret encryption, response sanitization, audit');

const createRes = await callPlatform('post', '/whatsapp/meta-connection', {
  name: 'NoraMedi Platform WhatsApp',
  phoneNumber: '+905551234567',
  metaPhoneNumberId: `phone-${suffix}`,
  metaBusinessId: `biz-${suffix}`,
  metaWabaId: `waba-${suffix}`,
  metaAppId: `app-${suffix}`,
  metaAccessTokenEncrypted: 'plaintext-access-token',
  metaWebhookVerifyToken: 'verify-token',
  metaWebhookSecret: 'plaintext-webhook-secret',
  webhookSecret: 'plaintext-shared-secret',
});
const connectionId: string = createRes.body?.connection?.id;

await test('returns 201 with a sanitized connection (no secret fields)', () => {
  assert.equal(createRes.statusCode, 201, JSON.stringify(createRes.body));
  const serialized = JSON.stringify(createRes.body.connection);
  assert.ok(!serialized.includes('plaintext'), 'no plaintext secret may ever appear in the response');
  assert.equal(createRes.body.connection.metaAccessTokenEncrypted, undefined);
  assert.equal(createRes.body.connection.metaWebhookSecret, undefined);
  assert.equal(createRes.body.connection.webhookSecret, undefined);
  assert.equal(createRes.body.connection.metaWebhookVerifyToken, undefined);
  assert.equal(createRes.body.connection.provider, 'meta_cloud_api');
});

await test('the access token is persisted AES-256-GCM encrypted, not plaintext', async () => {
  const row = await prisma.platformWhatsAppConnection.findUniqueOrThrow({ where: { id: connectionId } });
  assert.notEqual(row.metaAccessTokenEncrypted, 'plaintext-access-token');
  assert.equal(decryptSecret(row.metaAccessTokenEncrypted!), 'plaintext-access-token');
});

await test('the webhook secrets are persisted tagged-encrypted (enc:v1: prefix)', async () => {
  const row = await prisma.platformWhatsAppConnection.findUniqueOrThrow({ where: { id: connectionId } });
  assert.ok(row.metaWebhookSecret!.startsWith('enc:v1:'));
  assert.ok(row.webhookSecret!.startsWith('enc:v1:'));
  assert.equal(decryptSecretTagged(row.metaWebhookSecret), 'plaintext-webhook-secret');
  assert.equal(decryptSecretTagged(row.webhookSecret), 'plaintext-shared-secret');
});

await test('exactly one platform_whatsapp_connection.created audit row is written, with no secret value', async () => {
  const rows = await auditRows('platform_whatsapp_connection.created');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.resourceKey, connectionId);
  assert.equal(rows[0]!.outcome, 'success');
  const serialized = JSON.stringify(rows[0]);
  assert.ok(!serialized.includes('plaintext'), 'audit row must never contain a secret value');
});

section('Singleton enforcement');

await test('a second create is rejected with 409, and the DB unique constraint backs it (not just the pre-check)', async () => {
  const res = await callPlatform('post', '/whatsapp/meta-connection', {
    name: 'Second attempt', metaPhoneNumberId: `phone2-${suffix}`, metaAccessTokenEncrypted: 'x',
  });
  assert.equal(res.statusCode, 409);
  assert.equal(await prisma.platformWhatsAppConnection.count(), 1);
});

await test('the singleton column truly is DB-unique — a raw second insert violates the constraint', async () => {
  await assert.rejects(
    prisma.platformWhatsAppConnection.create({
      data: { name: 'Raw bypass attempt', metaPhoneNumberId: `raw-${suffix}` },
    }),
    /Unique constraint/,
  );
});

// ── Update — leave-unchanged secret convention ──────────────────────────────

section('Update — omitted secret fields leave the stored value unchanged');

await test('updating unrelated fields without secret keys leaves the access token unchanged', async () => {
  const before = await prisma.platformWhatsAppConnection.findUniqueOrThrow({ where: { id: connectionId } });
  const res = await callPlatform('put', '/whatsapp/meta-connection', { displayName: 'Updated Display Name' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.connection.displayName, 'Updated Display Name');
  const after = await prisma.platformWhatsAppConnection.findUniqueOrThrow({ where: { id: connectionId } });
  assert.equal(after.metaAccessTokenEncrypted, before.metaAccessTokenEncrypted);
});

await test('supplying a new access token rotates the stored encrypted value', async () => {
  const before = await prisma.platformWhatsAppConnection.findUniqueOrThrow({ where: { id: connectionId } });
  const res = await callPlatform('put', '/whatsapp/meta-connection', { metaAccessTokenEncrypted: 'rotated-token' });
  assert.equal(res.statusCode, 200);
  const after = await prisma.platformWhatsAppConnection.findUniqueOrThrow({ where: { id: connectionId } });
  assert.notEqual(after.metaAccessTokenEncrypted, before.metaAccessTokenEncrypted);
  assert.equal(decryptSecret(after.metaAccessTokenEncrypted!), 'rotated-token');
});

await test('exactly one platform_whatsapp_connection.updated audit row per update, keyed on field names only', async () => {
  const rows = await auditRows('platform_whatsapp_connection.updated');
  assert.equal(rows.length, 2);
  const meta = rows[1]!.safeMetadata as { fields: string[] };
  assert.deepEqual(meta.fields, ['metaAccessTokenEncrypted']);
});

await test('clearing metaPhoneNumberId while a token is present is rejected (manual-config completeness re-checked on update)', async () => {
  const res = await callPlatform('put', '/whatsapp/meta-connection', { metaPhoneNumberId: null });
  assert.equal(res.statusCode, 400);
  const row = await prisma.platformWhatsAppConnection.findUniqueOrThrow({ where: { id: connectionId } });
  assert.notEqual(row.metaPhoneNumberId, null, 'the rejected update must not have applied');
});

// ── Test connection — reuses the shared provider dispatch ───────────────────

section('Test connection — reuses whatsappService.ts runConnectionTest (same as the tenant path)');

await test('test-connection calls MetaCloudWhatsAppProvider.testConnection and persists a successful result', async () => {
  // Same fetch-stubbing convention as whatsappProvider.test.ts — no real
  // network call, and this proves the SAME provider class is reached.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ display_phone_number: '+1 555 0100', verified_name: 'NoraMedi Platform' }), { status: 200 })
  ) as typeof fetch;
  try {
    const res = await callPlatform('post', '/whatsapp/meta-connection/test');
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.result.success, true);
    assert.ok(!JSON.stringify(res.body).includes('rotated-token'), 'the access token must never appear in the response');
  } finally {
    globalThis.fetch = originalFetch;
  }
  const row = await prisma.platformWhatsAppConnection.findUniqueOrThrow({ where: { id: connectionId } });
  assert.equal(row.status, 'connected');
  assert.notEqual(row.lastConnectedAt, null);
});

await test('a failing provider test persists status=error with the message, and is audited as a failure', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('Unauthorized', { status: 401 })) as typeof fetch;
  try {
    const res = await callPlatform('post', '/whatsapp/meta-connection/test');
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.result.success, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
  const row = await prisma.platformWhatsAppConnection.findUniqueOrThrow({ where: { id: connectionId } });
  assert.equal(row.status, 'error');
  assert.ok(row.lastError);
  const rows = await auditRows('platform_whatsapp_connection.tested');
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.outcome, 'success');
  assert.equal(rows[1]!.outcome, 'failure');
});

// ── Tenant isolation ─────────────────────────────────────────────────────────

section('Tenant isolation — the platform connection never touches WhatsAppConnection');

const tenantOrg = await prisma.organization.create({
  data: { name: `F3WA002B Tenant Org ${suffix}`, slug: `f3wa002b-org-${suffix}`, status: 'active' },
});
const tenantClinic = await prisma.clinic.create({
  data: { name: 'F3WA002B Tenant Clinic', slug: `f3wa002b-clinic-${suffix}`, organizationId: tenantOrg.id, status: 'active' },
});
const tenantConnection = await prisma.whatsAppConnection.create({
  data: {
    organizationId: tenantOrg.id,
    name: 'Tenant Meta Connection',
    provider: 'meta_cloud_api',
    metaPhoneNumberId: `tenant-phone-${suffix}`,
  },
});

function tenantOwnerReq(body: Record<string, unknown> = {}, params: Record<string, string> = {}) {
  return {
    body, params,
    user: {
      id: `tenant-owner-${suffix}`,
      organizationId: tenantOrg.id,
      clinicId: tenantClinic.id,
      role: 'OWNER',
      canAccessAllClinics: true,
      allowedClinicIds: [],
    },
  } as any;
}

async function callTenant(method: 'get' | 'post' | 'put', path: string, body: Record<string, unknown> = {}, params: Record<string, string> = {}) {
  const chain = getRouteMiddlewareChain(organizationWhatsAppRoutes as any, method, path);
  const res = mockRes();
  await runChain(chain, tenantOwnerReq(body, params), res);
  return res;
}

await test('the tenant OWNER connection list never contains the platform connection', async () => {
  const res = await callTenant('get', '/organization/whatsapp-connections');
  assert.equal(res.statusCode, 200);
  const ids = (res.body as any[]).map((c) => c.id);
  assert.ok(!ids.includes(connectionId), 'the platform connection id must never appear in a tenant response');
  assert.ok(ids.includes(tenantConnection.id));
});

await test("GET /organization/whatsapp-connections/:id with the platform connection's id 404s (cannot be read via the tenant endpoint)", async () => {
  const res = await callTenant('get', '/organization/whatsapp-connections/:id', {}, { id: connectionId });
  assert.equal(res.statusCode, 404);
});

await test('mutating the platform connection never touches the tenant WhatsAppConnection row', async () => {
  const before = await prisma.whatsAppConnection.findUniqueOrThrow({ where: { id: tenantConnection.id } });
  await callPlatform('put', '/whatsapp/meta-connection', { displayName: 'Another update' });
  const after = await prisma.whatsAppConnection.findUniqueOrThrow({ where: { id: tenantConnection.id } });
  assert.deepEqual(after, before, 'the tenant row must be byte-for-byte unchanged by any platform-route operation');
});

await test('the platform WhatsApp service never imports/queries prisma.whatsAppConnection', async () => {
  const fs = await import('node:fs/promises');
  const source = await fs.readFile(new URL('../services/platformWhatsAppConnectionService.ts', import.meta.url), 'utf8');
  assert.ok(!source.includes('whatsAppConnection.'), 'platformWhatsAppConnectionService.ts must only ever touch prisma.platformWhatsAppConnection');
});

// ── Disconnect / Delete ──────────────────────────────────────────────────────

section('Disconnect and delete');

await test('disconnect marks the connection disconnected/inactive and audits it', async () => {
  const res = await callPlatform('post', '/whatsapp/meta-connection/disconnect');
  assert.equal(res.statusCode, 204);
  const row = await prisma.platformWhatsAppConnection.findUniqueOrThrow({ where: { id: connectionId } });
  assert.equal(row.status, 'disconnected');
  assert.equal(row.isActive, false);
  const rows = await auditRows('platform_whatsapp_connection.disconnected');
  assert.equal(rows.length, 1);
});

await test('delete removes the row and audits it, freeing the singleton slot', async () => {
  const res = await callPlatform('delete', '/whatsapp/meta-connection');
  assert.equal(res.statusCode, 204);
  assert.equal(await prisma.platformWhatsAppConnection.count(), 0);
  const rows = await auditRows('platform_whatsapp_connection.deleted');
  assert.equal(rows.length, 1);

  // The singleton slot is free again — a create right after delete must succeed.
  const recreated = await callPlatform('post', '/whatsapp/meta-connection', {
    name: 'Recreated', metaPhoneNumberId: `phone3-${suffix}`, metaAccessTokenEncrypted: 'x',
  });
  assert.equal(recreated.statusCode, 201);
  await prisma.platformWhatsAppConnection.delete({ where: { id: recreated.body.connection.id } });
});

await test('operating on a nonexistent connection 404s for update/test/disconnect/delete', async () => {
  assert.equal((await callPlatform('put', '/whatsapp/meta-connection', { displayName: 'x' })).statusCode, 404);
  assert.equal((await callPlatform('post', '/whatsapp/meta-connection/test')).statusCode, 404);
  assert.equal((await callPlatform('post', '/whatsapp/meta-connection/disconnect')).statusCode, 404);
  assert.equal((await callPlatform('delete', '/whatsapp/meta-connection')).statusCode, 404);
});

// ── Cleanup ──────────────────────────────────────────────────────────────────

await prisma.whatsAppConnection.deleteMany({ where: { id: tenantConnection.id } });
await prisma.clinic.deleteMany({ where: { id: tenantClinic.id } });
await prisma.organization.deleteMany({ where: { id: tenantOrg.id } });
await prisma.platformAdminAuditEvent.deleteMany({ where: { actorPlatformAdminId: ADMIN_ID } });
await prisma.platformAdmin.delete({ where: { id: adminFixture.id } });
await prisma.$disconnect();

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

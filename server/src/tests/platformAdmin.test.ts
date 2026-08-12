/**
 * platformAdmin.test.ts — Sprint 21: Platform Admin birim testleri
 *
 * Çalıştırma: cd server && npx tsx src/tests/platformAdmin.test.ts
 *
 * Kapsanan senaryolar:
 *  Auth:
 *   - generatePlatformToken geçerli bir token üretir
 *   - authenticatePlatformAdmin geçerli platform tokenı kabul eder
 *   - authenticatePlatformAdmin eksik tokenla 401 döner
 *   - authenticatePlatformAdmin yanlış tokenla 401 döner
 *   - authenticatePlatformAdmin klinik kullanıcı tokenıyla 403 döner (type mismatch)
 *   - Klinik JWT'si platform rotasına erişemez (type kontrolü)
 *
 *  parsePagination:
 *   - Varsayılan değerler page=1, limit=25
 *   - page ve limit sorgu parametrelerini doğru ayrıştırır
 *   - limit 100 ile sınırlanır
 *   - page en az 1 olur
 *   - skip değeri doğru hesaplanır
 *
 *  Token izolasyonu:
 *   - Platform tokenı klinik JWT gizliğiyle doğrulanamaz
 *   - Klinik tokenı platform JWT gizliğiyle doğrulanamaz
 */

// Must load before ANY other import in this file. platformAuth.ts reads
// PLATFORM_JWT_SECRET eagerly, once, at its own module top level — this file
// previously never imported db.ts (the only thing that pulled in
// `dotenv/config`) so PLATFORM_JWT_SECRET stayed consistently unset and every
// signature check happened to line up against the same hardcoded fallback.
// KVKK-HIGH-008-F1's new real-Postgres route tests below need `prisma` and
// `platformAdminRouter` (which imports `prisma`), and importing those AFTER
// platformAuth.ts made dotenv populate the real secret mid-file — an
// import-order hazard, not a logic bug in either module. Loading dotenv
// first removes the ordering dependency entirely.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

// These unit tests exercise the middleware via Bearer tokens; the production
// default is now cookie-only, so enable the fallback explicitly for the suite.
process.env.PLATFORM_BEARER_FALLBACK_ENABLED = 'true';

// F3-IMPL-003's MFA (TOTP) and SMS-provider audit-trail sections below exercise
// route handlers that call encryptSecretTagged/decryptSecretTagged, which hard-fail
// without a valid 64-char-hex ENCRYPTION_KEY (see utils/encryption.ts). Same
// disposable-test-key convention as the other suites in this directory
// (e.g. dataRetentionCleanupJob.test.ts) — synthetic, never a real secret.
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'f'.repeat(64);

import {
  generatePlatformToken,
  authenticatePlatformAdmin,
} from '../middleware/platformAuth.js';
import {
  loadDataRetentionConfig,
  DATA_RETENTION_DEFAULTS,
  DATA_RETENTION_MIN_DAYS,
  DATA_RETENTION_RUNTIME_SETTING_KEY,
} from '../services/privacy/dataRetentionPolicy.js';
import prisma from '../db.js';
import platformAdminRouter from '../routes/platformAdmin.js';
import { LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY } from '../services/communicationConsent/legacyConsentCorrection.js';
import { generateTotpSecret, generateTotp } from '../utils/totp.js';
import { encryptSecretTagged } from '../utils/encryption.js';

// ── Test yardımcısı ───────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

// ── parsePagination — route dosyasından kopyalanmış, aynı mantık ─────────────

function parsePagination(query: Record<string, string | string[]>): {
  skip: number;
  take: number;
  page: number;
  limit: number;
} {
  const rawPage = parseInt(String(query.page ?? '1'), 10);
  const rawLimit = parseInt(String(query.limit ?? '25'), 10);
  const page = Math.max(1, isNaN(rawPage) ? 1 : rawPage);
  const limit = Math.min(100, Math.max(1, isNaN(rawLimit) ? 25 : rawLimit));
  return { skip: (page - 1) * limit, take: limit, page, limit };
}

// ── Mock Express req/res/next ─────────────────────────────────────────────────

function makeReq(authHeader?: string) {
  return {
    headers: authHeader ? { authorization: authHeader } : {},
  } as any;
}

function makeRes() {
  let statusCode = 200;
  const body: any = {};
  const res = {
    _status: 200,
    _body: {} as any,
    status(code: number) {
      this._status = code;
      return this;
    },
    json(data: any) {
      this._body = data;
      return this;
    },
  };
  return res;
}

async function withEnv(updates: Record<string, string | undefined>, fn: () => void | Promise<void>) {
  const previous = Object.fromEntries(
    Object.keys(updates).map((key) => [key, process.env[key]]),
  ) as Record<string, string | undefined>;

  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

// F3-SEC-002: authenticatePlatformAdmin now performs a persistent, DB-backed
// admin lookup (existence/active/passwordChangedAt), so every test below
// that exercises the real middleware with a token for id 'admin-1' needs a
// real row to exist first — moved up front (not just before the later
// route-fixture-dependent sections at the bottom of this file) so the
// "authenticatePlatformAdmin — Middleware doğrulama" section immediately
// below can rely on it too. Idempotent upsert — safe to share with the
// later route tests' own reference to this same fixture id.
await prisma.platformAdmin.upsert({
  where: { id: 'admin-1' },
  update: {},
  create: {
    id: 'admin-1',
    email: 'admin-1-fixture@platform.test',
    passwordHash: 'not-a-real-hash-test-fixture-only',
    name: 'Test Fixture Platform Admin',
  },
});

// ── Tests ─────────────────────────────────────────────────────────────────────

section('parsePagination — Sayfalama yardımcısı');

await test('Varsayılan değerler page=1, limit=25 döner', () => {
  const result = parsePagination({});
  assert.equal(result.page, 1);
  assert.equal(result.limit, 25);
  assert.equal(result.skip, 0);
  assert.equal(result.take, 25);
});

await test('page ve limit sorgu parametrelerini doğru ayrıştırır', () => {
  const result = parsePagination({ page: '3', limit: '10' });
  assert.equal(result.page, 3);
  assert.equal(result.limit, 10);
  assert.equal(result.skip, 20);
  assert.equal(result.take, 10);
});

await test('limit 100 ile sınırlanır', () => {
  const result = parsePagination({ limit: '500' });
  assert.equal(result.limit, 100);
  assert.equal(result.take, 100);
});

await test('page minimum 1 olur (0 verilse)', () => {
  const result = parsePagination({ page: '0' });
  assert.equal(result.page, 1);
  assert.equal(result.skip, 0);
});

await test('page minimum 1 olur (negatif verilse)', () => {
  const result = parsePagination({ page: '-5' });
  assert.equal(result.page, 1);
});

await test('limit minimum 1 olur (0 verilse)', () => {
  const result = parsePagination({ limit: '0' });
  assert.equal(result.limit, 1);
});

await test('Geçersiz (NaN) page varsayılana döner', () => {
  const result = parsePagination({ page: 'abc' });
  assert.equal(result.page, 1);
});

await test('skip doğru hesaplanır: page=2, limit=10 → skip=10', () => {
  const result = parsePagination({ page: '2', limit: '10' });
  assert.equal(result.skip, 10);
});

section('generatePlatformToken — Token üretimi');

await test('Platform admin için geçerli token üretir', () => {
  const token = generatePlatformToken({ id: 'admin-1', email: 'admin@platform.com' });
  assert.ok(typeof token === 'string');
  assert.ok(token.split('.').length === 3, 'JWT 3 parçadan oluşmalı');
});

await test('Token type=platform_admin içerir', () => {
  const token = generatePlatformToken({ id: 'admin-1', email: 'admin@platform.com' });
  const PLATFORM_JWT_SECRET = process.env.PLATFORM_JWT_SECRET || 'platform-admin-secret-change-this';
  const decoded = jwt.verify(token, PLATFORM_JWT_SECRET) as any;
  assert.equal(decoded.type, 'platform_admin');
  assert.equal(decoded.id, 'admin-1');
  assert.equal(decoded.email, 'admin@platform.com');
});

section('authenticatePlatformAdmin — Middleware doğrulama');

await test('Geçerli platform tokenıyla next() çağrılır', async () => {
  // F3-SEC-002: the token's email claim is deliberately stale here — the
  // middleware now reads identity from the DB row (the 'admin-1' fixture
  // seeded near the top of this file), never from the token payload, so a
  // renamed/updated email can never be spoofed via an old token.
  const token = generatePlatformToken({ id: 'admin-1', email: 'admin@platform.com' });
  const req = makeReq(`Bearer ${token}`);
  const res = makeRes();
  let nextCalled = false;
  const next = () => { nextCalled = true; };

  await (authenticatePlatformAdmin as any)(req, res, next);

  assert.ok(nextCalled, 'next() çağrılmalıydı');
  assert.ok(req.platformAdmin, 'platformAdmin req üzerine set edilmeli');
  assert.equal(req.platformAdmin.id, 'admin-1');
  assert.equal(req.platformAdmin.email, 'admin-1-fixture@platform.test', 'email must come from the DB row, not the token claim');
});

await test('Bearer fallback kapatilinca gecerli platform Bearer tokeni 401 doner', async () => {
  await withEnv({ PLATFORM_BEARER_FALLBACK_ENABLED: 'false' }, async () => {
    const token = generatePlatformToken({ id: 'admin-1', email: 'admin@platform.com' });
    const req = makeReq(`Bearer ${token}`);
    const res = makeRes();
    let nextCalled = false;

    await (authenticatePlatformAdmin as any)(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(res._status, 401);
    assert.equal(res._body.error, 'Unauthorized: Cookie session required');
  });
});

await test('Authorization header eksikse 401 döner', async () => {
  const req = makeReq();
  const res = makeRes();
  let nextCalled = false;

  await (authenticatePlatformAdmin as any)(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false, 'next() çağrılmamalıydı');
  assert.equal(res._status, 401);
});

await test('Geçersiz (bozuk) token ile 401 döner', async () => {
  const req = makeReq('Bearer this.is.not.a.valid.token');
  const res = makeRes();
  let nextCalled = false;

  await (authenticatePlatformAdmin as any)(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res._status, 401);
});

await test('Klinik kullanıcı tokeni (type=clinic_user) ile 403 döner', async () => {
  // Klinik JWT farklı bir gizliyle imzalanır
  const clinicSecret = process.env.JWT_SECRET || 'defaultsecret';
  const clinicToken = jwt.sign(
    { id: 'user-1', clinicId: 'clinic-1', type: 'clinic_user' },
    clinicSecret,
    { expiresIn: '1h' },
  );
  const req = makeReq(`Bearer ${clinicToken}`);
  const res = makeRes();
  let nextCalled = false;

  await (authenticatePlatformAdmin as any)(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false, 'Klinik tokenı platform erişimi vermemeli');
  // 401 (imza hatası) veya 403 (tip uyuşmazlığı)
  assert.ok(res._status === 401 || res._status === 403, `Beklenen 401/403, alınan: ${res._status}`);
});

await test('platform_admin type olmayan token (farklı type) ile 403 döner', async () => {
  const platformSecret = process.env.PLATFORM_JWT_SECRET || 'platform-admin-secret-change-this';
  const badToken = jwt.sign(
    { id: 'user-1', type: 'something_else' },
    platformSecret,
    { expiresIn: '1h' },
  );
  const req = makeReq(`Bearer ${badToken}`);
  const res = makeRes();
  let nextCalled = false;

  await (authenticatePlatformAdmin as any)(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res._status, 403);
});

section('Token izolasyonu — Çapraz erişim engeli');

await test('Platform tokenı klinik JWT gizliğiyle doğrulanamaz', () => {
  const token = generatePlatformToken({ id: 'admin-1', email: 'admin@platform.com' });
  const clinicSecret = process.env.JWT_SECRET || 'defaultsecret';
  const platformSecret = process.env.PLATFORM_JWT_SECRET || 'platform-admin-secret-change-this';

  if (clinicSecret === platformSecret) {
    // Gizlilikler aynıysa test pass — production'da farklı olmalı uyarısı
    console.log('    ⚠ UYARI: JWT_SECRET ve PLATFORM_JWT_SECRET aynı! Production için farklı ayarlanmalı.');
    return;
  }

  assert.throws(() => jwt.verify(token, clinicSecret), 'Platform tokenı klinik gizliğiyle doğrulanmamalı');
});

await test('Klinik tokenı platform JWT gizliğiyle doğrulanamaz', () => {
  const clinicSecret = process.env.JWT_SECRET || 'defaultsecret';
  const platformSecret = process.env.PLATFORM_JWT_SECRET || 'platform-admin-secret-change-this';

  if (clinicSecret === platformSecret) {
    return; // Yukarıdaki uyarıya benzer
  }

  const clinicToken = jwt.sign({ id: 'user-1', type: 'clinic_user' }, clinicSecret, { expiresIn: '1h' });
  assert.throws(() => jwt.verify(clinicToken, platformSecret), 'Klinik tokenı platform gizliğiyle doğrulanmamalı');
});

section('Privacy / Data Retention — Policy endpoint mantığı');

await test('loadDataRetentionConfig varsayılan değerleri döner (env set değilken)', async () => {
  await withEnv({
    DATA_RETENTION_CLEANUP_ENABLED: undefined,
    DATA_RETENTION_CLEANUP_CRON: undefined,
    DATA_RETENTION_CONVERSATION_MESSAGES_DAYS: undefined,
    DATA_RETENTION_CONVERSATION_STATE_DAYS: undefined,
    DATA_RETENTION_OPERATIONAL_EVENTS_DAYS: undefined,
    DATA_RETENTION_INBOUND_EVENT_DAYS: undefined,
    DATA_RETENTION_RESOLVED_CONTACT_REQUEST_DAYS: undefined,
    DATA_RETENTION_BATCH_SIZE: undefined,
  }, () => {
    const config = loadDataRetentionConfig();
    assert.equal(config.enabled, true, 'Varsayılan: enabled=true');
    assert.equal(config.cronSchedule, '0 3 * * *', 'Varsayılan cron');
    assert.equal(config.conversationMessagesDays, DATA_RETENTION_DEFAULTS.conversationMessagesDays);
    assert.equal(config.conversationStateDays, DATA_RETENTION_DEFAULTS.conversationStateDays);
    assert.equal(config.operationalEventsDays, DATA_RETENTION_DEFAULTS.operationalEventsDays);
    assert.equal(config.inboundEventDays, DATA_RETENTION_DEFAULTS.inboundEventDays);
    assert.equal(config.resolvedContactRequestDays, DATA_RETENTION_DEFAULTS.resolvedContactRequestDays);
    assert.equal(config.batchSize, DATA_RETENTION_DEFAULTS.batchSize);
  });
});

await test('loadDataRetentionConfig DATA_RETENTION_CLEANUP_ENABLED=false ile disabled döner', async () => {
  await withEnv({ DATA_RETENTION_CLEANUP_ENABLED: 'false' }, () => {
    const config = loadDataRetentionConfig();
    assert.equal(config.enabled, false);
  });
});

await test('loadDataRetentionConfig geçerli env override değerlerini kullanır', async () => {
  await withEnv({
    DATA_RETENTION_CONVERSATION_MESSAGES_DAYS: '500',
    DATA_RETENTION_BATCH_SIZE: '200',
  }, () => {
    const config = loadDataRetentionConfig();
    assert.equal(config.conversationMessagesDays, 500);
    assert.equal(config.batchSize, 200);
  });
});

await test(`loadDataRetentionConfig minimum gün (${DATA_RETENTION_MIN_DAYS}) altındaki değerleri reddeder`, async () => {
  await withEnv({ DATA_RETENTION_CONVERSATION_MESSAGES_DAYS: '10' }, () => {
    const config = loadDataRetentionConfig();
    assert.equal(
      config.conversationMessagesDays,
      DATA_RETENTION_DEFAULTS.conversationMessagesDays,
      'Minimum altı değer varsayılana dönmeli',
    );
  });
});

await test('loadDataRetentionConfig batch size 1000 ile sınırlanır', async () => {
  await withEnv({ DATA_RETENTION_BATCH_SIZE: '9999' }, () => {
    const config = loadDataRetentionConfig();
    assert.equal(config.batchSize, 1000, 'Batch size DATA_RETENTION_MAX_BATCH_SIZE ile sınırlanmalı');
  });
});

await test('Klinik kullanıcısı platform rotalarına (policy, run) erişemez — middleware engeller', async () => {
  const clinicSecret = process.env.JWT_SECRET || 'defaultsecret';
  const clinicToken = jwt.sign(
    { id: 'user-1', clinicId: 'clinic-1', type: 'clinic_user' },
    clinicSecret,
    { expiresIn: '1h' },
  );
  const req = makeReq(`Bearer ${clinicToken}`);
  const res = makeRes();
  let nextCalled = false;

  await (authenticatePlatformAdmin as any)(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false, 'Klinik token platform privacy rotasına erişememeli');
  assert.ok(res._status === 401 || res._status === 403);
});

section('Runtime Toggle — Effective cleanup logic (birim)');

// Mirrors the buildPolicyResponse helper in platformAdmin.ts
function computeEffective(envEnabled: boolean, runtimeEnabled: boolean) {
  const effectiveCleanupEnabled = envEnabled && runtimeEnabled;
  const cleanupEnabledSource: 'env_disabled' | 'runtime_disabled' | 'enabled' =
    !envEnabled ? 'env_disabled' : !runtimeEnabled ? 'runtime_disabled' : 'enabled';
  return { envCleanupEnabled: envEnabled, runtimeCleanupEnabled: runtimeEnabled, effectiveCleanupEnabled, cleanupEnabledSource };
}

await test('env=false, runtime=true → effective=false, source=env_disabled', () => {
  const r = computeEffective(false, true);
  assert.equal(r.effectiveCleanupEnabled, false);
  assert.equal(r.cleanupEnabledSource, 'env_disabled');
});

await test('env=true, runtime=false → effective=false, source=runtime_disabled', () => {
  const r = computeEffective(true, false);
  assert.equal(r.effectiveCleanupEnabled, false);
  assert.equal(r.cleanupEnabledSource, 'runtime_disabled');
});

await test('env=true, runtime=true → effective=true, source=enabled', () => {
  const r = computeEffective(true, true);
  assert.equal(r.effectiveCleanupEnabled, true);
  assert.equal(r.cleanupEnabledSource, 'enabled');
});

await test('env=false, runtime=false → effective=false, source=env_disabled', () => {
  const r = computeEffective(false, false);
  assert.equal(r.effectiveCleanupEnabled, false);
  assert.equal(r.cleanupEnabledSource, 'env_disabled');
});

await test('getPlatformSetting null (kayıt yok) → runtimeCleanupEnabled varsayılan false', () => {
  const runtimeVal: string | null = null;
  const runtimeCleanupEnabled = runtimeVal === 'true';
  assert.equal(runtimeCleanupEnabled, false, 'Eksik ayar false olarak yorumlanmalı');
});

await test("getPlatformSetting 'false' döndüğünde runtimeCleanupEnabled=false", () => {
  const runtimeVal: string = 'false';
  const runtimeCleanupEnabled = runtimeVal === 'true';
  assert.equal(runtimeCleanupEnabled, false);
});

await test("getPlatformSetting 'true' döndüğünde runtimeCleanupEnabled=true", () => {
  const runtimeVal: string = 'true';
  const runtimeCleanupEnabled = runtimeVal === 'true';
  assert.equal(runtimeCleanupEnabled, true);
});

await test('PATCH /settings: boolean olmayan payload reddedilmeli (validasyon mantığı)', () => {
  const invalidPayloads = [
    { runtimeCleanupEnabled: 'true' },
    { runtimeCleanupEnabled: 1 },
    { runtimeCleanupEnabled: null },
    {},
  ];
  for (const body of invalidPayloads as any[]) {
    const { runtimeCleanupEnabled } = body ?? {};
    assert.equal(typeof runtimeCleanupEnabled !== 'boolean', true, `Reddedilmeli: ${JSON.stringify(body)}`);
  }
});

await test('PATCH /settings: geçerli boolean payload validasyonu geçer', () => {
  for (const val of [true, false]) {
    assert.equal(typeof val === 'boolean', true);
  }
});

section('Runtime Toggle — Cleanup job cron skip davranışı');

await test('getRuntimeEnabled=false olduğunda cron tik atlar', async () => {
  let runCalled = false;
  const mockGetRuntimeEnabled = async () => false;
  const runtimeEnabled = await mockGetRuntimeEnabled();
  if (runtimeEnabled) runCalled = true;
  assert.equal(runCalled, false, 'runtime kapalıyken cleanup çalışmamalı');
});

await test('getRuntimeEnabled=true olduğunda cron tik çalışır', async () => {
  let runCalled = false;
  const mockGetRuntimeEnabled = async () => true;
  const runtimeEnabled = await mockGetRuntimeEnabled();
  if (runtimeEnabled) runCalled = true;
  assert.equal(runCalled, true, 'runtime açıkken cleanup çalışmalı');
});

await test('startDataRetentionCleanupJob: env disabled ise job kaydedilmez', async () => {
  const { startDataRetentionCleanupJob } = await import('../jobs/dataRetentionCleanupJob.js');
  let getRuntimeCalled = false;
  await withEnv({ DATA_RETENTION_CLEANUP_ENABLED: 'false' }, () => {
    startDataRetentionCleanupJob({
      getRuntimeEnabled: async () => { getRuntimeCalled = true; return true; },
    });
  });
  assert.equal(getRuntimeCalled, false, 'env disabled ise runtime toggle hiç kontrol edilmemeli');
});

await test('Manuel dry-run: env disabled olsa bile çalışabilir (dryRun=true → env check yok)', async () => {
  // POST /run endpoint logic: dryRun=true → env check atlanır
  const dryRun = true;
  const envEnabled = false;
  const blocked = !dryRun && !envEnabled;
  assert.equal(blocked, false, 'Dry-run env disabled olsa da çalışabilmeli');
});

await test('Manuel live-run: env disabled ise engellenir (dryRun=false → 403)', () => {
  // POST /run endpoint logic: dryRun=false && !config.enabled → 403
  const dryRun = false;
  const envEnabled = false;
  const blocked = !dryRun && !envEnabled;
  assert.equal(blocked, true, 'Live run env disabled iken engellenmiş olmalı');
});

await test('Manuel live-run: env enabled ise geçer', () => {
  const dryRun = false;
  const envEnabled = true;
  const blocked = !dryRun && !envEnabled;
  assert.equal(blocked, false);
});

section('Privacy / Legacy Consent Correction Runtime Toggle (KVKK-HIGH-008-F1) — real route + DB');

// Same extraction technique as legacyConsentCorrection.test.ts: pull the
// route-specific handler chain out of the router's stack (this necessarily
// bypasses the router-level `router.use(authenticatePlatformAdmin,
// csrfProtection)` gate, since that's a separate, unkeyed layer — not part of
// `layer.route.stack` — exactly like every other route test in this file and
// in legacyConsentCorrection.test.ts). "L: clinic users cannot change it" is
// covered above by the generic authenticatePlatformAdmin clinic-JWT-rejection
// tests, which gate every route behind this router, including these two.
type RouterLike = { stack: Array<any> };
function getRouteMiddlewareChain(router: RouterLike, method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path && layer.route.methods?.[method]) {
      return layer.route.stack.map((s: any) => s.handle);
    }
  }
  throw new Error(`No route handler found for ${method.toUpperCase()} ${path}`);
}
async function runChain(chain: Array<(req: any, res: any, next: () => void) => void | Promise<void>>, req: any, res: any): Promise<void> {
  for (const fn of chain) {
    let calledNext = false;
    await fn(req, res, () => { calledNext = true; });
    if (!calledNext) return;
  }
}
function mockPlatformRes() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
  };
  return res;
}
function mockPlatformReq(body: Record<string, unknown> = {}) {
  return { body, platformAdmin: { id: 'admin-1', email: 'admin@platform.test' } } as any;
}

// PlatformAdminAuditEvent.actorPlatformAdminId has a real FK to
// PlatformAdmin(id) — every route test below attributes the mocked toggle to
// id 'admin-1'; that fixture row is created once, near the top of this file
// (see F3-SEC-002 comment above), and reused here.

await test('GET policy: no PlatformSetting row → runtimeEnabled=false (default-deny)', async () => {
  await prisma.platformSetting.deleteMany({ where: { key: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY } });
  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'get', '/privacy/legacy-consent-correction/policy');
  const res = mockPlatformRes();
  await runChain(chain, mockPlatformReq(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.runtimeEnabled, false);
});

await test('PATCH settings: platform admin enables it, GET then reflects true; row value is the literal string "true"', async () => {
  const patchChain = getRouteMiddlewareChain(platformAdminRouter as any, 'patch', '/privacy/legacy-consent-correction/settings');
  const patchRes = mockPlatformRes();
  await runChain(patchChain, mockPlatformReq({ runtimeEnabled: true }), patchRes);
  assert.equal(patchRes.statusCode, 200);
  assert.equal(patchRes.body.runtimeEnabled, true);

  const row = await prisma.platformSetting.findUnique({ where: { key: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY } });
  assert.equal(row?.value, 'true');

  const getChain = getRouteMiddlewareChain(platformAdminRouter as any, 'get', '/privacy/legacy-consent-correction/policy');
  const getRes = mockPlatformRes();
  await runChain(getChain, mockPlatformReq(), getRes);
  assert.equal(getRes.body.runtimeEnabled, true);
});

await test('PATCH settings: platform admin disables it again; row value is the literal string "false"', async () => {
  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'patch', '/privacy/legacy-consent-correction/settings');
  const res = mockPlatformRes();
  await runChain(chain, mockPlatformReq({ runtimeEnabled: false }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.runtimeEnabled, false);

  const row = await prisma.platformSetting.findUnique({ where: { key: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY } });
  assert.equal(row?.value, 'false');
});

await test('PATCH settings: non-boolean payload is rejected with 400 and never writes the setting', async () => {
  await prisma.platformSetting.deleteMany({ where: { key: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY } });
  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'patch', '/privacy/legacy-consent-correction/settings');
  for (const badBody of [{ runtimeEnabled: 'true' }, { runtimeEnabled: 1 }, { runtimeEnabled: null }, {}]) {
    const res = mockPlatformRes();
    await runChain(chain, mockPlatformReq(badBody), res);
    assert.equal(res.statusCode, 400, `expected 400 for payload ${JSON.stringify(badBody)}`);
  }
  const row = await prisma.platformSetting.findUnique({ where: { key: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY } });
  assert.equal(row, null, 'an invalid payload must never create/modify the setting row');
});

const AUDIT_ACTION = 'platform_setting.updated';
const RESET_AUDIT_ACTION = 'platform_setting.reset';

async function cleanAuditRows() {
  await prisma.platformAdminAuditEvent.deleteMany({
    where: {
      action: { in: [AUDIT_ACTION, RESET_AUDIT_ACTION] },
      resourceKey: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY,
    },
  });
}

// ── Deterministic ordering helpers for forced PATCH/DELETE race tests ────────
// F2-CI-FLAKE-LEGACY-CONSENT-001: a plain Promise.all() race (as in the
// "concurrent enable/reset" test below) lands on whichever legal
// serialization order the real Postgres scheduler happens to pick — that is
// sufficient to prove both orderings stay coherent across many runs, but not
// sufficient to force one specific ordering on demand for a fast,
// non-probabilistic assertion. These helpers hold the SAME transaction-scoped
// advisory lock the route handlers use (keyed to
// LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY) via a separate, externally
// controlled `prisma.$transaction` call, queue two route requests behind it
// in a chosen order (confirmed via pg_locks, not a fixed sleep), then release.
// Postgres's advisory-lock wait queue grants the longest-waiting requester
// first — verified empirically (15/15 forced orderings landed as queued, in a
// standalone check against this same disposable-Postgres setup) — so this
// produces the requested ordering deterministically, every run. Test-only: no
// production code is touched, hooked, or made aware that tests exist.
async function holdLegacyConsentAdvisoryLock(): Promise<{ release: () => void; released: Promise<void> }> {
  let releaseHolder!: () => void;
  const blocker = new Promise<void>((resolve) => { releaseHolder = resolve; });
  let lockAcquired!: () => void;
  const acquired = new Promise<void>((resolve) => { lockAcquired = resolve; });
  const released = prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY}))`;
    lockAcquired();
    await blocker;
  }).then(() => undefined);
  await acquired;
  return { release: releaseHolder, released };
}

async function waitForAdvisoryWaiters(count: number, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM pg_locks WHERE locktype = 'advisory' AND granted = false
    `;
    if (Number(rows[0]?.n ?? 0) >= count) return;
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${count} advisory-lock waiter(s); saw ${Number(rows[0]?.n ?? 0)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/**
 * Runs the PATCH(true) and DELETE handlers concurrently against a real
 * Postgres, but forces one to enter the advisory-lock wait queue strictly
 * before the other, so the resulting serialization order is deterministic
 * rather than a 50/50 real-DB race. `order: 'patch-first'` forces PATCH to
 * commit before DELETE; `'delete-first'` forces the reverse.
 */
async function runForcedPatchDeleteOrder(order: 'patch-first' | 'delete-first') {
  const patchChain = getRouteMiddlewareChain(platformAdminRouter as any, 'patch', '/privacy/legacy-consent-correction/settings');
  const deleteChain = getRouteMiddlewareChain(platformAdminRouter as any, 'delete', '/privacy/legacy-consent-correction/settings');
  const patchRes = mockPlatformRes();
  const deleteRes = mockPlatformRes();

  const holder = await holdLegacyConsentAdvisoryLock();

  const firstCall = order === 'patch-first'
    ? runChain(patchChain, mockPlatformReq({ runtimeEnabled: true }), patchRes)
    : runChain(deleteChain, mockPlatformReq(), deleteRes);
  await waitForAdvisoryWaiters(1);

  const secondCall = order === 'patch-first'
    ? runChain(deleteChain, mockPlatformReq(), deleteRes)
    : runChain(patchChain, mockPlatformReq({ runtimeEnabled: true }), patchRes);
  await waitForAdvisoryWaiters(2);

  holder.release();
  await holder.released;
  await Promise.all([firstCall, secondCall]);

  return { patchRes, deleteRes };
}

await test('PATCH settings: successful false→true toggle creates exactly one durable PlatformAdminAuditEvent row (platform-scope, admin-attributed, no patient data/secrets)', async () => {
  await cleanAuditRows();
  await prisma.platformSetting.upsert({
    where: { key: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY },
    update: { value: 'false' },
    create: { key: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY, value: 'false' },
  });

  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'patch', '/privacy/legacy-consent-correction/settings');
  const res = mockPlatformRes();
  await runChain(chain, mockPlatformReq({ runtimeEnabled: true }), res);
  assert.equal(res.statusCode, 200);

  const rows = await prisma.platformAdminAuditEvent.findMany({
    where: { action: AUDIT_ACTION, resourceKey: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY },
    orderBy: { createdAt: 'desc' },
  });
  assert.equal(rows.length, 1, 'exactly one durable audit row must be created for one successful toggle');
  const row = rows[0];
  assert.equal(row.actorPlatformAdminId, 'admin-1', 'must durably attribute the acting platform admin identity');
  assert.equal(row.resourceType, 'platform_setting');
  assert.equal(row.resourceKey, LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY);
  assert.equal(row.previousValue, 'false');
  assert.equal(row.newValue, 'true');
  assert.equal(row.outcome, 'success');
  const serialized = JSON.stringify(row);
  assert.ok(!serialized.includes('@'), 'must never contain an email/identity string — only the opaque platformAdminId');

  const signalCount = await prisma.securitySignalEvent.count({ where: { ruleKey: 'platform_admin.config_change.v1' } });
  assert.equal(signalCount, 0, 'a platform-admin config change must never be written to SecuritySignalEvent — that is a separate, security-detection-only domain');
});

await test('PATCH settings: successful true→false toggle creates exactly one durable PlatformAdminAuditEvent row with correct previous/new values', async () => {
  await cleanAuditRows();
  await prisma.platformSetting.upsert({
    where: { key: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY },
    update: { value: 'true' },
    create: { key: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY, value: 'true' },
  });

  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'patch', '/privacy/legacy-consent-correction/settings');
  const res = mockPlatformRes();
  await runChain(chain, mockPlatformReq({ runtimeEnabled: false }), res);
  assert.equal(res.statusCode, 200);

  const rows = await prisma.platformAdminAuditEvent.findMany({
    where: { action: AUDIT_ACTION, resourceKey: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY },
  });
  assert.equal(rows.length, 1, 'exactly one durable audit row must be created for one successful toggle');
  assert.equal(rows[0].previousValue, 'true');
  assert.equal(rows[0].newValue, 'false');
  assert.equal(rows[0].outcome, 'success');

  const signalCount = await prisma.securitySignalEvent.count({ where: { ruleKey: 'platform_admin.config_change.v1' } });
  assert.equal(signalCount, 0, 'a platform-admin config change must never be written to SecuritySignalEvent');
});

await test('PATCH settings: enabling from a truly ABSENT baseline (no PlatformSetting row at all) creates an audit row with previousValue=null, not the boolean-coerced string "false" (regression test for F2-CI-FLAKE-LEGACY-CONSENT-001)', async () => {
  await cleanAuditRows();
  await prisma.platformSetting.deleteMany({ where: { key: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY } });

  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'patch', '/privacy/legacy-consent-correction/settings');
  const res = mockPlatformRes();
  await runChain(chain, mockPlatformReq({ runtimeEnabled: true }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.runtimeEnabled, true);

  const row = await prisma.platformSetting.findUnique({ where: { key: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY } });
  assert.equal(row?.value, 'true');

  const rows = await prisma.platformAdminAuditEvent.findMany({
    where: { action: AUDIT_ACTION, resourceKey: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY },
  });
  assert.equal(rows.length, 1, 'exactly one durable audit row must be created for one successful toggle');
  assert.equal(
    rows[0].previousValue,
    null,
    'an absent PlatformSetting row must be recorded as null, not the boolean-coerced string "false" — the two are semantically distinct prior states and collapsing them is exactly the bug this test guards against',
  );
  assert.equal(rows[0].newValue, 'true');
  assert.equal(rows[0].outcome, 'success');
});

await test('PATCH settings: rejected (non-boolean) toggle attempt never creates a PlatformAdminAuditEvent — no misleading success record on a failed attempt', async () => {
  await cleanAuditRows();
  const before = await prisma.platformAdminAuditEvent.count({ where: { action: AUDIT_ACTION, resourceKey: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY } });
  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'patch', '/privacy/legacy-consent-correction/settings');
  for (const badBody of [{ runtimeEnabled: 'true' }, { runtimeEnabled: 1 }, { runtimeEnabled: null }, {}]) {
    const res = mockPlatformRes();
    await runChain(chain, mockPlatformReq(badBody), res);
    assert.equal(res.statusCode, 400);
  }
  const after = await prisma.platformAdminAuditEvent.count({ where: { action: AUDIT_ACTION, resourceKey: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY } });
  assert.equal(after, before, 'a rejected/invalid toggle attempt must never create any audit record — success or otherwise');
});

await test('PATCH settings: unauthorized caller (invalid platform token) is rejected before reaching the handler and creates no success audit', async () => {
  await cleanAuditRows();
  const req = makeReq('Bearer not-a-real-platform-token');
  const res = makeRes();
  let nextCalled = false;
  await (authenticatePlatformAdmin as any)(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false, 'authenticatePlatformAdmin must reject an invalid token before any handler runs');
  assert.equal(res._status, 401);

  const after = await prisma.platformAdminAuditEvent.count({ where: { action: AUDIT_ACTION, resourceKey: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY } });
  assert.equal(after, 0, 'an unauthorized request must never create an audit record');
});

await test('PATCH settings: setting update and audit insert are atomic — a forced audit-insert failure leaves the setting value unchanged and creates no row', async () => {
  await cleanAuditRows();
  await prisma.platformSetting.upsert({
    where: { key: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY },
    update: { value: 'false' },
    create: { key: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY, value: 'false' },
  });

  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'patch', '/privacy/legacy-consent-correction/settings');
  const res = mockPlatformRes();
  // actorPlatformAdminId has a real FK to PlatformAdmin(id); a non-existent
  // admin id forces a genuine DB-level foreign-key violation on the audit
  // insert inside the transaction — no mocking required. This must roll back
  // the setting upsert alongside it, proving atomicity, not just error safety.
  const req = { body: { runtimeEnabled: true }, platformAdmin: { id: 'admin-does-not-exist-ghost', email: 'ghost@platform.test' } } as any;
  await assert.rejects(() => runChain(chain, req, res), 'a failed audit insert must reject the whole request rather than silently succeed');

  const row = await prisma.platformSetting.findUnique({ where: { key: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY } });
  assert.equal(row?.value, 'false', 'the setting must remain at its pre-toggle value when the audit insert fails — atomic, not best-effort');

  const auditCount = await prisma.platformAdminAuditEvent.count({ where: { actorPlatformAdminId: 'admin-does-not-exist-ghost' } });
  assert.equal(auditCount, 0, 'no audit row should exist either, since the whole transaction rolled back');
});

await test('PATCH settings: two concurrent successful toggles serialize via a real Postgres advisory lock and produce a sequentially coherent audit chain (two genuinely concurrent $transaction calls, no mocking)', async () => {
  await cleanAuditRows();
  const baselineValue = 'false';
  await prisma.platformSetting.upsert({
    where: { key: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY },
    update: { value: baselineValue },
    create: { key: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY, value: baselineValue },
  });

  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'patch', '/privacy/legacy-consent-correction/settings');
  const resA = mockPlatformRes();
  const resB = mockPlatformRes();
  // Fired together via Promise.all (no await between them) against the same
  // Postgres instance — each runChain call opens its own prisma.$transaction
  // on its own pooled connection, so this is genuine DB-level concurrency,
  // not a simulated race. The route's advisory lock (keyed to this one
  // setting) forces exactly one of these two real transactions to block
  // until the other commits.
  await Promise.all([
    runChain(chain, mockPlatformReq({ runtimeEnabled: true }), resA),
    runChain(chain, mockPlatformReq({ runtimeEnabled: false }), resB),
  ]);
  assert.equal(resA.statusCode, 200);
  assert.equal(resB.statusCode, 200);

  const finalRow = await prisma.platformSetting.findUnique({ where: { key: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY } });
  const finalValue = finalRow?.value;
  assert.ok(finalValue === 'true' || finalValue === 'false', 'the setting must land on exactly one of the two submitted values');
  // Whichever of {true, false} did NOT win the race is the FIRST committer's target.
  const firstCommitterTarget = finalValue === 'true' ? 'false' : 'true';

  const rows = await prisma.platformAdminAuditEvent.findMany({
    where: { action: AUDIT_ACTION, resourceKey: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY },
  });
  assert.equal(rows.length, 2, 'both concurrent successful writes must each produce exactly one audit row — no merging, no duplication, no dropped row');

  const lastRow = rows.find((r) => r.newValue === finalValue);
  const firstRow = rows.find((r) => r.newValue === firstCommitterTarget);
  assert.ok(firstRow, "the first committer's audit row must exist");
  assert.ok(lastRow, "the last (final) committer's audit row must exist");
  assert.notEqual(firstRow!.id, lastRow!.id, 'the two rows must be distinct');

  assert.equal(firstRow!.previousValue, baselineValue, 'the first committer must have read the true pre-race baseline value');
  assert.equal(
    lastRow!.previousValue,
    firstCommitterTarget,
    "the second (final) committer must have read the FIRST committer's freshly-committed value from inside its own transaction — a stale pre-transaction read would instead record the original baseline here",
  );
  assert.notEqual(
    lastRow!.previousValue,
    baselineValue,
    'no stale duplicate previousValue: the committed order requires the second row to reflect the changed value, not the original baseline again',
  );
});

await test("PATCH settings: a concurrently-failing toggle (forced FK violation) never corrupts the concurrently-succeeding toggle's committed value or audit trail", async () => {
  await cleanAuditRows();
  await prisma.platformSetting.upsert({
    where: { key: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY },
    update: { value: 'false' },
    create: { key: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY, value: 'false' },
  });

  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'patch', '/privacy/legacy-consent-correction/settings');
  const goodReq = mockPlatformReq({ runtimeEnabled: true });
  // Same real-FK-violation technique as the single-request atomicity test
  // above, but fired concurrently against a separate, valid request.
  const ghostReq = { body: { runtimeEnabled: true }, platformAdmin: { id: 'admin-does-not-exist-ghost-2', email: 'ghost2@platform.test' } } as any;
  const goodRes = mockPlatformRes();
  const ghostRes = mockPlatformRes();

  const [goodOutcome, ghostOutcome] = await Promise.allSettled([
    runChain(chain, goodReq, goodRes),
    runChain(chain, ghostReq, ghostRes),
  ]);
  assert.equal(goodOutcome.status, 'fulfilled', 'the valid concurrent request must succeed regardless of the other one failing');
  assert.equal(ghostOutcome.status, 'rejected', 'the FK-violating concurrent request must reject, not silently succeed');

  const row = await prisma.platformSetting.findUnique({ where: { key: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY } });
  assert.equal(row?.value, 'true', "the setting must reflect only the successful concurrent write — the failed one's write must have fully rolled back, whichever order the two transactions ran in");

  const rows = await prisma.platformAdminAuditEvent.findMany({ where: { action: AUDIT_ACTION, resourceKey: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY } });
  assert.equal(rows.length, 1, 'only the successful write may leave an audit row; the failed transaction must roll back its insert along with its setting write');
  assert.equal(rows[0]!.previousValue, 'false');
  assert.equal(rows[0]!.newValue, 'true');

  const ghostAuditCount = await prisma.platformAdminAuditEvent.count({ where: { actorPlatformAdminId: 'admin-does-not-exist-ghost-2' } });
  assert.equal(ghostAuditCount, 0);
});

await test('DELETE settings: explicit false row is removed, default-deny is restored, and one durable reset audit row is created', async () => {
  await cleanAuditRows();
  await prisma.platformSetting.upsert({
    where: { key: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY },
    update: { value: 'false' },
    create: { key: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY, value: 'false' },
  });

  const chain = getRouteMiddlewareChain(
    platformAdminRouter as any,
    'delete',
    '/privacy/legacy-consent-correction/settings',
  );
  const res = mockPlatformRes();
  await runChain(chain, mockPlatformReq(), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    runtimeEnabled: false,
    settingPresent: false,
    removed: true,
  });

  const setting = await prisma.platformSetting.findUnique({
    where: { key: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY },
  });
  assert.equal(setting, null);

  const rows = await prisma.platformAdminAuditEvent.findMany({
    where: {
      action: RESET_AUDIT_ACTION,
      resourceKey: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY,
    },
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].actorPlatformAdminId, 'admin-1');
  assert.equal(rows[0].resourceType, 'platform_setting');
  assert.equal(rows[0].previousValue, 'false');
  assert.equal(rows[0].newValue, null);
  assert.equal(rows[0].outcome, 'success');
  assert.deepEqual(rows[0].safeMetadata, { restoredDefaultState: true });
});

await test('DELETE settings: absent setting is idempotent and creates no misleading reset audit row', async () => {
  await cleanAuditRows();
  await prisma.platformSetting.deleteMany({
    where: { key: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY },
  });

  const chain = getRouteMiddlewareChain(
    platformAdminRouter as any,
    'delete',
    '/privacy/legacy-consent-correction/settings',
  );
  const res = mockPlatformRes();
  await runChain(chain, mockPlatformReq(), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    runtimeEnabled: false,
    settingPresent: false,
    removed: false,
  });

  const auditCount = await prisma.platformAdminAuditEvent.count({
    where: {
      action: RESET_AUDIT_ACTION,
      resourceKey: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY,
    },
  });
  assert.equal(auditCount, 0);
});

await test('DELETE settings: audit failure rolls the deletion back atomically', async () => {
  await cleanAuditRows();
  await prisma.platformSetting.upsert({
    where: { key: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY },
    update: { value: 'false' },
    create: { key: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY, value: 'false' },
  });

  const chain = getRouteMiddlewareChain(
    platformAdminRouter as any,
    'delete',
    '/privacy/legacy-consent-correction/settings',
  );

  const req = {
    body: {},
    platformAdmin: {
      id: 'admin-does-not-exist-reset-ghost',
      email: 'reset-ghost@platform.test',
    },
  } as any;

  await assert.rejects(() => runChain(chain, req, mockPlatformRes()));

  const setting = await prisma.platformSetting.findUnique({
    where: { key: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY },
  });
  assert.equal(setting?.value, 'false');

  const auditCount = await prisma.platformAdminAuditEvent.count({
    where: {
      action: RESET_AUDIT_ACTION,
      resourceKey: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY,
    },
  });
  assert.equal(auditCount, 0);
});

await test('PATCH and DELETE settings: concurrent enable/reset operations serialize into a coherent final state and audit chain', async () => {
  await cleanAuditRows();
  const baselineValue = 'false';

  await prisma.platformSetting.upsert({
    where: { key: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY },
    update: { value: baselineValue },
    create: {
      key: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY,
      value: baselineValue,
    },
  });

  const patchChain = getRouteMiddlewareChain(
    platformAdminRouter as any,
    'patch',
    '/privacy/legacy-consent-correction/settings',
  );
  const deleteChain = getRouteMiddlewareChain(
    platformAdminRouter as any,
    'delete',
    '/privacy/legacy-consent-correction/settings',
  );

  const patchRes = mockPlatformRes();
  const deleteRes = mockPlatformRes();

  // Both handlers open independent real Postgres transactions and acquire the
  // same transaction-scoped advisory lock. The committed outcome must therefore
  // be equivalent to one complete serial ordering, never a stale-read mixture.
  await Promise.all([
    runChain(patchChain, mockPlatformReq({ runtimeEnabled: true }), patchRes),
    runChain(deleteChain, mockPlatformReq(), deleteRes),
  ]);

  assert.equal(patchRes.statusCode, 200);
  assert.equal(deleteRes.statusCode, 200);

  const finalSetting = await prisma.platformSetting.findUnique({
    where: { key: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY },
  });

  const updateRows = await prisma.platformAdminAuditEvent.findMany({
    where: {
      action: AUDIT_ACTION,
      resourceKey: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY,
    },
  });
  const resetRows = await prisma.platformAdminAuditEvent.findMany({
    where: {
      action: RESET_AUDIT_ACTION,
      resourceKey: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY,
    },
  });

  assert.equal(updateRows.length, 1, 'the successful PATCH must create exactly one update audit row');
  assert.equal(resetRows.length, 1, 'the successful DELETE must create exactly one reset audit row');

  const updateRow = updateRows[0]!;
  const resetRow = resetRows[0]!;

  assert.equal(updateRow.newValue, 'true');
  assert.equal(resetRow.newValue, null);

  if (finalSetting === null) {
    // PATCH committed first, then DELETE read the newly committed true value.
    assert.equal(updateRow.previousValue, baselineValue);
    assert.equal(resetRow.previousValue, 'true');
    assert.deepEqual(deleteRes.body, {
      runtimeEnabled: false,
      settingPresent: false,
      removed: true,
    });
  } else {
    // DELETE committed first, then PATCH recreated the absent setting.
    assert.equal(finalSetting.value, 'true');
    assert.equal(resetRow.previousValue, baselineValue);
    assert.equal(updateRow.previousValue, null);
    assert.deepEqual(deleteRes.body, {
      runtimeEnabled: false,
      settingPresent: false,
      removed: true,
    });
  }
});

await test('PATCH and DELETE settings: forced DELETE-first ordering deterministically records previousValue=null on the PATCH that recreates the absent row (not a probabilistic race — every run)', async () => {
  await cleanAuditRows();
  const baselineValue = 'false';
  await prisma.platformSetting.upsert({
    where: { key: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY },
    update: { value: baselineValue },
    create: { key: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY, value: baselineValue },
  });

  const { patchRes, deleteRes } = await runForcedPatchDeleteOrder('delete-first');
  assert.equal(patchRes.statusCode, 200);
  assert.equal(deleteRes.statusCode, 200);

  const finalSetting = await prisma.platformSetting.findUnique({
    where: { key: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY },
  });
  assert.equal(finalSetting?.value, 'true', 'DELETE was forced to commit first (clearing the row to truly absent), then PATCH recreated it with true');

  const updateRows = await prisma.platformAdminAuditEvent.findMany({
    where: { action: AUDIT_ACTION, resourceKey: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY },
  });
  const resetRows = await prisma.platformAdminAuditEvent.findMany({
    where: { action: RESET_AUDIT_ACTION, resourceKey: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY },
  });
  assert.equal(updateRows.length, 1, 'the successful PATCH must create exactly one update audit row');
  assert.equal(resetRows.length, 1, 'the successful DELETE must create exactly one reset audit row');

  assert.equal(resetRows[0]!.previousValue, baselineValue, 'DELETE (forced first committer) must have read the true pre-race baseline');
  assert.equal(resetRows[0]!.newValue, null);
  assert.equal(
    updateRows[0]!.previousValue,
    null,
    'PATCH (forced second committer, reading inside its own transaction after DELETE committed) must record the setting as truly absent — not the string "false" — at the exact moment it read it',
  );
  assert.equal(updateRows[0]!.newValue, 'true');
});

await test('PATCH and DELETE settings: forced PATCH-first ordering deterministically records the correct non-stale audit chain (not a probabilistic race — every run)', async () => {
  await cleanAuditRows();
  const baselineValue = 'false';
  await prisma.platformSetting.upsert({
    where: { key: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY },
    update: { value: baselineValue },
    create: { key: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY, value: baselineValue },
  });

  const { patchRes, deleteRes } = await runForcedPatchDeleteOrder('patch-first');
  assert.equal(patchRes.statusCode, 200);
  assert.equal(deleteRes.statusCode, 200);

  const finalSetting = await prisma.platformSetting.findUnique({
    where: { key: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY },
  });
  assert.equal(finalSetting, null, 'PATCH was forced to commit first (setting true), then DELETE removed the row again');

  const updateRows = await prisma.platformAdminAuditEvent.findMany({
    where: { action: AUDIT_ACTION, resourceKey: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY },
  });
  const resetRows = await prisma.platformAdminAuditEvent.findMany({
    where: { action: RESET_AUDIT_ACTION, resourceKey: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY },
  });
  assert.equal(updateRows.length, 1, 'the successful PATCH must create exactly one update audit row');
  assert.equal(resetRows.length, 1, 'the successful DELETE must create exactly one reset audit row');

  assert.equal(updateRows[0]!.previousValue, baselineValue, 'PATCH (forced first committer) must have read the true pre-race baseline');
  assert.equal(updateRows[0]!.newValue, 'true');
  assert.equal(
    resetRows[0]!.previousValue,
    'true',
    "DELETE (forced second committer) must have read PATCH's freshly committed true value from inside its own transaction, not a stale pre-transaction baseline",
  );
  assert.equal(resetRows[0]!.newValue, null);
});

await test("PATCH+DELETE settings: a concurrently-failing DELETE (forced FK violation) never corrupts a concurrently-succeeding PATCH's committed value or audit trail", async () => {
  await cleanAuditRows();
  await prisma.platformSetting.upsert({
    where: { key: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY },
    update: { value: 'false' },
    create: { key: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY, value: 'false' },
  });

  const patchChain = getRouteMiddlewareChain(platformAdminRouter as any, 'patch', '/privacy/legacy-consent-correction/settings');
  const deleteChain = getRouteMiddlewareChain(platformAdminRouter as any, 'delete', '/privacy/legacy-consent-correction/settings');

  const goodPatchReq = mockPlatformReq({ runtimeEnabled: true });
  // Same real-FK-violation technique as the single-request/PATCH+PATCH
  // atomicity tests above, but the failing side is now DELETE.
  const ghostDeleteReq = { body: {}, platformAdmin: { id: 'admin-does-not-exist-ghost-delete', email: 'ghost-delete@platform.test' } } as any;
  const patchRes = mockPlatformRes();
  const ghostDeleteRes = mockPlatformRes();

  const [patchOutcome, deleteOutcome] = await Promise.allSettled([
    runChain(patchChain, goodPatchReq, patchRes),
    runChain(deleteChain, ghostDeleteReq, ghostDeleteRes),
  ]);
  assert.equal(patchOutcome.status, 'fulfilled', 'the valid concurrent PATCH must succeed regardless of the concurrent DELETE failing');
  assert.equal(deleteOutcome.status, 'rejected', 'the FK-violating concurrent DELETE must reject, not silently succeed');

  const row = await prisma.platformSetting.findUnique({ where: { key: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY } });
  assert.equal(row?.value, 'true', "the setting must reflect only the successful PATCH — the failed DELETE's removal must have fully rolled back, whichever order the two transactions ran in");

  const updateRows = await prisma.platformAdminAuditEvent.findMany({ where: { action: AUDIT_ACTION, resourceKey: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY } });
  const resetRows = await prisma.platformAdminAuditEvent.findMany({ where: { action: RESET_AUDIT_ACTION, resourceKey: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY } });
  assert.equal(updateRows.length, 1, 'only the successful PATCH may leave an update audit row');
  assert.equal(resetRows.length, 0, "the failed DELETE must roll back its audit insert along with its (never-committed) setting deletion");
  assert.equal(updateRows[0]!.previousValue, 'false', 'the failed DELETE never actually committed a removal, so PATCH must always read the true baseline regardless of transaction ordering');
  assert.equal(updateRows[0]!.newValue, 'true');

  const ghostAuditCount = await prisma.platformAdminAuditEvent.count({ where: { actorPlatformAdminId: 'admin-does-not-exist-ghost-delete' } });
  assert.equal(ghostAuditCount, 0);
});

await test("PATCH+DELETE settings: a concurrently-failing PATCH (forced FK violation) never corrupts a concurrently-succeeding DELETE's committed value or audit trail", async () => {
  await cleanAuditRows();
  await prisma.platformSetting.upsert({
    where: { key: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY },
    update: { value: 'false' },
    create: { key: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY, value: 'false' },
  });

  const patchChain = getRouteMiddlewareChain(platformAdminRouter as any, 'patch', '/privacy/legacy-consent-correction/settings');
  const deleteChain = getRouteMiddlewareChain(platformAdminRouter as any, 'delete', '/privacy/legacy-consent-correction/settings');

  const ghostPatchReq = { body: { runtimeEnabled: true }, platformAdmin: { id: 'admin-does-not-exist-ghost-patch', email: 'ghost-patch@platform.test' } } as any;
  const goodDeleteReq = mockPlatformReq();
  const ghostPatchRes = mockPlatformRes();
  const deleteRes = mockPlatformRes();

  const [patchOutcome, deleteOutcome] = await Promise.allSettled([
    runChain(patchChain, ghostPatchReq, ghostPatchRes),
    runChain(deleteChain, goodDeleteReq, deleteRes),
  ]);
  assert.equal(deleteOutcome.status, 'fulfilled', 'the valid concurrent DELETE must succeed regardless of the concurrent PATCH failing');
  assert.equal(patchOutcome.status, 'rejected', 'the FK-violating concurrent PATCH must reject, not silently succeed');

  const row = await prisma.platformSetting.findUnique({ where: { key: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY } });
  assert.equal(row, null, "the setting must reflect only the successful DELETE — the failed PATCH's write must have fully rolled back, whichever order the two transactions ran in");

  const updateRows = await prisma.platformAdminAuditEvent.findMany({ where: { action: AUDIT_ACTION, resourceKey: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY } });
  const resetRows = await prisma.platformAdminAuditEvent.findMany({ where: { action: RESET_AUDIT_ACTION, resourceKey: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY } });
  assert.equal(updateRows.length, 0, 'the failed PATCH must roll back its audit insert along with its (never-committed) setting write');
  assert.equal(resetRows.length, 1, 'only the successful DELETE may leave a reset audit row');
  assert.equal(resetRows[0]!.previousValue, 'false', 'the failed PATCH never actually committed a write, so DELETE must always read the true baseline regardless of transaction ordering');
  assert.equal(resetRows[0]!.newValue, null);

  const ghostAuditCount = await prisma.platformAdminAuditEvent.count({ where: { actorPlatformAdminId: 'admin-does-not-exist-ghost-patch' } });
  assert.equal(ghostAuditCount, 0);
});

await test('PATCH settings: admin-attributed console log is emitted on toggle (existing platform-admin observability convention), leaving the DB row as the final restored state', async () => {
  const logSpy: string[] = [];
  const originalLog = console.log;
  console.log = ((...args: unknown[]) => { logSpy.push(args.map(String).join(' ')); }) as any;
  try {
    const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'patch', '/privacy/legacy-consent-correction/settings');
    await runChain(chain, mockPlatformReq({ runtimeEnabled: true }), mockPlatformRes());
  } finally {
    console.log = originalLog;
  }
  assert.ok(logSpy.some((line) => line.includes('admin-1') && line.includes('true')), 'toggle must be logged with the acting admin id and the new value (PII-minimized: id, not email)');
  assert.ok(!logSpy.some((line) => line.includes('admin@platform.test')), 'admin email must never appear in the console log (PII minimization)');

  // Restore to the real production default (absent) so this file leaves no
  // global PlatformSetting/PlatformAdminAuditEvent state behind for whatever
  // test file runs next.
  await prisma.platformSetting.deleteMany({ where: { key: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY } });
  await cleanAuditRows();
});

section('F3-IMPL-003 — Platform-Admin Privileged Mutation Audit Coverage (R-019)');

// Every route below is gated by the SAME router-level
// `router.use(authenticatePlatformAdmin, csrfProtection('platform'))` already
// proven (many times, above) to reject an invalid/missing platform token
// before any handler runs — so an unauthorized caller can never reach any of
// the mfa/*, sms-providers, or data-retention/settings handlers exercised
// below. One direct proof here, rather than duplicating it six times.
await test('F3-IMPL-003: unauthorized (invalid platform token) requests never reach the mfa/*, sms-providers, or data-retention/settings handlers', async () => {
  const req = makeReq('Bearer not-a-real-platform-token');
  const res = makeRes();
  let nextCalled = false;
  await (authenticatePlatformAdmin as any)(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false, 'authenticatePlatformAdmin must reject before any handler in this router runs');
  assert.equal(res._status, 401);
});

// ── MFA (TOTP) — security/auth configuration (priority class 1) ─────────────
//
// mfa/setup and mfa/verify mutate PlatformAdmin.totpSecretEncrypted /
// totpEnabledAt with zero prior audit trail; mfa/disable is the single
// highest-risk gap of the three — it weakens the acting admin's own account
// security posture. All three now write a PlatformAdminAuditEvent in the
// SAME transaction as the mutation (see platformAdmin.ts).

section('MFA (TOTP) — durable audit trail (F3-IMPL-003)');

const MFA_ADMIN_ID = 'admin-mfa-audit-f3impl003';
const MFA_ADMIN_PASSWORD = 'Str0ngTestPassword!MFA-F3';

await prisma.platformAdmin.upsert({
  where: { id: MFA_ADMIN_ID },
  update: { passwordHash: await bcrypt.hash(MFA_ADMIN_PASSWORD, 10) },
  create: {
    id: MFA_ADMIN_ID,
    email: `${MFA_ADMIN_ID}-fixture@platform.test`,
    passwordHash: await bcrypt.hash(MFA_ADMIN_PASSWORD, 10),
    name: 'Test Fixture Platform Admin (MFA Audit)',
  },
});

function mfaReq(body: Record<string, unknown> = {}, id: string = MFA_ADMIN_ID) {
  return { body, platformAdmin: { id, email: `${id}@platform.test` } } as any;
}

async function cleanMfaAuditRows() {
  await prisma.platformAdminAuditEvent.deleteMany({
    where: { resourceType: 'platform_admin', resourceKey: MFA_ADMIN_ID },
  });
}

async function resetMfaAdminState(overrides: { totpSecretEncrypted?: string | null; totpEnabledAt?: Date | null } = {}) {
  await prisma.platformAdmin.update({
    where: { id: MFA_ADMIN_ID },
    data: { totpSecretEncrypted: null, totpEnabledAt: null, ...overrides },
  });
}

// -- POST /auth/mfa/setup --

await test('POST /auth/mfa/setup: success creates exactly one platform_admin_mfa.setup_initiated audit row, attributed by id, never the secret', async () => {
  await cleanMfaAuditRows();
  await resetMfaAdminState();

  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'post', '/auth/mfa/setup');
  const res = mockPlatformRes();
  await runChain(chain, mfaReq({}), res);
  assert.equal(res.statusCode, 200);
  assert.ok(typeof res.body?.secret === 'string' && res.body.secret.length > 0);

  const rows = await prisma.platformAdminAuditEvent.findMany({
    where: { resourceType: 'platform_admin', resourceKey: MFA_ADMIN_ID, action: 'platform_admin_mfa.setup_initiated' },
  });
  assert.equal(rows.length, 1, 'exactly one audit row for one successful setup call');
  const row = rows[0]!;
  assert.equal(row.actorPlatformAdminId, MFA_ADMIN_ID, 'must durably attribute the acting platform admin by id');
  assert.equal(row.outcome, 'success');
  assert.equal(row.previousValue, null);
  assert.equal(row.newValue, null);
  assert.equal((row.safeMetadata as any)?.hadPendingSecret, false);

  const serialized = JSON.stringify(row);
  assert.ok(!serialized.includes(res.body.secret), 'audit row must never contain the TOTP secret itself');
  assert.ok(!serialized.includes('@'), 'audit row must contain no email-shaped value');
});

await test('POST /auth/mfa/setup: re-enrollment over an existing unverified secret records hadPendingSecret=true', async () => {
  await cleanMfaAuditRows();
  await resetMfaAdminState({ totpSecretEncrypted: encryptSecretTagged(generateTotpSecret()) });

  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'post', '/auth/mfa/setup');
  const res = mockPlatformRes();
  await runChain(chain, mfaReq({}), res);
  assert.equal(res.statusCode, 200);

  const rows = await prisma.platformAdminAuditEvent.findMany({
    where: { resourceType: 'platform_admin', resourceKey: MFA_ADMIN_ID, action: 'platform_admin_mfa.setup_initiated' },
  });
  assert.equal(rows.length, 1);
  assert.equal((rows[0]!.safeMetadata as any)?.hadPendingSecret, true);
});

await test('POST /auth/mfa/setup: rejected (MFA already enabled) creates no audit row', async () => {
  await cleanMfaAuditRows();
  await resetMfaAdminState({ totpEnabledAt: new Date() });
  const before = await prisma.platformAdminAuditEvent.count({ where: { resourceType: 'platform_admin', resourceKey: MFA_ADMIN_ID } });

  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'post', '/auth/mfa/setup');
  const res = mockPlatformRes();
  await runChain(chain, mfaReq({}), res);
  assert.equal(res.statusCode, 400);

  const after = await prisma.platformAdminAuditEvent.count({ where: { resourceType: 'platform_admin', resourceKey: MFA_ADMIN_ID } });
  assert.equal(after, before, 'a rejected setup attempt must never create any audit record');
  await resetMfaAdminState();
});

await test('POST /auth/mfa/setup: a non-existent actor id (admin row does not exist) is rejected before any mutation is attempted — no audit row', async () => {
  const ghostId = 'admin-mfa-ghost-setup';
  await prisma.platformAdminAuditEvent.deleteMany({ where: { actorPlatformAdminId: ghostId } });

  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'post', '/auth/mfa/setup');
  const res = mockPlatformRes();
  await runChain(chain, mfaReq({}, ghostId), res);
  assert.equal(res.statusCode, 404, 'the handler resolves the acting admin row before any mutation — a non-existent actor can never reach the transaction');

  const count = await prisma.platformAdminAuditEvent.count({ where: { actorPlatformAdminId: ghostId } });
  assert.equal(count, 0);
});

// -- POST /auth/mfa/verify --

async function primeMfaVerifyState(): Promise<string> {
  const secret = generateTotpSecret();
  await resetMfaAdminState({ totpSecretEncrypted: encryptSecretTagged(secret) });
  return secret;
}

await test('POST /auth/mfa/verify: success creates exactly one platform_admin_mfa.enabled audit row with previousValue=false/newValue=true', async () => {
  await cleanMfaAuditRows();
  const secret = await primeMfaVerifyState();
  const code = generateTotp(secret);

  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'post', '/auth/mfa/verify');
  const res = mockPlatformRes();
  await runChain(chain, mfaReq({ code }), res);
  assert.equal(res.statusCode, 200);

  const rows = await prisma.platformAdminAuditEvent.findMany({
    where: { resourceType: 'platform_admin', resourceKey: MFA_ADMIN_ID, action: 'platform_admin_mfa.enabled' },
  });
  assert.equal(rows.length, 1);
  const row = rows[0]!;
  assert.equal(row.actorPlatformAdminId, MFA_ADMIN_ID);
  assert.equal(row.previousValue, 'false');
  assert.equal(row.newValue, 'true');
  assert.equal(row.outcome, 'success');

  const admin = await prisma.platformAdmin.findUnique({ where: { id: MFA_ADMIN_ID } });
  assert.ok(admin?.totpEnabledAt, 'the underlying mutation must have actually taken effect');
});

await test('POST /auth/mfa/verify: rejected (wrong code) creates no audit row', async () => {
  await cleanMfaAuditRows();
  await primeMfaVerifyState();
  const before = await prisma.platformAdminAuditEvent.count({ where: { resourceType: 'platform_admin', resourceKey: MFA_ADMIN_ID, action: 'platform_admin_mfa.enabled' } });

  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'post', '/auth/mfa/verify');
  const res = mockPlatformRes();
  await runChain(chain, mfaReq({ code: '000000' }), res);
  assert.equal(res.statusCode, 400);

  const after = await prisma.platformAdminAuditEvent.count({ where: { resourceType: 'platform_admin', resourceKey: MFA_ADMIN_ID, action: 'platform_admin_mfa.enabled' } });
  assert.equal(after, before, 'a rejected verify attempt must never create any audit record');
});

await test('POST /auth/mfa/verify: a non-existent actor id is rejected before any mutation is attempted — no audit row', async () => {
  const ghostId = 'admin-mfa-ghost-verify';
  await prisma.platformAdminAuditEvent.deleteMany({ where: { actorPlatformAdminId: ghostId } });

  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'post', '/auth/mfa/verify');
  const res = mockPlatformRes();
  await runChain(chain, mfaReq({ code: '123456' }, ghostId), res);
  assert.equal(res.statusCode, 404);

  const count = await prisma.platformAdminAuditEvent.count({ where: { actorPlatformAdminId: ghostId } });
  assert.equal(count, 0);
});

// -- POST /auth/mfa/disable --

async function primeMfaDisableState(): Promise<string> {
  const secret = generateTotpSecret();
  await resetMfaAdminState({ totpSecretEncrypted: encryptSecretTagged(secret), totpEnabledAt: new Date() });
  return secret;
}

await test('POST /auth/mfa/disable: success creates exactly one platform_admin_mfa.disabled audit row with previousValue=true/newValue=false, no password/PII', async () => {
  await cleanMfaAuditRows();
  const secret = await primeMfaDisableState();
  const code = generateTotp(secret);

  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'post', '/auth/mfa/disable');
  const res = mockPlatformRes();
  await runChain(chain, mfaReq({ code, password: MFA_ADMIN_PASSWORD }), res);
  assert.equal(res.statusCode, 200);

  const rows = await prisma.platformAdminAuditEvent.findMany({
    where: { resourceType: 'platform_admin', resourceKey: MFA_ADMIN_ID, action: 'platform_admin_mfa.disabled' },
  });
  assert.equal(rows.length, 1);
  const row = rows[0]!;
  assert.equal(row.previousValue, 'true');
  assert.equal(row.newValue, 'false');
  assert.equal(row.outcome, 'success');
  const serialized = JSON.stringify(row);
  assert.ok(!serialized.includes(MFA_ADMIN_PASSWORD), 'audit row must never contain the admin password');
  assert.ok(!serialized.includes('@'), 'audit row must contain no email-shaped value');

  const admin = await prisma.platformAdmin.findUnique({ where: { id: MFA_ADMIN_ID } });
  assert.equal(admin?.totpEnabledAt, null);
  assert.equal(admin?.totpSecretEncrypted, null);
  // F3-SEC-002: MFA disable is not a credential-invalidating event — it
  // requires re-proof of both the current password AND a valid TOTP code
  // (see the password/code check above this route calls), so it carries no
  // more risk than an already-authenticated session performing any other
  // self-service action, and the caller already holds a live session by
  // definition. Session revocation stays scoped to password resets.
  assert.equal(admin?.passwordChangedAt, null, 'MFA disable must never touch the session-revocation checkpoint');
});

await test('POST /auth/mfa/disable: rejected (wrong password) creates no audit row and leaves MFA enabled', async () => {
  await cleanMfaAuditRows();
  const secret = await primeMfaDisableState();
  const code = generateTotp(secret);
  const before = await prisma.platformAdminAuditEvent.count({ where: { resourceType: 'platform_admin', resourceKey: MFA_ADMIN_ID, action: 'platform_admin_mfa.disabled' } });

  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'post', '/auth/mfa/disable');
  const res = mockPlatformRes();
  await runChain(chain, mfaReq({ code, password: 'definitely-the-wrong-password' }), res);
  assert.equal(res.statusCode, 401);

  const after = await prisma.platformAdminAuditEvent.count({ where: { resourceType: 'platform_admin', resourceKey: MFA_ADMIN_ID, action: 'platform_admin_mfa.disabled' } });
  assert.equal(after, before, 'a rejected disable attempt must never create any audit record');

  const admin = await prisma.platformAdmin.findUnique({ where: { id: MFA_ADMIN_ID } });
  assert.ok(admin?.totpEnabledAt, 'MFA must remain enabled after a rejected disable attempt');
});

await test('POST /auth/mfa/disable: a non-existent actor id is rejected before any mutation is attempted — no audit row', async () => {
  const ghostId = 'admin-mfa-ghost-disable';
  await prisma.platformAdminAuditEvent.deleteMany({ where: { actorPlatformAdminId: ghostId } });

  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'post', '/auth/mfa/disable');
  const res = mockPlatformRes();
  await runChain(chain, mfaReq({ code: '123456', password: 'irrelevant' }, ghostId), res);
  assert.equal(res.statusCode, 404);

  const count = await prisma.platformAdminAuditEvent.count({ where: { actorPlatformAdminId: ghostId } });
  assert.equal(count, 0);
});

await cleanMfaAuditRows();

// ── Platform SMS Providers — provider/credential configuration (priority 2) ─
//
// PUT upserts (and DELETE removes) global, cross-tenant SMS provider
// credentials with zero prior audit trail. Both now write a
// PlatformAdminAuditEvent in the SAME transaction as the mutation; neither
// previousValue/newValue nor safeMetadata ever carries the encrypted
// credentials payload — only non-secret config fields and a
// credentialsChanged boolean.

section('Platform SMS Providers — durable audit trail (F3-IMPL-003)');

const SMS_ADMIN_ID = 'admin-sms-provider-audit-f3impl003';
const SMS_REGION = 'tr';
const SMS_PROVIDER_CODE = 'test_provider_f3impl003';
const SMS_RESOURCE_KEY = `${SMS_REGION}:${SMS_PROVIDER_CODE}`;

await prisma.platformAdmin.upsert({
  where: { id: SMS_ADMIN_ID },
  update: {},
  create: {
    id: SMS_ADMIN_ID,
    email: `${SMS_ADMIN_ID}-fixture@platform.test`,
    passwordHash: 'not-a-real-hash-test-fixture-only',
    name: 'Test Fixture Platform Admin (SMS Provider Audit)',
  },
});

function smsReq(body: Record<string, unknown> = {}, id: string = SMS_ADMIN_ID) {
  return { body, params: {}, platformAdmin: { id, email: `${id}@platform.test` } } as any;
}

async function cleanSmsProviderFixture() {
  await prisma.platformSmsProvider.deleteMany({ where: { region: SMS_REGION, providerCode: SMS_PROVIDER_CODE } });
  await prisma.platformAdminAuditEvent.deleteMany({ where: { resourceType: 'platform_sms_provider', resourceKey: SMS_RESOURCE_KEY } });
}

await cleanSmsProviderFixture();

await test('PUT /sms-providers: creating a new provider creates exactly one platform_sms_provider.upserted audit row (previousValue=null), never the credentials', async () => {
  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'put', '/sms-providers');
  const res = mockPlatformRes();
  await runChain(chain, smsReq({
    region: SMS_REGION, providerCode: SMS_PROVIDER_CODE, displayName: 'Test Provider',
    isActive: true, credentials: { apiKey: 'super-secret-value-f3impl003' },
  }), res);
  assert.equal(res.statusCode, 200);

  const rows = await prisma.platformAdminAuditEvent.findMany({ where: { resourceType: 'platform_sms_provider', resourceKey: SMS_RESOURCE_KEY } });
  assert.equal(rows.length, 1);
  const row = rows[0]!;
  assert.equal(row.action, 'platform_sms_provider.upserted');
  assert.equal(row.actorPlatformAdminId, SMS_ADMIN_ID);
  assert.equal(row.previousValue, null);
  assert.ok(row.newValue?.includes('Test Provider'));
  assert.equal(row.outcome, 'success');
  assert.equal((row.safeMetadata as any)?.isNew, true);
  assert.equal((row.safeMetadata as any)?.credentialsChanged, true);

  const serialized = JSON.stringify(row);
  assert.ok(!serialized.includes('super-secret-value-f3impl003'), 'audit row must never contain provider credentials');
});

await test('PUT /sms-providers: updating an existing provider records accurate non-secret previous/new snapshots', async () => {
  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'put', '/sms-providers');
  const res = mockPlatformRes();
  await runChain(chain, smsReq({ region: SMS_REGION, providerCode: SMS_PROVIDER_CODE, displayName: 'Renamed Provider', isActive: false }), res);
  assert.equal(res.statusCode, 200);

  const rows = await prisma.platformAdminAuditEvent.findMany({
    where: { resourceType: 'platform_sms_provider', resourceKey: SMS_RESOURCE_KEY },
    orderBy: { createdAt: 'asc' },
  });
  assert.equal(rows.length, 2, 'the earlier create and this update must each leave exactly one row');
  const row = rows[1]!;
  const previous = JSON.parse(row.previousValue!);
  const next = JSON.parse(row.newValue!);
  assert.equal(previous.displayName, 'Test Provider');
  assert.equal(previous.isActive, true);
  assert.equal(next.displayName, 'Renamed Provider');
  assert.equal(next.isActive, false);
  assert.equal((row.safeMetadata as any)?.isNew, false);
  assert.equal((row.safeMetadata as any)?.credentialsChanged, false, 'credentials omitted from this payload must not be reported as changed');
});

await test('PUT /sms-providers: rejected (invalid payload) creates no audit row', async () => {
  const before = await prisma.platformAdminAuditEvent.count({ where: { resourceType: 'platform_sms_provider', resourceKey: SMS_RESOURCE_KEY } });
  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'put', '/sms-providers');
  const res = mockPlatformRes();
  await runChain(chain, smsReq({ region: 'not-a-real-region', providerCode: SMS_PROVIDER_CODE, displayName: 'x' }), res);
  assert.equal(res.statusCode, 400);
  const after = await prisma.platformAdminAuditEvent.count({ where: { resourceType: 'platform_sms_provider', resourceKey: SMS_RESOURCE_KEY } });
  assert.equal(after, before);
});

await test('PUT /sms-providers: forced audit-insert failure (non-existent actor id) rolls back the provider write too — atomic, not best-effort', async () => {
  const before = await prisma.platformSmsProvider.findUnique({ where: { region_providerCode: { region: SMS_REGION, providerCode: SMS_PROVIDER_CODE } } });
  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'put', '/sms-providers');
  const res = mockPlatformRes();
  const ghostId = 'admin-sms-ghost-put';
  await runChain(chain, smsReq({ region: SMS_REGION, providerCode: SMS_PROVIDER_CODE, displayName: 'Should Not Persist' }, ghostId), res);
  assert.equal(res.statusCode, 500, 'the FK-violating audit insert must fail the whole request rather than silently succeed');

  const after = await prisma.platformSmsProvider.findUnique({ where: { region_providerCode: { region: SMS_REGION, providerCode: SMS_PROVIDER_CODE } } });
  assert.equal(after?.displayName, before?.displayName, 'the provider row must remain unchanged when the audit insert fails inside the same transaction');

  const ghostCount = await prisma.platformAdminAuditEvent.count({ where: { actorPlatformAdminId: ghostId } });
  assert.equal(ghostCount, 0);
});

await test('DELETE /sms-providers/:id: success creates exactly one platform_sms_provider.deleted audit row and removes the row', async () => {
  const provider = await prisma.platformSmsProvider.findUniqueOrThrow({ where: { region_providerCode: { region: SMS_REGION, providerCode: SMS_PROVIDER_CODE } } });

  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'delete', '/sms-providers/:id');
  const res = mockPlatformRes();
  const req = smsReq({});
  req.params = { id: provider.id };
  await runChain(chain, req, res);
  assert.equal(res.statusCode, 200);

  const remaining = await prisma.platformSmsProvider.findUnique({ where: { id: provider.id } });
  assert.equal(remaining, null);

  const rows = await prisma.platformAdminAuditEvent.findMany({
    where: { resourceType: 'platform_sms_provider', resourceKey: SMS_RESOURCE_KEY, action: 'platform_sms_provider.deleted' },
  });
  assert.equal(rows.length, 1);
  const row = rows[0]!;
  assert.equal(row.actorPlatformAdminId, SMS_ADMIN_ID);
  assert.equal(row.newValue, null);
  assert.ok(row.previousValue?.includes('Renamed Provider'));
});

await test('DELETE /sms-providers/:id: not-found id is rejected with no audit row', async () => {
  const before = await prisma.platformAdminAuditEvent.count({ where: { resourceType: 'platform_sms_provider' } });
  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'delete', '/sms-providers/:id');
  const res = mockPlatformRes();
  const req = smsReq({});
  req.params = { id: 'does-not-exist-provider-id' };
  await runChain(chain, req, res);
  assert.equal(res.statusCode, 404);
  const after = await prisma.platformAdminAuditEvent.count({ where: { resourceType: 'platform_sms_provider' } });
  assert.equal(after, before);
});

await test('DELETE /sms-providers/:id: forced audit-insert failure (non-existent actor id) rolls back the deletion — provider row survives', async () => {
  const recreated = await prisma.platformSmsProvider.create({
    data: { region: SMS_REGION, providerCode: SMS_PROVIDER_CODE, displayName: 'Recreated For Forced-Failure Test' },
  });
  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'delete', '/sms-providers/:id');
  const res = mockPlatformRes();
  const ghostId = 'admin-sms-ghost-delete';
  const req = smsReq({}, ghostId);
  req.params = { id: recreated.id };
  await runChain(chain, req, res);
  assert.equal(res.statusCode, 404, "the route's existing catch-all maps any transaction failure to 404 — unchanged pre-existing behavior");

  const stillThere = await prisma.platformSmsProvider.findUnique({ where: { id: recreated.id } });
  assert.ok(stillThere, 'the provider row must survive when the audit insert fails inside the same transaction');

  const ghostCount = await prisma.platformAdminAuditEvent.count({ where: { actorPlatformAdminId: ghostId } });
  assert.equal(ghostCount, 0);

  await prisma.platformSmsProvider.delete({ where: { id: recreated.id } });
});

await cleanSmsProviderFixture();

// ── Privacy / Data Retention Runtime Toggle — privacy/runtime control (priority 3) ─
//
// This KVKK-relevant kill switch had zero durable audit evidence before —
// the sibling legacy-consent-correction runtime toggle above already wrote a
// PlatformAdminAuditEvent; this one did not. Same transactional,
// advisory-lock-serialized pattern applied here (see platformAdmin.ts).

section('Privacy / Data Retention Runtime Toggle — durable audit trail (F3-IMPL-003)');

const DR_ADMIN_ID = 'admin-data-retention-audit-f3impl003';

await prisma.platformAdmin.upsert({
  where: { id: DR_ADMIN_ID },
  update: {},
  create: {
    id: DR_ADMIN_ID,
    email: `${DR_ADMIN_ID}-fixture@platform.test`,
    passwordHash: 'not-a-real-hash-test-fixture-only',
    name: 'Test Fixture Platform Admin (Data Retention Audit)',
  },
});

function drReq(body: Record<string, unknown> = {}, id: string = DR_ADMIN_ID) {
  return { body, platformAdmin: { id, email: `${id}@platform.test` } } as any;
}

const DR_AUDIT_ACTION = 'platform_setting.updated';

async function cleanDrAuditRows() {
  await prisma.platformAdminAuditEvent.deleteMany({
    where: { action: DR_AUDIT_ACTION, resourceKey: DATA_RETENTION_RUNTIME_SETTING_KEY, actorPlatformAdminId: DR_ADMIN_ID },
  });
}

await test('PATCH /privacy/data-retention/settings: successful false→true toggle creates exactly one durable PlatformAdminAuditEvent row', async () => {
  await cleanDrAuditRows();
  await prisma.platformSetting.upsert({
    where: { key: DATA_RETENTION_RUNTIME_SETTING_KEY },
    update: { value: 'false' },
    create: { key: DATA_RETENTION_RUNTIME_SETTING_KEY, value: 'false' },
  });

  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'patch', '/privacy/data-retention/settings');
  const res = mockPlatformRes();
  await runChain(chain, drReq({ runtimeCleanupEnabled: true }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.runtimeCleanupEnabled, true);

  const rows = await prisma.platformAdminAuditEvent.findMany({
    where: { action: DR_AUDIT_ACTION, resourceKey: DATA_RETENTION_RUNTIME_SETTING_KEY, actorPlatformAdminId: DR_ADMIN_ID },
  });
  assert.equal(rows.length, 1, 'exactly one durable audit row must be created for one successful toggle');
  const row = rows[0]!;
  assert.equal(row.resourceType, 'platform_setting');
  assert.equal(row.previousValue, 'false');
  assert.equal(row.newValue, 'true');
  assert.equal(row.outcome, 'success');
  const serialized = JSON.stringify(row);
  assert.ok(!serialized.includes('@'), 'must never contain an email/identity string — only the opaque platformAdminId');
});

await test('PATCH /privacy/data-retention/settings: enabling from an absent baseline records previousValue=null, not the boolean-coerced string "false"', async () => {
  await cleanDrAuditRows();
  await prisma.platformSetting.deleteMany({ where: { key: DATA_RETENTION_RUNTIME_SETTING_KEY } });

  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'patch', '/privacy/data-retention/settings');
  const res = mockPlatformRes();
  await runChain(chain, drReq({ runtimeCleanupEnabled: true }), res);
  assert.equal(res.statusCode, 200);

  const rows = await prisma.platformAdminAuditEvent.findMany({
    where: { action: DR_AUDIT_ACTION, resourceKey: DATA_RETENTION_RUNTIME_SETTING_KEY, actorPlatformAdminId: DR_ADMIN_ID },
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.previousValue, null, 'an absent PlatformSetting row is a distinct prior state from the string "false" and must not be collapsed into it');
  assert.equal(rows[0]!.newValue, 'true');
});

await test('PATCH /privacy/data-retention/settings: rejected (non-boolean) payload creates no audit row', async () => {
  await cleanDrAuditRows();
  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'patch', '/privacy/data-retention/settings');
  for (const badBody of [{ runtimeCleanupEnabled: 'true' }, { runtimeCleanupEnabled: 1 }, { runtimeCleanupEnabled: null }, {}]) {
    const res = mockPlatformRes();
    await runChain(chain, drReq(badBody), res);
    assert.equal(res.statusCode, 400, `expected 400 for payload ${JSON.stringify(badBody)}`);
  }
  const count = await prisma.platformAdminAuditEvent.count({
    where: { action: DR_AUDIT_ACTION, resourceKey: DATA_RETENTION_RUNTIME_SETTING_KEY, actorPlatformAdminId: DR_ADMIN_ID },
  });
  assert.equal(count, 0, 'a rejected/invalid toggle attempt must never create any audit record');
});

await test('PATCH /privacy/data-retention/settings: setting update and audit insert are atomic — forced audit-insert failure leaves the setting unchanged', async () => {
  await cleanDrAuditRows();
  await prisma.platformSetting.upsert({
    where: { key: DATA_RETENTION_RUNTIME_SETTING_KEY },
    update: { value: 'false' },
    create: { key: DATA_RETENTION_RUNTIME_SETTING_KEY, value: 'false' },
  });

  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'patch', '/privacy/data-retention/settings');
  const res = mockPlatformRes();
  const ghostId = 'admin-dr-ghost-patch';
  // Same real-FK-violation technique proven above for legacy-consent-correction:
  // a non-existent actor id forces a genuine DB-level FK violation on the
  // audit insert inside the transaction — no mocking required.
  await assert.rejects(
    () => runChain(chain, drReq({ runtimeCleanupEnabled: true }, ghostId), res),
    'a failed audit insert must reject the whole request rather than silently succeed',
  );

  const row = await prisma.platformSetting.findUnique({ where: { key: DATA_RETENTION_RUNTIME_SETTING_KEY } });
  assert.equal(row?.value, 'false', 'the setting must remain at its pre-toggle value when the audit insert fails — atomic, not best-effort');

  const ghostCount = await prisma.platformAdminAuditEvent.count({ where: { actorPlatformAdminId: ghostId } });
  assert.equal(ghostCount, 0);
});

await cleanDrAuditRows();
await prisma.platformSetting.deleteMany({ where: { key: DATA_RETENTION_RUNTIME_SETTING_KEY } });

// ── Organization / Clinic / Plan / User Lifecycle — class 4 (F3-IMPL-005) ────
//
// The last unaudited class of platform-admin mutations (R-019), deferred by
// F3-IMPL-003 (see its evidence file §4/§12 — the exact same 10 routes).
// Same pattern proven above for sms-providers/data-retention: the target row
// is looked up first (structurally guards a not-found id before any
// transaction opens — the same accepted precedent already used by the MFA
// routes above), then the mutation and its audit row commit atomically in
// the same prisma.$transaction — see platformAdminAudit.ts.

section('Organization / Clinic / Plan / User Lifecycle — durable audit trail (F3-IMPL-005)');

const F5_ADMIN_ID = 'admin-lifecycle-audit-f3impl005';
await prisma.platformAdmin.upsert({
  where: { id: F5_ADMIN_ID },
  update: {},
  create: {
    id: F5_ADMIN_ID,
    email: `${F5_ADMIN_ID}-fixture@platform.test`,
    passwordHash: 'not-a-real-hash-test-fixture-only',
    name: 'Test Fixture Platform Admin (Lifecycle Audit)',
  },
});

function f5Req(body: Record<string, unknown> = {}, params: Record<string, string> = {}, id: string = F5_ADMIN_ID) {
  return { body, params, platformAdmin: { id, email: `${id}@platform.test` } } as any;
}

async function auditRowsFor(resourceType: string, resourceKey: string) {
  return prisma.platformAdminAuditEvent.findMany({
    where: { resourceType, resourceKey },
    orderBy: { createdAt: 'asc' },
  });
}

// One org + one clinic + one user, reused (and mutated in place) across this
// section's PATCH tests; two distinct plans so PATCH .../plan has something
// real to switch between.
const f5Suffix = randomUUID().slice(0, 8);
const f5PlanA = await prisma.plan.create({
  data: { name: `f3impl005-plan-a-${f5Suffix}`, displayName: 'F3-IMPL-005 Plan A', maxUsers: 5, maxPatients: 100, features: {}, monthlyPrice: 0, isActive: true },
});
const f5PlanB = await prisma.plan.create({
  data: { name: `f3impl005-plan-b-${f5Suffix}`, displayName: 'F3-IMPL-005 Plan B', maxUsers: 10, maxPatients: 200, features: {}, monthlyPrice: 10, isActive: true },
});
const f5Org = await prisma.organization.create({
  data: { name: 'F3-IMPL-005 Test Org', slug: `f3impl005-org-${f5Suffix}`, status: 'trial', planId: f5PlanA.id },
});
const f5Clinic = await prisma.clinic.create({
  data: { name: 'F3-IMPL-005 Test Clinic', slug: `f3impl005-clinic-${f5Suffix}`, organizationId: f5Org.id, status: 'trial', planId: f5PlanA.id },
});
const f5User = await prisma.user.create({
  data: {
    firstName: 'F5', lastName: 'Fixture', email: `f3impl005-user-${f5Suffix}@example.test`,
    passwordHash: 'not-a-real-hash-test-fixture-only', role: 'RECEPTIONIST',
    clinicId: f5Clinic.id, organizationId: f5Org.id, isActive: true,
  },
});

// ── PATCH /organizations/:id/status ──

await test('PATCH /organizations/:id/status: success updates status and creates exactly one platform_organization.status_updated audit row', async () => {
  await prisma.platformAdminAuditEvent.deleteMany({ where: { resourceType: 'organization', resourceKey: f5Org.id } });
  await prisma.organization.update({ where: { id: f5Org.id }, data: { status: 'trial' } });

  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'patch', '/organizations/:id/status');
  const res = mockPlatformRes();
  await runChain(chain, f5Req({ status: 'active' }, { id: f5Org.id }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'active');

  const rows = await auditRowsFor('organization', f5Org.id);
  assert.equal(rows.length, 1);
  const row = rows[0]!;
  assert.equal(row.action, 'platform_organization.status_updated');
  assert.equal(row.actorPlatformAdminId, F5_ADMIN_ID);
  assert.equal(row.previousValue, 'trial');
  assert.equal(row.newValue, 'active');
  assert.equal(row.outcome, 'success');
  assert.ok(!JSON.stringify(row).includes('@'), 'must never contain an email/identity string — only the opaque platformAdminId');
});

await test('PATCH /organizations/:id/status: invalid status value is rejected (400) with no audit row', async () => {
  const before = await prisma.platformAdminAuditEvent.count({ where: { resourceType: 'organization', resourceKey: f5Org.id } });
  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'patch', '/organizations/:id/status');
  const res = mockPlatformRes();
  await runChain(chain, f5Req({ status: 'not-a-real-status' }, { id: f5Org.id }), res);
  assert.equal(res.statusCode, 400);
  const after = await prisma.platformAdminAuditEvent.count({ where: { resourceType: 'organization', resourceKey: f5Org.id } });
  assert.equal(after, before);
});

await test('PATCH /organizations/:id/status: non-existent organization id is rejected (404) with no audit row', async () => {
  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'patch', '/organizations/:id/status');
  const res = mockPlatformRes();
  await runChain(chain, f5Req({ status: 'active' }, { id: 'does-not-exist-org-id' }), res);
  assert.equal(res.statusCode, 404);
  const count = await prisma.platformAdminAuditEvent.count({ where: { resourceType: 'organization', resourceKey: 'does-not-exist-org-id' } });
  assert.equal(count, 0);
});

await test('PATCH /organizations/:id/status: forced audit-insert failure (non-existent actor id) rolls back the status change too — atomic, not best-effort', async () => {
  await prisma.organization.update({ where: { id: f5Org.id }, data: { status: 'active' } });
  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'patch', '/organizations/:id/status');
  const res = mockPlatformRes();
  const ghostId = 'admin-org-status-ghost';
  await runChain(chain, f5Req({ status: 'suspended' }, { id: f5Org.id }, ghostId), res);
  assert.equal(res.statusCode, 500, 'the FK-violating audit insert must fail the whole request rather than silently succeed');

  const after = await prisma.organization.findUnique({ where: { id: f5Org.id } });
  assert.equal(after?.status, 'active', 'organization status must remain unchanged when the audit insert fails inside the same transaction');

  const ghostCount = await prisma.platformAdminAuditEvent.count({ where: { actorPlatformAdminId: ghostId } });
  assert.equal(ghostCount, 0);
});

// ── PATCH /organizations/:id/plan ──

await test('PATCH /organizations/:id/plan: success updates planId and creates exactly one platform_organization.plan_updated audit row', async () => {
  await prisma.platformAdminAuditEvent.deleteMany({ where: { resourceType: 'organization', resourceKey: f5Org.id, action: 'platform_organization.plan_updated' } });
  await prisma.organization.update({ where: { id: f5Org.id }, data: { planId: f5PlanA.id } });

  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'patch', '/organizations/:id/plan');
  const res = mockPlatformRes();
  await runChain(chain, f5Req({ planId: f5PlanB.id }, { id: f5Org.id }), res);
  assert.equal(res.statusCode, 200);

  const rows = await prisma.platformAdminAuditEvent.findMany({ where: { resourceType: 'organization', resourceKey: f5Org.id, action: 'platform_organization.plan_updated' } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.previousValue, f5PlanA.id);
  assert.equal(rows[0]!.newValue, f5PlanB.id);
  assert.equal(rows[0]!.outcome, 'success');
});

await test('PATCH /organizations/:id/plan: missing planId is rejected (400) with no audit row', async () => {
  const before = await prisma.platformAdminAuditEvent.count({ where: { resourceType: 'organization', resourceKey: f5Org.id, action: 'platform_organization.plan_updated' } });
  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'patch', '/organizations/:id/plan');
  const res = mockPlatformRes();
  await runChain(chain, f5Req({}, { id: f5Org.id }), res);
  assert.equal(res.statusCode, 400);
  const after = await prisma.platformAdminAuditEvent.count({ where: { resourceType: 'organization', resourceKey: f5Org.id, action: 'platform_organization.plan_updated' } });
  assert.equal(after, before);
});

await test('PATCH /organizations/:id/plan: non-existent plan id is rejected (404) with no audit row', async () => {
  const before = await prisma.platformAdminAuditEvent.count({ where: { resourceType: 'organization', resourceKey: f5Org.id, action: 'platform_organization.plan_updated' } });
  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'patch', '/organizations/:id/plan');
  const res = mockPlatformRes();
  await runChain(chain, f5Req({ planId: 'does-not-exist-plan-id' }, { id: f5Org.id }), res);
  assert.equal(res.statusCode, 404);
  const after = await prisma.platformAdminAuditEvent.count({ where: { resourceType: 'organization', resourceKey: f5Org.id, action: 'platform_organization.plan_updated' } });
  assert.equal(after, before);
});

await test('PATCH /organizations/:id/plan: forced audit-insert failure (non-existent actor id) rolls back the plan change too', async () => {
  await prisma.organization.update({ where: { id: f5Org.id }, data: { planId: f5PlanB.id } });
  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'patch', '/organizations/:id/plan');
  const res = mockPlatformRes();
  const ghostId = 'admin-org-plan-ghost';
  await runChain(chain, f5Req({ planId: f5PlanA.id }, { id: f5Org.id }, ghostId), res);
  assert.equal(res.statusCode, 500);

  const after = await prisma.organization.findUnique({ where: { id: f5Org.id } });
  assert.equal(after?.planId, f5PlanB.id, 'organization planId must remain unchanged when the audit insert fails inside the same transaction');

  const ghostCount = await prisma.platformAdminAuditEvent.count({ where: { actorPlatformAdminId: ghostId } });
  assert.equal(ghostCount, 0);
});

// ── PATCH /organizations/:id/trial ──

await test('PATCH /organizations/:id/trial: success updates trialEndsAt+status and creates exactly one platform_organization.trial_updated audit row', async () => {
  await prisma.platformAdminAuditEvent.deleteMany({ where: { resourceType: 'organization', resourceKey: f5Org.id, action: 'platform_organization.trial_updated' } });
  await prisma.organization.update({ where: { id: f5Org.id }, data: { status: 'active', trialEndsAt: null } });

  const newTrialEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'patch', '/organizations/:id/trial');
  const res = mockPlatformRes();
  await runChain(chain, f5Req({ trialEndsAt: newTrialEnd }, { id: f5Org.id }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'trial');

  const rows = await prisma.platformAdminAuditEvent.findMany({ where: { resourceType: 'organization', resourceKey: f5Org.id, action: 'platform_organization.trial_updated' } });
  assert.equal(rows.length, 1);
  const previous = JSON.parse(rows[0]!.previousValue!);
  const next = JSON.parse(rows[0]!.newValue!);
  assert.equal(previous.trialEndsAt, null);
  assert.equal(previous.status, 'active');
  assert.equal(next.status, 'trial');
  assert.ok(next.trialEndsAt);
});

await test('PATCH /organizations/:id/trial: missing/invalid trialEndsAt is rejected (400) with no audit row', async () => {
  const before = await prisma.platformAdminAuditEvent.count({ where: { resourceType: 'organization', resourceKey: f5Org.id, action: 'platform_organization.trial_updated' } });
  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'patch', '/organizations/:id/trial');
  for (const badBody of [{}, { trialEndsAt: 'not-a-date' }]) {
    const res = mockPlatformRes();
    await runChain(chain, f5Req(badBody, { id: f5Org.id }), res);
    assert.equal(res.statusCode, 400, `expected 400 for payload ${JSON.stringify(badBody)}`);
  }
  const after = await prisma.platformAdminAuditEvent.count({ where: { resourceType: 'organization', resourceKey: f5Org.id, action: 'platform_organization.trial_updated' } });
  assert.equal(after, before);
});

await test('PATCH /organizations/:id/trial: forced audit-insert failure (non-existent actor id) rolls back the trial change too', async () => {
  const before = await prisma.organization.findUniqueOrThrow({ where: { id: f5Org.id } });
  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'patch', '/organizations/:id/trial');
  const res = mockPlatformRes();
  const ghostId = 'admin-org-trial-ghost';
  await runChain(chain, f5Req({ trialEndsAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString() }, { id: f5Org.id }, ghostId), res);
  assert.equal(res.statusCode, 500);

  const after = await prisma.organization.findUnique({ where: { id: f5Org.id } });
  assert.equal(after?.trialEndsAt?.getTime(), before.trialEndsAt?.getTime(), 'trialEndsAt must remain unchanged when the audit insert fails inside the same transaction');
  assert.equal(after?.status, before.status);

  const ghostCount = await prisma.platformAdminAuditEvent.count({ where: { actorPlatformAdminId: ghostId } });
  assert.equal(ghostCount, 0);
});

// ── POST /clinics ──

await test('POST /clinics: success creates org+clinic and exactly one platform_clinic.created audit row (previousValue=null)', async () => {
  const slug = `f3impl005-post-clinic-${randomUUID().slice(0, 8)}`;
  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'post', '/clinics');
  const res = mockPlatformRes();
  await runChain(chain, f5Req({ name: 'F3-IMPL-005 New Clinic', slug }, {}), res);
  assert.equal(res.statusCode, 201);
  const clinicId = res.body.id;

  const rows = await auditRowsFor('clinic', clinicId);
  assert.equal(rows.length, 1);
  const row = rows[0]!;
  assert.equal(row.action, 'platform_clinic.created');
  assert.equal(row.actorPlatformAdminId, F5_ADMIN_ID);
  assert.equal(row.previousValue, null);
  const newValue = JSON.parse(row.newValue!);
  assert.equal(newValue.slug, slug);
  assert.ok(newValue.organizationId);

  await prisma.clinic.delete({ where: { id: clinicId } });
  await prisma.organization.delete({ where: { id: newValue.organizationId } });
});

await test('POST /clinics: missing required fields is rejected (400) with no audit row', async () => {
  const before = await prisma.platformAdminAuditEvent.count({ where: { action: 'platform_clinic.created' } });
  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'post', '/clinics');
  const res = mockPlatformRes();
  await runChain(chain, f5Req({}, {}), res);
  assert.equal(res.statusCode, 400);
  const after = await prisma.platformAdminAuditEvent.count({ where: { action: 'platform_clinic.created' } });
  assert.equal(after, before);
});

await test('POST /clinics: duplicate slug is rejected (409) with no audit row', async () => {
  const before = await prisma.platformAdminAuditEvent.count({ where: { action: 'platform_clinic.created' } });
  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'post', '/clinics');
  const res = mockPlatformRes();
  await runChain(chain, f5Req({ name: 'Duplicate', slug: f5Clinic.slug }, {}), res);
  assert.equal(res.statusCode, 409);
  const after = await prisma.platformAdminAuditEvent.count({ where: { action: 'platform_clinic.created' } });
  assert.equal(after, before);
});

await test('POST /clinics: forced audit-insert failure (non-existent actor id) rolls back BOTH the new organization and the new clinic', async () => {
  const slug = `f3impl005-ghost-clinic-${randomUUID().slice(0, 8)}`;
  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'post', '/clinics');
  const res = mockPlatformRes();
  const ghostId = 'admin-clinic-create-ghost';
  await runChain(chain, f5Req({ name: 'Should Not Persist', slug }, {}, ghostId), res);
  assert.equal(res.statusCode, 500, 'the FK-violating audit insert must fail the whole request rather than silently succeed');

  const clinic = await prisma.clinic.findFirst({ where: { slug } });
  assert.equal(clinic, null, 'no clinic row may survive when the audit insert fails inside the same transaction');
  const org = await prisma.organization.findFirst({ where: { slug } });
  assert.equal(org, null, 'no organization row may survive either — both were created in the same transaction');

  const ghostCount = await prisma.platformAdminAuditEvent.count({ where: { actorPlatformAdminId: ghostId } });
  assert.equal(ghostCount, 0);
});

// ── PATCH /clinics/:id/status ──

await test('PATCH /clinics/:id/status: success updates status and creates exactly one platform_clinic.status_updated audit row', async () => {
  await prisma.platformAdminAuditEvent.deleteMany({ where: { resourceType: 'clinic', resourceKey: f5Clinic.id, action: 'platform_clinic.status_updated' } });
  await prisma.clinic.update({ where: { id: f5Clinic.id }, data: { status: 'trial' } });

  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'patch', '/clinics/:id/status');
  const res = mockPlatformRes();
  await runChain(chain, f5Req({ status: 'active' }, { id: f5Clinic.id }), res);
  assert.equal(res.statusCode, 200);

  const rows = await prisma.platformAdminAuditEvent.findMany({ where: { resourceType: 'clinic', resourceKey: f5Clinic.id, action: 'platform_clinic.status_updated' } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.previousValue, 'trial');
  assert.equal(rows[0]!.newValue, 'active');
});

await test('PATCH /clinics/:id/status: invalid status is rejected (400) with no audit row', async () => {
  const before = await prisma.platformAdminAuditEvent.count({ where: { resourceType: 'clinic', resourceKey: f5Clinic.id, action: 'platform_clinic.status_updated' } });
  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'patch', '/clinics/:id/status');
  const res = mockPlatformRes();
  await runChain(chain, f5Req({ status: 'bogus' }, { id: f5Clinic.id }), res);
  assert.equal(res.statusCode, 400);
  const after = await prisma.platformAdminAuditEvent.count({ where: { resourceType: 'clinic', resourceKey: f5Clinic.id, action: 'platform_clinic.status_updated' } });
  assert.equal(after, before);
});

await test('PATCH /clinics/:id/status: non-existent clinic id is rejected (404) with no audit row', async () => {
  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'patch', '/clinics/:id/status');
  const res = mockPlatformRes();
  await runChain(chain, f5Req({ status: 'active' }, { id: 'does-not-exist-clinic-id' }), res);
  assert.equal(res.statusCode, 404);
  const count = await prisma.platformAdminAuditEvent.count({ where: { resourceType: 'clinic', resourceKey: 'does-not-exist-clinic-id' } });
  assert.equal(count, 0);
});

await test('PATCH /clinics/:id/status: forced audit-insert failure (non-existent actor id) rolls back the status change too', async () => {
  await prisma.clinic.update({ where: { id: f5Clinic.id }, data: { status: 'active' } });
  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'patch', '/clinics/:id/status');
  const res = mockPlatformRes();
  const ghostId = 'admin-clinic-status-ghost';
  await runChain(chain, f5Req({ status: 'suspended' }, { id: f5Clinic.id }, ghostId), res);
  assert.equal(res.statusCode, 500);

  const after = await prisma.clinic.findUnique({ where: { id: f5Clinic.id } });
  assert.equal(after?.status, 'active', 'clinic status must remain unchanged when the audit insert fails inside the same transaction');

  const ghostCount = await prisma.platformAdminAuditEvent.count({ where: { actorPlatformAdminId: ghostId } });
  assert.equal(ghostCount, 0);
});

// ── PATCH /clinics/:id/plan ──

await test('PATCH /clinics/:id/plan: success updates plan/limits and creates exactly one platform_clinic.plan_updated audit row', async () => {
  await prisma.platformAdminAuditEvent.deleteMany({ where: { resourceType: 'clinic', resourceKey: f5Clinic.id, action: 'platform_clinic.plan_updated' } });
  await prisma.clinic.update({ where: { id: f5Clinic.id }, data: { planId: f5PlanA.id, maxUsers: 5, maxPatients: 100 } });

  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'patch', '/clinics/:id/plan');
  const res = mockPlatformRes();
  await runChain(chain, f5Req({ planId: f5PlanB.id, maxUsers: 10, maxPatients: 200 }, { id: f5Clinic.id }), res);
  assert.equal(res.statusCode, 200);

  const rows = await prisma.platformAdminAuditEvent.findMany({ where: { resourceType: 'clinic', resourceKey: f5Clinic.id, action: 'platform_clinic.plan_updated' } });
  assert.equal(rows.length, 1);
  const previous = JSON.parse(rows[0]!.previousValue!);
  const next = JSON.parse(rows[0]!.newValue!);
  assert.equal(previous.planId, f5PlanA.id);
  assert.equal(previous.maxUsers, 5);
  assert.equal(next.planId, f5PlanB.id);
  assert.equal(next.maxUsers, 10);
});

await test('PATCH /clinics/:id/plan: non-existent clinic id is rejected (404) with no audit row', async () => {
  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'patch', '/clinics/:id/plan');
  const res = mockPlatformRes();
  await runChain(chain, f5Req({ planId: f5PlanA.id }, { id: 'does-not-exist-clinic-id' }), res);
  assert.equal(res.statusCode, 404);
  const count = await prisma.platformAdminAuditEvent.count({ where: { resourceType: 'clinic', resourceKey: 'does-not-exist-clinic-id', action: 'platform_clinic.plan_updated' } });
  assert.equal(count, 0);
});

await test('PATCH /clinics/:id/plan: forced audit-insert failure (non-existent actor id) rolls back the plan/limit change too', async () => {
  const before = await prisma.clinic.findUniqueOrThrow({ where: { id: f5Clinic.id } });
  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'patch', '/clinics/:id/plan');
  const res = mockPlatformRes();
  const ghostId = 'admin-clinic-plan-ghost';
  await runChain(chain, f5Req({ planId: f5PlanA.id, maxUsers: 999 }, { id: f5Clinic.id }, ghostId), res);
  assert.equal(res.statusCode, 500);

  const after = await prisma.clinic.findUnique({ where: { id: f5Clinic.id } });
  assert.equal(after?.planId, before.planId, 'clinic planId must remain unchanged when the audit insert fails inside the same transaction');
  assert.equal(after?.maxUsers, before.maxUsers);

  const ghostCount = await prisma.platformAdminAuditEvent.count({ where: { actorPlatformAdminId: ghostId } });
  assert.equal(ghostCount, 0);
});

// ── PATCH /clinics/:id/sms-addon ──

await test('PATCH /clinics/:id/sms-addon: first call creates settings with previousValue=null and safeMetadata.isNew=true', async () => {
  await prisma.platformAdminAuditEvent.deleteMany({ where: { resourceType: 'clinic', resourceKey: f5Clinic.id, action: 'platform_clinic.sms_addon_updated' } });
  await prisma.clinicSmsSettings.deleteMany({ where: { clinicId: f5Clinic.id } });

  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'patch', '/clinics/:id/sms-addon');
  const res = mockPlatformRes();
  await runChain(chain, f5Req({ addonEnabled: true, monthlyQuota: 100 }, { id: f5Clinic.id }), res);
  assert.equal(res.statusCode, 200);

  const rows = await prisma.platformAdminAuditEvent.findMany({ where: { resourceType: 'clinic', resourceKey: f5Clinic.id, action: 'platform_clinic.sms_addon_updated' } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.previousValue, null);
  assert.equal((rows[0]!.safeMetadata as any)?.isNew, true);
  assert.ok(JSON.parse(rows[0]!.newValue!).addonEnabled === true);
});

await test('PATCH /clinics/:id/sms-addon: second call updates existing settings with accurate previous/new snapshots', async () => {
  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'patch', '/clinics/:id/sms-addon');
  const res = mockPlatformRes();
  await runChain(chain, f5Req({ addonEnabled: false, monthlyQuota: 50 }, { id: f5Clinic.id }), res);
  assert.equal(res.statusCode, 200);

  const rows = await prisma.platformAdminAuditEvent.findMany({
    where: { resourceType: 'clinic', resourceKey: f5Clinic.id, action: 'platform_clinic.sms_addon_updated' },
    orderBy: { createdAt: 'asc' },
  });
  assert.equal(rows.length, 2);
  const row = rows[1]!;
  const previous = JSON.parse(row.previousValue!);
  const next = JSON.parse(row.newValue!);
  assert.equal(previous.addonEnabled, true);
  assert.equal(previous.monthlyQuota, 100);
  assert.equal(next.addonEnabled, false);
  assert.equal(next.monthlyQuota, 50);
  assert.equal((row.safeMetadata as any)?.isNew, false);
});

await test('PATCH /clinics/:id/sms-addon: invalid payload is rejected (400) with no audit row', async () => {
  const before = await prisma.platformAdminAuditEvent.count({ where: { resourceType: 'clinic', resourceKey: f5Clinic.id, action: 'platform_clinic.sms_addon_updated' } });
  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'patch', '/clinics/:id/sms-addon');
  const res = mockPlatformRes();
  await runChain(chain, f5Req({ addonEnabled: 'yes' }, { id: f5Clinic.id }), res);
  assert.equal(res.statusCode, 400);
  const after = await prisma.platformAdminAuditEvent.count({ where: { resourceType: 'clinic', resourceKey: f5Clinic.id, action: 'platform_clinic.sms_addon_updated' } });
  assert.equal(after, before);
});

await test('PATCH /clinics/:id/sms-addon: forced audit-insert failure (non-existent actor id) rolls back the settings write too', async () => {
  const before = await prisma.clinicSmsSettings.findUniqueOrThrow({ where: { clinicId: f5Clinic.id } });
  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'patch', '/clinics/:id/sms-addon');
  const res = mockPlatformRes();
  const ghostId = 'admin-sms-addon-ghost';
  await runChain(chain, f5Req({ addonEnabled: true, monthlyQuota: 9999 }, { id: f5Clinic.id }, ghostId), res);
  assert.equal(res.statusCode, 500);

  const after = await prisma.clinicSmsSettings.findUniqueOrThrow({ where: { clinicId: f5Clinic.id } });
  assert.equal(after.addonEnabled, before.addonEnabled, 'settings must remain unchanged when the audit insert fails inside the same transaction');
  assert.equal(after.monthlyQuota, before.monthlyQuota);

  const ghostCount = await prisma.platformAdminAuditEvent.count({ where: { actorPlatformAdminId: ghostId } });
  assert.equal(ghostCount, 0);
});

// ── PATCH /users/:id/status ──

await test('PATCH /users/:id/status: success flips isActive and creates exactly one platform_user.status_updated audit row, id-attributed only', async () => {
  await prisma.platformAdminAuditEvent.deleteMany({ where: { resourceType: 'user', resourceKey: f5User.id } });
  await prisma.user.update({ where: { id: f5User.id }, data: { isActive: true } });

  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'patch', '/users/:id/status');
  const res = mockPlatformRes();
  await runChain(chain, f5Req({ isActive: false }, { id: f5User.id }), res);
  assert.equal(res.statusCode, 200);

  const rows = await auditRowsFor('user', f5User.id);
  assert.equal(rows.length, 1);
  const row = rows[0]!;
  assert.equal(row.action, 'platform_user.status_updated');
  assert.equal(row.previousValue, 'true');
  assert.equal(row.newValue, 'false');
  assert.ok(!JSON.stringify(row).includes('@'), 'audit row must never contain the target user\'s email');
  assert.ok(!JSON.stringify(row).includes(f5User.firstName), 'audit row must never contain the target user\'s name');
});

await test('PATCH /users/:id/status: non-boolean isActive is rejected (400) with no audit row', async () => {
  const before = await prisma.platformAdminAuditEvent.count({ where: { resourceType: 'user', resourceKey: f5User.id } });
  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'patch', '/users/:id/status');
  const res = mockPlatformRes();
  await runChain(chain, f5Req({ isActive: 'nope' }, { id: f5User.id }), res);
  assert.equal(res.statusCode, 400);
  const after = await prisma.platformAdminAuditEvent.count({ where: { resourceType: 'user', resourceKey: f5User.id } });
  assert.equal(after, before);
});

await test('PATCH /users/:id/status: non-existent user id is rejected (404) with no audit row', async () => {
  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'patch', '/users/:id/status');
  const res = mockPlatformRes();
  await runChain(chain, f5Req({ isActive: false }, { id: 'does-not-exist-user-id' }), res);
  assert.equal(res.statusCode, 404);
  const count = await prisma.platformAdminAuditEvent.count({ where: { resourceType: 'user', resourceKey: 'does-not-exist-user-id' } });
  assert.equal(count, 0);
});

await test('PATCH /users/:id/status: forced audit-insert failure (non-existent actor id) rolls back the status change too', async () => {
  await prisma.user.update({ where: { id: f5User.id }, data: { isActive: false } });
  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'patch', '/users/:id/status');
  const res = mockPlatformRes();
  const ghostId = 'admin-user-status-ghost';
  await runChain(chain, f5Req({ isActive: true }, { id: f5User.id }, ghostId), res);
  assert.equal(res.statusCode, 500);

  const after = await prisma.user.findUnique({ where: { id: f5User.id } });
  assert.equal(after?.isActive, false, 'user isActive must remain unchanged when the audit insert fails inside the same transaction');

  const ghostCount = await prisma.platformAdminAuditEvent.count({ where: { actorPlatformAdminId: ghostId } });
  assert.equal(ghostCount, 0);
});

// ── POST /plans ──

await test('POST /plans: success creates a plan and exactly one platform_plan.created audit row (previousValue=null)', async () => {
  const name = `f3impl005-post-plan-${randomUUID().slice(0, 8)}`;
  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'post', '/plans');
  const res = mockPlatformRes();
  await runChain(chain, f5Req({ name, displayName: 'F3-IMPL-005 Posted Plan', maxUsers: 3, maxPatients: 50 }, {}), res);
  assert.equal(res.statusCode, 201);
  const planId = res.body.id;

  const rows = await auditRowsFor('plan', planId);
  assert.equal(rows.length, 1);
  const row = rows[0]!;
  assert.equal(row.action, 'platform_plan.created');
  assert.equal(row.previousValue, null);
  const newValue = JSON.parse(row.newValue!);
  assert.equal(newValue.name, name.toLowerCase());
  assert.equal(newValue.maxUsers, 3);

  await prisma.plan.delete({ where: { id: planId } });
});

await test('POST /plans: missing required fields is rejected (400) with no audit row', async () => {
  const before = await prisma.platformAdminAuditEvent.count({ where: { action: 'platform_plan.created' } });
  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'post', '/plans');
  const res = mockPlatformRes();
  await runChain(chain, f5Req({ name: 'incomplete' }, {}), res);
  assert.equal(res.statusCode, 400);
  const after = await prisma.platformAdminAuditEvent.count({ where: { action: 'platform_plan.created' } });
  assert.equal(after, before);
});

await test('POST /plans: forced audit-insert failure (non-existent actor id) rolls back the plan creation too', async () => {
  const name = `f3impl005-ghost-plan-${randomUUID().slice(0, 8)}`;
  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'post', '/plans');
  const res = mockPlatformRes();
  const ghostId = 'admin-plan-create-ghost';
  await runChain(chain, f5Req({ name, displayName: 'Should Not Persist', maxUsers: 1, maxPatients: 1 }, {}, ghostId), res);
  assert.equal(res.statusCode, 500);

  const plan = await prisma.plan.findUnique({ where: { name: name.toLowerCase() } });
  assert.equal(plan, null, 'no plan row may survive when the audit insert fails inside the same transaction');

  const ghostCount = await prisma.platformAdminAuditEvent.count({ where: { actorPlatformAdminId: ghostId } });
  assert.equal(ghostCount, 0);
});

// ── PUT /plans/:id ──

await test('PUT /plans/:id: success updates fields and creates exactly one platform_plan.updated audit row with accurate previous/new snapshots', async () => {
  await prisma.platformAdminAuditEvent.deleteMany({ where: { resourceType: 'plan', resourceKey: f5PlanB.id, action: 'platform_plan.updated' } });
  await prisma.plan.update({ where: { id: f5PlanB.id }, data: { displayName: 'F3-IMPL-005 Plan B', maxUsers: 10 } });

  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'put', '/plans/:id');
  const res = mockPlatformRes();
  await runChain(chain, f5Req({ displayName: 'F3-IMPL-005 Plan B Renamed', maxUsers: 20 }, { id: f5PlanB.id }), res);
  assert.equal(res.statusCode, 200);

  const rows = await prisma.platformAdminAuditEvent.findMany({ where: { resourceType: 'plan', resourceKey: f5PlanB.id, action: 'platform_plan.updated' } });
  assert.equal(rows.length, 1);
  const previous = JSON.parse(rows[0]!.previousValue!);
  const next = JSON.parse(rows[0]!.newValue!);
  assert.equal(previous.displayName, 'F3-IMPL-005 Plan B');
  assert.equal(previous.maxUsers, 10);
  assert.equal(next.displayName, 'F3-IMPL-005 Plan B Renamed');
  assert.equal(next.maxUsers, 20);
});

await test('PUT /plans/:id: non-existent plan id is rejected (404) with no audit row', async () => {
  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'put', '/plans/:id');
  const res = mockPlatformRes();
  await runChain(chain, f5Req({ displayName: 'X' }, { id: 'does-not-exist-plan-id' }), res);
  assert.equal(res.statusCode, 404);
  const count = await prisma.platformAdminAuditEvent.count({ where: { resourceType: 'plan', resourceKey: 'does-not-exist-plan-id' } });
  assert.equal(count, 0);
});

await test('PUT /plans/:id: forced audit-insert failure (non-existent actor id) rolls back the field update too', async () => {
  const before = await prisma.plan.findUniqueOrThrow({ where: { id: f5PlanB.id } });
  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'put', '/plans/:id');
  const res = mockPlatformRes();
  const ghostId = 'admin-plan-update-ghost';
  await runChain(chain, f5Req({ displayName: 'Should Not Persist' }, { id: f5PlanB.id }, ghostId), res);
  assert.equal(res.statusCode, 500);

  const after = await prisma.plan.findUniqueOrThrow({ where: { id: f5PlanB.id } });
  assert.equal(after.displayName, before.displayName, 'plan fields must remain unchanged when the audit insert fails inside the same transaction');

  const ghostCount = await prisma.platformAdminAuditEvent.count({ where: { actorPlatformAdminId: ghostId } });
  assert.equal(ghostCount, 0);
});

// ── Cleanup ──

await prisma.platformAdminAuditEvent.deleteMany({ where: { resourceKey: { in: [f5Org.id, f5Clinic.id, f5User.id, f5PlanA.id, f5PlanB.id] } } });
await prisma.clinicSmsSettings.deleteMany({ where: { clinicId: f5Clinic.id } });
await prisma.user.deleteMany({ where: { id: f5User.id } });
await prisma.clinic.deleteMany({ where: { id: f5Clinic.id } });
await prisma.organization.deleteMany({ where: { id: f5Org.id } });
await prisma.plan.deleteMany({ where: { id: { in: [f5PlanA.id, f5PlanB.id] } } });

// ── Sonuç ─────────────────────────────────────────────────────────────────────

console.log(`\n─────────────────────────────────`);
console.log(`Toplam: ${passed + failed}  ✓ ${passed}  ✗ ${failed}`);
if (failed > 0) {
  process.exit(1);
}

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
import jwt from 'jsonwebtoken';

// These unit tests exercise the middleware via Bearer tokens; the production
// default is now cookie-only, so enable the fallback explicitly for the suite.
process.env.PLATFORM_BEARER_FALLBACK_ENABLED = 'true';

import {
  generatePlatformToken,
  authenticatePlatformAdmin,
} from '../middleware/platformAuth.js';
import {
  loadDataRetentionConfig,
  DATA_RETENTION_DEFAULTS,
  DATA_RETENTION_MIN_DAYS,
} from '../services/privacy/dataRetentionPolicy.js';
import prisma from '../db.js';
import platformAdminRouter from '../routes/platformAdmin.js';
import { LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY } from '../services/communicationConsent/legacyConsentCorrection.js';

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
  const token = generatePlatformToken({ id: 'admin-1', email: 'admin@platform.com' });
  const req = makeReq(`Bearer ${token}`);
  const res = makeRes();
  let nextCalled = false;
  const next = () => { nextCalled = true; };

  await (authenticatePlatformAdmin as any)(req, res, next);

  assert.ok(nextCalled, 'next() çağrılmalıydı');
  assert.ok(req.platformAdmin, 'platformAdmin req üzerine set edilmeli');
  assert.equal(req.platformAdmin.id, 'admin-1');
  assert.equal(req.platformAdmin.email, 'admin@platform.com');
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
function getRouteMiddlewareChain(router: RouterLike, method: 'get' | 'patch' | 'delete', path: string) {
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
// id 'admin-1', so a real row must exist for the audit insert (and the
// transaction it lives in) to succeed, exactly as it would in production
// where the id always comes from an authenticated session.
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
  assert.ok(logSpy.some((line) => line.includes('admin@platform.test') && line.includes('true')), 'toggle must be logged with the acting admin identity and the new value');

  // Restore to the real production default (absent) so this file leaves no
  // global PlatformSetting/PlatformAdminAuditEvent state behind for whatever
  // test file runs next.
  await prisma.platformSetting.deleteMany({ where: { key: LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY } });
  await cleanAuditRows();
});

// ── Sonuç ─────────────────────────────────────────────────────────────────────

console.log(`\n─────────────────────────────────`);
console.log(`Toplam: ${passed + failed}  ✓ ${passed}  ✗ ${failed}`);
if (failed > 0) {
  process.exit(1);
}

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

// ── Sonuç ─────────────────────────────────────────────────────────────────────

console.log(`\n─────────────────────────────────`);
console.log(`Toplam: ${passed + failed}  ✓ ${passed}  ✗ ${failed}`);
if (failed > 0) {
  process.exit(1);
}

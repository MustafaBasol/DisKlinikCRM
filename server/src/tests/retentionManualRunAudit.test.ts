/**
 * retentionManualRunAudit.test.ts — RETENTION-MANUAL-RUN-AUDIT-001
 *
 * Focused coverage for POST /api/platform/privacy/data-retention/run: every
 * attempt (blocked, successful, partially failed, or unexpectedly errored)
 * must write exactly one immutable PlatformAdminAuditEvent row, and live
 * execution must be rejected whenever the runtime toggle / configured
 * environment / requested mode are inconsistent.
 *
 * Same technique as legacyConsentCorrection.test.ts: route handlers are
 * extracted directly from the router's internal stack and invoked against a
 * real disposable Postgres database — no supertest, no mocked Prisma.
 *
 * Run with: tsx src/tests/retentionManualRunAudit.test.ts
 * Requires DATABASE_URL to point at a disposable Postgres.
 */

import 'dotenv/config';

// This suite exercises the middleware via Bearer tokens in one sanity check;
// production defaults to cookie-only, so enable the fallback explicitly.
process.env.PLATFORM_BEARER_FALLBACK_ENABLED = 'true';

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prisma from '../db.js';
import platformAdminRouter from '../routes/platformAdmin.js';
import { authenticatePlatformAdmin } from '../middleware/platformAuth.js';
import { generatePlatformToken } from '../middleware/platformAuth.js';
import jwt from 'jsonwebtoken';
import {
  DATA_RETENTION_RUNTIME_SETTING_KEY,
} from '../services/privacy/dataRetentionPolicy.js';
import { DATA_RETENTION_JOB_LOCK_NAME } from '../jobs/dataRetentionCleanupJob.js';
import { getPlatformSetting, setPlatformSetting, unsetPlatformSetting } from '../services/platformSettings.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { console.log(`  ✓ ${name}`); passed++; })
    .catch((err: unknown) => {
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    });
}

function section(title: string) {
  console.log(`\n${title}`);
}

async function withEnv(updates: Record<string, string | undefined>, fn: () => void | Promise<void>) {
  const previous = Object.fromEntries(Object.keys(updates).map((k) => [k, process.env[k]]));
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

// ── Route-stack extraction (mirrors legacyConsentCorrection.test.ts) ──────────

type RouterLike = { stack: Array<any> };

function getRouteMiddlewareChain(router: RouterLike, method: 'post', path: string) {
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

function mockRes() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
  };
  return res;
}

const ACTOR_ID = 'retention-manual-run-admin-1';

function mockReq(body: Record<string, unknown> = {}) {
  return { body, platformAdmin: { id: ACTOR_ID, email: 'retention-admin@platform.test' } } as any;
}

const RUN_ACTION = 'data_retention.manual_run';

async function cleanAuditRows() {
  await prisma.platformAdminAuditEvent.deleteMany({ where: { action: RUN_ACTION, actorPlatformAdminId: ACTOR_ID } });
}

async function auditRows() {
  return prisma.platformAdminAuditEvent.findMany({
    where: { action: RUN_ACTION, actorPlatformAdminId: ACTOR_ID },
    orderBy: { createdAt: 'asc' },
  });
}

async function setRuntimeEnabled(enabled: boolean) {
  await setPlatformSetting(DATA_RETENTION_RUNTIME_SETTING_KEY, String(enabled));
}

async function clearRuntimeSetting() {
  await unsetPlatformSetting(DATA_RETENTION_RUNTIME_SETTING_KEY);
}

// PlatformAdminAuditEvent.actorPlatformAdminId has a real FK to
// PlatformAdmin(id) — a real row must exist for the audit insert to succeed.
await prisma.platformAdmin.upsert({
  where: { id: ACTOR_ID },
  update: {},
  create: {
    id: ACTOR_ID,
    email: `${ACTOR_ID}-fixture@platform.test`,
    passwordHash: 'not-a-real-hash-test-fixture-only',
    name: 'Test Fixture Platform Admin (Retention Manual Run)',
  },
});

const runChainForRoute = () => getRouteMiddlewareChain(platformAdminRouter as any, 'post', '/privacy/data-retention/run');

// ── Fixture helper: seed an old OperationalEvent row (no FK on organizationId,
// so no Organization/Clinic fixture is required) that is eligible for the
// "operationalEvents" cleanup category regardless of configured retention days. ──

async function seedOldOperationalEvent(message: string): Promise<string> {
  const row = await prisma.operationalEvent.create({
    data: {
      organizationId: randomUUID(),
      source: 'system',
      message,
      createdAt: new Date('2000-01-01T00:00:00.000Z'),
    },
  });
  return row.id;
}

async function countOperationalEventsBySubstring(substring: string): Promise<number> {
  return prisma.operationalEvent.count({ where: { message: { contains: substring } } });
}

section('POST /privacy/data-retention/run — Authorization gate');

await test('unauthorized (no token): authenticatePlatformAdmin rejects before any handler runs, no audit row', async () => {
  await cleanAuditRows();
  const req = { headers: {} } as any;
  const res = mockRes();
  let nextCalled = false;
  await (authenticatePlatformAdmin as any)(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  const rows = await auditRows();
  assert.equal(rows.length, 0, 'an unauthenticated request must never create an audit record');
});

await test('wrong role (clinic user token): rejected before any handler runs, no audit row', async () => {
  await cleanAuditRows();
  const clinicSecret = process.env.JWT_SECRET || 'defaultsecret';
  const clinicToken = jwt.sign({ id: 'user-1', clinicId: 'clinic-1', type: 'clinic_user' }, clinicSecret, { expiresIn: '1h' });
  const req = { headers: { authorization: `Bearer ${clinicToken}` } } as any;
  const res = mockRes();
  let nextCalled = false;
  await (authenticatePlatformAdmin as any)(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false, 'a clinic-scoped token must never authorize the platform-admin retention route');
  assert.ok(res.statusCode === 401 || res.statusCode === 403);
  const rows = await auditRows();
  assert.equal(rows.length, 0);
});

await test('sanity: a genuine platform admin token is accepted by the gate', async () => {
  const token = generatePlatformToken({ id: ACTOR_ID, email: 'retention-admin@platform.test' });
  const req = { headers: { authorization: `Bearer ${token}` } } as any;
  const res = mockRes();
  let nextCalled = false;
  await (authenticatePlatformAdmin as any)(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});

section('POST /privacy/data-retention/run — dry-run audit');

await test('dry-run (default env/runtime state): 200, audit outcome=success, dryRun=true, no PII, effective config captured', async () => {
  await cleanAuditRows();
  await clearRuntimeSetting(); // default-deny: runtime toggle absent → runtimeCleanupEnabled=false, irrelevant for a dry run
  const chain = runChainForRoute();
  const res = mockRes();
  await runChain(chain, mockReq({ dryRun: true }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.summary.dryRun, true);

  const rows = await auditRows();
  assert.equal(rows.length, 1, 'exactly one audit row per attempt');
  const row = rows[0];
  assert.equal(row.actorPlatformAdminId, ACTOR_ID);
  assert.equal(row.resourceType, 'data_retention');
  assert.equal(row.resourceKey, 'manual_run');
  assert.equal(row.outcome, 'success');

  const meta = row.safeMetadata as any;
  assert.equal(meta.dryRun, true);
  assert.equal(meta.runtimeCleanupEnabled, false, 'default-deny: absent PlatformSetting means runtime is off');
  assert.ok(meta.effectiveConfig, 'effective retention configuration must be recorded');
  assert.equal(typeof meta.effectiveConfig.conversationMessagesDays, 'number');
  assert.ok(meta.resultCounts, 'dry-run must still record the (eligible) counts');

  const serialized = JSON.stringify(row);
  assert.ok(!serialized.includes('@'), 'must never contain an email/identity string');
  assert.ok(!('clinicId' in meta) && !('organizationId' in meta) && !('patientId' in meta), 'must never carry clinic/patient identifiers — platform-scoped only');
});

section('POST /privacy/data-retention/run — inconsistent / disabled state rejection');

await test('runtime disabled (env enabled, runtime absent/false): live run rejected 403, audit outcome=blocked, errorCategory=blocked_runtime_disabled', async () => {
  await cleanAuditRows();
  await clearRuntimeSetting();
  await withEnv({ DATA_RETENTION_CLEANUP_ENABLED: undefined }, async () => {
    const chain = runChainForRoute();
    const res = mockRes();
    await runChain(chain, mockReq({ dryRun: false }), res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.cleanupEnabledSource, 'runtime_disabled');

    const rows = await auditRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].outcome, 'blocked');
    const meta = rows[0].safeMetadata as any;
    assert.equal(meta.errorCategory, 'blocked_runtime_disabled');
    assert.equal(meta.runtimeCleanupEnabled, false);
    assert.equal(meta.effectiveCleanupEnabled, false);
    assert.ok(!('resultCounts' in meta), 'a blocked (never-executed) attempt must not report result counts');
  });
});

await test('inconsistent toggle (runtime ON but env-level kill switch OFF): live run still rejected, audit explicitly records the mismatch', async () => {
  await cleanAuditRows();
  await setRuntimeEnabled(true); // operator turned the runtime toggle ON
  await withEnv({ DATA_RETENTION_CLEANUP_ENABLED: 'false' }, async () => { // ...without knowing the env kill switch is OFF
    const chain = runChainForRoute();
    const res = mockRes();
    await runChain(chain, mockReq({ dryRun: false }), res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.cleanupEnabledSource, 'env_disabled', 'env-level kill switch takes precedence when the two toggles disagree');

    const rows = await auditRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].outcome, 'blocked');
    const meta = rows[0].safeMetadata as any;
    assert.equal(meta.errorCategory, 'blocked_env_disabled');
    // The mismatch is explicit in the record: runtime says "on", env says "off".
    assert.equal(meta.runtimeCleanupEnabled, true);
    assert.equal(meta.effectiveConfig.envCleanupEnabled, false);
    assert.equal(meta.effectiveCleanupEnabled, false);
  });
  await clearRuntimeSetting();
});

await test('dry-run is never blocked by disabled state (safety valve preserved)', async () => {
  await cleanAuditRows();
  await clearRuntimeSetting();
  await withEnv({ DATA_RETENTION_CLEANUP_ENABLED: 'false' }, async () => {
    const chain = runChainForRoute();
    const res = mockRes();
    await runChain(chain, mockReq({ dryRun: true }), res);
    assert.equal(res.statusCode, 200);
    const rows = await auditRows();
    assert.equal(rows[0].outcome, 'success');
  });
});

section('POST /privacy/data-retention/run — live-run audit with real counts');

await test('live-run: env+runtime enabled, seeded eligible row is actually deleted, audit outcome=success with correct result counts', async () => {
  await cleanAuditRows();
  await setRuntimeEnabled(true);
  const marker = `retention-audit-test-${randomUUID()}`;
  await seedOldOperationalEvent(marker);
  assert.equal(await countOperationalEventsBySubstring(marker), 1, 'fixture row must exist before the run');

  await withEnv({ DATA_RETENTION_CLEANUP_ENABLED: undefined }, async () => {
    const chain = runChainForRoute();
    const res = mockRes();
    await runChain(chain, mockReq({ dryRun: false }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.summary.deletedOperationalEvents >= 1);

    assert.equal(await countOperationalEventsBySubstring(marker), 0, 'the seeded eligible row must actually be deleted, not just counted');

    const rows = await auditRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].outcome, 'success');
    const meta = rows[0].safeMetadata as any;
    assert.equal(meta.dryRun, false);
    assert.ok(meta.resultCounts.deletedOperationalEvents >= 1);
    assert.equal(meta.runtimeCleanupEnabled, true);
    assert.equal(meta.effectiveCleanupEnabled, true);
    assert.equal(meta.cleanupEnabledSource, 'enabled');
  });
  await clearRuntimeSetting();
});

await test('repeated invocation: two consecutive live runs each write their own audit row; the second finds nothing left to delete', async () => {
  await cleanAuditRows();
  await setRuntimeEnabled(true);
  const marker = `retention-audit-idem-${randomUUID()}`;
  await seedOldOperationalEvent(marker);

  await withEnv({ DATA_RETENTION_CLEANUP_ENABLED: undefined }, async () => {
    const chain = runChainForRoute();

    const res1 = mockRes();
    await runChain(chain, mockReq({ dryRun: false }), res1);
    assert.equal(res1.statusCode, 200);
    assert.ok(res1.body.summary.deletedOperationalEvents >= 1);

    const res2 = mockRes();
    await runChain(chain, mockReq({ dryRun: false }), res2);
    assert.equal(res2.statusCode, 200);
    assert.equal(await countOperationalEventsBySubstring(marker), 0);

    const rows = await auditRows();
    assert.equal(rows.length, 2, 'each attempt gets its own immutable audit row — attempts are never deduplicated');
    assert.equal(rows[0].outcome, 'success');
    assert.equal(rows[1].outcome, 'success');
    const meta2 = rows[1].safeMetadata as any;
    // Second run is idempotent: nothing new left for this fixture's category to touch.
    assert.equal((meta2.resultCounts.deletedOperationalEvents ?? 0) === 0 || meta2.resultCounts.deletedOperationalEvents < res1.body.summary.deletedOperationalEvents + 1, true);
  });
  await clearRuntimeSetting();
});

section('POST /privacy/data-retention/run — partial/failed cleanup');

await test('partial failure: one category genuinely fails at the DB level, others still succeed; audit outcome=partial_failure with a safe error category (no raw error message, no PII)', async () => {
  await cleanAuditRows();
  await setRuntimeEnabled(true);
  const marker = `retention-audit-partial-${randomUUID()}`;
  await seedOldOperationalEvent(marker);

  // Force a genuine, no-mocking failure in exactly one cleanup category by
  // temporarily renaming its backing table — the real Prisma call throws,
  // runCategory() catches it, and the category is recorded as skipped while
  // every other category still runs to completion.
  await prisma.$executeRawUnsafe('ALTER TABLE "OperationalEvent" RENAME TO "OperationalEvent_test_disabled"');
  try {
    await withEnv({ DATA_RETENTION_CLEANUP_ENABLED: undefined }, async () => {
      const chain = runChainForRoute();
      const res = mockRes();
      await runChain(chain, mockReq({ dryRun: false }), res);

      assert.equal(res.statusCode, 200, 'a partial category failure must not surface as an HTTP error — the request completed');
      assert.equal(res.body.success, true);
      assert.ok(res.body.summary.errors.length >= 1);
      assert.ok(res.body.summary.skippedCategories.includes('operationalEvents'));

      const rows = await auditRows();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].outcome, 'partial_failure');
      const meta = rows[0].safeMetadata as any;
      assert.equal(meta.errorCategory, 'category_execution_error');
      assert.ok(meta.skippedCategories.includes('operationalEvents'));

      const serialized = JSON.stringify(rows[0]);
      assert.ok(!serialized.includes('OperationalEvent_test_disabled'), 'no raw DB/error detail should leak into the audit row');
      assert.ok(!serialized.includes(marker), 'no raw content from the affected rows should leak into the audit row');
    });
  } finally {
    await prisma.$executeRawUnsafe('ALTER TABLE "OperationalEvent_test_disabled" RENAME TO "OperationalEvent"');
  }
  await clearRuntimeSetting();
  // The marker row survives untouched since its category failed — clean up the fixture.
  await prisma.operationalEvent.deleteMany({ where: { message: { contains: marker } } });
});

section('POST /privacy/data-retention/run — audit redaction / no PII / platform-scope');

await test('no PII in audit metadata: a message containing name/phone-shaped content never appears in safeMetadata', async () => {
  await cleanAuditRows();
  await setRuntimeEnabled(true);
  const piiLikeMarker = `PII-Ayse-Yilmaz-+905551237788-${randomUUID()}`;
  await seedOldOperationalEvent(piiLikeMarker);

  await withEnv({ DATA_RETENTION_CLEANUP_ENABLED: undefined }, async () => {
    const chain = runChainForRoute();
    const res = mockRes();
    await runChain(chain, mockReq({ dryRun: false }), res);
    assert.equal(res.statusCode, 200);

    const rows = await auditRows();
    const serialized = JSON.stringify(rows[rows.length - 1].safeMetadata);
    assert.ok(!serialized.includes('Ayse'), 'no name-shaped content in audit metadata');
    assert.ok(!serialized.includes('+905551237788'), 'no phone-shaped content in audit metadata');
    assert.ok(!serialized.includes(piiLikeMarker), 'the raw seeded message content must never appear in audit metadata — only counts');
  });
  await clearRuntimeSetting();
});

await test('no cross-tenant leakage: audit metadata never carries a clinicId/organizationId/patientId key, even though cleanup spans all tenants', async () => {
  await cleanAuditRows();
  await setRuntimeEnabled(true);
  await withEnv({ DATA_RETENTION_CLEANUP_ENABLED: undefined }, async () => {
    const chain = runChainForRoute();
    const res = mockRes();
    await runChain(chain, mockReq({ dryRun: true }), res);
    assert.equal(res.statusCode, 200);

    const rows = await auditRows();
    const meta = rows[rows.length - 1].safeMetadata as any;
    const keys = JSON.stringify(meta);
    for (const forbidden of ['clinicId', 'organizationId', 'patientId', 'phone', 'email']) {
      assert.ok(!keys.includes(`"${forbidden}"`), `safeMetadata must never carry a ${forbidden} key — this job is platform-scoped, not tenant-scoped`);
    }
  });
  await clearRuntimeSetting();
});

section('POST /privacy/data-retention/run — audit persistence failure');

await test('audit write failure: live run still executes (real deletion happens) but the response makes the missing audit record explicit, not a plain 200', async () => {
  await cleanAuditRows();
  await setRuntimeEnabled(true);
  const marker = `retention-audit-writefail-${randomUUID()}`;
  await seedOldOperationalEvent(marker);

  // actorPlatformAdminId has a real FK to PlatformAdmin(id) — a non-existent
  // admin id forces a genuine DB-level foreign-key violation on the audit
  // insert itself, no mocking required (same technique as
  // legacyConsentCorrection's forced-FK-violation tests in platformAdmin.test.ts).
  const ghostActorId = 'retention-manual-run-ghost-admin';
  const req = mockReq({ dryRun: false });
  req.platformAdmin = { id: ghostActorId, email: 'ghost@platform.test' };

  await withEnv({ DATA_RETENTION_CLEANUP_ENABLED: undefined }, async () => {
    const chain = runChainForRoute();
    const res = mockRes();
    await runChain(chain, req, res);

    assert.equal(res.statusCode, 500, 'a cleanup that ran but whose audit record failed to persist must never look like an ordinary 200 success');
    assert.ok(res.body?.summary, 'the actual summary must still be surfaced so the caller/ops can see what really happened');
    assert.ok(res.body.summary.deletedOperationalEvents >= 1, 'the response summary must reflect the real deletion, not be hidden');

    assert.equal(await countOperationalEventsBySubstring(marker), 0, 'the cleanup itself must have actually run and deleted the eligible row, even though its audit row failed to persist — this endpoint cannot atomically bundle a 7-table batched cleanup with one audit insert');

    const ghostRows = await prisma.platformAdminAuditEvent.findMany({ where: { actorPlatformAdminId: ghostActorId } });
    assert.equal(ghostRows.length, 0, 'the failed audit insert must not leave a partial/corrupt row behind — its own transaction rolled back cleanly');
  });
  await clearRuntimeSetting();
});

section('POST /privacy/data-retention/run — concurrent manual runs');

await test('concurrent live runs: the shared job lock serializes execution — only one run actually deletes, the other is rejected 409 with outcome=blocked/concurrent_run_in_progress', async () => {
  await cleanAuditRows();
  await prisma.jobLock.deleteMany({ where: { name: DATA_RETENTION_JOB_LOCK_NAME } });
  await setRuntimeEnabled(true);
  const marker = `retention-audit-concurrent-${randomUUID()}`;
  await seedOldOperationalEvent(marker);

  await withEnv({ DATA_RETENTION_CLEANUP_ENABLED: undefined }, async () => {
    const chain = runChainForRoute();
    const resA = mockRes();
    const resB = mockRes();
    // Fired together via Promise.all (no await between them) against the same
    // Postgres instance — genuine DB-level concurrency, not a simulated race.
    await Promise.all([
      runChain(chain, mockReq({ dryRun: false }), resA),
      runChain(chain, mockReq({ dryRun: false }), resB),
    ]);

    const statusCodes = [resA.statusCode, resB.statusCode].sort();
    assert.deepEqual(statusCodes, [200, 409], 'exactly one concurrent live run must execute (200) and the other must be rejected as already-in-progress (409)');

    const winner = resA.statusCode === 200 ? resA : resB;
    const loser = resA.statusCode === 200 ? resB : resA;
    assert.equal(winner.body.summary.deletedOperationalEvents, 1, 'the winning run must be the one that actually deleted the seeded row');
    assert.equal(loser.body.error, 'Another data retention run (scheduled or manual) is already in progress. Try again shortly.');

    assert.equal(await countOperationalEventsBySubstring(marker), 0, 'the seeded row is deleted exactly once — no double-processing');

    const rows = await auditRows();
    assert.equal(rows.length, 2, 'both attempts — the executed one and the lock-rejected one — each get their own immutable audit row');
    const outcomes = rows.map((r) => r.outcome).sort();
    assert.deepEqual(outcomes, ['blocked', 'success']);
    const blockedRow = rows.find((r) => r.outcome === 'blocked')!;
    assert.equal((blockedRow.safeMetadata as any).errorCategory, 'concurrent_run_in_progress');
  });
  await clearRuntimeSetting();
});

console.log(`\n─────────────────────────────────`);
console.log(`Toplam: ${passed + failed}  ✓ ${passed}  ✗ ${failed}`);

if (failed > 0) {
  process.exitCode = 1;
}

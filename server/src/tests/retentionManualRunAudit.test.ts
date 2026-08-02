/**
 * retentionManualRunAudit.test.ts — RETENTION-MANUAL-RUN-AUDIT-001
 *
 * Focused coverage for POST /api/platform/privacy/data-retention/run and the
 * two-phase durable audit trail behind it (services/privacy/
 * dataRetentionManualRunAudit.ts):
 *
 *   - Every genuine live-run attempt (dryRun=false, cleanup effectively
 *     enabled) writes a "started" PlatformAdminAuditEvent row BEFORE the
 *     job lock is attempted / before any delete-anonymize batch runs, then
 *     exactly one terminal row (completed/partial_failure/failed/blocked)
 *     sharing the same runId once the attempt concludes.
 *   - If the "started" write itself fails, cleanup must never execute.
 *   - A terminal-write failure must never roll back or corrupt the already
 *     durably-committed "started" row.
 *   - Dry runs and the policy-gate ("blocked") rejection never reach a lock
 *     acquisition or a mutation, so a single terminal-only row (still with
 *     its own runId, no "started" precursor) is correct for both.
 *   - No PII ever lands in either row's metadata.
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
import platformAdminRouter, { createDataRetentionRunHandler } from '../routes/platformAdmin.js';
import { authenticatePlatformAdmin } from '../middleware/platformAuth.js';
import { generatePlatformToken } from '../middleware/platformAuth.js';
import jwt from 'jsonwebtoken';
import {
  DATA_RETENTION_RUNTIME_SETTING_KEY,
  loadDataRetentionConfig,
} from '../services/privacy/dataRetentionPolicy.js';
import { DATA_RETENTION_JOB_LOCK_NAME, DATA_RETENTION_JOB_LOCK_TTL_MS } from '../jobs/dataRetentionCleanupJob.js';
import { acquireJobLock, releaseJobLock } from '../utils/jobLock.js';
import { getPlatformSetting, setPlatformSetting, unsetPlatformSetting } from '../services/platformSettings.js';
import {
  DATA_RETENTION_MANUAL_RUN_STARTED_ACTION,
  DATA_RETENTION_MANUAL_RUN_COMPLETED_ACTION,
  DATA_RETENTION_MANUAL_RUN_PARTIAL_FAILURE_ACTION,
  DATA_RETENTION_MANUAL_RUN_FAILED_ACTION,
  DATA_RETENTION_MANUAL_RUN_BLOCKED_ACTION,
  DATA_RETENTION_MANUAL_RUN_ALL_ACTIONS,
  recordManualRunStarted,
  recordManualRunTerminal,
  findIncompleteManualRuns,
} from '../services/privacy/dataRetentionManualRunAudit.js';

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

// F1-003-B2-R1: a real, controllable barrier (never a `setTimeout`/sleep) —
// used to deterministically hold a concurrent request's policy lookup open
// for as long as the test needs, so the admission-ordering proof below does
// not depend on any real-time race window.
function createDeferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
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

async function cleanAuditRows(actorId: string = ACTOR_ID) {
  await prisma.platformAdminAuditEvent.deleteMany({
    where: { action: { in: DATA_RETENTION_MANUAL_RUN_ALL_ACTIONS }, actorPlatformAdminId: actorId },
  });
}

async function auditRows(actorId: string = ACTOR_ID) {
  return prisma.platformAdminAuditEvent.findMany({
    where: { action: { in: DATA_RETENTION_MANUAL_RUN_ALL_ACTIONS }, actorPlatformAdminId: actorId },
    orderBy: { createdAt: 'asc' },
  });
}

function startedRows(rows: Awaited<ReturnType<typeof auditRows>>) {
  return rows.filter((r) => r.action === DATA_RETENTION_MANUAL_RUN_STARTED_ACTION);
}

function terminalRows(rows: Awaited<ReturnType<typeof auditRows>>) {
  return rows.filter((r) => r.action !== DATA_RETENTION_MANUAL_RUN_STARTED_ACTION);
}

function runIdOf(row: { safeMetadata: unknown }): string {
  const runId = (row.safeMetadata as any)?.runId;
  assert.equal(typeof runId, 'string', 'every manual-run audit row must carry a string runId in safeMetadata');
  return runId as string;
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

function buildGateCtx(overrides: Partial<{
  actorPlatformAdminId: string | null;
  runtimeCleanupEnabled: boolean;
  effectiveCleanupEnabled: boolean;
  cleanupEnabledSource: 'env_disabled' | 'runtime_disabled' | 'enabled';
}> = {}) {
  return {
    actorPlatformAdminId: ACTOR_ID,
    config: loadDataRetentionConfig(),
    runtimeCleanupEnabled: true,
    effectiveCleanupEnabled: true,
    cleanupEnabledSource: 'enabled' as const,
    ...overrides,
  };
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

section('POST /privacy/data-retention/run — dry-run audit (single terminal event, no "started" precursor)');

await test('dry-run (default env/runtime state): 200, single audit row, action=manual_run_completed, outcome=success, dryRun=true, no PII, effective config captured', async () => {
  await cleanAuditRows();
  await clearRuntimeSetting(); // default-deny: runtime toggle absent → runtimeCleanupEnabled=false, irrelevant for a dry run
  const chain = runChainForRoute();
  const res = mockRes();
  await runChain(chain, mockReq({ dryRun: true }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.summary.dryRun, true);

  const rows = await auditRows();
  assert.equal(rows.length, 1, 'a dry run never gets a "started" precursor — exactly one terminal row');
  assert.equal(startedRows(rows).length, 0, 'dry run must never write a manual_run_started row');
  const row = rows[0];
  assert.equal(row.action, DATA_RETENTION_MANUAL_RUN_COMPLETED_ACTION);
  assert.equal(row.actorPlatformAdminId, ACTOR_ID);
  assert.equal(row.resourceType, 'data_retention');
  assert.equal(row.resourceKey, 'manual_run');
  assert.equal(row.outcome, 'success');

  const meta = row.safeMetadata as any;
  assert.equal(typeof meta.runId, 'string', 'even a "started"-less terminal row carries its own runId, for uniform tooling');
  assert.equal(meta.dryRun, true);
  assert.equal(meta.runtimeCleanupEnabled, false, 'default-deny: absent PlatformSetting means runtime is off');
  assert.ok(meta.effectiveConfig, 'effective retention configuration must be recorded');
  assert.equal(typeof meta.effectiveConfig.conversationMessagesDays, 'number');
  assert.ok(meta.resultCounts, 'dry-run must still record the (eligible) counts');

  const serialized = JSON.stringify(row);
  assert.ok(!serialized.includes('@'), 'must never contain an email/identity string');
  assert.ok(!('clinicId' in meta) && !('organizationId' in meta) && !('patientId' in meta), 'must never carry clinic/patient identifiers — platform-scoped only');
});

section('POST /privacy/data-retention/run — inconsistent / disabled state rejection (policy gate: single terminal event, no "started" precursor)');

await test('runtime disabled (env enabled, runtime absent/false): live run rejected 403, single audit row, action=manual_run_blocked, outcome=blocked, errorCategory=blocked_runtime_disabled', async () => {
  await cleanAuditRows();
  await clearRuntimeSetting();
  await withEnv({ DATA_RETENTION_CLEANUP_ENABLED: undefined }, async () => {
    const chain = runChainForRoute();
    const res = mockRes();
    await runChain(chain, mockReq({ dryRun: false }), res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.cleanupEnabledSource, 'runtime_disabled');

    const rows = await auditRows();
    assert.equal(rows.length, 1, 'the policy gate is a synchronous rejection — nothing was ever going to run, so no "started" precursor');
    assert.equal(startedRows(rows).length, 0);
    assert.equal(rows[0].action, DATA_RETENTION_MANUAL_RUN_BLOCKED_ACTION);
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
    assert.equal(rows[0].action, DATA_RETENTION_MANUAL_RUN_BLOCKED_ACTION);
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
    assert.equal(rows[0].action, DATA_RETENTION_MANUAL_RUN_COMPLETED_ACTION);
    assert.equal(rows[0].outcome, 'success');
  });
});

section('POST /privacy/data-retention/run — live-run two-phase audit (started + terminal, shared runId)');

await test('live-run: env+runtime enabled, seeded eligible row is actually deleted; a "started" row is written, followed by exactly one manual_run_completed terminal row sharing its runId', async () => {
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
    assert.equal(rows.length, 2, 'a genuine live-run attempt writes exactly two rows: started + one terminal');
    const started = startedRows(rows);
    const terminal = terminalRows(rows);
    assert.equal(started.length, 1);
    assert.equal(terminal.length, 1);
    assert.equal(started[0].outcome, 'started');
    assert.equal(started[0].action, DATA_RETENTION_MANUAL_RUN_STARTED_ACTION);
    assert.ok(started[0].createdAt.getTime() <= terminal[0].createdAt.getTime(), 'the "started" row must be committed no later than its terminal row');

    assert.equal(terminal[0].action, DATA_RETENTION_MANUAL_RUN_COMPLETED_ACTION);
    assert.equal(terminal[0].outcome, 'success');

    const startedRunId = runIdOf(started[0]);
    const terminalRunId = runIdOf(terminal[0]);
    assert.equal(startedRunId, terminalRunId, 'the terminal row must share the exact same runId as its started row');

    const meta = terminal[0].safeMetadata as any;
    assert.equal(meta.dryRun, false);
    assert.ok(meta.resultCounts.deletedOperationalEvents >= 1);
    assert.equal(meta.runtimeCleanupEnabled, true);
    assert.equal(meta.effectiveCleanupEnabled, true);
    assert.equal(meta.cleanupEnabledSource, 'enabled');

    const startedMeta = started[0].safeMetadata as any;
    assert.equal(startedMeta.dryRun, false);
    assert.ok(!('resultCounts' in startedMeta), 'a "started" row is written before cleanup runs — it can never carry result counts');
  });
  await clearRuntimeSetting();
});

await test('the "started" row is durably committed before the first delete/anonymize operation of the run', async () => {
  // Exercises recordManualRunStarted()/runDataRetentionCleanup() directly
  // (bypassing the HTTP layer) so the ordering can be asserted deterministically,
  // rather than inferred from timestamps after the fact.
  await cleanAuditRows();
  const { runDataRetentionCleanup } = await import('../jobs/dataRetentionCleanupJob.js');
  const marker = `retention-audit-ordering-${randomUUID()}`;
  await seedOldOperationalEvent(marker);

  const ctx = buildGateCtx();
  const { runId } = await recordManualRunStarted(ctx);

  // At this point recordManualRunStarted() has returned (its own transaction
  // committed) but the route has not yet called runDataRetentionCleanup —
  // exactly mirroring platformAdmin.ts's ordering. The seeded row must still
  // be untouched.
  assert.equal(await countOperationalEventsBySubstring(marker), 1, 'no mutation may occur before the started row is committed');
  const midRunRows = await auditRows();
  assert.equal(midRunRows.length, 1);
  assert.equal(midRunRows[0].action, DATA_RETENTION_MANUAL_RUN_STARTED_ACTION);

  const summary = await runDataRetentionCleanup({ dryRun: false, config: ctx.config });
  assert.equal(await countOperationalEventsBySubstring(marker), 0, 'the mutation happens strictly after the started row was committed');

  await recordManualRunTerminal({ ...ctx, runId, dryRun: false, outcome: 'success', resultCounts: { deletedOperationalEvents: summary.deletedOperationalEvents } });
  const rows = await auditRows();
  assert.equal(rows.length, 2);
});

await test('repeated invocation: two consecutive live runs each write their own started+terminal pair with distinct runIds; the second finds nothing left to delete', async () => {
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
    assert.equal(rows.length, 4, 'two attempts × (started + terminal) = 4 immutable rows — attempts are never deduplicated');
    const started = startedRows(rows);
    const terminal = terminalRows(rows);
    assert.equal(started.length, 2);
    assert.equal(terminal.length, 2);

    const runIds = new Set(rows.map(runIdOf));
    assert.equal(runIds.size, 2, 'each attempt gets its own distinct runId');

    for (const t of terminal) {
      assert.equal(t.action, DATA_RETENTION_MANUAL_RUN_COMPLETED_ACTION);
      assert.equal(t.outcome, 'success');
    }
  });
  await clearRuntimeSetting();
});

section('POST /privacy/data-retention/run — partial/failed cleanup');

await test('partial failure: one category genuinely fails at the DB level, others still succeed; started row + manual_run_partial_failure terminal row share one runId, safe error category, no PII', async () => {
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
      assert.equal(rows.length, 2, 'started + one partial_failure terminal row');
      const started = startedRows(rows);
      const terminal = terminalRows(rows);
      assert.equal(started.length, 1);
      assert.equal(terminal.length, 1);
      assert.equal(terminal[0].action, DATA_RETENTION_MANUAL_RUN_PARTIAL_FAILURE_ACTION);
      assert.equal(terminal[0].outcome, 'partial_failure');
      assert.equal(runIdOf(started[0]), runIdOf(terminal[0]), 'started and terminal rows must share the same runId');
      const meta = terminal[0].safeMetadata as any;
      assert.equal(meta.errorCategory, 'category_execution_error');
      assert.ok(meta.skippedCategories.includes('operationalEvents'));

      const serialized = JSON.stringify(rows);
      assert.ok(!serialized.includes('OperationalEvent_test_disabled'), 'no raw DB/error detail should leak into the audit rows');
      assert.ok(!serialized.includes(marker), 'no raw content from the affected rows should leak into the audit rows');
    });
  } finally {
    await prisma.$executeRawUnsafe('ALTER TABLE "OperationalEvent_test_disabled" RENAME TO "OperationalEvent"');
  }
  await clearRuntimeSetting();
  // The marker row survives untouched since its category failed — clean up the fixture.
  await prisma.operationalEvent.deleteMany({ where: { message: { contains: marker } } });
});

section('POST /privacy/data-retention/run — audit redaction / no PII / platform-scope');

await test('no PII in audit metadata: a message containing name/phone-shaped content never appears in either the started or terminal row', async () => {
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
    assert.equal(rows.length, 2);
    const serialized = JSON.stringify(rows);
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

await test('exact metadata field set: both a started row and its terminal row carry only the documented, non-PII keys', async () => {
  await cleanAuditRows();
  await setRuntimeEnabled(true);
  const marker = `retention-audit-fieldset-${randomUUID()}`;
  await seedOldOperationalEvent(marker);

  await withEnv({ DATA_RETENTION_CLEANUP_ENABLED: undefined }, async () => {
    const chain = runChainForRoute();
    const res = mockRes();
    await runChain(chain, mockReq({ dryRun: false }), res);
    assert.equal(res.statusCode, 200);

    const rows = await auditRows();
    const started = startedRows(rows)[0];
    const terminal = terminalRows(rows)[0];

    const startedKeys = Object.keys(started.safeMetadata as object).sort();
    assert.deepEqual(startedKeys, [
      'cleanupEnabledSource',
      'dryRun',
      'effectiveCleanupEnabled',
      'effectiveConfig',
      'runId',
      'runtimeCleanupEnabled',
    ].sort());

    const terminalKeys = Object.keys(terminal.safeMetadata as object).sort();
    assert.deepEqual(terminalKeys, [
      'cleanupEnabledSource',
      'dryRun',
      'effectiveCleanupEnabled',
      'effectiveConfig',
      'resultCounts',
      'runId',
      'runtimeCleanupEnabled',
    ].sort());
  });
  await clearRuntimeSetting();
});

section('POST /privacy/data-retention/run — "started" audit-write failure (must abort before any mutation)');

await test('started-audit-write failure: cleanup never executes (no deletion happens), a safe 500 is returned, and no audit row of any kind is left behind', async () => {
  await cleanAuditRows('retention-manual-run-ghost-admin');
  await setRuntimeEnabled(true);
  const marker = `retention-audit-startfail-${randomUUID()}`;
  await seedOldOperationalEvent(marker);

  // actorPlatformAdminId has a real FK to PlatformAdmin(id) — a non-existent
  // admin id forces a genuine DB-level foreign-key violation on the very
  // first audit insert this request makes: the "started" row. Since that
  // write happens strictly before the job lock / cleanup call, this proves
  // cleanup is never reached when the pre-run audit trail cannot be
  // persisted (same fault-injection technique as
  // legacyConsentCorrection.test.ts's forced-FK-violation tests).
  const ghostActorId = 'retention-manual-run-ghost-admin';
  const req = mockReq({ dryRun: false });
  req.platformAdmin = { id: ghostActorId, email: 'ghost@platform.test' };

  await withEnv({ DATA_RETENTION_CLEANUP_ENABLED: undefined }, async () => {
    const chain = runChainForRoute();
    const res = mockRes();
    await runChain(chain, req, res);

    assert.equal(res.statusCode, 500, 'a run whose pre-run audit trail could not be persisted must never proceed to a 200/403/409');
    assert.deepEqual(res.body, { error: 'Unable to record a durable audit trail for this run. The run was not executed.' });

    assert.equal(await countOperationalEventsBySubstring(marker), 1, 'the seeded eligible row must be untouched — cleanup must never have run');

    const ghostRows = await prisma.platformAdminAuditEvent.findMany({ where: { actorPlatformAdminId: ghostActorId } });
    assert.equal(ghostRows.length, 0, 'the failed "started" insert must not leave a partial/corrupt row behind — its own transaction rolled back cleanly');
  });
  await clearRuntimeSetting();
  await prisma.operationalEvent.deleteMany({ where: { message: { contains: marker } } });
});

section('POST /privacy/data-retention/run — terminal audit-write failure (must never corrupt the started row)');

await test('terminal-audit-write failure: the "started" row remains fully intact (not rolled back, not updated) even though the terminal insert fails', async () => {
  // Direct service-level test (bypasses the HTTP layer) so the failure can
  // be injected deterministically between the two writes, rather than
  // racing the route's internal timing.
  await cleanAuditRows();
  const ctx = buildGateCtx();
  const { runId } = await recordManualRunStarted(ctx);

  const beforeRows = await auditRows();
  assert.equal(beforeRows.length, 1);
  const startedRowBefore = beforeRows[0];

  // Force the next PlatformAdminAuditEvent insert to fail at the DB level —
  // same rename-the-table fault-injection technique used by the partial-
  // failure test above, applied here to the audit table itself.
  await prisma.$executeRawUnsafe('ALTER TABLE "PlatformAdminAuditEvent" RENAME TO "PlatformAdminAuditEvent_test_disabled"');
  let threw = false;
  try {
    await recordManualRunTerminal({ ...ctx, runId, dryRun: false, outcome: 'success', resultCounts: { deletedOperationalEvents: 0 } });
  } catch {
    threw = true;
  } finally {
    await prisma.$executeRawUnsafe('ALTER TABLE "PlatformAdminAuditEvent_test_disabled" RENAME TO "PlatformAdminAuditEvent"');
  }
  assert.equal(threw, true, 'the terminal write must propagate its failure to the caller (platformAdmin.ts logs it and responds accordingly)');

  const afterRows = await auditRows();
  assert.equal(afterRows.length, 1, 'no terminal row was created, and the started row was not duplicated');
  assert.equal(afterRows[0].id, startedRowBefore.id);
  assert.equal(afterRows[0].action, DATA_RETENTION_MANUAL_RUN_STARTED_ACTION);
  assert.equal(afterRows[0].outcome, 'started');
  assert.deepEqual(afterRows[0].safeMetadata, startedRowBefore.safeMetadata, 'the started row\'s content must be byte-for-byte unchanged');
  assert.equal(afterRows[0].createdAt.getTime(), startedRowBefore.createdAt.getTime(), 'the started row must never be touched (no update, no delete) by a failed terminal write');
});

section('POST /privacy/data-retention/run — concurrent manual runs and scheduled/manual lock collisions');

await test('concurrent live runs: the shared job lock serializes execution — only one run actually deletes; both attempts get their own started+terminal audit pair, the loser terminal is manual_run_blocked/concurrent_run_in_progress', async () => {
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
    assert.equal(rows.length, 4, 'both attempts write their own started+terminal pair: 2 started + 2 terminal');
    assert.equal(startedRows(rows).length, 2, 'both racers reach the "started" write before contending for the lock');
    const terminal = terminalRows(rows);
    assert.equal(terminal.length, 2);
    const outcomes = terminal.map((r) => r.outcome).sort();
    assert.deepEqual(outcomes, ['blocked', 'success']);

    const blockedRow = terminal.find((r) => r.outcome === 'blocked')!;
    assert.equal(blockedRow.action, DATA_RETENTION_MANUAL_RUN_BLOCKED_ACTION);
    assert.equal((blockedRow.safeMetadata as any).errorCategory, 'concurrent_run_in_progress');

    const completedRow = terminal.find((r) => r.outcome === 'success')!;
    assert.equal(completedRow.action, DATA_RETENTION_MANUAL_RUN_COMPLETED_ACTION);

    // Every terminal row's runId must match exactly one started row's runId —
    // pairs are never cross-wired between the two concurrent attempts.
    const startedRunIds = startedRows(rows).map(runIdOf).sort();
    const terminalRunIds = terminal.map(runIdOf).sort();
    assert.deepEqual(startedRunIds, terminalRunIds);
    assert.equal(new Set(startedRunIds).size, 2, 'the two concurrent attempts must have distinct runIds');
  });
  await clearRuntimeSetting();
});

await test('scheduled/manual lock collision: a live manual run is rejected 409 when the shared lock is already held (simulating the scheduled cron mid-run), and the collision is itself audited as started+blocked', async () => {
  await cleanAuditRows();
  await prisma.jobLock.deleteMany({ where: { name: DATA_RETENTION_JOB_LOCK_NAME } });
  await setRuntimeEnabled(true);
  // F1-003-B2: seed an eligible row so a false "success" (the loser silently
  // running cleanup anyway) would be observable, not just a status-code check.
  const marker = `retention-audit-schedcollision-${randomUUID()}`;
  await seedOldOperationalEvent(marker);

  // Simulate the scheduled cron currently holding the shared lease lock —
  // same JobLock row/name the cron (dataRetentionCleanupJob.ts) and this
  // manual route both contend for.
  await prisma.jobLock.create({
    data: { name: DATA_RETENTION_JOB_LOCK_NAME, lockedUntil: new Date(Date.now() + 60_000), lockedBy: 'simulated-scheduled-cron' },
  });

  try {
    await withEnv({ DATA_RETENTION_CLEANUP_ENABLED: undefined }, async () => {
      const chain = runChainForRoute();
      const res = mockRes();
      await runChain(chain, mockReq({ dryRun: false }), res);

      assert.equal(res.statusCode, 409, 'a manual live run must be rejected while the scheduled job holds the shared lock');
      assert.equal(res.body.error, 'Another data retention run (scheduled or manual) is already in progress. Try again shortly.');
      assert.equal(await countOperationalEventsBySubstring(marker), 1, 'the rejected/losing attempt must perform no cleanup at all — the seeded row is untouched');

      const rows = await auditRows();
      assert.equal(rows.length, 2, 'the manual attempt still writes started + blocked, even though the scheduled job (not another manual run) held the lock');
      assert.equal(startedRows(rows).length, 1);
      const terminal = terminalRows(rows);
      assert.equal(terminal.length, 1);
      assert.equal(terminal[0].action, DATA_RETENTION_MANUAL_RUN_BLOCKED_ACTION);
      assert.equal(terminal[0].outcome, 'blocked');
      assert.equal((terminal[0].safeMetadata as any).errorCategory, 'concurrent_run_in_progress');
      assert.equal(runIdOf(startedRows(rows)[0]), runIdOf(terminal[0]));

      // The scheduled job's own (simulated) lock ownership must be untouched
      // by the rejected manual attempt — it never called releaseJobLock.
      const lockRow = await prisma.jobLock.findUnique({ where: { name: DATA_RETENTION_JOB_LOCK_NAME } });
      assert.equal(lockRow?.lockedBy, 'simulated-scheduled-cron', 'a rejected manual attempt must never release a lock it does not own');
    });
  } finally {
    await prisma.jobLock.deleteMany({ where: { name: DATA_RETENTION_JOB_LOCK_NAME } });
    await prisma.operationalEvent.deleteMany({ where: { message: { contains: marker } } });
  }
  await clearRuntimeSetting();
});

section('POST /privacy/data-retention/run — race gate (F1-003-B2: repeated concurrent live-run rounds)');

await test('race gate: 10 consecutive concurrent live-run rounds against real PostgreSQL — zero double-success, zero double-block observations', async () => {
  const ROUNDS = 10;
  let doubleSuccessCount = 0;
  let doubleBlockCount = 0;

  await setRuntimeEnabled(true);
  try {
    await withEnv({ DATA_RETENTION_CLEANUP_ENABLED: undefined }, async () => {
      for (let round = 1; round <= ROUNDS; round++) {
        await cleanAuditRows();
        await prisma.jobLock.deleteMany({ where: { name: DATA_RETENTION_JOB_LOCK_NAME } });
        const marker = `retention-audit-race-gate-${round}-${randomUUID()}`;
        await seedOldOperationalEvent(marker);

        const chain = runChainForRoute();
        const resA = mockRes();
        const resB = mockRes();
        // No await between the two dispatches — genuine, not simulated,
        // concurrency against the same disposable Postgres instance, same
        // as the primary concurrent-runs test above, repeated to gate
        // against the exact flake observed in CI run 30542271302 (PR #268).
        await Promise.all([
          runChain(chain, mockReq({ dryRun: false }), resA),
          runChain(chain, mockReq({ dryRun: false }), resB),
        ]);

        const statusCodes = [resA.statusCode, resB.statusCode].sort();
        if (statusCodes[0] === 200 && statusCodes[1] === 200) doubleSuccessCount++;
        if (statusCodes[0] === 409 && statusCodes[1] === 409) doubleBlockCount++;
        assert.deepEqual(
          statusCodes,
          [200, 409],
          `round ${round}/${ROUNDS}: exactly one 200 and one 409 required, got [${statusCodes.join(',')}]`,
        );
        assert.equal(await countOperationalEventsBySubstring(marker), 0, `round ${round}/${ROUNDS}: the seeded row must be deleted exactly once`);
      }
    });
  } finally {
    await prisma.jobLock.deleteMany({ where: { name: DATA_RETENTION_JOB_LOCK_NAME } });
    await clearRuntimeSetting();
  }

  assert.equal(doubleSuccessCount, 0, `${doubleSuccessCount}/${ROUNDS} rounds let both concurrent attempts succeed (the F1-003-B2 regression) — must be zero`);
  assert.equal(doubleBlockCount, 0, `${doubleBlockCount}/${ROUNDS} rounds blocked both concurrent attempts (no executor ran at all) — must be zero`);
});

section('POST /privacy/data-retention/run — admission ordering (F1-003-B2-R1: lock acquired before policy evaluation)');

await test('deterministic admission proof: two concurrent live requests, BOTH deliberately parked mid-policy-lookup via a controllable barrier (no sleep) — admission is already fully resolved (one JobLock row held) before either policy lookup is allowed to complete, and the outcome is still exactly one 200 and one 409', async () => {
  await cleanAuditRows();
  await prisma.jobLock.deleteMany({ where: { name: DATA_RETENTION_JOB_LOCK_NAME } });
  await setRuntimeEnabled(true);
  const marker = `retention-audit-admission-order-${randomUUID()}`;
  await seedOldOperationalEvent(marker);

  await withEnv({ DATA_RETENTION_CLEANUP_ENABLED: undefined }, async () => {
    const barriers = [createDeferred<void>(), createDeferred<void>()];
    const reachedPolicyStep = [createDeferred<void>(), createDeferred<void>()];
    let callIndex = 0;

    // Wraps the REAL getPlatformSetting: signals "I've reached the
    // post-admission policy step" immediately, then blocks on its own
    // barrier until the test explicitly releases it — proving whatever
    // happens next cannot influence which racer already won the lock.
    const barrieredGetPlatformSetting: typeof getPlatformSetting = async (key, client) => {
      const i = callIndex++;
      reachedPolicyStep[i].resolve();
      await barriers[i].promise;
      return getPlatformSetting(key, client);
    };

    const chain = [createDataRetentionRunHandler({ getPlatformSetting: barrieredGetPlatformSetting })];
    const resA = mockRes();
    const resB = mockRes();

    const p1 = runChain(chain, mockReq({ dryRun: false }), resA);
    const p2 = runChain(chain, mockReq({ dryRun: false }), resB);

    // Wait until BOTH racers have reached their post-admission policy step —
    // i.e. both have already completed acquireJobLock() and are now merely
    // waiting on the (test-controlled) policy read.
    await Promise.all([reachedPolicyStep[0].promise, reachedPolicyStep[1].promise]);

    // Admission must already be fully decided at this point: exactly one
    // held JobLock row exists, well before either policy lookup is allowed
    // to resolve.
    const lockRowWhileParked = await prisma.jobLock.findUnique({ where: { name: DATA_RETENTION_JOB_LOCK_NAME } });
    assert.ok(lockRowWhileParked, 'a JobLock row must already exist — admission was decided before either policy lookup completed');
    assert.ok(
      lockRowWhileParked!.lockedUntil.getTime() > Date.now(),
      'the JobLock row must be actively held (not expired) while both racers are parked mid-policy-lookup',
    );

    // Release both barriers — order doesn't matter, since admission is
    // already fixed and cannot be changed by finishing the policy read now.
    barriers[0].resolve();
    barriers[1].resolve();
    await Promise.all([p1, p2]);

    const statusCodes = [resA.statusCode, resB.statusCode].sort();
    assert.deepEqual(statusCodes, [200, 409], 'admission ordering must produce exactly one 200 and one 409 regardless of policy-lookup timing');
    assert.equal(await countOperationalEventsBySubstring(marker), 0, 'the seeded row is deleted exactly once');

    const rows = await auditRows();
    assert.equal(startedRows(rows).length, 2, 'both racers still reach their own "started" write');
    const terminal = terminalRows(rows);
    assert.deepEqual(terminal.map((r) => r.outcome).sort(), ['blocked', 'success']);
  });
  await prisma.jobLock.deleteMany({ where: { name: DATA_RETENTION_JOB_LOCK_NAME } });
  await clearRuntimeSetting();
});

await test('policy disabled after live lock acquisition: 403, no cleanup, the lock is released and immediately reusable', async () => {
  await cleanAuditRows();
  await prisma.jobLock.deleteMany({ where: { name: DATA_RETENTION_JOB_LOCK_NAME } });
  await clearRuntimeSetting(); // runtime toggle absent -> effectiveCleanupEnabled=false, discovered only AFTER admission now
  const marker = `retention-audit-policy-after-lock-${randomUUID()}`;
  await seedOldOperationalEvent(marker);

  await withEnv({ DATA_RETENTION_CLEANUP_ENABLED: undefined }, async () => {
    const chain = runChainForRoute();
    const res = mockRes();
    await runChain(chain, mockReq({ dryRun: false }), res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.cleanupEnabledSource, 'runtime_disabled');
    assert.equal(await countOperationalEventsBySubstring(marker), 1, 'no cleanup must have run — the seeded row is untouched');

    // Policy-block audit shape is unchanged from before this task: single
    // terminal-only row, no "started" precursor.
    const rows = await auditRows();
    assert.equal(rows.length, 1);
    assert.equal(startedRows(rows).length, 0);
    assert.equal(rows[0].action, DATA_RETENTION_MANUAL_RUN_BLOCKED_ACTION);
    assert.equal((rows[0].safeMetadata as any).errorCategory, 'blocked_runtime_disabled');

    // The lock was briefly held (to evaluate policy under admission) and
    // must now be fully released — immediately reusable, not orphaned.
    const acquiredAgain = await acquireJobLock(DATA_RETENTION_JOB_LOCK_NAME, DATA_RETENTION_JOB_LOCK_TTL_MS);
    assert.equal(acquiredAgain, true, 'the lock must be immediately reusable after a policy-gate rejection releases it');
  });
  await prisma.jobLock.deleteMany({ where: { name: DATA_RETENTION_JOB_LOCK_NAME } });
  await prisma.operationalEvent.deleteMany({ where: { message: { contains: marker } } });
});

await test('policy lookup throws after lock acquisition: no cleanup, the lock is released (not orphaned), sanitized 500, no fabricated audit row', async () => {
  await cleanAuditRows();
  await prisma.jobLock.deleteMany({ where: { name: DATA_RETENTION_JOB_LOCK_NAME } });
  await setRuntimeEnabled(true);
  const marker = `retention-audit-policy-throws-${randomUUID()}`;
  await seedOldOperationalEvent(marker);

  const failingGetPlatformSetting: typeof getPlatformSetting = async () => {
    throw new Error('simulated PlatformSetting lookup failure');
  };

  await withEnv({ DATA_RETENTION_CLEANUP_ENABLED: undefined }, async () => {
    const chain = [createDataRetentionRunHandler({ getPlatformSetting: failingGetPlatformSetting })];
    const res = mockRes();
    await runChain(chain, mockReq({ dryRun: false }), res);

    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { error: 'Unable to evaluate the retention policy configuration. See server logs for detail.' });
    assert.equal(await countOperationalEventsBySubstring(marker), 1, 'no cleanup must have run — the seeded row is untouched');

    // No valid gateCtx could ever be built (policy values unknown) — the
    // established "never fabricate audit metadata" discipline means no
    // audit row of any kind is written for this failure.
    const rows = await auditRows();
    assert.equal(rows.length, 0, 'no audit row of any kind is left behind when the policy lookup itself fails');

    // The lock was acquired before the failing policy read and must be
    // released immediately, not orphaned for its full TTL.
    const acquiredAgain = await acquireJobLock(DATA_RETENTION_JOB_LOCK_NAME, DATA_RETENTION_JOB_LOCK_TTL_MS);
    assert.equal(acquiredAgain, true, 'the lock must be immediately reusable after a policy-lookup failure releases it');
  });
  await prisma.jobLock.deleteMany({ where: { name: DATA_RETENTION_JOB_LOCK_NAME } });
  await prisma.operationalEvent.deleteMany({ where: { message: { contains: marker } } });
  await clearRuntimeSetting();
});

section('POST /privacy/data-retention/run — releaseJobLock failure semantics (F1-003-B2-R1)');

await test('releaseJobLock() never rejects even when the underlying DB update fails — a completed cleanup\'s success must never be reported as a failure just because the release afterward could not be confirmed', async () => {
  const lockName = `f1-003-b2-r1-release-failure-${randomUUID()}`;
  await prisma.jobLock.deleteMany({ where: { name: lockName } });
  const acquired = await acquireJobLock(lockName, DATA_RETENTION_JOB_LOCK_TTL_MS);
  assert.equal(acquired, true);

  // Force the underlying release UPDATE to fail genuinely (not simulated):
  // temporarily rename the table out from under it, same fault-injection
  // technique used by the existing started/terminal-audit-write-failure
  // tests above.
  await prisma.$executeRawUnsafe('ALTER TABLE "JobLock" RENAME TO "JobLock_test_disabled"');
  let releaseThrew = false;
  try {
    await releaseJobLock(lockName);
  } catch {
    releaseThrew = true;
  } finally {
    await prisma.$executeRawUnsafe('ALTER TABLE "JobLock_test_disabled" RENAME TO "JobLock"');
  }

  assert.equal(releaseThrew, false, 'releaseJobLock() must never reject — a caller that already completed and reported a successful cleanup must not have that success retroactively turned into an error just because this cleanup call failed');

  // Documented consequence of "never reject": the lock remains held (not
  // released) until its own TTL expires, since the release genuinely could
  // not be confirmed. This is a deliberate, logged (see jobLock.ts) trade-off,
  // not a silent data-loss risk — no audit/business data is affected, only
  // the lock's own availability window.
  const stillHeld = await acquireJobLock(lockName, DATA_RETENTION_JOB_LOCK_TTL_MS);
  assert.equal(stillHeld, false, 'the lock remains held after a genuinely failed release attempt — it was not silently cleared');

  // Force-clear for test hygiene.
  await prisma.jobLock.deleteMany({ where: { name: lockName } });
});

section('POST /privacy/data-retention/run — shared JobLock primitive (server/src/utils/jobLock.ts), exercised directly against real PostgreSQL');

await test('acquireJobLock(): N-way (4) truly-concurrent acquisition on a fresh lock name grants to exactly one caller', async () => {
  const lockName = `f1-003-b2-primitive-${randomUUID()}`;
  await prisma.jobLock.deleteMany({ where: { name: lockName } });
  try {
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, i) => acquireJobLock(lockName, DATA_RETENTION_JOB_LOCK_TTL_MS).then((ok) => ({ i, ok }))),
    );
    const winners = results.filter((r) => r.ok);
    assert.equal(winners.length, 1, `exactly one of 4 truly-concurrent acquireJobLock() calls must succeed, got ${winners.length}`);
  } finally {
    await releaseJobLock(lockName);
    await prisma.jobLock.deleteMany({ where: { name: lockName } });
  }
});

await test('acquireJobLock()/releaseJobLock(): after release, the lock is immediately free again — no orphaning after a normal successful completion', async () => {
  const lockName = `f1-003-b2-primitive-release-${randomUUID()}`;
  await prisma.jobLock.deleteMany({ where: { name: lockName } });
  try {
    const first = await acquireJobLock(lockName, DATA_RETENTION_JOB_LOCK_TTL_MS);
    assert.equal(first, true);
    const contended = await acquireJobLock(lockName, DATA_RETENTION_JOB_LOCK_TTL_MS);
    assert.equal(contended, false, 'a second acquire while the first is still held must fail');

    await releaseJobLock(lockName);

    const afterRelease = await acquireJobLock(lockName, DATA_RETENTION_JOB_LOCK_TTL_MS);
    assert.equal(afterRelease, true, 'the lock must be immediately acquirable again after release — this is what the route relies on after a successful live run');
  } finally {
    await releaseJobLock(lockName);
    await prisma.jobLock.deleteMany({ where: { name: lockName } });
  }
});

await test('acquireJobLock()/releaseJobLock(): a try/finally around a throwing callback (mirroring the route\'s cleanup wrapper) still releases the lock — no orphan after a thrown exception', async () => {
  const lockName = `f1-003-b2-primitive-throw-${randomUUID()}`;
  await prisma.jobLock.deleteMany({ where: { name: lockName } });
  try {
    const acquired = await acquireJobLock(lockName, DATA_RETENTION_JOB_LOCK_TTL_MS);
    assert.equal(acquired, true);

    let threw = false;
    try {
      // Mirrors platformAdmin.ts's `try { await runDataRetentionCleanup(...) } finally { await releaseJobLock(...) }`.
      try {
        await Promise.reject(new Error('simulated cleanup failure'));
      } finally {
        await releaseJobLock(lockName);
      }
    } catch {
      threw = true;
    }
    assert.equal(threw, true, 'the simulated failure must still propagate to the caller (the route catches it and writes an error terminal row)');

    const afterThrow = await acquireJobLock(lockName, DATA_RETENTION_JOB_LOCK_TTL_MS);
    assert.equal(afterThrow, true, 'the lock must not be orphaned for its full TTL just because the protected work threw — it must be free immediately');
  } finally {
    await releaseJobLock(lockName);
    await prisma.jobLock.deleteMany({ where: { name: lockName } });
  }
});

section('POST /privacy/data-retention/run — lock reserved-then-abandoned edge case (F1-003-B2: lock now acquired before the "started" write)');

await test('lock acquired but the "started" audit write then fails: the lock is released immediately, not orphaned for its full TTL', async () => {
  await cleanAuditRows('retention-manual-run-ghost-admin-lockrelease');
  await prisma.jobLock.deleteMany({ where: { name: DATA_RETENTION_JOB_LOCK_NAME } });
  await setRuntimeEnabled(true);

  // Same forced-FK-violation technique as the existing "started-audit-write
  // failure" test above, but this one specifically proves the NEW ordering
  // introduced by F1-003-B2 (lock acquired before the started-write) does
  // not orphan the lock when that started-write fails.
  const ghostActorId = 'retention-manual-run-ghost-admin-lockrelease';
  const req = mockReq({ dryRun: false });
  req.platformAdmin = { id: ghostActorId, email: 'ghost-lockrelease@platform.test' };

  try {
    await withEnv({ DATA_RETENTION_CLEANUP_ENABLED: undefined }, async () => {
      const chain = runChainForRoute();
      const res = mockRes();
      await runChain(chain, req, res);

      assert.equal(res.statusCode, 500);
      assert.deepEqual(res.body, { error: 'Unable to record a durable audit trail for this run. The run was not executed.' });

      const ghostRows = await prisma.platformAdminAuditEvent.findMany({ where: { actorPlatformAdminId: ghostActorId } });
      assert.equal(ghostRows.length, 0, 'no audit row of any kind must be left behind');

      const lockRow = await prisma.jobLock.findUnique({ where: { name: DATA_RETENTION_JOB_LOCK_NAME } });
      assert.ok(
        !lockRow || lockRow.lockedUntil.getTime() <= Date.now(),
        'the lock reserved before the failed started-write must be released immediately, not held for its full 2-hour TTL',
      );

      // Confirm it is genuinely re-acquirable, not merely "looks expired".
      const reacquired = await acquireJobLock(DATA_RETENTION_JOB_LOCK_NAME, DATA_RETENTION_JOB_LOCK_TTL_MS);
      assert.equal(reacquired, true, 'a subsequent attempt must be able to acquire the lock immediately');
    });
  } finally {
    await releaseJobLock(DATA_RETENTION_JOB_LOCK_NAME);
    await prisma.jobLock.deleteMany({ where: { name: DATA_RETENTION_JOB_LOCK_NAME } });
  }
  await clearRuntimeSetting();
});

section('POST /privacy/data-retention/run — incomplete-run reconciliation (findIncompleteManualRuns)');

await test('findIncompleteManualRuns: a "started" row with no matching terminal row (simulating a mid-run crash) is detected; a normally-completed run is not', async () => {
  await cleanAuditRows();
  const ctx = buildGateCtx();

  // Simulate a crash: write "started" and never write a terminal row.
  const { runId: crashedRunId } = await recordManualRunStarted(ctx);

  // A normal, fully-completed attempt for comparison — must NOT be reported incomplete.
  const { runId: completedRunId } = await recordManualRunStarted(ctx);
  await recordManualRunTerminal({ ...ctx, runId: completedRunId, dryRun: false, outcome: 'success', resultCounts: { deletedOperationalEvents: 0 } });

  const incomplete = await findIncompleteManualRuns({ graceMs: 0 });
  const incompleteRunIds = incomplete.map((r) => r.runId);
  assert.ok(incompleteRunIds.includes(crashedRunId), 'a started-but-never-terminated run must be surfaced');
  assert.ok(!incompleteRunIds.includes(completedRunId), 'a run with a matching terminal row must never be reported as incomplete');

  const crashedEntry = incomplete.find((r) => r.runId === crashedRunId)!;
  assert.equal(crashedEntry.actorPlatformAdminId, ACTOR_ID);
  assert.ok(crashedEntry.startedAt instanceof Date);

  // No PII: the reconciliation result itself must only ever carry runId/timestamp/actor id.
  const serialized = JSON.stringify(incomplete);
  assert.ok(!serialized.includes('@'), 'reconciliation output must never contain an email/identity string');
});

await test('findIncompleteManualRuns: a still-in-flight started row younger than the grace period is not (yet) reported', async () => {
  await cleanAuditRows();
  const ctx = buildGateCtx();
  await recordManualRunStarted(ctx);

  const incomplete = await findIncompleteManualRuns({ graceMs: 60 * 60 * 1000 }); // 1h grace — this run is seconds old
  const ourRows = await auditRows();
  const ourRunId = runIdOf(ourRows[0]);
  assert.ok(!incomplete.map((r) => r.runId).includes(ourRunId), 'a run still plausibly in flight must not be reported as incomplete yet');
});

console.log(`\n─────────────────────────────────`);
console.log(`Toplam: ${passed + failed}  ✓ ${passed}  ✗ ${failed}`);

if (failed > 0) {
  process.exitCode = 1;
}

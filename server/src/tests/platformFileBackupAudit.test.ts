/**
 * platformFileBackupAudit.test.ts — F3-IMPL-005
 *
 * POST /api/platform/file-backups/run and POST /api/platform/file-backups/
 * restore-rehearsal were the two remaining class-5 (operational trigger)
 * gaps left by F3-IMPL-003 (R-019) — the file-backup counterparts of
 * /backups/run and /backups/restore-test (F3-IMPL-001), which already write
 * a durable PlatformAdminAuditEvent. Both now route through the same
 * writePlatformAdminAuditEvent() helper (services/platformAdminAudit.ts).
 *
 * Same technique as platformBackupAudit.test.ts: FILE_BACKUP_ENABLED
 * defaults to false (services/fileBackupService.ts — fail-closed by design),
 * so runFileBackup() deterministically throws "File backup is disabled"
 * before any real file/S3 work begins in any environment that hasn't set
 * FILE_BACKUP_ENABLED=true — exercising the failure-audit branch.
 * runFileBackupRestoreRehearsal() deterministically finds zero verified
 * FileBackupEntry rows in a fresh disposable database and returns (does not
 * throw) success:false — exercising the completed-audit branch, which mirrors
 * exactly how the DB-backup routes treat "the operation ran without error"
 * as a success outcome.
 *
 * The route handler chain is extracted directly from the router's internal
 * stack and invoked against a real disposable Postgres database — no
 * supertest, no mocked Prisma.
 *
 * Run with: tsx src/tests/platformFileBackupAudit.test.ts
 * Requires DATABASE_URL to point at a disposable Postgres.
 */

import 'dotenv/config';

import assert from 'node:assert/strict';
import prisma from '../db.js';
import platformAdminRouter from '../routes/platformAdmin.js';
import { boundedErrorType } from '../utils/safeError.js';

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

const ACTOR_ID = 'platform-file-backup-audit-admin-1';
const ACTOR_EMAIL = 'platform-file-backup-audit-admin@platform.test';

function mockReq(body: Record<string, unknown> = {}) {
  return { body, platformAdmin: { id: ACTOR_ID, email: ACTOR_EMAIL } } as any;
}

async function cleanAuditRows() {
  await prisma.platformAdminAuditEvent.deleteMany({
    where: { actorPlatformAdminId: ACTOR_ID, resourceType: 'file_backup' },
  });
}

async function auditRows() {
  return prisma.platformAdminAuditEvent.findMany({
    where: { actorPlatformAdminId: ACTOR_ID, resourceType: 'file_backup' },
    orderBy: { createdAt: 'asc' },
  });
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
    name: 'Test Fixture Platform Admin (File Backup Audit)',
  },
});

const runChainRoute = getRouteMiddlewareChain(platformAdminRouter as any, 'post', '/file-backups/run');
const rehearsalChain = getRouteMiddlewareChain(platformAdminRouter as any, 'post', '/file-backups/restore-rehearsal');

async function main() {
  section('POST /file-backups/run — durable audit trail on failure');

  await cleanAuditRows();

  await test('FILE_BACKUP_ENABLED=false (default) writes exactly one file_backup.manual_run.failed audit row', async () => {
    delete process.env.FILE_BACKUP_ENABLED;
    const req = mockReq({});
    const res = mockRes();
    await runChain(runChainRoute, req, res);

    assert.equal(res.statusCode, 409);
    assert.match(res.body?.error ?? '', /disabled/);

    const rows = await auditRows();
    assert.equal(rows.length, 1, 'expected exactly one audit row for this admin/resourceType');
    const row = rows[0];
    assert.equal(row.action, 'file_backup.manual_run.failed');
    assert.equal(row.actorPlatformAdminId, ACTOR_ID);
    assert.equal(row.resourceType, 'file_backup');
    assert.equal(row.resourceKey, 'files');
    assert.equal(row.outcome, 'error');
    assert.equal(row.previousValue, null);
    assert.equal(row.newValue, null);
  });

  await test('failure audit row carries no PII — no admin email, only a fixed error-type metadata field', async () => {
    const rows = await auditRows();
    const row = rows[0];
    const serialized = JSON.stringify(row);
    assert.ok(!serialized.includes(ACTOR_EMAIL), 'audit row must never contain the admin email');
    assert.ok(!serialized.includes('@'), 'audit row must contain no email-shaped value at all');

    const metadata = row.safeMetadata as Record<string, unknown> | null;
    assert.ok(metadata, 'expected safeMetadata to be present');
    assert.equal(metadata!.errorType, 'Error');
    assert.deepEqual(Object.keys(metadata!), ['errorType']);
  });

  await cleanAuditRows();

  section('POST /file-backups/restore-rehearsal — durable audit trail on completion');

  await test('zero verified FileBackupEntry rows (fresh disposable DB) writes exactly one file_backup.restore_rehearsal.completed audit row', async () => {
    const req = mockReq({});
    const res = mockRes();
    await runChain(rehearsalChain, req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.success, false, 'the underlying rehearsal itself found nothing to verify — this is a distinct fact from "the route call succeeded"');

    const rows = await auditRows();
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.action, 'file_backup.restore_rehearsal.completed');
    assert.equal(row.actorPlatformAdminId, ACTOR_ID);
    assert.equal(row.resourceType, 'file_backup');
    assert.equal(row.resourceKey, 'restore_rehearsal');
    assert.equal(row.outcome, 'success');
    assert.equal(row.previousValue, null);
    assert.equal(row.newValue, null);
  });

  await test('completion audit row carries only sampleSize metadata — no PII, no free-form error text', async () => {
    const rows = await auditRows();
    const row = rows[0];
    const serialized = JSON.stringify(row);
    assert.ok(!serialized.includes(ACTOR_EMAIL));
    assert.ok(!serialized.includes('@'));

    const metadata = row.safeMetadata as Record<string, unknown> | null;
    assert.ok(metadata, 'expected safeMetadata to be present');
    assert.deepEqual(Object.keys(metadata!), ['sampleSize']);
  });

  await test('invalid sampleSize is rejected (400) with no audit row', async () => {
    const before = await auditRows();
    const req = mockReq({ sampleSize: -5 });
    const res = mockRes();
    await runChain(rehearsalChain, req, res);
    assert.equal(res.statusCode, 400);
    const after = await auditRows();
    assert.equal(after.length, before.length);
  });

  await cleanAuditRows();

  section('Audit-write failure path — no raw error content in logs (F3-IMPL-005-R1)');

  // Sentinels chosen to be unmistakable if they ever leaked into a log line.
  const SENTINEL_EMAIL = 'patient@example.test';
  const SENTINEL_PHONE = '+905551234567';
  const SENTINEL_TOKEN = 'SECRET_TEST_TOKEN_9f3ab1';

  function withCapturedConsoleError<T>(fn: () => Promise<T>): Promise<{ result: T; calls: unknown[][] }> {
    const calls: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { calls.push(args); };
    return fn()
      .then((result) => { console.error = original; return { result, calls }; })
      .catch((err) => { console.error = original; throw err; });
  }

  function withPoisonedAuditTransaction<T>(fn: () => Promise<T>): Promise<T> {
    const original = prisma.$transaction.bind(prisma);
    const sensitiveError = new Error(
      `simulated audit-write failure — connection string postgres://dbuser:${SENTINEL_TOKEN}@10.0.0.5:5432/db, ` +
      `patient contact ${SENTINEL_EMAIL} / ${SENTINEL_PHONE}`,
    );
    sensitiveError.name = 'PrismaClientKnownRequestError';
    (sensitiveError as unknown as { code: string }).code = 'P2010';
    (prisma as unknown as { $transaction: unknown }).$transaction = () => Promise.reject(sensitiveError);
    return fn().finally(() => {
      (prisma as unknown as { $transaction: unknown }).$transaction = original;
    });
  }

  await test('manual backup run: audit-write failure on the "failed" branch never logs raw error content', async () => {
    delete process.env.FILE_BACKUP_ENABLED;
    const req = mockReq({});
    const res = mockRes();

    const { calls } = await withCapturedConsoleError(() =>
      withPoisonedAuditTransaction(() => runChain(runChainRoute, req, res)),
    );

    // The operation still responds — a failed best-effort audit write must
    // never block or alter the caller-facing response.
    assert.equal(res.statusCode, 409);

    const relevant = calls.filter((args) =>
      typeof args[0] === 'string' && args[0].includes('[platform-file-backup]') && args[0].includes('failed manual backup run'),
    );
    assert.equal(relevant.length, 1, 'expected exactly one log line for the poisoned audit write');

    const serialized = JSON.stringify(relevant[0]);
    assert.ok(!serialized.includes(SENTINEL_EMAIL), 'log must not contain the raw patient email');
    assert.ok(!serialized.includes(SENTINEL_PHONE), 'log must not contain the raw phone number');
    assert.ok(!serialized.includes(SENTINEL_TOKEN), 'log must not contain the raw secret token');
    assert.ok(!serialized.includes('postgres://'), 'log must not contain the raw connection string');
    assert.ok(!serialized.includes('10.0.0.5'), 'log must not contain the raw host detail');

    const safeFieldsArg = relevant[0][1] as Record<string, unknown>;
    assert.equal(safeFieldsArg.errorName, 'PrismaClientKnownRequestError');
    assert.equal(safeFieldsArg.errorCode, 'P2010');
    assert.deepEqual(Object.keys(safeFieldsArg).sort(), ['errorCode', 'errorName']);
  });

  await cleanAuditRows();

  await test('restore rehearsal: audit-write failure on the "completed" branch never logs raw error content', async () => {
    const req = mockReq({});
    const res = mockRes();

    const { calls } = await withCapturedConsoleError(() =>
      withPoisonedAuditTransaction(() => runChain(rehearsalChain, req, res)),
    );

    assert.equal(res.statusCode, 200);

    const relevant = calls.filter((args) =>
      typeof args[0] === 'string' && args[0].includes('[platform-file-backup]') && args[0].includes('completed restore rehearsal'),
    );
    assert.equal(relevant.length, 1, 'expected exactly one log line for the poisoned audit write');

    const serialized = JSON.stringify(relevant[0]);
    assert.ok(!serialized.includes(SENTINEL_EMAIL), 'log must not contain the raw patient email');
    assert.ok(!serialized.includes(SENTINEL_PHONE), 'log must not contain the raw phone number');
    assert.ok(!serialized.includes(SENTINEL_TOKEN), 'log must not contain the raw secret token');
    assert.ok(!serialized.includes('postgres://'), 'log must not contain the raw connection string');
    assert.ok(!serialized.includes('10.0.0.5'), 'log must not contain the raw host detail');

    const safeFieldsArg = relevant[0][1] as Record<string, unknown>;
    assert.equal(safeFieldsArg.errorName, 'PrismaClientKnownRequestError');
    assert.equal(safeFieldsArg.errorCode, 'P2010');
    assert.deepEqual(Object.keys(safeFieldsArg).sort(), ['errorCode', 'errorName']);
  });

  await cleanAuditRows();

  section('Bounded errorType classification — no raw Error.name persisted (F3-IMPL-005-R2)');

  // Error.name is mutable, attacker/library-controllable free text — nothing
  // stops a thrower from setting it to a string embedding PII or secrets.
  // safeMetadata.errorType must collapse to a fixed, bounded label instead
  // of persisting it verbatim.
  const POISONED_NAME =
    'patient=Mustafa Secret email=patient@example.test phone=+905551234567 token=SECRET_TEST_TOKEN_9f3ab1';

  function assertNoSentinels(serialized: string, label: string) {
    for (const sentinel of [
      'Mustafa Secret',
      'patient@example.test',
      '+905551234567',
      'SECRET_TEST_TOKEN_9f3ab1',
      'patient=',
      'email=',
      'phone=',
      'token=',
    ]) {
      assert.ok(!serialized.includes(sentinel), `${label} must not contain "${sentinel}"`);
    }
  }

  await test('manual file backup failure: poisoned Error.name never reaches safeMetadata.errorType', () => {
    const err = new Error('safe');
    err.name = POISONED_NAME;

    // Mirrors the exact safeMetadata literal built on the
    // file_backup.manual_run.failed path in routes/platformAdmin.ts.
    const safeMetadata = { errorType: boundedErrorType(err) };

    assert.equal(safeMetadata.errorType, 'Error');
    assert.deepEqual(Object.keys(safeMetadata), ['errorType']);
    assertNoSentinels(JSON.stringify(safeMetadata), 'manual file backup failure safeMetadata');
  });

  await test('restore rehearsal failure: poisoned Error.name never reaches safeMetadata.errorType', () => {
    const err = new Error('safe');
    err.name = POISONED_NAME;

    // Mirrors the exact safeMetadata literal built on the
    // file_backup.restore_rehearsal.failed path in routes/platformAdmin.ts.
    const safeMetadata = { sampleSize: 5, errorType: boundedErrorType(err) };

    assert.equal(safeMetadata.errorType, 'Error');
    assert.deepEqual(Object.keys(safeMetadata).sort(), ['errorType', 'sampleSize']);
    assertNoSentinels(JSON.stringify(safeMetadata), 'restore rehearsal failure safeMetadata');
  });

  await test('non-Error throw classifies as UnknownError rather than passing through an arbitrary "name" property', () => {
    const nonError = { name: POISONED_NAME, message: 'not a real Error instance' };
    assert.equal(boundedErrorType(nonError), 'UnknownError');
    assertNoSentinels(JSON.stringify({ errorType: boundedErrorType(nonError) }), 'non-Error safeMetadata');
  });

  section('Summary');
  console.log('\n─────────────────────────────────────────');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  await prisma.$disconnect();
  if (failed > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error('Test runner error:', err);
  await prisma.$disconnect();
  process.exit(1);
});

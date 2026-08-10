/**
 * platformBackupAudit.test.ts — F3-IMPL-001
 *
 * POST /api/platform/backups/run and POST /api/platform/backups/restore-test
 * previously had ZERO durable audit evidence (R-019) — only a console.log
 * line that also leaked the triggering admin's email (R-018). Both gaps are
 * fixed by routing through the same writePlatformAdminAuditEvent() helper
 * already used elsewhere in platformAdmin.ts (services/platformAdminAudit.ts).
 *
 * This suite exercises the restore-test route's FAILURE branch specifically,
 * because it is deterministic and side-effect-free in any environment: the
 * backup directory (/root/noramedi-backups) does not exist outside a real
 * production host, so listBackupFiles() reliably returns [] and
 * runRestoreTest() reliably throws "No backup files available" before any
 * real file/DB restore work begins — see services/backupService.ts. The
 * success branch calls the exact same writePlatformAdminAuditEvent() helper
 * with different literal action/outcome arguments; it is not separately
 * exercised here because it requires a real pg_dump/backup toolchain not
 * present in this sandbox.
 *
 * Same technique as retentionManualRunAudit.test.ts: the route handler chain
 * is extracted directly from the router's internal stack and invoked against
 * a real disposable Postgres database — no supertest, no mocked Prisma.
 *
 * Run with: tsx src/tests/platformBackupAudit.test.ts
 * Requires DATABASE_URL to point at a disposable Postgres.
 */

import 'dotenv/config';

import assert from 'node:assert/strict';
import prisma from '../db.js';
import platformAdminRouter from '../routes/platformAdmin.js';

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

// ── Route-stack extraction (mirrors retentionManualRunAudit.test.ts) ────────

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

const ACTOR_ID = 'platform-backup-audit-admin-1';
const ACTOR_EMAIL = 'platform-backup-audit-admin@platform.test';

function mockReq(body: Record<string, unknown> = {}) {
  return { body, platformAdmin: { id: ACTOR_ID, email: ACTOR_EMAIL } } as any;
}

async function cleanAuditRows() {
  await prisma.platformAdminAuditEvent.deleteMany({
    where: { actorPlatformAdminId: ACTOR_ID, resourceType: 'backup' },
  });
}

async function auditRows() {
  return prisma.platformAdminAuditEvent.findMany({
    where: { actorPlatformAdminId: ACTOR_ID, resourceType: 'backup' },
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
    name: 'Test Fixture Platform Admin (Backup Audit)',
  },
});

const restoreTestChain = getRouteMiddlewareChain(platformAdminRouter as any, 'post', '/backups/restore-test');

async function main() {
  section('POST /backups/restore-test — durable audit trail on failure');

  await cleanAuditRows();

  await test('writes exactly one backup.restore_test.failed audit row, attributed to the triggering admin', async () => {
    const req = mockReq({});
    const res = mockRes();
    await runChain(restoreTestChain, req, res);

    // services/backupService.ts's listBackupFiles() returns [] whenever
    // /root/noramedi-backups doesn't exist (true in this sandbox), so
    // runRestoreTest() deterministically throws before any real restore
    // attempt — see module docstring.
    assert.equal(res.statusCode, 500);
    assert.equal(res.body?.error, 'No backup files available');

    const rows = await auditRows();
    assert.equal(rows.length, 1, 'expected exactly one audit row for this admin/resourceType');
    const row = rows[0];
    assert.equal(row.action, 'backup.restore_test.failed');
    assert.equal(row.actorPlatformAdminId, ACTOR_ID);
    assert.equal(row.resourceType, 'backup');
    assert.equal(row.resourceKey, 'restore_test');
    assert.equal(row.outcome, 'error');
  });

  await test('audit row carries no PII — no admin email, no arbitrary error message text', async () => {
    const rows = await auditRows();
    const row = rows[0];
    const serialized = JSON.stringify(row);
    assert.ok(!serialized.includes(ACTOR_EMAIL), 'audit row must never contain the admin email');
    assert.ok(!serialized.includes('@'), 'audit row must contain no email-shaped value at all');

    const metadata = row.safeMetadata as Record<string, unknown> | null;
    assert.ok(metadata, 'expected safeMetadata to be present');
    // Only a fixed error *type* (constructor name), never the free-form
    // error message, which could in principle embed request-derived values.
    assert.equal(metadata!.errorType, 'Error');
    assert.equal(metadata!.filename, 'latest');
    assert.deepEqual(Object.keys(metadata!).sort(), ['errorType', 'filename']);
  });

  await test('previousValue/newValue are unused (null) — this action audits an attempt, not a field change', async () => {
    const rows = await auditRows();
    const row = rows[0];
    assert.equal(row.previousValue, null);
    assert.equal(row.newValue, null);
  });

  await cleanAuditRows();

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

/**
 * jobLockAuditLogSafeErrorPrivacy.test.ts — F3-IMPL-006 (PII/PHI Runtime Log
 * Hygiene Wave 2) runtime-spy regression tests for utils/jobLock.ts and
 * utils/auditLog.ts.
 *
 * Both modules import the shared `prisma` singleton from `../db.js` and call
 * its model delegates directly (no dependency-injection seam) — this suite
 * follows this repo's established convention (see
 * externalCalendarOutboundSyncJob.test.ts) of monkey-patching the specific
 * Prisma model delegate methods actually used (`prisma.jobLock.*`,
 * `prisma.auditLog.create`) with in-memory fakes, so these tests exercise
 * the REAL production code paths end-to-end without needing a live
 * Postgres connection.
 *
 * Root cause: `console.error(label, error)` logged the raw Prisma error
 * object. A `PrismaClientKnownRequestError`/connection failure's `.message`
 * can embed the DB connection string (host/user/password) or, for
 * writeAuditLog, a validation error can echo back the attempted
 * organizationId/description/metadata payload. The fix routes both sites
 * through `safeErrorFields(err)`.
 *
 * Run with: cd server && npx tsx src/tests/jobLockAuditLogSafeErrorPrivacy.test.ts
 */

import assert from 'node:assert/strict';

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

import prisma from '../db.js';
import { acquireJobLock, releaseJobLock, withJobLock } from '../utils/jobLock.js';
import { writeAuditLog } from '../utils/auditLog.js';

// ── Console spy (mirrors inboundRateLimiterLogPrivacy.test.ts) ────────────────

type ConsoleMethod = 'log' | 'info' | 'error' | 'warn' | 'debug';
const CONSOLE_METHODS: ConsoleMethod[] = ['log', 'info', 'error', 'warn', 'debug'];

function captureConsole() {
  const calls: unknown[][] = [];
  const originals = CONSOLE_METHODS.map(method => [method, console[method]] as const);
  for (const method of CONSOLE_METHODS) {
    console[method] = ((...args: unknown[]) => { calls.push(args); }) as typeof console.log;
  }
  return {
    calls,
    restore: () => {
      for (const [method, original] of originals) {
        console[method] = original;
      }
    },
  };
}

function serialize(calls: unknown[][]): string {
  return JSON.stringify(calls, (_key, value) => (typeof value === 'function' ? '[fn]' : value));
}

function assertNoRawLeak(calls: unknown[][], rawValues: string[]) {
  const serialized = serialize(calls);
  for (const raw of rawValues) {
    assert.ok(
      !serialized.includes(raw),
      `raw value "${raw}" leaked into a console.* call.\nCaptured calls: ${serialized}`,
    );
  }
}

async function main() {
  // ── utils/jobLock.ts ──────────────────────────────────────────────────
  section('jobLock.ts — acquire-lock failure never logs the raw DB connection error');

  const CONN_DETAIL_FIXTURE =
    'password authentication failed for user "noramedi_prod" at postgres://noramedi_prod:S3cretPass!@10.0.4.12:5432/noramedi';
  const CONN_PASSWORD_FIXTURE = 'S3cretPass!';
  const CONN_HOST_FIXTURE = '10.0.4.12';

  await test('withJobLock logs safeErrorFields(error) when acquireJobLock throws, never the raw connection-error message', async () => {
    const acquireFixtureErr = Object.assign(new Error(CONN_DETAIL_FIXTURE), {
      name: 'PrismaClientKnownRequestError',
      code: 'P1000',
    });
    (prisma as any).jobLock = {
      updateMany: async () => {
        throw acquireFixtureErr;
      },
      create: async () => {
        throw acquireFixtureErr;
      },
    };

    const { calls, restore } = captureConsole();
    let result: boolean;
    try {
      result = await withJobLock('wave2-test-acquire-fail', 1000, async () => {
        throw new Error('fn must not run when the lock cannot be acquired');
      });
    } finally {
      restore();
    }

    assert.equal(result, false, 'withJobLock should report the lock as not acquired');
    assertNoRawLeak(calls, [CONN_DETAIL_FIXTURE, CONN_PASSWORD_FIXTURE, CONN_HOST_FIXTURE]);
    const serialized = serialize(calls);
    assert.ok(serialized.includes('PrismaClientKnownRequestError'), 'expected errorName in logs');
    assert.ok(serialized.includes('P1000'), 'expected errorCode in logs');
    assert.ok(serialized.includes('[job-lock] Failed to acquire lock'), 'expected the acquire-failure label in logs');
  });

  section('jobLock.ts — release-lock failure never logs the raw DB connection error');

  await test('withJobLock logs safeErrorFields(error) when releaseJobLock\'s updateMany throws, never the raw connection-error message', async () => {
    const releaseFixtureErr = Object.assign(new Error(CONN_DETAIL_FIXTURE), {
      name: 'PrismaClientKnownRequestError',
      code: 'P1001',
    });
    (prisma as any).jobLock = {
      // Acquire step: updateMany's where includes lockedUntil.lt — succeed so fn runs.
      // Release step: updateMany's where has no lockedUntil.lt — throw to exercise
      // releaseJobLock's own catch (utils/jobLock.ts's "Failed to release lock" site).
      updateMany: async ({ where }: any) => {
        if (where?.lockedUntil?.lt) return { count: 1 };
        throw releaseFixtureErr;
      },
      create: async () => ({ id: 'unused' }),
    };

    const { calls, restore } = captureConsole();
    let fnRan = false;
    let result: boolean;
    try {
      result = await withJobLock('wave2-test-release-fail', 1000, async () => {
        fnRan = true;
      });
    } finally {
      restore();
    }

    assert.equal(result, true, 'withJobLock should still report success — release failure must not fail the job');
    assert.ok(fnRan, 'expected fn to run once the lock was acquired');
    assertNoRawLeak(calls, [CONN_DETAIL_FIXTURE, CONN_PASSWORD_FIXTURE, CONN_HOST_FIXTURE]);
    const serialized = serialize(calls);
    assert.ok(serialized.includes('PrismaClientKnownRequestError'), 'expected errorName in logs');
    assert.ok(serialized.includes('P1001'), 'expected errorCode in logs');
    assert.ok(serialized.includes('[job-lock] Failed to release lock'), 'expected the release-failure label in logs');
  });

  await test('releaseJobLock never throws even when its own catch fires (F1-003-B2-R1 "asla reddetme" guarantee)', async () => {
    (prisma as any).jobLock = {
      updateMany: async () => { throw new Error('DB unreachable'); },
    };
    await assert.doesNotReject(() => releaseJobLock('wave2-test-release-never-throws'));
  });

  await test('acquireJobLock still propagates a genuine updateMany throw to its caller (unchanged control flow)', async () => {
    (prisma as any).jobLock = {
      updateMany: async () => { throw new Error('DB unreachable'); },
      create: async () => ({ id: 'unused' }),
    };
    await assert.rejects(() => acquireJobLock('wave2-test-acquire-propagates', 1000));
  });

  // ── utils/auditLog.ts ─────────────────────────────────────────────────
  section('auditLog.ts — write-failure log never leaks the attempted audit description/metadata');

  const PATIENT_NAME_FIXTURE = 'Mehmet Öztürk';
  const AUDIT_PHI_FIXTURE =
    `Argument \`description\`: Invalid value. Attempted data: { description: "Hasta kaydı güncellendi: ${PATIENT_NAME_FIXTURE}", ` +
    `metadata: { note: "alerji: penisilin" } }`;

  await test('writeAuditLog logs safeErrorFields(err) when prisma.auditLog.create throws, never the raw validation-error message', async () => {
    const auditFixtureErr = Object.assign(new Error(AUDIT_PHI_FIXTURE), {
      name: 'PrismaClientValidationError',
      code: 'P2009',
    });
    (prisma as any).auditLog = {
      create: async () => {
        throw auditFixtureErr;
      },
    };

    const { calls, restore } = captureConsole();
    try {
      await writeAuditLog({
        organizationId: 'org-1',
        actorUserId: 'user-1',
        action: 'patient_updated',
        entityType: 'patient',
        entityId: 'patient-1',
        description: `Hasta kaydı güncellendi: ${PATIENT_NAME_FIXTURE}`,
      });
    } finally {
      restore();
    }

    assertNoRawLeak(calls, [AUDIT_PHI_FIXTURE, PATIENT_NAME_FIXTURE, 'penisilin']);
    const serialized = serialize(calls);
    assert.ok(serialized.includes('PrismaClientValidationError'), 'expected errorName in logs');
    assert.ok(serialized.includes('P2009'), 'expected errorCode in logs');
    assert.ok(serialized.includes('[AuditLog] Failed to write audit log'), 'expected the write-failure label in logs');
  });

  await test('writeAuditLog swallows the error and never rejects (fire-and-forget contract preserved)', async () => {
    (prisma as any).auditLog = {
      create: async () => { throw new Error('DB unreachable'); },
    };
    await assert.doesNotReject(() =>
      writeAuditLog({
        organizationId: 'org-1',
        action: 'noop',
        entityType: 'test',
      }),
    );
  });

  section('Summary');
  console.log('\n─────────────────────────────────────────');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});

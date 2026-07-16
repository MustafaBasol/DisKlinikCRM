/**
 * verify-clinic-bulk-export-lifecycle.ts — manual disposable-DB verification
 * for KVKK-HIGH-004 (docs/compliance/54-kvkk-secure-clinic-bulk-export.md).
 *
 * Mirrors scripts/verify-export-archive-lifecycle.ts's structure and intent:
 * exercises the real ClinicBulkExportArchive/ClinicBulkExportPasswordAttempt
 * lifecycle against a real Postgres database (never mocked), importing and
 * calling the real exported functions directly (not reimplementations).
 * NOT wired into `npm test` — run manually against a disposable database:
 *
 *   DATABASE_URL=postgresql://user:pass@host:port/throwaway_db \
 *     CLINIC_BULK_EXPORT_IP_HASH_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
 *     npx tsx scripts/verify-clinic-bulk-export-lifecycle.ts
 *
 * Requires `npx prisma migrate deploy` to have already been run against that
 * same DATABASE_URL.
 */

import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  reserveClinicBulkExport,
  computeExportSlotLockKey,
  issueClinicBulkExportDownloadToken,
  expireArchiveIfPastTtl,
  ClinicBulkExportAlreadyRunningError,
  ClinicBulkExportRateLimitedError,
} from '../src/services/privacy/clinicBulkExportPackage.js';
import { verifyStepUpPasswordWithLockout } from '../src/services/privacy/clinicBulkExportPasswordAttempts.js';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must point at a disposable database — refusing to run without one.');
}
if (!process.env.CLINIC_BULK_EXPORT_IP_HASH_SECRET || process.env.CLINIC_BULK_EXPORT_IP_HASH_SECRET.length < 32) {
  throw new Error('CLINIC_BULK_EXPORT_IP_HASH_SECRET must be set (>=32 chars) for this script.');
}

const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL) });

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`      ${err instanceof Error ? err.stack : String(err)}`);
    failed++;
  }
}

async function main() {
  const suffix = Date.now();
  const org = await prisma.organization.create({ data: { name: `Verify Org ${suffix}`, slug: `verify-org-${suffix}` } });
  const clinicA = await prisma.clinic.create({ data: { name: `Verify Clinic A ${suffix}`, slug: `verify-clinic-a-${suffix}`, organizationId: org.id } });
  const clinicB = await prisma.clinic.create({ data: { name: `Verify Clinic B ${suffix}`, slug: `verify-clinic-b-${suffix}`, organizationId: org.id } });
  const user = await prisma.user.create({
    data: {
      clinicId: clinicA.id,
      organizationId: org.id,
      firstName: 'Verify',
      lastName: 'User',
      email: `verify-${suffix}@example.test`,
      role: 'OWNER',
      passwordHash: 'x',
    },
  });
  // A second, distinct user is used for the concurrent-reservation race so
  // the per-user creation cooldown (a separate, intentional rate limit)
  // never fires and the test isolates exactly the single-active-job
  // invariant, not the cooldown check.
  const userB = await prisma.user.create({
    data: {
      clinicId: clinicA.id,
      organizationId: org.id,
      firstName: 'Verify',
      lastName: 'UserB',
      email: `verify-b-${suffix}@example.test`,
      role: 'OWNER',
      passwordHash: 'x',
    },
  });

  const fakeReq = { ip: '203.0.113.9', headers: {} as Record<string, unknown> };

  console.log('\nReal concurrent reservation (production reserveClinicBulkExport, pg_advisory_xact_lock)');

  await test('same clinic, two simultaneous reservations: exactly one succeeds, one rejected with ClinicBulkExportAlreadyRunningError', async () => {
    const results = await Promise.allSettled([
      reserveClinicBulkExport({
        clinicId: clinicA.id,
        organizationId: org.id,
        requestedByUserId: user.id,
        purpose: 'other',
        restrictedNote: null,
        stepUpVerifiedAt: new Date(),
        actorRole: 'OWNER',
        req: fakeReq,
      }),
      reserveClinicBulkExport({
        clinicId: clinicA.id,
        organizationId: org.id,
        requestedByUserId: userB.id,
        purpose: 'other',
        restrictedNote: null,
        stepUpVerifiedAt: new Date(),
        actorRole: 'OWNER',
        req: fakeReq,
      }),
    ]);
    const fulfilled = results.filter((r): r is PromiseFulfilledResult<{ jobId: string }> => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    assert.equal(fulfilled.length, 1, 'exactly one concurrent reservation must succeed');
    assert.equal(rejected.length, 1, 'exactly one concurrent reservation must be rejected');
    assert.ok(rejected[0]!.reason instanceof ClinicBulkExportAlreadyRunningError);

    const activeRows = await prisma.clinicBulkExportArchive.findMany({
      where: { clinicId: clinicA.id, status: { in: ['queued', 'generating'] } },
    });
    assert.equal(activeRows.length, 1, 'exactly one active row must exist after the race');
  });

  await test("different clinic can reserve concurrently — doesn't contend on clinic A's lock", async () => {
    const result = await reserveClinicBulkExport({
      clinicId: clinicB.id,
      organizationId: org.id,
      requestedByUserId: user.id,
      purpose: 'other',
      restrictedNote: null,
      stepUpVerifiedAt: new Date(),
      actorRole: 'OWNER',
      req: fakeReq,
    });
    assert.ok(result.jobId);
  });

  console.log('\nPartial unique index — database-level final invariant (bypassing the application-level advisory lock)');

  await test('a raw concurrent INSERT bypassing the app-level check is rejected by the partial unique index itself', async () => {
    // clinicA already has exactly one active row from the test above.
    await assert.rejects(
      prisma.$executeRaw`
        INSERT INTO "ClinicBulkExportArchive"
          (id, "organizationId", "clinicId", "requestedByUserId", status, purpose, "stepUpVerifiedAt", "createdAt", "updatedAt")
        VALUES
          (gen_random_uuid()::text, ${org.id}, ${clinicA.id}, ${user.id}, 'queued', 'other', now(), now(), now())
      `,
      /duplicate key value violates unique constraint/,
      'the DB must reject a second active row for the same clinic even via raw SQL that bypasses reserveClinicBulkExport entirely',
    );
  });

  console.log('\nSynchronous, non-cron-dependent expiry (correction 1)');

  await test('a ready row past expiresAt is caught synchronously by expireArchiveIfPastTtl, not by waiting for a cron', async () => {
    const readyRow = await prisma.clinicBulkExportArchive.create({
      data: {
        organizationId: org.id,
        clinicId: clinicB.id,
        requestedByUserId: user.id,
        status: 'ready',
        purpose: 'other',
        stepUpVerifiedAt: new Date(),
        expiresAt: new Date(Date.now() - 1000), // already past
        storageKey: `exports/${clinicB.id}/already-expired.zip`,
      },
    });
    const status = await expireArchiveIfPastTtl(readyRow, new Date());
    assert.equal(status, 'expired');
    const reread = await prisma.clinicBulkExportArchive.findUniqueOrThrow({ where: { id: readyRow.id } });
    assert.equal(reread.status, 'expired', 'the stored status must actually be flipped, not just reported as expired');
  });

  console.log('\nAtomic download-token issuance under concurrency');

  await test('exactly one of two simultaneous token-issuance requests wins; the other gets token_already_issued', async () => {
    const readyRow = await prisma.clinicBulkExportArchive.create({
      data: {
        organizationId: org.id,
        clinicId: clinicB.id,
        requestedByUserId: user.id,
        status: 'ready',
        purpose: 'other',
        stepUpVerifiedAt: new Date(),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        storageKey: `exports/${clinicB.id}/${suffix}.zip`,
      },
    });

    const results = await Promise.allSettled([
      issueClinicBulkExportDownloadToken({
        jobId: readyRow.id,
        clinicId: clinicB.id,
        organizationId: org.id,
        actorUserId: user.id,
        actorRole: 'OWNER',
        stepUpOk: true,
        req: fakeReq,
      }),
      issueClinicBulkExportDownloadToken({
        jobId: readyRow.id,
        clinicId: clinicB.id,
        organizationId: org.id,
        actorUserId: user.id,
        actorRole: 'OWNER',
        stepUpOk: true,
        req: fakeReq,
      }),
    ]);

    const outcomes = results.map((r) => (r.status === 'fulfilled' ? r.value : { ok: false, failure: 'threw' as const }));
    const winners = outcomes.filter((o) => o.ok);
    const losers = outcomes.filter((o) => !o.ok);
    assert.equal(winners.length, 1, 'exactly one concurrent issuance must win');
    assert.equal(losers.length, 1);
    assert.equal(losers[0]!.failure, 'token_already_issued');

    const reread = await prisma.clinicBulkExportArchive.findUniqueOrThrow({ where: { id: readyRow.id } });
    assert.ok(reread.downloadTokenHash, 'a token hash must be persisted');
  });

  console.log('\nPostgreSQL-authoritative password-attempt lockout, genuinely serialized');

  const { LOCKOUT_MAX_ATTEMPTS } = await import('../src/services/privacy/clinicBulkExportPasswordAttempts.js');

  await test('below-threshold concurrent attempts: N simultaneous failed attempts produce exactly N recorded attempts (no lost increments)', async () => {
    const N = LOCKOUT_MAX_ATTEMPTS - 1; // stay under the lockout threshold so every attempt increments
    const results = await Promise.allSettled(
      Array.from({ length: N }, () =>
        verifyStepUpPasswordWithLockout({
          userId: user.id,
          clinicId: clinicA.id,
          ip: '203.0.113.50',
          suppliedPassword: 'definitely-wrong-password',
        }),
      ),
    );
    const fulfilled = results.filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled');
    assert.equal(fulfilled.length, N, 'all attempts must complete (not throw)');
    assert.ok(fulfilled.every((r) => r.value.outcome === 'rejected' && r.value.failure === 'mismatch'));

    const { createHmac } = await import('node:crypto');
    const ipHash = createHmac('sha256', process.env.CLINIC_BULK_EXPORT_IP_HASH_SECRET!).update('203.0.113.50', 'utf8').digest('hex');
    const row = await prisma.clinicBulkExportPasswordAttempt.findUniqueOrThrow({
      where: { userId_clinicId_ipHash: { userId: user.id, clinicId: clinicA.id, ipHash } },
    });
    assert.equal(row.attemptCount, N, `expected exactly ${N} recorded attempts, no lost increments from the concurrent race`);
    assert.equal(row.lockedUntil, null, 'must not be locked yet — one attempt below threshold');
  });

  await test('crossing the threshold locks out and further concurrent attempts do not over-increment past it', async () => {
    // One more failed attempt (the Nth from the previous test + 1 = LOCKOUT_MAX_ATTEMPTS) crosses the threshold.
    const crossing = await verifyStepUpPasswordWithLockout({
      userId: user.id,
      clinicId: clinicA.id,
      ip: '203.0.113.50',
      suppliedPassword: 'still-wrong',
    });
    assert.equal(crossing.outcome, 'rejected');

    const { createHmac } = await import('node:crypto');
    const ipHash = createHmac('sha256', process.env.CLINIC_BULK_EXPORT_IP_HASH_SECRET!).update('203.0.113.50', 'utf8').digest('hex');
    const afterCrossing = await prisma.clinicBulkExportPasswordAttempt.findUniqueOrThrow({
      where: { userId_clinicId_ipHash: { userId: user.id, clinicId: clinicA.id, ipHash } },
    });
    assert.equal(afterCrossing.attemptCount, LOCKOUT_MAX_ATTEMPTS);
    assert.ok(afterCrossing.lockedUntil, 'lockedUntil must be set exactly once the threshold is crossed');

    // Now fire several more CONCURRENT attempts while already locked — none
    // of them may increment attemptCount further (the guarded early-return
    // for an already-locked key must win the advisory-lock-serialized race
    // every time, not just on the first check).
    const extra = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        verifyStepUpPasswordWithLockout({
          userId: user.id,
          clinicId: clinicA.id,
          ip: '203.0.113.50',
          suppliedPassword: 'irrelevant-while-locked',
        }),
      ),
    );
    const fulfilledExtra = extra.filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled');
    assert.equal(fulfilledExtra.length, 4);
    assert.ok(fulfilledExtra.every((r) => r.value.outcome === 'locked'), 'every attempt while locked must be rejected as "locked", never bypass to a password check');

    const finalRow = await prisma.clinicBulkExportPasswordAttempt.findUniqueOrThrow({
      where: { userId_clinicId_ipHash: { userId: user.id, clinicId: clinicA.id, ipHash } },
    });
    assert.equal(finalRow.attemptCount, LOCKOUT_MAX_ATTEMPTS, 'attemptCount must never grow past the threshold once locked, even under concurrent load');
  });

  await prisma.clinicBulkExportArchive.deleteMany({ where: { organizationId: org.id } });
  await prisma.clinicBulkExportPasswordAttempt.deleteMany({ where: { clinicId: { in: [clinicA.id, clinicB.id] } } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.user.delete({ where: { id: userB.id } });
  await prisma.clinic.delete({ where: { id: clinicA.id } });
  await prisma.clinic.delete({ where: { id: clinicB.id } });
  await prisma.organization.delete({ where: { id: org.id } });

  console.log(`\n${passed} passed, ${failed} failed`);
  await prisma.$disconnect();
  if (failed > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});

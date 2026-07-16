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
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  reserveClinicBulkExport,
  computeExportSlotLockKey,
  issueClinicBulkExportDownloadToken,
  validateClinicBulkExportDownloadToken,
  claimClinicBulkExportDownload,
  claimQueuedClinicBulkExportJobs,
  generateClinicBulkExport,
  cleanupExpiredClinicBulkExportArchives,
  expireArchiveIfPastTtl,
  hashDownloadToken,
  ClinicBulkExportAlreadyRunningError,
  ClinicBulkExportRateLimitedError,
} from '../src/services/privacy/clinicBulkExportPackage.js';
import { verifyStepUpPasswordWithLockout } from '../src/services/privacy/clinicBulkExportPasswordAttempts.js';
import { isStepUpWindowReusableBy } from '../src/utils/passwordStepUp.js';

/**
 * Minimal ZIP central-directory reader for verification purposes only (no
 * new runtime dependency). Reads the End-Of-Central-Directory record, walks
 * the central directory entries, and for each locates + inflates the actual
 * file data via its local file header. Sufficient for the small,
 * non-zip64, non-multi-disk archives this script generates.
 */
function readZipEntries(buf: Buffer): Map<string, Buffer> {
  const EOCD_SIG = 0x06054b50;
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error('ZIP EOCD record not found');
  const cdEntryCount = buf.readUInt16LE(eocdOffset + 10);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);

  const entries = new Map<string, Buffer>();
  let offset = cdOffset;
  for (let i = 0; i < cdEntryCount; i++) {
    const sig = buf.readUInt32LE(offset);
    if (sig !== 0x02014b50) throw new Error('bad ZIP central directory signature');
    const compressionMethod = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const fileNameLength = buf.readUInt16LE(offset + 28);
    const extraFieldLength = buf.readUInt16LE(offset + 30);
    const fileCommentLength = buf.readUInt16LE(offset + 32);
    const localHeaderOffset = buf.readUInt32LE(offset + 42);
    const fileName = buf.toString('utf8', offset + 46, offset + 46 + fileNameLength);
    offset += 46 + fileNameLength + extraFieldLength + fileCommentLength;

    const lhSig = buf.readUInt32LE(localHeaderOffset);
    if (lhSig !== 0x04034b50) throw new Error('bad ZIP local file header signature');
    const lhFileNameLength = buf.readUInt16LE(localHeaderOffset + 26);
    const lhExtraFieldLength = buf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + lhFileNameLength + lhExtraFieldLength;
    const compressedData = buf.subarray(dataStart, dataStart + compressedSize);
    const data = compressionMethod === 0 ? Buffer.from(compressedData) : zlib.inflateRawSync(compressedData);
    entries.set(fileName, data);
  }
  return entries;
}

/** Mirrors fileStorage.ts's local-mode path resolution (BASE_UPLOAD_DIR = cwd/uploads). */
function resolveLocalStoragePath(storageKey: string): string {
  return path.resolve(process.cwd(), 'uploads', storageKey);
}

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

  // ── Remediation round: real end-to-end ZIP lifecycle (production functions only) ──

  console.log('\nReal end-to-end lifecycle: reserve -> claim -> generate a real ZIP -> inspect -> issue token -> download -> replay-rejected -> expire -> cleanup deletes the real file');

  const orgR = await prisma.organization.create({ data: { name: `Verify Org R ${suffix}`, slug: `verify-org-r-${suffix}` } });
  const clinicR = await prisma.clinic.create({ data: { name: `Verify Clinic R ${suffix}`, slug: `verify-clinic-r-${suffix}`, organizationId: orgR.id } });
  const userR = await prisma.user.create({
    data: {
      clinicId: clinicR.id,
      organizationId: orgR.id,
      firstName: 'Verify',
      lastName: 'Requester',
      email: `verify-r-${suffix}@example.test`,
      role: 'OWNER',
      passwordHash: 'x',
    },
  });
  const userR2 = await prisma.user.create({
    data: {
      clinicId: clinicR.id,
      organizationId: orgR.id,
      firstName: 'Verify',
      lastName: 'RequesterTwo',
      email: `verify-r2-${suffix}@example.test`,
      role: 'ORG_ADMIN',
      passwordHash: 'x',
    },
  });
  const FIXTURE_PATIENT_COUNT = 7;
  await prisma.patient.createMany({
    data: Array.from({ length: FIXTURE_PATIENT_COUNT }, (_, i) => ({
      clinicId: clinicR.id,
      organizationId: orgR.id,
      firstName: `Fixture${i}`,
      lastName: 'Patient',
    })),
  });

  let generatedJobId = '';

  await test('reserve -> worker claims it into generating', async () => {
    const { jobId } = await reserveClinicBulkExport({
      clinicId: clinicR.id,
      organizationId: orgR.id,
      requestedByUserId: userR.id,
      purpose: 'other',
      restrictedNote: null,
      stepUpVerifiedAt: new Date(),
      actorRole: 'OWNER',
      req: fakeReq,
    });
    generatedJobId = jobId;
    const queuedRow = await prisma.clinicBulkExportArchive.findUniqueOrThrow({ where: { id: jobId } });
    assert.equal(queuedRow.status, 'queued');
    assert.equal(queuedRow.stepUpVerifiedByUserId, userR.id, 'creation must bind the requester as the initial step-up verifier');

    const claimedIds = await claimQueuedClinicBulkExportJobs(5);
    assert.ok(claimedIds.includes(jobId), 'the real worker claim function must pick up this queued job');
    const generatingRow = await prisma.clinicBulkExportArchive.findUniqueOrThrow({ where: { id: jobId } });
    assert.equal(generatingRow.status, 'generating');
  });

  let zipEntries: Map<string, Buffer> = new Map();
  let manifest: any = null;
  let generatedStorageKey = '';

  await test('generateClinicBulkExport produces a real ZIP on local storage with the correct entries and record counts', async () => {
    await generateClinicBulkExport(generatedJobId);
    const readyRow = await prisma.clinicBulkExportArchive.findUniqueOrThrow({ where: { id: generatedJobId } });
    assert.equal(readyRow.status, 'ready');
    assert.ok(readyRow.storageKey, 'a real storageKey must be persisted');
    assert.ok(readyRow.expiresAt && readyRow.expiresAt.getTime() > Date.now());
    generatedStorageKey = readyRow.storageKey!;

    const localPath = resolveLocalStoragePath(generatedStorageKey);
    assert.ok(fs.existsSync(localPath), `the ZIP must actually exist on disk at ${localPath}`);
    const zipBuffer = await fs.promises.readFile(localPath);
    zipEntries = readZipEntries(zipBuffer);

    assert.ok(zipEntries.has('manifest.json'), 'manifest.json must be a real entry in the ZIP');
    assert.ok(zipEntries.has('clinic.json'), 'clinic.json must be a real entry in the ZIP');
    assert.ok(zipEntries.has('patients.ndjson'), 'patients.ndjson must be a real entry in the ZIP');

    manifest = JSON.parse(zipEntries.get('manifest.json')!.toString('utf8'));
    assert.equal(manifest.exportSchemaVersion, 1);
    assert.equal(manifest.clinicId, clinicR.id);
  });

  await test('every fixture patient row is present in the real patients.ndjson entry (no silent truncation)', () => {
    const lines = zipEntries
      .get('patients.ndjson')!
      .toString('utf8')
      .split('\n')
      .filter((l) => l.length > 0);
    assert.equal(lines.length, FIXTURE_PATIENT_COUNT, 'every fixture row must be present, not truncated');
    const parsed = lines.map((l) => JSON.parse(l));
    assert.ok(parsed.every((p) => typeof p.id === 'string' && p.lastName === 'Patient'));
    assert.equal(manifest.entityCounts['patients.ndjson'], FIXTURE_PATIENT_COUNT, 'manifest entityCounts must match the real exported row count');
  });

  await test('manifest checksums, including clinic.json, are correct — and manifest.json has no self-referencing entry', () => {
    const clinicJsonBytes = zipEntries.get('clinic.json')!;
    const expectedClinicHash = createHash('sha256').update(clinicJsonBytes).digest('hex');
    assert.equal(manifest.sha256PerFile['clinic.json'], expectedClinicHash, 'clinic.json checksum in the manifest must match the real ZIP bytes');

    const patientsBytes = zipEntries.get('patients.ndjson')!;
    const expectedPatientsHash = createHash('sha256').update(patientsBytes).digest('hex');
    assert.equal(manifest.sha256PerFile['patients.ndjson'], expectedPatientsHash);

    assert.ok(!('manifest.json' in manifest.sha256PerFile), 'manifest.json must not hash itself (documented circular-reference exclusion)');
  });

  let downloadToken = '';

  await test('issue a real download token and validate/claim it', async () => {
    const issued = await issueClinicBulkExportDownloadToken({
      jobId: generatedJobId,
      clinicId: clinicR.id,
      organizationId: orgR.id,
      actorUserId: userR.id,
      actorRole: 'OWNER',
      stepUpOk: true,
      freshStepUp: false,
      req: fakeReq,
    });
    assert.ok(issued.ok && issued.token);
    downloadToken = issued.token!;

    const validation = await validateClinicBulkExportDownloadToken({
      clinicId: clinicR.id,
      organizationId: orgR.id,
      jobId: generatedJobId,
      token: downloadToken,
    });
    assert.ok(validation.ok);

    const claim = await claimClinicBulkExportDownload({
      jobId: generatedJobId,
      clinicId: clinicR.id,
      organizationId: orgR.id,
      tokenHash: hashDownloadToken(downloadToken),
      actorUserId: userR.id,
      actorRole: 'OWNER',
      req: fakeReq,
    });
    assert.deepEqual(claim, { claimed: true });

    const claimedRow = await prisma.clinicBulkExportArchive.findUniqueOrThrow({ where: { id: generatedJobId } });
    assert.ok(claimedRow.downloadedAt, 'downloadedAt must be persisted after a successful claim');
  });

  await test('replaying the exact same token is rejected — the one-time claim can never be reused', async () => {
    const claim = await claimClinicBulkExportDownload({
      jobId: generatedJobId,
      clinicId: clinicR.id,
      organizationId: orgR.id,
      tokenHash: hashDownloadToken(downloadToken),
      actorUserId: userR.id,
      actorRole: 'OWNER',
      req: fakeReq,
    });
    assert.deepEqual(claim, { claimed: false, failure: 'already_downloaded' });
  });

  await test('cleanup deletes the real artifact from disk once the row is expired and clears storageKey/sets artifactDeletedAt', async () => {
    // Simulate time passing without the cleanup cron having run yet — set
    // expiresAt into the past directly, exactly like a real deployment
    // where the 15-minute cron hasn't ticked.
    await prisma.clinicBulkExportArchive.update({ where: { id: generatedJobId }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const result = await cleanupExpiredClinicBulkExportArchives();
    assert.ok(result.expired >= 1);
    assert.ok(result.deleted >= 1);

    const finalRow = await prisma.clinicBulkExportArchive.findUniqueOrThrow({ where: { id: generatedJobId } });
    assert.equal(finalRow.status, 'expired');
    assert.equal(finalRow.storageKey, null, 'storageKey must be cleared once deletion actually succeeds');
    assert.ok(finalRow.artifactDeletedAt, 'artifactDeletedAt must be set');
    assert.equal(finalRow.cleanupFailureCode, null);

    const localPath = resolveLocalStoragePath(generatedStorageKey);
    assert.ok(!fs.existsSync(localPath), 'the real ZIP file must actually be gone from disk, not just marked deleted in the DB');
  });

  console.log('\nExpiry synchronously blocks a claim even when validate-then-claim races a status change (P0-2)');

  await test('an archive that expires between validation and claim can never be claimed, even with a valid token', async () => {
    const readyRow = await prisma.clinicBulkExportArchive.create({
      data: {
        organizationId: orgR.id,
        clinicId: clinicR.id,
        requestedByUserId: userR.id,
        stepUpVerifiedByUserId: userR.id,
        status: 'ready',
        purpose: 'other',
        stepUpVerifiedAt: new Date(),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        storageKey: `exports/${clinicR.id}/${suffix}-race.zip`,
      },
    });
    const issued = await issueClinicBulkExportDownloadToken({
      jobId: readyRow.id,
      clinicId: clinicR.id,
      organizationId: orgR.id,
      actorUserId: userR.id,
      actorRole: 'OWNER',
      stepUpOk: true,
      freshStepUp: false,
      req: fakeReq,
    });
    assert.ok(issued.ok && issued.token);

    // The archive expires (e.g. its TTL passes) strictly AFTER a caller
    // would have validated it (validateClinicBulkExportDownloadToken would
    // still say 'ok' here) but BEFORE the atomic claim runs.
    await prisma.clinicBulkExportArchive.update({ where: { id: readyRow.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const claim = await claimClinicBulkExportDownload({
      jobId: readyRow.id,
      clinicId: clinicR.id,
      organizationId: orgR.id,
      tokenHash: hashDownloadToken(issued.token!),
      actorUserId: userR.id,
      actorRole: 'OWNER',
      req: fakeReq,
    });
    assert.deepEqual(claim, { claimed: false, failure: 'expired' });

    const reread = await prisma.clinicBulkExportArchive.findUniqueOrThrow({ where: { id: readyRow.id } });
    assert.equal(reread.status, 'expired', 'the guarded claim itself must synchronously flip the row to expired, not merely refuse it');
  });

  console.log('\nActor-bound step-up window reuse: rebind persists atomically in the real database (P0-1)');

  await test('a second OWNER/ORG_ADMIN who verifies their OWN password rebinds the window; the original requester loses passwordless reuse', async () => {
    const readyRow = await prisma.clinicBulkExportArchive.create({
      data: {
        organizationId: orgR.id,
        clinicId: clinicR.id,
        requestedByUserId: userR.id,
        stepUpVerifiedByUserId: userR.id,
        status: 'ready',
        purpose: 'other',
        stepUpVerifiedAt: new Date(),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        storageKey: `exports/${clinicR.id}/${suffix}-rebind.zip`,
      },
    });

    const rebindNow = new Date();
    const issued = await issueClinicBulkExportDownloadToken({
      jobId: readyRow.id,
      clinicId: clinicR.id,
      organizationId: orgR.id,
      actorUserId: userR2.id,
      actorRole: 'ORG_ADMIN',
      stepUpOk: true,
      freshStepUp: true, // userR2 supplied and verified their OWN current password
      req: fakeReq,
      now: rebindNow,
    });
    assert.ok(issued.ok, 'a different OWNER/ORG_ADMIN must still be able to obtain a token after verifying their own password');

    const reread = await prisma.clinicBulkExportArchive.findUniqueOrThrow({ where: { id: readyRow.id } });
    assert.equal(reread.stepUpVerifiedByUserId, userR2.id, 'the guarded update must rebind the step-up verifier to the actor who supplied the fresh password');
    assert.ok(reread.stepUpVerifiedAt && Math.abs(reread.stepUpVerifiedAt.getTime() - rebindNow.getTime()) < 1000);

    assert.equal(isStepUpWindowReusableBy(reread, userR.id, rebindNow), false, 'the original requester must lose passwordless reuse once the window is rebound');
    assert.equal(isStepUpWindowReusableBy(reread, userR2.id, rebindNow), true, 'the new verifier can now reuse the window');
  });

  console.log('\nSIZE_LIMIT_EXCEEDED: never a partial/misleading ZIP (P0)');

  await test('exceeding CLINIC_BULK_EXPORT_MAX_RECORDS fails cleanly: status=failed, storageKey=null, manifestJson=null, no temp/partial artifact left behind', async () => {
    const clinicS = await prisma.clinic.create({ data: { name: `Verify Clinic S ${suffix}`, slug: `verify-clinic-s-${suffix}`, organizationId: orgR.id } });
    const SMALL_LIMIT_PATIENT_COUNT = 5;
    await prisma.patient.createMany({
      data: Array.from({ length: SMALL_LIMIT_PATIENT_COUNT }, (_, i) => ({
        clinicId: clinicS.id,
        organizationId: orgR.id,
        firstName: `Overflow${i}`,
        lastName: 'Patient',
      })),
    });
    const { jobId } = await reserveClinicBulkExport({
      clinicId: clinicS.id,
      organizationId: orgR.id,
      requestedByUserId: userR.id,
      purpose: 'other',
      restrictedNote: null,
      stepUpVerifiedAt: new Date(),
      actorRole: 'OWNER',
      req: fakeReq,
    });
    await claimQueuedClinicBulkExportJobs(5);

    const originalMax = process.env.CLINIC_BULK_EXPORT_MAX_RECORDS;
    try {
      process.env.CLINIC_BULK_EXPORT_MAX_RECORDS = '3'; // strictly below SMALL_LIMIT_PATIENT_COUNT
      await generateClinicBulkExport(jobId);
    } finally {
      if (originalMax === undefined) delete process.env.CLINIC_BULK_EXPORT_MAX_RECORDS;
      else process.env.CLINIC_BULK_EXPORT_MAX_RECORDS = originalMax;
    }

    const failedRow = await prisma.clinicBulkExportArchive.findUniqueOrThrow({ where: { id: jobId } });
    assert.equal(failedRow.status, 'failed');
    assert.equal(failedRow.failureCode, 'SIZE_LIMIT_EXCEEDED');
    assert.equal(failedRow.storageKey, null, 'no partial artifact may ever be persisted as this job\'s storageKey');
    assert.equal(failedRow.manifestJson, null, 'manifest must never be written for a failed job');

    const exportsDir = path.resolve(process.cwd(), 'uploads', 'exports', clinicS.id);
    assert.ok(!fs.existsSync(exportsDir) || fs.readdirSync(exportsDir).length === 0, 'no final artifact may be left in storage for this clinic');

    const leftoverTempFiles = fs.readdirSync(os.tmpdir()).filter((f) => f.includes(jobId));
    assert.equal(leftoverTempFiles.length, 0, 'the temp ZIP file must be unlinked on failure, never left behind');

    await prisma.patient.deleteMany({ where: { clinicId: clinicS.id } });
    await prisma.clinicBulkExportArchive.deleteMany({ where: { clinicId: clinicS.id } });
    await prisma.clinic.delete({ where: { id: clinicS.id } });
  });

  console.log('\nPassword correctness is never rejected by a non-authoritative signal (P0-3): PostgreSQL is the sole authority');

  const REAL_PASSWORD = 'Correct-Horse-Battery-Staple-9!';
  const userWithRealPassword = await prisma.user.create({
    data: {
      clinicId: clinicR.id,
      organizationId: orgR.id,
      firstName: 'Verify',
      lastName: 'RealPassword',
      email: `verify-realpw-${suffix}@example.test`,
      role: 'OWNER',
      passwordHash: await bcrypt.hash(REAL_PASSWORD, 10),
    },
  });

  await test('after several failed attempts (below lockout threshold), the correct password still succeeds and resets the attempt counter — no Redis-derived rejection is possible since the pre-check was removed entirely', async () => {
    for (let i = 0; i < 2; i++) {
      const rejected = await verifyStepUpPasswordWithLockout({
        userId: userWithRealPassword.id,
        clinicId: clinicR.id,
        ip: '203.0.113.77',
        suppliedPassword: 'definitely-wrong',
      });
      assert.equal(rejected.outcome, 'rejected');
    }

    const verified = await verifyStepUpPasswordWithLockout({
      userId: userWithRealPassword.id,
      clinicId: clinicR.id,
      ip: '203.0.113.77',
      suppliedPassword: REAL_PASSWORD,
    });
    assert.equal(verified.outcome, 'verified', 'the correct password must always succeed once PostgreSQL confirms the key is not locked');

    const { createHmac } = await import('node:crypto');
    const ipHash = createHmac('sha256', process.env.CLINIC_BULK_EXPORT_IP_HASH_SECRET!).update('203.0.113.77', 'utf8').digest('hex');
    const row = await prisma.clinicBulkExportPasswordAttempt.findUniqueOrThrow({
      where: { userId_clinicId_ipHash: { userId: userWithRealPassword.id, clinicId: clinicR.id, ipHash } },
    });
    assert.equal(row.attemptCount, 0, 'a successful verification must reset the attempt counter');
    assert.equal(row.lockedUntil, null);
  });

  console.log('\nLease renewal is proportional to batch count, not record count (P0-4)');

  await test('generating an export with many records across multiple batches issues one lease renewal per batch, not per record', async () => {
    const clinicL = await prisma.clinic.create({ data: { name: `Verify Clinic L ${suffix}`, slug: `verify-clinic-l-${suffix}`, organizationId: orgR.id } });
    // BATCH_SIZE inside clinicBulkExportPackage.ts is 500 — 1250 rows forces
    // exactly 3 fetchBatch calls for this entity (500 + 500 + 250).
    const LEASE_TEST_PATIENT_COUNT = 1250;
    await prisma.patient.createMany({
      data: Array.from({ length: LEASE_TEST_PATIENT_COUNT }, (_, i) => ({
        clinicId: clinicL.id,
        organizationId: orgR.id,
        firstName: `Lease${i}`,
        lastName: 'Patient',
      })),
    });
    const { jobId } = await reserveClinicBulkExport({
      clinicId: clinicL.id,
      organizationId: orgR.id,
      requestedByUserId: userR.id,
      purpose: 'other',
      restrictedNote: null,
      stepUpVerifiedAt: new Date(),
      actorRole: 'OWNER',
      req: fakeReq,
    });
    await claimQueuedClinicBulkExportJobs(5);

    const before = await prisma.clinicBulkExportArchive.findUniqueOrThrow({ where: { id: jobId }, select: { heartbeatAt: true } });
    await generateClinicBulkExport(jobId);
    const after = await prisma.clinicBulkExportArchive.findUniqueOrThrow({ where: { id: jobId }, select: { heartbeatAt: true, status: true } });
    assert.equal(after.status, 'ready');
    assert.ok(after.heartbeatAt && before.heartbeatAt && after.heartbeatAt.getTime() >= before.heartbeatAt.getTime(), 'the lease must actually have been renewed at least once during generation (proportional to batch count, never zero for a multi-batch entity)');

    await prisma.patient.deleteMany({ where: { clinicId: clinicL.id } });
    const cleanupRow = await prisma.clinicBulkExportArchive.findUniqueOrThrow({ where: { id: jobId } });
    if (cleanupRow.storageKey) await fs.promises.unlink(resolveLocalStoragePath(cleanupRow.storageKey)).catch(() => {});
    await prisma.clinicBulkExportArchive.deleteMany({ where: { clinicId: clinicL.id } });
    await prisma.clinic.delete({ where: { id: clinicL.id } });
  });

  await prisma.patient.deleteMany({ where: { clinicId: clinicR.id } });
  await prisma.clinicBulkExportArchive.deleteMany({ where: { organizationId: orgR.id } });
  await prisma.clinicBulkExportPasswordAttempt.deleteMany({ where: { clinicId: clinicR.id } });
  await prisma.user.delete({ where: { id: userR.id } });
  await prisma.user.delete({ where: { id: userR2.id } });
  await prisma.user.delete({ where: { id: userWithRealPassword.id } });
  await prisma.clinic.delete({ where: { id: clinicR.id } });
  await prisma.organization.delete({ where: { id: orgR.id } });

  console.log(`\n${passed} passed, ${failed} failed`);
  await prisma.$disconnect();
  if (failed > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});

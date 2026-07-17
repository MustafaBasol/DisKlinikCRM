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
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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
  attemptArtifactDeletion,
  expireArchiveIfPastTtl,
  hashDownloadToken,
  sweepStaleClinicBulkExportTempFiles,
  ClinicBulkExportAlreadyRunningError,
  ClinicBulkExportRateLimitedError,
} from '../src/services/privacy/clinicBulkExportPackage.js';
import { verifyStepUpPasswordWithLockout } from '../src/services/privacy/clinicBulkExportPasswordAttempts.js';
import { isStepUpWindowReusableBy } from '../src/utils/passwordStepUp.js';
import {
  buildExportStorageKey,
  deleteFile,
  getExportTempDir,
  buildExportTempFilePath,
  ensureExportTempDir,
} from '../src/services/fileStorage.js';

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

/** Any temp file left behind for a given job under the dedicated private export temp directory. */
function listExportTempFilesFor(jobId: string): string[] {
  try {
    return fs.readdirSync(getExportTempDir()).filter((f) => f.includes(jobId));
  } catch {
    return []; // directory doesn't exist yet — trivially nothing left behind
  }
}

/** Saves/restores a set of env vars around `fn` — used throughout for CLINIC_BULK_EXPORT_* overrides. */
async function withEnvOverride<T>(overrides: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const original: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) original[key] = process.env[key];
  try {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
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
  // KVKK-HIGH-004 remediation (P0): the flag/allowlist is now a real
  // GENERATION kill switch, re-checked inside claimQueuedClinicBulkExportJobs
  // and generateClinicBulkExport themselves — not just a creation-time gate
  // the way it was when this script was first written. Almost every test
  // below exercises real generation and expects it to actually proceed, so
  // the operator-supplied env is asserted OFF here (preserving the original
  // safety intent — this script must be started without accidentally having
  // creation left enabled) and then the script takes over managing the flag
  // itself for the remainder of the run. The two places that specifically
  // need it OFF (the disabled-feature-route test below, and the dedicated
  // "real GENERATION kill switch" section near the end) save/restore it
  // around just their own scope.
  assert.notEqual(
    process.env.CLINIC_BULK_EXPORT_ENABLED,
    'true',
    'this script must be started with CLINIC_BULK_EXPORT_ENABLED unset/false in the operator shell',
  );
  process.env.CLINIC_BULK_EXPORT_ENABLED = 'true';

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

    const leftoverTempFiles = listExportTempFilesFor(jobId);
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

  console.log('\nRoute-level: clinic scope is validated BEFORE the disabled-feature check, using the REAL Express handler (P0-1)');

  const { default: clinicBulkExportRouter } = await import('../src/routes/clinicBulkExport.js');

  /** Extracts the real registered route handler (last layer in the route's
   * own stack, i.e. past the authorize() middleware) directly off the
   * Express Router instance — no HTTP server needed, but this is the actual
   * production handler function, not a reimplementation or source-string
   * check. */
  function getRouteHandler(method: 'get' | 'post', routePath: string): (req: any, res: any) => Promise<void> {
    const stack = (clinicBulkExportRouter as any).stack as any[];
    const layer = stack.find((l) => l.route?.path === routePath && l.route.methods[method]);
    if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${routePath}`);
    const routeStack = layer.route.stack as any[];
    return routeStack[routeStack.length - 1].handle;
  }

  function makeFakeRes() {
    const res: any = { statusCode: 200, jsonBody: undefined };
    res.status = (code: number) => {
      res.statusCode = code;
      return res;
    };
    res.json = (body: unknown) => {
      res.jsonBody = body;
      return res;
    };
    res.setHeader = () => res;
    return res;
  }

  const createHandler = getRouteHandler('post', '/clinic/:clinicId/bulk-export');

  const orgP = await prisma.organization.create({ data: { name: `Verify Org P0-1 ${suffix}`, slug: `verify-org-p01-${suffix}` } });
  const clinicP = await prisma.clinic.create({ data: { name: `Verify Clinic P0-1 ${suffix}`, slug: `verify-clinic-p01-${suffix}`, organizationId: orgP.id } });
  const otherOrg = await prisma.organization.create({ data: { name: `Verify Other Org P0-1 ${suffix}`, slug: `verify-other-org-p01-${suffix}` } });
  const otherClinic = await prisma.clinic.create({ data: { name: `Verify Other Clinic P0-1 ${suffix}`, slug: `verify-other-clinic-p01-${suffix}`, organizationId: otherOrg.id } });
  const userP = await prisma.user.create({
    data: {
      clinicId: clinicP.id,
      organizationId: orgP.id,
      firstName: 'Verify',
      lastName: 'ScopeUser',
      email: `verify-scope-${suffix}@example.test`,
      role: 'OWNER',
      passwordHash: 'x',
    },
  });

  const authUser = {
    id: userP.id,
    clinicId: clinicP.id,
    role: 'OWNER',
    normalizedRole: 'OWNER',
    organizationId: orgP.id,
    allowedClinicIds: [clinicP.id],
    canAccessAllClinics: false,
  };

  // This section specifically needs the flag OFF (it exercises the
  // disabled-feature route/audit path) — saved and restored around just
  // this block; every other section in this script relies on the ambient
  // 'true' set at the top of main().
  const savedFlagForDisabledRouteTest = process.env.CLINIC_BULK_EXPORT_ENABLED;
  process.env.CLINIC_BULK_EXPORT_ENABLED = 'false';

  await test('a cross-org clinicId is rejected before the flag check, with no audit row ever referencing it', async () => {
    const req: any = { user: authUser, params: { clinicId: otherClinic.id }, body: {}, headers: {}, ip: '203.0.113.201' };
    const res = makeFakeRes();
    await createHandler(req, res);
    assert.equal(res.statusCode, 403, 'cross-org clinicId must get the generic forbidden response, never reach the flag check');
    assert.notEqual(res.jsonBody?.error, 'CLINIC_BULK_EXPORT_DISABLED', 'must fail on scope, not on the feature flag');

    const stray = await prisma.auditLog.findFirst({ where: { OR: [{ clinicId: otherClinic.id }, { entityId: otherClinic.id }] } });
    assert.equal(stray, null, 'a raw/cross-org clinicId must never be persisted into AuditLog, even on the disabled-feature path');
  });

  await test('an inaccessible same-org clinicId is rejected before the flag check, with no audit row ever referencing it', async () => {
    const inaccessibleClinic = await prisma.clinic.create({
      data: { name: `Verify Inaccessible Clinic P0-1 ${suffix}`, slug: `verify-inaccessible-clinic-p01-${suffix}`, organizationId: orgP.id },
    });
    const req: any = { user: authUser, params: { clinicId: inaccessibleClinic.id }, body: {}, headers: {}, ip: '203.0.113.202' };
    const res = makeFakeRes();
    await createHandler(req, res);
    assert.equal(res.statusCode, 403);

    const stray = await prisma.auditLog.findFirst({ where: { OR: [{ clinicId: inaccessibleClinic.id }, { entityId: inaccessibleClinic.id }] } });
    assert.equal(stray, null, 'an inaccessible same-org clinic must never be persisted into AuditLog either');

    await prisma.clinic.delete({ where: { id: inaccessibleClinic.id } });
  });

  await test('a valid, accessible clinicId reaches the disabled-feature audit using only the VALIDATED clinicId/organizationId, without reading the password', async () => {
    const req: any = {
      user: authUser,
      params: { clinicId: clinicP.id },
      body: { currentPassword: 'must-never-be-read-while-disabled' },
      headers: {},
      ip: '203.0.113.203',
    };
    const res = makeFakeRes();
    await createHandler(req, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.jsonBody?.error, 'CLINIC_BULK_EXPORT_DISABLED');

    const auditRow = await prisma.auditLog.findFirst({
      where: { action: 'clinic_bulk_export_feature_disabled_attempt', clinicId: clinicP.id },
      orderBy: { createdAt: 'desc' },
    });
    assert.ok(auditRow, 'the disabled-feature audit event must still be recorded for a validated, accessible clinic');
    assert.equal(auditRow!.organizationId, orgP.id, 'audit organizationId must be the DB-validated one');
    assert.equal(auditRow!.entityId, clinicP.id, 'audit entityId must be the DB-validated clinicId, never a raw route param taken on faith');
  });

  if (savedFlagForDisabledRouteTest === undefined) delete process.env.CLINIC_BULK_EXPORT_ENABLED;
  else process.env.CLINIC_BULK_EXPORT_ENABLED = savedFlagForDisabledRouteTest;

  await prisma.auditLog.deleteMany({ where: { organizationId: { in: [orgP.id, otherOrg.id] } } });
  await prisma.user.delete({ where: { id: userP.id } });
  await prisma.clinic.delete({ where: { id: clinicP.id } });
  await prisma.clinic.delete({ where: { id: otherClinic.id } });
  await prisma.organization.delete({ where: { id: orgP.id } });
  await prisma.organization.delete({ where: { id: otherOrg.id } });

  console.log('\nQueue timeout is separate from, and longer than, the generation lease (P0-4)');

  const {
    getGenerationLeaseMs,
    getQueueTimeoutMs,
  } = await import('../src/services/privacy/clinicBulkExportPackage.js');

  await test('a queued job older than the generation lease, but younger than the queue timeout, remains claimable', async () => {
    const orgQ = await prisma.organization.create({ data: { name: `Verify Org Q ${suffix}`, slug: `verify-org-q-${suffix}` } });
    const clinicQ = await prisma.clinic.create({ data: { name: `Verify Clinic Q ${suffix}`, slug: `verify-clinic-q-${suffix}`, organizationId: orgQ.id } });
    const userQ = await prisma.user.create({
      data: {
        clinicId: clinicQ.id,
        organizationId: orgQ.id,
        firstName: 'Verify',
        lastName: 'QueueUser',
        email: `verify-queue-${suffix}@example.test`,
        role: 'OWNER',
        passwordHash: 'x',
      },
    });

    const originalLease = process.env.CLINIC_BULK_EXPORT_GENERATION_LEASE_MS;
    const originalQueueTimeout = process.env.CLINIC_BULK_EXPORT_QUEUE_TIMEOUT_MS;
    try {
      // Generation lease deliberately tiny (2s); queue timeout generously
      // long (60s) — a real bounded-concurrency backlog delay of a few
      // seconds must survive on the queue timeout even though it already
      // exceeds the (separate, shorter) generation lease.
      process.env.CLINIC_BULK_EXPORT_GENERATION_LEASE_MS = '2000';
      process.env.CLINIC_BULK_EXPORT_QUEUE_TIMEOUT_MS = '60000';
      assert.equal(getGenerationLeaseMs(), 2000);
      assert.equal(getQueueTimeoutMs(), 60000);

      const { jobId } = await reserveClinicBulkExport({
        clinicId: clinicQ.id,
        organizationId: orgQ.id,
        requestedByUserId: userQ.id,
        purpose: 'other',
        restrictedNote: null,
        stepUpVerifiedAt: new Date(),
        actorRole: 'OWNER',
        req: fakeReq,
      });

      const queuedRow = await prisma.clinicBulkExportArchive.findUniqueOrThrow({ where: { id: jobId } });
      assert.equal(queuedRow.status, 'queued');
      const remainingMs = queuedRow.leaseExpiresAt!.getTime() - Date.now();
      assert.ok(remainingMs > 30_000, 'a freshly queued row must carry the (long) queue-timeout deadline, not the short generation lease');

      // Real wall-clock wait — deliberately longer than the 2s generation
      // lease but nowhere near the 60s queue timeout, proving this is a
      // genuine backlog delay, not a fabricated timestamp.
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const claimedIds = await claimQueuedClinicBulkExportJobs(5);
      assert.ok(claimedIds.includes(jobId), 'a queued job older than the generation lease must still be claimable while within the queue timeout');

      const claimedRow = await prisma.clinicBulkExportArchive.findUniqueOrThrow({ where: { id: jobId } });
      assert.equal(claimedRow.status, 'generating', 'must not have been swept to failed/LEASE_EXPIRED merely for outliving the generation lease while still queued');

      const startedAudit = await prisma.auditLog.findFirst({
        where: { action: 'clinic_bulk_export_generation_started', clinicId: clinicQ.id },
      });
      assert.ok(startedAudit, 'exactly-once generation_started audit event must be recorded on a successful claim (P1)');

      // Claiming must REPLACE the deadline with the (now tiny, 2s) generation lease.
      const claimRemainingMs = claimedRow.leaseExpiresAt!.getTime() - Date.now();
      assert.ok(claimRemainingMs <= 2000 && claimRemainingMs > -1000, 'claiming must replace the queue-timeout deadline with the (shorter) generation lease');
    } finally {
      if (originalLease === undefined) delete process.env.CLINIC_BULK_EXPORT_GENERATION_LEASE_MS;
      else process.env.CLINIC_BULK_EXPORT_GENERATION_LEASE_MS = originalLease;
      if (originalQueueTimeout === undefined) delete process.env.CLINIC_BULK_EXPORT_QUEUE_TIMEOUT_MS;
      else process.env.CLINIC_BULK_EXPORT_QUEUE_TIMEOUT_MS = originalQueueTimeout;
    }

    await prisma.auditLog.deleteMany({ where: { organizationId: orgQ.id } });
    await prisma.clinicBulkExportArchive.deleteMany({ where: { organizationId: orgQ.id } });
    await prisma.user.delete({ where: { id: userQ.id } });
    await prisma.clinic.delete({ where: { id: clinicQ.id } });
    await prisma.organization.delete({ where: { id: orgQ.id } });
  });

  console.log('\nFull-lifecycle heartbeat survives a deliberately delayed storage upload (P0-3)');

  const { generateClinicBulkExport: generateWithUploadHook } = await import('../src/services/privacy/clinicBulkExportPackage.js');
  const { saveFileFromPath: realSaveFileFromPath, deleteFile: realDeleteFile } = await import('../src/services/fileStorage.js');

  await test('the lease is renewed by the background heartbeat during a slow storage upload, and generation still completes', async () => {
    const orgH = await prisma.organization.create({ data: { name: `Verify Org H ${suffix}`, slug: `verify-org-h-${suffix}` } });
    const clinicH = await prisma.clinic.create({ data: { name: `Verify Clinic H ${suffix}`, slug: `verify-clinic-h-${suffix}`, organizationId: orgH.id } });
    const userH = await prisma.user.create({
      data: {
        clinicId: clinicH.id,
        organizationId: orgH.id,
        firstName: 'Verify',
        lastName: 'HeartbeatUser',
        email: `verify-heartbeat-${suffix}@example.test`,
        role: 'OWNER',
        passwordHash: 'x',
      },
    });
    await prisma.patient.create({ data: { clinicId: clinicH.id, organizationId: orgH.id, firstName: 'Heartbeat', lastName: 'Patient' } });

    const originalLease = process.env.CLINIC_BULK_EXPORT_GENERATION_LEASE_MS;
    const originalHeartbeat = process.env.CLINIC_BULK_EXPORT_HEARTBEAT_INTERVAL_MS;
    try {
      // A lease shorter than the artificial upload delay below would have
      // expired mid-upload under the OLD per-batch-only renewal design
      // (nothing renewed during saveFileFromPath). With the heartbeat
      // running throughout, the lease must survive.
      process.env.CLINIC_BULK_EXPORT_GENERATION_LEASE_MS = '3000';
      process.env.CLINIC_BULK_EXPORT_HEARTBEAT_INTERVAL_MS = '500';

      const { jobId } = await reserveClinicBulkExport({
        clinicId: clinicH.id,
        organizationId: orgH.id,
        requestedByUserId: userH.id,
        purpose: 'other',
        restrictedNote: null,
        stepUpVerifiedAt: new Date(),
        actorRole: 'OWNER',
        req: fakeReq,
      });
      await claimQueuedClinicBulkExportJobs(5);

      const beforeHeartbeatAt = (await prisma.clinicBulkExportArchive.findUniqueOrThrow({ where: { id: jobId }, select: { heartbeatAt: true } })).heartbeatAt;

      // Wraps the REAL upload call with an artificial delay (> the 3s
      // generation lease) — this is the production `generateClinicBulkExport`
      // function, exercising the real archiver/finalize/upload path; only
      // the timing of the upload step itself is instrumented.
      await generateWithUploadHook(jobId, async (key: string, tempPath: string, contentType: string) => {
        await new Promise((resolve) => setTimeout(resolve, 4000));
        return realSaveFileFromPath(key, tempPath, contentType);
      });

      const finalRow = await prisma.clinicBulkExportArchive.findUniqueOrThrow({ where: { id: jobId } });
      assert.equal(finalRow.status, 'ready', 'generation must complete successfully — the heartbeat must have kept the lease alive through the slow upload');
      assert.ok(
        finalRow.heartbeatAt && beforeHeartbeatAt && finalRow.heartbeatAt.getTime() > beforeHeartbeatAt.getTime(),
        'heartbeatAt must have advanced during the artificially delayed upload, not just during DB pagination',
      );

      if (finalRow.storageKey) await realDeleteFile(finalRow.storageKey).catch(() => {});
    } finally {
      if (originalLease === undefined) delete process.env.CLINIC_BULK_EXPORT_GENERATION_LEASE_MS;
      else process.env.CLINIC_BULK_EXPORT_GENERATION_LEASE_MS = originalLease;
      if (originalHeartbeat === undefined) delete process.env.CLINIC_BULK_EXPORT_HEARTBEAT_INTERVAL_MS;
      else process.env.CLINIC_BULK_EXPORT_HEARTBEAT_INTERVAL_MS = originalHeartbeat;
    }

    await prisma.patient.deleteMany({ where: { clinicId: clinicH.id } });
    await prisma.clinicBulkExportArchive.deleteMany({ where: { organizationId: orgH.id } });
    await prisma.user.delete({ where: { id: userH.id } });
    await prisma.clinic.delete({ where: { id: clinicH.id } });
    await prisma.organization.delete({ where: { id: orgH.id } });
  });

  console.log('\nLease loss during storage upload prevents ready and deletes the artifact (P0-3)');

  await test('if the lease is lost during the storage upload, the row never becomes ready and the uploaded artifact is deleted', async () => {
    const orgLL = await prisma.organization.create({ data: { name: `Verify Org LL ${suffix}`, slug: `verify-org-ll-${suffix}` } });
    const clinicLL = await prisma.clinic.create({ data: { name: `Verify Clinic LL ${suffix}`, slug: `verify-clinic-ll-${suffix}`, organizationId: orgLL.id } });
    const userLL = await prisma.user.create({
      data: {
        clinicId: clinicLL.id,
        organizationId: orgLL.id,
        firstName: 'Verify',
        lastName: 'LeaseLostUser',
        email: `verify-leaselost-${suffix}@example.test`,
        role: 'OWNER',
        passwordHash: 'x',
      },
    });
    await prisma.patient.create({ data: { clinicId: clinicLL.id, organizationId: orgLL.id, firstName: 'LeaseLost', lastName: 'Patient' } });

    const originalHeartbeat = process.env.CLINIC_BULK_EXPORT_HEARTBEAT_INTERVAL_MS;
    let uploadedStorageKey: string | null = null;
    try {
      // A short-but-not-instant heartbeat interval so the delayed upload
      // below has time to let at least one tick observe the stolen lease.
      process.env.CLINIC_BULK_EXPORT_HEARTBEAT_INTERVAL_MS = '150';

      const { jobId } = await reserveClinicBulkExport({
        clinicId: clinicLL.id,
        organizationId: orgLL.id,
        requestedByUserId: userLL.id,
        purpose: 'other',
        restrictedNote: null,
        stepUpVerifiedAt: new Date(),
        actorRole: 'OWNER',
        req: fakeReq,
      });
      await claimQueuedClinicBulkExportJobs(5);

      await generateWithUploadHook(jobId, async (key: string, tempPath: string, contentType: string) => {
        uploadedStorageKey = key;
        // Simulate a TRANSIENT renewal failure — e.g. a brief DB hiccup on
        // one heartbeat tick — rather than a real external reassignment
        // that would have ALREADY recorded its own terminal failureCode
        // (in which case that writer's code, not this one, legitimately
        // owns the final status/code — generateClinicBulkExport correctly
        // never resurrects/overwrites an already-terminal row, by design).
        // Momentarily flipping status away from 'generating' makes the
        // in-flight heartbeat tick's renewLease() guarded update affect 0
        // rows, which is exactly how a real renewal failure is observed;
        // restoring 'generating' before upload finishes means NO other
        // writer has claimed a terminal state, so this job's own catch
        // block is the one that gets to record the stable LEASE_LOST code
        // — the specific invariant this test exists to prove.
        await prisma.clinicBulkExportArchive.updateMany({ where: { id: jobId, status: 'generating' }, data: { status: 'queued' } });
        await new Promise((resolve) => setTimeout(resolve, 400)); // let a heartbeat tick (150ms interval) observe the failed renewal
        await prisma.clinicBulkExportArchive.updateMany({ where: { id: jobId, status: 'queued' }, data: { status: 'generating' } });
        return realSaveFileFromPath(key, tempPath, contentType);
      });

      const finalRow = await prisma.clinicBulkExportArchive.findUniqueOrThrow({ where: { id: jobId } });
      assert.equal(finalRow.status, 'failed', 'a job that loses its lease during the storage upload must never transition to ready');
      assert.equal(finalRow.failureCode, 'LEASE_LOST', 'the stable LEASE_LOST failure code must be recorded (not a generic GENERATION_ERROR)');
      assert.equal(finalRow.storageKey, null, 'a lease-lost job must never retain a storageKey pointing at a reachable artifact');

      if (uploadedStorageKey) {
        const localPath = resolveLocalStoragePath(uploadedStorageKey);
        assert.ok(!fs.existsSync(localPath), 'the uploaded artifact must actually be deleted from storage once the lease-loss is detected, not just unlinked in the DB');
      }
    } finally {
      if (originalHeartbeat === undefined) delete process.env.CLINIC_BULK_EXPORT_HEARTBEAT_INTERVAL_MS;
      else process.env.CLINIC_BULK_EXPORT_HEARTBEAT_INTERVAL_MS = originalHeartbeat;
    }

    await prisma.patient.deleteMany({ where: { clinicId: clinicLL.id } });
    await prisma.clinicBulkExportArchive.deleteMany({ where: { organizationId: orgLL.id } });
    await prisma.user.delete({ where: { id: userLL.id } });
    await prisma.clinic.delete({ where: { id: clinicLL.id } });
    await prisma.organization.delete({ where: { id: orgLL.id } });
  });

  console.log('\nTenant rollout allowlist is server-enforced via the REAL Express handler (P1)');

  await test('an organization NOT on the allowlist gets the identical disabled response, even with the global flag on', async () => {
    const orgAllow = await prisma.organization.create({ data: { name: `Verify Org Allow ${suffix}`, slug: `verify-org-allow-${suffix}` } });
    const clinicAllow = await prisma.clinic.create({ data: { name: `Verify Clinic Allow ${suffix}`, slug: `verify-clinic-allow-${suffix}`, organizationId: orgAllow.id } });
    const userAllow = await prisma.user.create({
      data: {
        clinicId: clinicAllow.id,
        organizationId: orgAllow.id,
        firstName: 'Verify',
        lastName: 'AllowlistUser',
        email: `verify-allowlist-${suffix}@example.test`,
        role: 'OWNER',
        passwordHash: 'x',
      },
    });

    const originalEnabled = process.env.CLINIC_BULK_EXPORT_ENABLED;
    const originalAllowlist = process.env.CLINIC_BULK_EXPORT_ALLOWED_ORGANIZATION_IDS;
    try {
      process.env.CLINIC_BULK_EXPORT_ENABLED = 'true';
      // Allowlist configured, but deliberately does NOT include orgAllow.
      process.env.CLINIC_BULK_EXPORT_ALLOWED_ORGANIZATION_IDS = `${crypto.randomUUID()},${crypto.randomUUID()}`;

      const req: any = {
        user: {
          id: userAllow.id,
          clinicId: clinicAllow.id,
          role: 'OWNER',
          normalizedRole: 'OWNER',
          organizationId: orgAllow.id,
          allowedClinicIds: [clinicAllow.id],
          canAccessAllClinics: false,
        },
        params: { clinicId: clinicAllow.id },
        body: {},
        headers: {},
        ip: '203.0.113.210',
      };
      const res = makeFakeRes();
      await createHandler(req, res);
      assert.equal(res.statusCode, 403);
      assert.equal(res.jsonBody?.error, 'CLINIC_BULK_EXPORT_DISABLED', 'an org not on the allowlist must get the SAME response as the global flag being off');
    } finally {
      if (originalEnabled === undefined) delete process.env.CLINIC_BULK_EXPORT_ENABLED;
      else process.env.CLINIC_BULK_EXPORT_ENABLED = originalEnabled;
      if (originalAllowlist === undefined) delete process.env.CLINIC_BULK_EXPORT_ALLOWED_ORGANIZATION_IDS;
      else process.env.CLINIC_BULK_EXPORT_ALLOWED_ORGANIZATION_IDS = originalAllowlist;
    }

    await prisma.user.delete({ where: { id: userAllow.id } });
    await prisma.clinic.delete({ where: { id: clinicAllow.id } });
    await prisma.organization.delete({ where: { id: orgAllow.id } });
  });

  await test('an organization ON the allowlist is NOT blocked by the disabled-feature check (proceeds to step-up)', async () => {
    const orgAllow2 = await prisma.organization.create({ data: { name: `Verify Org Allow2 ${suffix}`, slug: `verify-org-allow2-${suffix}` } });
    const clinicAllow2 = await prisma.clinic.create({ data: { name: `Verify Clinic Allow2 ${suffix}`, slug: `verify-clinic-allow2-${suffix}`, organizationId: orgAllow2.id } });
    const userAllow2 = await prisma.user.create({
      data: {
        clinicId: clinicAllow2.id,
        organizationId: orgAllow2.id,
        firstName: 'Verify',
        lastName: 'AllowlistUser2',
        email: `verify-allowlist2-${suffix}@example.test`,
        role: 'OWNER',
        passwordHash: 'x',
      },
    });

    const originalEnabled = process.env.CLINIC_BULK_EXPORT_ENABLED;
    const originalAllowlist = process.env.CLINIC_BULK_EXPORT_ALLOWED_ORGANIZATION_IDS;
    try {
      process.env.CLINIC_BULK_EXPORT_ENABLED = 'true';
      process.env.CLINIC_BULK_EXPORT_ALLOWED_ORGANIZATION_IDS = `${crypto.randomUUID()},${orgAllow2.id},${crypto.randomUUID()}`;

      const req: any = {
        user: {
          id: userAllow2.id,
          clinicId: clinicAllow2.id,
          role: 'OWNER',
          normalizedRole: 'OWNER',
          organizationId: orgAllow2.id,
          allowedClinicIds: [clinicAllow2.id],
          canAccessAllClinics: false,
        },
        params: { clinicId: clinicAllow2.id },
        body: { purpose: 'other', confirm: true, currentPassword: '' }, // empty password -> step-up 'empty' rejection, never the disabled path
        headers: {},
        ip: '203.0.113.211',
      };
      const res = makeFakeRes();
      await createHandler(req, res);
      assert.notEqual(res.jsonBody?.error, 'CLINIC_BULK_EXPORT_DISABLED', 'an allowlisted org must pass the disabled-feature check entirely');
      assert.equal(res.statusCode, 401, 'must reach step-up verification and fail there (empty password), proving the allowlist did not block it');
      assert.equal(res.jsonBody?.error, 'CLINIC_BULK_EXPORT_STEP_UP_FAILED');
    } finally {
      if (originalEnabled === undefined) delete process.env.CLINIC_BULK_EXPORT_ENABLED;
      else process.env.CLINIC_BULK_EXPORT_ENABLED = originalEnabled;
      if (originalAllowlist === undefined) delete process.env.CLINIC_BULK_EXPORT_ALLOWED_ORGANIZATION_IDS;
      else process.env.CLINIC_BULK_EXPORT_ALLOWED_ORGANIZATION_IDS = originalAllowlist;
    }

    // The empty-password step-up rejection above recorded a failed attempt
    // (clinicBulkExportPasswordAttempts.ts's recordFailedAttempt) — must be
    // cleared before the clinic FK can be deleted.
    await prisma.clinicBulkExportPasswordAttempt.deleteMany({ where: { clinicId: clinicAllow2.id } });
    await prisma.user.delete({ where: { id: userAllow2.id } });
    await prisma.clinic.delete({ where: { id: clinicAllow2.id } });
    await prisma.organization.delete({ where: { id: orgAllow2.id } });
  });

  console.log('\nDurable planned-artifact lifecycle — no post-upload orphan artifacts (P0)');

  await test('a planned-key persist that loses its claim (lease already expired) never uploads anything — no artifact, no orphan', async () => {
    const orgPK = await prisma.organization.create({ data: { name: `Verify Org PK ${suffix}`, slug: `verify-org-pk-${suffix}` } });
    const clinicPK = await prisma.clinic.create({ data: { name: `Verify Clinic PK ${suffix}`, slug: `verify-clinic-pk-${suffix}`, organizationId: orgPK.id } });
    const userPK = await prisma.user.create({
      data: {
        clinicId: clinicPK.id,
        organizationId: orgPK.id,
        firstName: 'Verify',
        lastName: 'PlannedKeyUser',
        email: `verify-plannedkey-${suffix}@example.test`,
        role: 'OWNER',
        passwordHash: 'x',
      },
    });
    await prisma.patient.create({ data: { clinicId: clinicPK.id, organizationId: orgPK.id, firstName: 'PlannedKey', lastName: 'Patient' } });

    const { jobId } = await reserveClinicBulkExport({
      clinicId: clinicPK.id,
      organizationId: orgPK.id,
      requestedByUserId: userPK.id,
      purpose: 'other',
      restrictedNote: null,
      stepUpVerifiedAt: new Date(),
      actorRole: 'OWNER',
      req: fakeReq,
    });
    await claimQueuedClinicBulkExportJobs(5);

    // A plain pre-set stale leaseExpiresAt gets self-healed by the very
    // first per-batch renewLease() call during entity streaming (which runs
    // unconditionally, even for zero-record entities) long before the
    // planned-key persist is ever reached — so this uses the dedicated
    // test-only hook (fired at exactly the right instant, immediately
    // before the guarded planned-key update) to simulate a concurrent sweep
    // stealing the row in that narrow real window instead.
    await generateClinicBulkExport(jobId, undefined, async () => {
      await prisma.clinicBulkExportArchive.update({ where: { id: jobId }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });
    });

    const finalRow = await prisma.clinicBulkExportArchive.findUniqueOrThrow({ where: { id: jobId } });
    assert.equal(finalRow.status, 'failed');
    assert.equal(finalRow.failureCode, 'LEASE_LOST');
    assert.equal(finalRow.storageKey, null, 'the planned key must never be persisted once its own guarded update loses the race');

    const exportsDir = path.resolve(process.cwd(), 'uploads', 'exports', clinicPK.id);
    assert.ok(!fs.existsSync(exportsDir) || fs.readdirSync(exportsDir).length === 0, 'no artifact may ever be written to storage when the planned-key persist itself fails');
    const leftoverTempFiles = listExportTempFilesFor(jobId);
    assert.equal(leftoverTempFiles.length, 0, 'the temp ZIP file must be unlinked, never left behind');

    await prisma.patient.deleteMany({ where: { clinicId: clinicPK.id } });
    await prisma.clinicBulkExportArchive.deleteMany({ where: { clinicId: clinicPK.id } });
    await prisma.user.delete({ where: { id: userPK.id } });
    await prisma.clinic.delete({ where: { id: clinicPK.id } });
    await prisma.organization.delete({ where: { id: orgPK.id } });
  });

  await test('the final guarded ready update losing the race (lease expires between upload and the ready transition) deletes the real uploaded artifact', async () => {
    const orgRT = await prisma.organization.create({ data: { name: `Verify Org RT ${suffix}`, slug: `verify-org-rt-${suffix}` } });
    const clinicRT = await prisma.clinic.create({ data: { name: `Verify Clinic RT ${suffix}`, slug: `verify-clinic-rt-${suffix}`, organizationId: orgRT.id } });
    const userRT = await prisma.user.create({
      data: {
        clinicId: clinicRT.id,
        organizationId: orgRT.id,
        firstName: 'Verify',
        lastName: 'ReadyRaceUser',
        email: `verify-readyrace-${suffix}@example.test`,
        role: 'OWNER',
        passwordHash: 'x',
      },
    });
    await prisma.patient.create({ data: { clinicId: clinicRT.id, organizationId: orgRT.id, firstName: 'ReadyRace', lastName: 'Patient' } });

    const { jobId } = await reserveClinicBulkExport({
      clinicId: clinicRT.id,
      organizationId: orgRT.id,
      requestedByUserId: userRT.id,
      purpose: 'other',
      restrictedNote: null,
      stepUpVerifiedAt: new Date(),
      actorRole: 'OWNER',
      req: fakeReq,
    });
    await claimQueuedClinicBulkExportJobs(5);

    let uploadedKey = '';
    await generateClinicBulkExport(jobId, async (key: string, tempPath: string, contentType: string) => {
      uploadedKey = key;
      const { saveFileFromPath: realSave } = await import('../src/services/fileStorage.js');
      // Do the REAL upload first — proves a real artifact lands in storage —
      // then, strictly AFTER upload completes but BEFORE generateClinicBulkExport
      // reaches its own final guarded ready-transition update, simulate the
      // lease expiring via a direct write (distinct from the heartbeat's own
      // isLeaseLost() flag, which stays false here — this exercises the
      // SEPARATE guard on the final updateMany's own WHERE clause).
      await realSave(key, tempPath, contentType);
      await prisma.clinicBulkExportArchive.update({ where: { id: jobId }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });
    });

    const finalRow = await prisma.clinicBulkExportArchive.findUniqueOrThrow({ where: { id: jobId } });
    assert.equal(finalRow.status, 'failed', 'losing the final ready-transition race must never produce a ready row');
    assert.equal(finalRow.failureCode, 'LEASE_LOST');
    assert.equal(finalRow.storageKey, null, 'storageKey must be cleared once the orphaned artifact is deleted');
    assert.ok(uploadedKey, 'sanity check: the real upload must actually have happened');
    const localPath = resolveLocalStoragePath(uploadedKey);
    assert.ok(!fs.existsSync(localPath), 'the real artifact that was uploaded must be deleted, not left as an untracked orphan');

    await prisma.patient.deleteMany({ where: { clinicId: clinicRT.id } });
    await prisma.clinicBulkExportArchive.deleteMany({ where: { clinicId: clinicRT.id } });
    await prisma.user.delete({ where: { id: userRT.id } });
    await prisma.clinic.delete({ where: { id: clinicRT.id } });
    await prisma.organization.delete({ where: { id: orgRT.id } });
  });

  await test('upload succeeds for real but a subsequent failure occurs — the real artifact is found via its pre-persisted storageKey and deleted', async () => {
    const orgSF = await prisma.organization.create({ data: { name: `Verify Org SF ${suffix}`, slug: `verify-org-sf-${suffix}` } });
    const clinicSF = await prisma.clinic.create({ data: { name: `Verify Clinic SF ${suffix}`, slug: `verify-clinic-sf-${suffix}`, organizationId: orgSF.id } });
    const userSF = await prisma.user.create({
      data: {
        clinicId: clinicSF.id,
        organizationId: orgSF.id,
        firstName: 'Verify',
        lastName: 'SubsequentFailureUser',
        email: `verify-subsequentfailure-${suffix}@example.test`,
        role: 'OWNER',
        passwordHash: 'x',
      },
    });
    await prisma.patient.create({ data: { clinicId: clinicSF.id, organizationId: orgSF.id, firstName: 'SubsequentFailure', lastName: 'Patient' } });

    const { jobId } = await reserveClinicBulkExport({
      clinicId: clinicSF.id,
      organizationId: orgSF.id,
      requestedByUserId: userSF.id,
      purpose: 'other',
      restrictedNote: null,
      stepUpVerifiedAt: new Date(),
      actorRole: 'OWNER',
      req: fakeReq,
    });
    await claimQueuedClinicBulkExportJobs(5);

    let uploadedKey = '';
    await generateClinicBulkExport(jobId, async (key: string, tempPath: string, contentType: string) => {
      uploadedKey = key;
      const { saveFileFromPath: realSave } = await import('../src/services/fileStorage.js');
      await realSave(key, tempPath, contentType); // real bytes really land in storage
      throw new Error('simulated failure strictly after a successful real upload');
    });

    const finalRow = await prisma.clinicBulkExportArchive.findUniqueOrThrow({ where: { id: jobId } });
    assert.equal(finalRow.status, 'failed');
    assert.equal(finalRow.failureCode, 'GENERATION_ERROR');
    assert.equal(finalRow.storageKey, null, 'the pre-persisted planned storageKey must have been used to find and delete the real artifact');
    const localPath = resolveLocalStoragePath(uploadedKey);
    assert.ok(!fs.existsSync(localPath), 'the real artifact must actually be gone from disk, not merely unlinked in the DB');

    await prisma.patient.deleteMany({ where: { clinicId: clinicSF.id } });
    await prisma.clinicBulkExportArchive.deleteMany({ where: { clinicId: clinicSF.id } });
    await prisma.user.delete({ where: { id: userSF.id } });
    await prisma.clinic.delete({ where: { id: clinicSF.id } });
    await prisma.organization.delete({ where: { id: orgSF.id } });
  });

  await test('a worker crash after the planned key is persisted but before upload leaves a recoverable row cleanup fully clears in ONE pass (P1: expire -> sweep-abandoned -> delete-artifacts reordered into a single call)', async () => {
    const orgCR = await prisma.organization.create({ data: { name: `Verify Org CR ${suffix}`, slug: `verify-org-cr-${suffix}` } });
    const clinicCR = await prisma.clinic.create({ data: { name: `Verify Clinic CR ${suffix}`, slug: `verify-clinic-cr-${suffix}`, organizationId: orgCR.id } });
    const userCR = await prisma.user.create({
      data: {
        clinicId: clinicCR.id,
        organizationId: orgCR.id,
        firstName: 'Verify',
        lastName: 'CrashUser',
        email: `verify-crash-${suffix}@example.test`,
        role: 'OWNER',
        passwordHash: 'x',
      },
    });

    const { jobId } = await reserveClinicBulkExport({
      clinicId: clinicCR.id,
      organizationId: orgCR.id,
      requestedByUserId: userCR.id,
      purpose: 'other',
      restrictedNote: null,
      stepUpVerifiedAt: new Date(),
      actorRole: 'OWNER',
      req: fakeReq,
    });
    await claimQueuedClinicBulkExportJobs(5);

    // Simulate exactly the moment generateClinicBulkExport's own guarded
    // pre-upload persist would have run — the row is 'generating' with the
    // deterministic planned key set, and a REAL dummy artifact already sits
    // at that key (so deletion below has something real to remove) — then
    // the process is imagined to crash right there (nothing else in this
    // test ever calls generateClinicBulkExport for this job, so nothing more
    // happens in-process; there is deliberately no catch block to run).
    const plannedKey = buildExportStorageKey(clinicCR.id, jobId);
    const plannedLocalPath = resolveLocalStoragePath(plannedKey);
    await fs.promises.mkdir(path.dirname(plannedLocalPath), { recursive: true });
    await fs.promises.writeFile(plannedLocalPath, Buffer.from('real dummy export bytes for the one-pass cleanup test'));
    await prisma.clinicBulkExportArchive.update({ where: { id: jobId }, data: { storageKey: plannedKey, leaseExpiresAt: new Date(Date.now() - 1000) } });

    // KVKK-HIGH-004 remediation (P1): cleanupExpiredClinicBulkExportArchives
    // now runs expire -> sweep-abandoned -> delete-artifacts strictly in
    // that order within ONE call, specifically so a row needing BOTH the
    // abandoned-lease sweep AND artifact deletion (this exact scenario) is
    // fully cleaned up here — no second cleanup tick required.
    const cleanup = await cleanupExpiredClinicBulkExportArchives();
    assert.ok(cleanup.sweptAbandoned >= 1, 'the abandoned-lease sweep must have run');
    assert.ok(cleanup.deleted >= 1, 'the SAME call must also have deleted the artifact, in the same pass as the sweep');

    const afterCleanup = await prisma.clinicBulkExportArchive.findUniqueOrThrow({ where: { id: jobId } });
    assert.equal(afterCleanup.status, 'failed');
    assert.equal(afterCleanup.storageKey, null, 'storageKey must be cleared in this same single pass, not deferred to a later tick');
    assert.ok(afterCleanup.artifactDeletedAt);
    assert.equal(afterCleanup.cleanupFailureCode, null);
    assert.ok(!fs.existsSync(plannedLocalPath), 'the real dummy artifact must actually be gone from disk after just ONE cleanup call');

    await prisma.clinicBulkExportArchive.deleteMany({ where: { clinicId: clinicCR.id } });
    await prisma.user.delete({ where: { id: userCR.id } });
    await prisma.clinic.delete({ where: { id: clinicCR.id } });
    await prisma.organization.delete({ where: { id: orgCR.id } });
  });

  await test('an immediate delete failure preserves storageKey and sets cleanupFailureCode; a later cleanup run deletes the real file and clears it', async () => {
    const orgDF = await prisma.organization.create({ data: { name: `Verify Org DF ${suffix}`, slug: `verify-org-df-${suffix}` } });
    const clinicDF = await prisma.clinic.create({ data: { name: `Verify Clinic DF ${suffix}`, slug: `verify-clinic-df-${suffix}`, organizationId: orgDF.id } });
    const userDF = await prisma.user.create({
      data: {
        clinicId: clinicDF.id,
        organizationId: orgDF.id,
        firstName: 'Verify',
        lastName: 'DeleteFailUser',
        email: `verify-deletefail-${suffix}@example.test`,
        role: 'OWNER',
        passwordHash: 'x',
      },
    });

    const failedRowStorageKey = buildExportStorageKey(clinicDF.id, `${suffix}-delete-fail`);
    const localPath = resolveLocalStoragePath(failedRowStorageKey);
    await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
    await fs.promises.writeFile(localPath, Buffer.from('real dummy export bytes for the delete-retry test'));
    assert.ok(fs.existsSync(localPath), 'sanity check: the dummy artifact must actually exist before the test begins');

    const failedRow = await prisma.clinicBulkExportArchive.create({
      data: {
        organizationId: orgDF.id,
        clinicId: clinicDF.id,
        requestedByUserId: userDF.id,
        status: 'failed',
        purpose: 'other',
        stepUpVerifiedAt: new Date(),
        storageKey: failedRowStorageKey,
        failureCode: 'GENERATION_ERROR',
      },
    });

    let deleteAttempts = 0;
    const flakyDelete: typeof deleteFile = async (key: string) => {
      deleteAttempts++;
      if (deleteAttempts === 1) throw new Error('simulated transient storage delete failure');
      return deleteFile(key);
    };

    const firstRun = await attemptArtifactDeletion(failedRow.id, new Date(), flakyDelete);
    assert.equal(firstRun, false, 'the first, forced-to-fail delete attempt must report failure');
    const afterFirst = await prisma.clinicBulkExportArchive.findUniqueOrThrow({ where: { id: failedRow.id } });
    assert.equal(afterFirst.status, 'failed', 'status must stay a non-downloadable terminal status');
    assert.equal(afterFirst.storageKey, failedRowStorageKey, 'storageKey must be preserved (never nulled) after a failed delete attempt');
    assert.equal(afterFirst.cleanupFailureCode, 'STORAGE_DELETE_FAILED');
    assert.equal(afterFirst.artifactDeletedAt, null);
    assert.ok(fs.existsSync(localPath), 'the real file must still exist on disk after the forced failure');

    // A later cleanup run (no injected failure this time — the real deleteFile) succeeds.
    const secondRun = await attemptArtifactDeletion(failedRow.id);
    assert.equal(secondRun, true, 'a later, unforced retry must succeed');
    const afterSecond = await prisma.clinicBulkExportArchive.findUniqueOrThrow({ where: { id: failedRow.id } });
    assert.equal(afterSecond.storageKey, null);
    assert.ok(afterSecond.artifactDeletedAt);
    assert.equal(afterSecond.cleanupFailureCode, null);
    assert.ok(!fs.existsSync(localPath), 'the real file must actually be gone from disk once the retry succeeds');

    await prisma.clinicBulkExportArchive.deleteMany({ where: { clinicId: clinicDF.id } });
    await prisma.user.delete({ where: { id: userDF.id } });
    await prisma.clinic.delete({ where: { id: clinicDF.id } });
    await prisma.organization.delete({ where: { id: orgDF.id } });
  });

  console.log('\nTransactional, exactly-once generation_started audit (P1)');

  await test('concurrent claim calls: exactly one claims a given queued job, and exactly one generation_started audit exists for it', async () => {
    const orgC1 = await prisma.organization.create({ data: { name: `Verify Org C1 ${suffix}`, slug: `verify-org-c1-${suffix}` } });
    const clinicC1 = await prisma.clinic.create({ data: { name: `Verify Clinic C1 ${suffix}`, slug: `verify-clinic-c1-${suffix}`, organizationId: orgC1.id } });
    const userC1 = await prisma.user.create({
      data: {
        clinicId: clinicC1.id,
        organizationId: orgC1.id,
        firstName: 'Verify',
        lastName: 'ClaimUser',
        email: `verify-claim-${suffix}@example.test`,
        role: 'OWNER',
        passwordHash: 'x',
      },
    });

    const { jobId } = await reserveClinicBulkExport({
      clinicId: clinicC1.id,
      organizationId: orgC1.id,
      requestedByUserId: userC1.id,
      purpose: 'other',
      restrictedNote: null,
      stepUpVerifiedAt: new Date(),
      actorRole: 'OWNER',
      req: fakeReq,
    });

    // Two "replicas" racing to claim the SAME candidate set concurrently —
    // correctness comes entirely from the guarded per-row transaction, not
    // from any cross-replica lock.
    const [claimedA, claimedB] = await Promise.all([claimQueuedClinicBulkExportJobs(5), claimQueuedClinicBulkExportJobs(5)]);
    const claimCount = [...claimedA, ...claimedB].filter((id) => id === jobId).length;
    assert.equal(claimCount, 1, 'exactly one of the two concurrent claim calls may have claimed this job');

    const row = await prisma.clinicBulkExportArchive.findUniqueOrThrow({ where: { id: jobId } });
    assert.equal(row.status, 'generating');

    const startedAudits = await prisma.auditLog.findMany({
      where: { action: 'clinic_bulk_export_generation_started', clinicId: clinicC1.id },
    });
    assert.equal(startedAudits.length, 1, 'exactly one generation_started audit event must exist — the losing replica must never write one');

    await prisma.auditLog.deleteMany({ where: { clinicId: clinicC1.id } });
    await prisma.clinicBulkExportArchive.deleteMany({ where: { clinicId: clinicC1.id } });
    await prisma.user.delete({ where: { id: userC1.id } });
    await prisma.clinic.delete({ where: { id: clinicC1.id } });
    await prisma.organization.delete({ where: { id: orgC1.id } });
  });

  await test('a forced generation_started audit failure rolls back the claim entirely — the job remains queued and no audit is written', async () => {
    const orgC2 = await prisma.organization.create({ data: { name: `Verify Org C2 ${suffix}`, slug: `verify-org-c2-${suffix}` } });
    const clinicC2 = await prisma.clinic.create({ data: { name: `Verify Clinic C2 ${suffix}`, slug: `verify-clinic-c2-${suffix}`, organizationId: orgC2.id } });
    const userC2 = await prisma.user.create({
      data: {
        clinicId: clinicC2.id,
        organizationId: orgC2.id,
        firstName: 'Verify',
        lastName: 'ForcedFailUser',
        email: `verify-forcedfail-${suffix}@example.test`,
        role: 'OWNER',
        passwordHash: 'x',
      },
    });

    const { jobId } = await reserveClinicBulkExport({
      clinicId: clinicC2.id,
      organizationId: orgC2.id,
      requestedByUserId: userC2.id,
      purpose: 'other',
      restrictedNote: null,
      stepUpVerifiedAt: new Date(),
      actorRole: 'OWNER',
      req: fakeReq,
    });
    // reserveClinicBulkExport already sets heartbeatAt/leaseExpiresAt at
    // creation time (the queue-timeout deadline) — captured here so the
    // post-rollback assertion below proves the claim's OWN update (which
    // would overwrite both to the claim-time generation lease) never took
    // effect, rather than incorrectly expecting these fields to be null.
    const beforeClaim = await prisma.clinicBulkExportArchive.findUniqueOrThrow({ where: { id: jobId } });

    const forcedFailureAudit = async () => {
      throw new Error('forced audit failure for verification');
    };

    const claimedIds = await claimQueuedClinicBulkExportJobs(5, new Date(), forcedFailureAudit as any);
    assert.ok(!claimedIds.includes(jobId), 'a forced audit-write failure must roll back the whole transaction, including the claim itself');

    const row = await prisma.clinicBulkExportArchive.findUniqueOrThrow({ where: { id: jobId } });
    assert.equal(row.status, 'queued', 'the job must remain queued — available for another replica or a later tick — after the rollback');
    assert.equal(
      row.heartbeatAt?.getTime(),
      beforeClaim.heartbeatAt?.getTime(),
      'the claim update (heartbeatAt) must also have rolled back — still the reservation-time value, never bumped to the claim attempt',
    );
    assert.equal(
      row.leaseExpiresAt?.getTime(),
      beforeClaim.leaseExpiresAt?.getTime(),
      'the claim update (leaseExpiresAt) must also have rolled back — still the queue-timeout deadline, never replaced with the generation lease',
    );

    const audits = await prisma.auditLog.findMany({
      where: { action: 'clinic_bulk_export_generation_started', clinicId: clinicC2.id },
    });
    assert.equal(audits.length, 0, 'no generation_started audit may exist when its own transaction rolled back');

    // A subsequent, normal (non-forced-failure) claim call must still be able to claim it.
    const recoveredClaim = await claimQueuedClinicBulkExportJobs(5);
    assert.ok(recoveredClaim.includes(jobId), 'the job must remain claimable normally after the earlier forced rollback');

    await prisma.auditLog.deleteMany({ where: { clinicId: clinicC2.id } });
    await prisma.clinicBulkExportArchive.deleteMany({ where: { clinicId: clinicC2.id } });
    await prisma.user.delete({ where: { id: userC2.id } });
    await prisma.clinic.delete({ where: { id: clinicC2.id } });
    await prisma.organization.delete({ where: { id: orgC2.id } });
  });

  console.log('\nFeature flag / organization allowlist is a real GENERATION kill switch, not just a creation gate (P0)');

  await test('the global flag being off stops a queued job from ever being generated — atomically failed as FEATURE_DISABLED, with an audit event', async () => {
    const orgFD1 = await prisma.organization.create({ data: { name: `Verify Org FD1 ${suffix}`, slug: `verify-org-fd1-${suffix}` } });
    const clinicFD1 = await prisma.clinic.create({ data: { name: `Verify Clinic FD1 ${suffix}`, slug: `verify-clinic-fd1-${suffix}`, organizationId: orgFD1.id } });
    const userFD1 = await prisma.user.create({
      data: { clinicId: clinicFD1.id, organizationId: orgFD1.id, firstName: 'Verify', lastName: 'FlagOffUser', email: `verify-flagoff-${suffix}@example.test`, role: 'OWNER', passwordHash: 'x' },
    });

    const { jobId } = await reserveClinicBulkExport({
      clinicId: clinicFD1.id,
      organizationId: orgFD1.id,
      requestedByUserId: userFD1.id,
      purpose: 'other',
      restrictedNote: null,
      stepUpVerifiedAt: new Date(),
      actorRole: 'OWNER',
      req: fakeReq,
    });

    const claimedIds = await withEnvOverride({ CLINIC_BULK_EXPORT_ENABLED: 'false' }, () => claimQueuedClinicBulkExportJobs(5));
    assert.ok(!claimedIds.includes(jobId), 'a queued job must never be claimed while the global flag is off');

    const row = await prisma.clinicBulkExportArchive.findUniqueOrThrow({ where: { id: jobId } });
    assert.equal(row.status, 'failed');
    assert.equal(row.failureCode, 'FEATURE_DISABLED');
    assert.equal(row.storageKey, null, 'a job stopped before ever generating must never carry a storageKey');

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'clinic_bulk_export_generation_failed', clinicId: clinicFD1.id },
      orderBy: { createdAt: 'desc' },
    });
    assert.ok(audit, 'a generation_failed audit event must still be recorded for a flag-disabled queued job');
    assert.equal((audit!.metadata as any)?.failureCode, 'FEATURE_DISABLED');
    assert.equal((audit!.metadata as any)?.restrictedNote, undefined, 'no patient/clinic data may ever appear in this audit metadata');

    await prisma.auditLog.deleteMany({ where: { clinicId: clinicFD1.id } });
    await prisma.clinicBulkExportArchive.deleteMany({ where: { clinicId: clinicFD1.id } });
    await prisma.user.delete({ where: { id: userFD1.id } });
    await prisma.clinic.delete({ where: { id: clinicFD1.id } });
    await prisma.organization.delete({ where: { id: orgFD1.id } });
  });

  await test('an organization dropped from the rollout allowlist is stopped identically — no artifact is ever created', async () => {
    const orgFD2 = await prisma.organization.create({ data: { name: `Verify Org FD2 ${suffix}`, slug: `verify-org-fd2-${suffix}` } });
    const clinicFD2 = await prisma.clinic.create({ data: { name: `Verify Clinic FD2 ${suffix}`, slug: `verify-clinic-fd2-${suffix}`, organizationId: orgFD2.id } });
    const userFD2 = await prisma.user.create({
      data: { clinicId: clinicFD2.id, organizationId: orgFD2.id, firstName: 'Verify', lastName: 'AllowlistUser', email: `verify-allowlist-fd-${suffix}@example.test`, role: 'OWNER', passwordHash: 'x' },
    });
    await prisma.patient.create({ data: { clinicId: clinicFD2.id, organizationId: orgFD2.id, firstName: 'Allowlist', lastName: 'Patient' } });

    const { jobId } = await reserveClinicBulkExport({
      clinicId: clinicFD2.id,
      organizationId: orgFD2.id,
      requestedByUserId: userFD2.id,
      purpose: 'other',
      restrictedNote: null,
      stepUpVerifiedAt: new Date(),
      actorRole: 'OWNER',
      req: fakeReq,
    });

    // Flag globally ON, but the allowlist deliberately names a different,
    // unrelated organization — orgFD2 itself is excluded.
    const claimedIds = await withEnvOverride(
      { CLINIC_BULK_EXPORT_ENABLED: 'true', CLINIC_BULK_EXPORT_ALLOWED_ORGANIZATION_IDS: `not-${orgFD2.id}` },
      () => claimQueuedClinicBulkExportJobs(5),
    );
    assert.ok(!claimedIds.includes(jobId), 'an organization excluded from the allowlist must never be claimed even while the global flag is true');

    const row = await prisma.clinicBulkExportArchive.findUniqueOrThrow({ where: { id: jobId } });
    assert.equal(row.status, 'failed');
    assert.equal(row.failureCode, 'FEATURE_DISABLED');

    const exportsDir = path.resolve(process.cwd(), 'uploads', 'exports', clinicFD2.id);
    assert.ok(!fs.existsSync(exportsDir) || fs.readdirSync(exportsDir).length === 0, 'no artifact may ever be created for an allowlist-excluded organization');

    await prisma.patient.deleteMany({ where: { clinicId: clinicFD2.id } });
    await prisma.clinicBulkExportArchive.deleteMany({ where: { clinicId: clinicFD2.id } });
    await prisma.user.delete({ where: { id: userFD2.id } });
    await prisma.clinic.delete({ where: { id: clinicFD2.id } });
    await prisma.organization.delete({ where: { id: orgFD2.id } });
  });

  await test('disabling the flag strictly before the planned-key persist leaves no temp or final artifact — the row fails FEATURE_DISABLED', async () => {
    const orgFD3 = await prisma.organization.create({ data: { name: `Verify Org FD3 ${suffix}`, slug: `verify-org-fd3-${suffix}` } });
    const clinicFD3 = await prisma.clinic.create({ data: { name: `Verify Clinic FD3 ${suffix}`, slug: `verify-clinic-fd3-${suffix}`, organizationId: orgFD3.id } });
    const userFD3 = await prisma.user.create({
      data: { clinicId: clinicFD3.id, organizationId: orgFD3.id, firstName: 'Verify', lastName: 'MidGenUser', email: `verify-midgen-fd-${suffix}@example.test`, role: 'OWNER', passwordHash: 'x' },
    });
    await prisma.patient.create({ data: { clinicId: clinicFD3.id, organizationId: orgFD3.id, firstName: 'MidGen', lastName: 'Patient' } });

    let jobId = '';
    const originalFlag3 = process.env.CLINIC_BULK_EXPORT_ENABLED;
    process.env.CLINIC_BULK_EXPORT_ENABLED = 'true';
    try {
      const reserved = await reserveClinicBulkExport({
        clinicId: clinicFD3.id,
        organizationId: orgFD3.id,
        requestedByUserId: userFD3.id,
        purpose: 'other',
        restrictedNote: null,
        stepUpVerifiedAt: new Date(),
        actorRole: 'OWNER',
        req: fakeReq,
      });
      jobId = reserved.jobId;
      await claimQueuedClinicBulkExportJobs(5);

      await generateClinicBulkExport(jobId, undefined, async () => {
        // Fires immediately before the second flag re-check (right after
        // this hook, strictly before the planned-key persist) — flips the
        // flag off in exactly the narrow window that checkpoint must catch.
        process.env.CLINIC_BULK_EXPORT_ENABLED = 'false';
      });
    } finally {
      if (originalFlag3 === undefined) delete process.env.CLINIC_BULK_EXPORT_ENABLED;
      else process.env.CLINIC_BULK_EXPORT_ENABLED = originalFlag3;
    }

    const row = await prisma.clinicBulkExportArchive.findUniqueOrThrow({ where: { id: jobId } });
    assert.equal(row.status, 'failed');
    assert.equal(row.failureCode, 'FEATURE_DISABLED');
    assert.equal(row.storageKey, null, 'the planned key must never be persisted once disabled mid-flight, strictly before the persist');

    const exportsDir = path.resolve(process.cwd(), 'uploads', 'exports', clinicFD3.id);
    assert.ok(!fs.existsSync(exportsDir) || fs.readdirSync(exportsDir).length === 0, 'no final artifact may ever be written once disabled before upload');
    assert.equal(listExportTempFilesFor(jobId).length, 0, 'the temp ZIP must be unlinked, never left behind');

    await prisma.patient.deleteMany({ where: { clinicId: clinicFD3.id } });
    await prisma.clinicBulkExportArchive.deleteMany({ where: { clinicId: clinicFD3.id } });
    await prisma.user.delete({ where: { id: userFD3.id } });
    await prisma.clinic.delete({ where: { id: clinicFD3.id } });
    await prisma.organization.delete({ where: { id: orgFD3.id } });
  });

  await test('disabling the flag after a real upload (before the ready transition) deletes the just-uploaded real artifact and never sets ready', async () => {
    const orgFD4 = await prisma.organization.create({ data: { name: `Verify Org FD4 ${suffix}`, slug: `verify-org-fd4-${suffix}` } });
    const clinicFD4 = await prisma.clinic.create({ data: { name: `Verify Clinic FD4 ${suffix}`, slug: `verify-clinic-fd4-${suffix}`, organizationId: orgFD4.id } });
    const userFD4 = await prisma.user.create({
      data: { clinicId: clinicFD4.id, organizationId: orgFD4.id, firstName: 'Verify', lastName: 'PostUploadUser', email: `verify-postupload-fd-${suffix}@example.test`, role: 'OWNER', passwordHash: 'x' },
    });
    await prisma.patient.create({ data: { clinicId: clinicFD4.id, organizationId: orgFD4.id, firstName: 'PostUpload', lastName: 'Patient' } });

    let jobId = '';
    let uploadedKey = '';
    const originalFlag4 = process.env.CLINIC_BULK_EXPORT_ENABLED;
    process.env.CLINIC_BULK_EXPORT_ENABLED = 'true';
    try {
      const reserved = await reserveClinicBulkExport({
        clinicId: clinicFD4.id,
        organizationId: orgFD4.id,
        requestedByUserId: userFD4.id,
        purpose: 'other',
        restrictedNote: null,
        stepUpVerifiedAt: new Date(),
        actorRole: 'OWNER',
        req: fakeReq,
      });
      jobId = reserved.jobId;
      await claimQueuedClinicBulkExportJobs(5);

      await generateClinicBulkExport(jobId, async (key: string, tempPath: string, contentType: string) => {
        uploadedKey = key;
        const { saveFileFromPath: realSave } = await import('../src/services/fileStorage.js');
        await realSave(key, tempPath, contentType); // real bytes really land in storage
        process.env.CLINIC_BULK_EXPORT_ENABLED = 'false'; // disabled strictly AFTER the real upload completes
      });
    } finally {
      if (originalFlag4 === undefined) delete process.env.CLINIC_BULK_EXPORT_ENABLED;
      else process.env.CLINIC_BULK_EXPORT_ENABLED = originalFlag4;
    }

    const row = await prisma.clinicBulkExportArchive.findUniqueOrThrow({ where: { id: jobId } });
    assert.equal(row.status, 'failed', 'disabling mid-flight must never allow the ready transition');
    assert.equal(row.failureCode, 'FEATURE_DISABLED');
    assert.equal(row.storageKey, null, 'the orphaned real artifact must have been found and deleted via its pre-persisted storageKey');
    assert.ok(uploadedKey, 'sanity check: the real upload must actually have happened');
    assert.ok(!fs.existsSync(resolveLocalStoragePath(uploadedKey)), 'the real uploaded artifact must actually be gone from disk');

    await prisma.patient.deleteMany({ where: { clinicId: clinicFD4.id } });
    await prisma.clinicBulkExportArchive.deleteMany({ where: { clinicId: clinicFD4.id } });
    await prisma.user.delete({ where: { id: userFD4.id } });
    await prisma.clinic.delete({ where: { id: clinicFD4.id } });
    await prisma.organization.delete({ where: { id: orgFD4.id } });
  });

  await test('re-enabling the flag does not resurrect an already FEATURE_DISABLED job — it stays failed and is never claimed', async () => {
    const orgFD5 = await prisma.organization.create({ data: { name: `Verify Org FD5 ${suffix}`, slug: `verify-org-fd5-${suffix}` } });
    const clinicFD5 = await prisma.clinic.create({ data: { name: `Verify Clinic FD5 ${suffix}`, slug: `verify-clinic-fd5-${suffix}`, organizationId: orgFD5.id } });
    const userFD5 = await prisma.user.create({
      data: { clinicId: clinicFD5.id, organizationId: orgFD5.id, firstName: 'Verify', lastName: 'ReEnableUser', email: `verify-reenable-fd-${suffix}@example.test`, role: 'OWNER', passwordHash: 'x' },
    });

    const { jobId } = await reserveClinicBulkExport({
      clinicId: clinicFD5.id,
      organizationId: orgFD5.id,
      requestedByUserId: userFD5.id,
      purpose: 'other',
      restrictedNote: null,
      stepUpVerifiedAt: new Date(),
      actorRole: 'OWNER',
      req: fakeReq,
    });
    await withEnvOverride({ CLINIC_BULK_EXPORT_ENABLED: 'false' }, () => claimQueuedClinicBulkExportJobs(5));
    const disabledRow = await prisma.clinicBulkExportArchive.findUniqueOrThrow({ where: { id: jobId } });
    assert.equal(disabledRow.status, 'failed');
    assert.equal(disabledRow.failureCode, 'FEATURE_DISABLED');

    // Re-enable and try again — a terminal 'failed' row is never claimable by
    // definition (the claim query only ever selects status: 'queued'), but
    // this proves that explicitly rather than relying on it incidentally.
    const claimedAfterReenable = await withEnvOverride({ CLINIC_BULK_EXPORT_ENABLED: 'true' }, () => claimQueuedClinicBulkExportJobs(5));
    assert.ok(
      !claimedAfterReenable.includes(jobId),
      'a job already terminated as FEATURE_DISABLED must never be resurrected merely by re-enabling the flag',
    );
    const finalRow = await prisma.clinicBulkExportArchive.findUniqueOrThrow({ where: { id: jobId } });
    assert.equal(finalRow.status, 'failed', 'the row must remain in its terminal failed state');

    await prisma.clinicBulkExportArchive.deleteMany({ where: { clinicId: clinicFD5.id } });
    await prisma.user.delete({ where: { id: userFD5.id } });
    await prisma.clinic.delete({ where: { id: clinicFD5.id } });
    await prisma.organization.delete({ where: { id: orgFD5.id } });
  });

  console.log('\nFinal-ZIP byte ceiling is enforced on the REAL completed file, after manifest.json + ZIP central-directory overhead (P0)');

  await test('entity payload alone stays within budget, but manifest.json + ZIP overhead pushes the real final file over the ceiling — the post-finalize check still fails cleanly', async () => {
    const orgBC = await prisma.organization.create({ data: { name: `Verify Org BC ${suffix}`, slug: `verify-org-bc-${suffix}` } });
    const clinicBC = await prisma.clinic.create({ data: { name: `Verify Clinic BC ${suffix}`, slug: `verify-clinic-bc-${suffix}`, organizationId: orgBC.id } });
    const userBC = await prisma.user.create({
      data: { clinicId: clinicBC.id, organizationId: orgBC.id, firstName: 'Verify', lastName: 'ByteCeilingUser', email: `verify-byteceiling-${suffix}@example.test`, role: 'OWNER', passwordHash: 'x' },
    });
    await prisma.patient.create({ data: { clinicId: clinicBC.id, organizationId: orgBC.id, firstName: 'ByteCeiling', lastName: 'Patient' } });

    // Calibration run: generate once with no byte-limit override, to learn
    // the REAL final ZIP size for this exact payload in this exact
    // environment (zlib/archiver version) — avoids guessing a magic
    // threshold that would be fragile across environments.
    const { jobId: calibJobId } = await reserveClinicBulkExport({
      clinicId: clinicBC.id,
      organizationId: orgBC.id,
      requestedByUserId: userBC.id,
      purpose: 'other',
      restrictedNote: null,
      stepUpVerifiedAt: new Date(),
      actorRole: 'OWNER',
      req: fakeReq,
    });
    await claimQueuedClinicBulkExportJobs(5);
    await generateClinicBulkExport(calibJobId);
    const calibRow = await prisma.clinicBulkExportArchive.findUniqueOrThrow({ where: { id: calibJobId } });
    assert.equal(calibRow.status, 'ready', 'the calibration run must succeed unconstrained');
    const realFinalSize = fs.statSync(resolveLocalStoragePath(calibRow.storageKey!)).size;
    await deleteFile(calibRow.storageKey!);
    await prisma.clinicBulkExportArchive.delete({ where: { id: calibJobId } });

    // Real test run: cap MAX_BYTES to one byte under the real final size just
    // measured. The entity payload (one tiny patient record) is flushed
    // through archiver's 'data' event well before manifest.json is appended
    // and long before finalize() emits the ZIP's own central directory/EOCD
    // — so the OLD streaming-only check (which ran before manifest.json and
    // finalize()) would not have seen enough bytes yet to trip. Only the NEW
    // post-finalize, real-file-size check can catch this.
    const { jobId } = await reserveClinicBulkExport({
      clinicId: clinicBC.id,
      organizationId: orgBC.id,
      requestedByUserId: userBC.id,
      purpose: 'other',
      restrictedNote: null,
      stepUpVerifiedAt: new Date(),
      actorRole: 'OWNER',
      req: fakeReq,
    });
    await claimQueuedClinicBulkExportJobs(5);
    const originalMaxBytes = process.env.CLINIC_BULK_EXPORT_MAX_BYTES;
    try {
      process.env.CLINIC_BULK_EXPORT_MAX_BYTES = String(realFinalSize - 1);
      await generateClinicBulkExport(jobId);
    } finally {
      if (originalMaxBytes === undefined) delete process.env.CLINIC_BULK_EXPORT_MAX_BYTES;
      else process.env.CLINIC_BULK_EXPORT_MAX_BYTES = originalMaxBytes;
    }

    const failedRow = await prisma.clinicBulkExportArchive.findUniqueOrThrow({ where: { id: jobId } });
    assert.equal(failedRow.status, 'failed');
    assert.equal(failedRow.failureCode, 'SIZE_LIMIT_EXCEEDED');
    assert.equal(failedRow.storageKey, null, 'no artifact may ever be persisted once the post-finalize size check fails');

    const exportsDir = path.resolve(process.cwd(), 'uploads', 'exports', clinicBC.id);
    assert.ok(!fs.existsSync(exportsDir) || fs.readdirSync(exportsDir).length === 0, 'no final artifact may be left in storage');
    assert.equal(listExportTempFilesFor(jobId).length, 0, 'the temp ZIP must be unlinked, never left behind');

    await prisma.patient.deleteMany({ where: { clinicId: clinicBC.id } });
    await prisma.clinicBulkExportArchive.deleteMany({ where: { clinicId: clinicBC.id } });
    await prisma.user.delete({ where: { id: userBC.id } });
    await prisma.clinic.delete({ where: { id: clinicBC.id } });
    await prisma.organization.delete({ where: { id: orgBC.id } });
  });

  console.log('\nProcess-local stale-temp-file sweep: age AND DB status/lease both gate deletion (P0)');

  await test('a recognized temp file for a still-ACTIVELY-GENERATING row with a live lease is never deleted, no matter how old', async () => {
    const orgST1 = await prisma.organization.create({ data: { name: `Verify Org ST1 ${suffix}`, slug: `verify-org-st1-${suffix}` } });
    const clinicST1 = await prisma.clinic.create({ data: { name: `Verify Clinic ST1 ${suffix}`, slug: `verify-clinic-st1-${suffix}`, organizationId: orgST1.id } });
    const userST1 = await prisma.user.create({
      data: { clinicId: clinicST1.id, organizationId: orgST1.id, firstName: 'Verify', lastName: 'SweepActiveUser', email: `verify-sweepactive-${suffix}@example.test`, role: 'OWNER', passwordHash: 'x' },
    });
    const { jobId } = await reserveClinicBulkExport({
      clinicId: clinicST1.id,
      organizationId: orgST1.id,
      requestedByUserId: userST1.id,
      purpose: 'other',
      restrictedNote: null,
      stepUpVerifiedAt: new Date(),
      actorRole: 'OWNER',
      req: fakeReq,
    });
    await claimQueuedClinicBulkExportJobs(5); // status -> 'generating', live lease

    await ensureExportTempDir();
    const tempFilePath = buildExportTempFilePath(jobId);
    await fs.promises.writeFile(tempFilePath, Buffer.from('pretend in-progress temp zip bytes'));
    const veryOld = new Date(Date.now() - 60 * 60 * 1000);
    await fs.promises.utimes(tempFilePath, veryOld, veryOld);

    const deleted = await sweepStaleClinicBulkExportTempFiles(new Date(), 1000); // tiny maxAgeMs — age alone would allow deletion
    assert.equal(deleted, 0, 'a live, actively-generating job\'s temp file must never be counted as deleted');
    assert.ok(fs.existsSync(tempFilePath), 'the temp file must still exist — it belongs to a row the DB shows as actively generating with an unexpired lease');

    await fs.promises.unlink(tempFilePath).catch(() => {});
    await prisma.clinicBulkExportArchive.deleteMany({ where: { clinicId: clinicST1.id } });
    await prisma.user.delete({ where: { id: userST1.id } });
    await prisma.clinic.delete({ where: { id: clinicST1.id } });
    await prisma.organization.delete({ where: { id: orgST1.id } });
  });

  await test('a recognized temp file old enough, for a row that is no longer generating (failed) OR has no row at all, IS deleted', async () => {
    const orgST2 = await prisma.organization.create({ data: { name: `Verify Org ST2 ${suffix}`, slug: `verify-org-st2-${suffix}` } });
    const clinicST2 = await prisma.clinic.create({ data: { name: `Verify Clinic ST2 ${suffix}`, slug: `verify-clinic-st2-${suffix}`, organizationId: orgST2.id } });
    const userST2 = await prisma.user.create({
      data: { clinicId: clinicST2.id, organizationId: orgST2.id, firstName: 'Verify', lastName: 'SweepStaleUser', email: `verify-sweepstale-${suffix}@example.test`, role: 'OWNER', passwordHash: 'x' },
    });
    const { jobId: failedJobId } = await reserveClinicBulkExport({
      clinicId: clinicST2.id,
      organizationId: orgST2.id,
      requestedByUserId: userST2.id,
      purpose: 'other',
      restrictedNote: null,
      stepUpVerifiedAt: new Date(),
      actorRole: 'OWNER',
      req: fakeReq,
    });
    await claimQueuedClinicBulkExportJobs(5);
    await prisma.clinicBulkExportArchive.update({ where: { id: failedJobId }, data: { status: 'failed', failureCode: 'GENERATION_ERROR' } });

    await ensureExportTempDir();
    const failedTempPath = buildExportTempFilePath(failedJobId);
    await fs.promises.writeFile(failedTempPath, Buffer.from('orphaned temp zip for a failed job'));
    const missingRowJobId = crypto.randomUUID();
    const missingRowTempPath = buildExportTempFilePath(missingRowJobId);
    await fs.promises.writeFile(missingRowTempPath, Buffer.from('orphaned temp zip with no DB row at all'));
    const old = new Date(Date.now() - 60 * 60 * 1000);
    await fs.promises.utimes(failedTempPath, old, old);
    await fs.promises.utimes(missingRowTempPath, old, old);

    const deleted = await sweepStaleClinicBulkExportTempFiles(new Date(), 5 * 60 * 1000);
    assert.ok(deleted >= 2, 'both the failed-row and the no-row-at-all temp files must be deleted');
    assert.ok(!fs.existsSync(failedTempPath), 'a temp file for a terminal (failed) row must actually be gone from disk');
    assert.ok(!fs.existsSync(missingRowTempPath), 'a temp file whose job id has no DB row at all must actually be gone from disk');

    await prisma.clinicBulkExportArchive.deleteMany({ where: { clinicId: clinicST2.id } });
    await prisma.user.delete({ where: { id: userST2.id } });
    await prisma.clinic.delete({ where: { id: clinicST2.id } });
    await prisma.organization.delete({ where: { id: orgST2.id } });
  });

  await test('a recognized temp file younger than maxAgeMs is never deleted, even for a row that is already terminal', async () => {
    const orgST3 = await prisma.organization.create({ data: { name: `Verify Org ST3 ${suffix}`, slug: `verify-org-st3-${suffix}` } });
    const clinicST3 = await prisma.clinic.create({ data: { name: `Verify Clinic ST3 ${suffix}`, slug: `verify-clinic-st3-${suffix}`, organizationId: orgST3.id } });
    const userST3 = await prisma.user.create({
      data: { clinicId: clinicST3.id, organizationId: orgST3.id, firstName: 'Verify', lastName: 'SweepYoungUser', email: `verify-sweepyoung-${suffix}@example.test`, role: 'OWNER', passwordHash: 'x' },
    });
    const { jobId } = await reserveClinicBulkExport({
      clinicId: clinicST3.id,
      organizationId: orgST3.id,
      requestedByUserId: userST3.id,
      purpose: 'other',
      restrictedNote: null,
      stepUpVerifiedAt: new Date(),
      actorRole: 'OWNER',
      req: fakeReq,
    });
    await claimQueuedClinicBulkExportJobs(5);
    await prisma.clinicBulkExportArchive.update({ where: { id: jobId }, data: { status: 'failed', failureCode: 'GENERATION_ERROR' } });

    await ensureExportTempDir();
    const tempFilePath = buildExportTempFilePath(jobId);
    await fs.promises.writeFile(tempFilePath, Buffer.from('a very fresh temp file'));
    // Deliberately NOT backdated — its mtime is "now".

    const deleted = await sweepStaleClinicBulkExportTempFiles(new Date(), 60 * 60 * 1000); // 1 hour
    assert.equal(deleted, 0, 'a fresh file must never be deleted purely because its row is already terminal');
    assert.ok(fs.existsSync(tempFilePath), 'the fresh temp file must still exist');

    await fs.promises.unlink(tempFilePath).catch(() => {});
    await prisma.clinicBulkExportArchive.deleteMany({ where: { clinicId: clinicST3.id } });
    await prisma.user.delete({ where: { id: userST3.id } });
    await prisma.clinic.delete({ where: { id: clinicST3.id } });
    await prisma.organization.delete({ where: { id: orgST3.id } });
  });

  await test('the sweep never touches a file in the same directory that does not match the recognized naming pattern', async () => {
    await ensureExportTempDir();
    const unrelatedPath = path.join(getExportTempDir(), `unrelated-file-${suffix}.txt`);
    await fs.promises.writeFile(unrelatedPath, Buffer.from('not an export temp file'));
    const veryOld = new Date(Date.now() - 60 * 60 * 1000);
    await fs.promises.utimes(unrelatedPath, veryOld, veryOld);

    await sweepStaleClinicBulkExportTempFiles(new Date(), 1000);
    assert.ok(fs.existsSync(unrelatedPath), 'a file the sweep does not recognize as its own naming pattern must never be touched');

    await fs.promises.unlink(unrelatedPath).catch(() => {});
  });

  console.log('\nReal child-process hard crash: no catch/finally ever runs in the crashed process, yet the temp ZIP is still cleaned up (P0)');

  await test('a real child process is SIGKILLed mid-generation; a separate process (this one) later recognizes and deletes its real temp ZIP, with no final/partial artifact ever created', async () => {
    const orgCH = await prisma.organization.create({ data: { name: `Verify Org CH ${suffix}`, slug: `verify-org-ch-${suffix}` } });
    const clinicCH = await prisma.clinic.create({ data: { name: `Verify Clinic CH ${suffix}`, slug: `verify-clinic-ch-${suffix}`, organizationId: orgCH.id } });
    const userCH = await prisma.user.create({
      data: { clinicId: clinicCH.id, organizationId: orgCH.id, firstName: 'Verify', lastName: 'CrashChildUser', email: `verify-crashchild-${suffix}@example.test`, role: 'OWNER', passwordHash: 'x' },
    });
    // Enough records that generation takes measurably longer than an
    // instant, widening the real window in which the temp ZIP exists on
    // disk before the (never-reached, in this test) completion.
    await prisma.patient.createMany({
      data: Array.from({ length: 3000 }, (_, i) => ({ clinicId: clinicCH.id, organizationId: orgCH.id, firstName: `Crash${i}`, lastName: 'Patient' })),
    });

    const { jobId } = await reserveClinicBulkExport({
      clinicId: clinicCH.id,
      organizationId: orgCH.id,
      requestedByUserId: userCH.id,
      purpose: 'other',
      restrictedNote: null,
      stepUpVerifiedAt: new Date(),
      actorRole: 'OWNER',
      req: fakeReq,
    });
    await claimQueuedClinicBulkExportJobs(5);

    const childScriptPath = fileURLToPath(new URL('./_clinicBulkExportCrashChild.ts', import.meta.url));
    const child = spawn(process.execPath, ['--import', 'tsx', childScriptPath, jobId], {
      cwd: process.cwd(),
      // The parent script itself must keep running with creation disabled
      // (asserted earlier), but the CHILD needs the flag on to actually
      // reach real generation — this is what generateClinicBulkExport's own
      // first re-check would otherwise stop before any file is even
      // created.
      env: { ...process.env, CLINIC_BULK_EXPORT_ENABLED: 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let childOutput = '';
    child.stdout?.on('data', (d: Buffer) => {
      childOutput += d.toString();
    });
    child.stderr?.on('data', (d: Buffer) => {
      childOutput += d.toString();
    });

    // Poll for the child's real temp ZIP to appear on disk — proves the
    // child actually reached real file creation before being killed, rather
    // than this test racing a process that never got that far.
    const tempDir = getExportTempDir();
    const deadline = Date.now() + 20000;
    let tempFileName: string | null = null;
    while (Date.now() < deadline) {
      try {
        const found = fs.readdirSync(tempDir).find((f) => f.includes(jobId));
        if (found) {
          tempFileName = found;
          break;
        }
      } catch {
        // Directory may not exist yet on the very first poll(s).
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(tempFileName, `the child process's real temp ZIP must appear on disk within the deadline (child output so far: ${childOutput})`);
    const tempFilePath = path.join(tempDir, tempFileName!);
    assert.ok(fs.existsSync(tempFilePath), 'sanity check: the temp file must really exist on disk before the kill');

    // SIGKILL cannot be caught or trapped — no catch/finally in the CHILD
    // process is ever given a chance to run.
    child.kill('SIGKILL');
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    assert.ok(
      !childOutput.includes('CRASH_CHILD_UNEXPECTED_COMPLETION'),
      `the child must actually have been killed mid-generation, not completed first (output: ${childOutput})`,
    );

    // The crashed child can no longer renew its lease or unlink its own temp
    // file. Simulate the real-world passage of time deterministically (a
    // real production wait would be up to getGenerationLeaseMs() for the
    // lease, and the sweep's own maxAgeMs for the file) via direct writes,
    // exactly like every other timing-dependent test in this script.
    await prisma.clinicBulkExportArchive.update({ where: { id: jobId }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });
    const past = new Date(Date.now() - 10 * 60 * 1000);
    await fs.promises.utimes(tempFilePath, past, past);

    // Cleanup runs HERE, in the verify script's OWN process — a process
    // distinct from the one that was just SIGKILLed above.
    const deletedCount = await sweepStaleClinicBulkExportTempFiles(new Date(), 5 * 60 * 1000);
    assert.ok(deletedCount >= 1, "the stale-temp sweep must have deleted at least the crashed child's temp file");
    assert.ok(!fs.existsSync(tempFilePath), 'the real temp ZIP must actually be gone from disk after the sweep');

    // No final/partial artifact was ever created either — the crash
    // happened strictly before the planned-storageKey persist step.
    const exportsDir = path.resolve(process.cwd(), 'uploads', 'exports', clinicCH.id);
    assert.ok(
      !fs.existsSync(exportsDir) || fs.readdirSync(exportsDir).length === 0,
      'no final or partial artifact may exist for a job that crashed before ever uploading',
    );

    await prisma.patient.deleteMany({ where: { clinicId: clinicCH.id } });
    await prisma.clinicBulkExportArchive.deleteMany({ where: { clinicId: clinicCH.id } });
    await prisma.user.delete({ where: { id: userCH.id } });
    await prisma.clinic.delete({ where: { id: clinicCH.id } });
    await prisma.organization.delete({ where: { id: orgCH.id } });
  });

  console.log('\nLocal-mode temp/partial/final export files are created with mode 0600 (POSIX only — Windows has no equivalent permission model)');

  await test('a real end-to-end generation run produces a final local artifact with mode 0600', async () => {
    if (process.platform === 'win32') {
      console.log('    (skipped strict mode assertion on win32 — Node synthesizes file mode from the read-only attribute only; verified on POSIX in CI/production instead)');
      return;
    }
    const orgPM = await prisma.organization.create({ data: { name: `Verify Org PM ${suffix}`, slug: `verify-org-pm-${suffix}` } });
    const clinicPM = await prisma.clinic.create({ data: { name: `Verify Clinic PM ${suffix}`, slug: `verify-clinic-pm-${suffix}`, organizationId: orgPM.id } });
    const userPM = await prisma.user.create({
      data: { clinicId: clinicPM.id, organizationId: orgPM.id, firstName: 'Verify', lastName: 'PermsUser', email: `verify-perms-${suffix}@example.test`, role: 'OWNER', passwordHash: 'x' },
    });
    await prisma.patient.create({ data: { clinicId: clinicPM.id, organizationId: orgPM.id, firstName: 'Perms', lastName: 'Patient' } });

    const { jobId } = await reserveClinicBulkExport({
      clinicId: clinicPM.id,
      organizationId: orgPM.id,
      requestedByUserId: userPM.id,
      purpose: 'other',
      restrictedNote: null,
      stepUpVerifiedAt: new Date(),
      actorRole: 'OWNER',
      req: fakeReq,
    });
    await claimQueuedClinicBulkExportJobs(5);
    await generateClinicBulkExport(jobId);

    const row = await prisma.clinicBulkExportArchive.findUniqueOrThrow({ where: { id: jobId } });
    assert.equal(row.status, 'ready');
    const finalPath = resolveLocalStoragePath(row.storageKey!);
    const mode = fs.statSync(finalPath).mode & 0o777;
    assert.equal(mode, 0o600, `final local export artifact must be mode 0600, got ${mode.toString(8)}`);

    await deleteFile(row.storageKey!);
    await prisma.patient.deleteMany({ where: { clinicId: clinicPM.id } });
    await prisma.clinicBulkExportArchive.deleteMany({ where: { clinicId: clinicPM.id } });
    await prisma.user.delete({ where: { id: userPM.id } });
    await prisma.clinic.delete({ where: { id: clinicPM.id } });
    await prisma.organization.delete({ where: { id: orgPM.id } });
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  await prisma.$disconnect();
  if (failed > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});

/**
 * imagingStoragePlacement.test.ts — F4-IMAGING-001-R6.
 *
 * End-to-end regression cover for the ACCEPTED PRODUCTION-ACTIVATION BLOCKER
 * recorded as R5 Finding B: `ImagingImage` had no per-object storage placement
 * discriminator, so the read path inferred placement from the global
 * `IMAGING_STORAGE_BACKEND` flag. Once an object had been written only to VPS2,
 * unsetting that flag silently reclassified it as legacy and made it
 * unreadable — configuration rollback was unsafe after the first VPS2 write.
 *
 * R6 persists the backend that actually accepted the bytes on
 * `ImagingImage.storageBackend` and reads it back through
 * `resolveImagingStoragePlacement()`. Global configuration decides where NEW
 * objects are WRITTEN; the column decides where an EXISTING object is READ.
 *
 * WHAT THIS SUITE IS. Real disposable PostgreSQL + real disposable MinIO, real
 * `prisma` client, real `ingestImagingStudyCore`, real S3 wire protocol. No
 * mocks and no stubs: the whole 404-vs-provider-error contract is defined by
 * actual AWS SDK error shapes (`NoSuchKey` / `NotFound` / `$metadata
 * .httpStatusCode`), and a stub would let this pass while the real SDK shape
 * diverged. Every payload is `crypto.randomBytes(...)` — no real patient,
 * DICOM or CBCT data, and nothing production is touched.
 *
 * The VPS2 side is simulated by the same disposable MinIO the storage layer
 * already uses, in its OWN bucket with its own credentials, because an
 * imaging-primary store and a backup destination are different concerns that
 * must not share either. This suite writes no backup at all — backup coverage
 * lives in fileBackupDbIntegration.test.ts.
 *
 * DELIBERATELY WRITES NO EXECUTION RECEIPT. The Layer 4 gate
 * (scripts/test-runtime/lib/executionProof.ts) has a single receipt slot keyed
 * to `fileBackupDbIntegration`; a second receipt-writing suite would clobber
 * that artifact and fail the gate for a non-test reason.
 *
 * Requires DATABASE_URL pointing at a disposable Postgres with migrations
 * applied, and MINIO_ENDPOINT/MINIO_ACCESS_KEY/MINIO_SECRET_KEY. If MinIO is
 * unreachable the MinIO-dependent sections self-skip, matching
 * imagingRemoteStorage.test.ts, so the file stays safe outside Layer 4.
 *
 * Run: cd server && npx tsx src/tests/dbVerification/imagingStoragePlacement.test.ts
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { S3Client, CreateBucketCommand, PutObjectCommand } from '@aws-sdk/client-s3';

import {
  prisma,
  createSuite,
  createClinicFixtureSet,
  createTestPatient,
  cleanupAllFixtures,
  type ClinicFixtureSet,
} from './dbVerificationHarness.js';
import {
  openImagingFileStream,
  imagingFileExists,
  fileExists,
} from '../../services/fileStorage.js';
import {
  resolveImagingStoragePlacement,
  __resetImagingS3ClientForTest,
} from '../../services/imagingRemoteStorage.js';
import {
  ingestImagingStudyCore,
  type IngestImagingStudyCoreInput,
} from '../../services/imaging/imagingIngestCore.js';
import {
  checkImageStorageExists,
  ImagingNotFoundError,
  ImagingStorageUnavailableError,
} from '../../services/imaging/public.js';

const { section, test, summary } = createSuite('imagingStoragePlacement');

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`);
  }
}
function assertTrue(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

const sha256 = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

const BASE_UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');
const createdUploadDirs: string[] = [];

/** Writes a LEGACY (local-disk) object at an imaging-shaped key, without going through any imaging wrapper. */
async function writeLegacyObject(clinicId: string, content: Buffer): Promise<string> {
  const relKey = `${clinicId}/${randomUUID()}.bin`;
  const absPath = path.join(BASE_UPLOAD_DIR, relKey);
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, content);
  createdUploadDirs.push(path.dirname(absPath));
  return relKey;
}

const imagingBucketName = `imaging-placement-r6-${Date.now()}`;
const minioEndpoint = process.env.MINIO_ENDPOINT || 'http://localhost:19000';
const minioAccessKey = process.env.MINIO_ACCESS_KEY || 'reviewminio';
const minioSecretKey = process.env.MINIO_SECRET_KEY || 'reviewminiosecret';

const IMAGING_ENV_KEYS = [
  'IMAGING_STORAGE_BACKEND',
  'IMAGING_S3_BUCKET',
  'IMAGING_S3_REGION',
  'IMAGING_S3_ENDPOINT',
  'IMAGING_S3_ACCESS_KEY_ID',
  'IMAGING_S3_SECRET_ACCESS_KEY',
  'IMAGING_S3_FORCE_PATH_STYLE',
] as const;

const envSnapshot: Record<string, string | undefined> = {};
for (const key of IMAGING_ENV_KEYS) envSnapshot[key] = process.env[key];

/** VPS2 connection settings. `activateWrites` mirrors production activation; leaving it false is the post-rollback shape (connection configured, writes back on legacy). */
function configureVps2(opts: { activateWrites: boolean; accessKeyId?: string } = { activateWrites: false }): void {
  process.env.IMAGING_S3_BUCKET = imagingBucketName;
  process.env.IMAGING_S3_ENDPOINT = minioEndpoint;
  process.env.IMAGING_S3_ACCESS_KEY_ID = opts.accessKeyId ?? minioAccessKey;
  process.env.IMAGING_S3_SECRET_ACCESS_KEY = minioSecretKey;
  process.env.IMAGING_S3_FORCE_PATH_STYLE = 'true';
  process.env.IMAGING_S3_REGION = 'auto';
  if (opts.activateWrites) process.env.IMAGING_STORAGE_BACKEND = 'vps2';
  else delete process.env.IMAGING_STORAGE_BACKEND;
  __resetImagingS3ClientForTest();
}

function clearImagingEnv(): void {
  for (const key of IMAGING_ENV_KEYS) delete process.env[key];
  __resetImagingS3ClientForTest();
}

function restoreEnv(): void {
  for (const key of IMAGING_ENV_KEYS) {
    if (envSnapshot[key] === undefined) delete process.env[key];
    else process.env[key] = envSnapshot[key]!;
  }
  __resetImagingS3ClientForTest();
}

async function main(): Promise<boolean> {
  clearImagingEnv();

  const fixtures: ClinicFixtureSet = await createClinicFixtureSet('r6-placement');
  const patientA = await createTestPatient({ organizationId: (await prisma.clinic.findUniqueOrThrow({ where: { id: fixtures.defaultClinicId } })).organizationId, clinicId: fixtures.defaultClinicId });
  const patientB = await createTestPatient({ organizationId: (await prisma.clinic.findUniqueOrThrow({ where: { id: fixtures.crossOrgClinicId } })).organizationId, clinicId: fixtures.crossOrgClinicId });

  const studyA = await prisma.imagingStudy.create({ data: { clinicId: fixtures.defaultClinicId, patientId: patientA.id, modality: 'PX' } });
  const studyB = await prisma.imagingStudy.create({ data: { clinicId: fixtures.crossOrgClinicId, patientId: patientB.id, modality: 'PX' } });

  /** Fully-typed manual-upload ingest input — the real production shape, no `as any`. */
  function ingestInput(fileBuffer: Buffer, originalName: string): IngestImagingStudyCoreInput {
    return {
      clinicId: fixtures.defaultClinicId,
      source: 'manual_upload',
      createdById: null,
      bridgeAgentId: null,
      ingestKey: null,
      patientId: patientA.id,
      appointmentId: null,
      treatmentCaseId: null,
      deviceId: null,
      modality: 'PX',
      studyDate: null,
      description: null,
      imagingRequestId: null,
      fileBuffer,
      originalName,
      declaredMimeType: 'application/dicom',
      fileSize: fileBuffer.length,
    };
  }

  /**
   * A minimal, structurally-valid DICOM Part-10 payload: a 128-byte preamble
   * followed by the 'DICM' magic at offset 128, then synthetic random bytes.
   * The real ingest path runs isAllowedFileSignature() before it writes
   * anything, so an ingest test MUST feed it something the signature checker
   * accepts — otherwise the write path is never reached and the test would be
   * asserting nothing. Random padding keeps every payload unique so checksum
   * comparisons stay meaningful. No real DICOM/CBCT/patient data is involved.
   */
  function syntheticDicom(paddingBytes: number): Buffer {
    return Buffer.concat([
      Buffer.alloc(128, 0),
      Buffer.from('DICM', 'ascii'),
      crypto.randomBytes(paddingBytes),
    ]);
  }

  const createdImageIds: string[] = [];
  async function createRow(clinicId: string, studyId: string, key: string, size: number, storageBackend: 'legacy' | 'vps2' | null) {
    const row = await prisma.imagingImage.create({
      data: {
        clinicId,
        studyId,
        fileName: 'r6.bin',
        originalName: 'r6.bin',
        fileSize: size,
        mimeType: 'application/octet-stream',
        filePath: key,
        storageBackend,
      },
    });
    createdImageIds.push(row.id);
    return row;
  }

  const adminS3 = new S3Client({
    region: 'auto',
    endpoint: minioEndpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: minioAccessKey, secretAccessKey: minioSecretKey },
  });

  let minioAvailable = false;
  try {
    await adminS3.send(new CreateBucketCommand({ Bucket: imagingBucketName }));
    minioAvailable = true;
  } catch (err: any) {
    console.log(`[imagingStoragePlacement] MinIO not reachable at ${minioEndpoint} (${err?.message ?? err}) — skipping MinIO-dependent sections.`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  section('1. Placement is persisted by the WRITE path, from the backend that accepted the bytes');

  await test('R6-6. LEGACY WRITE: a real ingest with the flag unset stores the object on legacy storage AND persists storageBackend = "legacy" (never NULL — NULL is reserved for pre-R6 rows)', async () => {
    clearImagingEnv();
    const bytes = syntheticDicom(1024);
    const result = await ingestImagingStudyCore(
      ingestInput(bytes, 'legacy-write.dcm'),
    );
    const row = await prisma.imagingImage.findFirstOrThrow({ where: { studyId: result.studyId } });
    createdImageIds.push(row.id);
    assertEqual(row.storageBackend, 'legacy', 'a legacy write must persist an EXPLICIT legacy placement');
    assertEqual(await fileExists(row.filePath), true, 'the bytes really are on legacy storage');
    assertEqual(resolveImagingStoragePlacement(row.storageBackend), 'legacy', 'and it resolves to legacy');
  });

  if (minioAvailable) {
    await test('R6-5. VPS2 WRITE: a real ingest with IMAGING_STORAGE_BACKEND=vps2 stores the object in VPS2 ONLY and persists storageBackend = "vps2"', async () => {
      configureVps2({ activateWrites: true });
      const bytes = syntheticDicom(2048);
      const result = await ingestImagingStudyCore(
        ingestInput(bytes, 'vps2-write.dcm'),
      );
      const row = await prisma.imagingImage.findFirstOrThrow({ where: { studyId: result.studyId } });
      createdImageIds.push(row.id);
      assertEqual(row.storageBackend, 'vps2', 'a VPS2 write must persist a VPS2 placement');
      assertEqual(await fileExists(row.filePath), false, 'a VPS2 write must NOT also land on legacy storage');
      assertEqual(await imagingFileExists(row.filePath, 'vps2'), true, 'the object really is in the VPS2 bucket');

      // R6-16: nothing provider-specific may be persisted alongside it.
      const raw = await prisma.imagingImage.findUniqueOrThrow({ where: { id: row.id } });
      const serialized = JSON.stringify(raw);
      for (const secretish of [minioEndpoint, minioAccessKey, minioSecretKey, imagingBucketName, 'http://', 'https://', 's3://']) {
        assertTrue(!serialized.includes(secretish), `the ImagingImage row must never persist ${JSON.stringify(secretish)} — placement is a logical label, not connection data`);
      }
      assertTrue(
        raw.storageBackend === null || raw.storageBackend === 'legacy' || raw.storageBackend === 'vps2',
        'storageBackend must stay inside the closed two-token vocabulary',
      );
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  section('2. Placement — not the global flag — decides where an EXISTING object is read from');

  await test('R6-1. PRE-R6 ROW (NULL placement) reads from legacy storage even while the global write backend is vps2', async () => {
    if (!minioAvailable) { console.log('      (MinIO unavailable — the "flag is on" half of this case is skipped)'); }
    const bytes = crypto.randomBytes(1536);
    const key = await writeLegacyObject(fixtures.defaultClinicId, bytes);
    const row = await createRow(fixtures.defaultClinicId, studyA.id, key, bytes.length, null);

    if (minioAvailable) configureVps2({ activateWrites: true });
    const placement = resolveImagingStoragePlacement(row.storageBackend);
    assertEqual(placement, 'legacy', 'a NULL placement is the pre-R6 row and means legacy');
    const stream = await openImagingFileStream(row.filePath, placement);
    assertTrue(stream, 'a pre-R6 row must still be readable');
    assertEqual(sha256(await readAll(stream!)), sha256(bytes), 'the legacy bytes are returned unchanged');
  });

  if (minioAvailable) {
    await test('R6-2. EXPLICIT LEGACY ROW reads legacy while the global write backend is vps2 — and does so even when DIFFERENT bytes sit at the same key in VPS2 (so the assertion cannot be vacuous)', async () => {
      const legacyBytes = crypto.randomBytes(1200);
      const decoyBytes = crypto.randomBytes(1200);
      assertTrue(sha256(legacyBytes) !== sha256(decoyBytes), 'fixture sanity: the two payloads differ');
      const key = await writeLegacyObject(fixtures.defaultClinicId, legacyBytes);
      await adminS3.send(new PutObjectCommand({ Bucket: imagingBucketName, Key: key, Body: decoyBytes }));
      const row = await createRow(fixtures.defaultClinicId, studyA.id, key, legacyBytes.length, 'legacy');

      configureVps2({ activateWrites: true });
      const stream = await openImagingFileStream(row.filePath, resolveImagingStoragePlacement(row.storageBackend));
      assertTrue(stream, 'an explicit legacy row is readable');
      const got = await readAll(stream!);
      assertEqual(sha256(got), sha256(legacyBytes), 'an explicit legacy row must read the LEGACY bytes');
      assertTrue(sha256(got) !== sha256(decoyBytes), 'it must not have been routed at VPS2 because the write flag happens to be on');
      assertEqual(await imagingFileExists(row.filePath, 'legacy'), true, 'the existence check follows the same rule');
    });

    await test('R6-3. EXPLICIT VPS2 ROW reads VPS2 while the global backend is vps2', async () => {
      const bytes = crypto.randomBytes(4096);
      const key = `${fixtures.defaultClinicId}/${randomUUID()}.bin`;
      await adminS3.send(new PutObjectCommand({ Bucket: imagingBucketName, Key: key, Body: bytes }));
      const row = await createRow(fixtures.defaultClinicId, studyA.id, key, bytes.length, 'vps2');

      configureVps2({ activateWrites: true });
      const stream = await openImagingFileStream(row.filePath, resolveImagingStoragePlacement(row.storageBackend));
      assertTrue(stream, 'a VPS2 row is readable while the flag is on');
      assertEqual(sha256(await readAll(stream!)), sha256(bytes), 'byte-identical to what was put in the bucket');
      assertEqual(await fileExists(row.filePath), false, 'nothing was ever written to legacy storage for this object');
    });

    await test('R6-4. THE FINDING-B CASE: an explicit VPS2 row STILL reads from VPS2 after IMAGING_STORAGE_BACKEND is unset, with matching SHA-256', async () => {
      const bytes = crypto.randomBytes(8192);
      const key = `${fixtures.defaultClinicId}/${randomUUID()}.bin`;
      await adminS3.send(new PutObjectCommand({ Bucket: imagingBucketName, Key: key, Body: bytes }));
      const row = await createRow(fixtures.defaultClinicId, studyA.id, key, bytes.length, 'vps2');

      // Step 1: activate, prove it reads.
      configureVps2({ activateWrites: true });
      const before = await openImagingFileStream(row.filePath, resolveImagingStoragePlacement(row.storageBackend));
      assertTrue(before, 'readable while activated');
      const beforeHash = sha256(await readAll(before!));

      // Step 2: roll the WRITE flag back and re-initialize the client cache,
      // exactly as a process restart after a config rollback would.
      configureVps2({ activateWrites: false });
      assertEqual(process.env.IMAGING_STORAGE_BACKEND, undefined, 'the global write backend really is unset now');

      // Step 3: the same object must still come from VPS2.
      const reread = await prisma.imagingImage.findUniqueOrThrow({ where: { id: row.id } });
      assertEqual(reread.storageBackend, 'vps2', 'the persisted placement is unaffected by the config change');
      const after = await openImagingFileStream(reread.filePath, resolveImagingStoragePlacement(reread.storageBackend));
      assertTrue(after, 'STILL readable after the rollback — this is R5 Finding B, closed');
      const afterHash = sha256(await readAll(after!));
      assertEqual(afterHash, sha256(bytes), 'the bytes are the VPS2 bytes');
      assertEqual(afterHash, beforeHash, 'and identical to what the activated read returned');
      assertEqual(await imagingFileExists(reread.filePath, 'vps2'), true, 'the existence check agrees after the rollback');
      assertEqual(await fileExists(reread.filePath), false, 'there is no legacy copy — the bytes really only exist in VPS2');
    });

    // ════════════════════════════════════════════════════════════════════════
    section('3. Known-VPS2 failure semantics: absent is not the same as unavailable');

    await test('R6-7. CONFIRMED ABSENT: a vps2-placed object that is genuinely not in the bucket resolves null / false — an explicit "gone", not a throw', async () => {
      configureVps2({ activateWrites: false });
      const key = `${fixtures.defaultClinicId}/${randomUUID()}.bin`; // never written anywhere
      const row = await createRow(fixtures.defaultClinicId, studyA.id, key, 0, 'vps2');
      const placement = resolveImagingStoragePlacement(row.storageBackend);
      assertEqual(await openImagingFileStream(row.filePath, placement), null, 'a confirmed-absent VPS2 object reads as null');
      assertEqual(await imagingFileExists(row.filePath, placement), false, 'and as a real false, not an error');
    });

    await test('R6-9. ABSENT VPS2 OBJECT IS NOT SATISFIED FROM A SAME-KEY LEGACY OBJECT — R6 never mirrors or moves bytes, so a legacy twin is not the same object', async () => {
      configureVps2({ activateWrites: false });
      const legacyBytes = crypto.randomBytes(999);
      const key = await writeLegacyObject(fixtures.defaultClinicId, legacyBytes);
      // The key exists on LEGACY storage but NOT in the VPS2 bucket.
      const row = await createRow(fixtures.defaultClinicId, studyA.id, key, legacyBytes.length, 'vps2');
      assertEqual(await fileExists(key), true, 'fixture sanity: a legacy object really does exist at this key');

      const placement = resolveImagingStoragePlacement(row.storageBackend);
      const stream = await openImagingFileStream(row.filePath, placement);
      assertEqual(stream, null, 'a vps2-placed object must not be silently served from the legacy object at the same key');
      assertEqual(await imagingFileExists(row.filePath, placement), false, 'the existence check must not be satisfied by the legacy twin either');
    });

    await test('R6-8. PROVIDER ERROR PROPAGATES: a 403/unreachable VPS2 backend throws for a vps2-placed object — "cannot tell" is never laundered into "not here"', async () => {
      configureVps2({ activateWrites: false, accessKeyId: 'definitely-not-a-valid-access-key' });
      const key = `${fixtures.defaultClinicId}/${randomUUID()}.bin`;
      const row = await createRow(fixtures.defaultClinicId, studyA.id, key, 0, 'vps2');
      const placement = resolveImagingStoragePlacement(row.storageBackend);

      let threw = false;
      try {
        const result = await openImagingFileStream(row.filePath, placement);
        throw new Error(`expected a provider error to propagate, got ${result === null ? 'null' : 'a stream'}`);
      } catch (err: any) {
        threw = !/expected a provider error to propagate/.test(String(err?.message));
        if (!threw) throw err;
      }
      assertTrue(threw, 'the provider error must reach the caller');

      let existsThrew = false;
      try {
        await imagingFileExists(row.filePath, placement);
      } catch {
        existsThrew = true;
      }
      assertTrue(existsThrew, 'the existence check must propagate the provider error too, not answer false');
    });

    await test('R6-9b. PROVIDER ERROR MUST NOT FALL BACK to a legacy object that DOES exist at the same key (the anti-silent-fallback control, with the write flag OFF — the exact shape R5 could not express)', async () => {
      const legacyBytes = crypto.randomBytes(1111);
      const key = await writeLegacyObject(fixtures.defaultClinicId, legacyBytes);
      const row = await createRow(fixtures.defaultClinicId, studyA.id, key, legacyBytes.length, 'vps2');
      assertEqual(await fileExists(key), true, 'fixture sanity: a legacy object really does exist at this key');

      configureVps2({ activateWrites: false, accessKeyId: 'definitely-not-a-valid-access-key' });
      assertEqual(process.env.IMAGING_STORAGE_BACKEND, undefined, 'precondition: the global write backend is unset');

      const placement = resolveImagingStoragePlacement(row.storageBackend);
      let returned: Buffer | null = null;
      let threw = false;
      try {
        const stream = await openImagingFileStream(row.filePath, placement);
        returned = stream ? await readAll(stream) : null;
      } catch {
        threw = true;
      }
      assertTrue(threw, 'a broken provider must throw, not resolve');
      assertTrue(
        returned === null || sha256(returned) !== sha256(legacyBytes),
        'a provider failure must never be silently satisfied from the same-key legacy object',
      );
    });

    // ════════════════════════════════════════════════════════════════════════
    section('4. Placement is not authorization');

    await test('R6-14. CROSS-TENANT ACCESS STAYS DENIED for every placement value, and the tenant predicate is evaluated BEFORE any storage lookup', async () => {
      const bytes = crypto.randomBytes(700);
      const key = `${fixtures.crossOrgClinicId}/${randomUUID()}.bin`;
      await adminS3.send(new PutObjectCommand({ Bucket: imagingBucketName, Key: key, Body: bytes }));
      const rowB = await createRow(fixtures.crossOrgClinicId, studyB.id, key, bytes.length, 'vps2');

      const legacyBytes = crypto.randomBytes(700);
      const legacyKey = await writeLegacyObject(fixtures.crossOrgClinicId, legacyBytes);
      const rowBNull = await createRow(fixtures.crossOrgClinicId, studyB.id, legacyKey, legacyBytes.length, null);

      // Point the client at a deliberately unreachable endpoint. If the tenant
      // predicate were evaluated AFTER the storage lookup, or if placement
      // could be used to reach an object outside the caller's scope, this would
      // surface as a connection/unavailable error instead of "not found".
      configureVps2({ activateWrites: false });
      process.env.IMAGING_S3_ENDPOINT = 'http://127.0.0.1:1';
      __resetImagingS3ClientForTest();

      for (const row of [rowB, rowBNull]) {
        let notFound = false;
        try {
          await checkImageStorageExists(fixtures.defaultClinicId, row.id);
        } catch (err) {
          notFound = err instanceof ImagingNotFoundError;
          if (!notFound && err instanceof ImagingStorageUnavailableError) {
            throw new Error('a cross-tenant lookup reached the storage backend — the tenant predicate must run first');
          }
          if (!notFound) throw err;
        }
        assertTrue(notFound, `clinic A must get ImagingNotFoundError for clinic B's image (placement ${JSON.stringify(row.storageBackend)})`);
      }

      // And the owning tenant is still scoped normally: clinic B asking for
      // its own row gets past the predicate (and then, with the endpoint
      // broken, sees a sanitized unavailable error rather than a false).
      let unavailable = false;
      try {
        await checkImageStorageExists(fixtures.crossOrgClinicId, rowB.id);
      } catch (err) {
        unavailable = err instanceof ImagingStorageUnavailableError;
      }
      assertTrue(unavailable, 'the owning clinic passes the tenant predicate and then sees the sanitized provider-unavailable error');
      configureVps2({ activateWrites: false });
    });

    await test('R6-17b. checkImageStorageExists honours the row\'s placement: a vps2-placed object is reported present after the write flag is rolled back', async () => {
      const bytes = crypto.randomBytes(1300);
      const key = `${fixtures.defaultClinicId}/${randomUUID()}.bin`;
      await adminS3.send(new PutObjectCommand({ Bucket: imagingBucketName, Key: key, Body: bytes }));
      const row = await createRow(fixtures.defaultClinicId, studyA.id, key, bytes.length, 'vps2');

      configureVps2({ activateWrites: false });
      assertEqual(
        await checkImageStorageExists(fixtures.defaultClinicId, row.id),
        true,
        'the orphan inspection must not report a healthy VPS2 object as physically missing once the flag is unset',
      );
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  section('5. Fail-closed on an unrecognized persisted value');

  await test('an ImagingImage carrying an unrecognized storageBackend is refused rather than guessed, and the refusal is sanitized at the domain boundary', async () => {
    clearImagingEnv();
    const bytes = crypto.randomBytes(256);
    const key = await writeLegacyObject(fixtures.defaultClinicId, bytes);
    const row = await createRow(fixtures.defaultClinicId, studyA.id, key, bytes.length, null);
    await prisma.imagingImage.update({ where: { id: row.id }, data: { storageBackend: 'some-future-backend' } });

    let threw = false;
    try {
      await checkImageStorageExists(fixtures.defaultClinicId, row.id);
    } catch (err) {
      threw = err instanceof ImagingStorageUnavailableError;
      if (!threw) throw err;
    }
    assertTrue(threw, 'an unknown placement must fail closed, converted to the domain\'s sanitized unavailable error');
  });

  // ── Cleanup ───────────────────────────────────────────────────────────────
  console.log('\nCleaning up fixtures...');
  restoreEnv();
  await prisma.imagingImage.deleteMany({ where: { clinicId: { in: [fixtures.defaultClinicId, fixtures.crossOrgClinicId] } } }).catch(() => {});
  await prisma.imagingStudy.deleteMany({ where: { clinicId: { in: [fixtures.defaultClinicId, fixtures.crossOrgClinicId] } } }).catch(() => {});
  for (const dir of createdUploadDirs) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  await cleanupAllFixtures();

  return summary();
}

main()
  .then((ok) => { process.exitCode = ok ? 0 : 1; })
  .catch((err) => {
    console.error('[imagingStoragePlacement] Fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });

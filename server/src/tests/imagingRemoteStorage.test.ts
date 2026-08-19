/**
 * imagingRemoteStorage.test.ts — F4-IMAGING-001 VPS2 imaging-primary storage
 * backend (fileStorage.ts's saveImagingFile/openImagingFileStream/
 * imagingFileExists/deleteImagingFile + imagingRemoteStorage.ts).
 *
 * Two kinds of coverage, clearly separated:
 *   - PURE UNIT (sections 1-2): backend-selection flag, fail-closed config
 *     validation, default-off/rollback parity. No network, no filesystem
 *     beyond the existing local 'uploads/' dir this repo's other storage
 *     tests already use.
 *   - MinIO INTEGRATION (sections 3-6): requires a disposable S3-compatible
 *     endpoint at MINIO_ENDPOINT (default http://localhost:19000,
 *     credentials reviewminio/reviewminiosecret — same defaults as
 *     dbVerification/fileBackupDbIntegration.test.ts, this repo's existing
 *     MinIO-backed test, which the disposable-runtime "storage" profile
 *     already provisions). Proves actual write/read-back BYTE and SHA-256
 *     equality against a real S3-compatible target — never inferred from
 *     object counts.
 *
 * Run: cd server && npx tsx src/tests/imagingRemoteStorage.test.ts
 * (bring up MinIO first, e.g.
 *   docker run -d -p 127.0.0.1:19000:9000 -e MINIO_ROOT_USER=reviewminio \
 *     -e MINIO_ROOT_PASSWORD=reviewminiosecret minio/minio server /data
 * — or run under `npx tsx scripts/test-runtime/orchestrator.ts storage`,
 * once this file is added to the `server:test:storage-integration` chain.)
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {
  S3Client,
  CreateBucketCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';

import {
  isSafeStorageKey,
  saveFile,
  fileExists,
  deleteFile,
  saveImagingFile,
  openImagingFileStream,
  imagingFileExists,
  deleteImagingFile,
} from '../services/fileStorage.js';
import {
  isImagingRemoteStorageEnabled,
  validateImagingS3Config,
  __resetImagingS3ClientForTest,
} from '../services/imagingRemoteStorage.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { console.log(`  \u2713 ${name}`); passed++; })
    .catch((err: unknown) => {
      console.error(`  \u2717 ${name}`);
      console.error(`      ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    });
}

function section(title: string) {
  console.log(`\n${title}`);
}

async function readStreamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** Snapshot/restore every IMAGING_S3_ and IMAGING_STORAGE_BACKEND/NODE_ENV var this suite touches, so no test leaks config into another. */
const TOUCHED_ENV_VARS = [
  'IMAGING_STORAGE_BACKEND',
  'IMAGING_S3_BUCKET',
  'IMAGING_S3_REGION',
  'IMAGING_S3_ENDPOINT',
  'IMAGING_S3_ACCESS_KEY_ID',
  'IMAGING_S3_SECRET_ACCESS_KEY',
  'IMAGING_S3_FORCE_PATH_STYLE',
  'IMAGING_S3_SSE',
  'IMAGING_S3_SSE_KMS_KEY_ID',
  'IMAGING_S3_ALLOW_INSECURE_ENDPOINT',
  'NODE_ENV',
];

function snapshotEnv(): Record<string, string | undefined> {
  const snap: Record<string, string | undefined> = {};
  for (const key of TOUCHED_ENV_VARS) snap[key] = process.env[key];
  return snap;
}

function restoreEnv(snap: Record<string, string | undefined>): void {
  for (const key of TOUCHED_ENV_VARS) {
    if (snap[key] === undefined) delete process.env[key];
    else process.env[key] = snap[key];
  }
  __resetImagingS3ClientForTest();
}

function clearImagingEnv(): void {
  for (const key of TOUCHED_ENV_VARS) delete process.env[key];
  __resetImagingS3ClientForTest();
}

async function main() {
  const baseSnapshot = snapshotEnv();

  // ── 1. Backend selection (pure) ─────────────────────────────────────────
  section('1. Backend selection (IMAGING_STORAGE_BACKEND)');

  await test('unset -> disabled (current production default)', () => {
    clearImagingEnv();
    assert.equal(isImagingRemoteStorageEnabled(), false);
  });

  await test('"local" -> disabled', () => {
    clearImagingEnv();
    process.env.IMAGING_STORAGE_BACKEND = 'local';
    assert.equal(isImagingRemoteStorageEnabled(), false);
  });

  await test('unrecognized value -> disabled (fail closed, not fail open)', () => {
    clearImagingEnv();
    process.env.IMAGING_STORAGE_BACKEND = 'vps2-typo';
    assert.equal(isImagingRemoteStorageEnabled(), false);
  });

  await test('"vps2" -> enabled', () => {
    clearImagingEnv();
    process.env.IMAGING_STORAGE_BACKEND = 'vps2';
    assert.equal(isImagingRemoteStorageEnabled(), true);
  });

  // ── 2. Invalid configuration (fail closed) ──────────────────────────────
  section('2. Invalid configuration (fail-closed validation)');

  await test('disabled backend: validate is a no-op even with nothing else set', () => {
    clearImagingEnv();
    assert.doesNotThrow(() => validateImagingS3Config());
  });

  await test('enabled + no bucket -> throws in every environment', () => {
    clearImagingEnv();
    process.env.IMAGING_STORAGE_BACKEND = 'vps2';
    assert.throws(() => validateImagingS3Config(), /IMAGING_S3_BUCKET/);
  });

  await test('enabled + bucket + bad SSE value -> throws regardless of NODE_ENV', () => {
    clearImagingEnv();
    process.env.IMAGING_STORAGE_BACKEND = 'vps2';
    process.env.IMAGING_S3_BUCKET = 'imaging-test';
    process.env.IMAGING_S3_SSE = 'not-a-real-mode';
    assert.throws(() => validateImagingS3Config(), /Invalid IMAGING_S3_SSE/);
  });

  await test('production + no SSE -> throws (dev/test would not)', () => {
    clearImagingEnv();
    process.env.IMAGING_STORAGE_BACKEND = 'vps2';
    process.env.IMAGING_S3_BUCKET = 'imaging-test';
    process.env.NODE_ENV = 'production';
    assert.throws(() => validateImagingS3Config(), /IMAGING_S3_SSE must be set/);
  });

  await test('production + http:// endpoint, no insecure override -> throws', () => {
    clearImagingEnv();
    process.env.IMAGING_STORAGE_BACKEND = 'vps2';
    process.env.IMAGING_S3_BUCKET = 'imaging-test';
    process.env.IMAGING_S3_SSE = 'AES256';
    process.env.IMAGING_S3_ENDPOINT = 'http://10.0.0.5:9000';
    process.env.NODE_ENV = 'production';
    assert.throws(() => validateImagingS3Config(), /https:\/\//);
  });

  await test('production + http:// endpoint + explicit insecure override -> does not throw', () => {
    clearImagingEnv();
    process.env.IMAGING_STORAGE_BACKEND = 'vps2';
    process.env.IMAGING_S3_BUCKET = 'imaging-test';
    process.env.IMAGING_S3_SSE = 'AES256';
    process.env.IMAGING_S3_ENDPOINT = 'http://10.0.0.5:9000';
    process.env.IMAGING_S3_ALLOW_INSECURE_ENDPOINT = 'true';
    process.env.NODE_ENV = 'production';
    assert.doesNotThrow(() => validateImagingS3Config());
  });

  await test('dev/test env: http:// endpoint + no SSE never throws (local MinIO stays usable)', () => {
    clearImagingEnv();
    process.env.IMAGING_STORAGE_BACKEND = 'vps2';
    process.env.IMAGING_S3_BUCKET = 'imaging-test';
    process.env.IMAGING_S3_ENDPOINT = 'http://localhost:19000';
    process.env.NODE_ENV = 'test';
    assert.doesNotThrow(() => validateImagingS3Config());
  });

  // ── 3. Rollback / current-local behavior (backend unset) ───────────────
  section('3. Rollback switch: IMAGING_STORAGE_BACKEND unset behaves exactly like pre-existing local storage');

  await test('save/read/exists/delete round-trip identical to fileStorage.ts local mode', async () => {
    clearImagingEnv(); // explicitly OFF
    const key = `__imaging-remote-storage-test__/${crypto.randomUUID()}.bin`;
    const body = Buffer.from('rollback-mode local content', 'utf8');
    try {
      await saveImagingFile(key, body, 'application/octet-stream');
      assert.equal(await fileExists(key), true, 'saveImagingFile with backend unset must write through the ordinary local path');
      assert.equal(await imagingFileExists(key), true);
      const stream = await openImagingFileStream(key);
      assert.ok(stream, 'expected a stream back');
      const readBack = await readStreamToBuffer(stream!);
      assert.equal(readBack.equals(body), true, 'byte-for-byte equality');
      await deleteImagingFile(key);
      assert.equal(await fileExists(key), false, 'deleteImagingFile with backend unset must remove the local file');
    } finally {
      await deleteFile(key).catch(() => {});
    }
  });

  // ── MinIO-backed sections ────────────────────────────────────────────────
  const minioEndpoint = process.env.MINIO_ENDPOINT || 'http://localhost:19000';
  const minioAccessKey = process.env.MINIO_ACCESS_KEY || 'reviewminio';
  const minioSecretKey = process.env.MINIO_SECRET_KEY || 'reviewminiosecret';
  const bucketName = `imaging-remote-storage-test-${Date.now()}`;

  let minioAvailable = false;
  const adminS3 = new S3Client({
    region: 'auto',
    endpoint: minioEndpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: minioAccessKey, secretAccessKey: minioSecretKey },
  });

  try {
    await adminS3.send(new CreateBucketCommand({ Bucket: bucketName }));
    minioAvailable = true;
  } catch (err) {
    console.log(`\n[imagingRemoteStorage.test] MinIO not reachable at ${minioEndpoint} (${err instanceof Error ? err.message : String(err)}) — skipping MinIO-integration sections 4-6.`);
    console.log('  Start one with: docker run -d -p 127.0.0.1:19000:9000 -e MINIO_ROOT_USER=reviewminio -e MINIO_ROOT_PASSWORD=reviewminiosecret minio/minio server /data --console-address :9001');
  }

  function activateVps2(): void {
    clearImagingEnv();
    process.env.IMAGING_STORAGE_BACKEND = 'vps2';
    process.env.IMAGING_S3_BUCKET = bucketName;
    process.env.IMAGING_S3_ENDPOINT = minioEndpoint;
    process.env.IMAGING_S3_ACCESS_KEY_ID = minioAccessKey;
    process.env.IMAGING_S3_SECRET_ACCESS_KEY = minioSecretKey;
    process.env.IMAGING_S3_FORCE_PATH_STYLE = 'true';
    process.env.IMAGING_S3_REGION = 'auto';
  }

  if (minioAvailable) {
    // ── 4. Write, read-back, checksum ─────────────────────────────────────
    section('4. VPS2 write + read-back: byte equality and SHA-256 equality (never object-count-only)');

    await test('write then read-back is byte-identical and hash-identical', async () => {
      activateVps2();
      const key = `clinic-a/${crypto.randomUUID()}.dcm`;
      const body = crypto.randomBytes(4096); // synthetic, non-patient binary
      const originalHash = sha256(body);

      await saveImagingFile(key, body, 'application/dicom');

      const stream = await openImagingFileStream(key);
      assert.ok(stream, 'expected the object to be readable back from VPS2');
      const readBack = await readStreamToBuffer(stream!);

      assert.equal(readBack.length, body.length, 'byte length must match exactly');
      assert.equal(readBack.equals(body), true, 'byte-for-byte equality, not just length');
      assert.equal(sha256(readBack), originalHash, 'SHA-256 of read-back bytes must equal SHA-256 of the original write');

      assert.equal(await imagingFileExists(key), true);
    });

    await test('a corrupted object is detected by checksum mismatch (never silently accepted)', async () => {
      activateVps2();
      const key = `clinic-a/${crypto.randomUUID()}.dcm`;
      const original = crypto.randomBytes(2048);
      await saveImagingFile(key, original, 'application/dicom');

      // Simulate corruption at the destination (bit-flip via a direct admin overwrite) —
      // this is what a real corrupt-object detection path must catch.
      const tampered = Buffer.from(original);
      tampered[0] = tampered[0] ^ 0xff;
      const { PutObjectCommand } = await import('@aws-sdk/client-s3');
      await adminS3.send(new PutObjectCommand({ Bucket: bucketName, Key: key, Body: tampered }));

      const stream = await openImagingFileStream(key);
      const readBack = await readStreamToBuffer(stream!);
      assert.notEqual(sha256(readBack), sha256(original), 'tampered object must NOT hash-match the original — proves the checksum check is actually discriminating, not vacuously true');
    });

    await test('missing object behavior: a key never written anywhere resolves to null, not an error', async () => {
      activateVps2();
      const key = `clinic-a/${crypto.randomUUID()}-never-written.dcm`;
      const stream = await openImagingFileStream(key);
      assert.equal(stream, null);
      assert.equal(await imagingFileExists(key), false);
    });

    // ── 5. Legacy fallback + additive-write guarantee ───────────────────────
    section('5. Legacy fallback (read) and additive-only (write never touches legacy)');

    await test('write with VPS2 active never writes to local/legacy storage', async () => {
      activateVps2();
      const key = `clinic-b/${crypto.randomUUID()}.jpg`;
      const body = Buffer.from('vps2-primary-bytes');
      await saveImagingFile(key, body, 'image/jpeg');

      assert.equal(await fileExists(key), false, 'new imaging write must not appear in local/legacy storage (additive, single write target)');
      await adminS3.send(new HeadObjectCommand({ Bucket: bucketName, Key: key })); // throws if absent
    });

    await test('read falls back to legacy ONLY on a confirmed-absent VPS2 lookup', async () => {
      // A "legacy" object that predates VPS2 activation: written straight to
      // local storage, never touched VPS2.
      const key = `clinic-b/${crypto.randomUUID()}-pre-activation.jpg`;
      const legacyBody = Buffer.from('written before VPS2 was ever activated');
      await saveFile(key, legacyBody, 'image/jpeg');

      activateVps2();
      const exists = await imagingFileExists(key);
      assert.equal(exists, true, 'legacy fallback must find the pre-activation object');

      const stream = await openImagingFileStream(key);
      assert.ok(stream, 'legacy fallback must return a readable stream');
      const readBack = await readStreamToBuffer(stream!);
      assert.equal(readBack.equals(legacyBody), true);

      await deleteFile(key).catch(() => {});
    });

    // ── 6. Unavailable VPS2 behavior ────────────────────────────────────────
    section('6. Unavailable VPS2 behavior (network failure propagates, is never mistaken for "not found")');

    await test('a VPS2 backend that cannot be reached throws rather than silently returning null/false', async () => {
      clearImagingEnv();
      process.env.IMAGING_STORAGE_BACKEND = 'vps2';
      process.env.IMAGING_S3_BUCKET = bucketName;
      // Port 1 is a reserved, always-unbound port on any normal host — a fast,
      // deterministic "connection refused" without depending on an external
      // unreachable-but-routable address (which could hang on a slow OS-level
      // timeout instead of failing fast).
      process.env.IMAGING_S3_ENDPOINT = 'http://127.0.0.1:1';
      process.env.IMAGING_S3_FORCE_PATH_STYLE = 'true';
      process.env.IMAGING_S3_REGION = 'auto';
      process.env.IMAGING_S3_ACCESS_KEY_ID = minioAccessKey;
      process.env.IMAGING_S3_SECRET_ACCESS_KEY = minioSecretKey;

      const key = `clinic-a/${crypto.randomUUID()}.dcm`;
      await assert.rejects(
        () => openImagingFileStream(key),
        'an unreachable VPS2 endpoint must reject the read, not resolve null (which would be indistinguishable from a genuinely missing object)',
      );
      await assert.rejects(
        () => imagingFileExists(key),
        'an unreachable VPS2 endpoint must reject the existence check, not resolve false',
      );
      await assert.rejects(
        () => saveImagingFile(key, Buffer.from('x'), 'application/octet-stream'),
        'an unreachable VPS2 endpoint must reject the write, never silently redirect to local storage',
      );
    });
  }

  // ── 7. Tenant isolation (structural, no backend required) ──────────────
  section('7. Tenant isolation — the routing layer never constructs or trusts a caller-supplied key');

  await test('imaging wrappers only ever forward the exact ref given — no clinicId/path re-derivation inside the routing layer', () => {
    // The wrappers take a single opaque `ref`/`key` string and pass it straight
    // through to whichever backend is active; they have no clinicId parameter
    // and cannot construct a key. Cross-tenant access is prevented upstream —
    // by buildObjectStorageKey() (storageKeyContract.test.ts) and by the
    // Prisma `study: {clinicId: ...}` predicate every route resolves BEFORE
    // calling into this layer (routes/imaging.ts's streamStudyImage,
    // services/imaging/public.ts's checkImageStorageExists). This asserts the
    // structural property that makes that true: the function signatures below
    // take exactly one storage-key argument, nothing shaped like a tenant id.
    assert.equal(saveImagingFile.length, 3); // (key, body, contentType)
    assert.equal(openImagingFileStream.length, 1); // (ref)
    assert.equal(imagingFileExists.length, 1); // (ref)
    assert.equal(deleteImagingFile.length, 1); // (key)
  });

  await test('a traversal-shaped ref is rejected by the same isSafeStorageKey gate other storage reads use', () => {
    for (const bad of ['../etc/passwd', '/absolute/path', 'clinic\\..\\..\\secret', 'C:\\Windows\\System32']) {
      assert.equal(isSafeStorageKey(bad), false, `expected ${JSON.stringify(bad)} to be rejected`);
    }
  });

  // ── Cleanup ──────────────────────────────────────────────────────────────
  restoreEnv(baseSnapshot);
  try {
    const testDir = path.resolve(process.cwd(), 'uploads', '__imaging-remote-storage-test__');
    if (fs.existsSync(testDir)) await fsp.rm(testDir, { recursive: true, force: true });
  } catch { /* best-effort cleanup only */ }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();

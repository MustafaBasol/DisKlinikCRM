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
  buildObjectStorageKey,
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
  getImagingStorageBackend,
  resolveImagingStoragePlacement,
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

  await test('unset -> legacy/disabled (current production default)', () => {
    clearImagingEnv();
    assert.equal(getImagingStorageBackend(), 'legacy');
    assert.equal(isImagingRemoteStorageEnabled(), false);
  });

  await test('empty string -> legacy/disabled', () => {
    clearImagingEnv();
    process.env.IMAGING_STORAGE_BACKEND = '';
    assert.equal(getImagingStorageBackend(), 'legacy');
    assert.equal(isImagingRemoteStorageEnabled(), false);
  });

  await test('whitespace-only -> legacy/disabled', () => {
    clearImagingEnv();
    process.env.IMAGING_STORAGE_BACKEND = '   ';
    assert.equal(getImagingStorageBackend(), 'legacy');
    assert.equal(isImagingRemoteStorageEnabled(), false);
  });

  await test('"vps2" -> enabled', () => {
    clearImagingEnv();
    process.env.IMAGING_STORAGE_BACKEND = 'vps2';
    assert.equal(getImagingStorageBackend(), 'vps2');
    assert.equal(isImagingRemoteStorageEnabled(), true);
  });

  await test('"vps2" with surrounding whitespace -> enabled (trimmed)', () => {
    clearImagingEnv();
    process.env.IMAGING_STORAGE_BACKEND = '  vps2  ';
    assert.equal(getImagingStorageBackend(), 'vps2');
    assert.equal(isImagingRemoteStorageEnabled(), true);
  });

  await test('"local" -> throws (not a supported backend selector; only unset means legacy)', () => {
    clearImagingEnv();
    process.env.IMAGING_STORAGE_BACKEND = 'local';
    assert.throws(() => getImagingStorageBackend(), /Invalid IMAGING_STORAGE_BACKEND/);
    assert.throws(() => isImagingRemoteStorageEnabled(), /Invalid IMAGING_STORAGE_BACKEND/);
  });

  await test('typo -> throws (fail closed, NOT silently disabled — a typo must never quietly route imaging writes to legacy storage)', () => {
    clearImagingEnv();
    process.env.IMAGING_STORAGE_BACKEND = 'vps2-typo';
    assert.throws(() => getImagingStorageBackend(), /Invalid IMAGING_STORAGE_BACKEND/);
    assert.throws(() => isImagingRemoteStorageEnabled(), /Invalid IMAGING_STORAGE_BACKEND/);
  });

  await test('uppercase/mixed case -> throws (exact-case "vps2" only)', () => {
    clearImagingEnv();
    for (const bad of ['VPS2', 'Vps2', 'VPS2 ']) {
      process.env.IMAGING_STORAGE_BACKEND = bad;
      assert.throws(() => getImagingStorageBackend(), /Invalid IMAGING_STORAGE_BACKEND/, `expected ${JSON.stringify(bad)} to be rejected`);
    }
  });

  await test('a typo propagates through validateImagingS3Config() too, not just isImagingRemoteStorageEnabled()', () => {
    clearImagingEnv();
    process.env.IMAGING_STORAGE_BACKEND = 'vps2-typo';
    assert.throws(() => validateImagingS3Config(), /Invalid IMAGING_STORAGE_BACKEND/);
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
    // R3: an endpoint is now required in every environment, so it must be set
    // here to isolate this test on the SSE rule it is actually asserting
    // (otherwise the endpoint check would throw first and mask it).
    process.env.IMAGING_S3_ENDPOINT = 'https://imaging.vps2.example';
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

  // ── 2b. R3: IMAGING_S3_ENDPOINT is REQUIRED, in every environment ────────
  //
  // Regression cover for the R3 data-residency defect. Before this fix,
  // `IMAGING_STORAGE_BACKEND=vps2` with `IMAGING_S3_ENDPOINT` unset passed
  // validation and constructed an S3Client with no endpoint override, so the
  // AWS SDK resolved its own default public AWS endpoint: imaging bytes (KVKK
  // special-category health data) would have left Türkiye silently, with the
  // config still claiming "vps2". A missing endpoint must fail closed, not
  // default to a different continent.
  section('2b. R3 residency: IMAGING_S3_ENDPOINT required + scheme-validated');

  await test('enabled + bucket + NO endpoint -> throws in production (never defaults to AWS)', () => {
    clearImagingEnv();
    process.env.IMAGING_STORAGE_BACKEND = 'vps2';
    process.env.IMAGING_S3_BUCKET = 'imaging-test';
    process.env.IMAGING_S3_SSE = 'AES256';
    process.env.NODE_ENV = 'production';
    assert.throws(() => validateImagingS3Config(), /IMAGING_S3_ENDPOINT/);
  });

  await test('enabled + bucket + NO endpoint -> throws in dev/test too (not production-only)', () => {
    clearImagingEnv();
    process.env.IMAGING_STORAGE_BACKEND = 'vps2';
    process.env.IMAGING_S3_BUCKET = 'imaging-test';
    process.env.NODE_ENV = 'test';
    assert.throws(() => validateImagingS3Config(), /IMAGING_S3_ENDPOINT/);
  });

  await test('empty / whitespace-only endpoint is treated as unset -> throws', () => {
    for (const value of ['', '   ', '\t\n']) {
      clearImagingEnv();
      process.env.IMAGING_STORAGE_BACKEND = 'vps2';
      process.env.IMAGING_S3_BUCKET = 'imaging-test';
      process.env.IMAGING_S3_ENDPOINT = value;
      process.env.NODE_ENV = 'test';
      assert.throws(
        () => validateImagingS3Config(),
        /IMAGING_S3_ENDPOINT/,
        `expected whitespace endpoint ${JSON.stringify(value)} to be rejected`,
      );
    }
  });

  await test('scheme-less endpoint (bare host) -> throws, not silently accepted', () => {
    clearImagingEnv();
    process.env.IMAGING_STORAGE_BACKEND = 'vps2';
    process.env.IMAGING_S3_BUCKET = 'imaging-test';
    process.env.IMAGING_S3_ENDPOINT = 'imaging.vps2.example:9000';
    process.env.NODE_ENV = 'test';
    assert.throws(() => validateImagingS3Config(), /absolute URL|scheme/);
  });

  await test('non-http(s) scheme (e.g. ftp://, file://) -> throws', () => {
    for (const value of ['ftp://imaging.vps2.example', 'file:///srv/noramedi-imaging']) {
      clearImagingEnv();
      process.env.IMAGING_STORAGE_BACKEND = 'vps2';
      process.env.IMAGING_S3_BUCKET = 'imaging-test';
      process.env.IMAGING_S3_ENDPOINT = value;
      process.env.NODE_ENV = 'test';
      assert.throws(
        () => validateImagingS3Config(),
        /scheme/,
        `expected non-http(s) endpoint ${JSON.stringify(value)} to be rejected`,
      );
    }
  });

  await test('valid https:// endpoint in production -> does not throw', () => {
    clearImagingEnv();
    process.env.IMAGING_STORAGE_BACKEND = 'vps2';
    process.env.IMAGING_S3_BUCKET = 'imaging-test';
    process.env.IMAGING_S3_SSE = 'AES256';
    process.env.IMAGING_S3_ENDPOINT = 'https://imaging.vps2.example:9000';
    process.env.NODE_ENV = 'production';
    assert.doesNotThrow(() => validateImagingS3Config());
  });

  await test('endpoint requirement does not apply when backend is unset (rollback path stays clean)', () => {
    clearImagingEnv();
    process.env.NODE_ENV = 'production';
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
    // Classification (R1 correction — see docs/program/NORAMEDI_MASTER_TRACKER.md's
    // F4-IMAGING-001 entry): the two assertions below are
    // SYNTHETIC_WRITE_READ_BYTE_EQUALITY = VERIFIED and
    // SYNTHETIC_SHA256_COMPARISON = VERIFIED — this test suite computing
    // SHA-256 over synthetic bytes it wrote and read back itself, in the
    // untampered case. It does NOT establish any application-level
    // integrity/corruption-detection capability — the app persists no
    // expected checksum and verifies none on read. See the tampered-object
    // test below (RUNTIME_CORRUPTION_DETECTION = NOT_IMPLEMENTED).
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

    // NOTE — classification (R1 correction): this test does NOT prove
    // application-level corruption detection. `openImagingFileStream` does
    // not persist an expected checksum anywhere and performs no
    // verification on read — it returns whatever bytes the backend hands
    // back, tampered or not. This test only proves that (a) a
    // destination-side bit-flip really does change the retrievable bytes
    // (the MinIO target isn't silently normalizing/ignoring the admin
    // overwrite) and (b) this suite's own SHA-256 comparison correctly
    // discriminates tampered bytes from the original, i.e. it isn't
    // vacuously true. RUNTIME_CORRUPTION_DETECTION = NOT_IMPLEMENTED;
    // PRODUCTION_CHECKSUM_INTEGRITY_GATE = OPEN — see
    // docs/program/NORAMEDI_MASTER_TRACKER.md's F4-IMAGING-001 entry.
    await test('SYNTHETIC: a destination-side tamper changes the read-back bytes/hash (app performs NO runtime checksum verification — this is a test-harness sanity check, not corruption detection)', async () => {
      activateVps2();
      const key = `clinic-a/${crypto.randomUUID()}.dcm`;
      const original = crypto.randomBytes(2048);
      await saveImagingFile(key, original, 'application/dicom');

      // Simulate corruption at the destination (bit-flip via a direct admin overwrite).
      const tampered = Buffer.from(original);
      tampered[0] = tampered[0] ^ 0xff;
      const { PutObjectCommand } = await import('@aws-sdk/client-s3');
      await adminS3.send(new PutObjectCommand({ Bucket: bucketName, Key: key, Body: tampered }));

      // The app read path returns the tampered bytes without complaint —
      // no error, no rejection. It is this test, not the application, that
      // notices the hash no longer matches.
      const stream = await openImagingFileStream(key);
      const readBack = await readStreamToBuffer(stream!);
      assert.equal(readBack.equals(tampered), true, 'app read path returns the tampered bytes verbatim — no runtime integrity check exists to intercept them');
      assert.notEqual(sha256(readBack), sha256(original), 'sanity check: this test\'s own SHA-256 comparison is discriminating, not vacuously true (confirms the destination-side tamper actually took effect)');
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
    //
    // F4-IMAGING-001-R6 — THESE NUMBERS DELIBERATELY CHANGED from 3/1/1/1.
    // Three wrappers gained a second parameter, `placement?:
    // ImagingStoragePlacement`. TypeScript emits an optional parameter as a
    // plain one (no initializer), so Function.prototype.length counts it and
    // these assertions genuinely move — they are not passing by accident.
    // The property this test was written for is unchanged and still asserted:
    // the added parameter is a closed two-token placement union, structurally
    // incapable of carrying a clinicId, an organizationId or a path, which the
    // test immediately below pins by signature and by behavior.
    assert.equal(saveImagingFile.length, 3); // (key, body, contentType)
    assert.equal(openImagingFileStream.length, 2); // (ref, placement?)
    assert.equal(imagingFileExists.length, 2); // (ref, placement?)
    assert.equal(deleteImagingFile.length, 2); // (key, placement?)
  });

  await test('R6: the second parameter of the read/exists/delete wrappers is a storage PLACEMENT, never a tenant identifier', () => {
    const src = fs.readFileSync(path.resolve(import.meta.dirname, '../services/fileStorage.ts'), 'utf8');
    for (const sig of [
      'export async function openImagingFileStream(ref: string, placement?: ImagingStoragePlacement)',
      'export async function imagingFileExists(ref: string, placement?: ImagingStoragePlacement)',
      'export async function deleteImagingFile(key: string, placement?: ImagingStoragePlacement)',
    ]) {
      assert.ok(src.includes(sig), `fileStorage.ts must declare: ${sig}`);
    }
    // ImagingStoragePlacement is the closed two-token union, so the extra
    // parameter structurally cannot carry a clinicId, an organizationId, a
    // path, or anything else a caller could use to widen access.
    assert.equal(resolveImagingStoragePlacement('vps2'), 'vps2');
    assert.equal(resolveImagingStoragePlacement('legacy'), 'legacy');
    assert.throws(() => resolveImagingStoragePlacement('clinic-123'), /Invalid persisted ImagingImage.storageBackend/);
  });

  await test('a traversal-shaped ref is rejected by the same isSafeStorageKey gate other storage reads use', () => {
    for (const bad of ['../etc/passwd', '/absolute/path', 'clinic\\..\\..\\secret', 'C:\\Windows\\System32']) {
      assert.equal(isSafeStorageKey(bad), false, `expected ${JSON.stringify(bad)} to be rejected`);
    }
  });

  // ── 8. Finding C: config is validated at BOOT, not lazily on first use ──
  //
  // validateImagingS3Config() used to be reachable only from getImagingS3(),
  // i.e. on the first imaging request that actually constructed a client. An
  // operator who activated IMAGING_STORAGE_BACKEND=vps2 with a missing bucket
  // or endpoint therefore got a process that started up looking perfectly
  // healthy and only failed much later, at request time, with imaging silently
  // unavailable in between. It is now also called during startup validation in
  // index.ts, following that file's existing ENCRYPTION_KEY precedent.
  section('8. Boot-time configuration validation (F4-IMAGING-001 Finding C)');

  const indexSrc = fs.readFileSync(path.resolve(process.cwd(), 'src', 'index.ts'), 'utf8');

  await test('index.ts imports and calls validateImagingS3Config() during startup validation', () => {
    assert.ok(
      /import \{[^}]*validateImagingS3Config[^}]*\} from '\.\/services\/imagingRemoteStorage\.js';/.test(indexSrc),
      'index.ts must import validateImagingS3Config from the imaging storage module',
    );
    assert.ok(indexSrc.includes('validateImagingS3Config();'), 'index.ts must actually call it, not just import it');
  });

  await test('the boot-time call runs before the server starts listening (a bad config must stop startup, not surface on the first request)', () => {
    const callIdx = indexSrc.indexOf('validateImagingS3Config();');
    const listenIdx = indexSrc.search(/(app|server|httpServer)\.listen\(/);
    assert.ok(callIdx !== -1, 'boot-time call present');
    assert.ok(listenIdx !== -1, 'expected a listen() call in index.ts');
    assert.ok(callIdx < listenIdx, 'validation must run before the process begins accepting traffic');
  });

  await test('it fails closed in production (exit) and only warns outside production, matching the ENCRYPTION_KEY precedent in the same file', () => {
    const callIdx = indexSrc.indexOf('validateImagingS3Config();');
    const block = indexSrc.slice(callIdx, callIdx + 700);
    assert.ok(/catch\s*\(/.test(block), 'the throw is caught so the failure can be reported deliberately');
    assert.ok(/NODE_ENV === 'production'/.test(block), 'production is distinguished from dev/test');
    assert.ok(/process\.exit\(1\)/.test(block), 'production startup must abort on an invalid imaging storage config');
    assert.ok(/console\.warn/.test(block), 'non-production only warns, so local/dev work is not blocked');
  });

  // ── 9. F4-IMAGING-001-R6: per-object storage placement ────────────────────
  //
  // R5 Finding B: nothing recorded WHICH backend held a given imaging object,
  // so the read path inferred placement from the global IMAGING_STORAGE_BACKEND
  // flag. After the first VPS2-only write, unsetting that flag silently
  // reclassified those objects as legacy and made them unreadable — which made
  // configuration rollback unsafe. R6 persists the placement per object on
  // ImagingImage.storageBackend and reads it back through
  // resolveImagingStoragePlacement(). This section covers the pure half (no
  // database, no MinIO); the end-to-end half lives in
  // dbVerification/imagingStoragePlacement.test.ts (Layer 4).
  section('9. R6 per-object storage placement — resolver, key contract, default-off');

  await test('resolveImagingStoragePlacement: NULL / undefined / empty / whitespace all mean "pre-R6 row" and resolve to legacy', () => {
    clearImagingEnv();
    assert.equal(resolveImagingStoragePlacement(null), 'legacy');
    assert.equal(resolveImagingStoragePlacement(undefined), 'legacy');
    assert.equal(resolveImagingStoragePlacement(''), 'legacy');
    assert.equal(resolveImagingStoragePlacement('   '), 'legacy');
  });

  await test('resolveImagingStoragePlacement: the two explicit tokens round-trip, trimmed', () => {
    assert.equal(resolveImagingStoragePlacement('legacy'), 'legacy');
    assert.equal(resolveImagingStoragePlacement('vps2'), 'vps2');
    assert.equal(resolveImagingStoragePlacement('  vps2  '), 'vps2');
    assert.equal(resolveImagingStoragePlacement('  legacy  '), 'legacy');
  });

  await test('resolveImagingStoragePlacement FAILS CLOSED on any unrecognized persisted value — it never guesses a backend', () => {
    for (const bad of ['VPS2', 'Vps2', 'vps2-typo', 'local', 's3', 'https://imaging.example:9000', 'clinic-123']) {
      assert.throws(
        () => resolveImagingStoragePlacement(bad),
        /Invalid persisted ImagingImage\.storageBackend/,
        `expected ${JSON.stringify(bad)} to be refused rather than guessed`,
      );
    }
  });

  await test('resolveImagingStoragePlacement is a pure function of its argument — the global flag cannot change its answer (this is the whole point of R6)', () => {
    clearImagingEnv();
    const legacyModeNull = resolveImagingStoragePlacement(null);
    const legacyModeVps2 = resolveImagingStoragePlacement('vps2');
    const legacyModeLegacy = resolveImagingStoragePlacement('legacy');

    process.env.IMAGING_STORAGE_BACKEND = 'vps2';
    assert.equal(resolveImagingStoragePlacement(null), legacyModeNull, 'a pre-R6 row must not become VPS2 because the write flag was turned on');
    assert.equal(resolveImagingStoragePlacement('vps2'), legacyModeVps2, 'a VPS2 row stays VPS2');
    assert.equal(resolveImagingStoragePlacement('legacy'), legacyModeLegacy, 'an explicit legacy row stays legacy while the write flag is vps2');

    delete process.env.IMAGING_STORAGE_BACKEND;
    assert.equal(resolveImagingStoragePlacement('vps2'), 'vps2', 'a VPS2 row STILL resolves to VPS2 after the flag is unset — R5 Finding B, closed');
    assert.equal(resolveImagingStoragePlacement(null), 'legacy');
    clearImagingEnv();
  });

  await test('the two placement tokens are exactly the two ImagingStorageBackend tokens — one vocabulary, not two that can drift', () => {
    const src = fs.readFileSync(path.resolve(import.meta.dirname, '../services/imagingRemoteStorage.ts'), 'utf8');
    assert.ok(
      src.includes("export type ImagingStoragePlacement = ImagingStorageBackend;"),
      'ImagingStoragePlacement must be an alias of ImagingStorageBackend, never a second independently-declared union',
    );
  });

  await test('R6 storage-key contract UNCHANGED: placement never appears in, or alters the shape of, an object key', () => {
    const clinicId = 'clinic-r6-key-contract';
    const a = buildObjectStorageKey({ kind: 'imaging-image', clinicId, originalName: 'scan.dcm' });
    const b = buildObjectStorageKey({ kind: 'imaging-image', clinicId, originalName: 'scan.dcm' });
    for (const key of [a, b]) {
      assert.ok(isSafeStorageKey(key), 'key still passes the shared safety gate');
      assert.ok(key.startsWith(`${clinicId}/`), 'key still starts with the owning clinic segment');
      assert.ok(key.endsWith('.dcm'), 'key still ends with the normalized extension');
      assert.equal(key.includes('vps2'), false, 'the storage key must never carry a backend/placement token');
      assert.equal(key.includes('legacy'), false, 'the storage key must never carry a backend/placement token');
    }
    // Two objects that will differ ONLY in placement still produce
    // structurally identical keys: placement is DB state, never key state.
    const shape = (k: string) => k.split('/')[0] + '/<opaque>' + path.posix.extname(k);
    assert.equal(shape(a), shape(b), 'key shape is independent of placement');
  });

  await test('the persisted placement column holds a logical label only — no endpoint, bucket, region or credential is ever written to the DB', () => {
    const schemaSrc = fs.readFileSync(path.resolve(import.meta.dirname, '../../prisma/schema.prisma'), 'utf8');
    // Line-ending tolerant, deliberately. On Windows Git materializes
    // schema.prisma with CRLF while CI checks it out with LF, and an
    // `indexOf('\n}\n')` anchor never matches under CRLF: it returns -1,
    // `slice(start, -1)` hands back almost the whole file, and every
    // "this model contains X" assertion below would pass vacuously — which is
    // exactly what happened here before this was fixed. CI runs on Linux, so
    // CI could never have caught it. The length guard is the backstop.
    const modelStart = schemaSrc.indexOf('model ImagingImage ');
    assert.ok(modelStart > -1, 'ImagingImage model present');
    const afterStart = schemaSrc.slice(modelStart);
    const blockEnd = afterStart.search(/\r?\n\}\r?\n/);
    assert.ok(blockEnd > -1, 'ImagingImage model must have a closing brace');
    const block = afterStart.slice(0, blockEnd);
    assert.ok(block.length < 3000, `the extracted block must be one model, not the rest of the file (got ${block.length} chars)`);
    assert.ok(/\n\s*storageBackend\s+String\?/.test(block), 'storageBackend must be a nullable String (no default, no Prisma enum)');
    assert.equal(/\n\s*storageBackend\s+String\?\s*@default/.test(block), false, 'storageBackend must NOT carry a @default — NULL is the pre-R6 signal');
    for (const forbidden of ['s3Endpoint', 'accessKey', 'secretAccessKey', 'storageEndpoint', 'storageBucket', 'storageRegion', 'storageCredential']) {
      assert.equal(block.includes(forbidden), false, `ImagingImage must never persist ${forbidden}`);
    }
    // And the ingest write path must persist the value the write returned,
    // never a fresh read of the global flag.
    const ingestSrc = fs.readFileSync(path.resolve(import.meta.dirname, '../services/imaging/imagingIngestCore.ts'), 'utf8');
    assert.ok(
      /const storagePlacement = await saveImagingFile\(/.test(ingestSrc),
      'ingest must capture the placement from the call that actually wrote the bytes',
    );
    assert.ok(ingestSrc.includes('storageBackend: storagePlacement,'), 'ingest must persist exactly that captured value');
    assert.equal(
      /storageBackend:\s*(getImagingStorageBackend|isImagingRemoteStorageEnabled)/.test(ingestSrc),
      false,
      'ingest must never re-derive the persisted placement from the global flag',
    );
  });

  await test('R6 feature flag remains OFF by default: .env.example ships IMAGING_STORAGE_BACKEND commented out, and an unset flag still means legacy', () => {
    const envExample = fs.readFileSync(path.resolve(import.meta.dirname, '../../.env.example'), 'utf8');
    const active = envExample
      .split(/\r?\n/)
      .filter((line) => /^\s*IMAGING_STORAGE_BACKEND\s*=/.test(line));
    assert.deepEqual(active, [], 'no UNCOMMENTED IMAGING_STORAGE_BACKEND assignment may ship in .env.example');
    assert.ok(envExample.includes('# IMAGING_STORAGE_BACKEND=vps2'), 'the activation line stays present but commented out');

    clearImagingEnv();
    assert.equal(getImagingStorageBackend(), 'legacy', 'unset flag still means legacy');
    assert.equal(isImagingRemoteStorageEnabled(), false, 'VPS2 writes stay off by default');
  });

  await test('.env.example no longer documents the R5 one-way-rollback defect as permanent, and states the R6 rollback condition', () => {
    const envExample = fs.readFileSync(path.resolve(import.meta.dirname, '../../.env.example'), 'utf8');
    assert.equal(
      envExample.includes('ROLLBACK IS ONE-WAY AFTER THE FIRST VPS2 WRITE'),
      false,
      'the superseded R3/R5 one-way-rollback paragraph must be removed, not left contradicting the code',
    );
    assert.ok(envExample.includes('ImagingImage.storageBackend'), 'the rollback note must point at the column that now carries placement');
    assert.ok(
      /must STAY CONFIGURED/.test(envExample),
      'the rollback note must state the one remaining condition: IMAGING_S3_* stays configured while any row records vps2',
    );
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

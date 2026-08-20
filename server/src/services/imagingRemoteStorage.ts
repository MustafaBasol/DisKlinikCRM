/**
 * imagingRemoteStorage.ts — VPS2 imaging-primary storage backend
 * (F4-IMAGING-001, ClickUp `869em3zqg`, ROADMAP_ORDER_EXCEPTION per
 * docs/program/NORAMEDI_MASTER_TRACKER.md, 2026-08-19 entry).
 *
 * Deliberately a SEPARATE module from fileStorage.ts and a SEPARATE
 * environment-variable namespace (`IMAGING_S3_*`, activated only by
 * `IMAGING_STORAGE_BACKEND=vps2`) — mirrors the already-accepted
 * fileBackupDestination.ts (`FILE_BACKUP_S3_*`) pattern exactly, for the same
 * reason: primary object storage (fileStorage.ts's own `S3_*`), the off-host
 * backup destination, and this imaging-primary backend are three independent
 * concerns that must stay independently configurable/rotatable.
 *
 * Scope: this module owns ONLY the VPS2-side S3-compatible transport
 * primitives (config validation, client construction, put/get/head/delete)
 * for the imaging content class. It does NOT decide routing (new-write
 * destination, legacy-read fallback) — that orchestration lives in
 * fileStorage.ts's `saveImagingFile`/`openImagingFileStream`/
 * `imagingFileExists`/`deleteImagingFile`, which call back into this module
 * only when `isImagingRemoteStorageEnabled()` is true. When the flag is
 * unset (the default), this module is never imported into a live code path,
 * so behavior is byte-identical to before this file existed — no
 * application deploy of this code silently redirects imaging traffic.
 *
 * Storage-key contract: UNCHANGED. `buildObjectStorageKey({kind:
 * 'imaging-image', ...})` in fileStorage.ts still owns key shape
 * (`<clinicId>/<opaqueId><ext>`) — this module only accepts an
 * already-built, already-validated key string. No new key template, no
 * rewrite of persisted keys, no migration.
 *
 * Production S3-mode safety (identical rationale/shape to
 * fileBackupDestination.ts's validateFileBackupS3Config — see that file's
 * header for the full write-up; not re-derived here):
 *   - `IMAGING_S3_ENDPOINT` is REQUIRED in every environment whenever the
 *     backend is `vps2` (R3 data-residency correction). It must parse as an
 *     absolute `http://`/`https://` URL, and in production it must be
 *     `https://` unless `IMAGING_S3_ALLOW_INSECURE_ENDPOINT=true` is
 *     explicitly set (e.g. a private-network endpoint with TLS terminated
 *     upstream of this process). Unlike `FILE_BACKUP_S3_ENDPOINT`, an unset
 *     value is NOT a legitimate "use real AWS S3" configuration here — it
 *     would silently ship KVKK health data out of Türkiye. See
 *     `resolveImagingS3Endpoint()`.
 *   - In production, `IMAGING_S3_SSE` must be set ("AES256" or "aws:kms") —
 *     imaging-primary storage refuses to start with no server-side-encryption
 *     mode requested. This REQUESTS encryption on every write via the
 *     `ServerSideEncryption`/`SSEKMSKeyId` request parameters; it does NOT
 *     verify bucket-level default encryption or volume-level encryption at
 *     rest (see docs/program/NORAMEDI_MASTER_TRACKER.md's F4-IMAGING-001
 *     entry — VPS2 has a single unencrypted ext4 partition today;
 *     `ENCRYPTION_AT_REST` is `UNVERIFIED — PROVIDER DOCUMENTATION REQUIRED`
 *     until IHS confirms volume-resize/attach capability. This code path
 *     must not be read as a production-encryption-at-rest claim.)
 *   - Outside production, none of the above throws — a disposable local
 *     MinIO container (this task's own synthetic test target) keeps working
 *     without TLS or KMS setup.
 *
 * What this module deliberately does NOT do (F4-IMAGING-001 scope limit,
 * see tracker entry): stand up an actual S3-compatible SERVICE on VPS2, open
 * any new firewall port, or configure network reachability between the app
 * host and VPS2. `IMAGING_S3_ENDPOINT` is a plain env var pointing at
 * wherever such a service eventually runs — deploying and network-exposing
 * that service is a separate, not-yet-authorized infrastructure task (the
 * 2026-08-19 firewall authorization was SSH-only; "no other public services
 * are currently authorized"). Until that service exists and its endpoint is
 * configured, `IMAGING_STORAGE_BACKEND` stays unset and this module is
 * inert.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import type { Readable } from 'stream';

export type ImagingStorageBackend = 'legacy' | 'vps2';

/**
 * Single authoritative parser/validator for `IMAGING_STORAGE_BACKEND`. Fail-closed
 * contract (R1 correction — the original version silently treated any
 * unrecognized value as "disabled", which meant a typo in production would
 * quietly keep routing new imaging writes to the legacy path with no signal
 * that VPS2 was never actually activated):
 *
 *   - unset, or empty/whitespace-only after trim => `'legacy'` (current
 *     production behavior — this is the only value that means "disabled").
 *   - `"vps2"` (exact match after trim; case-sensitive) => `'vps2'`.
 *   - any other non-empty value — a typo (`"vps2-typo"`), a different case
 *     (`"VPS2"`, `"Vps2"`), or anything else including `"local"` (not a
 *     supported backend name; there is no explicit "local" selector, only
 *     "unset means legacy") — throws.
 *
 * Every call site below (and `validateImagingS3Config()`) calls this before
 * doing anything else, so a misconfigured `IMAGING_STORAGE_BACKEND` fails the
 * request/startup outright instead of silently falling back to legacy
 * storage. A typo must never be indistinguishable from "VPS2 intentionally
 * not activated".
 */
export function getImagingStorageBackend(): ImagingStorageBackend {
  const raw = process.env.IMAGING_STORAGE_BACKEND;
  const trimmed = raw?.trim() ?? '';
  if (trimmed === '') return 'legacy';
  if (trimmed === 'vps2') return 'vps2';
  throw new Error(
    `Invalid IMAGING_STORAGE_BACKEND value ${JSON.stringify(raw)} — must be unset/empty (legacy storage) or exactly "vps2" (VPS2 storage). Refusing to guess (fail closed): a typo must never silently keep routing imaging writes to legacy storage.`,
  );
}

/** True only when the imaging-primary write/read path is explicitly switched to VPS2. Throws on any unrecognized non-empty `IMAGING_STORAGE_BACKEND` value — see `getImagingStorageBackend()`. */
export function isImagingRemoteStorageEnabled(): boolean {
  return getImagingStorageBackend() === 'vps2';
}

/**
 * F4-IMAGING-001-R6 — AUTHORITATIVE PER-OBJECT STORAGE PLACEMENT.
 *
 * The backend that actually holds one particular object's bytes, as recorded
 * on `ImagingImage.storageBackend`. Deliberately the SAME two tokens as
 * `ImagingStorageBackend` above, aliased rather than redeclared, so there is
 * exactly one vocabulary for "which imaging backend" — but the two concepts
 * are not interchangeable and must not be used for each other's job:
 *
 *   - `getImagingStorageBackend()` answers "where do NEW objects get written?"
 *     It is global runtime configuration and it can legitimately change.
 *   - `ImagingStoragePlacement` answers "where does THIS EXISTING object
 *     live?" It is a historical fact about bytes that were already written,
 *     and it can never change without physically moving those bytes.
 *
 * R5 Finding B was exactly the confusion of the two: the read path inferred
 * the second from the first, so unsetting `IMAGING_STORAGE_BACKEND` after the
 * first VPS2 write silently reclassified those objects as legacy and made
 * them unreadable, which made configuration rollback unsafe.
 */
export type ImagingStoragePlacement = ImagingStorageBackend;

/**
 * Single authoritative interpreter of the persisted
 * `ImagingImage.storageBackend` column. Every read/exists/delete/backup path
 * that starts from a database row funnels through this, so no two paths can
 * disagree about where an object lives.
 *
 * Contract:
 *
 *   - `null` / `undefined` / empty-or-whitespace-only  =>  `'legacy'`.
 *     This is the PRE-R6 state: "the row was written before this column
 *     existed", not "unknown backend". It resolves to legacy
 *     DETERMINISTICALLY and WITHOUT consulting `IMAGING_STORAGE_BACKEND`, so
 *     a pre-R6 row reads from the same physical place across a restart, a
 *     flag flip, and a configuration rollback. That is a fact rather than a
 *     guess: VPS2 imaging storage has never been activated in production —
 *     `IMAGING_STORAGE_BACKEND` is unset there and the VPS2 object store is
 *     `STORAGE_MODE = SYNTHETIC_STAGING_ONLY` with no application network
 *     path, no client CA trust and no SSE capability (F4-IMAGING-001-R5
 *     evidence §5-§6, §8) — so no persisted row's bytes can be anywhere but
 *     legacy storage.
 *   - `'legacy'` => `'legacy'`; `'vps2'` => `'vps2'` (exact match after trim,
 *     case-sensitive, matching `getImagingStorageBackend()`).
 *   - anything else => THROWS.
 *
 * The throw is the same fail-closed discipline as `getImagingStorageBackend()`
 * and it matters more here, not less: an unrecognized persisted value means
 * this process does not know where the bytes are. Guessing would either serve
 * or "confirm missing" the wrong physical object. Failing the single row's
 * request is recoverable; silently reading the wrong backend is not. In the
 * backup sweep this surfaces as that row's `failed` entry (never
 * `missing_source`) and never aborts the run.
 */
export function resolveImagingStoragePlacement(
  persisted: string | null | undefined,
): ImagingStoragePlacement {
  const trimmed = persisted?.trim() ?? '';
  if (trimmed === '') return 'legacy';
  if (trimmed === 'legacy') return 'legacy';
  if (trimmed === 'vps2') return 'vps2';
  throw new Error(
    `Invalid persisted ImagingImage.storageBackend value ${JSON.stringify(persisted)} — must be NULL/empty (pre-R6 row, read as legacy storage), "legacy", or "vps2". Refusing to guess (fail closed): reading an imaging object from the wrong backend would either serve unrelated bytes or report a healthy object as missing.`,
  );
}

function isProductionEnv(): boolean {
  return process.env.NODE_ENV === 'production';
}

export type ImagingS3SseMode = 'AES256' | 'aws:kms';

/**
 * Parses/validates IMAGING_S3_SSE. Returns `null` when unset. Throws on any
 * *set-but-unrecognized* value in every environment — a typo must never
 * silently degrade to "no encryption requested".
 */
function getImagingS3SseMode(): ImagingS3SseMode | null {
  const raw = process.env.IMAGING_S3_SSE?.trim();
  if (!raw) return null;
  if (raw === 'AES256' || raw === 'aws:kms') return raw;
  throw new Error(`Invalid IMAGING_S3_SSE value "${raw}" — must be "AES256" or "aws:kms"`);
}

function getImagingS3SseParams(): { ServerSideEncryption?: ImagingS3SseMode; SSEKMSKeyId?: string } {
  const mode = getImagingS3SseMode();
  if (!mode) return {};
  const kmsKeyId = process.env.IMAGING_S3_SSE_KMS_KEY_ID?.trim();
  return {
    ServerSideEncryption: mode,
    ...(mode === 'aws:kms' && kmsKeyId ? { SSEKMSKeyId: kmsKeyId } : {}),
  };
}

/**
 * Resolves and validates `IMAGING_S3_ENDPOINT`. REQUIRED in every environment
 * whenever `IMAGING_STORAGE_BACKEND=vps2` — see the residency rationale below.
 *
 * R3 correction (data-residency fail-closed). This deliberately DIVERGES from
 * fileBackupDestination.ts, where leaving `FILE_BACKUP_S3_ENDPOINT` unset is a
 * legitimate configuration meaning "use real AWS S3". That is a valid choice
 * for a generic backup destination; it is NOT a valid choice here. The literal
 * meaning of `IMAGING_STORAGE_BACKEND=vps2` is "route imaging bytes to the
 * VPS2 host in Türkiye". If the endpoint were omitted, the AWS SDK would
 * silently resolve its own default public AWS endpoint and imaging objects —
 * KVKK special-category health data — would be written to a non-Türkiye
 * region with no error, no log line, and no signal that VPS2 was never
 * involved. A missing endpoint must therefore be a startup failure, never an
 * implicit default. Same principle as the R1 `IMAGING_STORAGE_BACKEND` enum
 * correction: a configuration gap must never be indistinguishable from a
 * deliberate, silently-different destination.
 *
 * Checks, in order:
 *   - always: must be set and non-empty after trim.
 *   - always: must parse as a URL with an `http:` or `https:` scheme (a
 *     bare host like "vps2.example.com" is rejected — the SDK would not treat
 *     it as an endpoint override the way an operator would expect).
 *   - production only: must be `https://` unless
 *     `IMAGING_S3_ALLOW_INSECURE_ENDPOINT=true` is explicitly set.
 */
function resolveImagingS3Endpoint(): string {
  const endpoint = process.env.IMAGING_S3_ENDPOINT?.trim();

  if (!endpoint) {
    throw new Error(
      'IMAGING_STORAGE_BACKEND=vps2 requires IMAGING_S3_ENDPOINT to be set — refusing to start (fail closed). Without an explicit endpoint the AWS SDK would fall back to its default public AWS S3 endpoint, silently writing imaging data outside Türkiye and breaking the KVKK/data-residency contract that "vps2" is meant to express.',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error(
      `IMAGING_S3_ENDPOINT must be an absolute URL including scheme (e.g. "https://imaging.vps2.example:9000"), got ${JSON.stringify(endpoint)} — refusing to start (fail closed)`,
    );
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(
      `IMAGING_S3_ENDPOINT must use the http:// or https:// scheme, got ${JSON.stringify(parsed.protocol)} — refusing to start (fail closed)`,
    );
  }

  if (isProductionEnv()) {
    const allowInsecure = process.env.IMAGING_S3_ALLOW_INSECURE_ENDPOINT === 'true';
    if (parsed.protocol !== 'https:' && !allowInsecure) {
      throw new Error(
        'IMAGING_S3_ENDPOINT must use https:// in production (set IMAGING_S3_ALLOW_INSECURE_ENDPOINT=true to explicitly override for a non-TLS-terminated, private-network endpoint)',
      );
    }
  }

  return endpoint;
}

/**
 * Fail-closed pre-flight check. A no-op when the backend isn't switched on.
 * Called from `getImagingS3()` before the client is constructed, so a
 * misconfigured production imaging backend is refused before the first
 * upload is attempted — not discovered mid-request.
 *
 *   - always: `IMAGING_S3_BUCKET` must be set when the backend is enabled.
 *   - always: `IMAGING_S3_SSE`, if set, must be a recognized mode.
 *   - always: `IMAGING_S3_ENDPOINT` must be set and be a valid http/https URL
 *     (R3 data-residency correction — see `resolveImagingS3Endpoint()`).
 *   - production only: that endpoint must be `https://` unless
 *     `IMAGING_S3_ALLOW_INSECURE_ENDPOINT=true`.
 *   - production only: `IMAGING_S3_SSE` must be set to a recognized mode.
 */
export function validateImagingS3Config(): void {
  if (!isImagingRemoteStorageEnabled()) return;

  if (!process.env.IMAGING_S3_BUCKET?.trim()) {
    throw new Error(
      'IMAGING_STORAGE_BACKEND=vps2 requires IMAGING_S3_BUCKET to be set — refusing to start imaging-primary VPS2 storage unconfigured (fail closed)',
    );
  }

  // Always validated, even outside production: a typo'd SSE value must
  // never silently degrade to "no encryption requested".
  const sseMode = getImagingS3SseMode();

  // Always validated, even outside production: an absent endpoint must never
  // resolve to the SDK's default public AWS endpoint (residency, see above).
  resolveImagingS3Endpoint();

  if (!isProductionEnv()) return;

  if (!sseMode) {
    throw new Error(
      'IMAGING_S3_SSE must be set ("AES256" or "aws:kms") before running VPS2-mode imaging storage in production — refusing to start with no server-side-encryption mode configured (fail closed)',
    );
  }
}

let imagingS3Client: S3Client | null = null;

function getImagingS3(): S3Client {
  if (imagingS3Client) return imagingS3Client;
  validateImagingS3Config();
  const accessKeyId = process.env.IMAGING_S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.IMAGING_S3_SECRET_ACCESS_KEY?.trim();
  // `endpoint` is passed UNCONDITIONALLY (R3): validateImagingS3Config() above
  // has already refused an unset/invalid endpoint, so there is no longer any
  // path that constructs a client which could resolve the SDK's default public
  // AWS endpoint. The previous conditional spread was the mechanism by which a
  // missing endpoint silently became "real AWS S3" instead of VPS2.
  imagingS3Client = new S3Client({
    region: process.env.IMAGING_S3_REGION?.trim() || 'auto',
    endpoint: resolveImagingS3Endpoint(),
    ...(process.env.IMAGING_S3_FORCE_PATH_STYLE === 'true' ? { forcePathStyle: true } : {}),
    ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
  });
  return imagingS3Client;
}

function imagingBucket(): string {
  return process.env.IMAGING_S3_BUCKET!.trim();
}

/** Test-only reset so a test that mutates IMAGING_S3_* env vars doesn't leak a stale client into the next test. Never called from production code. */
export function __resetImagingS3ClientForTest(): void {
  imagingS3Client = null;
}

/** Writes an object to the VPS2 imaging bucket. Assumes `key` is already validated by the caller (buildObjectStorageKey). */
export async function putImagingObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await getImagingS3().send(new PutObjectCommand({
    Bucket: imagingBucket(),
    Key: key,
    Body: body,
    ContentType: contentType,
    ...getImagingS3SseParams(),
  }));
}

/** Streams an object from the VPS2 imaging bucket. Returns null on a confirmed-absent (404/NoSuchKey) response; rethrows any other error (network/auth/unavailable) so the caller can distinguish "not here" from "can't tell". */
export async function getImagingObjectStream(key: string): Promise<Readable | null> {
  try {
    const result = await getImagingS3().send(new GetObjectCommand({ Bucket: imagingBucket(), Key: key }));
    return (result.Body as Readable) ?? null;
  } catch (error: any) {
    if (error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404) return null;
    throw error;
  }
}

/** Same not-found-vs-unavailable distinction as getImagingObjectStream, without transferring the body. */
export async function imagingObjectExists(key: string): Promise<boolean> {
  try {
    await getImagingS3().send(new HeadObjectCommand({ Bucket: imagingBucket(), Key: key }));
    return true;
  } catch (error: any) {
    if (error?.name === 'NotFound' || error?.$metadata?.httpStatusCode === 404) return false;
    throw error;
  }
}

/** Deletes an object from the VPS2 imaging bucket. Idempotent by S3 semantics (DeleteObject on a missing key is not an error). */
export async function deleteImagingObject(key: string): Promise<void> {
  await getImagingS3().send(new DeleteObjectCommand({ Bucket: imagingBucket(), Key: key }));
}

/**
 * Streaming multipart upload variant (mirrors fileStorage.ts's
 * saveFileFromPath / fileBackupDestination.ts's writeToBackupDestination) —
 * not currently wired to a call site (imaging ingest today reads the whole
 * validated buffer into memory before this point, same as it always has:
 * see imagingIngestCore.ts), kept here so a future large-DICOM streaming
 * path can reuse this backend's client/SSE/bucket config without
 * duplicating it, without changing today's ingest behavior.
 */
export async function uploadImagingObjectStream(key: string, body: Readable, contentType: string): Promise<void> {
  const upload = new Upload({
    client: getImagingS3(),
    params: { Bucket: imagingBucket(), Key: key, Body: body, ContentType: contentType, ...getImagingS3SseParams() },
    leavePartsOnError: false,
  });
  await upload.done();
}

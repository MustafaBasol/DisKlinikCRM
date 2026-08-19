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
 *   - `IMAGING_S3_ENDPOINT`, when set, must be `https://` in production
 *     (`NODE_ENV=production`) unless `IMAGING_S3_ALLOW_INSECURE_ENDPOINT=true`
 *     is explicitly set (e.g. a private-network endpoint with TLS terminated
 *     upstream of this process).
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
 * Fail-closed pre-flight check. A no-op when the backend isn't switched on.
 * Called from `getImagingS3()` before the client is constructed, so a
 * misconfigured production imaging backend is refused before the first
 * upload is attempted — not discovered mid-request.
 *
 *   - always: `IMAGING_S3_BUCKET` must be set when the backend is enabled.
 *   - production only: `IMAGING_S3_ENDPOINT`, if set, must be `https://`
 *     unless `IMAGING_S3_ALLOW_INSECURE_ENDPOINT=true`.
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

  if (!isProductionEnv()) return;

  const endpoint = process.env.IMAGING_S3_ENDPOINT?.trim();
  const allowInsecure = process.env.IMAGING_S3_ALLOW_INSECURE_ENDPOINT === 'true';
  if (endpoint && !endpoint.startsWith('https://') && !allowInsecure) {
    throw new Error(
      'IMAGING_S3_ENDPOINT must use https:// in production (set IMAGING_S3_ALLOW_INSECURE_ENDPOINT=true to explicitly override for a non-TLS-terminated, private-network endpoint)',
    );
  }

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
  imagingS3Client = new S3Client({
    region: process.env.IMAGING_S3_REGION?.trim() || 'auto',
    ...(process.env.IMAGING_S3_ENDPOINT?.trim() ? { endpoint: process.env.IMAGING_S3_ENDPOINT.trim() } : {}),
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

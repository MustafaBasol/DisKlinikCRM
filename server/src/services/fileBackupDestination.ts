/**
 * fileBackupDestination.ts — off-host replication target for filesystem-
 * backed clinical artifacts (FILE-BACKUP-COVERAGE-001).
 *
 * Deliberately a SEPARATE module from fileStorage.ts and a SEPARATE
 * environment-variable namespace from its S3_* vars. Two independent
 * concerns are being kept independent on purpose:
 *
 *   - fileStorage.ts (S3_*)      → PRIMARY storage: where a newly uploaded
 *                                   file lives and is served from.
 *   - fileBackupDestination.ts
 *     (FILE_BACKUP_*)            → BACKUP destination: an off-host COPY of
 *                                   what already exists in primary storage.
 *
 * This lets a clinic run local-primary + off-host-S3-backup (the
 * recommended default for a single-VPS deployment — see
 * docs/program/evidence/FILE_BACKUP_COVERAGE_001.md), or S3-primary +
 * different-provider-S3-backup for defense in depth. It also means a backup
 * destination can be configured/rotated without ever touching primary
 * storage credentials, and vice versa.
 *
 * Two destination kinds are supported:
 *   - Local secondary directory (FILE_BACKUP_LOCAL_DIR) — e.g. a mounted
 *     network share or a second disk. Intended for development/testing or a
 *     stopgap; on a single VPS with no second disk this does NOT satisfy the
 *     "off-host" requirement by itself and must not be reported as such.
 *   - S3-compatible bucket (FILE_BACKUP_S3_*) — AWS S3, MinIO, Cloudflare
 *     R2, or a Turkey-hosted S3-compatible provider. This is the
 *     off-host-capable option.
 *
 * If neither is configured, `isFileBackupDestinationConfigured()` returns
 * false and the backup job must refuse to run (fail closed — never silently
 * report "backup completed" with zero real off-host copies made).
 *
 * Production S3-mode safety configuration (FILE-BACKUP-COVERAGE-001 follow-
 * up, PR #247 hardening — production S3-mode backup is still NOT enabled by
 * this change; this only tightens what is REQUIRED before it could be):
 *
 *   - FILE_BACKUP_S3_ENDPOINT, when set, must be `https://` in production
 *     (`NODE_ENV=production`). An explicit, opt-in
 *     `FILE_BACKUP_S3_ALLOW_INSECURE_ENDPOINT=true` is required to run a
 *     plaintext-transport endpoint in production (e.g. a self-hosted MinIO
 *     reachable only over a private network without TLS termination) — this
 *     stops a copy/paste of a dev `.env` (`http://localhost:9000`, etc.)
 *     from silently shipping clinical file bytes over an unencrypted
 *     channel. Leaving `FILE_BACKUP_S3_ENDPOINT` unset (real AWS S3) is
 *     always fine — the AWS SDK's default endpoints are always HTTPS.
 *   - FILE_BACKUP_S3_SSE selects the server-side-encryption mode requested
 *     on every write (`AES256` or `aws:kms`, optionally paired with
 *     FILE_BACKUP_S3_SSE_KMS_KEY_ID for a specific customer-managed KMS
 *     key). In production, S3 mode refuses to start at all if this is
 *     unset — an unconfigured encryption mode is refused rather than
 *     silently falling back to whatever the bucket's own default happens to
 *     be (which may be none). This REQUESTS encryption on every write via
 *     the `ServerSideEncryption`/`SSEKMSKeyId` request parameters; it does
 *     NOT verify bucket-level default encryption via the S3 API (no
 *     `GetBucketEncryption` call is made) — see
 *     `docs/program/evidence/FILE_BACKUP_COVERAGE_001.md` §14 for what
 *     remains `IMPLEMENTED_NOT_PRODUCTION_VERIFIED` versus what this
 *     validation actually enforces in code.
 *   - Outside production (`NODE_ENV !== 'production'`: dev/test/CI), none
 *     of the above throws — a local MinIO container with `http://` and no
 *     SSE configured keeps working for this repo's own test suite
 *     (`fileBackupService.test.ts`, `fileBackupDbIntegration.test.ts`)
 *     without requiring TLS or KMS setup.
 *   - Bucket-level controls this module does NOT and CANNOT enforce from
 *     application code alone — versioning, object-lock/immutability,
 *     lifecycle/retention rules, and the IAM policy attached to the
 *     credentials used here — are operator-managed provider configuration.
 *     They are documented as explicit requirements (not implemented here)
 *     in `docs/program/evidence/FILE_BACKUP_COVERAGE_001.md` §14.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { safeErrorFields } from '../utils/safeError.js';

export type FileBackupDestinationKind = 'local' | 's3' | 'none';

export function getFileBackupDestinationKind(): FileBackupDestinationKind {
  if (process.env.FILE_BACKUP_S3_BUCKET?.trim()) return 's3';
  if (process.env.FILE_BACKUP_LOCAL_DIR?.trim()) return 'local';
  return 'none';
}

export function isFileBackupDestinationConfigured(): boolean {
  return getFileBackupDestinationKind() !== 'none';
}

/**
 * Hosts that are, by definition, the SAME machine — so an S3-compatible
 * endpoint pointing at one of them is not a second failure domain.
 */
function isLoopbackEndpointHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h === '::1' || h === '0.0.0.0') return true;
  // Whole 127.0.0.0/8, not just 127.0.0.1.
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

/**
 * True only for a destination this program can honestly call off-host.
 *
 * F4-FCR-001 promotes this value into an operator-facing "off-host ✓" badge,
 * into the recovery status file, and into the host monitor's failure-domain
 * alarm — so it must not answer `true` for something that is demonstrably the
 * same machine. Kind `s3` alone is not sufficient evidence: the module
 * deliberately permits `FILE_BACKUP_S3_ENDPOINT=http://localhost:9000` (a
 * MinIO container on this very VPS) via FILE_BACKUP_S3_ALLOW_INSECURE_ENDPOINT,
 * and that configuration shares a disk, a host, and a blast radius with the
 * primary data. Claiming it as an independent copy is exactly the false
 * assurance R-030 exists to prevent.
 *
 * A non-loopback endpoint is still only a claim about the CONFIGURED address,
 * not proof of a distinct failure domain — a remote-looking hostname can still
 * resolve to this host. It is the strongest check available in application
 * code; the durability argument itself remains an operator/architecture
 * decision (see docs/program/runbooks/F4_RECOVERY_OPERATIONS.md §7.2).
 */
export function isFileBackupDestinationOffHost(): boolean {
  if (getFileBackupDestinationKind() !== 's3') return false;

  const endpoint = process.env.FILE_BACKUP_S3_ENDPOINT?.trim();
  // No endpoint means real AWS S3, which is never this host.
  if (!endpoint) return true;

  try {
    return !isLoopbackEndpointHost(new URL(endpoint).hostname);
  } catch {
    // An unparseable endpoint cannot be shown to be off-host. Fail closed:
    // under-claiming durability is safe, over-claiming it is not.
    return false;
  }
}

let s3Client: S3Client | null = null;

function isProductionEnv(): boolean {
  return process.env.NODE_ENV === 'production';
}

export type FileBackupS3SseMode = 'AES256' | 'aws:kms';

/**
 * Parses/validates FILE_BACKUP_S3_SSE. Returns `null` when unset. Throws on
 * any *set-but-unrecognized* value in every environment (dev included) —
 * a typo here must never silently result in "no SSE header sent", it must
 * be loud immediately.
 */
function getFileBackupS3SseMode(): FileBackupS3SseMode | null {
  const raw = process.env.FILE_BACKUP_S3_SSE?.trim();
  if (!raw) return null;
  if (raw === 'AES256' || raw === 'aws:kms') return raw;
  throw new Error(`Invalid FILE_BACKUP_S3_SSE value "${raw}" — must be "AES256" or "aws:kms"`);
}

/**
 * Server-side-encryption request parameters to attach to every S3 write
 * (PutObject and multipart Upload) when FILE_BACKUP_S3_SSE is configured.
 * Returns `{}` (no SSE params sent) when unset — callers in production are
 * protected from ever reaching this with SSE unset by
 * `validateFileBackupS3Config()`'s fail-closed check, run before any client
 * is constructed.
 */
function getFileBackupS3SseParams(): { ServerSideEncryption?: FileBackupS3SseMode; SSEKMSKeyId?: string } {
  const mode = getFileBackupS3SseMode();
  if (!mode) return {};
  const kmsKeyId = process.env.FILE_BACKUP_S3_SSE_KMS_KEY_ID?.trim();
  return {
    ServerSideEncryption: mode,
    ...(mode === 'aws:kms' && kmsKeyId ? { SSEKMSKeyId: kmsKeyId } : {}),
  };
}

/**
 * Fail-closed pre-flight check for S3-mode file backup configuration. A
 * no-op when the configured destination kind isn't `s3` (local mode has no
 * transport/encryption-in-transit story to validate here). Called from
 * `getS3()` before the client is constructed AND from
 * `fileBackupService.ts`'s `runFileBackup()` pre-flight, so a misconfigured
 * production S3 destination is refused before a `FileBackupRun` row is even
 * created — not discovered mid-run on the first `PutObject` call.
 *
 * See this file's header comment for the full rationale. Summary:
 *   - production only (`NODE_ENV==='production'`): FILE_BACKUP_S3_ENDPOINT,
 *     if set, must be `https://` unless FILE_BACKUP_S3_ALLOW_INSECURE_ENDPOINT
 *     is explicitly `'true'`.
 *   - production only: FILE_BACKUP_S3_SSE must be set to a recognized mode
 *     — refuses to start with no server-side-encryption mode configured.
 *   - every environment: an explicitly-set-but-unrecognized
 *     FILE_BACKUP_S3_SSE value is always rejected.
 */
export function validateFileBackupS3Config(): void {
  if (getFileBackupDestinationKind() !== 's3') return;

  // Always validated, even outside production: a typo'd SSE value must
  // never silently degrade to "no encryption requested".
  const sseMode = getFileBackupS3SseMode();

  if (!isProductionEnv()) return;

  const endpoint = process.env.FILE_BACKUP_S3_ENDPOINT?.trim();
  const allowInsecure = process.env.FILE_BACKUP_S3_ALLOW_INSECURE_ENDPOINT === 'true';
  if (endpoint && !endpoint.startsWith('https://') && !allowInsecure) {
    throw new Error(
      'FILE_BACKUP_S3_ENDPOINT must use https:// in production (set FILE_BACKUP_S3_ALLOW_INSECURE_ENDPOINT=true to explicitly override for a non-TLS-terminated, private-network endpoint)',
    );
  }

  if (!sseMode) {
    throw new Error(
      'FILE_BACKUP_S3_SSE must be set ("AES256" or "aws:kms") before running S3-mode file backup in production — refusing to start with no server-side-encryption mode configured (fail closed)',
    );
  }
}

function getS3(): S3Client {
  if (s3Client) return s3Client;
  validateFileBackupS3Config();
  const accessKeyId = process.env.FILE_BACKUP_S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.FILE_BACKUP_S3_SECRET_ACCESS_KEY?.trim();
  s3Client = new S3Client({
    region: process.env.FILE_BACKUP_S3_REGION?.trim() || 'auto',
    ...(process.env.FILE_BACKUP_S3_ENDPOINT?.trim() ? { endpoint: process.env.FILE_BACKUP_S3_ENDPOINT.trim() } : {}),
    ...(process.env.FILE_BACKUP_S3_FORCE_PATH_STYLE === 'true' ? { forcePathStyle: true } : {}),
    ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
  });
  return s3Client;
}

function s3Bucket(): string {
  return process.env.FILE_BACKUP_S3_BUCKET!.trim();
}

function localBackupRoot(): string {
  return path.resolve(process.env.FILE_BACKUP_LOCAL_DIR!.trim());
}

/**
 * Builds the backup destination key for one source file. Deterministic from
 * (domain, clinicId, sourceRecordId) only — NOT content-addressed. This is a
 * deliberate choice: attachments/lab-attachments/imaging images are
 * immutable by design (no update endpoint exists for any of them, see
 * docs/compliance/53), so a record-id-based key is already stable across
 * runs without needing the sha256 known in advance. That in turn lets the
 * backup write be a single streaming pass (source → destination, hashing as
 * it goes) instead of requiring a first pass just to compute a checksum
 * before a second pass to write — important for large imaging/DICOM files,
 * which must never be fully buffered in memory.
 */
export function buildBackupDestinationKey(
  domain: 'attachments' | 'lab-attachments' | 'imaging',
  clinicId: string,
  sourceRecordId: string,
): string {
  return `file-backups/${domain}/${clinicId}/${sourceRecordId}.bin`;
}

/**
 * Streams a source Readable to the configured destination, hashing as it
 * writes. Returns the sha256 and byte count of the bytes actually read from
 * `source`. Hashing is done via a Transform stage piped between `source` and
 * the destination writer — NOT via a `source.on('data', ...)` listener run
 * alongside a separate consumer of the same stream, which would race two
 * independent consumers against one flowing-mode Readable and could silently
 * drop or duplicate chunks. This keeps a single linear pipeline with exactly
 * one consumer at every stage, so the whole file is still never buffered
 * fully in memory (required for large imaging/DICOM files).
 */
export async function writeToBackupDestination(
  key: string,
  source: Readable,
): Promise<{ sha256: string; bytes: number }> {
  const kind = getFileBackupDestinationKind();
  if (kind === 'none') {
    throw new Error('No file backup destination configured');
  }

  const hash = crypto.createHash('sha256');
  let bytes = 0;
  const hashing = new Transform({
    transform(chunk: Buffer, _enc, callback) {
      hash.update(chunk);
      bytes += chunk.length;
      callback(null, chunk);
    },
  });

  if (kind === 's3') {
    const client = getS3(); // validates FILE_BACKUP_S3_SSE/endpoint before any write is attempted
    const upload = new Upload({
      client,
      params: { Bucket: s3Bucket(), Key: key, Body: source.pipe(hashing), ...getFileBackupS3SseParams() },
      leavePartsOnError: false,
    });
    await upload.done();
    return { sha256: hash.digest('hex'), bytes };
  }

  // local mode
  const localPath = path.join(localBackupRoot(), key);
  await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
  const partialPath = `${localPath}.partial-${crypto.randomUUID()}`;
  try {
    await pipeline(source, hashing, fs.createWriteStream(partialPath, { mode: 0o600, flags: 'wx' }));
    await fs.promises.rename(partialPath, localPath);
  } catch (err) {
    await fs.promises.unlink(partialPath).catch(() => {});
    throw err;
  }
  return { sha256: hash.digest('hex'), bytes };
}

/** Opens a readable stream for an object already at the backup destination. Returns null if not found. */
export async function openBackupDestinationStream(key: string): Promise<Readable | null> {
  const kind = getFileBackupDestinationKind();
  if (kind === 'none') return null;

  if (kind === 's3') {
    try {
      const result = await getS3().send(new GetObjectCommand({ Bucket: s3Bucket(), Key: key }));
      return (result.Body as Readable) ?? null;
    } catch (error: any) {
      if (error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404) return null;
      throw error;
    }
  }

  const localPath = path.join(localBackupRoot(), key);
  if (!fs.existsSync(localPath)) return null;
  return fs.createReadStream(localPath);
}

/** Checks whether an object already exists at the backup destination without reading its content. */
export async function backupDestinationObjectExists(key: string): Promise<boolean> {
  const kind = getFileBackupDestinationKind();
  if (kind === 'none') return false;

  if (kind === 's3') {
    try {
      await getS3().send(new HeadObjectCommand({ Bucket: s3Bucket(), Key: key }));
      return true;
    } catch (error: any) {
      if (error?.name === 'NotFound' || error?.$metadata?.httpStatusCode === 404) return false;
      throw error;
    }
  }

  const localPath = path.join(localBackupRoot(), key);
  return fs.existsSync(localPath);
}

/** Writes a small JSON manifest object to the backup destination. Best-effort — a manifest write failure must never fail the underlying file backups it describes. */
export async function writeBackupManifest(key: string, manifest: unknown): Promise<boolean> {
  const kind = getFileBackupDestinationKind();
  if (kind === 'none') return false;
  const body = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8');

  try {
    if (kind === 's3') {
      await getS3().send(new PutObjectCommand({
        Bucket: s3Bucket(),
        Key: key,
        Body: body,
        ContentType: 'application/json',
        ...getFileBackupS3SseParams(),
      }));
      return true;
    }
    const localPath = path.join(localBackupRoot(), key);
    await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
    await fs.promises.writeFile(localPath, body, { mode: 0o600 });
    return true;
  } catch (err) {
    console.error('[file-backup-destination] manifest write failed', safeErrorFields(err));
    return false;
  }
}

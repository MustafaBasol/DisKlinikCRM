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

/** True only for the destination kind this program treats as off-host. */
export function isFileBackupDestinationOffHost(): boolean {
  return getFileBackupDestinationKind() === 's3';
}

let s3Client: S3Client | null = null;

function getS3(): S3Client {
  if (s3Client) return s3Client;
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
    const upload = new Upload({
      client: getS3(),
      params: { Bucket: s3Bucket(), Key: key, Body: source.pipe(hashing) },
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

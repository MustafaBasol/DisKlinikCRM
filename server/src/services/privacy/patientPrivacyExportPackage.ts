/**
 * patientPrivacyExportPackage.ts — KVKK/GDPR downloadable export packages
 * (docs/compliance/53-kvkk-attachment-imaging-lifecycle.md).
 *
 * Extends the existing JSON-body /privacy/export endpoint with a ZIP package
 * that additionally includes the physical attachment files (and imaging
 * metadata) plus a manifest with per-file SHA-256 hashes.
 *
 * Token handling follows the same pattern as
 * services/publicBookingNoticeEvidence.ts: the raw one-time download token
 * is returned to the caller exactly once and never persisted — only its
 * SHA-256 hash (tokenHash) is stored. A database read (or leaked backup)
 * cannot be used to forge a valid download.
 *
 * Storage keys (exports/<clinicId>/<uuid>.zip) are never serialized to any
 * API response — callers only ever see { exportId, downloadToken, expiresAt }.
 *
 * Streaming (PR #160 review remediation): the ZIP is built by piping
 * archiver directly into a temp file on disk — never accumulated as an
 * in-process Buffer[]/chunks array — and moved/streamed into final storage
 * via fileStorage.saveFileFromPath (rename on local disk, multipart
 * streaming Upload on S3). Individual attachment files are still read into a
 * bounded (<= EXPORT_MAX_FILE_SIZE_BYTES) buffer to compute their SHA-256
 * and append them to the archive — safe because that size is already
 * enforced at upload time (routes/attachments.ts), so no single file read
 * can exceed that bound. What is eliminated is unbounded/whole-archive
 * buffering: the total ZIP is never held in memory, and per-file, per-count,
 * and total-size caps are enforced (via a cheap stat, before any bytes are
 * read) rather than discovered only after buffering everything.
 */

import crypto, { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import archiver from 'archiver';
import type { Prisma, PrismaClient } from '@prisma/client';
import prisma from '../../db.js';
import {
  buildExportStorageKey,
  openFileStream,
  saveFileFromPath,
  statFile,
  deleteFile,
} from '../fileStorage.js';
import { ATTACHMENT_MAX_FILE_SIZE_BYTES } from '../../routes/attachments.js';
import { safeErrorFields } from '../../utils/safeError.js';

export const EXPORT_PACKAGE_TTL_MS = 60 * 60 * 1000; // 1 hour

/** How long a "generating"/"queued" row is treated as a live in-flight lock before being considered abandoned. */
export const EXPORT_GENERATION_STALE_MS = 10 * 60 * 1000; // 10 minutes

/** Bounds enforced on every export package build (PR #160 review). */
export const EXPORT_MAX_FILE_COUNT = 500;
export const EXPORT_MAX_FILE_SIZE_BYTES = ATTACHMENT_MAX_FILE_SIZE_BYTES; // reuse the attachment upload cap
export const EXPORT_MAX_TOTAL_SIZE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

export type SkipReasonCode =
  | 'file_not_found_in_storage'
  | 'read_failed'
  | 'size_limit_exceeded'
  | 'count_limit_exceeded'
  | 'total_size_limit_exceeded';

export interface ManifestFileEntry {
  attachmentId: string;
  /** Safe label — never the raw original filename with potential PII beyond what's already in the DB record itself; kept as the stored fileName (non-identifying, server-generated). */
  label: string;
  sha256: string;
  sizeBytes: number;
}

export interface ManifestMissingEntry {
  attachmentId: string;
  /** Stable reason code — never a raw exception message (never leaked into API responses/audit metadata). */
  reason: SkipReasonCode;
}

export interface ExportManifest {
  exportVersion: 1;
  patientId: string;
  clinicId: string;
  generatedAt: string;
  includedFiles: ManifestFileEntry[];
  missingFiles: ManifestMissingEntry[];
  skippedFiles: ManifestMissingEntry[];
}

export interface CreateExportPackageArgs {
  clinicId: string;
  organizationId: string;
  patientId: string;
  requestedByUserId: string;
  /** Structured JSON export payload (same shape as the existing /privacy/export endpoint) to embed as data.json inside the zip. */
  structuredData: unknown;
}

export interface CreateExportPackageResult {
  exportId: string;
  downloadToken: string;
  expiresAt: Date;
  manifest: ExportManifest;
}

export class ExportGenerationInProgressError extends Error {
  constructor() {
    super('An export package is already being generated for this clinic.');
    this.name = 'ExportGenerationInProgressError';
  }
}

function sha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** SHA-256 hex digest of a raw export download token. */
export function hashExportToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

/**
 * Deterministic pg_advisory_xact_lock key pair for a clinic's export-slot
 * reservation, mirroring services/appointmentRequestSafety.ts's
 * computeSlotLockKey pattern: SHA-256 of a namespaced string, split into two
 * signed int32 values (the only overload pg_advisory_xact_lock(int4, int4)
 * accepts). Exported for unit testing only.
 */
export function computeExportLockKey(clinicId: string): [number, number] {
  const hash = createHash('sha256').update(`export-archive-slot:${clinicId}`, 'utf8').digest();
  return [hash.readInt32BE(0), hash.readInt32BE(4)];
}

/**
 * Reserves the per-clinic export-generation slot atomically.
 *
 * Two concurrent requests for the same clinic MUST NOT both be able to
 * create a "generating" row: a naive findFirst-then-create (as this function
 * used to do) has a race window under READ COMMITTED — both transactions can
 * read "no active row" before either commits its create. This is closed the
 * same way appointment-slot booking is (acquireAppointmentSlotLock): a
 * PostgreSQL advisory transaction lock, scoped to this clinic, acquired
 * BEFORE the active-row check, inside the same transaction as the check and
 * the create. The lock is released automatically when the transaction ends
 * (commit or rollback) — no in-memory mutex, so this is correct across
 * multiple Node processes/API instances, not just within one.
 *
 * Within the locked transaction:
 *   1. Sweep stale queued/generating rows (older than
 *      EXPORT_GENERATION_STALE_MS) to status='failed' so an abandoned
 *      generation attempt never blocks new exports forever.
 *   2. Check for a current active (queued/generating) row; throw
 *      ExportGenerationInProgressError if one exists.
 *   3. Otherwise create exactly one new "generating" row.
 *
 * `client` is injectable (default: the shared prisma singleton) purely so
 * tests can point this at a disposable database without a reimplementation —
 * production code always uses the default.
 */
export async function reserveGenerationSlot(
  clinicId: string,
  organizationId: string,
  patientId: string,
  requestedByUserId: string,
  now: Date = new Date(),
  client: Pick<PrismaClient, '$transaction'> = prisma,
): Promise<string> {
  const staleBefore = new Date(now.getTime() - EXPORT_GENERATION_STALE_MS);
  const exportId = crypto.randomUUID();

  await client.$transaction(async (tx: Prisma.TransactionClient) => {
    const [key1, key2] = computeExportLockKey(clinicId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${key1}::int4, ${key2}::int4)`;

    await tx.patientPrivacyExportArchive.updateMany({
      where: {
        clinicId,
        status: { in: ['queued', 'generating'] },
        createdAt: { lt: staleBefore },
      },
      data: { status: 'failed' },
    });

    const inFlight = await tx.patientPrivacyExportArchive.findFirst({
      where: { clinicId, status: { in: ['queued', 'generating'] } },
      select: { id: true },
    });
    if (inFlight) {
      throw new ExportGenerationInProgressError();
    }

    await tx.patientPrivacyExportArchive.create({
      data: {
        id: exportId,
        organizationId,
        clinicId,
        patientId,
        requestedByUserId,
        status: 'generating',
      },
    });
  });

  return exportId;
}

/**
 * Builds a ZIP package containing:
 *  - data.json: the structured JSON export (patient/appointments/etc)
 *  - manifest.json: the manifest described above
 *  - attachments/<fileName>: each PatientAttachment's physical bytes (best-effort;
 *    missing/unreadable/oversized files are recorded in manifest.missingFiles /
 *    skippedFiles, never abort the export)
 *
 * Never includes physical imaging files in this PR — imaging is
 * conservative-retain (see docs/compliance/53); only imaging metadata already
 * present in structuredData is included via data.json.
 *
 * Throws ExportGenerationInProgressError (caller should map to HTTP 409) if
 * another export is already generating for this clinic.
 */
export async function createExportPackage(
  args: CreateExportPackageArgs,
): Promise<CreateExportPackageResult> {
  const { clinicId, organizationId, patientId, requestedByUserId, structuredData } = args;

  const exportId = await reserveGenerationSlot(clinicId, organizationId, patientId, requestedByUserId, new Date());

  let tempFilePath: string | null = null;

  try {
    const attachments = await prisma.patientAttachment.findMany({
      where: { clinicId, patientId },
      select: { id: true, fileName: true, originalName: true, filePath: true, legalHold: true },
      orderBy: { createdAt: 'asc' },
    });

    const includedFiles: ManifestFileEntry[] = [];
    const missingFiles: ManifestMissingEntry[] = [];
    const skippedFiles: ManifestMissingEntry[] = [];

    tempFilePath = path.join(os.tmpdir(), `kvkk-export-${exportId}.zip`);
    const archive = archiver('zip', { zlib: { level: 9 } });
    const writeStream = fs.createWriteStream(tempFilePath);

    const writeFinished = new Promise<void>((resolve, reject) => {
      writeStream.on('close', resolve);
      writeStream.on('error', reject);
      archive.on('error', reject);
    });
    archive.pipe(writeStream);

    archive.append(Buffer.from(JSON.stringify(structuredData, null, 2), 'utf8'), {
      name: 'data.json',
    });

    let totalBytesIncluded = 0;
    let countLimitReached = false;
    let totalLimitReached = false;

    for (const attachment of attachments) {
      if (countLimitReached) {
        skippedFiles.push({ attachmentId: attachment.id, reason: 'count_limit_exceeded' });
        continue;
      }
      if (totalLimitReached) {
        skippedFiles.push({ attachmentId: attachment.id, reason: 'total_size_limit_exceeded' });
        continue;
      }
      if (includedFiles.length >= EXPORT_MAX_FILE_COUNT) {
        countLimitReached = true;
        skippedFiles.push({ attachmentId: attachment.id, reason: 'count_limit_exceeded' });
        continue;
      }

      const stat = await statFile(attachment.filePath);
      if (!stat) {
        missingFiles.push({ attachmentId: attachment.id, reason: 'file_not_found_in_storage' });
        continue;
      }
      if (stat.size > EXPORT_MAX_FILE_SIZE_BYTES) {
        skippedFiles.push({ attachmentId: attachment.id, reason: 'size_limit_exceeded' });
        continue;
      }
      if (totalBytesIncluded + stat.size > EXPORT_MAX_TOTAL_SIZE_BYTES) {
        totalLimitReached = true;
        skippedFiles.push({ attachmentId: attachment.id, reason: 'total_size_limit_exceeded' });
        continue;
      }

      try {
        const stream = await openFileStream(attachment.filePath);
        if (!stream) {
          missingFiles.push({ attachmentId: attachment.id, reason: 'file_not_found_in_storage' });
          continue;
        }
        // Bounded read (<= EXPORT_MAX_FILE_SIZE_BYTES, already checked above
        // via statFile) — safe to buffer a single already-capped file to
        // compute its hash and append it; the ZIP as a whole is never
        // buffered (piped straight to a temp file, see above).
        const bufChunks: Buffer[] = [];
        for await (const chunk of stream) {
          bufChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        const buf = Buffer.concat(bufChunks);
        archive.append(buf, { name: `attachments/${attachment.fileName}` });
        includedFiles.push({
          attachmentId: attachment.id,
          label: attachment.fileName,
          sha256: sha256(buf),
          sizeBytes: buf.length,
        });
        totalBytesIncluded += buf.length;
      } catch (err) {
        const { errorName, errorCode } = safeErrorFields(err);
        console.error('[export-package] attachment read failed', {
          attachmentId: attachment.id,
          errorName,
          errorCode,
        });
        missingFiles.push({ attachmentId: attachment.id, reason: 'read_failed' });
      }
    }

    const manifest: ExportManifest = {
      exportVersion: 1,
      patientId,
      clinicId,
      generatedAt: new Date().toISOString(),
      includedFiles,
      missingFiles,
      skippedFiles,
    };

    archive.append(Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'), {
      name: 'manifest.json',
    });

    await archive.finalize();
    await writeFinished;

    const storageKey = buildExportStorageKey(clinicId, exportId);
    await saveFileFromPath(storageKey, tempFilePath, 'application/zip');
    // saveFileFromPath always removes tempFilePath itself (success or
    // failure, local or S3 mode) — null it out so the outer catch below
    // never attempts a redundant unlink of a path that no longer exists.
    tempFilePath = null;

    const now = new Date();
    const expiresAt = new Date(now.getTime() + EXPORT_PACKAGE_TTL_MS);
    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = hashExportToken(token);

    try {
      await prisma.patientPrivacyExportArchive.update({
        where: { id: exportId },
        data: {
          status: 'ready',
          storageKey,
          manifestJson: manifest as any,
          tokenHash,
          expiresAt,
        },
      });
    } catch (dbErr) {
      // The physical file was already written to storage — never leave an
      // orphaned file behind if the DB update fails.
      await deleteFile(storageKey).catch(() => {});
      throw dbErr;
    }

    return { exportId, downloadToken: token, expiresAt, manifest };
  } catch (err) {
    // Best-effort cleanup of the temp file (if we didn't get as far as
    // saveFileFromPath) and mark the row failed so it doesn't count as an
    // in-flight lock.
    if (tempFilePath) {
      await fs.promises.unlink(tempFilePath).catch(() => {});
    }
    await prisma.patientPrivacyExportArchive
      .update({ where: { id: exportId }, data: { status: 'failed' } })
      .catch(() => {});
    throw err;
  }
}

export type ExportDownloadValidationFailure =
  | 'missing'
  | 'not_found'
  | 'wrong_scope'
  | 'expired'
  | 'not_ready'
  | 'already_downloaded';

export interface ExportDownloadValidationResult {
  ok: boolean;
  failure?: ExportDownloadValidationFailure;
  archive?: { id: string; storageKey: string };
}

/**
 * Server-side validation of a client-supplied download token before
 * streaming an export package. Never trusts clinic/org/patient data supplied
 * by the client beyond the route path — resolves purely from the token hash,
 * then cross-checks clinic/org/patient scope. Does NOT consume the token —
 * see claimExportDownload for the atomic one-time consumption step.
 */
export async function validateExportDownloadToken(
  params: { clinicId: string; organizationId: string; patientId: string; exportId: string; token: string },
  client: Pick<PrismaClient, 'patientPrivacyExportArchive'> = prisma,
): Promise<ExportDownloadValidationResult> {
  const { clinicId, organizationId, patientId, exportId, token } = params;
  if (!token || typeof token !== 'string') return { ok: false, failure: 'missing' };

  const archiveRow = await client.patientPrivacyExportArchive.findUnique({
    where: { tokenHash: hashExportToken(token) },
    select: {
      id: true,
      clinicId: true,
      organizationId: true,
      patientId: true,
      storageKey: true,
      expiresAt: true,
      status: true,
      downloadedAt: true,
    },
  });

  if (!archiveRow || archiveRow.id !== exportId) return { ok: false, failure: 'not_found' };
  if (
    archiveRow.clinicId !== clinicId ||
    archiveRow.organizationId !== organizationId ||
    archiveRow.patientId !== patientId
  ) {
    return { ok: false, failure: 'wrong_scope' };
  }
  if (archiveRow.status !== 'ready' || !archiveRow.storageKey) return { ok: false, failure: 'not_ready' };
  if (!archiveRow.expiresAt || archiveRow.expiresAt.getTime() <= Date.now()) return { ok: false, failure: 'expired' };
  if (archiveRow.downloadedAt) return { ok: false, failure: 'already_downloaded' };

  return { ok: true, archive: { id: archiveRow.id, storageKey: archiveRow.storageKey } };
}

export type ClaimDownloadResult = { claimed: true } | { claimed: false; failure: 'already_downloaded' };

/**
 * Atomically marks an export as downloaded. Uses `updateMany` with a
 * `downloadedAt: null` guard in the WHERE clause so two concurrent requests
 * that both passed validateExportDownloadToken's read-only check cannot both
 * "win" — only one update matches a row (the other sees count === 0). Must
 * be called AFTER confirming the file stream can be opened, but BEFORE
 * piping to the response (closes the concurrent-replay window).
 */
export async function claimExportDownload(exportId: string): Promise<ClaimDownloadResult> {
  const result = await prisma.patientPrivacyExportArchive.updateMany({
    where: { id: exportId, downloadedAt: null },
    data: { downloadedAt: new Date() },
  });
  if (result.count === 0) {
    return { claimed: false, failure: 'already_downloaded' };
  }
  return { claimed: true };
}

/**
 * Deletes expired PatientPrivacyExportArchive rows AND their physical ZIP
 * files, regardless of downloadedAt (short-lived by design — the AuditLog
 * download event, not this row, is the durable record). Also sweeps rows
 * stuck in "generating"/"queued" past the staleness window (abandoned
 * generation attempts) so they never block future exports for the clinic.
 * Dependency-injected for unit testing, mirroring cleanupExpiredNoticeEvidence
 * / dataRetentionCleanupJob's test style.
 */
export async function cleanupExpiredExportArchives(
  now: Date = new Date(),
  deps: {
    findExpired?: (now: Date) => Promise<{ id: string; storageKey: string | null }[]>;
    deleteRow?: (id: string) => Promise<void>;
    deleteStoredFile?: (key: string) => Promise<void>;
  } = {},
): Promise<number> {
  const findExpired =
    deps.findExpired ??
    (async (n: Date) => {
      const staleBefore = new Date(n.getTime() - EXPORT_GENERATION_STALE_MS);
      return prisma.patientPrivacyExportArchive.findMany({
        where: {
          OR: [
            { expiresAt: { lt: n } },
            { status: { in: ['queued', 'generating'] }, createdAt: { lt: staleBefore } },
          ],
        },
        select: { id: true, storageKey: true },
      });
    });
  const deleteRow =
    deps.deleteRow ?? (async (id: string) => { await prisma.patientPrivacyExportArchive.delete({ where: { id } }); });
  const deleteStoredFile = deps.deleteStoredFile ?? deleteFile;

  const expired = await findExpired(now);
  let count = 0;
  for (const row of expired) {
    try {
      if (row.storageKey) {
        await deleteStoredFile(row.storageKey);
      }
      await deleteRow(row.id);
      count++;
    } catch (err) {
      const { errorName, errorCode } = safeErrorFields(err);
      console.error('[export-package-cleanup] failed to clean up archive', {
        exportId: row.id,
        errorName,
        errorCode,
      });
    }
  }
  return count;
}

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
 */

import crypto from 'node:crypto';
import archiver from 'archiver';
import { PassThrough } from 'node:stream';
import type { PrismaClient } from '@prisma/client';
import prisma from '../../db.js';
import {
  buildExportStorageKey,
  openFileStream,
  saveFile,
  deleteFile,
} from '../fileStorage.js';

export const EXPORT_PACKAGE_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface ManifestFileEntry {
  attachmentId: string;
  /** Safe label — never the raw original filename with potential PII beyond what's already in the DB record itself; kept as the stored fileName (non-identifying, server-generated). */
  label: string;
  sha256: string;
  sizeBytes: number;
}

export interface ManifestMissingEntry {
  attachmentId: string;
  reason: string;
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

function sha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** SHA-256 hex digest of a raw export download token. */
export function hashExportToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

/**
 * Builds a ZIP package (in memory) containing:
 *  - data.json: the structured JSON export (patient/appointments/etc)
 *  - manifest.json: the manifest described above
 *  - attachments/<fileName>: each PatientAttachment's physical bytes (best-effort;
 *    missing/unreadable files are recorded in manifest.missingFiles, never abort the export)
 *
 * Never includes physical imaging files in this PR — imaging is
 * conservative-retain (see docs/compliance/53); only imaging metadata already
 * present in structuredData is included via data.json.
 */
export async function createExportPackage(
  args: CreateExportPackageArgs,
): Promise<CreateExportPackageResult> {
  const { clinicId, organizationId, patientId, requestedByUserId, structuredData } = args;

  const attachments = await prisma.patientAttachment.findMany({
    where: { clinicId, patientId },
    select: { id: true, fileName: true, originalName: true, filePath: true, legalHold: true },
    orderBy: { createdAt: 'asc' },
  });

  const includedFiles: ManifestFileEntry[] = [];
  const missingFiles: ManifestMissingEntry[] = [];
  const skippedFiles: ManifestMissingEntry[] = [];

  const archive = archiver('zip', { zlib: { level: 9 } });
  const chunks: Buffer[] = [];
  const collector = new PassThrough();
  collector.on('data', (chunk: Buffer) => chunks.push(chunk));
  archive.on('error', (err: Error) => {
    throw err;
  });
  archive.pipe(collector);

  archive.append(Buffer.from(JSON.stringify(structuredData, null, 2), 'utf8'), {
    name: 'data.json',
  });

  for (const attachment of attachments) {
    try {
      const stream = await openFileStream(attachment.filePath);
      if (!stream) {
        missingFiles.push({ attachmentId: attachment.id, reason: 'file_not_found_in_storage' });
        continue;
      }
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
    } catch (err) {
      missingFiles.push({
        attachmentId: attachment.id,
        reason: `read_failed: ${err instanceof Error ? err.message : String(err)}`,
      });
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
  await new Promise<void>((resolve, reject) => {
    collector.on('end', resolve);
    collector.on('error', reject);
  });
  const zipBuffer = Buffer.concat(chunks);

  const exportId = crypto.randomUUID();
  const storageKey = buildExportStorageKey(clinicId, exportId);
  await saveFile(storageKey, zipBuffer, 'application/zip');

  const now = new Date();
  const expiresAt = new Date(now.getTime() + EXPORT_PACKAGE_TTL_MS);
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashExportToken(token);

  await prisma.patientPrivacyExportArchive.create({
    data: {
      id: exportId,
      organizationId,
      clinicId,
      patientId,
      requestedByUserId,
      storageKey,
      manifestJson: manifest as any,
      tokenHash,
      expiresAt,
    },
  });

  return { exportId, downloadToken: token, expiresAt, manifest };
}

export type ExportDownloadValidationFailure =
  | 'missing'
  | 'not_found'
  | 'wrong_scope'
  | 'expired';

export interface ExportDownloadValidationResult {
  ok: boolean;
  failure?: ExportDownloadValidationFailure;
  archive?: { id: string; storageKey: string };
}

/**
 * Server-side validation of a client-supplied download token before
 * streaming an export package. Never trusts clinic/org/patient data supplied
 * by the client beyond the route path — resolves purely from the token hash,
 * then cross-checks clinic/org/patient scope.
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
  if (archiveRow.expiresAt.getTime() <= Date.now()) return { ok: false, failure: 'expired' };

  return { ok: true, archive: { id: archiveRow.id, storageKey: archiveRow.storageKey } };
}

export async function markExportDownloaded(exportId: string): Promise<void> {
  await prisma.patientPrivacyExportArchive.update({
    where: { id: exportId },
    data: { downloadedAt: new Date() },
  });
}

/**
 * Deletes expired PatientPrivacyExportArchive rows AND their physical ZIP
 * files, regardless of downloadedAt (short-lived by design — the AuditLog
 * download event, not this row, is the durable record). Dependency-injected
 * for unit testing, mirroring cleanupExpiredNoticeEvidence /
 * dataRetentionCleanupJob's test style.
 */
export async function cleanupExpiredExportArchives(
  now: Date = new Date(),
  deps: {
    findExpired?: (now: Date) => Promise<{ id: string; storageKey: string }[]>;
    deleteRow?: (id: string) => Promise<void>;
    deleteStoredFile?: (key: string) => Promise<void>;
  } = {},
): Promise<number> {
  const findExpired =
    deps.findExpired ??
    (async (n: Date) =>
      prisma.patientPrivacyExportArchive.findMany({
        where: { expiresAt: { lt: n } },
        select: { id: true, storageKey: true },
      }));
  const deleteRow =
    deps.deleteRow ?? (async (id: string) => { await prisma.patientPrivacyExportArchive.delete({ where: { id } }); });
  const deleteStoredFile = deps.deleteStoredFile ?? deleteFile;

  const expired = await findExpired(now);
  let count = 0;
  for (const row of expired) {
    try {
      await deleteStoredFile(row.storageKey);
      await deleteRow(row.id);
      count++;
    } catch (err) {
      console.error('[export-package-cleanup] failed to clean up archive', row.id, err);
    }
  }
  return count;
}

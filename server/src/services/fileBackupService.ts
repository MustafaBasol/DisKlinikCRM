/**
 * fileBackupService.ts — off-host backup/replication for filesystem-backed
 * clinical artifacts (FILE-BACKUP-COVERAGE-001).
 *
 * docs/program/evidence/FILE_BACKUP_COVERAGE_001.md is the full evidence
 * record: storage inventory, coverage matrix, scope decision relative to the
 * KVKK architecture freeze boundary, and honest status. Summary of what this
 * module does and does NOT do:
 *
 *   - READS existing PatientAttachment/LabOrderAttachment/ImagingImage rows
 *     and their physical files (via fileStorage.ts, so it works transparently
 *     whether primary storage is local disk or S3).
 *   - COPIES each file's bytes to a separate backup destination
 *     (fileBackupDestination.ts), verifies the copy by re-reading it and
 *     comparing a fresh sha256 against the source's sha256, and records the
 *     outcome in FileBackupRun/FileBackupEntry.
 *   - NEVER modifies, renames, or deletes anything in primary storage.
 *   - NEVER changes a PatientAttachment/LabOrderAttachment/ImagingImage/
 *     ImagingStudy row.
 *   - NEVER migrates primary storage to a different backend — that is a
 *     separately-frozen, separately-authorized decision (KVKK architecture
 *     freeze boundary, row 16 "Storage and attachment lifecycle": storage-key
 *     migration remains frozen; this feature does not touch it).
 *   - Restore only ever writes to an operator-supplied, non-primary output
 *     directory — it never writes back into primary storage automatically.
 *
 * Fail-closed by design: FILE_BACKUP_ENABLED defaults to false (mirrors
 * CLINIC_BULK_EXPORT_ENABLED's existing convention in this codebase), and a
 * run refuses to start at all if no destination is configured, rather than
 * silently completing with zero real off-host copies made.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { Transform, Readable } from 'stream';
import { pipeline } from 'stream/promises';
import prisma from '../db.js';
import { openFileStream } from './fileStorage.js';
import { safeErrorFields } from '../utils/safeError.js';
import {
  isFileBackupDestinationConfigured,
  getFileBackupDestinationKind,
  isFileBackupDestinationOffHost,
  buildBackupDestinationKey,
  writeToBackupDestination,
  openBackupDestinationStream,
  writeBackupManifest,
} from './fileBackupDestination.js';

// Mirrors fileStorage.ts's own BASE_UPLOAD_DIR constant (not exported from
// there — see this module's header comment on why fileStorage.ts is
// intentionally left untouched). Used only as a restore-output safety guard
// (isSafeRestoreOutputDir), never to read/write primary storage directly.
const PRIMARY_UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');

export function isFileBackupEnabled(): boolean {
  return process.env.FILE_BACKUP_ENABLED === 'true';
}

function getBatchSize(): number {
  const raw = Number(process.env.FILE_BACKUP_BATCH_SIZE);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 100;
}

function getRestoreRehearsalSampleSize(): number {
  const raw = Number(process.env.FILE_BACKUP_RESTORE_REHEARSAL_SAMPLE_SIZE);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 5;
}

type SourceModelName = 'PatientAttachment' | 'LabOrderAttachment' | 'ImagingImage';
type SourceDomain = 'attachments' | 'lab-attachments' | 'imaging';

const SOURCE_MODELS: Array<{ name: SourceModelName; prismaKey: 'patientAttachment' | 'labOrderAttachment' | 'imagingImage'; domain: SourceDomain }> = [
  { name: 'PatientAttachment', prismaKey: 'patientAttachment', domain: 'attachments' },
  { name: 'LabOrderAttachment', prismaKey: 'labOrderAttachment', domain: 'lab-attachments' },
  { name: 'ImagingImage', prismaKey: 'imagingImage', domain: 'imaging' },
];

interface SourceRow {
  id: string;
  clinicId: string;
  filePath: string;
  fileSize: number;
}

/** Paginated, read-only enumeration of one source model's rows. Never mutates anything. */
async function* iterateSourceRows(prismaKey: (typeof SOURCE_MODELS)[number]['prismaKey'], batchSize: number): AsyncGenerator<SourceRow> {
  let cursor: string | undefined;
  for (;;) {
    const rows: SourceRow[] = await (prisma as any)[prismaKey].findMany({
      take: batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: { id: true, clinicId: true, filePath: true, fileSize: true },
    });
    if (rows.length === 0) return;
    for (const row of rows) yield row;
    cursor = rows[rows.length - 1]!.id;
    if (rows.length < batchSize) return;
  }
}

async function hashReadable(stream: Readable): Promise<{ sha256: string; bytes: number }> {
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  for await (const chunk of stream) {
    const buf = chunk as Buffer;
    hash.update(buf);
    bytes += buf.length;
  }
  return { sha256: hash.digest('hex'), bytes };
}

let backupRunning = false;
export function isFileBackupRunning(): boolean {
  return backupRunning;
}

export interface FileBackupRunSummary {
  runId: string;
  status: 'completed' | 'failed';
  filesScanned: number;
  filesCopied: number;
  filesVerified: number;
  filesSkipped: number;
  filesFailed: number;
  filesMissing: number;
  bytesCopied: string; // stringified BigInt for JSON-safety
}

/**
 * Runs one full backup pass over PatientAttachment/LabOrderAttachment/
 * ImagingImage. Sequential (one file at a time), not parallel — current
 * production data volume is small (~3.1 MB observed, see the evidence doc's
 * storage inventory) and a sequential pass keeps this first implementation
 * simple and easy to reason about. Bounded concurrency is a documented
 * future hardening item, not required for a first pilot clinic's scale.
 */
export async function runFileBackup(options: { trigger?: 'scheduled' | 'manual' } = {}): Promise<FileBackupRunSummary> {
  if (!isFileBackupEnabled()) {
    throw new Error('File backup is disabled (FILE_BACKUP_ENABLED=false)');
  }
  if (!isFileBackupDestinationConfigured()) {
    throw new Error('No file backup destination configured (set FILE_BACKUP_S3_BUCKET or FILE_BACKUP_LOCAL_DIR)');
  }
  if (backupRunning) {
    throw new Error('A file backup run is already in progress on this process');
  }
  backupRunning = true;

  const run = await prisma.fileBackupRun.create({ data: { trigger: options.trigger ?? 'scheduled', status: 'running' } });

  let filesScanned = 0;
  let filesCopied = 0;
  let filesVerified = 0;
  let filesSkipped = 0;
  let filesFailed = 0;
  let filesMissing = 0;
  let bytesCopied = 0n;
  const errorCodes: string[] = [];

  try {
    for (const cfg of SOURCE_MODELS) {
      for await (const row of iterateSourceRows(cfg.prismaKey, getBatchSize())) {
        filesScanned++;
        try {
          // Immutable-by-design source data (no update endpoint exists for
          // any of these three models — see docs/compliance/53): once a
          // record has one successful verified/copied entry, it can never
          // legitimately change, so later runs skip it without re-reading
          // the file. This keeps the ledger's size proportional to unique
          // files, not files × runs.
          const existing = await prisma.fileBackupEntry.findFirst({
            where: { sourceModel: cfg.name, sourceRecordId: row.id, status: { in: ['copied', 'verified'] } },
            select: { id: true },
          });
          if (existing) {
            filesSkipped++;
            continue;
          }

          const sourceStream = await openFileStream(row.filePath);
          if (!sourceStream) {
            filesMissing++;
            await prisma.fileBackupEntry.create({
              data: {
                runId: run.id,
                sourceModel: cfg.name,
                sourceRecordId: row.id,
                clinicId: row.clinicId,
                sourceKey: row.filePath,
                destinationKey: '',
                status: 'missing_source',
              },
            });
            continue;
          }

          const destinationKey = buildBackupDestinationKey(cfg.domain, row.clinicId, row.id);
          const written = await writeToBackupDestination(destinationKey, sourceStream);
          filesCopied++;
          bytesCopied += BigInt(written.bytes);

          // Verification pass: re-read what was actually persisted at the
          // destination (not the in-memory value from the write above) and
          // compare checksums — this is what catches corruption introduced
          // by the write/storage layer itself, not just a source-read error.
          const destStream = await openBackupDestinationStream(destinationKey);
          const destHash = destStream ? await hashReadable(destStream) : null;
          const verified = destHash !== null && destHash.sha256 === written.sha256;
          if (verified) filesVerified++;
          else filesFailed++;

          await prisma.fileBackupEntry.create({
            data: {
              runId: run.id,
              sourceModel: cfg.name,
              sourceRecordId: row.id,
              clinicId: row.clinicId,
              sourceKey: row.filePath,
              destinationKey,
              sourceChecksumSha256: written.sha256,
              destinationChecksumSha256: destHash?.sha256 ?? null,
              sourceSizeBytes: written.bytes,
              status: verified ? 'verified' : 'failed',
              errorMessage: verified ? null : 'checksum_mismatch_after_copy',
              copiedAt: new Date(),
              verifiedAt: verified ? new Date() : null,
            },
          });
        } catch (err) {
          filesFailed++;
          const { errorCode } = safeErrorFields(err);
          errorCodes.push(`${cfg.name}:${errorCode}`);
          await prisma.fileBackupEntry
            .create({
              data: {
                runId: run.id,
                sourceModel: cfg.name,
                sourceRecordId: row.id,
                clinicId: row.clinicId,
                sourceKey: row.filePath,
                destinationKey: '',
                status: 'failed',
                errorMessage: errorCode,
              },
            })
            .catch(() => {});
        }
      }
    }

    const manifestKey = `file-backups/manifests/${run.id}.json`;
    const manifestWritten = await writeBackupManifest(manifestKey, {
      runId: run.id,
      generatedAt: new Date().toISOString(),
      destinationKind: getFileBackupDestinationKind(),
      filesScanned,
      filesCopied,
      filesVerified,
      filesSkipped,
      filesFailed,
      filesMissing,
    });

    const status: 'completed' | 'failed' = filesFailed > 0 ? 'failed' : 'completed';
    await prisma.fileBackupRun.update({
      where: { id: run.id },
      data: {
        status,
        finishedAt: new Date(),
        filesScanned,
        filesCopied,
        filesVerified,
        filesSkipped,
        filesFailed,
        filesMissing,
        bytesCopied,
        errorSummary: errorCodes.length > 0 ? errorCodes.slice(0, 20).join('; ') : null,
        manifestKey: manifestWritten ? manifestKey : null,
      },
    });

    return {
      runId: run.id,
      status,
      filesScanned,
      filesCopied,
      filesVerified,
      filesSkipped,
      filesFailed,
      filesMissing,
      bytesCopied: bytesCopied.toString(),
    };
  } catch (err) {
    const { errorCode } = safeErrorFields(err);
    await prisma.fileBackupRun
      .update({ where: { id: run.id }, data: { status: 'failed', finishedAt: new Date(), errorSummary: errorCode } })
      .catch(() => {});
    throw err;
  } finally {
    backupRunning = false;
  }
}

// ─── Status / monitoring ────────────────────────────────────────────────────

export async function getFileBackupStatus() {
  const [lastRun, totalEntries, verifiedCount, failedCount, missingCount] = await Promise.all([
    prisma.fileBackupRun.findFirst({ orderBy: { startedAt: 'desc' } }),
    prisma.fileBackupEntry.count(),
    prisma.fileBackupEntry.count({ where: { status: 'verified' } }),
    prisma.fileBackupEntry.count({ where: { status: 'failed' } }),
    prisma.fileBackupEntry.count({ where: { status: 'missing_source' } }),
  ]);

  return {
    enabled: isFileBackupEnabled(),
    destinationConfigured: isFileBackupDestinationConfigured(),
    destinationKind: getFileBackupDestinationKind(),
    destinationOffHost: isFileBackupDestinationOffHost(),
    currentlyRunning: backupRunning,
    lastRun: lastRun
      ? {
          id: lastRun.id,
          startedAt: lastRun.startedAt,
          finishedAt: lastRun.finishedAt,
          status: lastRun.status,
          trigger: lastRun.trigger,
          filesScanned: lastRun.filesScanned,
          filesCopied: lastRun.filesCopied,
          filesVerified: lastRun.filesVerified,
          filesSkipped: lastRun.filesSkipped,
          filesFailed: lastRun.filesFailed,
          filesMissing: lastRun.filesMissing,
          bytesCopied: lastRun.bytesCopied.toString(),
        }
      : null,
    totals: {
      entries: totalEntries,
      verified: verifiedCount,
      failed: failedCount,
      missingSource: missingCount,
    },
  };
}

// ─── Restore ─────────────────────────────────────────────────────────────────

/**
 * Refuses any output directory that resolves inside (or equal to) primary
 * storage's upload root. This is the hard safety line the task brief
 * requires: restore must never silently write back into production/primary
 * storage — that stays a separate, explicit, operator-controlled action.
 */
function isSafeRestoreOutputDir(outputDir: string): boolean {
  const resolved = path.resolve(outputDir);
  const relative = path.relative(PRIMARY_UPLOAD_DIR, resolved);
  const insidePrimaryUploadDir = relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  return !insidePrimaryUploadDir;
}

export interface RestoreResult {
  success: boolean;
  outputPath?: string;
  checksumMatch?: boolean;
  error?: string;
}

/**
 * Restores the latest verified backup of one source record to an
 * operator-supplied output directory. Never writes to primary storage. Does
 * NOT touch the source PatientAttachment/LabOrderAttachment/ImagingImage row
 * or its filePath in any way — this is a read-from-backup, write-to-a-new-
 * inspection-location operation only.
 */
export async function restoreFileToPath(params: {
  sourceModel: SourceModelName;
  sourceRecordId: string;
  outputDir: string;
}): Promise<RestoreResult> {
  if (!isSafeRestoreOutputDir(params.outputDir)) {
    return { success: false, error: 'Refusing to restore into primary storage upload directory' };
  }

  const entry = await prisma.fileBackupEntry.findFirst({
    where: { sourceModel: params.sourceModel, sourceRecordId: params.sourceRecordId, status: 'verified' },
    orderBy: { createdAt: 'desc' },
  });
  if (!entry) {
    return { success: false, error: 'No verified backup entry found for this record' };
  }

  const stream = await openBackupDestinationStream(entry.destinationKey);
  if (!stream) {
    return { success: false, error: 'Backup object not found at destination' };
  }

  await fs.promises.mkdir(params.outputDir, { recursive: true });
  const outputPath = path.join(params.outputDir, `${params.sourceModel}-${params.sourceRecordId}.bin`);
  const hash = crypto.createHash('sha256');
  const hashing = new Transform({
    transform(chunk: Buffer, _enc, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });

  try {
    await pipeline(stream, hashing, fs.createWriteStream(outputPath, { mode: 0o600 }));
  } catch (err) {
    const { errorCode } = safeErrorFields(err);
    return { success: false, error: `Restore write failed: ${errorCode}` };
  }

  const checksumMatch = hash.digest('hex') === entry.destinationChecksumSha256;
  return { success: true, outputPath, checksumMatch };
}

export interface RestoreRehearsalResult {
  success: boolean;
  sampleSize: number;
  passed: number;
  failed: number;
  results: Array<{ sourceModel: string; sourceRecordId: string; checksumMatch: boolean }>;
  error?: string;
}

let restoreRehearsalRunning = false;
export function isFileBackupRestoreRehearsalRunning(): boolean {
  return restoreRehearsalRunning;
}

/**
 * Automated restore-rehearsal: picks a bounded sample of the most recently
 * verified backup entries, restores each into a disposable OS-temp
 * directory, checks the restored bytes' checksum, then deletes the temp
 * directory in `finally` regardless of outcome. This is the file-backup
 * equivalent of backupService.ts's runRestoreTest() for the database — it
 * gives durable, re-runnable evidence that "restore actually works," not
 * just that "a backup copy exists somewhere."
 */
export async function runFileBackupRestoreRehearsal(sampleSize: number = getRestoreRehearsalSampleSize()): Promise<RestoreRehearsalResult> {
  if (restoreRehearsalRunning) {
    throw new Error('A restore rehearsal is already running');
  }
  restoreRehearsalRunning = true;

  try {
    const entries = await prisma.fileBackupEntry.findMany({
      where: { status: 'verified' },
      orderBy: { createdAt: 'desc' },
      take: sampleSize,
      select: { sourceModel: true, sourceRecordId: true },
    });
    if (entries.length === 0) {
      return { success: false, sampleSize: 0, passed: 0, failed: 0, results: [], error: 'No verified backup entries available to rehearse' };
    }

    const rehearsalDir = path.join(os.tmpdir(), `diskliniks-file-backup-rehearsal-${crypto.randomUUID()}`);
    await fs.promises.mkdir(rehearsalDir, { recursive: true, mode: 0o700 });

    let passed = 0;
    let failed = 0;
    const results: RestoreRehearsalResult['results'] = [];
    try {
      for (const entry of entries) {
        const restore = await restoreFileToPath({
          sourceModel: entry.sourceModel as SourceModelName,
          sourceRecordId: entry.sourceRecordId,
          outputDir: rehearsalDir,
        });
        const ok = restore.success && restore.checksumMatch === true;
        if (ok) passed++;
        else failed++;
        results.push({ sourceModel: entry.sourceModel, sourceRecordId: entry.sourceRecordId, checksumMatch: Boolean(restore.checksumMatch) });
      }
    } finally {
      await fs.promises.rm(rehearsalDir, { recursive: true, force: true }).catch(() => {});
    }

    return { success: failed === 0, sampleSize: entries.length, passed, failed, results };
  } finally {
    restoreRehearsalRunning = false;
  }
}

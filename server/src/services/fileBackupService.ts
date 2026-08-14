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
import { withJobLock } from '../utils/jobLock.js';
import { listImagesForBackup } from './imaging/ops.js';
import {
  isFileBackupDestinationConfigured,
  getFileBackupDestinationKind,
  isFileBackupDestinationOffHost,
  buildBackupDestinationKey,
  writeToBackupDestination,
  openBackupDestinationStream,
  writeBackupManifest,
  validateFileBackupS3Config,
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

// Cross-process guard: every caller of runFileBackup() (the scheduled cron
// tick in fileBackupJob.ts, the manual POST /file-backups/run route, and any
// future caller) funnels through this SAME withJobLock name/TTL, so a manual
// trigger on one replica can never run concurrently with the scheduled job
// (or another manual trigger) on a different replica. Fixed here, not in
// each call site, so no caller can forget it. TTL must comfortably exceed
// the slowest expected full sweep — see jobLock.ts's own doc comment on why
// a too-short TTL lets a second replica start while the first is still mid-run.
export const FILE_BACKUP_JOB_LOCK_NAME = 'file-backup';
export const FILE_BACKUP_JOB_LOCK_TTL_MS = 60 * 60 * 1000; // 1 hour

type SourceModelName = 'PatientAttachment' | 'LabOrderAttachment' | 'ImagingImage';
type SourceDomain = 'attachments' | 'lab-attachments' | 'imaging';

interface SourceRow {
  id: string;
  clinicId: string;
  filePath: string;
  fileSize: number;
}

/**
 * Paginated, read-only enumeration of one PatientAttachment/LabOrderAttachment
 * row set. Never mutates anything. Not used for ImagingImage — see
 * iterateImagingRowsForBackup below, which reads Imaging rows through
 * imaging/ops.ts's narrow, Imaging-owned platform contract instead of a
 * direct Prisma model access (F2-STAGE3-GAPD-001; F2-STAGE3-EXIT-DECIDE-001
 * accepted architecture decision).
 */
async function* iterateGenericSourceRows(prismaKey: 'patientAttachment' | 'labOrderAttachment', batchSize: number): AsyncGenerator<SourceRow> {
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

/**
 * Same enumeration contract as iterateGenericSourceRows (paginated,
 * read-only, stable id-ascending order, identical termination rule), but
 * sourced from imaging/ops.ts's listImagesForBackup instead of a direct,
 * generic Prisma bracket-access to the Imaging model. This is the platform
 * backup sweep's intentionally global (cross-tenant, no clinicId)
 * enumeration — see ops.ts's header for why that scope is correct here.
 */
async function* iterateImagingRowsForBackup(batchSize: number): AsyncGenerator<SourceRow> {
  let cursor: string | undefined;
  for (;;) {
    const { rows, nextCursor } = await listImagesForBackup({ cursor, limit: batchSize });
    if (rows.length === 0) return;
    for (const row of rows) {
      yield { id: row.id, clinicId: row.clinicId, filePath: row.storageKeyOrFilePath, fileSize: row.fileSize };
    }
    if (!nextCursor) return;
    cursor = nextCursor;
  }
}

const SOURCE_MODELS: Array<{ name: SourceModelName; domain: SourceDomain; rows: (batchSize: number) => AsyncGenerator<SourceRow> }> = [
  { name: 'PatientAttachment', domain: 'attachments', rows: (batchSize) => iterateGenericSourceRows('patientAttachment', batchSize) },
  { name: 'LabOrderAttachment', domain: 'lab-attachments', rows: (batchSize) => iterateGenericSourceRows('labOrderAttachment', batchSize) },
  { name: 'ImagingImage', domain: 'imaging', rows: iterateImagingRowsForBackup },
];

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
  // Fail-closed S3 production-safety pre-flight (endpoint TLS + required SSE
  // mode) — checked here, before a FileBackupRun row is even created, not
  // discovered mid-run on the first S3 write. No-op for local-mode
  // destinations. See fileBackupDestination.ts's validateFileBackupS3Config
  // doc comment for the exact rules.
  validateFileBackupS3Config();
  if (backupRunning) {
    throw new Error('A file backup run is already in progress on this process');
  }
  backupRunning = true;

  try {
    let summary: FileBackupRunSummary | undefined;
    const acquired = await withJobLock(FILE_BACKUP_JOB_LOCK_NAME, FILE_BACKUP_JOB_LOCK_TTL_MS, async () => {
      summary = await runFileBackupLocked(options);
    });
    if (!acquired) {
      throw new Error('A file backup run is already in progress on another process/replica');
    }
    return summary!;
  } finally {
    backupRunning = false;
  }
}

async function runFileBackupLocked(options: { trigger?: 'scheduled' | 'manual' }): Promise<FileBackupRunSummary> {
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
      for await (const row of cfg.rows(getBatchSize())) {
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
  }
}

// ─── Stale run reaper ───────────────────────────────────────────────────────

/** Default cutoff: a FileBackupRun still `running` after 3 hours is abandoned. */
export const DEFAULT_FILE_BACKUP_MAX_RUNNING_MINUTES = 180;

/**
 * Sweeps crashed FileBackupRun rows to a terminal state and returns how many
 * it swept.
 *
 * Without this, a process that dies mid-sweep leaves its run row `running`
 * with `finishedAt: null` FOREVER: getFileBackupStatus()'s `lastRun` then
 * reports a backup that looks perpetually in flight, and any "when did a
 * backup last complete" question silently reads the wrong row. The in-process
 * `backupRunning` flag and the JobLock lease both clear themselves on crash —
 * the ledger row is the one piece of state that does not.
 *
 * `errorSummary` is set to the fixed label `run_abandoned`, never a raw error
 * message (there is no error object here to begin with — the process simply
 * vanished).
 *
 * Never throws: it runs at the top of a job tick and must not stop the real
 * work behind it.
 */
export async function reapStaleFileBackupRuns(
  maxRunningMinutes: number = DEFAULT_FILE_BACKUP_MAX_RUNNING_MINUTES,
): Promise<number> {
  const minutes =
    Number.isFinite(maxRunningMinutes) && maxRunningMinutes > 0 ? maxRunningMinutes : DEFAULT_FILE_BACKUP_MAX_RUNNING_MINUTES;
  const cutoff = new Date(Date.now() - minutes * 60_000);

  try {
    const result = await prisma.fileBackupRun.updateMany({
      where: { status: 'running', startedAt: { lt: cutoff } },
      data: { status: 'failed', finishedAt: new Date(), errorSummary: 'run_abandoned' },
    });
    if (result.count > 0) {
      console.warn(`[file-backup] Reaped ${result.count} abandoned backup run(s) older than ${minutes} minutes.`);
    }
    return result.count;
  } catch (err) {
    console.error('[file-backup] Failed to reap abandoned backup runs:', safeErrorFields(err));
    return 0;
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

function isInsidePrimaryUploadDir(resolved: string): boolean {
  const relative = path.relative(PRIMARY_UPLOAD_DIR, resolved);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Resolves symlinks for whatever prefix of `p` already exists on disk,
 * leaving any not-yet-created suffix untouched (mkdir hasn't run yet at the
 * time this is first called). A plain `path.resolve`/`path.relative` check
 * only compares path STRINGS — it never follows a symlink, so an output
 * directory that is itself a symlink pointing at (or inside) primary
 * storage's uploads/ tree would satisfy the string check while actually
 * writing through to primary storage. Walking up to the nearest existing
 * ancestor and realpath-ing that ancestor closes that gap.
 */
function resolveRealExistingPrefix(p: string): string {
  const suffix: string[] = [];
  let current = p;
  for (;;) {
    try {
      const real = fs.realpathSync(current);
      return suffix.length > 0 ? path.join(real, ...suffix.reverse()) : real;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return p; // reached filesystem root, nothing on this path exists
      suffix.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Refuses any output directory that resolves inside (or equal to) primary
 * storage's upload root. This is the hard safety line the task brief
 * requires: restore must never silently write back into production/primary
 * storage — that stays a separate, explicit, operator-controlled action.
 *
 * Symlink-aware: resolves the existing portion of `outputDir` to its real
 * path before comparing, so a pre-existing symlink pointing at (or inside)
 * the primary uploads/ tree cannot be used to bypass this check.
 */
function isSafeRestoreOutputDir(outputDir: string): boolean {
  const resolved = resolveRealExistingPrefix(path.resolve(outputDir));
  return !isInsidePrimaryUploadDir(resolved);
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

  // Re-check post-mkdir against the fully-resolved real path: outputDir is
  // now guaranteed to exist, so this is the authoritative check (closes a
  // narrow TOCTOU window where outputDir could be replaced by a symlink
  // between the pre-check above and this point).
  const realOutputDir = await fs.promises.realpath(params.outputDir);
  if (isInsidePrimaryUploadDir(path.resolve(realOutputDir))) {
    return { success: false, error: 'Refusing to restore into primary storage upload directory' };
  }

  const outputPath = path.join(realOutputDir, `${params.sourceModel}-${params.sourceRecordId}.bin`);
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
  /** Measured wall-clock cost of the whole rehearsal — the file-side RTO evidence. */
  durationMs: number;
  /** Which sampling strategy actually ran ('newest' | 'oldest' | 'mixed'). */
  strategy: string;
  /** createdAt of the OLDEST entry actually exercised, ISO string, or null. */
  oldestSampledAt: string | null;
  /** createdAt of the NEWEST entry actually exercised, ISO string, or null. */
  newestSampledAt: string | null;
  error?: string;
}

/**
 * How the rehearsal picks which verified entries to exercise.
 *
 *   - 'newest' — most recently created entries first. This was the original
 *     (and only) behavior.
 *   - 'oldest' — least recently created entries first. This is the one that
 *     can detect destination-side bit rot / silent object loss in OLD backup
 *     objects. A newest-only sample structurally cannot: the newest objects
 *     were written minutes-to-days ago and have had no time to rot, so a
 *     newest-only rehearsal can pass indefinitely while every object older
 *     than the sampling window is quietly unrecoverable.
 *   - 'mixed' (default) — half newest, half oldest, deduplicated by entry id.
 *     Keeps the "did last night's backup actually restore" signal while also
 *     continuously re-proving the long tail.
 */
export type RestoreRehearsalStrategy = 'newest' | 'oldest' | 'mixed';

export interface RestoreRehearsalOptions {
  sampleSize?: number;
  strategy?: RestoreRehearsalStrategy;
  /**
   * Restore EXACTLY these entry ids instead of re-running the sampling query.
   *
   * F4-FCR-001-R1 (M1b): a caller that vets a sample before restoring (the
   * rehearsal job's synthetic-clinic gate) must restore the rows it vetted,
   * not whatever a second identical query happens to return. Two reads of a
   * live ledger are not one snapshot, so passing the ids closes the window
   * between "this sample is safe" and "these bytes were restored".
   *
   * Ids are still re-checked against `status: 'verified'`, so a stale id can
   * only ever shrink the sample, never widen it. An empty/omitted list falls
   * back to the ordinary sampling query.
   */
  entryIds?: string[];
}

/**
 * One verified entry chosen for a rehearsal. `clinicId` is included so a
 * caller can enforce a pre-flight safety policy (e.g. the restore-rehearsal
 * job's synthetic-clinic-only guard) BEFORE any real patient bytes are
 * written to a scratch directory. It must never be logged.
 */
export interface RestoreRehearsalSampleEntry {
  id: string;
  sourceModel: string;
  sourceRecordId: string;
  clinicId: string;
  createdAt: Date;
  copiedAt: Date | null;
}

let restoreRehearsalRunning = false;
export function isFileBackupRestoreRehearsalRunning(): boolean {
  return restoreRehearsalRunning;
}

/** Normalizes the backward-compatible `number | options | undefined` argument. */
function normalizeRehearsalOptions(
  input?: number | RestoreRehearsalOptions,
): { sampleSize: number; strategy: RestoreRehearsalStrategy; entryIds: string[] } {
  const options: RestoreRehearsalOptions = typeof input === 'number' ? { sampleSize: input } : (input ?? {});
  const rawSize = options.sampleSize;
  const sampleSize = typeof rawSize === 'number' && Number.isFinite(rawSize) && rawSize > 0 ? Math.floor(rawSize) : getRestoreRehearsalSampleSize();
  const entryIds = Array.isArray(options.entryIds)
    ? Array.from(new Set(options.entryIds.filter((id): id is string => typeof id === 'string' && id.length > 0)))
    : [];
  return { sampleSize, strategy: options.strategy ?? 'mixed', entryIds };
}

/**
 * Chooses the verified entries a rehearsal would exercise, without touching
 * the filesystem or restoring anything. Exported so a caller can run a
 * pre-flight policy check (see restoreRehearsalJob.ts's synthetic-clinic
 * guard) against exactly the same selection the rehearsal will use.
 *
 * F4-FCR-001-R1 (M1b) — TWO properties make the pre-flight gate meaningful:
 *
 *   1. TOTAL ORDER. `createdAt` alone is NOT a total order: a single backup
 *      sweep writes many entries inside the same millisecond, so two
 *      `ORDER BY createdAt` reads may legitimately return different rows for
 *      the same LIMIT. `{ id: 'asc' }` is therefore appended everywhere as a
 *      tiebreaker, making the selection deterministic and repeatable.
 *   2. PASS-THROUGH. Even a deterministic query is a second read of live
 *      state. A caller that vets a sample should hand the vetted ids back via
 *      `entryIds` so the rehearsal exercises exactly those rows.
 *
 * Without both, a gate can pass on sample A while sample B — possibly holding
 * a real-tenant entry — is what actually gets restored.
 */
export async function selectRestoreRehearsalSample(input?: number | RestoreRehearsalOptions): Promise<RestoreRehearsalSampleEntry[]> {
  const { sampleSize, strategy, entryIds } = normalizeRehearsalOptions(input);
  const select = { id: true, sourceModel: true, sourceRecordId: true, clinicId: true, createdAt: true, copiedAt: true } as const;

  // Explicit id list: restore exactly what the caller vetted, in the order it
  // vetted them. Still constrained to `verified`, so an id that changed state
  // since the caller looked drops out instead of being restored anyway.
  if (entryIds.length > 0) {
    const rows = await prisma.fileBackupEntry.findMany({ where: { id: { in: entryIds }, status: 'verified' }, select });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return entryIds
      .map((id) => byId.get(id))
      .filter((row): row is RestoreRehearsalSampleEntry => row !== undefined);
  }

  if (strategy === 'newest' || strategy === 'oldest') {
    return prisma.fileBackupEntry.findMany({
      where: { status: 'verified' },
      orderBy: [{ createdAt: strategy === 'newest' ? 'desc' : 'asc' }, { id: 'asc' }],
      take: sampleSize,
      select,
    });
  }

  // 'mixed': ceil(N/2) from each end, then dedupe by id (the two halves
  // overlap whenever the ledger holds fewer than N verified entries) and cap
  // the result back at N.
  const half = Math.max(1, Math.ceil(sampleSize / 2));
  const [newest, oldest] = await Promise.all([
    prisma.fileBackupEntry.findMany({ where: { status: 'verified' }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: half, select }),
    prisma.fileBackupEntry.findMany({ where: { status: 'verified' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: half, select }),
  ]);

  const seen = new Set<string>();
  const merged: RestoreRehearsalSampleEntry[] = [];
  for (const entry of [...newest, ...oldest]) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    merged.push(entry);
    if (merged.length >= sampleSize) break;
  }
  return merged;
}

/**
 * Newest `copiedAt` across all verified backup entries — i.e. the freshness of
 * the most recent off-host artifact a file restore could fall back on. This is
 * the RPO input a recovery drill records as `sourceArtifactAt`.
 */
export async function getLatestVerifiedBackupArtifactAt(): Promise<Date | null> {
  const newest = await prisma.fileBackupEntry.findFirst({
    where: { status: 'verified', copiedAt: { not: null } },
    orderBy: { copiedAt: 'desc' },
    select: { copiedAt: true },
  });
  return newest?.copiedAt ?? null;
}

/**
 * Automated restore-rehearsal: picks a bounded sample of verified backup
 * entries (see RestoreRehearsalStrategy for how), restores each into a
 * disposable OS-temp directory, checks the restored bytes' checksum, then
 * deletes the temp directory in `finally` regardless of outcome. This is the
 * file-backup equivalent of backupService.ts's runRestoreTest() for the
 * database — it gives durable, re-runnable evidence that "restore actually
 * works," not just that "a backup copy exists somewhere."
 *
 * Accepts either a bare sample-size number (the original signature, still used
 * by the operator CLI) or an options object. Prefer the options object with
 * `entryIds` when the caller has already vetted a sample — see
 * selectRestoreRehearsalSample.
 *
 * NOTE: this function has no tenant-safety policy of its own. The
 * synthetic-clinic gate, the cluster lock and the drill-ledger row all live in
 * `jobs/restoreRehearsalJob.ts#runRestoreRehearsalTick`, which is the ONLY
 * entry point production callers (scheduled job and platform-admin route)
 * should use. Calling this directly skips all three.
 */
export async function runFileBackupRestoreRehearsal(input?: number | RestoreRehearsalOptions): Promise<RestoreRehearsalResult> {
  if (restoreRehearsalRunning) {
    throw new Error('A restore rehearsal is already running');
  }
  restoreRehearsalRunning = true;
  const startedAtMs = Date.now();

  try {
    const { sampleSize, strategy, entryIds } = normalizeRehearsalOptions(input);
    const entries = await selectRestoreRehearsalSample({ sampleSize, strategy, entryIds });
    if (entries.length === 0) {
      return {
        success: false,
        sampleSize: 0,
        passed: 0,
        failed: 0,
        results: [],
        durationMs: Date.now() - startedAtMs,
        strategy,
        oldestSampledAt: null,
        newestSampledAt: null,
        error: 'No verified backup entries available to rehearse',
      };
    }

    const sampledTimes = entries.map((entry) => entry.createdAt.getTime());
    const oldestSampledAt = new Date(Math.min(...sampledTimes)).toISOString();
    const newestSampledAt = new Date(Math.max(...sampledTimes)).toISOString();

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

    return {
      success: failed === 0,
      sampleSize: entries.length,
      passed,
      failed,
      results,
      durationMs: Date.now() - startedAtMs,
      strategy,
      oldestSampledAt,
      newestSampledAt,
    };
  } finally {
    restoreRehearsalRunning = false;
  }
}

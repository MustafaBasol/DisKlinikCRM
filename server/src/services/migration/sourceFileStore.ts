/**
 * sourceFileStore.ts — F3-DATA-MIG-TODAY-001
 *
 * Run-scoped, private on-disk storage for an uploaded migration source
 * workbook. A clinic's export is the densest concentration of patient PII the
 * product ever handles in one artifact, so the storage rules below are
 * security requirements, not conveniences:
 *
 *  1. NOT PUBLIC. The root is `server/.tmp/migration-source` — never under
 *     `uploads/`, never mounted by a static handler, never reachable over
 *     HTTP by any route. Nothing in this module returns a URL.
 *  2. TRAVERSAL-PROOF BY CONSTRUCTION, not by escaping. The only caller-
 *     supplied component of the path is `runId`, which must match the UUID
 *     shape WE generate; the filename is the FIXED literal `source.bin`. There
 *     is therefore no string in the path that an attacker can influence beyond
 *     36 hex-and-dash characters, and `..`, `/`, `\`, NUL and drive letters
 *     are all rejected by the same single regex. The uploader's filename is
 *     never involved in any way — it exists only as a DISPLAY label
 *     (`sanitizeDisplayFilename`).
 *  3. RE-VERIFIED ON EVERY TOUCH. Read/delete re-resolve the path and assert
 *     containment inside the root before the filesystem is touched, so a
 *     stored path that was tampered with in the database still cannot escape.
 *  4. RETAINED, THEN DESTROYED. `cleanupExpiredSourceFiles` implements the
 *     retention window from the contracts (`SOURCE_FILE_RETENTION_MS`).
 *
 * PRIVACY CONTRACT: no path derived from user input and no file content is
 * ever logged here. Error details carry codes and byte counts only.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { MigrationError } from './contracts.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The ONLY accepted run-id shape. This is the whole traversal defence: the run
 * id is a UUID this system generates, so anything that is not one is a bug or
 * an attack, and both must fail closed.
 */
const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Fixed stored filename. The uploader's filename never reaches the disk. */
const SOURCE_FILE_NAME = 'source.bin';

/** Owner-only directory / file modes — no group or other access, ever. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

/**
 * Resolved on every call rather than cached at module load, so a process that
 * changes its working directory (and every test that uses a temp cwd) observes
 * the correct root instead of one frozen at import time.
 */
export function getMigrationSourceRoot(): string {
  return path.resolve(process.cwd(), '.tmp', 'migration-source');
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

function assertRunId(runId: string): string {
  if (typeof runId !== 'string' || !RUN_ID_PATTERN.test(runId)) {
    // INTERNAL_ERROR, not a 4xx: every caller obtains this id from the run
    // record we created. A non-UUID here means our own code passed the wrong
    // value, which is a defect that must be loud — and it must never be
    // reported back with the offending value.
    throw new MigrationError('INTERNAL_ERROR', {
      message: 'Invalid migration run identifier.',
      detail: 'RUN_ID_SHAPE_INVALID',
    });
  }
  return runId.toLowerCase();
}

/**
 * Re-derive the absolute path and prove it is exactly
 * `<root>/<uuid>/source.bin`. Containment is asserted with `path.relative`
 * (not with `startsWith` on the raw string, which is defeated by a sibling
 * directory whose name merely has the root as a prefix), and the two path
 * segments are then re-validated individually so a symlinked or crafted
 * `storedPath` cannot select any other file even inside the root.
 */
function resolveStoredPath(storedPath: string): string {
  if (typeof storedPath !== 'string' || storedPath.length === 0) {
    throw new MigrationError('INTERNAL_ERROR', {
      message: 'Invalid stored file path.',
      detail: 'STORED_PATH_EMPTY',
    });
  }

  const root = getMigrationSourceRoot();
  const resolved = path.resolve(storedPath);
  const relative = path.relative(root, resolved);

  if (
    relative === '' ||
    relative.startsWith('..') ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new MigrationError('INTERNAL_ERROR', {
      message: 'Invalid stored file path.',
      detail: 'STORED_PATH_OUTSIDE_ROOT',
    });
  }

  const segments = relative.split(path.sep);
  if (segments.length !== 2 || !RUN_ID_PATTERN.test(segments[0]!) || segments[1] !== SOURCE_FILE_NAME) {
    throw new MigrationError('INTERNAL_ERROR', {
      message: 'Invalid stored file path.',
      detail: 'STORED_PATH_SHAPE_INVALID',
    });
  }

  return resolved;
}

function isEnoent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Persist the uploaded buffer for one run.
 *
 * Written through a `.partial` sibling and promoted with `fs.rename`, matching
 * the convention in `services/fileStorage.ts` (`saveFileFromPath`): the rename
 * is atomic within a directory, so a concurrent reader of the final path can
 * never observe a truncated workbook, and a crash mid-write leaves only a
 * `.partial` file that the retention sweep removes with the rest of the run
 * directory.
 */
export async function storeSourceFile(
  runId: string,
  buffer: Buffer,
): Promise<{ storedPath: string; sha256: string; sizeBytes: number }> {
  const safeRunId = assertRunId(runId);

  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new MigrationError('FILE_MISSING', {
      message: 'No file content was received.',
      detail: 'UPLOAD_EMPTY',
    });
  }

  const runDir = path.join(getMigrationSourceRoot(), safeRunId);
  const storedPath = path.join(runDir, SOURCE_FILE_NAME);
  const partialPath = path.join(runDir, `${SOURCE_FILE_NAME}.partial-${crypto.randomUUID()}`);

  // `recursive` also creates the root. The mode applies to directories this
  // call creates; an existing directory keeps its mode, which is why the root
  // is created here rather than assumed.
  await fs.promises.mkdir(runDir, { recursive: true, mode: DIR_MODE });

  try {
    // `wx` (exclusive create) plus a random suffix: two concurrent writers for
    // the same run can never share a partial file.
    await fs.promises.writeFile(partialPath, buffer, { mode: FILE_MODE, flag: 'wx' });
    // Re-assert the mode: `writeFile`'s mode is masked by the process umask.
    await fs.promises.chmod(partialPath, FILE_MODE).catch(() => {});
    await fs.promises.rename(partialPath, storedPath);
  } catch (error) {
    await fs.promises.unlink(partialPath).catch(() => {});
    throw new MigrationError('INTERNAL_ERROR', {
      message: 'The source file could not be stored.',
      // The underlying errno message can contain the absolute path; only the
      // syscall error CODE is kept.
      detail: `SOURCE_WRITE_FAILED code=${(error as NodeJS.ErrnoException)?.code ?? 'UNKNOWN'}`,
    });
  }

  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  return { storedPath, sha256, sizeBytes: buffer.length };
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function readSourceFile(storedPath: string): Promise<Buffer> {
  const resolved = resolveStoredPath(storedPath);

  try {
    return await fs.promises.readFile(resolved);
  } catch (error) {
    if (isEnoent(error)) {
      // Expected after the retention sweep: the run outlives its source file.
      throw new MigrationError('FILE_MISSING', {
        message: 'The stored source file is no longer available.',
        detail: 'SOURCE_FILE_NOT_FOUND',
      });
    }
    throw new MigrationError('INTERNAL_ERROR', {
      message: 'The source file could not be read.',
      detail: `SOURCE_READ_FAILED code=${(error as NodeJS.ErrnoException)?.code ?? 'UNKNOWN'}`,
    });
  }
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/** Returns true when a file was removed, false when there was nothing to remove. */
export async function deleteSourceFile(storedPath: string): Promise<boolean> {
  const resolved = resolveStoredPath(storedPath);

  try {
    await fs.promises.unlink(resolved);
  } catch (error) {
    if (isEnoent(error)) return false;
    throw new MigrationError('INTERNAL_ERROR', {
      message: 'The source file could not be deleted.',
      detail: `SOURCE_DELETE_FAILED code=${(error as NodeJS.ErrnoException)?.code ?? 'UNKNOWN'}`,
    });
  }

  // Remove the now-empty run directory so deleted runs do not accumulate
  // directory entries until the retention sweep runs. `rmdir` fails harmlessly
  // (ENOTEMPTY) if a `.partial` file from a crashed write is still there.
  await fs.promises.rmdir(path.dirname(resolved)).catch(() => {});
  return true;
}

// ---------------------------------------------------------------------------
// Retention sweep
// ---------------------------------------------------------------------------

/**
 * Delete run directories whose mtime is older than the cutoff. Called with
 * `SOURCE_FILE_RETENTION_MS` from a scheduled job — this is the mechanism that
 * makes the "we do not keep your export" statement true.
 *
 * Only entries whose name is a UUID are considered, so an unrelated file that
 * somehow ended up under the root is left alone rather than deleted by a
 * sweep that is not supposed to own it.
 */
export async function cleanupExpiredSourceFiles(
  olderThanMs: number,
): Promise<{ deletedRuns: number }> {
  if (!Number.isFinite(olderThanMs) || olderThanMs < 0) {
    throw new MigrationError('INTERNAL_ERROR', {
      message: 'Invalid retention window.',
      detail: 'RETENTION_WINDOW_INVALID',
    });
  }

  const root = getMigrationSourceRoot();
  const cutoff = Date.now() - olderThanMs;

  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch (error) {
    // A root that was never created is the normal state before the first
    // upload — only ENOENT is swallowed.
    if (isEnoent(error)) return { deletedRuns: 0 };
    throw error;
  }

  let deletedRuns = 0;

  for (const entry of entries) {
    if (!entry.isDirectory() || !RUN_ID_PATTERN.test(entry.name)) continue;
    const runDir = path.join(root, entry.name);

    try {
      const stats = await fs.promises.stat(runDir);
      if (stats.mtimeMs >= cutoff) continue;
      await fs.promises.rm(runDir, { recursive: true, force: true });
      deletedRuns += 1;
    } catch (error) {
      // Another sweep (or a delete) removed it between readdir and here.
      if (isEnoent(error)) continue;
      throw error;
    }
  }

  return { deletedRuns };
}

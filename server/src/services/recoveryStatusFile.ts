import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import prisma from '../db.js';
import { getFileBackupStatus } from './fileBackupService.js';
import { safeErrorFields } from '../utils/safeError.js';

/**
 * F4-FCR-001 — the bridge between the application's recovery ledger (in
 * PostgreSQL) and `scripts/noramedi-opscheck.sh`'s `filebackup` and `drill`
 * checks (a root systemd oneshot with no database access).
 *
 * WHY A FILE AND NOT A QUERY OR AN ENDPOINT:
 *   - opscheck is a dead-man's-switch that must keep working when the
 *     application is down. Giving it a psql dependency and a copy of
 *     DATABASE_URL would couple the monitor to the thing it monitors and
 *     would put database credentials in a second place on disk.
 *   - The alternative — an unauthenticated HTTP status endpoint — would
 *     expose backup posture to anyone who can reach the port. The existing
 *     backup routes are deliberately platform-admin-only.
 *
 * A file also gives the monitor a free liveness signal: `generatedAt` going
 * stale means the writer stopped, which opscheck treats as a failure rather
 * than as "healthy, nothing to report".
 *
 * OUTPUT CONTRACT — do not change without changing the consumer in lockstep.
 * `scripts/noramedi-opscheck.sh` parses this without `jq`, using scoped
 * regex extraction, so the shape is deliberately rigid:
 *   - `schemaVersion` MUST appear exactly once in the whole document.
 *   - `fileBackup` and `drill` MUST be flat objects. A nested object inside
 *     either one makes the consumer fail closed.
 *   - Every timestamp MUST be ISO-8601 ending in `Z` (Date#toISOString).
 * `server/src/tests/recoveryStatusFileContract.test.ts` pins this by running
 * the real writer's output through the real shell consumer.
 *
 * PRIVACY: this file carries no clinic id, no patient identifier, no file
 * name, no storage key, no path, and no credential — only counts, states,
 * and timestamps. It is safe for a root-readable operational directory.
 */

export const RECOVERY_STATUS_SCHEMA_VERSION = 1;

/** Mirrors the opscheck default so the two sides agree with no configuration. */
export const DEFAULT_RECOVERY_STATUS_FILE = '/var/lib/noramedi/recovery-status.json';

export function resolveRecoveryStatusFilePath(): string {
  const configured = process.env.NORAMEDI_RECOVERY_STATUS_FILE?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_RECOVERY_STATUS_FILE;
}

export interface RecoveryStatusDocument {
  schemaVersion: number;
  generatedAt: string;
  fileBackup: {
    enabled: boolean;
    /**
     * Whether the configured destination is in a DIFFERENT failure domain.
     * Carried into the status file so the host monitor can alarm on a
     * same-disk "backup" — without it, a local-directory destination on the
     * single-disk production VPS completes cleanly, reports
     * `status: "completed"`, and the dead-man's switch says healthy while the
     * only copy of every patient file shares a disk with the primary.
     */
    destinationOffHost: boolean;
    status?: string;
    lastRunAt?: string;
    filesFailed?: number;
    filesMissing?: number;
  };
  drill: {
    status?: string;
    kind?: string;
    lastRunAt?: string;
  };
}

/**
 * Structural inputs for {@link mapRecoveryStatusDocument}.
 *
 * Declared structurally rather than importing the service return types so the
 * mapper stays a pure function with no database dependency — that is what lets
 * `recoveryStatusFileContract.test.ts` drive real documents through the real
 * shell consumer without provisioning PostgreSQL.
 */
export interface RecoveryStatusFileBackupInput {
  enabled: boolean;
  destinationOffHost: boolean;
  /**
   * The most recent run that reached a TERMINAL state (`completed`/`failed`) —
   * NOT simply the most recent run.
   *
   * This distinction is load-bearing. The host monitor treats any status other
   * than `completed` as a failure and pings the dead-man's switch's `/fail`
   * endpoint, which emails the operator immediately. If the latest run were
   * reported verbatim, every nightly sweep that happened to be in flight when
   * the status file was refreshed would report `status: "running"` and page
   * the operator — training them to ignore the exact alarm this task exists to
   * add. Reporting the last terminal run instead means an in-flight sweep is
   * simply invisible to the monitor, while a sweep that HANGS still alarms,
   * because the last terminal run keeps aging.
   */
  lastTerminalRun: {
    status: string;
    startedAt: Date | string;
    finishedAt: Date | string | null;
    filesFailed: number;
    filesMissing: number;
  } | null;
}

export interface RecoveryStatusDrillInput {
  /** Last rehearsal in a terminal state (`passed`/`failed`) — see above. */
  lastTerminalRehearsal: {
    status: string;
    kind: string;
    startedAt: Date | string;
  } | null;
}

/**
 * Pure mapper from ledger state to the on-disk document.
 *
 * Absent history is represented by OMITTING `lastRunAt`, never by inventing a
 * placeholder timestamp: "a file backup has never run" and "a restore drill
 * has never run" are exactly the conditions a first customer needs alerted,
 * and the consumer treats a missing `lastRunAt` as a failure.
 */
export function mapRecoveryStatusDocument(
  fileBackup: RecoveryStatusFileBackupInput,
  drills: RecoveryStatusDrillInput,
  now: Date = new Date(),
): RecoveryStatusDocument {
  const lastRun = fileBackup.lastTerminalRun;
  // A terminal run always has finishedAt; startedAt is only a defensive
  // fallback for a row written before this field existed.
  const lastRunAt = lastRun ? (lastRun.finishedAt ?? lastRun.startedAt) : null;

  const rehearsal = drills.lastTerminalRehearsal;

  return {
    schemaVersion: RECOVERY_STATUS_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    fileBackup: {
      enabled: fileBackup.enabled,
      destinationOffHost: fileBackup.destinationOffHost,
      ...(lastRun ? { status: lastRun.status } : {}),
      ...(lastRunAt ? { lastRunAt: new Date(lastRunAt).toISOString() } : {}),
      ...(lastRun ? { filesFailed: lastRun.filesFailed, filesMissing: lastRun.filesMissing } : {}),
    },
    drill: {
      ...(rehearsal ? { status: rehearsal.status, kind: rehearsal.kind } : {}),
      ...(rehearsal ? { lastRunAt: new Date(rehearsal.startedAt).toISOString() } : {}),
    },
  };
}

/** Exact bytes the writer publishes — shared with the contract test. */
export function serializeRecoveryStatusDocument(doc: RecoveryStatusDocument): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/** Terminal states — the only ones the host monitor should ever judge. */
const TERMINAL_FILE_BACKUP_STATUSES = ['completed', 'failed'];
const TERMINAL_DRILL_STATUSES = ['passed', 'failed'];

/** Builds the document from live ledger state. */
export async function buildRecoveryStatusDocument(): Promise<RecoveryStatusDocument> {
  // `getFileBackupStatus()` is used only for configuration (enabled /
  // destination), never for the run outcome: its `lastRun` is the newest row
  // regardless of state, which is exactly what must NOT be reported here.
  const [config, lastTerminalRun, lastTerminalRehearsal] = await Promise.all([
    getFileBackupStatus(),
    prisma.fileBackupRun.findFirst({
      where: { status: { in: TERMINAL_FILE_BACKUP_STATUSES } },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      select: { status: true, startedAt: true, finishedAt: true, filesFailed: true, filesMissing: true },
    }),
    prisma.recoveryDrillRun.findFirst({
      where: { kind: 'file_restore_rehearsal', status: { in: TERMINAL_DRILL_STATUSES } },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      select: { status: true, kind: true, startedAt: true },
    }),
  ]);

  return mapRecoveryStatusDocument(
    {
      enabled: config.enabled,
      destinationOffHost: config.destinationOffHost,
      lastTerminalRun,
    },
    { lastTerminalRehearsal },
  );
}

/**
 * Writes the status file atomically. Returns false (never throws) when the
 * file could not be written, so a status-file problem can never take down the
 * job tick that calls it.
 *
 * The parent directory is NOT created. Provisioning `/var/lib/noramedi` is an
 * install-time operator step (it is root-owned and outside the application's
 * deployment tree); silently creating it here would let a typo'd path produce
 * a status file that opscheck never reads, which fails OPEN — the monitor
 * would see a missing file and alert, but the operator would be chasing the
 * wrong directory. A single warning is emitted instead.
 */
export async function writeRecoveryStatusFile(): Promise<boolean> {
  const target = resolveRecoveryStatusFilePath();
  const dir = path.dirname(target);

  try {
    await fs.access(dir);
  } catch {
    console.warn(
      `[recovery-status] Status directory does not exist; skipping write. Create it during installation (see docs/program/runbooks/F4_RECOVERY_OPERATIONS.md).`,
    );
    return false;
  }

  let doc: RecoveryStatusDocument;
  try {
    doc = await buildRecoveryStatusDocument();
  } catch (err) {
    console.error('[recovery-status] Failed to build status document:', safeErrorFields(err));
    return false;
  }

  // Atomic publish: a monitor reading mid-write must never see a truncated
  // document. A partial read would fail the JSON shape check and alert, which
  // is a false positive on an otherwise healthy system.
  const tmp = path.join(dir, `.recovery-status.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(tmp, serializeRecoveryStatusDocument(doc), { mode: 0o600, flag: 'wx' });
    await fs.rename(tmp, target);
    return true;
  } catch (err) {
    console.error('[recovery-status] Failed to write status file:', safeErrorFields(err));
    try {
      await fs.unlink(tmp);
    } catch {
      // best effort — the temp name is unique, so a leftover cannot collide
    }
    return false;
  }
}

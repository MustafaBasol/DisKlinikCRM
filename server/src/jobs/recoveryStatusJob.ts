import fs from 'node:fs/promises';
import path from 'node:path';
import cron from 'node-cron';

import {
  resolveRecoveryStatusFilePath,
  writeRecoveryStatusFile,
} from '../services/recoveryStatusFile.js';
import { safeErrorFields } from '../utils/safeError.js';

/**
 * F4-FCR-001 — refreshes the operational recovery status file that
 * `scripts/noramedi-opscheck.sh` reads for its `filebackup` and `drill`
 * checks.
 *
 * This runs on its own short cadence rather than piggy-backing on the file
 * backup job for two reasons:
 *
 *   1. The most important condition it reports is `fileBackup.enabled: false`
 *      — file backup switched off entirely. If the writer only ran from
 *      inside the file backup job, that condition could never be reported,
 *      because the job that would report it is the one that is not running.
 *
 *   2. `generatedAt` doubles as a writer-liveness signal. opscheck fails the
 *      check when `generatedAt` goes stale, which catches a dead worker even
 *      while the last recorded backup still looks fresh. That signal is only
 *      meaningful if the refresh cadence is much shorter than the staleness
 *      threshold.
 *
 * No job lock is taken. The write is atomic (temp file + rename) and
 * idempotent, so two processes racing produce the same document and the
 * loser's temp file is discarded — a lock would add a database round trip to
 * protect against a harmless outcome.
 */

const DEFAULT_RECOVERY_STATUS_CRON = '*/10 * * * *';

export function startRecoveryStatusJob(): void {
  const schedule = process.env.RECOVERY_STATUS_CRON?.trim() || DEFAULT_RECOVERY_STATUS_CRON;
  const target = resolveRecoveryStatusFilePath();
  const dir = path.dirname(target);

  // Fail closed and LOUD rather than silently writing nowhere. If the
  // directory is absent the job does not schedule at all; opscheck then sees
  // a missing status file and alerts, and this startup line explains why.
  // Provisioning the directory is a documented install step.
  void fs
    .access(dir)
    .then(() => {
      if (!cron.validate(schedule)) {
        console.error(
          `[recovery-status] Invalid RECOVERY_STATUS_CRON; job not scheduled. Falling back is deliberately NOT done — an unnoticed wrong cadence would weaken the writer-liveness signal.`,
        );
        return;
      }

      cron.schedule(schedule, () => {
        void writeRecoveryStatusFile().catch((err) => {
          console.error('[recovery-status] Refresh tick failed:', safeErrorFields(err));
        });
      });

      // Write once at startup so a freshly deployed worker does not leave the
      // monitor looking at a stale document for a whole cron interval.
      void writeRecoveryStatusFile().catch((err) => {
        console.error('[recovery-status] Initial write failed:', safeErrorFields(err));
      });

      console.log(`[recovery-status] Job scheduled (${schedule}).`);
    })
    .catch(() => {
      console.error(
        `[recovery-status] Status directory is missing; job NOT scheduled. Create it during installation (see docs/program/runbooks/F4_RECOVERY_OPERATIONS.md). opscheck will alert on the absent status file until this is done.`,
      );
    });
}

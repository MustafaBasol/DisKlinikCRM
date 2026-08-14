/**
 * restoreRehearsalJob.ts — scheduled file restore rehearsal + recovery drill
 * evidence recording (F4-FCR-001).
 *
 * Modelled on fileBackupJob.ts. Same discipline, same reasons:
 *
 *   - RESTORE_REHEARSAL_ENABLED defaults to false (fail-closed): the job is
 *     not even scheduled unless explicitly turned on, mirroring
 *     FILE_BACKUP_ENABLED / CLINIC_BULK_EXPORT_ENABLED.
 *   - Cluster-wide singleton execution IS the intent. Unlike fileBackupJob.ts
 *     — whose cross-process guard lives inside runFileBackup() itself — the
 *     rehearsal's shared runner is this tick (it also reaps stale rows and
 *     writes the drill ledger), so withJobLock is applied HERE, once, around
 *     the whole tick. Do not add a second lock inside the service.
 *   - The rehearsal restores real patient bytes into a disposable os.tmpdir()
 *     directory, so nothing this file logs may carry a clinic id, a patient
 *     identifier, a file name, a storage key, or an output path. Only run
 *     ids, counts, durations and safeErrorFields(err) are ever printed.
 *
 * SAFETY GATE (RESTORE_REHEARSAL_REQUIRE_SYNTHETIC): when set to 'true', the
 * tick refuses to rehearse unless EVERY sampled entry belongs to a clinic
 * listed in RESTORE_REHEARSAL_SYNTHETIC_CLINIC_IDS. That lets an operator run
 * this continuously against seeded synthetic tenants without ever restoring a
 * real patient's bytes. It defaults to false, which preserves exactly today's
 * behavior for anyone already relying on the manual rehearsal path.
 */

import cron from 'node-cron';
import {
  isFileBackupEnabled,
  reapStaleFileBackupRuns,
  runFileBackupRestoreRehearsal,
  selectRestoreRehearsalSample,
  getLatestVerifiedBackupArtifactAt,
  type RestoreRehearsalStrategy,
} from '../services/fileBackupService.js';
import { isFileBackupDestinationConfigured } from '../services/fileBackupDestination.js';
import { startRecoveryDrill, finishRecoveryDrill, reapStaleRecoveryDrills } from '../services/recoveryDrillService.js';
import { withJobLock } from '../utils/jobLock.js';
import { safeErrorFields } from '../utils/safeError.js';

export const RESTORE_REHEARSAL_JOB_LOCK_NAME = 'restore-rehearsal';
export const RESTORE_REHEARSAL_JOB_LOCK_TTL_MS = 60 * 60 * 1000; // 1 hour

export function isRestoreRehearsalEnabled(): boolean {
  return process.env.RESTORE_REHEARSAL_ENABLED === 'true';
}

function getCronSchedule(): string {
  // Weekly, Sunday 04:30 local — deliberately after the 03:00 file backup, so
  // the rehearsal exercises artifacts the same night's backup just produced.
  return process.env.RESTORE_REHEARSAL_CRON?.trim() || '30 4 * * 0';
}

function getStrategy(): RestoreRehearsalStrategy {
  const raw = process.env.RESTORE_REHEARSAL_STRATEGY?.trim();
  return raw === 'newest' || raw === 'oldest' || raw === 'mixed' ? raw : 'mixed';
}

function requiresSyntheticClinics(): boolean {
  return process.env.RESTORE_REHEARSAL_REQUIRE_SYNTHETIC === 'true';
}

function getSyntheticClinicIds(): Set<string> {
  const raw = process.env.RESTORE_REHEARSAL_SYNTHETIC_CLINIC_IDS ?? '';
  return new Set(
    raw
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  );
}

/**
 * Pre-flight tenant gate. Returns the number of sampled entries that are NOT
 * in the synthetic allowlist — deliberately a COUNT, never the offending
 * clinic ids, because this number goes straight into a log line.
 */
export function countNonSyntheticSamples(sampleClinicIds: string[], allowedClinicIds: Set<string>): number {
  return sampleClinicIds.filter((clinicId) => !allowedClinicIds.has(clinicId)).length;
}

/**
 * One rehearsal tick, lock-guarded so a manual trigger on one replica can
 * never run concurrently with the scheduled job on another.
 *
 * Order matters: both reapers run FIRST, so a row abandoned by a previous
 * crashed tick is already in a terminal state before this tick opens its own
 * drill row (otherwise `runningDrills` would keep climbing and the status
 * endpoint would report phantom in-flight drills forever).
 */
export async function runRestoreRehearsalTick(
  options: { trigger?: 'scheduled' | 'manual' } = {},
): Promise<{ ran: boolean; drillId: string | null }> {
  let outcome: { ran: boolean; drillId: string | null } = { ran: false, drillId: null };

  const acquired = await withJobLock(RESTORE_REHEARSAL_JOB_LOCK_NAME, RESTORE_REHEARSAL_JOB_LOCK_TTL_MS, async () => {
    await reapStaleFileBackupRuns();
    await reapStaleRecoveryDrills();

    const strategy = getStrategy();

    if (requiresSyntheticClinics()) {
      const allowed = getSyntheticClinicIds();
      const sample = await selectRestoreRehearsalSample({ strategy });
      const violations = countNonSyntheticSamples(
        sample.map((entry) => entry.clinicId),
        allowed,
      );
      if (violations > 0) {
        console.error(
          `[restore-rehearsal] Refusing to run: RESTORE_REHEARSAL_REQUIRE_SYNTHETIC=true and ` +
            `${violations} of ${sample.length} sampled entries are outside the synthetic clinic allowlist.`,
        );
        return;
      }
      if (sample.length === 0) {
        console.warn('[restore-rehearsal] No verified backup entries available to rehearse; skipping this tick.');
        return;
      }
    }

    const sourceArtifactAt = await getLatestVerifiedBackupArtifactAt();
    const drillId = await startRecoveryDrill({
      kind: 'file_restore_rehearsal',
      trigger: options.trigger ?? 'scheduled',
      sourceArtifactAt,
    });
    outcome = { ran: true, drillId };

    try {
      const result = await runFileBackupRestoreRehearsal({ strategy });
      await finishRecoveryDrill({
        id: drillId,
        status: result.success ? 'passed' : 'failed',
        samplesAttempted: result.sampleSize,
        samplesPassed: result.passed,
        samplesFailed: result.failed,
        // runFileBackupRestoreRehearsal removes its scratch directory in a
        // `finally` on every path, so reaching here means cleanup ran. It
        // leaves no named durable artifact behind to report.
        cleanupVerified: true,
        residualArtifact: null,
        errorCode: result.error ? 'no_verified_entries' : null,
      });
      console.log(
        `[restore-rehearsal] drill=${drillId} status=${result.success ? 'passed' : 'failed'} strategy=${result.strategy} ` +
          `attempted=${result.sampleSize} passed=${result.passed} failed=${result.failed} durationMs=${result.durationMs}`,
      );
    } catch (err) {
      const { errorCode } = safeErrorFields(err);
      await finishRecoveryDrill({ id: drillId, status: 'failed', cleanupVerified: true, errorCode });
      console.error(`[restore-rehearsal] drill=${drillId} failed:`, safeErrorFields(err));
    }
  });

  if (!acquired) {
    console.warn('[restore-rehearsal] Another process/replica holds the rehearsal lock; skipping this tick.');
  }
  return outcome;
}

export function startRestoreRehearsalJob(): void {
  if (!isRestoreRehearsalEnabled()) {
    console.log('[restore-rehearsal] Job disabled (RESTORE_REHEARSAL_ENABLED=false).');
    return;
  }
  if (!isFileBackupEnabled()) {
    console.error('[restore-rehearsal] RESTORE_REHEARSAL_ENABLED=true but FILE_BACKUP_ENABLED=false. Job will not be scheduled.');
    return;
  }
  if (!isFileBackupDestinationConfigured()) {
    console.error(
      '[restore-rehearsal] RESTORE_REHEARSAL_ENABLED=true but no backup destination is configured ' +
        '(set FILE_BACKUP_S3_BUCKET or FILE_BACKUP_LOCAL_DIR). Job will not be scheduled.',
    );
    return;
  }
  if (requiresSyntheticClinics() && getSyntheticClinicIds().size === 0) {
    console.error(
      '[restore-rehearsal] RESTORE_REHEARSAL_REQUIRE_SYNTHETIC=true but ' +
        'RESTORE_REHEARSAL_SYNTHETIC_CLINIC_IDS is empty — every tick would refuse to run. Job will not be scheduled.',
    );
    return;
  }

  const schedule = getCronSchedule();
  cron.schedule(schedule, () => {
    runRestoreRehearsalTick({ trigger: 'scheduled' }).catch((err: unknown) => {
      console.error('[restore-rehearsal] Tick skipped or failed:', safeErrorFields(err));
    });
  });

  console.log(`[restore-rehearsal] Scheduled restore rehearsal job cron="${schedule}".`);
}

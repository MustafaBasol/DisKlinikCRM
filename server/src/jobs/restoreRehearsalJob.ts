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
 * real patient's bytes. It defaults to false, so with no configuration the
 * behavior is unchanged.
 *
 * The gate applies to the MANUAL platform-admin trigger too
 * (F4-FCR-001-R1 / M1a): runRestoreRehearsalTick() is the single entry point
 * for both, so a flag whose entire purpose is "never restore real bytes here"
 * cannot be defeated by clicking a button. Scheduling remains opt-in via
 * RESTORE_REHEARSAL_ENABLED; the manual trigger does not require it, exactly
 * as before.
 */

import cron from 'node-cron';
import {
  isFileBackupEnabled,
  reapStaleFileBackupRuns,
  runFileBackupRestoreRehearsal,
  selectRestoreRehearsalSample,
  getLatestVerifiedBackupArtifactAt,
  type RestoreRehearsalResult,
  type RestoreRehearsalStrategy,
} from '../services/fileBackupService.js';
import { isFileBackupDestinationConfigured } from '../services/fileBackupDestination.js';
import {
  startRecoveryDrill,
  finishRecoveryDrill,
  reapStaleRecoveryDrills,
  DEFAULT_RECOVERY_DRILL_MAX_RUNNING_MINUTES,
} from '../services/recoveryDrillService.js';
import { withJobLock } from '../utils/jobLock.js';
import { safeErrorFields } from '../utils/safeError.js';

export const RESTORE_REHEARSAL_JOB_LOCK_NAME = 'restore-rehearsal';

/**
 * Lease TTL for the rehearsal lock. F4-FCR-001-R1 (L4): this MUST comfortably
 * exceed the drill reaper's cutoff
 * (DEFAULT_RECOVERY_DRILL_MAX_RUNNING_MINUTES, 180 min) — jobLock.ts requires
 * a TTL larger than the longest expected run, and the reaper cutoff is this
 * system's declared upper bound on "a rehearsal that is still legitimately
 * running". Inverting the two (TTL < cutoff) means a long-but-healthy
 * rehearsal loses its lease while the reaper still considers it alive, and a
 * second replica starts a concurrent tick against the same ledger. 4 hours
 * keeps a comfortable margin above the 3-hour cutoff; if either constant
 * moves, move the other so the ordering `TTL > cutoff` still holds.
 */
const DRILL_REAPER_CUTOFF_MS = DEFAULT_RECOVERY_DRILL_MAX_RUNNING_MINUTES * 60_000;
export const RESTORE_REHEARSAL_JOB_LOCK_TTL_MS = Math.max(4 * 60 * 60 * 1000, DRILL_REAPER_CUTOFF_MS + 60 * 60 * 1000);

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

/** Why a tick did not rehearse. Null when the rehearsal actually ran. */
export type RestoreRehearsalSkipReason = 'lock_held' | 'synthetic_guard' | 'no_verified_entries';

export interface RestoreRehearsalTickOutcome {
  /** True once a drill ledger row was opened and the rehearsal was attempted. */
  ran: boolean;
  drillId: string | null;
  result: RestoreRehearsalResult | null;
  skipReason: RestoreRehearsalSkipReason | null;
}

/**
 * THE ONLY production entry point for a file restore rehearsal — scheduled and
 * manual alike. F4-FCR-001-R1 (M1a): the platform-admin route used to call
 * runFileBackupRestoreRehearsal() directly, which skipped all three of the
 * protections that live here — the synthetic-clinic gate, the cluster lock,
 * and the drill-ledger row. A manual click could therefore restore real
 * patient bytes into /tmp on production while
 * RESTORE_REHEARSAL_REQUIRE_SYNTHETIC=true, and leave no evidence row behind.
 * Route every new caller through this function.
 *
 * Lock-guarded so a manual trigger on one replica can never run concurrently
 * with the scheduled job on another.
 *
 * Order matters: both reapers run FIRST, so a row abandoned by a previous
 * crashed tick is already in a terminal state before this tick opens its own
 * drill row (otherwise `runningDrills` would keep climbing and the status
 * endpoint would report phantom in-flight drills forever). The reapers also
 * run from recoveryStatusJob's unconditional tick — see the note there.
 *
 * Throws only if the rehearsal itself throws, and only AFTER the drill row has
 * been closed as failed; callers that need the error (the manual route) get
 * it, and the scheduled caller logs it.
 */
export async function runRestoreRehearsalTick(
  options: { trigger?: 'scheduled' | 'manual'; sampleSize?: number } = {},
): Promise<RestoreRehearsalTickOutcome> {
  const outcome: RestoreRehearsalTickOutcome = { ran: false, drillId: null, result: null, skipReason: null };

  const acquired = await withJobLock(RESTORE_REHEARSAL_JOB_LOCK_NAME, RESTORE_REHEARSAL_JOB_LOCK_TTL_MS, async () => {
    await reapStaleFileBackupRuns();
    await reapStaleRecoveryDrills();

    const strategy = getStrategy();
    const sampleSize = options.sampleSize;

    // Select ONCE, up front, whether or not the synthetic gate is on, and hand
    // the chosen ids to the rehearsal below (F4-FCR-001-R1 / M1b). Re-running
    // the sampling query inside the rehearsal would give the gate one row set
    // and the restore another.
    const sample = await selectRestoreRehearsalSample({ strategy, sampleSize });
    const entryIds = sample.map((entry) => entry.id);

    if (requiresSyntheticClinics()) {
      const allowed = getSyntheticClinicIds();
      const violations = countNonSyntheticSamples(
        sample.map((entry) => entry.clinicId),
        allowed,
      );
      if (violations > 0) {
        console.error(
          `[restore-rehearsal] Refusing to run: RESTORE_REHEARSAL_REQUIRE_SYNTHETIC=true and ` +
            `${violations} of ${sample.length} sampled entries are outside the synthetic clinic allowlist.`,
        );
        outcome.skipReason = 'synthetic_guard';
        return;
      }
      if (sample.length === 0) {
        console.warn('[restore-rehearsal] No verified backup entries available to rehearse; skipping this tick.');
        outcome.skipReason = 'no_verified_entries';
        return;
      }
    }

    const sourceArtifactAt = await getLatestVerifiedBackupArtifactAt();
    const drillId = await startRecoveryDrill({
      kind: 'file_restore_rehearsal',
      trigger: options.trigger ?? 'scheduled',
      sourceArtifactAt,
    });
    outcome.ran = true;
    outcome.drillId = drillId;

    try {
      const result = await runFileBackupRestoreRehearsal({ strategy, sampleSize, entryIds });
      outcome.result = result;
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
      // Rethrow only after the ledger row is terminal: the manual route needs
      // the failure to answer with a non-200, and the scheduled caller logs it.
      throw err;
    }
  });

  if (!acquired) {
    console.warn('[restore-rehearsal] Another process/replica holds the rehearsal lock; skipping this tick.');
    outcome.skipReason = 'lock_held';
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

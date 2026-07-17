/**
 * clinicBulkExportWorker.ts — KVKK-HIGH-004 async generation worker
 * (docs/compliance/54-kvkk-secure-clinic-bulk-export.md).
 *
 * Non-overlap is PROCESS-LOCAL, not a database-wide lock: a module-level
 * `isTickRunning` flag skips a tick if the previous one is still running in
 * THIS process. Using the DB-backed `withJobLock` (a constant lock name)
 * here would have been wrong — it would serialize ticks across every
 * replica, so only one replica's worker could ever run at a time, directly
 * contradicting the requirement that multiple worker replicas process
 * different clinics' jobs concurrently. `withJobLock` is reserved for
 * clinicBulkExportCleanupJob.ts, where singleton cluster-wide execution
 * actually is the intent.
 *
 * Cross-replica correctness instead comes from claimQueuedClinicBulkExportJobs()
 * in clinicBulkExportPackage.ts: a guarded per-row `updateMany` where only
 * one of N concurrent replicas polling the same row can win, so different
 * replicas claiming different rows never contend on anything.
 *
 * Each tick claims at most CLINIC_BULK_EXPORT_WORKER_CONCURRENCY rows and
 * processes them with bounded concurrency (never an unbounded Promise.all).
 *
 * Graceful shutdown retains the specific ScheduledTask handle for THIS
 * worker (not every cron task in the process, which would also stop
 * unrelated jobs like reminders/meta-sync) and stops only that one on
 * SIGTERM/SIGINT, letting any already-claimed in-flight job finish within
 * the process's normal shutdown grace period rather than being forcibly
 * abandoned — if the deadline is hit anyway, the next surviving replica's
 * lease-expiry sweep picks the row back up.
 */

import cron, { type ScheduledTask } from 'node-cron';
import {
  claimQueuedClinicBulkExportJobs,
  generateClinicBulkExport,
  sweepStaleClinicBulkExportTempFiles,
} from '../services/privacy/clinicBulkExportPackage.js';

function getWorkerConcurrency(): number {
  const raw = Number(process.env.CLINIC_BULK_EXPORT_WORKER_CONCURRENCY);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 2;
}

let isTickRunning = false;
let scheduledTask: ScheduledTask | null = null;
let shuttingDown = false;

/**
 * Process-local (this host only) sweep of orphaned bulk-export temp ZIPs —
 * see sweepStaleClinicBulkExportTempFiles's own doc comment. Deliberately
 * swallows its own errors and never throws: a sweep failure must never
 * abort claiming/generating in the same tick, and must never stop the
 * worker's own cron from being scheduled at startup.
 */
async function runStaleTempSweep(): Promise<void> {
  try {
    const deleted = await sweepStaleClinicBulkExportTempFiles();
    if (deleted > 0) {
      console.log(`[clinic-bulk-export-worker] stale-temp sweep deleted ${deleted} orphaned temp file(s) on this host.`);
    }
  } catch (err) {
    console.error('[clinic-bulk-export-worker] stale-temp sweep failed', err instanceof Error ? err.message : String(err));
  }
}

async function runTick(): Promise<void> {
  if (isTickRunning || shuttingDown) return;
  isTickRunning = true;
  try {
    // Runs every tick (not only at startup) — recovers from a crash of a
    // sibling worker instance on the same host, or of this same process
    // between ticks, without waiting on the separate DB-locked cleanup
    // cron's own 15-minute schedule (which cannot see this host's local
    // filesystem at all).
    await runStaleTempSweep();

    const concurrency = getWorkerConcurrency();
    const claimedIds = await claimQueuedClinicBulkExportJobs(concurrency);
    if (claimedIds.length === 0) return;

    // Bounded concurrency — never an unbounded Promise.all: claimedIds.length
    // is already capped at `concurrency` by claimQueuedClinicBulkExportJobs.
    await Promise.all(claimedIds.map((jobId) => generateClinicBulkExport(jobId)));
  } catch (err) {
    console.error('[clinic-bulk-export-worker] tick failed', err instanceof Error ? err.message : String(err));
  } finally {
    isTickRunning = false;
  }
}

export function startClinicBulkExportWorker(): void {
  // The worker always runs (it drains already-queued jobs even if creation
  // is later disabled) — CLINIC_BULK_EXPORT_ENABLED only gates whether new
  // jobs can be CREATED, not whether existing queued jobs get processed.
  scheduledTask = cron.schedule('*/1 * * * *', () => {
    void runTick();
  });
  console.log('[clinic-bulk-export-worker] Scheduled worker cron="*/1 * * * *".');

  // Startup sweep, independent of the first cron tick — recovers from a
  // crash that happened before this process last exited as early as
  // possible, rather than waiting up to a minute for the first tick.
  void runStaleTempSweep();

  process.once('SIGTERM', stopClinicBulkExportWorker);
  process.once('SIGINT', stopClinicBulkExportWorker);
}

/** Stops only this worker's own scheduled task — never touches other jobs' cron tasks. */
export function stopClinicBulkExportWorker(): void {
  shuttingDown = true;
  scheduledTask?.stop();
}

/** Exported for tests. */
export function isClinicBulkExportWorkerTickRunning(): boolean {
  return isTickRunning;
}

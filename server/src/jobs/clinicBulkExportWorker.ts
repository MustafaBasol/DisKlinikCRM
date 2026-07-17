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
 * SIGTERM/SIGINT. As of the final review round (P0), shutdown ALSO
 * atomically cancels every job this process is still actively generating
 * right now (`activeGenerationJobIds` + `failActiveGenerationForWorkerShutdown`)
 * rather than letting it run to completion — a PM2 rolling reload otherwise
 * leaves an old process free to finish (or even resurrect) an in-flight
 * export using its own stale, in-memory `CLINIC_BULK_EXPORT_ENABLED`
 * snapshot well after a new process has already started with the flag
 * disabled. If the process is killed before this cancellation completes
 * anyway, the next surviving replica's lease-expiry sweep picks the row
 * back up exactly as before.
 */

import cron, { type ScheduledTask } from 'node-cron';
import {
  claimQueuedClinicBulkExportJobs,
  generateClinicBulkExport,
  sweepStaleClinicBulkExportTempFiles,
  failActiveGenerationForWorkerShutdown,
} from '../services/privacy/clinicBulkExportPackage.js';

function getWorkerConcurrency(): number {
  const raw = Number(process.env.CLINIC_BULK_EXPORT_WORKER_CONCURRENCY);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 2;
}

let isTickRunning = false;
let scheduledTask: ScheduledTask | null = null;
let shuttingDown = false;
let shutdownPromise: Promise<void> | null = null;

/**
 * Job ids this PROCESS has actually claimed and is (or was, until
 * `stopClinicBulkExportWorker` cancels it) actively running
 * `generateClinicBulkExport` for. Populated synchronously the instant a
 * claim succeeds (final review round, P0) — before any further `await` —
 * so there is no window between a successful claim and this set reflecting
 * it. `stopClinicBulkExportWorker` reads this set to know which jobs to
 * atomically cancel on SIGTERM/SIGINT.
 */
const activeGenerationJobIds = new Set<string>();

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
    // Shutdown may have begun while the sweep above was in flight — never
    // start claiming new work into a worker that is already shutting down.
    if (shuttingDown) return;

    const concurrency = getWorkerConcurrency();
    const claimedIds = await claimQueuedClinicBulkExportJobs(concurrency);
    if (claimedIds.length === 0) return;

    if (shuttingDown) {
      // Shutdown began while the claim above was in flight — these rows
      // were already atomically moved to 'generating' by the guarded claim
      // itself, but generation must never actually START once shutting
      // down. Fail them the exact same stable way an already-in-flight
      // generation gets cancelled (final review round, P0) instead of
      // calling generateClinicBulkExport at all.
      await Promise.allSettled(claimedIds.map((jobId) => failActiveGenerationForWorkerShutdown(jobId)));
      return;
    }

    // Tracked synchronously, before any further `await` in this tick, so
    // stopClinicBulkExportWorker's own snapshot of activeGenerationJobIds
    // can never miss a job this tick just claimed.
    for (const jobId of claimedIds) activeGenerationJobIds.add(jobId);

    // Bounded concurrency — never an unbounded Promise.all: claimedIds.length
    // is already capped at `concurrency` by claimQueuedClinicBulkExportJobs.
    await Promise.all(
      claimedIds.map((jobId) =>
        generateClinicBulkExport(jobId).finally(() => {
          activeGenerationJobIds.delete(jobId);
        }),
      ),
    );
  } catch (err) {
    console.error('[clinic-bulk-export-worker] tick failed', err instanceof Error ? err.message : String(err));
  } finally {
    isTickRunning = false;
  }
}

export function startClinicBulkExportWorker(): void {
  // The worker always runs (it drains already-queued jobs even if creation
  // is later disabled) — CLINIC_BULK_EXPORT_ENABLED gates both new job
  // CREATION and whether an already-queued/in-flight job may actually be
  // claimed/generated: claimQueuedClinicBulkExportJobs re-checks the flag
  // (and the organization allowlist) per candidate and atomically fails an
  // ineligible queued row as FEATURE_DISABLED instead of claiming it, and
  // generateClinicBulkExport re-checks it three more times during an
  // already-claimed job (see clinicBulkExportPackage.ts, final review
  // round). A graceful SIGTERM/SIGINT shutdown additionally cancels any
  // job this process is still actively generating right now, regardless of
  // the flag — see stopClinicBulkExportWorker below.
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

/**
 * Stops only this worker's own scheduled task (never touches other jobs'
 * cron tasks) and, as of the final review round (P0), atomically cancels
 * every job this process is still actively generating right now — this is
 * what actually makes the feature flag a genuine kill switch across a PM2
 * rolling reload: an old process that keeps running past a new process
 * starting with `CLINIC_BULK_EXPORT_ENABLED=false` must not be able to
 * finish (or resurrect) an in-flight export merely because its own
 * `process.env` snapshot is stale.
 *
 * Idempotent: repeated calls (a second signal, a duplicate invocation)
 * return the SAME in-flight/settled promise rather than re-running the
 * cancellation — `activeGenerationJobIds` is only ever snapshotted once,
 * on the first call, and `failActiveGenerationForWorkerShutdown` is itself
 * separately guarded (`status: 'generating'`) so even a second snapshot
 * would be a safe no-op. Safe across multiple worker replicas for the same
 * reason: each replica only ever cancels the job ids IT locally tracked as
 * active, and the guarded per-row update means two replicas racing to
 * cancel the same id (which cannot happen in practice — a job is only
 * ever active in the one replica that claimed it — but would be harmless
 * even so) can never double-transition or clobber a different terminal
 * code.
 */
export function stopClinicBulkExportWorker(): Promise<void> {
  if (shutdownPromise) return shutdownPromise;
  shuttingDown = true;
  scheduledTask?.stop();
  const jobIds = Array.from(activeGenerationJobIds);
  shutdownPromise = (async () => {
    if (jobIds.length === 0) return;
    console.log(`[clinic-bulk-export-worker] shutting down — cancelling ${jobIds.length} active generation job(s).`);
    await Promise.allSettled(jobIds.map((jobId) => failActiveGenerationForWorkerShutdown(jobId)));
  })();
  return shutdownPromise;
}

/** Exported for tests. */
export function isClinicBulkExportWorkerTickRunning(): boolean {
  return isTickRunning;
}

/**
 * Test-only: registers a job id as actively generating in THIS worker
 * process, exactly as runTick() does immediately after a real claim — never
 * called by any production code path. Exists so a test can exercise the
 * real stopClinicBulkExportWorker() cancellation path against a job started
 * directly via generateClinicBulkExport (bypassing node-cron's real
 * minute-granularity schedule, which a test cannot reasonably wait on).
 */
export function trackActiveGenerationJobForTest(jobId: string): void {
  activeGenerationJobIds.add(jobId);
}

/**
 * outboxDispatcherJob.ts — F5-2 scheduling and lifecycle for the outbox dispatcher.
 *
 * NO `withJobLock`, DELIBERATELY
 * ------------------------------
 * Eleven of this repository's background jobs take a `JobLock` lease, which
 * serializes them cluster-wide and — as a side effect — hands them their system
 * execution context. This job must NOT take one, for exactly the reason
 * `clinicBulkExportWorker.ts` records for itself: a constant lock name would
 * mean only one replica in the whole cluster could ever be draining the outbox,
 * which defeats the multi-dispatcher design the claim statement exists for.
 *
 * Cross-replica correctness comes from `FOR UPDATE SKIP LOCKED` inside
 * `claimOutboxEvents()` instead: two dispatchers cannot receive the same row,
 * and neither blocks the other. F5-1P E16b measured this at four concurrent
 * dispatchers — 60 claims, 60 distinct.
 *
 * Because it is lock-free it must declare its own system context, which it does
 * below. `tests/tenantSystemContextInventory.test.ts` holds the lock-free job
 * list to exactly the files that declare one, so this cannot quietly regress.
 *
 * `background-job` is the right reason even though every claimed row belongs to
 * exactly one tenant: the CLAIM polls across all of them. The dispatcher then
 * narrows to `runAsTenant` per row once the row's owner is known — the same
 * "system to claim, tenant to execute" shape F5-1P T1-T7 exercised against the
 * real primitive.
 *
 * PROCESS-LOCAL NON-OVERLAP. A module-level `isTickRunning` flag skips a tick if
 * the previous one is still running in THIS process. That is a guard against a
 * slow tick queueing behind itself, not a distributed lock — other replicas are
 * expected to be ticking at the same time.
 */

import cron, { type ScheduledTask } from 'node-cron';
import { runAsSystem } from '../tenancy/tenantContext.js';
import { logger } from '../utils/logger.js';
import { safeErrorFields } from '../utils/safeError.js';
import {
  runOutboxDispatchTick,
  setOutboxDispatcherShuttingDown,
} from '../outbox/outboxDispatcher.js';
import {
  isOutboxDispatchEnabled,
  getOutboxDispatchCron,
  buildOutboxDispatcherId,
} from '../outbox/outboxConfig.js';

const asDispatcherSystem = <T>(fn: () => Promise<T>): Promise<T> =>
  runAsSystem({ reason: 'background-job', detail: 'outbox-dispatcher' }, fn);

let isTickRunning = false;
let scheduledTask: ScheduledTask | null = null;
let shutdownPromise: Promise<void> | null = null;
/** Resolves when the in-flight tick (if any) has settled. */
let inFlightTick: Promise<unknown> | null = null;

async function runTick(): Promise<void> {
  if (isTickRunning) return;
  isTickRunning = true;
  const dispatcherId = buildOutboxDispatcherId();
  try {
    const result = await asDispatcherSystem(() => runOutboxDispatchTick({ dispatcherId }));
    // Silent when there was nothing to do — a per-minute "0 events" line in
    // production logs is noise that hides the lines that matter.
    if (result.claimed > 0 || result.reclaimed > 0) {
      logger.info({ dispatcherId, ...result }, 'outbox-dispatcher: tick complete');
    }
  } catch (err) {
    logger.error({ dispatcherId, ...safeErrorFields(err) }, 'outbox-dispatcher: tick failed');
  } finally {
    isTickRunning = false;
  }
}

/**
 * Schedules the dispatcher, if and only if `OUTBOX_DISPATCH_ENABLED=true`.
 *
 * When the flag is off this function logs once and returns, so a deployment of
 * this branch is behaviourally identical to the previous release: no cron is
 * registered, no query runs, and the two new tables stay untouched. That is
 * what makes the additive migration safe to deploy ahead of any cutover
 * decision.
 */
export function startOutboxDispatcherJob(): void {
  if (!isOutboxDispatchEnabled()) {
    logger.info('[outbox-dispatcher] OUTBOX_DISPATCH_ENABLED is not "true" — dispatcher not scheduled.');
    return;
  }

  setOutboxDispatcherShuttingDown(false);
  const expression = getOutboxDispatchCron();
  scheduledTask = cron.schedule(expression, () => {
    inFlightTick = runTick();
    void inFlightTick;
  });
  logger.info({ cron: expression }, '[outbox-dispatcher] scheduled');

  process.once('SIGTERM', stopOutboxDispatcherJob);
  process.once('SIGINT', stopOutboxDispatcherJob);
}

/**
 * Graceful shutdown.
 *
 * Stops this job's own scheduled task (never every cron task in the process,
 * which would also stop reminders and the export worker), sets the shutdown
 * flag so a tick already inside `runOutboxDispatchTick` releases anything it
 * has just claimed instead of starting it, and waits for the in-flight tick to
 * settle.
 *
 * Events already being executed are allowed to FINISH rather than being
 * abandoned: a consumer interrupted between its provider call and its
 * idempotency finalisation is exactly what produces an AMBIGUOUS_SIDE_EFFECT,
 * so cutting one short to shut down half a second sooner would manufacture the
 * one outcome this design works hardest to avoid.
 *
 * Idempotent: repeated calls return the same promise.
 */
export function stopOutboxDispatcherJob(): Promise<void> {
  if (shutdownPromise) return shutdownPromise;
  setOutboxDispatcherShuttingDown(true);
  scheduledTask?.stop();
  scheduledTask = null;
  shutdownPromise = (async () => {
    if (inFlightTick) {
      await inFlightTick.catch(() => {});
    }
    logger.info('[outbox-dispatcher] stopped');
  })();
  return shutdownPromise;
}

/** Test-only: clears module state between suites. */
export function resetOutboxDispatcherJobForTest(): void {
  scheduledTask?.stop();
  scheduledTask = null;
  shutdownPromise = null;
  inFlightTick = null;
  isTickRunning = false;
  setOutboxDispatcherShuttingDown(false);
}

/**
 * externalCalendarOutboundSyncJob.ts — bounded retry for
 * ExternalCalendarAppointmentLink rows left in 'failed_retryable' (network
 * errors, 429s, 5xxs — see classifyExternalCalendarSyncError) after the
 * immediate post-conversion sync attempt.
 *
 * Mirrors inboundEventRetryJob.ts's shape:
 *  - Runs every 10 minutes, guarded by a process-local overlap flag AND the
 *    shared JobLock lease (so the API process and a separate worker process
 *    never both process the same batch).
 *  - Crash recovery first: rows stuck in 'syncing' for longer than a
 *    provider call could plausibly take are recovered back to
 *    'failed_retryable' so they re-enter the normal retry path instead of
 *    being silently stuck forever.
 *  - Then retries: due rows (nextAttemptAt <= now, attempts < MAX_SYNC_ATTEMPTS)
 *    are retried via attemptExternalCalendarSync — the SAME function the
 *    immediate attempt and the manual retry endpoint use, so claiming,
 *    classification, backoff scheduling, and the synced/failed transition
 *    are identical across all three call sites.
 */

import cron from 'node-cron';
import prisma from '../db.js';
import { attemptExternalCalendarSync, MAX_SYNC_ATTEMPTS } from '../services/externalCalendar/externalCalendarOutboundSync.js';
import { withJobLock } from '../utils/jobLock.js';
import { logger } from '../utils/logger.js';
import { safeErrorFields } from '../utils/safeError.js';

/** A provider HTTP call is expected to resolve in seconds, not minutes — 30
 *  minutes stuck in 'syncing' can only mean the process crashed mid-attempt. */
const STUCK_SYNCING_MS = 30 * 60 * 1000;
/** A 'pending' row this old was created by the conversion transaction (see
 *  ensurePendingSyncLinkInConversionTransaction) but never picked up by the
 *  immediate post-response attempt — most likely because the process
 *  exited before that fire-and-forget continuation ran. The grace period
 *  gives the normal immediate-attempt path (which completes in seconds) time
 *  to claim the row first; claimSyncLinkForAttempt's atomic claim makes it
 *  harmless even if both race. */
const STALE_PENDING_MS = 2 * 60 * 1000;
const BATCH_SIZE = 50;

export async function runExternalCalendarOutboundSyncJob(): Promise<void> {
  const stuck = await prisma.externalCalendarAppointmentLink.updateMany({
    where: {
      status: 'syncing',
      updatedAt: { lt: new Date(Date.now() - STUCK_SYNCING_MS) },
    },
    data: {
      status: 'failed_retryable',
      lastError: 'Stuck in syncing (recovered by retry job) — will be retried.',
      errorCode: 'STUCK_RECOVERED',
      nextAttemptAt: new Date(),
    },
  });
  if (stuck.count > 0) {
    logger.warn({ count: stuck.count }, 'external-calendar-outbound-sync: recovered stuck syncing row(s)');
  }

  const [dueFailed, stalePending] = await Promise.all([
    prisma.externalCalendarAppointmentLink.findMany({
      where: {
        status: 'failed_retryable',
        attempts: { lt: MAX_SYNC_ATTEMPTS },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
      },
      orderBy: { updatedAt: 'asc' },
      take: BATCH_SIZE,
      select: { id: true },
    }),
    // Rows the conversion transaction created durably but that never got an
    // immediate attempt (e.g. the process exited before the post-response
    // fire-and-forget continuation ran) — see STALE_PENDING_MS.
    prisma.externalCalendarAppointmentLink.findMany({
      where: {
        status: 'pending',
        createdAt: { lt: new Date(Date.now() - STALE_PENDING_MS) },
      },
      orderBy: { createdAt: 'asc' },
      take: BATCH_SIZE,
      select: { id: true },
    }),
  ]);

  const due = [...dueFailed, ...stalePending];
  if (due.length === 0) return;
  logger.info(
    { failedRetryableCount: dueFailed.length, stalePendingCount: stalePending.length },
    'external-calendar-outbound-sync: retrying sync record(s)',
  );

  for (const row of due) {
    try {
      const result = await attemptExternalCalendarSync(row.id);
      if (result.outcome === 'not_claimed') {
        // Another worker/manual retry claimed it first, or it's no longer due — expected, not an error.
        continue;
      }
    } catch (error) {
      // attemptExternalCalendarSync already classifies and persists failures
      // internally; this catch only guards against a truly unexpected throw
      // (e.g. a DB outage mid-attempt) so one bad row can't abort the batch.
      logger.error({ linkId: row.id, ...safeErrorFields(error) }, 'external-calendar-outbound-sync: unexpected error retrying sync record');
    }
  }
}

let retryJobRunning = false;

export function startExternalCalendarOutboundSyncJob(): void {
  cron.schedule('*/10 * * * *', () => {
    if (retryJobRunning) {
      logger.warn('external-calendar-outbound-sync: previous run still in progress, skipping this tick');
      return;
    }
    retryJobRunning = true;
    withJobLock('external-calendar-outbound-sync', 10 * 60 * 1000, runExternalCalendarOutboundSyncJob)
      .catch((error) => logger.error(safeErrorFields(error), 'external-calendar-outbound-sync: job run failed'))
      .finally(() => {
        retryJobRunning = false;
      });
  });
  logger.info('external-calendar-outbound-sync: retry job scheduled (every 10 min)');
}

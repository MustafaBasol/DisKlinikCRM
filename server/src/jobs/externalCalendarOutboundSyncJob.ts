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

/** A provider HTTP call is expected to resolve in seconds, not minutes — 30
 *  minutes stuck in 'syncing' can only mean the process crashed mid-attempt. */
const STUCK_SYNCING_MS = 30 * 60 * 1000;
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
    console.warn(`[external-calendar-outbound-sync] Recovered ${stuck.count} stuck syncing row(s).`);
  }

  const due = await prisma.externalCalendarAppointmentLink.findMany({
    where: {
      status: 'failed_retryable',
      attempts: { lt: MAX_SYNC_ATTEMPTS },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
    },
    orderBy: { updatedAt: 'asc' },
    take: BATCH_SIZE,
    select: { id: true },
  });

  if (due.length === 0) return;
  console.info(`[external-calendar-outbound-sync] Retrying ${due.length} failed sync record(s).`);

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
      console.error('[external-calendar-outbound-sync] Unexpected error retrying sync record', { linkId: row.id, error });
    }
  }
}

let retryJobRunning = false;

export function startExternalCalendarOutboundSyncJob(): void {
  cron.schedule('*/10 * * * *', () => {
    if (retryJobRunning) {
      console.warn('[external-calendar-outbound-sync] Previous run still in progress, skipping this tick.');
      return;
    }
    retryJobRunning = true;
    withJobLock('external-calendar-outbound-sync', 10 * 60 * 1000, runExternalCalendarOutboundSyncJob)
      .catch((error) => console.error('[external-calendar-outbound-sync] Job run failed:', error))
      .finally(() => {
        retryJobRunning = false;
      });
  });
  console.log('[external-calendar-outbound-sync] External calendar outbound sync retry job scheduled (every 10 min).');
}

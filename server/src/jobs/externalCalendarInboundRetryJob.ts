/**
 * externalCalendarInboundRetryJob.ts — crash-recovery for
 * ExternalCalendarInboundEvent rows stuck in 'processing'.
 *
 * Mirrors inboundEventRetryJob.ts's crash-recovery half. Unlike the
 * WhatsApp job, there is no business-logic retry here: marking a stored
 * event processed/ignored is a deterministic function of its eventType (see
 * externalCalendarWebhookProcessor.ts), so a row can only be "stuck" if the
 * process crashed between creating the row and marking it — recovering it
 * just means finishing that same deterministic step.
 */

import cron from 'node-cron';
import prisma from '../db.js';
import {
  ACTIVE_EXTERNAL_CALENDAR_EVENT_TYPES,
} from '../services/externalCalendar/externalCalendarWebhookProcessor.js';
import {
  markExternalCalendarEventIgnored,
  markExternalCalendarEventProcessed,
} from '../services/externalCalendar/externalCalendarIdempotency.js';
import { withJobLock } from '../utils/jobLock.js';

const STUCK_PROCESSING_MS = 60 * 60 * 1000; // 1 hour
const BATCH_SIZE = 100;

export async function runExternalCalendarInboundRetryJob(): Promise<void> {
  const stuck = await prisma.externalCalendarInboundEvent.findMany({
    where: {
      status: 'processing',
      updatedAt: { lt: new Date(Date.now() - STUCK_PROCESSING_MS) },
    },
    take: BATCH_SIZE,
  });

  if (stuck.length === 0) return;
  console.warn(`[external-calendar-retry] Recovering ${stuck.length} stuck inbound event(s).`);

  for (const event of stuck) {
    try {
      if (ACTIVE_EXTERNAL_CALENDAR_EVENT_TYPES.has(event.eventType)) {
        await markExternalCalendarEventProcessed(event.id);
      } else {
        await markExternalCalendarEventIgnored(
          event.id,
          `Reserved/unknown event type recovered from stuck processing: ${event.eventType}`,
        );
      }
    } catch (error) {
      console.error('[external-calendar-retry] Failed to recover event', { eventId: event.id, error });
    }
  }
}

let retryJobRunning = false;

export function startExternalCalendarInboundRetryJob(): void {
  cron.schedule('*/10 * * * *', () => {
    if (retryJobRunning) {
      console.warn('[external-calendar-retry] Previous run still in progress, skipping this tick.');
      return;
    }
    retryJobRunning = true;
    withJobLock('external-calendar-inbound-retry', 10 * 60 * 1000, runExternalCalendarInboundRetryJob)
      .catch((error) => console.error('[external-calendar-retry] Job run failed:', error))
      .finally(() => {
        retryJobRunning = false;
      });
  });
  console.log('[external-calendar-retry] External calendar inbound event retry job scheduled (every 10 min).');
}

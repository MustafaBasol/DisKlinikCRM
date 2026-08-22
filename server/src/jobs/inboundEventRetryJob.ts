/**
 * inboundEventRetryJob.ts — Failed webhook event retry (docs/45 Faz 2 #6),
 * hardened by F5-3.
 *
 * WHY IT EXISTS (unchanged): Meta receives a 200, so it never redelivers a
 * webhook whose PROCESSING failed. Without this job, a message that fell over
 * on a transient database or AI error would be lost permanently.
 *
 * ─── WHAT F5-3 CHANGED, AND WHY ─────────────────────────────────────────────
 *
 * 1. `failed` MEANT FOUR DIFFERENT THINGS AND NOTHING COULD TELL THEM APART.
 *    A `failed` row could be: retryable soon; out of attempts; aged past the
 *    six-hour window (still `attempts: 1`, so it LOOKS retryable forever); or
 *    from a channel this job never selects at all. The last two are terminal
 *    and nothing said so — a real patient message could sit `failed` and
 *    unanswered indefinitely with no signal anywhere.
 *
 *    Now: terminal outcomes transition to `status: 'dead'` with a stable
 *    `lastErrorCode` and a `deadLetteredAt`, so they are queryable, alarmable
 *    and replayable (`messaging/messagingInboundDlq.ts`,
 *    `messaging/messagingInboundReplay.ts`).
 *
 * 2. THE BACKOFF WAS A FIXED FIVE-MINUTE FLOOR WITH NO GROWTH AND NO JITTER.
 *    That is the exact shape that produces a synchronised retry storm: when a
 *    provider is down, every failed event in the batch comes back together
 *    every five minutes, for as long as the outage lasts.
 *
 *    Now: exponential backoff with FULL jitter per category, written to
 *    `nextAttemptAt`, floored by a provider `Retry-After` where one was given.
 *    `nextAttemptAt: null` keeps its old meaning (eligible once the minimum-age
 *    floor has passed), so rows written before this deploy behave exactly as
 *    they did — which is what makes the migration safe to ship ahead of the app.
 *
 * 3. THE PROVIDER FILTER WAS A LITERAL BURIED IN A `findMany`.
 *    `provider: 'meta_cloud_api'` is now derived from
 *    `messaging/messagingRedeliveryRegistry.ts`, where "which channels can be
 *    re-driven, and why not" is a reviewable statement rather than a filter
 *    someone has to notice. Evolution and Instagram remain unsupported — F5-3
 *    deliberately does not build handlers that would re-run a stale
 *    conversational turn — but their failures now become terminal
 *    (`NO_RETRY_HANDLER`) and visible instead of silently permanent.
 *
 * 4. FAILURES WERE RECORDED AS RAW EXCEPTION TEXT.
 *    `markInboundEventFailed` persisted `error.message.slice(0, 1000)`, and a
 *    provider body can echo a phone number or the message itself. Every failure
 *    here now carries a stable `MessagingFailureCode`; the free-text column is
 *    no longer written by this job.
 *
 * WHAT DID NOT CHANGE: this job still takes the `withJobLock` lease (so it
 * inherits its system execution context), still increments `attempts` BEFORE
 * the attempt so a process death is counted, and still refuses to re-drive a
 * stale conversational turn beyond the retry window.
 */

import cron from 'node-cron';
import prisma from '../db.js';
import { MetaCloudWhatsAppProvider } from '../services/whatsapp/MetaCloudWhatsAppProvider.js';
import { deliverIncomingMetaMessage } from '../services/whatsapp/metaInboundDelivery.js';
import {
  markInboundEventProcessed,
  markInboundEventFailed,
} from '../services/messagingInboundIdempotency.js';
import { withJobLock } from '../utils/jobLock.js';
import { safeErrorFields } from '../utils/safeError.js';
import {
  classifyMessagingError,
  computeMessagingBackoffMs,
  isRetryableMessagingCategory,
  type MessagingFailureCode,
} from '../messaging/messagingFailureClassification.js';
import { deadLetterInboundEvent } from '../messaging/messagingInboundDlq.js';
import { getSupportedRedeliveryTargets } from '../messaging/messagingRedeliveryRegistry.js';

export const MAX_ATTEMPTS = 3;
const RETRY_WINDOW_MS = 6 * 60 * 60 * 1000; // 6 saat: bayat AI yanıtı göndermeyi önler
const MIN_AGE_MS = 5 * 60 * 1000; // fail'den en az 5 dk sonra dene (nextAttemptAt yoksa)
const STUCK_PROCESSING_MS = 60 * 60 * 1000; // 1 saat
const BATCH_SIZE = 50;

/**
 * Sweep failures that are terminal for a reason the retry loop itself will
 * never notice, because it never selects them.
 *
 * Both cases were previously invisible: the row stayed `failed` with a low
 * attempt count, looking retryable, forever.
 */
export async function deadLetterUnretryableEvents(
  now: number,
): Promise<{ expired: number; unsupported: number }> {
  const supported = getSupportedRedeliveryTargets();

  // (a) Aged past the retry window. Re-driving now would answer a question the
  //     patient asked six hours ago, which is why the window exists — but the
  //     event still deserves to be seen, not silently abandoned.
  const expired = await prisma.messagingInboundEvent.updateMany({
    where: {
      status: 'failed',
      createdAt: { lte: new Date(now - RETRY_WINDOW_MS) },
    },
    data: {
      status: 'dead',
      lastErrorCode: 'RETRY_WINDOW_EXPIRED' satisfies MessagingFailureCode,
      deadLetteredAt: new Date(now),
      nextAttemptAt: null,
    },
  });

  // (b) A channel with no re-delivery handler. Expressed as NOT(supported
  //     pairs) from the registry, so adding a handler automatically stops this
  //     sweep from claiming that channel.
  const unsupported = await prisma.messagingInboundEvent.updateMany({
    where: {
      status: 'failed',
      NOT: supported.map((t) => ({ channel: t.channel, provider: t.provider })),
    },
    data: {
      status: 'dead',
      lastErrorCode: 'NO_RETRY_HANDLER' satisfies MessagingFailureCode,
      deadLetteredAt: new Date(now),
      nextAttemptAt: null,
    },
  });

  return { expired: expired.count, unsupported: unsupported.count };
}

/** Record a failed attempt: either schedule a backoff, or dead-letter it. */
async function recordAttemptFailure(
  event: { id: string; attempts: number },
  err: unknown,
  now: number,
): Promise<void> {
  const failure = classifyMessagingError(err);

  if (!isRetryableMessagingCategory(failure.category)) {
    await deadLetterInboundEvent({ eventId: event.id, code: failure.code, now: new Date(now) });
    return;
  }

  // `attempts` was already incremented when this attempt was claimed, so
  // `event.attempts + 1` is the number of attempts now spent.
  const attemptsSpent = event.attempts + 1;
  if (attemptsSpent >= MAX_ATTEMPTS) {
    await deadLetterInboundEvent({
      eventId: event.id,
      code: 'MAX_ATTEMPTS_EXCEEDED',
      now: new Date(now),
    });
    return;
  }

  const backoffMs = computeMessagingBackoffMs(failure.category, attemptsSpent, {
    ...(failure.retryAfterMs !== undefined ? { retryAfterMs: failure.retryAfterMs } : {}),
  });
  await markInboundEventFailed(event.id, {
    code: failure.code,
    nextAttemptAt: new Date(now + backoffMs),
  });
}

/** Dead-letter directly, for conditions that can never become retryable. */
async function failTerminally(eventId: string, code: MessagingFailureCode, now: number): Promise<void> {
  await deadLetterInboundEvent({ eventId, code, now: new Date(now) });
}

export async function runInboundEventRetryJob(): Promise<void> {
  const now = Date.now();

  // Crash recovery: a row left in `processing` by a dead process becomes
  // retryable again. `attempts` is NOT reset — it was incremented at claim,
  // which is what bounds a crash loop.
  const stuck = await prisma.messagingInboundEvent.updateMany({
    where: {
      status: 'processing',
      updatedAt: { lt: new Date(now - STUCK_PROCESSING_MS) },
    },
    data: {
      status: 'failed',
      lastErrorCode: 'STUCK_IN_PROCESSING' satisfies MessagingFailureCode,
      // Immediately eligible: the work is already an hour late, and backing off
      // further would punish the event for the processor's failure.
      nextAttemptAt: new Date(now),
    },
  });
  if (stuck.count > 0) {
    console.warn(`[inbound-retry] Recovered ${stuck.count} stuck processing event(s).`);
  }

  const swept = await deadLetterUnretryableEvents(now);
  if (swept.expired > 0 || swept.unsupported > 0) {
    console.warn(
      `[inbound-retry] Dead-lettered ${swept.expired} window-expired and ${swept.unsupported} ` +
        'unsupported-channel event(s). They are now visible in the DLQ view.',
    );
  }

  const supported = getSupportedRedeliveryTargets();
  const events = await prisma.messagingInboundEvent.findMany({
    where: {
      status: 'failed',
      OR: supported.map((t) => ({ channel: t.channel, provider: t.provider })),
      attempts: { lt: MAX_ATTEMPTS },
      createdAt: { gt: new Date(now - RETRY_WINDOW_MS) },
      // Backoff, with the pre-F5-3 minimum-age floor preserved for rows that
      // predate `nextAttemptAt` (it is NULL on every existing row).
      AND: [
        {
          OR: [
            { nextAttemptAt: { lte: new Date(now) } },
            { AND: [{ nextAttemptAt: null }, { updatedAt: { lt: new Date(now - MIN_AGE_MS) } }] },
          ],
        },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take: BATCH_SIZE,
  });

  if (events.length === 0) return;
  console.info(`[inbound-retry] Retrying ${events.length} failed inbound event(s).`);

  for (const event of events) {
    // Denemeyi baştan say: işlem sırasında süreç ölürse event 'processing'te
    // kalır ve yukarıdaki crash recovery ile tekrar failed'e döner.
    await prisma.messagingInboundEvent.update({
      where: { id: event.id },
      data: { status: 'processing', attempts: { increment: 1 }, nextAttemptAt: null },
    });

    try {
      if (!event.connectionId) {
        await failTerminally(event.id, 'MISSING_CONNECTION', now);
        continue;
      }

      const connection = await prisma.whatsAppConnection.findFirst({
        where: { id: event.connectionId, provider: 'meta_cloud_api', isActive: true },
        select: { id: true, organizationId: true },
      });
      if (!connection) {
        // Terminal, not retryable: a deleted or deactivated connection will not
        // come back on its own, and retrying it three times changes nothing.
        await failTerminally(event.id, 'CONNECTION_INACTIVE', now);
        continue;
      }

      const provider = new MetaCloudWhatsAppProvider();
      const parsed = provider.parseWebhook(event.rawPayload, {
        id: connection.id,
        organizationId: connection.organizationId,
        provider: 'meta_cloud_api',
        status: 'connected',
      });

      const phone = parsed.phone || event.fromPhone || undefined;
      const text = parsed.text;
      if (parsed.eventType !== 'message' || !phone || !text) {
        // The stored envelope will never parse into a message, however many
        // times it is tried.
        await failTerminally(event.id, 'UNPARSEABLE_PAYLOAD', now);
        continue;
      }

      await deliverIncomingMetaMessage(
        connection,
        phone,
        text,
        parsed.messageId ?? event.providerMessageId,
        event.rawPayload,
      );
      await markInboundEventProcessed(event.id);
    } catch (error) {
      await recordAttemptFailure(event, error, now).catch(() => {});
      console.error('[inbound-retry] Retry failed for event', { eventId: event.id, ...safeErrorFields(error) });
    }
  }
}

let retryJobRunning = false;

export function startInboundEventRetryJob(): void {
  cron.schedule('*/10 * * * *', () => {
    if (retryJobRunning) {
      console.warn('[inbound-retry] Previous run still in progress, skipping this tick.');
      return;
    }
    retryJobRunning = true;
    // Paylaşımlı kilit: birden fazla replika/worker aynı failed event'leri
    // aynı anda yeniden işlemesin (docs/45 Faz 3 #9-10).
    withJobLock('inbound-event-retry', 10 * 60 * 1000, runInboundEventRetryJob)
      .catch(error => console.error('[inbound-retry] Job run failed:', safeErrorFields(error)))
      .finally(() => {
        retryJobRunning = false;
      });
  });
  console.log('[inbound-retry] Failed inbound event retry job scheduled (every 10 min).');
}

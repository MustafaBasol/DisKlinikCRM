/**
 * inboundEventRetryJob.ts — Failed webhook event retry (docs/45 Faz 2 #6)
 *
 * Meta 200 aldığı için failed bir webhook event'ini asla yeniden göndermez;
 * işleme sırasında (ör. geçici DB/AI hatası) düşen mesajlar kalıcı kaybolurdu.
 * Bu job MessagingInboundEvent üzerinden basit bir kuyruk mantığı kurar:
 *
 *  - 10 dakikada bir çalışır (süreç-yerel overlap kilidi ile).
 *  - Önce crash-recovery: 1 saatten uzun süredir 'processing'te takılı event'ler
 *    'failed'e çekilir (süreç restart'ında yarım kalanlar).
 *  - Sonra retry: son 6 saat içinde oluşmuş, en az 5 dk önce fail olmuş,
 *    attempts < 3 event'ler yeniden işlenir.
 *
 * Şimdilik yalnızca channel=whatsapp / provider=meta_cloud_api yeniden işlenir
 * (hasta randevu asistanı — en kritik akış). Evolution ve Instagram event'leri
 * failed olarak kalır; handler eklendiğinde SUPPORTED_PROVIDERS'a eklenir.
 */

import cron from 'node-cron';
import prisma from '../db.js';
import { MetaCloudWhatsAppProvider } from '../services/whatsapp/MetaCloudWhatsAppProvider.js';
import { deliverIncomingMetaMessage } from '../services/whatsapp/metaInboundDelivery.js';
import {
  markInboundEventFailed,
  markInboundEventProcessed,
} from '../services/messagingInboundIdempotency.js';
import { withJobLock } from '../utils/jobLock.js';

const MAX_ATTEMPTS = 3;
const RETRY_WINDOW_MS = 6 * 60 * 60 * 1000; // 6 saat: bayat AI yanıtı göndermeyi önler
const MIN_AGE_MS = 5 * 60 * 1000; // fail'den en az 5 dk sonra dene
const STUCK_PROCESSING_MS = 60 * 60 * 1000; // 1 saat
const BATCH_SIZE = 50;

export async function runInboundEventRetryJob(): Promise<void> {
  const now = Date.now();

  // Crash recovery: takılı 'processing' event'leri retryable hale getir.
  const stuck = await prisma.messagingInboundEvent.updateMany({
    where: {
      status: 'processing',
      updatedAt: { lt: new Date(now - STUCK_PROCESSING_MS) },
    },
    data: { status: 'failed', errorMessage: 'Stuck in processing (recovered by retry job)' },
  });
  if (stuck.count > 0) {
    console.warn(`[inbound-retry] Recovered ${stuck.count} stuck processing event(s).`);
  }

  const events = await prisma.messagingInboundEvent.findMany({
    where: {
      status: 'failed',
      channel: 'whatsapp',
      provider: 'meta_cloud_api',
      attempts: { lt: MAX_ATTEMPTS },
      createdAt: { gt: new Date(now - RETRY_WINDOW_MS) },
      updatedAt: { lt: new Date(now - MIN_AGE_MS) },
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
      data: { status: 'processing', attempts: { increment: 1 } },
    });

    try {
      if (!event.connectionId) {
        await markInboundEventFailed(event.id, new Error('Missing connectionId; cannot retry'));
        continue;
      }

      const connection = await prisma.whatsAppConnection.findFirst({
        where: { id: event.connectionId, provider: 'meta_cloud_api', isActive: true },
        select: { id: true, organizationId: true },
      });
      if (!connection) {
        await markInboundEventFailed(event.id, new Error('Connection not found or inactive'));
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
        await markInboundEventFailed(event.id, new Error('Stored payload is not a parseable message'));
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
      await markInboundEventFailed(event.id, error).catch(() => {});
      console.error('[inbound-retry] Retry failed for event', { eventId: event.id, error });
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
      .catch(error => console.error('[inbound-retry] Job run failed:', error))
      .finally(() => {
        retryJobRunning = false;
      });
  });
  console.log('[inbound-retry] Failed inbound event retry job scheduled (every 10 min).');
}

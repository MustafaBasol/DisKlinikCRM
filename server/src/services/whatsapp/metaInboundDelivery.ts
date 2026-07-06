/**
 * metaInboundDelivery.ts — Meta Cloud gelen mesajın klinik çözümü + inbox + AI işleme çekirdeği.
 *
 * Webhook route'u (ilk teslim) ve inboundEventRetryJob (failed event'lerin yeniden
 * işlenmesi) aynı fonksiyonu kullanır; idempotency kaydı (MessagingInboundEvent)
 * çağıranın sorumluluğundadır. Bkz. docs/45 Faz 2 #6.
 */

import {
  resolveClinicForIncomingMessage,
  upsertInboxEntry,
} from './clinicResolver.js';
import { processMetaWhatsAppIncomingMessage } from './metaWhatsAppAiProcessor.js';
import { writeAuditLog } from '../../utils/auditLog.js';

export type MetaInboundConnection = { id: string; organizationId: string };

export type MetaClinicResolution = Awaited<ReturnType<typeof resolveClinicForIncomingMessage>>;

function summarizePhone(value: string | null | undefined) {
  if (!value) return null;
  return { length: value.length, suffix: value.slice(-4) };
}

function asJsonRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * Klinik çözümü yapılmış (veya burada yapılacak) bir Meta mesajını inbox'a yazar
 * ve klinik biliniyorsa AI işleyiciyi çalıştırır. Hata fırlatırsa çağıran
 * markInboundEventFailed ile işaretler.
 */
export async function deliverIncomingMetaMessage(
  connection: MetaInboundConnection,
  phone: string,
  text: string,
  messageId: string | undefined,
  rawPayload: unknown,
  precomputedResolution?: MetaClinicResolution,
): Promise<void> {
  const resolution =
    precomputedResolution ??
    (await resolveClinicForIncomingMessage(connection.id, connection.organizationId, phone));

  if (resolution.clinicId) {
    // Klinik biliniyor: inbox'a yaz, sonra AI işleyiciyi çalıştır.
    await upsertInboxEntry({
      organizationId: connection.organizationId,
      whatsappConnectionId: connection.id,
      clinicId: resolution.clinicId,
      needsClinicResolution: false,
      phone,
      lastMessageText: text,
      externalMessageId: messageId,
    });

    if (text.trim()) {
      await processMetaWhatsAppIncomingMessage({
        organizationId: connection.organizationId,
        clinicId: resolution.clinicId,
        connectionId: connection.id,
        phone,
        messageId,
        text,
        rawPayload: asJsonRecord(rawPayload),
      });
    }
  } else if (resolution.needsClinicResolution) {
    // Çözülemeyen paylaşımlı hat: sadece inbox, AI yok.
    await upsertInboxEntry({
      organizationId: connection.organizationId,
      whatsappConnectionId: connection.id,
      clinicId: null,
      needsClinicResolution: true,
      phone,
      lastMessageText: text,
      externalMessageId: messageId,
    });
  } else {
    writeAuditLog({
      organizationId: connection.organizationId,
      action: 'meta_webhook_no_clinic_links',
      entityType: 'whatsapp_connection',
      entityId: connection.id,
      description: 'Meta webhook received for a WhatsApp connection with no clinic assignments',
      metadata: { phone: summarizePhone(phone) },
    }).catch(() => {
      // Operasyonel log hatası mesaj işlemeyi engellememeli
    });
  }
}

/**
 * MetaCloudWhatsAppProvider.ts — Meta Cloud API provider foundation.
 *
 * Data model, API shape, webhook route structure and frontend fields are ready.
 * Full live sending is NOT implemented yet — methods return clear not-implemented
 * responses so the rest of the system can operate cleanly.
 *
 * When Meta app approval and credentials are available, implement:
 *   - sendMessage()  → POST https://graph.facebook.com/v19.0/{phoneNumberId}/messages
 *   - verifyWebhook  → GET endpoint for hub.verify_token challenge
 *   - disconnect()   → deregister phone number or revoke token
 */

import type {
  WhatsAppProvider,
  WhatsAppConnectionRecord,
  SendMessagePayload,
  SendMessageResult,
  TestConnectionResult,
  QrCodeResult,
  ParsedWebhookEvent,
} from './WhatsAppProvider.js';

const NOT_IMPLEMENTED_MESSAGE =
  'Meta Cloud API provider is configured but live sending is not implemented yet. This feature will be activated in a later sprint.';

export class MetaCloudWhatsAppProvider implements WhatsAppProvider {
  async sendMessage(
    _connection: WhatsAppConnectionRecord,
    _payload: SendMessagePayload,
  ): Promise<SendMessageResult> {
    return { success: false, error: NOT_IMPLEMENTED_MESSAGE };
  }

  async testConnection(connection: WhatsAppConnectionRecord): Promise<TestConnectionResult> {
    // Validate that the minimum required fields are saved — does not make a live API call.
    const hasMinFields =
      connection.metaPhoneNumberId?.trim() &&
      connection.metaAccessTokenEncrypted?.trim();

    if (!hasMinFields) {
      return {
        success: false,
        message:
          'Meta Cloud API configuration is incomplete. Phone Number ID and Access Token are required.',
      };
    }

    return {
      success: true,
      message:
        `Meta Cloud API foundation is configured (Phone Number ID: ${connection.metaPhoneNumberId}). ` +
        'Live sending is not yet implemented — will be activated in a future sprint.',
    };
  }

  async getQrCode(_connection: WhatsAppConnectionRecord): Promise<QrCodeResult> {
    return {
      available: false,
      message:
        'Meta Cloud API does not use this QR flow. Use Meta Embedded Signup / Cloud API setup instead.',
    };
  }

  async disconnect(_connection: WhatsAppConnectionRecord): Promise<void> {
    // Meta Cloud API connections are managed through the Meta Business Manager.
    // Marking as inactive in our DB is sufficient for MVP.
  }

  parseWebhook(payload: unknown, _connection: WhatsAppConnectionRecord): ParsedWebhookEvent {
    if (!payload || typeof payload !== 'object') {
      return { eventType: 'unknown', raw: payload };
    }

    // Meta webhook structure: { object: "whatsapp_business_account", entry: [...] }
    const body = payload as Record<string, unknown>;
    if (body.object !== 'whatsapp_business_account') {
      return { eventType: 'unknown', raw: payload };
    }

    try {
      const entries = body.entry as Array<Record<string, unknown>>;
      const changes = entries?.[0]?.changes as Array<Record<string, unknown>>;
      const value = changes?.[0]?.value as Record<string, unknown>;
      const messages = value?.messages as Array<Record<string, unknown>>;
      const statuses = value?.statuses as Array<Record<string, unknown>>;

      if (messages?.length) {
        const msg = messages[0];
        const textContent = (msg.text as Record<string, unknown> | undefined)?.body as string ?? '';
        return {
          eventType: 'message',
          phone: (msg.from as string)?.replace(/\D/g, ''),
          text: textContent,
          messageId: msg.id as string,
          timestamp: msg.timestamp as number | undefined,
          raw: payload,
        };
      }

      if (statuses?.length) {
        const status = statuses[0];
        return {
          eventType: 'status_update',
          status: status.status as string,
          messageId: status.id as string,
          raw: payload,
        };
      }
    } catch {
      // Fall through to unknown
    }

    return { eventType: 'unknown', raw: payload };
  }
}

/**
 * MetaCloudWhatsAppProvider.ts — Meta Cloud API provider implementation.
 *
 * Sends WhatsApp messages via Meta Graph API, verifies webhooks and parses
 * incoming Meta webhook payloads. Credentials are decrypted server-side;
 * they are never logged or returned to clients.
 *
 * Graph API base: https://graph.facebook.com/{version}
 * Send message:   POST /{phoneNumberId}/messages
 * Phone info:     GET  /{phoneNumberId}?fields=display_phone_number,verified_name
 *
 * Required on WhatsAppConnection:
 *   metaPhoneNumberId        — The Phone Number ID from Meta Business Manager
 *   metaAccessTokenEncrypted — AES-256-GCM encrypted permanent access token
 *
 * Optional:
 *   metaWebhookVerifyToken   — Used for webhook verification challenge
 */

import type {
  WhatsAppProvider,
  WhatsAppConnectionRecord,
  SendMessagePayload,
  SendMessageResult,
  TestConnectionResult,
  QrCodeResult,
  ParsedWebhookEvent,
  TemplateSendPayload,
  TemplateSendResult,
} from './WhatsAppProvider.js';
import { decryptSecret } from '../../utils/encryption.js';

const GRAPH_API_VERSION = process.env.META_GRAPH_API_VERSION || 'v23.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

/** Decrypt the stored access token; returns null on failure. Never throws. */
function resolveAccessToken(connection: WhatsAppConnectionRecord): string | null {
  const raw = connection.metaAccessTokenEncrypted?.trim();
  if (!raw) return null;
  try {
    return decryptSecret(raw);
  } catch {
    // Legacy / test records stored unencrypted — accept as-is
    return raw;
  }
}

export class MetaCloudWhatsAppProvider implements WhatsAppProvider {
  /**
   * Send a text message via Meta Graph API.
   * POST /{phoneNumberId}/messages
   */
  async sendMessage(
    connection: WhatsAppConnectionRecord,
    payload: SendMessagePayload,
  ): Promise<SendMessageResult> {
    const phoneNumberId = connection.metaPhoneNumberId?.trim();
    const accessToken = resolveAccessToken(connection);

    if (!phoneNumberId || !accessToken) {
      return {
        success: false,
        error:
          'Meta Cloud API configuration is incomplete. Phone Number ID and Access Token are required.',
      };
    }

    const url = `${GRAPH_BASE}/${encodeURIComponent(phoneNumberId)}/messages`;
    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: payload.phone,
      type: 'text',
      text: { preview_url: false, body: payload.text },
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        return {
          success: false,
          error: `Meta Graph API sendMessage failed with ${response.status}: ${errorText}`,
        };
      }

      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const messages = data.messages as Array<Record<string, unknown>> | undefined;
      const externalMessageId = (messages?.[0]?.id as string) ?? null;
      return { success: true, externalMessageId };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Meta Graph API request error: ${msg}` };
    }
  }

  /**
   * Verify connectivity by calling the phone number info endpoint.
   * GET /{phoneNumberId}?fields=display_phone_number,verified_name
   */
  async testConnection(connection: WhatsAppConnectionRecord): Promise<TestConnectionResult> {
    const phoneNumberId = connection.metaPhoneNumberId?.trim();
    const accessToken = resolveAccessToken(connection);

    if (!phoneNumberId || !accessToken) {
      return {
        success: false,
        message:
          'Meta Cloud API configuration is incomplete. Phone Number ID and Access Token are required.',
      };
    }

    const url = `${GRAPH_BASE}/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`;

    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        return {
          success: false,
          message: `Meta Graph API test failed (${response.status}): ${errorText}`,
        };
      }

      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const displayPhone = data.display_phone_number as string | undefined;
      const verifiedName = data.verified_name as string | undefined;
      const info = [displayPhone, verifiedName].filter(Boolean).join(' / ');

      return {
        success: true,
        message: `Meta Cloud API connected successfully.${info ? ` (${info})` : ''}`,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: `Meta Graph API request error: ${msg}` };
    }
  }

  /**
   * Meta Cloud API does not use Evolution-style QR codes.
   * Direct users to Meta Embedded Signup instead.
   */
  async getQrCode(_connection: WhatsAppConnectionRecord): Promise<QrCodeResult> {
    return {
      available: false,
      message:
        'Meta Cloud API does not use QR code pairing. ' +
        'Use the "Connect with Meta" (Embedded Signup) button to link your WhatsApp Business account.',
    };
  }

  /**
   * Mark the connection as disconnected in DB (done by the caller).
   * We do NOT attempt to revoke the Meta access token in MVP —
   * that requires additional Meta permissions and explicit user intent.
   */
  async disconnect(_connection: WhatsAppConnectionRecord): Promise<void> {
    // Caller (whatsappService.disconnectWhatsAppConnection) marks status=disconnected
    // and isActive=false. No API call needed for MVP.
  }

  /**
   * Send a WhatsApp template message via Meta Graph API.
   *
   * Template messages are required for business-initiated messages outside the
   * 24-hour customer-service window. Templates must be pre-approved by Meta.
   *
   * NOTE: Template management (creating/submitting templates) is out of scope for
   * the current MVP. This method sends an existing approved template by name.
   *
   * Meta free-form text messages work inside the customer-service window (within
   * 24 h of the customer's last message). Template messages are required for
   * out-of-window / business-initiated messages (e.g. appointment reminders).
   *
   * TODO (future sprint): Add template library management UI and Meta template
   * submission/approval workflow.
   */
  async sendTemplateMessage(
    connection: WhatsAppConnectionRecord,
    payload: TemplateSendPayload,
  ): Promise<TemplateSendResult> {
    const phoneNumberId = connection.metaPhoneNumberId?.trim();
    const accessToken = resolveAccessToken(connection);

    if (!phoneNumberId || !accessToken) {
      return {
        supported: true,
        success: false,
        error: 'Meta Cloud API configuration is incomplete. Phone Number ID and Access Token are required.',
      };
    }

    const url = `${GRAPH_BASE}/${encodeURIComponent(phoneNumberId)}/messages`;
    const body: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      to: payload.phone,
      type: 'template',
      template: {
        name: payload.templateName,
        language: { code: payload.languageCode },
        ...(payload.components ? { components: payload.components } : {}),
      },
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        return {
          supported: true,
          success: false,
          error: `Meta Graph API sendTemplateMessage failed (${response.status}): ${errorText}`,
        };
      }

      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const messages = data.messages as Array<Record<string, unknown>> | undefined;
      return {
        supported: true,
        success: true,
        externalMessageId: (messages?.[0]?.id as string) ?? null,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { supported: true, success: false, error: `Meta Graph API request error: ${msg}` };
    }
  }

  /**
   * Parse an inbound Meta Cloud API webhook payload into a normalised event.
   *
   * Meta payload shape:
   * {
   *   object: "whatsapp_business_account",
   *   entry: [{
   *     id: <waba_id>,
   *     changes: [{
   *       value: {
   *         messaging_product: "whatsapp",
   *         metadata: { display_phone_number, phone_number_id },
   *         messages: [{ from, id, timestamp, text: { body }, type }],
   *         statuses: [{ id, status, timestamp, recipient_id }]
   *       },
   *       field: "messages"
   *     }]
   *   }]
   * }
   */
  parseWebhook(payload: unknown, _connection: WhatsAppConnectionRecord): ParsedWebhookEvent {
    if (!payload || typeof payload !== 'object') {
      return { eventType: 'unknown', raw: payload };
    }

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
        // Only handle text messages for now; other types are normalised as unknown
        const msgType = msg.type as string;
        if (msgType !== 'text') {
          return { eventType: 'unknown', raw: payload };
        }
        const textContent =
          ((msg.text as Record<string, unknown> | undefined)?.body as string) ?? '';
        return {
          eventType: 'message',
          phone: (msg.from as string)?.replace(/\D/g, ''),
          text: textContent,
          messageId: msg.id as string,
          timestamp:
            typeof msg.timestamp === 'string'
              ? parseInt(msg.timestamp, 10)
              : (msg.timestamp as number | undefined),
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

  /**
   * Extract the phone_number_id from the first message/status in a Meta webhook payload.
   * Used to resolve a connection when using a global webhook route.
   * Returns null if not found or payload is not a valid Meta structure.
   */
  static extractPhoneNumberIdFromPayload(payload: unknown): string | null {
    try {
      const body = payload as Record<string, unknown>;
      if (body?.object !== 'whatsapp_business_account') return null;
      const entries = body.entry as Array<Record<string, unknown>>;
      const changes = entries?.[0]?.changes as Array<Record<string, unknown>>;
      const value = changes?.[0]?.value as Record<string, unknown>;
      const metadata = value?.metadata as Record<string, unknown> | undefined;
      return (metadata?.phone_number_id as string) ?? null;
    } catch {
      return null;
    }
  }
}

/**
 * EvolutionWhatsAppProvider.ts — Evolution API provider implementation.
 *
 * Wraps the existing Evolution API HTTP calls and exposes them through the
 * WhatsAppProvider interface. This is the ONLY file that talks directly to
 * Evolution API — all other code goes through whatsappService.ts.
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
import { getLegacyEvolutionConfig } from '../../utils/legacyWhatsApp.js';

const buildEvolutionSendTextUrl = (baseUrl: string, instanceName: string) =>
  `${baseUrl.replace(/\/$/, '')}/message/sendText/${encodeURIComponent(instanceName)}`;

const buildEvolutionFetchInstanceUrl = (baseUrl: string, instanceName: string) =>
  `${baseUrl.replace(/\/$/, '')}/instance/fetchInstances?instanceName=${encodeURIComponent(instanceName)}`;

const buildEvolutionQrCodeUrl = (baseUrl: string, instanceName: string) =>
  `${baseUrl.replace(/\/$/, '')}/instance/connect/${encodeURIComponent(instanceName)}`;

// Some Evolution API deployments use /instance/qrcode instead of /instance/connect
const buildEvolutionQrCodeAltUrl = (baseUrl: string, instanceName: string) =>
  `${baseUrl.replace(/\/$/, '')}/instance/qrcode/${encodeURIComponent(instanceName)}`;

const buildEvolutionLogoutUrl = (baseUrl: string, instanceName: string) =>
  `${baseUrl.replace(/\/$/, '')}/instance/logout/${encodeURIComponent(instanceName)}`;

function resolveCredentials(connection: WhatsAppConnectionRecord): {
  baseUrl: string;
  apiKey: string;
  instanceName: string;
} | null {
  // Primary source: DB connection record fields
  const dbBaseUrl = connection.evolutionApiUrl?.trim();
  const dbInstanceName = connection.evolutionInstanceName?.trim();

  // Per-field env fallback — only allowed when legacy fallback is enabled.
  // This covers partially-migrated records that have a DB row but were imported
  // before all fields were populated (e.g., URL stored, key stored via env).
  const legacy = getLegacyEvolutionConfig(); // null when fallback disabled

  const baseUrl = dbBaseUrl || legacy?.url;
  const instanceName = dbInstanceName || legacy?.instanceName;

  // Decrypt stored key; fall back to legacy env key only if fallback is enabled
  let apiKey: string | undefined;
  const rawKey = connection.evolutionApiKeyEncrypted?.trim();
  if (rawKey) {
    try {
      apiKey = decryptSecret(rawKey);
    } catch {
      // Legacy or test records may be stored unencrypted — accept as-is
      apiKey = rawKey;
    }
  } else {
    // No key in DB record — use env var only if fallback is permitted
    apiKey = legacy?.key;
  }

  if (!baseUrl || !apiKey || !instanceName) return null;
  return { baseUrl, apiKey, instanceName };
}

export class EvolutionWhatsAppProvider implements WhatsAppProvider {
  async sendMessage(
    connection: WhatsAppConnectionRecord,
    payload: SendMessagePayload,
  ): Promise<SendMessageResult> {
    const creds = resolveCredentials(connection);
    if (!creds) {
      return { success: false, error: 'Evolution API configuration is incomplete' };
    }

    try {
      const response = await fetch(buildEvolutionSendTextUrl(creds.baseUrl, creds.instanceName), {
        method: 'POST',
        headers: { apikey: creds.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ number: payload.phone, text: payload.text }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Evolution API sendText failed with ${response.status}: ${errorText}`,
        };
      }

      const data = await response.json().catch(() => ({}));
      const externalMessageId = (data as any)?.key?.id ?? null;
      return { success: true, externalMessageId };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Evolution API request error: ${msg}` };
    }
  }

  async testConnection(connection: WhatsAppConnectionRecord): Promise<TestConnectionResult> {
    const creds = resolveCredentials(connection);
    if (!creds) {
      return { success: false, message: 'Evolution API credentials are not configured' };
    }

    try {
      const response = await fetch(
        buildEvolutionFetchInstanceUrl(creds.baseUrl, creds.instanceName),
        { headers: { apikey: creds.apiKey } },
      );

      if (!response.ok) {
        return {
          success: false,
          message: `Evolution API test failed with status ${response.status}`,
        };
      }

      const data = await response.json().catch(() => ({}));
      const instances: unknown[] = Array.isArray(data) ? data : [];
      const instance = instances.find(
        (i) =>
          typeof i === 'object' &&
          i !== null &&
          (i as Record<string, unknown>).name === creds.instanceName,
      ) as Record<string, unknown> | undefined;

      const connected =
        instance?.connectionStatus === 'open' ||
        (instance?.instance as Record<string, unknown> | undefined)?.state === 'open';

      return {
        success: true,
        message: connected
          ? `Evolution API connected (${creds.instanceName})`
          : `Evolution API reachable but instance state: ${
              (instance?.connectionStatus ??
                (instance?.instance as Record<string, unknown> | undefined)?.state) ||
              'unknown'
            }`,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: `Evolution API connection test error: ${msg}` };
    }
  }

  async getQrCode(connection: WhatsAppConnectionRecord): Promise<QrCodeResult> {
    const creds = resolveCredentials(connection);
    if (!creds) {
      return { available: false, message: 'Evolution API credentials are not configured' };
    }

    // Try the primary endpoint first; fall back to the alternate path used by some deployments.
    const urlsToTry = [
      buildEvolutionQrCodeUrl(creds.baseUrl, creds.instanceName),
      buildEvolutionQrCodeAltUrl(creds.baseUrl, creds.instanceName),
    ];

    for (const url of urlsToTry) {
      try {
        const response = await fetch(url, { headers: { apikey: creds.apiKey } });

        // 404 or 405 → this path doesn't exist on this deployment; try the next one
        if (response.status === 404 || response.status === 405) continue;

        if (!response.ok) {
          return {
            available: false,
            message: `Evolution API QR fetch failed with status ${response.status}`,
          };
        }

        const data = await response.json().catch(() => ({})) as Record<string, unknown>;
        const qrcodeObj = data?.qrcode as Record<string, unknown> | undefined;
        const qrCode = (qrcodeObj?.base64 ?? data?.base64) as string | undefined ?? null;

        return {
          available: Boolean(qrCode),
          qrCode: typeof qrCode === 'string' ? qrCode : null,
          message: qrCode ? undefined : 'No QR code available — instance may already be connected',
        };
      } catch {
        // Network error on this URL — try the next one
        continue;
      }
    }

    return {
      available: false,
      message: 'QR endpoint is not available for this Evolution API deployment.',
    };
  }

  async disconnect(connection: WhatsAppConnectionRecord): Promise<void> {
    const creds = resolveCredentials(connection);
    if (!creds) return;

    await fetch(buildEvolutionLogoutUrl(creds.baseUrl, creds.instanceName), {
      method: 'DELETE',
      headers: { apikey: creds.apiKey },
    }).catch(() => {
      // Ignore logout errors — connection will be marked inactive regardless
    });
  }

  parseWebhook(payload: unknown, _connection: WhatsAppConnectionRecord): ParsedWebhookEvent {
    if (!payload || typeof payload !== 'object') {
      return { eventType: 'unknown', raw: payload };
    }

    const body = payload as Record<string, unknown>;
    const event = body.event as string | undefined;
    const data = body.data as Record<string, unknown> | undefined;

    if (event === 'messages.upsert' || event === 'messages.set') {
      const key = (data?.key ?? data?.message) as Record<string, unknown> | undefined;
      const msg = (data?.message ?? data) as Record<string, unknown> | undefined;
      const phone = (key?.remoteJid ?? data?.remoteJid ?? '') as string;
      const extMsg = msg?.extendedTextMessage as Record<string, unknown> | undefined;
      const text =
        ((msg?.conversation ?? extMsg?.text ?? '') as string) || '';
      const messageId = (key?.id ?? '') as string;

      return {
        eventType: 'message',
        phone: phone.replace(/@.+$/, '').replace(/\D/g, ''),
        text,
        messageId,
        raw: payload,
      };
    }

    if (event === 'messages.update') {
      const updateObj = (data as Record<string, unknown>)?.update as Record<string, unknown> | undefined;
      const status = (updateObj?.status ?? '') as string;
      return {
        eventType: 'status_update',
        status,
        raw: payload,
      };
    }

    return { eventType: 'unknown', raw: payload };
  }

  /**
   * Template messages are not natively supported by Evolution API in the same way
   * as Meta Cloud API. Evolution API may support custom template-like messages via
   * its own mechanisms, but this is not implemented in the current MVP.
   *
   * NOTE: If your Evolution API deployment supports template messages, implement
   * the send logic here using the Evolution API documentation.
   */
  async sendTemplateMessage(
    _connection: WhatsAppConnectionRecord,
    _payload: TemplateSendPayload,
  ): Promise<TemplateSendResult> {
    return {
      supported: false,
      error: 'Template messages are not implemented for Evolution API in this version.',
    };
  }
}

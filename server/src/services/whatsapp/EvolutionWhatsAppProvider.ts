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
} from './WhatsAppProvider.js';

const buildEvolutionSendTextUrl = (baseUrl: string, instanceName: string) =>
  `${baseUrl.replace(/\/$/, '')}/message/sendText/${encodeURIComponent(instanceName)}`;

const buildEvolutionFetchInstanceUrl = (baseUrl: string, instanceName: string) =>
  `${baseUrl.replace(/\/$/, '')}/instance/fetchInstances?instanceName=${encodeURIComponent(instanceName)}`;

const buildEvolutionQrCodeUrl = (baseUrl: string, instanceName: string) =>
  `${baseUrl.replace(/\/$/, '')}/instance/connect/${encodeURIComponent(instanceName)}`;

const buildEvolutionLogoutUrl = (baseUrl: string, instanceName: string) =>
  `${baseUrl.replace(/\/$/, '')}/instance/logout/${encodeURIComponent(instanceName)}`;

function resolveCredentials(connection: WhatsAppConnectionRecord): {
  baseUrl: string;
  apiKey: string;
  instanceName: string;
} | null {
  const baseUrl = connection.evolutionApiUrl?.trim() || process.env.EVOLUTION_API_BASE_URL?.trim();
  const apiKey = connection.evolutionApiKeyEncrypted?.trim() || process.env.EVOLUTION_API_KEY?.trim();
  const instanceName =
    connection.evolutionInstanceName?.trim() || process.env.EVOLUTION_INSTANCE_NAME?.trim();

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

    try {
      const response = await fetch(buildEvolutionQrCodeUrl(creds.baseUrl, creds.instanceName), {
        headers: { apikey: creds.apiKey },
      });

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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { available: false, message: `Evolution API QR request error: ${msg}` };
    }
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
}

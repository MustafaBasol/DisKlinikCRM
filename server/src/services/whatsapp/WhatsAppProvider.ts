/**
 * WhatsAppProvider.ts — Provider-Agnostic WhatsApp Interface
 *
 * All WhatsApp providers (Evolution API, Meta Cloud API, future) must implement
 * this interface. Core messaging code calls whatsappService, never providers directly.
 */

export type SendMessagePayload = {
  phone: string;
  text: string;
};

export type SendMessageResult = {
  success: boolean;
  externalMessageId?: string | null;
  error?: string;
};

export type TestConnectionResult = {
  success: boolean;
  message: string;
};

export type QrCodeResult = {
  available: boolean;
  qrCode?: string | null;
  message?: string;
};

export type ParsedWebhookEvent = {
  eventType: 'message' | 'status_update' | 'unknown';
  phone?: string;
  text?: string;
  messageId?: string;
  status?: string;
  timestamp?: number;
  raw: unknown;
};

/**
 * Minimal connection info needed by providers.
 * Full WhatsAppConnection Prisma record is accepted so providers can read all fields.
 */
export type WhatsAppConnectionRecord = {
  id: string;
  organizationId: string;
  provider: string;
  status: string;
  phoneNumber?: string | null;
  evolutionApiUrl?: string | null;
  evolutionInstanceName?: string | null;
  evolutionApiKeyEncrypted?: string | null;
  metaBusinessId?: string | null;
  metaWabaId?: string | null;
  metaPhoneNumberId?: string | null;
  metaAppId?: string | null;
  metaAccessTokenEncrypted?: string | null;
  metaWebhookVerifyToken?: string | null;
  metaWebhookSecret?: string | null;
  webhookSecret?: string | null;
  // Token lifecycle
  metaTokenStatus?: string | null;
  metaTokenExpiresAt?: Date | null;
  metaTokenLastCheckedAt?: Date | null;
};

export type TemplateSendPayload = {
  phone: string;
  templateName: string;
  languageCode: string;
  components?: unknown[];
};

export type TemplateSendResult = {
  supported: boolean;
  success?: boolean;
  externalMessageId?: string | null;
  error?: string;
};

export interface WhatsAppProvider {
  /** Send a text message. */
  sendMessage(
    connection: WhatsAppConnectionRecord,
    payload: SendMessagePayload,
  ): Promise<SendMessageResult>;

  /** Send a template message (for out-of-window / business-initiated messages). */
  sendTemplateMessage(
    connection: WhatsAppConnectionRecord,
    payload: TemplateSendPayload,
  ): Promise<TemplateSendResult>;

  /** Verify connectivity / credentials. */
  testConnection(connection: WhatsAppConnectionRecord): Promise<TestConnectionResult>;

  /** Get QR code for pairing (Evolution API). Optional on providers that don't use QR flow. */
  getQrCode?(connection: WhatsAppConnectionRecord): Promise<QrCodeResult>;

  /** Disconnect / logout the instance. Optional. */
  disconnect?(connection: WhatsAppConnectionRecord): Promise<void>;

  /** Parse an inbound webhook payload into a normalised event. */
  parseWebhook(payload: unknown, connection: WhatsAppConnectionRecord): ParsedWebhookEvent;
}

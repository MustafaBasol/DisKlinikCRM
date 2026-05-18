export type NormalizedWhatsAppMessage = {
  phone: string;
  name?: string;
  messageId?: string;
  instance?: string;
  text: string;
  rawPayload: Record<string, unknown>;
};

export type NormalizedEvolutionWebhookPayload = {
  event?: string;
  instance?: string;
  fromMe: boolean;
  message: NormalizedWhatsAppMessage | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const readString = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
};

const normalizePhone = (value: string) => value.replace(/@.+$/, '').replace(/\D/g, '');

export const normalizeEvolutionWebhookPayload = (payload: unknown): NormalizedEvolutionWebhookPayload => {
  const payloadRecord = isRecord(payload) ? payload : undefined;
  const envelope = payloadRecord && isRecord(payloadRecord.body) ? payloadRecord.body : payloadRecord;
  if (!isRecord(envelope)) {
    return { fromMe: false, message: null };
  }

  const data = isRecord(envelope.data) ? envelope.data : undefined;
  const key = data && isRecord(data.key) ? data.key : undefined;
  const message = data && isRecord(data.message) ? data.message : undefined;
  const extendedText = message && isRecord(message.extendedTextMessage) ? message.extendedTextMessage : undefined;
  const remoteJid = readString(key?.remoteJid, envelope.sender, data?.sender);
  const phone = remoteJid ? normalizePhone(remoteJid) : undefined;
  const text = readString(message?.conversation, extendedText?.text, envelope.message, envelope.text);
  const name = readString(data?.pushName, envelope.pushName);
  const instance = readString(envelope.instance);
  const messageId = readString(key?.id, data?.id, envelope.messageId, envelope.id);

  return {
    event: readString(envelope.event),
    instance,
    fromMe: key?.fromMe === true || envelope.fromMe === true,
    message: phone && text
      ? {
          phone,
          name,
          messageId,
          instance,
          text,
          rawPayload: envelope,
        }
      : null,
  };
};

export const getWebhookIgnoreReason = (payload: NormalizedEvolutionWebhookPayload) => {
  if (payload.event && payload.event !== 'messages.upsert') {
    return 'unsupported_event';
  }

  if (payload.fromMe) {
    return 'from_me';
  }

  if (!payload.message) {
    return 'no_text_message';
  }

  return null;
};

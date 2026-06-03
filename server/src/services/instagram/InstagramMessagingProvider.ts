/**
 * InstagramMessagingProvider.ts — Meta Graph API provider for Instagram DM
 *
 * Handles:
 *   - testConnection: validate token + instagramAccountId against Graph API
 *   - sendMessage:    send text reply to Instagram user via Messaging API
 *   - parseWebhook:   normalize raw Instagram webhook payload to common shape
 *   - disconnect:     mark connection as disconnected
 *
 * Security rules:
 *   - Tokens are NEVER logged or returned to clients.
 *   - All Graph API calls use server-side token only.
 *   - senderId / recipientId are stored as-is (IGSIDs); no phone numbers.
 *   - Cross-org safety is the caller's responsibility.
 */

import { decryptSecret } from '../../utils/encryption.js';

// ── Types ────────────────────────────────────────────────────────────────────

export type InstagramConnectionRecord = {
  id: string;
  organizationId: string;
  status?: string | null;
  instagramAccountId?: string | null;
  instagramUsername?: string | null;
  accessTokenEncrypted?: string | null;
  pageAccessTokenEncrypted?: string | null;
  webhookVerifyToken?: string | null;
  webhookSecret?: string | null;
  isActive?: boolean;
};

export type TestConnectionResult = {
  success: boolean;
  message: string;
  username?: string | null;
};

export type SendMessagePayload = {
  recipientIgsid: string;   // Instagram-scoped ID of the message recipient
  text: string;
};

export type SendMessageResult = {
  success: boolean;
  externalMessageId?: string | null;
  error?: string;
};

/**
 * Normalized event shape produced by parseWebhook().
 * Callers should check eventType before accessing optional fields.
 */
export type ParsedInstagramEvent = {
  eventType: 'message' | 'echo' | 'unsupported';
  channel: 'instagram';
  externalConversationId?: string | null;
  externalMessageId?: string | null;
  /** Instagram-scoped sender ID */
  senderId?: string | null;
  /** Instagram-scoped recipient ID (usually the page/account's IGSID) */
  recipientId?: string | null;
  /** Instagram page/account id from the webhook entry */
  pageId?: string | null;
  text?: string | null;
  timestamp?: number | null;
  /** Full raw entry payload for debugging / future field extraction */
  rawPayload: unknown;
};

const GRAPH_API_BASE = 'https://graph.facebook.com/v20.0';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Decrypt and return access token. Returns null if not configured. */
function resolveToken(conn: InstagramConnectionRecord): string | null {
  const encrypted = conn.accessTokenEncrypted || conn.pageAccessTokenEncrypted;
  if (!encrypted) return null;
  try {
    return decryptSecret(encrypted);
  } catch {
    return null;
  }
}

// ── Provider Methods ─────────────────────────────────────────────────────────

/**
 * testConnection — validate that the stored token can access the Instagram account.
 *
 * Calls GET /{instagramAccountId}?fields=username to check token validity.
 * Returns a safe status message; never exposes the token.
 */
export async function testConnection(
  conn: InstagramConnectionRecord,
): Promise<TestConnectionResult> {
  if (conn.isActive === false) {
    return { success: false, message: 'Instagram connection is inactive.' };
  }
  const token = resolveToken(conn);
  if (!token) {
    return { success: false, message: 'Access token is not configured.' };
  }
  if (!conn.instagramAccountId) {
    return { success: false, message: 'Instagram Account ID is not configured.' };
  }

  try {
    const url = `${GRAPH_API_BASE}/${encodeURIComponent(conn.instagramAccountId)}?fields=username&access_token=${token}`;
    const res = await fetch(url);
    const data = (await res.json()) as Record<string, unknown>;

    if (!res.ok) {
      const errMsg =
        (data?.error as Record<string, unknown>)?.message ?? `HTTP ${res.status}`;
      return { success: false, message: `Meta API error: ${errMsg}` };
    }

    const username = data.username as string | undefined;
    return {
      success: true,
      message: username
        ? `Connected as @${username}`
        : 'Connection successful (username not returned).',
      username: username ?? null,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, message: `Network error: ${msg}` };
  }
}

/**
 * sendMessage — send a text message to an Instagram DM recipient.
 *
 * Uses the Instagram Messaging API (send_message endpoint on the IG account).
 * The recipient must be within the applicable messaging window (Meta policy).
 */
export async function sendMessage(
  conn: InstagramConnectionRecord,
  payload: SendMessagePayload,
): Promise<SendMessageResult> {
  if (conn.isActive === false) {
    return { success: false, error: 'Instagram connection is inactive.' };
  }
  const token = resolveToken(conn);
  if (!token) {
    return { success: false, error: 'Access token is not configured.' };
  }
  if (!conn.instagramAccountId) {
    return { success: false, error: 'Instagram Account ID is not configured.' };
  }

  // Limit message length — Instagram has a 1000-char limit for DMs
  const text = payload.text.slice(0, 1000);

  try {
    const url = `${GRAPH_API_BASE}/${encodeURIComponent(conn.instagramAccountId)}/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: payload.recipientIgsid },
        message: { text },
        access_token: token,
      }),
    });

    const data = (await res.json()) as Record<string, unknown>;

    if (!res.ok) {
      const errMsg =
        (data?.error as Record<string, unknown>)?.message ?? `HTTP ${res.status}`;
      return { success: false, error: `Meta API error: ${errMsg}` };
    }

    const messageId = (data.message_id as string) ?? null;
    return { success: true, externalMessageId: messageId };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, error: `Network error: ${msg}` };
  }
}

/**
 * parseWebhook — normalize an Instagram webhook payload to a common shape.
 *
 * Instagram webhooks deliver an array of entries, each with a messaging array.
 * This function extracts the first relevant message event.
 *
 * Only text messages are supported in MVP; other types return eventType=unsupported.
 * Echo messages (from_me) are returned as eventType=echo.
 */
export function parseWebhook(rawBody: unknown): ParsedInstagramEvent[] {
  const events: ParsedInstagramEvent[] = [];

  if (!rawBody || typeof rawBody !== 'object') return events;

  const body = rawBody as Record<string, unknown>;
  const entries = Array.isArray(body.entry) ? body.entry : [];

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const entryObj = entry as Record<string, unknown>;
    const pageId = typeof entryObj.id === 'string' ? entryObj.id : null;
    const messaging = Array.isArray(entryObj.messaging) ? entryObj.messaging : [];

    for (const msg of messaging) {
      if (!msg || typeof msg !== 'object') continue;
      const msgObj = msg as Record<string, unknown>;

      const sender = (msgObj.sender as Record<string, unknown> | undefined)?.id as string | undefined;
      const recipient = (msgObj.recipient as Record<string, unknown> | undefined)?.id as string | undefined;
      const timestamp = typeof msgObj.timestamp === 'number' ? msgObj.timestamp : null;

      const messageData = msgObj.message as Record<string, unknown> | undefined;
      if (!messageData) continue;

      const externalMessageId = messageData.mid as string | undefined;
      const text = messageData.text as string | undefined;

      // Echo messages = messages sent by the page/account itself
      const isEcho = messageData.is_echo === true;

      if (isEcho) {
        events.push({
          eventType: 'echo',
          channel: 'instagram',
          externalMessageId: externalMessageId ?? null,
          senderId: sender ?? null,
          recipientId: recipient ?? null,
          pageId,
          text: text ?? null,
          timestamp,
          rawPayload: msgObj,
        });
        continue;
      }

      // Unsupported: no text (attachments, stickers, reactions, etc.)
      if (!text) {
        events.push({
          eventType: 'unsupported',
          channel: 'instagram',
          externalMessageId: externalMessageId ?? null,
          senderId: sender ?? null,
          recipientId: recipient ?? null,
          pageId,
          text: null,
          timestamp,
          rawPayload: msgObj,
        });
        continue;
      }

      events.push({
        eventType: 'message',
        channel: 'instagram',
        externalMessageId: externalMessageId ?? null,
        senderId: sender ?? null,
        recipientId: recipient ?? null,
        pageId,
        text,
        timestamp,
        rawPayload: msgObj,
      });
    }
  }

  return events;
}

/**
 * disconnect — mark the connection status as disconnected.
 * Actual token revocation must be done by the user via Meta Developer Dashboard.
 * Returns a safe informational message.
 */
export function disconnect(): { message: string } {
  return {
    message:
      'Connection marked as disconnected locally. To fully revoke access, remove the app from your Instagram/Facebook settings.',
  };
}

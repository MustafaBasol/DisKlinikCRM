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
  instagramLoginUserId?: string | null;
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
  instagramLoginUserId?: string | null;
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
  senderUsername?: string | null;
  /** Instagram-scoped recipient ID (usually the page/account's IGSID) */
  recipientId?: string | null;
  /** Instagram page/account id from the webhook entry */
  pageId?: string | null;
  text?: string | null;
  timestamp?: number | null;
  /** Full raw entry payload for debugging / future field extraction */
  rawPayload: unknown;
};

const FACEBOOK_GRAPH_API_BASE = 'https://graph.facebook.com/v20.0';
export const INSTAGRAM_LOGIN_GRAPH_API_BASE = 'https://graph.instagram.com/v25.0';
const INSTAGRAM_LOGIN_ME_FIELDS = 'id,username';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Decrypt and return access token. Returns null if not configured. */
function decryptToken(encrypted: string | null | undefined): string | null {
  if (!encrypted) return null;
  try {
    const token = decryptSecret(encrypted).trim();
    return token || null;
  } catch {
    return null;
  }
}

/** Decrypt and return access token. Returns null if not configured. */
function resolveToken(conn: InstagramConnectionRecord): ResolvedInstagramToken | null {
  const accessToken = decryptToken(conn.accessTokenEncrypted);
  if (accessToken) {
    return { token: accessToken, source: 'instagram_login' };
  }

  const pageAccessToken = decryptToken(conn.pageAccessTokenEncrypted);
  if (pageAccessToken) {
    return { token: pageAccessToken, source: 'facebook_page' };
  }

  return null;
}

type MetaResponseBody = Record<string, unknown> | string | null;

type MetaJsonResponse = {
  res: Response;
  body: MetaResponseBody;
};

type InstagramLoginTokenValidationResult = {
  success: boolean;
  message: string;
  instagramLoginUserId?: string | null;
  username?: string | null;
};

type ResolvedInstagramToken = {
  token: string;
  source: 'instagram_login' | 'facebook_page';
};

function tokenPrefix(token: string): string {
  return token.slice(0, 8);
}

function safeEndpointForLog(url: URL): string {
  const safeUrl = new URL(url.toString());
  safeUrl.searchParams.delete('access_token');
  return safeUrl.toString();
}

function redactMetaBody(value: unknown, token: string): unknown {
  if (typeof value === 'string') {
    return token ? value.split(token).join('[redacted-access-token]') : value;
  }
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(item => redactMetaBody(item, token));

  const redacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    redacted[key] = lowerKey.includes('token')
      ? '[redacted]'
      : redactMetaBody(entry, token);
  }
  return redacted;
}

async function readMetaResponseBody(res: Response): Promise<MetaResponseBody> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return text;
  }
}

async function fetchMetaJson(
  operation: string,
  url: URL,
  token: string,
  init?: RequestInit,
): Promise<MetaJsonResponse> {
  const endpoint = safeEndpointForLog(url);
  const diagnosticBase = {
    operation,
    endpoint,
    tokenPrefix: tokenPrefix(token),
    tokenLength: token.length,
  };

  console.info('[InstagramMeta] request', diagnosticBase);

  const res = await fetch(url, init);
  const body = await readMetaResponseBody(res);

  console.info('[InstagramMeta] response', {
    ...diagnosticBase,
    status: res.status,
  });

  if (!res.ok) {
    console.error('[InstagramMeta] error', {
      ...diagnosticBase,
      status: res.status,
      errorBody: redactMetaBody(body, token),
    });
  }

  return { res, body };
}

function getMetaErrorMessage(body: MetaResponseBody, status: number): string {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const error = (body as Record<string, unknown>).error;
    if (error && typeof error === 'object' && !Array.isArray(error)) {
      const message = (error as Record<string, unknown>).message;
      if (typeof message === 'string' && message.trim()) return message;
    }
    if (typeof error === 'string' && error.trim()) return error;
  }
  return `HTTP ${status}`;
}

function buildInstagramLoginMeUrl(token: string): URL {
  const url = new URL(`${INSTAGRAM_LOGIN_GRAPH_API_BASE}/me`);
  url.searchParams.set('fields', INSTAGRAM_LOGIN_ME_FIELDS);
  url.searchParams.set('access_token', token);
  return url;
}

export async function validateInstagramLoginToken(
  rawToken: string,
): Promise<InstagramLoginTokenValidationResult> {
  const token = rawToken.trim();
  if (!token) {
    return { success: false, message: 'Access token is not configured.' };
  }

  try {
    const { res, body } = await fetchMetaJson(
      'instagram_login_validate',
      buildInstagramLoginMeUrl(token),
      token,
    );

    if (!res.ok) {
      return { success: false, message: `Meta API error: ${getMetaErrorMessage(body, res.status)}` };
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { success: false, message: 'Instagram API response was not valid JSON.' };
    }

    const instagramLoginUserId = typeof body.id === 'string' ? body.id : null;
    const username = typeof body.username === 'string' ? body.username : null;
    if (!instagramLoginUserId) {
      return { success: false, message: 'Instagram API response did not include an account id.' };
    }

    return {
      success: true,
      message: username ? `Connected as @${username}` : 'Connection successful (username not returned).',
      instagramLoginUserId,
      username,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, message: `Network error: ${msg}` };
  }
}

// ── Provider Methods ─────────────────────────────────────────────────────────

/**
 * testConnection — validate that the stored token can access the Instagram account.
 *
 * Calls graph.instagram.com /me with id,username for Instagram Login tokens.
 * Returns a safe status message; never exposes the token.
 */
export async function testConnection(
  conn: InstagramConnectionRecord,
): Promise<TestConnectionResult> {
  if (conn.isActive === false) {
    return { success: false, message: 'Instagram connection is inactive.' };
  }
  const resolvedToken = resolveToken(conn);
  if (!resolvedToken) {
    return { success: false, message: 'Access token is not configured.' };
  }

  const result = await validateInstagramLoginToken(resolvedToken.token);
  if (!result.success) return result;

  return result;
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
  const resolvedToken = resolveToken(conn);
  if (!resolvedToken) {
    return { success: false, error: 'Access token is not configured.' };
  }
  if (!conn.instagramAccountId) {
    return { success: false, error: 'Instagram Account ID is not configured.' };
  }

  // Limit message length — Instagram has a 1000-char limit for DMs
  const text = payload.text.trim().slice(0, 1000);
  if (!text) {
    return { success: false, error: 'Message text is required.' };
  }

  try {
    const graphBase = resolvedToken.source === 'instagram_login'
      ? INSTAGRAM_LOGIN_GRAPH_API_BASE
      : FACEBOOK_GRAPH_API_BASE;
    const url = new URL(`${graphBase}/${encodeURIComponent(conn.instagramAccountId)}/messages`);
    const { res, body } = await fetchMetaJson('instagram_send_message', url, resolvedToken.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: payload.recipientIgsid },
        message: { text },
        access_token: resolvedToken.token,
      }),
    });

    if (!res.ok) {
      const errMsg = getMetaErrorMessage(body, res.status);
      return { success: false, error: `Meta API error: ${errMsg}` };
    }

    const data = body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
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

      const senderObj = msgObj.sender as Record<string, unknown> | undefined;
      const sender = senderObj?.id as string | undefined;
      const senderUsername =
        typeof senderObj?.username === 'string'
          ? senderObj.username
          : typeof senderObj?.name === 'string'
          ? senderObj.name
          : null;
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
          senderUsername,
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
          senderUsername,
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
        senderUsername,
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

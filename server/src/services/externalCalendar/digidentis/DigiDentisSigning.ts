/**
 * DigiDentisSigning.ts — DigiDentiS v3.2.0 per-request HMAC authentication
 * and webhook signature verification.
 *
 * IMPORTANT / KNOWN LIMITATION: no publicly reachable copy of the DigiDentiS
 * Takvim API v3.2.0 documentation could be located for this task (searched
 * the web; nothing under the DigiDentiS name matches a dental-calendar API).
 * The header names and algorithm below (X-Client-ID / X-Timestamp / X-Nonce
 * / X-Signature, HMAC-SHA256 keyed by the clinic's Client Secret) are exactly
 * what was specified for this task and are treated as authoritative. The
 * earlier OAuth2 client-credentials scheme this module used to implement was
 * a wrong assumption and has been removed entirely (see DigiDentisAuthClient
 * deletion). What remains unverified against a real spec — because no such
 * spec was available — is the byte-for-byte signing-string layout (field
 * order/separators), so it is isolated here, exactly as before, so it can be
 * corrected without touching call sites. Do not treat the signing-string
 * layout as verified against a real DigiDentiS deployment.
 *
 * Request authentication (every non-webhook API call):
 *   X-Client-ID: <clinic's DigiDentiS client id>            (plaintext, not secret)
 *   X-Timestamp: <unix epoch milliseconds, decimal string>
 *   X-Nonce:     <32 hex chars / 16 random bytes, unique per request>
 *   X-Signature: hex(HMAC-SHA256(clientSecret, signingString))
 *   signingString = `${METHOD}\n${path}\n${timestamp}\n${nonce}\n${sha256Hex(body)}`
 *   - `path` is the request path only (no scheme/host/query).
 *   - `body` is the *exact* byte sequence sent as the HTTP request body — the
 *     caller (DigiDentisApiClient.ts) must sign the same Buffer it transmits,
 *     never a re-serialization of it.
 *   - There is no Authorization/Bearer header — HMAC signing IS the auth.
 *
 * Webhook signatures: HMAC-SHA256 over the exact raw request body, keyed by
 * the clinic's webhook secret, sent as `X-Webhook-Signature: <hex>` and
 * verified with a constant-time comparison.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

export function sha256Hex(input: Buffer | string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** 16 random bytes as 32 lowercase hex chars — unique per outgoing request. */
export function generateDigiDentisNonce(): string {
  return randomBytes(16).toString('hex');
}

export function buildDigiDentisSigningString(
  method: string,
  path: string,
  timestamp: string,
  nonce: string,
  bodyHash: string,
): string {
  return `${method.toUpperCase()}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`;
}

export type DigiDentisSignedHeaders = {
  'X-Client-ID': string;
  'X-Timestamp': string;
  'X-Nonce': string;
  'X-Signature': string;
};

/**
 * Signs a single DigiDentiS API request. `path` must be the request path
 * only (no scheme/host/query). `body` must be the exact Buffer transmitted
 * as the HTTP request body (or an empty Buffer for bodyless requests) — the
 * signature is only valid if the signed bytes match the sent bytes exactly.
 */
export function signDigiDentisRequest(
  clientId: string,
  clientSecret: string,
  method: string,
  path: string,
  body: Buffer,
  timestampMs: number = Date.now(),
  nonce: string = generateDigiDentisNonce(),
): DigiDentisSignedHeaders {
  const timestamp = String(timestampMs);
  const bodyHash = sha256Hex(body);
  const signingString = buildDigiDentisSigningString(method, path, timestamp, nonce, bodyHash);
  const signature = createHmac('sha256', clientSecret).update(signingString).digest('hex');
  return {
    'X-Client-ID': clientId,
    'X-Timestamp': timestamp,
    'X-Nonce': nonce,
    'X-Signature': signature,
  };
}

/** Constant-time comparison — never short-circuits on the first mismatching byte. */
function constantTimeEquals(a: string, b: string): boolean {
  try {
    if (a.length !== b.length) return false;
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return a === b;
  }
}

/**
 * Verifies an inbound DigiDentiS webhook signature. `signatureHeader` is the
 * raw `X-Webhook-Signature` header value — a lowercase hex HMAC-SHA256
 * digest of the exact raw request body, keyed by the clinic's webhook
 * secret. Returns false (never throws) on any mismatch, missing header, or
 * missing secret.
 */
export function verifyDigiDentisWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  webhookSecret: string,
): boolean {
  if (!signatureHeader || !webhookSecret) return false;
  const expected = createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
  return constantTimeEquals(expected.toLowerCase(), signatureHeader.trim().toLowerCase());
}

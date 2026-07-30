/**
 * DigiDentisSigning.ts — DigiDentiS v3.2.0 authentication & request signing.
 *
 * IMPORTANT / KNOWN LIMITATION: the DigiDentiS v3.2.0 API documentation
 * referenced by this task was not available in this repository or the task
 * materials at implementation time. The scheme below is a best-practice
 * placeholder — OAuth2 client-credentials for bearer auth, plus HMAC-SHA256
 * request signing modeled on this codebase's existing Meta/WhatsApp webhook
 * verification (utils/webhookVerification.ts, routes/metaWhatsAppWebhook.ts)
 * — deliberately isolated in this single module so it can be replaced with
 * the exact v3.2.0 header names/canonicalization once the real spec is
 * available, without touching DigiDentisApiClient.ts's call sites or any
 * business logic. Do not treat this as verified against a real DigiDentiS
 * deployment.
 *
 * Assumed scheme:
 *   - Authorization: Bearer <access_token>            (see DigiDentisAuthClient.ts)
 *   - X-DigiDentiS-Client-Id: <clientId>
 *   - X-DigiDentiS-Timestamp: <unix ms>
 *   - X-DigiDentiS-Signature: HMAC-SHA256(clientSecret, canonicalString), hex
 *   canonicalString = `${METHOD}\n${path}\n${timestamp}\n${sha256Hex(body)}`
 *
 * Webhook signatures are verified the same way the codebase already
 * verifies Meta's X-Hub-Signature-256: HMAC-SHA256 over the raw body with
 * the clinic's configured webhook secret, constant-time compared.
 */

import { createHash, createHmac, timingSafeEqual } from 'crypto';

export function sha256Hex(input: Buffer | string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function buildDigiDentisCanonicalString(
  method: string,
  path: string,
  timestamp: string,
  bodyHash: string,
): string {
  return `${method.toUpperCase()}\n${path}\n${timestamp}\n${bodyHash}`;
}

export type DigiDentisSignedHeaders = {
  'X-DigiDentiS-Client-Id': string;
  'X-DigiDentiS-Timestamp': string;
  'X-DigiDentiS-Signature': string;
};

/**
 * Signs a single DigiDentiS API request. `path` must be the request path
 * only (no scheme/host/query), matching what the server is assumed to
 * canonicalize on its side.
 */
export function signDigiDentisRequest(
  clientId: string,
  clientSecret: string,
  method: string,
  path: string,
  body: Buffer,
  timestampMs: number = Date.now(),
): DigiDentisSignedHeaders {
  const timestamp = String(timestampMs);
  const bodyHash = sha256Hex(body);
  const canonical = buildDigiDentisCanonicalString(method, path, timestamp, bodyHash);
  const signature = createHmac('sha256', clientSecret).update(canonical).digest('hex');
  return {
    'X-DigiDentiS-Client-Id': clientId,
    'X-DigiDentiS-Timestamp': timestamp,
    'X-DigiDentiS-Signature': signature,
  };
}

/**
 * Constant-time comparison helper, mirroring
 * routes/metaWhatsAppWebhook.ts's validateHubSignature.
 */
function constantTimeEquals(a: string, b: string): boolean {
  try {
    if (a.length !== b.length) return false;
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return a === b;
  }
}

/**
 * Verifies an inbound DigiDentiS webhook signature. `signatureHeader` is
 * expected in `sha256=<hex>` form (same convention as Meta's
 * X-Hub-Signature-256). Returns false (never throws) on any mismatch,
 * missing header, or missing secret.
 */
export function verifyDigiDentisWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  webhookSecret: string,
): boolean {
  if (!signatureHeader || !webhookSecret) return false;
  const expected = `sha256=${createHmac('sha256', webhookSecret).update(rawBody).digest('hex')}`;
  return constantTimeEquals(expected, signatureHeader);
}

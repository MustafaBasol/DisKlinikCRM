/**
 * DigiDentisSigning.ts — DigiDentiS Takvim API v3.2.0 per-request HMAC
 * authentication and webhook signature verification.
 *
 * Verified against the real vendor documentation
 * (`docs/vendor/digidentis/DigiDentiS_Takvim_API_Documentation_v3.2.html`,
 * §2 "Authentication", §3 "Request Headers", §4 "Signature Calculation",
 * §11.4 "Signature Verification"). Nothing below is a placeholder.
 *
 * Request authentication (every API call, including the health check):
 *   X-Client-ID: <clinic's DigiDentiS client id>            (plaintext, not secret)
 *   X-Timestamp: <unix epoch SECONDS, decimal string>       (must be within 5 min of server time)
 *   X-Nonce:     <unique per request — 32 hex chars / 16 random bytes, per the vendor's own PHP reference>
 *   X-Signature: hex(HMAC-SHA256(signingString, clientSecret))
 *
 *   body_hash      = SHA256(request_body)              — hex; empty string for a bodyless request
 *   signing_string = `${timestamp}.${nonce}.${method}.${path}.${body_hash}`   — DOT-separated, this exact field order
 *   signature      = HMAC-SHA256(signing_string, client_secret)              — hex
 *
 *   - `path` is the endpoint path RELATIVE TO THE BASE URL: no scheme/host,
 *     no leading slash, and — critically — NO QUERY STRING. A GET request
 *     with query parameters (e.g. pagination, `?reason=...` on cancel) signs
 *     only the bare path; the query string is never part of the signature.
 *   - `body` is the *exact* byte sequence sent as the HTTP request body — the
 *     caller (DigiDentisApiClient.ts) must sign the same Buffer it transmits,
 *     never a re-serialization of it.
 *   - There is no Authorization/Bearer header and no token endpoint —
 *     HMAC signing IS the auth, on every single request independently.
 *
 * Worked example straight from the vendor doc (§4), used verbatim as a
 * fixture in digidentisSigning.test.ts:
 *   timestamp = 1736694000, nonce = 550e8400-e29b-41d4-a716-446655440000,
 *   method = GET, path = companies, body = "" (bodyHash = SHA256("") =
 *   e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855)
 *   → signing_string =
 *   "1736694000.550e8400-e29b-41d4-a716-446655440000.GET.companies.e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
 *
 * Webhook signatures (§11.4): HMAC-SHA256 over the exact raw request body,
 * keyed by the clinic's webhook secret, sent as
 * `X-Webhook-Signature: sha256=<hex-digest>` (the `sha256=` prefix is part
 * of the documented format, not a bare hex digest) and verified with a
 * constant-time comparison of the full, prefixed string.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

export function sha256Hex(input: Buffer | string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * 16 random bytes as 32 lowercase hex chars — matches the vendor doc's own
 * PHP reference implementation exactly (`bin2hex(random_bytes(16))`, §4
 * "PHP Example"). The prose elsewhere ("UUID v4 recommended") describes an
 * acceptable entropy source, not a mandated dashed-UUID string format; the
 * doc's own reference code does not produce dashes, so neither do we.
 */
export function generateDigiDentisNonce(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Builds the exact documented signing string:
 * `${timestamp}.${nonce}.${method}.${path}.${bodyHash}` — dot-separated,
 * in this field order. `path` must already be relative to the base URL,
 * with no leading slash and no query string (see this file's header
 * comment); `method` is upper-cased defensively (the doc's examples are
 * already upper-case).
 */
export function buildDigiDentisSigningString(
  timestamp: string,
  nonce: string,
  method: string,
  path: string,
  bodyHash: string,
): string {
  return `${timestamp}.${nonce}.${method.toUpperCase()}.${path}.${bodyHash}`;
}

export type DigiDentisSignedHeaders = {
  'X-Client-ID': string;
  'X-Timestamp': string;
  'X-Nonce': string;
  'X-Signature': string;
};

/**
 * Signs a single DigiDentiS API request. `path` must already be relative to
 * the base URL — no scheme/host, no leading slash, no query string (see
 * this file's header comment; DigiDentisApiClient.ts is responsible for
 * passing the correctly canonicalized path). `body` must be the exact
 * Buffer transmitted as the HTTP request body (or an empty Buffer for
 * bodyless requests) — the signature is only valid if the signed bytes
 * match the sent bytes exactly. `timestampSeconds` defaults to the current
 * Unix time in SECONDS (the vendor doc's `X-Timestamp` is seconds, not
 * milliseconds — its own example, `1736694000`, is a 10-digit value).
 */
export function signDigiDentisRequest(
  clientId: string,
  clientSecret: string,
  method: string,
  path: string,
  body: Buffer,
  timestampSeconds: number = Math.floor(Date.now() / 1000),
  nonce: string = generateDigiDentisNonce(),
): DigiDentisSignedHeaders {
  const timestamp = String(timestampSeconds);
  const bodyHash = sha256Hex(body);
  const signingString = buildDigiDentisSigningString(timestamp, nonce, method, path, bodyHash);
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
 * raw `X-Webhook-Signature` header value, expected in the documented
 * `sha256=<hex-digest>` form (§11.4) — NOT a bare hex digest. Returns false
 * (never throws) on any mismatch, missing header, missing secret, or a
 * header that lacks the `sha256=` prefix entirely.
 */
export function verifyDigiDentisWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  webhookSecret: string,
): boolean {
  if (!signatureHeader || !webhookSecret) return false;
  const expected = `sha256=${createHmac('sha256', webhookSecret).update(rawBody).digest('hex')}`;
  return constantTimeEquals(expected, signatureHeader.trim());
}

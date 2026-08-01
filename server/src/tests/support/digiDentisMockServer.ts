/**
 * digiDentisMockServer.ts — test-only, real-listening HTTP double for the
 * DigiDentiS Takvim API v3.2.0 (`docs/vendor/digidentis/DigiDentiS_Takvim_API_Documentation_v3.2.html`).
 *
 * This is a CONTRACT double, not a reimplementation of NoraMedi's business
 * logic: it never touches Prisma, never applies clinic/appointment domain
 * rules, and does not attempt to reproduce DigiDentiS's real rate-limit
 * counters or booking engine. It exists only so digidentisE2EContract.test.ts
 * can point the REAL, unmodified `DigiDentisApiClient.ts` at a real `http://`
 * origin (via `fetch`, not an injected fake) and observe what actually goes
 * over the wire — headers, signing string inputs, query handling, bodies —
 * while returning exactly the documented envelope/error shapes.
 *
 * CRYPTOGRAPHIC INDEPENDENCE: this file deliberately does NOT import
 * `sha256Hex`, `buildDigiDentisSigningString`, `signDigiDentisRequest`, or
 * any other helper from NoraMedi's production `DigiDentisSigning.ts` (or
 * anywhere else under `services/externalCalendar/`). It reimplements
 * signature verification from scratch, directly from the vendor's own
 * documentation (`docs/vendor/digidentis/DigiDentiS_Takvim_API_Documentation_v3.2.html`,
 * §3 "Request Headers", §4 "Signature Calculation"), using only
 * `node:crypto` primitives. This is not "duplicating business logic" —
 * it is the whole point of the harness: if NoraMedi's real signing code
 * ever silently drifted from the vendor spec (wrong field order, wrong
 * separator, milliseconds instead of seconds, a signed path that still
 * carries the base prefix or a query string, a body hash of something
 * other than the exact bytes sent, or a non-hex signature encoding),
 * sharing one signing helper between the client under test and this mock
 * would make both sides agree on the same wrong thing and the bug would
 * never surface here. Two independently-written implementations of the
 * same spec disagreeing is real signal; two calls into the same function
 * agreeing is not.
 *
 * Quoted directly from the vendor doc, §4 "Signature Calculation":
 *   Step 1: body_hash = SHA256(request_body)            ("" for a bodyless GET)
 *   Step 2: signing_string = timestamp + '.' + nonce + '.' + method + '.' + path + '.' + body_hash
 *   Step 3: signature = HMAC-SHA256(signing_string, client_secret)
 *   "Important — what `path` is: the endpoint path relative to the base
 *   URL, with no leading slash and no query string. The base URL prefix
 *   (`/Api/v1/external_booking`) is removed before signing."
 * And from §3 "Request Headers": `X-Timestamp` is a "Unix timestamp in
 * seconds (must be within 5 minutes of server time)"; `X-Nonce` is a
 * "Unique request ID ... prevents replay attacks".
 *
 * The vendor doc's own worked example (§4 "Example") is reproduced verbatim
 * below as VENDOR_WORKED_EXAMPLE and self-checked against this file's
 * independent implementation at import time (see assertVendorWorkedExample
 * below) — if this reimplementation ever drifts from the documented
 * algorithm, every test importing this module fails immediately, not just
 * whichever assertion happens to exercise the drifted code path.
 *
 * Scenario triggers (deterministic, sentinel-id based — see the exported
 * FIXTURE_ and _TEST_CLIENT_ID constants below) exist for every negative-path
 * scenario the harness needs to prove the real client handles correctly:
 * invalid signature, stale timestamp, reused nonce, missing IP
 * authorization, validation error, rate limiting, SLOT_NOT_AVAILABLE, a
 * one-time transient 5xx, and idempotent repeated appointment creation.
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash, createHmac } from 'node:crypto';

const BASE_PATH_PREFIX = '/Api/v1/external_booking/';
const TIMESTAMP_SKEW_SECONDS = 300; // vendor doc §3: "must be within 5 minutes"

// ── Independent verifier — reimplemented from the vendor spec, not shared
// with NoraMedi's production signing code (see file header). ──────────────

/** Vendor doc §4 "Example" — reproduced verbatim as a fixed fixture. */
const VENDOR_WORKED_EXAMPLE = {
  timestamp: '1736694000',
  nonce: '550e8400-e29b-41d4-a716-446655440000',
  method: 'GET',
  path: 'companies',
  body: '',
  expectedBodyHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  expectedSigningString:
    '1736694000.550e8400-e29b-41d4-a716-446655440000.GET.companies.' +
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
} as const;

/** §4 Step 1: `body_hash = SHA256(request_body)`, hex-encoded. */
function independentSha256Hex(input: Buffer | string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * §4 Step 2: `signing_string = timestamp + '.' + nonce + '.' + method + '.' +
 * path + '.' + body_hash` — dot-separated, this exact field order. `path`
 * must already be relative to the base URL, with no leading slash and no
 * query string (see file header).
 */
function independentBuildSigningString(
  timestamp: string,
  nonce: string,
  method: string,
  path: string,
  bodyHash: string,
): string {
  return `${timestamp}.${nonce}.${method.toUpperCase()}.${path}.${bodyHash}`;
}

/** §4 Step 3: `signature = HMAC-SHA256(signing_string, client_secret)`, hex-encoded. */
function independentSign(secret: string, signingString: string): string {
  return createHmac('sha256', secret).update(signingString).digest('hex');
}

/**
 * Fails loudly at import time if this file's independent reimplementation
 * of the vendor algorithm ever disagrees with the vendor doc's own worked
 * example — the whole harness is worthless if this drifts silently.
 */
function assertVendorWorkedExample(): void {
  const bodyHash = independentSha256Hex(VENDOR_WORKED_EXAMPLE.body);
  if (bodyHash !== VENDOR_WORKED_EXAMPLE.expectedBodyHash) {
    throw new Error(
      `digiDentisMockServer: independent body-hash implementation does not match the vendor doc §4 worked example ` +
        `(expected ${VENDOR_WORKED_EXAMPLE.expectedBodyHash}, got ${bodyHash})`,
    );
  }
  const signingString = independentBuildSigningString(
    VENDOR_WORKED_EXAMPLE.timestamp,
    VENDOR_WORKED_EXAMPLE.nonce,
    VENDOR_WORKED_EXAMPLE.method,
    VENDOR_WORKED_EXAMPLE.path,
    bodyHash,
  );
  if (signingString !== VENDOR_WORKED_EXAMPLE.expectedSigningString) {
    throw new Error(
      `digiDentisMockServer: independent signing-string implementation does not match the vendor doc §4 worked example ` +
        `(expected "${VENDOR_WORKED_EXAMPLE.expectedSigningString}", got "${signingString}")`,
    );
  }
}

assertVendorWorkedExample();

// ── Registered test credentials (fixtures, not real secrets) ───────────────

export const DIGIDENTIS_TEST_CLIENT_ID = 'dpapi_client_test_ok_0000000000000001';
export const DIGIDENTIS_TEST_CLIENT_SECRET = 'dpapi_secret_test_ok_sentinel_0000001';

/** Registered credentials whose IP is deliberately not whitelisted server-side
 *  (vendor doc §2/§8: 403 IP_NOT_ALLOWED) — a valid client id/secret pair
 *  that still cannot authenticate from this "origin". */
export const DIGIDENTIS_IP_BLOCKED_CLIENT_ID = 'dpapi_client_test_ip_blocked_00002';
export const DIGIDENTIS_IP_BLOCKED_CLIENT_SECRET = 'dpapi_secret_test_ip_blocked_00002';

const CREDENTIALS = new Map<string, string>([
  [DIGIDENTIS_TEST_CLIENT_ID, DIGIDENTIS_TEST_CLIENT_SECRET],
  [DIGIDENTIS_IP_BLOCKED_CLIENT_ID, DIGIDENTIS_IP_BLOCKED_CLIENT_SECRET],
]);

// ── Fixture data ─────────────────────────────────────────────────────────

export const FIXTURE_COMPANY_ID = 'company_1';
export const FIXTURE_CLINIC_ID = 'clinic_ext_1';
export const FIXTURE_DOCTOR_ID = 'doctor_1';
export const FIXTURE_TREATMENT_TYPE_ID = 'treatment_1';
export const FIXTURE_SLOT_DATE = '2026-08-10';

/** Any request whose path contains this company id always returns 429
 *  RATE_LIMIT_EXCEEDED (vendor doc §5.4) — a deterministic trigger, not a
 *  reimplementation of DigiDentiS's real token-bucket counters. */
export const RATE_LIMITED_COMPANY_ID = 'company_rate_limited';

/** The first request under this company id returns 500 INTERNAL_ERROR; every
 *  subsequent request succeeds normally — models a one-time transient
 *  provider outage a caller should be able to retry past. */
export const FLAKY_COMPANY_ID = 'company_flaky_5xx';

/** create-appointment payloads with this treatment type always return 409
 *  SLOT_NOT_AVAILABLE (vendor doc §8). */
export const SLOT_CONFLICT_TREATMENT_TYPE_ID = 'treatment_conflict_slot_taken';

/** An X-Idempotency-Key with this prefix fails with 500 INTERNAL_ERROR on its
 *  first attempt (nothing created/cached), then succeeds normally on a
 *  retry with the SAME key — proving a caller can safely retry a failed
 *  create-appointment call using its own idempotency key. */
export const FLAKY_ONCE_IDEMPOTENCY_KEY_PREFIX = 'flaky-once:';

type AppointmentRecord = { id: string; status: string; [key: string]: unknown };

type MockServerState = {
  usedNonces: Set<string>;
  flakyAttempted: Set<string>;
  idempotencyCache: Map<string, AppointmentRecord>;
  appointments: Map<string, AppointmentRecord>;
  appointmentSeq: number;
  requestLog: Array<{ method: string; path: string; clientId: string | null }>;
};

function freshState(): MockServerState {
  return {
    usedNonces: new Set(),
    flakyAttempted: new Set(),
    idempotencyCache: new Map(),
    appointments: new Map(),
    appointmentSeq: 0,
    requestLog: [],
  };
}

function envelope(data: unknown) {
  return JSON.stringify({ success: true, data, meta: { request_id: `req_${Date.now()}`, api_version: '3.2.0' } });
}

function errorEnvelope(code: string, message: string) {
  return JSON.stringify({ success: false, error: { code, message }, meta: { request_id: `req_${Date.now()}` } });
}

function headerValue(req: http.IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

export type DigiDentisMockServer = {
  port: number;
  /** `http://127.0.0.1:<port>/Api/v1/external_booking` — mirrors the
   *  documented base URL's own path prefix so path-join/signing behave
   *  exactly as they would against the real vendor host. */
  baseUrl: string;
  requestLog: MockServerState['requestLog'];
  /** Introspection for idempotency assertions — how many distinct
   *  appointments were actually created server-side (never how many create
   *  *requests* were received, which is the whole point of the assertion). */
  getAppointmentCount(): number;
  close(): Promise<void>;
};

export async function startDigiDentisMockServer(): Promise<DigiDentisMockServer> {
  const state = freshState();

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        handleRequest(req, res, Buffer.concat(chunks), state);
      } catch (err) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(errorEnvelope('INTERNAL_ERROR', `mock server crashed: ${(err as Error).message}`));
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;

  return {
    port: address.port,
    baseUrl: `http://127.0.0.1:${address.port}${BASE_PATH_PREFIX}`,
    requestLog: state.requestLog,
    getAppointmentCount: () => state.appointments.size,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse, rawBody: Buffer, state: MockServerState) {
  const method = (req.method ?? 'GET').toUpperCase();
  const fullUrl = new URL(req.url ?? '/', 'http://mock-digidentis.invalid');

  if (!fullUrl.pathname.startsWith(BASE_PATH_PREFIX)) {
    return send(res, 404, errorEnvelope('NOT_FOUND', 'Unknown base path'));
  }
  // Signing path per vendor doc §4: relative to the base URL, no leading
  // slash, no query string.
  const path = fullUrl.pathname.slice(BASE_PATH_PREFIX.length);

  const clientId = headerValue(req, 'x-client-id') ?? null;
  const timestamp = headerValue(req, 'x-timestamp') ?? null;
  const nonce = headerValue(req, 'x-nonce') ?? null;
  const signature = headerValue(req, 'x-signature') ?? null;
  const idempotencyKey = headerValue(req, 'x-idempotency-key') ?? null;

  state.requestLog.push({ method, path, clientId });

  if (!clientId) return send(res, 401, errorEnvelope('AUTH_MISSING_CLIENT_ID', 'X-Client-ID header is required'));
  if (!timestamp) return send(res, 401, errorEnvelope('TIMESTAMP_MISSING', 'X-Timestamp header is required'));
  if (!nonce) return send(res, 401, errorEnvelope('NONCE_MISSING', 'X-Nonce header is required'));
  if (!signature) return send(res, 401, errorEnvelope('SIGNATURE_MISSING', 'X-Signature header is required'));

  // IP whitelist check (vendor doc §2/§8) happens ahead of HMAC verification —
  // a real gateway rejects a disallowed origin before spending a computation
  // on signature checking.
  if (clientId === DIGIDENTIS_IP_BLOCKED_CLIENT_ID) {
    return send(res, 403, errorEnvelope('IP_NOT_ALLOWED', 'IP address not in whitelist for this client'));
  }

  const secret = CREDENTIALS.get(clientId);
  if (!secret) {
    return send(res, 401, errorEnvelope('SIGNATURE_INVALID', 'Unknown client id'));
  }

  const now = Math.floor(Date.now() / 1000);
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > TIMESTAMP_SKEW_SECONDS) {
    return send(res, 401, errorEnvelope('TIMESTAMP_EXPIRED', 'X-Timestamp is outside the 5-minute allowed skew'));
  }

  const nonceKey = `${clientId}:${nonce}`;
  if (state.usedNonces.has(nonceKey)) {
    return send(res, 401, errorEnvelope('NONCE_USED', 'This nonce has already been used'));
  }

  const bodyHash = independentSha256Hex(rawBody);
  const signingString = independentBuildSigningString(timestamp, nonce, method, path, bodyHash);
  const expectedSignature = independentSign(secret, signingString);
  if (expectedSignature !== signature) {
    return send(res, 401, errorEnvelope('SIGNATURE_INVALID', 'Request signature verification failed'));
  }

  // Only mark the nonce consumed once the request is otherwise fully
  // authenticated — an unsigned/mis-signed request must never burn a nonce.
  state.usedNonces.add(nonceKey);

  if (path.includes(RATE_LIMITED_COMPANY_ID)) {
    return send(res, 429, errorEnvelope('RATE_LIMIT_EXCEEDED', 'Too many requests'), {
      'Retry-After': '2',
      'X-RateLimit-Limit': '120',
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': String(now + 2),
      'X-RateLimit-Scope': 'endpoint',
      'X-RateLimit-Endpoint': path,
    });
  }

  if (path.includes(FLAKY_COMPANY_ID)) {
    const attemptKey = `${clientId}:${method}:${path}`;
    if (!state.flakyAttempted.has(attemptKey)) {
      state.flakyAttempted.add(attemptKey);
      return send(res, 500, errorEnvelope('INTERNAL_ERROR', 'Temporary server error, please retry'));
    }
  }

  let parsedBody: Record<string, unknown> | null = null;
  if (rawBody.length > 0) {
    try {
      parsedBody = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return send(res, 400, errorEnvelope('MISSING_FIELD', 'Request body is not valid JSON'));
    }
  }

  return route(res, method, path, parsedBody, fullUrl.searchParams, idempotencyKey, state);
}

function route(
  res: http.ServerResponse,
  method: string,
  path: string,
  body: Record<string, unknown> | null,
  query: URLSearchParams,
  idempotencyKey: string | null,
  state: MockServerState,
) {
  // §7.1 health check
  if (method === 'GET' && path === 'status') {
    return send(res, 200, envelope({ status: 'healthy' }));
  }

  // §7.2 list companies
  if (method === 'GET' && path === 'companies') {
    return send(res, 200, envelope({ companies: [{ id: FIXTURE_COMPANY_ID, name: 'Test Company' }] }));
  }

  // §7.11 full sync export
  if (method === 'GET' && path === 'sync') {
    return send(res, 200, envelope({ items: [] }));
  }

  // §7.13 list appointments / §7.12 create appointment
  if (path === 'appointments') {
    if (method === 'GET') {
      return send(res, 200, envelope({ appointments: [...state.appointments.values()] }));
    }
    if (method === 'POST') {
      return handleCreateAppointment(res, body, idempotencyKey, state);
    }
  }

  const companyMatch = path.match(/^companies\/([^/]+)(\/(.+))?$/);
  if (companyMatch) {
    const companyId = decodeURIComponent(companyMatch[1]);
    const sub = companyMatch[3];
    if (companyId !== FIXTURE_COMPANY_ID && companyId !== RATE_LIMITED_COMPANY_ID && companyId !== FLAKY_COMPANY_ID) {
      return send(res, 404, errorEnvelope('COMPANY_NOT_FOUND', `Unknown company id: ${companyId}`));
    }
    if (!sub && method === 'GET') {
      return send(res, 200, envelope({ id: companyId, name: 'Test Company' }));
    }
    if (sub === 'quota' && method === 'GET') {
      return send(res, 200, envelope({ plan: 'standard', used: 10, limit: 1000 }));
    }
    if (sub === 'clinics' && method === 'GET') {
      return send(res, 200, envelope({ clinics: [{ id: FIXTURE_CLINIC_ID, name: 'Test Clinic' }] }));
    }
    if (sub === 'doctors' && method === 'GET') {
      return send(
        res,
        200,
        envelope({ doctors: [{ id: FIXTURE_DOCTOR_ID, name: 'Dr. Test Sentinel', clinic_id: FIXTURE_CLINIC_ID }] }),
      );
    }
    if (sub === 'treatment-types' && method === 'GET') {
      return send(
        res,
        200,
        envelope({ treatment_types: [{ id: FIXTURE_TREATMENT_TYPE_ID, name: 'Checkup', duration_minutes: 30 }] }),
      );
    }
  }

  const doctorSlotsMatch = path.match(/^doctors\/([^/]+)\/slots$/);
  if (doctorSlotsMatch && method === 'GET') {
    return send(res, 200, envelope({ available_slots: { [FIXTURE_SLOT_DATE]: [{ start: '09:00', end: '09:30' }] } }));
  }

  const appointmentByIdMatch = path.match(/^appointments\/([^/]+)$/);
  if (appointmentByIdMatch) {
    const id = decodeURIComponent(appointmentByIdMatch[1]);
    const existing = state.appointments.get(id);
    if (method === 'GET') {
      if (!existing) return send(res, 404, errorEnvelope('APPOINTMENT_NOT_FOUND', `No such appointment: ${id}`));
      return send(res, 200, envelope(existing));
    }
    if (method === 'DELETE') {
      if (!existing) return send(res, 404, errorEnvelope('APPOINTMENT_NOT_FOUND', `No such appointment: ${id}`));
      existing.status = 'cancelled';
      void query.get('reason'); // reason is accepted but not itself validated by this contract double
      return send(res, 200, envelope(existing));
    }
    if (method === 'PUT') {
      if (!existing) return send(res, 404, errorEnvelope('APPOINTMENT_NOT_FOUND', `No such appointment: ${id}`));
      const date = body?.date;
      if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return send(res, 400, errorEnvelope('INVALID_DATE_FORMAT', 'date must be YYYY-MM-DD'));
      }
      existing.date = date;
      existing.start_time = body?.start_time;
      return send(res, 200, envelope(existing));
    }
  }

  return send(res, 404, errorEnvelope('NOT_FOUND', `No mock handler for ${method} ${path}`));
}

function handleCreateAppointment(
  res: http.ServerResponse,
  body: Record<string, unknown> | null,
  idempotencyKey: string | null,
  state: MockServerState,
) {
  if (idempotencyKey && state.idempotencyCache.has(idempotencyKey)) {
    return send(res, 200, envelope(state.idempotencyCache.get(idempotencyKey)), { 'X-Idempotency-Hit': 'true' });
  }

  if (idempotencyKey?.startsWith(FLAKY_ONCE_IDEMPOTENCY_KEY_PREFIX) && !state.flakyAttempted.has(idempotencyKey)) {
    state.flakyAttempted.add(idempotencyKey);
    // Deliberately not cached/created — a genuine transient failure must
    // leave nothing behind for the retry to collide with.
    return send(res, 500, errorEnvelope('INTERNAL_ERROR', 'Temporary server error, please retry'));
  }

  const date = body?.date;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return send(res, 400, errorEnvelope('INVALID_DATE_FORMAT', 'date must be YYYY-MM-DD'));
  }
  if (!body?.doctor_id || !body?.patient_first_name || !body?.patient_last_name) {
    return send(res, 400, errorEnvelope('MISSING_FIELD', 'doctor_id/patient_first_name/patient_last_name are required'));
  }
  if (body.treatment_type === SLOT_CONFLICT_TREATMENT_TYPE_ID) {
    return send(res, 409, errorEnvelope('SLOT_NOT_AVAILABLE', 'The requested time slot is no longer available'));
  }

  const id = `apt_${++state.appointmentSeq}`;
  const record: AppointmentRecord = { id, status: 'confirmed', ...body };
  state.appointments.set(id, record);
  if (idempotencyKey) state.idempotencyCache.set(idempotencyKey, record);
  return send(res, 201, envelope(record));
}

function send(res: http.ServerResponse, status: number, body: string, extraHeaders: Record<string, string> = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...extraHeaders });
  res.end(body);
}

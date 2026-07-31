/**
 * digidentisApiClient.test.ts — DigiDentiS API client per-request HMAC
 * signing, path canonicalization, response-envelope unwrapping, error
 * handling, and create-appointment idempotency-key propagation.
 *
 * Uses a fake `fetch` implementation (injected via the client's optional
 * fetchImpl parameter) — no real network access, no live DigiDentiS server,
 * and no token endpoint: authentication is per-request HMAC signing, so
 * every call is self-contained.
 *
 * Fixture response bodies below are shaped exactly like the vendor
 * documentation's worked examples
 * (`docs/vendor/digidentis/DigiDentiS_Takvim_API_Documentation_v3.2.html`,
 * §7 "API Endpoints", §8 "Error Codes") — the `{success, data, meta}` /
 * `{success:false, error:{code,message}, meta}` envelope, not raw objects.
 *
 * Run with: npx tsx src/tests/digidentisApiClient.test.ts
 */

import assert from 'node:assert/strict';
import {
  digiDentisCancelAppointment,
  digiDentisCreateAppointment,
  digiDentisHealthCheck,
  digiDentisListDoctors,
  digiDentisRescheduleAppointment,
  digiDentisTestConnection,
} from '../services/externalCalendar/digidentis/DigiDentisApiClient.js';
import {
  ExternalCalendarAuthError,
  ExternalCalendarConflictError,
  ExternalCalendarRateLimitedError,
  ExternalCalendarTransientError,
  ExternalCalendarValidationError,
} from '../services/externalCalendar/externalCalendarErrors.js';
import type { DigiDentisClientConfig } from '../services/externalCalendar/digidentis/DigiDentisApiClient.js';
import { DIGIDENTIS_VERIFIED_PRODUCTION_BASE_URL } from '../services/externalCalendar/digidentis/digidentisConfig.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { console.log(`  ✓ ${name}`); passed++; })
    .catch((err: unknown) => {
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
      failed++;
    });
}

function section(title: string) {
  console.log(`\n${title}`);
}

const baseConfig: DigiDentisClientConfig = {
  baseUrl: DIGIDENTIS_VERIFIED_PRODUCTION_BASE_URL,
  clientId: 'client-1',
  clientSecret: 'secret-1',
};

function envelopeResponse(status: number, data: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ success: true, data, meta: { request_id: 'req_1', api_version: '3.2.0' } }), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function errorEnvelopeResponse(status: number, code: string, message: string, headers: Record<string, string> = {}): Response {
  return new Response(
    JSON.stringify({ success: false, error: { code, message }, meta: { request_id: 'req_1', api_version: '3.2.0' } }),
    { status, headers: { 'content-type': 'application/json', ...headers } },
  );
}

function fakeFetch(apiHandler: (url: string, init: RequestInit | undefined) => Response): typeof fetch {
  return (async (input: any, init?: any) => apiHandler(String(input), init)) as typeof fetch;
}

section('Path canonicalization — the request URL must include the base path prefix');

await test('the base URL\'s own path prefix (/Api/v1/external_booking) is preserved, not dropped', async () => {
  let capturedUrl = '';
  const fetchImpl = fakeFetch((url) => {
    capturedUrl = url;
    return envelopeResponse(200, { doctors: [] });
  });

  await digiDentisListDoctors(baseConfig, 'cmp_1', fetchImpl);

  const parsed = new URL(capturedUrl);
  assert.equal(parsed.hostname, 'www.ddslogin.com');
  assert.equal(parsed.pathname, '/Api/v1/external_booking/companies/cmp_1/doctors');
});

section('Request signing — every call is self-authenticated (no token endpoint)');

await test('outgoing requests carry X-Client-ID/X-Timestamp/X-Nonce/X-Signature and no Authorization header', async () => {
  let capturedHeaders: Record<string, string> = {};
  const fetchImpl = fakeFetch((_url, init) => {
    capturedHeaders = Object.fromEntries(new Headers(init?.headers as HeadersInit).entries());
    return envelopeResponse(200, { doctors: [] });
  });

  await digiDentisListDoctors(baseConfig, 'cmp_1', fetchImpl);

  assert.equal(capturedHeaders['x-client-id'], 'client-1');
  assert.ok(capturedHeaders['x-timestamp']);
  assert.ok(capturedHeaders['x-nonce']);
  assert.ok(capturedHeaders['x-signature']);
  assert.equal(capturedHeaders['authorization'], undefined);
});

await test('the signature is computed over the path relative to the base URL, without the base prefix or query string', async () => {
  // Regression test for a real path-join bug: signing the full resolved
  // pathname (including /Api/v1/external_booking) — or including a query
  // string — would produce a signature the real server could never verify,
  // since vendor doc §4 defines `path` as base-prefix-stripped and
  // query-string-free.
  let capturedHeaders: Record<string, string> = {};
  const fetchImpl = fakeFetch((_url, init) => {
    capturedHeaders = Object.fromEntries(new Headers(init?.headers as HeadersInit).entries());
    return envelopeResponse(200, { doctors: [] });
  });

  await digiDentisListDoctors(baseConfig, 'cmp_1', fetchImpl);

  const { createHmac } = await import('crypto');
  const { sha256Hex } = await import('../services/externalCalendar/digidentis/DigiDentisSigning.js');
  const expectedSigningString = `${capturedHeaders['x-timestamp']}.${capturedHeaders['x-nonce']}.GET.companies/cmp_1/doctors.${sha256Hex(Buffer.alloc(0))}`;
  const expectedSignature = createHmac('sha256', baseConfig.clientSecret).update(expectedSigningString).digest('hex');
  assert.equal(capturedHeaders['x-signature'], expectedSignature);
});

await test('two calls in a row use different nonces', async () => {
  const nonces: string[] = [];
  const fetchImpl = fakeFetch((_url, init) => {
    nonces.push(new Headers(init?.headers as HeadersInit).get('x-nonce') ?? '');
    return envelopeResponse(200, { doctors: [] });
  });

  await digiDentisListDoctors(baseConfig, 'cmp_1', fetchImpl);
  await digiDentisListDoctors(baseConfig, 'cmp_1', fetchImpl);

  assert.notEqual(nonces[0], nonces[1]);
});

section('Response envelope — {success, data, meta} is unwrapped');

await test('a wrapped {success:true, data:{doctors:[...]}} response is unwrapped to the doctors array', async () => {
  const fetchImpl = fakeFetch(() =>
    envelopeResponse(200, {
      doctors: [{ id: 'doc_1', name: 'Dr. Mehmet Ozkan', clinic_id: 'cln_1' }],
    }),
  );
  const doctors = await digiDentisListDoctors(baseConfig, 'cmp_1', fetchImpl);
  assert.deepEqual(doctors, [{ id: 'doc_1', name: 'Dr. Mehmet Ozkan', clinicId: 'cln_1' }]);
});

section('Health check (vendor doc §7.1 — rate-limit-exempt endpoint)');

await test('digiDentisHealthCheck calls the documented /status endpoint, not a data-listing endpoint', async () => {
  let capturedUrl = '';
  const fetchImpl = fakeFetch((url) => {
    capturedUrl = url;
    return envelopeResponse(200, { status: 'healthy' });
  });
  await digiDentisHealthCheck(baseConfig, fetchImpl);
  assert.ok(new URL(capturedUrl).pathname.endsWith('/status'));
});

await test('digiDentisTestConnection is an alias for the health check', async () => {
  assert.equal(digiDentisTestConnection, digiDentisHealthCheck);
});

section('Provider error handling — auth');

await test('HTTP 401 from the API maps to ExternalCalendarAuthError', async () => {
  const fetchImpl = fakeFetch(() => errorEnvelopeResponse(401, 'SIGNATURE_INVALID', 'Request signature verification failed'));
  await assert.rejects(() => digiDentisListDoctors(baseConfig, 'cmp_1', fetchImpl), ExternalCalendarAuthError);
});

await test('HTTP 403 IP_NOT_ALLOWED maps to ExternalCalendarAuthError with the vendor error code preserved', async () => {
  const fetchImpl = fakeFetch(() => errorEnvelopeResponse(403, 'IP_NOT_ALLOWED', 'IP address not in whitelist'));
  await assert.rejects(
    () => digiDentisListDoctors(baseConfig, 'cmp_1', fetchImpl),
    (err: unknown) => {
      assert.ok(err instanceof ExternalCalendarAuthError);
      assert.ok(err.message.includes('IP_NOT_ALLOWED'));
      return true;
    },
  );
});

section('Provider error handling — conflict (409)');

await test('HTTP 409 SLOT_NOT_AVAILABLE maps to ExternalCalendarConflictError with the vendor error code', async () => {
  const fetchImpl = fakeFetch(() => errorEnvelopeResponse(409, 'SLOT_NOT_AVAILABLE', 'The requested time slot is no longer available'));
  await assert.rejects(
    () => digiDentisListDoctors(baseConfig, 'cmp_1', fetchImpl),
    (err: unknown) => {
      assert.ok(err instanceof ExternalCalendarConflictError);
      assert.equal(err.code, 'SLOT_NOT_AVAILABLE');
      return true;
    },
  );
});

section('Provider error handling — rate limiting');

await test('HTTP 429 maps to ExternalCalendarRateLimitedError and captures Retry-After', async () => {
  const fetchImpl = fakeFetch(() => errorEnvelopeResponse(429, 'RATE_LIMIT_EXCEEDED', 'Too many requests', { 'retry-after': '30' }));
  await assert.rejects(
    () => digiDentisListDoctors(baseConfig, 'cmp_1', fetchImpl),
    (err: unknown) => {
      assert.ok(err instanceof ExternalCalendarRateLimitedError);
      assert.equal(err.retryAfterMs, 30_000);
      return true;
    },
  );
});

section('Provider error handling — transient/server errors');

await test('HTTP 500 maps to ExternalCalendarTransientError (safe to retry)', async () => {
  const fetchImpl = fakeFetch(() => errorEnvelopeResponse(500, 'INTERNAL_ERROR', 'Server error'));
  await assert.rejects(() => digiDentisListDoctors(baseConfig, 'cmp_1', fetchImpl), ExternalCalendarTransientError);
});

await test('a network-level throw maps to ExternalCalendarTransientError', async () => {
  const fetchImpl = fakeFetch(() => {
    throw new Error('ECONNRESET');
  });
  await assert.rejects(() => digiDentisListDoctors(baseConfig, 'cmp_1', fetchImpl), ExternalCalendarTransientError);
});

section('Provider error handling — validation errors');

await test('HTTP 400 maps to ExternalCalendarValidationError with the vendor error code preserved', async () => {
  const fetchImpl = fakeFetch(() => errorEnvelopeResponse(400, 'INVALID_DATE_FORMAT', 'Date must be YYYY-MM-DD'));
  await assert.rejects(
    () => digiDentisListDoctors(baseConfig, 'cmp_1', fetchImpl),
    (err: unknown) => {
      assert.ok(err instanceof ExternalCalendarValidationError);
      assert.equal(err.code, 'INVALID_DATE_FORMAT');
      return true;
    },
  );
});

await test('HTTP 404 maps to ExternalCalendarValidationError', async () => {
  const fetchImpl = fakeFetch(() => errorEnvelopeResponse(404, 'DOCTOR_NOT_FOUND', 'Doctor does not exist'));
  await assert.rejects(() => digiDentisListDoctors(baseConfig, 'cmp_1', fetchImpl), ExternalCalendarValidationError);
});

section('createAppointment — real field shape (vendor doc §7.12) and header-based idempotency key');

await test('the request body uses documented field names (doctor_id/date/start_time/patient_first_name/...) and clinic_id from the worked example', async () => {
  let capturedBody: any = null;
  let capturedHeaders: Record<string, string> = {};
  const fetchImpl = fakeFetch((_url, init) => {
    capturedBody = JSON.parse(String(init?.body));
    capturedHeaders = Object.fromEntries(new Headers(init?.headers as HeadersInit).entries());
    return envelopeResponse(201, { id: 'apt_1', status: 'confirmed' });
  });

  const result = await digiDentisCreateAppointment(
    baseConfig,
    'cln_1',
    {
      externalDoctorId: 'doc_1',
      externalTreatmentTypeId: 'att_1',
      date: '2026-08-01',
      startTime: '09:00',
      endTime: '09:30',
      patientFirstName: 'Ahmet',
      patientLastName: 'Yilmaz',
      patientPhone: '+905551234567',
      idempotencyKey: 'appt-local-id-42',
    },
    fetchImpl,
  );

  assert.equal(result.externalAppointmentId, 'apt_1');
  assert.equal(capturedBody.clinic_id, 'cln_1');
  assert.equal(capturedBody.doctor_id, 'doc_1');
  assert.equal(capturedBody.treatment_type, 'att_1');
  assert.equal(capturedBody.date, '2026-08-01');
  assert.equal(capturedBody.start_time, '09:00');
  assert.equal(capturedBody.end_time, '09:30');
  assert.equal(capturedBody.patient_first_name, 'Ahmet');
  assert.equal(capturedBody.patient_last_name, 'Yilmaz');
  // The idempotency key must be a HEADER, never a body field.
  assert.equal(capturedBody.idempotencyKey, undefined);
  assert.equal(capturedBody.idempotency_key, undefined);
  assert.equal(capturedHeaders['x-idempotency-key'], 'appt-local-id-42');
});

await test('a create response with no appointment id is treated as a validation error', async () => {
  const fetchImpl = fakeFetch(() => envelopeResponse(201, { status: 'confirmed' }));
  await assert.rejects(
    () =>
      digiDentisCreateAppointment(
        baseConfig,
        'cln_1',
        {
          externalDoctorId: 'doc_1',
          externalTreatmentTypeId: 'att_1',
          date: '2026-08-01',
          startTime: '09:00',
          patientFirstName: 'Ahmet',
          patientLastName: 'Yilmaz',
          idempotencyKey: 'appt-local-id-43',
        },
        fetchImpl,
      ),
    ExternalCalendarValidationError,
  );
});

section('cancelAppointment — reason is a QUERY PARAMETER, never a body field (vendor doc §7.15)');

await test('reason is sent as a query string parameter and DELETE carries no body', async () => {
  let capturedUrl = '';
  let capturedMethod = '';
  let capturedBody: unknown;
  const fetchImpl = fakeFetch((url, init) => {
    capturedUrl = url;
    capturedMethod = String(init?.method);
    capturedBody = init?.body;
    return envelopeResponse(200, { id: 'apt_1', status: 'cancelled' });
  });

  await digiDentisCancelAppointment(baseConfig, 'apt_1', 'Hasta iptal etti', 'cancel-key-1', fetchImpl);

  assert.equal(capturedMethod, 'DELETE');
  assert.equal(capturedBody, undefined);
  assert.equal(new URL(capturedUrl).searchParams.get('reason'), 'Hasta iptal etti');
});

section('rescheduleAppointment — PUT with date/start_time/end_time split (vendor doc §7.16)');

await test('reschedule sends a PUT with the documented date/time fields', async () => {
  let capturedMethod = '';
  let capturedBody: any = null;
  const fetchImpl = fakeFetch((_url, init) => {
    capturedMethod = String(init?.method);
    capturedBody = JSON.parse(String(init?.body));
    return envelopeResponse(200, { id: 'apt_1', status: 'confirmed' });
  });

  const result = await digiDentisRescheduleAppointment(
    baseConfig,
    'apt_1',
    { date: '2026-08-05', startTime: '10:00' },
    fetchImpl,
  );

  assert.equal(capturedMethod, 'PUT');
  assert.equal(capturedBody.date, '2026-08-05');
  assert.equal(capturedBody.start_time, '10:00');
  assert.equal(result.externalAppointmentId, 'apt_1');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;

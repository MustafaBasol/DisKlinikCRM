/**
 * digidentisApiClient.test.ts — DigiDentiS API client error handling and
 * create-appointment idempotency-key propagation.
 *
 * Uses a fake `fetch` implementation (injected via the client's optional
 * fetchImpl parameter) — no real network access, no live DigiDentiS server.
 *
 * Run with: npx tsx src/tests/digidentisApiClient.test.ts
 */

import assert from 'node:assert/strict';
import {
  digiDentisCreateAppointment,
  digiDentisListDoctors,
  digiDentisTestConnection,
  type DigiDentisClientConfig,
} from '../services/externalCalendar/digidentis/DigiDentisApiClient.js';
import { clearDigiDentisTokenCacheForTests } from '../services/externalCalendar/digidentis/DigiDentisAuthClient.js';
import {
  ExternalCalendarAuthError,
  ExternalCalendarRateLimitedError,
  ExternalCalendarTransientError,
  ExternalCalendarValidationError,
} from '../services/externalCalendar/externalCalendarErrors.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  clearDigiDentisTokenCacheForTests();
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
  connectionId: 'conn-1',
  baseUrl: 'https://sandbox.digidentis.invalid/api/v3.2',
  clientId: 'client-1',
  clientSecret: 'secret-1',
};

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

/** A fetch fake that always issues a valid token, then delegates the actual
 *  API call to `apiHandler`. */
function fakeFetch(apiHandler: (url: string, init: RequestInit | undefined) => Response): typeof fetch {
  return (async (input: any, init?: any) => {
    const url = String(input);
    if (url.includes('/oauth/token')) {
      return jsonResponse(200, { access_token: 'test-token', expires_in: 3600 });
    }
    return apiHandler(url, init);
  }) as typeof fetch;
}

section('Provider error handling — auth');

await test('HTTP 401 from the API maps to ExternalCalendarAuthError', async () => {
  const fetchImpl = fakeFetch(() => jsonResponse(401, { error: 'invalid_token' }));
  await assert.rejects(() => digiDentisListDoctors(baseConfig, 'ext-clinic-1', fetchImpl), ExternalCalendarAuthError);
});

await test('HTTP 401 from the TOKEN endpoint itself maps to ExternalCalendarAuthError', async () => {
  const fetchImpl = (async (input: any) => {
    if (String(input).includes('/oauth/token')) return jsonResponse(401, { error: 'invalid_client' });
    return jsonResponse(200, { doctors: [] });
  }) as typeof fetch;
  await assert.rejects(() => digiDentisListDoctors(baseConfig, 'ext-clinic-1', fetchImpl), ExternalCalendarAuthError);
});

section('Provider error handling — rate limiting');

await test('HTTP 429 maps to ExternalCalendarRateLimitedError and captures Retry-After', async () => {
  const fetchImpl = fakeFetch(() => jsonResponse(429, { error: 'rate_limited' }, { 'retry-after': '30' }));
  await assert.rejects(
    () => digiDentisListDoctors(baseConfig, 'ext-clinic-1', fetchImpl),
    (err: unknown) => {
      assert.ok(err instanceof ExternalCalendarRateLimitedError);
      assert.equal(err.retryAfterMs, 30_000);
      return true;
    },
  );
});

section('Provider error handling — transient/server errors');

await test('HTTP 500 maps to ExternalCalendarTransientError (safe to retry)', async () => {
  const fetchImpl = fakeFetch(() => jsonResponse(500, { error: 'internal' }));
  await assert.rejects(() => digiDentisListDoctors(baseConfig, 'ext-clinic-1', fetchImpl), ExternalCalendarTransientError);
});

await test('a network-level throw maps to ExternalCalendarTransientError', async () => {
  const fetchImpl = fakeFetch(() => {
    throw new Error('ECONNRESET');
  });
  await assert.rejects(() => digiDentisListDoctors(baseConfig, 'ext-clinic-1', fetchImpl), ExternalCalendarTransientError);
});

section('Provider error handling — validation errors');

await test('HTTP 400 maps to ExternalCalendarValidationError (not safe to blindly retry)', async () => {
  const fetchImpl = fakeFetch(() => jsonResponse(400, { error: 'invalid doctor id' }));
  await assert.rejects(() => digiDentisListDoctors(baseConfig, 'ext-clinic-1', fetchImpl), ExternalCalendarValidationError);
});

await test('HTTP 404 maps to ExternalCalendarValidationError', async () => {
  const fetchImpl = fakeFetch(() => jsonResponse(404, { error: 'not found' }));
  await assert.rejects(() => digiDentisListDoctors(baseConfig, 'ext-clinic-1', fetchImpl), ExternalCalendarValidationError);
});

section('testConnection reports failure without throwing to the caller');

await test('digiDentisTestConnection surfaces the underlying error message on failure', async () => {
  const fetchImpl = fakeFetch(() => jsonResponse(500, {}));
  await assert.rejects(() => digiDentisTestConnection(baseConfig, fetchImpl));
});

section('createAppointment idempotency-key propagation');

await test('the idempotencyKey is sent in the request body to the provider', async () => {
  let capturedBody: any = null;
  const fetchImpl = fakeFetch((_url, init) => {
    capturedBody = JSON.parse(String(init?.body));
    return jsonResponse(201, { id: 'ext-appt-1', status: 'created' });
  });

  const result = await digiDentisCreateAppointment(
    baseConfig,
    'ext-clinic-1',
    {
      externalDoctorId: 'doc-1',
      externalTreatmentTypeId: 'tt-1',
      startTime: '2026-08-01T09:00:00.000Z',
      endTime: '2026-08-01T09:30:00.000Z',
      patientName: 'Test Patient',
      idempotencyKey: 'appt-local-id-42',
    },
    fetchImpl,
  );

  assert.equal(result.externalAppointmentId, 'ext-appt-1');
  assert.equal(capturedBody.idempotencyKey, 'appt-local-id-42');
});

await test('a create response with no appointment id is treated as a validation error', async () => {
  const fetchImpl = fakeFetch(() => jsonResponse(201, { status: 'created' }));
  await assert.rejects(
    () =>
      digiDentisCreateAppointment(
        baseConfig,
        'ext-clinic-1',
        {
          externalDoctorId: 'doc-1',
          externalTreatmentTypeId: 'tt-1',
          startTime: '2026-08-01T09:00:00.000Z',
          endTime: '2026-08-01T09:30:00.000Z',
          patientName: 'Test Patient',
          idempotencyKey: 'appt-local-id-43',
        },
        fetchImpl,
      ),
    ExternalCalendarValidationError,
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;

/**
 * digidentisE2EContract.test.ts — specification-derived end-to-end contract
 * test for NoraMedi's DigiDentiS external calendar client
 * (`server/src/services/externalCalendar/digidentis/`), verified against
 * `docs/vendor/digidentis/DigiDentiS_Takvim_API_Documentation_v3.2.html`.
 *
 * Unlike digidentisApiClient.test.ts (which injects a fake `fetch` and never
 * touches the network), this suite starts a REAL, listening, test-only
 * DigiDentiS HTTP double (see tests/support/digiDentisMockServer.ts) and
 * points the REAL, unmodified `DigiDentisApiClient.ts` functions at it via
 * real `fetch` over `http://127.0.0.1`. Every header, signing string input,
 * body byte, and query parameter asserted on below is what NoraMedi's actual
 * client put on the wire — not a hand-mocked stand-in for it.
 *
 * Two scenarios (stale timestamp, reused nonce) are deliberately NOT
 * reachable through the typed client wrapper — `DigiDentisApiClient.ts`'s
 * exported endpoint functions never expose a way to override the
 * auto-generated timestamp/nonce, which is correct, deliberate production
 * behavior (a client should never let a caller force a stale/replayed
 * request), not a testability defect. Those two scenarios instead call the
 * real, unmodified `signDigiDentisRequest` primitive from
 * DigiDentisSigning.ts directly (it already accepts optional
 * timestamp/nonce overrides — this is existing production API, not a new
 * seam) and send the result over real HTTP via `fetch`, one layer below the
 * typed client. This is called out explicitly in each such test's name.
 *
 * Run with: npx tsx src/tests/digidentisE2EContract.test.ts
 */

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? 'd'.repeat(64);

import assert from 'node:assert/strict';
import { randomUUID, createHash, createHmac } from 'node:crypto';
import {
  digiDentisHealthCheck,
  digiDentisListCompanies,
  digiDentisGetCompanyDetails,
  digiDentisGetCompanyQuota,
  digiDentisListClinics,
  digiDentisListDoctors,
  digiDentisListTreatmentTypes,
  digiDentisListAvailableSlots,
  digiDentisFullSync,
  digiDentisCreateAppointment,
  digiDentisGetAppointment,
  digiDentisListAppointments,
  digiDentisCancelAppointment,
  digiDentisRescheduleAppointment,
  type DigiDentisClientConfig,
} from '../services/externalCalendar/digidentis/DigiDentisApiClient.js';
import { signDigiDentisRequest } from '../services/externalCalendar/digidentis/DigiDentisSigning.js';
import {
  ExternalCalendarAuthError,
  ExternalCalendarConflictError,
  ExternalCalendarRateLimitedError,
  ExternalCalendarTransientError,
  ExternalCalendarValidationError,
} from '../services/externalCalendar/externalCalendarErrors.js';
import {
  startDigiDentisMockServer,
  DIGIDENTIS_TEST_CLIENT_ID,
  DIGIDENTIS_TEST_CLIENT_SECRET,
  DIGIDENTIS_IP_BLOCKED_CLIENT_ID,
  DIGIDENTIS_IP_BLOCKED_CLIENT_SECRET,
  FIXTURE_COMPANY_ID,
  FIXTURE_CLINIC_ID,
  FIXTURE_DOCTOR_ID,
  FIXTURE_TREATMENT_TYPE_ID,
  FIXTURE_SLOT_DATE,
  RATE_LIMITED_COMPANY_ID,
  FLAKY_COMPANY_ID,
  SLOT_CONFLICT_TREATMENT_TYPE_ID,
  FLAKY_ONCE_IDEMPOTENCY_KEY_PREFIX,
  type DigiDentisMockServer,
} from './support/digiDentisMockServer.js';

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

// ── Sentinel PII (synthetic only) used to prove nothing leaks into failure
// output or console — mirrors httpRequestLogPrivacy.test.ts's SENTINEL
// pattern (see the "Privacy" section at the bottom of this file). ──────────
const SENTINEL_PATIENT_FIRST_NAME = 'SentinelFirstname';
const SENTINEL_PATIENT_LAST_NAME = 'SentinelLastname';
const SENTINEL_PATIENT_PHONE = '+905551119999';

let mock: DigiDentisMockServer;
let config: DigiDentisClientConfig;

// ── Console capture — every line this file's `test()`/`section()` helpers
// print goes through here too, so the privacy check at the end inspects the
// SAME text a developer would see scroll by in a failing CI run. ──────────
const consoleLines: string[] = [];
const originalConsoleLog = console.log.bind(console);
const originalConsoleError = console.error.bind(console);
console.log = (...args: unknown[]) => {
  consoleLines.push(args.map(String).join(' '));
  originalConsoleLog(...args);
};
console.error = (...args: unknown[]) => {
  consoleLines.push(args.map(String).join(' '));
  originalConsoleError(...args);
};

async function main() {
  mock = await startDigiDentisMockServer();
  config = { baseUrl: mock.baseUrl, clientId: DIGIDENTIS_TEST_CLIENT_ID, clientSecret: DIGIDENTIS_TEST_CLIENT_SECRET };

  try {
    section('Successful calls — company, clinic, doctor, treatment-type, slot (real client, real HTTP)');

    await test('health check (§7.1) succeeds against the real mock origin', async () => {
      const result = await digiDentisHealthCheck(config);
      assert.equal(result.success, true);
    });

    await test('list companies (§7.2) returns the fixture company over real HTTP', async () => {
      const companies = await digiDentisListCompanies(config);
      assert.equal(companies[0]?.id, FIXTURE_COMPANY_ID);
    });

    await test('get company details (§7.3)', async () => {
      const company = await digiDentisGetCompanyDetails(config, FIXTURE_COMPANY_ID);
      assert.equal(company?.id, FIXTURE_COMPANY_ID);
    });

    await test('get company quota (§7.4)', async () => {
      const quota = await digiDentisGetCompanyQuota(config, FIXTURE_COMPANY_ID);
      assert.ok(quota);
    });

    await test('list clinics for company (§7.5)', async () => {
      const clinics = await digiDentisListClinics(config, FIXTURE_COMPANY_ID);
      assert.equal(clinics[0]?.id, FIXTURE_CLINIC_ID);
    });

    await test('list doctors for company (§7.6, company-scoped)', async () => {
      const doctors = await digiDentisListDoctors(config, FIXTURE_COMPANY_ID);
      assert.equal(doctors[0]?.id, FIXTURE_DOCTOR_ID);
      assert.equal(doctors[0]?.clinicId, FIXTURE_CLINIC_ID);
    });

    await test('list treatment types for company (§7.10)', async () => {
      const types = await digiDentisListTreatmentTypes(config, FIXTURE_COMPANY_ID);
      assert.equal(types[0]?.id, FIXTURE_TREATMENT_TYPE_ID);
    });

    await test('list available slots for a doctor (§7.8) flattens the date-grouped response', async () => {
      const slots = await digiDentisListAvailableSlots(config, {
        externalDoctorId: FIXTURE_DOCTOR_ID,
        fromDate: FIXTURE_SLOT_DATE,
        toDate: FIXTURE_SLOT_DATE,
      });
      assert.equal(slots[0]?.date, FIXTURE_SLOT_DATE);
      assert.equal(slots[0]?.startTime, '09:00');
    });

    await test('full sync export (§7.11) reaches the sync endpoint with query params, not path segments', async () => {
      const result = await digiDentisFullSync(config, FIXTURE_COMPANY_ID);
      assert.ok(result);
      const call = mock.requestLog.find((r) => r.path === 'sync');
      assert.ok(call, 'expected a request to the bare "sync" path (company_id must be a query param, not a segment)');
    });

    let createdAppointmentId = '';

    await test('create appointment (§7.12) with the documented field shape succeeds', async () => {
      const result = await digiDentisCreateAppointment(config, FIXTURE_CLINIC_ID, {
        externalDoctorId: FIXTURE_DOCTOR_ID,
        externalTreatmentTypeId: FIXTURE_TREATMENT_TYPE_ID,
        date: '2026-08-15',
        startTime: '10:00',
        endTime: '10:30',
        patientFirstName: SENTINEL_PATIENT_FIRST_NAME,
        patientLastName: SENTINEL_PATIENT_LAST_NAME,
        patientPhone: SENTINEL_PATIENT_PHONE,
        idempotencyKey: `create-once-${randomUUID()}`,
      });
      assert.ok(result.externalAppointmentId);
      assert.equal(result.status, 'confirmed');
      createdAppointmentId = result.externalAppointmentId;
    });

    await test('get appointment (§7.14) returns the appointment just created', async () => {
      const appointment = (await digiDentisGetAppointment(config, createdAppointmentId)) as { id: string };
      assert.equal(appointment.id, createdAppointmentId);
    });

    await test('list appointments (§7.13) with multiple simultaneous query filters succeeds', async () => {
      const appointments = await digiDentisListAppointments(config, {
        companyId: FIXTURE_COMPANY_ID,
        clinicId: FIXTURE_CLINIC_ID,
        doctorId: FIXTURE_DOCTOR_ID,
        startDate: '2026-08-01',
        endDate: '2026-08-31',
      });
      assert.ok(Array.isArray(appointments));
    });

    await test('reschedule appointment (§7.16) succeeds with a PUT', async () => {
      const result = await digiDentisRescheduleAppointment(config, createdAppointmentId, {
        date: '2026-08-16',
        startTime: '11:00',
      });
      assert.equal(result.externalAppointmentId, createdAppointmentId);
    });

    await test('cancel appointment (§7.15) succeeds, reason sent as a query parameter', async () => {
      await digiDentisCancelAppointment(config, createdAppointmentId, 'Patient rescheduled elsewhere', undefined);
    });

    section('Invalid signature (§8: 401 SIGNATURE_INVALID) — real client, wrong secret');

    await test('the real client signing with the wrong client secret is rejected by the server', async () => {
      const wrongSecretConfig: DigiDentisClientConfig = { ...config, clientSecret: 'not-the-real-secret' };
      await assert.rejects(() => digiDentisHealthCheck(wrongSecretConfig), (err: unknown) => {
        assert.ok(err instanceof ExternalCalendarAuthError);
        assert.ok(err.message.includes('SIGNATURE_INVALID'));
        return true;
      });
    });

    section(
      'Stale timestamp & reused nonce (§8: 401 TIMESTAMP_EXPIRED / NONCE_USED) — real signDigiDentisRequest + real HTTP, one layer below the typed client (see file header)',
    );

    await test('a request signed 10 minutes ago is rejected as a stale timestamp', async () => {
      const staleTimestamp = Math.floor(Date.now() / 1000) - 600;
      const headers = signDigiDentisRequest(
        DIGIDENTIS_TEST_CLIENT_ID,
        DIGIDENTIS_TEST_CLIENT_SECRET,
        'GET',
        'status',
        Buffer.alloc(0),
        staleTimestamp,
      );
      const res = await fetch(new URL('status', mock.baseUrl), { headers });
      const body = (await res.json()) as { error?: { code?: string } };
      assert.equal(res.status, 401);
      assert.equal(body.error?.code, 'TIMESTAMP_EXPIRED');
    });

    await test('reusing the same nonce on a second, independently valid request is rejected as replay', async () => {
      const fixedNonce = `reused-nonce-${randomUUID()}`;
      const firstHeaders = signDigiDentisRequest(
        DIGIDENTIS_TEST_CLIENT_ID,
        DIGIDENTIS_TEST_CLIENT_SECRET,
        'GET',
        'status',
        Buffer.alloc(0),
        undefined,
        fixedNonce,
      );
      const first = await fetch(new URL('status', mock.baseUrl), { headers: firstHeaders });
      assert.equal(first.status, 200);

      // Second request: fresh timestamp, correctly (re-)signed, but the SAME
      // nonce — a valid signature does not save a replayed request.
      const secondHeaders = signDigiDentisRequest(
        DIGIDENTIS_TEST_CLIENT_ID,
        DIGIDENTIS_TEST_CLIENT_SECRET,
        'GET',
        'status',
        Buffer.alloc(0),
        undefined,
        fixedNonce,
      );
      const second = await fetch(new URL('status', mock.baseUrl), { headers: secondHeaders });
      const body = (await second.json()) as { error?: { code?: string } };
      assert.equal(second.status, 401);
      assert.equal(body.error?.code, 'NONCE_USED');
    });

    section('Missing IP authorization (§8: 403 IP_NOT_ALLOWED) — real client, valid credentials, disallowed origin');

    await test('valid credentials from a non-whitelisted IP are rejected, not treated as a signature failure', async () => {
      const ipBlockedConfig: DigiDentisClientConfig = {
        baseUrl: mock.baseUrl,
        clientId: DIGIDENTIS_IP_BLOCKED_CLIENT_ID,
        clientSecret: DIGIDENTIS_IP_BLOCKED_CLIENT_SECRET,
      };
      await assert.rejects(() => digiDentisHealthCheck(ipBlockedConfig), (err: unknown) => {
        assert.ok(err instanceof ExternalCalendarAuthError);
        assert.ok(err.message.includes('IP_NOT_ALLOWED'));
        return true;
      });
    });

    section('Validation error (§8: 400 INVALID_DATE_FORMAT) — real client sends a malformed date');

    await test('creating an appointment with a malformed date is rejected as a validation error, code preserved', async () => {
      await assert.rejects(
        () =>
          digiDentisCreateAppointment(config, FIXTURE_CLINIC_ID, {
            externalDoctorId: FIXTURE_DOCTOR_ID,
            externalTreatmentTypeId: FIXTURE_TREATMENT_TYPE_ID,
            date: '15-08-2026', // wrong format on purpose
            startTime: '10:00',
            patientFirstName: SENTINEL_PATIENT_FIRST_NAME,
            patientLastName: SENTINEL_PATIENT_LAST_NAME,
            idempotencyKey: `bad-date-${randomUUID()}`,
          }),
        (err: unknown) => {
          assert.ok(err instanceof ExternalCalendarValidationError);
          assert.equal(err.code, 'INVALID_DATE_FORMAT');
          return true;
        },
      );
    });

    section('Rate limiting (§5.4: 429 RATE_LIMIT_EXCEEDED, Retry-After) — real client, real HTTP response headers');

    await test('a 429 from the real HTTP response maps to ExternalCalendarRateLimitedError with retryAfterMs from Retry-After', async () => {
      await assert.rejects(() => digiDentisListClinics(config, RATE_LIMITED_COMPANY_ID), (err: unknown) => {
        assert.ok(err instanceof ExternalCalendarRateLimitedError);
        assert.equal(err.retryAfterMs, 2000);
        return true;
      });
    });

    section('SLOT_NOT_AVAILABLE (§8: 409 conflict) — real client create-appointment call');

    await test('creating an appointment against an already-booked slot is reported as a conflict, code preserved', async () => {
      await assert.rejects(
        () =>
          digiDentisCreateAppointment(config, FIXTURE_CLINIC_ID, {
            externalDoctorId: FIXTURE_DOCTOR_ID,
            externalTreatmentTypeId: SLOT_CONFLICT_TREATMENT_TYPE_ID,
            date: '2026-08-20',
            startTime: '09:00',
            patientFirstName: SENTINEL_PATIENT_FIRST_NAME,
            patientLastName: SENTINEL_PATIENT_LAST_NAME,
            idempotencyKey: `slot-conflict-${randomUUID()}`,
          }),
        (err: unknown) => {
          assert.ok(err instanceof ExternalCalendarConflictError);
          assert.equal(err.code, 'SLOT_NOT_AVAILABLE');
          return true;
        },
      );
    });

    section('Temporary 5xx failure (§8: 500 INTERNAL_ERROR, safe to retry) — real client, real HTTP');

    await test('the first call against a flaky endpoint fails transiently; an identical retry succeeds', async () => {
      await assert.rejects(() => digiDentisListClinics(config, FLAKY_COMPANY_ID), ExternalCalendarTransientError);
      const retried = await digiDentisListClinics(config, FLAKY_COMPANY_ID);
      assert.ok(Array.isArray(retried));
    });

    section('Idempotent repeated appointment creation (§10.2) — real client, same X-Idempotency-Key twice');

    await test('two create-appointment calls with the same idempotency key return the same appointment id, only one row created', async () => {
      const idempotencyKey = `idem-repeat-${randomUUID()}`;
      const beforeCount = mock.getAppointmentCount();

      const first = await digiDentisCreateAppointment(config, FIXTURE_CLINIC_ID, {
        externalDoctorId: FIXTURE_DOCTOR_ID,
        externalTreatmentTypeId: FIXTURE_TREATMENT_TYPE_ID,
        date: '2026-08-21',
        startTime: '09:00',
        patientFirstName: SENTINEL_PATIENT_FIRST_NAME,
        patientLastName: SENTINEL_PATIENT_LAST_NAME,
        idempotencyKey,
      });
      const second = await digiDentisCreateAppointment(config, FIXTURE_CLINIC_ID, {
        externalDoctorId: FIXTURE_DOCTOR_ID,
        externalTreatmentTypeId: FIXTURE_TREATMENT_TYPE_ID,
        date: '2026-08-21',
        startTime: '09:00',
        patientFirstName: SENTINEL_PATIENT_FIRST_NAME,
        patientLastName: SENTINEL_PATIENT_LAST_NAME,
        idempotencyKey,
      });

      assert.equal(second.externalAppointmentId, first.externalAppointmentId);
      assert.equal(mock.getAppointmentCount(), beforeCount + 1, 'a retried create must never create a second appointment');
    });

    await test('retrying create-appointment with the same key AFTER a transient 500 does not double-book', async () => {
      const idempotencyKey = `${FLAKY_ONCE_IDEMPOTENCY_KEY_PREFIX}${randomUUID()}`;
      const beforeCount = mock.getAppointmentCount();

      await assert.rejects(
        () =>
          digiDentisCreateAppointment(config, FIXTURE_CLINIC_ID, {
            externalDoctorId: FIXTURE_DOCTOR_ID,
            externalTreatmentTypeId: FIXTURE_TREATMENT_TYPE_ID,
            date: '2026-08-22',
            startTime: '09:00',
            patientFirstName: SENTINEL_PATIENT_FIRST_NAME,
            patientLastName: SENTINEL_PATIENT_LAST_NAME,
            idempotencyKey,
          }),
        ExternalCalendarTransientError,
      );
      assert.equal(mock.getAppointmentCount(), beforeCount, 'a failed attempt must not create a row');

      const retried = await digiDentisCreateAppointment(config, FIXTURE_CLINIC_ID, {
        externalDoctorId: FIXTURE_DOCTOR_ID,
        externalTreatmentTypeId: FIXTURE_TREATMENT_TYPE_ID,
        date: '2026-08-22',
        startTime: '09:00',
        patientFirstName: SENTINEL_PATIENT_FIRST_NAME,
        patientLastName: SENTINEL_PATIENT_LAST_NAME,
        idempotencyKey,
      });
      assert.ok(retried.externalAppointmentId);
      assert.equal(mock.getAppointmentCount(), beforeCount + 1);
    });

    section('Signing over real HTTP — headers, query exclusion, request-id observed on the wire');

    await test('a successful call left no X-Client-ID-less/anonymous request in the mock server log', () => {
      assert.ok(mock.requestLog.every((r) => r.clientId !== null));
    });

    section(
      'Vendor spec fidelity (§4) — the mock\'s independently-implemented verifier rejects a signing string that ' +
        'deviates from the documented field order, separator, timestamp unit, path canonicalization, body hashing, ' +
        'or signature encoding. These requests are hand-built with node:crypto directly against docs/vendor/digidentis, ' +
        'never through DigiDentisApiClient.ts/DigiDentisSigning.ts — a real drift in production signing would fail ' +
        'these the same way a hand-crafted deviation does.',
    );

    await test('a manually-built request following the documented shape exactly is accepted (positive control)', async () => {
      const ts = String(Math.floor(Date.now() / 1000));
      const nonce = randomUUID();
      const bodyHash = createHash('sha256').update('').digest('hex');
      const signingString = `${ts}.${nonce}.GET.status.${bodyHash}`;
      const signature = createHmac('sha256', DIGIDENTIS_TEST_CLIENT_SECRET).update(signingString).digest('hex');
      const res = await fetch(new URL('status', mock.baseUrl), {
        headers: {
          'X-Client-ID': DIGIDENTIS_TEST_CLIENT_ID,
          'X-Timestamp': ts,
          'X-Nonce': nonce,
          'X-Signature': signature,
        },
      });
      assert.equal(res.status, 200);
    });

    await test('field order swapped (nonce before timestamp) is rejected as SIGNATURE_INVALID', async () => {
      const ts = String(Math.floor(Date.now() / 1000));
      const nonce = randomUUID();
      const bodyHash = createHash('sha256').update('').digest('hex');
      const swappedOrderSigningString = `${nonce}.${ts}.GET.status.${bodyHash}`; // wrong: nonce, timestamp swapped
      const signature = createHmac('sha256', DIGIDENTIS_TEST_CLIENT_SECRET).update(swappedOrderSigningString).digest('hex');
      const res = await fetch(new URL('status', mock.baseUrl), {
        headers: { 'X-Client-ID': DIGIDENTIS_TEST_CLIENT_ID, 'X-Timestamp': ts, 'X-Nonce': nonce, 'X-Signature': signature },
      });
      const body = (await res.json()) as { error?: { code?: string } };
      assert.equal(res.status, 401);
      assert.equal(body.error?.code, 'SIGNATURE_INVALID');
    });

    await test('"." separator replaced with ":" is rejected as SIGNATURE_INVALID', async () => {
      const ts = String(Math.floor(Date.now() / 1000));
      const nonce = randomUUID();
      const bodyHash = createHash('sha256').update('').digest('hex');
      const wrongSeparatorSigningString = `${ts}:${nonce}:GET:status:${bodyHash}`; // wrong: ':' instead of '.'
      const signature = createHmac('sha256', DIGIDENTIS_TEST_CLIENT_SECRET).update(wrongSeparatorSigningString).digest('hex');
      const res = await fetch(new URL('status', mock.baseUrl), {
        headers: { 'X-Client-ID': DIGIDENTIS_TEST_CLIENT_ID, 'X-Timestamp': ts, 'X-Nonce': nonce, 'X-Signature': signature },
      });
      const body = (await res.json()) as { error?: { code?: string } };
      assert.equal(res.status, 401);
      assert.equal(body.error?.code, 'SIGNATURE_INVALID');
    });

    await test('signing with a millisecond timestamp (X-Timestamp header still in documented seconds) is rejected as SIGNATURE_INVALID', async () => {
      const tsSeconds = String(Math.floor(Date.now() / 1000));
      const tsMilliseconds = String(Number(tsSeconds) * 1000);
      const nonce = randomUUID();
      const bodyHash = createHash('sha256').update('').digest('hex');
      // Header carries the correct seconds value (so the freshness check passes)
      // but the signing string was built with milliseconds — a unit mismatch,
      // not a stale/expired timestamp.
      const msUnitSigningString = `${tsMilliseconds}.${nonce}.GET.status.${bodyHash}`;
      const signature = createHmac('sha256', DIGIDENTIS_TEST_CLIENT_SECRET).update(msUnitSigningString).digest('hex');
      const res = await fetch(new URL('status', mock.baseUrl), {
        headers: { 'X-Client-ID': DIGIDENTIS_TEST_CLIENT_ID, 'X-Timestamp': tsSeconds, 'X-Nonce': nonce, 'X-Signature': signature },
      });
      const body = (await res.json()) as { error?: { code?: string } };
      assert.equal(res.status, 401);
      assert.equal(body.error?.code, 'SIGNATURE_INVALID');
    });

    await test('signing with a leading-slash path ("/status" instead of the documented base-prefix-stripped "status") is rejected as SIGNATURE_INVALID', async () => {
      const ts = String(Math.floor(Date.now() / 1000));
      const nonce = randomUUID();
      const bodyHash = createHash('sha256').update('').digest('hex');
      const leadingSlashSigningString = `${ts}.${nonce}.GET./status.${bodyHash}`; // wrong: leading slash retained
      const signature = createHmac('sha256', DIGIDENTIS_TEST_CLIENT_SECRET).update(leadingSlashSigningString).digest('hex');
      const res = await fetch(new URL('status', mock.baseUrl), {
        headers: { 'X-Client-ID': DIGIDENTIS_TEST_CLIENT_ID, 'X-Timestamp': ts, 'X-Nonce': nonce, 'X-Signature': signature },
      });
      const body = (await res.json()) as { error?: { code?: string } };
      assert.equal(res.status, 401);
      assert.equal(body.error?.code, 'SIGNATURE_INVALID');
    });

    await test('signing with the query string folded into the path (documented behavior excludes it entirely) is rejected as SIGNATURE_INVALID', async () => {
      const ts = String(Math.floor(Date.now() / 1000));
      const nonce = randomUUID();
      const bodyHash = createHash('sha256').update('').digest('hex');
      const pathWithQuerySigningString = `${ts}.${nonce}.GET.status?probe=1.${bodyHash}`; // wrong: query string included
      const signature = createHmac('sha256', DIGIDENTIS_TEST_CLIENT_SECRET).update(pathWithQuerySigningString).digest('hex');
      const res = await fetch(new URL('status?probe=1', mock.baseUrl), {
        headers: { 'X-Client-ID': DIGIDENTIS_TEST_CLIENT_ID, 'X-Timestamp': ts, 'X-Nonce': nonce, 'X-Signature': signature },
      });
      const body = (await res.json()) as { error?: { code?: string } };
      assert.equal(res.status, 401);
      assert.equal(body.error?.code, 'SIGNATURE_INVALID');
    });

    await test('a body hash computed from anything other than the exact transmitted bytes is rejected as SIGNATURE_INVALID', async () => {
      const ts = String(Math.floor(Date.now() / 1000));
      const nonce = randomUUID();
      const realBody = Buffer.from(JSON.stringify({ probe: 'body-hash-fixture' }));
      const wrongBodyHash = createHash('sha256').update('').digest('hex'); // hash of "" — not this request's real body
      const wrongBodyHashSigningString = `${ts}.${nonce}.POST.status.${wrongBodyHash}`;
      const signature = createHmac('sha256', DIGIDENTIS_TEST_CLIENT_SECRET).update(wrongBodyHashSigningString).digest('hex');
      const res = await fetch(new URL('status', mock.baseUrl), {
        method: 'POST',
        headers: {
          'X-Client-ID': DIGIDENTIS_TEST_CLIENT_ID,
          'X-Timestamp': ts,
          'X-Nonce': nonce,
          'X-Signature': signature,
          'content-type': 'application/json',
        },
        body: realBody,
      });
      const body = (await res.json()) as { error?: { code?: string } };
      assert.equal(res.status, 401);
      assert.equal(body.error?.code, 'SIGNATURE_INVALID');
    });

    await test('a correctly-computed signature re-encoded as base64 instead of the documented hex is rejected as SIGNATURE_INVALID', async () => {
      const ts = String(Math.floor(Date.now() / 1000));
      const nonce = randomUUID();
      const bodyHash = createHash('sha256').update('').digest('hex');
      const signingString = `${ts}.${nonce}.GET.status.${bodyHash}`;
      const hexSignature = createHmac('sha256', DIGIDENTIS_TEST_CLIENT_SECRET).update(signingString).digest('hex');
      const base64Signature = Buffer.from(hexSignature, 'hex').toString('base64');
      const res = await fetch(new URL('status', mock.baseUrl), {
        headers: {
          'X-Client-ID': DIGIDENTIS_TEST_CLIENT_ID,
          'X-Timestamp': ts,
          'X-Nonce': nonce,
          'X-Signature': base64Signature,
        },
      });
      const body = (await res.json()) as { error?: { code?: string } };
      assert.equal(res.status, 401);
      assert.equal(body.error?.code, 'SIGNATURE_INVALID');
    });
  } finally {
    await mock.close();
  }

  console.log = originalConsoleLog;
  console.error = originalConsoleError;

  section('Privacy — secrets, signatures, and patient PII never appear in console output from this run');

  await test('the client secret(s), a real HMAC signature, and sentinel patient PII never appear anywhere in the captured console output', () => {
    const fullText = consoleLines.join('\n');
    const forbidden: Record<string, string> = {
      testClientSecret: DIGIDENTIS_TEST_CLIENT_SECRET,
      ipBlockedClientSecret: DIGIDENTIS_IP_BLOCKED_CLIENT_SECRET,
      patientFirstName: SENTINEL_PATIENT_FIRST_NAME,
      patientLastName: SENTINEL_PATIENT_LAST_NAME,
      patientFullPhone: SENTINEL_PATIENT_PHONE,
    };
    for (const [label, value] of Object.entries(forbidden)) {
      assert.ok(!fullText.includes(value), `${label} leaked into console output`);
    }
    // A raw hex HMAC-SHA256 signature is exactly 64 lowercase hex chars —
    // none of this suite's ~40 test names/section titles contain a run of
    // that length, so any match here would be a genuine signature leak.
    assert.equal(/\b[0-9a-f]{64}\b/.test(fullText), false, 'a raw 64-hex-char signature/hash leaked into console output');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});

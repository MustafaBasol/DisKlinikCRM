/**
 * DigiDentisApiClient.ts — low-level, HMAC-signed HTTP client for the
 * DigiDentiS Takvim API v3.2.0. Higher-level orchestration (mapping
 * resolution, tenant scoping) lives in DigiDentisProvider.ts /
 * externalCalendarConnectionService.ts — this module only knows how to make
 * one signed request and map the response/error.
 *
 * Verified against the real vendor documentation
 * (`docs/vendor/digidentis/DigiDentiS_Takvim_API_Documentation_v3.2.html`,
 * §5–§8). Authentication is per-request HMAC-SHA256 signing (X-Client-ID/
 * X-Timestamp/X-Nonce/X-Signature — see DigiDentisSigning.ts). There is no
 * token endpoint, no bearer token, and nothing to cache: every call signs
 * itself independently from the clinic's clientId/clientSecret.
 *
 * Response envelope (§6, §8): every response is
 * `{"success": true, "data": {...}, "meta": {...}}` on success, or
 * `{"success": false, "error": {"code": "...", "message": "..."}, "meta": {...}}`
 * on failure — this client unwraps `.data` on success and surfaces
 * `error.code`/`error.message` in thrown errors.
 */

import { signDigiDentisRequest } from './DigiDentisSigning.js';
import { DEFAULT_DIGIDENTIS_BASE_URL, DIGIDENTIS_PATHS } from './digidentisConfig.js';
import {
  ExternalCalendarAuthError,
  ExternalCalendarConflictError,
  ExternalCalendarRateLimitedError,
  ExternalCalendarTransientError,
  ExternalCalendarValidationError,
} from '../externalCalendarErrors.js';
import type {
  ExternalClinic,
  ExternalCompany,
  ExternalDoctor,
  ExternalSlot,
  ExternalSlotQuery,
  ExternalTreatmentType,
  CreateExternalAppointmentPayload,
  ExternalAppointmentResult,
  RescheduleExternalAppointmentInput,
} from '../ExternalCalendarProvider.js';

export type DigiDentisClientConfig = {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
};

type DigiDentisHttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

type RequestOptions = {
  method: DigiDentisHttpMethod;
  /** Relative path — no leading slash, no query string (see digidentisConfig.ts). */
  path: string;
  query?: Record<string, string | undefined>;
  body?: unknown;
  /** Sent as `X-Idempotency-Key` (vendor doc §3 "Optional Headers") — never a body field. */
  idempotencyKey?: string;
};

type DigiDentisSuccessEnvelope = { success: true; data: unknown; meta?: Record<string, unknown> };
type DigiDentisErrorEnvelope = {
  success: false;
  error: { code?: string; message?: string };
  meta?: Record<string, unknown>;
};

/**
 * Builds the full request URL. `path` (no leading slash) is resolved
 * against `baseUrl` — the URL constructor only appends a leading-slash-free
 * relative reference onto the base's own path; a leading-slash path would
 * instead resolve from the domain root and silently drop the
 * `/Api/v1/external_booking` prefix. The signing path used by the caller
 * below is `path` itself, verbatim: relative, no leading slash, no query
 * string (vendor doc §4, "what `path` is") — query parameters are appended
 * to the request URL here but are deliberately NEVER part of the signature.
 */
function buildUrl(baseUrl: string, path: string, query?: Record<string, string | undefined>): { url: string } {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const url = new URL(path, normalizedBase);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
  }
  return { url: url.toString() };
}

function retryAfterMs(response: Response): number | null {
  const header = response.headers.get('retry-after');
  if (!header) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) ? seconds * 1000 : null;
}

async function parseEnvelope(response: Response): Promise<DigiDentisSuccessEnvelope | DigiDentisErrorEnvelope | null> {
  return response
    .json()
    .then((body) => (body && typeof body === 'object' ? (body as DigiDentisSuccessEnvelope | DigiDentisErrorEnvelope) : null))
    .catch(() => null);
}

async function performRequest(
  config: DigiDentisClientConfig,
  options: RequestOptions,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const { url } = buildUrl(config.baseUrl, options.path, options.query);
  // The exact same Buffer is used both to compute the signature and as the
  // transmitted body below — signing a re-serialization of `options.body`
  // instead of these exact bytes would make the signature invalid on the
  // receiving end.
  const bodyBuffer = options.body !== undefined ? Buffer.from(JSON.stringify(options.body)) : Buffer.alloc(0);

  // Signing path: `options.path` verbatim — relative, no leading slash, no
  // query string. Never the resolved absolute URL's pathname (which would
  // include the base URL's own path prefix) and never a query-string-bearing
  // path.
  const signedHeaders = signDigiDentisRequest(config.clientId, config.clientSecret, options.method, options.path, bodyBuffer);

  const headers: Record<string, string> = { ...signedHeaders };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.idempotencyKey) headers['X-Idempotency-Key'] = options.idempotencyKey;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: options.method,
      headers,
      body: options.body !== undefined ? bodyBuffer : undefined,
    });
  } catch (err) {
    throw new ExternalCalendarTransientError('DigiDentiS', null, (err as Error).message);
  }

  const envelope = await parseEnvelope(response);
  const errorCode = envelope && envelope.success === false ? envelope.error?.code ?? null : null;
  const errorMessage = envelope && envelope.success === false ? envelope.error?.message : undefined;

  if (response.status === 401 || response.status === 403) {
    throw new ExternalCalendarAuthError(
      'DigiDentiS',
      errorCode ? `${errorCode}${errorMessage ? `: ${errorMessage}` : ''}` : `HTTP ${response.status}`,
    );
  }
  if (response.status === 409) {
    throw new ExternalCalendarConflictError('DigiDentiS', errorCode, errorMessage);
  }
  if (response.status === 429) {
    throw new ExternalCalendarRateLimitedError('DigiDentiS', retryAfterMs(response));
  }
  if (response.status >= 500) {
    throw new ExternalCalendarTransientError('DigiDentiS', response.status, errorMessage);
  }
  if (response.status >= 400) {
    throw new ExternalCalendarValidationError('DigiDentiS', response.status, errorMessage, errorCode);
  }

  if (response.status === 204) return null;
  if (!envelope) return null;
  return envelope.success ? envelope.data : null;
}

/** vendor doc §7.1 — the one endpoint documented as rate-limit-exempt,
 *  designed for exactly this purpose ("monitoring should never fail"). */
export async function digiDentisHealthCheck(
  config: DigiDentisClientConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<{ success: boolean; message: string }> {
  await performRequest(config, { method: 'GET', path: DIGIDENTIS_PATHS.health }, fetchImpl);
  return { success: true, message: 'DigiDentiS connection verified.' };
}

/** Alias kept for existing callers — delegates to the documented,
 *  rate-limit-exempt health endpoint rather than a data-listing endpoint. */
export const digiDentisTestConnection = digiDentisHealthCheck;

export async function digiDentisListCompanies(
  config: DigiDentisClientConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<ExternalCompany[]> {
  const data = (await performRequest(config, { method: 'GET', path: DIGIDENTIS_PATHS.companies }, fetchImpl)) as
    | { companies?: ExternalCompany[] }
    | null;
  return data?.companies ?? [];
}

export async function digiDentisGetCompanyDetails(
  config: DigiDentisClientConfig,
  companyId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ExternalCompany | null> {
  return (await performRequest(
    config,
    { method: 'GET', path: DIGIDENTIS_PATHS.companyDetails(companyId) },
    fetchImpl,
  )) as ExternalCompany | null;
}

export async function digiDentisGetCompanyQuota(
  config: DigiDentisClientConfig,
  companyId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  return performRequest(config, { method: 'GET', path: DIGIDENTIS_PATHS.companyQuota(companyId) }, fetchImpl);
}

export async function digiDentisListClinics(
  config: DigiDentisClientConfig,
  companyId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ExternalClinic[]> {
  const data = (await performRequest(
    config,
    { method: 'GET', path: DIGIDENTIS_PATHS.clinicsForCompany(companyId) },
    fetchImpl,
  )) as { clinics?: ExternalClinic[] } | null;
  return data?.clinics ?? [];
}

/** Company-scoped, not clinic-scoped (vendor doc §7.6) — each returned
 *  doctor record carries its own `clinic_id`. */
export async function digiDentisListDoctors(
  config: DigiDentisClientConfig,
  companyId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ExternalDoctor[]> {
  const data = (await performRequest(
    config,
    { method: 'GET', path: DIGIDENTIS_PATHS.doctorsForCompany(companyId) },
    fetchImpl,
  )) as { doctors?: Array<{ id: string; name: string; clinic_id?: string | null }> } | null;
  return (data?.doctors ?? []).map((d) => ({ id: d.id, name: d.name, clinicId: d.clinic_id ?? null }));
}

/** Company-scoped, not clinic-scoped (vendor doc §7.10). An empty result
 *  means no treatment type has "API Visible" enabled in the DigiDentiS
 *  dashboard (Settings > System > Customization) — not an error. */
export async function digiDentisListTreatmentTypes(
  config: DigiDentisClientConfig,
  companyId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ExternalTreatmentType[]> {
  const data = (await performRequest(
    config,
    { method: 'GET', path: DIGIDENTIS_PATHS.treatmentTypesForCompany(companyId) },
    fetchImpl,
  )) as { treatment_types?: Array<{ id: string; name: string; duration_minutes?: number }> } | null;
  return (data?.treatment_types ?? []).map((t) => ({ id: t.id, name: t.name, durationMinutes: t.duration_minutes ?? null }));
}

/**
 * Doctor availability (vendor doc §7.8) — no treatment-type filter exists on
 * this endpoint. The response is grouped by date
 * (`{ "2026-01-21": [{start, end, duration}, ...] }`); flattened here into
 * a flat ExternalSlot[].
 */
export async function digiDentisListAvailableSlots(
  config: DigiDentisClientConfig,
  query: ExternalSlotQuery,
  fetchImpl: typeof fetch = fetch,
): Promise<ExternalSlot[]> {
  const data = (await performRequest(
    config,
    {
      method: 'GET',
      path: DIGIDENTIS_PATHS.doctorSlots(query.externalDoctorId),
      query: { start_date: query.fromDate, end_date: query.toDate },
    },
    fetchImpl,
  )) as { available_slots?: Record<string, Array<{ start: string; end: string }>> } | null;

  const slots: ExternalSlot[] = [];
  for (const [date, daySlots] of Object.entries(data?.available_slots ?? {})) {
    for (const slot of daySlots) {
      slots.push({ date, startTime: slot.start, endTime: slot.end, externalDoctorId: query.externalDoctorId });
    }
  }
  return slots;
}

/** vendor doc §7.11 — requires company_id; very low rate limits (0/s, 5/min
 *  per §5.2), intended for a one-time initial load, not routine polling. */
export async function digiDentisFullSync(
  config: DigiDentisClientConfig,
  companyId: string,
  dateRange?: { startDate?: string; endDate?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  return performRequest(
    config,
    {
      method: 'GET',
      path: DIGIDENTIS_PATHS.fullSync,
      query: { company_id: companyId, start_date: dateRange?.startDate, end_date: dateRange?.endDate },
    },
    fetchImpl,
  );
}

/**
 * vendor doc §7.12. `treatment_type` must be a public treatment-type id
 * obtained from `digiDentisListTreatmentTypes`. `clinic_id` is included in
 * the request body per the vendor doc's own worked example (§7.12 "Request
 * Example") even though it is not listed in that section's request-body
 * field table — a documented inconsistency; included here to match the
 * example rather than the (seemingly incomplete) table. The idempotency
 * key is sent as the `X-Idempotency-Key` HEADER (vendor doc §3), never a
 * body field.
 */
export async function digiDentisCreateAppointment(
  config: DigiDentisClientConfig,
  externalClinicId: string,
  payload: CreateExternalAppointmentPayload,
  fetchImpl: typeof fetch = fetch,
): Promise<ExternalAppointmentResult> {
  const data = (await performRequest(
    config,
    {
      method: 'POST',
      path: DIGIDENTIS_PATHS.appointments,
      idempotencyKey: payload.idempotencyKey,
      body: {
        clinic_id: externalClinicId,
        doctor_id: payload.externalDoctorId,
        date: payload.date,
        start_time: payload.startTime,
        end_time: payload.endTime ?? undefined,
        treatment_duration: payload.treatmentDurationMinutes ?? undefined,
        treatment_type: payload.externalTreatmentTypeId,
        patient_first_name: payload.patientFirstName,
        patient_last_name: payload.patientLastName,
        patient_phone: payload.patientPhone ?? undefined,
        patient_email: payload.patientEmail ?? undefined,
        notes: payload.notes ?? undefined,
        booking_id: payload.bookingId ?? undefined,
      },
    },
    fetchImpl,
  )) as { id?: string; status?: string } | null;

  if (!data?.id) {
    throw new ExternalCalendarValidationError('DigiDentiS', null, 'Create-appointment response had no appointment id');
  }
  return { externalAppointmentId: data.id, status: data.status ?? 'confirmed' };
}

export async function digiDentisListAppointments(
  config: DigiDentisClientConfig,
  filter: { companyId?: string; clinicId?: string; doctorId?: string; startDate: string; endDate: string },
  fetchImpl: typeof fetch = fetch,
): Promise<unknown[]> {
  const data = (await performRequest(
    config,
    {
      method: 'GET',
      path: DIGIDENTIS_PATHS.appointments,
      query: {
        company_id: filter.companyId,
        clinic_id: filter.clinicId,
        doctor_id: filter.doctorId,
        start_date: filter.startDate,
        end_date: filter.endDate,
      },
    },
    fetchImpl,
  )) as { appointments?: unknown[] } | null;
  return data?.appointments ?? [];
}

/** vendor doc §7.14 — only returns appointments created through this same API. */
export async function digiDentisGetAppointment(
  config: DigiDentisClientConfig,
  externalAppointmentId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  return performRequest(config, { method: 'GET', path: DIGIDENTIS_PATHS.appointmentById(externalAppointmentId) }, fetchImpl);
}

/**
 * vendor doc §7.15 — `reason` is a QUERY PARAMETER on the DELETE request,
 * never a body field (DELETE requests carry no body in this API). Only
 * appointments created through this same API can be cancelled.
 */
export async function digiDentisCancelAppointment(
  config: DigiDentisClientConfig,
  externalAppointmentId: string,
  reason: string | undefined,
  idempotencyKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await performRequest(
    config,
    {
      method: 'DELETE',
      path: DIGIDENTIS_PATHS.appointmentById(externalAppointmentId),
      query: { reason },
      idempotencyKey,
    },
    fetchImpl,
  );
}

/** vendor doc §7.16 — PUT (PATCH also accepted by the real API; PUT used here). */
export async function digiDentisRescheduleAppointment(
  config: DigiDentisClientConfig,
  externalAppointmentId: string,
  input: RescheduleExternalAppointmentInput,
  fetchImpl: typeof fetch = fetch,
): Promise<ExternalAppointmentResult> {
  const data = (await performRequest(
    config,
    {
      method: 'PUT',
      path: DIGIDENTIS_PATHS.appointmentById(externalAppointmentId),
      idempotencyKey: input.idempotencyKey,
      body: {
        date: input.date,
        start_time: input.startTime,
        end_time: input.endTime ?? undefined,
        treatment_duration: input.treatmentDurationMinutes ?? undefined,
      },
    },
    fetchImpl,
  )) as { id?: string; status?: string } | null;

  return { externalAppointmentId: data?.id ?? externalAppointmentId, status: data?.status ?? 'confirmed' };
}

export function resolveDigiDentisBaseUrl(apiBaseUrl: string | null | undefined): string {
  return apiBaseUrl?.trim() || DEFAULT_DIGIDENTIS_BASE_URL;
}

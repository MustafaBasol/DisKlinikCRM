/**
 * DigiDentisApiClient.ts — low-level, signed HTTP client for the DigiDentiS
 * v3.2.0 API. Higher-level orchestration (mapping resolution, tenant
 * scoping) lives in DigiDentisProvider.ts / externalCalendarConnectionService.ts
 * — this module only knows how to make one signed, authenticated call and
 * map the response/error.
 *
 * See DigiDentisSigning.ts's header comment: request signing and endpoint
 * paths are assumed placeholders pending real v3.2.0 documentation.
 */

import { getDigiDentisAccessToken } from './DigiDentisAuthClient.js';
import { signDigiDentisRequest } from './DigiDentisSigning.js';
import { DEFAULT_DIGIDENTIS_BASE_URL, DIGIDENTIS_PATHS } from './digidentisConfig.js';
import {
  ExternalCalendarAuthError,
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
} from '../ExternalCalendarProvider.js';

export type DigiDentisClientConfig = {
  connectionId: string;
  baseUrl: string;
  clientId: string;
  clientSecret: string;
};

type RequestOptions = {
  method: 'GET' | 'POST';
  path: string;
  query?: Record<string, string | undefined>;
  body?: unknown;
};

function buildUrl(baseUrl: string, path: string, query?: Record<string, string | undefined>): { url: string; pathWithQuery: string } {
  const url = new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
  }
  return { url: url.toString(), pathWithQuery: `${url.pathname}${url.search}` };
}

function retryAfterMs(response: Response): number | null {
  const header = response.headers.get('retry-after');
  if (!header) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) ? seconds * 1000 : null;
}

async function performRequest(
  config: DigiDentisClientConfig,
  options: RequestOptions,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const { url, pathWithQuery } = buildUrl(config.baseUrl, options.path, options.query);
  const bodyBuffer = options.body !== undefined ? Buffer.from(JSON.stringify(options.body)) : Buffer.alloc(0);

  const accessToken = await getDigiDentisAccessToken(
    {
      connectionId: config.connectionId,
      baseUrl: config.baseUrl,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    },
    fetchImpl,
  );

  const signedHeaders = signDigiDentisRequest(config.clientId, config.clientSecret, options.method, pathWithQuery, bodyBuffer);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: options.method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...signedHeaders,
      },
      body: options.body !== undefined ? bodyBuffer : undefined,
    });
  } catch (err) {
    throw new ExternalCalendarTransientError('DigiDentiS', null, (err as Error).message);
  }

  if (response.status === 401 || response.status === 403) {
    throw new ExternalCalendarAuthError('DigiDentiS', `HTTP ${response.status}`);
  }
  if (response.status === 429) {
    throw new ExternalCalendarRateLimitedError('DigiDentiS', retryAfterMs(response));
  }
  if (response.status >= 500) {
    throw new ExternalCalendarTransientError('DigiDentiS', response.status);
  }
  if (response.status >= 400) {
    const detail = await response.text().catch(() => undefined);
    throw new ExternalCalendarValidationError('DigiDentiS', response.status, detail?.slice(0, 500));
  }

  if (response.status === 204) return null;
  return response.json().catch(() => null);
}

export async function digiDentisTestConnection(
  config: DigiDentisClientConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<{ success: boolean; message: string }> {
  await performRequest(config, { method: 'GET', path: DIGIDENTIS_PATHS.companies }, fetchImpl);
  return { success: true, message: 'DigiDentiS connection verified.' };
}

export async function digiDentisListCompanies(
  config: DigiDentisClientConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<ExternalCompany[]> {
  const data = (await performRequest(config, { method: 'GET', path: DIGIDENTIS_PATHS.companies }, fetchImpl)) as
    | { companies?: ExternalCompany[] }
    | ExternalCompany[]
    | null;
  return Array.isArray(data) ? data : data?.companies ?? [];
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
  )) as { clinics?: ExternalClinic[] } | ExternalClinic[] | null;
  return Array.isArray(data) ? data : data?.clinics ?? [];
}

export async function digiDentisListDoctors(
  config: DigiDentisClientConfig,
  externalClinicId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ExternalDoctor[]> {
  const data = (await performRequest(
    config,
    { method: 'GET', path: DIGIDENTIS_PATHS.doctors(externalClinicId) },
    fetchImpl,
  )) as { doctors?: ExternalDoctor[] } | ExternalDoctor[] | null;
  return Array.isArray(data) ? data : data?.doctors ?? [];
}

export async function digiDentisListTreatmentTypes(
  config: DigiDentisClientConfig,
  externalClinicId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ExternalTreatmentType[]> {
  const data = (await performRequest(
    config,
    { method: 'GET', path: DIGIDENTIS_PATHS.treatmentTypes(externalClinicId) },
    fetchImpl,
  )) as { treatmentTypes?: ExternalTreatmentType[] } | ExternalTreatmentType[] | null;
  return Array.isArray(data) ? data : data?.treatmentTypes ?? [];
}

export async function digiDentisListAvailableSlots(
  config: DigiDentisClientConfig,
  externalClinicId: string,
  query: ExternalSlotQuery,
  fetchImpl: typeof fetch = fetch,
): Promise<ExternalSlot[]> {
  const data = (await performRequest(
    config,
    {
      method: 'GET',
      path: DIGIDENTIS_PATHS.availableSlots(externalClinicId),
      query: {
        doctorId: query.externalDoctorId,
        treatmentTypeId: query.externalTreatmentTypeId,
        from: query.fromDate,
        to: query.toDate,
      },
    },
    fetchImpl,
  )) as { slots?: ExternalSlot[] } | ExternalSlot[] | null;
  return Array.isArray(data) ? data : data?.slots ?? [];
}

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
      path: DIGIDENTIS_PATHS.appointments(externalClinicId),
      body: {
        doctorId: payload.externalDoctorId,
        treatmentTypeId: payload.externalTreatmentTypeId,
        startTime: payload.startTime,
        endTime: payload.endTime,
        patientName: payload.patientName,
        patientPhone: payload.patientPhone ?? undefined,
        notes: payload.notes ?? undefined,
        idempotencyKey: payload.idempotencyKey,
      },
    },
    fetchImpl,
  )) as { id?: string; appointmentId?: string; status?: string } | null;

  const externalAppointmentId = data?.id ?? data?.appointmentId;
  if (!externalAppointmentId) {
    throw new ExternalCalendarValidationError('DigiDentiS', null, 'Create-appointment response had no appointment id');
  }
  return { externalAppointmentId, status: data?.status ?? 'created' };
}

export async function digiDentisCancelAppointment(
  config: DigiDentisClientConfig,
  externalClinicId: string,
  externalAppointmentId: string,
  reason: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await performRequest(
    config,
    {
      method: 'POST',
      path: DIGIDENTIS_PATHS.appointmentCancel(externalClinicId, externalAppointmentId),
      body: { reason: reason ?? undefined },
    },
    fetchImpl,
  );
}

export async function digiDentisRescheduleAppointment(
  config: DigiDentisClientConfig,
  externalClinicId: string,
  externalAppointmentId: string,
  newStartTime: string,
  newEndTime: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ExternalAppointmentResult> {
  const data = (await performRequest(
    config,
    {
      method: 'POST',
      path: DIGIDENTIS_PATHS.appointmentReschedule(externalClinicId, externalAppointmentId),
      body: { startTime: newStartTime, endTime: newEndTime },
    },
    fetchImpl,
  )) as { id?: string; appointmentId?: string; status?: string } | null;

  const id = data?.id ?? data?.appointmentId ?? externalAppointmentId;
  return { externalAppointmentId: id, status: data?.status ?? 'rescheduled' };
}

export function resolveDigiDentisBaseUrl(apiBaseUrl: string | null | undefined): string {
  return apiBaseUrl?.trim() || DEFAULT_DIGIDENTIS_BASE_URL;
}

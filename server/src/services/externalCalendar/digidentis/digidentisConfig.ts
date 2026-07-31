/**
 * digidentisConfig.ts — shared constants for the DigiDentiS v3.2.0 client.
 *
 * Authentication is per-request HMAC signing (see DigiDentisSigning.ts) —
 * there is no token endpoint and no bearer token, so no auth-related
 * constant lives here anymore.
 *
 * PATHS below are assumed REST conventions, not confirmed against the real
 * v3.2.0 spec (see DigiDentisSigning.ts's header comment for why). Kept in
 * one place so they are trivial to correct later without touching call
 * sites in DigiDentisApiClient.ts.
 */

export const DIGIDENTIS_PROVIDER_KEY = 'digidentis';
export const DIGIDENTIS_API_VERSION = 'v3.2.0';

/** RFC 2606 .invalid TLD — never a real, reachable host — used only as a
 *  last-resort default so a misconfigured clinic fails loudly instead of
 *  silently calling an unintended real endpoint. */
export const DEFAULT_DIGIDENTIS_BASE_URL =
  process.env.DIGIDENTIS_DEFAULT_API_BASE_URL?.trim() || 'https://sandbox.digidentis.invalid/api/v3.2';

export const DIGIDENTIS_PATHS = {
  companies: '/companies',
  clinicsForCompany: (companyId: string) => `/companies/${encodeURIComponent(companyId)}/clinics`,
  doctors: (clinicId: string) => `/clinics/${encodeURIComponent(clinicId)}/doctors`,
  treatmentTypes: (clinicId: string) => `/clinics/${encodeURIComponent(clinicId)}/treatment-types`,
  availableSlots: (clinicId: string) => `/clinics/${encodeURIComponent(clinicId)}/available-slots`,
  appointments: (clinicId: string) => `/clinics/${encodeURIComponent(clinicId)}/appointments`,
  appointmentCancel: (clinicId: string, appointmentId: string) =>
    `/clinics/${encodeURIComponent(clinicId)}/appointments/${encodeURIComponent(appointmentId)}/cancel`,
  appointmentReschedule: (clinicId: string, appointmentId: string) =>
    `/clinics/${encodeURIComponent(clinicId)}/appointments/${encodeURIComponent(appointmentId)}/reschedule`,
} as const;

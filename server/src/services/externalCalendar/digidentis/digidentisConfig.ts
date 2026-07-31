/**
 * digidentisConfig.ts — shared constants for the DigiDentiS Takvim API
 * v3.2.0 client.
 *
 * Base URL and every path below are verified against the real vendor
 * documentation (`docs/vendor/digidentis/DigiDentiS_Takvim_API_Documentation_v3.2.html`,
 * §1 "Base URL" and §7 "API Endpoints") — none of this is a placeholder.
 *
 * All paths are relative, WITHOUT a leading slash. This matters for two
 * independent reasons:
 *   1. Signing (DigiDentisSigning.ts): the documented signing string uses
 *      "the endpoint path relative to the base URL, with no leading slash
 *      and no query string" (§4) — these path values are used AS-IS as the
 *      signing path, so they must never carry a leading slash or query.
 *   2. URL resolution (DigiDentisApiClient.ts): `new URL(path, baseUrl)`
 *      only appends a relative path onto the base URL's own path when the
 *      relative reference has no leading slash. A leading-slash path
 *      resolves from the domain root instead, silently discarding the
 *      `/Api/v1/external_booking` prefix — a real bug the previous
 *      placeholder paths had (invisible because the placeholder base URL
 *      had no path prefix to lose).
 *
 * The API is company-scoped, not clinic-scoped: doctors, treatment types,
 * and the full-sync export are listed per `company_id`, not per
 * `clinic_id` — clinic filtering happens via each record's own `clinic_id`
 * field or an optional `clinic_id` query parameter, never via a
 * clinic-nested path segment.
 */

export const DIGIDENTIS_PROVIDER_KEY = 'digidentis';
export const DIGIDENTIS_API_VERSION = 'v3.2.0';

/**
 * Verified production base URL (vendor doc §1, "Base URL — Production").
 * The vendor documentation lists exactly one base URL — no sandbox/staging
 * host is documented anywhere in the v3.2.0 spec. Confirm with DigiDentiS
 * support directly whether a non-production environment exists before
 * assuming this can be safely used for testing (see
 * docs/architecture/external-calendar-integration.md).
 */
export const DIGIDENTIS_VERIFIED_PRODUCTION_BASE_URL = 'https://www.ddslogin.com/Api/v1/external_booking';

export const DEFAULT_DIGIDENTIS_BASE_URL =
  process.env.DIGIDENTIS_DEFAULT_API_BASE_URL?.trim() || DIGIDENTIS_VERIFIED_PRODUCTION_BASE_URL;

/**
 * Every path is relative (no leading slash) and excludes any query string —
 * see this file's header comment. Path segments built from caller-supplied
 * ids are `encodeURIComponent`-escaped so the exact same string can be used
 * both to build the request URL and to compute the request signature.
 */
export const DIGIDENTIS_PATHS = {
  /** §7.1 — authenticated; the one endpoint documented as rate-limit-exempt. */
  health: 'status',
  /** §7.2 — GET, paginated (page, per_page). */
  companies: 'companies',
  /** §7.3 — GET. */
  companyDetails: (companyId: string) => `companies/${encodeURIComponent(companyId)}`,
  /** §7.4 — GET. */
  companyQuota: (companyId: string) => `companies/${encodeURIComponent(companyId)}/quota`,
  /** §7.5 — GET, paginated. */
  clinicsForCompany: (companyId: string) => `companies/${encodeURIComponent(companyId)}/clinics`,
  /** §7.6 — GET, paginated. Company-scoped, NOT clinic-scoped. */
  doctorsForCompany: (companyId: string) => `companies/${encodeURIComponent(companyId)}/doctors`,
  /** §7.7 — GET. */
  doctorDetails: (doctorId: string) => `doctors/${encodeURIComponent(doctorId)}`,
  /** §7.8 — GET (start_date, end_date query params, max 90-day span). */
  doctorSlots: (doctorId: string) => `doctors/${encodeURIComponent(doctorId)}/slots`,
  /** §7.9 — GET, company-wide (company_id required query param). */
  companySlots: 'slots',
  /** §7.10 — GET, paginated. Empty result means no treatment type has "API
   *  Visible" enabled in the DigiDentiS dashboard (Settings > System >
   *  Customization) — see externalCalendarConnectionService.ts callers. */
  treatmentTypesForCompany: (companyId: string) => `companies/${encodeURIComponent(companyId)}/treatment-types`,
  /** §7.11 — GET, requires company_id; heavily rate-limited (5/min) —
   *  intended for a one-time initial load, not routine polling. */
  fullSync: 'sync',
  /** §7.12 (POST) / §7.13 (GET, list). */
  appointments: 'appointments',
  /** §7.14 (GET) / §7.15 (DELETE) / §7.16 (PUT, PATCH also accepted). */
  appointmentById: (appointmentId: string) => `appointments/${encodeURIComponent(appointmentId)}`,
} as const;

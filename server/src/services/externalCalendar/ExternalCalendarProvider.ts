/**
 * ExternalCalendarProvider.ts — Provider-Agnostic External Calendar Interface
 *
 * All external dental-software calendar providers (DigiDentiS, future
 * providers) must implement this interface. Orchestration code (routes,
 * jobs, the future appointment-approval boundary) calls providers only
 * through externalCalendarProviderFactory.ts — never a concrete class
 * directly — mirroring services/whatsapp/WhatsAppProvider.ts.
 *
 * Shapes below are verified against the real DigiDentiS Takvim API v3.2.0
 * documentation where DigiDentiS is concerned (dates/times, UUID prefixes,
 * company-vs-clinic scoping) — see DigiDentisApiClient.ts. This interface
 * itself stays provider-agnostic; a future second provider may not share
 * every field (e.g. `treatmentDurationMinutes`), which is fine — it simply
 * won't populate/require what its own real API doesn't support.
 */

/** Minimal connection info a provider needs. Encrypted fields are decrypted
 *  by the provider implementation itself — never by callers. */
export type ExternalCalendarConnectionRecord = {
  id: string;
  clinicId: string;
  organizationId: string;
  provider: string;
  clientId?: string | null;
  clientSecretEncrypted?: string | null;
  webhookSecretEncrypted?: string | null;
  externalCompanyId?: string | null;
  externalClinicId?: string | null;
  apiBaseUrl?: string | null;
};

export type ExternalCompany = { id: string; name: string };
export type ExternalClinic = { id: string; name: string };
export type ExternalDoctor = { id: string; name: string; clinicId?: string | null };
export type ExternalTreatmentType = { id: string; name: string; durationMinutes?: number | null };

/**
 * DigiDentiS's own doctor-slots endpoint takes only a doctor id plus a date
 * range (vendor doc §7.8) — there is no treatment-type filter on
 * availability. `fromDate`/`toDate` are `YYYY-MM-DD`, Europe/Istanbul (the
 * vendor's documented timezone, §10.3); a future provider with different
 * slot semantics implements this the same way its own real API works.
 */
export type ExternalSlotQuery = {
  externalDoctorId: string;
  fromDate: string;
  toDate: string;
};

export type ExternalSlot = {
  /** `YYYY-MM-DD`, Europe/Istanbul. */
  date: string;
  /** `HH:MM`, 24-hour, Europe/Istanbul. */
  startTime: string;
  endTime: string;
  externalDoctorId: string;
};

/**
 * DigiDentiS's create/reschedule-appointment body (vendor doc §7.12, §7.16)
 * splits date and time, and accepts EITHER an explicit `endTime` OR a
 * `treatmentDurationMinutes` (never both meaningfully) — if neither is
 * given, the provider's own default appointment duration for that doctor
 * applies. Patient name is two fields, not one, per the real API.
 */
export type CreateExternalAppointmentPayload = {
  externalDoctorId: string;
  externalTreatmentTypeId: string;
  /** `YYYY-MM-DD`, Europe/Istanbul. */
  date: string;
  /** `HH:MM`, 24-hour, Europe/Istanbul. */
  startTime: string;
  endTime?: string | null;
  treatmentDurationMinutes?: number | null;
  patientFirstName: string;
  patientLastName: string;
  patientPhone?: string | null;
  patientEmail?: string | null;
  notes?: string | null;
  /** Caller's own internal booking reference, echoed back by some providers. */
  bookingId?: string | null;
  /** Client-generated idempotency key — a retried call with the same key
   *  must never create a second provider-side appointment. Sent as a
   *  request HEADER by DigiDentiS (X-Idempotency-Key), never a body field. */
  idempotencyKey: string;
};

/** Same date/time split as create — see CreateExternalAppointmentPayload. */
export type RescheduleExternalAppointmentInput = {
  date: string;
  startTime: string;
  endTime?: string | null;
  treatmentDurationMinutes?: number | null;
  /** Sent as X-Idempotency-Key, same convention as create. */
  idempotencyKey?: string;
};

export type ExternalAppointmentResult = {
  externalAppointmentId: string;
  status: string;
};

export type TestConnectionResult = {
  success: boolean;
  message: string;
};

/**
 * DigiDentiS's webhook contract (vendor doc §11.1) defines six event types:
 * three that fire today ("Available") and three reserved for later
 * ("Reserved" — explicitly part of the contract, arriving automatically
 * once activated). Both groups are recognized/normalized here; only
 * genuinely unrecognized provider event types fall back to 'unknown'.
 */
export type ExternalCalendarEventType =
  | 'appointment.created'
  | 'appointment.confirmed'
  | 'appointment.cancelled'
  | 'appointment.rescheduled'
  | 'appointment.completed'
  | 'appointment.no_show'
  | 'unknown';

export type ParsedExternalCalendarWebhookEvent = {
  /** Normalized to one of the six documented event types when recognized;
   *  'unknown' otherwise (never invented/guessed). */
  eventType: ExternalCalendarEventType;
  /** The provider's raw event type string, always populated. */
  rawEventType: string;
  /** Dedupe key for this specific delivery. For DigiDentiS this is the
   *  `X-Webhook-Id` request header (vendor doc §11.2/§11.5: "use X-Webhook-Id
   *  (or data.id) to make your processing idempotent") — never guessed from
   *  the payload body when a proper delivery id is available out-of-band. */
  providerEventId: string;
  externalAppointmentId?: string;
  raw: unknown;
};

export interface ExternalCalendarProvider {
  /** Verify connectivity / credentials without mutating anything. */
  testConnection(connection: ExternalCalendarConnectionRecord): Promise<TestConnectionResult>;

  listCompanies(connection: ExternalCalendarConnectionRecord): Promise<ExternalCompany[]>;
  listClinics(connection: ExternalCalendarConnectionRecord, companyId: string): Promise<ExternalClinic[]>;
  /** Doctors are listed per DigiDentiS *company*, not per clinic (vendor doc §7.6). */
  listDoctors(connection: ExternalCalendarConnectionRecord): Promise<ExternalDoctor[]>;
  /** Treatment types are listed per DigiDentiS *company* (vendor doc §7.10) —
   *  an empty result means none are marked "API Visible" in the DigiDentiS
   *  dashboard (Settings > System > Customization), not an error. */
  listTreatmentTypes(connection: ExternalCalendarConnectionRecord): Promise<ExternalTreatmentType[]>;
  listAvailableSlots(
    connection: ExternalCalendarConnectionRecord,
    query: ExternalSlotQuery,
  ): Promise<ExternalSlot[]>;

  /** Create an appointment. Must be idempotent on payload.idempotencyKey. */
  createAppointment(
    connection: ExternalCalendarConnectionRecord,
    payload: CreateExternalAppointmentPayload,
  ): Promise<ExternalAppointmentResult>;

  /**
   * Cancel a previously created appointment, where the documented API
   * allows it. Only appointments created through this same API can be
   * cancelled (vendor doc §7.15) — a front-desk-created DigiDentiS
   * appointment is out of reach entirely.
   */
  cancelAppointment(
    connection: ExternalCalendarConnectionRecord,
    externalAppointmentId: string,
    reason?: string,
    idempotencyKey?: string,
  ): Promise<void>;

  /**
   * Reschedule a previously created appointment, where the documented API
   * allows it. Same API-created-only restriction as cancelAppointment.
   */
  rescheduleAppointment(
    connection: ExternalCalendarConnectionRecord,
    externalAppointmentId: string,
    input: RescheduleExternalAppointmentInput,
  ): Promise<ExternalAppointmentResult>;

  /** Verify an inbound webhook's signature. Returns false on any mismatch. */
  verifyWebhookSignature(
    connection: ExternalCalendarConnectionRecord,
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): boolean;

  /**
   * Parse an already-signature-verified webhook payload into a normalized
   * event. `headers` is passed alongside the payload because the
   * provider-agnostic delivery/dedupe id may live in a header rather than
   * the body (DigiDentiS: `X-Webhook-Id`, vendor doc §11.2).
   */
  parseWebhook(
    payload: unknown,
    headers: Record<string, string | string[] | undefined>,
  ): ParsedExternalCalendarWebhookEvent;
}

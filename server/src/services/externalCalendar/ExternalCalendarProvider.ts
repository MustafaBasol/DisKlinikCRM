/**
 * ExternalCalendarProvider.ts — Provider-Agnostic External Calendar Interface
 *
 * All external dental-software calendar providers (DigiDentiS, future
 * providers) must implement this interface. Orchestration code (routes,
 * jobs, the future appointment-approval boundary) calls providers only
 * through externalCalendarProviderFactory.ts — never a concrete class
 * directly — mirroring services/whatsapp/WhatsAppProvider.ts.
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
export type ExternalClinic = { id: string; companyId: string; name: string };
export type ExternalDoctor = { id: string; name: string; isActive?: boolean };
export type ExternalTreatmentType = { id: string; name: string; durationMinutes?: number; isActive?: boolean };

export type ExternalSlotQuery = {
  externalDoctorId: string;
  externalTreatmentTypeId: string;
  fromDate: string; // ISO date (yyyy-mm-dd) — provider's own calendar timezone
  toDate: string;
};

export type ExternalSlot = {
  startTime: string; // ISO 8601
  endTime: string; // ISO 8601
  externalDoctorId: string;
};

export type CreateExternalAppointmentPayload = {
  externalDoctorId: string;
  externalTreatmentTypeId: string;
  startTime: string; // ISO 8601
  endTime: string; // ISO 8601
  patientName: string;
  patientPhone?: string | null;
  notes?: string | null;
  /** Client-generated idempotency key — a retried call with the same key
   *  must never create a second provider-side appointment. */
  idempotencyKey: string;
};

export type ExternalAppointmentResult = {
  externalAppointmentId: string;
  status: string;
};

export type TestConnectionResult = {
  success: boolean;
  message: string;
};

export type ParsedExternalCalendarWebhookEvent = {
  /** Normalized to one of the active event types when recognized; the
   *  provider's own raw type string otherwise (never invented/guessed). */
  eventType: 'appointment.created' | 'appointment.cancelled' | 'appointment.rescheduled' | 'unknown';
  /** The provider's raw event type string, always populated. */
  rawEventType: string;
  /** Dedupe key for this specific delivery — provider event id when present. */
  providerEventId: string;
  externalAppointmentId?: string;
  raw: unknown;
};

export interface ExternalCalendarProvider {
  /** Verify connectivity / credentials without mutating anything. */
  testConnection(connection: ExternalCalendarConnectionRecord): Promise<TestConnectionResult>;

  listCompanies(connection: ExternalCalendarConnectionRecord): Promise<ExternalCompany[]>;
  listClinics(connection: ExternalCalendarConnectionRecord, companyId: string): Promise<ExternalClinic[]>;
  listDoctors(connection: ExternalCalendarConnectionRecord): Promise<ExternalDoctor[]>;
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

  /** Cancel a previously created appointment, where the documented API allows it. */
  cancelAppointment(
    connection: ExternalCalendarConnectionRecord,
    externalAppointmentId: string,
    reason?: string,
  ): Promise<void>;

  /** Reschedule a previously created appointment, where the documented API allows it. */
  rescheduleAppointment(
    connection: ExternalCalendarConnectionRecord,
    externalAppointmentId: string,
    newStartTime: string,
    newEndTime: string,
  ): Promise<ExternalAppointmentResult>;

  /** Verify an inbound webhook's signature. Returns false on any mismatch. */
  verifyWebhookSignature(
    connection: ExternalCalendarConnectionRecord,
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): boolean;

  /** Parse an already-signature-verified webhook payload into a normalized event. */
  parseWebhook(payload: unknown): ParsedExternalCalendarWebhookEvent;
}

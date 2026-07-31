/**
 * DigiDentisProvider.ts — ExternalCalendarProvider implementation for
 * DigiDentiS. Decrypts connection credentials internally; callers never see
 * plaintext secrets. Mirrors services/whatsapp/MetaCloudWhatsAppProvider.ts's
 * shape (decrypt-then-delegate).
 *
 * Verified against the real vendor documentation
 * (`docs/vendor/digidentis/DigiDentiS_Takvim_API_Documentation_v3.2.html`).
 */

import { createHash } from 'crypto';
import { decryptSecret } from '../../../utils/encryption.js';
import type {
  ExternalCalendarConnectionRecord,
  ExternalCalendarProvider,
  ExternalCalendarEventType,
  ExternalCompany,
  ExternalClinic,
  ExternalDoctor,
  ExternalTreatmentType,
  ExternalSlot,
  ExternalSlotQuery,
  CreateExternalAppointmentPayload,
  RescheduleExternalAppointmentInput,
  ExternalAppointmentResult,
  TestConnectionResult,
  ParsedExternalCalendarWebhookEvent,
} from '../ExternalCalendarProvider.js';
import {
  digiDentisHealthCheck,
  digiDentisListCompanies,
  digiDentisListClinics,
  digiDentisListDoctors,
  digiDentisListTreatmentTypes,
  digiDentisListAvailableSlots,
  digiDentisCreateAppointment,
  digiDentisCancelAppointment,
  digiDentisRescheduleAppointment,
  resolveDigiDentisBaseUrl,
  type DigiDentisClientConfig,
} from './DigiDentisApiClient.js';
import { verifyDigiDentisWebhookSignature } from './DigiDentisSigning.js';
import { ExternalCalendarAuthError } from '../externalCalendarErrors.js';

/** vendor doc §11.1 — "Available" today: the only event types that mark a
 *  stored inbound event 'processed' (still no domain mutation in this
 *  phase — see externalCalendarWebhookProcessor.ts). */
const ACTIVE_EVENT_TYPES = new Set<ExternalCalendarEventType>([
  'appointment.created',
  'appointment.cancelled',
  'appointment.rescheduled',
]);

/** vendor doc §11.1 — "Reserved": explicitly part of the webhook contract,
 *  documented to "arrive automatically once activated." Recognized (never
 *  classified as 'unknown'), but stored as reserved/not-yet-active rather
 *  than 'processed' — see externalCalendarWebhookProcessor.ts. */
const RESERVED_EVENT_TYPES = new Set<ExternalCalendarEventType>([
  'appointment.confirmed',
  'appointment.completed',
  'appointment.no_show',
]);

const RECOGNIZED_EVENT_TYPES = new Set<ExternalCalendarEventType>([...ACTIVE_EVENT_TYPES, ...RESERVED_EVENT_TYPES]);

function resolveClientConfig(connection: ExternalCalendarConnectionRecord): DigiDentisClientConfig {
  if (!connection.clientId) {
    throw new ExternalCalendarAuthError('DigiDentiS', 'clientId is not configured for this clinic');
  }
  if (!connection.clientSecretEncrypted) {
    throw new ExternalCalendarAuthError('DigiDentiS', 'clientSecret is not configured for this clinic');
  }
  return {
    baseUrl: resolveDigiDentisBaseUrl(connection.apiBaseUrl),
    clientId: connection.clientId,
    clientSecret: decryptSecret(connection.clientSecretEncrypted),
  };
}

function requireExternalClinicId(connection: ExternalCalendarConnectionRecord): string {
  if (!connection.externalClinicId) {
    throw new ExternalCalendarAuthError('DigiDentiS', 'externalClinicId is not configured for this clinic');
  }
  return connection.externalClinicId;
}

/** Doctors/treatment types are listed per DigiDentiS *company*, not per
 *  clinic (vendor doc §7.6, §7.10) — see digidentisConfig.ts's header comment. */
function requireExternalCompanyId(connection: ExternalCalendarConnectionRecord): string {
  if (!connection.externalCompanyId) {
    throw new ExternalCalendarAuthError('DigiDentiS', 'externalCompanyId is not configured for this clinic');
  }
  return connection.externalCompanyId;
}

function headerValue(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

export class DigiDentisProvider implements ExternalCalendarProvider {
  async testConnection(connection: ExternalCalendarConnectionRecord): Promise<TestConnectionResult> {
    try {
      return await digiDentisHealthCheck(resolveClientConfig(connection));
    } catch (err) {
      return { success: false, message: (err as Error).message };
    }
  }

  async listCompanies(connection: ExternalCalendarConnectionRecord): Promise<ExternalCompany[]> {
    return digiDentisListCompanies(resolveClientConfig(connection));
  }

  async listClinics(connection: ExternalCalendarConnectionRecord, companyId: string): Promise<ExternalClinic[]> {
    return digiDentisListClinics(resolveClientConfig(connection), companyId);
  }

  async listDoctors(connection: ExternalCalendarConnectionRecord): Promise<ExternalDoctor[]> {
    return digiDentisListDoctors(resolveClientConfig(connection), requireExternalCompanyId(connection));
  }

  async listTreatmentTypes(connection: ExternalCalendarConnectionRecord): Promise<ExternalTreatmentType[]> {
    return digiDentisListTreatmentTypes(resolveClientConfig(connection), requireExternalCompanyId(connection));
  }

  async listAvailableSlots(
    connection: ExternalCalendarConnectionRecord,
    query: ExternalSlotQuery,
  ): Promise<ExternalSlot[]> {
    return digiDentisListAvailableSlots(resolveClientConfig(connection), query);
  }

  async createAppointment(
    connection: ExternalCalendarConnectionRecord,
    payload: CreateExternalAppointmentPayload,
  ): Promise<ExternalAppointmentResult> {
    return digiDentisCreateAppointment(resolveClientConfig(connection), requireExternalClinicId(connection), payload);
  }

  async cancelAppointment(
    connection: ExternalCalendarConnectionRecord,
    externalAppointmentId: string,
    reason?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return digiDentisCancelAppointment(resolveClientConfig(connection), externalAppointmentId, reason, idempotencyKey);
  }

  async rescheduleAppointment(
    connection: ExternalCalendarConnectionRecord,
    externalAppointmentId: string,
    input: RescheduleExternalAppointmentInput,
  ): Promise<ExternalAppointmentResult> {
    return digiDentisRescheduleAppointment(resolveClientConfig(connection), externalAppointmentId, input);
  }

  verifyWebhookSignature(
    connection: ExternalCalendarConnectionRecord,
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): boolean {
    if (!connection.webhookSecretEncrypted) return false;
    const secret = decryptSecret(connection.webhookSecretEncrypted);
    const signature = headerValue(headers, 'x-webhook-signature');
    return verifyDigiDentisWebhookSignature(rawBody, signature, secret);
  }

  parseWebhook(
    payload: unknown,
    headers: Record<string, string | string[] | undefined>,
  ): ParsedExternalCalendarWebhookEvent {
    const record = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
    // vendor doc §11.3: the envelope is always { event, timestamp, data }.
    const data = (record.data && typeof record.data === 'object' ? record.data : {}) as Record<string, unknown>;

    const rawEventType = String(record.event ?? 'unknown');
    const eventType = RECOGNIZED_EVENT_TYPES.has(rawEventType as ExternalCalendarEventType)
      ? (rawEventType as ExternalCalendarEventType)
      : 'unknown';

    // vendor doc §11.2/§11.5: the delivery/dedupe id is the X-Webhook-Id
    // request header — "use X-Webhook-Id (or data.id) to make your
    // processing idempotent." Never guessed from a hash of the payload when
    // a real delivery id is available out-of-band.
    const webhookIdHeader = headerValue(headers, 'x-webhook-id');
    const dataId = typeof data.id === 'string' && data.id.trim() ? data.id : undefined;
    const providerEventId =
      webhookIdHeader?.trim() ||
      dataId ||
      createHash('sha256').update(JSON.stringify(payload ?? {})).digest('hex');

    const externalAppointmentId = dataId;

    return {
      eventType,
      rawEventType,
      providerEventId,
      externalAppointmentId,
      raw: payload,
    };
  }
}

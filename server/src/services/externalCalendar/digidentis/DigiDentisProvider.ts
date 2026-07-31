/**
 * DigiDentisProvider.ts — ExternalCalendarProvider implementation for
 * DigiDentiS. Decrypts connection credentials internally; callers never see
 * plaintext secrets. Mirrors services/whatsapp/MetaCloudWhatsAppProvider.ts's
 * shape (decrypt-then-delegate).
 */

import { createHash } from 'crypto';
import { decryptSecret } from '../../../utils/encryption.js';
import type {
  ExternalCalendarConnectionRecord,
  ExternalCalendarProvider,
  ExternalCompany,
  ExternalClinic,
  ExternalDoctor,
  ExternalTreatmentType,
  ExternalSlot,
  ExternalSlotQuery,
  CreateExternalAppointmentPayload,
  ExternalAppointmentResult,
  TestConnectionResult,
  ParsedExternalCalendarWebhookEvent,
} from '../ExternalCalendarProvider.js';
import {
  digiDentisTestConnection,
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

const ACTIVE_EVENT_TYPES = new Set(['appointment.created', 'appointment.cancelled', 'appointment.rescheduled']);

/** Some providers emit "canceled" (US spelling) — normalize without
 *  inventing new domain event types. */
const RAW_EVENT_TYPE_ALIASES: Record<string, string> = {
  'appointment.canceled': 'appointment.cancelled',
};

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

export class DigiDentisProvider implements ExternalCalendarProvider {
  async testConnection(connection: ExternalCalendarConnectionRecord): Promise<TestConnectionResult> {
    try {
      return await digiDentisTestConnection(resolveClientConfig(connection));
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
    return digiDentisListDoctors(resolveClientConfig(connection), requireExternalClinicId(connection));
  }

  async listTreatmentTypes(connection: ExternalCalendarConnectionRecord): Promise<ExternalTreatmentType[]> {
    return digiDentisListTreatmentTypes(resolveClientConfig(connection), requireExternalClinicId(connection));
  }

  async listAvailableSlots(
    connection: ExternalCalendarConnectionRecord,
    query: ExternalSlotQuery,
  ): Promise<ExternalSlot[]> {
    return digiDentisListAvailableSlots(resolveClientConfig(connection), requireExternalClinicId(connection), query);
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
  ): Promise<void> {
    return digiDentisCancelAppointment(
      resolveClientConfig(connection),
      requireExternalClinicId(connection),
      externalAppointmentId,
      reason,
    );
  }

  async rescheduleAppointment(
    connection: ExternalCalendarConnectionRecord,
    externalAppointmentId: string,
    newStartTime: string,
    newEndTime: string,
  ): Promise<ExternalAppointmentResult> {
    return digiDentisRescheduleAppointment(
      resolveClientConfig(connection),
      requireExternalClinicId(connection),
      externalAppointmentId,
      newStartTime,
      newEndTime,
    );
  }

  verifyWebhookSignature(
    connection: ExternalCalendarConnectionRecord,
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): boolean {
    if (!connection.webhookSecretEncrypted) return false;
    const secret = decryptSecret(connection.webhookSecretEncrypted);
    const header = headers['x-webhook-signature'];
    const signature = Array.isArray(header) ? header[0] : header;
    return verifyDigiDentisWebhookSignature(rawBody, signature, secret);
  }

  parseWebhook(payload: unknown): ParsedExternalCalendarWebhookEvent {
    const record = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
    const data = (record.data && typeof record.data === 'object' ? record.data : record) as Record<string, unknown>;

    const rawEventType = String(record.type ?? record.event ?? record.eventType ?? 'unknown');
    const normalized = RAW_EVENT_TYPE_ALIASES[rawEventType] ?? rawEventType;
    const eventType = ACTIVE_EVENT_TYPES.has(normalized)
      ? (normalized as ParsedExternalCalendarWebhookEvent['eventType'])
      : 'unknown';

    const explicitEventId = record.eventId ?? record.id;
    const providerEventId =
      typeof explicitEventId === 'string' && explicitEventId.trim()
        ? explicitEventId
        : createHash('sha256').update(JSON.stringify(payload ?? {})).digest('hex');

    const appointmentIdCandidate =
      (data as any)?.appointmentId ?? (data as any)?.appointment?.id ?? (record as any)?.appointmentId;
    const externalAppointmentId =
      typeof appointmentIdCandidate === 'string' && appointmentIdCandidate.trim() ? appointmentIdCandidate : undefined;

    return {
      eventType,
      rawEventType,
      providerEventId,
      externalAppointmentId,
      raw: payload,
    };
  }
}

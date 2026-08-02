/**
 * externalCalendarWebhookProcessor.ts — turns an already signature-verified,
 * already-parsed provider webhook event into a durable, idempotent record.
 *
 * CURRENT PHASE BOUNDARY: this processor never mutates Appointment or any
 * other production domain state, even for the three "active" event types
 * (appointment.created/cancelled/rescheduled). It only records that the
 * event was received and durably stored. Wiring these events to the
 * appointment approval flow is an explicitly deferred next phase — see
 * docs/architecture/external-calendar-integration.md and
 * externalCalendarOrchestration.ts, which documents the prepared boundary.
 *
 * Reserved/unknown event types (anything DigiDentiS sends that isn't one of
 * the three active types) are stored with status 'ignored' — never dropped,
 * never guessed at.
 */

import type { ParsedExternalCalendarWebhookEvent } from './ExternalCalendarProvider.js';
import {
  createExternalCalendarInboundEventOrDetectDuplicate,
  markExternalCalendarEventIgnored,
  markExternalCalendarEventProcessed,
} from './externalCalendarIdempotency.js';

export const ACTIVE_EXTERNAL_CALENDAR_EVENT_TYPES = new Set([
  'appointment.created',
  'appointment.cancelled',
  'appointment.rescheduled',
]);

export type ProcessWebhookEventArgs = {
  provider: string;
  connectionId: string;
  clinicId: string | null;
  organizationId: string | null;
  parsed: ParsedExternalCalendarWebhookEvent;
};

export type ProcessWebhookEventResult = {
  outcome: 'duplicate' | 'skipped' | 'stored';
  eventId?: string;
};

function asJsonRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export async function processExternalCalendarWebhookEvent(
  args: ProcessWebhookEventArgs,
): Promise<ProcessWebhookEventResult> {
  const created = await createExternalCalendarInboundEventOrDetectDuplicate({
    provider: args.provider,
    connectionId: args.connectionId,
    clinicId: args.clinicId,
    organizationId: args.organizationId,
    eventType: args.parsed.rawEventType,
    providerEventId: args.parsed.providerEventId,
    externalAppointmentId: args.parsed.externalAppointmentId,
    rawPayload: asJsonRecord(args.parsed.raw),
  });

  if (created.status === 'duplicate') {
    return { outcome: 'duplicate' };
  }
  if (created.status === 'skipped') {
    return { outcome: 'skipped' };
  }

  if (ACTIVE_EXTERNAL_CALENDAR_EVENT_TYPES.has(args.parsed.eventType)) {
    await markExternalCalendarEventProcessed(created.eventId);
  } else {
    await markExternalCalendarEventIgnored(
      created.eventId,
      `Reserved/unknown event type stored without domain action: ${args.parsed.rawEventType}`,
    );
  }

  return { outcome: 'stored', eventId: created.eventId };
}

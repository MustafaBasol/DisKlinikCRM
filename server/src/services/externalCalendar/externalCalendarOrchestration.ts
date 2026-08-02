/**
 * externalCalendarOrchestration.ts — the prepared seam for connecting the
 * external calendar integration to NoraMedi's appointment approval flow.
 *
 * NOT WIRED UP YET. Nothing in this module is called by any production
 * route, job, or webhook handler in this phase. It exists so the next phase
 * has a single, already-designed integration point instead of needing to
 * invent one while also changing approval behavior — per this phase's
 * explicit boundary: "prepare a clean orchestration boundary... do not yet
 * change production appointment approval behavior or patient confirmation
 * messages."
 *
 * Intended future call sites (NOT implemented here):
 *   - After a clinic staff member approves an AppointmentRequest /
 *     Appointment, call syncAppointmentToExternalCalendar() to create the
 *     matching DigiDentiS appointment (using resolveExternalCalendarMapping
 *     for the practitioner/service, and idempotencyKey derived from the
 *     NoraMedi appointment id so retries never double-book).
 *   - When staff cancel/reschedule a synced appointment, call the
 *     corresponding cancel/reschedule function here.
 *   - Inbound webhook events currently only reach
 *     externalCalendarWebhookProcessor.ts (store-only). A future phase adds
 *     a second consumer here that reacts to processed events — e.g.
 *     reflecting a DigiDentiS-side cancellation back onto the linked
 *     Appointment — behind its own explicit, reviewed change.
 */

import { ExternalCalendarError } from './externalCalendarErrors.js';

export class ExternalCalendarOrchestrationNotImplementedError extends ExternalCalendarError {
  constructor(operation: string) {
    super(
      `${operation} is not implemented in this phase. This is a prepared boundary only — ` +
        'see externalCalendarOrchestration.ts header comment.',
    );
  }
}

export type SyncAppointmentToExternalCalendarInput = {
  appointmentId: string;
};

/**
 * Future entry point: create/update the DigiDentiS-side appointment for a
 * NoraMedi Appointment once it is approved. Deliberately throws — wiring
 * this into the approval flow is out of scope for this phase.
 */
export async function syncAppointmentToExternalCalendar(
  _input: SyncAppointmentToExternalCalendarInput,
): Promise<never> {
  throw new ExternalCalendarOrchestrationNotImplementedError('syncAppointmentToExternalCalendar');
}

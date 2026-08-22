/**
 * appointmentRequestConfirmationConsumer.ts — F5-2 the first real outbox flow.
 *
 * WHY THIS FLOW AND NOT ANOTHER
 * -----------------------------
 * F0-010 named four candidate outbox-shaped flows. Re-inspected against the
 * repository as it stands today (see section 7 of the F5-2 evidence document),
 * three of them are not outbox-shaped:
 *
 *   - appointment reminders and payment reminders are SCHEDULE-shaped. They are
 *     derived from durable appointment/installment state by a daily cron, they
 *     already write a `SentMessage` ledger row before sending, and a missed tick
 *     is recovered by the next tick. There is no commit-then-obligation gap to
 *     close, and routing them through an outbox is precisely the "migrate every
 *     cron/job" that ADR-006's acceptance conditions refuse.
 *   - in-app notification generation is a SAME-DATABASE write, already
 *     idempotent through `upsert` on a stable `externalId`. Its correct fix is
 *     to include the write in the caller's transaction, not to publish an event
 *     that a dispatcher will consume in order to write another local row.
 *
 * The fourth is genuinely outbox-shaped, and the gap is in the code today:
 *
 *   `routes/appointmentRequests.ts` converts an AppointmentRequest inside a
 *   transaction (advisory locks, overlap re-check, Appointment created,
 *   request marked `converted`). The transaction commits, the HTTP response is
 *   sent, and THEN `scheduleExternalCalendarSyncOrNotify` runs fire-and-forget.
 *   When the clinic has an external-calendar integration enabled, the durable
 *   `ExternalCalendarAppointmentLink` created INSIDE the transaction carries the
 *   obligation and the confirmation rides on its retry. When the clinic has NO
 *   integration — the ordinary case at first-customer stage — the confirmation
 *   is sent inline with `.catch(log)` and nothing else. A process exit, a
 *   provider blip, or a WhatsApp 5xx in that window loses the patient's
 *   confirmation permanently, with no record that it was ever owed.
 *
 * That is the exact shape F5-1P E11/E11c measured: committed business state,
 * a required side effect, and no durable obligation between them.
 *
 * WHAT THIS CONSUMER DOES NOT DO
 * ------------------------------
 * It does not re-implement the notification. It re-reads durable state and
 * calls the SAME `sendAppointmentRequestConfirmationNotification` the inline
 * path calls, so the message a patient receives is identical whichever path
 * produced it, and there is no second copy of the rendering logic to drift.
 *
 * Re-reading rather than carrying the message in the payload is also what makes
 * a replay correct: a confirmation replayed two hours later renders from the
 * appointment as it is NOW, not as it was when the event was published.
 */

import prisma from '../../db.js';
import { logger } from '../../utils/logger.js';
import { sendAppointmentRequestConfirmationNotification } from '../../services/appointmentRequestNotification.js';
import {
  registerOutboxConsumer,
  type OutboxConsumerContext,
  type OutboxConsumerOutcome,
} from '../outboxConsumerRegistry.js';
import { OutboxConsumerError } from '../outboxErrors.js';
import { OutboxDeferError } from '../outboxDispatcher.js';
import { beginConsumerExecution, completeConsumerExecution } from '../outboxIdempotency.js';
import { buildOutboxDispatcherId } from '../outboxConfig.js';

export const APPOINTMENT_REQUEST_CONFIRMATION_CONSUMER_KEY = 'appointment-request-confirmation';

/**
 * The idempotency key for this contract. Exported because the PRODUCER must
 * derive it with the same function — two derivations of "the same key" that can
 * drift are not an idempotency mechanism.
 */
export function buildAppointmentConfirmationIdempotencyKey(appointmentId: string): string {
  return `${APPOINTMENT_REQUEST_CONFIRMATION_CONSUMER_KEY}:${appointmentId}`;
}

/** Deferral window when another dispatcher holds the business key. */
const IN_FLIGHT_RETRY_MS = 30_000;

async function handle(ctx: OutboxConsumerContext): Promise<OutboxConsumerOutcome> {
  const appointmentId = ctx.payload.appointmentId;
  const appointmentRequestId = ctx.payload.appointmentRequestId;

  // Re-read from durable state, scoped to the event's own clinic. `clinicId` in
  // the where-clause is not decoration: it is the tenant predicate for this
  // read, derived from the row's server-written ownership column.
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, clinicId: ctx.clinicId ?? undefined },
    include: {
      practitioner: { select: { firstName: true, lastName: true } },
      appointmentType: { select: { name: true } },
      clinic: { select: { organizationId: true } },
    },
  });

  // The obligation no longer exists: the appointment was deleted, or the event
  // points at a clinic that no longer owns it. SKIPPED, not failed — retrying
  // an obligation that has gone away is pure load, and dead-lettering it would
  // put a false alarm in front of an operator.
  if (!appointment) {
    logger.warn(
      { eventId: ctx.eventId, clinicId: ctx.clinicId },
      'outbox/appointment-confirmation: appointment no longer exists; skipping',
    );
    return { result: 'SKIPPED', outcomeCode: 'APPOINTMENT_NOT_FOUND' };
  }

  // Defence in depth against a forged or stale ownership column: the
  // appointment's own clinic must resolve to the organization the event claims.
  if (appointment.clinic.organizationId !== ctx.organizationId) {
    logger.error(
      { eventId: ctx.eventId },
      'outbox/appointment-confirmation: event organization does not match the appointment clinic',
    );
    throw new OutboxConsumerError('PERMANENT_VALIDATION', 'Event organization does not own this appointment.', {
      code: 'TENANT_UNRESOLVABLE',
    });
  }

  const sourceRequest = await prisma.appointmentRequest.findFirst({
    where: { id: appointmentRequestId, clinicId: appointment.clinicId },
  });
  if (!sourceRequest) {
    return { result: 'SKIPPED', outcomeCode: 'SOURCE_REQUEST_NOT_FOUND' };
  }
  if (!appointment.patientId) {
    // The inline path passes `updatedRequest.patientId!`; a conversion always
    // sets it. A null here means the appointment was mutated afterwards, and
    // there is no patient to notify.
    return { result: 'SKIPPED', outcomeCode: 'APPOINTMENT_HAS_NO_PATIENT' };
  }
  // 'manual' requests were never notified by the inline path either
  // (`sendAppointmentRequestConfirmationNotification` returns immediately).
  // Recognising that here keeps a no-op out of the idempotency ledger.
  if (String(sourceRequest.source ?? '').toLowerCase() === 'manual') {
    return { result: 'SKIPPED', outcomeCode: 'MANUAL_SOURCE_NOT_NOTIFIED' };
  }

  // ── The irreversible step begins here ────────────────────────────────────
  //
  // Everything above is a read and can be repeated safely. The marker is taken
  // now, immediately before the send, so the ambiguity window is as narrow as it
  // can be made: exactly the provider call.
  const begin = await beginConsumerExecution({
    consumerKey: APPOINTMENT_REQUEST_CONFIRMATION_CONSUMER_KEY,
    idempotencyKey: ctx.idempotencyKey,
    organizationId: ctx.organizationId,
    clinicId: ctx.clinicId,
    executedBy: buildOutboxDispatcherId(),
  });

  if (begin.decision === 'ALREADY_COMPLETED') {
    logger.info(
      { eventId: ctx.eventId, attemptCount: ctx.attemptCount },
      'outbox/appointment-confirmation: duplicate delivery suppressed',
    );
    return { result: 'SKIPPED', outcomeCode: 'DUPLICATE_SUPPRESSED' };
  }
  if (begin.decision === 'IN_FLIGHT_ELSEWHERE') {
    throw new OutboxDeferError(IN_FLIGHT_RETRY_MS);
  }
  if (begin.decision === 'AMBIGUOUS') {
    // A previous attempt committed "about to send" and never returned. Whether
    // the patient received the message is unknowable from here, so this is
    // terminal and visible rather than a silent re-send or a silent drop. An
    // operator who checks the provider can replay it deliberately.
    logger.error(
      { eventId: ctx.eventId },
      'outbox/appointment-confirmation: previous attempt left an ambiguous side effect; dead-lettering',
    );
    throw new OutboxConsumerError(
      'PERMANENT_VALIDATION',
      'A previous attempt may already have sent this confirmation.',
      { code: 'AMBIGUOUS_SIDE_EFFECT' },
    );
  }

  try {
    await sendAppointmentRequestConfirmationNotification({
      clinicId: appointment.clinicId,
      source: sourceRequest.source,
      phone: sourceRequest.phone,
      externalSenderId: sourceRequest.externalSenderId,
      sourceConnectionId: sourceRequest.sourceConnectionId,
      patientName: sourceRequest.patientName,
      organizationId: appointment.clinic.organizationId,
      patientId: appointment.patientId,
      appointment: {
        startTime: appointment.startTime,
        appointmentType: { name: appointment.appointmentType.name },
        practitioner: {
          firstName: appointment.practitioner.firstName,
          lastName: appointment.practitioner.lastName,
        },
      },
    });
  } catch (err) {
    // The send was ISSUED. Whether it reached the provider is unknown — a
    // timeout is precisely the case where the message may still have been
    // delivered — so the marker is deliberately NOT released. The next attempt
    // will see it, and if this process died it will see it EXPIRED and
    // dead-letter as AMBIGUOUS_SIDE_EFFECT rather than re-sending to a patient.
    //
    // `sendAppointmentRequestConfirmationNotification` swallows provider-level
    // failures itself (it logs and returns), so reaching here means something
    // more structural: the database read inside it failed, or a connection
    // lookup threw. Classified TRANSIENT so it is retried on a short budget.
    throw new OutboxConsumerError('TRANSIENT', 'Confirmation notification threw.', {
      code: 'TRANSIENT',
      cause: err,
    });
  }

  await completeConsumerExecution({
    executionId: begin.executionId,
    outcomeCode: 'CONFIRMATION_SENT',
  });

  return { result: 'APPLIED', outcomeCode: 'CONFIRMATION_SENT' };
}

/**
 * Registered once, from `startOutbox()`. Registration is separate from the
 * module body so importing this file for a type (or in a test) does not mutate
 * global state as a side effect.
 */
export function registerAppointmentRequestConfirmationConsumer(): void {
  registerOutboxConsumer({
    consumerKey: APPOINTMENT_REQUEST_CONFIRMATION_CONSUMER_KEY,
    description:
      'Sends the post-conversion appointment confirmation to the patient on the channel the ' +
      'request arrived from. Owned by the appointments/messaging domain.',
    handle,
  });
}

/** Exported for tests, which drive the handler directly rather than via the registry. */
export { handle as handleAppointmentRequestConfirmation };

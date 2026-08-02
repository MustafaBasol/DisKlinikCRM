/**
 * externalCalendarOutboundSync.ts — Phase 2: wires the generic external
 * calendar provider framework (PR #271) into the AppointmentRequest → Appointment
 * conversion flow.
 *
 * This module is provider-agnostic — it talks to providers only through
 * getExternalCalendarProvider() / resolveExternalCalendarMapping() /
 * getExternalCalendarConnectionRecord(), never a concrete class. All
 * DigiDentiS-specific parsing/error-shaping stays inside the digidentis/
 * subfolder; this module only branches on the shared error hierarchy in
 * externalCalendarErrors.ts.
 *
 * Design constraints (see docs/architecture/external-calendar-integration.md
 * and appointmentRequests.ts's convert handler):
 *  - Never make an external HTTP call inside a Prisma transaction or while
 *    holding an advisory lock. Everything here runs strictly after the
 *    conversion transaction has committed.
 *  - attemptExternalCalendarSync() is the SAME function called by the
 *    immediate post-conversion attempt, the bounded retry job
 *    (externalCalendarOutboundSyncJob.ts), and the manual staff retry
 *    endpoint. Concurrency safety comes from claimSyncLinkForAttempt()'s
 *    single conditional UPDATE (an optimistic claim scoped to one row) —
 *    no advisory lock is held across the external HTTP call.
 *  - The idempotency key is deterministic per Appointment
 *    (computeOutboundSyncIdempotencyKey), so a repeated conversion request,
 *    a retried claim, or a duplicate manual retry can never create a second
 *    provider-side appointment: the DB unique constraint
 *    (connectionId, idempotencyKey) collapses duplicate link rows, and the
 *    provider itself is contracted to dedupe on the same key
 *    (CreateExternalAppointmentPayload.idempotencyKey doc comment).
 */

import { Prisma } from '@prisma/client';
import prisma from '../../db.js';
import { getExternalCalendarProvider } from './externalCalendarProviderFactory.js';
import {
  getExternalCalendarConnectionRecord,
  recordExternalCalendarConnectionCheck,
} from './externalCalendarConnectionService.js';
import { resolveExternalCalendarMapping } from './externalCalendarMappingService.js';
import {
  ExternalCalendarAuthError,
  ExternalCalendarConflictError,
  ExternalCalendarDisabledError,
  ExternalCalendarMappingMissingError,
  ExternalCalendarNotConfiguredError,
  ExternalCalendarRateLimitedError,
  ExternalCalendarTransientError,
  ExternalCalendarValidationError,
} from './externalCalendarErrors.js';
import { sendAppointmentRequestConfirmationNotification } from '../appointmentRequestNotification.js';
import { recordOperationalEvent } from '../operationalEventService.js';
import { logger } from '../../utils/logger.js';
import { getZonedDateTimeParts } from '../../utils/helpers.js';
import type { ExternalCalendarConnectionRecord } from './ExternalCalendarProvider.js';

/** vendor-agnostic timezone convention already baked into ExternalSlotQuery /
 *  CreateExternalAppointmentPayload's doc comments ("YYYY-MM-DD,
 *  Europe/Istanbul"); kept here (not in a DigiDentiS-only file) because it is
 *  part of the shared provider contract, not a DigiDentiS implementation
 *  detail. */
const PROVIDER_TIME_ZONE = 'Europe/Istanbul';

/** Retry job / immediate attempt both stop after this many total attempts. */
export const MAX_SYNC_ATTEMPTS = 5;
const BASE_RETRY_DELAY_MS = 5 * 60 * 1000; // 5 min
const MAX_RETRY_DELAY_MS = 6 * 60 * 60 * 1000; // 6 hours

/** Linear-doubling backoff, capped — same shape as inboundEventRetryJob.ts's
 *  MIN_AGE_MS floor, extended with a cap so late attempts don't wait days. */
export function computeBackoffDelayMs(attempts: number): number {
  const exponent = Math.max(0, attempts - 1);
  return Math.min(BASE_RETRY_DELAY_MS * 2 ** exponent, MAX_RETRY_DELAY_MS);
}

/** Deterministic per-appointment idempotency key — a repeated conversion
 *  request, retry, or manual retry always resolves to the same key, so the
 *  unique index (connectionId, idempotencyKey) and the provider's own
 *  idempotency contract both collapse duplicates to a single external
 *  appointment. */
export function computeOutboundSyncIdempotencyKey(appointmentId: string): string {
  return `appt:${appointmentId}`;
}

function toDigiDentisStyleDateTime(date: Date): { date: string; time: string } {
  const parts = getZonedDateTimeParts(date, PROVIDER_TIME_ZONE);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`,
    time: `${pad(parts.hour)}:${pad(parts.minute)}`,
  };
}

export type SyncErrorClassification = {
  errorCode: string;
  /** Sanitized, staff-safe summary — never a raw provider response body,
   *  never secrets/credentials, never patient data. */
  message: string;
  retryable: boolean;
};

/**
 * Classifies a thrown error from the provider framework into a safe,
 * staff-visible summary plus a retry/terminal decision. Only branches on the
 * shared error hierarchy (externalCalendarErrors.ts) — never a provider-
 * specific error shape, so this stays correct for any future provider.
 */
export function classifyExternalCalendarSyncError(err: unknown): SyncErrorClassification {
  if (err instanceof ExternalCalendarMappingMissingError) {
    return {
      errorCode: 'MAPPING_MISSING',
      message: `No active ${err.mappingType} mapping is configured. An administrator must map this ${err.mappingType} before synchronization can proceed.`,
      retryable: false,
    };
  }
  if (err instanceof ExternalCalendarAuthError) {
    return {
      errorCode: 'AUTH_ERROR',
      message: 'The provider rejected the clinic\'s credentials. An administrator must reconfigure the integration.',
      retryable: false,
    };
  }
  if (err instanceof ExternalCalendarNotConfiguredError || err instanceof ExternalCalendarDisabledError) {
    return {
      errorCode: 'NOT_CONFIGURED',
      message: 'External calendar integration is not configured or enabled for this clinic.',
      retryable: false,
    };
  }
  if (err instanceof ExternalCalendarConflictError) {
    return {
      errorCode: err.code === 'SLOT_NOT_AVAILABLE' ? 'SLOT_NOT_AVAILABLE' : 'CONFLICT',
      message: 'The provider reported the requested time slot is no longer available. Re-check availability and retry with a new slot.',
      retryable: false,
    };
  }
  if (err instanceof ExternalCalendarValidationError) {
    return {
      errorCode: 'VALIDATION_ERROR',
      message: 'The provider rejected the appointment as invalid. Review the practitioner/service mapping and try again.',
      retryable: false,
    };
  }
  if (err instanceof ExternalCalendarRateLimitedError) {
    return {
      errorCode: 'RATE_LIMITED',
      message: 'The provider is rate-limiting requests. This will be retried automatically.',
      retryable: true,
    };
  }
  if (err instanceof ExternalCalendarTransientError) {
    return {
      errorCode: 'TRANSIENT',
      message: 'A temporary error occurred while contacting the provider. This will be retried automatically.',
      retryable: true,
    };
  }
  return {
    errorCode: 'UNKNOWN',
    message: 'An unexpected error occurred while synchronizing with the external calendar provider. This will be retried automatically.',
    retryable: true,
  };
}

type SyncLink = Awaited<ReturnType<typeof prisma.externalCalendarAppointmentLink.findUniqueOrThrow>>;

/**
 * The `enabled` master switch lives on ExternalCalendarIntegration but is
 * deliberately excluded from ExternalCalendarConnectionRecord (the shape
 * providers receive) — checked here via a direct, minimal read instead.
 * Re-checked on every attempt (not just at link-creation time) so an
 * administrator disabling the integration mid-retry-window stops further
 * attempts on the next tick.
 */
async function getIntegrationEnabledAndProvider(
  clinicId: string,
): Promise<{ enabled: boolean; provider: string; status: string } | null> {
  const row = await prisma.externalCalendarIntegration.findUnique({
    where: { clinicId },
    select: { enabled: true, provider: true, status: true },
  });
  return row ?? null;
}

async function isExternalCalendarIntegrationEnabledForClinic(clinicId: string): Promise<boolean> {
  const row = await getIntegrationEnabledAndProvider(clinicId);
  return Boolean(row?.enabled);
}

/**
 * Idempotent link creation — a repeated conversion request or a retried
 * caller resolves to the SAME row (unique on connectionId+idempotencyKey),
 * never a second pending record for the same appointment. `update: {}` is
 * deliberately a no-op: re-calling this must never reset an in-flight or
 * already-synced row back to 'pending'.
 */
export async function ensurePendingSyncLink(params: {
  connection: ExternalCalendarConnectionRecord;
  appointmentId: string;
  clinicId: string;
}): Promise<SyncLink> {
  const idempotencyKey = computeOutboundSyncIdempotencyKey(params.appointmentId);
  return prisma.externalCalendarAppointmentLink.upsert({
    where: {
      connectionId_idempotencyKey: {
        connectionId: params.connection.id,
        idempotencyKey,
      },
    },
    create: {
      connectionId: params.connection.id,
      organizationId: params.connection.organizationId,
      clinicId: params.clinicId,
      appointmentId: params.appointmentId,
      idempotencyKey,
      status: 'pending',
    },
    update: {},
  });
}

/**
 * Durable-link creation variant that runs INSIDE the caller's own
 * appointment-conversion transaction (the same `tx` used for the advisory
 * locks, overlap checks, and Appointment/AppointmentRequest writes) — never
 * inside a standalone prisma call. This makes the pending sync record commit
 * atomically with the Appointment itself: if the process exits unexpectedly
 * right after the transaction commits (before the post-response
 * scheduleExternalCalendarSyncOrNotify call ever runs), the 'pending' row
 * already exists durably in the database and the retry job's periodic sweep
 * (see externalCalendarOutboundSyncJob.ts) will still find and process it —
 * the outbound sync task can never be silently lost.
 *
 * Only reads/writes local tables — resolving the integration id/enabled flag
 * is a plain SELECT, and creating the link row is a plain INSERT/UPDATE.
 * Never makes an external HTTP call, so it is safe to run under the same
 * advisory-lock-holding transaction as the rest of the conversion.
 *
 * A no-op when no integration is configured/enabled for the clinic —
 * preserves the "disabled clinics behave exactly as before" contract.
 */
export async function ensurePendingSyncLinkInConversionTransaction(
  tx: Prisma.TransactionClient,
  params: { appointmentId: string; clinicId: string },
): Promise<void> {
  const integration = await tx.externalCalendarIntegration.findUnique({
    where: { clinicId: params.clinicId },
    select: { id: true, enabled: true, organizationId: true },
  });
  if (!integration || !integration.enabled) return;

  const idempotencyKey = computeOutboundSyncIdempotencyKey(params.appointmentId);
  await tx.externalCalendarAppointmentLink.upsert({
    where: {
      connectionId_idempotencyKey: {
        connectionId: integration.id,
        idempotencyKey,
      },
    },
    create: {
      connectionId: integration.id,
      organizationId: integration.organizationId,
      clinicId: params.clinicId,
      appointmentId: params.appointmentId,
      idempotencyKey,
      status: 'pending',
    },
    update: {},
  });
}

/**
 * Atomically claims a link row for processing. The WHERE clause (status +
 * due-time) is the entire concurrency mechanism: an immediate attempt, the
 * retry job, and a manual retry racing on the SAME row will only ever have
 * one UPDATE match (Postgres row-level locking on the write), so exactly one
 * caller proceeds. No advisory lock is taken — this claim never wraps an
 * external HTTP call, only this single conditional UPDATE.
 */
export async function claimSyncLinkForAttempt(linkId: string): Promise<SyncLink | null> {
  const now = new Date();
  const claim = await prisma.externalCalendarAppointmentLink.updateMany({
    where: {
      id: linkId,
      status: { in: ['pending', 'failed_retryable'] },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    data: {
      status: 'syncing',
      attempts: { increment: 1 },
      lastAttemptAt: now,
      nextAttemptAt: null,
    },
  });
  if (claim.count === 0) return null;
  return prisma.externalCalendarAppointmentLink.findUnique({ where: { id: linkId } });
}

async function finalizeFailure(
  link: SyncLink,
  classification: SyncErrorClassification,
): Promise<{ outcome: 'failed_retryable' | 'failed_terminal'; errorCode: string }> {
  const exhausted = link.attempts >= MAX_SYNC_ATTEMPTS;
  const terminal = !classification.retryable || exhausted;
  const status = terminal ? 'failed_terminal' : 'failed_retryable';

  const lastError = exhausted && classification.retryable
    ? `${classification.message} (retry attempts exhausted after ${link.attempts})`
    : classification.message;

  await prisma.externalCalendarAppointmentLink.update({
    where: { id: link.id },
    data: {
      status,
      lastError,
      errorCode: classification.errorCode,
      nextAttemptAt: terminal ? null : new Date(Date.now() + computeBackoffDelayMs(link.attempts)),
    },
  });

  // Structured, privacy-safe log — object-first (pino convention), never a
  // raw provider payload, secret, or patient field. logger.error/warn instead
  // of console.error so this participates in the same log pipeline/redaction
  // as the rest of the backend.
  const logFields = {
    linkId: link.id,
    appointmentId: link.appointmentId,
    clinicId: link.clinicId,
    attempts: link.attempts,
    status,
    errorCode: classification.errorCode,
  };
  if (terminal) {
    logger.error(logFields, 'external-calendar-outbound-sync: sync attempt failed terminally');
  } else {
    logger.warn(logFields, 'external-calendar-outbound-sync: sync attempt failed, will retry');
  }

  // Terminal failures are the ones staff actually need to act on (retryable
  // failures resolve themselves via the retry job) — surface those through
  // the existing OperationalEvent pattern (same admin-visible surface as
  // WhatsApp/SMS/finance failures), sanitized message + safe ids only.
  if (terminal) {
    await recordOperationalEvent({
      organizationId: link.organizationId,
      clinicId: link.clinicId,
      severity: 'error',
      source: 'external_calendar',
      message: lastError,
      metadata: { linkId: link.id, appointmentId: link.appointmentId, errorCode: classification.errorCode },
    });
  }

  // Provider authentication/credential failures are an integration-wide
  // problem, not a per-appointment one — degrade the clinic's integration
  // health via the SAME function the Platform Admin "test connection" route
  // uses, so it's visible on the existing config screen and so
  // attemptExternalCalendarSync short-circuits (see the status === 'error'
  // check above) instead of repeatedly calling a provider known to reject
  // this clinic's credentials. A later successful connection test or
  // credential update (upsertExternalCalendarIntegration) clears this back
  // to a non-error status — see externalCalendarConnectionService.ts.
  if (classification.errorCode === 'AUTH_ERROR') {
    await recordExternalCalendarConnectionCheck(link.clinicId, { success: false, message: classification.message }).catch((err) => {
      logger.error({ clinicId: link.clinicId, err }, 'external-calendar-outbound-sync: failed to degrade integration health after auth failure');
    });
  }

  return { outcome: status, errorCode: classification.errorCode };
}

/**
 * Re-derives the same notification the pre-Phase-2 convert handler sent
 * inline, from durable state only (Appointment + its originating
 * AppointmentRequest) — this lets the retry job and manual retry send the
 * exact same confirmation the immediate path would have sent, potentially
 * long after the original HTTP request/response is gone.
 */
async function sendConfirmationForConvertedAppointment(
  appointmentId: string,
  sendConfirmation: typeof sendAppointmentRequestConfirmationNotification,
): Promise<void> {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      practitioner: { select: { firstName: true, lastName: true } },
      appointmentType: { select: { name: true } },
      clinic: { select: { organizationId: true } },
    },
  });
  if (!appointment) return;

  const sourceRequest = await prisma.appointmentRequest.findFirst({
    where: { convertedAppointmentId: appointmentId },
  });
  if (!sourceRequest) return;

  await sendConfirmation({
    clinicId: appointment.clinicId,
    source: sourceRequest.source,
    phone: sourceRequest.phone,
    externalSenderId: sourceRequest.externalSenderId,
    sourceConnectionId: sourceRequest.sourceConnectionId,
    patientName: sourceRequest.patientName,
    organizationId: appointment.clinic.organizationId,
    patientId: appointment.patientId!,
    appointment: {
      startTime: appointment.startTime,
      appointmentType: { name: appointment.appointmentType.name },
      practitioner: {
        firstName: appointment.practitioner.firstName,
        lastName: appointment.practitioner.lastName,
      },
    },
  });
}

/**
 * Requeues a failed row for a manual staff retry — bypasses the backoff
 * floor (staff explicitly asked for another attempt right now, e.g. after
 * fixing a mapping or rotating credentials) but is still a single atomic
 * conditional UPDATE: only failed_retryable/failed_terminal rows transition,
 * so a manual retry can never resurrect a row the automatic job or another
 * manual retry has already claimed into 'syncing', nor one that already
 * reached 'synced'/'cancelled'. The caller should follow this with
 * attemptExternalCalendarSync(linkId) — if the automatic retry job claims
 * the freshly-requeued row first, that attempt returns 'not_claimed', which
 * is a safe, expected outcome (the row is being processed exactly once, just
 * not by this caller).
 */
export async function requeueSyncLinkForManualRetry(linkId: string): Promise<{ requeued: boolean }> {
  const result = await prisma.externalCalendarAppointmentLink.updateMany({
    where: { id: linkId, status: { in: ['failed_retryable', 'failed_terminal'] } },
    data: { status: 'pending', nextAttemptAt: null },
  });
  return { requeued: result.count > 0 };
}

export type SyncAttemptOutcome =
  | { outcome: 'not_claimed' }
  | { outcome: 'synced'; externalAppointmentId: string }
  | { outcome: 'failed_retryable'; errorCode: string }
  | { outcome: 'failed_terminal'; errorCode: string };

/** Test-only seam: overrides how the provider instance is resolved, so unit
 *  tests can inject a fake ExternalCalendarProvider without making a real
 *  HTTP call. Production code never passes this — the default always
 *  resolves the real provider via the shared factory. */
export type AttemptExternalCalendarSyncDeps = {
  getProvider?: typeof getExternalCalendarProvider;
  sendConfirmation?: typeof sendAppointmentRequestConfirmationNotification;
};

/**
 * The single synchronization function shared by the immediate post-
 * conversion attempt, the bounded retry job, and the manual retry endpoint.
 * Never called from inside a Prisma transaction and never holds an advisory
 * lock — claimSyncLinkForAttempt()'s conditional UPDATE is the entire
 * concurrency guard.
 */
export async function attemptExternalCalendarSync(
  linkId: string,
  deps: AttemptExternalCalendarSyncDeps = {},
): Promise<SyncAttemptOutcome> {
  const resolveProvider = deps.getProvider ?? getExternalCalendarProvider;
  const sendConfirmation = deps.sendConfirmation ?? sendAppointmentRequestConfirmationNotification;
  const link = await claimSyncLinkForAttempt(linkId);
  if (!link) return { outcome: 'not_claimed' };
  if (!link.appointmentId) {
    return finalizeFailure(link, {
      errorCode: 'APPOINTMENT_MISSING',
      message: 'This sync record is not linked to a local appointment.',
      retryable: false,
    });
  }

  try {
    const [integrationFlags, connection, appointment] = await Promise.all([
      getIntegrationEnabledAndProvider(link.clinicId),
      getExternalCalendarConnectionRecord(link.clinicId),
      prisma.appointment.findUnique({
        where: { id: link.appointmentId },
        include: { practitioner: true, appointmentType: true, patient: true },
      }),
    ]);

    if (!integrationFlags || !integrationFlags.enabled || !connection) {
      return finalizeFailure(link, {
        errorCode: 'NOT_CONFIGURED',
        message: 'External calendar integration is not configured or enabled for this clinic.',
        retryable: false,
      });
    }
    // The integration is already known to be unhealthy (a previous attempt —
    // for this appointment or another one at the same clinic — got an
    // authentication/credential rejection from the provider). Fail fast
    // WITHOUT calling the provider again: this is what actually prevents the
    // retry job / immediate attempts / manual retries from hammering a
    // provider known to reject this clinic's credentials. Resolved by an
    // administrator fixing credentials (upsertExternalCalendarIntegration) or
    // a successful connection test (recordExternalCalendarConnectionCheck),
    // either of which clears status away from 'error'.
    if (integrationFlags.status === 'error') {
      return finalizeFailure(link, {
        errorCode: 'INTEGRATION_UNHEALTHY',
        message: 'The external calendar integration for this clinic is marked unhealthy after a previous authentication/credential failure. An administrator must update the credentials or run a successful connection test before synchronization can resume.',
        retryable: false,
      });
    }
    if (!appointment) {
      return finalizeFailure(link, {
        errorCode: 'APPOINTMENT_MISSING',
        message: 'The local appointment no longer exists.',
        retryable: false,
      });
    }

    const provider = resolveProvider(integrationFlags.provider);

    // Validate mappings before ever touching the network.
    const externalDoctorId = await resolveExternalCalendarMapping(connection.id, 'practitioner', appointment.practitionerId);
    const externalTreatmentTypeId = await resolveExternalCalendarMapping(connection.id, 'service', appointment.appointmentTypeId);

    const start = toDigiDentisStyleDateTime(appointment.startTime);
    const end = toDigiDentisStyleDateTime(appointment.endTime);

    // Recheck the provider slot immediately before create — closes the
    // window between the last known-good check and this attempt (which may
    // run long after conversion, e.g. from the retry job).
    const slots = await provider.listAvailableSlots(connection, {
      externalDoctorId,
      fromDate: start.date,
      toDate: start.date,
    });
    const stillAvailable = slots.some((slot) => slot.date === start.date && slot.startTime === start.time);
    if (!stillAvailable) {
      return finalizeFailure(link, {
        errorCode: 'SLOT_NOT_AVAILABLE',
        message: 'The provider no longer has this time slot available.',
        retryable: false,
      });
    }

    const result = await provider.createAppointment(connection, {
      externalDoctorId,
      externalTreatmentTypeId,
      date: start.date,
      startTime: start.time,
      endTime: end.time,
      patientFirstName: appointment.patient.firstName,
      patientLastName: appointment.patient.lastName,
      patientPhone: appointment.patient.phone,
      patientEmail: appointment.patient.email,
      bookingId: appointment.id,
      idempotencyKey: link.idempotencyKey,
    });

    await prisma.externalCalendarAppointmentLink.update({
      where: { id: link.id },
      data: {
        status: 'synced',
        externalAppointmentId: result.externalAppointmentId,
        lastSyncedAt: new Date(),
        lastError: null,
        errorCode: null,
      },
    });

    await sendConfirmationForConvertedAppointment(appointment.id, sendConfirmation).catch((err) => {
      logger.error({ appointmentId: appointment.id, clinicId: link.clinicId, err }, 'external-calendar-outbound-sync: post-sync confirmation notification failed');
    });

    return { outcome: 'synced', externalAppointmentId: result.externalAppointmentId };
  } catch (err) {
    const classification = classifyExternalCalendarSyncError(err);
    return finalizeFailure(link, classification);
  }
}

export type ConfirmationNotificationArgs = Omit<
  Parameters<typeof sendAppointmentRequestConfirmationNotification>[0],
  'clinicId'
>;

/**
 * Entry point called by the AppointmentRequest conversion route AFTER the
 * conversion transaction has committed (and after the HTTP response is
 * already sent — same fire-and-forget convention as the pre-Phase-2
 * notification call it replaces).
 *
 * When no integration is enabled for the clinic, behavior is preserved
 * EXACTLY: the same notification is sent with the same arguments the route
 * already had in memory, no extra state is created. When an integration is
 * enabled, a durable pending sync record is created (idempotent — a repeat
 * call resolves to the same row) and synchronization is attempted
 * immediately; the confirmation notification is sent only once that
 * synchronization succeeds (see attemptExternalCalendarSync).
 */
export async function scheduleExternalCalendarSyncOrNotify(
  input: {
    appointmentId: string;
    clinicId: string;
    notification: ConfirmationNotificationArgs;
  },
  deps: AttemptExternalCalendarSyncDeps = {},
): Promise<void> {
  const [enabled, connection] = await Promise.all([
    isExternalCalendarIntegrationEnabledForClinic(input.clinicId),
    getExternalCalendarConnectionRecord(input.clinicId),
  ]);

  if (!enabled || !connection) {
    const sendConfirmation = deps.sendConfirmation ?? sendAppointmentRequestConfirmationNotification;
    await sendConfirmation({
      clinicId: input.clinicId,
      ...input.notification,
    }).catch((err) => logger.error({ clinicId: input.clinicId, appointmentId: input.appointmentId, err }, 'external-calendar-outbound-sync: appointment confirmation notification failed'));
    return;
  }

  const link = await ensurePendingSyncLink({
    connection,
    appointmentId: input.appointmentId,
    clinicId: input.clinicId,
  });
  await attemptExternalCalendarSync(link.id, deps);
}

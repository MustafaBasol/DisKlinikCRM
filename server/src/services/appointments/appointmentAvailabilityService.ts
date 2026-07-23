/**
 * appointmentAvailabilityService.ts
 *
 * Central service for appointment availability logic.
 *
 * All booking channels (AI flows, staff panel, public widget) and conversion
 * paths should use these functions to ensure consistent availability and
 * overlap behavior across the system.
 *
 * Blocking status rules:
 *   Appointment        : any status EXCEPT cancelled, no_show  → blocks a slot
 *   AppointmentRequest : pending, approved                      → blocks a slot
 *
 *   Non-blocking:
 *   Appointment        : cancelled, no_show
 *   AppointmentRequest : rejected, converted, closed
 *
 * Concurrency:
 *   For AI booking flows that create AppointmentRequest records, the advisory
 *   lock + assertSlotAvailable pattern from appointmentRequestSafety.ts is the
 *   authoritative concurrency guard and MUST still be used. This service does
 *   NOT replace the advisory lock; it centralises the STATUS constants and
 *   provides consistent helper functions.
 *
 * Re-exported for single-import convenience:
 *   assertSlotAvailable, acquireAppointmentSlotLock,
 *   acquireAppointmentRequestConversionLock,
 *   SlotConflictError, SlotConflictKind,
 *   NON_BLOCKING_APPOINTMENT_STATUSES, BLOCKING_APPOINTMENT_REQUEST_STATUSES
 */

import type { Prisma } from '@prisma/client';

import {
  checkPractitionerAvailability as _checkPractitionerAvailability,
} from '../../utils/helpers.js';

import {
  NON_BLOCKING_APPOINTMENT_STATUSES,
  BLOCKING_APPOINTMENT_REQUEST_STATUSES,
} from '../appointmentRequestSafety.js';

// Accepts either the module-level PrismaClient singleton or a transaction
// client (the `tx` passed into a prisma.$transaction callback) — PrismaClient
// is structurally assignable to Prisma.TransactionClient, so every existing
// call site (which passes the plain `prisma` singleton) keeps type-checking
// unchanged; only callers that need the re-check to participate in an
// in-flight transaction (see appointmentRequests.ts convert handler) pass `tx`.
type QueryClient = Prisma.TransactionClient;

// ── Re-exports from appointmentRequestSafety ──────────────────────────────────
export {
  assertSlotAvailable,
  acquireAppointmentSlotLock,
  acquireAppointmentRequestConversionLock,
  SlotConflictError,
  NON_BLOCKING_APPOINTMENT_STATUSES,
  BLOCKING_APPOINTMENT_REQUEST_STATUSES,
} from '../appointmentRequestSafety.js';

export type { SlotConflictKind } from '../appointmentRequestSafety.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface PractitionerAvailabilityResult {
  ok: boolean;
  slots: Array<{ startTime: string; endTime: string; [key: string]: unknown }>;
  timeZone: string;
  reason?: string;
  offDay?: unknown;
}

export interface CheckOverlapParams {
  clinicId: string;
  practitionerId: string;
  startTime: Date;
  endTime: Date;
  /** Exclude this appointment ID from the overlap check (used during update). */
  excludeAppointmentId?: string;
}

export interface CheckRequestConflictParams {
  clinicId: string;
  practitionerId: string;
  startTime: Date;
  endTime: Date;
  /**
   * Exclude this AppointmentRequest ID from the conflict check.
   * Used when converting a request so the request being converted
   * does not conflict with itself.
   */
  excludeRequestId?: string;
}

// ── Practitioner availability ─────────────────────────────────────────────────

/**
 * Canonical practitioner availability check.
 *
 * Checks:
 *   1. Cross-midnight span (rejected)
 *   2. Doctor off-day
 *   3. Clinic working hours (isClosed)
 *   4. Doctor schedule (doctorAvailability rows)
 *
 * This is the authoritative version and should be used by ALL booking paths.
 * It supersedes the local `checkPractitionerAvailability` that previously
 * existed in server/src/routes/whatsapp.ts (which did not check off-days).
 */
export async function checkPractitionerAvailabilityForSlot(
  clinicId: string,
  practitionerId: string,
  startTime: Date,
  endTime: Date,
): Promise<PractitionerAvailabilityResult> {
  return _checkPractitionerAvailability(clinicId, practitionerId, startTime, endTime);
}

// ── Appointment overlap ────────────────────────────────────────────────────────

/**
 * Returns true if a conflicting Appointment exists for the given slot.
 *
 * Uses NON_BLOCKING_APPOINTMENT_STATUSES = ['cancelled', 'no_show'] so that
 * slots freed by cancellation or no-show are available for rebooking.
 *
 * This is the canonical overlap check. All booking and update paths must use
 * this function instead of ad-hoc `findFirst` queries with `notIn: ['cancelled']`.
 */
export async function checkAppointmentOverlap(
  prismaClient: QueryClient,
  params: CheckOverlapParams,
): Promise<boolean> {
  const { clinicId, practitionerId, startTime, endTime, excludeAppointmentId } = params;

  const conflict = await prismaClient.appointment.findFirst({
    where: {
      clinicId,
      practitionerId,
      deletedAt: null,
      status: { notIn: [...NON_BLOCKING_APPOINTMENT_STATUSES] },
      ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
      OR: [{ startTime: { lt: endTime }, endTime: { gt: startTime } }],
    },
    select: { id: true },
  });

  return conflict !== null;
}

// ── AppointmentRequest conflict ────────────────────────────────────────────────

/**
 * Returns true if a pending or approved AppointmentRequest overlaps the slot.
 *
 * Rows with null preferredStartTime / preferredEndTime are ignored by the
 * Prisma filter (NULL comparisons evaluate to false in SQL).
 *
 * Staff creation and conversion paths can optionally call this to avoid
 * silently creating an Appointment over a pending bot-submitted request.
 */
export async function checkAppointmentRequestConflict(
  prismaClient: QueryClient,
  params: CheckRequestConflictParams,
): Promise<boolean> {
  const { clinicId, practitionerId, startTime, endTime, excludeRequestId } = params;

  const conflict = await prismaClient.appointmentRequest.findFirst({
    where: {
      clinicId,
      practitionerId,
      status: { in: [...BLOCKING_APPOINTMENT_REQUEST_STATUSES] },
      ...(excludeRequestId ? { id: { not: excludeRequestId } } : {}),
      preferredStartTime: { lt: endTime },
      preferredEndTime: { gt: startTime },
    },
    select: { id: true },
  });

  return conflict !== null;
}

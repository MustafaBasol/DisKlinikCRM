/**
 * appointmentRequestSafety.ts
 *
 * Concurrency-safe helpers for creating AppointmentRequest records.
 *
 * Background:
 *   Instagram DM, Meta WhatsApp, and Evolution WhatsApp AI flows check
 *   availability and then create an AppointmentRequest.  Under PostgreSQL
 *   READ COMMITTED isolation (the default), wrapping the read + write in a
 *   single $transaction is NOT sufficient: two concurrent transactions can
 *   both read "no conflict" before either one commits its new row.
 *
 *   The real concurrency guard is a PostgreSQL advisory transaction lock
 *   acquired at the START of the transaction, before any overlap checks.
 *   pg_advisory_xact_lock serializes all writes for the same slot; the lock
 *   is released automatically when the transaction ends (commit or rollback).
 *
 * Transaction order (enforced in every AI booking flow):
 *   1. acquireAppointmentSlotLock(tx, { clinicId, practitionerId, startTime })
 *      — serializes concurrent writes for the same slot
 *   2. assertSlotAvailable(tx, { clinicId, practitionerId, startTime, endTime })
 *      — re-checks Appointment + AppointmentRequest overlaps inside the tx
 *   3. tx.appointmentRequest.create({ ... })
 *      — creates the record only if no conflict was found
 *
 * Lock key design:
 *   computeSlotLockKey(clinicId, practitionerId, startTime) → [int32, int32]
 *   - SHA-256 of the canonical key string (clinicId:practitionerId:msEpoch)
 *   - First 8 bytes split into two signed int32 values
 *   - Passed to pg_advisory_xact_lock(int4, int4) — stable PostgreSQL overload
 *   - practitionerId=null uses the literal string 'null' for determinism
 *   - Different slots produce different keys; same slot always produces same key
 *
 * Blocking statuses:
 *   AppointmentRequest : pending, approved   (slot reserved for review)
 *   Appointment        : any except cancelled, no_show
 *
 * Non-blocking statuses:
 *   AppointmentRequest : rejected, converted, closed
 *   Appointment        : cancelled, no_show
 *
 * DB constraint decision (NOT applied in this PR):
 *   A partial unique index was considered but rejected because practitionerId
 *   and preferredStartTime are both nullable (PostgreSQL treats NULL as
 *   distinct, so the constraint would not catch null-practitioner collisions).
 *   Advisory lock + transaction-level re-check is the correct approach.
 */

import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';

// ── Error type ─────────────────────────────────────────────────────────────────

export type SlotConflictKind =
  | 'APPOINTMENT_OVERLAP'
  | 'APPOINTMENT_REQUEST_CONFLICT'
  | 'APPOINTMENT_OUTSIDE_AVAILABILITY';

/**
 * Thrown by assertSlotAvailable when a conflicting record is found.
 * `.message` equals `.kind` so existing callers checking error.message
 * continue to work without changes.
 */
export class SlotConflictError extends Error {
  readonly kind: SlotConflictKind;

  constructor(kind: SlotConflictKind) {
    super(kind);
    this.name = 'SlotConflictError';
    this.kind = kind;
  }
}

// ── Blocking status constants ──────────────────────────────────────────────────

/** AppointmentRequest statuses that reserve a slot and block new requests. */
export const BLOCKING_APPOINTMENT_REQUEST_STATUSES = ['pending', 'approved'] as const;

/** Appointment statuses that do NOT occupy a slot (slot is free again). */
export const NON_BLOCKING_APPOINTMENT_STATUSES = ['cancelled', 'no_show'] as const;

// ── Advisory lock ─────────────────────────────────────────────────────────────

/**
 * Computes a deterministic [key1, key2] pair for pg_advisory_xact_lock(int4, int4).
 *
 * The key is derived from SHA-256 of "{clinicId}:{practitionerId}:{startEpochMs}".
 * The first 8 bytes are split into two signed int32 values.
 *
 * Properties:
 *  - Same clinic/practitioner/startTime → same key pair
 *  - Different startTime or practitioner → different key pair (collision probability negligible)
 *  - practitionerId=null → uses the literal string 'null' (deterministic, not random)
 *  - No DB migration required
 *
 * Exported for unit testing only.
 */
export function computeSlotLockKey(
  clinicId: string,
  practitionerId: string | null,
  startTime: Date,
): [number, number] {
  const keyString = `${clinicId}:${practitionerId ?? 'null'}:${startTime.getTime()}`;
  const hash = createHash('sha256').update(keyString, 'utf8').digest();
  // readInt32BE returns signed values in [-2147483648, 2147483647] — valid PostgreSQL int4
  const key1 = hash.readInt32BE(0);
  const key2 = hash.readInt32BE(4);
  return [key1, key2];
}

/**
 * Acquires a PostgreSQL advisory transaction lock for the given slot identity.
 *
 * MUST be called as the FIRST operation inside a prisma.$transaction callback,
 * before assertSlotAvailable() and before appointmentRequest.create().
 *
 * pg_advisory_xact_lock(int4, int4) blocks until the lock is available and
 * releases it automatically when the surrounding transaction ends (commit or
 * rollback). Two concurrent transactions for the same slot will serialize here,
 * ensuring only one can pass the subsequent assertSlotAvailable() check.
 *
 * Different slots use different lock keys and do not block each other.
 */
export async function acquireAppointmentSlotLock(
  tx: Prisma.TransactionClient,
  args: {
    clinicId: string;
    practitionerId: string | null;
    startTime: Date;
  },
): Promise<void> {
  const [key1, key2] = computeSlotLockKey(args.clinicId, args.practitionerId, args.startTime);
  // pg_advisory_xact_lock(int4,int4): explicit casts required — Prisma binds JS
  // numbers as int8 by default, but PostgreSQL has no (bigint,bigint) overload.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${key1}::int4, ${key2}::int4)`;
}

// ── Core assertion ─────────────────────────────────────────────────────────────

/**
 * Asserts that no conflicting Appointment or AppointmentRequest exists for
 * the given clinicId / practitionerId / time window.
 *
 * MUST be called AFTER acquireAppointmentSlotLock() and INSIDE a
 * prisma.$transaction callback. The advisory lock ensures two concurrent
 * transactions cannot both pass this check for the same slot.
 *
 * @throws {SlotConflictError} with kind='APPOINTMENT_OVERLAP' if an existing
 *   Appointment (not cancelled/no_show) overlaps the window.
 * @throws {SlotConflictError} with kind='APPOINTMENT_REQUEST_CONFLICT' if an
 *   existing AppointmentRequest with status pending/approved overlaps the window.
 */
export async function assertSlotAvailable(
  tx: Prisma.TransactionClient,
  args: {
    clinicId: string;
    practitionerId: string;
    startTime: Date;
    endTime: Date;
  },
): Promise<void> {
  // 1. Check for existing confirmed/scheduled Appointment overlap
  const apptOverlap = await tx.appointment.findFirst({
    where: {
      clinicId: args.clinicId,
      practitionerId: args.practitionerId,
      deletedAt: null,
      status: { notIn: [...NON_BLOCKING_APPOINTMENT_STATUSES] },
      OR: [{ startTime: { lt: args.endTime }, endTime: { gt: args.startTime } }],
    },
    select: { id: true },
  });

  if (apptOverlap) {
    throw new SlotConflictError('APPOINTMENT_OVERLAP');
  }

  // 2. Check for an existing pending/approved AppointmentRequest for the same slot.
  //    Rows with null preferredStartTime or null preferredEndTime are skipped by
  //    the Prisma filter (NULL comparisons evaluate to false in SQL).
  const reqConflict = await tx.appointmentRequest.findFirst({
    where: {
      clinicId: args.clinicId,
      practitionerId: args.practitionerId,
      status: { in: [...BLOCKING_APPOINTMENT_REQUEST_STATUSES] },
      preferredStartTime: { lt: args.endTime },
      preferredEndTime: { gt: args.startTime },
    },
    select: { id: true },
  });

  if (reqConflict) {
    throw new SlotConflictError('APPOINTMENT_REQUEST_CONFLICT');
  }
}

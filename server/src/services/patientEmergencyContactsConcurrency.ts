/**
 * patientEmergencyContactsConcurrency.ts — US-01.2-FU: closes the
 * emergency-contact primary-promotion race that the database-level partial
 * unique index (PatientEmergencyContact_one_primary_per_patient — see
 * migration 20260803120000_add_patient_emergency_contacts) does not fully
 * cover on its own.
 *
 * Why the unique index alone is not enough:
 *   The index only rejects a write when two transactions' primary-setting
 *   statements are BOTH still in flight and physically overlap at the
 *   index-insert step — Postgres's standard unique-constraint wait/recheck
 *   protocol. Two requests dispatched together (e.g. Promise.all) do not
 *   have to overlap at that precise step: if the first transaction's whole
 *   reset-then-set sequence (BEGIN, clear-other-primaries, write, COMMIT)
 *   finishes before the second transaction even opens — a completely normal
 *   outcome under connection-pool/event-loop scheduling, more likely under
 *   CI runner contention than on a quiet local box — the second transaction
 *   freshly (and correctly, from Postgres's point of view) observes the
 *   first transaction's now-committed primary, clears it, and writes its own
 *   row as the new primary. No unique violation ever occurs, because by the
 *   time the second write lands only one row is trying to hold
 *   isPrimary=true. Both requests then observe HTTP 200, silently
 *   overwriting each other, even though only one caller's intent should have
 *   won and the other should have been told about the conflict.
 *
 * Fix:
 *   A transaction-scoped PostgreSQL advisory lock (pg_advisory_xact_lock —
 *   same primitive already used by
 *   server/src/services/appointmentRequestSafety.ts) keyed by patientId
 *   alone serializes every primary-promotion attempt for that patient. Each
 *   promotion then re-validates, INSIDE the lock, that the
 *   currently-primary contact (if any) still matches what THIS request
 *   observed before it started — an optimistic-concurrency check — and
 *   throws PrimaryContactConflictError instead of silently overwriting a
 *   promotion that raced ahead of it. Different patients (including
 *   different organizations/clinics) never contend: patientId is already
 *   globally unique in this schema (see the route file's own comment on the
 *   same point), and the lock is only ever acquired for isPrimary=true
 *   writes — concurrent isPrimary=false writes and unrelated field updates
 *   never touch this lock or the re-validation query.
 */

import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { PRIMARY_CONTACT_CONFLICT_CODE } from './patientEmergencyContacts.js';

/**
 * Thrown when a primary-promotion loses the optimistic-concurrency re-check
 * performed under the per-patient advisory lock. Carries the same `code` as
 * a raw Prisma P2002 unique-constraint error so isPrimaryContactConflict()
 * (patientEmergencyContacts.ts) maps both to the identical 409
 * PRIMARY_CONTACT_CONFLICT response without the route needing to know which
 * of the two conflict sources actually fired.
 */
export class PrimaryContactConflictError extends Error {
  readonly code = PRIMARY_CONTACT_CONFLICT_CODE;

  constructor() {
    super('Another request just set a primary contact for this patient.');
    this.name = 'PrimaryContactConflictError';
  }
}

/**
 * Deterministic [int4, int4] pg_advisory_xact_lock key pair for a single
 * patient's emergency-contact primary-promotion critical section.
 * Domain-separated from every other advisory lock in this codebase (see
 * appointmentRequestSafety.ts's computeSlotLockKey /
 * computeAppointmentRequestConversionLockKey) by the
 * "patient-emergency-contact-primary:" prefix, even though all advisory
 * locks share PostgreSQL's single global (int4, int4) key space.
 *
 * Exported for unit testing only.
 */
export function computeEmergencyContactPrimaryLockKey(patientId: string): [number, number] {
  const hash = createHash('sha256').update(`patient-emergency-contact-primary:${patientId}`, 'utf8').digest();
  return [hash.readInt32BE(0), hash.readInt32BE(4)];
}

/**
 * Acquires a PostgreSQL advisory transaction lock scoped to a single
 * patient's emergency-contact primary-promotion critical section.
 *
 * MUST be called as the FIRST operation inside the promoting
 * prisma.$transaction callback, before re-reading the current primary
 * contact and before the reset-then-set writes. pg_advisory_xact_lock
 * blocks until the lock is available and releases it automatically when
 * the surrounding transaction ends (commit or rollback) — never held
 * across a network call or unrelated work. Different patientId values
 * never block each other.
 */
export async function acquireEmergencyContactPrimaryLock(
  tx: Prisma.TransactionClient,
  patientId: string,
): Promise<void> {
  const [key1, key2] = computeEmergencyContactPrimaryLockKey(patientId);
  // pg_advisory_xact_lock(int4,int4): explicit casts required — Prisma binds JS
  // numbers as int8 by default, but PostgreSQL has no (bigint,bigint) overload.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${key1}::int4, ${key2}::int4)`;
}

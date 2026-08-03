/**
 * patientMedicalHistoryConcurrency.ts — US-01.1-P1: closes the medical-history
 * version-allocation race the same way patientEmergencyContactsConcurrency.ts
 * closes the emergency-contact single-primary race.
 *
 * Why a unique index alone is not enough:
 *   "version = previous max(version) + 1" is a read-then-write sequence. Two
 *   concurrent POSTs for the same patient can both read the same max(version)
 *   before either commits, then both attempt to insert version = max+1. The
 *   database-level @@unique([patientId, version]) constraint (see migration
 *   <TBD>_add_patient_medical_history_foundation) rejects the loser's insert
 *   with a P2002 error — a correct backstop, but on its own it degrades a
 *   normal "create a new version" request into an unhandled 500 for the
 *   loser instead of a deterministic, retryable response.
 *
 * Fix:
 *   A transaction-scoped PostgreSQL advisory lock (pg_advisory_xact_lock —
 *   same primitive as acquireEmergencyContactPrimaryLock in
 *   patientEmergencyContactsConcurrency.ts) keyed by patientId alone
 *   serializes every version-creating transaction for that patient: read
 *   max(version), insert max+1, commit — all while holding the lock, so the
 *   next waiting transaction always observes the previous transaction's
 *   committed version. Different patients (including different
 *   clinics/organizations) never contend, since patientId is already
 *   globally unique in this schema.
 */

import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';

/** Stable API error code returned when the database-level unique constraint
 * on (patientId, version) rejects a concurrent write that slipped past the
 * advisory lock (defense in depth — should not happen in normal operation). */
export const MEDICAL_HISTORY_VERSION_CONFLICT_CODE = 'MEDICAL_HISTORY_VERSION_CONFLICT';

/**
 * Thrown when, for whatever reason, the row this request is about to insert
 * would collide with an existing (patientId, version) pair even after
 * acquiring the per-patient advisory lock (should be unreachable in normal
 * operation — the lock alone should already prevent this). Kept as an
 * explicit, named error so callers can map it to a stable 409 instead of an
 * unhandled exception, mirroring PrimaryContactConflictError.
 */
export class MedicalHistoryVersionConflictError extends Error {
  readonly code = MEDICAL_HISTORY_VERSION_CONFLICT_CODE;

  constructor() {
    super('Another request just recorded a medical history version for this patient.');
    this.name = 'MedicalHistoryVersionConflictError';
  }
}

/**
 * True when `err` is either source of a medical-history version conflict:
 *   - a Prisma unique-constraint violation (P2002) from the database-level
 *     @@unique([patientId, version]) backstop; or
 *   - a MedicalHistoryVersionConflictError from the in-transaction re-check.
 * The only unique constraint on PatientMedicalHistory is that compound
 * index, so any P2002 raised while creating a version can only be this race.
 */
export function isMedicalHistoryVersionConflict(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  return code === 'P2002' || code === MEDICAL_HISTORY_VERSION_CONFLICT_CODE;
}

/**
 * Deterministic [int4, int4] pg_advisory_xact_lock key pair for a single
 * patient's medical-history version-allocation critical section.
 * Domain-separated from every other advisory lock in this codebase (e.g.
 * "patient-emergency-contact-primary:") by the
 * "patient-medical-history-version:" prefix, even though all advisory locks
 * share PostgreSQL's single global (int4, int4) key space.
 *
 * Exported for unit testing only.
 */
export function computeMedicalHistoryVersionLockKey(patientId: string): [number, number] {
  const hash = createHash('sha256').update(`patient-medical-history-version:${patientId}`, 'utf8').digest();
  return [hash.readInt32BE(0), hash.readInt32BE(4)];
}

/**
 * Acquires a PostgreSQL advisory transaction lock scoped to a single
 * patient's medical-history version-allocation critical section.
 *
 * MUST be called as the FIRST operation inside the version-creating
 * prisma.$transaction callback, before reading the current max(version) and
 * before inserting the new version row. pg_advisory_xact_lock blocks until
 * the lock is available and releases it automatically when the surrounding
 * transaction ends (commit or rollback) — never held across a network call
 * or unrelated work. Different patientId values never block each other.
 */
export async function acquireMedicalHistoryVersionLock(
  tx: Prisma.TransactionClient,
  patientId: string,
): Promise<void> {
  const [key1, key2] = computeMedicalHistoryVersionLockKey(patientId);
  // pg_advisory_xact_lock(int4,int4): explicit casts required — Prisma binds JS
  // numbers as int8 by default, but PostgreSQL has no (bigint,bigint) overload.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${key1}::int4, ${key2}::int4)`;
}

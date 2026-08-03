/**
 * patientEmergencyContactPrimaryLock.ts — US-01.2 / F1-004-P1.
 *
 * Concurrency-safe helper for the "at most one isPrimary=true
 * PatientEmergencyContact per patient" invariant.
 *
 * Root cause (F1-004-P1):
 *   The pre-existing partial unique index (PatientEmergencyContact_
 *   one_primary_per_patient — see migration 20260803120000_add_patient_
 *   emergency_contacts) guarantees the DB never physically holds two
 *   isPrimary=true rows for one patient at once. It does NOT guarantee that
 *   two concurrent HTTP requests racing to become primary get the
 *   documented "one 200 winner, one 409 PRIMARY_CONTACT_CONFLICT loser"
 *   contract. The route's old reset-then-set sequence (clear whoever is
 *   currently primary, then set the target row) could run to completion
 *   TWICE without ever violating the unique index: request B's "clear"
 *   step legitimately clears request A's already-committed primary before
 *   B sets its own row — two 200 responses, silent last-writer-wins,
 *   never a 409 for the loser. Confirmed against real disposable
 *   PostgreSQL (CI run 30813103465, both attempts; forced-interleaving
 *   local repro) — see docs/program/evidence/F1-004-P1_*.
 *
 * Fix:
 *   A PostgreSQL advisory transaction lock, scoped to the patient,
 *   serializes concurrent primary-transition attempts for that patient
 *   (same pattern as acquireAppointmentSlotLock in
 *   appointmentRequestSafety.ts). Serializing alone would only make the
 *   domino deterministic instead of racy, so the lock is combined with an
 *   optimistic snapshot check: the caller records which contact (if any)
 *   was primary when the request started (readCurrentPrimaryContactId
 *   against the plain `prisma` client, before the transaction opens).
 *   After acquiring the lock, claimPrimaryContactSlot() re-reads the
 *   current primary and compares it to that snapshot:
 *     - unchanged  → either no concurrent request is in flight, or this is
 *       a legitimate sequential reassignment (switching primary from one
 *       contact to another outside of any race) — proceed: clear the
 *       previous primary (if any and if not the target itself) and let the
 *       caller set its own row.
 *     - changed    → a concurrent request won the race in between; throw
 *       PrimaryContactRaceError. The route maps this to the documented 409
 *       PRIMARY_CONTACT_CONFLICT, and because the throw happens before any
 *       write in this transaction, the loser's target row is never
 *       touched — same contract the pre-existing unique-index/P2002 path
 *       already provided for the cases it did catch.
 *
 * Lock key:
 *   SHA-256 of "patient-emergency-contact-primary:{patientId}", split into
 *   two signed int32 values, passed to pg_advisory_xact_lock(int4, int4).
 *   The "patient-emergency-contact-primary:" prefix domain-separates this
 *   lock namespace from every other advisory lock in the codebase (they
 *   all share PostgreSQL's single global (int4, int4) advisory-lock space
 *   — see appointmentRequestSafety.ts for the same convention).
 *
 *   patientId alone is sufficient scope: Patient.id (server/prisma/
 *   schema.prisma) is a single global primary key, not partitioned per
 *   clinic/organization, so two different patients can never hash to a
 *   lock-key collision that would matter (and even a hash collision across
 *   unrelated patients would only cause extra, harmless serialization, not
 *   an incorrect result — the re-check inside claimPrimaryContactSlot is
 *   always scoped to the specific patientId/clinicId/organizationId via
 *   the WHERE clause, never to the lock key alone). Different patients use
 *   different keys and never block each other; non-primary-transition
 *   writes never acquire this lock at all (see the route: only entered
 *   when isPrimary is actually being turned on for a row that wasn't
 *   already primary).
 */

import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';

/**
 * Thrown by claimPrimaryContactSlot when the current primary contact
 * changed between the pre-transaction snapshot and lock acquisition — a
 * concurrent request won the race. The route maps this to the documented
 * 409 { error, code: 'PRIMARY_CONTACT_CONFLICT' } response.
 */
export class PrimaryContactRaceError extends Error {
  constructor() {
    super('PRIMARY_CONTACT_RACE');
    this.name = 'PrimaryContactRaceError';
  }
}

export type PrimaryContactScope = { patientId: string; clinicId: string; organizationId: string };

type PrimaryContactReader = {
  patientEmergencyContact: {
    findFirst: (args: {
      where: { patientId: string; clinicId: string; organizationId: string; isPrimary: true };
      select: { id: true };
    }) => Promise<{ id: string } | null>;
  };
};

/** Exported for unit testing only. */
export function computePatientPrimaryContactLockKey(patientId: string): [number, number] {
  const hash = createHash('sha256').update(`patient-emergency-contact-primary:${patientId}`, 'utf8').digest();
  // readInt32BE returns signed values in [-2147483648, 2147483647] — valid PostgreSQL int4
  return [hash.readInt32BE(0), hash.readInt32BE(4)];
}

/**
 * Reads the id of the current primary contact (if any) for the given
 * patient scope. Safe to call with either the plain `prisma` client (for
 * the pre-transaction snapshot) or a `tx` inside a transaction (for the
 * post-lock re-check) — both expose the same query shape.
 */
export async function readCurrentPrimaryContactId(
  client: PrimaryContactReader,
  scope: PrimaryContactScope,
): Promise<string | null> {
  const row = await client.patientEmergencyContact.findFirst({
    where: { patientId: scope.patientId, clinicId: scope.clinicId, organizationId: scope.organizationId, isPrimary: true },
    select: { id: true },
  });
  return row?.id ?? null;
}

/**
 * MUST be called as the FIRST operation inside the prisma.$transaction
 * callback for any create/update that will set isPrimary=true on a row
 * that was not already primary. See the file header for the full race
 * analysis.
 *
 * @param tx a Prisma interactive-transaction client
 * @param scope the patient/clinic/organization the write is scoped to
 * @param expectedCurrentPrimaryId the primary contact id (or null)
 *   observed BEFORE the transaction started, via readCurrentPrimaryContactId
 *   against the plain `prisma` client (not `tx`)
 * @param keepContactId the id of the row this request intends to make
 *   primary — never cleared by this function even if it happens to already
 *   be the current primary. Omit for POST, where the row does not exist yet.
 * @throws {PrimaryContactRaceError} if the current primary changed between
 *   the pre-transaction snapshot and lock acquisition.
 */
export async function claimPrimaryContactSlot(
  tx: Prisma.TransactionClient,
  scope: PrimaryContactScope,
  expectedCurrentPrimaryId: string | null,
  keepContactId?: string,
): Promise<void> {
  const [key1, key2] = computePatientPrimaryContactLockKey(scope.patientId);
  // pg_advisory_xact_lock(int4,int4): explicit casts required — Prisma binds JS
  // numbers as int8 by default, but PostgreSQL has no (bigint,bigint) overload.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${key1}::int4, ${key2}::int4)`;

  const currentPrimaryId = await readCurrentPrimaryContactId(tx, scope);
  if (currentPrimaryId !== expectedCurrentPrimaryId) {
    throw new PrimaryContactRaceError();
  }

  if (currentPrimaryId && currentPrimaryId !== keepContactId) {
    await tx.patientEmergencyContact.update({ where: { id: currentPrimaryId }, data: { isPrimary: false } });
  }
}

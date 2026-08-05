/**
 * patientEmergencyContacts.ts — US-01.2 validation/normalization logic.
 *
 * Pure functions only (no Prisma/DB access) so the create/update invariants
 * — fullName required, phone required whenever fullName is present, email
 * format, contactType contract — can be unit tested without a database. The
 * route handler (server/src/routes/patientEmergencyContacts.ts) is
 * responsible for scope resolution and the single-primary transaction.
 *
 * The "at most one isPrimary=true row per patient" invariant is enforced by
 * a database-level partial unique index (PatientEmergencyContact_
 * one_primary_per_patient — see migration 20260803120000_add_patient_
 * emergency_contacts), not by the application transaction alone. Concurrent
 * requests that both try to become primary race on that index; the loser's
 * Prisma call rejects with a P2002 unique-constraint error, which the route
 * translates via isPrimaryContactConflict() below into a stable 409 response
 * instead of an unhandled exception.
 */

export const EMERGENCY_CONTACT_TYPES = ['SPOUSE', 'PARENT', 'GUARDIAN', 'CHILD', 'SIBLING', 'OTHER'] as const;
export type EmergencyContactType = (typeof EMERGENCY_CONTACT_TYPES)[number];

export type EmergencyContactInput = {
  contactType?: unknown;
  fullName?: unknown;
  phone?: unknown;
  phoneCountryCode?: unknown;
  email?: unknown;
  occupation?: unknown;
  isPrimary?: unknown;
  isLegalDecisionMaker?: unknown;
};

export type NormalizedEmergencyContact = {
  contactType: EmergencyContactType;
  fullName: string;
  phone: string;
  phoneCountryCode: string | null;
  email: string | null;
  occupation: string | null;
  isPrimary: boolean;
  isLegalDecisionMaker: boolean;
};

export type EmergencyContactValidationResult =
  | { ok: true; data: NormalizedEmergencyContact }
  | { ok: false; error: string };

/** Stable API error code returned when the database-level single-primary
 * partial unique index rejects a concurrent write (see the file header). */
export const PRIMARY_CONTACT_CONFLICT_CODE = 'PRIMARY_CONTACT_CONFLICT';

/**
 * True when `err` is one of the sources of a single-primary-contact
 * conflict (F1-004-P1-R2):
 *   - a PrimaryContactConflictError (server/src/services/
 *     patientEmergencyContactsConcurrency.ts) from the optimistic-concurrency
 *     re-check performed under the per-patient advisory lock, which is what
 *     actually catches the race in practice (see that file's header comment
 *     for why the unique index alone is not sufficient, and why an earlier
 *     version of this same check — PR #310 — still had a gap); or
 *   - a Prisma unique-constraint violation (P2002) from the database-level
 *     partial index (see migration 20260803120000_add_patient_emergency_
 *     contacts), kept as a last-resort backstop; or
 *   - a Prisma transaction-conflict error (P2034 — deadlock or serialization
 *     failure), which should not occur under this design's default READ
 *     COMMITTED isolation but is mapped defensively rather than surfacing as
 *     an unhandled 500 if it ever does.
 * The only unique constraint on PatientEmergencyContact is the partial index
 * above, so any P2002 raised while creating/updating a contact can only be
 * that race — never an unrelated/ambiguous conflict.
 */
export function isPrimaryContactConflict(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  return code === 'P2002' || code === 'P2034' || code === PRIMARY_CONTACT_CONFLICT_CODE;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toTrimmedStringOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

/** Validates a full (all-fields-present) emergency contact record — used directly for create, and for update after merging the existing row with the patch (see mergeEmergencyContactPatch). */
export function validateEmergencyContact(input: EmergencyContactInput): EmergencyContactValidationResult {
  const rawType = typeof input.contactType === 'string' ? input.contactType.trim().toUpperCase() : '';
  if (!(EMERGENCY_CONTACT_TYPES as readonly string[]).includes(rawType)) {
    return { ok: false, error: `contactType must be one of: ${EMERGENCY_CONTACT_TYPES.join(', ')}` };
  }

  const fullName = toTrimmedStringOrNull(input.fullName);
  if (!fullName) {
    return { ok: false, error: 'fullName is required' };
  }

  const phone = toTrimmedStringOrNull(input.phone);
  if (!phone) {
    return { ok: false, error: 'phone is required when fullName is provided' };
  }

  const email = toTrimmedStringOrNull(input.email);
  if (email && !EMAIL_RE.test(email)) {
    return { ok: false, error: 'email must be a valid email address' };
  }

  return {
    ok: true,
    data: {
      contactType: rawType as EmergencyContactType,
      fullName,
      phone,
      phoneCountryCode: toTrimmedStringOrNull(input.phoneCountryCode),
      email,
      occupation: toTrimmedStringOrNull(input.occupation),
      isPrimary: input.isPrimary === true,
      isLegalDecisionMaker: input.isLegalDecisionMaker === true,
    },
  };
}

/**
 * Merges a partial PUT body onto the existing row so the joint fullName/phone
 * invariant is re-checked against the RESULTING record, not just the patch —
 * e.g. a PUT that only sends `{ phone: "" }` on a contact with an existing
 * fullName must be rejected, even though `fullName` itself was never touched.
 * Only keys actually present in `patch` override the existing value.
 */
export function mergeEmergencyContactPatch(
  existing: NormalizedEmergencyContact,
  patch: EmergencyContactInput,
): EmergencyContactInput {
  return {
    contactType: 'contactType' in patch ? patch.contactType : existing.contactType,
    fullName: 'fullName' in patch ? patch.fullName : existing.fullName,
    phone: 'phone' in patch ? patch.phone : existing.phone,
    phoneCountryCode: 'phoneCountryCode' in patch ? patch.phoneCountryCode : existing.phoneCountryCode,
    email: 'email' in patch ? patch.email : existing.email,
    occupation: 'occupation' in patch ? patch.occupation : existing.occupation,
    isPrimary: 'isPrimary' in patch ? patch.isPrimary : existing.isPrimary,
    isLegalDecisionMaker: 'isLegalDecisionMaker' in patch ? patch.isLegalDecisionMaker : existing.isLegalDecisionMaker,
  };
}

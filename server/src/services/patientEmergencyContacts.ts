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
 *     contacts), kept as a last-resort backstop.
 * The only unique constraint on PatientEmergencyContact is the partial index
 * above, so any P2002 raised while creating/updating a contact can only be
 * that race — never an unrelated/ambiguous conflict.
 *
 * Deliberately NOT included — Prisma P2034 (generic transaction-conflict:
 * deadlock or serialization failure). An earlier version of this function
 * mapped P2034 to PRIMARY_CONTACT_CONFLICT defensively, on the theory that
 * it "shouldn't occur" under this design's READ COMMITTED isolation so it
 * was safe to treat as this race if it ever did. That reasoning doesn't
 * hold: P2034 is Prisma's generic code for ANY deadlock or serialization
 * failure the database reports, not a signal specific to this primary-
 * contact race — READ COMMITTED transactions can still deadlock for reasons
 * having nothing to do with primary-contact promotion (e.g. lock-ordering
 * with an unrelated concurrent write on the same patient row). Classifying
 * every such failure as PRIMARY_CONTACT_CONFLICT would mislabel a genuine
 * operational failure as a business conflict and hide it from the same
 * operational visibility (500 + server-side log) every other unexpected
 * transaction failure gets. A generic P2034 that reaches the route handler
 * now falls through to the existing catch-all — logged and returned as a
 * plain 500, exactly like any other unclassified transaction error — never
 * exposing raw Prisma details to the client. Retrying it automatically was
 * considered and rejected here: nothing in this file's error data
 * distinguishes a spuriously-retryable deadlock from a real underlying
 * problem, and no repository convention already justifies a bounded retry
 * for this specific path.
 */
export function isPrimaryContactConflict(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  return code === 'P2002' || code === PRIMARY_CONTACT_CONFLICT_CODE;
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
 * A client-supplied optimistic-concurrency precondition for primary-contact
 * promotion (F1-004-P1-R2-R3). Distinct from NormalizedEmergencyContact
 * because it is a REQUEST-level precondition, not persisted contact data.
 *
 * Presence and value are deliberately tracked separately —
 * `{ provided: false }` (the field was omitted entirely — legacy client,
 * best-effort server-side comparison only, see patientEmergencyContactsConcurrency.ts)
 * is NOT the same as `{ provided: true, expectedCurrentPrimaryContactId: null }`
 * (the client explicitly asserts "I observed no current primary"). Collapsing
 * "omitted" into "null" would silently downgrade every legacy request into a
 * (false) explicit "no primary" assertion and reject legitimate sequential
 * replacements against an established primary.
 */
export type ExpectedPrimaryPrecondition =
  | { provided: false }
  | { provided: true; expectedCurrentPrimaryContactId: string | null };

export type ExpectedPrimaryPreconditionResult =
  | { ok: true; precondition: ExpectedPrimaryPrecondition }
  | { ok: false; error: string };

/**
 * Parses the optional `expectedCurrentPrimaryContactId` request field used by
 * POST/PUT emergency-contacts to close the primary-promotion race that a
 * purely server-side "prior vs current" comparison cannot: see
 * patientEmergencyContactsConcurrency.ts's header comment for the full proof
 * that no database-only signal can distinguish two requests that genuinely
 * overlapped at the HTTP layer from two that were genuinely sequential, once
 * the losing request's entire transaction happens to execute after the
 * winner's commit. When the client provides this field, it captures the
 * client's own observed state at request-formation time — information the
 * server can never reconstruct from database state alone — and the route
 * enforces it as a true optimistic-concurrency precondition instead of
 * relying on timing.
 *
 * Accepts: field omitted entirely (`{ provided: false }`); `null` (client
 * observed no current primary); or a non-empty string (client observed that
 * exact contact as primary). Any other JSON type (number, boolean, object,
 * empty string) is a validation error — never silently coerced.
 */
export function parseExpectedPrimaryPrecondition(body: Record<string, unknown>): ExpectedPrimaryPreconditionResult {
  if (!Object.prototype.hasOwnProperty.call(body, 'expectedCurrentPrimaryContactId')) {
    return { ok: true, precondition: { provided: false } };
  }
  const raw = body.expectedCurrentPrimaryContactId;
  if (raw === null) {
    return { ok: true, precondition: { provided: true, expectedCurrentPrimaryContactId: null } };
  }
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return { ok: true, precondition: { provided: true, expectedCurrentPrimaryContactId: raw.trim() } };
  }
  return { ok: false, error: 'expectedCurrentPrimaryContactId must be null or a non-empty string contact id' };
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

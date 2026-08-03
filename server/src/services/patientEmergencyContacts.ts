/**
 * patientEmergencyContacts.ts — US-01.2 validation/normalization logic.
 *
 * Pure functions only (no Prisma/DB access) so the create/update invariants
 * — fullName required, phone required whenever fullName is present, email
 * format, contactType contract — can be unit tested without a database. The
 * route handler (server/src/routes/patientEmergencyContacts.ts) is
 * responsible for scope resolution and the single-primary transaction.
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

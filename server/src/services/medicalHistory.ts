/**
 * medicalHistory.ts — US-01.1-P1 validation/normalization logic.
 *
 * Pure functions only (no Prisma/DB access), following the same convention
 * as services/patientEmergencyContacts.ts, so the create invariants —
 * noKnownConditions exclusivity, pregnancy-status/date consistency,
 * condition-status contract, no duplicate condition codes in one submission
 * — can be unit tested without a database. The route handler
 * (server/src/routes/patientMedicalHistory.ts) is responsible for scope
 * resolution, resolving condition `code`s against the MedicalCondition
 * lookup table (a DB read this file deliberately does not perform), and the
 * version-allocation transaction.
 */

export const PREGNANCY_STATUSES = ['unknown', 'not_pregnant', 'pregnant', 'not_applicable'] as const;
export type PregnancyStatus = (typeof PREGNANCY_STATUSES)[number];

export const MEDICAL_CONDITION_STATUSES = ['active', 'resolved', 'historical'] as const;
export type MedicalConditionStatus = (typeof MEDICAL_CONDITION_STATUSES)[number];

export type MedicalHistoryConditionInput = {
  code?: unknown;
  status?: unknown;
  note?: unknown;
};

export type MedicalHistoryInput = {
  noKnownConditions?: unknown;
  allergies?: unknown;
  currentMedications?: unknown;
  pregnancyStatus?: unknown;
  pregnancyStartDate?: unknown;
  conditions?: unknown;
};

export type NormalizedMedicalHistoryCondition = {
  code: string;
  status: MedicalConditionStatus;
  note: string | null;
};

export type NormalizedMedicalHistory = {
  noKnownConditions: boolean;
  allergies: string | null;
  currentMedications: string | null;
  pregnancyStatus: PregnancyStatus;
  pregnancyStartDate: Date | null;
  conditions: NormalizedMedicalHistoryCondition[];
};

export type MedicalHistoryValidationResult =
  | { ok: true; data: NormalizedMedicalHistory }
  | { ok: false; error: string };

function toTrimmedStringOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

function validateCondition(
  input: MedicalHistoryConditionInput,
  index: number,
): { ok: true; data: NormalizedMedicalHistoryCondition } | { ok: false; error: string } {
  const code = toTrimmedStringOrNull(input.code);
  if (!code) {
    return { ok: false, error: `conditions[${index}].code is required` };
  }

  const rawStatus = typeof input.status === 'string' ? input.status.trim().toLowerCase() : 'active';
  if (!(MEDICAL_CONDITION_STATUSES as readonly string[]).includes(rawStatus)) {
    return { ok: false, error: `conditions[${index}].status must be one of: ${MEDICAL_CONDITION_STATUSES.join(', ')}` };
  }

  return {
    ok: true,
    data: {
      code,
      status: rawStatus as MedicalConditionStatus,
      note: toTrimmedStringOrNull(input.note),
    },
  };
}

/**
 * Validates and normalizes a full medical-history version submission.
 *
 * Invariants enforced:
 *  - pregnancyStatus must be one of PREGNANCY_STATUSES (defaults to
 *    'unknown' when absent).
 *  - pregnancyStartDate may only be set when pregnancyStatus === 'pregnant'
 *    — rejected (not silently dropped) otherwise, so a caller passing
 *    inconsistent data gets an explicit error rather than a silently
 *    modified record.
 *  - noKnownConditions exclusivity: when true, `conditions` must be empty —
 *    a patient is never simultaneously "no known conditions" and "has
 *    condition X" in the same version.
 *  - conditions[].code must be non-empty and unique within the submission
 *    (no duplicate condition linked twice in one version); conditions[].status
 *    must be a recognized value.
 */
export function validateMedicalHistory(input: MedicalHistoryInput): MedicalHistoryValidationResult {
  const noKnownConditions = input.noKnownConditions === true;

  const rawPregnancyStatus =
    typeof input.pregnancyStatus === 'string' && input.pregnancyStatus.trim().length > 0
      ? input.pregnancyStatus.trim().toLowerCase()
      : 'unknown';
  if (!(PREGNANCY_STATUSES as readonly string[]).includes(rawPregnancyStatus)) {
    return { ok: false, error: `pregnancyStatus must be one of: ${PREGNANCY_STATUSES.join(', ')}` };
  }
  const pregnancyStatus = rawPregnancyStatus as PregnancyStatus;

  let pregnancyStartDate: Date | null = null;
  if (input.pregnancyStartDate !== undefined && input.pregnancyStartDate !== null && input.pregnancyStartDate !== '') {
    if (pregnancyStatus !== 'pregnant') {
      return { ok: false, error: "pregnancyStartDate can only be set when pregnancyStatus is 'pregnant'" };
    }
    const parsed = new Date(input.pregnancyStartDate as string);
    if (Number.isNaN(parsed.getTime())) {
      return { ok: false, error: 'pregnancyStartDate must be a valid date' };
    }
    pregnancyStartDate = parsed;
  }

  const rawConditions = Array.isArray(input.conditions) ? input.conditions : [];
  if (noKnownConditions && rawConditions.length > 0) {
    return { ok: false, error: 'conditions must be empty when noKnownConditions is true' };
  }

  const conditions: NormalizedMedicalHistoryCondition[] = [];
  const seenCodes = new Set<string>();
  for (let i = 0; i < rawConditions.length; i++) {
    const result = validateCondition(rawConditions[i] as MedicalHistoryConditionInput, i);
    if (!result.ok) return result;
    const normalizedCode = result.data.code.toUpperCase();
    if (seenCodes.has(normalizedCode)) {
      return { ok: false, error: `conditions[${i}].code duplicates an earlier entry: ${result.data.code}` };
    }
    seenCodes.add(normalizedCode);
    conditions.push({ ...result.data, code: normalizedCode });
  }

  return {
    ok: true,
    data: {
      noKnownConditions,
      allergies: toTrimmedStringOrNull(input.allergies),
      currentMedications: toTrimmedStringOrNull(input.currentMedications),
      pregnancyStatus,
      pregnancyStartDate,
      conditions,
    },
  };
}

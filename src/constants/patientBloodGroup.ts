/**
 * patientBloodGroup.ts — F3-DATA-MIG-TODAY-001-R8
 *
 * The eight canonical ABO/Rh values `Patient.bloodGroup` accepts, in the order
 * the patient form and the patient detail page present them.
 *
 * This list MIRRORS `patientBloodGroupValues` in server/src/schemas/index.ts,
 * which is the authority: the API rejects anything outside it with a 400. It
 * is duplicated here rather than imported because the client bundle does not
 * import server code, and it is asserted against the four locale files by
 * src/constants/__tests__/patientBloodGroup.vitest.test.ts — so a value added
 * on one side without the other fails CI instead of shipping a select whose
 * options the API refuses.
 *
 * PRESENTATION vs STORAGE: Turkish clinical usage writes the O group with the
 * digit zero ("0 Rh+"). That is a LABEL, held in the locale files. What is
 * stored and sent over the wire is always the canonical letter-O token
 * (`O_POSITIVE`). Never derive one from the other by string manipulation.
 *
 * There is deliberately no UNKNOWN member: the form's empty option submits ''
 * which the API stores as NULL, meaning "no blood group recorded". A token
 * meaning "recorded as unknown" would be a different clinical claim.
 *
 * KVKK Art. 6 special-category health data — see the Patient.bloodGroup doc
 * comment in server/prisma/schema.prisma.
 */
export const PATIENT_BLOOD_GROUP_VALUES = [
  'A_POSITIVE',
  'A_NEGATIVE',
  'B_POSITIVE',
  'B_NEGATIVE',
  'AB_POSITIVE',
  'AB_NEGATIVE',
  'O_POSITIVE',
  'O_NEGATIVE',
] as const;

export type PatientBloodGroup = (typeof PATIENT_BLOOD_GROUP_VALUES)[number];

/** The i18n key holding the human label for a canonical value. */
export function bloodGroupLabelKey(value: string): string {
  return `patients:bloodGroup.${value}`;
}

/**
 * firstCustomerMatrix.ts — F3-DATA-MIG-TODAY
 *
 * The FIRST-CUSTOMER MAPPING PROFILE: the accepted, per-column disposition of
 * all 91 named columns in the first customer's legacy dental export.
 *
 * Source of truth: docs/program/PATIENT_FIELD_GAP_AND_IDENTITY_DECISION_PACKAGE.md
 * §5 "Source→NoraMedi field matrix (F3-DATA-MIG-002)" and §5.1 "Decision counts",
 * as corrected through R4.
 *
 * THIS IS THE ONLY MODULE IN THE MIGRATION SUBSYSTEM THAT IS ALLOWED TO KNOW
 * VENDOR COLUMN NAMES. It is a mapping profile, not domain code. Nothing in
 * patient/treatment/finance services may import from here.
 *
 * BYTE-EXACT KEYS. `sourceField` is the header string exactly as exported.
 * Matching by the normalized form is a FALLBACK performed by the engine; the
 * key stored here and in a saved template is always byte-exact, or reruns
 * silently re-key. See normalizeHeader.ts.
 *
 * ---------------------------------------------------------------------------
 * DECISION COUNTS ENCODED HERE (a reviewer can check these against §5.1)
 * ---------------------------------------------------------------------------
 * The document's §5.1 table records the dispositions as they stood BEFORE this
 * sprint created four new destinations and re-classified two columns. The six
 * deltas are listed explicitly below so the difference is auditable rather than
 * accidental.
 *
 *   disposition                      §5.1 (R4 doc)   encoded here   delta
 *   IMPORT_DIRECT                          5              4          -1
 *   IMPORT_AFTER_NORMALIZATION             5              6          +1
 *   IMPORT_AFTER_REFERENCE_MAPPING         1              1           0
 *   IMPORT_AFTER_SCHEMA_FIELD              1              4          +3
 *   IMPORT_AFTER_SENSITIVE_REVIEW          0              4          +4   (R7/R8)
 *   SENSITIVE_REVIEW_NO_DESTINATION        0              0           0   (R8)
 *   HISTORICAL_METADATA_ONLY               4              4           0
 *   MANUAL_REVIEW                          2              2           0
 *   IGNORE_VENDOR_INTERNAL                12             13          +1
 *   IGNORE_SUMMARY_NOT_TRANSACTION        16             16           0
 *   BLOCKED_LEGAL_DECISION                 5              2          -3
 *   BLOCKED_NO_DESTINATION                40             35          -5
 *   TOTAL                                 91             91           0
 *
 * ---------------------------------------------------------------------------
 * R7 POLICY CORRECTION (F3-DATA-MIG-TODAY-001-FINAL-R7)
 * ---------------------------------------------------------------------------
 * The rejected model was:
 *     SPECIAL_CATEGORY -> LEGAL_BLOCKED -> CAN NEVER BE IMPORTED
 * The accepted model is:
 *     SPECIAL_CATEGORY -> appropriate destination -> controlled, REVIEWED
 *     migration -> tenant scope + audit + existing authorization
 *
 * This export comes from the clinic's incumbent practice-management system and
 * is being migrated so the clinic can keep operating. Special-category status
 * must constrain HOW its own operational record moves, not delete it.
 *
 * Four of the six BLOCKED_LEGAL_DECISION columns were blocked ONLY because
 * their content is health data, and they move:
 *   ONEMLINOT   -> IMPORT_AFTER_SENSITIVE_REVIEW  (patient.notes, order 1)
 *   KONTROLNOTU -> IMPORT_AFTER_SENSITIVE_REVIEW  (patient.notes, order 2)
 *   UZUNNOT     -> IMPORT_AFTER_SENSITIVE_REVIEW  (patient.notes, order 3)
 *   KANGURUBU   -> IMPORT_AFTER_SENSITIVE_REVIEW  (patient.bloodGroup)
 *                  R8 UPDATE: R7 left this one SENSITIVE_REVIEW_NO_DESTINATION
 *                  because the product had nowhere to put a blood group. The
 *                  program owner has since decided it should have a real
 *                  structured field, and R8 created `Patient.bloodGroup`
 *                  (eight canonical ABO/Rh values) plus the `blood_group_tr`
 *                  normalization. The STRUCTURAL blocker is gone; the
 *                  SENSITIVE gate is not. The state is unchanged at
 *                  SENSITIVE_REVIEW_REQUIRED and a human still has to approve
 *                  it, at confidence 70, below every auto-accept path.
 *                  SENSITIVE_REVIEW_NO_DESTINATION therefore has no members
 *                  today. The disposition is RETAINED because 'reviewed,
 *                  sensitive, and the product genuinely has nowhere to put
 *                  it' is a real outcome the next customer profile may need,
 *                  and deleting it would force the next author to re-derive
 *                  the distinction from scratch.
 *
 * TWO REMAIN BLOCKED_LEGAL_DECISION AND THAT IS CORRECT — they were never
 * blocked for sensitivity:
 *   KVKKONAYKODU, KVKKSMS — writing these would FABRICATE consent that no
 *   patient gave. "A migration may not manufacture a lawful basis" is a
 *   different rule from "special-category data may never move", and only the
 *   second one is being retired. Both are 0 % filled, so nothing is lost.
 *
 * NONE of the four reclassified columns is auto-applied. All land in mapping
 * state SENSITIVE_REVIEW_REQUIRED, which is UNDECIDED: the run cannot execute
 * until a Platform Admin resolves each column individually.
 *
 * The six deltas, each with its reason:
 *
 *  1. TCNO      BLOCKED_NO_DESTINATION -> IMPORT_AFTER_SCHEMA_FIELD
 *     §5 recorded "G-E4 + encryption decision" as the blocker. §6.0 then ruled
 *     `TC_NATIONAL_IDENTITY_FIRST_CUSTOMER_PRIORITY = P0_FIRST_CUSTOMER_BLOCKER`
 *     and this sprint created `patient.identity.tckn`. The blocker is resolved,
 *     so the disposition advances to IMPORT_AFTER_SCHEMA_FIELD.
 *  2. CINSIYET  BLOCKED_NO_DESTINATION -> IMPORT_AFTER_SCHEMA_FIELD
 *     §5's blocker was literally "G-E5 — 11,807 values, no destination".
 *     `patient.gender` now exists.
 *  3. DOSYANO   BLOCKED_NO_DESTINATION -> IMPORT_AFTER_SCHEMA_FIELD
 *     §5's C-15 confirmed it clinic-facing and near-unique; the only blocker
 *     was the missing column. `patient.chartNumber` now exists.
 *  4. KANGURUBU BLOCKED_NO_DESTINATION -> BLOCKED_LEGAL_DECISION
 *     §5 already names the real blocker: "G-E11 + Art. 6 legal gate". Blood
 *     group is KVKK Art. 6 special-category health data. Recording it as a
 *     mere missing-destination would let a future destination unblock it
 *     without a legal decision. The legal gate is the stronger, correct state.
 *  5. HATIRLAT  BLOCKED_NO_DESTINATION -> IGNORE_VENDOR_INTERNAL
 *     §5: "G-E25 — HARD RULE: never map to any consent field. Recommend NOT
 *     building". A deliberate never-build is an IGNORE, not a pending gap.
 *  6. ADRESI    IMPORT_DIRECT -> IMPORT_AFTER_NORMALIZATION
 *     §5 rows for ADRESI and MAHALLE both target `Patient.address`, with
 *     MAHALLE marked "(composed) ... documented MAHALLE+ADRESI -> address".
 *     A composed write is by definition not a trim-only direct import, so both
 *     halves of the composition carry IMPORT_AFTER_NORMALIZATION.
 *
 * Rolled-up buckets encoded here: IMPORT 15 · HISTORICAL 4 · IGNORE 29 ·
 * BLOCKED 37 · MANUAL_REVIEW 2 · SENSITIVE_REVIEW 4  =  91.
 */

import {
  DESTINATION_FIELDS,
  getDestinationField,
  type MappingReason,
  type MappingState,
  type TransformName,
} from '../contracts.js';

/** The source system identifier this profile applies to. */
export const FIRST_CUSTOMER_SOURCE_SYSTEM = 'legacy-dental-tr-v1';

/**
 * The disposition vocabulary of §5. Note `BLOCKED_INVALID_SOURCE` from §5.1 is
 * deliberately absent: its count is 0 and §5.1 explains why ("TCNO's 8.5 %
 * malformed values are a ROW-level classification, not a column-level one").
 */
export type MatrixDisposition =
  | 'IMPORT_DIRECT'
  | 'IMPORT_AFTER_NORMALIZATION'
  | 'IMPORT_AFTER_REFERENCE_MAPPING'
  | 'IMPORT_AFTER_SCHEMA_FIELD'
  | 'HISTORICAL_METADATA_ONLY'
  | 'MANUAL_REVIEW'
  /**
   * KVKK Art. 6 special-category content WITH a valid destination in the
   * catalog. The destination is PROPOSED, never applied automatically: a
   * Platform Admin approves each column individually. See MappingState
   * 'SENSITIVE_REVIEW_REQUIRED' in contracts.ts for why this is not
   * BLOCKED_LEGAL_DECISION.
   */
  | 'IMPORT_AFTER_SENSITIVE_REVIEW'
  /**
   * KVKK Art. 6 special-category content that carries MEANINGFUL clinic data
   * but has NO valid destination anywhere in the product. It must not be
   * dropped and must not be guessed into an unrelated field, so it surfaces as
   * a review item with no proposal until a program owner decides on a
   * destination. Distinct from BLOCKED_NO_DESTINATION, which is silent.
   */
  | 'SENSITIVE_REVIEW_NO_DESTINATION'
  | 'IGNORE_VENDOR_INTERNAL'
  | 'IGNORE_SUMMARY_NOT_TRANSACTION'
  | 'BLOCKED_LEGAL_DECISION'
  | 'BLOCKED_NO_DESTINATION';

export interface MatrixEntry {
  /** Byte-exact vendor column name. The stored mapping key. */
  sourceField: string;
  /** Short English meaning, for the reviewer UI. */
  meaning: string;
  disposition: MatrixDisposition;
  /** A key from DESTINATION_FIELDS, or null when nothing may be written. */
  destinationField: string | null;
  transform: TransformName | null;
  /** Only set when several columns compose into one destination. */
  composeOrder?: number;
  /** The mapping state this disposition implies. */
  mappingState: MappingState;
  reason: MappingReason;
  /** 0..100. Confidence in the DESTINATION PROPOSAL, not in the decision. */
  confidence: number;
  /** WHY. Mandatory in spirit for every blocked / ignored / manual row. */
  note?: string;
}

// ---------------------------------------------------------------------------
// disposition -> (mappingState, reason, confidence)
// ---------------------------------------------------------------------------

function stateFor(d: MatrixDisposition): MappingState {
  switch (d) {
    case 'IMPORT_DIRECT':
    case 'IMPORT_AFTER_NORMALIZATION':
    case 'IMPORT_AFTER_REFERENCE_MAPPING':
    case 'IMPORT_AFTER_SCHEMA_FIELD':
      return 'AUTO_CONFIDENT';
    case 'IGNORE_VENDOR_INTERNAL':
    case 'IGNORE_SUMMARY_NOT_TRANSACTION':
    case 'HISTORICAL_METADATA_ONLY':
      return 'IGNORE';
    case 'IMPORT_AFTER_SENSITIVE_REVIEW':
    case 'SENSITIVE_REVIEW_NO_DESTINATION':
      return 'SENSITIVE_REVIEW_REQUIRED';
    case 'BLOCKED_LEGAL_DECISION':
      return 'LEGAL_BLOCKED';
    case 'BLOCKED_NO_DESTINATION':
      return 'BLOCKED';
    case 'MANUAL_REVIEW':
      return 'MANUAL_REQUIRED';
  }
}

function reasonFor(d: MatrixDisposition): MappingReason {
  switch (d) {
    case 'IMPORT_DIRECT':
    case 'IMPORT_AFTER_NORMALIZATION':
    case 'IMPORT_AFTER_REFERENCE_MAPPING':
    case 'IMPORT_AFTER_SCHEMA_FIELD':
      return 'FIRST_CUSTOMER_MATRIX';
    case 'IGNORE_VENDOR_INTERNAL':
      return 'VENDOR_INTERNAL';
    case 'IGNORE_SUMMARY_NOT_TRANSACTION':
      return 'SUMMARY_NOT_TRANSACTION';
    // HISTORICAL_METADATA_ONLY is retained as RUN METADATA, never written to a
    // patient field. From the destination catalog's point of view it is the
    // same class of decision as a vendor-internal column: no destination is
    // legitimate, so the reason is VENDOR_INTERNAL per the accepted mapping.
    case 'HISTORICAL_METADATA_ONLY':
      return 'VENDOR_INTERNAL';
    case 'IMPORT_AFTER_SENSITIVE_REVIEW':
    case 'SENSITIVE_REVIEW_NO_DESTINATION':
      return 'SPECIAL_CATEGORY_REVIEW';
    case 'BLOCKED_LEGAL_DECISION':
      return 'LEGAL_GATE';
    case 'BLOCKED_NO_DESTINATION':
      return 'NO_DESTINATION';
    case 'MANUAL_REVIEW':
      return 'SEMANTICS_UNRESOLVED';
  }
}

/**
 * Confidence is confidence in the PROPOSED DESTINATION.
 *
 * An accepted import or an accepted ignore is a settled decision: 100. A
 * blocked or manual-review column proposes no destination at all, so there is
 * nothing to be confident about: 0. Reporting anything else would let a
 * confidence threshold in the UI treat "we deliberately refuse to map this"
 * as "we are fairly sure about this mapping".
 */
function confidenceFor(d: MatrixDisposition): number {
  switch (d) {
    case 'IMPORT_DIRECT':
    case 'IMPORT_AFTER_NORMALIZATION':
    case 'IMPORT_AFTER_REFERENCE_MAPPING':
    case 'IMPORT_AFTER_SCHEMA_FIELD':
    case 'IGNORE_VENDOR_INTERNAL':
    case 'IGNORE_SUMMARY_NOT_TRANSACTION':
    case 'HISTORICAL_METADATA_ONLY':
      return 100;
    // A proposed-but-unapproved destination. Deliberately BELOW every
    // auto-accept path so "accept all safe suggestions" can never sweep a
    // special-category column into the import without a human looking at it,
    // while still being non-zero: there IS a destination proposal here, unlike
    // a blocked or manual-review column, and reporting 0 would tell the
    // operator we have no opinion when in fact we have a documented one.
    case 'IMPORT_AFTER_SENSITIVE_REVIEW':
      return 70;
    case 'SENSITIVE_REVIEW_NO_DESTINATION':
    case 'BLOCKED_LEGAL_DECISION':
    case 'BLOCKED_NO_DESTINATION':
    case 'MANUAL_REVIEW':
      return 0;
  }
}

interface MatrixSpec {
  sourceField: string;
  meaning: string;
  disposition: MatrixDisposition;
  destinationField?: string | null;
  transform?: TransformName | null;
  composeOrder?: number;
  note?: string;
}

function entry(spec: MatrixSpec): MatrixEntry {
  const base: MatrixEntry = {
    sourceField: spec.sourceField,
    meaning: spec.meaning,
    disposition: spec.disposition,
    destinationField: spec.destinationField ?? null,
    transform: spec.transform ?? null,
    mappingState: stateFor(spec.disposition),
    reason: reasonFor(spec.disposition),
    confidence: confidenceFor(spec.disposition),
    note: spec.note,
  };
  return spec.composeOrder === undefined ? base : { ...base, composeOrder: spec.composeOrder };
}

// ---------------------------------------------------------------------------
// THE MATRIX — 91 named columns, in physical column order per §5.
//
// §5 note: the workbook is physically 92 columns wide; the leading column
// carries no header text and no data of any type in the header row or any of
// the 14,890 data rows. It is a structural artifact, not a 92nd named column,
// and requires no disposition. It is therefore absent from this array.
// ---------------------------------------------------------------------------

export const FIRST_CUSTOMER_MATRIX: readonly MatrixEntry[] = [
  entry({
    sourceField: 'HASTA_ID',
    meaning: 'Vendor patient primary key',
    disposition: 'IMPORT_AFTER_SCHEMA_FIELD',
    destinationField: 'provenance.sourceId',
    transform: 'provenance_source_id',
    note:
      '100 % filled, 14,890 unique. The durable cross-run identity: rerunning a row MATCHES ' +
      'instead of creating a second patient. Never shown to a patient and never treated as a ' +
      'medical identifier.',
  }),
  entry({
    sourceField: 'ADI',
    meaning: 'First name',
    disposition: 'IMPORT_DIRECT',
    destinationField: 'patient.firstName',
    transform: 'trim_collapse',
  }),
  entry({
    sourceField: 'SOYADI',
    meaning: 'Last name',
    disposition: 'IMPORT_DIRECT',
    destinationField: 'patient.lastName',
    transform: 'trim',
  }),
  entry({
    sourceField: 'UNVANI',
    meaning: 'Title / honorific',
    disposition: 'BLOCKED_NO_DESTINATION',
    note: 'G-E14. No Patient field holds an honorific; fill rate unmeasured.',
  }),
  entry({
    sourceField: 'BABAADI',
    meaning: "Father's name",
    disposition: 'BLOCKED_NO_DESTINATION',
    note: 'G-E12. Third-party PII with no destination. Never divert into a name or note field.',
  }),
  entry({
    sourceField: 'ANNEADI',
    meaning: "Mother's name",
    disposition: 'BLOCKED_NO_DESTINATION',
    note: 'G-E12. Third-party PII with no destination.',
  }),
  entry({
    sourceField: 'CINSIYET',
    meaning: 'Gender',
    disposition: 'IMPORT_AFTER_SCHEMA_FIELD',
    destinationField: 'patient.gender',
    transform: 'gender_tr',
    note:
      "§5's blocker was G-E5 — 11,807 values with no destination. patient.gender now exists, so " +
      'the column is importable. 79.3 % filled / 2 distinct. Unrecognized or blank values map to ' +
      'NULL plus a warning, NEVER to "other" and never to a guess: not-recorded and ' +
      'patient-reported-other are different states.',
  }),
  entry({
    sourceField: 'DOGUMTARIHI',
    meaning: 'Date of birth',
    disposition: 'IMPORT_AFTER_NORMALIZATION',
    destinationField: 'patient.dateOfBirth',
    transform: 'date_excel_serial',
    note:
      '69.5 % filled; 10,332 date cells and 10 string cells. Excel serial -> Date anchored at UTC ' +
      'noon to avoid timezone drift. Future-dated values are rejected by the write schema and ' +
      'classify the row INVALID at dry-run.',
  }),
  entry({
    sourceField: 'DOGUMIL',
    meaning: 'Birth province',
    disposition: 'BLOCKED_NO_DESTINATION',
    note: 'G-E13. patient.city is the RESIDENCE province and is already claimed by IL.',
  }),
  entry({
    sourceField: 'DOGUMILCE',
    meaning: 'Birth district',
    disposition: 'BLOCKED_NO_DESTINATION',
    note: 'G-E13. No district field exists at all.',
  }),
  entry({
    sourceField: 'MEDENIHALI',
    meaning: 'Marital status',
    disposition: 'BLOCKED_NO_DESTINATION',
    note: 'G-E15. No destination and no consumer in the product.',
  }),
  entry({
    sourceField: 'MESLEGI',
    meaning: 'Occupation',
    disposition: 'BLOCKED_NO_DESTINATION',
    note:
      'G-E16. TRAP: an `occupation` field does exist, but on PatientEmergencyContact — it is the ' +
      "EMERGENCY CONTACT's occupation, not the patient's. Writing there would attribute the " +
      "patient's occupation to a third party.",
  }),
  entry({
    sourceField: 'EGITIMDURUMU',
    meaning: 'Education level',
    disposition: 'BLOCKED_NO_DESTINATION',
    note: 'G-E17. No destination; the accepted recommendation is NOT to build one.',
  }),
  entry({
    sourceField: 'UYRUK',
    meaning: 'Nationality',
    disposition: 'BLOCKED_NO_DESTINATION',
    note:
      'G-E9. 0 % filled, so it cannot be a first-customer blocker. Nationality is CITIZENSHIP; ' +
      'patient.country is RESIDENCE. They are not interchangeable.',
  }),
  entry({
    sourceField: 'ULKE',
    meaning: 'Country of residence',
    disposition: 'IMPORT_DIRECT',
    destinationField: 'patient.country',
    transform: 'trim',
    note:
      '0 % filled FOR THIS CUSTOMER, but the mapping is VALID and must be recorded as a mapping, ' +
      'NOT as IGNORE. Recording an empty-but-correct column as IGNORE would bake this ' +
      "customer's data shape into the profile and silently drop the NEXT customer's country data.",
  }),
  entry({
    sourceField: 'TCNO',
    meaning: 'T.C. national identity number',
    disposition: 'IMPORT_AFTER_SCHEMA_FIELD',
    destinationField: 'patient.identity.tckn',
    transform: 'identity_tckn',
    note:
      '77.2 % filled / 11,500 values. §6.0 ruled this P0_FIRST_CUSTOMER_BLOCKER and this sprint ' +
      'created patient.identity.tckn. Written ONLY to the encrypted PatientIdentityDocument child ' +
      'model under separated key material with a tenant-bound HMAC lookup token. Values failing ' +
      'shape/checksum are QUARANTINED (classified, never written) — a malformed legacy value must ' +
      'never become a verified identity.',
  }),
  entry({
    sourceField: 'PASAPORTNO',
    meaning: 'Passport number',
    disposition: 'BLOCKED_NO_DESTINATION',
    note:
      'G-E4. 0 % filled, so not P0. The identity model created this sprint is TCKN-specific; ' +
      'passport numbers have a different shape and no checksum, so they must not reuse it.',
  }),
  entry({
    sourceField: 'SOSYAL_GUVENCE_NO',
    meaning: 'Social security (SGK) number',
    disposition: 'BLOCKED_NO_DESTINATION',
    note: 'G-E4 (C-4). 0 % filled. A distinct identity class with no destination.',
  }),
  entry({
    sourceField: 'SOSYAL_GUVENCE_KURUMU',
    meaning: 'Social security institution',
    disposition: 'BLOCKED_NO_DESTINATION',
    note: 'G-E19. Would require a reference map to an institution entity that does not exist.',
  }),
  entry({
    sourceField: 'ENABIZTAKIPNO',
    meaning: 'e-Nabiz tracking number',
    disposition: 'BLOCKED_NO_DESTINATION',
    note: 'G-E4 (C-4). 0 % filled. National health-system identifier with no destination.',
  }),
  entry({
    sourceField: 'YUPASS_NO',
    meaning: 'Foreign national pass number',
    disposition: 'BLOCKED_NO_DESTINATION',
    note: 'G-E4. Meaning unconfirmed; no destination. Do not guess an identity semantic.',
  }),
  entry({
    sourceField: 'HTS_KODU',
    meaning: 'Health-tourism code',
    disposition: 'BLOCKED_NO_DESTINATION',
    note: 'G-E4. Acronym unexpanded — an unexplained code must not be mapped anywhere.',
  }),
  entry({
    sourceField: 'VERGIDAIRESI',
    meaning: 'Tax office',
    disposition: 'BLOCKED_NO_DESTINATION',
    note: 'G-E26. No financial-party model to hold it.',
  }),
  entry({
    sourceField: 'VERGINO',
    meaning: 'Tax number (VKN)',
    disposition: 'BLOCKED_NO_DESTINATION',
    note:
      'G-E4. Likely explains the 72 twelve-digit values misfiled in TCNO — which is exactly why ' +
      'it must not be merged into the identity destination.',
  }),
  entry({
    sourceField: 'EVTELEFONU',
    meaning: 'Home phone',
    disposition: 'BLOCKED_NO_DESTINATION',
    note:
      'G-E8 (C-5). 0.3 % filled. Patient has ONE phone field, already claimed by CEPTELEFONU. ' +
      'HARD RULE: never divert into PatientEmergencyContact.phone — that would assert a home ' +
      'number is an emergency contact, which is a clinical safety claim nobody made.',
  }),
  entry({
    sourceField: 'ISTELEFONU',
    meaning: 'Work phone',
    disposition: 'BLOCKED_NO_DESTINATION',
    note: 'G-E8 (C-5). 1.1 % filled. Same single-phone-field constraint as EVTELEFONU.',
  }),
  entry({
    sourceField: 'CEPTELEFONU',
    meaning: 'Mobile phone',
    disposition: 'IMPORT_AFTER_NORMALIZATION',
    destinationField: 'patient.phone',
    transform: 'phone_tr',
    note:
      '91.4 % filled; 13,342 string cells and 271 number cells whose leading zero Excel destroyed. ' +
      'NEVER a dedup key: 28.6 % of source rows share a phone (shared family phones are supported ' +
      'product behaviour). The dry-run reports every pre-existing patient flipped from 1 to 2 ' +
      'matches instead of merging anyone.',
  }),
  entry({
    sourceField: 'FAX',
    meaning: 'Fax number',
    disposition: 'BLOCKED_NO_DESTINATION',
    note: 'G-E8. No destination; the accepted recommendation is NOT to build one.',
  }),
  entry({
    sourceField: 'EMAIL',
    meaning: 'E-mail address',
    disposition: 'IMPORT_AFTER_NORMALIZATION',
    destinationField: 'patient.email',
    transform: 'lower_trim',
    note:
      '0.05 % filled — 7 rows, of which about 1 is valid. NEVER a dedup key and unusable as ' +
      'identity. An invalid value is DROPPED with a row warning, never a row failure: failing ' +
      '6 rows over a decade-old typo would block a migration for nothing.',
  }),
  entry({
    sourceField: 'ADRESI',
    meaning: 'Street address',
    disposition: 'IMPORT_AFTER_NORMALIZATION',
    destinationField: 'patient.address',
    transform: 'compose_address',
    composeOrder: 2,
    note:
      'Second part of the documented MAHALLE + ADRESI -> patient.address composition. The order ' +
      'is fixed and the join rule is stable across reruns; an unstable rule would break ' +
      'idempotency by producing a different address string on every run.',
  }),
  entry({
    sourceField: 'ADRES_KODU',
    meaning: 'Address code (postal code or UAVT code — unresolved)',
    disposition: 'MANUAL_REVIEW',
    note:
      'C-12. 0.00 % filled (0/14,890). The 0 % measurement closes the MEASUREMENT question, not ' +
      'the SEMANTIC one: 5-digit posta kodu vs 10-digit UAVT address code remains unresolved and ' +
      'there is no data to examine. ABSENCE OF DATA MUST NEVER BE ENCODED AS A DIRECT MAPPING — ' +
      'a future export with non-zero fill would then write UAVT codes into postalCode silently. ' +
      'Resolve with a digit-length histogram before importing from any source with fill here.',
  }),
  entry({
    sourceField: 'IL',
    meaning: 'Province / city',
    disposition: 'IMPORT_DIRECT',
    destinationField: 'patient.city',
    transform: 'trim',
    note: 'Free text. No province canonicalization table exists in the product, so none is applied.',
  }),
  entry({
    sourceField: 'ILCE',
    meaning: 'District',
    disposition: 'BLOCKED_NO_DESTINATION',
    note:
      'G-E7. About 13 filled rows. No district field. Do NOT fold into address: that would make ' +
      'the composition rule depend on fill rate and break rerun stability.',
  }),
  entry({
    sourceField: 'MAHALLE',
    meaning: 'Neighbourhood',
    disposition: 'IMPORT_AFTER_NORMALIZATION',
    destinationField: 'patient.address',
    transform: 'compose_address',
    composeOrder: 1,
    note:
      'First part of the documented MAHALLE + ADRESI -> patient.address composition. patient.address ' +
      'is the one destination in the catalog with allowsComposition === true.',
  }),
  entry({
    sourceField: 'KANGURUBU',
    meaning: 'Blood group',
    disposition: 'IMPORT_AFTER_SENSITIVE_REVIEW',
    destinationField: 'patient.bloodGroup',
    transform: 'blood_group_tr',
    note:
      'KVKK Art. 6 special-category health data. 1 filled row out of 14,890. ' +
      'R7 moved it off the standing legal block and onto operator review, but that review ' +
      'had nothing to approve: the product had no blood-group column at all, so the column ' +
      'was sensitive AND structurally blocked. R8 UPDATE: the program owner decided it ' +
      'should have a real structured destination, and this sprint added Patient.bloodGroup ' +
      'with the eight canonical ABO/Rh values plus the blood_group_tr normalization. ' +
      'The structural blocker is resolved; the SENSITIVE gate is NOT. The state is unchanged ' +
      'at SENSITIVE_REVIEW_REQUIRED (UNDECIDED) with confidence 70, below every auto-accept ' +
      'path, so a Platform Admin must still approve this column individually before the run ' +
      'can execute. It is deliberately NOT folded into patient.notes: a structured clinical ' +
      'attribute written into free text is not the same datum and could not be read back as ' +
      'a blood group. The single filled source value is NOT pre-judged here. If ' +
      'blood_group_tr does not recognize it, the transform yields NULL plus a countable ' +
      'warning and the value stays in the workbook for the operator to resolve. Rh is never ' +
      'inferred from an ABO-only value. Nothing is discarded on any path.',
  }),
  entry({
    sourceField: 'ONEMLINOT',
    meaning: 'Important clinical note',
    disposition: 'IMPORT_AFTER_SENSITIVE_REVIEW',
    destinationField: 'patient.notes',
    transform: 'compose_notes',
    composeOrder: 1,
    note:
      'C-13. 45.70 % filled (6,805/14,890) — by volume the single largest body of clinical ' +
      'content in this export, and the clinic needs it to keep treating these patients. ' +
      'R7 CORRECTION: previously LEGAL_BLOCKED, which discarded it outright for being ' +
      'special-category. Two things changed. (1) The policy: KVKK Art. 6 status governs HOW ' +
      'this migrates — masked preview, explicit per-column approval, tenant scope, audit — not ' +
      'WHETHER an incumbent clinic may migrate its own operational record. (2) The stated ' +
      'factual justification did not survive verification: "write-only from the UI, so a KVKK ' +
      'request would be unserviceable" is wrong. patient.notes is READ and rendered as the ' +
      'patient-detail Clinical Alerts card, exported for subject access (patientPrivacy.ts), ' +
      'accepted on PUT /patients/:id (schemas/index.ts + routes/patients.ts) and already ' +
      'cleared by patientAnonymization.ts. Access, rectification and erasure are therefore all ' +
      'serviceable today; the only real gap is a missing edit control in the clinic UI. ' +
      'First of the documented ONEMLINOT -> KONTROLNOTU -> UZUNNOT composition into ' +
      'patient.notes. NOT auto-applied: SENSITIVE_REVIEW_REQUIRED, so a Platform Admin must ' +
      'approve it before the run can execute.',
  }),
  entry({
    sourceField: 'UZUNNOT',
    meaning: 'Long note',
    disposition: 'IMPORT_AFTER_SENSITIVE_REVIEW',
    destinationField: 'patient.notes',
    transform: 'compose_notes',
    composeOrder: 3,
    note:
      '0 % filled in THIS workbook, so nothing is at stake for the first customer either way. ' +
      'R7 CORRECTION: it still moves off LEGAL_BLOCKED, because the disposition is a ' +
      'COLUMN-level decision that applies to the NEXT customer too — and the reasoning that ' +
      'blocked it (special-category => never importable) is the reasoning being retired. ' +
      'Last in the composition order, so on an export where it IS filled it appends after ' +
      'ONEMLINOT and KONTROLNOTU rather than displacing them. Zero fill means the operator ' +
      'reviewing it will see an empty preview and can resolve it to IGNORE in one click; that ' +
      'is a deliberate operator decision, which is exactly the point.',
  }),
  entry({
    sourceField: 'KONTROLNOTU',
    meaning: 'Recall / check-up note',
    disposition: 'IMPORT_AFTER_SENSITIVE_REVIEW',
    destinationField: 'patient.notes',
    transform: 'compose_notes',
    composeOrder: 2,
    note:
      'C-14. 0.01 % filled (2/14,890), near-vestigial — but 2 real values is DATA-BEARING, not ' +
      'empty, and the R7 data-loss gate counts it as meaningful. R7 CORRECTION: same reasoning ' +
      'as ONEMLINOT. Low volume never justified the block and low volume does not justify ' +
      'dropping it now either; it simply means the reviewing operator has very little to read. ' +
      'Second in the ONEMLINOT -> KONTROLNOTU -> UZUNNOT composition.',
  }),
  entry({
    sourceField: 'TEDAVIDURUMU',
    meaning: 'Treatment status',
    disposition: 'IGNORE_SUMMARY_NOT_TRANSACTION',
    note:
      '0.02 % filled (3/14,890) — which is itself the evidence that this export carries NO ' +
      'treatment history. A status with no underlying transactions cannot be reconstructed.',
  }),
  entry({
    sourceField: 'SUBE_ID',
    meaning: 'Vendor branch id',
    disposition: 'IGNORE_VENDOR_INTERNAL',
    note:
      '61 % filled but only 1 distinct value. Deliberately ignored: the destination clinic cannot ' +
      'be derived from a vendor branch id and is operator-selected for the run.',
  }),
  entry({
    sourceField: 'HASTADOKTOR',
    meaning: 'Assigned doctor label',
    disposition: 'IMPORT_AFTER_REFERENCE_MAPPING',
    destinationField: 'patient.primaryPractitionerId',
    transform: 'practitioner_reference',
    note:
      'C-8. 99.5 % filled / 25 distinct. Resolved through an EXPLICIT, human-approved reference ' +
      'map to an EXISTING User. NO fuzzy matching and NO auto-creation: inventing a practitioner ' +
      'record, or matching one by similarity, would attribute patients to the wrong clinician. ' +
      'An unresolved source value blocks the rows carrying it.',
  }),
  entry({
    sourceField: 'REFERANSI',
    meaning: 'Referring person or source',
    disposition: 'BLOCKED_NO_DESTINATION',
    note:
      'G-E18. patient.source is ENUM-CONSTRAINED; REFERANSI is free text that may name a THIRD ' +
      'PARTY. Coercing it into the enum would destroy the referrer identity AND pollute a typed ' +
      'marketing enum with unbounded PII.',
  }),
  entry({
    sourceField: 'KURUMREFERANSI',
    meaning: 'Institutional referrer',
    disposition: 'BLOCKED_NO_DESTINATION',
    note: 'G-E19. Requires a reference map to an institution entity that does not exist.',
  }),
  entry({
    sourceField: 'REHBER_ID',
    meaning: 'Guide / agency id',
    disposition: 'IGNORE_VENDOR_INTERNAL',
    note: 'K-2. Vendor-internal id. Re-open only if profiling shows a genuine agency foreign key.',
  }),
  entry({
    sourceField: 'CALISMAGURUBU',
    meaning: 'Working group',
    disposition: 'IGNORE_VENDOR_INTERNAL',
    note: 'Meaning unconfirmed and vendor-internal. An unexplained grouping is not migrated.',
  }),
  entry({
    sourceField: 'AILEGURUBU',
    meaning: 'Family group code (semantics REFUTED)',
    disposition: 'IGNORE_VENDOR_INTERNAL',
    note:
      'C-16, which CLOSES AND REFUTES G-E20. The family-key hypothesis was MEASURED, not assumed: ' +
      '100.00 % distinct (14,890/14,890 unique, fixed 24-char all-digit). Inside every one of the ' +
      '1,557 shared-CEPTELEFONU groups (3,512 rows) the distinct AILEGURUBU count always equals ' +
      'the group size — no two rows sharing a phone ever share a value. A real household key would ' +
      'repeat among family members; none do. It is an opaque per-record system identifier. If a ' +
      'family/household key is ever needed, re-profile YAKINLIKKODU, not this column.',
  }),
  entry({
    sourceField: 'UCRETTARIFESI',
    meaning: 'Fee tariff',
    disposition: 'BLOCKED_NO_DESTINATION',
    note: 'G-E21. Model mismatch (D-17): no per-patient standing tariff exists.',
  }),
  entry({
    sourceField: 'KURUMTARIFE',
    meaning: 'Institution tariff',
    disposition: 'BLOCKED_NO_DESTINATION',
    note: 'G-E19. Depends on the missing institution entity.',
  }),
  entry({
    sourceField: 'SIGORTATURU',
    meaning: 'Insurance type',
    disposition: 'BLOCKED_NO_DESTINATION',
    note:
      'G-E23. Creating an InsuranceProvision merely to hold a type would FABRICATE A FINANCIAL ' +
      'RECORD that never existed.',
  }),
  entry({
    sourceField: 'RISK_TUTARI',
    meaning: 'Outstanding balance',
    disposition: 'IGNORE_SUMMARY_NOT_TRANSACTION',
    note:
      '0.01 % filled (2 rows). A balance is a DERIVED summary of transactions; no financial ' +
      'history exists in this export, so importing the summary would create an unbacked debt.',
  }),
  entry({
    sourceField: 'INDIRIMORANI',
    meaning: 'Standing discount rate',
    disposition: 'BLOCKED_NO_DESTINATION',
    note:
      'G-E22. Genuinely a STANDING ATTRIBUTE, not a summary — so it is blocked for want of a ' +
      'destination rather than ignored as derived data. The distinction matters for the backlog.',
  }),
  entry({
    sourceField: 'CARIODEMESTATU',
    meaning: 'Current-account payment status',
    disposition: 'IGNORE_SUMMARY_NOT_TRANSACTION',
    note:
      'Merged §13 records THREE COEXISTING definitions of "outstanding" in the source. A status ' +
      'whose own definition is ambiguous cannot be migrated into a single typed field.',
  }),
  entry({
    sourceField: 'ODEMESONTARIHI',
    meaning: 'Payment due date',
    disposition: 'IGNORE_SUMMARY_NOT_TRANSACTION',
    note: 'Derived from financial transactions that this export does not contain.',
  }),
  entry({
    sourceField: 'SONODEMETARIHI',
    meaning: 'Last payment date',
    disposition: 'IGNORE_SUMMARY_NOT_TRANSACTION',
    note: 'Derived from payment records that this export does not contain.',
  }),
  entry({
    sourceField: 'ODEMENOTU',
    meaning: 'Payment note',
    disposition: 'IGNORE_SUMMARY_NOT_TRANSACTION',
    note:
      'HARD RULE: do NOT divert into patient.notes. A finance comment rendered as a clinical note ' +
      'would appear to staff as medical context it is not.',
  }),
  entry({
    sourceField: 'ODEMENOTTARIHI',
    meaning: 'Payment-note date',
    disposition: 'IGNORE_SUMMARY_NOT_TRANSACTION',
    note: 'Timestamp of a finance comment that is itself not migrated.',
  }),
  entry({
    sourceField: 'SMSBORCTARIH',
    meaning: 'Debt-reminder SMS date',
    disposition: 'IGNORE_SUMMARY_NOT_TRANSACTION',
    note:
      'HARD RULE: never read as consent or opt-out evidence. That an SMS was sent proves the ' +
      'vendor sent it, not that the patient agreed to receive it.',
  }),
  entry({
    sourceField: 'SMSODEMETARIHI',
    meaning: 'Payment-confirmation SMS date',
    disposition: 'IGNORE_SUMMARY_NOT_TRANSACTION',
    note: 'As SMSBORCTARIH: delivery evidence, never consent evidence.',
  }),
  entry({
    sourceField: 'SONISLEMTARIHI',
    meaning: 'Last procedure date',
    disposition: 'IGNORE_SUMMARY_NOT_TRANSACTION',
    note:
      'A synthesised value here would MASS-FABRICATE RECALL CANDIDATES: one staff click on the ' +
      'recall list would contact thousands of patients on the strength of an invented date.',
  }),
  entry({
    sourceField: 'SONKONTROLTARIHI',
    meaning: 'Last check-up date',
    disposition: 'IGNORE_SUMMARY_NOT_TRANSACTION',
    note: 'Same mass-recall fabrication risk as SONISLEMTARIHI.',
  }),
  entry({
    sourceField: 'TEDAVISONTARIHI',
    meaning: 'Treatment end date',
    disposition: 'IGNORE_SUMMARY_NOT_TRANSACTION',
    note: 'Derived from treatment records that this export does not contain.',
  }),
  entry({
    sourceField: 'TEDAVIBITISTARIH',
    meaning: 'Treatment completion date',
    disposition: 'IGNORE_SUMMARY_NOT_TRANSACTION',
    note: 'treatmentCaseSchema exposes no createdAt/closedAt to receive it.',
  }),
  entry({
    sourceField: 'SONRANDEVUTARIHI',
    meaning: 'Last appointment date',
    disposition: 'IGNORE_SUMMARY_NOT_TRANSACTION',
    note:
      "Derived from appointments not present in this export. The product's availability check " +
      "evaluates TODAY's roster, so a historical summary has no consumer anyway.",
  }),
  entry({
    sourceField: 'SONANKETTARIHI',
    meaning: 'Last survey date',
    disposition: 'IGNORE_SUMMARY_NOT_TRANSACTION',
    note: 'Derived from survey records that this export does not contain.',
  }),
  entry({
    sourceField: 'SONGORUNTUTARIHI',
    meaning: 'Last imaging date',
    disposition: 'IGNORE_SUMMARY_NOT_TRANSACTION',
    note:
      'Derived. Retained as evidence (D-14) that an imaging corpus exists somewhere outside this ' +
      'export — a scoping signal, not migratable data.',
  }),
  entry({
    sourceField: 'KONTROLPERYODU',
    meaning: 'Recall interval',
    disposition: 'BLOCKED_NO_DESTINATION',
    note:
      'G-E24. A STANDING SETTING and genuinely useful, unlike the derived recall dates — blocked ' +
      'for want of a destination, not ignored as summary data.',
  }),
  entry({
    sourceField: 'HATIRLAT',
    meaning: 'Reminder flag',
    disposition: 'IGNORE_VENDOR_INTERNAL',
    note:
      'G-E25 — HARD RULE: this flag must NEVER map to any consent field. A vendor reminder toggle ' +
      'is an operational setting, not a KVKK/marketing consent record. §5 recorded it as ' +
      'BLOCKED_NO_DESTINATION with "recommend NOT building"; a deliberate never-build is an ' +
      'IGNORE, and recording it as merely blocked would invite a future task to "unblock" it by ' +
      'adding a consent column — the exact outcome the hard rule forbids.',
  }),
  entry({
    sourceField: 'KVKKONAYKODU',
    meaning: 'KVKK approval code',
    disposition: 'BLOCKED_LEGAL_DECISION',
    note:
      '0 % filled. CONSENT IS NEVER INVENTED. PatientCommunicationPreference is service-owned and ' +
      'evidence-gated (evidence_required is enforced); PatientCommunicationConsentEvent is ' +
      'append-only and must never be written by a migration. All migrated patients arrive ' +
      'non-messageable. ' +
      'R7: DELIBERATELY UNCHANGED. This column is NOT blocked for being sensitive — it is ' +
      'blocked because writing it would FABRICATE a lawful basis that no one ever gave. The R7 ' +
      'policy retires "special-category => never importable"; it does not touch "a migration ' +
      'may not manufacture consent evidence", which is a different and still-binding rule. ' +
      'Nothing is lost by holding it: 0 filled values.',
  }),
  entry({
    sourceField: 'KVKKILKKODU',
    meaning: 'KVKK initial code',
    disposition: 'HISTORICAL_METADATA_ONLY',
    note:
      'K-4. 31.9 % filled / 4,633 distinct — a near-unique CODE, not a consent STATE. Retained as ' +
      'run metadata only. Its near-uniqueness is precisely why it cannot be read as a flag.',
  }),
  entry({
    sourceField: 'KVKKSMS',
    meaning: 'KVKK SMS flag',
    disposition: 'BLOCKED_LEGAL_DECISION',
    note:
      '0 % filled. Same consent gate as KVKKONAYKODU. Consent is never inferred from a legacy ' +
      'flag. R7: DELIBERATELY UNCHANGED, for the same reason — the block is consent ' +
      'fabrication, not sensitivity, and 0 filled values means nothing is lost by holding it.',
  }),
  entry({
    sourceField: 'MESAJOK',
    meaning: '"Messaging OK" flag',
    disposition: 'IGNORE_VENDOR_INTERNAL',
    note:
      'HARD RULE: must NEVER map to any consent field, despite the tempting name. Discarded ' +
      'deliberately — a vendor UI toggle is not lawful-basis evidence under KVKK.',
  }),
  entry({
    sourceField: 'SMSGONDERILDI',
    meaning: 'SMS-sent flag',
    disposition: 'IGNORE_VENDOR_INTERNAL',
    note:
      'HARD RULE: must NEVER map to any consent field. It is DELIVERY EVIDENCE — proof the vendor ' +
      'sent a message, not proof the patient agreed to receive one.',
  }),
  entry({
    sourceField: 'KAYITTARIHI',
    meaning: 'Registration date',
    disposition: 'HISTORICAL_METADATA_ONLY',
    note:
      '100 % filled, spanning 2016-2026. Retained as run metadata. HARD RULE: do NOT overwrite ' +
      'patient.createdAt (@default(now())) — createdAt means "row created in NoraMedi", and ' +
      'overwriting it would falsify that. Ten years of patient tenure has no faithful home today.',
  }),
  entry({
    sourceField: 'KAYITSAATI',
    meaning: 'Registration time',
    disposition: 'HISTORICAL_METADATA_ONLY',
    note: 'The time half of KAYITTARIHI. Same createdAt prohibition.',
  }),
  entry({
    sourceField: 'KAYDEDEN',
    meaning: 'Recorded-by staff member',
    disposition: 'HISTORICAL_METADATA_ONLY',
    note:
      'Would need the same explicit reference contract as HASTADOKTOR, and there is no Patient ' +
      'field for a historical recorder. Retained as run metadata.',
  }),
  entry({
    sourceField: 'SILINDI',
    meaning: 'Soft-delete flag',
    disposition: 'IMPORT_AFTER_NORMALIZATION',
    destinationField: 'patient.patientStatus',
    transform: 'deleted_to_status',
    note:
      '100 % filled / 172 true. true -> patientStatus "archived". HARD RULE: the migration must ' +
      'NOT write deletedAt — patient soft-delete in this product IS patientStatus="archived", and ' +
      'deletedAt is a phantom column written by nothing. Archived rows do not consume plan quota.',
  }),
  entry({
    sourceField: 'DOSYAVAR',
    meaning: 'Has a physical file',
    disposition: 'IGNORE_VENDOR_INTERNAL',
    note: 'Vendor bookkeeping. Valuable only as a D-13 physical-inventory signal, not as patient data.',
  }),
  entry({
    sourceField: 'CHECKBOX',
    meaning: 'Unlabelled checkbox',
    disposition: 'IGNORE_VENDOR_INTERNAL',
    note:
      'An unlabelled vendor flag. ESCALATION RULE: if profiling ever shows consent-like semantics, ' +
      'it moves to BLOCKED_LEGAL_DECISION — never to a consent field.',
  }),
  entry({
    sourceField: 'HESAP_KODU',
    meaning: 'Ledger account code',
    disposition: 'IGNORE_VENDOR_INTERNAL',
    note: 'D-10: no ledger model exists in the product to receive an account code.',
  }),
  entry({
    sourceField: 'UST_HESAP_KODU',
    meaning: 'Parent ledger account code',
    disposition: 'IGNORE_VENDOR_INTERNAL',
    note: 'D-10: as HESAP_KODU.',
  }),
  entry({
    sourceField: 'DOSYANO',
    meaning: 'Patient chart / file number',
    disposition: 'IMPORT_AFTER_SCHEMA_FIELD',
    destinationField: 'patient.chartNumber',
    transform: 'chart_number',
    note:
      'C-15. 98.84 % filled (14,718/14,890), 99.88 % distinct among filled (14,701/14,718); only ' +
      '17 duplicate pairs (34 rows). Clinic-facing, not vendor-internal (C-6) — the number ' +
      'reception quotes and that is written on every paper chart. patient.chartNumber now exists. ' +
      'NOT unique: duplicates raise a warning for manual reconciliation and are never silently ' +
      'overwritten.',
  }),
  entry({
    sourceField: 'SUBEDOSYANO',
    meaning: 'Branch file number',
    disposition: 'BLOCKED_NO_DESTINATION',
    note:
      'G-E6. patient.chartNumber is singular and already claimed by DOSYANO. Two chart numbers ' +
      'cannot occupy one field without one silently winning.',
  }),
  entry({
    sourceField: 'ALTDOSYANO',
    meaning: 'Sub-file number',
    disposition: 'BLOCKED_NO_DESTINATION',
    note: 'G-E6. Same single-chartNumber constraint as SUBEDOSYANO.',
  }),
  entry({
    sourceField: 'ULKEGIRISTARIHI',
    meaning: 'Country entry date',
    disposition: 'BLOCKED_NO_DESTINATION',
    note: 'G-E10. Health-tourism data with no destination. Fill unmeasured.',
  }),
  entry({
    sourceField: 'ULKECIKISTARIHI',
    meaning: 'Country exit date',
    disposition: 'BLOCKED_NO_DESTINATION',
    note: 'G-E10. Health-tourism data with no destination. Fill unmeasured.',
  }),
  entry({
    sourceField: 'GELDIGIULKE',
    meaning: 'Country of origin',
    disposition: 'BLOCKED_NO_DESTINATION',
    note:
      'G-E10. HARD RULE: patient.country is RESIDENCE and is already claimed by ULKE. Writing ' +
      'origin there would silently redefine every existing country value.',
  }),
  entry({
    sourceField: 'TURIZM',
    meaning: 'Health-tourism flag',
    disposition: 'BLOCKED_NO_DESTINATION',
    note: 'G-E10 — the cheapest health-tourism gap to close, but no destination exists today.',
  }),
  entry({
    sourceField: 'RESIMUZANTI',
    meaning: 'Patient photo file extension',
    disposition: 'IGNORE_VENDOR_INTERNAL',
    note: 'A filename fragment for images that are not in this export. Useless without the binaries.',
  }),
  entry({
    sourceField: 'HASTARENGI',
    meaning: 'Vendor UI row colour',
    disposition: 'IGNORE_VENDOR_INTERNAL',
    note: 'Pure presentation state of the vendor application. Carries no clinical or business meaning.',
  }),
  entry({
    sourceField: 'EK_ACIKLAMA',
    meaning: 'Additional free-text description',
    disposition: 'MANUAL_REVIEW',
    note:
      'patient.notes exists but the SEMANTIC FIT IS UNCONFIRMED and the content is presumed KVKK ' +
      'Art. 6 special-category. Must be profiled first: clinical content -> BLOCKED_LEGAL_DECISION, ' +
      'administrative content -> IMPORT_AFTER_NORMALIZATION. Guessing either way is unacceptable, ' +
      'so it stays MANUAL_REVIEW with no destination.',
  }),
  entry({
    sourceField: 'YAKINLIKKODU',
    meaning: 'Relationship / kinship code',
    disposition: 'BLOCKED_NO_DESTINATION',
    note:
      'C-11, the column that closes C-1 — the genuinely missing 91st name, at physical position 12 ' +
      'between SOSYAL_GUVENCE_KURUMU and DOSYANO, omitted from every prior transcription of this ' +
      'matrix. 0.00 % filled (0/14,890), so no first-customer risk. If a family/household key is ' +
      'ever needed, THIS is the column to re-profile — not AILEGURUBU, whose family semantics were ' +
      'measured and refuted (C-16).',
  }),
];

// ---------------------------------------------------------------------------
// Module-level integrity assertions.
//
// These run at import time and throw. A matrix that has silently lost or
// duplicated a column is worse than a missing module: the run would proceed and
// map 90 columns while a reviewer believed 91 were dispositioned.
// ---------------------------------------------------------------------------

/** The accepted matrix size. §5: "All 91 columns, individually dispositioned." */
export const FIRST_CUSTOMER_MATRIX_SIZE = 91;

if (FIRST_CUSTOMER_MATRIX.length !== FIRST_CUSTOMER_MATRIX_SIZE) {
  throw new Error(
    `firstCustomerMatrix: expected ${FIRST_CUSTOMER_MATRIX_SIZE} entries, found ${FIRST_CUSTOMER_MATRIX.length}`,
  );
}

const byField = new Map<string, MatrixEntry>();
for (const e of FIRST_CUSTOMER_MATRIX) {
  if (byField.has(e.sourceField)) {
    throw new Error(`firstCustomerMatrix: duplicate sourceField "${e.sourceField}"`);
  }
  byField.set(e.sourceField, e);
}

// Every destination named by the matrix must exist in the catalog, and every
// transform must be one the destination actually allows. Catching this at
// import time turns a mapping typo into a startup failure instead of a
// mid-migration MAPPING_TYPE_INCOMPATIBLE for 14,890 rows.
for (const e of FIRST_CUSTOMER_MATRIX) {
  if (e.destinationField === null) {
    if (e.transform !== null) {
      throw new Error(`firstCustomerMatrix: "${e.sourceField}" has a transform but no destination`);
    }
    continue;
  }
  const dest = getDestinationField(e.destinationField);
  if (!dest) {
    throw new Error(
      `firstCustomerMatrix: "${e.sourceField}" names unknown destination "${e.destinationField}"`,
    );
  }
  if (e.transform === null || !dest.allowedTransforms.includes(e.transform)) {
    throw new Error(
      `firstCustomerMatrix: "${e.sourceField}" transform "${String(e.transform)}" is not allowed by "${e.destinationField}"`,
    );
  }
  if (e.composeOrder !== undefined && !dest.allowsComposition) {
    throw new Error(
      `firstCustomerMatrix: "${e.sourceField}" sets composeOrder on non-composable "${e.destinationField}"`,
    );
  }
}

// A destination used more than once must be composable, and its composeOrders
// must be unique — the same silent-collision guard validateMapping applies to
// operator edits, applied here to the shipped profile itself.
{
  const seen = new Map<string, number[]>();
  for (const e of FIRST_CUSTOMER_MATRIX) {
    if (e.destinationField === null) continue;
    const orders = seen.get(e.destinationField) ?? [];
    orders.push(e.composeOrder ?? -1);
    seen.set(e.destinationField, orders);
  }
  for (const [key, orders] of seen) {
    if (orders.length <= 1) continue;
    const dest = getDestinationField(key);
    if (!dest?.allowsComposition) {
      throw new Error(`firstCustomerMatrix: ${orders.length} columns collide on "${key}"`);
    }
    if (new Set(orders).size !== orders.length || orders.includes(-1)) {
      throw new Error(`firstCustomerMatrix: composition on "${key}" has duplicate/missing order`);
    }
  }
}

/** Byte-exact lookup. The key is the vendor header exactly as exported. */
export const FIRST_CUSTOMER_MATRIX_BY_FIELD: ReadonlyMap<string, MatrixEntry> = byField;

/**
 * Count of each disposition. Must total 91. Compare with §5.1 using the delta
 * table in this file's header comment.
 */
export function matrixDecisionCounts(): Record<MatrixDisposition, number> {
  const counts: Record<MatrixDisposition, number> = {
    IMPORT_DIRECT: 0,
    IMPORT_AFTER_NORMALIZATION: 0,
    IMPORT_AFTER_REFERENCE_MAPPING: 0,
    IMPORT_AFTER_SCHEMA_FIELD: 0,
    HISTORICAL_METADATA_ONLY: 0,
    MANUAL_REVIEW: 0,
    IMPORT_AFTER_SENSITIVE_REVIEW: 0,
    SENSITIVE_REVIEW_NO_DESTINATION: 0,
    IGNORE_VENDOR_INTERNAL: 0,
    IGNORE_SUMMARY_NOT_TRANSACTION: 0,
    BLOCKED_LEGAL_DECISION: 0,
    BLOCKED_NO_DESTINATION: 0,
  };
  for (const e of FIRST_CUSTOMER_MATRIX) {
    counts[e.disposition] += 1;
  }
  return counts;
}

/** Destination catalog keys this profile actually writes to, for reporting. */
export function matrixMappedDestinations(): string[] {
  const used = new Set<string>();
  for (const e of FIRST_CUSTOMER_MATRIX) {
    if (e.destinationField !== null) used.add(e.destinationField);
  }
  return DESTINATION_FIELDS.filter((d) => used.has(d.key)).map((d) => d.key);
}

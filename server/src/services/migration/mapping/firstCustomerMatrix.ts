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
 *   HISTORICAL_METADATA_ONLY               4              3          -1   (R9)
 *   MANUAL_REVIEW                          2              6          +4   (R9)
 *   IGNORE_VENDOR_INTERNAL                12             13          +1
 *   IGNORE_SUMMARY_NOT_TRANSACTION        16             16           0
 *   BLOCKED_LEGAL_DECISION                 5              2          -3
 *   BLOCKED_NO_DESTINATION                40             32          -8   (R9)
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
 * ---------------------------------------------------------------------------
 * R9 CORRECTION (F3-DATA-MIG-TODAY-001-R9-DATA-LOSS-GATE)
 * ---------------------------------------------------------------------------
 * THIS FILE IS A RECOMMENDATION, NOT A DECISION. Everything encoded here was
 * derived from the accepted decision package BEFORE any customer workbook was
 * uploaded. R7/R8's data-loss accounting treated a disposition of IGNORE /
 * BLOCKED / BLOCKED_LEGAL_DECISION reached from this table as an "explicit
 * exclusion" and therefore as fully accounted for. It is not: nobody chose it.
 * Only a Platform Admin, on a specific run, against measured fill counts, can
 * decide that a populated column will not be migrated. See dataLossGate.ts.
 *
 * Four columns are RECLASSIFIED here because a system-recommended silent drop
 * was the wrong disposition once their MEASURED fill was taken seriously
 * (docs §5 FILL column, R3 re-profiling; transcribed in
 * firstCustomerMeasuredFill.ts):
 *
 *   EVTELEFONU   BLOCKED_NO_DESTINATION   -> MANUAL_REVIEW    45 rows filled
 *   ISTELEFONU   BLOCKED_NO_DESTINATION   -> MANUAL_REVIEW   164 rows filled
 *   ILCE         BLOCKED_NO_DESTINATION   -> MANUAL_REVIEW    ~13 rows filled
 *   KVKKILKKODU  HISTORICAL_METADATA_ONLY -> MANUAL_REVIEW  4,750 rows filled
 *
 * The first three are clinic-operational PII with no destination in the
 * product. "No destination exists" is a fact about NoraMedi, never a finding
 * that the customer's data is worthless — so they become unanswered questions
 * (MANUAL_REVIEW, which blocks the run) instead of silent drops. No destination
 * was invented for them: guessing beats dropping only until the guess is wrong.
 *
 * KVKKILKKODU is the serious one. It was an IGNORE carrying 4,750 rows of
 * consent-ADJACENT evidence, and §3.3 #5 of the decision package says it may be
 * a key into a consent-form archive — potentially the only lawful route to a
 * `granted` state for these patients. It must not be fabricated into consent
 * and must not be discarded; it is a program-owner question.
 *
 * The OTHER measured-meaningful IGNORE columns (SUBE_ID, AILEGURUBU,
 * TEDAVIDURUMU, RISK_TUTARI, KAYITTARIHI) are DELIBERATELY left as IGNORE.
 * Each has a real evidential basis for exclusion — 1 distinct branch value; the
 * C-16 refutation of the family-key hypothesis; 3 and 2 rows of summary data
 * with no transaction history behind them; a registration date with no faithful
 * destination. That basis makes exclusion the right RECOMMENDATION, and the
 * gate still requires an operator to confirm each one before Execute, so
 * nothing is dropped without a named human deciding it.
 *
 * Rolled-up buckets encoded here: IMPORT 15 · HISTORICAL 3 · IGNORE 28 ·
 * BLOCKED 34 · MANUAL_REVIEW 6 · SENSITIVE_REVIEW 4  =  91.
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
  /**
   * F3-DATA-MIG-TODAY-001-R10. CONTROLLED LEGACY SOURCE PRESERVATION.
   *
   * The column carries MEASURED, MEANINGFUL data and has no canonical
   * destination in the product, so the only two options R9 had were "invent a
   * Patient field" or "drop it". This is the third: keep the value verbatim on
   * MigrationPreservedSourceValue with full provenance, as EVIDENCE of what the
   * old system held - never as current clinical truth, and never readable by
   * any clinical, messaging, billing or patient-matching code path.
   *
   * PROPOSED, NOT APPLIED. It resolves to AUTO_REVIEW, so a Platform Admin
   * still affirmatively accepts each one (individually, or in bulk via
   * accept-auto). Preservation writes real PII into a new table; that is a
   * decision with privacy weight, not a default the system may take silently.
   * What it is NOT is a data-loss risk: accepting it loses nothing, and the
   * operator remains free to exclude the column instead.
   *
   * NEVER for a consent column. Consent columns are BLOCKED_LEGAL_DECISION and
   * validateMapping Rule 4 forbids them carrying ANY destination, this one
   * included. Preservation is about columns with no home, not about lawful
   * basis.
   */
  | 'PRESERVE_LEGACY_SOURCE'
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
    // A destination IS proposed, so this is not MANUAL_REQUIRED; but it is not
    // applied without a human, so it is not AUTO_CONFIDENT either. AUTO_REVIEW
    // is exactly that state, and accept-auto can promote it in bulk.
    case 'PRESERVE_LEGACY_SOURCE':
      return 'AUTO_REVIEW';
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
    // The proposal comes from this reviewed customer profile, exactly like an
    // import proposal does. What differs is the destination, not the evidence.
    case 'PRESERVE_LEGACY_SOURCE':
      return 'FIRST_CUSTOMER_MATRIX';
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
    // High confidence in the DESTINATION - preservation is always a valid
    // place to put a value with no canonical home, and unlike a field guess it
    // cannot be semantically wrong. The operator gate is the AUTO_REVIEW state,
    // not a low score, so scoring this low would misreport certainty.
    case 'PRESERVE_LEGACY_SOURCE':
      return 90;
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
    meaning: 'Display name (derived)',
    disposition: 'PRESERVE_LEGACY_SOURCE',
    destinationField: 'legacy.preservedSourceValue',
    transform: 'preserve_source_value',
    note:
      'F3-DATA-MIG-TODAY-001-R10. 14,890 filled rows (100 %) MEASURED by a real Analyze pass ' +
      'over the accepted workbook (sha256 f08c0019...), not transcribed. R9 recorded UNKNOWN. ' +
      'Profiling also settled what it IS: 100 % of values CONTAIN the patient\'s own ADI, and ' +
      'the word-count histogram is 2 words (13,161) or 3 (1,714). It is a derived "Ad Soyad" ' +
      'display string, NOT a title or honorific - so there was never an honorific field to ' +
      'build. It duplicates data already imported into firstName/lastName and adds no new fact, ' +
      'but 14,890 rows may not be dropped on a system recommendation. Preserved verbatim on ' +
      'MigrationPreservedSourceValue with full provenance (run, vendor system, source column, ' +
      'source row). EVIDENCE of what the old system held, never current clinical truth: no ' +
      'clinical, messaging, billing or patient-matching code path may read it. Proposed, not ' +
      'applied - AUTO_REVIEW, so a Platform Admin still accepts it. An operator who judges the ' +
      'duplication not worth keeping may exclude it instead - that is now an informed choice ' +
      'rather than a silent one.',
  }),
  entry({
    sourceField: 'BABAADI',
    meaning: 'Father\'s name',
    disposition: 'PRESERVE_LEGACY_SOURCE',
    destinationField: 'legacy.preservedSourceValue',
    transform: 'preserve_source_value',
    note:
      'F3-DATA-MIG-TODAY-001-R10. 18 filled rows MEASURED by a real Analyze pass over the ' +
      'accepted workbook (sha256 f08c0019...), not transcribed. Identical treatment and ' +
      'identical third-party-PII reasoning as ANNEADI. Preserved verbatim on ' +
      'MigrationPreservedSourceValue with full provenance (run, vendor system, source column, ' +
      'source row). EVIDENCE of what the old system held, never current clinical truth: no ' +
      'clinical, messaging, billing or patient-matching code path may read it. Proposed, not ' +
      'applied - AUTO_REVIEW, so a Platform Admin still accepts it.',
  }),
  entry({
    sourceField: 'ANNEADI',
    meaning: 'Mother\'s name',
    disposition: 'PRESERVE_LEGACY_SOURCE',
    destinationField: 'legacy.preservedSourceValue',
    transform: 'preserve_source_value',
    note:
      'F3-DATA-MIG-TODAY-001-R10. 25 filled rows MEASURED by a real Analyze pass over the ' +
      'accepted workbook (sha256 f08c0019...), not transcribed. R9 recorded UNKNOWN. G-E12 ' +
      'stands: this is THIRD-PARTY PII and must never be diverted into a patient name or note ' +
      'field. Preservation is not that divergence - the value stays labelled as the vendor ' +
      'column it came from, is covered by patient anonymization (hard delete) and data ' +
      'retention, and is never presented as a fact about the patient. Preserved verbatim on ' +
      'MigrationPreservedSourceValue with full provenance (run, vendor system, source column, ' +
      'source row). EVIDENCE of what the old system held, never current clinical truth: no ' +
      'clinical, messaging, billing or patient-matching code path may read it. Proposed, not ' +
      'applied - AUTO_REVIEW, so a Platform Admin still accepts it.',
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
    disposition: 'PRESERVE_LEGACY_SOURCE',
    destinationField: 'legacy.preservedSourceValue',
    transform: 'preserve_source_value',
    note:
      'F3-DATA-MIG-TODAY-001-R10. 57 filled rows MEASURED by a real Analyze pass over the ' +
      'accepted workbook (sha256 f08c0019...), not transcribed. (2 distinct: married / single). ' +
      'R9 recorded UNKNOWN. G-E15 stands: there is no destination and no consumer, so no field ' +
      'is being built for 57 rows. Preserved verbatim on MigrationPreservedSourceValue with ' +
      'full provenance (run, vendor system, source column, source row). EVIDENCE of what the ' +
      'old system held, never current clinical truth: no clinical, messaging, billing or ' +
      'patient-matching code path may read it. Proposed, not applied - AUTO_REVIEW, so a ' +
      'Platform Admin still accepts it.',
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
      'F3-DATA-MIG-TODAY-001-R10. CORRECTS A MATERIALLY WRONG FIGURE. R9 recorded this column ' +
      'as 0 % filled, transcribed from the decision package. It is in fact 14,890/14,890 ' +
      '(100.00 %) filled, MEASURED by a real Analyze pass over the accepted workbook (sha256 ' +
      'f08c0019...). - the single worst transcription error the hand-maintained evidence table ' +
      'carried, off by every row in the file. 3 distinct vendor country codes, one of them ' +
      'dominant (14,884 rows). The mapping to patient.country was already correct and is ' +
      'unchanged; what changes is that it now carries real data for every patient instead of ' +
      'being believed empty. Values are vendor CODES, not country names, so the operator should ' +
      'confirm the code-to-country reading before accepting.',
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
    disposition: 'IMPORT_AFTER_SCHEMA_FIELD',
    destinationField: 'patient.contactPoint.home',
    transform: 'phone_tr',
    note:
      'F3-DATA-MIG-TODAY-001-R10. 50 filled rows MEASURED by a real Analyze pass over the ' +
      'accepted workbook (sha256 f08c0019...), not transcribed. (R9 recorded 45; the ' +
      'transcription had drifted.) 15 of those patients have NO mobile number at all, so for ' +
      'them this is the clinic\'s only contact route. R9 had nowhere to put it because Patient ' +
      'has a single phone field, already claimed by CEPTELEFONU. R10 created ' +
      'PatientContactPoint. HARD RULE, unchanged and now structurally enforced by having a ' +
      'correct destination: never divert into PatientEmergencyContact.phone - that would ' +
      'fabricate a named third party and, through isLegalDecisionMaker, a clinical ' +
      'decision-making authority nobody asserted. patient.phone is never touched by this ' +
      'mapping.',
  }),
  entry({
    sourceField: 'ISTELEFONU',
    meaning: 'Work phone',
    disposition: 'IMPORT_AFTER_SCHEMA_FIELD',
    destinationField: 'patient.contactPoint.work',
    transform: 'phone_tr',
    note:
      'F3-DATA-MIG-TODAY-001-R10. 166 filled rows MEASURED by a real Analyze pass over the ' +
      'accepted workbook (sha256 f08c0019...), not transcribed. (R9 recorded 164.) 10 of those ' +
      'patients have no mobile number. Same architecture and the same hard rule as EVTELEFONU: ' +
      'writes a PatientContactPoint of type "work", never patient.phone, never an emergency ' +
      'contact.',
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
    disposition: 'PRESERVE_LEGACY_SOURCE',
    destinationField: 'legacy.preservedSourceValue',
    transform: 'preserve_source_value',
    note:
      'F3-DATA-MIG-TODAY-001-R10. 96 filled rows MEASURED by a real Analyze pass over the ' +
      'accepted workbook (sha256 f08c0019...), not transcribed. R9 recorded UNKNOWN. The ' +
      'accepted recommendation not to build a fax field stands - a fax number is not a ' +
      'messaging channel this product supports - but "we will not build a field" is not a ' +
      'reason to discard 96 real contact values. Preserved verbatim on ' +
      'MigrationPreservedSourceValue with full provenance (run, vendor system, source column, ' +
      'source row). EVIDENCE of what the old system held, never current clinical truth: no ' +
      'clinical, messaging, billing or patient-matching code path may read it. Proposed, not ' +
      'applied - AUTO_REVIEW, so a Platform Admin still accepts it.',
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
    meaning: 'District (ilce)',
    disposition: 'IMPORT_AFTER_SCHEMA_FIELD',
    destinationField: 'patient.district',
    transform: 'trim',
    note:
      'F3-DATA-MIG-TODAY-001-R10. 13 filled rows MEASURED by a real Analyze pass over the ' +
      'accepted workbook (sha256 f08c0019...), not transcribed. 9 distinct districts. R9 had to ' +
      'hold this at MANUAL_REVIEW with the note "No district field exists, so a human decides ' +
      'whether that matters; the system may not decide it by omission." R10 created the field: ' +
      'Patient.district (additive, nullable). Distinct from patient.city, which is the PROVINCE ' +
      '(il) and is claimed by source IL. Still NOT folded into patient.address - composition ' +
      'order would then depend on fill rate and break rerun stability.',
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
      'F3-DATA-MIG-TODAY-001-R10. 1 filled row, and its value is "Bilinmiyor" - Turkish for ' +
      '"Unknown". MEASURED by a real Analyze pass over the accepted workbook (sha256 ' +
      'f08c0019...). So this export contains NO blood-group data at all: the single populated ' +
      'cell records the absence of a blood group. KVKK Art. 6 special-category review is still ' +
      'required before accepting the destination, and the R8 decision to create ' +
      'Patient.bloodGroup rather than fold this into notes still stands for future customers - ' +
      'but for THIS customer the reviewer should know that approving it imports exactly zero ' +
      'blood groups. Rh is never inferred.',
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
    meaning: 'Treatment status code',
    disposition: 'PRESERVE_LEGACY_SOURCE',
    destinationField: 'legacy.preservedSourceValue',
    transform: 'preserve_source_value',
    note:
      'F3-DATA-MIG-TODAY-001-R10. 3 filled rows (3 distinct codes) MEASURED by a real Analyze ' +
      'pass over the accepted workbook (sha256 f08c0019...), not transcribed. Still evidence ' +
      'that this export carries NO treatment history, and still not importable as a treatment ' +
      'fact. 3 rows kept rather than dropped. Preserved verbatim on ' +
      'MigrationPreservedSourceValue with full provenance (run, vendor system, source column, ' +
      'source row). EVIDENCE of what the old system held, never current clinical truth: no ' +
      'clinical, messaging, billing or patient-matching code path may read it. Proposed, not ' +
      'applied - AUTO_REVIEW, so a Platform Admin still accepts it.',
  }),
  entry({
    sourceField: 'SUBE_ID',
    meaning: 'Vendor branch id',
    disposition: 'IGNORE_VENDOR_INTERNAL',
    note:
      'F3-DATA-MIG-TODAY-001-R10. 9,083 filled rows (61.00 %) but exactly ONE distinct value, ' +
      'the literal string "none". MEASURED by a real Analyze pass over the accepted workbook ' +
      '(sha256 f08c0019...). This also CLOSES the standing question of whether SUBE_ID branch ' +
      'semantics needed reconciling against the target clinic: there are no branch semantics in ' +
      'this export to reconcile. The target clinic remains operator-selected and ' +
      'server-validated, as it always was. It is filled but CONSTANT: every filled row carries ' +
      'the SAME value, so importing it would add a constant to thousands of patient records and ' +
      'distinguish none of them. That is why excluding it loses no information - and the ' +
      'operator can now confirm that from evidence instead of taking it on trust. Confirmation ' +
      'is still required; the system does not get to decide this alone.',
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
    meaning: 'Family group code (= HASTA_ID)',
    disposition: 'IGNORE_VENDOR_INTERNAL',
    note:
      'F3-DATA-MIG-TODAY-001-R10. 14,890 filled rows (100 %), 14,890 distinct - and profiling ' +
      'settled what that means: the value is IDENTICAL TO HASTA_ID on all 14,890 rows. MEASURED ' +
      'by a real Analyze pass over the accepted workbook (sha256 f08c0019...). So it is not a ' +
      'family/household key at all (C-16 refuted G-E20 on distinctness alone; this proves the ' +
      'stronger statement). Every patient is their own group, and the column carries a copy of ' +
      'the primary key that is ALREADY imported as provenance.sourceId. Excluding it therefore ' +
      'discards no information whatsoever - the same values are preserved, under their real ' +
      'name, by the provenance mapping. Operator confirmation is still required.',
  }),
  entry({
    sourceField: 'UCRETTARIFESI',
    meaning: 'Fee tariff code',
    disposition: 'PRESERVE_LEGACY_SOURCE',
    destinationField: 'legacy.preservedSourceValue',
    transform: 'preserve_source_value',
    note:
      'F3-DATA-MIG-TODAY-001-R10. 1 filled row MEASURED by a real Analyze pass over the ' +
      'accepted workbook (sha256 f08c0019...), not transcribed. G-E21/D-17 model mismatch ' +
      'stands - there is no tariff entity to point at. One row, kept rather than dropped. ' +
      'Preserved verbatim on MigrationPreservedSourceValue with full provenance (run, vendor ' +
      'system, source column, source row). EVIDENCE of what the old system held, never current ' +
      'clinical truth: no clinical, messaging, billing or patient-matching code path may read ' +
      'it. Proposed, not applied - AUTO_REVIEW, so a Platform Admin still accepts it.',
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
    disposition: 'PRESERVE_LEGACY_SOURCE',
    destinationField: 'legacy.preservedSourceValue',
    transform: 'preserve_source_value',
    note:
      'F3-DATA-MIG-TODAY-001-R10. 2 filled rows MEASURED by a real Analyze pass over the ' +
      'accepted workbook (sha256 f08c0019...), not transcribed. R9 recorded UNKNOWN. G-E23 ' +
      'stands: writing this into an insurance model would FABRICATE a financial record with no ' +
      'transactions behind it. Preservation asserts nothing financial. Preserved verbatim on ' +
      'MigrationPreservedSourceValue with full provenance (run, vendor system, source column, ' +
      'source row). EVIDENCE of what the old system held, never current clinical truth: no ' +
      'clinical, messaging, billing or patient-matching code path may read it. Proposed, not ' +
      'applied - AUTO_REVIEW, so a Platform Admin still accepts it.',
  }),
  entry({
    sourceField: 'RISK_TUTARI',
    meaning: 'Outstanding balance',
    disposition: 'IGNORE_SUMMARY_NOT_TRANSACTION',
    note:
      'F3-DATA-MIG-TODAY-001-R10. 2 filled rows and exactly ONE distinct value, "0". MEASURED ' +
      'by a real Analyze pass over the accepted workbook (sha256 f08c0019...). So there is no ' +
      'outstanding-balance data in this export at all, and the standing concern about importing ' +
      'a derived debt figure is moot. The summary-not-transaction rule stands regardless. It is ' +
      'filled but CONSTANT: every filled row carries the SAME value, so importing it would add ' +
      'a constant to thousands of patient records and distinguish none of them. That is why ' +
      'excluding it loses no information - and the operator can now confirm that from evidence ' +
      'instead of taking it on trust. Confirmation is still required; the system does not get ' +
      'to decide this alone.',
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
    note:
      'F3-DATA-MIG-TODAY-001-R10. 1 filled row, 1 distinct value. MEASURED by a real Analyze ' +
      'pass over the accepted workbook (sha256 f08c0019...). A due date derived from payment ' +
      'transactions this export does not contain. It is filled but CONSTANT: every filled row ' +
      'carries the SAME value, so importing it would add a constant to thousands of patient ' +
      'records and distinguish none of them. That is why excluding it loses no information - ' +
      'and the operator can now confirm that from evidence instead of taking it on trust. ' +
      'Confirmation is still required; the system does not get to decide this alone.',
  }),
  entry({
    sourceField: 'SONODEMETARIHI',
    meaning: 'Last payment date',
    disposition: 'PRESERVE_LEGACY_SOURCE',
    destinationField: 'legacy.preservedSourceValue',
    transform: 'preserve_source_value',
    note:
      'F3-DATA-MIG-TODAY-001-R10. 202 filled rows (13 distinct dates) MEASURED by a real ' +
      'Analyze pass over the accepted workbook (sha256 f08c0019...), not transcribed. R9 ' +
      'recorded UNKNOWN. Preserved as evidence; no Payment row is created, so no unbacked ' +
      'financial fact is asserted. Preserved verbatim on MigrationPreservedSourceValue with ' +
      'full provenance (run, vendor system, source column, source row). EVIDENCE of what the ' +
      'old system held, never current clinical truth: no clinical, messaging, billing or ' +
      'patient-matching code path may read it. Proposed, not applied - AUTO_REVIEW, so a ' +
      'Platform Admin still accepts it.',
  }),
  entry({
    sourceField: 'ODEMENOTU',
    meaning: 'Payment note',
    disposition: 'PRESERVE_LEGACY_SOURCE',
    destinationField: 'legacy.preservedSourceValue',
    transform: 'preserve_source_value',
    note:
      'F3-DATA-MIG-TODAY-001-R10. 3 filled rows MEASURED by a real Analyze pass over the ' +
      'accepted workbook (sha256 f08c0019...), not transcribed. HARD RULE, unchanged: must NOT ' +
      'be diverted into patient.notes - a payment comment is not a clinical note and would ' +
      'corrupt a special-category field. Preservation keeps it labelled as the payment column ' +
      'it is. Preserved verbatim on MigrationPreservedSourceValue with full provenance (run, ' +
      'vendor system, source column, source row). EVIDENCE of what the old system held, never ' +
      'current clinical truth: no clinical, messaging, billing or patient-matching code path ' +
      'may read it. Proposed, not applied - AUTO_REVIEW, so a Platform Admin still accepts it.',
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
    disposition: 'PRESERVE_LEGACY_SOURCE',
    destinationField: 'legacy.preservedSourceValue',
    transform: 'preserve_source_value',
    note:
      'F3-DATA-MIG-TODAY-001-R10. 331 filled rows MEASURED by a real Analyze pass over the ' +
      'accepted workbook (sha256 f08c0019...), not transcribed. R9 recorded UNKNOWN. Same ' +
      'reasoning as SONRANDEVUTARIHI: preserved as evidence, never materialised as a treatment ' +
      'record, so it can never mass-fabricate recall candidates. Preserved verbatim on ' +
      'MigrationPreservedSourceValue with full provenance (run, vendor system, source column, ' +
      'source row). EVIDENCE of what the old system held, never current clinical truth: no ' +
      'clinical, messaging, billing or patient-matching code path may read it. Proposed, not ' +
      'applied - AUTO_REVIEW, so a Platform Admin still accepts it.',
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
    disposition: 'PRESERVE_LEGACY_SOURCE',
    destinationField: 'legacy.preservedSourceValue',
    transform: 'preserve_source_value',
    note:
      'F3-DATA-MIG-TODAY-001-R10. 13,403 filled rows (90.01 %) MEASURED by a real Analyze pass ' +
      'over the accepted workbook (sha256 f08c0019...), not transcribed. R9 recorded UNKNOWN. ' +
      'The IGNORE_SUMMARY_NOT_TRANSACTION reasoning stands as far as it goes: this is a DERIVED ' +
      'summary with no appointment rows behind it, and materialising it as an appointment would ' +
      'fabricate history. But preservation materialises nothing - the value is evidence, not an ' +
      'Appointment - so the recall/availability fabrication risk does not arise. 13,403 rows of ' +
      'genuine operational history is far too much to discard on that technicality. Preserved ' +
      'verbatim on MigrationPreservedSourceValue with full provenance (run, vendor system, ' +
      'source column, source row). EVIDENCE of what the old system held, never current clinical ' +
      'truth: no clinical, messaging, billing or patient-matching code path may read it. ' +
      'Proposed, not applied - AUTO_REVIEW, so a Platform Admin still accepts it.',
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
    meaning: 'Vendor reminder flag',
    disposition: 'PRESERVE_LEGACY_SOURCE',
    destinationField: 'legacy.preservedSourceValue',
    transform: 'preserve_source_value',
    note:
      'F3-DATA-MIG-TODAY-001-R10. 14,890 filled rows (100 %), 27 true, MEASURED by a real ' +
      'Analyze pass over the accepted workbook (sha256 f08c0019...), not transcribed. R9 ' +
      'recorded UNKNOWN. HARD RULE, unchanged and absolutely load-bearing: this must NEVER map ' +
      'to any consent field despite being a messaging-adjacent flag. A vendor UI toggle is not ' +
      'lawful-basis evidence under KVKK. Preservation is the opposite of that mistake - it ' +
      'records the vendor flag AS a vendor flag, with the vendor column name attached, and ' +
      'grants nothing. Preserved verbatim on MigrationPreservedSourceValue with full provenance ' +
      '(run, vendor system, source column, source row). EVIDENCE of what the old system held, ' +
      'never current clinical truth: no clinical, messaging, billing or patient-matching code ' +
      'path may read it. Proposed, not applied - AUTO_REVIEW, so a Platform Admin still accepts ' +
      'it.',
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
    meaning: 'KVKK register key (vendor)',
    disposition: 'PRESERVE_LEGACY_SOURCE',
    destinationField: 'legacy.preservedSourceValue',
    transform: 'preserve_source_value',
    note:
      'F3-DATA-MIG-TODAY-001-R10. K-4 IS NOW ANSWERED BY MEASUREMENT, and the answer is that ' +
      'this is NOT consent. 4,754 filled rows / 4,633 distinct MEASURED by a real Analyze pass ' +
      'over the accepted workbook (sha256 f08c0019...), not transcribed. Every value is a ' +
      '5-digit integer in [10023, 99971]; fill by registration year is 0 % for 2016-2021, 44 % ' +
      'in 2022 and 100 % for 2023-2026; and it co-occurs with MESAJOK=true on exactly ONE row. ' +
      'That is the signature of a sequential REGISTER KEY switched on mid-2022, not of a ' +
      'consent state - a consent flag would not be near-unique, would not correlate with ' +
      'registration date, and would correlate with the messaging flag. It therefore CANNOT be ' +
      'read as consent, and R9 was right to refuse to. What it plausibly keys is an external ' +
      'consent-form archive; if that archive is ever produced, the ARCHIVE is the evidence, ' +
      'never this integer. Preserved verbatim on MigrationPreservedSourceValue with full ' +
      'provenance (run, vendor system, source column, source row). EVIDENCE of what the old ' +
      'system held, never current clinical truth: no clinical, messaging, billing or ' +
      'patient-matching code path may read it. Proposed, not applied - AUTO_REVIEW, so a ' +
      'Platform Admin still accepts it. Preserving it grants NO lawful basis and creates no ' +
      'PatientCommunicationPreference: it records a vendor reference so the question stays ' +
      'answerable.',
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
    meaning: 'Vendor "messaging OK" flag',
    disposition: 'PRESERVE_LEGACY_SOURCE',
    destinationField: 'legacy.preservedSourceValue',
    transform: 'preserve_source_value',
    note:
      'F3-DATA-MIG-TODAY-001-R10. 14,153 filled rows (95.05 %) MEASURED by a real Analyze pass ' +
      'over the accepted workbook (sha256 f08c0019...), not transcribed. - and only FOUR are ' +
      'true. R9 recorded UNKNOWN, so the gate blocked on it. HARD RULE, unchanged: this must ' +
      'NEVER map to any consent field, despite the tempting name. A vendor UI toggle is not ' +
      'lawful-basis evidence, and the measurement makes the point concrete - reading it as ' +
      'consent would have granted a messaging basis for 4 patients while implying a decision ' +
      'about 14,149 others. Preservation records the flag as vendor evidence and creates no ' +
      'PatientCommunicationPreference. Preserved verbatim on MigrationPreservedSourceValue with ' +
      'full provenance (run, vendor system, source column, source row). EVIDENCE of what the ' +
      'old system held, never current clinical truth: no clinical, messaging, billing or ' +
      'patient-matching code path may read it. Proposed, not applied - AUTO_REVIEW, so a ' +
      'Platform Admin still accepts it.',
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
    meaning: 'Vendor registration date',
    disposition: 'PRESERVE_LEGACY_SOURCE',
    destinationField: 'legacy.preservedSourceValue',
    transform: 'preserve_source_value',
    note:
      'F3-DATA-MIG-TODAY-001-R10. 14,890 filled rows (100 %), 1,825 distinct dates spanning ' +
      '2016-2026, MEASURED by a real Analyze pass over the accepted workbook (sha256 ' +
      'f08c0019...), not transcribed. HARD RULE, unchanged: this must NEVER be written to ' +
      'patient.createdAt, which means "row created in NoraMedi" and would be falsified by it. ' +
      'R9 held it as HISTORICAL_METADATA_ONLY, which resolved to IGNORE - i.e. the clinic\'s ' +
      'entire 10-year registration history was a system recommendation away from being ' +
      'discarded. Preservation is what "historical metadata only" always meant, now with ' +
      'somewhere to actually put it. Preserved verbatim on MigrationPreservedSourceValue with ' +
      'full provenance (run, vendor system, source column, source row). EVIDENCE of what the ' +
      'old system held, never current clinical truth: no clinical, messaging, billing or ' +
      'patient-matching code path may read it. Proposed, not applied - AUTO_REVIEW, so a ' +
      'Platform Admin still accepts it.',
  }),
  entry({
    sourceField: 'KAYITSAATI',
    meaning: 'Vendor registration time',
    disposition: 'PRESERVE_LEGACY_SOURCE',
    destinationField: 'legacy.preservedSourceValue',
    transform: 'preserve_source_value',
    note:
      'F3-DATA-MIG-TODAY-001-R10. 14,890 filled rows (100 %) MEASURED by a real Analyze pass ' +
      'over the accepted workbook (sha256 f08c0019...), not transcribed. The time component of ' +
      'KAYITTARIHI, and preserved for the same reason and under the same createdAt prohibition. ' +
      'Preserved verbatim on MigrationPreservedSourceValue with full provenance (run, vendor ' +
      'system, source column, source row). EVIDENCE of what the old system held, never current ' +
      'clinical truth: no clinical, messaging, billing or patient-matching code path may read ' +
      'it. Proposed, not applied - AUTO_REVIEW, so a Platform Admin still accepts it.',
  }),
  entry({
    sourceField: 'KAYDEDEN',
    meaning: 'Recorded-by staff member',
    disposition: 'HISTORICAL_METADATA_ONLY',
    note:
      'F3-DATA-MIG-TODAY-001-R10. 14,890 filled rows (100 %) but exactly ONE distinct value, ' +
      '"admin". MEASURED by a real Analyze pass over the accepted workbook (sha256 ' +
      'f08c0019...). R9 recorded UNKNOWN. There is no per-user attribution in this export to ' +
      'preserve - every row was recorded by the same account - so the HASTADOKTOR-style ' +
      'reference contract this column was parked on is not needed for it. It is filled but ' +
      'CONSTANT: every filled row carries the SAME value, so importing it would add a constant ' +
      'to thousands of patient records and distinguish none of them. That is why excluding it ' +
      'loses no information - and the operator can now confirm that from evidence instead of ' +
      'taking it on trust. Confirmation is still required; the system does not get to decide ' +
      'this alone.',
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
    note:
      'F3-DATA-MIG-TODAY-001-R10. 3,051 filled rows (20.49 %) but exactly ONE distinct value, ' +
      '"false" - i.e. the flag is never true anywhere in the export. MEASURED by a real Analyze ' +
      'pass over the accepted workbook (sha256 f08c0019...). R9 recorded UNKNOWN. D-13 ' +
      'physical-file inventory signal, and the signal is uniformly negative. It is filled but ' +
      'CONSTANT: every filled row carries the SAME value, so importing it would add a constant ' +
      'to thousands of patient records and distinguish none of them. That is why excluding it ' +
      'loses no information - and the operator can now confirm that from evidence instead of ' +
      'taking it on trust. Confirmation is still required; the system does not get to decide ' +
      'this alone.',
  }),
  entry({
    sourceField: 'CHECKBOX',
    meaning: 'Unlabelled checkbox',
    disposition: 'IGNORE_VENDOR_INTERNAL',
    note:
      'F3-DATA-MIG-TODAY-001-R10. 3,500 filled rows (23.51 %) but exactly ONE distinct value, ' +
      '"Yeni" ("New"). MEASURED by a real Analyze pass over the accepted workbook (sha256 ' +
      'f08c0019...). R9 recorded UNKNOWN and flagged an ESCALATION RULE: if profiling ever ' +
      'showed consent-like semantics this must become BLOCKED_LEGAL_DECISION. Profiling has now ' +
      'run, and the value is a single non-consent status word, so the escalation does NOT fire. ' +
      'That is a measured conclusion, not an assumption. It is filled but CONSTANT: every ' +
      'filled row carries the SAME value, so importing it would add a constant to thousands of ' +
      'patient records and distinguish none of them. That is why excluding it loses no ' +
      'information - and the operator can now confirm that from evidence instead of taking it ' +
      'on trust. Confirmation is still required; the system does not get to decide this alone.',
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
    note:
      'F3-DATA-MIG-TODAY-001-R10. 13,985 filled rows (93.92 %) but exactly ONE distinct value, ' +
      'a single ledger account code. MEASURED by a real Analyze pass over the accepted workbook ' +
      '(sha256 f08c0019...). R9 recorded UNKNOWN. D-10 stands - there is no ledger model - and ' +
      'the measurement shows there is also nothing to model. It is filled but CONSTANT: every ' +
      'filled row carries the SAME value, so importing it would add a constant to thousands of ' +
      'patient records and distinguish none of them. That is why excluding it loses no ' +
      'information - and the operator can now confirm that from evidence instead of taking it ' +
      'on trust. Confirmation is still required; the system does not get to decide this alone.',
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
    disposition: 'PRESERVE_LEGACY_SOURCE',
    destinationField: 'legacy.preservedSourceValue',
    transform: 'preserve_source_value',
    note:
      'F3-DATA-MIG-TODAY-001-R10. 9,105 filled rows (61.15 %) MEASURED by a real Analyze pass ' +
      'over the accepted workbook (sha256 f08c0019...), not transcribed. R9 recorded UNKNOWN ' +
      'and left it BLOCKED, so 9,105 rows of a real clinic identifier were one system ' +
      'recommendation away from being dropped. Patient.chartNumber is singular and already ' +
      'claimed by DOSYANO, so there is still no canonical home. Preserved verbatim on ' +
      'MigrationPreservedSourceValue with full provenance (run, vendor system, source column, ' +
      'source row). EVIDENCE of what the old system held, never current clinical truth: no ' +
      'clinical, messaging, billing or patient-matching code path may read it. Proposed, not ' +
      'applied - AUTO_REVIEW, so a Platform Admin still accepts it.',
  }),
  entry({
    sourceField: 'ALTDOSYANO',
    meaning: 'Sub-file number',
    disposition: 'PRESERVE_LEGACY_SOURCE',
    destinationField: 'legacy.preservedSourceValue',
    transform: 'preserve_source_value',
    note:
      'F3-DATA-MIG-TODAY-001-R10. 10 filled rows MEASURED by a real Analyze pass over the ' +
      'accepted workbook (sha256 f08c0019...), not transcribed. R9 recorded UNKNOWN. Same G-E6 ' +
      'reasoning as SUBEDOSYANO: chartNumber is singular and claimed. Preserved verbatim on ' +
      'MigrationPreservedSourceValue with full provenance (run, vendor system, source column, ' +
      'source row). EVIDENCE of what the old system held, never current clinical truth: no ' +
      'clinical, messaging, billing or patient-matching code path may read it. Proposed, not ' +
      'applied - AUTO_REVIEW, so a Platform Admin still accepts it.',
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
    disposition: 'PRESERVE_LEGACY_SOURCE',
    destinationField: 'legacy.preservedSourceValue',
    transform: 'preserve_source_value',
    note:
      'F3-DATA-MIG-TODAY-001-R10. 6 filled rows (4 distinct codes) MEASURED by a real Analyze ' +
      'pass over the accepted workbook (sha256 f08c0019...), not transcribed. R9 recorded ' +
      'UNKNOWN. The health-tourism module (US-01.8) is a separate product decision and is not ' +
      'being built here; 6 rows do not justify one. Preserved verbatim on ' +
      'MigrationPreservedSourceValue with full provenance (run, vendor system, source column, ' +
      'source row). EVIDENCE of what the old system held, never current clinical truth: no ' +
      'clinical, messaging, billing or patient-matching code path may read it. Proposed, not ' +
      'applied - AUTO_REVIEW, so a Platform Admin still accepts it.',
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
    meaning: 'Additional free text',
    disposition: 'PRESERVE_LEGACY_SOURCE',
    destinationField: 'legacy.preservedSourceValue',
    transform: 'preserve_source_value',
    note:
      'F3-DATA-MIG-TODAY-001-R10. 1 filled row MEASURED by a real Analyze pass over the ' +
      'accepted workbook (sha256 f08c0019...), not transcribed. R9 recorded UNKNOWN and could ' +
      'not classify it. One row is too little to establish a semantic, so no field is being ' +
      'built and no clinical meaning is being assigned. Preserved verbatim on ' +
      'MigrationPreservedSourceValue with full provenance (run, vendor system, source column, ' +
      'source row). EVIDENCE of what the old system held, never current clinical truth: no ' +
      'clinical, messaging, billing or patient-matching code path may read it. Proposed, not ' +
      'applied - AUTO_REVIEW, so a Platform Admin still accepts it.',
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
    // R10: a destination that writes one RECORD per source column is not a
    // collision and has no composition order to check. See
    // DestinationFieldDef.allowsIndependentMultiUse and validateMapping Rule 2.
    if (dest?.allowsIndependentMultiUse) continue;
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
    PRESERVE_LEGACY_SOURCE: 0,
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

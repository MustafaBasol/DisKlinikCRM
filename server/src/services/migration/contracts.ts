/**
 * contracts.ts — F3-DATA-MIG-TODAY-001
 *
 * The vendor-neutral canonical contract for the Platform Admin clinic data
 * migration. This is the ONLY module every other migration module depends on.
 *
 * Boundary the whole feature is built around:
 *
 *   Vendor / legacy workbook  (HASTA_ID, ADI, SOYADI, CEPTELEFONU, ...)
 *          |   source adapter + mapping profile   <- the ONLY layer that knows vendor names
 *   Canonical migration contract                  <- vendor-neutral (this file)
 *          |   validation / normalization
 *   NoraMedi domain application contracts
 *
 * Vendor column names must never appear in patient, treatment or finance
 * services. They appear in exactly one place: the first-customer mapping
 * matrix (firstCustomerMatrix.ts), which is a mapping profile, not domain code.
 *
 * PRIVACY RULE FOR THIS ENTIRE SUBSYSTEM: no type in this file, and no value
 * flowing through any of these structures into a log, an audit payload, a
 * report or an API response, may carry raw PII/PHI. Errors carry CODES; counts
 * carry NUMBERS; classifications carry ENUM-LIKE STRINGS. Never a cell value.
 */

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------

/**
 * MigrationRun.status. The state machine in runState.ts is authoritative;
 * illegal transitions are rejected with MIGRATION_STATE_INVALID.
 */
export const MIGRATION_RUN_STATUSES = [
  'CREATED',
  'UPLOADED',
  'ANALYZED',
  'MAPPING_REQUIRED',
  'MAPPING_READY',
  'DRY_RUN_RUNNING',
  'DRY_RUN_COMPLETE',
  'BLOCKED',
  'READY',
  'RUNNING',
  'PARTIAL_FAILURE',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;

export type MigrationRunStatus = (typeof MIGRATION_RUN_STATUSES)[number];

/** Statuses from which no further transition is possible except a fresh run. */
export const TERMINAL_RUN_STATUSES: readonly MigrationRunStatus[] = [
  'COMPLETED',
  'FAILED',
  'CANCELLED',
];

export const MIGRATION_BATCH_STATUSES = [
  'PENDING',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'SKIPPED',
] as const;

export type MigrationBatchStatus = (typeof MIGRATION_BATCH_STATUSES)[number];

// ---------------------------------------------------------------------------
// Typed failure taxonomy
// ---------------------------------------------------------------------------

/**
 * Safe, stable, machine-readable error codes. A raw database exception string,
 * a stack trace, or any cell value must NEVER reach the client — every failure
 * surfaces as one of these plus a templated, PII-free message.
 */
export const MIGRATION_ERROR_CODES = [
  // ---- file intake ----
  'FILE_MISSING',
  'FILE_UNSUPPORTED',
  'FILE_CORRUPTED',
  'FILE_TOO_LARGE',
  'FILE_ENCRYPTED',
  'FILE_SIGNATURE_MISMATCH',
  'SHEET_INVALID',
  'SHEET_EMPTY',
  'HEADER_MISSING',
  'HEADER_DUPLICATE',
  // ---- mapping ----
  'MAPPING_REQUIRED',
  'MAPPING_INVALID',
  'MAPPING_TYPE_INCOMPATIBLE',
  'MAPPING_DESTINATION_COLLISION',
  'MAPPING_COMPOSITION_UNSUPPORTED',
  'REFERENCE_UNRESOLVED',
  'LEGAL_BLOCKED',
  // ---- row data ----
  'ROW_REQUIRED_FIELD_MISSING',
  'ROW_VALUE_INVALID',
  'IDENTITY_INVALID',
  'IDENTITY_AMBIGUOUS',
  'DUPLICATE_SOURCE_RECORD',
  'DESTINATION_CONFLICT',
  // ---- commercial ----
  'PLAN_LIMIT_EXCEEDED',
  // ---- execution ----
  'BATCH_FAILED',
  'DATABASE_ERROR',
  'EXECUTION_ALREADY_RUNNING',
  'EXECUTION_CANCELLED',
  'MIGRATION_STATE_INVALID',
  'IDENTITY_CRYPTO_NOT_CONFIGURED',
  // ---- authorization / addressing ----
  'ORGANIZATION_NOT_FOUND',
  'CLINIC_NOT_FOUND',
  'ORG_CLINIC_MISMATCH',
  'RUN_NOT_FOUND',
  'REPORT_NOT_AVAILABLE',
  'INTERNAL_ERROR',
] as const;

export type MigrationErrorCode = (typeof MIGRATION_ERROR_CODES)[number];

/**
 * The only error type the migration routes ever convert into an HTTP response.
 * `detail` is a SAFE, templated string — structural facts, counts, field names
 * and codes only. It must never contain a source cell value, a filename the
 * caller supplied verbatim, or a database exception message.
 */
export class MigrationError extends Error {
  readonly code: MigrationErrorCode;
  readonly httpStatus: number;
  readonly detail?: string;
  readonly fieldName?: string;
  readonly retryable: boolean;

  constructor(
    code: MigrationErrorCode,
    options: {
      message?: string;
      httpStatus?: number;
      detail?: string;
      fieldName?: string;
      retryable?: boolean;
    } = {},
  ) {
    super(options.message ?? code);
    this.name = 'MigrationError';
    this.code = code;
    this.httpStatus = options.httpStatus ?? defaultHttpStatusFor(code);
    this.detail = options.detail;
    this.fieldName = options.fieldName;
    this.retryable = options.retryable ?? false;
  }
}

export function defaultHttpStatusFor(code: MigrationErrorCode): number {
  switch (code) {
    case 'ORGANIZATION_NOT_FOUND':
    case 'CLINIC_NOT_FOUND':
    case 'RUN_NOT_FOUND':
    case 'REPORT_NOT_AVAILABLE':
      return 404;
    case 'ORG_CLINIC_MISMATCH':
      return 400;
    case 'FILE_TOO_LARGE':
      return 413;
    case 'PLAN_LIMIT_EXCEEDED':
      return 402;
    case 'EXECUTION_ALREADY_RUNNING':
      return 409;
    case 'MIGRATION_STATE_INVALID':
      return 409;
    case 'DATABASE_ERROR':
    case 'INTERNAL_ERROR':
    case 'IDENTITY_CRYPTO_NOT_CONFIGURED':
      return 500;
    default:
      return 400;
  }
}

/** Errors a batch retry could plausibly clear. */
export function isRetryableCode(code: MigrationErrorCode): boolean {
  return code === 'DATABASE_ERROR' || code === 'BATCH_FAILED' || code === 'INTERNAL_ERROR';
}

// ---------------------------------------------------------------------------
// Canonical source model (what the parser layer produces)
// ---------------------------------------------------------------------------

export type CanonicalCellType = 'empty' | 'string' | 'number' | 'date' | 'boolean' | 'error';

/** One parsed cell. `raw` is the typed value; it is NEVER logged. */
export interface CanonicalCell {
  type: CanonicalCellType;
  /** Trimmed string projection used by every transform. '' when empty. */
  text: string;
  numberValue?: number;
  dateValue?: Date;
  booleanValue?: boolean;
  /** Excel serial for a date cell, so date handling is auditable. */
  dateSerial?: number;
  /** Non-fatal parser observations, e.g. 'TRUNCATED', 'ERROR_CELL'. */
  warning?: string;
}

export interface CanonicalHeader {
  /** Header text EXACTLY as exported. Byte-exact — reruns re-key on this. */
  original: string;
  /** Upper-cased, whitespace/punctuation-collapsed form. Matching only. */
  normalized: string;
  /** Physical 0-based column index in the worksheet. */
  index: number;
}

export interface CanonicalRow {
  /** 1-based data-row number (worksheet header row excluded). */
  rowNumber: number;
  /** Dense, aligned with the sheet's physical column count. */
  cells: CanonicalCell[];
}

export interface CanonicalSheetMetadata {
  name: string;
  index: number;
  hidden: boolean;
  rowCount: number;
  columnCount: number;
}

export interface CanonicalWorkbookMetadata {
  /** Determined by BINARY SIGNATURE, never by extension or declared MIME. */
  format: SourceFileFormat;
  sheets: CanonicalSheetMetadata[];
  selectedSheetIndex: number;
  dateEpoch: 1900 | 1904;
  /** Structural, non-blocking observations. Codes only. */
  warnings: string[];
  parseMs: number;
}

export interface CanonicalWorkbook {
  metadata: CanonicalWorkbookMetadata;
  headers: CanonicalHeader[];
  rows: CanonicalRow[];
}

export type SourceFileFormat = 'xls' | 'xlsx';

/** What signature detection can conclude. */
export type DetectedFileKind = 'xls' | 'xlsx' | 'zip_not_xlsx' | 'unsupported' | 'corrupted';

// ---------------------------------------------------------------------------
// Aggregate column profile (safe: counts only, never sample values)
// ---------------------------------------------------------------------------

export interface SourceColumnProfile {
  index: number;
  header: string;
  /** Rows with a non-empty value. */
  filledCount: number;
  totalRows: number;
  /** filledCount / totalRows, 0..1, rounded to 4 dp. */
  fillRate: number;
  /** Distinct non-empty values. A COUNT — never the values themselves. */
  distinctCount: number;
  typeCounts: Record<CanonicalCellType, number>;
  /** Longest observed text length. A length, not a value. */
  maxLength: number;
}

// ---------------------------------------------------------------------------
// Destination catalog
// ---------------------------------------------------------------------------

export type DestinationValueType =
  | 'string'
  | 'phone'
  | 'email'
  | 'date'
  | 'enum'
  | 'identity'
  | 'provenance'
  | 'reference';

/**
 * A destination a source column may be mapped onto. This catalog is the ONLY
 * definition of what the migration is allowed to write. A destination that is
 * not in here cannot be selected in the UI and cannot be written by execution.
 */
export interface DestinationFieldDef {
  /** Canonical key, e.g. 'patient.firstName'. Stable across releases. */
  key: string;
  /** i18n-independent English label for the mapping UI. */
  label: string;
  /** Grouping for the mapping UI. */
  group: 'identity' | 'name' | 'contact' | 'address' | 'clinical' | 'operational' | 'provenance';
  type: DestinationValueType;
  required: boolean;
  /** Allowed transforms for this destination. */
  allowedTransforms: readonly TransformName[];
  /** True when several source columns may compose into it (documented rule). */
  allowsComposition: boolean;
  /** Allowed values when type === 'enum'. */
  enumValues?: readonly string[];
  /** Short reviewer-facing note rendered in the mapping UI. */
  note?: string;
}

/**
 * Named, deterministic value transforms. The mapping engine may only propose a
 * transform listed in the destination's `allowedTransforms`.
 */
export const TRANSFORM_NAMES = [
  'trim',
  'trim_collapse',
  'lower_trim',
  'phone_tr',
  'date_excel_serial',
  'gender_tr',
  'deleted_to_status',
  'compose_address',
  'chart_number',
  'identity_tckn',
  'provenance_source_id',
  'practitioner_reference',
] as const;

export type TransformName = (typeof TRANSFORM_NAMES)[number];

/**
 * THE DESTINATION CATALOG.
 *
 * Deliberately NOT present, and why (each is an accepted program decision, not
 * an oversight — see docs/program/PATIENT_FIELD_GAP_AND_IDENTITY_DECISION_PACKAGE.md):
 *
 *  - patient.notes                — KVKK Art. 6 special-category gate is
 *    unresolved for ONEMLINOT (45.70 % filled) / KONTROLNOTU / UZUNNOT /
 *    KANGURUBU. The destination exists in the schema; the blocker is purely
 *    LEGAL, which makes it more dangerous, not less. Also write-only from the
 *    UI — imported clinical text could not be rectified or erased by staff
 *    through any interface, making a KVKK request unserviceable.
 *  - patient.postalCode           — ADRES_KODU semantics (5-digit posta kodu
 *    vs 10-digit UAVT address code) remain UNRESOLVED. 0.00 % filled in this
 *    workbook, so absence of data must never be encoded as a direct mapping.
 *  - patient.communicationConsent / marketingConsent / smsOptOut / smsOptOutAt
 *                                 — consent is NEVER invented. All migrated
 *    patients arrive non-messageable. PatientCommunicationPreference is
 *    service-owned and evidence-gated; PatientCommunicationConsentEvent is
 *    append-only and must never be written by a migration.
 *  - patient.createdAt            — KAYITTARIHI is retained as run metadata
 *    only. createdAt means "row created in NoraMedi"; overwriting it would
 *    falsify that.
 *  - patient.deletedAt            — patient soft-delete is
 *    patientStatus='archived'; deletedAt is a phantom column written by
 *    nothing.
 *  - patient.isAnonymized / anonymizedAt / anonymizedById / anonymizationReason
 *  - patient.source               — enum-constrained; REFERANSI is free text
 *    that may name a THIRD PARTY. Coercing it would destroy the referrer
 *    identity and pollute a typed marketing enum.
 *  - patient.primaryClinicId      — set by no runtime path today; the
 *    organization dashboard counts by it. Deliberately left unset so this
 *    migration does not silently change what that dashboard reports. Recorded
 *    as a known consequence in the reconciliation, not papered over.
 */
export const DESTINATION_FIELDS: readonly DestinationFieldDef[] = [
  {
    key: 'provenance.sourceId',
    label: 'Source record id (provenance)',
    group: 'provenance',
    type: 'provenance',
    required: true,
    allowedTransforms: ['provenance_source_id'],
    allowsComposition: false,
    note:
      'REQUIRED. The vendor primary key (HASTA_ID). Durable cross-run identity: ' +
      'rerunning a row matches instead of creating a second patient. Never a ' +
      'patient business identifier and never shown as medical identity.',
  },
  {
    key: 'patient.firstName',
    label: 'First name',
    group: 'name',
    type: 'string',
    required: true,
    allowedTransforms: ['trim_collapse', 'trim'],
    allowsComposition: false,
  },
  {
    key: 'patient.lastName',
    label: 'Last name',
    group: 'name',
    type: 'string',
    required: true,
    allowedTransforms: ['trim_collapse', 'trim'],
    allowsComposition: false,
  },
  {
    key: 'patient.phone',
    label: 'Mobile phone',
    group: 'contact',
    type: 'phone',
    required: false,
    allowedTransforms: ['phone_tr', 'trim'],
    allowsComposition: false,
    note:
      'NEVER a dedup key. Shared family phones are a supported product ' +
      'behaviour (28.6 % of source rows share a phone) and must not merge ' +
      'patients. The dry-run reports the shared-phone impact instead.',
  },
  {
    key: 'patient.email',
    label: 'E-mail',
    group: 'contact',
    type: 'email',
    required: false,
    allowedTransforms: ['lower_trim'],
    allowsComposition: false,
    note: 'NEVER a dedup key. Invalid values are dropped with a row warning, not a row failure.',
  },
  {
    key: 'patient.dateOfBirth',
    label: 'Date of birth',
    group: 'identity',
    type: 'date',
    required: false,
    allowedTransforms: ['date_excel_serial'],
    allowsComposition: false,
    note: 'UTC-noon anchored to avoid timezone drift. Future-dated values are rejected per the write schema.',
  },
  {
    key: 'patient.gender',
    label: 'Gender',
    group: 'identity',
    type: 'enum',
    required: false,
    allowedTransforms: ['gender_tr'],
    allowsComposition: false,
    enumValues: ['male', 'female', 'other'],
    note:
      'NULL (not recorded) is a DISTINCT state from "other" (an affirmative ' +
      'patient-reported value). Blank or unrecognized legacy values map to NULL ' +
      'plus a row warning — never to "other" and never to a guess.',
  },
  {
    key: 'patient.address',
    label: 'Street address',
    group: 'address',
    type: 'string',
    required: false,
    allowedTransforms: ['compose_address', 'trim'],
    allowsComposition: true,
    note:
      'Supports documented multi-source composition (e.g. neighbourhood + ' +
      'street). The composition rule is STABLE across reruns — an unstable rule ' +
      'would break idempotency.',
  },
  {
    key: 'patient.city',
    label: 'City / province',
    group: 'address',
    type: 'string',
    required: false,
    allowedTransforms: ['trim'],
    allowsComposition: false,
    note: 'Free text — no province lookup table exists in the product, so values are not canonicalized.',
  },
  {
    key: 'patient.country',
    label: 'Country of residence',
    group: 'address',
    type: 'string',
    required: false,
    allowedTransforms: ['trim'],
    allowsComposition: false,
    note: 'Address country, NOT citizenship. A valid mapping even at 0 % fill for this customer.',
  },
  {
    key: 'patient.patientStatus',
    label: 'Patient status',
    group: 'operational',
    type: 'enum',
    required: false,
    allowedTransforms: ['deleted_to_status'],
    allowsComposition: false,
    enumValues: ['new', 'active', 'inactive', 'archived'],
    note:
      'A source soft-delete flag maps to archived. The migration NEVER writes ' +
      'deletedAt. Archived patients do not consume plan quota.',
  },
  {
    key: 'patient.chartNumber',
    label: 'Legacy chart / file number',
    group: 'operational',
    type: 'string',
    required: false,
    allowedTransforms: ['chart_number'],
    allowsComposition: false,
    note:
      'Clinic-facing, not vendor-internal: the number reception quotes and that ' +
      'is written on every paper chart. Not unique — measured source data has ' +
      '17 duplicate pairs needing manual reconciliation, so duplicates raise a ' +
      'warning and are never silently overwritten.',
  },
  {
    key: 'patient.primaryPractitionerId',
    label: 'Assigned practitioner',
    group: 'operational',
    type: 'reference',
    required: false,
    allowedTransforms: ['practitioner_reference'],
    allowsComposition: false,
    note:
      'Resolved through an explicit, human-approved reference map to an ' +
      'EXISTING User. No fuzzy matching, no auto-creation. An unresolved source ' +
      'value blocks the rows carrying it.',
  },
  {
    key: 'patient.identity.tckn',
    label: 'National identity number (T.C. Kimlik No)',
    group: 'identity',
    type: 'identity',
    required: false,
    allowedTransforms: ['identity_tckn'],
    allowsComposition: false,
    note:
      'Written ONLY to the encrypted PatientIdentityDocument child model under ' +
      'dedicated key material, with a tenant-bound HMAC lookup token. Never a ' +
      'Patient scalar, never returned in plaintext by any ordinary API, never ' +
      'logged. Values failing shape/checksum are QUARANTINED (classified, not ' +
      'written) — a malformed legacy value never becomes a verified identity.',
  },
];

const DESTINATION_BY_KEY = new Map(DESTINATION_FIELDS.map((d) => [d.key, d]));

export function getDestinationField(key: string): DestinationFieldDef | undefined {
  return DESTINATION_BY_KEY.get(key);
}

/** Destinations that may legally appear more than once across the mapping. */
export function destinationAllowsComposition(key: string): boolean {
  return DESTINATION_BY_KEY.get(key)?.allowsComposition ?? false;
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

export const MAPPING_STATES = [
  'AUTO_CONFIDENT',
  'AUTO_REVIEW',
  'MANUAL_REQUIRED',
  'BLOCKED',
  'IGNORE',
  'LEGAL_BLOCKED',
  'RESOLVED',
] as const;

export type MappingState = (typeof MAPPING_STATES)[number];

/** States a run may execute from. Anything else blocks the run. */
export const EXECUTABLE_MAPPING_STATES: readonly MappingState[] = [
  'AUTO_CONFIDENT',
  'RESOLVED',
  'IGNORE',
];

export const MAPPING_REASONS = [
  'EXACT_HEADER',
  'ALIAS',
  'NORMALIZED',
  'FIRST_CUSTOMER_MATRIX',
  'SAVED_TEMPLATE',
  'MANUAL',
  'NO_DESTINATION',
  'LEGAL_GATE',
  'VENDOR_INTERNAL',
  'SUMMARY_NOT_TRANSACTION',
  'SEMANTICS_UNRESOLVED',
  'UNKNOWN_HEADER',
] as const;

export type MappingReason = (typeof MAPPING_REASONS)[number];

export interface MappingSuggestion {
  sourceField: string;
  sourceLabel: string;
  sourceIndex: number;
  sourceNormalized: string;
  destinationField: string | null;
  destinationLabel: string | null;
  transform: TransformName | null;
  composeOrder: number | null;
  /** 0..100, deterministic — produced by the rule that matched. */
  confidence: number;
  reason: MappingReason;
  mappingState: MappingState;
}

export interface MappingValidationIssue {
  code: MigrationErrorCode;
  message: string;
  sourceField?: string;
  destinationField?: string;
}

export interface MappingValidationResult {
  valid: boolean;
  issues: MappingValidationIssue[];
  unresolvedCount: number;
  blockedCount: number;
  legalBlockedCount: number;
  ignoredCount: number;
  mappedCount: number;
}

// ---------------------------------------------------------------------------
// Reference mapping
// ---------------------------------------------------------------------------

export const REFERENCE_MAP_STATUSES = [
  'UNMAPPED',
  'MAPPED_APPROVED',
  'MAPPED_IGNORED',
  'CONFLICTED',
] as const;

export type ReferenceMapStatus = (typeof REFERENCE_MAP_STATUSES)[number];

export type ReferenceEntityType = 'practitioner' | 'staff_user' | 'service' | 'branch';

// ---------------------------------------------------------------------------
// Identity classification
// ---------------------------------------------------------------------------

export const IDENTITY_CLASSIFICATIONS = [
  'VALID',
  'INVALID_LEGACY',
  'AMBIGUOUS',
  'DUPLICATE_SOURCE',
  'MANUAL_REVIEW',
  'ABSENT',
] as const;

export type IdentityClassification = (typeof IDENTITY_CLASSIFICATIONS)[number];

/**
 * ONLY 'VALID' is ever persisted as an identity document. Everything else is
 * QUARANTINED: classified and counted, never written. A migration must not
 * convert a malformed legacy value into a verified identity, and must not
 * silently discard it either — the classification IS the retained record.
 */
export const PERSISTABLE_IDENTITY_CLASSIFICATIONS: readonly IdentityClassification[] = ['VALID'];

// ---------------------------------------------------------------------------
// Row classification
// ---------------------------------------------------------------------------

export const ROW_STATUSES = [
  'CREATED',
  'MATCHED',
  'SKIPPED',
  'FAILED',
  'BLOCKED',
  'INVALID',
  'MANUAL_REVIEW',
  'AMBIGUOUS',
  'DUPLICATE_SOURCE',
  'MAPPING_REQUIRED',
] as const;

export type RowStatus = (typeof ROW_STATUSES)[number];

/** Dry-run row classification (no writes occur, so CREATED/MATCHED are plans). */
export const DRY_RUN_ROW_CLASSES = [
  'VALID_NEW',
  'VALID_MATCHED',
  'NORMALIZED',
  'AMBIGUOUS',
  'MAPPING_REQUIRED',
  'INVALID',
  'DUPLICATE_SOURCE',
  'DUPLICATE_DESTINATION',
  'SKIPPED_BY_POLICY',
  'BLOCKED',
] as const;

export type DryRunRowClass = (typeof DRY_RUN_ROW_CLASSES)[number];

// ---------------------------------------------------------------------------
// Dry-run report
// ---------------------------------------------------------------------------

export interface DryRunBlocker {
  code: MigrationErrorCode;
  /** Safe, human-readable explanation. Never PII. */
  message: string;
  affectedRows: number;
  fieldName?: string;
}

export interface PlanLimitReport {
  /** Source rows that would count against the cap (archived rows do not). */
  sourceActivePatientCount: number;
  /** Current destination count, counted the same way the product counts it. */
  destinationCurrentCount: number;
  expectedResultingCount: number;
  /** From the organization's Plan, when the organization has one. */
  organizationPatientCap: number | null;
  /** Clinic column fallback. */
  clinicPatientCap: number | null;
  /** The cap actually applied, mirroring middleware/planLimits.ts resolution. */
  effectiveCap: number | null;
  effectiveCapSource: 'organization_plan' | 'clinic_column' | 'none';
  allowed: boolean;
  /**
   * How an authorized operator raises the cap. This migration deliberately
   * implements NO hidden bypass: it reports the blocker and names the existing,
   * audited Platform Admin route that changes the commercial limit.
   */
  overrideMechanism: string;
}

export interface SharedPhoneImpact {
  /** Destination patients that already share a phone with another patient. */
  destinationSharedBefore: number;
  /** Projected count after the import. */
  destinationSharedAfter: number;
  /** Pre-existing patients whose auto-link status flips unique -> ambiguous. */
  preExistingFlippedToAmbiguous: number;
  /** Source rows sharing a phone with at least one other source row. */
  sourceRowsSharingPhone: number;
}

export interface DryRunSummary {
  generatedAt: string;
  totalSourceRows: number;
  parsedRows: number;
  validRows: number;
  warningRows: number;
  blockedRows: number;
  invalidRows: number;
  duplicateSourceRows: number;
  ambiguousRows: number;
  manualReviewRows: number;
  unresolvedMappings: number;
  referenceMappingBlockers: number;
  legalBlockers: number;
  expectedCreateCount: number;
  expectedReuseCount: number;
  expectedSkippedCount: number;
  identityClassifications: Record<IdentityClassification, number>;
  rowClasses: Record<DryRunRowClass, number>;
  blockers: DryRunBlocker[];
  warnings: DryRunBlocker[];
  planLimit: PlanLimitReport;
  sharedPhoneImpact: SharedPhoneImpact;
  /** True when execution may proceed. */
  executable: boolean;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

/**
 * Deterministic post-execution reconciliation. The invariant below is asserted
 * by the reconciliation code AND by a test — it is not decoration.
 *
 *   eligible === created + reused + skipped + failed + manualBlocked
 */
export interface ReconciliationReport {
  generatedAt: string;
  sourceTotal: number;
  eligibleTotal: number;
  attemptedTotal: number;
  created: number;
  reused: number;
  manualReview: number;
  skipped: number;
  failed: number;
  blocked: number;
  /** Destination patient count delta measured across the run. */
  destinationCountBefore: number;
  destinationCountAfter: number;
  destinationCountDelta: number;
  provenanceRows: number;
  identityRows: number;
  batchTotals: {
    total: number;
    succeeded: number;
    failed: number;
    pending: number;
    cancelled: number;
  };
  /** Every provenance destination reference resolved to a live in-scope row. */
  provenanceResolves: boolean;
  /** Zero rows landed outside the target (organizationId, clinicId). */
  tenantScopeClean: boolean;
  /** The arithmetic invariant above holds. */
  balanced: boolean;
  /** Populated when balanced === false. Codes only. */
  imbalanceDetail?: string;
}

/** The single authoritative reconciliation invariant. */
export function isReconciliationBalanced(r: {
  eligibleTotal: number;
  created: number;
  reused: number;
  skipped: number;
  failed: number;
  manualReview: number;
  blocked: number;
}): boolean {
  return (
    r.eligibleTotal === r.created + r.reused + r.skipped + r.failed + r.manualReview + r.blocked
  );
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export const DEFAULT_BATCH_SIZE = 500;
export const MIN_BATCH_SIZE = 50;
export const MAX_BATCH_SIZE = 2000;

/** Upload ceiling. The real first-customer workbook is ~10.8 MiB. */
export const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;

/**
 * A run's execution lock is considered stale after this long without a
 * heartbeat, which is what makes resume possible after a process restart.
 * Reclaiming a stale lock is an EXPLICIT Platform Admin action, never
 * automatic — an automatic reclaim could run two executors at once.
 */
export const EXECUTION_LOCK_STALE_MS = 5 * 60 * 1000;

export const EXECUTION_HEARTBEAT_INTERVAL_MS = 15 * 1000;

/** How long a completed run's source file is retained before deletion. */
export const SOURCE_FILE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export const SOURCE_SYSTEM_DEFAULT = 'legacy-dental-tr-v1';

// ---------------------------------------------------------------------------
// Safe logging helper
// ---------------------------------------------------------------------------

/**
 * The ONLY shape migration code may pass to a logger. Structurally incapable of
 * carrying a name, phone, e-mail, address, note or identity value: every field
 * is an id, a count, a status or a code.
 */
export interface SafeMigrationLogContext {
  migrationRunId: string;
  organizationId: string;
  clinicId: string;
  batchNumber?: number;
  status?: string;
  errorCode?: MigrationErrorCode;
  processedRows?: number;
  createdRows?: number;
  matchedRows?: number;
  failedRows?: number;
  skippedRows?: number;
  warningRows?: number;
  durationMs?: number;
}

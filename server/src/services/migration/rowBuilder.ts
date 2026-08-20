/**
 * rowBuilder.ts — F3-DATA-MIG-TODAY-001
 *
 * Turns a parsed source row plus the operator's resolved mapping into a
 * vendor-neutral patient draft. This is the last place vendor semantics exist
 * and the first place NoraMedi domain values do.
 *
 * Two properties everything downstream depends on:
 *
 *  1. DETERMINISM. The same source row plus the same mapping must produce the
 *     same draft, byte for byte, on every run. Dry-run counts would otherwise
 *     not predict execution, and composed values (address) would differ
 *     between the run that created a patient and the rerun that is supposed to
 *     recognise it. That is why composition order is resolved once, here, from
 *     persisted `composeOrder`, and why no transform is allowed to re-sort.
 *
 *  2. NO RAW PII LEAVES THIS MODULE EXCEPT INTO THE DRAFT. Warnings are codes.
 *     Errors are templated messages naming a FIELD, never a value. The identity
 *     value is carried in a dedicated field that the caller hands straight to
 *     the classifier/encryptor; it is never logged, never reported, and never
 *     placed on the row outcome.
 */

import {
  MigrationError,
  type CanonicalCell,
  type CanonicalHeader,
  type CanonicalRow,
  type MigrationErrorCode,
  type TransformName,
} from './contracts.js';
import { applyTransform } from './mapping/transforms.js';

/** A persisted mapping row, structurally typed so Prisma is not imported here. */
export interface ResolvedMapping {
  sourceField: string;
  sourceIndex: number;
  destinationField: string | null;
  transform: string | null;
  composeOrder: number | null;
  state: string;
}

/**
 * The mapping, pre-indexed for row-loop use.
 *
 * Built ONCE per run, not once per row. Rebuilding it per row over 14,890 rows
 * and 91 columns would be ~1.4M redundant map constructions — the difference
 * between a dry run that takes seconds and one that takes minutes.
 */
export interface CompiledMapping {
  /** destination key -> the source columns feeding it, in composition order. */
  byDestination: Map<string, ResolvedMapping[]>;
  /** Physical column index of the provenance source id. */
  provenanceIndex: number;
  provenanceTransform: TransformName;
  /** True when any column is mapped to the identity destination. */
  hasIdentity: boolean;
  /** True when any column is mapped to the practitioner reference. */
  hasPractitioner: boolean;
}

const WRITING_STATES = new Set(['AUTO_CONFIDENT', 'RESOLVED']);

export function compileMapping(mappings: ResolvedMapping[]): CompiledMapping {
  const byDestination = new Map<string, ResolvedMapping[]>();

  for (const mapping of mappings) {
    if (!mapping.destinationField) continue;
    if (!WRITING_STATES.has(mapping.state)) continue;

    const bucket = byDestination.get(mapping.destinationField);
    if (bucket) bucket.push(mapping);
    else byDestination.set(mapping.destinationField, [mapping]);
  }

  // Resolve composition order ONCE. A null composeOrder sorts first and ties
  // break on the physical column index, so the order is total and stable even
  // if a future mapping row is saved without an explicit order.
  for (const bucket of byDestination.values()) {
    bucket.sort((a, b) => {
      const ao = a.composeOrder ?? Number.NEGATIVE_INFINITY;
      const bo = b.composeOrder ?? Number.NEGATIVE_INFINITY;
      if (ao !== bo) return ao - bo;
      return a.sourceIndex - b.sourceIndex;
    });
  }

  const provenance = byDestination.get('provenance.sourceId');
  if (!provenance || provenance.length === 0) {
    // validateMappings should have caught this long before execution. Failing
    // hard here rather than defaulting is deliberate: a run without provenance
    // is a run that duplicates every patient on its next attempt.
    throw new MigrationError('MAPPING_REQUIRED', {
      message:
        'No source column is mapped to the provenance source id, so this run could not be rerun safely.',
    });
  }

  return {
    byDestination,
    provenanceIndex: provenance[0]!.sourceIndex,
    provenanceTransform: (provenance[0]!.transform as TransformName) ?? 'provenance_source_id',
    hasIdentity: byDestination.has('patient.identity.tckn'),
    hasPractitioner: byDestination.has('patient.primaryPractitionerId'),
  };
}

/** The NoraMedi-shaped patient values a row produces. */
export interface PatientDraft {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  dateOfBirth: Date | null;
  address: string | null;
  city: string | null;
  country: string | null;
  patientStatus: string;
  gender: string | null;
  chartNumber: string | null;
  /**
   * KVKK Art. 6 special-category clinical free text. Only ever non-null when a
   * Platform Admin has explicitly RESOLVED a source column onto
   * `patient.notes` — the matrix proposes that destination in mapping state
   * SENSITIVE_REVIEW_REQUIRED, which compileMapping() does not treat as a
   * writing state, so an unapproved proposal contributes nothing here.
   * NEVER logged, never placed in a warning, never in a row outcome message.
   */
  notes: string | null;
  /**
   * KVKK Art. 6 special-category STRUCTURED health data. Same gate as
   * `notes`: only ever non-null once a Platform Admin has explicitly
   * RESOLVED a source column onto `patient.bloodGroup`. One of the eight
   * canonical values or null - `blood_group_tr` emits nothing else, and
   * never infers Rh.
   * NEVER logged, never placed in a warning, never in a row outcome message.
   */
  bloodGroup: string | null;
}

export interface RowFailure {
  code: MigrationErrorCode;
  /** Templated. Names a destination field; never a value. */
  message: string;
  fieldName?: string;
}

export interface BuiltRow {
  rowNumber: number;
  /** The vendor primary key. Provenance, never medical identity. */
  sourceId: string | null;
  draft: PatientDraft | null;
  /**
   * The raw identity value, for the classifier/encryptor ONLY.
   * NEVER log this, never report it, never persist it outside the encrypted
   * child model.
   */
  identityRawValue: string | null;
  /** Byte-exact source practitioner label, for the reference map lookup. */
  practitionerSourceValue: string | null;
  warnings: string[];
  failures: RowFailure[];
}

const EMPTY_CELL: CanonicalCell = { type: 'empty', text: '' };

function cellsFor(row: CanonicalRow, sources: ResolvedMapping[]): CanonicalCell[] {
  return sources.map((source) => row.cells[source.sourceIndex] ?? EMPTY_CELL);
}

/**
 * Build one row. Never throws for data problems — a data condition produces a
 * classification and a counted failure, never an exception and never a 500.
 * The only throw path is a programming error in the compiled mapping.
 */
export function buildRow(
  row: CanonicalRow,
  compiled: CompiledMapping,
  _headers: CanonicalHeader[],
): BuiltRow {
  const warnings: string[] = [];
  const failures: RowFailure[] = [];

  const read = (destination: string): string | number | boolean | Date | null => {
    const sources = compiled.byDestination.get(destination);
    if (!sources || sources.length === 0) return null;

    const transformName = (sources[0]!.transform as TransformName) ?? 'trim';
    const output = applyTransform(transformName, {
      cells: cellsFor(row, sources),
      rowNumber: row.rowNumber,
    });

    for (const warning of output.warnings) {
      // Codes only, prefixed with the destination so a reviewer can see WHERE
      // a warning came from without the value that caused it.
      warnings.push(`${destination}:${warning}`);
    }
    if (output.error) {
      failures.push({
        code: output.error.code,
        message: output.error.message,
        fieldName: destination,
      });
      return null;
    }
    return output.value;
  };

  const asString = (value: unknown): string | null =>
    typeof value === 'string' && value.length > 0 ? value : null;

  // ---- provenance --------------------------------------------------------
  const sourceIdValue = read('provenance.sourceId');
  const sourceId = asString(sourceIdValue);
  if (!sourceId) {
    failures.push({
      code: 'ROW_REQUIRED_FIELD_MISSING',
      message:
        'This row has no source record id, so it cannot be imported idempotently and was not attempted.',
      fieldName: 'provenance.sourceId',
    });
  }

  // ---- required name fields ----------------------------------------------
  const firstName = asString(read('patient.firstName'));
  const lastName = asString(read('patient.lastName'));
  if (!firstName) {
    failures.push({
      code: 'ROW_REQUIRED_FIELD_MISSING',
      message: 'First name is empty.',
      fieldName: 'patient.firstName',
    });
  }
  if (!lastName) {
    failures.push({
      code: 'ROW_REQUIRED_FIELD_MISSING',
      message: 'Last name is empty.',
      fieldName: 'patient.lastName',
    });
  }

  // ---- identity ----------------------------------------------------------
  // Read but NOT placed on the draft: identity never becomes a Patient scalar.
  const identityRawValue = compiled.hasIdentity ? asString(read('patient.identity.tckn')) : null;

  // ---- practitioner reference -------------------------------------------
  const practitionerSourceValue = compiled.hasPractitioner
    ? asString(read('patient.primaryPractitionerId'))
    : null;

  // ---- the rest ----------------------------------------------------------
  const dateOfBirthValue = read('patient.dateOfBirth');
  const dateOfBirth = dateOfBirthValue instanceof Date ? dateOfBirthValue : null;

  const patientStatusValue = asString(read('patient.patientStatus'));

  const draft: PatientDraft | null =
    firstName && lastName
      ? {
          firstName,
          lastName,
          email: asString(read('patient.email')),
          phone: asString(read('patient.phone')),
          dateOfBirth,
          address: asString(read('patient.address')),
          city: asString(read('patient.city')),
          country: asString(read('patient.country')),
          // Default 'new' rather than null: patientStatus is non-nullable with
          // a product default, and an unmapped source simply means "no
          // soft-delete information", not "unknown status".
          patientStatus: patientStatusValue ?? 'new',
          gender: asString(read('patient.gender')),
          chartNumber: asString(read('patient.chartNumber')),
          notes: asString(read('patient.notes')),
          bloodGroup: asString(read('patient.bloodGroup')),
        }
      : null;

  return {
    rowNumber: row.rowNumber,
    sourceId,
    draft,
    identityRawValue,
    practitionerSourceValue,
    warnings,
    failures,
  };
}

/**
 * Does this row consume plan quota?
 *
 * Mirrors the product's counting rule: archived patients do not count. The
 * source soft-delete flag maps to `archived`, so those rows import without
 * consuming the customer's plan — which is why the plan-limit report must ask
 * this question rather than counting source rows.
 */
export function consumesPlanQuota(built: BuiltRow): boolean {
  return built.draft !== null && built.draft.patientStatus !== 'archived';
}

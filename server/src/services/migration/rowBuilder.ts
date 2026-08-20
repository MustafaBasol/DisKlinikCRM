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
  /**
   * F3-DATA-MIG-TODAY-001-R10. Source columns mapped to a secondary contact
   * point, paired with the contact type their destination implies.
   */
  contactPointSources: readonly { contactType: string; mapping: ResolvedMapping }[];
  /**
   * F3-DATA-MIG-TODAY-001-R10. Every source column the operator accepted for
   * legacy preservation. Unlike every other destination this one is
   * INDEPENDENTLY MULTI-USED: each column produces its own preserved row, so
   * this is a list, never a composition.
   */
  preservationSources: readonly ResolvedMapping[];
}

/**
 * Destination key -> the PatientContactPoint.contactType it writes.
 * A closed map: an unknown contact-point destination is a programming error,
 * not something to guess a type for.
 */
const CONTACT_POINT_DESTINATIONS: ReadonlyMap<string, string> = new Map([
  ['patient.contactPoint.home', 'home'],
  ['patient.contactPoint.work', 'work'],
]);

/** The one destination that writes MigrationPreservedSourceValue rows. */
const PRESERVATION_DESTINATION = 'legacy.preservedSourceValue';

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

  const contactPointSources: { contactType: string; mapping: ResolvedMapping }[] = [];
  for (const [destination, contactType] of CONTACT_POINT_DESTINATIONS) {
    for (const mapping of byDestination.get(destination) ?? []) {
      contactPointSources.push({ contactType, mapping });
    }
  }

  return {
    byDestination,
    provenanceIndex: provenance[0]!.sourceIndex,
    provenanceTransform: (provenance[0]!.transform as TransformName) ?? 'provenance_source_id',
    hasIdentity: byDestination.has('patient.identity.tckn'),
    hasPractitioner: byDestination.has('patient.primaryPractitionerId'),
    contactPointSources,
    preservationSources: byDestination.get(PRESERVATION_DESTINATION) ?? [],
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
  /**
   * F3-DATA-MIG-TODAY-001-R10. District / ilçe. Separate from `city`, which is
   * the province (il) — the two are different administrative levels and
   * collapsing them would lose the distinction the field was added to keep.
   */
  district: string | null;
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
  /**
   * F3-DATA-MIG-TODAY-001-R10. Secondary phone numbers for this row. NOT on
   * the draft: they are child records, and `Patient.phone` must never receive
   * one of these values.
   */
  contactPoints: DraftContactPoint[];
  /**
   * F3-DATA-MIG-TODAY-001-R10. Legacy source values to preserve for this row,
   * one per accepted source column. NOT on the draft: these are evidence
   * records, never Patient fields.
   */
  preservedValues: DraftPreservedValue[];
  warnings: string[];
  failures: RowFailure[];
}

/** One secondary contact point a row produces. */
export interface DraftContactPoint {
  contactType: string;
  value: string;
}

/** One legacy value a row preserves, with the provenance that explains it. */
export interface DraftPreservedValue {
  /** Byte-exact vendor column name this value came from. */
  sourceColumn: string;
  value: string;
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

  /*
   * ---- secondary contact points (R10) -----------------------------------
   * Read through the SAME transform pipeline as any other destination, so a
   * secondary number is normalized and warned about exactly like the primary
   * one. Each destination has one source, so `read()` is correct here.
   */
  const contactPoints: DraftContactPoint[] = [];
  for (const { contactType, mapping } of compiled.contactPointSources) {
    /*
     * Read THIS mapping's own cell, not `read(destination)`.
     *
     * `read()` hands the destination's whole source bucket to one transform
     * call — composition semantics. If two columns were ever mapped to the same
     * contact-point destination, `read()` would transform `cells[0]` and return
     * that one value for BOTH iterations: the first column's number written
     * twice and the second silently dropped. `validateMapping` Rule 2 currently
     * makes that unreachable (a non-composable, non-multi-use destination with
     * two sources is a MAPPING_DESTINATION_COLLISION), but the executor must
     * not silently lose a phone number just because a validator ran upstream.
     */
    const cell = row.cells[mapping.sourceIndex] ?? EMPTY_CELL;
    const output = applyTransform((mapping.transform as TransformName) ?? 'phone_tr', {
      cells: [cell],
      rowNumber: row.rowNumber,
    });
    for (const warning of output.warnings) {
      warnings.push(`${mapping.destinationField}:${warning}`);
    }
    if (output.error) {
      failures.push({
        code: output.error.code,
        message: output.error.message,
        fieldName: mapping.destinationField ?? undefined,
      });
      continue;
    }
    const value = asString(output.value);
    // An absent source cell is not a contact point. Writing an empty row would
    // assert the clinic holds a number it does not hold.
    if (value) contactPoints.push({ contactType, value });
  }

  /*
   * ---- preserved legacy values (R10) ------------------------------------
   * The ONE place `read()` is deliberately not used. `read()` hands EVERY
   * source cell for a destination to a single transform call, which is
   * composition semantics — right for patient.address, wrong here. Preservation
   * is independently multi-used: each accepted column keeps its OWN value under
   * its OWN name, so each is transformed separately and tagged with its
   * byte-exact sourceField. Merging them would destroy the provenance that is
   * the entire point of preserving anything.
   */
  const preservedValues: DraftPreservedValue[] = [];
  for (const mapping of compiled.preservationSources) {
    const cell = row.cells[mapping.sourceIndex] ?? EMPTY_CELL;
    const output = applyTransform((mapping.transform as TransformName) ?? 'preserve_source_value', {
      cells: [cell],
      rowNumber: row.rowNumber,
    });
    for (const warning of output.warnings) {
      warnings.push(`${PRESERVATION_DESTINATION}:${warning}`);
    }
    if (output.error) {
      failures.push({
        code: output.error.code,
        message: output.error.message,
        fieldName: PRESERVATION_DESTINATION,
      });
      continue;
    }
    const value = asString(output.value);
    // An empty source cell preserves nothing. No evidence row is written for
    // absence — an absent value is not evidence that the old system held one.
    if (value) preservedValues.push({ sourceColumn: mapping.sourceField, value });
  }

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
          district: asString(read('patient.district')),
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
    contactPoints,
    preservedValues,
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

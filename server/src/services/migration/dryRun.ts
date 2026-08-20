/**
 * dryRun.ts — F3-DATA-MIG-TODAY-001
 *
 * ZERO DOMAIN WRITES. This module reads the source workbook, evaluates every
 * row against the resolved mapping, and produces a full report. It creates and
 * updates NOTHING in the clinical domain: no Patient, no PatientIdentityDocument,
 * no appointment, no treatment record, no payment, no consent row, no message.
 *
 * The ONLY thing it persists is analytical run state on `MigrationRun`
 * (`dryRunSummary`, `status`) — the run's own bookkeeping, which is explicitly
 * permitted and is not domain data.
 *
 * That property is enforced structurally, not by discipline: this file imports
 * `prisma` for READS only, and every write path in the module is a single
 * `migrationRun.update` at the end. A test asserts that a dry run over a
 * dirty-data fixture leaves the Patient and PatientIdentityDocument counts
 * unchanged.
 *
 * WHY A DRY RUN IS NOT OPTIONAL: it is the only place the operator learns the
 * plan-limit outcome, the blocker counts, the identity classification spread
 * and the shared-phone impact BEFORE 14,890 rows land in a live tenant. The
 * state machine therefore requires DRY_RUN_COMPLETE before READY.
 */

import prisma from '../../db.js';
import {
  MigrationError,
  type DryRunBlocker,
  type DryRunRowClass,
  type DryRunSummary,
  type IdentityClassification,
  type SharedPhoneImpact,
} from './contracts.js';
import { classifyIdentities, type IdentityDecision } from './identity/identityClassifier.js';
import {
  evaluateDataLossGate,
  type DataLossGateRecord,
  type DataLossGateReport,
} from './mapping/dataLossGate.js';
import { buildPlanLimitReport, planLimitBlockerMessage } from './planLimits.js';
import { buildRow, compileMapping, consumesPlanQuota, type BuiltRow } from './rowBuilder.js';
import type { CanonicalWorkbook } from './contracts.js';
import type { ResolvedMapping } from './rowBuilder.js';

export interface DryRunInput {
  runId: string;
  organizationId: string;
  clinicId: string;
  sourceSystem: string;
  workbook: CanonicalWorkbook;
  mappings: ResolvedMapping[];
  /** Source values still unresolved in the practitioner reference map. */
  unresolvedReferenceValues: ReadonlySet<string>;
  /** Columns the operator left in a legal-gated state. */
  legalBlockedFields: readonly string[];
  /** Columns still awaiting a decision. */
  unresolvedMappingCount: number;
  /**
   * F3-DATA-MIG-TODAY-001-R9. The persisted mapping rows, carrying the measured
   * `sourceProfile` and the operator-decision evidence
   * (`isAutoSuggested` / `decidedByPlatformAdminId` / `decidedAt`) that
   * `mappings` (a `ResolvedMapping[]`, deliberately narrowed for the row loop)
   * does not.
   *
   * REQUIRED, not optional. An optional field is an opt-out, and "the caller
   * forgot" would then read as "no data-loss risk" — the precise fail-open this
   * gate exists to close. Making it required moves that mistake from a silent
   * runtime pass to a compile error at every call site.
   */
  gateRecords: readonly DataLossGateRecord[];
}

function emptyRowClasses(): Record<DryRunRowClass, number> {
  return {
    VALID_NEW: 0,
    VALID_MATCHED: 0,
    NORMALIZED: 0,
    AMBIGUOUS: 0,
    MAPPING_REQUIRED: 0,
    INVALID: 0,
    DUPLICATE_SOURCE: 0,
    DUPLICATE_DESTINATION: 0,
    SKIPPED_BY_POLICY: 0,
    BLOCKED: 0,
  };
}

function emptyIdentityCounts(): Record<IdentityClassification, number> {
  return {
    VALID: 0,
    INVALID_LEGACY: 0,
    AMBIGUOUS: 0,
    DUPLICATE_SOURCE: 0,
    MANUAL_REVIEW: 0,
    ABSENT: 0,
  };
}

/** Accumulate blockers by code so the report shows one line per cause. */
class BlockerTally {
  private readonly byKey = new Map<string, DryRunBlocker>();

  add(blocker: Omit<DryRunBlocker, 'affectedRows'>, rows = 1): void {
    const key = `${blocker.code}|${blocker.fieldName ?? ''}`;
    const existing = this.byKey.get(key);
    if (existing) {
      existing.affectedRows += rows;
      return;
    }
    this.byKey.set(key, { ...blocker, affectedRows: rows });
  }

  list(): DryRunBlocker[] {
    return [...this.byKey.values()].sort((a, b) => b.affectedRows - a.affectedRows);
  }

  get size(): number {
    return this.byKey.size;
  }
}

export async function runDryRun(input: DryRunInput): Promise<DryRunSummary> {
  const startedAt = Date.now();
  const {
    organizationId,
    clinicId,
    sourceSystem,
    workbook,
    mappings,
    unresolvedReferenceValues,
    legalBlockedFields,
    unresolvedMappingCount,
    gateRecords,
  } = input;

  const compiled = compileMapping(mappings);

  // ---- pass 1: build every row -------------------------------------------
  const built: BuiltRow[] = [];
  for (const row of workbook.rows) {
    built.push(buildRow(row, compiled, workbook.headers));
  }

  // ---- source-level duplicate provenance ids ------------------------------
  // A vendor primary key that repeats in the file is a source defect: two rows
  // claiming the same identity would collapse into one patient on execution
  // and the second row's data would silently vanish. Counted, never merged.
  const sourceIdCounts = new Map<string, number>();
  for (const row of built) {
    if (!row.sourceId) continue;
    sourceIdCounts.set(row.sourceId, (sourceIdCounts.get(row.sourceId) ?? 0) + 1);
  }

  // ---- existing provenance: which rows would MATCH rather than create -----
  // One indexed query for the whole run, not one per row. At 14,890 rows the
  // per-row alternative is 14,890 round trips.
  const sourceIds = [...sourceIdCounts.keys()];
  const existingRecords = await prisma.migrationRecord.findMany({
    where: {
      organizationId,
      sourceSystem,
      sourceEntity: 'patient',
      sourceId: { in: sourceIds },
    },
    select: { sourceId: true, destinationId: true },
  });
  const existingBySourceId = new Map(existingRecords.map((r) => [r.sourceId, r.destinationId]));

  // ---- identity classification -------------------------------------------
  let identityDecisions: IdentityDecision[] = [];
  const identityCounts = emptyIdentityCounts();

  if (compiled.hasIdentity) {
    // The destination organization's existing identity tokens, so a source
    // value colliding with a DIFFERENT patient classifies AMBIGUOUS rather
    // than being auto-merged. Only the tokens are loaded — never a plaintext
    // value, which the database does not hold anyway.
    const existingDocs = await prisma.patientIdentityDocument.findMany({
      where: { organizationId, docType: 'TCKN' },
      select: { lookupHash: true, patientId: true },
    });
    const existingLookupHashes = new Map(existingDocs.map((d) => [d.lookupHash, d.patientId]));

    identityDecisions = classifyIdentities(
      built.map((row) => ({ rowNumber: row.rowNumber, rawValue: row.identityRawValue })),
      { organizationId, docType: 'TCKN', existingLookupHashes },
    );

    for (const decision of identityDecisions) {
      identityCounts[decision.classification]++;
    }
  } else {
    identityCounts.ABSENT = built.length;
  }
  const identityByRow = new Map(identityDecisions.map((d) => [d.rowNumber, d]));

  // ---- shared-phone impact ------------------------------------------------
  const sharedPhoneImpact = await computeSharedPhoneImpact(clinicId, built);

  // ---- pass 2: classify every row ----------------------------------------
  const rowClasses = emptyRowClasses();
  const blockers = new BlockerTally();
  const warnings = new BlockerTally();

  let validRows = 0;
  let warningRows = 0;
  let blockedRows = 0;
  let invalidRows = 0;
  let duplicateSourceRows = 0;
  let ambiguousRows = 0;
  let manualReviewRows = 0;
  let referenceBlockers = 0;
  let expectedCreateCount = 0;
  let expectedReuseCount = 0;
  let expectedSkippedCount = 0;
  let planQuotaConsumingRows = 0;

  for (const row of built) {
    const identity = identityByRow.get(row.rowNumber);

    if (identity && identity.classification !== 'VALID' && identity.classification !== 'ABSENT') {
      // The patient row still imports; only the identity value is quarantined.
      // Discarding the patient because their legacy TC is malformed would lose
      // a real person over a data-entry error made years ago.
      warnings.add({
        code: identity.classification === 'INVALID_LEGACY' ? 'IDENTITY_INVALID' : 'IDENTITY_AMBIGUOUS',
        message:
          identity.classification === 'INVALID_LEGACY'
            ? 'The national identity value failed shape or checksum validation and will be quarantined. The patient is still imported; the identity value is not stored as verified.'
            : 'The national identity value is ambiguous or duplicated in the source and will be quarantined for manual review. It is never auto-merged.',
        fieldName: 'patient.identity.tckn',
      });
      if (identity.classification === 'AMBIGUOUS') ambiguousRows++;
      if (identity.classification === 'MANUAL_REVIEW') manualReviewRows++;
    }

    // -- hard failures from the row builder --
    if (row.failures.length > 0) {
      invalidRows++;
      rowClasses.INVALID++;
      for (const failure of row.failures) {
        blockers.add({
          code: failure.code,
          message: failure.message,
          fieldName: failure.fieldName,
        });
      }
      continue;
    }

    // -- duplicate provenance id within the file --
    if (row.sourceId && (sourceIdCounts.get(row.sourceId) ?? 0) > 1) {
      duplicateSourceRows++;
      rowClasses.DUPLICATE_SOURCE++;
      blockers.add({
        code: 'DUPLICATE_SOURCE_RECORD',
        message:
          'This source record id appears on more than one row. Both rows are held for manual review rather than collapsed into one patient.',
        fieldName: 'provenance.sourceId',
      });
      continue;
    }

    // -- unresolved practitioner reference --
    if (row.practitionerSourceValue && unresolvedReferenceValues.has(row.practitionerSourceValue)) {
      referenceBlockers++;
      rowClasses.MAPPING_REQUIRED++;
      blockers.add({
        code: 'REFERENCE_UNRESOLVED',
        message:
          'The source practitioner for this row has not been mapped to an existing NoraMedi user. Map every practitioner value, or mark it as not carried, before executing.',
        fieldName: 'patient.primaryPractitionerId',
      });
      continue;
    }

    // -- would this row match an existing patient via provenance? --
    if (row.sourceId && existingBySourceId.has(row.sourceId)) {
      expectedReuseCount++;
      validRows++;
      rowClasses.VALID_MATCHED++;
      if (consumesPlanQuota(row)) planQuotaConsumingRows++;
      if (row.warnings.length > 0) warningRows++;
      continue;
    }

    expectedCreateCount++;
    validRows++;
    rowClasses.VALID_NEW++;
    if (consumesPlanQuota(row)) planQuotaConsumingRows++;
    if (row.warnings.length > 0) {
      warningRows++;
      rowClasses.NORMALIZED++;
      for (const warning of row.warnings) {
        warnings.add({ code: 'ROW_VALUE_INVALID', message: describeWarning(warning), fieldName: warning.split(':')[0] });
      }
    }
  }

  // ---- mapping-level blockers --------------------------------------------
  if (unresolvedMappingCount > 0) {
    blockers.add(
      {
        code: 'MAPPING_REQUIRED',
        message: `${unresolvedMappingCount} source column(s) still need a mapping decision before this run can execute.`,
      },
      unresolvedMappingCount,
    );
  }

  // A legally-gated column that the operator has already excluded from the
  // mapping (mapping state LEGAL_BLOCKED — see validateMapping.ts, where this
  // is one of the NON_WRITING_DECIDED_STATES, the same tier as IGNORE) writes
  // nothing to the destination. It must stay prominently visible, but it is a
  // DECIDED exclusion, not an unresolved problem — so unlike every other entry
  // in `blockers`, it must never suppress `executable` on its own. A legally
  // blocked column that a required destination invariant actually depends on
  // is caught upstream: validateMappings' Rule 5 fails the mapping step itself
  // when a required destination has no mapped source, before a run can reach
  // this dry run at all.
  const legalExclusions = new BlockerTally();
  for (const field of legalBlockedFields) {
    legalExclusions.add({
      code: 'LEGAL_BLOCKED',
      message:
        'This source column holds special-category (KVKK Art. 6) content whose legal basis is unresolved. It is excluded from the import; lifting the gate is a program-owner decision.',
      fieldName: field,
    });
  }
  const legalBlockerCount = legalBlockedFields.length;
  blockedRows = rowClasses.BLOCKED;

  // ---- F3-DATA-MIG-TODAY-001-R9: the first-customer data-loss gate --------
  //
  // The rule the program owner set: EVERY source column carrying MEANINGFUL
  // data must end in a mapped destination, manual review, sensitive review, or
  // an OPERATOR-CONFIRMED exclusion. A profile that recommends IGNORE, an
  // engine that reports BLOCKED and a legal gate are RECOMMENDATIONS; none of
  // them is a human deciding to discard a clinic's own operational record.
  //
  // Note what this does NOT change: the MAPPING-stage Continue gate
  // (validateMappings) still passes a run whose columns are ignored/blocked,
  // because at that point the operator has not yet been shown the measured
  // fill and cannot reasonably be asked to confirm exclusions. The confirmation
  // is owed HERE, at the dry run — the first moment the real per-column counts
  // exist — and it gates EXECUTE, which is the only step that can lose data.
  const dataLossGate = evaluateDataLossGate(gateRecords);

  for (const field of dataLossGate.unconfirmedExclusionFields) {
    blockers.add({
      code: 'MAPPING_EXCLUSION_NOT_CONFIRMED',
      message:
        'This source column carries data, and the system RECOMMENDS excluding it — but no operator has confirmed that decision for this run. Open it in the mapping screen and save it to record the exclusion, or give it a destination.',
      fieldName: field,
    });
  }

  for (const field of dataLossGate.blockedMeaningfulFields) {
    blockers.add({
      code: 'MAPPING_MEANINGFUL_COLUMN_BLOCKED',
      message:
        'This source column carries data but is BLOCKED — an unresolved obstacle, not a decision. Map it to a destination, send it to review, or mark it ignored and save, which records the exclusion as yours.',
      fieldName: field,
    });
  }

  // A legally-gated column with MEANINGFUL content is the one case where the
  // legal gate must gate EXECUTION and not merely be displayed: the
  // legalExclusions list above deliberately never suppresses `executable`, and
  // R7/R8 relied on that for every legal-blocked column regardless of how much
  // real content it held. Zero-data and unmeasured legal-blocked columns are
  // unaffected and stay purely informational.
  for (const field of dataLossGate.legalBlockedMeaningfulFields) {
    blockers.add({
      code: 'MAPPING_MEANINGFUL_COLUMN_BLOCKED',
      message:
        'This source column holds real content under an unresolved KVKK Art. 6 legal gate. It may not simply be dropped: it needs a program-owner decision — an accepted historical-evidence destination, or an explicit review outcome — before this run may execute.',
      fieldName: field,
    });
  }

  for (const field of dataLossGate.unmeasuredFillFields) {
    blockers.add({
      code: 'MAPPING_FILL_UNMEASURED',
      message:
        'This column was never profiled, so whether excluding it loses data is unknown. Unmeasured is not empty. Re-run Analyze so the column is measured before this run executes.',
      fieldName: field,
    });
  }

  for (const field of dataLossGate.unaccountedMeaningfulFields) {
    blockers.add({
      code: 'MAPPING_DATA_LOSS_UNACCOUNTED',
      message:
        'This source column carries data but sits in a state the data-loss accounting does not recognise, so nothing can vouch for where its content goes. Give it an explicit decision in the mapping screen.',
      fieldName: field,
    });
  }

  // Belt and braces, and the only place the gate reports on ITSELF.
  //
  // Every case enumerated above contributes its own per-field blocker, and the
  // two remaining unsatisfied cases (a meaningful column still in manual or
  // sensitive review) are blocked by the MAPPING_REQUIRED entry derived from
  // `unresolvedMappingCount`. So this fires only when the accounting failed to
  // balance, or when a caller passed an `unresolvedMappingCount` that disagrees
  // with the rows it passed. Both are defects in the surrounding code rather
  // than in the operator's mapping — and both are exactly the conditions under
  // which "nothing is missing" stops being provable, so they are reported
  // rather than swallowed.
  if (!dataLossGate.satisfied && blockers.size === 0) {
    blockers.add({
      code: 'MAPPING_DATA_LOSS_UNACCOUNTED',
      message: `The source-column data-loss accounting did not resolve cleanly: ${dataLossGate.meaningfulSourceColumns} meaningful column(s) against ${dataLossGate.resolved} mapped, ${dataLossGate.manualReview} in manual review, ${dataLossGate.sensitiveReview} in sensitive review and ${dataLossGate.operatorConfirmedExcluded} operator-confirmed exclusion(s).`,
    });
  }

  // ---- plan limits --------------------------------------------------------
  const planLimit = await buildPlanLimitReport({
    organizationId,
    clinicId,
    sourceActivePatientCount: planQuotaConsumingRows,
    expectedReuseCount,
  });

  if (!planLimit.allowed) {
    blockers.add(
      {
        code: 'PLAN_LIMIT_EXCEEDED',
        message: planLimitBlockerMessage(planLimit),
      },
      expectedCreateCount,
    );
  }

  const blockerList = blockers.list();
  // `dataLossGate.satisfied` is stated explicitly rather than left to follow
  // from `blockerList.length === 0`. It does follow today — every unsatisfied
  // class adds a blocker above — but that is an invariant across two separate
  // pieces of code, and the failure mode if it ever breaks is a run that
  // executes while dropping clinic data. Naming the condition makes the gate
  // hold even if the blocker wiring above is later changed.
  const executable = blockerList.length === 0 && validRows > 0 && dataLossGate.satisfied;

  return {
    generatedAt: new Date().toISOString(),
    totalSourceRows: workbook.rows.length,
    parsedRows: built.length,
    validRows,
    warningRows,
    blockedRows,
    invalidRows,
    duplicateSourceRows,
    ambiguousRows,
    manualReviewRows,
    unresolvedMappings: unresolvedMappingCount,
    referenceMappingBlockers: referenceBlockers,
    legalBlockers: legalBlockerCount,
    expectedCreateCount,
    expectedReuseCount,
    expectedSkippedCount,
    identityClassifications: identityCounts,
    rowClasses,
    blockers: blockerList,
    legalExclusions: legalExclusions.list(),
    warnings: warnings.list(),
    planLimit,
    sharedPhoneImpact,
    dataLossGate,
    executable,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Turn an internal warning code into an operator-readable sentence.
 * Codes in, sentences out — no values ever pass through here.
 */
function describeWarning(code: string): string {
  const bare = code.includes(':') ? code.slice(code.indexOf(':') + 1) : code;
  switch (bare) {
    case 'GENDER_VALUE_UNRECOGNIZED':
      return 'The source gender value was not recognised and is left unset rather than guessed. "Unknown" and "other" are deliberately different states.';
    case 'BLOOD_GROUP_VALUE_UNRECOGNIZED':
      return 'The source blood-group value was not recognised and is left unset rather than guessed. The value is preserved in the source column and nothing is discarded - review it there.';
    case 'BLOOD_GROUP_RH_MISSING':
      return 'The source recorded an ABO group with no Rh factor. Rh is never inferred, so the blood group is left unset - half a blood group is not a blood group.';
    case 'PHONE_LEADING_ZERO_RESTORED':
      return 'A leading zero destroyed by the spreadsheet was restored under a Turkish-number assumption. A 10-digit number starting with 5 is genuinely ambiguous, so it is flagged rather than silently assumed.';
    case 'PHONE_UNPARSEABLE':
      return 'The source phone value could not be normalised and is left unset.';
    case 'EMAIL_INVALID_DROPPED':
      return 'The source e-mail address is not a valid address and is left unset. It does not fail the row.';
    case 'DATE_UNPARSEABLE':
      return 'The source date could not be parsed and is left unset.';
    default:
      return `Row-level normalisation warning: ${bare}.`;
  }
}

/**
 * The shared-family-phone impact report.
 *
 * MANDATORY and migration-specific. NoraMedi deliberately supports several
 * patients sharing one phone (families, guardians) and its inbound matchers
 * return "no match" rather than guessing when a phone is ambiguous. Importing
 * thousands of patients therefore has an invisible side effect: PRE-EXISTING
 * patients whose phone was previously unique can become ambiguous, and their
 * inbound WhatsApp/Instagram messages stop auto-linking. Nobody would notice
 * until the front desk complained, so it is measured and reported up front.
 *
 * Reads counts only — no phone number is returned, logged or reported.
 */
async function computeSharedPhoneImpact(
  clinicId: string,
  built: BuiltRow[],
): Promise<SharedPhoneImpact> {
  const sourcePhoneCounts = new Map<string, number>();
  for (const row of built) {
    const phone = row.draft?.phone;
    if (!phone) continue;
    sourcePhoneCounts.set(phone, (sourcePhoneCounts.get(phone) ?? 0) + 1);
  }

  let sourceRowsSharingPhone = 0;
  for (const count of sourcePhoneCounts.values()) {
    if (count > 1) sourceRowsSharingPhone += count;
  }

  // Existing destination phones, loaded once under the clinic scope.
  const existing = await prisma.patient.findMany({
    where: { clinicId, deletedAt: null, phone: { not: null } },
    select: { phone: true },
  });

  const destinationCounts = new Map<string, number>();
  for (const patient of existing) {
    const phone = patient.phone;
    if (!phone) continue;
    destinationCounts.set(phone, (destinationCounts.get(phone) ?? 0) + 1);
  }

  let destinationSharedBefore = 0;
  for (const count of destinationCounts.values()) {
    if (count > 1) destinationSharedBefore += count;
  }

  // Project the import onto the destination and re-measure.
  const projected = new Map(destinationCounts);
  for (const [phone, count] of sourcePhoneCounts) {
    projected.set(phone, (projected.get(phone) ?? 0) + count);
  }

  let destinationSharedAfter = 0;
  for (const count of projected.values()) {
    if (count > 1) destinationSharedAfter += count;
  }

  // The number that actually matters: patients who WERE uniquely identifiable
  // by phone and no longer will be.
  let preExistingFlippedToAmbiguous = 0;
  for (const [phone, before] of destinationCounts) {
    if (before === 1 && (projected.get(phone) ?? 0) > 1) {
      preExistingFlippedToAmbiguous++;
    }
  }

  return {
    destinationSharedBefore,
    destinationSharedAfter,
    preExistingFlippedToAmbiguous,
    sourceRowsSharingPhone,
  };
}

/** Guard used by the route: a dry run must exist and be clean before execution. */
export function assertExecutable(summary: DryRunSummary | null): asserts summary is DryRunSummary {
  if (!summary) {
    throw new MigrationError('MIGRATION_STATE_INVALID', {
      message: 'A dry run must be completed before this migration can be executed.',
    });
  }
  if (!summary.executable) {
    throw new MigrationError('MIGRATION_STATE_INVALID', {
      message: `This migration cannot be executed while ${summary.blockers.length} blocker(s) remain. Resolve them and run the dry run again.`,
    });
  }
  /*
   * F3-DATA-MIG-TODAY-001-R9. The persisted summary must PROVE the data-loss
   * gate ran, not merely fail to contradict it.
   *
   * `dryRunSummary` is a Json column read back from a previous request, so a
   * run whose dry run completed before this release carries `executable: true`
   * computed WITHOUT the gate. Trusting that flag alone would let exactly the
   * runs this task exists to stop walk straight through on the strength of a
   * stale verdict. An absent or unsatisfied gate is therefore not executable,
   * and the fix is the cheap, safe one: run the dry run again.
   */
  const gate = summary.dataLossGate;
  if (!gate) {
    throw new MigrationError('MIGRATION_STATE_INVALID', {
      message:
        'This dry run was produced before the source-column data-loss gate existed, so it cannot show that every column carrying data has been accounted for. Run the dry run again.',
    });
  }
  if (!gate.satisfied) {
    throw new MigrationError('MIGRATION_STATE_INVALID', {
      message: `This migration cannot be executed while source columns carrying data are unaccounted for: ${gate.systemRecommendedButUnconfirmedExclusions} unconfirmed exclusion(s), ${gate.blockedMeaningful + gate.legalBlockedMeaningful} blocked, ${gate.unmeasuredFillColumns} unmeasured, ${gate.unaccountedMeaningful} unaccounted.`,
    });
  }
}

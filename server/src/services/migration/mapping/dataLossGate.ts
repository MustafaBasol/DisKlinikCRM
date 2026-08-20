/**
 * dataLossGate.ts — F3-DATA-MIG-TODAY-001-R9-DATA-LOSS-GATE
 *
 * THE FIRST-CUSTOMER DATA-LOSS GATE. Every source column that carries
 * MEANINGFUL data must end in exactly one of four dispositions before a real
 * migration may execute:
 *
 *   1. RESOLVED                      mapped to a valid NoraMedi destination
 *   2. MANUAL_REVIEW_REQUIRED        a human still owes an answer
 *   3. SENSITIVE_REVIEW_REQUIRED     KVKK Art. 6 review still owed
 *   4. OPERATOR_CONFIRMED_EXCLUSION  a named Platform Admin deliberately
 *                                    excluded THIS column on THIS run
 *
 * ---------------------------------------------------------------------------
 * THE DEFECT THIS MODULE REPLACES
 * ---------------------------------------------------------------------------
 * R7/R8 accounted mapping states IGNORE, BLOCKED and LEGAL_BLOCKED as
 * `explicitlyExcluded`, and validateMapping.ts still described them as states
 * the operator "affirmatively chose". For the great majority of those columns
 * that was not true: nobody chose them. They arrived pre-set from
 * firstCustomerMatrix.ts — a MAPPING PROFILE, i.e. a system RECOMMENDATION
 * computed before the workbook was ever uploaded — and were written by the
 * analyze route with `isAutoSuggested: true` and no decider at all.
 *
 * A system-generated mapping-policy exclusion is NOT an operator decision to
 * discard a clinic's operational data. Counting it as one let the accounting
 * balance while dozens of columns' worth of real content silently failed to
 * arrive. So this module splits the single old bucket in two:
 *
 *   SYSTEM_RECOMMENDED_EXCLUSION   the profile/engine proposes not to import.
 *                                  A RECOMMENDATION. Blocks Execute.
 *   OPERATOR_CONFIRMED_EXCLUSION   a Platform Admin saved that decision for
 *                                  this run. Auditable. The only one that
 *                                  satisfies the gate.
 *
 * ---------------------------------------------------------------------------
 * HOW OPERATOR CONFIRMATION IS RECORDED — NO NEW WORKFLOW, NO NEW SCHEMA
 * ---------------------------------------------------------------------------
 * `MigrationFieldMapping` already carries the exact evidence, and the two write
 * paths already keep it honest:
 *
 *   analyze (POST .../analyze)   deletes and recreates every row with
 *                                `isAutoSuggested: true` and NULL
 *                                `decidedByPlatformAdminId` / `decidedAt`. So
 *                                re-analyzing a run correctly REVOKES every
 *                                prior confirmation — a confirmation is about
 *                                the column as it was measured, not about its
 *                                name.
 *   save   (PUT .../mappings)    updates ONLY the rows the operator actually
 *                                submitted, stamping `isAutoSuggested: false`,
 *                                `decidedByPlatformAdminId` and `decidedAt`.
 *                                A row nobody submitted keeps the analyze
 *                                defaults, so "not sent" can never masquerade
 *                                as "decided".
 *
 * Confirming an exclusion is therefore the action the operator already has:
 * leave the column IGNORE and save it. Nothing new to learn, nothing new to
 * migrate. All three fields are required together (fail-closed): a row with a
 * stale `isAutoSuggested: false` and no decider proves nothing.
 *
 * ---------------------------------------------------------------------------
 * FAIL-CLOSED ON UNMEASURED FILL
 * ---------------------------------------------------------------------------
 * The gate reads the REAL per-column fill count the analyzer measured from the
 * uploaded workbook (`MigrationFieldMapping.sourceProfile.filledCount`). A
 * column whose fill is missing or unparseable is UNMEASURED, and UNMEASURED is
 * NOT zero: it means nobody can say whether dropping it loses data. It blocks.
 * Only a column MEASURED at 0 filled rows may be auto-excluded, because there
 * is provably nothing there to lose.
 *
 * PRIVACY. Counts and vendor column headers only. Never a cell value, never a
 * distinct-value list, never a row identifier. The report is safe to persist on
 * the run, return over the wire and write to the audit log.
 */

import { getDestinationField } from '../contracts.js';

/**
 * The destination-catalog group that would hold PRESERVED HISTORICAL EVIDENCE —
 * a legally-gated column's own content kept as source evidence rather than
 * imported as operational data.
 *
 * NO DESTINATION DECLARES IT TODAY, and that is the point. It gives the one
 * narrow exception in this gate ("a meaningful LEGAL_BLOCKED column may pass
 * only with an ACCEPTED historical/evidence disposition") a precise, checkable
 * shape instead of leaving it to prose — while the catalog's emptiness keeps
 * the exception structurally unreachable until a program owner accepts such a
 * destination. A test asserts BOTH halves: the rule exists, and no member does.
 *
 * Note that validateMapping.ts Rule 4 independently forbids a LEGAL_BLOCKED
 * column from carrying ANY destination, so accepting one would be a deliberate,
 * reviewable change in two places, never an accident in one.
 */
export const HISTORICAL_EVIDENCE_DESTINATION_GROUP = 'historical_evidence';

/** Where a single source column ends up, for data-loss accounting. */
export type ColumnDisposition =
  /** Mapped to a real destination. Its data arrives. */
  | 'RESOLVED'
  /** Undecided: semantics unknown. Blocks. */
  | 'MANUAL_REVIEW_REQUIRED'
  /** Undecided: special-category review owed. Blocks. */
  | 'SENSITIVE_REVIEW_REQUIRED'
  /** A named Platform Admin excluded this column on this run. Satisfies the gate. */
  | 'OPERATOR_CONFIRMED_EXCLUSION'
  /** The system proposes exclusion; no human has confirmed it. Blocks. */
  | 'SYSTEM_RECOMMENDED_EXCLUSION'
  /** BLOCKED with meaningful data: an unresolved obstacle, not a decision. Blocks. */
  | 'BLOCKED_MEANINGFUL'
  /** LEGAL_BLOCKED with meaningful data and no accepted evidence disposition. Blocks. */
  | 'LEGAL_BLOCKED_MEANINGFUL'
  /** Measured at 0 filled rows. Nothing to lose; accounted separately. */
  | 'ZERO_DATA'
  /** Fill never measured. Cannot be proved safe to drop. Blocks. */
  | 'UNMEASURED_FILL'
  /** A state this gate does not recognise. Blocks. */
  | 'UNACCOUNTED';

/**
 * A persisted mapping row, loosened to a structural type so this module can
 * accept a Prisma `MigrationFieldMapping` row, an in-memory draft or a test
 * fixture without importing Prisma. Mirrors validateMapping.ts's
 * `MappingRecordLike` convention.
 */
export interface DataLossGateRecord {
  sourceField: string;
  state: string;
  destinationField?: string | null;
  /**
   * `SourceColumnProfile` as persisted in the `sourceProfile` Json column.
   * Deliberately `unknown`: it round-trips through JSON and a run created
   * before that column existed has none, so it is parsed defensively rather
   * than trusted.
   */
  sourceProfile?: unknown;
  isAutoSuggested?: boolean | null;
  decidedByPlatformAdminId?: string | null;
  decidedAt?: Date | string | null;
}

export interface ColumnAccounting {
  sourceField: string;
  state: string;
  /** Measured non-empty rows, or null when never measured. */
  filledCount: number | null;
  disposition: ColumnDisposition;
  /** True when this column alone is enough to stop Execute. */
  blocksExecute: boolean;
}

/**
 * The real data-loss equation, over REAL measured fill counts.
 *
 *   meaningfulSourceColumns
 *     = resolved + manualReview + sensitiveReview + operatorConfirmedExcluded
 *       + systemRecommendedButUnconfirmedExclusions + blockedMeaningful
 *       + legalBlockedMeaningful + unaccountedMeaningful
 *
 * and the gate is satisfied only when every term after
 * `operatorConfirmedExcluded` is zero — i.e. the four-disposition rule holds
 * with no remainder.
 *
 * Zero-data and unmeasured-fill columns are counted SEPARATELY and never folded
 * into `meaningfulSourceColumns`; an unmeasured column still blocks.
 */
export interface DataLossGateReport {
  totalSourceColumns: number;
  meaningfulSourceColumns: number;
  zeroDataColumns: number;
  unmeasuredFillColumns: number;

  resolved: number;
  manualReview: number;
  sensitiveReview: number;
  operatorConfirmedExcluded: number;

  systemRecommendedButUnconfirmedExclusions: number;
  blockedMeaningful: number;
  legalBlockedMeaningful: number;
  unaccountedMeaningful: number;

  /** True when the eight per-column terms sum exactly to `meaningfulSourceColumns`. */
  balanced: boolean;
  /** True when Execute may proceed as far as DATA LOSS is concerned. */
  satisfied: boolean;

  /* Vendor source headers only — never a cell value. Sorted, so the report is
   * deterministic across runs and diffable in an audit. */
  unconfirmedExclusionFields: string[];
  blockedMeaningfulFields: string[];
  legalBlockedMeaningfulFields: string[];
  unmeasuredFillFields: string[];
  unaccountedMeaningfulFields: string[];
}

const RESOLVED_STATES = new Set(['AUTO_CONFIDENT', 'RESOLVED']);
const MANUAL_REVIEW_STATES = new Set(['MANUAL_REQUIRED', 'AUTO_REVIEW']);

/**
 * The measured non-empty row count for a column, or `null` for UNMEASURED.
 *
 * Defensive by design. `sourceProfile` is a Json column: it may be absent (a
 * row written before it existed), `null`, a JSON string, or a shape that no
 * longer matches `SourceColumnProfile`. Every one of those is UNMEASURED, not
 * zero — guessing zero is precisely how a populated column would be dropped.
 */
export function filledCountOf(sourceProfile: unknown): number | null {
  let profile = sourceProfile;
  if (typeof profile === 'string') {
    try {
      profile = JSON.parse(profile);
    } catch {
      return null;
    }
  }
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return null;
  const value = (profile as { filledCount?: unknown }).filledCount;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null;
  return value;
}

/**
 * Did a named Platform Admin deliberately decide THIS column on THIS run?
 *
 * All three facts are required together. `isAutoSuggested === false` on its own
 * is not evidence — it is also the value a row would carry if some future write
 * path forgot to stamp a decider — and a decider without a timestamp is not an
 * auditable event. Fail-closed: anything short of the full record reads as
 * "the system proposed this", which blocks rather than passes.
 */
export function isOperatorConfirmed(record: DataLossGateRecord): boolean {
  if (record.isAutoSuggested !== false) return false;
  const decider = record.decidedByPlatformAdminId;
  if (typeof decider !== 'string' || decider.trim() === '') return false;
  return record.decidedAt !== null && record.decidedAt !== undefined;
}

/**
 * Does a legally-gated column carry an ACCEPTED historical/evidence disposition?
 *
 * See HISTORICAL_EVIDENCE_DESTINATION_GROUP. Requires BOTH a destination in
 * that group AND an operator confirmation — preserving special-category content
 * as evidence is a decision a human takes, never one a profile makes.
 */
export function hasAcceptedHistoricalEvidenceDisposition(record: DataLossGateRecord): boolean {
  const key = record.destinationField;
  if (typeof key !== 'string' || key === '') return false;
  const destination = getDestinationField(key);
  if (destination?.group !== HISTORICAL_EVIDENCE_DESTINATION_GROUP) return false;
  return isOperatorConfirmed(record);
}

/** Classify ONE column. The whole gate is this function, applied per column. */
export function classifyColumn(record: DataLossGateRecord): ColumnAccounting {
  const filledCount = filledCountOf(record.sourceProfile);
  const base = { sourceField: record.sourceField, state: record.state, filledCount };

  // Fill is the FIRST question, before state. A column nobody measured cannot
  // be shown to be safe to drop, whatever the profile recommends for it.
  if (filledCount === null) {
    return { ...base, disposition: 'UNMEASURED_FILL', blocksExecute: true };
  }
  // Measured empty. There is provably nothing to lose, so no decision is owed
  // and no operator is asked to confirm a non-event.
  if (filledCount === 0) {
    return { ...base, disposition: 'ZERO_DATA', blocksExecute: false };
  }

  const { state } = record;

  if (RESOLVED_STATES.has(state)) {
    // A writing state with nowhere to write is not resolved, it is a hole.
    // validateMappings reports it too; this gate must not paper over it.
    if (typeof record.destinationField !== 'string' || record.destinationField === '') {
      return { ...base, disposition: 'UNACCOUNTED', blocksExecute: true };
    }
    return { ...base, disposition: 'RESOLVED', blocksExecute: false };
  }

  if (MANUAL_REVIEW_STATES.has(state)) {
    return { ...base, disposition: 'MANUAL_REVIEW_REQUIRED', blocksExecute: true };
  }

  if (state === 'SENSITIVE_REVIEW_REQUIRED') {
    return { ...base, disposition: 'SENSITIVE_REVIEW_REQUIRED', blocksExecute: true };
  }

  if (state === 'IGNORE') {
    // THE CORE R9 DISTINCTION. Same state, two entirely different meanings.
    return isOperatorConfirmed(record)
      ? { ...base, disposition: 'OPERATOR_CONFIRMED_EXCLUSION', blocksExecute: false }
      : { ...base, disposition: 'SYSTEM_RECOMMENDED_EXCLUSION', blocksExecute: true };
  }

  if (state === 'BLOCKED') {
    // BLOCKED names an UNRESOLVED OBSTACLE ("no destination exists"), not a
    // decision. It is deliberately NOT confirmable in place: an operator who
    // means to drop the column moves it to IGNORE and saves, which produces a
    // confirmation record that says what they actually decided. Confirming
    // "blocked" would record an obstacle, not a choice.
    return { ...base, disposition: 'BLOCKED_MEANINGFUL', blocksExecute: true };
  }

  if (state === 'LEGAL_BLOCKED') {
    return hasAcceptedHistoricalEvidenceDisposition(record)
      ? { ...base, disposition: 'OPERATOR_CONFIRMED_EXCLUSION', blocksExecute: false }
      : { ...base, disposition: 'LEGAL_BLOCKED_MEANINGFUL', blocksExecute: true };
  }

  return { ...base, disposition: 'UNACCOUNTED', blocksExecute: true };
}

/** Run the gate over a whole mapping set and produce the accounting report. */
export function evaluateDataLossGate(records: readonly DataLossGateRecord[]): DataLossGateReport {
  const columns = records.map(classifyColumn);

  const fieldsFor = (disposition: ColumnDisposition): string[] =>
    columns
      .filter((c) => c.disposition === disposition)
      .map((c) => c.sourceField)
      .sort();

  const count = (disposition: ColumnDisposition): number =>
    columns.reduce((n, c) => (c.disposition === disposition ? n + 1 : n), 0);

  const zeroDataColumns = count('ZERO_DATA');
  const unmeasuredFillColumns = count('UNMEASURED_FILL');
  const meaningfulSourceColumns = columns.length - zeroDataColumns - unmeasuredFillColumns;

  const resolved = count('RESOLVED');
  const manualReview = count('MANUAL_REVIEW_REQUIRED');
  const sensitiveReview = count('SENSITIVE_REVIEW_REQUIRED');
  const operatorConfirmedExcluded = count('OPERATOR_CONFIRMED_EXCLUSION');
  const systemRecommendedButUnconfirmedExclusions = count('SYSTEM_RECOMMENDED_EXCLUSION');
  const blockedMeaningful = count('BLOCKED_MEANINGFUL');
  const legalBlockedMeaningful = count('LEGAL_BLOCKED_MEANINGFUL');
  const unaccountedMeaningful = count('UNACCOUNTED');

  const balanced =
    meaningfulSourceColumns ===
    resolved +
      manualReview +
      sensitiveReview +
      operatorConfirmedExcluded +
      systemRecommendedButUnconfirmedExclusions +
      blockedMeaningful +
      legalBlockedMeaningful +
      unaccountedMeaningful;

  const satisfied = balanced && columns.every((c) => !c.blocksExecute);

  return {
    totalSourceColumns: columns.length,
    meaningfulSourceColumns,
    zeroDataColumns,
    unmeasuredFillColumns,
    resolved,
    manualReview,
    sensitiveReview,
    operatorConfirmedExcluded,
    systemRecommendedButUnconfirmedExclusions,
    blockedMeaningful,
    legalBlockedMeaningful,
    unaccountedMeaningful,
    balanced,
    satisfied,
    unconfirmedExclusionFields: fieldsFor('SYSTEM_RECOMMENDED_EXCLUSION'),
    blockedMeaningfulFields: fieldsFor('BLOCKED_MEANINGFUL'),
    legalBlockedMeaningfulFields: fieldsFor('LEGAL_BLOCKED_MEANINGFUL'),
    unmeasuredFillFields: fieldsFor('UNMEASURED_FILL'),
    unaccountedMeaningfulFields: fieldsFor('UNACCOUNTED'),
  };
}

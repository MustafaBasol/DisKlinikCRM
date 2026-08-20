/**
 * platformMigrationHelpers.ts — pure, framework-free helpers for the Platform
 * Admin Migration Center wizard (F3-DATA-MIG-TODAY).
 *
 * Kept separate from the React components so the state-machine / filter /
 * arithmetic logic can be exercised by a standalone tsx test
 * (src/pages/__tests__/platformMigrationHelpers.test.ts) without a DOM or a
 * test framework, mirroring bookingWidgetHelpers.ts.
 */

import type {
  MappingDto,
  MigrationRunStatus,
  SourceColumnProfileDto,
} from '../services/platformMigrationApi';

// ---------------------------------------------------------------------------
// Wizard step routing
// ---------------------------------------------------------------------------

/** 1-based step numbers for the 9-step wizard. Step 10 (history) is a separate page. */
export const MIGRATION_STEPS = {
  TARGET: 1,
  UPLOAD: 2,
  ANALYZE: 3,
  MAPPING: 4,
  REFERENCE: 5,
  DRY_RUN: 6,
  CONFIRM: 7,
  PROGRESS: 8,
  RESULTS: 9,
} as const;

export type MigrationStepNumber = (typeof MIGRATION_STEPS)[keyof typeof MIGRATION_STEPS];

/**
 * Pure mapping from a run's server status to the wizard step an operator
 * re-entering the run should land on. Used both to resume an in-flight run on
 * mount and to jump forward automatically after every mutating call.
 *
 * Deliberately a plain switch over the full status union (not a lookup table)
 * so TypeScript's exhaustiveness check catches a status the contract adds
 * later that this function has not been taught about.
 */
export function stepForStatus(status: MigrationRunStatus): MigrationStepNumber {
  switch (status) {
    case 'CREATED':
      return MIGRATION_STEPS.UPLOAD;
    case 'UPLOADED':
      return MIGRATION_STEPS.ANALYZE;
    case 'ANALYZED':
    case 'MAPPING_REQUIRED':
      return MIGRATION_STEPS.MAPPING;
    case 'MAPPING_READY':
      return MIGRATION_STEPS.REFERENCE;
    case 'DRY_RUN_RUNNING':
    case 'DRY_RUN_COMPLETE':
    case 'BLOCKED':
      return MIGRATION_STEPS.DRY_RUN;
    case 'READY':
      return MIGRATION_STEPS.CONFIRM;
    case 'RUNNING':
    case 'PARTIAL_FAILURE':
      return MIGRATION_STEPS.PROGRESS;
    case 'COMPLETED':
    case 'FAILED':
    case 'CANCELLED':
      return MIGRATION_STEPS.RESULTS;
    default: {
      // Exhaustiveness guard — a status this function doesn't know yet must
      // fail loudly in dev/tests rather than silently stranding the operator.
      const _exhaustive: never = status;
      void _exhaustive;
      return MIGRATION_STEPS.TARGET;
    }
  }
}

// ---------------------------------------------------------------------------
// Mapping screen: filter chips
// ---------------------------------------------------------------------------

/**
 * The destination key that means "keep this legacy value verbatim as evidence".
 * Mirrored from the server catalog by literal — this module stays free of
 * server imports — and pinned by a parity test.
 */
export const PRESERVATION_DESTINATION_KEY = 'legacy.preservedSourceValue';

/**
 * WHAT THE OPERATOR SEES. F3-DATA-MIG-TODAY-001-R12.
 *
 * The mapping screen used to render the ENGINE's state machine directly:
 * AUTO_CONFIDENT, AUTO_REVIEW, SENSITIVE_REVIEW_REQUIRED, LEGAL_BLOCKED,
 * BLOCKED, IGNORE, RESOLVED — eight internal states, several of which are only
 * distinguishable if you know why the state machine has them. A Platform Admin
 * running a clinic's first migration is not, and should not have to be, an
 * expert on the KVKK Art. 6 gate or on the difference between "the system
 * proposes excluding this" and "a human excluded this".
 *
 * So there are now two vocabularies. The INTERNAL one is unchanged: nothing in
 * the state machine, the data-loss gate or the legal gate is relaxed, and the
 * server still decides everything on the internal state. The OPERATOR one is a
 * projection of it, computed here, in one place, so the whole screen agrees.
 *
 *   MATCHED       Eşleşti                — goes to a NoraMedi field
 *   PRESERVED     Saklanacak eski veri   — kept verbatim as legacy evidence
 *   NEEDS_REVIEW  Kontrol et             — a human still owes an answer
 *   EMPTY         Boş sütun              — measured at 0 values; nothing to do
 *   IGNORED       Aktarılmayacak         — decided not to carry it
 *   ERROR         Hatalı                 — carries data and cannot proceed
 */
export const OPERATOR_MAPPING_STATUSES = [
  'MATCHED',
  'PRESERVED',
  'NEEDS_REVIEW',
  'EMPTY',
  'IGNORED',
  'ERROR',
] as const;
export type OperatorMappingStatus = (typeof OPERATOR_MAPPING_STATUSES)[number];

/**
 * Project one mapping row onto the operator vocabulary.
 *
 * `profile` carries the MEASURED fill. It is optional because the profiles are
 * fetched separately from the mappings, and when it is missing the column's
 * fill is UNKNOWN — which is never reported as EMPTY. Claiming a column is
 * empty because nobody measured it is the exact fail-open the server-side
 * data-loss gate refuses (dataLossGate.ts: UNMEASURED blocks, only a measured
 * zero passes), and the screen must not contradict the gate.
 *
 * A LEGAL_BLOCKED column measured at zero reports EMPTY rather than inventing
 * an operator-facing legal concept: it is true, it is the only thing about that
 * column an operator can act on (nothing), and the recorded legal reason is
 * still rendered in the destination cell for anyone who looks. The INTERNAL
 * state stays LEGAL_BLOCKED — this projection never writes anything.
 */
export function operatorMappingStatus(
  mapping: Pick<MappingDto, 'state' | 'destinationField'>,
  profile?: Pick<SourceColumnProfileDto, 'filledCount'> | undefined,
): OperatorMappingStatus {
  const measuredEmpty = !!profile && profile.filledCount === 0;

  if (mapping.state === 'AUTO_CONFIDENT' || mapping.state === 'RESOLVED') {
    return mapping.destinationField === PRESERVATION_DESTINATION_KEY ? 'PRESERVED' : 'MATCHED';
  }
  if (
    mapping.state === 'MANUAL_REQUIRED' ||
    mapping.state === 'AUTO_REVIEW' ||
    mapping.state === 'SENSITIVE_REVIEW_REQUIRED'
  ) {
    return 'NEEDS_REVIEW';
  }
  if (mapping.state === 'IGNORE') return measuredEmpty ? 'EMPTY' : 'IGNORED';
  if (mapping.state === 'BLOCKED' || mapping.state === 'LEGAL_BLOCKED') {
    // With data and no destination this is a genuine obstacle, not a decision:
    // the run cannot execute while it stands, so it reads as an error rather
    // than quietly as "ignored".
    return measuredEmpty ? 'EMPTY' : 'ERROR';
  }
  return 'ERROR';
}

/** Does this row still cost the operator something? Drives the "kalan iş" count. */
export function operatorNeedsAction(status: OperatorMappingStatus): boolean {
  return status === 'NEEDS_REVIEW' || status === 'ERROR';
}

/**
 * The chips, in the operator's vocabulary.
 *
 * R12 replaced the previous engine-state chips (`unresolved`, `blocked`,
 * `legal`, `auto`, `unmappedWithData`) with these. The old set asked the
 * operator to filter by concepts they had to learn first, and two of them —
 * `blocked` and `legal` — were mostly measured-empty columns, i.e. a chip whose
 * whole result set was noise.
 */
export const MAPPING_FILTER_IDS = [
  'all',
  'needsReview',
  'matched',
  'preserved',
  'ignored',
  'empty',
  'error',
  'headerless',
] as const;
export type MappingFilterId = (typeof MAPPING_FILTER_IDS)[number];

/**
 * The identity fields every mapping-screen predicate needs. `sourceHeader` is
 * OPTIONAL here (rather than a plain `Pick<MappingDto, 'sourceHeader' | ...>`)
 * for one reason only: a response from a backend older than
 * F3-DATA-MIG-TODAY-001-FINAL-R7 has no such property at all, and that
 * "absent" case is exactly what `isHeaderlessMapping` must be able to tell
 * apart from an explicit `null`. Making it required would make the legacy
 * shape unrepresentable in TypeScript and push the distinction into casts.
 */
export type MappingIdentity = Pick<MappingDto, 'sourceField' | 'sourceIndex'> &
  Partial<Pick<MappingDto, 'sourceHeader'>>;

/**
 * Is this column's workbook header cell blank?
 *
 * AUTHORITATIVE FIRST: when the payload carries `sourceHeader` at all (the
 * property exists — including the value `null`), that value decides, because
 * the server persists it from the parser's `CanonicalHeader.headerWasBlank`.
 * That doc block in server/src/services/migration/contracts.ts explicitly
 * forbids identifying a headerless column by string-matching the synthesized
 * `COLUMN_<index>` name: a real vendor header could coincidentally BE that
 * string, and mislabelling it "Başlık yok" would hide the column's true
 * identity from the operator making the mapping decision.
 *
 * LEGACY FALLBACK, only when the property is absent entirely: fall back to the
 * name shape — but ANCHORED TO THE PHYSICAL INDEX. `COLUMN_7` is only treated
 * as synthesized when it sits at index 7, which is how canonicalParser.ts
 * builds the name. This is strictly stronger than the previous bare
 * `parseUnnamedColumnIndex(sourceField) !== null` test, which called any
 * `COLUMN_<digits>` header headerless wherever it appeared.
 */
export function isHeaderlessMapping(mapping: MappingIdentity): boolean {
  if (mapping != null && Object.prototype.hasOwnProperty.call(mapping, 'sourceHeader')) {
    return mapping.sourceHeader === null;
  }
  return parseUnnamedColumnIndex(mapping.sourceField) === mapping.sourceIndex;
}

/**
 * Chip predicate, in the operator vocabulary.
 *
 * Every chip except `all` and `headerless` is exactly one
 * `operatorMappingStatus` bucket, so a chip can never disagree with the badge
 * rendered on the row it hides or shows — the previous chips were an
 * independent second classification of the same rows and had already drifted
 * from what the badges said.
 *
 * `headerless` stays state-independent: a column whose workbook header cell was
 * blank can land in any state, and an operator reviewing "the columns with no
 * name" wants all of them together.
 *
 * `profile` is optional because the profiles are fetched separately from the
 * mappings. When it is missing the fill is UNKNOWN, and the projection above
 * never reports UNKNOWN as EMPTY — so an unmeasured column shows up under the
 * chip for whatever its state says, never under `empty`.
 */
export function mappingMatchesFilter(
  mapping: Pick<MappingDto, 'state' | 'destinationField'> & MappingIdentity,
  filter: MappingFilterId,
  profile?: Pick<SourceColumnProfileDto, 'filledCount'> | undefined,
): boolean {
  if (filter === 'all') return true;
  if (filter === 'headerless') return isHeaderlessMapping(mapping);

  const status = operatorMappingStatus(mapping, profile);
  switch (filter) {
    case 'needsReview':
      return status === 'NEEDS_REVIEW';
    case 'matched':
      return status === 'MATCHED';
    case 'preserved':
      return status === 'PRESERVED';
    case 'ignored':
      return status === 'IGNORED';
    case 'empty':
      return status === 'EMPTY';
    case 'error':
      return status === 'ERROR';
    default:
      return true;
  }
}

/**
 * Parses the numeric index out of a synthesized `COLUMN_<physicalIndex>`
 * source-field name (canonicalParser.ts, `UNNAMED_COLUMN_PREFIX`), or null
 * when the name has some other shape. Mirrors the server's prefix by string
 * literal (not an import — this module stays framework/runtime-free) since
 * the prefix is a public, stable part of the wire contract's column-naming
 * convention.
 *
 * NOT a headerless test on its own — use `isHeaderlessMapping`. A real vendor
 * header can literally be the text `COLUMN_43`, so this shape check is only
 * ever the index-anchored LEGACY fallback for a payload that predates the
 * authoritative `sourceHeader` field. Kept exported for that one use and for
 * its own tests.
 */
export function parseUnnamedColumnIndex(sourceField: string): number | null {
  const match = /^COLUMN_(\d+)$/.exec(sourceField);
  if (!match) return null;
  return Number(match[1]);
}

/**
 * Physical workbook column identity: 0-based index -> Excel-style letter
 * (0 -> 'A', 25 -> 'Z', 26 -> 'AA', 701 -> 'ZZ', 702 -> 'AAA', ...). Standard
 * bijective base-26 conversion (no zero digit), deliberately independent of
 * the source column's header text — a synthesized or duplicate header must
 * never change what physical column an operator thinks they are looking at
 * (F3-DATA-MIG-TODAY-001-UI-006-R6, requirement A).
 */
export function excelColumnLetter(zeroBasedIndex: number): string {
  let n = zeroBasedIndex + 1;
  let letters = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/**
 * Physical workbook coordinate for one column, in the single convention the
 * whole mapping screen uses: `AQ (43)` — Excel letter first, 1-based physical
 * column number in parentheses. Both halves are derived from `sourceIndex`
 * alone, never from header text.
 */
export function excelColumnCoordinate(sourceIndex: number): { letter: string; number: number } {
  return { letter: excelColumnLetter(sourceIndex), number: sourceIndex + 1 };
}

/** Every field the search box may match a column on. */
export type MappingSearchable = MappingIdentity &
  Partial<Pick<MappingDto, 'sourceLabel' | 'sourceNormalized'>>;

/**
 * Does this column match the operator's free-text search?
 *
 * NULL-SAFE ON EVERY FIELD BY CONSTRUCTION. The previous implementation called
 * `mapping.sourceLabel.toLowerCase()` directly; because `||` short-circuits,
 * that only blew up when `sourceField` did NOT match first — i.e. typing a
 * query that should have shown "no results" threw a TypeError inside a
 * render-phase useMemo and took the whole mapping screen down. Nothing here
 * dereferences a value it has not type-checked as a string first, so an
 * older/partial backend degrades to "this field doesn't match" rather than
 * crashing.
 *
 * Matching rules:
 *  - SUBSTRING, case-insensitive, over the textual identifiers (original
 *    header, technical/synthesized source field, normalized form, label).
 *  - WHOLE TOKEN for the two physical coordinates, because they are addresses,
 *    not text: the Excel letter must EQUAL the query (`AQ` finds index 42;
 *    `A` must not drag in every column from A to AZ), and the 1-based column
 *    number must EQUAL the query (`43` finds index 42; `4` must not match 43,
 *    44 or 14).
 */
export function mappingMatchesQuery(mapping: MappingSearchable, query: string): boolean {
  const q = typeof query === 'string' ? query.trim().toLowerCase() : '';
  if (!q) return true;
  if (mapping == null) return false;

  const textual: unknown[] = [
    mapping.sourceHeader,
    mapping.sourceField,
    mapping.sourceNormalized,
    mapping.sourceLabel,
  ];
  for (const candidate of textual) {
    if (typeof candidate === 'string' && candidate.toLowerCase().includes(q)) return true;
  }

  if (typeof mapping.sourceIndex === 'number' && Number.isFinite(mapping.sourceIndex)) {
    if (excelColumnLetter(mapping.sourceIndex).toLowerCase() === q) return true;
    if (String(mapping.sourceIndex + 1) === q) return true;
  }

  return false;
}

/**
 * Combined predicate the mapping table's toolbar applies to each row. The
 * column profile is optional and feeds the operator-status projection every
 * chip is derived from (see `mappingMatchesFilter`).
 */
export function mappingRowVisible(
  mapping: Pick<MappingDto, 'state' | 'destinationField'> & MappingSearchable,
  filter: MappingFilterId,
  query: string,
  profile?: Pick<SourceColumnProfileDto, 'filledCount'> | undefined,
): boolean {
  return mappingMatchesFilter(mapping, filter, profile) && mappingMatchesQuery(mapping, query);
}

// ---------------------------------------------------------------------------
// Reconciliation arithmetic
// ---------------------------------------------------------------------------

export interface ReconciliationBalanceInput {
  eligibleTotal: number;
  created: number;
  reused: number;
  skipped: number;
  failed: number;
  manualReview: number;
  blocked: number;
}

/**
 * The single authoritative reconciliation invariant, mirrored from
 * server/src/services/migration/contracts.ts::isReconciliationBalanced.
 * Kept as a client-side copy (not imported — the server module is not
 * bundle-safe for the browser) so the Results step can show the arithmetic
 * AND assert it balances using the exact same rule the backend does.
 */
export function isReconciliationBalanced(r: ReconciliationBalanceInput): boolean {
  return r.eligibleTotal === r.created + r.reused + r.skipped + r.failed + r.manualReview + r.blocked;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Client-side mirror of the server's MAX_UPLOAD_BYTES (32 MiB) — a fast, friendly guard only. */
export const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;

/** Byte-size formatter for the upload dropzone and run tables. Binary (1024) units. */
export function formatByteSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/** Fill-rate / confidence percentage formatter — DryRunSummary and profiles report 0..1 ratios. */
export function formatPercent(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return '—';
  return `${Math.round(ratio * 100)}%`;
}

// ---------------------------------------------------------------------------
// Status → badge class
// ---------------------------------------------------------------------------

export type BadgeClass = 'badge-gray' | 'badge-blue' | 'badge-yellow' | 'badge-red' | 'badge-green';

/**
 * Deterministic status → badge-class mapping shared by the wizard header, the
 * history table and the resumed-run banner, so a given status always reads
 * the same colour everywhere in the feature.
 */
export function statusBadgeClass(status: MigrationRunStatus): BadgeClass {
  switch (status) {
    case 'CREATED':
    case 'UPLOADED':
    case 'ANALYZED':
    case 'MAPPING_REQUIRED':
    case 'CANCELLED':
      return 'badge-gray';
    case 'MAPPING_READY':
    case 'DRY_RUN_RUNNING':
    case 'RUNNING':
      return 'badge-blue';
    case 'DRY_RUN_COMPLETE':
    case 'READY':
    case 'PARTIAL_FAILURE':
      return 'badge-yellow';
    case 'BLOCKED':
    case 'FAILED':
      return 'badge-red';
    case 'COMPLETED':
      return 'badge-green';
    default: {
      const _exhaustive: never = status;
      void _exhaustive;
      return 'badge-gray';
    }
  }
}

/** Statuses the progress poller must treat as "still running". */
export function isRunInFlight(status: MigrationRunStatus): boolean {
  return status === 'RUNNING' || status === 'DRY_RUN_RUNNING';
}

/** Statuses from which no further transition is possible except a fresh run. */
export function isTerminalRunStatus(status: MigrationRunStatus): boolean {
  return status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED';
}

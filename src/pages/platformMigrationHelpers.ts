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

export const MAPPING_FILTER_IDS = [
  'all',
  'unresolved',
  'unmappedWithData',
  'blocked',
  'legal',
  'headerless',
  'ignored',
  'auto',
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
 * Chip predicate. `unresolved` covers both MANUAL_REQUIRED (no destination
 * chosen yet) and AUTO_REVIEW (a suggestion exists but confidence was too low
 * to auto-accept) — both need an operator decision before Continue unblocks.
 * `headerless` covers every column whose workbook header cell was blank
 * (state-independent — a headerless column can land in any mapping state),
 * so an operator can review every synthesized-name column as a group
 * regardless of what the engine decided about each one individually.
 *
 * `unmappedWithData` is the triage chip: columns that still need a human
 * decision AND actually carry values. It needs the column's profile, which is
 * fetched separately from the mappings, so `profile` is an OPTIONAL third
 * parameter — every existing call site keeps compiling. When it is missing the
 * column's fill is UNKNOWN, and an unknown column is never claimed to have
 * data (returns false) rather than padding the chip with maybes.
 */
export function mappingMatchesFilter(
  mapping: Pick<MappingDto, 'state'> & MappingIdentity,
  filter: MappingFilterId,
  profile?: Pick<SourceColumnProfileDto, 'filledCount'> | undefined,
): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'unresolved':
      return mapping.state === 'MANUAL_REQUIRED' || mapping.state === 'AUTO_REVIEW';
    case 'unmappedWithData': {
      const needsDecision =
        mapping.state === 'MANUAL_REQUIRED' ||
        mapping.state === 'AUTO_REVIEW' ||
        mapping.state === 'SENSITIVE_REVIEW_REQUIRED';
      if (!needsDecision) return false;
      return !!profile && profile.filledCount > 0;
    }
    case 'blocked':
      return mapping.state === 'BLOCKED';
    case 'legal':
      return mapping.state === 'LEGAL_BLOCKED';
    case 'headerless':
      return isHeaderlessMapping(mapping);
    case 'ignored':
      return mapping.state === 'IGNORE';
    case 'auto':
      return mapping.state === 'AUTO_CONFIDENT';
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
 * column profile is optional and only consumed by the `unmappedWithData` chip
 * (see `mappingMatchesFilter`).
 */
export function mappingRowVisible(
  mapping: Pick<MappingDto, 'state'> & MappingSearchable,
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

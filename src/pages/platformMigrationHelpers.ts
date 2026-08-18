/**
 * platformMigrationHelpers.ts — pure, framework-free helpers for the Platform
 * Admin Migration Center wizard (F3-DATA-MIG-TODAY).
 *
 * Kept separate from the React components so the state-machine / filter /
 * arithmetic logic can be exercised by a standalone tsx test
 * (src/pages/__tests__/platformMigrationHelpers.test.ts) without a DOM or a
 * test framework, mirroring bookingWidgetHelpers.ts.
 */

import type { MappingDto, MigrationRunStatus } from '../services/platformMigrationApi';

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

export const MAPPING_FILTER_IDS = ['all', 'unresolved', 'blocked', 'legal', 'ignored', 'auto'] as const;
export type MappingFilterId = (typeof MAPPING_FILTER_IDS)[number];

/**
 * Chip predicate. `unresolved` covers both MANUAL_REQUIRED (no destination
 * chosen yet) and AUTO_REVIEW (a suggestion exists but confidence was too low
 * to auto-accept) — both need an operator decision before Continue unblocks.
 */
export function mappingMatchesFilter(mapping: Pick<MappingDto, 'state'>, filter: MappingFilterId): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'unresolved':
      return mapping.state === 'MANUAL_REQUIRED' || mapping.state === 'AUTO_REVIEW';
    case 'blocked':
      return mapping.state === 'BLOCKED';
    case 'legal':
      return mapping.state === 'LEGAL_BLOCKED';
    case 'ignored':
      return mapping.state === 'IGNORE';
    case 'auto':
      return mapping.state === 'AUTO_CONFIDENT';
    default:
      return true;
  }
}

/** Case-insensitive substring match over the source column's identifying text. */
export function mappingMatchesQuery(
  mapping: Pick<MappingDto, 'sourceField' | 'sourceLabel' | 'sourceNormalized'>,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    mapping.sourceField.toLowerCase().includes(q) ||
    mapping.sourceLabel.toLowerCase().includes(q) ||
    mapping.sourceNormalized.toLowerCase().includes(q)
  );
}

/** Combined predicate the mapping table's toolbar applies to each row. */
export function mappingRowVisible(
  mapping: Pick<MappingDto, 'state' | 'sourceField' | 'sourceLabel' | 'sourceNormalized'>,
  filter: MappingFilterId,
  query: string,
): boolean {
  return mappingMatchesFilter(mapping, filter) && mappingMatchesQuery(mapping, query);
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

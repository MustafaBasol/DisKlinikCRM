/**
 * runState.ts — F3-DATA-MIG-TODAY-001
 *
 * The migration run state machine. Transitions are an explicit allow-list:
 * anything not listed is rejected with MIGRATION_STATE_INVALID.
 *
 * Why an allow-list rather than "any status may become any other": a migration
 * is a sequence of gates that each exist to stop a specific defect. Executing
 * before a dry run means executing without a plan-limit check and without a
 * blocker count. Re-uploading over a RUNNING run means the executor reads a
 * file that no longer matches the mapping it validated. A permissive state
 * model would let a UI bug, a double-click or a stale browser tab skip a gate
 * silently, so the gates live here, in the server, keyed on persisted state.
 */

import { MigrationError, type MigrationRunStatus, TERMINAL_RUN_STATUSES } from './contracts.js';

/**
 * Allowed transitions, keyed by the CURRENT status.
 *
 * Design notes on the loops, which are deliberate rather than accidental:
 *  - ANALYZED / MAPPING_* / DRY_RUN_COMPLETE / BLOCKED / READY all accept a return to
 *    UPLOADED, because re-uploading a corrected workbook is a normal operator
 *    action and must reset the downstream decisions rather than silently reuse
 *    a mapping validated against different headers.
 *  - MAPPING_READY <-> MAPPING_REQUIRED loops while the operator edits.
 *  - RUNNING -> PARTIAL_FAILURE -> RUNNING is the retry/resume path.
 *  - Nothing leaves COMPLETED, FAILED or CANCELLED. Rerunning is a NEW run,
 *    which is what keeps each run's report and reconciliation immutable.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<MigrationRunStatus, readonly MigrationRunStatus[]>> = {
  CREATED: ['UPLOADED', 'CANCELLED', 'FAILED'],
  UPLOADED: ['ANALYZED', 'UPLOADED', 'FAILED', 'CANCELLED'],
  ANALYZED: ['MAPPING_REQUIRED', 'MAPPING_READY', 'UPLOADED', 'FAILED', 'CANCELLED'],
  MAPPING_REQUIRED: ['MAPPING_READY', 'MAPPING_REQUIRED', 'UPLOADED', 'FAILED', 'CANCELLED'],
  MAPPING_READY: [
    'DRY_RUN_RUNNING',
    'MAPPING_REQUIRED',
    'MAPPING_READY',
    'UPLOADED',
    'FAILED',
    'CANCELLED',
  ],
  DRY_RUN_RUNNING: ['DRY_RUN_COMPLETE', 'BLOCKED', 'FAILED', 'CANCELLED'],
  DRY_RUN_COMPLETE: [
    'READY',
    'BLOCKED',
    'DRY_RUN_RUNNING',
    'MAPPING_REQUIRED',
    'UPLOADED',
    'FAILED',
    'CANCELLED',
  ],
  BLOCKED: [
    'MAPPING_REQUIRED',
    'MAPPING_READY',
    'DRY_RUN_RUNNING',
    'UPLOADED',
    'FAILED',
    'CANCELLED',
  ],
  READY: ['RUNNING', 'DRY_RUN_RUNNING', 'MAPPING_REQUIRED', 'UPLOADED', 'FAILED', 'CANCELLED'],
  RUNNING: ['COMPLETED', 'PARTIAL_FAILURE', 'FAILED', 'CANCELLED'],
  PARTIAL_FAILURE: ['RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

export function isTerminalStatus(status: MigrationRunStatus): boolean {
  return TERMINAL_RUN_STATUSES.includes(status);
}

export function canTransition(from: MigrationRunStatus, to: MigrationRunStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function allowedNextStatuses(from: MigrationRunStatus): readonly MigrationRunStatus[] {
  return ALLOWED_TRANSITIONS[from] ?? [];
}

/**
 * Throws MIGRATION_STATE_INVALID (HTTP 409) when the transition is not allowed.
 * The message names both states so the operator understands what happened; it
 * carries no run content.
 */
export function assertTransition(from: MigrationRunStatus, to: MigrationRunStatus): void {
  if (canTransition(from, to)) return;
  throw new MigrationError('MIGRATION_STATE_INVALID', {
    message: `A migration run in status ${from} cannot move to ${to}.`,
    detail: `allowed=${allowedNextStatuses(from).join(',') || 'none'}`,
  });
}

/**
 * Guard for the action-shaped endpoints: "this action requires one of these
 * statuses". Separate from assertTransition because the useful error for an
 * operator who clicked Execute too early names the ACTION, not the transition.
 */
export function assertStatusIn(
  current: MigrationRunStatus,
  allowed: readonly MigrationRunStatus[],
  action: string,
): void {
  if (allowed.includes(current)) return;
  throw new MigrationError('MIGRATION_STATE_INVALID', {
    message: `${action} is not available while the run is in status ${current}.`,
    detail: `required=${allowed.join(',')}`,
  });
}

/**
 * The status an operator's browser should resume at. Exported so the API and
 * the UI agree on one definition rather than each inventing its own.
 */
export function isResumable(status: MigrationRunStatus): boolean {
  return status === 'RUNNING' || status === 'PARTIAL_FAILURE';
}

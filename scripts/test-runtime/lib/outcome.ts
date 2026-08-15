/**
 * Pure exit-status combination logic — the cleanup-failure policy from
 * docs/program/evidence/F1-003-P2A_DISPOSABLE_RUNTIME_PROVISIONING_DESIGN.md
 * §12 (§F), reconciled/finalized version (supersedes the original design's
 * warn-only rule):
 *
 *  - setup failure (guard/readiness/migration) before tests start -> FAIL.
 *  - test failure -> FAIL, real exit code preserved, never swallowed.
 *  - cleanup failure after successful tests -> FAIL the runtime job.
 *  - cleanup failure after failed tests -> preserve the original test
 *    failure as primary; separately, additionally report the cleanup
 *    failure (not conflated into one opaque message).
 */

export interface TestPhaseResult {
  /** Did the test command actually get invoked (i.e. setup/guard/migration succeeded)? */
  ranTests: boolean;
  /** Real child-process exit code of the test command; null if never ran. */
  testExitCode: number | null;
  /** Populated when ranTests is false — the setup/guard/migration failure reason. */
  setupFailureReason?: string;
}

export interface CleanupResult {
  success: boolean;
  errors: string[];
}

export interface CombinedOutcome {
  exitCode: number;
  reasons: string[];
}

/**
 * F4-CI-L4-STORAGE-GATE-001 — distinct, greppable exit codes for the three
 * fail-closed conditions this task adds. They are deliberately not 1: a
 * reviewer reading a red job must be able to tell "the suite failed" from
 * "the suite never proved it ran" from "the process died silently" without
 * reading the whole log.
 */
export const EXIT_NO_EXECUTION_PROOF = 90;
export const EXIT_ABNORMAL_TERMINATION = 91;
export const EXIT_UNCAUGHT_ERROR = 92;
export const EXIT_SUMMARY_WRITE_FAILED = 94;

/**
 * Positive-execution evidence for the profile's test phase, as evaluated by
 * lib/executionProof.ts. `required: false` means the profile does not carry
 * a receipt contract (postgres/postgres-compat today) and the field is
 * informational only.
 */
export interface ExecutionProofOutcome {
  required: boolean;
  satisfied: boolean;
  executedCount: number;
  failures: string[];
}

/**
 * F4-CI-L4-STORAGE-GATE-001: `executionProof` is optional so existing callers
 * (postgres/postgres-compat) are unaffected. When it is present AND required,
 * a test-phase exit code of 0 is NOT sufficient for an overall pass — the run
 * must additionally have proved the intended suite executed. This is the
 * fail-open fix: "the child exited 0" can no longer, by itself, produce a
 * green run.
 */
export function combineOutcome(
  testPhase: TestPhaseResult,
  cleanup: CleanupResult,
  executionProof?: ExecutionProofOutcome,
): CombinedOutcome {
  const reasons: string[] = [];
  let exitCode: number;

  if (!testPhase.ranTests) {
    exitCode = 1;
    reasons.push(`setup failure before tests started: ${testPhase.setupFailureReason ?? 'unknown'}`);
  } else {
    exitCode = testPhase.testExitCode ?? 1;
    reasons.push(exitCode === 0 ? 'tests passed' : `tests failed with exit code ${exitCode}`);
  }

  if (executionProof?.required) {
    if (executionProof.satisfied) {
      reasons.push(`execution proof satisfied (${executionProof.executedCount} test case(s) executed)`);
    } else {
      reasons.push(
        `execution proof NOT satisfied — refusing to report success without evidence the intended suite ran: ${
          executionProof.failures.join('; ') || 'unknown'
        }`,
      );
      if (exitCode === 0) {
        exitCode = EXIT_NO_EXECUTION_PROOF;
      }
    }
  }

  if (!cleanup.success) {
    reasons.push(`cleanup failed: ${cleanup.errors.join('; ') || 'unknown cleanup error'}`);
    if (exitCode === 0) {
      exitCode = 1;
    }
    // else: a nonzero exit is already set (setup or test failure) — preserved
    // as the primary failure; the cleanup failure is reported separately
    // above, not merged into a single opaque code/message.
  } else {
    reasons.push('cleanup succeeded');
  }

  return { exitCode, reasons };
}

/** Stale-resource TTL check — pure, deterministic given an explicit "now". */
export function isStale(createdAtIso: string, ttlHours: number, nowMs: number): boolean {
  const createdMs = Date.parse(createdAtIso);
  if (!Number.isFinite(createdMs)) return false;
  return nowMs - createdMs > ttlHours * 3600 * 1000;
}

export const DEFAULT_STALE_TTL_HOURS = 4;

export function resolveStaleTtlHours(envValue: string | undefined): number {
  const parsed = Number(envValue);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_STALE_TTL_HOURS;
}

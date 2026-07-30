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

export function combineOutcome(testPhase: TestPhaseResult, cleanup: CleanupResult): CombinedOutcome {
  const reasons: string[] = [];
  let exitCode: number;

  if (!testPhase.ranTests) {
    exitCode = 1;
    reasons.push(`setup failure before tests started: ${testPhase.setupFailureReason ?? 'unknown'}`);
  } else {
    exitCode = testPhase.testExitCode ?? 1;
    reasons.push(exitCode === 0 ? 'tests passed' : `tests failed with exit code ${exitCode}`);
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

/**
 * F4-CI-L4-STORAGE-GATE-001 — positive proof that the intended test suite
 * actually executed.
 *
 * Why this exists
 * ---------------
 * Before this module the orchestrator's only evidence that the storage suite
 * ran was "the `npm run <script>` child process exited 0". That is a
 * fail-OPEN signal in three separate ways:
 *
 *   1. An npm aggregate that resolves to zero underlying commands, or a suite
 *      whose `main()` short-circuits before asserting anything, exits 0.
 *   2. The child never being spawned at all (the orchestrator terminating
 *      before that point) leaves `process.exitCode` unset, which Node reports
 *      as 0.
 *   3. Nothing downstream — not the orchestrator, not the npm script, not the
 *      CI job — ever checked how many assertions actually ran.
 *
 * The fix is an execution RECEIPT: the suite itself writes a machine-readable
 * record of what it executed to a path the orchestrator dictates, and the
 * orchestrator refuses to report success unless that record exists, parses,
 * shows a non-zero executed count, shows zero failures, and contains every
 * member the profile is contractually required to exercise.
 *
 * Every function here is pure (no fs, no Docker, no process state) so the
 * whole gate is unit-testable without a container runtime.
 */

/** One executed test case as recorded by the suite. */
export interface ExecutionReceiptEntry {
  /** Stable identifier, set explicitly by the suite for contractual members. */
  id?: string;
  /** Human-readable test name. */
  name: string;
  status: 'passed' | 'failed';
}

export interface ExecutionReceipt {
  suite: string;
  /** The orchestrator run id that requested this suite — binds the receipt to THIS run. */
  runId: string;
  startedAt: string;
  finishedAt: string;
  passed: number;
  failed: number;
  entries: ExecutionReceiptEntry[];
}

export type ParsedReceipt =
  | { ok: true; receipt: ExecutionReceipt }
  | { ok: false; error: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseEntries(raw: unknown): ExecutionReceiptEntry[] | string {
  if (!Array.isArray(raw)) return 'receipt "entries" is not an array';
  const entries: ExecutionReceiptEntry[] = [];
  for (const [index, item] of raw.entries()) {
    if (!isPlainObject(item)) return `receipt entry #${index} is not an object`;
    const { id, name, status } = item;
    if (typeof name !== 'string' || name.length === 0) return `receipt entry #${index} has no name`;
    if (status !== 'passed' && status !== 'failed') return `receipt entry #${index} has invalid status`;
    entries.push({ ...(typeof id === 'string' && id.length > 0 ? { id } : {}), name, status });
  }
  return entries;
}

/**
 * Strict parse. Anything unexpected is an error, never a silently-coerced
 * default — a malformed receipt must fail the run, not be repaired into a
 * passing one.
 */
export function parseExecutionReceipt(raw: string): ParsedReceipt {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    return { ok: false, error: `receipt is not valid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!isPlainObject(data)) return { ok: false, error: 'receipt is not a JSON object' };

  const { suite, runId, startedAt, finishedAt, passed, failed } = data;
  if (typeof suite !== 'string' || suite.length === 0) return { ok: false, error: 'receipt has no "suite"' };
  if (typeof runId !== 'string' || runId.length === 0) return { ok: false, error: 'receipt has no "runId"' };
  if (typeof startedAt !== 'string' || startedAt.length === 0) return { ok: false, error: 'receipt has no "startedAt"' };
  if (typeof finishedAt !== 'string' || finishedAt.length === 0) return { ok: false, error: 'receipt has no "finishedAt"' };
  if (!Number.isInteger(passed) || (passed as number) < 0) return { ok: false, error: 'receipt "passed" is not a non-negative integer' };
  if (!Number.isInteger(failed) || (failed as number) < 0) return { ok: false, error: 'receipt "failed" is not a non-negative integer' };

  const entries = parseEntries(data.entries);
  if (typeof entries === 'string') return { ok: false, error: entries };

  const countedPassed = entries.filter((e) => e.status === 'passed').length;
  const countedFailed = entries.filter((e) => e.status === 'failed').length;
  if (countedPassed !== passed || countedFailed !== failed) {
    return {
      ok: false,
      error: `receipt counters disagree with its own entries (declared ${passed}/${failed} passed/failed, entries show ${countedPassed}/${countedFailed})`,
    };
  }

  return { ok: true, receipt: { suite, runId, startedAt, finishedAt, passed, failed, entries } };
}

export interface ExecutionProofRequirements {
  expectedSuite: string;
  /** The orchestrator run id this receipt must be bound to. */
  expectedRunId: string;
  /** Test ids the profile is contractually required to have executed AND passed. */
  requiredMemberIds: readonly string[];
  /** Floor on total executed cases — a suite that runs "almost nothing" is not proof. */
  minimumExecuted: number;
}

export interface ExecutionProof {
  satisfied: boolean;
  executedCount: number;
  passedCount: number;
  failedCount: number;
  /** Required member ids that were not executed, or executed but failed. */
  missingRequiredMemberIds: string[];
  failures: string[];
}

/** Proof for the case where no receipt could be read at all. */
export function noReceiptProof(reason: string): ExecutionProof {
  return {
    satisfied: false,
    executedCount: 0,
    passedCount: 0,
    failedCount: 0,
    missingRequiredMemberIds: [],
    failures: [reason],
  };
}

export function evaluateExecutionProof(
  receipt: ExecutionReceipt,
  requirements: ExecutionProofRequirements,
): ExecutionProof {
  const failures: string[] = [];
  const executedCount = receipt.entries.length;

  if (receipt.suite !== requirements.expectedSuite) {
    failures.push(`receipt is for suite "${receipt.suite}", expected "${requirements.expectedSuite}"`);
  }
  if (receipt.runId !== requirements.expectedRunId) {
    failures.push(
      `receipt is bound to run "${receipt.runId}", not this run ("${requirements.expectedRunId}") — a stale receipt from an earlier run is not proof that this run executed anything`,
    );
  }
  if (executedCount === 0) {
    failures.push('receipt records zero executed test cases — a run that executed nothing is not a pass');
  } else if (executedCount < requirements.minimumExecuted) {
    failures.push(
      `receipt records ${executedCount} executed test case(s), below the required minimum of ${requirements.minimumExecuted}`,
    );
  }
  if (receipt.failed > 0) {
    failures.push(`receipt records ${receipt.failed} failed test case(s)`);
  }

  const passedIds = new Set(receipt.entries.filter((e) => e.status === 'passed' && e.id).map((e) => e.id as string));
  const missingRequiredMemberIds = requirements.requiredMemberIds.filter((id) => !passedIds.has(id));
  if (missingRequiredMemberIds.length > 0) {
    failures.push(
      `required suite member(s) did not execute-and-pass: ${missingRequiredMemberIds.join(', ')}`,
    );
  }

  return {
    satisfied: failures.length === 0,
    executedCount,
    passedCount: receipt.passed,
    failedCount: receipt.failed,
    missingRequiredMemberIds,
    failures,
  };
}

/**
 * The storage profile's contract. These ids are set explicitly on the
 * corresponding cases in
 * server/src/tests/dbVerification/fileBackupDbIntegration.test.ts — renaming a
 * test there does not silently drop it from this gate, but deleting or
 * skipping it does fail the gate, which is the point.
 */
export const STORAGE_SUITE_NAME = 'fileBackupDbIntegration';

export const STORAGE_REQUIRED_MEMBER_IDS = [
  'local-first-run-backs-up-seeded-files',
  'local-destination-bytes-match-source',
  's3-bucket-created',
  's3-destination-kind-and-offhost-classification',
  's3-backup-run-uploads-and-verifies',
  's3-independent-read-back',
  's3-missing-object-restore-fails-cleanly',
  's3-corruption-detected-at-restore',
] as const;

/**
 * Floor, not a target. Set below the suite's real case count on purpose so
 * ordinary test additions/removals do not churn this constant, while a
 * catastrophically truncated run (the failure mode this task exists to catch)
 * still trips it.
 */
export const STORAGE_MINIMUM_EXECUTED = 20;

export function storageExecutionProofRequirements(runId: string): ExecutionProofRequirements {
  return {
    expectedSuite: STORAGE_SUITE_NAME,
    expectedRunId: runId,
    requiredMemberIds: STORAGE_REQUIRED_MEMBER_IDS,
    minimumExecuted: STORAGE_MINIMUM_EXECUTED,
  };
}

/**
 * F4-CI-L4-STORAGE-GATE-001 — the CI-side hard gate over a Layer 4 storage
 * run summary.
 *
 * This is a SECOND, independent check on top of the orchestrator's own
 * fail-closed logic, and it exists because the two failures this task fixes
 * were both "nobody ever looked":
 *
 *   - the orchestrator could exit 0 having executed nothing, and
 *   - the workflow only validated the summary artifact `if: failure()`, so on
 *     the (vacuously) green path the artifact was never parsed, never
 *     inspected, and never even uploaded.
 *
 * Consequently this validator treats ABSENCE as failure everywhere. A missing
 * field, a null test block, a zero executed count and a missing file are all
 * hard failures — there is no "assume fine" branch anywhere below.
 *
 * Pure: takes already-parsed JSON, returns findings. No fs, no process exit.
 */

import { STORAGE_MINIMUM_EXECUTED, STORAGE_REQUIRED_MEMBER_IDS, STORAGE_SUITE_NAME } from './executionProof.js';

export const STORAGE_TEST_SCRIPT_NAME = 'server:test:storage-integration';

export interface SummaryValidation {
  valid: boolean;
  failures: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates a parsed `storage-run-summary.json`.
 *
 * `opts.requireOffHostShapedDestination` is set by CI on Linux runners, where
 * the disposable MinIO container's own network address IS routable from the
 * host. There, a loopback fallback means the run silently stopped exercising
 * the off-host-shaped destination, which is a coverage regression the gate
 * must catch rather than tolerate.
 */
export function validateStorageRunSummary(
  data: unknown,
  opts: { requireOffHostShapedDestination?: boolean } = {},
): SummaryValidation {
  const failures: string[] = [];
  const fail = (msg: string) => failures.push(msg);

  if (!isPlainObject(data)) {
    return { valid: false, failures: ['summary is not a JSON object'] };
  }

  if (data.profile !== 'storage') {
    fail(`summary.profile is ${JSON.stringify(data.profile)}, expected "storage"`);
  }
  if (typeof data.runId !== 'string' || data.runId.length === 0) {
    fail('summary.runId is missing');
  }

  const outcome = data.outcome;
  if (!isPlainObject(outcome)) {
    fail('summary.outcome is missing');
  } else if (outcome.exitCode !== 0) {
    fail(`summary.outcome.exitCode is ${JSON.stringify(outcome.exitCode)}, expected 0`);
  }

  const migration = data.migration;
  if (!isPlainObject(migration)) {
    fail('summary.migration is missing — migrations never ran, so no schema was ever provisioned');
  } else if (migration.code !== 0) {
    fail(`summary.migration.code is ${JSON.stringify(migration.code)}, expected 0`);
  }

  const test = data.test;
  if (!isPlainObject(test)) {
    fail('summary.test is null/missing — the storage test command was never invoked');
  } else {
    if (test.scriptName !== STORAGE_TEST_SCRIPT_NAME) {
      fail(`summary.test.scriptName is ${JSON.stringify(test.scriptName)}, expected "${STORAGE_TEST_SCRIPT_NAME}"`);
    }
    if (test.code !== 0) {
      fail(`summary.test.code is ${JSON.stringify(test.code)}, expected 0`);
    }
  }

  const proof = data.executionProof;
  if (!isPlainObject(proof)) {
    fail('summary.executionProof is missing — the run produced no positive evidence that the suite executed');
  } else {
    if (proof.required !== true) {
      fail('summary.executionProof.required is not true — the storage profile must always demand execution proof');
    }
    if (proof.satisfied !== true) {
      const reasons = Array.isArray(proof.failures) ? proof.failures.join('; ') : 'no detail recorded';
      fail(`summary.executionProof.satisfied is not true: ${reasons}`);
    }
    if (typeof proof.executedCount !== 'number' || !Number.isInteger(proof.executedCount)) {
      fail('summary.executionProof.executedCount is missing or not an integer');
    } else if (proof.executedCount < STORAGE_MINIMUM_EXECUTED) {
      fail(
        `summary.executionProof.executedCount is ${proof.executedCount}, below the required minimum of ${STORAGE_MINIMUM_EXECUTED}`,
      );
    }
    if (proof.suite !== undefined && proof.suite !== STORAGE_SUITE_NAME) {
      fail(`summary.executionProof.suite is ${JSON.stringify(proof.suite)}, expected "${STORAGE_SUITE_NAME}"`);
    }
    const missing = proof.missingRequiredMemberIds;
    if (Array.isArray(missing) && missing.length > 0) {
      fail(`summary.executionProof reports missing required member(s): ${missing.join(', ')}`);
    }
  }

  const cleanup = data.cleanup;
  if (!isPlainObject(cleanup)) {
    fail('summary.cleanup is missing');
  } else if (cleanup.success !== true) {
    const errors = Array.isArray(cleanup.errors) ? cleanup.errors.join('; ') : 'no detail recorded';
    fail(`summary.cleanup.success is not true: ${errors}`);
  }

  const minio = data.minio;
  if (!isPlainObject(minio)) {
    fail('summary.minio is missing — the storage profile must record which destination topology it used');
  } else {
    const mode = minio.addressMode;
    if (mode !== 'container-network' && mode !== 'loopback-fallback') {
      fail(`summary.minio.addressMode is ${JSON.stringify(mode)}, expected "container-network" or "loopback-fallback"`);
    } else if (opts.requireOffHostShapedDestination && mode !== 'container-network') {
      fail(
        'summary.minio.addressMode is "loopback-fallback" but this platform requires the container-network (off-host-shaped) destination — the run silently stopped exercising the independent-destination topology',
      );
    }
    if (minio.offHostClassification !== undefined) {
      const expected = mode === 'container-network';
      if (minio.offHostClassification !== expected) {
        fail(
          `summary.minio.offHostClassification is ${JSON.stringify(minio.offHostClassification)} but addressMode "${String(mode)}" implies ${expected} — the destination's real topology and its recorded classification disagree`,
        );
      }
    }
  }

  return { valid: failures.length === 0, failures };
}

/** Exported for the gate CLI's human-readable output. */
export const STORAGE_GATE_CONTRACT_SUMMARY = [
  `profile=storage, outcome.exitCode=0, migration.code=0`,
  `test.scriptName=${STORAGE_TEST_SCRIPT_NAME}, test.code=0`,
  `executionProof.required=true, .satisfied=true, .executedCount>=${STORAGE_MINIMUM_EXECUTED}`,
  `required members: ${STORAGE_REQUIRED_MEMBER_IDS.join(', ')}`,
  `cleanup.success=true, minio.addressMode recorded`,
].join('\n  ');

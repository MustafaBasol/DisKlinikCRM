/**
 * F1-003-P2-R3: concurrency-safe cleanup-target registry.
 *
 * Replaces the orchestrator's former single global `activeCleanupTargets`
 * slot (which one concurrent `runDisposableProfile()` invocation could
 * overwrite or null out while another invocation was still active — see the
 * F1-003-P2-R3 section of
 * docs/program/evidence/F1-003-P2_DISPOSABLE_RUNTIME_IMPLEMENTATION_AND_VERIFICATION.md
 * for the full defect writeup) with a `Map<runId, TeardownTargets>` keyed by
 * each invocation's own stable run ID.
 *
 * Test/dev tooling only — never imported by application runtime. Pure
 * in-process state: no cross-process lock, temp file, or persisted state of
 * any kind (dies with the orchestrator process, exactly like the module it
 * replaces).
 */
import { teardown, type TeardownTargets } from './cleanup.js';
import type { CleanupResult } from './outcome.js';

export type TeardownFn = (targets: TeardownTargets) => Promise<CleanupResult>;

export interface RegisteredTarget {
  runId: string;
  targets: TeardownTargets;
}

export interface RunTeardownOutcome {
  runId: string;
  result: CleanupResult;
}

const registry = new Map<string, TeardownTargets>();

/** In-flight signal-cleanup pass, if any — see runSignalCleanupOnce(). */
let signalCleanupPromise: Promise<RunTeardownOutcome[]> | null = null;

export class DuplicateRunRegistrationError extends Error {
  constructor(runId: string) {
    super(`Cleanup targets are already registered for run ID "${runId}"`);
    this.name = 'DuplicateRunRegistrationError';
  }
}

/**
 * Registers one invocation's (mutable) TeardownTargets object by reference,
 * before its first Docker resource is created. The caller continues to push
 * container/network names and temp-dir paths onto the SAME object it
 * registered here — because the registry holds a reference, not a copy,
 * those later mutations are automatically visible to any signal snapshot
 * taken afterward, with no separate "update" call required.
 *
 * Throws if `runId` is already registered — a duplicate registration is
 * rejected deterministically rather than silently overwriting (or being
 * silently ignored for) another invocation's live targets.
 */
export function registerCleanupTargets(runId: string, targets: TeardownTargets): void {
  if (registry.has(runId)) {
    throw new DuplicateRunRegistrationError(runId);
  }
  registry.set(runId, targets);
}

/** Removes one invocation's entry. Harmless no-op for an unknown/already-removed run ID. */
export function unregisterCleanupTargets(runId: string): void {
  registry.delete(runId);
}

export function getRegisteredRunIds(): string[] {
  return [...registry.keys()];
}

export function registrySize(): number {
  return registry.size;
}

/**
 * Snapshots every currently-registered invocation at call time. Used by both
 * the signal handler (§ below) and normal-path introspection/tests. Returns
 * a plain array copy — later register/unregister calls do not mutate an
 * already-taken snapshot, though each snapshotted `targets` object is still
 * the SAME live reference the invocation is mutating (so its in-flight
 * container/network list is current as of the moment teardown actually runs
 * against it, not merely as of snapshot time).
 */
export function snapshotRegisteredTargets(): RegisteredTarget[] {
  return [...registry.entries()].map(([runId, targets]) => ({ runId, targets }));
}

/**
 * Attempts teardown for every currently-registered invocation. One target's
 * teardown failure (including a thrown/rejected teardown call) must not
 * prevent attempts for the remaining targets — Promise.allSettled, never
 * Promise.all, is used for exactly this reason. Each invocation that
 * completes teardown (successfully or not) is removed from the registry;
 * teardown itself is idempotent/best-effort (docker rm -f tolerates an
 * already-removed container; a network-removal failure is reported as a
 * cleanup error, never thrown/crashed on), matching the existing
 * `teardown()` contract this module composes rather than replaces.
 *
 * `teardownFn` defaults to the real Docker-backed `teardown()` but is
 * injectable so unit tests can exercise this coordination logic without
 * Docker — the same pattern `lib/prismaGeneration.ts` already uses for its
 * injectable `GenerateRunner`.
 */
export async function teardownAllRegistered(teardownFn: TeardownFn = teardown): Promise<RunTeardownOutcome[]> {
  const snapshot = snapshotRegisteredTargets();
  const settled = await Promise.allSettled(
    snapshot.map(async ({ runId, targets }): Promise<RunTeardownOutcome> => {
      const result = await teardownFn(targets);
      unregisterCleanupTargets(runId);
      return { runId, result };
    }),
  );
  return settled.map((outcome, i) => {
    if (outcome.status === 'fulfilled') return outcome.value;
    return {
      runId: snapshot[i].runId,
      result: { success: false, errors: [outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)] },
    };
  });
}

/**
 * Signal-safe entry point: runs exactly one teardown-all pass regardless of
 * how many times it is called while that pass is still in flight. The first
 * call starts `teardownAllRegistered()` and caches its promise; every call
 * that arrives before that promise settles — e.g. a second SIGINT/SIGTERM
 * delivered while the first is still tearing down — receives the SAME
 * promise instead of starting a second, overlapping pass. The cached promise
 * is intentionally never cleared after settling: a signal-cleanup pass is a
 * process-terminating, one-shot action for the life of this module, not a
 * repeatable operation.
 */
export function runSignalCleanupOnce(teardownFn: TeardownFn = teardown): Promise<RunTeardownOutcome[]> {
  if (!signalCleanupPromise) {
    signalCleanupPromise = teardownAllRegistered(teardownFn);
  }
  return signalCleanupPromise;
}

/** Test-only: clears all registry and in-flight-signal-cleanup state between test cases. */
export function resetCleanupRegistryForTest(): void {
  registry.clear();
  signalCleanupPromise = null;
}

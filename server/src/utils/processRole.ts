/**
 * processRole.ts — F3-IMPL-002: explicit process-role contract for the two
 * production entrypoints (server/src/index.ts = "api", server/src/worker.ts
 * = "worker").
 *
 * F3-IMPL-001's backgroundJobsOwnership.ts made the API's job-ownership
 * decision explicit and tested, but left the actual production *topology* —
 * whether a `noramedi-worker` process is really running opposite the API —
 * entirely unverifiable from the repository (see PRODUCTION_TOPOLOGY.md §3,
 * RISK_REGISTER.md R-033/R-040). `ecosystem.config.cjs` closes that gap by
 * declaring both PM2 apps with an explicit `NORAMEDI_PROCESS_ROLE` env value
 * each. This module is the corresponding runtime guard: each entrypoint
 * asserts its own expected role at startup, so a misconfigured/duplicated
 * PM2 app definition (e.g. the worker's block accidentally cloned with
 * `NORAMEDI_PROCESS_ROLE=api`, or a typo'd value) fails closed at process
 * start instead of running with a silently ambiguous role.
 *
 * `NORAMEDI_PROCESS_ROLE` is optional. Unset is not an error — it is the
 * pre-existing single-process/dev/test shape, preserved byte-for-byte: any
 * environment that doesn't declare a role (local dev, every existing test,
 * a deployment that predates this task) behaves exactly as it did before.
 * Only an explicitly *wrong* declared value is refused.
 */
export type NoramediProcessRole = 'api' | 'worker';

export interface ProcessRoleAssertion {
  /** Whether NORAMEDI_PROCESS_ROLE was explicitly set in the environment. */
  declared: boolean;
  /** The role this process is confirmed to be operating as. */
  role: NoramediProcessRole;
}

const VALID_ROLES: readonly NoramediProcessRole[] = ['api', 'worker'];

function entrypointFor(role: NoramediProcessRole): string {
  return role === 'api' ? 'server/src/index.ts' : 'server/src/worker.ts';
}

/**
 * Asserts that this process's entrypoint matches its declared
 * NORAMEDI_PROCESS_ROLE, if any is declared. Throws (fail closed) rather
 * than guessing when the declared value is unrecognized or contradicts the
 * entrypoint calling this function — an ambiguous production role is worse
 * than a crashed process, since PM2 surfaces a crash loudly (errored/restart
 * count) while an ambiguous role can silently mis-own or double-own
 * background jobs.
 */
export function assertProcessRole(
  expectedRole: NoramediProcessRole,
  env: NodeJS.ProcessEnv = process.env,
): ProcessRoleAssertion {
  const raw = env.NORAMEDI_PROCESS_ROLE;

  if (raw === undefined) {
    return { declared: false, role: expectedRole };
  }

  if (!VALID_ROLES.includes(raw as NoramediProcessRole)) {
    throw new Error(
      `NORAMEDI_PROCESS_ROLE=${JSON.stringify(raw)} is not a recognized process role ` +
        `(expected "api" or "worker", or leave unset). Refusing to start with an ` +
        `unrecognized role rather than guessing production background-job ownership.`,
    );
  }

  if (raw !== expectedRole) {
    throw new Error(
      `NORAMEDI_PROCESS_ROLE=${raw} does not match this process's entrypoint. ` +
        `This process is ${entrypointFor(expectedRole)} and expects role "${expectedRole}". ` +
        `Refusing to start with a mismatched role rather than risking ambiguous or ` +
        `duplicated background-job ownership between the API and worker processes.`,
    );
  }

  return { declared: true, role: expectedRole };
}

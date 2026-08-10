/**
 * backgroundJobsOwnership.ts — explicit, tested decision for whether the API
 * process owns/starts cron background jobs (jobs/startBackgroundJobs.ts).
 *
 * Historically this was an inline `process.env.RUN_BACKGROUND_JOBS !== 'false'`
 * check in index.ts with no test coverage and no startup-visible diagnostic —
 * an operator could not tell, from logs alone, whether a given production API
 * process actually owns jobs. LAUNCH_GATES.md flags this exact fact as
 * unverified for the current deployment.
 *
 * Deliberately preserves today's default byte-for-byte:
 *   - RUN_BACKGROUND_JOBS=false            -> API does NOT own jobs
 *   - RUN_BACKGROUND_JOBS=<anything else>  -> API owns jobs (including unset)
 *
 * A stricter default — API opts out unless RUN_BACKGROUND_JOBS=true is set
 * explicitly in production — was considered, since it is the fail-safe shape
 * F3's brief prefers. It was rejected here: scripts/noramedi-deploy.sh only
 * reloads a `noramedi-api` PM2 process and references no dedicated worker
 * process, so today's actual production deployment relies on the API process
 * running jobs by default. Flipping that default would silently stop
 * reminders/data-retention/etc. in production unless an operator has already
 * (and unverifiably, per LAUNCH_GATES.md) set RUN_BACKGROUND_JOBS=true — an
 * unacceptable silent behavior change for a first-customer pilot. Closing the
 * ambiguity here is limited to making the decision explicit, tested, and
 * diagnosable at startup; changing the default is left to a follow-up task
 * once a dedicated worker process is actually part of the deployment
 * topology (ecosystem config / deploy script) and can be verified in
 * production first.
 */
export interface BackgroundJobsOwnershipDecision {
  ownsJobs: boolean;
  reason: string;
}

export function resolveApiBackgroundJobsOwnership(
  env: NodeJS.ProcessEnv = process.env,
): BackgroundJobsOwnershipDecision {
  if (env.RUN_BACKGROUND_JOBS === 'false') {
    return {
      ownsJobs: false,
      reason: 'RUN_BACKGROUND_JOBS=false — jobs delegated to a dedicated worker process',
    };
  }
  if (env.RUN_BACKGROUND_JOBS === undefined) {
    return {
      ownsJobs: true,
      reason: 'RUN_BACKGROUND_JOBS is unset — API owns jobs (single-process default)',
    };
  }
  return {
    ownsJobs: true,
    reason: `RUN_BACKGROUND_JOBS=${JSON.stringify(env.RUN_BACKGROUND_JOBS)} — API owns jobs (only the literal string "false" opts out)`,
  };
}

/**
 * The worker process's (server/src/worker.ts) side of the same decision.
 * Unlike the API, the worker is unconditional: it always owns jobs and does
 * not read RUN_BACKGROUND_JOBS at all (see worker.ts's own docstring).
 * Extracted as a named, tested function — mirroring
 * resolveApiBackgroundJobsOwnership — so the intended production topology
 * (API opted out via RUN_BACKGROUND_JOBS=false, worker unconditional) can be
 * asserted in one place instead of relying on reading worker.ts by eye.
 */
export function resolveWorkerBackgroundJobsOwnership(): BackgroundJobsOwnershipDecision {
  return {
    ownsJobs: true,
    reason: 'worker process always owns jobs — RUN_BACKGROUND_JOBS does not apply here, only to the API process',
  };
}

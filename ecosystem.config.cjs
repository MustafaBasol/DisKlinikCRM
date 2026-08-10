// ecosystem.config.cjs — F3-IMPL-002: repository-defined PM2 process contract.
//
// Before this file, neither PM2 process's definition (script, cwd, restart
// policy, env) existed in the repository (RISK_REGISTER.md R-040) and
// scripts/noramedi-deploy.sh only ever reloaded `noramedi-api`, never
// `noramedi-worker` (R-033) — worker deploy/reload automation was entirely
// external and undocumented. This file is the single repository-defined
// source of truth for both processes; scripts/noramedi-deploy.sh drives it
// via `pm2 startOrReload ecosystem.config.cjs --only <name> --update-env`,
// which reloads an already-running app or starts it if missing — so a fresh
// box (or a box where PM2's process table was lost) can reproduce the exact
// same topology from this file alone.
//
// Each app declares NORAMEDI_PROCESS_ROLE, asserted at startup by
// server/src/utils/processRole.ts (fails closed on a missing/mismatched
// role). Only the API app sets RUN_BACKGROUND_JOBS=false — this is the
// production job-ownership decision documented in
// server/src/utils/backgroundJobsOwnership.ts: the worker owns background
// jobs unconditionally (RUN_BACKGROUND_JOBS does not apply to it), so
// explicitly opting the API out here (rather than leaving it unset, which
// defaults to the API *also* owning jobs) prevents duplicate job
// registration (RISK_REGISTER.md R-034) now that a worker's lifecycle is
// itself repository-managed by this same file.
//
// Operational note for the first deploy under this file: `pm2
// startOrReload` performs a graceful reload only when the app's resolved
// config already matches what PM2 currently has recorded for that name. If
// either process was originally `pm2 start`-ed outside this repository with
// a different script/cwd/args, the first run against this file will fall
// back to a full restart (brief downtime for `noramedi-api`) rather than a
// zero-downtime reload — expected and one-time, not a bug. Both entrypoints
// already run their existing graceful-shutdown handlers regardless (SIGTERM
// drains the HTTP server / lets in-flight job ticks finish before exiting).
//
// No secrets live here. DATABASE_URL, REDIS_URL, ENCRYPTION_KEY, and every
// other secret/credential continue to come from the process's own
// environment (systemd/.env/shell profile) exactly as before — this file
// only adds the two small, non-secret variables described above.

'use strict';

const path = require('node:path');

const SERVER_DIR = path.join(__dirname, 'server');

module.exports = {
  apps: [
    {
      name: 'noramedi-api',
      cwd: SERVER_DIR,
      script: 'npm',
      args: 'run start',
      interpreter: 'none',
      exec_mode: 'fork',
      env: {
        NORAMEDI_PROCESS_ROLE: 'api',
        RUN_BACKGROUND_JOBS: 'false',
      },
    },
    {
      name: 'noramedi-worker',
      cwd: SERVER_DIR,
      script: 'npm',
      args: 'run start:worker',
      interpreter: 'none',
      exec_mode: 'fork',
      env: {
        NORAMEDI_PROCESS_ROLE: 'worker',
      },
    },
  ],
};

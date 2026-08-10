# F3-IMPL-002 — Production Worker Process Contract, Deploy Lifecycle & Job Ownership Hardening

Task ID: F3-IMPL-002 · Phase: F3 — Production Hardening · Date: 2026-08-10

## 1. Baseline

- Expected `origin/main`: `1909b186a01611c8be90313b7166085a887d05f4` (PR #355 / F3-IMPL-001 merge commit).
- Confirmed via `git fetch origin --prune` then `git rev-parse origin/main`: exact match, no drift.
- Post-main CI independently verified green prior to this task: workflow `ci-main-and-nightly`, run `31398594201`, conclusion `success`.
- Dedicated worktree: `E:\Ek Gelir\Siteler\DisKlinikCRM-worktrees\f3-impl-002` (created fresh from `origin/main` at the SHA above; the shared primary worktree was not edited).
- Branch: `feature/f3-impl-002-production-worker-contract`.

## 2. Pre-work inventory (answers to the task brief's 12 questions)

Read first: `AGENTS.md`, `docs/program/NORAMEDI_MASTER_TRACKER.md`, `docs/program/CURRENT_PHASE.md`, `docs/program/phases/F3_PRODUCTION_HARDENING.md`, `docs/program/LAUNCH_GATES.md`, `docs/program/PRODUCTION_TOPOLOGY.md`, `docs/program/ENVIRONMENT_MATRIX.md`, `docs/program/ARCHITECTURE_DECISIONS.md`, `docs/program/RISK_REGISTER.md`. Then `server/src/index.ts`, `server/src/worker.ts`, `server/src/utils/backgroundJobsOwnership.ts`, `server/src/utils/jobLock.ts`, `scripts/noramedi-deploy.sh`, `scripts/noramedi-healthcheck.sh`, `server/package.json`.

1. **What exact process starts the API today?** `npm run start` → `npx prisma generate && tsx src/index.ts` (`server/package.json`), reloaded in production by `pm2 reload noramedi-api --update-env` from `scripts/noramedi-deploy.sh`.
2. **What exact process starts `worker.ts`, if any?** `npm run start:worker` → `npx prisma generate && tsx src/worker.ts`. `server/src/worker.ts` **already existed** on this baseline (added by a prior, pre-F3 task per its own header comment referencing "docs/45 Faz 3 #10") — this task did not need to create it.
3. **Is `noramedi-worker` defined anywhere in-repo?** Only as a PM2 process *name* referenced in documentation (`PRODUCTION_TOPOLOGY.md`, `RISK_REGISTER.md` R-033/R-034/R-036/R-037/R-040, `LAUNCH_GATES.md`). No `ecosystem.config.*` or any script defined, started, reloaded, or verified it. `PRODUCTION_TOPOLOGY.md` §2/§3 (evidence from F0-002/F0-006, `VERIFIED_PRODUCTION_OBSERVED`) records that a `noramedi-worker` PM2 process **is already running in production today**, entrypoint `server/src/worker.ts`, but its "initial registration and ongoing reload/restart mechanism" is confirmed **not defined in this repository**.
4. **Is production worker startup reproducible from repository code/config?** No, before this task. `worker.ts` itself is correct and reproducible; nothing in the repository told an operator (or PM2) *how* to run it as a named, deploy-managed process.
5. **Which jobs are API-owned?** All 9 jobs registered by `jobs/startBackgroundJobs.ts`, conditionally — only if `resolveApiBackgroundJobsOwnership()` returns `ownsJobs: true` (true whenever `RUN_BACKGROUND_JOBS !== 'false'`, including unset).
6. **Which jobs are worker-owned?** The same 9 jobs, unconditionally — `worker.ts` always calls `startBackgroundJobs()` regardless of `RUN_BACKGROUND_JOBS`.
7. **Can API and worker both register the same jobs?** Yes, if `RUN_BACKGROUND_JOBS` is not the literal string `'false'` on the API process — which `PRODUCTION_TOPOLOGY.md`/`ENVIRONMENT_MATRIX.md` record as `SET` but with its **literal value unread/unverified** in production (R-034). Duplicate *registration* was possible; duplicate *execution* of any single tick was already prevented by the DB-backed `JobLock` lease (`server/src/utils/jobLock.ts`), unchanged by this task.
8. **Can neither process register them?** Yes — if an operator ever set `RUN_BACKGROUND_JOBS=false` for the API (the fail-safe-looking choice) without the worker process actually running (which, before this task, had no repository-defined lifecycle and could silently be down after a box rebuild or a lost PM2 process table), background jobs would silently stop entirely. This is the exact zero-owner risk the task brief and F3-IMPL-001's own docstring warned about.
9. **What happens if `RUN_BACKGROUND_JOBS` is unset?** The API owns jobs (pre-existing single-process default, unchanged by this task for any environment that doesn't declare `NORAMEDI_PROCESS_ROLE`/use the new ecosystem file).
10. **What does F3-IMPL-001's ownership helper currently decide?** `resolveApiBackgroundJobsOwnership()` — API owns jobs unless `RUN_BACKGROUND_JOBS === 'false'` exactly. Deliberately not flipped by F3-IMPL-001 pending a real worker deploy lifecycle (its own docstring, quoted in this task's brief).
11. **What process-health evidence exists for worker?** None beyond PM2's own "online" status — no HTTP endpoint, no heartbeat table. `LAUNCH_GATES.md` explicitly accepts "PM2 online status" as sufficient for worker liveness at go-live, recommending but not mandating an additional lightweight check.
12. **What deploy/restart/rollback behavior exists for worker?** None in the repository — `scripts/noramedi-deploy.sh` referenced only `noramedi-api` before this task (confirmed by direct read, header comment "5. pm2 reload noramedi-api").

**Classification: `PARTIAL`.** The runtime code (`worker.ts`, `backgroundJobsOwnership.ts`, `jobLock.ts`) was already correct and safe by construction — this is not `UNSAFE`. But the *deployment topology* around it was undefined in the repository (`R-033`/`R-040`), which made the API's job-ownership default unsafe to change (the exact reason F3-IMPL-001 left it alone) and left open a real zero-owner failure mode if an operator ever changed `RUN_BACKGROUND_JOBS` without independently, manually ensuring the worker was actually running. Production itself (per `PRODUCTION_TOPOLOGY.md`'s `VERIFIED_PRODUCTION_OBSERVED` evidence) already runs a `noramedi-worker` PM2 process today — so the live system is likely closer to `SAFE` in practice than the repository alone would suggest, but that fact was **not reproducible or verifiable from the repository**, which is the gap this task closes.

## 3. Root cause / exact gap

Two coupled gaps, both already named in `RISK_REGISTER.md` from F0-006:

- **R-033**: no repository-defined deploy/reload automation for `noramedi-worker`.
- **R-040**: no repository-defined PM2 process/config source (`ecosystem.config.*`) for either process.

These two together are *why* R-034 (possible duplicate job registration) could not be safely closed by simply setting `RUN_BACKGROUND_JOBS=false` on the API: doing so without a guaranteed, repository-managed worker lifecycle risks the zero-owner state (item 8 above) — exactly what F3-IMPL-001's own docstring in `backgroundJobsOwnership.ts` refused to do.

## 4. Implementation

### 4.1 `ecosystem.config.cjs` (new, repository root)

Single source of truth for both PM2 apps (`noramedi-api`, `noramedi-worker`): `cwd` (`server/`), `script`/`args` (`npm run start` / `npm run start:worker` — the same canonical entrypoints `PRODUCTION_TOPOLOGY.md` already documents, not a new invocation shape), and a small non-secret `env` block per app. `.cjs` extension used because both `package.json` files in this repository declare `"type": "module"`.

- `noramedi-api`: `NORAMEDI_PROCESS_ROLE=api`, `RUN_BACKGROUND_JOBS=false`.
- `noramedi-worker`: `NORAMEDI_PROCESS_ROLE=worker`.

No secrets added — `DATABASE_URL`, `REDIS_URL`, `ENCRYPTION_KEY`, etc. continue to come from the process's own environment exactly as before.

**Operational note (documented in the file itself):** `pm2 startOrReload` performs a graceful reload only if the app's resolved config already matches PM2's current record for that name. Since both processes were originally started outside this repository, the *first* deploy under this file may fall back to a full restart rather than a zero-downtime reload — expected, one-time, not a bug. Both entrypoints already implement graceful `SIGTERM`/`SIGINT` shutdown regardless.

### 4.2 `server/src/utils/processRole.ts` (new)

`assertProcessRole(expectedRole, env)` — optional `NORAMEDI_PROCESS_ROLE` contract:

- Unset → no-op, `declared: false` (byte-for-byte backward compatible with every existing dev/test/pre-existing-deployment environment).
- Set and matches the calling entrypoint's expected role → `declared: true`, no throw.
- Set but unrecognized (not `'api'`/`'worker'`, including empty string) → **throws**.
- Set but contradicts the calling entrypoint (e.g. `worker` value on the `index.ts`/api entrypoint) → **throws**.

Wired into `server/src/index.ts` (`assertProcessRole('api')`, called immediately after `dotenv.config()`, before any other startup validation) and `server/src/worker.ts` (`assertProcessRole('worker')`, same position). A throw here crashes the process before it binds a port or registers any job — PM2 surfaces this loudly (`errored`/rapid restart count), which is the intended fail-closed behavior: an ambiguous role is worse than a crashed process, since it could otherwise run with silently wrong or duplicated job ownership.

### 4.3 `server/src/utils/backgroundJobsOwnership.ts` (extended, not rewritten)

Added `resolveWorkerBackgroundJobsOwnership()`, mirroring the existing `resolveApiBackgroundJobsOwnership()`: always returns `{ ownsJobs: true, reason: ... }`. `resolveApiBackgroundJobsOwnership()` itself is **unchanged** — its existing, already-tested `RUN_BACKGROUND_JOBS`-based decision logic is exactly right and did not need modification; only the *deployment topology around it* was missing.

### 4.4 `server/src/worker.ts` (edited)

Now calls `assertProcessRole('worker')` and logs its result, and replaces the previously hardcoded `ownsJobs=true` log string with a call to `resolveWorkerBackgroundJobsOwnership()` — same runtime behavior (`startBackgroundJobs()` is still called unconditionally), now backed by a named, tested decision function instead of an inline literal.

### 4.5 `server/src/index.ts` (edited)

Now calls `assertProcessRole('api')` immediately after `dotenv.config()`, and the existing `[jobs] API background-jobs ownership` startup log line now also states the resolved process role and whether it was explicitly declared.

### 4.6 `scripts/noramedi-deploy.sh` (edited)

- Steps 5-6: `pm2 reload noramedi-api --update-env` replaced with `pm2 startOrReload ecosystem.config.cjs --only noramedi-api --update-env`, and a new equivalent step added for `noramedi-worker`. `set -euo pipefail` (unchanged) means either failing aborts the whole deploy — not silently ignored.
- Step 7 (unchanged): existing API healthcheck via `noramedi-healthcheck.sh`.
- Step 8 (new): worker verification. `pm2_status_of()`/`verify_pm2_online()` poll `pm2 jlist`, parsed by a small inline `node -e` script (Node is already a hard runtime dependency of this server — no new tool required), for the `noramedi-worker` app's `pm2_env.status` field, retrying up to 12 attempts / 5s interval (matching the existing API healthcheck's own retry budget). If the worker never reaches `online`, the script prints a clear `FATAL` message to stderr and exits `1` — the deploy is not reported successful. No HTTP endpoint was added to the worker for this (see §6 below); only the PM2 process-status word is read and printed — no environment variables, connection strings, or other secrets are ever included in any log line this script prints.
- `bash -n scripts/noramedi-deploy.sh` — syntax-clean (see §7).

## 5. Background-job ownership matrix (before / after)

| Scenario | Before this task | After this task (intended production topology via `ecosystem.config.cjs`) |
|---|---|---|
| API process | Owns jobs unless `RUN_BACKGROUND_JOBS=false` set externally (unverified in production) | `RUN_BACKGROUND_JOBS=false` explicit in `ecosystem.config.cjs` → does **not** own jobs |
| Worker process | Always owns jobs (if running — lifecycle undefined in repo) | Always owns jobs, deploy-managed and verified `online` before deploy succeeds |
| Duplicate registration risk | Possible (R-034) if API's literal `RUN_BACKGROUND_JOBS` value was ever `!= 'false'` | Eliminated for any deployment using `ecosystem.config.cjs`; `JobLock` remains the defense-in-depth backstop regardless |
| Zero-owner risk | Possible if `RUN_BACKGROUND_JOBS=false` were ever set without independently guaranteeing the worker was running | Eliminated for any deployment using this task's deploy script, which fails the whole deploy (non-zero exit) if the worker does not reach PM2 `online` |
| Dev/test (no `ecosystem.config.cjs`, no `NORAMEDI_PROCESS_ROLE`) | API owns jobs by default (single-process shape) | **Unchanged** — proven by `backgroundJobsOwnership.test.ts`'s new "pre-existing single-process shape" test |

## 6. Worker health / verification mechanism

PM2 process status only (`pm2 jlist` → `pm2_env.status === 'online'`), read via a small `node -e` snippet inside `scripts/noramedi-deploy.sh` — no HTTP server added to the worker, per the task brief's explicit preference and `LAUNCH_GATES.md`'s own stated acceptance of PM2-online status as the worker liveness signal. This is a smaller change than adding a durable DB-backed heartbeat (which would have been reasonable to build on top of the existing `JobLock` table) — deferred as unnecessary for this task's bounded scope; PM2 status is a real, already-relied-upon signal (see `PRODUCTION_TOPOLOGY.md` §3, `LAUNCH_GATES.md` "Worker process status" row) and required no schema change.

## 7. Migration status

**No schema/migration change.** No Prisma schema file touched; no `prisma/migrations/` entry added.

## 8. Tests

All commands run from `E:\Ek Gelir\Siteler\DisKlinikCRM-worktrees\f3-impl-002` (`cd server` where noted).

| Command | Result |
|---|---|
| `cd server && npm run typecheck` (`npx prisma generate && tsc --noEmit`) | Exit `0`, no type errors |
| `cd server && npm run test:process-role` (new, `processRole.test.ts`) | `8/8` passed |
| `cd server && npm run test:background-jobs-ownership` (`backgroundJobsOwnership.test.ts`, extended) | `10/10` passed (7 pre-existing API-side + 1 new worker-side + 2 new topology-matrix tests) |
| `cd server && npm run test:database-url-validation` | `11/11` passed (unaffected regression check) |
| `cd server && npm run test:request-id-correlation` | `2/2` passed (unaffected regression check) |
| `cd server && npm run server:test:non-disposable` (full aggregate, 69 members after wiring `test:process-role` in) | Exit `0` — every member is `&&`-chained, so a non-zero exit from any single member would have stopped the chain and failed the command; the command's own exit code `0` is proof the entire aggregate passed, including every pre-existing suite unrelated to this change |
| `bash -n scripts/noramedi-deploy.sh` | Syntax-clean, exit `0` |
| `npm run test:runtime:postgres -- --summary-file=postgres-run-summary.json` (repo root, disposable Postgres via Docker) | See §9 |

No test was modified to weaken an assertion; no test was skipped.

## 9. `test:runtime:postgres` result

Command (repo root): `npm run test:runtime:postgres -- --summary-file=postgres-run-summary.json` — Docker-provisioned, digest-pinned `postgres` container, runs `server:test:disposable-db` (25 test-file members, real PostgreSQL) after `npx prisma migrate deploy`.

**First attempt** failed before any test ran: `migration.step: "generate"`, `migration.code: 1`, `outcome.exitCode: 1`. Root cause: transient — this session had several other heavy background processes running concurrently at that moment (a `npm ci` install and the full `server:test:non-disposable` suite), and re-running the exact same orchestrator command immediately after those finished succeeded cleanly with no code change in between; `cd server && npm run typecheck` (which also runs `npx prisma generate`) had already succeeded standalone earlier in this same task. Treated as host resource contention, not a defect in this change.

**Retry**, run cleanly with no other background load: **exit `0`**.

```json
{
  "profile": "postgres",
  "migration": { "code": 0, "step": "ok" },
  "test": { "scriptName": "server:test:disposable-db", "code": 0 },
  "cleanup": { "success": true, "errors": [] },
  "outcome": { "exitCode": 0, "reasons": ["tests passed", "cleanup succeeded"] }
}
```

All 25 `server:test:disposable-db` members' own per-file summaries report `passed, 0 failed` (25/25 files, each internally 0 failed); every "failed" string match remaining in the raw log is an intentional failure-path assertion inside a passing test (e.g. `external-calendar-outbound-sync`'s `AUTH_ERROR`/retry-exhaustion cases, `orphan-file-inspection`'s cross-tenant mark-missing rejection log, `platformBackupAudit`'s restore-test-failure audit row) — none is an actual test failure. `72/72` Prisma migrations applied cleanly (`migration.step: "ok"`). Docker cleanup succeeded, no orphaned container left behind (confirmed via `docker ps -a` post-run).

## 10. Security / tenant / KVKK impact

- **Security impact:** none negative. The new `NORAMEDI_PROCESS_ROLE` fail-closed guard is a strict safety improvement (an ambiguous production process role now crashes loudly instead of silently running). `ecosystem.config.cjs` contains no secrets (verified by direct read — only `NORAMEDI_PROCESS_ROLE` and `RUN_BACKGROUND_JOBS`, both non-secret operational flags already used elsewhere in this codebase). The deploy script's new worker-verification code path prints only a PM2 status word (`online`/`stopped`/`errored`/etc.) — never an environment variable, connection string, or other secret.
- **Tenant isolation impact:** none. No query path, authorization check, or tenant-scoping logic touched. The 9 background jobs' own tenant-scoping behavior is unchanged — only *which process* runs them changed, not *what* they do.
- **KVKK/privacy impact:** none. No patient/clinic/message payload is logged by any new code in this task — the only new log lines are process-role/ownership diagnostics (`[worker] Background job worker starting... role=worker (declared=...) ownsJobs=... (...)`, `[jobs] API background-jobs ownership: role=api (declared=...) ownsJobs=... (...)`) and the deploy script's PM2-status lines, none of which can contain patient data, tokens, secrets, or `DATABASE_URL`.

## 11. Backward compatibility

- Any environment that does not set `NORAMEDI_PROCESS_ROLE` (every existing test, local dev, and any pre-existing deployment that predates this task) behaves identically to before — proven by `processRole.test.ts`'s "unset" cases and `backgroundJobsOwnership.test.ts`'s "pre-existing single-process shape" case.
- `resolveApiBackgroundJobsOwnership()`'s own logic is untouched — every one of F3-IMPL-001's original 7 tests for it still passes unmodified.
- `worker.ts` still unconditionally calls `startBackgroundJobs()` — behavior unchanged, only the log line and an added role guard.

## 12. Rollback

**Code:** `git revert <merge-commit-of-this-PR>` — a clean revert; no other commit depends on `ecosystem.config.cjs`, `processRole.ts`, or the deploy-script changes.

**Operational (if this PR has already been deployed and needs to be rolled back on the VPS):**

1. Restore the previous `scripts/noramedi-deploy.sh` (the git-reverted version) — its step 5 becomes `pm2 reload noramedi-api --update-env` again, with no worker step.
2. To restore prior `RUN_BACKGROUND_JOBS` behavior on the API process safely: run `pm2 restart noramedi-api --update-env` **after** unsetting/removing the `RUN_BACKGROUND_JOBS=false` value this task's `ecosystem.config.cjs` introduced (e.g. `pm2 set noramedi-api:RUN_BACKGROUND_JOBS ''` or simply restart without `ecosystem.config.cjs` so PM2 falls back to whatever environment it already had cached) — this restores the pre-F3-IMPL-002 single-process-capable default (API owns jobs again unless something else explicitly sets the flag).
3. The `noramedi-worker` PM2 process itself is not stopped or removed by any rollback step above — it was already running in production before this task (per `PRODUCTION_TOPOLOGY.md`) and continues running; only the *deploy script's* management of it reverts to "not managed."
4. No database rollback needed — no schema/migration was touched.

## 13. Program docs updated (additive only)

- `docs/program/NORAMEDI_MASTER_TRACKER.md` §4 (F3 phase-summary row appended)
- `docs/program/CURRENT_PHASE.md` (new entry prepended at top)
- `docs/program/phases/F3_PRODUCTION_HARDENING.md` (new top status line + change-history row)
- `docs/program/evidence/README.md` (new row, this file)
- `docs/program/RISK_REGISTER.md` (new "Son güncelleme" entry; R-033/R-034/R-040 rows updated with this mitigation's evidence pointer — **none closed**)
- This file (new)

No historical evidence file was rewritten in place.

# F0-006 — Production Topology and Configuration Verification Evidence

Task: F0-006 — Production Topology and Configuration Verification
Phase: F0 — Baseline, Program Control, and Architecture Validation
Dependency: F0-002 (Repository and Deployment Baseline Inventory) — `MERGED` ([PR #172](https://github.com/MustafaBasol/DisKlinikCRM/pull/172), merge commit `db89b60c91666cb029c32757f171f227a643c79c`, merged `2026-07-19T12:02:51Z`, confirmed via `gh pr view 172 --json state,mergedAt,mergeCommit`).

This document does **not** duplicate F0-002's evidence. It cites F0-002 by section and adds only F0-006-specific verification: process-level source-code tracing (entrypoints, job scheduling, graceful shutdown, storage/backup client code), reconciliation of a second, task-supplied production evidence snapshot against F0-002 Stage B, and the required drift/contradiction table. See [README.md](README.md) for the evidence-classification legend, used unchanged here.

---

## 0. Isolation and starting state

| Fact | Value |
|---|---|
| Worktree | `D:\Mustafa\Siteler\DisKlinikCRM-worktrees\f0-006-production-topology` |
| Branch | `docs/f0-006-production-topology-verification` (created from `origin/main`) |
| HEAD at creation | `db89b60c91666cb029c32757f171f227a643c79c` — this is the merge commit of [PR #172](https://github.com/MustafaBasol/DisKlinikCRM/pull/172) (F0-002), confirmed `MERGED` via `gh pr view 172` (`mergedAt: 2026-07-19T12:02:51Z`) | `VERIFIED_GITHUB` / `VERIFIED_GIT` |
| Working tree at creation | Clean (`git status --short` → empty) | `VERIFIED_GIT` |
| Primary working tree (`D:\Mustafa\Siteler\DisKlinikCRM`) | Active KVKK-HIGH-007 consent-reconciliation work observed present (13 modified + 6 untracked files under `server/prisma/`, `server/src/jobs`, `server/src/routes`, `server/src/scripts`, `server/src/services`) — **not inspected, not read, not staged, not modified, not reset, not stashed, not cleaned, not deleted, not copied, and not used as evidence for this task**, per task instruction. Only `git status --short` (read-only) was run against that path. | `OBSERVED_LOCAL_ONLY` |

**Note on F0-002 status:** the task instructions' "authoritative current state" declared F0-002 `MERGED`. The tracker file's own committed text (as of the merge commit that carries it) still reads `PR_OPEN` internally — this is the same self-reference lag observed for F0-003/F0-004/F0-005 (each task's own tracker update landed *before* its PR merged, so the merge commit's tracker snapshot describes its own pre-merge state). `gh pr view 172` independently confirms `state: MERGED`, `mergeCommit.oid: db89b60c91666cb029c32757f171f227a643c79c` — identical to this worktree's `origin/main` HEAD. This is corrected in this task's tracker update (§ below). Per the source hierarchy (tracker §2.1, item 1: git commits / merged PRs outrank the tracker file itself), the GitHub-confirmed `MERGED` status is authoritative.

---

## 1. Reconciliation of task-supplied production evidence with F0-002 Stage B

The task prompt supplied a "current production evidence" block (host, application, runtime, processes, health, TLS, database, config presence, storage, backup, PITR, restore) dated 2026-07-19. F0-002 Stage B ([F0-002_PRODUCTION_BASELINE_EVIDENCE.md](F0-002_PRODUCTION_BASELINE_EVIDENCE.md)) already recorded a read-only evidence run against the same host on the same date, evidence timestamp `2026-07-19T13:43:12+03:00`.

Cross-checking every field, the two are **consistent to within collection-time rounding** — same hostname, same disk/RAM/swap figures, same production `HEAD` (`7fcf2f850f151241266f07349c4bf4442c72bbca`), same branch/clean state, same runtime versions (Node `22.23.1`, npm `10.9.8`, PM2 `7.0.1`, PostgreSQL `16.14`, Redis `7.0.15` active, Nginx `1.24.0`), same PM2 topology (`noramedi-api`/`noramedi-worker`, fork mode, both online, restart counts **14/13 identical**, 0 unstable), same health results (local + public `200`), same TLS SAN set and expiry (`2026-09-26`), same migration head (`20260718164142_add_communication_preference_and_consent`, 0 incomplete), same config presence set (8 `SET`, 3 `MISSING` — identical variable names in both lists), same storage state (`LOCAL_VPS_STORAGE`, `~3.1 MB`), same backup state (7 files, `~10.6` hours latest age), same PITR state (`wal_level=replica`, `archive_mode=off`), same restore-test gap (`UNVERIFIED`).

The only differences are presentation-level (uptime reported as "~20 days" here vs. "~19 days 23 hours" in Stage B — consistent with a few hours' additional elapsed time; load average and exact byte-level backup size were not repeated here). No field contradicts Stage B.

**Conclusion:** this is treated as a corroborating re-confirmation of the same underlying production state F0-002 Stage B already documented, not an independent second evidence-collection event with its own timestamp. `VERIFIED_PRODUCTION_OBSERVED` classifications below cite F0-002 Stage B as the primary evidence record and note task-prompt corroboration where relevant. No new production command was required to establish these facts — they duplicate what F0-002 already collected, per the task's own instruction not to re-request evidence F0-002 already answered.

---

## 2. Process topology — source-level verification (new for F0-006)

Repository evidence, read directly from source (not previously cited at this depth in F0-002):

| Fact | Evidence | Classification |
|---|---|---|
| API entrypoint | `server/src/index.ts` — `dotenv.config()` (no explicit path — relies on `process.cwd()`), Express app, binds `host:port` from `LISTEN_HOST`/`PORT` (defaults `0.0.0.0:5000`) | `VERIFIED_REPOSITORY` — `server/src/index.ts:72,99-101,258` |
| Worker entrypoint | `server/src/worker.ts` — separate process, own `dotenv.config()` call, calls `startBackgroundJobs()` unconditionally at module load, no HTTP server | `VERIFIED_REPOSITORY` — `server/src/worker.ts:16-24` |
| Job registration | Both `index.ts` and `worker.ts` import the same `startBackgroundJobs()` (`server/src/jobs/startBackgroundJobs.ts`), which registers 9 named cron-style jobs (reminders, meta-template sync, data-retention cleanup, inbound-event retry, imaging-bridge offline check, public-booking notice-evidence cleanup, patient-privacy export cleanup, clinic-bulk-export worker, clinic-bulk-export cleanup) | `VERIFIED_REPOSITORY` — `server/src/jobs/startBackgroundJobs.ts:1-31` |
| `RUN_BACKGROUND_JOBS` semantics — API | API starts jobs **unless** `RUN_BACKGROUND_JOBS === 'false'` (i.e. unset, empty, or any other value still starts jobs in-process) | `VERIFIED_REPOSITORY` — `server/src/index.ts:264-268` |
| `RUN_BACKGROUND_JOBS` semantics — worker | Worker starts jobs **unconditionally**; it does not read `RUN_BACKGROUND_JOBS` at all | `VERIFIED_REPOSITORY` — `server/src/worker.ts:23-24` |
| **Duplicate job registration condition** | If `RUN_BACKGROUND_JOBS` is `SET` (confirmed present, §B.8 of F0-002 Stage B) to any value other than the literal string `'false'`, **both** `noramedi-api` and `noramedi-worker` register the same 9 jobs independently, in two OS processes. The literal value was not read (redaction rule, F0-002); presence alone does not resolve which case applies. | `VERIFIED_REPOSITORY` (code path) + `UNVERIFIED_PRODUCTION` (literal value) |
| Duplicate-execution mitigation | `server/src/utils/jobLock.ts` — a Postgres-table-backed (`JobLock` model) atomic lease lock. Each job body runs under `withJobLock(name, ttlMs, fn)`; if a lock is already held (by the other process or another replica), the calling process logs a skip and does **not** execute the job body this tick. This is DB-based specifically so no extra infrastructure (Redis, etc.) is required and so it works identically whether one process or two register the same cron. | `VERIFIED_REPOSITORY` — `server/src/utils/jobLock.ts:1-88` |
| **Net conclusion** | Two-process job *registration* is architecturally possible and its actual state on this host is `UNVERIFIED_PRODUCTION` (the literal `RUN_BACKGROUND_JOBS` value was intentionally not read). Duplicate job *execution* (i.e. the same tick's work running twice) is prevented by `JobLock` regardless of the registration case. This distinction — registration vs. execution — is the basis for risk R-034 below; it must not be collapsed into a single claim either way. | `VERIFIED_REPOSITORY` (synthesis) |
| Graceful shutdown — API | `SIGTERM`/`SIGINT` → `server.close()` (stop accepting new connections, drain in-flight) → `Promise.allSettled([prisma.$disconnect(), closeRedis()])` → exit 0; forced exit after 10s if not clean | `VERIFIED_REPOSITORY` — `server/src/index.ts:274-291` (previously cited by F0-002 Stage A §6.6 at an approximate line range; re-confirmed here at the exact block) |
| Graceful shutdown — worker | Same pattern, independently implemented (no shared shutdown helper module) | `VERIFIED_REPOSITORY` — `server/src/worker.ts:29-44` |
| Health/readiness | Single endpoint `GET /api/health` — `Promise.race` of `SELECT 1` (Prisma) vs. a 3s timeout; `200 {status:"ok"}` or `503 {status:"degraded"}`; unauthenticated, no detail leaked. No separate liveness-only or worker-specific health endpoint exists — the worker process has **no HTTP surface at all**, so nothing external can probe worker liveness directly (only PM2's own process-alive check applies to it) | `VERIFIED_REPOSITORY` — `server/src/index.ts:162-172` |
| PM2 process definition | **No `ecosystem.config.js`/`.cjs`/`.json` file exists anywhere in the repository** (`Glob` for `ecosystem.config.*` at repository root: 0 matches). `scripts/noramedi-deploy.sh` only ever calls `pm2 reload noramedi-api --update-env` — it assumes both PM2 processes (`noramedi-api` AND `noramedi-worker`) were registered by some out-of-repository, undocumented `pm2 start ...` invocation. Nothing in the repository defines the worker's PM2 registration, its working directory, or its own `--update-env` reload path. | `VERIFIED_REPOSITORY` (absence) — confirms and sharpens F0-002 Stage A §6.6/§6.10 item 3 |
| Env file location assumption | The production evidence-request runbook (`F0-002_PRODUCTION_EVIDENCE_REQUEST.md` §G) hardcodes `ENV_FILE="$APP_DIR/server/.env"`, consistent with `dotenv.config()`'s default behavior only if the PM2 process's working directory is `server/`. **No repository file confirms this is actually the working directory PM2 uses for either process** — it is inferred from the deploy script's `pushd "$APP_DIR/server"` for the `npm ci`/`prisma` steps, not from any PM2 process registration in this repository. | `VERIFIED_REPOSITORY` (partial) + `UNVERIFIED_PRODUCTION` (actual PM2 `cwd`) |

---

## 3. Deployment topology — verified deploy sequence (cites F0-002 §6.6, adds ordering/atomicity analysis)

From `scripts/noramedi-deploy.sh` (full file read):

```
1. git -C $APP_DIR pull --ff-only          (skip: --skip-pull)
2. cd $APP_DIR/server; npm ci              (skip: --skip-build)
3. npx prisma migrate deploy               (skip: --skip-migrate)
4. npx prisma generate                     (skip: --skip-generate)
5. pm2 reload noramedi-api --update-env
6. sleep 2
7. noramedi-healthcheck.sh --local --max-attempts 12 --interval 5
```

| Question | Answer | Evidence |
|---|---|---|
| Migration ordering | Migrations run (step 3) **before** the API reload (step 5) — new-schema-compatible code is deployed to disk first (steps 1-2), then migrated, then reloaded. This is the correct ordering for additive/backward-compatible migrations; the script has no concept of a multi-phase (expand/contract) migration and would apply a breaking migration in the same pass. | `scripts/noramedi-deploy.sh:56-86`, `VERIFIED_REPOSITORY` |
| Backend build/restart ordering | No compiled build step for the backend — `tsx` runs TypeScript directly at runtime (confirmed F0-002 §6.6). `npm ci` (step 2) refreshes `node_modules` before `pm2 reload` (step 5), so a reload always picks up the newly installed dependency tree. | `VERIFIED_REPOSITORY` |
| Worker restart ordering | **Not present in this script at all.** The script never runs `pm2 reload noramedi-worker`. If the worker process is left running against pre-deploy code/dependencies after this script completes, it continues executing whatever it had loaded at its own last start — the deploy script's migration step still applies to the shared database both processes use, so a worker running old code against a newly migrated schema is possible if a migration changes something the worker path depends on differently than the API path does. | `VERIFIED_REPOSITORY` (absence), confirms F0-002 §6.6/§6.10 item 3 |
| Frontend build/deploy ordering | **Not present in this script at all.** `noramedi-deploy.sh` only touches `$APP_DIR/server`; it never runs the frontend `build` script (`tsc -b && vite build`) or touches `nginx`'s static file root (`/usr/share/nginx/html`, per the repository's container-oriented `nginx.conf`, or whatever path the actual host Nginx serves from — not established by this evidence). Frontend deployment is **not reproducible from this script**; it must happen via a separate, undocumented mechanism. | `VERIFIED_REPOSITORY` (absence) |
| Atomicity | `set -euo pipefail` (line 24) means the script aborts on the first failing step — it is **fail-fast**, not **atomic**: if step 3 (migrate) succeeds but step 5 (`pm2 reload`) fails, the database has already been migrated against code that was never reloaded to serve it, and the script does not roll the migration back. There is no transactional wrapper across the whole sequence. | `VERIFIED_REPOSITORY` — `scripts/noramedi-deploy.sh:24` |
| Migration-success validation before restart | The script relies solely on `prisma migrate deploy`'s own exit code (via `set -e`); it does not separately query `_prisma_migrations` to confirm `finished_at IS NOT NULL` before proceeding to reload. If `migrate deploy` exits 0 this is a reasonable proxy, but there is no independent verification step. | `VERIFIED_REPOSITORY` |
| Health verification after restart | Yes — step 7, `noramedi-healthcheck.sh --local`, retries up to 12 times at 5s intervals (~60s ceiling), treats `200/204/401/403` as healthy | `VERIFIED_REPOSITORY` — `scripts/noramedi-healthcheck.sh:74-98` |
| Rollback path | **None found.** No rollback subcommand, no previous-release retention mechanism (e.g. releases/current symlink pattern), no automated `git revert`/`prisma migrate resolve` invocation anywhere in `scripts/` or root docs for the bare-VPS path. A rollback would require manual `git checkout <previous-sha>`, manual `npm ci`, and — for a destructive migration — manual intervention with no scripted support. | `VERIFIED_REPOSITORY` (absence), confirms F0-002 §6.6 |
| Frontend artifact-matches-source verification | **Not checked by any repository script**, and not part of F0-002 Stage B's read-only command scope. Remains `UNVERIFIED_PRODUCTION`. | `UNVERIFIED_PRODUCTION` |
| Docker vs. bare-VPS | **Confirmed bare-VPS + PM2 + host Nginx** is what actually runs (F0-002 Stage B §B.2/§B.4/§B.6). `docs/35-docker-deploy-runbook.md` (read directly for this task) describes a **different, non-existent** topology: containers `disklinikcrm_api`/`disklinikcrm_frontend`, compose files under `/docker/disklinikcrm/`, database name `dis_klinik_crm` (not `noramedi_crm`), product name "Aile Dis CRM" throughout. No `Dockerfile` or `docker-compose*` file exists anywhere in the repository (confirmed absent, F0-002 §6.7). This document is **stale/aspirational documentation**, not a description of any topology that has ever run in production per available evidence. | `VERIFIED_REPOSITORY` + `VERIFIED_PRODUCTION_OBSERVED` |

---

## 4. Nginx and public routing

| Fact | Value | Classification |
|---|---|---|
| Repository `nginx.conf` | Container-internal only — serves the SPA build from `/usr/share/nginx/html`, explicit comment block states TLS termination/redirect/HSTS are the external proxy's responsibility and instructs **not** to add `listen 443 ssl` to this file | `VERIFIED_REPOSITORY` — `nginx.conf:1-31` |
| Confirmed public hostnames | `api.noramedi.com`, `app.noramedi.com`, `noramedi.com`, `www.noramedi.com` | `VERIFIED_PRODUCTION_OBSERVED` — F0-002 Stage B §B.6 |
| TLS termination point | Host Nginx `1.24.0` (not the repository's container `nginx.conf`, and not the application itself) | `VERIFIED_PRODUCTION_OBSERVED` — F0-002 Stage B §B.6 |
| Static asset serving | Repository `nginx.conf` pattern (`try_files ... /index.html`, 1y cache for hashed static assets, no-cache for `index.html`) is evidence of the *intended* SPA-serving pattern; whether the actual host Nginx config matches this file verbatim is **not confirmed** — the host's active config was not requested or read (per task instruction not to request/record the full production Nginx config) | `VERIFIED_REPOSITORY` (repository intent) / `UNVERIFIED_PRODUCTION` (host config content) |
| `TRUST_PROXY` / `X-Forwarded-For` | API reads `TRUST_PROXY` (default `1`, i.e. trust exactly one hop) and derives `req.ip` from `X-Forwarded-For` — correct only if exactly one reverse proxy (the host Nginx) sits in front of the API, which matches the confirmed bare-VPS topology | `VERIFIED_REPOSITORY` — `server/src/index.ts:125-134` |
| Request body limit | Application-level: `express.json({ limit: process.env.JSON_BODY_LIMIT || '1mb' })` — a repository-level default, independent of whatever `client_max_body_size` the host Nginx may or may not set | `VERIFIED_REPOSITORY` — `server/src/index.ts:153-158` |
| Nginx-level body/timeout limits | **Not requested** — task instruction explicitly limits this area to repository evidence unless strictly necessary, and the host's live Nginx config was not part of F0-002's read-only command set either | `UNVERIFIED_PRODUCTION` |
| Security headers (application-level) | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` always; `Strict-Transport-Security: max-age=15552000; includeSubDomains` when `NODE_ENV=production` | `VERIFIED_REPOSITORY` — `server/src/index.ts:140-148` |
| Security headers (Nginx-level) | Not established — host Nginx config not requested | `UNVERIFIED_PRODUCTION` |
| WebSocket/SSE | No WebSocket/SSE server code found in `server/src/index.ts`; not otherwise assessed (out of scope unless evidence surfaced one) | `VERIFIED_REPOSITORY` (absence, based on entrypoint read only — not a repository-wide search) |

---

## 5. Configuration model

| Fact | Value | Classification |
|---|---|---|
| Env loading mechanism | `dotenv.config()` (no explicit path argument) called independently in `server/src/index.ts`, `server/src/worker.ts`, and (via `import 'dotenv/config'`) `server/src/db.ts`. All three resolve relative to `process.cwd()` at process start — there is no centralized/shared config-loading module. | `VERIFIED_REPOSITORY` |
| Config file location (repository-documented) | `server/.env` (per `server/.env.example`'s existence and the production evidence-request runbook's hardcoded `$APP_DIR/server/.env`) | `VERIFIED_REPOSITORY` (documented convention) + `UNVERIFIED_PRODUCTION` (actual PM2 `cwd`, see §2 above) |
| Required variables (fatal if missing/invalid in production) | `ENCRYPTION_KEY` — `process.exit(1)` if unset/invalid **when `NODE_ENV=production`** (warns only otherwise) | `VERIFIED_REPOSITORY` — `server/src/index.ts:75-89` |
| Required variable (implicit, no fallback) | `DATABASE_URL` — passed with a non-null assertion (`!`) directly into the Prisma adapter; an unset value would throw at Prisma client construction, not with a friendly startup message | `VERIFIED_REPOSITORY` — `server/src/db.ts:16` |
| Optional with documented defaults | `PORT` (5000), `LISTEN_HOST` (`0.0.0.0`), `JSON_BODY_LIMIT` (`1mb`), `TRUST_PROXY` (`1`), `DB_POOL_MAX` (10), `DB_POOL_CONNECT_TIMEOUT_MS` (10 000), `DB_POOL_IDLE_TIMEOUT_MS` (30 000), `RUN_BACKGROUND_JOBS` (unset = jobs run in-process) | `VERIFIED_REPOSITORY` |
| Optional, fail-open capability | `REDIS_URL` — absent means all Redis-backed rate-limit/shared-state code falls back to an in-process `Map` (documented fail-open design, `server/src/utils/redis.ts`) | `VERIFIED_REPOSITORY` |
| Optional, feature-gated | `S3_BUCKET`/`S3_REGION`/`S3_ENDPOINT`/`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`/`S3_FORCE_PATH_STYLE` — presence of `S3_BUCKET` alone flips storage mode; the other four are optional refinements | `VERIFIED_REPOSITORY` — `server/src/services/fileStorage.ts:43-64` |
| Duplicate source found | `server/.env.example` defines `CORS_ORIGINS=` **twice** (line 17, a "Development" example; line 21, a "Production" example) — both uncommented. In a real `.env` file loaded by `dotenv`, only the **last** assignment takes effect (`dotenv` does not error on duplicate keys). This is an example-file quality issue (previously noted, F0-002 §6.10 item 6), re-confirmed here by direct read. It does not affect production unless production's actual `.env` was copied from this example without editing — not something this task can check without reading `.env` content, which is out of scope. | `VERIFIED_REPOSITORY` |
| `.env.example` gaps | `REDIS_URL`, `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `RUN_BACKGROUND_JOBS`, `DB_POOL_MAX`/`DB_POOL_CONNECT_TIMEOUT_MS`/`DB_POOL_IDLE_TIMEOUT_MS` do not appear in `server/.env.example` at all (confirmed by direct read for this task) — a fresh deployment following only the example file would not discover these options. Previously noted at a summary level by F0-002 §6.10 item 5; this task confirms the exact variable list by direct inspection. | `VERIFIED_REPOSITORY` |
| Unsafe default present | `SESSION_COOKIE_SECURE=false` is the example file's **default line** (line 100); a commented-out line 102 shows the production override (`SESSION_COOKIE_SECURE=true`). If an operator copies `.env.example` to `.env` without uncommenting the production block, session cookies would be issued without the `Secure` flag. Not evidence that production actually has this misconfiguration (production's `.env` content was not read) — flagged as a **documentation/template risk**, not a confirmed production defect. | `VERIFIED_REPOSITORY` |
| Frontend build-time vs. runtime config | Frontend is a Vite SPA — any `VITE_*` variable is baked into the build at `vite build` time (standard Vite behavior), not read at runtime by the served static bundle. `docs/35-docker-deploy-runbook.md` documents `VITE_API_URL`, `VITE_APP_NAME`, etc. as build-time inputs for its (stale) Docker path; the bare-VPS frontend build/deploy mechanism itself is not defined in any repository script (§3 above), so **which values were actually baked into the currently-served frontend bundle is unverified**. | `VERIFIED_REPOSITORY` (mechanism) + `UNVERIFIED_PRODUCTION` (actual deployed values) |
| API vs. worker config consistency | Both processes read from the same `server/.env` location (assumed, see §2) and share the same `DATABASE_URL`/`REDIS_URL`/etc. — no evidence of environment divergence between the two processes was found or checked (no per-process env diffing was part of any evidence collection) | `VERIFIED_REPOSITORY` (mechanism) / `NOT_APPLICABLE` (not independently checked) |

---

## 6. PostgreSQL

| Fact | Value | Classification |
|---|---|---|
| Connection path | `@prisma/adapter-pg` (driver-adapter pattern) over `pg` `8.22.0`, single `DATABASE_URL` for all reads/writes | `VERIFIED_REPOSITORY` — `server/src/db.ts` |
| Connection pool | `max` = `DB_POOL_MAX` (default 10) per **process** — with 2 processes (API + worker) at default settings, up to 20 concurrent connections from this application alone; `connectionTimeoutMillis`/`idleTimeoutMillis` also configurable | `VERIFIED_REPOSITORY` |
| PgBouncer | No repository evidence found (confirmed absence, F0-002 §6.7); not part of any production evidence collected to date | `VERIFIED_REPOSITORY` (absence) + `UNVERIFIED_PRODUCTION` (production presence/absence never checked) |
| Read replica | No repository evidence of read/write connection splitting | `VERIFIED_REPOSITORY` (absence) + `UNVERIFIED_PRODUCTION` |
| Migration execution path | `npx prisma migrate deploy` inside `scripts/noramedi-deploy.sh`, run once per deploy from `$APP_DIR/server`, shared by both API and worker (worker never runs migrations itself) | `VERIFIED_REPOSITORY` |
| Backup model | External script (`/usr/local/sbin/noramedi-db-backup.sh`, not in this repository) triggered by cron (`/etc/cron.d/noramedi-db-backup`); repository only contains the *status/trigger/retention* client logic (`server/src/services/backupService.ts`) — fixed paths `BACKUP_DIR=/root/noramedi-backups`, retention 7 days, filename pattern `noramedi_crm-YYYYMMDD-HHMMSS.dump` | `VERIFIED_REPOSITORY` (client side) — confirms F0-002 §6.7 |
| Restore model | `runRestoreTest()` in the same service — creates a uniquely-named temp DB, `pg_restore`s the target `.dump` with `--no-privileges --no-owner`, runs read-only verification queries (table count, `PlatformAdmin` count, `Plan` count, `_prisma_migrations` count), always drops the temp DB in a `finally` block | `VERIFIED_REPOSITORY` — `server/src/services/backupService.ts:167-277` |
| Restore-test trigger surface | `POST /api/platform/backups/restore-test` — gated behind `authenticatePlatformAdmin` + `csrfProtection('platform')` (applied to "all routes below" at `platformAdmin.ts:138`, which includes the backup routes registered later in the file) — **manually triggered by an authenticated platform admin only; not scheduled/automated anywhere in the repository** | `VERIFIED_REPOSITORY` — `server/src/routes/platformAdmin.ts:134-151` |
| PITR gap | `wal_level=replica`, `archive_mode=off` — `NOT_CONFIGURED`/`NOT_AVAILABLE` | `VERIFIED_PRODUCTION_OBSERVED` — F0-002 Stage B §B.10 |

---

## 7. Redis

| Fact | Value | Classification |
|---|---|---|
| Components using Redis | Optional, fail-open shared store for rate-limit counters (per `server/src/utils/redis.ts`'s own header comment); no other subsystem (queue, session, cache) was found to depend on Redis in the files read for this task | `VERIFIED_REPOSITORY` |
| Client construction | Lazy singleton — only constructed on first `getRedis()` call, only if `REDIS_URL` is set; `maxRetriesPerRequest: 1`, `enableOfflineQueue: false`, `connectTimeout: 5000` | `VERIFIED_REPOSITORY` — `server/src/utils/redis.ts:18-31` |
| Fallback on unavailability | Callers fall back to an in-process `Map` — single-process (or single-replica) behavior is unaffected; multi-replica deployments lose cross-replica rate-limit sharing without Redis | `VERIFIED_REPOSITORY` |
| Worker dependency on Redis | Worker startup (`worker.ts`) does not construct or require a Redis connection itself; `startBackgroundJobs()`'s constituent jobs were not individually audited for Redis use in this task (out of the read-file set) | `VERIFIED_REPOSITORY` (entrypoint level) / `NOT_APPLICABLE` (not exhaustively checked per-job) |
| Production state | Redis `7.0.15`, service **active**, `REDIS_URL` `SET` | `VERIFIED_PRODUCTION_OBSERVED` — F0-002 Stage B §B.3/§B.8 |
| Tenant/security impact | Fail-open design means a Redis outage degrades shared rate-limiting to per-process limiting, not a security bypass of any auth/authorization check (rate-limiting only) | `VERIFIED_REPOSITORY` (design intent, not independently penetration-tested) |

---

## 8. Storage

| Fact | Value | Classification |
|---|---|---|
| Local upload path | `path.resolve(process.cwd(), 'uploads')` — same `process.cwd()` dependency as the env-loading mechanism (§5); resolves to `server/uploads` when the process's working directory is `server/` | `VERIFIED_REPOSITORY` — `server/src/services/fileStorage.ts:41` |
| Storage-key scheme (new records) | `{clinicId}/{timestamp}-{rand}{ext}`, server-generated — no client input reaches a path segment | `VERIFIED_REPOSITORY` — `server/src/services/fileStorage.ts:71-74` |
| Storage-key scheme (legacy records) | Absolute filesystem paths, always read from local disk regardless of `S3_BUCKET` configuration — a legacy record can never be served from S3 even after a storage-mode switch | `VERIFIED_REPOSITORY` — `server/src/services/fileStorage.ts:81-83,105-118` |
| Path-traversal protection | `isSafeStorageKey()` rejects absolute paths (POSIX and Win32 forms), UNC prefixes, control characters, and any `.`/`..` path segment for all **new** code paths (`fileExists`, `statFile`); explicitly does not apply to the legacy absolute-path fallback (by design, for backward compatibility) | `VERIFIED_REPOSITORY` — `server/src/services/fileStorage.ts:144-155` |
| S3-compatible mode | Enabled when `S3_BUCKET` is set; supports non-AWS S3-compatible endpoints (`S3_ENDPOINT`, e.g. MinIO/R2), path-style addressing, and falls back to the AWS SDK's default credential chain if explicit keys are absent | `VERIFIED_REPOSITORY` — `server/src/services/fileStorage.ts:43-64` |
| Production storage mode | `LOCAL_VPS_STORAGE` — `S3_BUCKET`/`S3_REGION`/`S3_ENDPOINT` all `MISSING`; `/var/www/noramedi/server/uploads` exists, `~3.1 MB` | `VERIFIED_PRODUCTION_OBSERVED` — F0-002 Stage B §B.9 |
| Filesystem persistence assumption | Local mode assumes a single, persistent, non-ephemeral filesystem for the process's entire lifetime — no horizontal API scaling is possible without either shared network storage or a migration to S3-compatible storage, since a second API replica would not see files written to the first replica's local `uploads/` | `VERIFIED_REPOSITORY` (architectural implication of local mode) |
| Backup inclusion/exclusion | The database backup pipeline (`noramedi-db-backup.sh`, cron-triggered) backs up **only** the PostgreSQL database (per its invocation via `runBackup()`, which shells out with no arguments referencing `uploads/`) — `server/uploads/` (patient/lab file content) is **not** part of the observed backup pipeline based on repository evidence; this was not independently confirmed against the actual script's contents (the script itself is not in this repository) | `VERIFIED_REPOSITORY` (client-side inference) + `UNVERIFIED_PRODUCTION` (actual script behavior) |
| Tenant isolation (storage) | New-record keys are clinic-scoped (`{clinicId}/...`) by construction; no cross-tenant path is reachable through the key-generation functions read in this task | `VERIFIED_REPOSITORY` |
| KVKK implication | Patient/lab file content on local disk is subject to the same single-VPS availability/durability profile as the database, but is **not** included in the database backup pipeline per the evidence above — a VPS-level loss (disk failure, host loss) could lose original file content independent of database backup state | `VERIFIED_REPOSITORY` (synthesis) — basis for risk R-029 below |

---

## 9. Backup and resilience

Fully covered by F0-002 Stage B §B.10/§B.11 (not repeated in detail) plus this task's source-level additions:

| Fact | Value | Classification |
|---|---|---|
| Cron schedule | `/etc/cron.d/noramedi-db-backup` present; exact schedule expression not read (redaction rule — cron file content not printed, only presence) | `VERIFIED_PRODUCTION_OBSERVED` (presence) — F0-002 Stage B §B.10 |
| Retention policy | `7` days, hardcoded in `server/src/services/backupService.ts:13` (`RETENTION_DAYS = 7`) — this is the **client-side display value**; actual deletion of old backups is presumably performed by the external script itself (not in this repository), so the retention *enforcement* mechanism is `UNVERIFIED_PRODUCTION` even though the *declared* policy is `VERIFIED_REPOSITORY` | `VERIFIED_REPOSITORY` (declared) / `UNVERIFIED_PRODUCTION` (enforced) |
| Backup location | `/root/noramedi-backups` — same host as the database it backs up | `VERIFIED_PRODUCTION_OBSERVED` — F0-002 Stage B §B.10 |
| Same-host risk | Confirmed — no offsite copy evidence found or supplied | `VERIFIED_PRODUCTION_OBSERVED` (absence) — F0-002 Stage B §B.10/§B.11 |
| Encryption status | Not established by any repository or production evidence collected (backup file encryption-at-rest was not part of any evidence request) | `UNVERIFIED_PRODUCTION` |
| Restore-test capability | Exists (`runRestoreTest()`), manually triggered via authenticated platform-admin API only (§6 above) | `VERIFIED_REPOSITORY` |
| Restore-test evidence | No matching automated cron/systemd restore-test job found; no durable manual record supplied | `UNVERIFIED_PRODUCTION` — F0-002 Stage B §B.10 |
| RPO | Bounded below by backup frequency — at evidence time, latest backup was `~10.6` hours old, implying a worst-case RPO on the order of the cron interval (exact interval not read, per redaction rule) plus any backup-run duration | `VERIFIED_PRODUCTION_OBSERVED` (age observation) / `UNVERIFIED_PRODUCTION` (exact scheduled interval) |
| RTO | Not established — no restore has been confirmed as ever exercised, so no restore-duration data exists to estimate RTO from | `UNVERIFIED_PRODUCTION` |
| PITR status | `NOT_CONFIGURED`/`NOT_AVAILABLE` (`archive_mode=off`) | `VERIFIED_PRODUCTION_OBSERVED` — F0-002 Stage B §B.10 |
| Rollback limitation | No application-level deploy rollback path (§3 above) compounds the backup/PITR gap: a bad migration cannot be rolled back by the deploy script, and point-in-time recovery to just-before-the-migration is unavailable (`archive_mode=off`) — the only recovery path is restoring the most recent full backup (up to ~11h old at evidence time) and re-applying any subsequent, non-migration data changes manually, if possible at all | `VERIFIED_REPOSITORY` (synthesis) |

---

## 10. Security and privilege

| Fact | Value | Classification |
|---|---|---|
| PM2 process owner | Both `noramedi-api` and `noramedi-worker` run as `root` | `VERIFIED_PRODUCTION_OBSERVED` — F0-002 Stage B §B.11 finding 10 |
| File ownership assumption | Not independently checked (would require `stat` on `$APP_DIR`, not part of any evidence request to date) | `UNVERIFIED_PRODUCTION` |
| Least-privilege gap | Running both application processes as `root` means any remote-code-execution vulnerability in either process (API or worker) would grant an attacker root on the host, not a scoped service-account. No evidence was collected of any mitigating control (e.g. a container/namespace boundary) — the confirmed topology is bare-VPS + PM2 with no container isolation. | `VERIFIED_REPOSITORY` (architectural absence) + `VERIFIED_PRODUCTION_OBSERVED` (root execution confirmed) |
| Env file permissions | Not checked — out of the read-only evidence-request scope to date (would require `stat -c '%a %U:%G' $APP_DIR/server/.env`, not previously requested) | `UNVERIFIED_PRODUCTION` |
| Nginx/API privilege separation | Nginx (`1.24.0`) and the Node processes are logically separated (reverse proxy vs. application) but both ultimately run on the same host with no evidence of OS-level sandboxing between them | `VERIFIED_PRODUCTION_OBSERVED` (topology) + `UNVERIFIED_PRODUCTION` (isolation mechanism, if any) |
| Secret exposure in deploy scripts | `scripts/noramedi-deploy.sh` and `scripts/noramedi-healthcheck.sh` were read in full — neither script echoes, logs, or otherwise handles any secret value; `pm2 reload ... --update-env` re-reads the environment from whatever the process's env source already is, it does not print it | `VERIFIED_REPOSITORY` |
| Backup/restore trigger authorization | `POST /api/platform/backups/run` and `POST /api/platform/backups/restore-test` both sit behind `router.use(authenticatePlatformAdmin, csrfProtection('platform'))` (all routes below `platformAdmin.ts:138`, which includes both) — not reachable by a clinic-scoped user token | `VERIFIED_REPOSITORY` — `server/src/routes/platformAdmin.ts:134-151` |

---

## 11. Drift and contradictions table

| # | Repository expectation | Production observation | Classification | Risk | Required follow-up |
|---|---|---|---|---|---|
| 1 | CI (`windows-bridge-pr.yml`) declares/uses Node `20`; no `engines` field anywhere in root/server `package.json` | Node `22.23.1` running both `noramedi-api` and `noramedi-worker` | `VERSION_DRIFT` | Medium — unmonitored 2-major-version gap between the only tested Node version and the actually-deployed one | Add an `engines` field pinning the intended production Node major version; add it to CI as an explicit compatibility check; decide whether to standardize on 20 or 22 as the target (F1/F3 scope) |
| 2 | `docs/35-docker-deploy-runbook.md` describes a Docker Compose deployment (`disklinikcrm_api`/`disklinikcrm_frontend` containers, `/docker/disklinikcrm/`, DB name `dis_klinik_crm`, product name "Aile Dis CRM") | Bare-VPS + PM2 + host Nginx (`/var/www/noramedi`, `noramedi_crm`, `noramedi-api`/`noramedi-worker`) — no `Dockerfile`/`docker-compose*` file exists anywhere in the repository | `STALE_DOCUMENTATION` | Medium — could mislead a future deploy attempt or a new operator | Mark `docs/35-docker-deploy-runbook.md` as deprecated/historical, or delete it, in a future documentation-scoped task (out of F0-006's own non-goals — no doc content is rewritten here beyond this table) |
| 3 | `server/package.json` declares `start:worker` (`npx prisma generate && tsx src/worker.ts`) and the worker has its own graceful-shutdown/job-registration code | `scripts/noramedi-deploy.sh` never registers, reloads, or restarts a `noramedi-worker` PM2 process; no `ecosystem.config.*` file exists in the repository | `DEPLOYMENT_DRIFT` | High — the worker's actual update/restart lifecycle in production is not reproducible from anything in this repository; a deploy currently updates the API but not necessarily the worker, unless an undocumented manual step exists | Author and commit an `ecosystem.config.js`/deploy-script extension that explicitly registers/reloads `noramedi-worker`, or document the existing out-of-repository mechanism if one already exists (requires user/operator input — this cannot be inferred from repository or read-only evidence alone) |
| 4 | Vite frontend `build` script (`tsc -b && vite build`) produces `dist/` from source at a given commit | No repository script deploys the frontend build to the host Nginx's static root; whether the currently-served bundle matches source at the currently-deployed backend commit (`7fcf2f850f151241266f07349c4bf4442c72bbca`) is unconfirmed | `UNVERIFIED` | Medium — a frontend/backend version skew (e.g. a stale frontend calling a changed API contract) would not be caught by any existing check | A minimal, non-secret-leaking read-only check (e.g. hashing the served `index.html`/main bundle filename and comparing to a fresh local build's asset manifest) could resolve this in a future task; not attempted here per the read-only/no-build-locally scope |
| 5 | `fileStorage.ts` supports both local-disk and S3-compatible storage modes | Production runs `LOCAL_VPS_STORAGE` — no S3-compatible target configured | `CONFIG_DRIFT` (relative to the program's stated direction, tracker §9 item 13: "object storage mandatory before imaging scales") | High — patient/lab file content co-located with the database on a single VPS with no object-storage redundancy | F0-011 (Object Storage and Backup Migration Design) — this task documents the gap, does not remediate it |
| 6 | `backupService.ts` declares `wal_level`/`archive_mode` are relevant to PITR (comment-documented expectation that PITR is a target capability) | `archive_mode=off` — PITR not configured | `CONFIG_DRIFT` | High — no point-in-time recovery; recovery granularity is bounded by backup frequency (~11h observed gap) | F0-011 / a dedicated PITR-enablement task; out of F0-006 scope to configure |
| 7 | `runRestoreTest()` exists as a first-class, admin-triggerable capability | No durable evidence any restore has ever actually been exercised via this or any other path | `UNVERIFIED` | High — a backup pipeline that has never been proven restorable carries unknown real recovery risk | A scheduled, evidence-producing restore-test exercise (writes its result to a durable, queryable location) should be planned as a dedicated operational task, not silently assumed to work because the code exists |
| 8 | Deploy script assumes PM2 is pre-installed and both application processes are managed by it | Both `noramedi-api` and `noramedi-worker` confirmed running as PM2 processes owned by `root` | `MATCH` (topology) + separately flagged `CONFIG_DRIFT` (privilege) | Medium — no least-privilege separation; a code-execution bug in either process is host-root-equivalent | Evaluate running both processes under a dedicated non-root service account in a future hardening task (F3 — Production Hardening) |
| 9 | `backupService.ts` hardcodes `BACKUP_DIR=/root/noramedi-backups` (same host as the database) with no offsite-upload step anywhere in the codebase | Backup directory confirmed local to the same VPS; no offsite copy evidence found or supplied | `CONFIG_DRIFT` (relative to program direction — secure/durable backups implied by AGENTS.md's "Secure backups" security rule) | High — a single host-level incident (disk failure, host compromise, accidental deletion) could destroy both the live database and every backup simultaneously | F0-011 — extend the backup pipeline with an offsite/object-storage upload step |

Rows 5, 6, 7, and 9 restate F0-002 Stage B's already-identified `HIGH` risks in the specific drift-table format this task requires — they are not new discoveries, they are the same findings reclassified against the task's required schema. Rows 1, 2, 3, 4, and 8 add detail beyond what F0-002 recorded (worker deploy-automation gap now explicitly classified as `DEPLOYMENT_DRIFT` with a concrete remediation path; Docker runbook explicitly classified `STALE_DOCUMENTATION`; frontend artifact question formally entered as an open `UNVERIFIED` row; PM2 root execution formally paired with a `CONFIG_DRIFT` classification distinct from the topology `MATCH`).

---

## 12. Accepted findings (F0-006-specific, beyond F0-002)

1. Background-job registration can occur in both `noramedi-api` and `noramedi-worker` simultaneously depending on the literal (unread) value of `RUN_BACKGROUND_JOBS`; duplicate *execution* of any single job tick is prevented by a DB-backed `JobLock`, not by process topology alone.
2. No `ecosystem.config.*` file or other repository-committed PM2 process definition exists; both PM2 processes' registration (name, `cwd`, restart policy, log paths) originates entirely outside this repository.
3. The deploy script (`scripts/noramedi-deploy.sh`) is fail-fast (`set -euo pipefail`) but not atomic or rollback-capable; a mid-sequence failure between migration and reload can leave the database migrated ahead of the running code.
4. Frontend deployment (build + publish to the Nginx static root) has no corresponding script anywhere in the repository; it is entirely undocumented from a repository-evidence standpoint.
5. Backup/restore-test trigger endpoints are correctly gated behind platform-admin authentication and CSRF protection; there is no evidence of an unauthenticated or under-privileged path to either capability.
6. The retention policy (7 days) is a client-side *display* value in `backupService.ts`; its actual enforcement depends on the external backup script, which is not part of this repository and was not independently verified.
7. `docs/35-docker-deploy-runbook.md` is confirmed, by direct content inspection for this task, to describe a topology (containers, compose paths, old product/database names) that does not correspond to any file present in the repository and does not correspond to the confirmed running production topology.

## 13. Explicitly unverified after F0-006 (no fabricated resolution)

- Literal value of `RUN_BACKGROUND_JOBS` in production (presence only was ever confirmed, per redaction rule — not re-requested here since the JobLock-based conclusion in §2 holds regardless of the value)
- PM2 `cwd` for `noramedi-api` and `noramedi-worker` (assumed `server/` by convention, never confirmed)
- Actual host Nginx configuration content (body-size limits, timeouts, security headers, upstream directives) — intentionally not requested, per task instruction
- PgBouncer / read-replica presence in production
- Frontend build-artifact-to-source match
- Backup encryption-at-rest status
- Offsite backup existence
- Actual retention-enforcement mechanism (vs. the declared 7-day policy)
- Env file (`server/.env`) filesystem permissions and ownership
- Whether `server/uploads/` content is included in any backup pipeline (repository evidence suggests it is not, but the external backup script's actual contents were never read)
- Last restore test (remains `UNVERIFIED`, not "never happened" — per the same explicit instruction F0-002 applied)

---

## Files touched by this delivery

Only files under `docs/program/` were created or modified. No application source, schema, migration, package manifest, lockfile, test, CI workflow, deployment script, Nginx file, environment file, or runtime configuration was modified. No production system was changed or accessed by this agent — all production facts cited here trace to F0-002 Stage B (collected by the user, read-only) or to the task-supplied evidence block reconciled in §1 above (also user-supplied, read-only, same underlying session).

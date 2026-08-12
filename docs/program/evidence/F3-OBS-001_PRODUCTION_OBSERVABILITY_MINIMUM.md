# F3-OBS-001 — First-Customer Production Observability Minimum and Alerting Foundation

**Task ID:** F3-OBS-001 · **Phase:** F3 — Production Hardening · **Priority:** CRITICAL / F3 exit-gate
**Branch:** `feature/f3-obs-001-production-observability-minimum` · **Worktree:** `E:\Ek Gelir\Siteler\DisKlinikCRM-worktrees\f3-obs-001`
**Baseline:** `origin/main` @ `92fc0c0c5eee34ae71bd2508bbfcc2f0309e3055` (PR #359/F3-WA-META-COEX-002-R4 merge commit — includes F3-IMPL-001…004(+R1), F3-DIGIDENTIS-MAP-001(+R1)), fresh `git fetch`/`git worktree add`, no drift at task start.
**Status:** `AGENT_COMPLETED` — see §11 lifecycle states. **Does not close the F3 exit gate** (no live dashboard/alert evidence exists or is claimed by this task — see §11).

CodeGraph was queried and scoped to `server/src/index.ts`, `server/src/worker.ts`, `server/src/utils/logger.ts`, `server/src/services/operationalEventService.ts`, `server/src/utils/roles.ts`, `src/pages/Operations.tsx`, `src/utils/logger.ts`; the remaining named-in-brief files (`server/src/middleware/requestId.ts`, `server/src/utils/processRole.ts`, `scripts/noramedi-healthcheck.sh`, `scripts/noramedi-deploy.sh`, `ecosystem.config.cjs`, `server/src/utils/redis.ts`, `server/src/utils/jobLock.ts`, `server/src/routes/operationalMonitoring.ts`, `server/src/services/backupService.ts`, `server/prisma/schema.prisma`) were read directly (outside CodeGraph's per-call file budget) — no business-domain files were scanned.

---

## 1. Pre-work inventory (16 items, classified)

| # | Item | Classification | Evidence |
|---|---|---|---|
| 1 | `/health` | `PRODUCTION_READY` (unchanged by this task) | `GET /api/health` (`server/src/index.ts:178-188`): 3s-bounded `SELECT 1`, `{status:'ok'}` / `503 {status:'degraded'}`. Used by `scripts/noramedi-healthcheck.sh` (401/403 also treated as healthy — auth wall reachable) and `scripts/noramedi-deploy.sh` step 7. |
| 2 | Readiness signal | `MISSING` → now `REPOSITORY_READY` | No dedicated readiness endpoint existed; `/api/health` conflated "process alive" and "dependency ready" into one endpoint and one 3s budget. Added `GET /api/readyz` (§3). |
| 3 | Liveness signal | `MISSING` → now `REPOSITORY_READY` | No endpoint answered "is the process alive" without also touching the DB. Added `GET /api/livez` (§3). |
| 4 | DB health | `PARTIAL` (existing `/api/health` check reused, now also in `/readyz`) | Same `prisma.$queryRaw\`SELECT 1\`` pattern as `/api/health`, extracted into a testable, injectable decision (`utils/readiness.ts`). |
| 5 | Redis health | `PARTIAL` → `REPOSITORY_READY` (deliberately non-blocking) | `utils/redis.ts` already documents Redis as optional/fail-open (in-memory fallback when unconfigured; `enableOfflineQueue:false` when configured-but-down). `/readyz` reports Redis reachability when `REDIS_URL` is set but never fails readiness on it — see `utils/readiness.ts` module docstring for the explicit rationale. |
| 6 | Worker PM2/process health | `PRODUCTION_READY` (F3-IMPL-002, unchanged) | `scripts/noramedi-deploy.sh` step 8 polls `pm2 jlist` for `noramedi-worker` status `online`, aborting the deploy otherwise — no HTTP surface, by deliberate design (see that script's own comment, reaffirmed here, not re-litigated). This task adds no worker HTTP server. |
| 7 | Request ID / correlation | `PRODUCTION_READY` (F3-IMPL-001, unchanged) | `middleware/requestId.ts` echoes pino-http's `req.id` as `X-Request-Id`. Reused as-is by the new error-tracking boundary (§5) and referenced (not duplicated) by the new fatal-error handlers (§4). |
| 8 | Structured logger | `PRODUCTION_READY` (pino + pino-http, unchanged) | `utils/logger.ts` — allowlist-based structured HTTP logging, no bodies/headers/query/IP. One export added (`safeErrorLog`, previously private) so the new fatal-error handler can reuse the exact same redaction policy instead of re-implementing it (§4). |
| 9 | Exception / unhandled-rejection handling | `MISSING` → now `REPOSITORY_READY` | Neither `index.ts` nor `worker.ts` registered `process.on('uncaughtException' \| 'unhandledRejection', ...)` before this task — confirmed by repository-wide grep, zero matches outside this task's own new file. Added `utils/fatalErrorHandlers.ts` (§4), installed in both entrypoints. |
| 10 | Frontend fatal-error capture | `MISSING`, **not addressed by this task** | Out of the bounded scope confirmed with the task brief ("frontend global error/bootstrap entry only if needed" — not needed for a repository-side minimum; the backend fatal-path gap was the priority). Recorded as a follow-up in §9. |
| 11 | Backup freshness signal | `PARTIAL` (existing, authenticated; not exposed to `/readyz`) | `services/backupService.ts#getBackupStatus()` already returns `latestBackup`/`recentBackups`/`totalBackupCount` from the filesystem, surfaced via an existing authenticated Platform Admin route (audited under F3-IMPL-003/R-019). Not mandatory-dependency material for `/readyz` (a stale backup does not mean the API can't serve traffic) — left as an alert condition against the existing endpoint (§6) rather than duplicated into a new one. |
| 12 | Job failure visibility | `PARTIAL`, **not modified by this task** (F3-IMPL-006 owns bulk job/log remediation — parallel ownership boundary) | `utils/jobLock.ts` logs lock-acquisition failures (`console.error`/`console.warn`, not structured/queryable); `services/operationalEventService.ts#recordOperationalEvent()` is org-scoped (see #15) and already used by some job paths for per-tenant failures (e.g. `dataRetentionCleanupJob.ts`). No durable "N consecutive failures" counter exists for any job. Documented as an alert condition against existing structured logs (§6), not built here. |
| 13 | External uptime probe support | `PRODUCTION_READY` (unchanged) | `scripts/noramedi-healthcheck.sh` already probes `https://api.noramedi.com/api/health` with retry/backoff; unaffected by this task. `/api/livez`/`/api/readyz` are additive endpoints an external prober can point at instead/in addition (§10). |
| 14 | Metric / tracing infrastructure | `MISSING`, **deliberately deferred** | No OTel SDK, no `@opentelemetry/*` dependency, no metrics endpoint anywhere in `server/package.json` or source. Per the task brief ("Full OTel implementation is NOT required unless... small and low-risk... document as P1/F7 follow-up"), this is documented as a follow-up (§9), not implemented — full OTel instrumentation across ~70 authenticated routes and 12 background jobs is not small. |
| 15 | Operational-event infrastructure | `PRODUCTION_READY`, evaluated for reuse, **not extended** | `OperationalEvent` (Prisma model, `schema.prisma:1799`) is real, queried/written today (`operationalEventService.ts`, `routes/operationalMonitoring.ts` — `GET /api/ops/events`, `GET /api/ops/health`, org-scoped dashboard already exists). **Finding: `organizationId` is a required (non-nullable) field** — it cannot represent a process-wide fatal error (`uncaughtException`, DB-down at `/readyz`) which has no tenant/organization context. Reusing it for those would require a schema change, which this task's brief explicitly says to avoid ("No schema/migration unless absolutely unavoidable. Expected: NONE."). **Decision: not reused for process-level fatal errors** (those go to structured logs + the optional error-tracking boundary, §5); still the correct sink for the per-tenant job failures it already receives — no change needed there. |
| 16 | Production alert configuration evidence | `MISSING` / `EXTERNAL_CONFIG_REQUIRED` | No alerting-provider configuration (Sentry, PagerDuty, UptimeRobot/BetterStack, Prometheus Alertmanager, etc.) exists anywhere in this repository. §6 defines the repository-visible alert *conditions*; wiring them to a live provider is explicitly external/production-side action (§7), not performed by this task. |

---

## 2. Architectural principles — compliance

No Kubernetes, no Kafka, no microservice, no logging redesign (only one function, `safeErrorLog`, changed from private to exported — same implementation), no framework migration. Express/Prisma/PM2/modular-monolith preserved. Worker gets **no** new HTTP server — PM2 process status remains the accepted worker-liveness signal (F3-IMPL-002 precedent, reaffirmed, not re-litigated).

## 3. `/livez` and `/readyz`

**New files:**
- `server/src/utils/readiness.ts` — pure `evaluateReadiness(deps)`, injectable `checkDatabase`/`checkRedis`, no Express/Prisma import. Mirrors the existing `resolveApiBackgroundJobsOwnership()` pattern (`utils/backgroundJobsOwnership.ts`) of extracting a previously-inline decision into a tested, dependency-injected function.
- `server/src/routes/health.ts` — `buildHealthRouter({ processRole, checkDatabase, checkRedis })`, mounted at `app.use('/api', buildHealthRouter(...))` in `index.ts`, positioned immediately after the pre-existing, **byte-for-byte unchanged** `/api/health` block.

**Contract:**

| Endpoint | Auth | Dependency checks | 200 | 503 |
|---|---|---|---|---|
| `GET /api/livez` | none (mounted before `/api` auth middleware, same as `/api/health`) | none — process-alive only | always, once the process can route requests | never |
| `GET /api/readyz` | none | DB (mandatory, 3s timeout, same budget as `/api/health`); Redis (optional, reported not blocking — see `readiness.ts` docstring) | DB check ok | DB check fails or times out |

Response bodies are a fixed shape only: `{ status, role, checks: [{ name, status, reason? }] }` where `reason` is one of a closed enum (`timeout` | `error` | `not_configured`) — **never** a raw driver/exception message, connection string, or credential. Proven by `healthRoutes.test.ts` ("never leaks the raw driver error / connection string / credentials") and `readiness.test.ts` ("DB failure never leaks the raw error message into the result").

`role` is `'api'` or `'worker'` — sourced from the same `NORAMEDI_PROCESS_ROLE` contract as F3-IMPL-002's `assertProcessRole()`, satisfying "API process role visible safely."

`/api/health` is untouched — same route, same handler, same response shape, verified by direct diff review (not a new automated regression test — see `healthRoutes.test.ts`'s own docstring for why `index.ts` can't be imported by a test harness).

## 4. Exception / unhandled-rejection handling

**New file:** `server/src/utils/fatalErrorHandlers.ts` — `installFatalErrorHandlers({ processLabel, logger, exit? })`, called once in `index.ts` (`processLabel: 'api'`) and once in `worker.ts` (`processLabel: 'worker'`), both right after each entrypoint's existing `assertProcessRole()` call (i.e. as early as practical in the startup sequence, so a startup-time throw is also caught structurally).

On `uncaughtException`/`unhandledRejection`: logs one `fatal`-level structured line — `processLabel`, `kind`, and the error via the exact same `safeErrorLog()` redaction policy `utils/logger.ts` already applies to every other 5xx error path (production: `error.name` + fixed message, no raw message/stack; non-production: full message + stack) — then calls `process.exit(1)`.

**Exit-on-crash is intentional, not a gap:** per Node's own guidance, a process's in-memory state is not trustworthy after an uncaught exception; PM2 (`ecosystem.config.cjs`, unchanged) restarts it. This is a *diagnosability* fix (a crash now leaves a structured, grep-able log line with the correct process label instead of a bare stderr stack trace with no correlation to this codebase's logging), not a resilience/retry mechanism.

**Known, explicitly-scoped-out gap:** the error-tracking boundary (§5) is **not** wired into this crash path. `process.exit(1)` is synchronous and a network send to an external error-tracking provider is not; making that flush reliably before exit needs the tracking SDK's own crash-integration (e.g. Sentry's own `onFatalError`/`shutdownTimeout` handling), which only exists once `@sentry/node` is actually installed (§5) — hand-rolling a flush-then-exit race in this module would be exactly the kind of premature complexity the task brief warns against building for a dependency that isn't installed yet. Documented here, not solved.

## 5. Error tracking

**Finding:** no error-tracking provider (Sentry, GlitchTip, or otherwise) is configured anywhere in this repository — confirmed by grep across `server/`, `package.json`, `server/package.json` (zero matches for `sentry`/`glitchtip`/`opentelemetry`).

**New file:** `server/src/utils/errorTracking.ts` — `captureFatalError(err, { requestId, role, route })`, a low-lock-in boundary compatible with any Sentry-protocol-speaking ingest endpoint (Sentry itself or self-hosted GlitchTip):

- `SENTRY_DSN` unset (every environment today): pure no-op.
- `SENTRY_DSN` set, `@sentry/node` **not** installed (current repository state — this task deliberately does not add the dependency): the dynamic `import()` rejects, is caught, logged once (not per-call), still no-ops. Proven by `errorTracking.test.ts`.
- `SENTRY_DSN` set and `@sentry/node` installed (future, external step): `Sentry.init({ dsn, environment, release, sendDefaultPii: false })`, `captureException` with only `{ requestId, role, route }` as context — no request/response body, no message body beyond what `Error#message` already carries through the same production-safe path, no default PII integrations.

Wired into `index.ts`'s existing global error handler (fire-and-forget, alongside the pre-existing `logUnhandledError` call — never blocks or fails the client response). **Not** wired into the crash path — see §4's explicit reasoning.

This satisfies "compatible with future OTel expansion" in spirit (a provider-neutral capture point exists) without adding an OTel SDK now.

## 6. Alerting contract (repository-visible conditions)

None of these are wired to a live alert channel by this task — see §7/§10 for what that requires. Each row states the exact repository-visible signal an external alerting system should poll/tail.

| Condition | Signal | Source |
|---|---|---|
| API unreachable | `GET /api/livez` non-200 or connection refused/timeout | `routes/health.ts` (new) |
| Readiness failing | `GET /api/readyz` returns `503` | `routes/health.ts` (new) |
| Worker offline | `pm2 jlist` → `noramedi-worker` `pm2_env.status !== 'online'` | Pre-existing (F3-IMPL-002); same check `scripts/noramedi-deploy.sh` already runs post-deploy |
| Database unavailable | `GET /api/readyz` → `checks[].name === 'database' && status === 'fail'` | `routes/health.ts` (new) |
| Repeated background-job failure | `[job-lock]`/`[reminders]`/job-specific `console.error` lines in PM2/stdout logs (structured counting not implemented — see #12 in §1) | Pre-existing job code (unmodified — F3-IMPL-006 ownership boundary) |
| Backup stale/failing | `services/backupService.ts#getBackupStatus().latestBackup` older than the expected cadence, or `scriptExists`/`scriptExecutable`/`cronExists` false | Pre-existing, exposed via an authenticated Platform Admin route |
| Disk/storage critical | Not self-observed by the application today. Node 22 (`process.versions.node`, confirmed by RISK_REGISTER R-035) has `fs.statfsSync` available, but no endpoint exposes it — recommend OS-level disk alerting (e.g. a `df`-based check) as the near-term path; a repository-side disk-check endpoint is a reasonable small follow-up, not built in this task (see §9) | Not implemented |
| Elevated 5xx signal | `pino-http` completed-request log lines with `status >= 500`, tailable/aggregatable in production logs | Pre-existing (`utils/logger.ts#buildHttpLogger`'s `customLogLevel`) |

## 7. External configuration still required

None of the following can be verified or performed from this repository, and this task performs no production action:

1. Pointing an external uptime prober (already-existing capability per `noramedi-healthcheck.sh`'s own design, or a third-party service) at `/api/livez` and/or `/api/readyz` in addition to/instead of `/api/health`.
2. Standing up log aggregation/alerting on the structured `pino` output (5xx rate, `fatal`-level lines, job-failure `console.*` lines) — no log shipper is configured in this repository.
3. If Sentry/GlitchTip is adopted: `npm install @sentry/node`, provisioning a project/DSN, setting `SENTRY_DSN` (and optionally `RELEASE_SHA`) in the production environment.
4. PM2/worker-offline and backup-staleness alert wiring to an actual paging/notification channel.
5. Disk/storage monitoring (OS-level or a future repository-side check, per §6).

## 8. Production verification plan (for the program owner to run post-merge/deploy — not performed by this task)

```bash
# Liveness (should be immediate 200 even mid-incident, unless the process itself is down)
curl -s -o /dev/null -w '%{http_code}\n' https://api.noramedi.com/api/livez

# Readiness (should be 200 when the DB is reachable)
curl -s https://api.noramedi.com/api/readyz | python3 -m json.tool
# Expect: {"status":"ok","role":"api","checks":[{"name":"database","status":"ok"}, ...]}

# PM2 process status (both processes; worker liveness has no HTTP surface by design)
pm2 status
pm2 jlist | node -e 'let r="";process.stdin.on("data",c=>r+=c);process.stdin.on("end",()=>console.log(JSON.parse(r).map(a=>({name:a.name,status:a.pm2_env.status}))))'

# Dependency-failure simulation, SAFE subset only (do not stop production Postgres):
#   - Point a *disposable* environment's DATABASE_URL at an unreachable host and confirm
#     /api/readyz there returns 503 with {"status":"degraded"} and no connection string in the body.
#   - Do NOT run this against the production database.

# External uptime-probe verification: confirm the configured provider (per §7 item 1)
# is actually polling /api/livez or /api/readyz and its dashboard reflects current state.

# Alert delivery test: trigger one condition from §6 in a non-production environment
# (e.g. a disposable /readyz 503) and confirm the configured alert channel (per §7 item 4)
# actually receives a notification — do not simulate this against production.
```

## 9. Follow-ups (explicitly not built in this task)

- **P1/F7 — OTel tracing/metrics.** Deferred per the task brief; not small/low-risk against ~70 authenticated routes + 12 jobs today.
- **Frontend fatal-error capture** (global `window.onerror`/React error boundary → structured report). Out of this task's bounded repository-side-backend-minimum scope.
- **Structured, queryable job-failure counters** (e.g. a `lastError`/`consecutiveFailures` column on `JobLock`, or reusing/extending `OperationalEvent` with a nullable `organizationId` for system-scope events) — would need a schema change; this task's brief instructs against one absent a compelling need. Left as a scoped follow-up if repeated-job-failure alerting via log-tailing (§6) proves insufficient in practice.
- **Repository-side disk/storage check** (`fs.statfsSync`-backed endpoint) — small, but not requested by name in the bounded scope; §6 documents the interim OS-level path.
- **Sentry/GlitchTip adoption** — the boundary exists (§5); actually installing `@sentry/node` and provisioning a DSN is a deliberate follow-up decision, not automatic.

## 10. Files changed

```
server/src/utils/readiness.ts                  (new)
server/src/routes/health.ts                     (new)
server/src/utils/fatalErrorHandlers.ts          (new)
server/src/utils/errorTracking.ts               (new)
server/src/utils/logger.ts                      (safeErrorLog: private -> exported, no behavior change)
server/src/index.ts                             (mount health router; install fatal handlers; wire captureFatalError into the existing 5xx handler)
server/src/worker.ts                            (install fatal handlers)
server/.env.example                             (document optional SENTRY_DSN / RELEASE_SHA)
server/src/tests/readiness.test.ts              (new, 8 assertions)
server/src/tests/healthRoutes.test.ts           (new, 7 assertions)
server/src/tests/fatalErrorHandlers.test.ts     (new, 5 assertions)
server/src/tests/errorTracking.test.ts          (new, 4 assertions)
server/package.json                             (4 new test: scripts, wired into server:test:non-disposable)
```

No `schema.prisma`/migration change. No route removed or renamed. `GET /api/health`, `scripts/noramedi-healthcheck.sh`, `scripts/noramedi-deploy.sh`, `ecosystem.config.cjs`, PM2 process names all unchanged.

## 11. Tests

`cd server && npm run typecheck` — exit `0`.

New: `test:readiness` (8/8), `test:health-routes` (7/7), `test:fatal-error-handlers` (5/5), `test:error-tracking` (4/4) — all pure/in-process (live `app.listen(0)` + injected fake dependency-check functions for the E2E ones), no real Postgres/Redis required; no disposable-Postgres suite added since `/readyz`'s real DB check is the same one-line `prisma.$queryRaw` shape `/api/health` already uses in production, now unit-tested via injection rather than needing a second live-DB integration test for an unchanged query.

Regression (files touched or logically adjacent): `test:background-jobs-ownership` (10/10), `test:process-role` (8/8), `test:request-id-correlation` (2/2), `test:http-log-privacy` (44/44 — exercises `utils/logger.ts`, where `safeErrorLog` was exported) — all unchanged, 0 failures.

## 12. Lifecycle states (reported separately, per instruction)

- Repository implementation: `AGENT_COMPLETED`
- Tests: `TESTS_PASSED` (typecheck + 24 new + 64 regression assertions, all green)
- PR: opened against `main` (see tracker for number/link once created)
- Merge: `NOT_MERGED`
- Deploy: `NOT_DEPLOYED`
- Production verification: `NOT_PRODUCTION_VERIFIED`
- Live alert delivery: `LIVE_ALERT_VERIFIED: NO` — none of §6's conditions have been wired to a live provider or observed firing in production; this task performed no such verification and does not claim it
- F3 exit gate: **NOT SATISFIED** — this task narrows (does not close) the "gözlemlenebilirlik standardı canlıda kanıtla çalışıyor" gap named in `phases/F3_PRODUCTION_HARDENING.md`'s exit gate; no live dashboard/alarm evidence exists yet (§7 lists exactly what production-side action would produce it)

## 13. Rollback

Every change is additive (new files, new mounted routes, new `process.on()` handlers, one export visibility change, one env-example addition, four new independent test scripts). No existing route, script, PM2 app name, or schema changed. Rollback is a plain `git revert` of this PR's merge commit — no migration to reverse, no PM2/ecosystem config change to undo, no external provider state was ever created (§7 items are all still-pending external actions, nothing to unwind). If `SENTRY_DSN` is ever set in production before this PR is reverted, unsetting it (or leaving it set, since `captureFatalError` is deleted along with the rest of the module on revert) fully restores the pre-existing no-error-tracking state.

## 14. R2 — external telemetry error classification privacy fix (F3-OBS-001-R2-LITE)

**Blocker:** `§5`'s `captureFatalError` derived the external `errType` tag from `err.name` directly. `Error.prototype.name` is a plain writable string (`err.name = '<anything>'` is valid JS), so it was not an intrinsically safe telemetry field despite the R1 review treating it as equivalent to `safeErrorLog`'s fixed `type` enum.

**Fix:** `safeExternalErrorType()` (`server/src/utils/errorTracking.ts`) now returns exactly one of two fixed literals — `'Error'` (err is an `Error` instance) or `'UnknownError'` (anything else) — never `err.name`. No other field in the outbound payload changed (still: fixed message, `errType`, `requestId`, `role`, `route`, `environment`, `release` — never raw `err`/`message`/`stack`/`cause`).

**Test:** added a dedicated poisoned-`Error.name` case to `errorTracking.test.ts` (`err.name` set to an embedded patient/email/phone/token sentinel string) asserting none of that text reaches `captureMessage`'s message/tags/extra or `init()`'s options, and that `errType` resolves to the bounded `'Error'` literal regardless. `test:error-tracking` is now 8/8 (was 7/7 pre-R2; the R1-era "4 assertions" count in §10/§11 above predates the 3 privacy-boundary tests R1 itself added and was already stale before this R2 note).

No route/readiness/schema code touched by R2; `test:fatal-error-handlers` (5/5) and `test:http-log-privacy` (44/44) re-run clean as directly-coupled regressions.

# F3-IMPL-001 — First-Customer Production Hardening Baseline and Critical Controls

Phase: F3 — Production Hardening. First F3 implementation task.

Branch: `feature/f3-impl-001-first-customer-production-hardening`
Worktree: `E:\Ek Gelir\Siteler\DisKlinikCRM-worktrees\f3-impl-001`
Baseline: `origin/main` @ `9cb256856b628a5ed5cc6ff85f84ec01a4a12cf0` (PR #354 / F2-DOC-005 merge commit) — independently confirmed via `git fetch origin --prune` + `git rev-parse origin/main`, exact match, no drift. Post-main CI independently reported green by the assigning task brief (`ci-main-and-nightly` run `31381175925`), not re-verified by this task (no `gh` credentials used here).

## 1. Pre-work inventory (items A–O)

Bounded, targeted inspection of `origin/main` @ `9cb2568`. Not a full-repo read — followed runtime call paths from `server/src/index.ts`/`worker.ts` outward.

| # | Item | Status | Evidence | Gap (if any) |
|---|---|---|---|---|
| A | Request/correlation id | `PARTIAL` → fixed | `pino-http` auto-generates `req.id` (`server/node_modules/pino-http/logger.js:233-240` — a per-process monotonic counter, not derived from client input), consumed by `utils/logger.ts:82,137`. No response header echoed it back to the client. | Closed by this task — `middleware/requestId.ts`. |
| B | Structured logging | `PARTIAL` | Real logger exists (`utils/logger.ts`, pino + pino-http), wired at `index.ts:146`. ~91 non-test files under `server/src` still call `console.log/warn/error` directly (jobs/*, several routes). Only a handful of files import the structured logger. | Not closed — repo-wide `console.*` migration is out of this task's bounded scope; only the 7 admin-email sites in `routes/platformAdmin.ts` were fixed (item H below). |
| C | Error tracking / correlation | `MISSING` | No Sentry or equivalent found anywhere in `server/` dependencies or source. Error correlation exists only as pino JSON via `logUnhandledError` (log-only, no aggregation/alerting). | Not closed — external error-tracking integration is a larger, separate task; out of scope. |
| D | Secret fail-hard behavior | `PARTIAL` → improved | `getSecret()` (`utils/secrets.ts`) already fails hard in production for `JWT_SECRET`/`PLATFORM_JWT_SECRET`/`IMAGING_BRIDGE_PAIRING_PEPPER`. `ENCRYPTION_KEY` has its own explicit `process.exit(1)` in `index.ts`. `DATABASE_URL` had only a non-null assertion (`db.ts:16`, prior to this task) — no validated failure path; node-postgres silently falls back to `PG*` environment variables (or driver defaults) when `connectionString` is `undefined`. | `DATABASE_URL` production fail-hard added by this task (`utils/databaseUrl.ts`). CORS-wildcard and session-cookie/bearer-fallback warnings remain `console.warn`-only (do not fail-hard) — left untouched, out of this task's bounded P0 selection. |
| E | API vs worker process separation | `IMPLEMENTED_NOT_FULLY_TESTED` | Distinct entrypoints exist: `index.ts` (API) and `worker.ts` (worker), invoked via `server/package.json` `start`/`start:worker` scripts. `scripts/noramedi-deploy.sh:27` reloads only a `noramedi-api` PM2 process — no dedicated worker PM2 process name referenced anywhere in deploy tooling. | Not closed — the worker's own deploy/reload path is not evidenced in-repo; this is an operational/deploy-tooling gap, out of this task's bounded scope (would require touching deploy scripts, a P1 item). |
| F | `RUN_BACKGROUND_JOBS` behavior | `PARTIAL` → clarified, not flipped | `index.ts` (prior): `if (process.env.RUN_BACKGROUND_JOBS !== 'false') startBackgroundJobs()` — untested, undiagnosable at runtime. `worker.ts` unconditionally calls `startBackgroundJobs()`. `LAUNCH_GATES.md` explicitly flags production's actual `RUN_BACKGROUND_JOBS` value as unverified. `JobLock` (`utils/jobLock.ts`) is the existing DB-lease safety net against genuine double-execution if both processes ever do run jobs simultaneously. | Decision extracted into a tested, documented function with a startup diagnostic (`utils/backgroundJobsOwnership.ts`) — see §3 for why the default itself was deliberately NOT changed. |
| G | Worker deploy/reload lifecycle | `PARTIAL` | Graceful SIGTERM/SIGINT handling exists in both `index.ts`/`worker.ts` (10s forced-exit timeout, `prisma.$disconnect()` + `closeRedis()`). No `ecosystem.config.js`/PM2 config file exists in the repository — PM2 process names are only referenced textually in `scripts/noramedi-deploy.sh`/`noramedi-healthcheck.sh`, implying PM2 is configured directly on the VPS, un-versioned. | Not closed — out of this task's bounded scope (would require introducing a versioned PM2 ecosystem file, a larger P1/P2 change). |
| H | PII/PHI log redaction/minimization | `PARTIAL` → improved | Dedicated redaction helpers exist (`utils/logRedaction.ts`); HTTP logs are allowlist-only (`utils/logger.ts`). Concrete violation found: 7 `console.log` sites in `routes/platformAdmin.ts` interpolated `req.platformAdmin?.email` (the triggering admin's email address) directly into log lines. | Fixed by this task — all 7 sites now log the admin's id instead of email. The ~91 other non-test `console.*` sites repo-wide are untouched (bounded scope; none found to log patient/clinic PII in the files actually inspected for this task). |
| I | Platform-admin audit trail | `PARTIAL` (mostly `MISSING`) → improved | `writePlatformAdminAuditEventInTx` (`services/platformAdminAudit.ts`) is used for ~3 of ~20 platform-admin mutation endpoints (data-retention settings, legacy-consent-correction settings). `POST /backups/run` and `POST /backups/restore-test` had **zero** durable audit evidence — only the now-fixed `console.log`. Org/clinic status & plan changes, SMS provider changes, user status changes, plan CRUD remain unaudited. | `POST /backups/run`/`POST /backups/restore-test` closed by this task (a bounded, representative, high-risk pair — operational triggers, not mere config toggles). The ~18 other unaudited endpoints are explicitly **not** closed — see §7 "Remaining F3 blockers". |
| J | Security headers | `PARTIAL` | Manual headers in `index.ts`: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, production-only `Strict-Transport-Security`. No `helmet` dependency, no CSP, no `Permissions-Policy`. | Not touched — already correctly implemented for what it covers; expanding it (CSP, helmet) is a P1 item explicitly not selected for this task (task brief: "do not touch an item that is already correctly implemented merely to standardize it"). |
| K | Rate limiting / abuse protection | `PARTIAL` | Custom `createRateLimiter` (`utils/helpers.ts`), Redis-or-memory backed. Applied to login, platform login, clinic registration, imaging bridge endpoints, security-incident mutations. No `express-rate-limit`; broad `/api` CRUD surface (patients, appointments, payments) has no rate limiting. | Not touched — P1 item, out of this task's P0-focused bounded scope. |
| L | Production readiness/startup behavior | `PARTIAL` → improved | Only `ENCRYPTION_KEY` (and transitively `getSecret()`) fail hard at startup. CORS-wildcard and cookie/bearer-fallback issues are `console.warn`-only. No consolidated "validate everything critical, exit non-zero" startup gate. | `DATABASE_URL` and background-jobs-ownership are now both explicit and diagnosable at startup (items D/F above). A single consolidated startup-validation gate covering CORS/cookies is a larger P1 change, not selected here. |
| M | Health/readiness endpoints | `IMPLEMENTED_NOT_FULLY_TESTED` | `GET /api/health` (`index.ts`) races a 3s-timeout `SELECT 1` against the DB, returns 200/503. No Redis/queue connectivity check, no separate `/ready` vs `/live`. | Not touched — already functioning for its stated purpose; expanding it is a P1 item. |
| N | Production Node/runtime contract | `MISSING` | No `"engines"` field in root or `server/package.json`. No `.nvmrc`/`.node-version`. Deploy script does not pin/reference a Node version. | Not touched — P1 item, out of this task's bounded scope. |
| O | First-customer production smoke support | `PARTIAL` | `docs/36-smoke-test-checklist.md` is a manual, role-based checklist. `scripts/noramedi-healthcheck.sh` is an automated but narrow post-deploy HTTP-reachability probe. No scripted end-to-end smoke test. | Not touched — P1 item, out of this task's bounded scope. |

## 2. Gaps selected and why they are first-customer blockers

Selected per the task brief's P0 priority list, taking the smallest coherent, tightly-coupled slice:

1. **`DATABASE_URL` fail-hard (D)** — a missing/misconfigured `DATABASE_URL` in production could silently connect the process to an unintended default/local Postgres instance instead of refusing to start. For a real customer's data, "wrong database, no error" is a correctness/data-integrity blocker, not just an operability nuisance.
2. **Background-jobs-ownership diagnosability (F)** — `LAUNCH_GATES.md` explicitly names this exact flag's production value as unverified and required before G1 (controlled pilot). Making the decision explicit, tested, and loudly logged at startup is a direct, bounded step toward closing that specific launch-gate item, without the risk of flipping production behavior blind.
3. **Request-id correlation (A)** — for a first real customer, support needs to be able to take "my request failed" and find the exact server-side log line. Previously impossible without server access.
4. **Admin-email log leakage (H, R-018)** — a concrete, repository-evidenced KVKK-relevant PII leak (an identifiable person's email in plaintext logs) with a mechanical, low-risk fix.
5. **Backup-endpoint audit trail (I, R-019)** — the two most operationally significant privileged actions found with zero durable audit evidence (a database backup trigger and a restore-test trigger), fixed together with item 4 since they share the same file and the same removed `console.log` lines.

Items 4 and 5 are the "tightly coupled" pair the task brief explicitly permits bundling: same file, same admin-attribution mechanism (`req.platformAdmin`), same underlying `PlatformAdminAuditEvent` audit primitive.

## 3. Worker/background-jobs decision — why the default was NOT flipped

The task brief's preferred fail-safe shape is: "API defaults to not owning worker-only jobs in production." This was deliberately **not** implemented as the default-changing form. Evidence considered:

- `scripts/noramedi-deploy.sh:27` reloads only a PM2 process named `noramedi-api`. No `noramedi-worker` (or any other worker-named) PM2 process appears anywhere in `scripts/**` or any deploy documentation found in this repository.
- `worker.ts`'s own header comment describes the intended pattern (`RUN_BACKGROUND_JOBS=false` on the API, a separate `npm run start:worker` process) as available, not as the confirmed current production configuration.
- `LAUNCH_GATES.md` itself states production's actual `RUN_BACKGROUND_JOBS` value is unverified.

Given this, the only production topology this repository's own deploy tooling evidences today is a **single API process** that must run its own background jobs (reminders, data-retention cleanup, etc.) to have them run at all. If the API's default were flipped to "don't own jobs unless `RUN_BACKGROUND_JOBS=true` is explicitly set," and production has not independently and separately set that variable (unverified, per `LAUNCH_GATES.md`), background jobs would silently stop running in production the moment this change deployed — a severe, silent regression for a live pilot customer (missed appointment reminders, unrun data-retention cleanup), and exactly the kind of "silent behavior change for clinic users" the task brief's own backward-compatibility rule prohibits.

Instead, this task:
- Extracted the exact existing decision (`RUN_BACKGROUND_JOBS !== 'false'` → owns jobs) into `resolveApiBackgroundJobsOwnership()`, byte-for-byte preserving today's outcome for every input.
- Added a mandatory startup log line in `index.ts` stating the resolved decision and its reason, on every start (not just the opt-out branch).
- Added a clarifying startup log line in `worker.ts` stating it always owns jobs regardless of `RUN_BACKGROUND_JOBS` (worker.ts already ignored this variable; this makes that explicit rather than implicit).
- Added 7 unit tests proving the decision table, including that the default is unchanged for every `NODE_ENV`.

This closes the "is this ambiguous/undiagnosable" gap without touching the actual runtime outcome. Flipping the default is left as a documented follow-up, conditioned on a dedicated worker PM2 process actually being added to the deployment topology and verified in production first (see §14 "Exact next task").

## 4. Files changed

- `server/src/utils/databaseUrl.ts` (new) — `getRequiredDatabaseUrl()`.
- `server/src/utils/backgroundJobsOwnership.ts` (new) — `resolveApiBackgroundJobsOwnership()`.
- `server/src/middleware/requestId.ts` (new) — `attachRequestIdHeader()`.
- `server/src/db.ts` — uses `getRequiredDatabaseUrl()` instead of `process.env.DATABASE_URL!`.
- `server/src/index.ts` — request-id header middleware wired in; background-jobs startup block now logs the resolved decision via `resolveApiBackgroundJobsOwnership()`.
- `server/src/worker.ts` — clarifying startup log line only; job-scheduling behavior unchanged.
- `server/src/services/platformAdminAudit.ts` — new standalone `writePlatformAdminAuditEvent()` helper (non-transactional convenience wrapper around the existing `writePlatformAdminAuditEventInTx`).
- `server/src/routes/platformAdmin.ts` — 7 `console.log` sites no longer interpolate admin email (use admin id instead); `POST /backups/run` and `POST /backups/restore-test` now write a durable `PlatformAdminAuditEvent` row on both success and failure.
- `server/package.json` — 7 new test scripts; `server:test:non-disposable` gained 3 (`test:database-url-validation`, `test:background-jobs-ownership`, `test:request-id-correlation`); `server:test:disposable-db` gained 1 (`test:platform-backup-audit`).
- New test files: `server/src/tests/databaseUrlValidation.test.ts`, `server/src/tests/backgroundJobsOwnership.test.ts`, `server/src/tests/requestIdCorrelation.test.ts`, `server/src/tests/platformBackupAudit.test.ts`.
- Docs: `docs/program/CURRENT_PHASE.md`, `docs/program/NORAMEDI_MASTER_TRACKER.md`, `docs/program/phases/F3_PRODUCTION_HARDENING.md`, `docs/program/evidence/README.md`, this file.

No schema/migration/route-response-shape/public-contract change. No dependency added.

## 5. Runtime behavior before / after

| Area | Before | After |
|---|---|---|
| `DATABASE_URL` missing, production | `connectionString: undefined` passed to the pg adapter; node-postgres silently falls back to `PG*` env vars / driver defaults — process may start and connect to an unintended database with no error. | `getRequiredDatabaseUrl()` throws at `db.ts` import time in production, crashing the process immediately with a clear diagnostic message. Non-production behavior is byte-for-byte unchanged. |
| API background-jobs decision | Inline, untested `!== 'false'` check; only the opt-out branch logged anything. | Same outcome, now via a tested function; every start logs the resolved decision (`ownsJobs=true/false`) and why. |
| Worker background-jobs behavior | Unconditionally runs jobs; no log clarified this was intentional/independent of `RUN_BACKGROUND_JOBS`. | Unchanged behavior; startup log now states explicitly that the worker always owns jobs regardless of the flag. |
| Client-visible request correlation | No response header carried the server-assigned request id. | `X-Request-Id` present on every response, matching the id used in that request's structured log lines. |
| `routes/platformAdmin.ts` console logs | 7 lines logged the triggering admin's email address in plaintext. | Same 7 lines now log the admin's id; no behavior/response change. |
| `POST /backups/run` / `POST /backups/restore-test` | No durable record of who triggered a backup/restore-test, or when, or whether it succeeded. | A `PlatformAdminAuditEvent` row is written (best-effort — failure to write the audit row is logged but never blocks the HTTP response, since these are non-destructive operations that already succeeded/failed on their own merits) recording `actorPlatformAdminId`, action, outcome, and non-PII metadata (e.g. backup filename, error type — never an error message or email). |

## 6. Architecture/boundary impact

None. No new cross-domain dependency introduced; `writePlatformAdminAuditEvent` reuses the existing `PlatformAdminAuditEvent` model and the existing `platformAdminAudit.ts` service, called only from `routes/platformAdmin.ts` (same file that already called the transactional variant). No TenantContext/RLS/PgBouncer/tenant-table work. No queue/BullMQ/Kafka/microservice change. Modular monolith preserved.

## 7. Migration status

No schema migration. `PlatformAdminAuditEvent` already exists (added by a prior task, `20260720180000_add_platform_admin_audit_event`); this task only adds new rows through the existing model via the existing service.

## 8. Exact tests run

All commands run from `E:\Ek Gelir\Siteler\DisKlinikCRM-worktrees\f3-impl-001\server` unless noted.

| Command | Purpose |
|---|---|
| `npm run typecheck` | `npx prisma generate && tsc --noEmit` |
| `npx tsx src/tests/databaseUrlValidation.test.ts` | New — `DATABASE_URL` fail-hard positive/negative, production-only |
| `npx tsx src/tests/backgroundJobsOwnership.test.ts` | New — API job-ownership decision table |
| `npx tsx src/tests/requestIdCorrelation.test.ts` | New — `X-Request-Id` header present + per-request-distinct |
| `npm run server:test:non-disposable` | Full 68(+3 new)-member non-disposable regression suite (CI Layer 2, zero external infra) |
| `npm run test:runtime:postgres` (repo root) | Disposable-PostgreSQL orchestrator running `server:test:disposable-db` (CI Layer 3), 22(+1 new) members, incl. new `test:platform-backup-audit` |

### Regression note (found and fixed during this task)

An initial, unconditional version of `getRequiredDatabaseUrl()` (throwing in every environment, not just production) was run against `server:test:non-disposable` first and **failed immediately** — `test:password-reset` crashed at import time with the new error, because `db.ts` constructs its Prisma client eagerly at module load and many non-disposable tests import it only transitively (via a route/service) without ever issuing a real query. This is exactly the kind of test/dev breakage the task brief's secret-hardening rule warns against. The check was corrected to be production-only (mirroring the existing `ENCRYPTION_KEY` pattern) and the full suite was re-run clean. Both the failing and the corrected run are on record in this task's working log.

## 9. Pass/fail/skip counts and exit codes

| Command | Result |
|---|---|
| `npm run typecheck` | Exit `0`, 0 errors |
| `databaseUrlValidation.test.ts` | 11 passed, 0 failed, exit `0` |
| `backgroundJobsOwnership.test.ts` | 7 passed, 0 failed, exit `0` |
| `requestIdCorrelation.test.ts` | 2 passed, 0 failed, exit `0` |
| `server:test:non-disposable` (68 members, incl. 3 new) | 0 failures found in full log (`grep -c "✗"` matches only pre-existing `✗ 0` summary lines; no `Error:`/failed-count>0 lines) — first attempt (unconditional fail-hard) crashed at the very first sub-script; second attempt (production-only fix) completed clean |
| `platformBackupAudit.test.ts` (standalone) | 3 passed, 0 failed |
| `server:test:disposable-db` via `npm run test:runtime:postgres` (22 members, incl. 1 new) | See orchestrator summary below |

`test:runtime:postgres` orchestrator (`server:test:disposable-db`, 22 members incl. new `test:platform-backup-audit`), full run summary:

```json
{
  "profile": "postgres",
  "migration": { "code": 0, "step": "ok" },
  "test": { "scriptName": "server:test:disposable-db", "code": 0 },
  "cleanup": { "success": true, "errors": [] },
  "outcome": { "exitCode": 0, "reasons": ["tests passed", "cleanup succeeded"] }
}
```

72/72 migrations applied cleanly (PostgreSQL 16, `postgres:16-alpine`, digest-pinned, Docker-provisioned). `test:platform-backup-audit` itself: **3 passed, 0 failed** — proves admin-id attribution, zero PII (no email, no `@`-shaped value) in the audit row, and exactly the two expected `safeMetadata` keys (`filename`, `errorType`) on the `POST /backups/restore-test` failure path. Every other member of the 22-script chain also passed (0 failures anywhere in the full log).

## 10. Typecheck result

Clean. `npx prisma generate && tsc --noEmit` exits `0`, zero errors, on both the initial and corrected `databaseUrl.ts` implementations.

## 11. Security impact

- **Positive:** closes a silent-database-fallback risk in production (D); removes a plaintext PII (email) leak from 7 production-reachable log call sites (H, R-018); adds durable, admin-attributed audit evidence for two previously-unaudited privileged operational triggers (I, R-019); makes the background-jobs ownership decision diagnosable, supporting the launch-gate verification `LAUNCH_GATES.md` already requires (F).
- **No new attack surface:** `X-Request-Id`'s value is a per-process monotonic counter generated server-side by pino-http's default `genReqId` — never derived from or reflecting client input, so it cannot be used for header/log injection or to leak anything the client didn't already know (its own response).
- **Not addressed by this task (see §13):** the remaining ~18 unaudited platform-admin mutation endpoints; the ~91 other non-test `console.*` call sites repo-wide; no CSP/helmet; no rate limiting on the broad `/api` CRUD surface; no external error tracking.

## 12. Tenant isolation impact

None. No query, scope predicate, or authorization check touched. `writePlatformAdminAuditEvent`/`writePlatformAdminAuditEventInTx` write platform-scoped rows (`PlatformAdminAuditEvent` has no `clinicId`/`organizationId`, by design — it audits platform-admin actions, not tenant data) and no cross-tenant read was introduced. The `DATABASE_URL`/background-jobs/request-id changes are process-level, not request-scoped, and touch no per-tenant data path.

## 13. KVKK/privacy impact

Directly relevant and positive: item H removes a plaintext admin-email log leak (KVKK-relevant personal data of the platform admin, not a patient, but still personal data under the same discipline the task brief's LOGGING/KVKK RULE requires — "never log ... email"). The new audit-event `safeMetadata` fields (`filename`, `errorType`) were deliberately restricted to non-PII values — verified by `platformBackupAudit.test.ts`'s explicit assertion that the audit row's serialized JSON never contains the admin's email or any `@`-shaped string, and that only exactly the two expected metadata keys are present (payload-minimization check). No patient/clinic/treatment data was read, logged, or touched by any change in this task.

## 14. Logging/secret exposure review

- No secret value is ever logged by any change in this task. `getRequiredDatabaseUrl()`'s error message states that `DATABASE_URL` is unset — it never echoes the value itself (there is none to echo, by construction of the check).
- The 7 fixed `console.log` sites in `routes/platformAdmin.ts` now log `req.platformAdmin?.id` (an internal UUID, not personal data) instead of `req.platformAdmin?.email`.
- The new `PlatformAdminAuditEvent` rows for backup endpoints store: `actorPlatformAdminId` (existing FK field, already used this way elsewhere), `action`/`resourceType`/`resourceKey` (fixed literal strings), `outcome` (fixed literal string), and `safeMetadata` limited to `{ filename }` (an internal backup-file name, e.g. `noramedi_crm-20260629-031500.dump` — not PII) and `{ errorType }` (the error's constructor name only, e.g. `"Error"` — never the free-form `err.message`, which could in principle embed request-derived values, per the same discipline already documented in `utils/logger.ts`'s `safeErrorLog`).

## 15. Worker/job ownership impact

See §3 in full. Summary: the resolved decision and its outcome are **unchanged** for every existing production/dev/test configuration — this task only makes that decision explicit, unit-tested, and loudly diagnosable at startup in both `index.ts` and `worker.ts`. No process now starts or stops owning jobs differently than it did before this task, for any value of `RUN_BACKGROUND_JOBS`/`NODE_ENV`.

## 16. Platform-admin impact

`POST /backups/run` and `POST /backups/restore-test` now produce durable, admin-attributed audit evidence (`PlatformAdminAuditEvent` rows) where none existed before. No platform-admin permission was added, removed, or broadened — this is purely an audit-trail addition on already-existing, already-authenticated (`authenticatePlatformAdmin`, applied at the router level, unchanged) endpoints. The authorization model itself was not touched.

## 17. Backward compatibility

- No public API/route/response-shape change. `POST /backups/run`/`POST /backups/restore-test`'s success/error response bodies are unchanged; only the audit side-effect and the log line's content changed.
- `X-Request-Id` is a new, additive response header — no existing header removed or changed, no client contract broken.
- `DATABASE_URL` fail-hard is production-only and only fires when the variable is genuinely absent/blank — a correctly configured production deployment (which must already have a working `DATABASE_URL`, since the app cannot function without one) sees no behavior change. Non-production behavior is byte-for-byte unchanged (see §9's regression note for how this was verified, not just claimed).
- Background-jobs ownership: the resolved decision is unchanged for every input — see §3/§15.
- No clinic-user-facing behavior changed at all; every change in this task is either platform-admin-facing (audit trail, log content) or operator/ops-facing (startup diagnostics, fail-hard config validation).

## 18. Rollback method

Primary: `git revert <merge-commit-or-squash-commit-of-this-PR>` on `main`, once merged. All changes are additive/localized (new files + small, isolated edits to `db.ts`/`index.ts`/`worker.ts`/`platformAdmin.ts`/`platformAdminAudit.ts`); a straight revert is safe and requires no data migration (no schema change was made).

Configuration rollback (if the `DATABASE_URL` fail-hard needs to be bypassed in an emergency before a code revert can be deployed): none should be needed — the check only fires when `DATABASE_URL` is genuinely unset/blank in production, which is already a broken configuration state; setting `DATABASE_URL` correctly is the fix, not a rollback. There is no new environment variable this task requires operators to set for existing behavior to continue (background-jobs ownership behavior is unchanged for every existing `RUN_BACKGROUND_JOBS` value).

## 19. Status

- **Agent completed?** Yes — the five selected gaps are implemented, tested, and documented.
- **Tests passed?** Yes, directly observed by this task (typecheck, all 4 new test files, full `server:test:non-disposable`, full `server:test:disposable-db` via the disposable-Postgres orchestrator) — not an externally-confirmed `TESTS_PASSED` state per `NORAMEDI_MASTER_TRACKER.md` §2.3's stricter definition, but the exact commands/counts above are reproducible by anyone.
- **PR opened?** Yes — [PR #355](https://github.com/MustafaBasol/DisKlinikCRM/pull/355).
- **PR CI passed?** Not yet known at authoring time — to be confirmed once CI runs on the opened PR.
- **Merged?** No.
- **Deployed?** No.
- **Production verified?** No.

## 20. Remaining F3 blockers

- F3 exit gate requires: live observability dashboard/alarm evidence (none produced by this task), a full security-hardening checklist sign-off (this task closes 5 of many items), and an incident-response drill (not attempted).
- R-018 (log leakage): only the 7 admin-email sites in `routes/platformAdmin.ts` are fixed. ~91 other non-test `console.*` call sites repo-wide were not audited/fixed by this bounded task.
- R-019 (platform-admin auditability): only `POST /backups/run`/`POST /backups/restore-test` gained audit coverage. ~18 other platform-admin mutation endpoints (org/clinic status & plan changes, SMS provider credential changes, user status changes, plan CRUD) remain unaudited.
- Items E/G/J/K/M/N/O from the inventory (worker deploy/reload lifecycle, security headers/CSP, rate limiting breadth, health-endpoint breadth, Node/runtime version pinning, scripted smoke test) are P1 items, none selected for this P0-focused task.
- Item C (external error tracking) is entirely missing and unaddressed.

## 21. Non-blocking follow-ups

- A repo-wide `console.*` → structured-logger migration (or a lint rule preventing new `console.*` call sites in `server/src/routes|services|jobs`) would close item B and reduce future R-018 recurrence risk systemically, rather than one file at a time.
- Once a dedicated worker PM2 process is actually added to `scripts/noramedi-deploy.sh` (or equivalent) and verified running in production, revisit flipping the API's background-jobs default per §3.
- Author a versioned PM2 `ecosystem.config.js` (item G) so worker/API process definitions are reviewable in-repo instead of living only on the VPS.

## 22. Is first-customer production risk reduced? How precisely?

Yes, modestly and specifically:
- A misconfigured/missing `DATABASE_URL` in production will now fail loudly at startup instead of potentially connecting to an unintended database silently — a concrete data-integrity risk closed.
- Support/ops can now correlate a specific failed customer request to its exact server-side log line via `X-Request-Id` — previously impossible without direct server access, which matters for a real (non-internal) pilot customer.
- The single most launch-gate-relevant undiagnosed flag (`RUN_BACKGROUND_JOBS`'s effective production state) is now something an operator can positively confirm from a log line, closing the diagnosability half of a `LAUNCH_GATES.md`-named open item (the production-value-verification half still requires someone to actually read the production log — not done by this task, no production access used).
- One concrete, repository-evidenced PII leak (admin email in plaintext logs) is closed.
- Two previously fully-unaudited privileged operational endpoints (manual backup run, restore test) now produce durable, attributable evidence of who triggered them and when.

What this task does **not** claim: it does not claim F3's exit gate is satisfied, does not claim R-018/R-019 are closed, does not claim production is verified to be correctly configured (only that misconfiguration will now fail loudly), and does not claim the broader observability/incident-response/security-hardening-checklist work is done.

## 23. Exact next task

Program-owner review/merge decision for this PR. Two concrete, independently-scoped follow-ups are recommended as the next F3 implementation slices (not bundled into this task, per its own bounded-scope instruction):
1. Extend the `PlatformAdminAuditEvent` audit trail to the remaining ~18 unaudited platform-admin mutation endpoints (R-019) — a mechanical, repeatable pattern once this task's `writePlatformAdminAuditEvent` helper exists.
2. A repo-wide `console.*` → structured-logger sweep (or a lint guardrail), scoped file-by-file or domain-by-domain to stay bounded, to systemically reduce R-018 recurrence risk (item B).

## 24. What the program owner should do next

Review and, if acceptable, merge this PR. Separately, and only when convenient, have someone with production access check the new `[jobs] API background-jobs ownership: ...` log line on the running production `noramedi-api` process to finally resolve the `LAUNCH_GATES.md`-flagged "unverified" status of `RUN_BACKGROUND_JOBS` in production — this task could not do so itself (no production access used, per instructions).

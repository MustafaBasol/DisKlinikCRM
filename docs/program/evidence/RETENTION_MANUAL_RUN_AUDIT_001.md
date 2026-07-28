# RETENTION-MANUAL-RUN-AUDIT-001 — Manual Data-Retention Run Audit & Runtime-State Consistency

Task: RETENTION-MANUAL-RUN-AUDIT-001
Baseline: `origin/main @ 26c6c339a7cd8db06b1707c059f7f27857f45e61`
Branch: `fix/retention-manual-run-audit-001`
Status: **IMPLEMENTED_NOT_PRODUCTION_VERIFIED**

---

## 1. Scope

Close the code/evidence gap around the platform-admin manual data-retention
run endpoint (`POST /api/platform/privacy/data-retention/run`) and production
runtime-state visibility. No central tracker, risk register, final
reconciliation, or launch-gate file is touched by this change.

---

## 2. Investigation — CodeGraph-scoped review

Targeted review of `server/src` was scoped to: `dataRetentionPolicy`,
`dataRetentionCleanupJob`, the privacy/data-retention route, platform admin
audit events, runtime configuration, environment toggle handling, and
operational metrics/logging.

**Confirmed gap (pre-fix state):**

- `server/src/routes/platformAdmin.ts`'s `POST /privacy/data-retention/run`
  handler checked only the environment hard-switch
  (`DATA_RETENTION_CLEANUP_ENABLED`, via `loadDataRetentionConfig().enabled`)
  before allowing a live (`dryRun=false`) run. It never checked the runtime
  kill-switch (`PlatformSetting` key `privacy.dataRetention.runtimeEnabled`)
  that the **scheduled cron** (`startDataRetentionCleanupJob` in
  `dataRetentionCleanupJob.ts`) already respects on every tick.
  Consequence: an operator could disable the runtime toggle to halt the
  *scheduled* job (e.g. during an incident) while this manual endpoint kept
  deleting/anonymizing data on request — a real runtime-toggle /
  requested-execution inconsistency, not merely a theoretical one.
- The handler wrote **no audit record at all** — not for a rejected attempt,
  not for a successful run, not for a partially failed one. There was no
  durable, immutable record of who ran a manual retention operation, in what
  mode, against what effective configuration, with what result. The only
  trace was a `console.log`/`console.error` line in `dataRetentionCleanupJob.ts`
  (`[data-retention] Complete dryRun=... messages=... ...`), which is
  ephemeral process-log output, not a queryable, tamper-evident audit trail.
- `GET /privacy/data-retention/policy` already exposed `effectiveCleanupEnabled`
  / `cleanupEnabledSource` (`buildPolicyResponse()`), so the *inconsistency
  detection logic* existed for read-only display but was never applied as a
  *gate* on the mutating run endpoint.

**Model reuse determination:** `PlatformAdminAuditEvent`
(`server/prisma/schema.prisma`, migration
`20260720180000_add_platform_admin_audit_event`) is already a generic,
platform-scoped, immutable audit row — `actorPlatformAdminId` (FK to
`PlatformAdmin`, `onDelete: SetNull`), `action`, `resourceType`,
`resourceKey`, `previousValue`/`newValue`, `outcome` (plain `String`, not a DB
enum), `safeMetadata` (`Json?`), `createdAt`. It already fully expresses every
required field for this task (actor, timestamp, mode, effective config,
runtime state, result counts, outcome, safe error category) with zero
structural changes. **No migration was needed or added.** The only schema
edit is a doc-comment update on the `outcome` field (see §4) — Prisma schema
comments are not synced to the database (no `COMMENT ON` is generated), so
this does not produce or require a migration file.

---

## 3. Remediation

`server/src/routes/platformAdmin.ts` — `POST /privacy/data-retention/run` rewritten:

1. **Runtime-state gate for live execution.** The handler now loads both the
   environment config (`loadDataRetentionConfig()`) and the runtime
   `PlatformSetting` toggle, then reuses the existing `buildPolicyResponse()`
   helper (same one `GET /policy` uses) to derive `effectiveCleanupEnabled`
   and `cleanupEnabledSource` (`'env_disabled' | 'runtime_disabled' |
   'enabled'`). A live run (`dryRun=false`) is rejected with `403` unless
   `effectiveCleanupEnabled` is `true` — i.e. **both** the env hard-switch and
   the runtime kill-switch must agree. This is the exact same "effective
   enabled" gate the scheduled cron already enforces, so the manual endpoint
   can never do something the scheduler itself refuses to do. Dry runs are
   never blocked by this gate (unchanged safety-valve behavior).
2. **Explicit inconsistency detection.** `cleanupEnabledSource` distinguishes
   *which* layer is limiting (env vs. runtime) rather than collapsing both to
   a single boolean, so a case like "runtime toggle ON, env hard-switch OFF"
   (an operator enabled the feature at the platform-settings level without
   realizing the environment-level kill switch is still off) is recorded and
   rejected with `blockedReason: 'blocked_env_disabled'`, not silently merged
   with the more common "runtime toggle simply off" case
   (`blocked_runtime_disabled`).
3. **Immutable audit event for every attempt.** A new
   `recordDataRetentionManualRunAudit()` helper writes exactly one
   `PlatformAdminAuditEvent` row (via the existing
   `writePlatformAdminAuditEventInTx()` writer, inside a `prisma.$transaction`)
   for every code path:
   - **Blocked** (unsafe live execution rejected) — `outcome: 'blocked'`,
     `errorCategory: 'blocked_env_disabled' | 'blocked_runtime_disabled'`, no
     `resultCounts` (nothing executed).
   - **Success** (dry run or live run, zero category errors) —
     `outcome: 'success'`.
   - **Partial failure** (`runDataRetentionCleanup()`'s per-category error
     collection reports one or more `summary.errors`) —
     `outcome: 'partial_failure'`, `errorCategory: 'category_execution_error'`,
     plus `skippedCategories` (static category labels only, e.g.
     `"operationalEvents"` — never row content).
   - **Unexpected exception** (anything escaping the try/catch) —
     `outcome: 'error'`, `errorCategory: 'unexpected_exception'`.
   The audit write happens synchronously inside the request handler itself —
   it is not deferred to, or dependent on, any subsequent call the frontend
   might or might not make.
4. **Recorded fields** (`PlatformAdminAuditEvent` + `safeMetadata`):
   - `actorPlatformAdminId` — top-level column, from `req.platformAdmin.id`.
   - `createdAt` — top-level column, automatic (timestamp).
   - `safeMetadata.dryRun` — boolean mode flag.
   - `safeMetadata.effectiveConfig` — the full effective `DataRetentionConfig`
     snapshot (env enabled flag, cron schedule, every per-category retention
     day threshold, batch size) — all plain numbers/strings/booleans.
   - `safeMetadata.runtimeCleanupEnabled` / `effectiveCleanupEnabled` /
     `cleanupEnabledSource` — runtime enabled/disabled state and the
     env-vs-runtime consistency verdict.
   - `safeMetadata.resultCounts` — the same per-category counts as the job's
     `DataRetentionSummary` (present only for attempts that actually executed).
   - `safeMetadata.skippedCategories` — static category-label strings (present
     only when non-empty).
   - `outcome` (top-level column) — `'success' | 'partial_failure' |
     'blocked' | 'error'`.
   - `safeMetadata.errorCategory` — a fixed, non-PII reason code (present only
     when the outcome isn't a clean success).
5. **Never recorded:** patient PII, raw deleted/anonymized row content, raw
   Prisma/DB error messages (only the fixed `errorCategory` code is stored),
   credentials, or any clinic/organization/patient identifier — this job is
   platform-scoped, not tenant-scoped, and the audit event's shape reflects
   that by construction (no such field exists on the model or is ever added
   to `safeMetadata`).
6. **No frontend dependency.** Because the audit write happens inside the
   handler before the response is sent, retention-cleanup accountability does
   not depend on the calling frontend ever reading the response, retrying, or
   making a second "confirm" call.
7. Minor consistency cleanup: `GET /privacy/data-retention/policy` and
   `PATCH /privacy/data-retention/settings` now reference the same new
   exported `DATA_RETENTION_RUNTIME_SETTING_KEY` constant
   (`server/src/services/privacy/dataRetentionPolicy.ts`) that the run
   endpoint and the scheduled cron job (`dataRetentionCleanupJob.ts`) use,
   replacing three separate copies of the same string literal
   (`'privacy.dataRetention.runtimeEnabled'`).

---

## 4. Files changed

- `server/src/routes/platformAdmin.ts` — `POST /privacy/data-retention/run`
  rewritten with the runtime-state gate and audit recording described above;
  `GET /policy` and `PATCH /settings` switched to the shared setting-key
  constant.
- `server/src/services/privacy/dataRetentionPolicy.ts` — added exported
  `DATA_RETENTION_RUNTIME_SETTING_KEY` constant.
- `server/src/jobs/dataRetentionCleanupJob.ts` — switched to the shared
  setting-key constant (behavior unchanged).
- `server/prisma/schema.prisma` — doc-comment update only on
  `PlatformAdminAuditEvent.outcome`, reflecting that this model now also
  records non-success outcomes for attempted-operation actions. **No
  migration added** (comment-only change; confirmed no `prisma migrate dev`
  diff is produced by a schema comment edit).
- `server/src/tests/retentionManualRunAudit.test.ts` — new, 12 focused
  assertions (see §6).
- `server/package.json` — registered `test:retention-manual-run-audit`,
  appended to the aggregate `test` script (inserted after
  `test:data-retention`).
- `docs/program/evidence/RETENTION_MANUAL_RUN_AUDIT_001.md` — this document.

---

## 5. Required-behavior checklist

| # | Requirement | How it's satisfied |
|---|---|---|
| 1 | Correct Platform Admin authorization | Pre-existing router-level `router.use(authenticatePlatformAdmin, csrfProtection('platform'))` gate (unchanged, applies to this route like every other privileged route in this file). `PlatformAdmin` has no sub-roles in this schema — authentication as an active platform admin *is* the authorization boundary, consistent with every other route in this router (e.g. the legacy-consent-correction toggle). |
| 2 | Dry-run supported safely | `dryRun` defaults to `true` (`req.body?.dryRun !== false`); never blocked by the runtime-state gate. |
| 3 | Immutable audit event for every attempted run | `recordDataRetentionManualRunAudit()` on all four code paths (blocked/success/partial_failure/error). |
| 4 | Required fields recorded | See §3.4. |
| 5 | No PII/raw content/credentials in audit | See §3.5; verified by dedicated tests (§6). |
| 6 | Explicit inconsistency detection (runtime toggle / env / requested live execution) | `cleanupEnabledSource` + the "inconsistent toggle" test (§6) covering runtime-ON/env-OFF. |
| 7 | Reject unsafe live execution on inconsistent state | `403` + `outcome: 'blocked'` whenever `!effectiveCleanupEnabled`. |
| 8 | Clinic-safe, platform-scoped | No clinic/patient identifiers anywhere in the audit path; job itself is platform-wide by design (unchanged). |
| 9 | Not dependent on frontend behavior | Audit write is synchronous, server-side, inside the handler. |

---

## 6. Tests

New file: `server/src/tests/retentionManualRunAudit.test.ts` (real disposable
Postgres, no mocked Prisma — route handlers extracted directly from the
router's internal stack, same technique as `legacyConsentCorrection.test.ts`).

1. Unauthorized (no token) — rejected before any handler runs, no audit row.
2. Wrong role (clinic-user JWT) — rejected before any handler runs, no audit row.
3. Sanity: a genuine platform admin token is accepted by the gate.
4. Dry-run audit — `200`, `outcome: 'success'`, `dryRun: true`, effective
   config captured, no PII/clinic/org keys.
5. Runtime disabled (env enabled, runtime absent/false — the default state) —
   live run rejected `403`, `outcome: 'blocked'`,
   `errorCategory: 'blocked_runtime_disabled'`, no `resultCounts`.
6. Inconsistent toggle (runtime toggle explicitly `true`, env hard-switch
   explicitly `false`) — live run still rejected; audit explicitly records
   `runtimeCleanupEnabled: true` alongside `effectiveConfig.envCleanupEnabled:
   false` and `errorCategory: 'blocked_env_disabled'` (env takes precedence).
7. Dry run is never blocked by disabled state (safety valve preserved).
8. Live run with real counts — a genuine eligible `OperationalEvent` row
   (seeded with `createdAt` in year 2000; no FK required) is actually deleted,
   not just counted; audit `resultCounts.deletedOperationalEvents >= 1`.
9. Repeated invocation — two consecutive live runs each produce their own
   audit row (attempts are never deduplicated); the second run's count for
   the already-cleaned category is verified to reflect nothing left to do.
10. Partial/failed cleanup — the `OperationalEvent` table is genuinely
    renamed away (`ALTER TABLE ... RENAME TO ...`) for the duration of one
    test, forcing a **real** Prisma error for exactly that category (no
    mocking); confirms the request still completes `200`,
    `outcome: 'partial_failure'`, `errorCategory: 'category_execution_error'`,
    `skippedCategories` includes `"operationalEvents"`, and neither the
    temporary table name nor any seeded row content leaks into the audit row.
11. No PII in audit metadata — a name/phone-shaped synthetic marker seeded
    into the cleaned row's content is confirmed absent from `safeMetadata`.
12. No cross-tenant leakage — `safeMetadata` is confirmed to never contain a
    `clinicId`, `organizationId`, `patientId`, `phone`, or `email` key.

### Commands run and results (this worktree, disposable Postgres 16 container,
migrations applied via `prisma migrate deploy`)

```
cd server
npm run typecheck                        # clean
npm run test:data-retention              # 39 passed, 0 failed
npx tsx src/tests/platformAdmin.test.ts  # 55 passed, 0 failed (test:auth)
npm run test:retention-manual-run-audit  # 12 passed, 0 failed
git diff --check                         # clean (exit 0)
```

Full repo-wide `npm test` (~80 scripts) was not run. This change touches only
`platformAdmin.ts` (one route handler + two constant-reference swaps),
`dataRetentionPolicy.ts` (additive constant), and `dataRetentionCleanupJob.ts`
(constant-reference swap, no behavior change) — confirmed via `git diff` that
no other exported symbol's signature changed. `test:data-retention` and
`test:auth` (which imports and exercises `platformAdmin.ts` and
`dataRetentionCleanupJob.ts` directly) both pass unchanged, and the new
focused suite covers the modified route directly.

---

## 7. Production verification instructions (NOT executed — for the operator, post-merge)

**Do not run a live (`dryRun: false`) request against production as part of
this verification.** The steps below are dry-run-only and read-only; they
confirm the new gate/audit behavior without touching any production data.

1. **Confirm current runtime/env state (read-only):**
   ```
   curl -s -X GET https://api.noramedi.com/api/platform/privacy/data-retention/policy \
     -H "Cookie: <platform-admin session cookie>"
   ```
   Expect a JSON body containing `envCleanupEnabled`, `runtimeCleanupEnabled`,
   `effectiveCleanupEnabled`, `cleanupEnabledSource`.

2. **Dry-run the manual endpoint (safe — no mutation):**
   ```
   curl -s -X POST https://api.noramedi.com/api/platform/privacy/data-retention/run \
     -H "Cookie: <platform-admin session cookie>" \
     -H "X-CSRF-Token: <csrf token from /api/platform/auth/csrf>" \
     -H "Content-Type: application/json" \
     -d '{"dryRun": true}'
   ```
   Expect `HTTP 200`, `{"success": true, "summary": {"dryRun": true, ...}}`.

3. **Confirm an audit row was written** (requires a platform-admin-only
   internal query — via `psql`/Prisma Studio on the production database, or a
   future read-only admin endpoint if one exists; do not add a new
   general-purpose read endpoint solely for this check without separate
   review):
   ```sql
   SELECT "id", "actorPlatformAdminId", "action", "outcome", "safeMetadata", "createdAt"
   FROM "PlatformAdminAuditEvent"
   WHERE "action" = 'data_retention.manual_run'
   ORDER BY "createdAt" DESC
   LIMIT 1;
   ```
   Expect exactly one new row, `outcome = 'success'`, `safeMetadata` containing
   `"dryRun": true` and no patient/clinic identifiers.

4. **Confirm the runtime-disabled block path (safe — still no mutation, since
   this only tests the *rejection*, and only if you can toggle the runtime
   setting back immediately):**
   - `PATCH /api/platform/privacy/data-retention/settings` with
     `{"runtimeCleanupEnabled": false}`.
   - Attempt `POST /privacy/data-retention/run` with `{"dryRun": false}` —
     expect `HTTP 403`, `cleanupEnabledSource: "runtime_disabled"`.
   - Confirm a `PlatformAdminAuditEvent` row with `outcome = 'blocked'` was
     written for that attempt.
   - Restore the runtime setting to its prior value immediately afterward.

5. Do **not** issue a `{"dryRun": false}` request while the runtime/env state
   is fully enabled during this verification pass — that would perform a real
   production cleanup run and is out of scope for "verification."

---

## 8. Known limitations / follow-up

- Production verification (§7) has not been performed as part of this task —
  status remains `IMPLEMENTED_NOT_PRODUCTION_VERIFIED` until an operator
  executes the read-only/dry-run steps above against the deployed instance.
- `PlatformAdmin` has no sub-role model in this schema (flat
  active/inactive), so "correct Platform Admin authorization" is, by design,
  identical to every other route behind this router's `authenticatePlatformAdmin`
  gate. If a future task introduces platform-admin role tiers, this endpoint
  should be revisited to require the appropriate tier.
- The partial-failure test (§6.10) forces a real category failure via a
  temporary `ALTER TABLE ... RENAME` against the disposable test database,
  restored in a `finally` block. This technique is confirmed safe for a
  disposable Postgres test database and must never be run against a shared
  or production database.

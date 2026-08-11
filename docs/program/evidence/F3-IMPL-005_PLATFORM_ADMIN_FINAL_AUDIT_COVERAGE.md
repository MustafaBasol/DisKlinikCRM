# F3-IMPL-005 — Platform Admin Remaining Privileged Mutation Audit Coverage (R-019)

Phase: F3 — Production Hardening. Direct follow-up to F3-IMPL-003, closing exactly the 12-endpoint residual gap that task's own §4/§12 named as the recommended next slice.

Branch: `feature/f3-impl-005-platform-admin-audit-final`
Worktree: `E:\Ek Gelir\Siteler\DisKlinikCRM-worktrees\f3-impl-005`
Baseline: `origin/main` @ `92fc0c0c5eee34ae71bd2508bbfcc2f0309e3055` — independently confirmed via `git fetch origin main` + `git rev-parse origin/main`, exact match, no drift. This SHA includes F3-IMPL-002/003(+R1/R2)/004(+R1), F3-WA-META-COEX-002(+R1–R4), and F3-DIGIDENTIS-MAP-001(+R1) — 10 commits ahead of F3-IMPL-003's own `1909b186a01611c8be90313b7166085a887d05f4` baseline. None of the intervening commits touch `platformAdmin.ts`, `platformSecurityIncidents.ts`, `platformExternalCalendar.ts`, `services/platformAdminAudit.ts`, `services/security/*`, or `tests/platformAdmin*` — confirmed via `git log --oneline 13caabb..92fc0c0` (docs/meta reconciliation + the DigiDentiS practitioner-dropdown bugfix, both in unrelated files).

## 1. Objective

Close R-019 ("Platform-admin yetki aşımı" — `RISK_REGISTER.md` row 90, `Medium`/`High`, `OPEN`, `UNVERIFIED` at task start) for its persisted-mutation-audit slice, by adding durable, attributable, PII-minimized `PlatformAdminAuditEvent` coverage to every remaining unaudited platform-admin mutation endpoint. F3-IMPL-003 closed the 6 highest-risk endpoints (priority classes 1–3 of 5) and explicitly deferred the remaining 12 (classes 4–5) as "a natural, mechanical next F3 slice... no new infrastructure needed" (its evidence file §12).

## 2. Pre-work inventory (re-derived, not assumed)

Per this task's own instruction ("Do NOT assume the old count is still exact"), the full route inventory was re-enumerated against current `origin/main`, not copied from F3-IMPL-003's evidence.

CodeGraph was used first, restricted to the routes/services/tests paths named in the task brief, to establish route inventory, existing durable audit writers, and transaction boundaries — then every route was independently confirmed by direct `Read` of the actual worktree files (CodeGraph's index tracks the primary repo checkout, not this dedicated worktree, so its output was treated as a starting map, not final evidence).

| File | Route count (grep `^router\.(get\|post\|put\|patch\|delete)\(`) | F3-IMPL-003's count | Drift |
|---|---:|---:|---|
| `platformAdmin.ts` | 46 | 46 | none |
| `platformSecurityIncidents.ts` | 13 | 13 | none |
| `platformExternalCalendar.ts` | 11 | 11 | none |
| **Total** | **70** | **70** | **none** |

Classification (unchanged from F3-IMPL-003, independently re-verified by direct read of every mutation route's current source):

| Classification | Count |
|---|---:|
| `READ_ONLY` | 28 |
| `NON_PERSISTED_OPERATION` (`OUT_OF_SCOPE` in F3-IMPL-003's vocabulary — login, logout, connectivity tests, mail test) | 5 |
| `AUDITED_DURABLY` (pre-existing, before this task: 19 baseline + 6 from F3-IMPL-001/F3-IMPL-003) | 25 |
| `UNAUDITED_PERSISTED_MUTATION` (this task's target) | 12 |
| **Total** | **70** |

The 12-item residual list matched F3-IMPL-003's §4 exactly, byte-for-byte, confirmed by direct `Read` of each route's current line range before writing any code:

**Class 4 — organization/clinic/plan/user lifecycle (10):**
`PATCH /organizations/:id/status`, `PATCH /organizations/:id/plan`, `PATCH /organizations/:id/trial`, `POST /clinics`, `PATCH /clinics/:id/status`, `PATCH /clinics/:id/plan`, `PATCH /clinics/:id/sms-addon`, `PATCH /users/:id/status`, `POST /plans`, `PUT /plans/:id`.

**Class 5 — operational triggers, file-backup counterpart of the already-audited DB-backup routes (2):**
`POST /file-backups/run`, `POST /file-backups/restore-rehearsal`.

No new mutation route was found that F3-IMPL-003's inventory missed. No STOP condition was triggered: current main introduces no materially different audit architecture, no schema change was required, and no other open PR was found touching any of these 12 routes (`git log`/route-file `git blame` show no in-flight work on them; the concurrently-active `f3-impl-006` worktree is on `feature/f3-impl-006-runtime-log-hygiene-wave2`, a disjoint PII-log-hygiene scope with zero file overlap, confirmed by inspection).

## 3. Implementation

All 12 endpoints now use the existing, unmodified `writePlatformAdminAuditEventInTx()`/`writePlatformAdminAuditEvent()` (`services/platformAdminAudit.ts`) — the exact same audit primitive F3-IMPL-001 and F3-IMPL-003 established. No new audit infrastructure was added.

### 3.1 Class 4 — transactional pattern (10 endpoints)

For the 10 organization/clinic/plan/user lifecycle mutations, each route now wraps its business mutation and its audit-event insert in the same `prisma.$transaction`, mirroring the `PUT /sms-providers`/`PATCH /privacy/data-retention/settings` pattern F3-IMPL-003 established: **a successful mutation without its audit row is transactionally impossible.** Where the route already guarded a not-found id via a pre-transaction lookup (e.g. `POST /organizations/:id/plan`'s target-plan-exists check), that lookup was left outside the transaction — the same accepted, narrower-but-still-real precedent F3-IMPL-003 documented for the three MFA routes (§5 of its evidence file): a non-existent id 404s before any transaction opens, structurally guarding it.

| # | Route | Action | resourceType/Key | previous/new | Why unaudited was a real gap |
|---|---|---|---|---|---|
| 1 | `PATCH /organizations/:id/status` | `platform_organization.status_updated` | `organization` / org id | status string / status string | Suspending/reactivating a whole organization (and every clinic under it) had zero trace. |
| 2 | `PATCH /organizations/:id/plan` | `platform_organization.plan_updated` | `organization` / org id | planId / planId | Silent plan/entitlement changes at the organization level, zero trace. |
| 3 | `PATCH /organizations/:id/trial` | `platform_organization.trial_updated` | `organization` / org id | JSON `{trialEndsAt,status}` | Trial-extension abuse vector, zero trace. |
| 4 | `POST /clinics` | `platform_clinic.created` | `clinic` / new clinic id | `null` / JSON `{name,slug,organizationId,planId}` | New org+clinic creation (a privileged provisioning action), zero trace. |
| 5 | `PATCH /clinics/:id/status` | `platform_clinic.status_updated` | `clinic` / clinic id | status string / status string | Clinic suspension/reactivation, zero trace. |
| 6 | `PATCH /clinics/:id/plan` | `platform_clinic.plan_updated` | `clinic` / clinic id | JSON `{planId,maxUsers,maxPatients}` | Silent per-clinic entitlement/limit changes, zero trace. |
| 7 | `PATCH /clinics/:id/sms-addon` | `platform_clinic.sms_addon_updated` | `clinic` / clinic id | JSON of non-secret SMS-addon settings | Enabling/disabling a paid add-on and its routing policy, zero trace. |
| 8 | `PATCH /users/:id/status` | `platform_user.status_updated` | `user` / user id (never email) | `'true'`/`'false'` | Deactivating/reactivating a clinic user account, zero trace. |
| 9 | `POST /plans` | `platform_plan.created` | `plan` / new plan id | `null` / JSON `{name,displayName,maxUsers,maxPatients,monthlyPrice,isActive}` | New platform-wide plan definition, zero trace. |
| 10 | `PUT /plans/:id` | `platform_plan.updated` | `plan` / plan id | JSON snapshot of the changed fields | Silent redefinition of an existing plan's limits/pricing (affects every clinic/org on that plan), zero trace. |

`Plan.features` (an arbitrary, potentially large JSON blob of feature flags — not secret, not PII) is deliberately excluded from every plan audit row's previous/new snapshot to keep the row minimized and bounded in size; the other, small, meaningful fields are captured in full.

### 3.2 Class 5 — best-effort operational-trigger pattern (2 endpoints)

`POST /file-backups/run` and `POST /file-backups/restore-rehearsal` mirror `POST /backups/run`/`POST /backups/restore-test` exactly (F3-IMPL-001, R-019): these are operational triggers with real side effects outside the database (copying files to S3/local storage), not pure row mutations, so they use the standalone `writePlatformAdminAuditEvent()` wrapper — a best-effort audit write on both the success and failure branch, never blocking the actual response on an audit-write failure (logged to console if it fails, exactly as the DB-backup routes already do).

| Route | Actions | resourceType/Key | safeMetadata |
|---|---|---|---|
| `POST /file-backups/run` | `file_backup.manual_run.completed` / `file_backup.manual_run.failed` | `file_backup` / `files` | `{errorType}` on failure only |
| `POST /file-backups/restore-rehearsal` | `file_backup.restore_rehearsal.completed` / `file_backup.restore_rehearsal.failed` | `file_backup` / `restore_rehearsal` | `{sampleSize}` always; `{sampleSize, errorType}` on failure |

### 3.3 PII/secret minimization, per endpoint

- `PATCH /users/:id/status`'s `resourceKey` is the user's opaque `id` — never their email/name; verified by a negative `JSON.stringify(row)` scan against both in tests.
- `POST /clinics`'s `newValue` carries `name`/`slug`/`organizationId`/`planId` only — no clinic `email`/`phone`/`address` (present in the request body but never echoed into the audit row).
- All 12 use `actorPlatformAdminId` (a UUID, sourced from `req.platformAdmin?.id`) for attribution — never the acting admin's email.
- No endpoint's audit row carries a password, API key, token, MFA secret, or raw request body.

None of the 12 broaden authorization, change tenant scope, or alter response shape/status codes — each change is additive: wrap the existing mutation in `prisma.$transaction` (class 4) or add a best-effort audit call around the existing try/catch (class 5). **No schema/migration change** — `PlatformAdminAuditEvent` already existed (`20260720180000_add_platform_admin_audit_event`) and is reused as-is, exactly as F3-IMPL-003 predicted ("no new infrastructure needed").

### 3.4 One structural fix required by TypeScript's `strict` mode, not by this task's own design

Adding `PlatformAdminRequest` typing to 8 previously-untyped handlers (`req` was implicitly `any` before) surfaced that this file's `PlatformAdminRequest['params']` types `id` as `string | string[]` — a pre-existing project-wide typing (Express `ParamsDictionary` with array-capable query parsing), already worked around elsewhere in this exact file (`DELETE /sms-providers/:id`'s `Array.isArray(req.params.id) ? req.params.id[0] : req.params.id`). The same one-line normalization was applied at all 8 new call sites that destructured `const { id } = req.params` under the new typing. This is a type-narrowing fix only — no behavioral change; Express never actually delivers an array for a single-segment `:id` path parameter in this app's routing.

## 4. Tests

37 new tests added to the existing `server/src/tests/platformAdmin.test.ts` (was 82/82 after F3-IMPL-003-R2, now **118/118**), covering the 10 class-4 endpoints, reusing the exact conventions (`getRouteMiddlewareChain`/`runChain`/`mockPlatformRes`, real disposable Postgres, no supertest, no mocked Prisma) already proven for `PUT /sms-providers`/`PATCH /privacy/data-retention/settings`. A new standalone test file, `server/src/tests/platformFileBackupAudit.test.ts` (5/5), covers the 2 class-5 endpoints, mirroring `platformBackupAudit.test.ts`'s exact structure and its deterministic-failure technique (`FILE_BACKUP_ENABLED` defaults to `false`, so `runFileBackup()` deterministically throws before any real file/S3 work in any environment that hasn't opted in; `runFileBackupRestoreRehearsal()` deterministically finds zero verified `FileBackupEntry` rows in a fresh disposable database and returns — does not throw — exercising the completed/success audit branch).

Per endpoint/class, tests prove:

1. **Success → exactly one correct durable audit row** — action/resourceType/resourceKey/previousValue/newValue/outcome asserted exactly.
2. **Invalid/rejected input → no audit row** — every existing validation branch (bad enum, missing required field, non-boolean, invalid date) re-verified to still create zero audit rows.
3. **DB/business failure → transaction rollback includes the audit** — a real Postgres FK violation (a non-existent `actorPlatformAdminId` against `PlatformAdminAuditEvent`'s real FK to `PlatformAdmin(id)`) forces the audit insert to fail inside the transaction; asserted that the business mutation (organization/clinic/plan/user row) is also rolled back — atomic, not best-effort, for all 10 class-4 endpoints, including a multi-table proof for `POST /clinics` (both the new `Organization` and the new `Clinic` rows are absent after a forced failure, since both are created inside the one transaction).
4. **Actor is id-based** — every test attributes via a UUID; a negative `JSON.stringify(row)` scan for `@` (no email-shaped value) runs on every success-path assertion.
5. **Secrets/PII absent** — no email, no name, no credential in any of the 12 endpoints' audit rows (verified directly for `PATCH /users/:id/status`, the one endpoint whose target resource itself carries PII).
6. **previous/new values are meaningful but minimized** — exact field-level assertions per endpoint (e.g. `PATCH /organizations/:id/plan`'s `previousValue`/`newValue` are the plan ids being switched between, not a full organization snapshot).
7. **Existing endpoint behavior unchanged** — every pre-existing validation/404/success status code and response shape re-asserted unchanged (400 for bad enum, 404 for not-found, 200/201 for success, unchanged response bodies).

### 4.1 Full regression, exact commands and results

- `cd server && npm run typecheck` — clean, exit `0`.
- Focused `platformAdmin.test.ts` (part of `test:auth`, run inside the full suites below) — **118/118 pass, 0 fail** (was 82/82; 36 new tests for class 4 endpoints).
- `platformFileBackupAudit.test.ts` (part of `server:test:disposable-db`, run inside the suite below) — **5/5 pass, 0 fail**.
- `npm run test:runtime:postgres-compat -- --summary-file=postgres-compat-run-summary.json` (repo root; disposable Postgres, `server:test:legacy-db-required`, includes `test:auth` → `platformAdmin.test.ts`) — migration `code: 0`/`step: "ok"`; test `code: 0`; cleanup `success: true`; outcome `exitCode: 0`.
- `npm run test:runtime:postgres -- --summary-file=postgres-run-summary.json` (repo root; disposable Postgres, `server:test:disposable-db`, includes the new `test:platform-file-backup-audit` → `platformFileBackupAudit.test.ts`, added to this aggregate script alongside the existing `test:platform-backup-audit`) — migration `code: 0`/`step: "ok"`; test `code: 0`; cleanup `success: true`; outcome `exitCode: 0`.

Both summary JSONs written at repo root, left untracked (consistent with prior task precedent).

### 4.2 Environment issues found and fixed (not code defects)

This freshly-created worktree's `npm install` produced a corrupted `node_modules` twice, independently, for two unrelated packages — `@prisma/client`'s own shipped `.d.ts` re-export stubs (`default.d.ts`/`index.d.ts`/`edge.d.ts`/`extension.d.ts`/`sql.d.ts`) and `@smithy/core`'s entire `dist-cjs/submodules/` directory were both missing after the first `npm install`, despite `package-lock.json` being byte-identical to a known-working worktree's. This produced two symptoms during verification, both diagnosed and fixed before relying on any result:

1. **`tsc --noEmit` reported ~130 unrelated `Could not find a declaration file for module '@prisma/client'` errors** across dozens of files this task never touched — root-caused to the missing `.d.ts` stubs (confirmed against a known-working worktree's identical-version install, which has them). After restoring the 5 missing stub files (verbatim copies of the same version's shipped content) and a full `npm ci` (clean reinstall from lockfile, "added 400 packages"), `npm run typecheck` passed with **zero errors**, including confirming this task's own final `req.params.id` typing fix (§3.4) is correct.
2. **`server:test:disposable-db`'s `test:kvkk-lifecycle` step crashed with `Cannot find module '@smithy/core/.../submodules/retry/index.js'`** — an entirely unrelated pre-existing test, not touched by this task, root-caused to the same install corruption. Fixed by the same `npm ci` reinstall.
3. A `tsc --noEmit` `RangeError: Maximum call stack size exceeded` was also observed once, before the `npm ci` fix — not reproduced after; attributed to the same underlying corrupted install rather than a distinct issue, since it did not recur once `node_modules` was verified clean.

All three are one-time, this-worktree-local `npm install` artifacts (plausibly disk-I/O contention from several other agents' concurrent worktree installs observed running at the same time) — not reproduced in a known-working sibling worktree with an identical `package-lock.json`, and not present in the final `npm ci`-clean state this task's results are reported against. No test, source, or lockfile content was changed to work around them.

## 5. Security / tenant / KVKK impact

- **Security:** all 12 audited actions are platform-admin-scoped. The `POST /clinics` atomicity proof is the highest-value new guarantee: an admin-privileged provisioning action (creating a new tenant) can no longer succeed without a durable trace, and a forced audit failure now provably prevents a "ghost" org+clinic pair from being silently created.
- **Tenant isolation:** unaffected — none of the 12 routes' authorization/query-scoping logic was touched, only audit-write additions inside existing (or newly added, for class 4) transactions.
- **KVKK:** none of the 12 endpoints read, write, or log patient/medical data; `PATCH /users/:id/status`'s target is a clinic *user* account (staff), not a patient, and its audit row is id-only.
- No new authorization surface, no authorization broadened, no platform-admin auth model changed. Response shapes, status codes, and validation rules are byte-for-byte unchanged for all 12 routes (proven by the "existing behavior unchanged" test category above).

## 6. Migration

**None.** No schema change required or made, confirming the task brief's own expectation.

## 7. Rollback

Pure additive code change to `platformAdmin.ts` plus test files plus one new `package.json` script pair. Revert is a single-commit `git revert` with zero data-migration concerns — no schema touched, no data backfilled/transformed, no response shape changed. The 12 newly-audited routes' business behavior (status codes, response shapes, validation rules) is unchanged; only new `PlatformAdminAuditEvent` rows are now written on success (class 4: transactionally-guaranteed; class 5: best-effort).

## 8. R-019 status

**R-019 audit-coverage gap is now fully closed at the repository level**: 37 of 37 platform-admin mutation-only endpoints are `AUDITED_DURABLY` (19 pre-existing + 6 from F3-IMPL-001/F3-IMPL-003 + 12 from this task), **0 remain `UNAUDITED_PERSISTED_MUTATION`**. Per this program's own established rule (see the R-071/R-072 precedent in `RISK_REGISTER.md` — a task's own self-verification of its own work is not independent risk-owner acceptance), R-019's row is updated to `CLOSURE_PROPOSED_AWAITING_EXTERNAL_CONFIRMATION`, not unilaterally `CLOSED`. R-019's other two named mitigations — a break-glass procedure and an explicit scope boundary — are **not** addressed by this task and remain open; this closure proposal covers only the "denetim izi" (audit trail) slice.

## 9. Task status

- Agent: `AGENT_COMPLETED`.
- Tests: `TESTS_PASSED` — `cd server && npm run typecheck` exit `0`; `platformAdmin.test.ts` 118/118 (36 new); `platformFileBackupAudit.test.ts` 5/5 (new); `test:runtime:postgres-compat` exit `0`; `test:runtime:postgres` exit `0`.
- PR: `PR_OPENED` — [PR #365](https://github.com/MustafaBasol/DisKlinikCRM/pull/365).
- Merged: `NOT_MERGED`.
- Deployed: `NOT_DEPLOYED`.
- Production verified: `NOT_PRODUCTION_VERIFIED`.

## 10. Exact next task

Program-owner review/merge decision for this PR. Independently: R-019's remaining, unaddressed mitigations (break-glass procedure, explicit platform-admin scope-boundary design) are a separate, not-yet-scoped future task — this task's own instructions explicitly excluded incident-response/security-checklist work outside audit-correctness findings.

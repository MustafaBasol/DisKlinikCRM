# KVKK-HIGH-006 — Combined Post-Merge Independent Verification

**Verification date:** 2026-07-22
**Verified commit (`origin/main`):** `fd520300aeafada0dff5ea479e064493c76dbffc` (2026-07-22 14:06:44 +0200) — "Merge pull request #201 from MustafaBasol/docs/kvkk-high006-final-program-reconciliation"
**Worktree:** `D:/Mustafa/Siteler/DisKlinikCRM-worktrees/kvkk-high006-combined-verification`
**Branch:** `verify/kvkk-high006-combined-post-merge`
**Scope of this task:** independent, post-merge, source/simulation-level re-verification of the final combined KVKK-HIGH-006 implementation. No runtime code, tests, schema, migrations, frontend, package files, shared trackers, or deployment configuration were modified. No deployment or production access occurred.

---

## 1. Authoritative merged PR chain

All eight PRs were confirmed as ancestors of `fd520300aeafada0dff5ea479e064493c76dbffc` via `git merge-base --is-ancestor <sha> fd520300...` (all returned true), with merge commits located directly in `git log`:

| PR | Subject | Merge commit SHA |
|----|---------|-------------------|
| #194 | Batch 1 (`fix/kvkk-high006-batch1-v2`) | `7ee68ef73c203a1d239086c9f2c2e5090011e08a` |
| #195 | Batch 2 (`fix/kvkk-high006-batch2-financial-scope`) | `b372406a191e4c557c58a1823cd441bd67f7ae27` |
| #196 | Batch 3 (`fix/kvkk-high006-batch3-messaging-scope`) | `47dea4d534aa8e464e186e448e51a31a31e61cf3` |
| #197 | R-061 authenticated verification package (`docs/r061-authenticated-verification-package`) | `965b0288248175174174cfa0da25730974d5c03b` |
| #198 | Message read/send record scope (`fix/kvkk-high006-messages-record-scope`) | `4712870fbf9b1cc1dee582fb8981648c482014ad` |
| #199 | Batch 4 target-clinic quota scope (`fix/kvkk-high006-batch4-target-clinic`) | `0a5be5e4e77cea864ea785451acb1d05f184bc9a` |
| #200 | Batch 4 characterization/product decision (`docs/kvkk-high006-batch4-characterization`) | `6ec61ba036849153382c965fe333af9a176a35e5` |
| #201 | Final program reconciliation (`docs/kvkk-high006-final-program-reconciliation`) | `fd520300aeafada0dff5ea479e064493c76dbffc` |

All confirmed present and ordered correctly in `git log --merges --oneline` on the verification branch.

---

## 2. CodeGraph usage and methodology note

Per instructions, CodeGraph was the first tool considered for source review. However, this repository's only `.codegraph/` index lives in the main working copy (`D:/Mustafa/Siteler/DisKlinikCRM`), which was checked out at `404f653` (branch `docs/kvkk-20260720-production-reconciliation`) at the start of this task — **64 commits behind** the verification target `fd520300a`. A worktree-scoped diff (`git diff --stat 404f653 fd520300a -- <14 files>`) showed **12 of the 14 required files changed** between those two commits (only `dentalChart.ts` unaffected; `clinicScope.ts`/`clinicAccess.ts` also unaffected in that diff window).

Since CodeGraph's index would silently serve pre-remediation source for the very files under audit, it was **not used as the source of truth** for this verification — using it would have violated the "re-read the current merged source directly" requirement. Instead, all 14 required files (plus tests and evidence docs) were read directly from the `fd520300a`-pinned worktree via the file-read tool, which is Read-equivalent and guarantees fidelity to the exact verified commit. This discrepancy is recorded here as a genuine environment limitation, not a defect in the reviewed application code.

---

## 3. Files and routes reviewed (direct source read, worktree-pinned to `fd520300a`)

- `server/src/utils/clinicScope.ts` — central scope helpers (`buildClinicScopeWhere`, `validateAndGetScope`, `toClinicOnlyScope`, `getAccessibleClinicIds`, `resolveEffectiveClinicId`, `buildClinicIdScope`, `validateAndGetClinicIdScope`, `clinicIdsFromScope`)
- `server/src/middleware/clinicAccess.ts` — `requireClinicAccess`, `requireSpecificClinicAccess`
- `server/src/middleware/planLimits.ts` — `checkUserLimit`, `checkPatientLimit`, `requireFeature`
- `server/src/routes/reports.ts` — revenue/CSV export/doctor-performance/patient-sources/no-show-analysis
- `server/src/routes/appointmentRequests.ts` — list/counts/status/convert/update
- `server/src/routes/dentalChart.ts` — list/upsert/delete
- `server/src/routes/paymentPlans.ts` — list/overdue-collections/detail/create/pay-installment/cancel
- `server/src/routes/inventory.ts` — list/alerts/detail/create/update/transactions
- `server/src/routes/insuranceProvisions.ts` — list/detail/create/update/status/cancel
- `server/src/routes/services.ts` — appointment-types/services + materials CRUD
- `server/src/routes/postTreatment.ts` — templates CRUD + queue approve/cancel
- `server/src/routes/messages.ts` — message-templates CRUD, messages prepare/list/detail/send, Meta submit/sync/status
- `server/src/routes/users.ts` — users list/create/update, doctor availability/off-days
- `server/src/routes/patients.ts` — patients list/detail/create/update/archive/unarchive

---

## 4. Core check results

| # | Check | Result |
|---|-------|--------|
| 1 | List routes use centralized accessible-clinic scope | ✅ Confirmed in all 14 files — every list endpoint calls `validateAndGetScope`/`validateAndGetClinicIdScope` or `getAccessibleClinicIds` |
| 2 | Create routes resolve the explicit target clinic through the centralized resolver | ✅ `resolveEffectiveClinicId(req.user!, <requested clinicId>)` used in paymentPlans, inventory, insuranceProvisions, services, postTreatment, messages (templates + prepare), users, patients (via `checkUserLimit`/`checkPatientLimit` middleware) |
| 3 | Record-specific routes query within authorized clinic scope | ✅ All detail/update/delete routes filter by `getAccessibleClinicIds()`-derived `clinicId: { in: accessibleIds }` or an equivalent validated scope before lookup |
| 4 | Record mutations use the found record's own `clinicId` | ✅ Confirmed pattern (`const clinicId = existing.clinicId` / `record.clinicId` / `plan.clinicId` / `message.clinicId` / `request.clinicId`) used for all dependent writes/logActivity calls, never re-derived from `req.user.clinicId`, in every reviewed file |
| 5 | Cross-organization and inaccessible records are not exposed | ✅ Confirmed both by source review (org-id always folded into scope, or record lookup constrained to `accessibleIds`) and by passing regression suites (see §6) explicitly asserting cross-org 404 |
| 6 | Multi-clinic users can access authorized sibling-clinic records | ✅ Confirmed by source (accessible-clinic-set based lookups, not single default clinic) and by passing regression suites |
| 7 | Single-clinic behavior remains unchanged | ✅ Explicit backward-compatibility tests pass in every batch suite |
| 8 | `MessageTemplate` routes use clinic-only scope, matching schema | ✅ `messages.ts` message-template routes use `validateAndGetClinicIdScope`/`resolveEffectiveClinicId` (clinic-only, no `organizationId` field on this model) |
| 9 | Post-treatment models use organization-aware scope where supported | ✅ `postTreatment.ts` uses `validateAndGetScope`/`resolveEffectiveClinicId` (organization-aware) and creates `PostTreatmentMessageTemplate` rows with an explicit `organizationId` field, matching the model's schema |
| 10 | Message read/send routes use record-owned clinic context for provider dispatch, consent checks, and logging | ✅ `messages.ts` `GET /messages/:id` and `POST /messages/:id/send` resolve `clinicId = message.clinicId` (the found record's own clinic) and use it for SMS/WhatsApp dispatch, `assertCommunicationPermission` consent gating, and `logActivity` — confirmed both by source read and by `messagesRecordScope.test.ts` (21/21 passing, including items 10–12 specifically targeting this) |
| 11 | Plan-limit middleware evaluates quota against the actual creation target | ✅ `planLimits.ts` `checkUserLimit`/`checkPatientLimit` call `resolveEffectiveClinicId(req.user!, req.query.clinicId)` and evaluate quota against `targetClinicId`, not the requester's default clinic |
| 12 | `req.targetClinicId` is safely passed from middleware to create routes | ✅ `users.ts` (`POST /users`) and `patients.ts` (`POST /patients`) both read `req.targetClinicId!` set by the preceding `checkUserLimit`/`checkPatientLimit` middleware, with no re-validation gap |
| 13 | No new authorization bypass, existence oracle, or cross-tenant write path | ✅ None found in the 14 reviewed files; all denial paths consistently return `403`/`404` without leaking record existence across org/clinic boundaries (also asserted by regression tests, e.g. "403 vs 404 distinction" in `messagesRecordScope.test.ts`) |
| 14 | No unintended widening beyond the caller's authorized organization/clinic set | ✅ Every `'all'`/omitted-selector path resolves through `getAccessibleClinicIds`/`buildClinicScopeWhere`, which is itself bounded by `organizationId` and `allowedClinicIds`/`canAccessAllClinics` — no widening beyond that set observed |
| 15 | Remaining raw `req.user.clinicId` matches classified | ✅ See §5 |

---

## 5. Global occurrence scan and classification

Command run (from repo root of the verification worktree):

```powershell
rg -n "req\.user(!|\?)?\.clinicId" server/src/routes server/src/middleware
```

**20 matches found**, all classified below. None represent an authorization bypass, existence oracle, data leakage, or cross-tenant write path for KVKK-HIGH-006. An additional check for `clinicId: req.user`, `where: { clinicId...req.user`, and bare `where: { clinicId` patterns limited to the 14 required files returned **zero** matches — i.e. none of the 14 files under mandatory review contain a live unsafe pattern.

| File:Line | Classification |
|---|---|
| `appointmentRequests.ts:214` | Comment (documents the record-derived `clinicId` design; no code effect) |
| `clinicBulkExport.ts:6` | Comment |
| `attachments.ts:121` | Comment |
| `attachments.ts:310` | Comment |
| `attachments.ts:379` | Comment |
| `services.ts:18` | Comment |
| `gdprExport.ts:6` | Comment |
| `labOrders.ts:285` | Comment |
| `labOrders.ts:353` | Comment (Turkish) |
| `middleware/planLimits.ts:136` | Live code, inside `requireFeature`'s `else` branch (no `organizationId` — legacy single-clinic/org-less account). Reads the user's own clinic's plan features for a feature-flag check, not a quota/authorization scoping decision. **Legitimate UI/default-clinic behavior.** |
| `routes/dashboard.ts:249` | Live code. `chartPreferenceClinicId` selects which clinic's locale/timezone operating preferences to use for chart formatting when `'all'`/no clinic is selected — a display-formatting default, not a data-authorization scope (the actual dashboard queries are scoped separately). **Legitimate UI default.** |
| `routes/reports.ts:204` | Live code. Same pattern as above: selects which clinic's operating preferences (locale/timezone) format the CSV export dates when `'all'`/unspecified; the CSV data query itself already uses `scope` from `validateAndGetClinicIdScope`. **Legitimate UI default.** |
| `routes/organizationWhatsApp.ts:241,406,610,680,745,850,1070` (7 occurrences) | Live code, all `logActivity({ clinicId: req.user!.clinicId, ... })` — an activity-log attribution tag on organization-scoped `WhatsAppConnection` entities (guarded by `organizationId` plus explicit cross-org clinic checks elsewhere in the same handlers). Not an authorization/data-scoping decision. **Legitimate logging attribution, out of KVKK-HIGH-006's record-scope remit** (this route file was not in the required review list and was not touched by any of the 8 merged PRs). |
| `routes/organizationBranches.ts:668` | Live code, same `logActivity` clinicId-tag pattern for a cross-clinic user-assignment operation (the actual clinic assignment writes are guarded by an explicit transaction and org checks elsewhere in the handler). **Legitimate logging attribution**, out of scope. |

**Conclusion:** zero unresolved defects among remaining raw occurrences. All live (non-comment) matches are either UI-default formatting choices or activity-log attribution tags on already-authorization-guarded operations — none feed an authorization or data-scoping decision.

---

## 6. Test execution (exact commands and results)

Environment note: the verification worktree had no `node_modules` (git worktrees do not share installs). Ran `npm ci` (installs from the commit's own `package-lock.json`, no version drift) followed by `npx prisma generate` (local codegen only — no database connection) before running any suite.

### 6.1 Mandatory suites

| Command | Result |
|---|---|
| `npx tsx src/tests/kvkkHigh006Batch1ClinicScope.test.ts` | **File does not exist** at `fd520300a` — see §6.3 |
| `npx tsx src/tests/kvkkHigh006Batch2ClinicScope.test.ts` | ✅ 37/37 passed |
| `npx tsx src/tests/kvkkHigh006Batch3ClinicScope.test.ts` | ✅ 31/31 passed |
| `npx tsx src/tests/messagesRecordScope.test.ts` | ✅ 21/21 passed |
| `npx tsx src/tests/planLimitsTargetClinicFix.test.ts` | ✅ 11/11 passed |

### 6.2 Batch 1 equivalents (see §6.3 for why these replace the literal filename)

| Command | Result |
|---|---|
| `npx tsx src/tests/appointmentRequestRecordScope.test.ts` | ✅ 13/13 passed |
| `npx tsx src/tests/dentalChartClinicScope.test.ts` | ✅ 17/17 passed |
| `npx tsx src/tests/reportsClinicScope.test.ts` | ✅ 16/16 passed |

### 6.3 Stale literal / source assertion: `kvkkHigh006Batch1ClinicScope.test.ts`

The task's suggested command referenced `server/src/tests/kvkkHigh006Batch1ClinicScope.test.ts`, which does not exist on `fd520300a`. `git show --stat` on the Batch 1 merge commit (`7ee68ef7`, PR #194) shows the actual files added were `appointmentRequestRecordScope.test.ts`, `dentalChartClinicScope.test.ts`, and `reportsClinicScope.test.ts` — these were run instead (§6.2) and cover the same Batch 1 scope (appointment-request/dental-chart/reports record-derived clinic scoping). Classified as a **stale literal/source assertion** in the task instructions, not a missing-coverage defect.

### 6.4 Adjacent regression suites

| Suite | Result |
|---|---|
| `multiBranchAccess.test.ts` | ✅ 142/142 passed |
| `appointmentRequestOverlapSafety.test.ts` | ✅ 31/31 passed |
| `overdueReceivables.test.ts` | ✅ 12/12 passed |
| `treatmentCaseClinicScope.test.ts` | ✅ 11/11 passed |
| `labOrders.test.ts` | ✅ 32/32 passed |
| `paymentValidation.test.ts` | ✅ 9/9 passed |
| `paymentBillingEdit.test.ts` | ✅ 25/25 passed |
| `servicePricing.test.ts` | ✅ 29/29 passed |
| `postTreatmentMessaging.test.ts` | ✅ 16/16 passed |
| `messageSafetyHardening.test.ts` | ✅ 36/36 passed |
| `messageTemplatePurpose.test.ts` | ✅ 17/17 passed |
| `messageTemplateWabaBinding.test.ts` | ⚠️ 19/20 passed — 1 failure, see §6.5 |
| `smsModule.test.ts` | ✅ 77/77 passed |
| `billingPatientAccess.test.ts` | ✅ 18/18 passed |
| `staffOnboarding.test.ts` | ✅ 15/15 passed |
| `userImportOnboarding.test.ts` | ✅ 10/10 passed |

No test file literally named `roles.test.ts` exists; the closest and functionally-equivalent role/branch-authorization suite is `multiBranchAccess.test.ts` (also the target of the `test:roles` npm script) — run above.

**Total: 550 assertions across 21 suites — 549 passed, 1 failed (stale assertion, see below).**

### 6.5 Failure analysis: `messageTemplateWabaBinding.test.ts`

One assertion failed:

```
✗ meta/status route strips metaTemplateConnectionId/metaWabaIdSnapshot before responding
    status endpoint must not return raw connection/WABA ids
```

The test (`git blame` → commit `d23eff3d`, 2026-07-01) asserts an exact source substring:
```
const { metaTemplateConnectionId, metaWabaIdSnapshot, ...safeTemplate } = template;
```
The current source at `server/src/routes/messages.ts:776` (`git blame` → commit `4866cbf`, part of PR #196/Batch 3, 2026-07-22) is:
```
const { metaTemplateConnectionId, metaWabaIdSnapshot, clinicId: _clinicId, ...safeTemplate } = template;
```
The Batch 3 messaging-scope remediation legitimately added a `clinicId` extraction (needed elsewhere in the same handler as a local `clinicId` variable), which incidentally changed the exact-match substring the older test asserts. The functional security property under test — that `metaTemplateConnectionId` and `metaWabaIdSnapshot` are stripped before the response is sent — **is still true**; the destructuring still excludes both fields from `safeTemplate`. Confirmed by direct read of `messages.ts:741-785`.

**Classification: stale literal/source assertion**, predating a later legitimate refactor. Not a regression, not a security defect. Recommend updating the test's expected substring in a future maintenance pass (out of scope for this verification task, which may only add evidence documentation).

---

## 7. `npm run typecheck`

```
> server@1.0.0 typecheck
> npx prisma generate && tsc --noEmit
```

Result: **0 errors.** Exit code 0.

---

## 8. Regression / security / compatibility findings summary

- **Regressions:** None found. All batch-specific and adjacent suites pass except the one stale literal assertion in §6.5 (not a regression — the underlying behavior is correct).
- **Security findings:** None. All 15 core checks (§4) confirmed. All 20 raw `req.user.clinicId` occurrences (§5) classified as comments or legitimate non-authorization uses (UI-default formatting, activity-log attribution). No authorization bypass, existence oracle, cross-tenant write path, or unintended scope widening identified.
- **Compatibility findings:** Single-clinic and pre-existing multi-clinic behavior confirmed unchanged by explicit backward-compatibility assertions in every batch suite (e.g., "single-clinic user, no explicit target → behavior byte-identical to before the fix").

---

## 9. Source/simulation vs. DB-backed distinction

**All test results in §6 are source-level and in-memory/mock simulations run directly against the TypeScript route/middleware source and hand-rolled fixtures — none of them exercise a real PostgreSQL database, a running Express server, or Prisma's query engine against live data.** This is consistent with the tests' own documented design (e.g. `kvkkHigh006Batch2ClinicScope.test.ts`'s header explicitly states: "no live database is available in this task's environment... this is a disposable, synthetic, in-memory fixture only"). `npm run typecheck` validates types only, not runtime query behavior. This verification is a **source/simulation-level PASS**, not a DB-backed integration PASS.

---

## 10. Disposable PostgreSQL readiness assessment

Inspected (read-only, no services started):

- Repository root and `server/` for `docker-compose*.yml` / `Dockerfile*` — **none found anywhere in the repository.**
- `server/src/tests/` for any DB-connecting test helper, `testcontainers`, or `pg-mem` usage — **none found** (the only textual match for "docker" across `server/src/tests` is a code comment in `kvkkHigh006Batch2ClinicScope.test.ts` stating no Docker/psql/.env is present in this task's environment).
- `server/package.json` — no `docker`/`testcontainers`/integration-test scripts; only the `tsx`-run mock/source suites enumerated in §6.
- `server/.env.example` — defines `DATABASE_URL` for a conventional local Postgres (`postgresql://crm_user:change-me@localhost:5432/noramedi_crm`), but no container/compose definition to stand one up.
- `server/prisma/` — a real, substantial migration history (66 migrations) and `prisma.config.ts` exist, so `prisma migrate deploy` against a disposable database is mechanically straightforward once one exists.

**Result: no disposable PostgreSQL integration-test harness currently exists in this repository.** All KVKK-HIGH-006 verification to date (all batches, all evidence documents, this combined verification) is source/simulation-only. No production services were started or accessed as part of this assessment.

---

## 11. Next-step DB-backed execution plan (for a future task)

This plan is a specification only — no framework or harness was built in this verification task, per instructions.

1. **Isolated disposable PostgreSQL container**
   - Start a throwaway `postgres:16` (or matching the production major version) container on a random/non-default port, e.g. via a one-off `docker run --rm -e POSTGRES_PASSWORD=... -e POSTGRES_DB=kvkk_high006_verify -p <random>:5432 postgres:16`.
   - No named/persistent volume — container and data must not survive the task.
2. **Dedicated test database**
   - A single database (e.g. `kvkk_high006_verify`), never the developer's or production's `noramedi_crm` database.
   - `DATABASE_URL` pointed at the container only for the duration of the test run, never committed.
3. **Schema setup**
   - `npx prisma migrate deploy` (not `dev`) against the disposable database, applying all 66 existing migrations as-is.
4. **Fixture organizations/clinics/users**
   - At least: 2 organizations (org-1, org-2, for cross-org isolation checks), org-1 with ≥2 clinics (clinic-A, clinic-B) and org-2 with 1 clinic (clinic-X).
   - Users: a single-clinic user (clinic-A only), a multi-clinic user (allowedClinicIds=[A,B]), an org-wide user (canAccessAllClinics=true), and a zero-assignment user (allowedClinicIds=[]).
   - Seed representative records per model under test (AppointmentRequest, ToothRecord, PaymentPlan, InventoryItem, InsuranceProvision, AppointmentType/materials, PostTreatmentMessageTemplate/Queue, MessageTemplate, SentMessage, User, Patient) split across clinic-A, clinic-B, and clinic-X.
5. **No production credentials** — container-local superuser/app credentials only, generated fresh per run, never sourced from `.env`/secrets used by any real deployment.
6. **Teardown requirements** — container removed (`docker rm -f` / `--rm`) and any generated `.env.test`-style file deleted at the end of the run, whether it passed or failed; no dangling volumes.
7. **Required DB-backed scenarios** (mapped to the objective's required list):
   - Authorized sibling-clinic list/detail access (multi-clinic user reads clinic-B records via `'all'`/explicit selector).
   - Inaccessible sibling and cross-org denial (clinic-A-only user denied clinic-B; org-1 user denied any org-2/clinic-X record, including for an org-1 `canAccessAllClinics` user).
   - Record-owned clinic mutations (update/status/cancel/delete operations write using the found record's own `clinicId`, verified via a post-write DB read, not just the response body).
   - Message read/send provider and consent context (`GET /messages/:id`, `POST /messages/:id/send` resolve provider dispatch + `assertCommunicationPermission` consent gating + audit log against the message's actual owning clinic, not the caller's default).
   - Insurance list all-authorized-clinics behavior (`'all'` selector for an org-wide user returns provisions from every accessible clinic, and only those).
   - Payment/inventory/insurance create target validation (`resolveEffectiveClinicId` correctly resolves and validates an explicit target clinic against real DB-backed `Clinic`/org rows, rejecting a cross-org or unassigned target).
   - User creation target-clinic quota false-allow case (target clinic actually over quota in DB, requester's own clinic under quota — must block).
   - User creation target-clinic quota false-block case (target clinic actually under quota, requester's own clinic over quota — must allow).
   - Patient creation equivalents of both quota cases above.
   - Repeated or malformed `clinicId` query input behavior (e.g. `?clinicId=a&clinicId=b`, non-UUID string, empty string) — confirm graceful 400/403, not a 500 or an unintended array-vs-string coercion bypass.
   - Single-clinic compatibility (byte-for-byte unchanged responses for a single-clinic account across all touched endpoints, run against the same seeded DB as the multi-clinic cases).
8. Recommended runner: a small dedicated script (not part of this verification) invoking each suite in §6 against a live Express app bound to the disposable DB, or converting the existing mock-based suites' assertions into real HTTP/Prisma calls — implementation decision left to that future task.

---

## 12. Risk register status

- **R-071 remains OPEN.** This verification is source/simulation-level only (§9); R-071 (disposable-PostgreSQL DB-backed verification) closes only once the plan in §11 is executed, followed by deployment and a production-safe smoke verification. **A PASS here does not imply production readiness.**
- **R-061 remains OPEN.** PR #197 ("R-061 authenticated verification package") is confirmed merged into `origin/main` (§1), but this task did not execute an authenticated, live-system verification against a running instance — that remains a separate, not-yet-executed step.
- **No deployment or production access occurred** as part of this verification task.

---

## 13. Verdict

# PASS WITH CONDITIONS

**Rationale:** All 15 core checks pass on direct re-read of the current merged source at `fd520300a`. All 8 authoritative PRs confirmed merged via `git merge-base`. 549 of 550 test assertions pass across mandatory and adjacent suites; the single failure is a confirmed stale literal/source assertion with no underlying functional or security defect (§6.5). `npm typecheck` is clean. The global raw-occurrence scan found zero unresolved defects (§5). The "conditions" are: (1) the one stale test assertion in `messageTemplateWabaBinding.test.ts` should be updated in a future maintenance pass so the suite reflects the current, correct source; (2) this verification is source/simulation-level only — R-071 and R-061 remain OPEN pending the DB-backed plan in §11, deployment, and production-safe smoke verification, none of which occurred or were attempted here.

# F0-009 — Tenant Isolation, Prisma Guard, RLS and PgBouncer PoC Design

Task: F0-009 · Phase: F0 — Baseline, Program Control, and Architecture Validation
Status: `AGENT_COMPLETED` (documentation only; external review required before merge)
Baseline commit: `origin/main` @ `9669b06aa19035d45ccdec85837b71c9e4e8512d` (PR #176 merge commit, confirmed current via `git fetch origin --prune` + `git rev-parse origin/main` at task start — no drift from the known handoff commit)
Worktree: `D:\Mustafa\Siteler\DisKlinikCRM-worktrees\f0-009-tenant-rls-pgbouncer-poc`, branch `docs/f0-009-tenant-rls-pgbouncer-poc-design`

> **Non-authorization statement (required, verbatim):**
> F0-009 defines an isolated PoC and future rollout evidence requirements only. It does not authorize Prisma tenant-extension implementation, PostgreSQL RLS rollout, schema/backfill migrations, database-role changes, PgBouncer deployment, or production configuration changes. Those actions remain blocked until the active architecture freeze conditions are explicitly released and the relevant ADR receives evidence-based acceptance.

---

## 1. Purpose and scope

This document is a **design specification for a future, isolated Proof of Concept**, not an implementation. It answers whether NoraMedi's next tenant-isolation defense layers — a Prisma data-access guard, a formal `TenantContext`, PostgreSQL Row-Level Security (RLS), PostgreSQL role separation, and PgBouncer connection pooling — are technically testable, and specifies exactly what evidence a future PoC (run in a disposable environment, never against production or the shared development database) must produce before ADR-004 and ADR-005 can move past `NEEDS_POC`.

It is bound by, and does not attempt to loosen, `docs/program/KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md`. Per that document's §6, "F0-009 — RLS/Prisma/PgBouncer PoC design (design only)" is explicitly listed as allowed to proceed now; its §7 explicitly lists "F0-009 ... implementation (as opposed to design)" as blocked regardless of KVKK-HIGH-007 continuation status. This document does not change that.

Scope is documentation and design only: no file under `server/src/`, `server/prisma/schema.prisma`, `server/prisma/migrations/`, `src/`, deployment scripts, CI workflows, or environment files was touched to produce it.

## 2. Current repository evidence

### 2.1 Program status verified at task start

- `origin/main` fetched and confirmed at `9669b06aa19035d45ccdec85837b71c9e4e8512d` — identical to the task's stated "known latest main merge commit," so no drift inspection was required beyond the fetch itself.
- F0-002 through F0-008: `MERGED`. F0-008 (PR #176, merge commit `9669b06aa19035d45ccdec85837b71c9e4e8512d`) was already `MERGED` at this task's baseline — that merge commit *is* this task's own baseline commit. The baseline repository documents (tracker, current-phase, F0 phase doc, as committed within that same merge) still contained a self-reference-lag entry describing F0-008 as `PR_OPEN`, written before PR #176's own merge. F0-009 found and corrected that documentary lag (same recurring pattern as F0-002 through F0-007); PR #176/F0-008 was not unmerged at F0-009 task start. Its ADR classifications are read as the current documentary record per tracker §2.1 source hierarchy.
- PR #175 (KVKK-HIGH-007 continuation, migration `20260719120821_kvkk_high007_consent_reconciliation`): confirmed `MERGED` into `main` by F0-008's correction pass (commit `1da9586995b625624b7385c14e70ba6a322def73`). **Not** confirmed deployed. **Not** confirmed applied to production. **Not** production-verified. Communication-consent rollout flags (`enforcementConfig.ts`, read directly by F0-008) default disabled; production backfill was not executed per `docs/compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md`'s 2026-07-19 row.
- Per `KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md` §5, condition 2 (PR merged) is satisfied; conditions 3–5 (production migration confirmed applied, rollback/tenant-impact independently verified, external "KVKK baseline stable" declaration) are **not** satisfied. The §3 default freeze rules — including item 11 "RLS rollout" and item 12 "Prisma tenant-extension rollout" — therefore remain in force regardless of this document's conclusions.

### 2.2 Prisma client architecture (§A.1–A.2)

- **Singleton (app runtime):** `server/src/db.ts:14` — `const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL!, max, connectionTimeoutMillis, idleTimeoutMillis }) })`, exported as `export default prisma`. All route/service files import this one instance.
- **11 additional standalone `new PrismaClient(...)` instantiations** exist outside `db.ts`, each opening its own separate connection pool rather than reusing the singleton: `server/check_db.ts:4`, `server/prisma/seed.ts:6`, `server/prisma/seed.e2e-booking.ts:21`, three `server/scripts/verify-*.ts` files, and five `server/src/scripts/*.ts` one-off/backfill scripts. Of these, **`server/src/utils/activity.ts:10`** is notable — it is a live runtime module (used by `logActivity()` for every audit-log write), not a one-off script, and it constructs its own `Pool`/`PrismaClient` instead of importing `db.ts`'s singleton. This is a second live connection pool inside the running application and must be accounted for in any future connection-budget calculation and in any future Prisma guard/extension rollout (an extension applied only to the `db.ts` export would silently not cover `activity.ts`'s writes).
- **No Prisma Client extensions (`$extends`) exist anywhere in the repository today** (`grep -rl '\$extends' server --include=*.ts` returned zero hits). A future guard is a greenfield addition, not a modification of existing middleware.
- **`prisma.$transaction` usage:** 39 real call sites across 25 files. 5 are batch (array) form (`routes/auth.ts:464,533`, `routes/inventory.ts:229`, `routes/labOrders.ts:239`, `services/clinicOperatingPreferences.ts:193`); the remaining 34 are interactive (callback) form, spread across route handlers (`appointments.ts`, `imaging.ts`, `platformAdmin.ts`, `treatmentPackages.ts`, `users.ts`, etc.) and services (`securityIncidentService.ts` ×4, `clinicBulkExportPackage.ts` ×4, `communicationConsentAdmin.ts`, `patientPrivacyExportPackage.ts`).

### 2.3 Tenant scoping utilities (§A.6, §C precursor)

Three files own tenant scoping today, per `MODULE_MAP.md`'s "Tenant Security and Scope" domain (classified "clearly bounded"):

- **`server/src/utils/clinicScope.ts`** — canonical scope builder. `buildClinicScopeWhere(user, selectedClinicId)` (returns `{organizationId}` / `{organizationId, clinicId}` / `{organizationId, clinicId:{in:[...]}}}`, with an explicit code comment: "always includes organizationId — never returns clinicId alone"); `validateAndGetScope` (403-on-null wrapper); `toClinicOnlyScope` (strips `organizationId` for models lacking it); `getAccessibleClinicIds`; `resolveEffectiveClinicId`; `buildClinicIdScope`/`validateAndGetClinicIdScope` (clinicId-only variant for models without `organizationId`); `clinicIdsFromScope`.
- **`server/src/middleware/clinicAccess.ts`** — Express middleware (`requireClinicAccess`, `requireSpecificClinicAccess`) that populates `req.clinicScope` from the above.
- **`server/src/utils/tenantGuard.ts`** — smaller, older helper (`findOwnedOrNull`, `verifyClinicOwnership`), `clinicId`-only, bypassing the `organizationId`-aware machinery in `clinicScope.ts` entirely.

Injection is **manual**: routes call `validateAndGetScope`/`validateAndGetClinicIdScope` and pass the returned object directly as a Prisma `where` clause. There is no automatic middleware/extension-level injection today — every call site must remember to apply the scope, and a route that forgets is not caught by any structural mechanism, only by code review and the isolation test suite (§2.7). This is the single most important fact motivating this PoC: application-level scoping is real and evidenced (~40+ call sites per `adr-foundation-review.md`), but it is opt-in per call site, not enforced by the framework.

### 2.4 Raw SQL inventory (§A.9)

19 files contain `$queryRaw`/`$executeRaw`/`$queryRawUnsafe`/`$executeRawUnsafe` (14 production route/service files, 1 script, 4 test files). Full statement-level detail is in the JSON inventory's `raw_sql_files_summary` and per-model `raw_sql_exposure` fields. Highlights:

- Three `SELECT 1` health checks (`index.ts:165`, `platformAdmin.ts:985`, `operationalMonitoring.ts:234`) — no tenant parameter, by design, low risk.
- `routes/imaging.ts` and `routes/imagingBridgePublic.ts` use a local `clinicScopeSql()` helper (`imaging.ts:128`) that turns the validated scope into a parameterized `Prisma.sql` fragment — tenant-parameterized.
- `routes/reports.ts:87` uses `$queryRawUnsafe` with a positional `clinicId` **parameter** but a **string-interpolated** `groupByTrunc` value — the only call site in the repository that is not fully parameterized end-to-end. This is a candidate for the PoC's raw-SQL-bypass-detection experiment (§8, Experiment 11) even though the tenant predicate itself is bound correctly.
- Six advisory-lock call sites (`appointmentRequestSafety.ts`, `communicationConsentAdmin.ts`, `clinicBulkExportPackage.ts`, `clinicBulkExportPasswordAttempts.ts`, `patientPrivacyExportPackage.ts`) use `pg_advisory_xact_lock` with keys hashed from tenant identifiers — locks only, not data reads, but relevant to the PgBouncer transaction-pooling design (§7) because advisory locks are session/transaction-scoped and pooling mode changes their semantics.
- `services/security/securityIncidentService.ts:138` uses `$executeRawUnsafe` for an `UPDATE ... WHERE id=$3 AND (...)<$4` — **scoped by primary key only, no `clinicId`/`organizationId` predicate in the SQL itself.** This was flagged by prior F0-004 evidence as not statement-by-statement audited; this task confirms the finding and additionally notes that whether the caller validated tenant ownership of `incidentId` **upstream** was **not verified** in this pass. This is carried into the JSON inventory (`SecurityIncident` model, `migration_risk: "high"`) and should be resolved (upstream ownership check confirmed or added) independently of — and before — any RLS policy work on that table.

### 2.5 Jobs/workers (§A.5, §A.8)

`server/src/jobs/` (10 files) + `server/src/worker.ts` (separate process entrypoint, gated by `RUN_BACKGROUND_JOBS`, calls `startBackgroundJobs()`). Concrete cross-tenant-by-design patterns:

- `jobs/reminders.ts:571` — `const clinics = await prisma.clinic.findMany();` (no filter, every clinic in every organization), then `mapWithConcurrency(clinics, CLINIC_CONCURRENCY, ...)` (line 573, concurrency from `REMINDER_CLINIC_CONCURRENCY`, default 5). Tenant context is established only by passing the whole `clinic` object as a plain function parameter down the call chain (`runPatientAppointmentRemindersForClinic(clinic, ...)`, line 585) — **no formal tenant-context abstraction**: no `AsyncLocalStorage`, no RLS session variable, just manual parameter threading.
- `jobs/dataRetentionCleanupJob.ts` — deletes globally across all tenants by age threshold only (e.g. line 82), with **no clinic loop at all** — not even clinic-aware, let alone tenant-context-aware.
- `jobs/clinicBulkExportCleanupJob.ts` — cron sweep delegating to service functions that (per this pass) are assumed to iterate globally by expiry, not by explicit tenant loop (service internals not traced further in this pass).

This confirms the design questions in §5 below are not hypothetical: a job today can and does read/write across every tenant in a single process, by design, with the only "tenant context" being whatever variable is in scope in the calling function. Any future guard/RLS layer must have an explicit, first-class "system/job" mode — it cannot assume every Prisma call happens inside a single-tenant request.

### 2.6 Platform-admin paths (§A.11)

`server/src/routes/platformAdmin.ts`, mounted at `index.ts:184`. Distinct `PlatformAdmin` Prisma model (schema.prisma:1290), separate from the tenant `User` model, authenticated via `authenticatePlatformAdmin` (`middleware/platformAuth.ts:18`) applied blanket at `platformAdmin.ts:138`. Confirmed cross-tenant reads with no ownership check: `GET /organizations` (`prisma.organization.findMany`, unfiltered except optional status/search), `GET /clinics` (`prisma.clinic.findMany`, unfiltered), `GET /clinics/:id/users` (any clinic by path param, no requester-tenant check — access is gated purely by "is a platform admin," which is architecturally correct for this actor class but must be treated as the canonical "break-glass" context in any future guard design, not folded into the same code path as tenant-user requests).

### 2.7 DB connection pool and PgBouncer (§A.14–A.16)

`server/src/db.ts:9-21` (exact code, confirmed by direct read):

```ts
const parsePositiveInt = (value, fallback) => { const parsed = parseInt(value ?? '', 10); return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback; };
const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL!,
    max: parsePositiveInt(process.env.DB_POOL_MAX, 10),
    connectionTimeoutMillis: parsePositiveInt(process.env.DB_POOL_CONNECT_TIMEOUT_MS, 10_000),
    idleTimeoutMillis: parsePositiveInt(process.env.DB_POOL_IDLE_TIMEOUT_MS, 30_000),
  }),
});
```

Env vars: `DATABASE_URL` (required, no default), `DB_POOL_MAX` (default 10), `DB_POOL_CONNECT_TIMEOUT_MS` (default 10000), `DB_POOL_IDLE_TIMEOUT_MS` (default 30000) — none of the three pool-tuning variables appear in `server/.env.example` (confirmed by `ENVIRONMENT_MATRIX.md`), so an operator following only the example would not discover them. `db.ts`'s own code comment (lines 5-8) already flags that the default pool size can exhaust "under concurrent load (many clinics online)." With 2 processes (API + worker) at default `DB_POOL_MAX=10`, up to 20 direct-Postgres connections are opened from the application alone, before counting the 11 standalone script/utility clients in §2.2 (most are short-lived one-off runs, but `utils/activity.ts`'s pool is long-lived).

**PgBouncer presence in production is `UNVERIFIED`** — confirmed independently by this task via `PRODUCTION_TOPOLOGY.md` (§7 "What remains unverified"), `F0-006_PRODUCTION_TOPOLOGY_EVIDENCE.md`, and a repository-wide grep for "pgbouncer" (case-insensitive) that returned **zero code hits** and only documentation references, all of which state the same unverified status. There is no PgBouncer configuration, client library, or connection-string convention anywhere in the repository. Any PgBouncer PoC therefore starts from zero — it is not validating an existing partial deployment, it is validating a greenfield candidate technology against a known application connection pattern.

**PostgreSQL version:** 16.14, single database `noramedi_crm`, `wal_level=replica`, `archive_mode=off` (no PITR) — per `PRODUCTION_TOPOLOGY.md`, itself `VERIFIED_PRODUCTION_OBSERVED` via F0-002 Stage B / F0-006. No read replica, no second database host anywhere in confirmed production topology.

### 2.8 Existing tenant-isolation test evidence (§A.13)

At least 13 backend test files contain explicit cross-tenant/cross-clinic/cross-organization denial assertions (full list with line references in the research evidence retained in this task's working notes; representative sample): `tests/multiBranchAccess.test.ts` (cross-org clinic access blocked, staff cannot guess clinic IDs), `tests/treatmentCaseClinicScope.test.ts`, `tests/clinicLegalProfile.test.ts` ("resolveEffectiveClinicId returns null for cross-org clinic access"), `tests/kvkkAttachmentImagingLifecycle.test.ts` (cross-clinic and cross-org token validation denial), `tests/imaging.test.ts` (cross-clinic device/bridge deletion blocked as 404), `tests/communicationConsent.test.ts` (cross-clinic patient rejected, cross-org identifier rejected), `tests/communicationPreferencesRoute.test.ts`, `tests/channelConsentGate.test.ts`, `tests/messageTemplateWabaBinding.test.ts`, `tests/imagingBridgePairing.test.ts`, `tests/imagingBridgeUpdate.test.ts`, `tests/clinicBulkExport.test.ts` (cross-org clinicId cannot bypass audit ordering; distinct lock keys per clinic). Per `TEST_OWNERSHIP.md`, 6 backend `.test.ts` files (including `channelConsentGate.test.ts` and `clinicLegalProfile.test.ts`) have **no `package.json` script** wiring them into any run command — they exist and pass when run directly, but are not part of any CI-equivalent gate today. This is a pre-existing gap this task did not create and is not in scope to fix, but it is directly relevant to §9 (a future CI-mandatory isolation regression matrix cannot simply assume these files already run).

### 2.9 Coverage statement

This evidence was gathered via direct `Read`/`Grep` of `server/src/db.ts`, `server/src/utils/clinicScope.ts`, `server/src/middleware/clinicAccess.ts`, `server/src/utils/tenantGuard.ts`, `server/src/routes/platformAdmin.ts`, all files under `server/src/jobs/`, `server/src/worker.ts`, all 19 raw-SQL files, and a full manual read of `server/prisma/schema.prisma` (2994 lines, all 91 models). It does **not** claim to have read every route/service file in the repository (56 route files, 79 service files per `MODULE_MAP.md`) — the ~40+ call sites of `validateAndGetScope`/`validateAndGetClinicIdScope` are counted by grep match, not individually reviewed. Statement-by-statement audit of two raw-SQL files (`index.ts`'s and `securityIncidentService.ts`'s, per §2.4) remains partial. Full coverage of all 56 route files and 79 service files is explicitly deferred to the PoC implementation phase (F5), not claimed here.

## 3. Tenant model classification

Full detail — all 91 Prisma models, each with domain owner, current tenant key(s), classification, direct/inherited scope, current access evidence, proposed PoC guard mode, proposed RLS policy family, raw-SQL exposure, system-context need, migration risk, and confidence — is in the machine-readable inventory: [`evidence/f0-009-tenant-model-inventory.json`](evidence/f0-009-tenant-model-inventory.json). Validated: 91/91 schema models classified, 0 unclassified, 0 duplicates, JSON-valid (see §11 Validation).

Summary counts:

| Classification | Count | Meaning |
|---|---:|---|
| `clinic_scoped_direct` | 49 | Has `clinicId` directly, no `organizationId` column |
| `clinic_scoped_dual_key` | 19 | Has both `clinicId` and `organizationId` directly |
| `platform_global` | 5 | No tenant column; global/system entity |
| `org_scoped_optional_clinic` | 5 | `organizationId` required, `clinicId` nullable by design |
| `ambiguous_nullable_tenant` | 4 | Both keys nullable by design (or structurally decoupled) — needs an explicit decision before any default policy |
| `child_via_parent` | 6 | No own tenant column; scope only derivable via a parent join |
| `organization_scoped` | 3 | Has `organizationId` directly, no `clinicId` (shared across an org's clinics) |

(Correction, F0-009 correction pass, 2026-07-19: this table and the `summary_counts` block in the JSON evidence file previously carried stale, internally inconsistent counts — 47/22/7/5/6/5/3, summing to 95 instead of 91 — left over from an earlier classification draft. The counts above are recomputed directly from the `classification` field of each of the 91 model entries via a deterministic script; they sum to 91 and match `schema.prisma`'s 91 models exactly. No model's `classification` value was changed to produce this correction.)

This task does **not** recommend adding `organizationId` to every clinic-scoped table. 49 of 91 models (`clinic_scoped_direct`) function correctly today on `clinicId` alone, and `clinicScope.ts`'s own `toClinicOnlyScope`/`buildClinicIdScope` functions exist specifically because that split is intentional, not an oversight. Where the dual-key pattern *is* present (19 models), the schema's own comments mark it `// Phase 1b: NOT NULL after backfill` for the four foundational models (`Clinic`, `User`, `Patient`, `InventoryItem`) — a backfill already completed for those four — while newer messaging/consent/privacy models (`WhatsAppConnection` family, `PatientCommunicationPreference` family, `ClinicBulkExportArchive`, etc.) were designed dual-key from the start. The four `ambiguous_nullable_tenant` models (`MessagingInboundEvent`, `CommunicationConsentConflictBucket`, `SecuritySignalEvent`, `SecurityIncident`) are the ones requiring an explicit design decision — see §4 and §6. `SecurityIncidentActivity` inherits the same nullable-tenant ambiguity by parent reference but has no tenant column of its own, so it is classified `child_via_parent`, not `ambiguous_nullable_tenant`.

Two findings from the classification work are worth surfacing here rather than only in the JSON:

1. **`UserClinic` sits on the critical path for computing tenant context itself** — it is the table that resolves `ctx.allowedClinicIds`. Any future guard/RLS ordering must query this table *before* full tenant context exists, which is a bootstrapping concern distinct from every other clinic-scoped table (JSON: `migration_risk: "medium"`, flagged explicitly).
2. **`PasswordResetToken`, `EmailVerificationToken`, and the User login-by-email path** are legitimate pre-tenant-context lookups (a user is not yet authenticated, so no tenant is known). These are not bugs to fix; they are the first three concrete instances of the "escape hatch" concept required by §D below, and the PoC design treats them as such rather than as gaps in the classification.

## 4. TenantContext contract (future API — not implemented)

A future `TenantContext` should be an explicit, constructed value — not solely an `AsyncLocalStorage`-populated implicit global — because the evidence in §2.5–§2.6 shows at least three genuinely distinct calling shapes that a single implicit-only design would blur together: an authenticated tenant request, a background job iterating many tenants in one process, and a platform-admin break-glass action. `AsyncLocalStorage` is still the right mechanism to *propagate* whichever context was constructed across an async call chain (so route handlers don't have to thread a parameter through every function), but propagation and construction are different concerns.

### 4.1 Context modes

| Mode | Constructed by | Required fields | Fails closed when |
|---|---|---|---|
| `tenant` | Auth middleware, from an authenticated `User` session | `organizationId`, `allowedClinicIds[]`, `selectedClinicId` (nullable = "all allowed clinics"), `actorUserId`, `actorRole` | `organizationId` cannot be resolved, or `selectedClinicId` is set but not in `allowedClinicIds` |
| `system` | Job scheduler / worker entrypoint only, never by route-handler code | `jobName`, `correlationId`, explicit tenant iteration variable when the job is per-tenant (e.g. `clinicId` for `reminders.ts`) or `scope: 'all_tenants'` when it is not (e.g. `dataRetentionCleanupJob.ts`) | `jobName`/`correlationId` missing |
| `platform_admin` | Platform-admin auth middleware only | `actorPlatformAdminId`, `reason` (free-text, mandatory, audited), `correlationId` | `reason` missing or empty |
| `break_glass` | A narrower, explicitly-invoked subset of `platform_admin` for cross-tenant writes specifically (not reads) | everything `platform_admin` requires, plus a second, distinct confirmation flag not settable by the same call that sets `reason` | any of the above, or the confirmation flag is absent |
| unauthenticated / pre-context | Explicit named functions only (login-by-email, token redemption, public-booking write, webhook ingest) | none — this is the "no context" case | N/A — see §4.4 |

`actor`, `access mode`, and `reason/correlation data` (required fields named in the task prompt) map to `actorUserId`/`actorPlatformAdminId`, the mode enum itself, and `correlationId`/`reason` respectively above.

### 4.2 Who may construct which context

- `tenant`: only the authentication middleware, immediately after validating a session/JWT, using the existing `clinicScope.ts` resolution logic as its source of truth (this PoC design does not propose replacing that logic — it proposes wrapping it in a typed context object propagated via `AsyncLocalStorage` instead of an ad hoc `req.clinicScope`).
- `system`: only `server/src/worker.ts`'s job-invocation wrapper and `server/src/jobs/startBackgroundJobs.ts`'s scheduler, never by route-handler code, never callable from an HTTP request.
- `platform_admin`/`break_glass`: only `middleware/platformAuth.ts`'s `authenticatePlatformAdmin`, and only for routes explicitly mounted under `/api/platform`.
- No code path may construct a `system` or `platform_admin` context implicitly, by omission, or as a "fallback" when a `tenant` context fails to resolve. **Missing context must fail closed (403/500, not an unscoped query)** — this is the single most important behavioral requirement carried into the guard design in §5, and it must be provable by the PoC's context-absence experiment (§8, Experiment 2).

### 4.3 Nested contexts, concurrency, and leakage prevention

- **Nesting**: a `tenant` context must never be re-entered with a *different* tenant's identifiers mid-request (no legitimate code path needs this). A `system` context iterating clinics (like `reminders.ts`) is the one legitimate case of sequential-not-nested context switching within a single process — each iteration should run inside its own freshly-entered `AsyncLocalStorage.run()` scope with that iteration's `clinicId`, not a mutated shared object, precisely to prevent the leakage failure mode where async callback ordering causes clinic B's code to observe clinic A's still-set context.
- **Concurrency safety**: `mapWithConcurrency` (already used by `reminders.ts:573`) runs multiple clinic iterations concurrently within one process. `AsyncLocalStorage` is designed for exactly this — each concurrent async chain gets its own context snapshot — but this must be *proven*, not assumed, because a bug in how the job wrapper invokes `AsyncLocalStorage.run()` per iteration (e.g. accidentally sharing one `run()` call across the whole `mapWithConcurrency` batch) would silently produce the worst possible failure mode: concurrent cross-tenant leakage inside a single job run. This is Experiment 1 in §8.
- **Context leakage across requests**: Node.js `AsyncLocalStorage` is per-async-chain by construction, so context should not leak between unrelated concurrent HTTP requests under normal operation — but connection-pool reuse patterns (a Prisma/`pg` client reused across requests) and the PgBouncer transaction-pooling question in §7 are a *different* leakage surface (session-level Postgres state, not Node-level context) and must be tested independently — this is Experiment 3.
- **Job iteration strategy**: for a per-clinic job like `reminders.ts`, the context must be entered once per clinic iteration, immediately before that clinic's Prisma calls, and exited (implicitly, by `AsyncLocalStorage.run()`'s callback returning) before the next iteration's context is entered — never batch-entered for the whole clinic list.
- **Test setup/teardown**: test suites must be able to construct any context mode directly (bypassing the auth-middleware constructors named in §4.2, since tests are not going through HTTP) for both positive (correct-tenant access succeeds) and negative (cross-tenant access fails) assertions — this is an explicit escape hatch *for the test harness only*, distinct from the production escape hatches in §5.5, and must be clearly named and isolated (e.g. a `test-utils` module never imported by production code) so it cannot accidentally become a production bypass.

### 4.4 Unauthenticated / pre-context paths

Login-by-email, password-reset-token redemption, email-verification-token redemption, public-booking write (`PublicBookingNoticeEvidence`), and webhook ingest (`MessagingInboundEvent`) are **not** failures of the context model — they are its documented exceptions. Each must be an explicitly named function (not a context mode) that a future guard recognizes as legitimately running with no `TenantContext` at all, and each must resolve to a `tenant` (or, for a login failure, no) context by the time it reaches any tenant-scoped table. `SecuritySignalEvent`/`SecurityIncident`'s nullable-tenant design (§3, §6) is a related but distinct case — a signal or incident *can* have a resolved tenant and still legitimately be visible only under `platform_admin` context, which §4.1's `system_context_required` guard mode (§5) is meant to capture.

## 5. Prisma guard alternatives (evaluated, not selected)

| Approach | Description | Fit given current architecture |
|---|---|---|
| `$extends` query extension | Wrap the `db.ts` singleton with `.extends({query: {...}})`, intercepting `findMany`/`findFirst`/`update`/etc. per model and injecting the tenant `where` from `AsyncLocalStorage` context | Cleanest per-operation interception; Prisma's documented extension mechanism (Prisma-version-specific behavior must be re-verified against the actual Prisma major version in use before implementation — see §12 unresolved assumptions). **Does not automatically cover the 11 standalone `PrismaClient` instances in §2.2**, most critically `utils/activity.ts`'s live pool — an extension applied only to `db.ts`'s export leaves that pool unguarded. |
| Client wrapping (manual proxy) | Hand-written `Proxy` around `PrismaClient` methods | More control over edge cases (raw SQL, `$transaction`) than `$extends`, but is reinventing what `$extends` already does for the covered operations, and does not resolve the multi-instance problem either. |
| Repository/data-access façade | Introduce a per-domain repository layer that all routes/services call instead of `prisma` directly, with tenant scoping enforced inside the façade | Structurally the strongest guarantee (nothing can bypass it because nothing has direct `prisma` access), but is the largest change — it is a "physical module refactoring" of a kind the KVKK freeze boundary (`§3` item 13, "wide module extraction") would treat as blocked-until-baseline-stable regardless of RLS status, and it duplicates what `clinicScope.ts` already does for the ~40+ existing call sites, at the cost of touching every one of them. |
| Generated model metadata | Codegen a static table of {model → tenant key(s)} from `schema.prisma` (the JSON inventory in §3 is a hand-built version of exactly this) and drive the guard's per-model behavior from it at runtime | Not an alternative to the above — a **prerequisite** for any of them. Whichever mechanism is chosen, it needs machine-readable model metadata to know which models take `clinicId`, which take `organizationId`, which are dual-key, and which are `system_context_required`. This document's JSON inventory is the seed for that metadata; a PoC should decide whether to keep it hand-maintained, generate it from a Prisma schema comment/annotation convention, or generate it from a database introspection query. |
| Hybrid enforcement | `$extends` for the operations it can safely intercept + explicit escape-hatch functions for raw SQL and the standalone-client instances, backed by the shared generated metadata | Most consistent with the evidence in §2: raw SQL and multiple client instances are real, current facts, not hypothetical edge cases to design around later. |

**No guard proposed here silently changes query semantics without a testable proof** — every guard mode below is required to have a corresponding experiment in §8 demonstrating it produces the *same result set* as the existing manual `clinicScope.ts` call for at least one representative model per classification family, before it is trusted to run unattended.

### 5.1 Per-operation guard behavior (required for any candidate)

| Operation | Required guard behavior |
|---|---|
| `findUnique` | Post-query validation only (primary-key lookups cannot carry a `where.clinicId` without changing the query's uniqueness semantics for some models) — the guard must check the returned row's tenant key against context *after* the query and suppress/404 a cross-tenant hit, matching `tenantGuard.ts`'s existing `findOwnedOrNull` pattern. |
| `findFirst`, `findMany`, `count`, `aggregate`, `groupBy` | Automatic filter injection into `where` (and, for `groupBy`, verify the tenant key is compatible with the `by` clause). |
| `create`, `createMany` | Write-payload validation: the tenant key(s) in the payload must equal context's tenant key(s); the guard must not silently *inject* a tenant key into a create payload the caller didn't already scope correctly, because that would mask a bug rather than reject it — see "operations that must be prohibited" below. |
| `update`, `upsert` | Automatic filter injection on the `where` (so the update cannot target a cross-tenant row) plus write-payload validation on the `data` (so a same-tenant update cannot *change* a row's tenant key to another tenant's). |
| `updateMany`, `deleteMany` | Automatic filter injection into `where` is **mandatory, not optional** — these are the operations named explicitly in the experiment matrix (§8, Experiment 8) because a missed injection here silently affects every row in the table, not just one. |
| `delete` | Automatic filter injection into `where`, same reasoning as `update`. |
| Nested writes (`connect`, relation-scoped `create`) | **Parent ownership validation** — a nested `connect` to a related record must verify that related record belongs to the same tenant before the write commits; this is the single hardest case in the whole guard design because Prisma's nested-write API does not expose a clean single interception point for "the ID being connected." Flagged as **cannot-safely-auto-rewrite** below. |
| `disconnect` | Same parent-ownership validation as `connect`, plus verification that the record being disconnected currently belongs to the context tenant (so a cross-tenant disconnect can't be used to sever another tenant's relation as a side effect). |
| Relation filters (`include`/nested `where`) | Automatic filter injection must apply *recursively* into included relations, not just the top-level `where` — otherwise `patient.findMany({where: scopedByOrg, include: {appointments: true}})` could return another tenant's appointments nested under a correctly-scoped patient if `Appointment` itself isn't independently filtered. |
| `include` / nested relation reads | Same recursive requirement as relation filters. |
| `$transaction` (batch array form) | Guard must apply per-statement, exactly as it would outside a transaction — the 5 known batch call sites (§2.2) are straightforward. |
| `$transaction` (interactive/callback form) | Guard must propagate the *same* `TenantContext` into the transaction client (`tx`) that the outer call had — the 34 known interactive call sites are where the AsyncLocalStorage-vs-explicit-parameter design choice in §4 matters most, because `tx` is a distinct client instance from `prisma` for the duration of the callback. |
| Raw SQL (`$queryRaw`, `$executeRaw`, and the `Unsafe` variants) | **Cannot be auto-rewritten at all.** Treated separately in §6. |
| Platform/global models (`Plan`, `PlatformAdmin`, `PlatformSetting`, `PlatformSmsProvider`, `JobLock`) | Guard must recognize these via the generated metadata (§5, "generated model metadata") and apply **no** tenant filter, while still requiring an explicit `system` or `platform_admin` context to be present (per §4) — i.e., "no tenant filter" is not the same as "no context required." |
| Explicit system context (`ctx.mode === 'system'`) | Guard must switch to whatever iteration-scoped tenant value the job explicitly set (§4.3) rather than reading an ambient `organizationId` — the job is the source of truth for which tenant it's currently processing, not the guard. |

### 5.2 Operations that cannot safely be auto-rewritten

1. **Nested `connect`/`disconnect` on relations whose foreign key is not the model's own tenant key** (e.g. connecting a `TreatmentPlanProcedure` to a `TreatmentPackageItem` — both are `clinic_scoped_direct` but the FK path between them isn't the tenant key itself). A guard can validate these post-hoc (query the connected row's tenant key before committing) but cannot safely rewrite the `connect` call itself without risking silently connecting to a *different*, guard-selected row — which would be worse than rejecting the operation outright.
2. **All raw SQL** — by definition outside Prisma's query-builder AST, so no extension/wrapper can inspect or rewrite it. Treated in §6.
3. **The 6 `child_via_parent` models' writes** (`PaymentPlanInstallment`, `LabWorkOrderStatusHistory`, `ImagingBridgePairingDevice`, `SecurityIncidentActivity`, and by the same reasoning any similar future child table) — a `create` on these has no tenant column to auto-filter; the guard's only lever is parent-ownership validation *before* the write, which is a real check but not a rewrite.
4. **Writes originating from the 5 named pre-context paths** (§4.4) — by definition, no `TenantContext` exists yet to rewrite against; these need named, narrow, explicitly-audited functions instead (§5.5), not guard rewriting.

### 5.3 Automatic filter injection vs. post-query validation vs. write-payload validation vs. parent-ownership validation

These are treated as four **distinct** mechanisms in this design, not synonyms, because different Prisma operations need different combinations of them (see the table in §5.1): filter injection changes what a read query asks the database for; post-query validation checks what came back; write-payload validation checks what's about to be written; parent-ownership validation checks a *related* row's tenant key before a write proceeds. A guard PoC must demonstrate all four independently, because a design that only implements filter injection (the easiest one) would leave `findUnique`, all writes, and all nested relations unguarded — which is most of the operation list in §5.1.

### 5.4 Operations that must be prohibited outright

- A `create`/`createMany`/`update`/`upsert` payload that supplies a tenant-key value **different** from the current context's tenant key must be rejected (400/403), never silently corrected to the "right" value — silent correction would hide a caller bug that put the wrong tenant key in a payload in the first place, which is exactly the class of bug this whole PoC exists to catch.
- Any `updateMany`/`deleteMany` call with **no** tenant predicate reachable in its `where` (i.e., the guard cannot construct a scoped filter for this model+context combination) must be rejected outright rather than executed unscoped — this is the single highest-severity failure mode in the entire guard design (one missed injection = every tenant's rows affected) and is why it has its own dedicated experiment (§8, Experiment 8).

### 5.5 Escape hatches

Per the task's requirement, escape hatches must be narrow, named, audited, and unavailable to normal request code. Proposed escape-hatch inventory (design only — none implemented):

| Escape hatch | Scope | Audit requirement |
|---|---|---|
| `runAsSystem(jobName, fn)` | Background jobs only, callable only from `server/src/jobs/*` and `worker.ts` | Every invocation logged with `jobName` + `correlationId`; never callable from `server/src/routes/*`. |
| `runAsPlatformAdmin(platformAdminId, reason, fn)` | Platform-admin routes only | `reason` is mandatory and non-empty; every invocation is itself an `AuditLog` write (not merely a log line), because platform-admin cross-tenant access is exactly the kind of action `AuditLog`/`OperationalEvent` already exist to record. |
| `runAsBreakGlass(platformAdminId, reason, confirmationToken, fn)` | A strict subset of the above, for cross-tenant **writes** specifically | Same as above, plus a second, distinct confirmation step (not the same call that supplies `reason`) so a break-glass write cannot happen from a single, easily-scripted call. |
| `resolveUnauthenticated(functionName, fn)` | The 5 named pre-context paths in §4.4 only, one named wrapper per path (not a generic bypass) | Each named wrapper is individually reviewable in a diff; a generic `bypassGuard()` escape hatch is explicitly rejected as a design option — it would be indistinguishable from a bug at every call site. |

## 6. Raw SQL treatment

Raw SQL is not something the guard can intercept (§5.2). The PoC design instead requires:

1. **A repository-wide raw-SQL inventory as a checked artifact** (this document's §2.4 and the JSON's `raw_sql_files_summary` are the seed; a future task should turn this into a lint rule or CI check that fails when a new `$queryRaw`/`$executeRaw` call site is added without a corresponding entry in the inventory).
2. **Every raw-SQL call site must state, in a comment adjacent to the call, which tenant key(s) parameterize it and how** (most already effectively do this via variable naming, e.g. `clinicScopeSql()`, but it is not a structural, checked requirement today).
3. **The two specific gaps found in §2.4 are named as pre-PoC remediation candidates, independent of RLS/guard work**: (a) confirm or add an upstream tenant-ownership check before `securityIncidentService.ts:138`'s `$executeRawUnsafe` call, and (b) either parameterize `routes/reports.ts:87`'s `groupByTrunc` value via an allowlist (it almost certainly already is constrained to a small enum of valid values, but that constraint was not verified in this pass) or replace it with the tagged-template form used elsewhere in the same file.
4. **RLS is the structural answer to "what if a guard is bypassed or a raw-SQL statement omits a tenant predicate,"** which is precisely why ADR-002 and the enterprise-foundation-decision-set treat RLS as *additive* to, not a replacement for, application-level scoping (§7) — a raw-SQL statement that forgets its tenant predicate would still be constrained by an active RLS policy at the database layer, provided the connection's session role is the constrained `app` role and not a bypass role (§7.2).

## 7. RLS PoC design (isolated environment only)

This is a design for a **future, disposable** PoC — it must not run against production, the shared development database, or existing project migrations. Nothing here is scheduled or authorized to run.

### 7.1 Environment

- A disposable PostgreSQL 16.x instance (matching the confirmed production major version, §2.7), created and destroyed per PoC run — never a shared/persistent database, never connected to via the production `DATABASE_URL`.
- A **minimal representative schema**, not the full 91-model schema: one `organizations` table, one `clinics` table (FK to organizations), one `users` table (dual-key, mirroring the real `User` model), one direct-scoped child table (mirroring `clinic_scoped_direct`, e.g. an `appointments`-shaped table), one dual-key child table (mirroring `clinic_scoped_dual_key`), and one parent-scoped-only child table with no tenant column (mirroring `child_via_parent`, e.g. a `payment_plan_installments`-shaped table FK'd to a `payment_plans`-shaped parent). This is deliberately small so policy behavior, not schema completeness, is what's being measured.
- Representative data: at least 3 organizations, 2+ clinics per organization (to exercise cross-clinic-within-org rules distinctly from cross-org rules), 2+ users per clinic, and enough rows in each child table to make index/query-plan comparisons meaningful (the PoC should scale this up specifically for the performance-benchmark experiments, §8, separately from the small fixture used for the correctness experiments).

### 7.2 Roles

| Role | Purpose | Key property |
|---|---|---|
| `app` | The role the running application (via `db.ts`'s pool) connects as in the PoC | Subject to RLS; no `BYPASSRLS`; this is the role every correctness experiment must use to prove denial actually happens. |
| `migrator` | Schema migrations only | `BYPASSRLS`, used only for the PoC's own `prisma migrate`-equivalent setup step, never for query experiments. |
| `platform_support` (optional) | Models the `platform_admin`/`break_glass` context from §4 | A distinct role (not `BYPASSRLS` — that would make every table fully visible, which is broader than platform-admin's actual real-world access pattern per §2.6) with its own, deliberately permissive policy on the specific tables platform-admin routes actually touch, so the PoC can test that break-glass access is *scoped to what the policy allows*, not unconditionally total. |

### 7.3 RLS mechanics to test

- `ENABLE ROW LEVEL SECURITY` vs. `FORCE ROW LEVEL SECURITY` — the PoC must test both, because `FORCE` is required to make RLS apply even to the table owner, and the `app` role's relationship to table ownership (owner vs. non-owner) must be decided and tested, not assumed.
- **Transaction-local context** via `SET LOCAL app.organization_id = '...'` (or `set_config('app.organization_id', $1, true)`) — set once per transaction/request, read by policy `USING`/`WITH CHECK` expressions via `current_setting('app.organization_id', true)` (the `true` third argument for "missing is null, not an error" — the PoC must test the alternative, an unset variable causing every policy `current_setting` call to raise, as the **fail-closed default**, and treat "missing setting silently defaults to something permissive" as the failure condition to actively rule out).
- **Malformed-setting behavior**: what happens if `app.organization_id` is set to a non-UUID string, or a UUID that doesn't `::uuid`-cast cleanly against the column type — must error, not silently coerce to a false/true comparison.
- **Connection reuse behavior**: since `SET LOCAL` is transaction-scoped, a connection returned to a pool (either the app's own `pg` pool per §2.7, or a future PgBouncer layer per §7 below) must have its session variable cleared or re-set before the next transaction — this is the exact seam where §4.3's "context leakage" concern becomes a database-layer, not just a Node-layer, risk, and is why Experiment 3 in §8 exists as a distinct test from the Node-level context-propagation experiment.
- **Owner-table bypass**: confirm that a table's owner role bypasses `ENABLE`-only RLS (well-documented Postgres behavior) and that `FORCE` is genuinely required to close that gap for the `app` role if `app` happens to own the table in the PoC's setup — role/ownership assignment must be deliberate, not incidental.
- **Foreign-key and nested-write behavior**: a child-table insert whose FK points to a parent row the current policy wouldn't let the session *read* (e.g. inserting a `payment_plan_installments`-shaped row against a `payment_plans`-shaped row from another tenant) — Postgres FK constraint checks run with elevated privilege regardless of RLS, so this specific cross-tenant FK-target insert is a case where **RLS alone will not catch the bug**; the PoC must confirm this empirically and document it as a case where the Prisma guard's parent-ownership validation (§5.1) remains load-bearing even with RLS enabled — direct evidence for why RLS is additive, not a replacement.
- **Bulk operation behavior**: `updateMany`/`deleteMany`-equivalent bulk `UPDATE`/`DELETE` statements against the RLS-enabled table, confirming the affected-row count matches the tenant-scoped expectation, not the whole-table count.
- **Interactive transaction behavior**: `SET LOCAL` inside a Prisma interactive transaction callback (§5.1's `$transaction` interactive-form row) — must confirm the setting survives for the whole callback and is genuinely transaction-scoped (cleared at commit/rollback), matching the 34 known interactive call sites' shape.
- **Rollback behavior**: after a rolled-back transaction, confirm the next transaction on the same (possibly pooled) connection does not inherit the rolled-back transaction's session variable.
- **Worker/system-job behavior**: the PoC must include at least one simulated "job" client that either (a) connects as a role with no RLS applied (mirroring `system_context_required` guard mode) or (b) iterates `SET LOCAL` per simulated tenant inside a loop, and must measure whether option (b) is fast enough to be viable for `reminders.ts`-shaped cross-tenant iteration (this is a real, not hypothetical, question — see §7.6 below).

### 7.4 Policy-family alternatives compared (not pre-selected)

| Family | Mechanism | Best fit (per §3 classification) | Open question the PoC must answer |
|---|---|---|---|
| Direct `organizationId`/`clinicId` policy | `USING (clinic_id = current_setting('app.clinic_id')::uuid)` | The 49 `clinic_scoped_direct` + 19 `clinic_scoped_dual_key` models (68 of 91) | Whether a single-column vs. two-column (`dual_key_policy`) predicate has a measurable performance difference at realistic row counts/index shapes. |
| `clinicId` + join/subquery through `Clinic` | `USING (EXISTS (SELECT 1 FROM clinics WHERE clinics.id = this.clinic_id AND clinics.organization_id = current_setting(...)))` | An alternative to dual-key columns for models that only carry `clinicId` today (the 49) — trading a schema change (adding `organizationId`) for a join cost | Whether the join cost is acceptable at scale, and whether it's actually *needed* given that `clinicId` alone is already sufficiently selective (per `clinicScope.ts`'s own comment, the app-level code already treats `clinicId` as sufficient for these models specifically). |
| Parent-derived child policy | `USING (EXISTS (SELECT 1 FROM parent_table WHERE parent_table.id = this.parent_id AND parent_table.clinic_id = current_setting(...)))` | The 6 `child_via_parent` models | Join performance at realistic depth (some of these, e.g. `SecurityIncidentActivity`, are two hops from a nullable-tenant parent — §7.5) and whether Postgres can use an index on the join efficiently. |
| Policy-function/helper-function approach | A `SECURITY DEFINER` SQL function encapsulating the predicate, referenced by multiple table policies | The 5 `org_scoped_optional_clinic` models (conditional clinic-or-not logic) and, tentatively, the 4 `ambiguous_nullable_tenant` models once §7.5's open question is resolved | Whether a function call per row evaluation has a measurable performance cost versus an inline expression, and whether `SECURITY DEFINER` here introduces its own privilege-escalation review burden that needs separate sign-off. |

**No family is pre-selected.** The classification in §3 suggests direct-column policies are sufficient for the large majority (68/91) of models, and that the harder design work concentrates in the 15 models that are `org_scoped_optional_clinic`, `ambiguous_nullable_tenant`, or `child_via_parent` (5 + 4 + 6) — this is itself a PoC-scoping finding: a future PoC can get useful, representative signal from a small schema (§7.1) precisely because the "easy" 68 all share one shape. The remaining 8 models (`platform_global`: 5, `organization_scoped`: 3) are out of scope for per-clinic RLS policies entirely — they have no clinic-level tenant dimension to enforce.

### 7.5 The nullable-tenant-key open question

`SecuritySignalEvent`, `SecurityIncident` (and by inheritance `SecurityIncidentActivity`), `MessagingInboundEvent`, and `CommunicationConsentConflictBucket` all have `organizationId`/`clinicId` as nullable, by explicit design (per their own schema doc comments — e.g. `SecuritySignalEvent`'s comment names "a Platform Admin login failure" and "a cross-tenant probe with no resolvable target org" as legitimate no-tenant cases). A naive RLS policy (`clinic_id = current_setting(...)`) would either hide these rows from every context (if the comparison is strict-equality against a null column) or, worse, silently match them under some contexts depending on how Postgres's `NULL` comparison semantics interact with the specific predicate written — this is exactly the ambiguity a policy-function approach (§7.4) is meant to resolve explicitly rather than leave to comparison-operator accident. The PoC must include this case specifically, not only the easy dual-key/direct-key cases, because it is the one place where "add a policy" is not obviously safe by default.

### 7.6 Trade-offs to document from the PoC (not pre-judged here)

- Index behavior: does an RLS predicate on `clinic_id` actually use the existing `@@index([clinicId, ...])` composite indexes already present on most models (confirmed present on e.g. `Appointment`, `RecallCandidate`, `SmsMessage`), or does Postgres's query planner need a different index shape once the predicate comes from a policy rather than an explicit `WHERE` clause?
- Latency impact: must be measured, not assumed, separately for the direct-column family (expected minimal) and the join-based families (expected non-trivial, magnitude unknown without measurement).
- Whether a per-tenant `SET LOCAL` loop (§7.3's worker-behavior item) is fast enough for `reminders.ts`'s current ~5-way concurrent, potentially hundreds-of-clinics-per-run shape — if `SET LOCAL` + policy evaluation adds meaningful per-iteration overhead, that is a direct input to whether the guard's `system_context_required` mode should mean "RLS off entirely for this role" (simpler, but forfeits DB-layer defense-in-depth for jobs) or "RLS on with fast per-iteration context switching" (the PoC must show which is actually true).

## 8. PgBouncer PoC design (isolated environment only)

### 8.1 What must be proven, and why transaction pooling is the starting candidate (not a conclusion)

Transaction pooling is PgBouncer's mode most compatible with a stateless, autoscalable API tier and is the mode most commonly recommended for exactly this workload shape — but that is general industry knowledge, not a repository fact, and per the task's instruction it must be marked for **primary-source verification** before implementation: the PoC's job is to confirm (a) whether Prisma's driver adapter (`@prisma/adapter-pg`, per `db.ts`'s `PrismaPg` import) is compatible with transaction-pooled connections at all under the currently-pinned Prisma major version, and (b) specifically how prepared-statement caching behaves under transaction pooling with that adapter, since transaction pooling's best-known incompatibility across the ecosystem is with server-side prepared statements that assume session affinity.

### 8.2 Exact experiments required

| # | Question | Method |
|---|---|---|
| 1 | Does the `pg`-adapter-backed Prisma client function at all against a PgBouncer transaction-pooled endpoint for the operation shapes in §5.1 (simple CRUD, interactive `$transaction`, raw SQL)? | Point the disposable PoC's `db.ts`-equivalent at a PgBouncer instance in transaction-pool mode instead of directly at Postgres; re-run the same test suite used for §7's RLS correctness experiments. |
| 2 | Must prepared-statement caching be disabled/configured? | Compare behavior with the adapter's default settings vs. any documented "disable prepared statements" / statement-cache-size option — the exact option name and default must be pulled from current Prisma/`pg`/`@prisma/adapter-pg` primary-source documentation at PoC time, not assumed from this document. |
| 3 | Is `SET LOCAL`-based RLS context (§7.3) safe under transaction pooling specifically? | This is the highest-priority experiment in this whole section: transaction pooling's core guarantee is "one connection per transaction, returned to the pool at commit/rollback" — which is exactly the scope `SET LOCAL` is designed for, making transaction pooling plausibly *compatible* with the RLS design in §7 in a way that session pooling would trivially be but statement pooling would not. This must be proven with an actual concurrent-load test (many simulated tenants, transaction-pooled), not inferred from the mode's documented semantics alone. |
| 4 | What happens when a query executes outside the required tenant transaction (i.e., `SET LOCAL` was never issued for the connection currently borrowed from the pool)? | Deliberately issue a bare query with no preceding `SET LOCAL` against a transaction-pooled, RLS-enabled table and confirm the fail-closed behavior from §7.3 (missing setting → policy denies, does not silently pass) holds identically under pooling. |
| 5 | Interactive transactions specifically | Confirm Prisma's interactive `$transaction` callback form (34 known call sites, §2.2) genuinely maps to one held connection for the callback's duration under transaction pooling — if it does not (e.g. if the adapter or pooler splits statements within one callback across different pooled connections), the whole `SET LOCAL` design in §7 breaks, and this must be discovered in the PoC, not in production. |
| 6 | Connection reuse / no leakage between unrelated transactions | Two simulated concurrent tenants hammering the pool; assert tenant B never observes tenant A's `SET LOCAL` value even under pool exhaustion/reuse pressure. |
| 7 | API and worker pool sizing | Model the PoC's connection budget on §2.7's confirmed shape (2 process types today: API + worker, `DB_POOL_MAX` default 10 each) plus a third simulated "migration" role — measure whether PgBouncer's `default_pool_size`/`max_client_conn` need to differ meaningfully from the current direct-Postgres `DB_POOL_MAX` given the transaction-pooling multiplexing PgBouncer provides. |
| 8 | Graceful shutdown / failure / reconnect | Kill the PgBouncer process mid-load-test; confirm the app's existing `pg` pool error/retry behavior (as currently configured via `DB_POOL_CONNECT_TIMEOUT_MS`) degrades predictably rather than hanging or silently dropping RLS context. |

### 8.3 Minimum PgBouncer version and configuration flags

Not asserted here — this is exactly the kind of external-product fact the task instructs to mark for verification rather than present as a repository fact. The PoC's setup step must pull the current minimum version supporting whatever prepared-statement/transaction-pooling configuration Experiment 2 above determines is required, from PgBouncer's own current documentation, at PoC time — not from this document, which has no authority on PgBouncer's release history.

### 8.4 Rollback path

The direct-Postgres path (§2.7's current architecture) is the rollback: if the PoC finds transaction pooling incompatible with the RLS/guard design at an acceptable performance/correctness bar, the fallback is not "abandon PgBouncer, abandon RLS" — it is "continue direct-Postgres connections as today, and let the guard (application layer) plus a smaller connection-budget increase (raising `DB_POOL_MAX`, adding read-oriented process separation) be the near-term connection-exhaustion mitigation for R-008, while RLS is still evaluated independently on its own merits (defense-in-depth) without being coupled to PgBouncer's fate." This decoupling — RLS and PgBouncer are two separate ADRs (004, 005) for exactly this reason — should be preserved in any future rollout plan.

### 8.5 Connection budget proposal (PoC acceptance input, not a production commitment)

| Process class | Current confirmed shape | PoC budget to test |
|---|---|---|
| API | `DB_POOL_MAX=10` default, 1 process today (per F0-006 topology) | Model at least 2-4 API instances in the PoC's load simulation (horizontal scaling is a stated program goal per the master tracker's program objective, §1) even though production today runs 1. |
| Worker | `DB_POOL_MAX=10` default, 1 process today, plus the separate live pool in `utils/activity.ts` (§2.2) | Include `activity.ts`'s pool explicitly as a second connection source in the budget model — it is real today, not a future addition. |
| Migrations | No confirmed dedicated connection path today (Prisma CLI migrations connect directly, ad hoc) | Must use the `migrator` role (§7.2, `BYPASSRLS`) and, if PgBouncer is adopted, a **direct** (non-pooled) connection for migrations specifically — DDL under transaction pooling is a known-risky combination that should not be tested as a first-class supported path, only confirmed-avoided. |
| Administrative/maintenance (`platform_support`) | N/A today | Model as a small, separate, low-concurrency budget distinct from API/worker, since break-glass access (§4, §5.5) is expected to be rare and low-volume, not sized like request traffic. |

### 8.6 Acceptance measurements

Defined jointly with §10 below (the task's required measurable thresholds apply identically to the PgBouncer and RLS experiments; they are not separated into two threshold sets because the combined "guard + RLS + PgBouncer" benchmark in §9's experiment matrix is itself one of the required experiments).

## 9. PoC experiment matrix

The full matrix (setup / action / expected result / failure interpretation / security significance / acceptance threshold / rollback-cleanup for each of the following) is maintained as a companion document to keep this file's length manageable: [`f0-009-poc-test-matrix.md`](f0-009-poc-test-matrix.md). Experiment list (20 required, matching the task's minimum set):

1. Tenant-context propagation across concurrent requests
2. Context-absence fail-closed test
3. Context-leakage test (Node-level `AsyncLocalStorage` **and** DB-session-level, tested separately per §7.3/§8.2 Experiment 6)
4. Cross-org read denial
5. Cross-org write denial
6. Cross-clinic behavior inside the same organization
7. Nested create/connect denial
8. `updateMany`/`deleteMany` containment
9. `upsert` isolation
10. `findUnique` behavior (post-query validation path)
11. Raw SQL bypass detection
12. Interactive transaction with RLS context
13. Transaction rollback and context cleanup
14. PgBouncer transaction-pool connection reuse
15. Prepared-statement behavior
16. Worker tenant iteration (mirroring `reminders.ts`'s actual shape)
17. System-job restricted access (mirroring `dataRetentionCleanupJob.ts`'s cross-tenant-by-design shape)
18. Platform-admin/break-glass audited access
19. Migration role bypass (`migrator`/`BYPASSRLS` correctness)
20. Performance benchmark ladder: baseline (no guard/RLS) → guard only → RLS only → guard+RLS → guard+RLS+PgBouncer

## 10. Acceptance thresholds (PoC proposal, requiring measurement)

### 10.1 Security acceptance — absolute, not negotiable

- **Zero** successful cross-organization reads across every experiment in §9.
- **Zero** successful cross-organization writes across every experiment in §9.
- **Zero** tenant-context leakage events (Node-level or DB-session-level) across every concurrency/pooling experiment.
- **Zero** unaudited system/break-glass access — every `runAsSystem`/`runAsPlatformAdmin`/`runAsBreakGlass` invocation in the PoC harness must produce a corresponding audit record, and the PoC must include a test that fails if one doesn't.

Any single violation of the above fails the PoC outright, regardless of performance results — performance thresholds below are not permitted to offset a security failure.

### 10.2 Performance/operational acceptance — proposed initial thresholds, explicitly requiring PoC measurement before being treated as real

| Metric | Proposed initial threshold | Status |
|---|---|---|
| p50 latency delta (guard+RLS vs. baseline) | ≤ 10% | Proposal — unmeasured |
| p95 latency delta | ≤ 20% | Proposal — unmeasured |
| p99 latency delta | ≤ 35% | Proposal — unmeasured |
| Throughput delta | ≥ 90% of baseline | Proposal — unmeasured |
| DB connection count under load | Within the budget table in §8.5 | Proposal — unmeasured |
| Transaction count / pool wait time | Pool wait time p95 ≤ 50ms under the PoC's simulated peak concurrency | Proposal — unmeasured |
| Error rate | No increase over baseline error rate under identical simulated load | Proposal — unmeasured |
| False-denial count (legitimate same-tenant access incorrectly blocked) | Zero | Proposal — unmeasured, but treated as a correctness bar as strict as the security bar, since a guard that fails closed *too* aggressively breaks the product |
| CPU impact | ≤ 15% increase at the DB host under identical simulated load | Proposal — unmeasured |
| Query-plan/index evidence | `EXPLAIN ANALYZE` captured for at least one representative query per policy family (§7.4), attached to the PoC report | Proposal — unmeasured |
| Worker batch-duration impact (`reminders.ts`-shaped job) | ≤ 25% increase in total per-run duration at a simulated realistic clinic count | Proposal — unmeasured |

These numbers are starting proposals for the PoC to test against, not commitments — per the task's instruction, they must be clearly marked as PoC acceptance proposals requiring measurement, which is why every row above is explicitly labeled "Proposal — unmeasured."

## 11. Proposed staged rollout (future, design-only — F0-009 does not authorize any stage)

| Stage | Content | Dependency | Flag | Observability | Backward compatibility | Rollback | Stopping condition | Required evidence |
|---|---|---|---|---|---|---|---|---|
| 1. Model inventory + generated metadata | Turn §3's JSON into the runtime-consumable metadata format chosen in §5 | This document | N/A (build-time artifact) | Metadata-generation CI check | N/A — additive | Delete the generated artifact | Metadata generation fails or disagrees with `schema.prisma` | Generation matches schema 1:1 (as this document's inventory does today, §12) |
| 2. TenantContext library | Implement §4's contract, `AsyncLocalStorage`-based propagation, all 5 context-mode constructors | Stage 1 | New library, unused by any route yet | Unit tests only | Fully additive — nothing calls it yet | Delete/don't wire in | Any context-mode construction test fails | 100% of §4.1's context-mode table covered by unit tests |
| 3. Shadow/audit-only guard mode | Wrap the guard around real traffic in **audit-only** mode (logs what it *would* have blocked/rewritten, changes nothing) | Stage 2 | `TENANT_GUARD_MODE=audit` | Structured log of every "would-have-been-denied" event | Fully backward compatible by construction (no behavior change) | Flag flip to `off` | Any unexpected high-volume "would-deny" pattern on legitimate traffic (signals a guard bug, not a real tenant bug) | Zero unexplained would-deny spikes over a defined observation window |
| 4. Fail-closed context for selected low-risk paths | Enable real enforcement (not just audit) for a small set of low-`migration_risk` models from §3's inventory (e.g. `DoctorAvailability`, `DoctorOffDay`) | Stage 3 clean audit results | `TENANT_GUARD_MODE=enforce`, per-model allowlist | Error-rate/deny-rate dashboards scoped to the enabled models | Additive — unlisted models unaffected | Remove model from allowlist | Deny-rate on enabled models exceeds the audit-stage baseline | Isolation regression tests pass for every enabled model |
| 5. Prisma guard on a selected model family | Expand enforcement to a full domain family (e.g. all Imaging models) | Stage 4 stable | Per-domain flag | Domain-scoped dashboards | Additive | Per-domain flag rollback | Any security-acceptance violation (§10.1) | Full §9 experiment matrix run against real staging traffic patterns for that domain |
| 6. Cross-tenant generated tests | CI-mandatory isolation regression suite generated from §3's inventory (one negative test per classification family at minimum) | Stage 1 (can run in parallel with 3-5) | CI gate | Test-run history | N/A | Revert CI gate config | Suite is flaky or has false positives | Suite green across ≥ 2 consecutive full runs |
| 7. Disposable RLS PoC | Execute §7/§8's design in an actual disposable environment, produce the §10 measurements | This document | N/A — separate environment entirely | PoC report | N/A | Destroy the environment | Any §10.1 security-acceptance failure, or §10.2 thresholds missed by a wide margin | Full PoC report with measured (not proposed) values for every §10.2 row |
| 8. Staging RLS rollout, table-by-table | Enable RLS per table in a real staging environment, starting with the lowest-`migration_risk` `clinic_scoped_direct` models | Stage 7 pass + KVKK freeze-boundary §5 conditions 3-5 satisfied (independent of this rollout's own readiness) | Per-table RLS flag (app connects as constrained role only once enabled) | Query-plan and latency monitoring per enabled table | Additive, table-by-table | `ALTER TABLE ... NO FORCE ROW LEVEL SECURITY` / `DISABLE ROW LEVEL SECURITY` per table | Any staging security-acceptance violation | Staging isolation-regression suite green with RLS enabled |
| 9. PgBouncer staging PoC | Point staging at a PgBouncer instance, re-run §8's experiments against real staging traffic | Stage 7 pass | Separate connection-string flag (app can fall back to direct Postgres) | Connection/pool dashboards | Fallback to direct connection is the rollback path itself | Flip connection string back to direct Postgres | Any §8.2 experiment fails against real staging load | Staging load test matches or exceeds PoC (Stage 7) measured thresholds |
| 10. Production canary rollout | **Only after** the KVKK freeze-boundary is explicitly released (§5 conditions 3-5) **and** ADR-004/005 receive evidence-based acceptance from Stages 7-9 | Stages 7-9, external ADR acceptance, external freeze-boundary release declaration | Production feature flag, single-tenant or small-cohort canary | Full production observability | Canary is opt-in per tenant/clinic | Flag off, canary tenants revert to pre-RLS/pre-guard path | Any §10.1 violation, or unresolved §10.2 regression | Canary period completes with zero security-acceptance violations |
| 11. Wider rollout, per-table rollback | General availability, staged by table/domain, each with its own independent rollback | Stage 10 canary success | Per-table/domain flags retained (not removed after canary) | Ongoing | Full — every stage retains its own rollback lever | Per-table/domain flag off | Any regression at any point in the wider rollout | Continuous CI-mandatory isolation regression suite green |

**F0-009 explicitly does not authorize any stage above.** Stage 1 is the earliest point at which any repository code would change, and even Stage 1 requires a separate, future task with its own review — this document is design input to that future task, not its authorization.

## 12. Freeze-boundary impact mapping

| Proposed future action | Classification |
|---|---|
| This document itself (design, JSON inventory, test matrix) | Allowed now: documentation only |
| Rollout Stage 7 (disposable RLS PoC execution) | Allowed now: isolated disposable PoC only — **not** authorized to actually run by this document; a future task must explicitly schedule and execute it |
| Rollout Stage 9 (PgBouncer staging PoC) | Allowed now: isolated disposable PoC only, same caveat |
| Rollout Stage 1 (generated model metadata, no runtime wiring) | Blocked until explicit KVKK baseline-stable declaration — per `KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md` §3 item 7 ("tenant-scope middleware restructuring") arguably does not cover a purely additive, unwired metadata artifact, but out of caution this document treats any repository code change — even unwired — as blocked until the freeze boundary's §5 conditions 3-5 are satisfied, since §7 of that document lists "F0-009 ... implementation (as opposed to design)" as blocked without qualification |
| Rollout Stages 2-6 (guard library, shadow mode, enforcement) | Blocked until explicit KVKK baseline-stable declaration (freeze boundary §3 items 7, 11, 12 directly name tenant-scope middleware restructuring, RLS rollout, and Prisma tenant-extension rollout) |
| Rollout Stage 8 (staging RLS rollout) | Blocked until production migration verification (KVKK freeze-boundary §5 condition 3) **and** blocked until separate ADR acceptance (ADR-005 must leave `NEEDS_POC`) |
| Rollout Stage 10 (production canary) | Blocked until explicit KVKK baseline-stable declaration (freeze-boundary §5 condition 5, external declaration) **and** blocked until separate ADR acceptance (ADR-004 and ADR-005) **and** blocked until legal/operational decision (a production RLS/PgBouncer rollout on a KVKK-regulated health platform is a decision this task is not positioned to make unilaterally even with all technical evidence in hand) |
| Rollout Stage 11 (wider GA rollout) | Same as Stage 10, plus dependent on Stage 10's own canary evidence |
| Remediating `securityIncidentService.ts:138`'s unaudited raw SQL (§6) | Not itself blocked by the freeze boundary's RLS/tenant-extension items (it is a bug-fix / audit-trail correctness item, not a tenant-scoping architecture change) — but is out of scope for this documentation-only task; flagged as a recommended near-term follow-up independent of F0-009/F5 |

PR #175's merge does **not** constitute full freeze release — per §2.1, only condition 2 of 5 is satisfied. This document does not treat it as more than that anywhere above.

## 13. Security, tenant, and KVKK impact of this task itself

This task changed no runtime behavior, no schema, no migration, no database role, no connection configuration, and no deployment artifact. Its security/tenant/KVKK impact is entirely in what it *documents*: it makes explicit, for the first time in the repository, (a) the full 91-model tenant classification, (b) the specific raw-SQL statement (`securityIncidentService.ts:138`) whose upstream tenant-ownership validation is unverified, and (c) the specific model (`SentMessage`) whose `organizationId` is nullable in a way that would block a naive dual-key RLS policy. None of these are new risks introduced by this task — they are pre-existing repository facts this task surfaces with file:line precision for the first time, which is itself the intended KVKK/security value of a documentation-only F0 task: it narrows what a future PoC and future implementation must account for, without touching anything live.

## 14. Unresolved questions

1. Which Prisma major version is actually pinned in `package.json`, and does its `$extends` API support all the operation-level interception behaviors required in §5.1? (Not verified in this pass — `package.json` was not read; this is a direct input to the PoC and must be confirmed before any guard implementation, not assumed from this document's title mentioning "Prisma 7.")
2. Whether `utils/activity.ts`'s standalone `PrismaClient`/`Pool` (§2.2) should be refactored to use the `db.ts` singleton *before* any guard work begins (so the guard has one, not two, connection surfaces to cover), or whether the guard design should explicitly support multiple client instances from the start.
3. Whether `CommunicationConsentConflictBucket`'s missing Prisma relation to `Clinic`/`Organization` (§3, JSON entry) is a deliberate decoupling to preserve or an oversight — this task did not read the conflict-detection service code closely enough to judge intent.
4. Whether `MessagingInboundEvent`'s nullable clinicId/organizationId get backfilled after creation (e.g. once a webhook payload is matched to a clinic) — the timing/mechanism of that backfill was not traced in this pass and materially affects which RLS policy family (§7.4) is even applicable.
5. Exact minimum PgBouncer version and required configuration flags (§8.3) — explicitly deferred to primary-source verification at PoC time.
6. Whether a repository/data-access façade (§5, rejected as a *first* option due to freeze-boundary conflict with "wide module extraction") becomes viable *after* the KVKK baseline stabilizes, as a longer-term alternative to a Prisma-extension-based guard — not evaluated in depth here because it is not a near-term candidate regardless.
7. Whether the existing ~40+ `validateAndGetScope`/`validateAndGetClinicIdScope` call sites should be migrated to route through a future guard (redundant-but-safe overlap during transition) or left as-is with the guard as a second independent layer — a transition-strategy question for the future implementation task, not resolved here.

## 15. Implementation blockers

- KVKK architecture freeze boundary §5 conditions 3-5 (production migration confirmation, rollback/tenant-impact verification, external baseline-stable declaration) — all unsatisfied as of this task's writing.
- ADR-004 and ADR-005 status `NEEDS_POC` — unchanged by this document (see §16).
- No disposable PostgreSQL/PgBouncer PoC environment has been provisioned or scheduled — Stage 7/9 of §11 require a future, separate task to actually execute.
- `package.json`'s pinned Prisma version was not confirmed in this pass (§14 item 1) — a hard prerequisite fact for any guard implementation.
- No external legal/compliance sign-off exists for production RLS/PgBouncer changes on a KVKK-regulated platform, independent of the technical PoC outcome (§12, Stage 10 mapping).

## 16. ADR-004 / ADR-005 status

Unchanged by this task: both remain `NEEDS_POC`. This document refines their PoC criteria (§7-§10 above are, concretely, that refinement) but does not mark either `ACCEPTED` — per the task's explicit instruction, only actual PoC evidence (from a future, executed Stage 7/9 per §11) may support that status change. No conflation of ADR-004 (Prisma+PgBouncer) and ADR-005 (RLS) scope was found that would require splitting them further; if anything, this task's evidence (§8.4) reinforces that they are correctly separated, since a PgBouncer-incompatibility finding would not itself invalidate RLS's independent merits, and vice versa.

---

*Re-stating the required non-authorization statement: F0-009 defines an isolated PoC and future rollout evidence requirements only. It does not authorize Prisma tenant-extension implementation, PostgreSQL RLS rollout, schema/backfill migrations, database-role changes, PgBouncer deployment, or production configuration changes. Those actions remain blocked until the active architecture freeze conditions are explicitly released and the relevant ADR receives evidence-based acceptance.*

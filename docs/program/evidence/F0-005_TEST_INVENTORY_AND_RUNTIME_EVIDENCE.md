# F0-005 Evidence — Test Inventory, Runtime Measurement, and Ownership Map

Task: F0-005 — Test Inventory, Runtime Measurement, and Ownership Map · Phase: F0 · Scope: repository-only, documentation-only. No test file, package script, schema, migration, CI workflow, or runtime source file was modified **by this task**. (The rebaseline in §1a merges in commit 7fcf2f850f151241266f07349c4bf4442c72bbca from `origin/main`, which itself did change test/schema/migration files as part of already-merged PR #169 — that change was authored and merged independently of this task; this task only inventories and measures its effect.)

This document is the detailed evidence base behind [`TEST_OWNERSHIP.md`](../TEST_OWNERSHIP.md). The structured/machine-readable forms are [`F0-005_test_inventory.json`](F0-005_test_inventory.json) (100 test/verification targets, ownership, F0-004 high-risk edge coverage, coverage gaps, affected-test recommendations) and [`F0-005_test_runtime_results.json`](F0-005_test_runtime_results.json) (every command actually executed, with duration, exit code, and pass/fail counts).

## 1. Methodology and scope

- Original baseline: commit `5ee0b6af30fff187b7190d649f1fc3e844362105` (`origin/main` HEAD at task start — F0-004's PR #170 not yet merged, F0-003 merged). Work was performed in an isolated git worktree (`D:\Mustafa\Siteler\DisKlinikCRM-worktrees\f0-005-test-ownership`, branch `docs/f0-005-test-inventory-runtime-ownership`) checked out from `origin/main`, so the working tree was byte-identical to the committed baseline at that time.
- **Current baseline (rebaselined 2026-07-19): commit `7fcf2f850f151241266f07349c4bf4442c72bbca`.** See §1a.

### 1a. Rebaseline: merge from `origin/main` (2026-07-19)

Before PR #171 (this task's PR) could merge, `origin/main` advanced by one commit: `7fcf2f850f151241266f07349c4bf4442c72bbca` (PR #169, "feat(kvkk): add centralized communication preference and consent management"), merged to `main` after this task's original baseline (`5ee0b6a`) but before this task's PR was reviewed. The F0-005 branch was updated with a normal, non-force `git merge origin/main` (no rebase, no force-push); the merge completed with **zero conflicts** (`ort` strategy, clean auto-merge).

That commit added **3 test files** not present in the original inventory:

| File | Area | Reason added |
|---|---|---|
| `server/src/tests/communicationConsent.test.ts` | Backend | New `.test.ts` file, wired into `server/package.json`'s `test` chain as the 55th of 56 scripts |
| `server/src/tests/communicationPreferenceBackfill.test.ts` | Backend | New `.test.ts` file, wired into the `test` chain as the 56th (last) script |
| `src/components/__tests__/communicationConsentMatrixHelpers.test.ts` | Frontend | New frontend test file, wired into a new `test:communication-consent-matrix` root script |

It also changed `server/prisma/schema.prisma` (+134/−2 lines, one new migration) and `package.json`/`server/package.json` (new script entries only — no lockfile changes, confirmed via `git diff 5ee0b6a 7fcf2f8 --stat -- package-lock.json server/package-lock.json`, empty). It did **not** touch `bridge-agent/` or `windows-bridge/`.

Per this task's own instruction to not silently preserve a stale baseline when a merge changes test/source evidence, this document, both JSON files, `TEST_OWNERSHIP.md`, the tracker, and the phase doc were all updated to a **current, fully re-verified baseline at commit `7fcf2f850f151241266f07349c4bf4442c72bbca`**: the 3 new files were classified and inventoried (§2a), and every runtime command whose inputs could plausibly have changed (Prisma generation, typecheck, build, the full backend test chain, all frontend tests) was re-executed from scratch rather than reused from the original 534b66e run. `bridge-agent/` and `windows-bridge/` commands were **not** re-executed because those directories' inputs were provably untouched by the merge; their original results are carried forward unchanged (see `F0-005_test_runtime_results.json` `rerunAt7fcf2f8` flags for the exact per-command record of what was and wasn't re-run).
- **Ownership reuse, not re-derivation:** F0-003's committed `evidence/F0-003_module_ownership_inventory.json` already assigns 68 of the 70 backend `.test.ts` files to one or more domains via its `domains[].tests[]` field. This task reused those assignments directly as the base and:
  1. Assigned the 2 files absent from F0-003's map (`dataRetentionCleanupJob.test.ts`, `messageTemplatePurpose.test.ts`) from direct file-content evidence.
  2. Where F0-003 listed a test under 2–3 domains (10 files), this task read each file's header comment and imports and chose a single canonical primary owner per the task's "behavior principally protected, not folder location" rule, keeping the remaining domain(s) as secondary. See §3.
  3. Assigned all 5 frontend test files fresh (F0-003's scope was backend + Prisma models only, not frontend test files).
- **Technical classification (test type, DB/Redis/filesystem/network requirement, external-provider mode, env vars, order/timing sensitivity):** produced by 5 parallel read-only agents, each covering 14 of the 70 backend `.test.ts` files, instructed to use `Grep` for signal and avoid dumping full files. Each agent's output was cross-checked against the canonical ownership file list — all 70 files accounted for, zero omissions, zero duplicates.
- **Runtime measurement:** performed live in the isolated worktree (§7–§9), not simulated or inferred.
- **windows-bridge C# tests** are inventoried at **project/script granularity**, not per-`.cs`-file or per-`[Fact]` method, given their volume (~354 `[Fact]`/`[Theory]` attributes across 4 test projects — grep-counted). Treating each of the 4 `dotnet test` projects and each of the 4 installer PowerShell scripts as one "executable test target" is consistent with the task's own allowance for "test file or executable test target" and with how `dotnet test`/CI actually invoke them (per-project, not per-class).
- **Known limitations:**
  1. Two of the ten multi-domain canonical-ownership calls in §3 are judgment calls a reasonable reviewer could contest (recorded in the JSON `unresolved[]`).
  2. windows-bridge C# test runtime could not be measured at all (SDK version mismatch — §8).
  3. DB-backed test runtime (1 `.test.ts` file + 3 manual verify scripts) could not be measured (no committed disposable-DB provisioning — §8).
  4. No coverage percentage tool exists in the repository; no line/branch coverage numbers are reported anywhere in this task's output.

## 2. Baseline test-file counts (cross-checked against F0-003)

| Area | Count | Cross-check |
|---|---|---|
| Backend `server/src/tests/*.test.ts` | 72 (was 70 at original baseline; +2 from PR #169, see §2a) | `find server/src/tests -maxdepth 1 -name "*.test.ts" \| wc -l` = 72 |
| Backend non-test fixture helpers in `server/src/tests/` | 2 (`whatsappConversationFixtures.ts`, `whatsappSafetyFixtures.ts`) | both wired into `npm run test` (`test:fixtures`, `test:safety`) and produce their own PASS/FAIL output |
| **Backend total (F0-003's own count + PR #169's 2 new files)** | **74** | 72 `.test.ts` + 2 fixture helpers |
| Frontend `src/**/__tests__/*.test.ts` | 6 (was 5 at original baseline; +1 from PR #169, see §2a) | `find src -name "*.test.ts*"` = 6; each has exactly one dedicated `npm run test:*` script, zero orphans |
| bridge-agent `bridge-agent/tests/*.test.ts` | 9 | + 1 non-test shared harness (`testHarness.ts`); `npm run test` in `bridge-agent/` chains exactly these 9; unaffected by PR #169 |
| windows-bridge C# test projects | 4 (`NoraMedi.Bridge.Core.Tests`, `.IntegrationTests`, `.Manager.Tests`, `.Service.Tests`) | ~354 `[Fact]`/`[Theory]` attributes total (grep-counted); unaffected by PR #169 |
| windows-bridge installer PowerShell test scripts | 4 (`InstallerTestHelpers`, `StateMachine`, `MigrateLegacyConfigCommand`, `BuildReleaseScript`) | matches the exact 4-script list CI invokes in `.github/workflows/windows-bridge-pr.yml`; unaffected by PR #169 |
| `server/scripts/verify-*.ts` manual disposable-DB lifecycle scripts | 3 | + 1 non-test child-process helper (`_clinicBulkExportCrashChild.ts`) spawned by one of them |
| Repo-level smoke/deploy scripts (`scripts/*.sh`) | 2 | `noramedi-healthcheck.sh` (smoke), `noramedi-deploy.sh` (deployment automation, not a test) |
| Documentation-validation scripts | 0 | confirmed absent — no markdown-link-checker, no doc-linter of any kind found in either `package.json` or `scripts/` |
| **Grand total test/verification targets recorded** | **100** (was 97; +3 from PR #169) | see `F0-005_test_inventory.json` `testFiles[]` |

### 2a. The 3 files added by PR #169's merge — classification

| File | Canonical primary | Secondary | Test type | DB required | Observed result |
|---|---|---|---|---|---|
| `server/src/tests/communicationConsent.test.ts` | **Privacy / Consent / Retention / DSR** | Messaging — WhatsApp, Messaging — SMS | DATABASE_INTEGRATION (+ PRIVACY_KVKK, PROVIDER_ADAPTER secondary) | yes — real Postgres via `DATABASE_URL` | BLOCKED — 4 of 92 assertions pass (the DB-free ones); 88 fail with `ECONNREFUSED` (§9.4) |
| `server/src/tests/communicationPreferenceBackfill.test.ts` | **Privacy / Consent / Retention / DSR** | Patients | DATABASE_INTEGRATION (+ MIGRATION secondary) | yes — real Postgres via `DATABASE_URL` | BLOCKED — crashes in `createFixture()` before any of its 7 named tests run (§9.5) |
| `src/components/__tests__/communicationConsentMatrixHelpers.test.ts` | **Privacy / Consent / Retention / DSR** | none | FRONTEND_UTILITY | none | STABLE_PASS — 13 passed, 0 failed |

Reasoning: all 3 files exist to support KVKK-HIGH-007 (communication preference and consent management) — the same regulatory Privacy/Consent/Retention/DSR domain that already owns `aiPrivacyBoundary.test.ts`, `channelConsentGate.test.ts`, `dataRetentionCleanupJob.test.ts`, and `clinicBulkExportSelectionHelpers.test.ts`. `communicationConsent.test.ts` additionally protects consent-gating logic inside `smsService.ts` and `whatsappOutboundMessaging.ts` (Messaging domains), listed as secondary per this task's "behavior principally protected" rule, exactly as `aiPrivacyBoundary.test.ts` lists Messaging AI Orchestration as secondary. **None of the 3 new files map to any of F0-004's 9 `HIGH_RISK_BOUNDARY_VIOLATION` edges** — those edges are all `Patient`/`Appointment` write paths inside `routes/whatsapp.ts`, `routes/whatsappInbox.ts`, `services/whatsapp/metaWhatsAppAiProcessor.ts`, and `services/instagram/instagramAiConversationProcessor.ts`; the new tests exercise a different file (`whatsappOutboundMessaging.ts`, an outbound consent-gate) not implicated in any of the 9 edges (§7 is otherwise unchanged by this rebaseline).

## 3. Canonical ownership — the 12 non-obvious cases

F0-003 listed 10 backend test files under 2–3 domains without designating a primary. Per this task's ownership rule ("behavior principally protected, not folder location" — the same rule the task instructions illustrate with a messaging/Patient example and a Privacy/Messaging example), this task read each file's header and picked one canonical primary:

| File | F0-003's domain list (order = F0-003's domain-array iteration order, NOT priority) | Canonical primary chosen | Secondary | Reasoning |
|---|---|---|---|---|
| `aiPrivacyBoundary.test.ts` | Privacy + Messaging AI Orchestration | **Privacy / Consent / Retention / DSR** | Messaging AI Orchestration | Tests PII masking/redaction (`maskPhone`, `redactSensitiveText`, `buildSafeAiPatientContext`) — a Privacy concern applied to the AI agent's prompt construction. Matches the task's own worked example almost verbatim. |
| `billingFinancialTreatmentCaseSelect.test.ts` | Tenant Security + Treatment Cases + Advanced Finance | **Tenant Security and Scope** | Treatment Cases, Advanced Finance | Tests role-based field-restriction/authorization for the BILLING role's access to a Treatment-Cases-owned endpoint — an authorization/data-minimization behavior, not treatment-case business logic itself. |
| `billingPatientAccess.test.ts` | Tenant Security + Patients | **Tenant Security and Scope** | Patients | Same reasoning — BILLING role's restricted access to Patient/Payment data. |
| `multiBranchAccess.test.ts` | Organization/Membership + Tenant Security | **Tenant Security and Scope** | Organization / Clinic / User Membership | Directly matches the task's own explicit rule example: "a tenant-isolation test spanning many domains should be Tenant Security, not arbitrarily assigned to the first model referenced." Content is entirely clinic/org access-scoping (`canAccessAllClinics`, `allowedClinicIds`, cross-org denial). |
| `noShowFollowUpParity.test.ts` | Appointments + Recall | **Appointments and Availability** | Automations / Reminders / Follow-up / Recall | Protects a shared "unresolved no-show" query util; no-show is fundamentally an appointment-status concern, consumed by the Recall/follow-up dashboard as a secondary. |
| `publicBookingNoticeEvidence.test.ts` | Privacy + Public Booking | **Privacy / Consent / Retention / DSR** | Public Booking | KVKK-CRIT-001a consent/notice-evidence token validation — a Privacy/KVKK mechanism applied within the Public Booking flow. |
| `scheduleAccess.test.ts` | Organization/Membership + Appointments | **Appointments and Availability** | Organization / Clinic / User Membership | Majority of scenarios are Appointments' own domain logic (working hours, closed days, doctor-availability derivation); role checks are secondary to the availability logic being verified. |
| `staffOnboarding.test.ts` | Identity/Access + Organization/Membership | **Organization / Clinic / User Membership** | Identity and Access | The onboarding *workflow* is Org/Membership's function; `User` is Identity-owned but managed through Org/Membership's routes (F0-003/F0-004 both already document this exact expected overlap). |
| `treatmentCaseClinicScope.test.ts` | Tenant Security + Treatment Cases | **Tenant Security and Scope** | Treatment Cases | Protects a clinic-scope-consistency bug fix (list/detail/procedures endpoints using different scope-resolution logic) — a tenant-scoping behavior. |
| `treatmentPackagePermissions.test.ts` | Permissions/Roles + Treatment Cases | **Permissions / Roles** | Treatment Cases | Pure role-based write-permission gate (OWNER/ORG_ADMIN/CLINIC_MANAGER only), no clinic-scope component — matches F0-003's own domain iteration order here, and is the cleanest example of pure Permissions/Roles behavior in the whole set. |

Two files were absent from F0-003's `tests[]` map entirely and assigned fresh:

| File | Canonical primary | Reasoning |
|---|---|---|
| `dataRetentionCleanupJob.test.ts` | **Privacy / Consent / Retention / DSR** | "Retention" is explicitly named in this domain; the file tests the data-retention cleanup job directly. |
| `messageTemplatePurpose.test.ts` | **Cross-Domain Contract** | `MessageTemplate` is F0-003's own confirmed "Shared Contract/Reference Data" example (used by both WhatsApp's Meta-template binding and SMS's `templateId`). This test's principal behavior is the shared template-purpose selection contract itself, consumed by Automations/Recall (`reminders.ts`) and Messaging-WhatsApp/SMS as secondary. |

All 5 original frontend test files were assigned fresh (out of F0-003's scope): `dicomHelpers.test.ts` → Imaging (Server/Viewer); `onboardingHelpers.test.ts` and `pairingPoller.test.ts` → Imaging (Device Bridge); `bookingWidgetHelpers.test.ts` → Public Booking; `clinicBulkExportSelectionHelpers.test.ts` → Privacy (KVKK-HIGH-004), secondary Platform Administration. The 6th frontend file added by the 2026-07-19 rebaseline, `communicationConsentMatrixHelpers.test.ts`, is also Privacy-owned — see §2a.

## 4. Test-type taxonomy distribution

Backend (72 files, was 70) primary-type distribution (see `testFiles[]` for per-file secondary tags): the large majority (~46) are **UNIT** — pure functions, injected fakes, or hand-reimplemented logic mirrors, not real Prisma/network calls. The rest split across **AUTH_SECURITY** (~10), **PRIVACY_KVKK** (~7), **PROVIDER_ADAPTER** (~7), **APPLICATION_SERVICE** (~4), **TENANT_ISOLATION** (2 primary — many more as secondary tag), **JOB_WORKER** (2), **DATABASE_INTEGRATION** (4 — `securityIncident.test.ts` genuinely, `platformBackup.test.ts` only for its filesystem-touching branches, plus the 2 new PR #169 files `communicationConsent.test.ts` and `communicationPreferenceBackfill.test.ts`, both genuinely DB-backed, see §2a/§9), and **CONTRACT** (1 primary). Frontend (6 files, was 5) are all **FRONTEND_UTILITY** — there is no `FRONTEND_COMPONENT` test anywhere in the repository (see §11). Bridge-agent (9 files) are **BRIDGE_UNIT**/**BRIDGE_INTEGRATION**. windows-bridge is **BRIDGE_UNIT**/**BRIDGE_INTEGRATION** at project granularity. The 3 manual verify scripts are **MIGRATION**/**DATABASE_INTEGRATION**.

## 5. The critical structural finding: no centralized JS/TS test framework or runner exists

No JavaScript/TypeScript test framework (Jest, Mocha, Vitest) and no centralized test runner exists anywhere in the backend, frontend, or bridge-agent code. Every single `.test.ts` file in those three areas uses the **same hand-rolled convention instead**: `node:assert/strict` plus a locally-defined `async function test(name, fn)` helper that increments module-level `passed`/`failed` counters, prints `OK <name>` / `PASS`/`✓` or `FAIL`/`✗`, and ends with `if (failed > 0) process.exit(1)`. Every such file is executed directly via `tsx <path>`, one process per file — there is no shared test-runner binary invoking them, only `package.json` scripts that shell out to `tsx` per file (or chain several such invocations with `&&`).

This is **not true of the whole repository**: the 4 `windows-bridge` C# test projects (`NoraMedi.Bridge.Core.Tests`, `.IntegrationTests`, `.Manager.Tests`, `.Service.Tests`) use **xUnit**, a real .NET test framework, invoked via the standard `dotnet test` runner — see §8 for why their execution was blocked in this environment (a pinned `.NET 10.0.301` SDK requirement, only `9.0.305` installed), not because they lack a framework.

Stated precisely, then: **no JavaScript/TypeScript test framework or centralized JS/TS runner exists** — JS/TS tests use hand-rolled `node:assert` helpers and per-file `tsx` execution, exactly as described above. Windows Bridge is the one part of the repository with real, framework-based test projects, and this task's only finding there is that their execution was blocked by an environment SDK-version mismatch, not that they are absent or hand-rolled. This has concrete consequences for the JS/TS side, documented throughout this evidence doc:

- No test discovery — every test target must be individually wired into a `package.json` script, and 6+6 backend files below prove that step is fallible (§6).
- No shared setup/teardown, no fixtures library, no snapshot testing, no coverage instrumentation.
- No parallelization within a file's `test()` calls — `await test(...)` calls run strictly sequentially, which is why the 2–3 explicitly order-sensitive files (`passwordReset.test.ts`, `messageSafetyHardening.test.ts`) rely on that sequencing for correct `process.env` save/restore.

## 6. Command-map findings: orphans, gaps, and misleading names

- **`npm run test` (server) chains 56 of 62 `test:*` scripts** (was 54 of 60 at the original baseline; PR #169 added 2 scripts, both appended to the chain — `test:communication-consent`, `test:communication-consent-backfill`). The same 6 scripts as before are **never called** from the chain: `test:consent-resume`, `test:meta-template`, `test:outbound`, `test:no-show-follow-up-parity`, `test:overdue-installments`, `test:overdue-receivables`. One of these (`test:overdue-installments`) has a genuine, reproducible 2-assertion regression — see §9.
- **6 backend `.test.ts` files have no `package.json` script at all:** `aiPrivacyBoundary.test.ts`, `channelConsentGate.test.ts`, `clinicLegalProfile.test.ts`, `patientSharedPhone.test.ts`, `platformBackup.test.ts`, `treatmentPackagePermissions.test.ts`. They are only reachable via a direct `npx tsx src/tests/<file>.test.ts` invocation. All 6 pass cleanly when run this way (177 assertions, 0 failures) — this is a wiring gap, not a quality gap.
- **`npm run test` (server) itself requires an undocumented prerequisite:** it fails immediately (`SyntaxError: The requested module '@prisma/client' does not provide an export named 'PrismaClient'`) unless `npx prisma generate` has already run. `npm run typecheck` includes this step; `npm run test` does not.
- **Root `npm run build`** is misleadingly named for typecheck purposes — it is `tsc -b && vite build`, i.e. a real production bundle build, not a lightweight typecheck. It is currently the *only* frontend static-check script available.
- **`bridge-agent/package.json:test`** is a complete, working 9-file chain but is never invoked by any CI workflow (confirmed — `bridge-agent/` does not appear in either `.github/workflows/*.yml` file).
- **Exactly one CI workflow runs any tests at all** — see §11.

## 7. F0-004 high-risk boundary-violation edge coverage (all 9)

See `F0-005_test_inventory.json` `highRiskEdgeCoverage[]` for the full evidence-cited table (edge ID, file:line, classification, evidence, missing behavior). Summary: **8 of 9 edges are NOT_COVERED; 1 (Instagram→Patients, F0004-E0608) is PARTIALLY_COVERED** via a test that exercises a hand-reimplemented "fake DB" mirror of the dedup logic, not the real Prisma call site. Three separate test files' own header comments **explicitly self-document** that they deliberately do not exercise the real Prisma-backed write paths for these edges (`whatsappIdentityAndPostBooking.test.ts`, `instagramAssistantParity.test.ts`, and implicitly `whatsappInbox.test.ts` by never importing the route it is named after).

The single most consequential gap: **`routes/whatsappInbox.ts:757`'s missing `pg_advisory_xact_lock` guard (F0004-E0684, F0-004's own "most severe" finding) has zero test coverage of the double-booking race condition it creates.** `whatsappInbox.test.ts` exists (25 test cases) but per its own docstring only covers `utils/roles.ts` permission checks and a locally-reimplemented `getPhoneVariants` — it never imports the actual route handler. `appointmentRequestOverlapSafety.test.ts` (31 thorough test cases) tests the *safe* pattern in a completely different file (`appointmentRequestSafety.ts`, used by `publicBooking.ts`), not this one.

This table is unchanged by the 2026-07-19 rebaseline: none of the 3 files added by PR #169 touch any of these 9 edges (see §2a for the file-by-file check).

## 8. Runtime execution — what ran, what didn't, and why

Full detail (exact commands, working directories, durations, exit codes) is in `F0-005_test_runtime_results.json`, including the `rerunAt7fcf2f8` flag on every entry recording exactly what this rebaseline re-executed versus carried forward unchanged. Summary (as of the 2026-07-19 rebaseline at commit `7fcf2f850f151241266f07349c4bf4442c72bbca`):

| Area | Result |
|---|---|
| `server/` `npm ci` | not re-run — lockfile untouched by the merge; original result (clean, 25s) carried forward |
| `npx prisma generate` | re-run (schema changed) — clean, 3s — **required before any test can run**, not automatic |
| `server/` `npm run typecheck` | re-run — clean, 0 errors, 49s |
| repo-root `npm ci` | not re-run — lockfile untouched by the merge; original result (clean, 23s) carried forward |
| repo-root `npm run build` | re-run — clean, 0 errors, 71s |
| `bridge-agent/` `npm ci` + `npm run test` | not re-run — `bridge-agent/` untouched by the merge; original result (clean, 9s, 105/105 passed) carried forward |
| `server/` `npm run test` (full 56-script chain, was 54) | re-run — **2481/2482 passed, 1 failed**, 115s — chain still stops at the same failure (`test:clinic-bulk-export`, script 53); scripts 54-56 (`test:security-incidents`, `test:communication-consent`, `test:communication-consent-backfill`) never run this invocation |
| `server/` `test:communication-consent` (individual, new) | **BLOCKED** — 4/92 passed, 88 failed (`ECONNREFUSED`) — §9.4 |
| `server/` `test:communication-consent-backfill` (individual, new) | **BLOCKED** — crashes before any of 7 named tests run (`ECONNREFUSED`) — §9.5 |
| 6 orphan `test:*` scripts (run individually) | re-run — **101/103 passed, 2 failed** in `test:overdue-installments`, identical to original |
| 6 no-script files (run via direct `tsx`) | re-run — 177/177 passed, identical to original |
| 6 frontend test scripts (was 5; +`test:communication-consent-matrix`) | re-run — 128/128 passed (115 original + 13 new) |
| `windows-bridge` `dotnet test` | not re-run — `windows-bridge/` untouched by the merge; original BLOCKED result (SDK version mismatch, 10.0.301 required, 9.0.305 installed) carried forward |
| 4 windows-bridge installer PowerShell scripts | not re-run — `windows-bridge/` untouched by the merge; original result (58/58 passed) carried forward |
| `securityIncident.test.ts` + 3 manual verify scripts | re-run — **BLOCKED**, identical to original — no committed disposable-Postgres provisioning |

**On the decision not to stand up a disposable Postgres via Docker:** Docker CLI (29.6.1) is present on this machine but its daemon is not running (`docker ps` fails with `dockerDesktopLinuxEngine` pipe not found), and no committed `docker-compose.yml` or equivalent automation exists in the repository. The repository's own `verify-*.ts` scripts document the convention "point `DATABASE_URL` at a throwaway db you provision yourself," but that remains a manual, uncommitted convention. Per this task's explicit instruction — "if a safe disposable database cannot be established from committed repository instructions: do not improvise destructive setup; classify DB-dependent runtime measurement as BLOCKED" — this task did not stand up an ad-hoc container, for the original baseline or for this rebaseline. This now affects 3 of 72 backend `.test.ts` files (`securityIncident.test.ts`, and, newly, `communicationConsent.test.ts` and `communicationPreferenceBackfill.test.ts` — see §2a) plus 3 manual verify scripts that were never wired into any runner in the first place; the technical classification pass (§1) had already independently determined that the large majority of backend test files use injected fakes/mocks rather than a real database connection, so this decision's actual coverage impact remains small and precisely bounded, if slightly larger than at the original baseline.

## 9. Failures found — captured, not fixed

This task's runtime measurement found exactly **2 reproducible test failures**, plus **3 environment blockers** that prevent 3 test files from running to completion at all. Precise terminology, since these are not interchangeable:

- **1 deterministic source-drift test failure**: `overdueInstallments.test.ts` (§9.2) — the test ran to completion and its assertions are wrong relative to current production code; this is a genuine, reproducible defect in the *test*, exposing that the *production* behavior changed underneath it undetected.
- **1 environment-sensitive line-ending failure**: `clinicBulkExport.test.ts` (§9.1) — the test ran to completion and failed only because of a Windows CRLF checkout interacting with a literal-`\n` string match; the underlying product behavior it protects is confirmed correct.
- **3 environment blockers** (not failures in the above sense — the tests cannot run to completion at all in this environment): `securityIncident.test.ts` (§9.3, original baseline), `communicationConsent.test.ts` (§9.4, new — 2026-07-19 rebaseline), `communicationPreferenceBackfill.test.ts` (§9.5, new — 2026-07-19 rebaseline). All 3 require a reachable `DATABASE_URL` that does not exist in this environment (no committed disposable-Postgres provisioning — §8).

**0 confirmed product-runtime defects were established by this documentation task.** The one deterministic failure (§9.2) is a test/production drift, not a runtime defect independently confirmed in a live environment; the one environment-sensitive failure (§9.1) is confirmed NOT to indicate a product defect; and the 3 blockers report no pass/fail verdict on product behavior at all. Per task instructions, nothing was fixed, weakened, or skipped to make any of these 5 items go away.

### 9.1 `clinicBulkExport.test.ts` — "status DTO never serializes sensitive fields" (STABLE_FAIL, reproduced 2×, environment-sensitive)

- **Command:** `npm run test:clinic-bulk-export` (server/)
- **Failing assertion:** `assert.ok(dtoBlockStart > -1, 'expected the explicit status DTO block to be present')` at `server/src/tests/clinicBulkExport.test.ts:385`.
- **Root cause (confirmed via byte-level inspection):** the test does `source.indexOf('res.json({\n      jobId: row.id,')` — an exact substring match containing a **literal `\n`**. This repository checks out with `core.autocrlf=true` (confirmed: `git config --get core.autocrlf` → `true`) and `server/src/routes/clinicBulkExport.ts` is a CRLF (`\r\n`) file on disk on this Windows machine (confirmed via `file`/`xxd`). The exact source block exists at `routes/clinicBulkExport.ts:264–272` and is functionally correct (the DTO genuinely never serializes `restrictedNote`/`storageKey`/`downloadTokenHash`/`manifestJson`/`cleanupFailureCode`) — the test's own **line-ending-sensitive string match** is what fails, not the underlying behavior it protects.
- **Category:** environment/platform sensitivity (line-ending), not a deterministic assertion failure of the product behavior under test.
- **Repeatability:** STABLE_FAIL — reproduced identically on a second run (`116 passed, 1 failed` both times).
- **Not fixed** — flagged here as evidence only.

### 9.2 `overdueInstallments.test.ts` — 2 genuine deterministic failures (STABLE_FAIL, reproduced 2×, real source drift)

- **Command:** `npm run test:overdue-installments` (server/) — **one of the 6 scripts never called by `npm run test`'s full chain** (§6).
- **Failing assertions:**
  1. `"status her zaman pending — literal \"overdue\" durumu asla yazılmaz"` expects `overdueInstallmentWhere()`'s `status` filter to equal the literal string `'pending'`; the actual current value is `{ in: ['pending', 'overdue'] }`.
  2. `"literal status=\"overdue\" (hiç yazılmayan değer) — pending olmadığı için false döner"` expects `isInstallmentOverdue({ status: 'overdue', ... })` to return `false`; the actual current return value is `true`.
- **Root cause:** the production code (`server/src/utils/overdueInstallments.ts`) has genuinely changed to support a literal `'overdue'` payment-installment status value. This orphaned test still encodes the **old** invariant ("a literal `'overdue'` status is never written and must be treated as not-overdue") and was never updated to match — because it is never run by `npm run test` or any CI workflow, nobody was ever notified of the drift.
- **Category:** deterministic assertion failure — genuine behavioral drift between an unreachable test and its production code, not an environment issue.
- **Repeatability:** STABLE_FAIL — reproduced identically on a second run (`9 total, 7 passed, 2 failed` both times, same two named assertions).
- **Not fixed, not weakened** — flagged here as evidence only. This is presented as direct, concrete proof of the CI-enforcement gap documented in §11: an orphaned test is not a theoretical risk in this repository, it is already carrying an undetected real regression.

### 9.3 `securityIncident.test.ts` — environment blocker, not a code defect

- **Command:** `npm run test:security-incidents` (server/)
- **First 8 assertions pass** (pure sanitization/hashing logic, no DB). **All subsequent assertions fail** with `Invalid \`prisma.platformAdmin.create()\` invocation` — no reachable `DATABASE_URL`.
- **Category:** environment/missing-service blocker (see §8). Not counted as a code defect.

### 9.4 `communicationConsent.test.ts` — environment blocker, not a code defect (new — 2026-07-19 rebaseline)

- **Command:** `npm run test:communication-consent` (server/)
- **4 of 92 assertions pass** (test #15, disabled-mode — explicitly never touches the DB; tests #29-31, evidence-sanitization — pure string logic). **The remaining 88 assertions fail** with `Invalid \`prisma.organization.create()\` invocation ... ECONNREFUSED` — no reachable `DATABASE_URL`, identical root cause to §9.3.
- **Category:** environment/missing-service blocker (see §8). Not counted as a code defect. This file was added by PR #169 (commit `7fcf2f850f151241266f07349c4bf4442c72bbca`), merged into `origin/main` after this task's original baseline; it did not exist to be measured at the original baseline commit.
- **Repeatability:** reproduced — identical result on every attempt in this environment.

### 9.5 `communicationPreferenceBackfill.test.ts` — environment blocker, not a code defect (new — 2026-07-19 rebaseline)

- **Command:** `npm run test:communication-consent-backfill` (server/)
- **Crashes before any of its 7 named tests run.** Unlike §9.3/§9.4, this file's `createFixture()` call sits directly in `main()`, outside any `test()` wrapper, so the `ECONNREFUSED` from `prisma.organization.create()` is an uncaught rejection that aborts the whole process (exit code 1) before a single pass/fail line is printed.
- **Category:** environment/missing-service blocker (see §8). Not counted as a code defect. Same PR #169 origin as §9.4.
- **Repeatability:** reproduced — identical crash on every attempt in this environment.

## 10. Repeatability summary

| Suite | Classification |
|---|---|
| 52 of 53 scripts in the main `npm run test` chain | STABLE_PASS (re-run at the 2026-07-19 rebaseline; not repeated a 2nd time within this rebaseline since they passed) |
| `test:clinic-bulk-export` | STABLE_FAIL — reproduced identically at both the original baseline (2×) and this rebaseline |
| `test:overdue-installments` | STABLE_FAIL — reproduced identically at both the original baseline (2×) and this rebaseline |
| `test:security-incidents` | BLOCKED — reproduced identically at both the original baseline (2×) and this rebaseline (same DB-connection failure every time) |
| `test:communication-consent` (new) | BLOCKED — reproduced (same 4 passed/88 failed `ECONNREFUSED` result on every attempt in this environment) |
| `test:communication-consent-backfill` (new) | BLOCKED — reproduced (same crash-before-any-test-runs result on every attempt in this environment) |
| Remaining 5 orphan scripts + 6 no-script files + 6 frontend scripts + bridge-agent (not re-run) + 4 installer PowerShell scripts (not re-run) | STABLE_PASS on single run each within this rebaseline; not repeated (all passed cleanly, no timing/order sensitivity flagged by the classification pass) |
| windows-bridge `dotnet test` | BLOCKED before any test executed (SDK mismatch) — not re-run at this rebaseline (inputs untouched); not a repeatability question |

No test in this baseline was found to be NONDETERMINISTIC (flaky) across the runs performed in this task, including the 2026-07-19 rebaseline re-runs.

## 11. CI enforcement — the central coverage-gap finding

**Exactly one** GitHub Actions workflow in the repository executes any test at all: [`.github/workflows/windows-bridge-pr.yml`](../../../.github/workflows/windows-bridge-pr.yml). It triggers only on PRs touching `windows-bridge/**`, `server/src/services/imaging/**`, `server/src/routes/imaging*.ts`, `server/src/tests/imaging*.ts`, or `src/components/imaging/**`. Within that scope it runs: `test:imaging`, `test:imaging-bridge-pairing`, `test:imaging-bridge-onboarding`, `test:imaging-bridge-update` (4 of 72 backend files), `test:dicom-helpers`, `test:onboarding-helpers`, `test:pairing-poller` (3 of 6 frontend files — **not** `test:booking-widget-helpers`, `test:clinic-bulk-export-selection`, or the new `test:communication-consent-matrix`), the 4 `dotnet test` projects, and the 4 installer PowerShell scripts, plus root `npm run build` and server `npm run typecheck`. This workflow's path triggers do not include any of the 3 files added by PR #169, so none of them gained CI coverage as a side effect of that merge.

[`.github/workflows/windows-bridge-release.yml`](../../../.github/workflows/windows-bridge-release.yml) is a manual, `workflow_dispatch`-only production release/signing pipeline — it runs no tests.

**Consequence, stated precisely:** 68 of 72 backend `.test.ts` files (was 66 of 70), 3 of 6 frontend test files (was 2 of 5), and all 9 bridge-agent test files have **zero CI enforcement**. `npm run test` (the full 56-script backend chain) is never invoked by any workflow, on any trigger. Section 9.2's finding — a real, silent 2-assertion regression sitting in an orphaned, CI-unreachable test — is direct proof this gap is not theoretical; the 2 new backend files and 1 new frontend file added by PR #169 arrived with zero CI enforcement from day one, the same gap this section already documents.

## 12. Frontend and bridge coverage shape

No React Testing Library, DOM harness, or component-rendering test infrastructure exists anywhere in the repository (confirmed by explicit, repeated statements in all 6 frontend test files' own header comments, including the new `communicationConsentMatrixHelpers.test.ts`). All 6 are `FRONTEND_UTILITY` tests of pure extracted functions. There is **zero `FRONTEND_COMPONENT` coverage**. Per F0-003's inventory (~64 frontend pages), 6 have any test coverage at all (was 5).

bridge-agent (9 Node/TS tests, 105 assertions, all passing, all uninvoked by CI) and windows-bridge (4 .NET projects + 4 PowerShell scripts, CI-invoked only on the imaging path) together represent the repository's only device/bridge-layer test coverage, unaffected by the 2026-07-19 rebaseline; see §8 for what could and could not be executed in this task.

## 13. No load/chaos testing

Confirmed absent — no k6, Artillery, Locust, or any chaos-engineering/fault-injection tooling exists in either `package.json`, `bridge-agent/package.json`, or the repository's dependency tree. Unaffected by the 2026-07-19 rebaseline.

## 14. What this task did not do

Per its non-goals: no test file was modified, no snapshot was updated, no assertion was loosened, no skip was added, no timeout was changed, no package script was added or changed, no CI workflow was modified, no testing framework or coverage tool was installed, no runtime source was refactored, no import was altered, no Prisma schema/migration was touched or deployed **by this task**, no production/VPS service was used or contacted, no affected-test-detection mechanism was implemented, no module manifest was created, no eslint boundary was added. The 2026-07-19 rebaseline (§1a) added exactly one normal, non-force `git merge origin/main` to the branch and updated this task's own documentation/JSON evidence files to match the merged tree — it did not author, edit, or revert any of the test/schema/migration/package-script changes that arrived via that merge; those were authored and already merged independently as PR #169.

# F0-005 Evidence — Test Inventory, Runtime Measurement, and Ownership Map

Task: F0-005 — Test Inventory, Runtime Measurement, and Ownership Map · Phase: F0 · Scope: repository-only, documentation-only. No test file, package script, schema, migration, CI workflow, or runtime source file was modified.

This document is the detailed evidence base behind [`TEST_OWNERSHIP.md`](../TEST_OWNERSHIP.md). The structured/machine-readable forms are [`F0-005_test_inventory.json`](F0-005_test_inventory.json) (97 test/verification targets, ownership, F0-004 high-risk edge coverage, coverage gaps, affected-test recommendations) and [`F0-005_test_runtime_results.json`](F0-005_test_runtime_results.json) (every command actually executed, with duration, exit code, and pass/fail counts).

## 1. Methodology and scope

- Baseline: commit `5ee0b6af30fff187b7190d649f1fc3e844362105` (`origin/main` HEAD at task start — F0-004's PR #170 not yet merged, F0-003 merged). Work was performed in an isolated git worktree (`D:\Mustafa\Siteler\DisKlinikCRM-worktrees\f0-005-test-ownership`, branch `docs/f0-005-test-inventory-runtime-ownership`) checked out from `origin/main`, so the working tree is byte-identical to the committed baseline.
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
| Backend `server/src/tests/*.test.ts` | 70 | `find server/src/tests -maxdepth 1 -name "*.test.ts" \| wc -l` = 70 |
| Backend non-test fixture helpers in `server/src/tests/` | 2 (`whatsappConversationFixtures.ts`, `whatsappSafetyFixtures.ts`) | both wired into `npm run test` (`test:fixtures`, `test:safety`) and produce their own PASS/FAIL output |
| **Backend total (F0-003's own count)** | **72** | matches F0-003's committed "72/72 test dosyası eşlendi" exactly |
| Frontend `src/**/__tests__/*.test.ts` | 5 | `find src -name "*.test.ts*"` = 5; each has exactly one dedicated `npm run test:*` script, zero orphans |
| bridge-agent `bridge-agent/tests/*.test.ts` | 9 | + 1 non-test shared harness (`testHarness.ts`); `npm run test` in `bridge-agent/` chains exactly these 9 |
| windows-bridge C# test projects | 4 (`NoraMedi.Bridge.Core.Tests`, `.IntegrationTests`, `.Manager.Tests`, `.Service.Tests`) | ~354 `[Fact]`/`[Theory]` attributes total (grep-counted) |
| windows-bridge installer PowerShell test scripts | 4 (`InstallerTestHelpers`, `StateMachine`, `MigrateLegacyConfigCommand`, `BuildReleaseScript`) | matches the exact 4-script list CI invokes in `.github/workflows/windows-bridge-pr.yml` |
| `server/scripts/verify-*.ts` manual disposable-DB lifecycle scripts | 3 | + 1 non-test child-process helper (`_clinicBulkExportCrashChild.ts`) spawned by one of them |
| Repo-level smoke/deploy scripts (`scripts/*.sh`) | 2 | `noramedi-healthcheck.sh` (smoke), `noramedi-deploy.sh` (deployment automation, not a test) |
| Documentation-validation scripts | 0 | confirmed absent — no markdown-link-checker, no doc-linter of any kind found in either `package.json` or `scripts/` |
| **Grand total test/verification targets recorded** | **97** | see `F0-005_test_inventory.json` `testFiles[]` |

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

All 5 frontend test files were assigned fresh (out of F0-003's scope): `dicomHelpers.test.ts` → Imaging (Server/Viewer); `onboardingHelpers.test.ts` and `pairingPoller.test.ts` → Imaging (Device Bridge); `bookingWidgetHelpers.test.ts` → Public Booking; `clinicBulkExportSelectionHelpers.test.ts` → Privacy (KVKK-HIGH-004), secondary Platform Administration.

## 4. Test-type taxonomy distribution

Backend (70 files) primary-type distribution (see `testFiles[]` for per-file secondary tags): the large majority (~46) are **UNIT** — pure functions, injected fakes, or hand-reimplemented logic mirrors, not real Prisma/network calls. The rest split across **AUTH_SECURITY** (~10), **PRIVACY_KVKK** (~7), **PROVIDER_ADAPTER** (~7), **APPLICATION_SERVICE** (~4), **TENANT_ISOLATION** (2 primary — many more as secondary tag), **JOB_WORKER** (2), **DATABASE_INTEGRATION** (2 — `securityIncident.test.ts` genuinely, `platformBackup.test.ts` only for its filesystem-touching branches), and **CONTRACT** (1 primary). Frontend (5 files) are all **FRONTEND_UTILITY** — there is no `FRONTEND_COMPONENT` test anywhere in the repository (see §11). Bridge-agent (9 files) are **BRIDGE_UNIT**/**BRIDGE_INTEGRATION**. windows-bridge is **BRIDGE_UNIT**/**BRIDGE_INTEGRATION** at project granularity. The 3 manual verify scripts are **MIGRATION**/**DATABASE_INTEGRATION**.

## 5. The critical structural finding: no test framework exists

Every single `.test.ts` file in this repository — backend, frontend, and bridge-agent alike — uses the **same hand-rolled convention**: `node:assert/strict` plus a locally-defined `async function test(name, fn)` helper that increments module-level `passed`/`failed` counters, prints `OK <name>` / `PASS`/`✓` or `FAIL`/`✗`, and ends with `if (failed > 0) process.exit(1)`. There is **no Jest, Mocha, Vitest, or Pester** (except the 4 windows-bridge C# xUnit projects, which are a real framework). Every file is executed directly via `tsx <path>`, one process per file. This has concrete consequences documented throughout this evidence doc:

- No test discovery — every test target must be individually wired into a `package.json` script, and 6+6 backend files below prove that step is fallible (§6).
- No shared setup/teardown, no fixtures library, no snapshot testing, no coverage instrumentation.
- No parallelization within a file's `test()` calls — `await test(...)` calls run strictly sequentially, which is why the 2–3 explicitly order-sensitive files (`passwordReset.test.ts`, `messageSafetyHardening.test.ts`) rely on that sequencing for correct `process.env` save/restore.

## 6. Command-map findings: orphans, gaps, and misleading names

- **`npm run test` (server) chains 54 of 60 `test:*` scripts.** 6 scripts exist in `server/package.json` but are **never called** from the chain: `test:consent-resume`, `test:meta-template`, `test:outbound`, `test:no-show-follow-up-parity`, `test:overdue-installments`, `test:overdue-receivables`. One of these (`test:overdue-installments`) has a genuine, reproducible 2-assertion regression — see §9.
- **6 backend `.test.ts` files have no `package.json` script at all:** `aiPrivacyBoundary.test.ts`, `channelConsentGate.test.ts`, `clinicLegalProfile.test.ts`, `patientSharedPhone.test.ts`, `platformBackup.test.ts`, `treatmentPackagePermissions.test.ts`. They are only reachable via a direct `npx tsx src/tests/<file>.test.ts` invocation. All 6 pass cleanly when run this way (177 assertions, 0 failures) — this is a wiring gap, not a quality gap.
- **`npm run test` (server) itself requires an undocumented prerequisite:** it fails immediately (`SyntaxError: The requested module '@prisma/client' does not provide an export named 'PrismaClient'`) unless `npx prisma generate` has already run. `npm run typecheck` includes this step; `npm run test` does not.
- **Root `npm run build`** is misleadingly named for typecheck purposes — it is `tsc -b && vite build`, i.e. a real production bundle build, not a lightweight typecheck. It is currently the *only* frontend static-check script available.
- **`bridge-agent/package.json:test`** is a complete, working 9-file chain but is never invoked by any CI workflow (confirmed — `bridge-agent/` does not appear in either `.github/workflows/*.yml` file).
- **Exactly one CI workflow runs any tests at all** — see §11.

## 7. F0-004 high-risk boundary-violation edge coverage (all 9)

See `F0-005_test_inventory.json` `highRiskEdgeCoverage[]` for the full evidence-cited table (edge ID, file:line, classification, evidence, missing behavior). Summary: **8 of 9 edges are NOT_COVERED; 1 (Instagram→Patients, F0004-E0608) is PARTIALLY_COVERED** via a test that exercises a hand-reimplemented "fake DB" mirror of the dedup logic, not the real Prisma call site. Three separate test files' own header comments **explicitly self-document** that they deliberately do not exercise the real Prisma-backed write paths for these edges (`whatsappIdentityAndPostBooking.test.ts`, `instagramAssistantParity.test.ts`, and implicitly `whatsappInbox.test.ts` by never importing the route it is named after).

The single most consequential gap: **`routes/whatsappInbox.ts:757`'s missing `pg_advisory_xact_lock` guard (F0004-E0684, F0-004's own "most severe" finding) has zero test coverage of the double-booking race condition it creates.** `whatsappInbox.test.ts` exists (25 test cases) but per its own docstring only covers `utils/roles.ts` permission checks and a locally-reimplemented `getPhoneVariants` — it never imports the actual route handler. `appointmentRequestOverlapSafety.test.ts` (31 thorough test cases) tests the *safe* pattern in a completely different file (`appointmentRequestSafety.ts`, used by `publicBooking.ts`), not this one.

## 8. Runtime execution — what ran, what didn't, and why

Full detail (exact commands, working directories, durations, exit codes) is in `F0-005_test_runtime_results.json`. Summary:

| Area | Result |
|---|---|
| `server/` `npm ci` | clean, 25s |
| `npx prisma generate` | clean, 11s — **required before any test can run**, not automatic |
| `server/` `npm run typecheck` | clean, 0 errors, 45s |
| repo-root `npm ci` | clean, 23s (2 pre-existing `npm audit` vulnerabilities observed, not remediated — out of scope) |
| repo-root `npm run build` | clean, 0 errors, 54s |
| `bridge-agent/` `npm ci` + `npm run test` | clean, 9s, 105/105 passed |
| `server/` `npm run test` (full 54-script chain) | **2481/2482 passed, 1 failed**, 107s — chain stopped at the failure (`test:security-incidents`, the 54th script, never ran this invocation) |
| 6 orphan `test:*` scripts (run individually) | **101/103 passed, 2 failed** in `test:overdue-installments` |
| 6 no-script files (run via direct `tsx`) | 177/177 passed |
| 5 frontend test scripts | 115/115 passed |
| `windows-bridge` `dotnet test` | **BLOCKED** — SDK version mismatch (10.0.301 required, 9.0.305 installed) |
| 4 windows-bridge installer PowerShell scripts | 58/58 passed (Windows PowerShell 5.1, not the `pwsh` 7 CI declares) |
| `securityIncident.test.ts` + 3 manual verify scripts | **BLOCKED** — no committed disposable-Postgres provisioning |

**On the decision not to stand up a disposable Postgres via Docker:** Docker CLI (29.6.1) is present on this machine. The repository's own `verify-*.ts` scripts document the convention "point `DATABASE_URL` at a throwaway db you provision yourself," but no committed `docker-compose.yml` or equivalent automation exists to do so. Per this task's explicit instruction — "if a safe disposable database cannot be established from committed repository instructions: do not improvise destructive setup; classify DB-dependent runtime measurement as BLOCKED" — this task did not stand up an ad-hoc container. This affected only 1 of 70 backend `.test.ts` files (`securityIncident.test.ts`) plus 3 manual verify scripts that were never wired into any runner in the first place; the technical classification pass (§1) had already independently determined that 69 of 70 backend test files use injected fakes/mocks rather than a real database connection, so this decision's actual coverage impact was small and precisely bounded.

## 9. Failures found — captured, not fixed

Two genuine, reproducible failures were found; a third apparent failure (`securityIncident.test.ts`) is an environment blocker, not a code defect. Per task instructions, none was fixed.

### 9.1 `clinicBulkExport.test.ts` — "status DTO never serializes sensitive fields" (STABLE_FAIL, reproduced 2×, environment-caused)

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

## 10. Repeatability summary

| Suite | Classification |
|---|---|
| 52 of 53 scripts in the main `npm run test` chain | STABLE_PASS (single run; not repeated a 2nd time per the task's 2-full-suite-run cap, since they passed) |
| `test:clinic-bulk-export` | STABLE_FAIL — reproduced 2× |
| `test:overdue-installments` | STABLE_FAIL — reproduced 2× |
| `test:security-incidents` | BLOCKED — reproduced 2× (same DB-connection failure both times) |
| Remaining 5 orphan scripts + 6 no-script files + 5 frontend scripts + bridge-agent + 4 installer PowerShell scripts | STABLE_PASS on single run each; not repeated (all passed cleanly, no timing/order sensitivity flagged by the classification pass) |
| windows-bridge `dotnet test` | BLOCKED before any test executed (SDK mismatch) — not a repeatability question |

No test in this baseline was found to be NONDETERMINISTIC (flaky) across the runs performed in this task.

## 11. CI enforcement — the central coverage-gap finding

**Exactly one** GitHub Actions workflow in the repository executes any test at all: [`.github/workflows/windows-bridge-pr.yml`](../../../.github/workflows/windows-bridge-pr.yml). It triggers only on PRs touching `windows-bridge/**`, `server/src/services/imaging/**`, `server/src/routes/imaging*.ts`, `server/src/tests/imaging*.ts`, or `src/components/imaging/**`. Within that scope it runs: `test:imaging`, `test:imaging-bridge-pairing`, `test:imaging-bridge-onboarding`, `test:imaging-bridge-update` (4 of 70 backend files), `test:dicom-helpers`, `test:onboarding-helpers`, `test:pairing-poller` (3 of 5 frontend files — **not** `test:booking-widget-helpers` or `test:clinic-bulk-export-selection`), the 4 `dotnet test` projects, and the 4 installer PowerShell scripts, plus root `npm run build` and server `npm run typecheck`.

[`.github/workflows/windows-bridge-release.yml`](../../../.github/workflows/windows-bridge-release.yml) is a manual, `workflow_dispatch`-only production release/signing pipeline — it runs no tests.

**Consequence, stated precisely:** 66 of 70 backend `.test.ts` files, 2 of 5 frontend test files, and all 9 bridge-agent test files have **zero CI enforcement**. `npm run test` (the full 54-script backend chain) is never invoked by any workflow, on any trigger. Section 9.2's finding — a real, silent 2-assertion regression sitting in an orphaned, CI-unreachable test — is direct proof this gap is not theoretical.

## 12. Frontend and bridge coverage shape

No React Testing Library, DOM harness, or component-rendering test infrastructure exists anywhere in the repository (confirmed by explicit, repeated statements in all 5 frontend test files' own header comments). All 5 are `FRONTEND_UTILITY` tests of pure extracted functions. There is **zero `FRONTEND_COMPONENT` coverage**. Per F0-003's inventory (~64 frontend pages), 5 have any test coverage at all.

bridge-agent (9 Node/TS tests, 105 assertions, all passing, all uninvoked by CI) and windows-bridge (4 .NET projects + 4 PowerShell scripts, CI-invoked only on the imaging path) together represent the repository's only device/bridge-layer test coverage; see §8 for what could and could not be executed in this task.

## 13. No load/chaos testing

Confirmed absent — no k6, Artillery, Locust, or any chaos-engineering/fault-injection tooling exists in either `package.json`, `bridge-agent/package.json`, or the repository's dependency tree.

## 14. What this task did not do

Per its non-goals: no test file was modified, no snapshot was updated, no assertion was loosened, no skip was added, no timeout was changed, no package script was added or changed, no CI workflow was modified, no testing framework or coverage tool was installed, no runtime source was refactored, no import was altered, no Prisma schema/migration was touched or deployed, no production/VPS service was used or contacted, no affected-test-detection mechanism was implemented, no module manifest was created, no eslint boundary was added.

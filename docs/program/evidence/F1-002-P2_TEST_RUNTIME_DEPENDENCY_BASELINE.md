# F1-002-P2 — Test Runtime Dependency and Disposable Environment Baseline

**Task ID:** F1-002-P2 · **Parent:** F1-002 (Test Inventory Refresh and Ownership Reconciliation) · **Phase:** F1 — CI and Test Architecture
**Task type:** parallel evidence subtask, documentation/evidence only — no Docker, CI, test, package, database, or runtime implementation change was made by this task.
**Worktree:** `E:\Ek Gelir\Siteler\DisKlinikCRM-worktrees\f1-002-p2-test-runtime-baseline`, branch `docs/f1-002-p2-test-runtime-baseline`, created from `origin/main` at `08f2eaf82a205cf3f997c57e6a295fedd66b142d`.
**Structured companions (normative — this document narrates them, it does not restate every field):** [F1-002-P2_test_runtime_requirements.json](F1-002-P2_test_runtime_requirements.json), [F1-002-P2_disposable_environment_capabilities.json](F1-002-P2_disposable_environment_capabilities.json).

## 0. Baseline verification and parallel-authorization compliance

- `git fetch origin --prune` + `git rev-parse origin/main` → `08f2eaf82a205cf3f997c57e6a295fedd66b142d`. Primary tree (`fix/revenue-report-group-by`) was clean at task start and was not modified by this task.
- `git merge-base --is-ancestor 94cc4ac58f0487dd186886878c5628627f0b1ce3 origin/main` → exit 0, confirmed. The F1-001 merge commit named as this task's authoritative baseline remains an ancestor of current `origin/main`.
- A dedicated worktree/branch was created per this task's own instruction, from a freshly-fetched `origin/main`, isolated from the primary tree and from the pre-existing `f1-002-test-inventory-refresh` worktree (parent task, confirmed present and untouched via `git worktree list`).
- This task's own authorization allows running in parallel with F1-002 main, F1-002-P1, and active KVKK remediation — no coordination with those tasks' own file changes was required, since this task creates only 3 new, previously-nonexistent evidence files.

## 1. Relationship to prior evidence — why a fresh pass was required

`TEST_OWNERSHIP.md`/`F0-005_test_inventory.json` is pinned to commit `7fcf2f850f151241266f07349c4bf4442c72bbca` (2026-07-19, 100 test/verification targets: 72 backend, 6 frontend, 9 bridge-agent, 4 windows-bridge .NET projects, 4 windows-bridge installer PowerShell scripts, 3 manual verify scripts). A later task, F1-001 (2026-07-28), independently found this evidence **stale** relative to a `d0311636`-era `HEAD` (96 backend files vs. 72, 9 frontend vs. 6) and recorded this as **`RISK_REGISTER.md` R-072**, still `OPEN`.

This task's own fresh count against the current worktree `HEAD` (`08f2eaf`) finds the drift has **continued past F1-001's own snapshot**: **105 backend test files** (97 flat in `server/src/tests/`, independently confirmed via `find server/src/tests -maxdepth 1 -name "*.test.ts" | wc -l` = 97, plus 8 in a new `server/src/tests/dbVerification/` subdirectory, independently confirmed via `find`), not 96. Frontend is **9 files**, matching F1-001 exactly (confirmed via `find src -name "*.test.ts" -o -name "*.vitest.test.tsx"`). **This document does not close, resolve, or supersede R-072** — closing that risk is explicitly out of this task's allowed scope (`TEST_OWNERSHIP.md`/F0-005 refresh is F1-002 main's job, not this parallel evidence subtask's). This document instead independently confirms R-072's concern is real and ongoing, and supplies the runtime-dependency classification F1-002-P2 was specifically asked to produce, for both the 100 previously-classified targets and the newly-discovered 37 files (33 backend `.test.ts` including the 8 new `dbVerification/` files, 1 new manual verify script, 3 new frontend).

## 2. Methodology

- **CodeGraph**: checked via `ToolSearch` before starting; not available in this task's execution environment, consistent with F1-001's own §0 disclosure. No repository-wide replacement scan was performed. Targeted `Grep`/`Glob`/`Read` inspection was used instead, scoped to `server/src/tests`, `server/src/services`, `server/src/utils`, `src` test directories, `.github/workflows`, and repo-root (for Docker/Compose artifacts).
- **Division of labor**: a subagent performed the bulk of the file-diff-against-F0-005 and per-new-file classification pass (33 new backend files, 3 new frontend files, CI workflow content, package.json script inventories, Docker/Compose glob, Redis/imaging repo-wide grep). Every count and claim the subagent reported that could materially affect this document's findings was **independently spot-checked in this task's own shell** against the live worktree before being written into the companion JSON files — see the exact commands and their raw output below (§3). Where the subagent's and this task's own independent counts disagreed (backend file count: subagent said 99 flat + 6 `dbVerification/` = 105 total; this task's own count found 97 flat + 8 `dbVerification/` = 105 total), the **total (105) matched and is reported as verified; the internal breakdown uses this task's own independently-run count (97+8), not the subagent's unreconciled sub-totals.**
- **Reused, not re-derived**: classification for the 100 files already inventoried by F0-005 was reused directly from `F0-005_test_inventory.json`'s per-file fields (dbRequired, redisRequired, filesystemRequired, networkRequired, envVarsRequired, externalProviderMode, command), remapped into this document's required runtime-class vocabulary. This task did not re-execute those 100 files.

## 3. Independent verification commands and output (this task's own shell, not the subagent's)

```
$ find server/src/tests -maxdepth 1 -name "*.test.ts" | wc -l
97
$ find server/src/tests/dbVerification -name "*.test.ts"
appointmentRequestConversionAtomicity.test.ts, fileBackupDbIntegration.test.ts,
kvkkHigh006DbClinicScopeAccess.test.ts, kvkkHigh006DbInputHandling.test.ts,
kvkkHigh006DbInsuranceListBehavior.test.ts, kvkkHigh006DbPlanLimitsQuota.test.ts,
kvkkHigh006DbRecordOwnedMutationScope.test.ts, kvkkHigh006DbTargetClinicCreation.test.ts   (8 files)
$ find src -name "*.test.ts" -o -name "*.vitest.test.tsx"                                   (9 files, matches F1-001)
$ ls vitest.config.ts                                                                        → exists (new since F0-005)
$ ls .github/workflows/                                                                      → windows-bridge-pr.yml, windows-bridge-release.yml (2, unchanged)
$ find . -iname "Dockerfile*" -o -iname "docker-compose*" -o -iname "compose.y*ml" | grep -v node_modules
                                                                                               → zero matches
$ grep -c '"test:' server/package.json                                                       → 94
$ node -e "...count npm run test:* calls inside server/package.json's own 'test' script..."   → 77 (was 56 per F0-005)
$ grep '"test' package.json                                                                   → 8 scripts (7 tsx + test:vitest)
$ find bridge-agent/tests -name "*.test.ts" | wc -l                                           → 9 (unchanged)
$ find windows-bridge -iname "*Tests*.csproj"                                                 → 4 projects (unchanged, IntegrationTests confirmed present)
$ find server/scripts -name "verify-*.ts"                                                     → 4 (was 3; new: verify-kvkk-high007-high008-rollback-tenant.ts)
```

## 4. Runtime classification — summary

Full per-group detail (paths, env vars, processes, ports, DB/migration/fixture/network/provider requirements, reproducibility, CI suitability, cleanup, isolation risk, tenant/KVKK considerations, confidence, evidence) is in [F1-002-P2_test_runtime_requirements.json](F1-002-P2_test_runtime_requirements.json) `testGroups[]` (17 groups covering all 105 backend + 9 frontend + 9 bridge-agent + 4 windows-bridge .NET + 4 windows-bridge PS1 + 4 manual verify scripts + production-safe/manual-only operator scripts).

| Runtime class | Count (files, approx. where grouped) | CI-suitable today? |
|---|---|---|
| PURE_NODE | ~67 backend + 7 frontend hand-rolled | Yes |
| JSDOM | 2 (new vitest component tests) | Yes |
| DISPOSABLE_POSTGRES | 22 files (14 flat + 8 in `dbVerification/`, one dual-counted with STORAGE_EMULATOR_REQUIRED) | No — no committed provisioning |
| POSTGRES_PLUS_MIGRATIONS | 2 (1 new test file + 1 new manual script) | No — same gap, plus migration-rollback tooling gap (R-070) |
| REDIS_REQUIRED | 0 | n/a — no test needs this |
| FILESYSTEM_FIXTURE | 17 | Yes (self-contained temp paths) |
| STORAGE_EMULATOR_REQUIRED | 1 (dual-counted) | No — no MinIO/S3-emulator provisioning exists |
| EXTERNAL_PROVIDER_MOCK | 8 (+1 dual-counted) | Yes — already fully stubbed |
| LOCAL_SERVICE_REQUIRED | 1 in-process (ephemeral port) + 4 .NET projects + 4 PowerShell scripts | Yes — .NET/PS1 already CI-invoked on windows-latest with pinned SDK |
| EXTERNAL_NETWORK_REQUIRED | 0 | n/a |
| IMAGING_TOOLCHAIN_REQUIRED | 0 | n/a — no test parses/renders real DICOM |
| PRODUCTION_SAFE_PACKAGE | 1 (`scripts/noramedi-healthcheck.sh`) | Not a CI concern by design |
| MANUAL_ONLY | 4 `verify-*.ts` scripts + ad hoc production-verification packages (R-061/R-046 style) | Not a CI concern by design |
| UNKNOWN | 1 (see §7) | n/a |

## 5. PostgreSQL and migration requirements

**22 test files require a reachable, migrated disposable Postgres** (`DATABASE_URL`): the 3 pre-existing `DATABASE_INTEGRATION`-tagged files from F0-005 (`securityIncident.test.ts`, `communicationConsent.test.ts`, `communicationPreferenceBackfill.test.ts` — all previously `BLOCKED` in F0-005's own environment, all subsequently independently re-run **passing** against a real disposable Postgres in F0-011-P2) plus **19 new files**: 11 flat new backend files (`communicationConsentAuditReport`, `communicationPreferenceReconciliationReport`, `communicationPreferencesRoute`, `legacyConsentCorrection`, `legacyReconciliationResolver`, `messagesConsentGate`, `recallConsentGate`, `paymentsListFieldScope`, `platformAdminPasswordRecovery`, `retentionManualRunAudit`, `metaWhatsAppPostBookingHandler`) and all **8 files in the new `server/src/tests/dbVerification/` subdirectory**. **2 additional files** require migration-mechanics-level verification specifically (`kvkkHigh007High008SchemaIntegrity.test.ts`, `verify-kvkk-high007-high008-rollback-tenant.ts` — the latter a manual script, not a wired test). None of these 24 files apply migrations themselves at test-run time beyond the KVKK-HIGH-007/008 schema-integrity check's read-only assertions — every one presumes `npx prisma migrate deploy` has already been run against the target database, exactly as F0-005 §8 found for the 3 pre-existing files.

**None of these 24 files are runnable in this task's own environment** — same root cause F0-005 recorded (no reachable `DATABASE_URL`, no committed disposable-Postgres provisioning) — and this task did not attempt to stand one up, per its own instruction not to provision or change any environment.

## 6. Redis, filesystem/storage, provider-mock, network, and imaging findings

- **Redis: 0 test files require it.** Repo-wide grep of `ioredis|REDIS_URL|createClient(` across all 105 backend test files returns zero matches. `ioredis` is a real production dependency (used by application source for rate limiting) but is never instantiated or connected to by any test — F0-005's finding stands completely unchanged.
- **Filesystem/storage: 17 files use real local disk I/O or source-file regression scans** (`fs.readFileSync` of committed route/service source, or real `os.tmpdir()`-based temp file round-trips), all self-contained and self-cleaning, no persistent state. **1 additional file** (`dbVerification/fileBackupDbIntegration.test.ts`, new) requires a **disposable S3-compatible object-storage emulator (MinIO, default `http://localhost:19000`)** — this is the single new capability class this task found that F0-005 never encountered: the first test in this program's history with a genuinely unstubbed network dependency beyond the database connection itself. No MinIO/S3-emulator provisioning of any kind exists anywhere in the repository.
- **Provider mocks: 9 files** (8 pre-existing/unchanged + 1 new, `metaWhatsAppPostBookingHandler.test.ts`, dual-classified as also requiring a live disposable Postgres) exercise Meta WhatsApp Cloud, Instagram Graph API, Evolution WhatsApp, SMS, or AI (Gemini/Google AI Studio) adapters — **every single one via a stubbed/spied call site** (`globalThis.fetch` reassignment, provider-prototype-method override, or an explicit environment-variable short-circuit such as `MAIL_ENABLED=false` or deliberately deleting `GOOGLE_AI_STUDIO_API_KEY`/`GEMINI_API_KEY`). **Zero live provider calls were found anywhere in the backend or frontend test suite.** Full per-provider breakdown: [F1-002-P2_disposable_environment_capabilities.json](F1-002-P2_disposable_environment_capabilities.json) `externalDependencyAssessment`.
- **External network: 0 files require live third-party network access.** The one exception noted above (MinIO) is a disposable local service, not a live external provider.
- **Imaging/DICOM: 0 files exercise a real DICOM parsing/rendering toolchain.** Repo-wide grep for `dcmjs|dicom-parser|cornerstone` across all backend test files returns zero matches; every imaging-named test (backend and frontend) exercises bridge-pairing/onboarding/update/metadata-handling logic only — F0-005's own finding, independently reconfirmed unchanged.

## 7. UNKNOWN findings

**1 item** could not be resolved to a definite yes/no with the evidence available to this task: whether `server/src/tests/messagesConsentGate.test.ts`'s import of the `EvolutionWhatsAppProvider` type is exercised only in a fully-stubbed path or could, under some code path not inspected line-by-line, reach a live send call. This is recorded as **MEDIUM confidence**, not asserted either way, and flagged in both companion JSON files as a recommended closer-review candidate. No other file in this inventory was left at UNKNOWN — every other classification is backed by either a prior committed execution record (F0-005, F0-011-P2, KVKK-HIGH-006 evidence) or this task's own direct grep/read confirmation.

## 8. Disposable PostgreSQL pattern — assessment

Full 10-question assessment: [F1-002-P2_disposable_environment_capabilities.json](F1-002-P2_disposable_environment_capabilities.json) `disposablePostgresAssessment`. Summary:

1. **Pattern exists** — demonstrated independently at least 3 times (F0-011-P2, KVKK-HIGH-006-DISPOSABLE_POSTGRES_VERIFICATION, KVKK-HIGH-008-PMVR Phase B1) — but only as ad hoc, per-task practice, never committed as a reusable script or Compose file.
2. **Exact commands** are recorded verbatim in the JSON (image `postgres:16-alpine`, `docker run --rm -d`, non-default ports 5434/55432, `npx prisma generate && npx prisma migrate deploy`).
3. **Migrations are always deployed** via the project's normal `prisma migrate deploy` — never hand-run SQL for the forward path.
4. **Test data isolation** is achieved by convention (UUID/timestamp-suffixed fixtures, per-file truncation), not by a repository-enforced mechanism.
5. **Parallel-agent safety is NOT designed for** — two historical instances coexisted only because an operator manually checked for an already-occupied port (5433) before choosing another (5434).
6. **Port/database-name collisions are a real, currently-unmitigated risk** — no registry or dynamic allocation exists.
7. **Cleanup is deterministic at the container level** (`--rm`, no volume, confirmed via `docker ps -a` showing zero rows post-teardown) and **convention-deterministic at the test-data level** (self-truncating fixtures), but not universally enforced.
8. **S5-equivalent capability has already been demonstrated once** (F0-011-P2's migration-forward + rollback rehearsal) but is not packaged as a reusable, committed mechanism.
9. **Five concrete gaps remain before CI automation**: no committed provisioning script/Compose file, no MinIO/object-storage provisioning, no collision-avoidance mechanism, no automated migration-rollback tooling, and no CI workflow that provisions any database/storage service at all today.
10. **Rollback/cleanup is forward-only by design**; physical rollback is technically possible (demonstrated) but destructive once real evidence rows exist, and Prisma's own bookkeeping does not self-reconcile afterward (`_prisma_migrations` drift, error `P3012` on `migrate resolve --rolled-back`, tracked as `RISK_REGISTER.md` R-070, still `OPEN`) — the program's own accepted recommendation is retain-and-forward-fix over physical rollback by default.

**No database was run, provisioned, or connected to by this task.** Every fact above traces to a previously-committed evidence document, not to any action taken in this task.

## 9. Credential/secret safety findings

No test file was found reading a real, non-test provider credential, and no live call to Meta, Instagram, Evolution, SMS, email, or AI infrastructure was found anywhere in the 105-file backend suite or 9-file frontend suite. The one file warranting closer review before any future CI-wiring (`dbVerification/fileBackupDbIntegration.test.ts`) uses fixed test credentials against a **local, disposable** MinIO endpoint by default — not a live AWS account — though this task did not independently re-confirm that line-by-line (see UNKNOWN finding, §7, and the flagged-for-closer-review list in the capabilities JSON). No secret values were read or exposed by this task at any point.

## 10. What this task did not do

Per its own non-goals: no Docker container, database, or environment was created, started, stopped, or modified. No test file, package script, schema, migration, or CI workflow was added, changed, or deleted. No test was executed. No production/VPS access occurred. No real patient data was referenced, read, or used anywhere in this document or its companion JSON files. `RISK_REGISTER.md` R-072 was not closed, reopened, or edited by this task (F1-002 main's responsibility). `TEST_OWNERSHIP.md`, `CURRENT_PHASE.md`, `NORAMEDI_MASTER_TRACKER.md`, `phases/F1_CI_AND_TEST_ARCHITECTURE.md`, and `evidence/README.md` were not modified.

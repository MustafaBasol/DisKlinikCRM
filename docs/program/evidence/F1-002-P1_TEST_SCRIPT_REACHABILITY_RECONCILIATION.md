# F1-002-P1 — Test Script Reachability and Runner Reconciliation

**Task ID:** F1-002-P1
**Parent task:** F1-002 (Test Inventory Refresh and Ownership Reconciliation)
**Phase:** F1 — CI and Test Architecture
**Task type:** Parallel evidence subtask — documentation/evidence only. No package script modification, no test/CI implementation, no program-status transition, no test-ownership assignment.
**Generated:** 2026-07-28

**Expected initial baseline (per task order):** `94cc4ac58f0487dd186886878c5628627f0b1ce3` (F1-001 / PR #241 merge commit)
**Actual `origin/main` at task start:** `08f2eaf82a205cf3f997c57e6a295fedd66b142d`
**Ancestry check:** `git merge-base --is-ancestor 94cc4ac5… origin/main` → **true**. `origin/main` advanced normally (28 commits, PRs #242–#252); the expected baseline is an ancestor, not a divergent branch.
**Execution baseline used for all findings in this document:** `08f2eaf82a205cf3f997c57e6a295fedd66b142d`

This document, and the two JSON files it summarizes, are the only three files this task created or modified:

- `docs/program/evidence/F1-002-P1_TEST_SCRIPT_REACHABILITY_RECONCILIATION.md` (this file)
- `docs/program/evidence/F1-002-P1_test_script_reconciliation.json`
- `docs/program/evidence/F1-002-P1_test_file_reachability.json`

No package script, test file, CI workflow, `TEST_OWNERSHIP.md`, `RISK_REGISTER.md`, tracker, or phase file was modified.

---

## 1. Scope of the intervening change (94cc4ac → 08f2eaf)

Of the 28 commits between the two SHAs, exactly one touched anything in this task's inspection scope:

| File | Change |
|---|---|
| `server/package.json` | +2 test scripts (`test:ai-prompt-privacy`, `test:retention-manual-run-audit`, `test:kvkk-high007-high008-schema-integrity`, `test:file-backup`, `test:file-backup-db-integration`, `test:reports-revenue-by-period` — 6 new scripts total across PRs #245/#246/#247/#252), and `test`'s own chain grew from 76 to 77 chained scripts (2 of the 6 new scripts were spliced into the chain: `test:ai-prompt-privacy`, `test:retention-manual-run-audit`; the other 4 were not) |
| `scripts/backup-restore-rehearsal.sh` | New file, added by PR #242 — an operational rehearsal script, not wired to any `package.json` script; out of this task's package-script scope, noted for completeness only |

Root `package.json`, `.github/workflows/**`, and `vitest.config.ts` are byte-identical between 94cc4ac and 08f2eaf. Findings below are therefore already current against the parallel F1-002 main task's own execution baseline (`origin/main` at `08f2eaf`, confirmed via `git worktree list` showing the sibling `docs/f1-002-test-inventory-refresh` worktree pinned to the same SHA).

## 2. Method

- **Programmatic parsing**, not manual transcription: a Node script (`node --version` `v24.18.0`, available in-tree) read `package.json` (root) and `server/package.json`, isolated every script named `test` or `test:*`, split each `rawCommand` on top-level `&&`, and classified each segment as `npm run <ref>` (recursively expanded, cycle-guarded), `tsx <file>` (direct file invocation), `vitest run` (glob-based), or `unknown`. No script was executed; this is static parsing only, per the task's "do not execute" instruction.
- **Filesystem cross-reference**: every referenced file path was checked with `fs.existsSync` against the execution-baseline worktree to populate `matchedCurrentFiles` / `missingReferencedFiles`.
- **Full test-file inventory**: `server/src/tests/**/*.test.ts` (walked, 106 files) + the 2 fixture-loader helpers invoked by `test:fixtures`/`test:safety` (`whatsappConversationFixtures.ts`, `whatsappSafetyFixtures.ts`, both pre-existing at the F0-005 baseline) + `src/**/*.test.{ts,tsx}` (9 files: 7 hand-rolled `__tests__` helpers + 2 `*.vitest.test.tsx` component tests) = **116 current test-related files**.
- **Runtime-dependency classification**: for files already present in `docs/program/evidence/F0-005_test_inventory.json` (baseline commit `7fcf2f850f1…`, itself confirmed an ancestor of `08f2eaf` at F0-005/F1-001 time), that document's own empirically-verified `dbRequired`/`redisRequired`/`envVarsRequired` fields were **carried forward** (per this task's instruction to reuse existing authoritative values rather than re-derive them) and cross-checked against a static grep of each file for `PrismaClient`/`@prisma/client`/`../db.js` imports, `ioredis`, `aws-sdk`/`S3Client`, and `process.env.*` references. For the 36 files added since F0-005 (no prior evidence exists), classification is grep-derived only and marked `MEDIUM` confidence, not `HIGH`.
- **CodeGraph**: not used. Per the task's own guidance this subtask is filesystem/command-analysis-shaped; targeted `grep`/`find`/Node parsing covered every required field without a full-repository scan.
- **CI cross-reference**: both files under `.github/workflows/` (`windows-bridge-pr.yml`, `windows-bridge-release.yml`) were read in full to determine which `npm run test:*` invocations are actually reachable from CI today, independent of what package.json alone would suggest.

## 3. Package scripts found

| Package | Test-related scripts (`test`/`test:*`) |
|---|---|
| root (`health-crm-frontend`, `package.json`) | 8 |
| `server/package.json` | 95 |
| **Total** | **103** |

No `frontend package.json` distinct from the root exists — the root `package.json` (`name: health-crm-frontend`) *is* the frontend package. `bridge-agent/package.json` is a separate Node package (own `test` chain, 9 files) outside this task's named inspection scope (root/server/frontend); it is unchanged since F0-005 (same 9 files, confirmed by direct comparison) and is noted here only for completeness, not covered in the two JSON deliverables.

Of the 103 test scripts, 2 are **orchestrators** — their own `rawCommand` contains no direct `tsx`/`vitest` invocation, only `npm run <other-script>` chains:

- `server:test` — chains 77 other `test:*` scripts, recursively expanding to **83 distinct backend test files**.
- `server:test:kvkk-high006-db-verification` — chains the 6 `test:kvkk-high006-db-*` scripts (all under `dbVerification/`).

1 script (`root:test:vitest`) is **glob-based** (`vitest run`, include pattern `src/**/*.vitest.test.{ts,tsx}` from `vitest.config.ts`) rather than an explicit file list — its matched file set can silently change without any script edit.

The remaining 100 scripts are **leaf scripts**: each directly invokes `tsx` against one or more explicit file paths (a few, e.g. `test:auth`, `test:instagram`, `test:meta-wa`, chain 2–4 files with `&&` but no nested `npm run`).

**Stale/missing references: zero.** Every one of the 103 test scripts' referenced files resolved against the execution-baseline filesystem — `missingReferencedFiles` is empty for all 103 records, and no `npm run <name>` reference points at a non-existent script name. There is no `STALE_SCRIPT_REFERENCE` finding in this reconciliation.

## 4. Full-suite chain resolution (`server:test`)

`server:test`'s raw command chains 77 `npm run test:*` references. Recursively expanding those (2 of the 77, `test:auth` and `test:instagram`/`test:meta-wa`, themselves chain 2–4 files with `&&`) yields **83 distinct backend `.test.ts` files** actually reached by `npm run test` in `server/`.

Root `package.json` has **no equivalent aggregate script** — there is no root-level `test` or `test:all` that runs the 7 hand-rolled frontend helper tests and `vitest run` together. Each frontend helper test is reachable only through its own single dedicated script; `npm test` at the repo root does not exist at all (only `test:<name>` leaves and `test:vitest`).

### 4.1 Scripts that exist but are excluded from `npm run test` (17)

These are genuine `package.json` scripts, not typos — each resolves to a real, existing file — but none is referenced anywhere inside `server:test`'s chain:

**Database-required, deliberately excluded (9)** — all under `src/tests/dbVerification/`, whose shared harness (`dbVerificationHarness.ts`) explicitly documents in its own header that it "runs against a REAL disposable PostgreSQL instance… Requires `DATABASE_URL` to point at a disposable Postgres before import":
`test:kvkk-high006-db-clinic-scope-access`, `test:kvkk-high006-db-record-owned-mutation-scope`, `test:kvkk-high006-db-target-clinic-creation`, `test:kvkk-high006-db-insurance-list-behavior`, `test:kvkk-high006-db-plan-limits-quota`, `test:kvkk-high006-db-input-handling`, `test:kvkk-high006-db-verification` (the 6-file aggregator itself), `test:appointment-request-conversion-atomicity`, `test:file-backup-db-integration`.

**No apparent database/external-service reason for exclusion (8)** — same in-memory/mocked-fixture style as most of the 83 chained scripts, but simply never spliced into the chain:
`test:consent-resume`, `test:meta-template`, `test:outbound`, `test:no-show-follow-up-parity`, `test:overdue-installments`, `test:overdue-receivables`, `test:platform-admin-password-recovery`, `test:file-backup`.

This second group matters most for future CI design: `test:file-backup` (`fileBackupService.test.ts`) is a **new script added since F0-005** (PR #247, FILE-BACKUP-COVERAGE-001) that was never wired into the full-suite chain at all — running `npm test` today gives no signal on the file-backup service's non-DB unit coverage, and no CI workflow calls `test:file-backup` directly either (see §7). `test:overdue-installments` was already flagged by F0-005 as having "a genuine 2-assertion regression" that went undetected specifically *because* it is chain-excluded and CI-unreached — that historical finding is unchanged; this task did not re-run it (no test execution performed).

## 5. Test-file reachability (116 files)

| Category | Count |
|---|---|
| Total current test-related files (server + frontend) | 116 |
| Reachable via a dedicated targeted script (`reachableThroughTargetedScript`) | 108 |
| Reachable via the full-suite command (`reachableThroughFullSuite`, i.e. chained into `server:test`) | 83 |
| Reachable through **more than one** script path (`MULTI_SCRIPT_REACHABLE`) | 89 |
| Reachable through exactly one script path (`SINGLE_PATH`) | 19 |
| **Unreachable through any supported script (`UNSCRIPTED`)** | **8** |
| Reachable *only* via the full-suite command, with no dedicated leaf script of its own (strict `FULL_SUITE_ONLY`) | **0** |

The strict `FULL_SUITE_ONLY` count is genuinely zero: every file chained into `server:test` also has its own individually-runnable `test:<name>` leaf script (a consequence of this repo's naming convention, where the mega-script is assembled by referencing the same leaf scripts a developer would run standalone). The 89 `MULTI_SCRIPT_REACHABLE` files are reachable exactly two ways — their own leaf script, plus one aggregator (`server:test` for 83 of them, `server:test:kvkk-high006-db-verification` for the other 6) — never three or more; no file is chained into two different aggregators.

### 5.1 UNSCRIPTED — reachable through no package script at all (8)

| File | Notes |
|---|---|
| `server/src/tests/channelConsentGate.test.ts` | Present at F0-005 baseline; F0-005 already flagged this as one of its own 6 no-script files |
| `server/src/tests/clinicLegalProfile.test.ts` | Same — F0-005-known gap, unchanged |
| `server/src/tests/patientSharedPhone.test.ts` | Same — F0-005-known gap, unchanged |
| `server/src/tests/platformBackup.test.ts` | Same — F0-005-known gap, unchanged |
| `server/src/tests/treatmentPackagePermissions.test.ts` | Same — F0-005-known gap, unchanged |
| `server/src/tests/kvkkHigh006Batch2ClinicScope.test.ts` | **New since F0-005** — sibling `kvkkHigh006Batch3ClinicScope.test.ts` has a script (`test:kvkk-high006-batch3`); Batch2 does not |
| `server/src/tests/metaWhatsAppPostBookingHandler.test.ts` | **New since F0-005** — no script references this file under any name |
| `server/src/tests/planLimitsTargetClinicFix.test.ts` | **New since F0-005** — explicitly named in `dbVerificationHarness.ts`'s own header as one of the files that "mirror route logic against in-memory fixtures because no live database was reachable," yet it has no script entry point at all |

F0-005's own evidence (`evidence/F0-005_test_inventory.json` → `commands[]` → `"6 no-script backend test files"`) listed 6 files including `aiPrivacyBoundary.test.ts`; that specific gap has since been **closed** — PR #245 added `test:ai-prompt-privacy`, which now wires it into `server:test`. Net effect since F0-005: 1 closed, 3 opened, for a current total of 8.

These 8 are only runnable via direct manual invocation (`npx tsx server/src/tests/<file>.test.ts`), never through any documented package script — classification `MANUAL_ONLY` / `UNSCRIPTED`.

## 6. Database and external-runtime-dependency findings

| | Scripts | Files |
|---|---|---|
| Require a live database (`DATABASE_URL`, real `pg`/Prisma pool at import time) | 34 of 103 | 35 of 116 |
| Require an external service beyond the database (S3/MinIO object storage) | 3 of 103 | — |
| Structurally suitable for CI today (no DB dependency, no missing file references) | 69 of 103 | — |

**Database-required** is heavily concentrated in `src/tests/dbVerification/**` (9 scripts, all DB-required by explicit in-repo documentation) plus a long tail of pre-existing route-level tests already flagged `dbRequired` by F0-005 (`communicationConsent.test.ts`, `securityIncident.test.ts`, `communicationPreferenceBackfill.test.ts`, `appointmentAvailabilityService.test.ts`, `publicBookingAvailability.test.ts`, and others — F0-005 additionally noted `securityIncident.test.ts`, `communicationConsent.test.ts`, `communicationPreferenceBackfill.test.ts` "could not be executed to completion" in its own environment for lack of a reachable database).

**External-service (S3/MinIO)** is limited to 3 scripts whose files construct an S3 client directly: `kvkkAttachmentImagingLifecycle.test.ts` (`test:kvkk-lifecycle`), `fileBackupService.test.ts` (`test:file-backup`, notably *not* itself database-required — the non-DB and DB-integration file-backup tests are correctly split into two separate scripts), and `fileBackupDbIntegration.test.ts` (`test:file-backup-db-integration`, both DB- and S3-required).

No script or file was found to depend on Redis at runtime. One file (`clinicBulkExport.test.ts`) contains the substring "Redis" only inside a comment/assertion explicitly proving Redis is *not* used on that code path ("PostgreSQL must be the sole authority — no Redis pre-check"); grepping for the literal string without inspecting context would have produced a false positive here, so this was verified by reading the matched lines, not by string count alone.

Environment-variable surface (`environmentVariables` field, populated per-script from `process.env.*` references in the files it invokes) is otherwise dominated by feature flags (e.g. `CLINIC_BULK_EXPORT_ENABLED`, `FILE_BACKUP_ENABLED`, `PATIENT_PRIVACY_EXPORT_CLEANUP_ENABLED`) rather than credentials — no script reads a secret-shaped variable directly in its own `rawCommand` (no `VAR=value npm run …` prefix exists anywhere in either `package.json`).

## 7. CI suitability

Exactly one CI workflow in the repository executes any JavaScript/TypeScript test: `.github/workflows/windows-bridge-pr.yml`, and only 7 of the 116 files in scope are ever reached by it, path-triggered (only fires on changes under `windows-bridge/**`, `server/src/services/imaging/**`, `server/src/routes/imaging*.ts`, `server/src/tests/imaging*.ts`, `src/components/imaging/**`):

- Backend (4): `test:imaging`, `test:imaging-bridge-pairing`, `test:imaging-bridge-onboarding`, `test:imaging-bridge-update`
- Frontend (3): `test:dicom-helpers`, `test:onboarding-helpers`, `test:pairing-poller`

`windows-bridge-release.yml` runs no test script at all (signing/build/dry-run only, `workflow_dispatch` gated).

This means:

- `server:test` (83 files) is **never invoked by any CI workflow**, on any trigger.
- `root:test:vitest` and 4 of the 7 root leaf scripts (`test:booking-widget-helpers`, `test:clinic-bulk-export-selection`, `test:communication-consent-matrix`, `test:patient-detail-tabs-helpers`) are **never invoked by any CI workflow**.
- 109 of 116 test files (94%) have zero CI enforcement today. This matches — and, with 36 additional files added since, extends — the gap R-072/F0-005 already recorded (F0-005: 66 of 70 backend files uncovered; current: 79 of 83 chained-full-suite-reachable backend files, plus all 8 unscripted files, uncovered).
- Of the 69 scripts this task classifies `suitableForCI` (no DB dependency, no missing references — a structural/mechanical judgment only, not a recommendation on priority or ownership), only 7 are actually wired into the one existing workflow. The other 62 are structurally CI-ready but simply not called from any workflow file.

No new CI suitability judgment beyond "structurally CI-ready: yes/no" is made here — priority, grouping, and selection strategy are explicitly parent-task (F1-002) and F1-001-architecture concerns, not this subtask's.

## 8. Ambiguous command resolution

No script produced a genuine `AMBIGUOUS_COMMAND_RESOLUTION` finding (no shell-expansion glob outside `vitest run`'s documented `include` pattern, no undocumented working-directory switch, no chained script whose target script name could not be resolved). The one glob-based script (`test:vitest`) is flagged separately (§3) as a *silent-drift risk*, not an ambiguity in today's resolution — its current matched set (`CommunicationPreferencesPanel.vitest.test.tsx`, `PatientDetailTabs.vitest.test.tsx`) was independently confirmed against `vitest.config.ts`'s `include: ['src/**/*.vitest.test.{ts,tsx}']`.

All scripts run from a fixed, implicit working directory (repo root for root `package.json` scripts, `server/` for server scripts) with no `cd`/`--prefix` switching; this is the same convention documented by F0-005 and unchanged.

## 9. Additions since F0-005 (`7fcf2f850f151241266f07349c4bf4442c72bbca`, 2026-07-19)

**Test files added: 36** (0 removed) — cross-checked against `docs/program/evidence/F0-005_test_inventory.json`'s own 100-entry `testFiles[]` list. Full list in `F1-002-P1_test_file_reachability.json` (`isNewSinceF0005: true`). Notably:

- 6 of the 9 `dbVerification/**` files are new (`appointmentRequestConversionAtomicity`, `fileBackupDbIntegration`, and the 6 `kvkkHigh006Db*` files — this entire directory postdates F0-005).
- 2 new frontend `*.vitest.test.tsx` files — a **new runner** (`vitest`) that did not exist in F0-005's vocabulary at all (F0-005 and its own `runner` field only ever recorded hand-rolled `tsx` execution). This is the exact drift already called out by R-072.
- 2 files (`whatsappConversationFixtures.ts`, `whatsappSafetyFixtures.ts`) were independently confirmed via `git cat-file -e` to **already exist** at the F0-005 baseline commit — they are not new, just never separately catalogued in F0-005's `testFiles[]` enumeration (a scope choice in that document, since they are fixture-loader modules invoked by `test:fixtures`/`test:safety`, not literal `*.test.ts` files). Not counted in the 36.

**Package scripts added since F0-005: 6**, all in `server/package.json`: `test:ai-prompt-privacy`, `test:retention-manual-run-audit`, `test:kvkk-high007-high008-schema-integrity`, `test:file-backup`, `test:file-backup-db-integration`, `test:reports-revenue-by-period`. 2 of these 6 (`test:ai-prompt-privacy`, `test:retention-manual-run-audit`) were spliced into `server:test`'s chain; the other 4 were not (§4.1).

No script was removed or renamed since F0-005.

## 10. Deliverables and validation

| File | Purpose |
|---|---|
| `F1-002-P1_test_script_reconciliation.json` | One record per test-related package script (103 records: 8 root + 95 server), matching the requested schema (`package`, `scriptName`, `rawCommand`, `expandedScriptChain`, `runner`, `workingDirectory`, `environmentVariables`, `referencedFiles`, `referencedGlobs`, `matchedCurrentFiles`, `missingReferencedFiles`, `indirectlyInvokedScripts`, `databaseRequired`, `externalServiceRequired`, `suitableForCI`, `fullSuiteCandidate`, `notes`, `confidence`) |
| `F1-002-P1_test_file_reachability.json` | One record per current test file (116 records), matching the requested schema (`relativePath`, `directlyMatchedByScripts`, `indirectlyMatchedByScripts`, `reachableThroughFullSuite`, `reachableThroughTargetedScript`, `unreachable`, `ambiguity`, `runner`, `confidence`), plus `isNewSinceF0005` and `databaseRequired`/`externalServiceRequired` as supplementary fields |

Both files were validated with:

```
node -e "JSON.parse(require('fs').readFileSync('docs/program/evidence/F1-002-P1_test_script_reconciliation.json','utf8')); console.log('scripts valid')"
node -e "JSON.parse(require('fs').readFileSync('docs/program/evidence/F1-002-P1_test_file_reachability.json','utf8')); console.log('reachability valid')"
```

— both printed their success message with no error.

## 11. Explicit non-scope statement

This task did **not**:

- Modify any package script, test file, CI workflow, or configuration.
- Assign or change canonical domain ownership for any test file (owned by the parent F1-002 task).
- Update `TEST_OWNERSHIP.md`, `RISK_REGISTER.md`, `NORAMEDI_MASTER_TRACKER.md`, `CURRENT_PHASE.md`, `phases/F1_CI_AND_TEST_ARCHITECTURE.md`, or `evidence/README.md`.
- Close R-072 or transition any program/phase/parent-task status.
- Execute any test, migration, or production/runtime command.

Findings here are handed off for the parent F1-002 task to index alongside its own ownership-reconciliation pass.

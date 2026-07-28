# F1-003-P2A — Disposable Runtime Provisioning Design and Collision-Safety Contract

**Status: `AGENT_COMPLETED` — design/evidence only. Not implemented, not executed, not CI-ready, not merged.**

**Reconciliation status (F1-003-R1, this update):** F1-003-P1 is now **MERGED** (PR #257, merge commit `1e983fe7134f9224cdaeb0065d32b1e8ef2d0904`, mergedAt `2026-07-28T21:43:36Z`). This document has been reconciled against P1's actual merged findings — every "P1 pending" statement in the original design has been replaced below with P1's final, authoritative decision. This reconciliation pass (F1-003-R1) is itself documentation/evidence-only: no runtime was implemented, no test was executed, no CI workflow was created, R-070 remains OPEN, and F1's exit gate remains unsatisfied (§28).

## 1. Task identity and parallel authorization

| Field | Value |
|---|---|
| Task ID | F1-003-P2A (this reconciliation pass: F1-003-R1) |
| Parent task | F1-003 — Baseline CI Test Execution and Disposable Runtime Readiness |
| Phase | F1 — CI and Test Architecture |
| Task type | PARALLEL PREPARATORY EVIDENCE/DESIGN ONLY, now reconciled with the merged execution contract |
| Ran in parallel with | F1-003-P1 — Test Script Closure and Authoritative Execution Contract — **now MERGED**, PR #257, merge commit `1e983fe7134f9224cdaeb0065d32b1e8ef2d0904` |
| Scope boundary | This task designs disposable PostgreSQL/MinIO provisioning, isolation, and collision-safety. It does not own package-script closure, runner composition, the 8 unscripted tests, the 17 aggregate-chain exclusions, `messagesConsentGate.test.ts`'s runtime classification, or the authoritative command matrix — those are F1-003-P1's, and are now settled facts, reconciled into this document (§4a). |
| Implementation authorization | None. This reconciliation (F1-003-R1) itself does not authorize F1-003-P2 implementation — it produces the exact implementation contract (§K/§27) that a separately-authorized F1-003-P2 task must follow. |

## 2. Baseline SHA and worktree

- Primary repository (`E:\Ek Gelir\Siteler\DisKlinikCRM-git`, branch `fix/revenue-report-group-by`): `git status --short` → clean, untouched by this reconciliation task.
- `git fetch origin --prune` → `origin/main` advanced from `e3a29a3bdf4e862c17a18bbad75c3a4b0b36d80a` (this document's original baseline) to `1e983fe7134f9224cdaeb0065d32b1e8ef2d0904` (PR #257's own merge commit, confirmed HEAD of `origin/main` at reconciliation time via `git log --oneline --decorate -10 origin/main`).
- `git merge-base --is-ancestor 1e983fe7134f9224cdaeb0065d32b1e8ef2d0904 origin/main` → exit code `0` — confirmed ancestor.
- This branch's own worktree (`E:\Ek Gelir\Siteler\DisKlinikCRM-worktrees\f1-003-p2a-runtime-design`, branch `docs/f1-003-p2a-disposable-runtime-design`) was confirmed clean and at its expected original HEAD (`c45b37c`) before this reconciliation began.
- Reconciliation merge performed: `git merge --no-ff origin/main` (no rebase, no force-push, no blanket `--ours`/`--theirs`) → **merge commit `42ea904`, zero conflicts.** Files brought in by the merge: `docs/program/evidence/F1-003-P1_TEST_SCRIPT_CLOSURE_AND_EXECUTION_CONTRACT.md` (new), `docs/program/evidence/F1-003-P1_test_execution_contract.json` (new, 114 records), plus updates to `docs/program/CURRENT_PHASE.md`, `docs/program/NORAMEDI_MASTER_TRACKER.md`, `docs/program/TEST_OWNERSHIP.md`, `docs/program/phases/F1_CI_AND_TEST_ARCHITECTURE.md`, `docs/program/evidence/README.md`, `server/package.json` (8 new leaf scripts + 3 new aggregate scripts, legacy `server:test` byte-for-byte unchanged). This document's own two evidence files (`F1-003-P2A_DISPOSABLE_RUNTIME_PROVISIONING_DESIGN.md`, `F1-003-P2A_disposable_runtime_contract.json`) were untouched by the merge itself — P1 never touched either file — and are updated by this reconciliation pass on top of the merge, in a separate commit. No other worktree was opened, modified, reset, cleaned, stashed, or inspected for dirty/untracked contents.

## 3. Sources reviewed (reconciliation pass)

In addition to every source cited in §3 of the original design (unchanged, not re-litigated): `docs/program/evidence/F1-003-P1_TEST_SCRIPT_CLOSURE_AND_EXECUTION_CONTRACT.md` (full, 296 lines), `docs/program/evidence/F1-003-P1_test_execution_contract.json` (full, 114 canonical script records, 3705 lines — read via structured queries: `countsSummary`, `p1CorrectionsApplied`, `messagesConsentGateResolution`, `the17ExclusionsReconciliation`, `legacyServerTestPreExistingDbMixingFinding`, `r070Boundary`, `f1003p2Handoff`, `futureCiCommandMatrix`, and individual `records[]` entries for both new aggregates and every DB/MinIO-related script), `docs/program/RISK_REGISTER.md` (R-070, R-046, R-071 rows re-read directly at the new baseline — R-070 `OPEN` unchanged, R-046 `OPEN` unchanged, R-071 `CLOSURE_PROPOSED_AWAITING_EXTERNAL_CONFIRMATION — IMPLEMENTATION_MERGED — SOURCE_DB_AND_PRODUCTION_VERIFIED — COMPLETE`, not `CLOSED`, unaffected by this reconciliation), `docs/program/NORAMEDI_MASTER_TRACKER.md` (F1-003-P1's own entry, confirming `AGENT_COMPLETED`, PR #257, not-yet-merged-at-time-of-writing status — since independently confirmed merged by this task's own `git merge-base --is-ancestor` check, §2), `server/package.json` at the new baseline (confirmed via `node -e "require(...)"`: 115 total scripts, `test:kvkk-lifecycle`, `test:file-backup-db-integration`, `server:test:non-disposable`, `server:test:disposable-db`, `server:test:storage-integration` all present and resolve), `server/src/tests/dbVerification/fileBackupDbIntegration.test.ts` (re-read, unchanged from original design's full read), `server/src/tests/kvkkAttachmentImagingLifecycle.test.ts` (newly read in full by this reconciliation pass — see §4a Q-B).

## 4. CodeGraph commands and findings (unchanged from original design, restated)

CodeGraph remains unavailable: `ToolSearch` queried for `"CodeGraph"`/`"codegraph"` in this reconciliation pass's own execution environment returned zero matching deferred tools — the fifth independent confirmation of this finding in this program (after F1-001, F1-002-P1, F1-002-P2, and the original F1-003-P2A pass). No repository-wide replacement scan was performed. This reconciliation pass additionally read, in full, one file the original design cited only via F1-002-P2's inference rather than its own direct read: `server/src/tests/kvkkAttachmentImagingLifecycle.test.ts` (1483 lines) — see §4a Q-B for what this direct read resolves. The original design's 10 targeted-question answers (§4 Q1-Q10 of the prior revision) are carried forward unchanged except where §4a below supersedes them; no other finding in the original §4 is contradicted by P1's merged evidence or by this pass's own additional direct read.

## 4a. Reconciliation of every P1 open question against this design

The original design (§26, prior revision) recorded 6 open questions requiring P1 reconciliation. Each is now resolved:

| # | Original open question | P1's merged finding | Final decision for this design |
|---|---|---|---|
| 1 | Authoritative script/file matrix — would P1 rename/remove/re-chain the 22+1 target files? | P1 added 8 new leaf scripts and 3 new aggregates (`server:test:non-disposable` 68 members, `server:test:disposable-db` 9 members, `server:test:storage-integration` 1 member); legacy `server:test` left byte-for-byte unchanged. No file this design's 22+1 target set names was renamed or removed. | **No re-design needed.** This design's provisioning target surface is now precisely: `server:test:disposable-db` (9 members) + `server:test:storage-integration` (1 member) as the two new, explicitly-DB/MinIO-classified aggregates, **plus** legacy `server:test`'s own 23 DB-required + 1 MinIO-required silently-chained scripts (§9a), which P1 explicitly declined to migrate or rename (additive-only constraint) and handed to P2 as an unresolved policy question — resolved by this design at §C/§9a. |
| 2 | `messagesConsentGate.test.ts` UNKNOWN status | **Resolved by P1**: `DISPOSABLE_POSTGRES + EXTERNAL_PROVIDER_MOCK (fully stubbed)`, `externalNetworkRequired: false`, confidence `HIGH`. Already chained inside legacy `server:test` via `test:messages-consent-gate`; no wiring change needed. | No longer an open question for this design. `test:messages-consent-gate` is confirmed safe to include in any future disposable-Postgres profile (it needs Postgres only, no external network) — it is one of the 23 DB-required scripts already silently inside legacy `server:test` (§9a), not a separate concern. |
| 3 | Production PostgreSQL major-version confirmation | P1 did not investigate this — out of P1's own scope (script/runner closure only). | **Still unresolved** — no authoritative repository/deployment evidence exists (§G). Provisional `postgres:16-alpine` choice stands, recorded as a pre-P3/pre-release verification item, not resolved by this task or by P1. |
| 4 | Disposition of the 3 orphaned test files (`kvkkHigh006Batch2ClinicScope.test.ts`, `metaWhatsAppPostBookingHandler.test.ts`, `planLimitsTargetClinicFix.test.ts`) | **Resolved by P1**: all 3 now have dedicated leaf scripts (`test:kvkk-high006-batch2`, `test:meta-whatsapp-post-booking`, `test:plan-limits-target-clinic-fix`). Two (`kvkkHigh006Batch2ClinicScope`, `planLimitsTargetClinicFix`) are confirmed non-DB and are members of `server:test:non-disposable`; one (`metaWhatsAppPostBookingHandler`) is confirmed DB-required and is a member of `server:test:disposable-db`. | No longer orphaned. `test:meta-whatsapp-post-booking` is now explicitly part of this design's 9-member `server:test:disposable-db` provisioning target (§9). |
| 5 | Schema-per-run safety, given `kvkkHigh007High008SchemaIntegrity.test.ts`'s raw introspection | P1 did not re-investigate; confirmed this script (`test:kvkk-high007-high008-schema-integrity`) is one of the 23 DB-required scripts silently inside legacy `server:test` (§9a), not independently re-classified. | **Unchanged from original design**: schema-per-run remains evaluated-not-selected (§9 Option C). This risk is now explicitly folded into the legacy-`server:test` policy decision (§C) rather than treated as a standalone open question, since the file in question is a legacy-`server:test` member, not a new-aggregate member. |
| 6 | Who is authorized to change `fileBackupDbIntegration.test.ts`'s hardcoded bucket name / incomplete teardown? | P1 did not touch this file (out of P1's own scope: script wiring only, no test-file edits). | **Still unresolved, explicitly deferred to F1-003-P2's own separate authorization** (§K item on bucket-naming/teardown test-code change) — this reconciliation (F1-003-R1) does not authorize or perform that change either; it is documentation/evidence-only. |

## 5. Existing PostgreSQL-dependent tests — reconciled count vocabulary (§A)

**This section replaces the original design's single "22 files" statement with the full, disambiguated count vocabulary P1's merge makes possible. Five distinct counts exist in this program's evidence chain; none is interchangeable with another:**

1. **22 — a *file count*.** F1-002-P2's `DISPOSABLE_POSTGRES` runtime-class file tally (14 flat + 8 under `server/src/tests/dbVerification/`, one of the 22 — `fileBackupDbIntegration.test.ts` — dual-counted with `STORAGE_EMULATOR_REQUIRED`). This counts distinct `.test.ts` files by runtime dependency, independent of how many package scripts point at them or how those scripts are aggregated.

2. **23 — a *package-script count*, silently inside one specific aggregate (legacy `server:test`).** P1's own direct computation (`legacyServerTestPreExistingDbMixingFinding`): 23 `test:*` scripts already chained inside the existing, unmodified `server:test` full-suite aggregate that are `databaseRequired: true` in F1-002-P1's own JSON. This is **not** the same population as the file-count-22 above — it overlaps partially (e.g. `test:kvkk-high007-high008-schema-integrity`, `test:messages-consent-gate` are in the 23 but were not among F1-002-P2's original 22 DISPOSABLE_POSTGRES files, because F1-002-P2 classified those 2 under its separate `POSTGRES_PLUS_MIGRATIONS`/other groupings) — the 22 and the 23 are two different classification passes over overlapping-but-not-identical sets, one file-centric (F1-002-P2), one script-chain-centric (F1-003-P1). **Do not sum or equate these two numbers.**

3. **9 — an *aggregate-member count*.** The exact membership of the new `server:test:disposable-db` aggregate P1 created: `test:kvkk-high006-db-clinic-scope-access`, `test:kvkk-high006-db-record-owned-mutation-scope`, `test:kvkk-high006-db-target-clinic-creation`, `test:kvkk-high006-db-insurance-list-behavior`, `test:kvkk-high006-db-plan-limits-quota`, `test:kvkk-high006-db-input-handling`, `test:appointment-request-conversion-atomicity`, `test:platform-admin-password-recovery`, `test:meta-whatsapp-post-booking`. This is a *subset selection* P1 made — it deliberately excludes the 23-count scripts above (already reachable via legacy `server:test`, not duplicated) and deliberately excludes the 1-count `server:test:storage-integration` member (dual Postgres+MinIO requirement, kept in its own aggregate).

4. **1 — the current `server:test:storage-integration` aggregate-member count.** `test:file-backup-db-integration` only.

5. **10 — a *file-set count* (the corrected DB-required exclusion group from the original 17 aggregate-chain exclusions).** P1's own correction (§6/`p1CorrectionsApplied`): `test:platform-admin-password-recovery` was moved from the "no apparent reason" bucket into the DB-required bucket, making it 10 (not 9), because F1-002-P1's own prose (not its JSON) had misclassified it. Of these 10, one (`test:kvkk-high006-db-verification`) is a **duplicate alias** of the 6 `test:kvkk-high006-db-*` leaf scripts already counted in group 3 above — it is its own JSON record (`aggregateProfile: disposable_db_group_alias_aggregator`) but is not an 11th independent script for chaining/provisioning purposes. This is the "1 duplicate alias" the task brief's count vocabulary names.

6. **114 — a *canonical script-record count*.** P1's total: 103 pre-existing (from F1-002-P1) + 8 new leaf + 3 new aggregate = 114 records in `F1-003-P1_test_execution_contract.json`. This is a record-bookkeeping count (one JSON object per canonical script name), not a file count and not a runtime-dependency count — it includes non-DB scripts, aggregates, and the alias record above, all as equal-weight "records."

7. **137 — a *program-wide verification-target count*.** F1-002's own inventory total: 105 backend + 9 frontend test files + 22 other verification targets (9 bridge-agent test files, 4 windows-bridge .NET test projects, 4 windows-bridge installer PowerShell scripts, 4 manual `verify-*.ts` disposable-DB scripts, 1 production-safe healthcheck script). This is the broadest count in the program and is **not** a subset or superset relationship with any of counts 1-6 above in a simple arithmetic sense — it spans backend, frontend, bridge-agent, and .NET/PowerShell targets that counts 1-6 (all backend-`server/`-script-scoped) do not include at all.

**Explicit rule for F1-003-P2 and all future evidence:** file counts (1), package-script counts (2/3/4/5), aggregate-record counts (6), and program-wide verification-target counts (7) must always be labeled with which of these four categories they belong to. None may be added, subtracted, or compared across categories without restating the category boundary, per this reconciliation's own explicit finding that at least two prior evidence passes (F1-002-P1's MD prose in two places, corrected by P1 itself in §6/§9 of its own report) produced numeric inconsistencies exactly by blurring this distinction.

None of these 24 files (22 DISPOSABLE_POSTGRES + 2 POSTGRES_PLUS_MIGRATIONS, i.e. `kvkkHigh007High008SchemaIntegrity.test.ts` + the manual `verify-kvkk-high007-high008-rollback-tenant.ts`) apply migrations themselves — this finding is unchanged from the original design and independently reconfirmed by P1's own §4 Q3 finding (no test file shells out to `prisma migrate deploy`/`migrate dev`/`db push`).

## 6. MinIO-dependent target reconciliation (§B)

**The original design identified exactly one MinIO-dependent target: `fileBackupDbIntegration.test.ts`. P1 additionally flagged a second candidate: `kvkkAttachmentImagingLifecycle.test.ts` / script `test:kvkk-lifecycle`. This reconciliation pass independently read `kvkkAttachmentImagingLifecycle.test.ts` in full (1483 lines) to resolve the discrepancy — the answer is not the same for both files.**

**Direct-read finding:** `kvkkAttachmentImagingLifecycle.test.ts` imports `S3Client` from `@aws-sdk/client-s3` (line 100) and, in exactly 2 of its ~54+ test cases (the "53-54. saveFileFromPath temp-file cleanup (S3 mode, mocked client)" section, lines 952-994), **overrides `S3Client.prototype.send`** with an in-process mock function before exercising the S3 code path, then restores the original `.send` in a `finally` block. No test case in this file ever calls `.send()` against a real network endpoint — every S3-shaped code path in this file is exercised exclusively through the prototype-level mock. This directly confirms the finding the original design had only carried forward from F1-002-P2's inference (F1-002-P2 itself did not open this file to its S3-mocking code, per its own §6: "`kvkkAttachmentImagingLifecycle.test.ts` is the one file that does construct an S3 client, but mocks the send method").

`fileBackupDbIntegration.test.ts`, by direct re-read (unchanged from the original design's own full read), constructs a **real** `S3Client` (lines 358-366) and issues an actual `adminS3.send(new CreateBucketCommand(...))` call with **no mock, no stub, no conditional branch** anywhere in the file — every S3 operation in this file requires a genuinely reachable MinIO/S3-compatible endpoint.

**Resolution of the 7 sub-questions the task brief poses:**

1. **Are both truly MinIO/S3-emulator-required?** No. Only `fileBackupDbIntegration.test.ts` is. `kvkkAttachmentImagingLifecycle.test.ts` imports the AWS SDK and exercises S3-shaped code paths, but every actual network call in the file is intercepted by an in-process mock — it requires **zero** reachable S3/MinIO endpoint to pass.
2. **Mandatory or conditional?** `fileBackupDbIntegration.test.ts`: mandatory, unconditional (no mock branch exists in the file). `kvkkAttachmentImagingLifecycle.test.ts`: **not applicable** — the file's MinIO/S3 "dependency" is entirely mocked; there is no real dependency to be mandatory or conditional about. Its only genuine external-runtime dependency is PostgreSQL (`DATABASE_URL`), like the other 22 DISPOSABLE_POSTGRES files.
3. **Is real external S3 access impossible?** For `kvkkAttachmentImagingLifecycle.test.ts`: yes, structurally impossible as written — the mock replaces the prototype method before any S3-shaped call in those 2 test cases, and no other test case in the file constructs an `S3Client` at all. For `fileBackupDbIntegration.test.ts`: real external S3 access is not impossible — the file will happily talk to any reachable endpoint named by `MINIO_ENDPOINT`/`FILE_BACKUP_S3_ENDPOINT`, which is exactly why this design's production-endpoint guard (§18/§productionEndpointGuardPolicy) exists.
4. **Which canonical runtime profile owns each target?** `fileBackupDbIntegration.test.ts` / `test:file-backup-db-integration` → `server:test:storage-integration` (Postgres + MinIO). `kvkkAttachmentImagingLifecycle.test.ts` / `test:kvkk-lifecycle` → Postgres-only requirement; it is already a member of legacy `server:test`'s silently-DB-required 23-script set (§5 count-2) and does **not** belong in `server:test:storage-integration` (it needs no MinIO) — it is a `server:test:disposable-db`-*shaped* target (Postgres-only) that P1 deliberately left inside legacy `server:test` rather than duplicating (§9a).
5. **Must `server:test:storage-integration` be expanded?** No. Its correct, final membership is exactly `test:file-backup-db-integration` (1 member) — the only script in this entire program with a genuine, unconditional, unmocked MinIO/S3 requirement. Adding `test:kvkk-lifecycle` to it would be a factual error (it has no MinIO requirement) and is explicitly rejected.
6. **Does legacy `server:test` remain mixed?** Yes — unchanged finding from P1: legacy `server:test` contains 23 DB-required scripts (including `test:kvkk-lifecycle`, Postgres-only) but **zero** genuinely MinIO-required scripts once `test:kvkk-lifecycle` is correctly reclassified as Postgres-only-with-mocked-S3. `fileBackupDbIntegration.test.ts` was never part of legacy `server:test` in the first place (it is new, dedicated to the new `server:test:storage-integration` aggregate) — so legacy `server:test`'s own MinIO footprint, corrected by this reconciliation, is **zero**, not one. This corrects P1's own `additionalMinioRequiredMemberOfLegacyChain` field, which characterized `test:kvkk-lifecycle` as "additionally requir[ing] MinIO/S3" — P1 derived this solely from F1-002-P1's JSON field `externalServiceDetail: ["aws-s3"]`, without opening the file to check whether that SDK usage is mocked. This reconciliation's own direct read (this section) is the first evidence document in this program to open `kvkkAttachmentImagingLifecycle.test.ts` to its actual S3-mocking code and is treated as the authoritative correction, the same way P1 itself corrected `platformBackup.test.ts`'s stale carried-forward classification by direct execution (P1 §6, correction 2) — an analogous "verify by reading the actual code, not the inherited field" correction.
7. **How is duplicate execution prevented?** `test:kvkk-lifecycle` remains solely inside legacy `server:test`, never added to `server:test:storage-integration` or any future MinIO-specific profile (§6 above already establishes it has no MinIO requirement to place there). `test:file-backup-db-integration` remains solely inside `server:test:storage-integration`. Any future canonical CI profile (§D) must invoke each named script exactly once per profile run, composing aggregates explicitly (e.g. `server:test:non-disposable && server:test:disposable-db && server:test:storage-integration` for a nightly disposable-runtime profile) rather than nesting one aggregate inside another's chain.

**Final canonical MinIO target list (authoritative, this document): exactly one script requires a real, running MinIO/S3-compatible instance: `test:file-backup-db-integration` (`server/src/tests/dbVerification/fileBackupDbIntegration.test.ts`), owned by `server:test:storage-integration`.** No other script in this program's current 114-record inventory has an unmocked S3/MinIO dependency.

## 7. Current environment-variable and connection behavior (unchanged from original design)

Restated, not re-derived: `DATABASE_URL` is read once at `server/src/db.ts` import time; no test file or helper constructs, derives, or overrides it. MinIO env vars (`MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`) are read only inside `fileBackupDbIntegration.test.ts`, with hardcoded fallback defaults. `FILE_BACKUP_S3_*` variables are the application's own production-facing configuration surface, reused by that one test to point the real `fileBackupDestination.ts` code path at the disposable MinIO instance under test. This reconciliation found nothing in P1's merged evidence that changes any of this.

## 8. Current collision risks (unchanged from original design, restated)

No central port/database-name/container-name/bucket-name registry, lock file, or dynamic-allocation mechanism exists anywhere in this repository — P1's own merge did not add one (P1's own scope was script/runner closure, not provisioning). `fileBackupDbIntegration.test.ts`'s bucket name (`` `file-backup-review-${Date.now()}` ``) remains the single new collision surface this design's naming algorithm (§13) replaces. P1's own `f1003p2Handoff.inputsProvided` explicitly re-confirms this gap "unmitigated," citing the same F1-002-P2 evidence this design already cited — no new information, no change to this design's §9-§17 provisioning design.

## 9. PostgreSQL/MinIO provisioning design (unchanged from original design)

§9 through §17 of the original design (PostgreSQL provisioning options considered, selected design and rationale, MinIO provisioning options considered, selected design and rationale, port/database/schema/bucket isolation contract, setup/readiness/migration sequence, cleanup and orphan-sweeper design, local Windows execution design, GitHub Actions execution design) are **unchanged by this reconciliation** — P1's merged evidence does not affect any provisioning-mechanism decision, only the *target script list* those mechanisms must run against, which is now finalized in §5/§6/§9a/§C above and below. Readers should treat §9-§17 of the original design (preserved verbatim in this document's git history, reachable via `git show c45b37c:docs/program/evidence/F1-003-P2A_DISPOSABLE_RUNTIME_PROVISIONING_DESIGN.md`) as still-current provisioning-mechanism design; this reconciliation pass's job is the target-set/policy reconciliation (§5, §6, §9a-§K), not a rewrite of the container/naming/cleanup mechanism itself.

## 9a. Legacy `server:test` policy (§C)

**Adopted policy, per the task brief's own preferred default (no repository evidence found to disprove it):**

1. **Preserve legacy `server:test` for backward compatibility.** It is not renamed, restructured, or reordered by this reconciliation or by any decision this document makes for F1-003-P2.
2. **Formally classify legacy `server:test` as a mixed full-runtime aggregate requiring disposable PostgreSQL** (23 silently-chained DB-required scripts, §5 count-2) **but not MinIO** (§6 corrects P1's own finding that `test:kvkk-lifecycle` needed MinIO — it does not; its S3 usage is fully mocked). Legacy `server:test`'s accurate runtime classification is: `MIXED_PURE_NODE_AND_DISPOSABLE_POSTGRES` — Postgres-required for a correct, all-green run; MinIO-free.
3. **Legacy `server:test` is not the non-disposable PR gate.** `server:test:non-disposable` (P1's new, 68-member, structurally-DB/MinIO-free aggregate) is the PR-safe gate; legacy `server:test` remains a DB-requiring aggregate not safe to run without F1-003-P2's disposable Postgres.
4. **Do not remove or reorder legacy `server:test`'s members in F1-003-P2.** Untangling it (removing its 23 DB-required members into a dedicated aggregate, i.e. making `server:test` itself DB-free) is explicitly **out of scope** for F1-003-P2 unless a separate, explicitly-authorized task chooses to do so — this would be an application/script-behavior change requiring its own authorization, per P1's own explicit acceptance-criterion wording (`f1003p2Handoff.acceptanceCriteria` item 4: "either decision satisfies this criterion; silence does not").
5. **Do not duplicate every legacy DB member into `server:test:disposable-db` merely for count symmetry.** P1 already made this decision (§5 count-2 vs count-3 are deliberately disjoint, non-overlapping-by-duplication sets) and this design ratifies it — duplicating would create two independent invocation paths for the same underlying test file, risking double-execution/double-fixture-creation under a single CI profile.
6. **Use explicit profile composition, not aggregate nesting, in future runner scripts.** A future nightly/full-runtime profile must invoke `server:test:non-disposable`, `server:test:disposable-db`, `server:test:storage-integration`, and legacy `server:test` as sibling steps in one job (not one calling another), each against the **same** already-provisioned, already-migrated disposable Postgres/MinIO instance for that job run — this prevents both duplicate execution (§6 sub-question 7) and duplicate container/database provisioning within one profile run.

**No alternative policy was found better-supported by repository evidence.** The preferred policy above is adopted as-is.

## 10. Alias and aggregate ownership matrix (§D)

| Aggregate/script | Members / selection rule | Runtime dependencies | Canonical or compatibility-only | Duplicate execution allowed? | CI eligibility | Expected current exit status | Setup/cleanup owner |
|---|---|---|---|---|---|---|---|
| `server:test:non-disposable` | 68 explicit members (P1-defined; `test:overdue-installments` deliberately last) | None (pure Node / in-process mock only) | **Canonical** — the authoritative "safe without disposable runtime" aggregate | N/A — no other aggregate duplicates these members | PR: yes; main: yes; nightly: yes; release: yes | **exit 1** (sole known cause: `test:overdue-installments`, 7 passed/2 failed, pre-existing product/test drift — §11/§F1-003-B1) | No infra owner — no cleanup required (in-process only) |
| `server:test:disposable-db` | 9 explicit members (§5 count-3) | Disposable PostgreSQL only | **Canonical** — the authoritative new-aggregate DB-only provisioning target | No — none of its 9 members appear in any other aggregate | PR: no (until F1-003-P2 lands); main: no; nightly: yes (once F1-003-P2 lands); release: yes | `not_executed_dependency_blocked` (no disposable Postgres exists yet) | F1-003-P2's provisioning mechanism (Postgres container-per-run, §9-§15 of the original design) |
| `server:test:storage-integration` | 1 explicit member (`test:file-backup-db-integration`) | Disposable PostgreSQL **and** disposable MinIO | **Canonical** — the sole genuine MinIO-required target's dedicated aggregate | No | PR: no; main: no; nightly: yes (once F1-003-P2 lands); release: yes | `not_executed_dependency_blocked` | F1-003-P2's provisioning mechanism (Postgres + MinIO container-per-run) |
| Legacy `server:test` | Full 77-script `&&`-chained legacy aggregate, unmodified by P1 (byte-for-byte) | Disposable PostgreSQL (23 silently-chained members, §5 count-2); **no** MinIO (§6 correction) | **Compatibility-only** — preserved for backward compatibility, not the canonical DB-required gate (that role belongs conceptually to `server:test:disposable-db`+`server:test:storage-integration` for *new* targets, while legacy `server:test`'s own 23 members remain reachable only through it) | Yes, by design/necessity — its 23 DB-required members are **not** duplicated elsewhere (§9a item 5), but running legacy `server:test` **and** `server:test:disposable-db`/`server:test:storage-integration` in the same profile run does **not** re-execute any shared script (the two aggregates' memberships are disjoint) | PR: no (DB-required); main: no; nightly: yes (once disposable Postgres exists); release: yes | Not executed by P1 (structural validation only for the 2 new aggregates; legacy `server:test` itself was not re-run by P1 — it was already known DB-mixed before P1) | F1-003-P2's provisioning mechanism, once P2 explicitly decides (per §9a item 4) whether legacy `server:test` is provisioned in P2 or deferred |
| Future full-runtime wrapper | Not yet created — would compose `server:test:non-disposable` + `server:test:disposable-db` + `server:test:storage-integration` + legacy `server:test` as sibling steps (§9a item 6), never nested | All of the above, superset | Not yet created — a P2/P3-era artifact | Must be explicitly engineered to avoid duplication (§9a item 6) | Nightly/release only, never PR/main | N/A — does not exist yet | Whichever future task creates it |
| Future PR profile | `root: npm run build` + `server: npm run typecheck` + `server: npm run server:test:non-disposable` | None beyond Node/tsc | Canonical, per P1's `futureCiCommandMatrix.pr` | N/A | PR | Blocked today on `test:overdue-installments` (§14) for a "required, must be green" gate; usable today as a "required, known-failure carved out" gate if the program accepts that framing (not decided by this document) | No infra owner |
| Future main profile | Same as PR profile, re-run at merged-`main` tip | None beyond Node/tsc | Canonical, per P1's `futureCiCommandMatrix.main` | N/A | main | Same as PR profile | No infra owner |
| Future nightly profile | Legacy `server:test` + `server:test:non-disposable` + `server:test:disposable-db` + `server:test:storage-integration` + root frontend + `root:test:vitest` + bridge-agent `npm run test`, against one freshly-provisioned disposable Postgres 16 + MinIO instance | Disposable Postgres + MinIO for the DB/storage members | Canonical, per P1's `futureCiCommandMatrix.nightly` | Must not duplicate (§9a item 6) | nightly | Blocked entirely on F1-003-P2 (no provisioning exists) | F1-003-P2's provisioning mechanism |
| Future release profile | Nightly set + migration deployment/upgrade verification (forward-only) + production-like smoke in a non-production environment | Disposable Postgres + MinIO + migration tooling | Canonical, per P1's `futureCiCommandMatrix.release` | Must not duplicate | release | Blocked on F1-003-P2 (nightly prerequisite) **and** R-070 (rollback-rehearsal profile, if ever included, remains opt-in/non-default) | F1-003-P2's provisioning mechanism + a separate, not-yet-authorized migration-rollback-tooling task for anything beyond forward-only verification |

## 11. Overdue-installments blocker (§E)

P1 established, by direct execution (not assumed): `server:test:non-disposable` (68 members) executes end-to-end and exits **1**, with the **sole** known failure being `test:overdue-installments` — exact result **7 passed, 2 failed** in that one test file, a deterministic, pre-existing product/test drift (production code now writes/reads a literal `'overdue'` status value this orphan test still assumes differs; documented since F0-005, reconfirmed by F1-002-P1 §4.1/§9, and now independently re-executed and reconfirmed by P1 itself). This reconciliation pass did not re-execute this test (no application tests are authorized in F1-003-R1, §24) — P1's own execution record (§11.3/§12 of P1's report, cited here) is accepted as authoritative, historical evidence, **not** re-run or re-verified by this task.

**This is recorded as a hard prerequisite for P3 workflow activation.** This reconciliation does not fix it, does not remove or skip the test, and does not mark the non-disposable aggregate green. `server:test:non-disposable`'s real, current, accepted status is: **exit 1, by design/acceptance, not by defect** — the aggregate correctly propagates a real product/test drift rather than hiding it.

**Follow-up task defined (not executed by this reconciliation):**

**F1-003-B1 — Overdue Installments Baseline Drift Resolution.** Scope: resolve the deterministic 2-assertion drift in `server/src/tests/overdueInstallments.test.ts` against current production code's `'overdue'` status-literal behavior — either update the test's expectations to match current intentional product behavior, or fix a genuine product regression, whichever the drift's root-cause analysis determines. Must not weaken, skip, or `|| true` the test. Must not touch disposable-runtime provisioning. Exact acceptance criterion: `server:test:non-disposable` (68 members, unchanged membership) executes end-to-end with **exit 0**, all 68 members passing, no member removed or reclassified to make this true. **This reconciliation (F1-003-R1) does not execute F1-003-B1** — it is named here as the exact, precise prerequisite that must be satisfied, separately, before any CI profile treats `server:test:non-disposable`'s exit code as a required, must-be-green PR/main gate. Until F1-003-B1 completes, any future PR/main CI wiring of `server:test:non-disposable` must either (a) treat it as informational/non-blocking, or (b) explicitly carve out `test:overdue-installments`'s known failure from the gate's pass/fail determination via a documented, narrow exception — never by removing the test from the aggregate.

## 12. Cleanup failure policy (§F)

**The original design's cleanup-failure policy (§15 of the original design, and `failSafeRules.cleanupFailure` in the original JSON) proposed treating cleanup failure as warn/non-fatal in all cases. This reconciliation replaces that with the task brief's stricter, final policy — no part of the original warn-only rule survives unchanged:**

- **Provisioning failure:** FAIL.
- **Readiness failure:** FAIL (unchanged from original design — 60s bounded timeout, no indefinite retry).
- **Migration failure:** FAIL (unchanged — non-zero exit or any reported pending migration after `migrate deploy`).
- **Test failure:** FAIL (the runtime job's own exit code reflects the real test outcome, never swallowed).
- **Production-like endpoint detection:** FAIL CLOSED, before any provisioning command runs (unchanged from original design, now stated as a hard rule with no exception).
- **Missing runtime credential/config:** FAIL CLOSED (unchanged from original design).
- **Cleanup failure after successful tests: FAIL the runtime job.** This **reverses** the original design's warn-only rule — a runtime job that passed its tests but then failed to remove its own disposable container(s)/database/bucket must not be reported as a clean success; the job's own exit code must reflect the cleanup failure.
- **Cleanup failure after failed tests: preserve the original test failure as the primary, reported failure, and additionally, separately report the infrastructure cleanup failure** — the two must not be conflated into one opaque failure message; both facts must be visible in the job's output.
- **Local orphan resource:** non-zero exit **plus** an actionable cleanup command printed to the operator (e.g. the exact `docker rm -f <name>` to run), not a silent warning.
- **CI orphan resource:** the cleanup step must run with always/finally semantics (e.g. GitHub Actions `if: always()` on the cleanup step), so it executes regardless of the test step's own outcome.
- **Sweeper:** remains defense-in-depth only (unchanged from original design, §15) — it is not the primary success criterion for any single run's cleanup; the run's own cleanup step succeeding or failing is the primary signal now that cleanup failure is fail-fatal (this is precisely why the sweeper's role changes from "the only real backstop" (original design) to "genuine defense-in-depth" (this reconciliation) — the primary path is no longer allowed to silently rely on it).

**Exception required and why:** none. The task brief's stricter policy is adopted in full, with no carve-out — the original design's rationale for warn-only ("failing a green CI run over an unrelated Docker-daemon flake would produce false negatives") is superseded by the task brief's explicit instruction; a flaky `docker rm` is now expected to surface as a real, actionable failure rather than being absorbed silently, on the theory that a silently-leaked container/database/bucket is itself a real problem (resource exhaustion, potential collision with a future run) that deserves visibility, not suppression.

## 13. PostgreSQL version evidence (§G)

**No authoritative repository/deployment inventory recording production PostgreSQL's major version was found by this reconciliation pass.** Searched: `docs/program/` evidence and tracker files (grep for "postgres" version strings), `server/.env.example`, `server/prisma/schema.prisma`'s `datasource` block (engine-agnostic, no version pin), deployment-related evidence documents already cited elsewhere in this program (`KVKK-HIGH-008-F1_PRODUCTION_DEPLOYMENT_VERIFICATION.md` and similar, cited by `RISK_REGISTER.md`'s R-046/R-070 rows) — none records a production PostgreSQL major version. This reconciliation did **not** access production and did **not** read any secret to search for this fact.

**Decision (unchanged from the original design, now explicitly reaffirmed rather than merely provisional):** `postgres:16-alpine` remains the provisional test-runtime choice, based on historical repository precedent (3 independent prior disposable-Postgres uses in this repository all used version-16-family images). **Production-major-version alignment is recorded as an explicit pre-P3/pre-release verification item** — not resolved by this task, not resolved by P1, not claimed as version parity by this document.

## 14. MinIO image pinning (§H)

**Implementation-ready policy (replacing the original design's example-only wording):**

- **Exact release tag required:** a specific `RELEASE.<YYYY-MM-DDThh-mm-ssZ>` MinIO release tag (MinIO's own official tagging convention) must be pinned in whatever script/workflow F1-003-P2 commits. The exact tag value itself remains a P2 implementation decision — no repository evidence constrains which specific release to choose (this is the first MinIO use in this program's history, per the original design's own finding, §11 of the original design).
- **Mutable `latest` tag is prohibited**, in CI and in any committed local-development script alike — no exception.
- **Digest pin is required for CI** (e.g. `minio/minio@sha256:<digest>` alongside or instead of the release tag) to guard against a registry-side tag-content change between CI runs; recommended (not strictly required) for local/developer-convenience scripts, where an operator re-pulling a fresh image occasionally is an acceptable tradeoff for convenience.
- **Image version and digest must both be recorded in the P2 evidence document** at implementation time — not merely referenced by tag name in a script, so that a future reviewer can confirm exactly which image content was used for that implementation's own test evidence.

## 15. Network isolation (§I)

**Distinguished, per the task brief's own required categories:**

- **Mandatory application/test-level outbound guards:** none exist today, and none are implemented by this reconciliation. The original design's recommended (not implemented) shared test-bootstrap `fetch`/`undici` dispatcher override (§18 of the original design) remains a recommendation, not a control in place.
- **Mandatory production endpoint guards:** none exist today (confirmed by this reconciliation's own re-check: no hostname allow-list/deny-list exists in `db.ts`, `dbVerificationHarness.ts`, or any DB-dependent test file). This design specifies (§18/§productionEndpointGuardPolicy) that F1-003-P2 must implement one — it is not optional in the implementation contract (§K), but it does not exist as of this reconciliation.
- **Provider mocks/stubs:** these **do** already exist and are confirmed, repeatedly, independently (F1-002-P2 §6, P1 §8's `messagesConsentGate.test.ts` resolution, this reconciliation's own §6 direct read of `kvkkAttachmentImagingLifecycle.test.ts`'s S3 mock) — every external-provider and every S3/MinIO touchpoint in the test suite except `fileBackupDbIntegration.test.ts` is fully stubbed at the code level, verified by direct read, not merely inferred.
- **Optional runner/container-level egress restriction:** recommended, not implemented, exactly as the original design stated (§18) — restricting a CI runner's own network egress to the npm registry, GitHub, and loopback for any disposable-runtime-backed job remains a recommendation for F1-003-P2 to consider, not a requirement this document mandates as a hard acceptance criterion (unlike the production-endpoint guard, which is mandatory).
- **Controls not practically enforceable on hosted GitHub runners:** full network-egress denial at the OS/firewall level is not practically enforceable on a shared, hosted GitHub Actions runner without a self-hosted runner or a third-party network-policy action — this document does **not** claim full egress denial exists or is planned; it recommends the narrower, practically-enforceable measures above (application-level fetch-dispatcher allow-listing, which *is* enforceable regardless of runner type).

**This design does not state that full egress denial exists or is implemented anywhere** — it exists nowhere in the repository today, and no part of this document's forward-looking recommendations should be read as claiming otherwise.

## 16. R-070 boundary (§J)

Restated, exactly, per the task brief's required list, unchanged in substance from the original design (§20) and independently reconfirmed against the new baseline's own `RISK_REGISTER.md` R-070 row (§3 above, re-read directly, status `OPEN`):

- `prisma migrate deploy` is forward-only.
- Empty-database migration validation is allowed (this design's migration profile 1).
- Previous-version-to-current upgrade validation is allowed (profile 2).
- Idempotency/status verification is allowed (profile 3).
- Physical rollback tooling is not implemented, by this document or by any task this document authorizes.
- `_prisma_migrations` must not be manually rewritten by P2.
- Destructive rollback rehearsal (profile 5) remains separate, opt-in, non-default.
- **F1-003-P2 does not close R-070.** Neither does this reconciliation (F1-003-R1). R-070 remains `OPEN`.

## 17. Security impact (unchanged from original design, restated)

Unchanged: this design adds two new controls beyond today's ad hoc practice (fail-closed production-URL detector; recommended network-egress guard), reduces reliance on `fileBackupDbIntegration.test.ts`'s own hardcoded MinIO credential fallback, and introduces no change to any application authorization/authentication code path, no new production access, no new external network dependency. This reconciliation's own correction (§6 — `test:kvkk-lifecycle` does not require real MinIO) narrows the actual attack/exposure surface the eventual implementation must guard, versus what P1's own (uncorrected) finding would have implied — one fewer real network endpoint needs a production-guard check than P1's raw finding suggested.

## 18. Tenant-isolation impact (unchanged from original design, restated)

None — this reconciliation, like the original design, changes only the *infrastructure hosting* test execution and the *target-set/policy* reconciliation around it, not fixture generation, authorization logic, or scope-filtering code.

## 19. KVKK/privacy impact (unchanged from original design, restated)

None — no real patient data introduced, referenced, or required. This reconciliation's own direct read of `kvkkAttachmentImagingLifecycle.test.ts` (§6) confirms its fixtures remain synthetic/mocked, consistent with every other fixture this program's evidence chain has observed.

## 20. Backward compatibility (unchanged from original design, restated)

No existing script, test file, workflow file, Prisma schema/migration, or application/runtime file is changed by this reconciliation task. Legacy `server:test` remains untouched (§9a). The design remains strictly additive.

## 21. Rollback of this reconciliation

A single `git revert` of this reconciliation's own commit (on top of the merge commit) restores this document and its companion JSON to their pre-reconciliation (original F1-003-P2A) content; the merge commit bringing in P1's evidence remains (reverting a merge commit is a separate, more complex operation not needed here, since the merge itself introduced no conflicting or incorrect content — only the reconciliation commit's own edits are the "if this needs undoing" target). No database, storage, or production rollback is implied by either commit.

## 22. Remaining unresolved items (consolidated)

1. Production PostgreSQL major-version confirmation (§13/§G) — no evidence source in this program answers it; recorded as a pre-P3/pre-release verification item.
2. Exact MinIO release tag + digest selection (§14/§H) — a P2 implementation-time decision, not constrained by existing repository evidence.
3. Whether legacy `server:test`'s own 23 DB-required members are provisioned by F1-003-P2 itself or deferred to a later task (§9a item 4/§K) — P1 explicitly left this as an open decision for P2; this reconciliation does not make that decision, it only states both options remain valid and neither may be resolved by silence.
4. `F1-003-B1` (overdue-installments drift) — named, not executed, not scheduled by this reconciliation.
5. The test-code change `fileBackupDbIntegration.test.ts` needs (bucket-naming algorithm adoption + completing its bucket-teardown path) — requires its own separate authorization, per the original design's own finding (§26 item 6, carried forward), unchanged by this reconciliation.
6. Whether a future runner/container-level egress restriction (§15) is adopted — recommended, not decided.

## 23. Explicit non-claims (this reconciliation, F1-003-R1)

This task does **not** claim: disposable-Postgres or MinIO provisioning is implemented, running, or CI-ready; any test was executed by this reconciliation task (P1's own historical execution record is cited, not re-run — see §11); a CI workflow was implemented, created, or enabled; a deployment occurred; production was accessed or verified; R-070 is resolved, mitigated, or closed (it remains `OPEN`); R-046 or R-071's status was changed by this task (both are read, not altered — R-046 `OPEN`, R-071 `CLOSURE_PROPOSED_AWAITING_EXTERNAL_CONFIRMATION`, neither `CLOSED`/`MITIGATED`); F1's exit gate is satisfied; F1 or F1-003 is complete; G1/G2 approval status has changed; the KVKK baseline is stable; PR #256 is merged; this task reached any status beyond `AGENT_COMPLETED`.

---

## K. Final F1-003-P2 implementation contract

**F1-003-P2 — Disposable PostgreSQL and MinIO Provisioning and Collision Avoidance.**

### K.1 Exact files expected to be created or changed

- `scripts/test-runtime/provision.ps1` (or equivalent path chosen at implementation time) — PowerShell-compatible local entry point, one-shot: provisions Postgres (+ MinIO if the invoked profile requires it), exports `DATABASE_URL`/`MINIO_*` into the invoking PowerShell session, runs the requested test command(s), tears down unconditionally.
- `scripts/test-runtime/provision.sh` — Bash/Linux/CI-compatible equivalent entry point, same contract, POSIX-portable (used by a future GitHub Actions job).
- `scripts/test-runtime/sweep.ps1` / `scripts/test-runtime/sweep.sh` — the stale-resource sweeper (§15 of the original design), local/worktree-only.
- A new evidence document, e.g. `docs/program/evidence/F1-003-P2_DISPOSABLE_RUNTIME_PROVISIONING_IMPLEMENTATION.md`, and a machine-readable companion JSON, recording exact commands run, exact pass/fail counts, exact image digests used (§14), and the acceptance-criteria checklist (§L) with evidence for each item.
- No `.github/workflows/**` file, unless P2's own task definition explicitly re-includes CI-workflow activation (not assumed by this contract).
- No change to `server/package.json`'s existing script definitions is required by this contract (the 9+1 target scripts and 3 aggregates already exist, from P1) — P2 may add new scripts only if it introduces new profile-composition wrapper scripts (e.g. a `server:test:nightly` composition script), which must not rename, remove, or reorder any existing script.

### K.2 Runtime and isolation requirements

- **One-container-per-run PostgreSQL**, one-container-per-run MinIO (for the storage-integration profile only) — no persistent volume for either, matching the original design's §9-§12 selected options.
- **Dynamic host-port allocation** via Docker's own `-p 127.0.0.1::5432`/`::9000` assignment, discovered via `docker port` after bind — never a pre-scan-then-bind race.
- **Collision-resistant container/database/bucket identifiers**, per the original design's §13 naming algorithm (`runKey` derived from `CI_RUN_ID`/`CI_RUN_ATTEMPT`/`process.pid`/a fresh UUID; `nmtest_<scopeTag>_<runKey>` for databases, `nmtest-<scopeTag>-<runKey>` for buckets, `nmtest-pg-<scopeTag>-<runKey>`/`nmtest-minio-<scopeTag>-<runKey>` for containers).
- **`DATABASE_URL` and MinIO env vars constructed before any Prisma/storage-dependent test file is imported** — never hardcoded, never written to a committed `.env` file.
- **Production-like endpoint guard** (§18/§I): hard-fail, before any provisioning command runs, if a caller-supplied override of `DATABASE_URL`/`MINIO_ENDPOINT` resolves to a non-loopback/non-private host or matches a known production hostname pattern.
- **Readiness timeouts:** 60s bounded, fail (not retry-forever) on timeout, for both Postgres (`pg_isready`) and MinIO (`GET /minio/health/ready`).
- **Migration-deploy sequence:** `npx prisma generate && npx prisma migrate deploy`, asserting exit 0 and zero reported pending migrations, exactly once per provisioned database, before any dependent test runs.
- **Deterministic cleanup** per §12's finalized fail-fatal policy (this reconciliation's cleanup-failure rules supersede the original design's warn-only rule).
- **Signal/interruption cleanup:** PowerShell `try/finally` + `Register-EngineEvent PowerShell.Exiting` for local Windows; POSIX `trap EXIT`/`trap INT TERM` for the Bash entry point; documented known-gap for a hard task-manager-kill on Windows (§15 of the original design, unchanged).
- **Stale-resource labels and TTL:** `noramedi.disposable-runtime=true`, `noramedi.run-scope`, `noramedi.run-id`, `noramedi.created-at` labels; 4-hour local/worktree TTL for the sweeper; no TTL/sweeper needed in CI (runner VM teardown handles it).
- **No persistent volumes, no real external providers, no production access** — hard constraints, not aspirational.

### K.3 Exact aggregate commands P2 must execute (and report pass/fail for)

1. `server:test:disposable-db` (9 members, §5 count-3) — against a freshly-provisioned, freshly-migrated disposable Postgres.
2. `server:test:storage-integration` (1 member) — against the same disposable Postgres plus a freshly-provisioned disposable MinIO.
3. Legacy `server:test` — **only if** P2's own task definition explicitly includes making it runnable (§9a item 4 leaves this an open P2-time decision, not pre-decided here); if deferred, P2's evidence must explicitly state the deferral, per P1's own acceptance criterion (silence is not acceptable).
4. The 5 migration profiles named in the original design's JSON (`migrationProfiles` — profile 1 empty-DB deploy, profile 2 previous-to-current upgrade, profile 3 idempotency/status, profile 4 application-test-execution-after-migration, profile 5 destructive rollback rehearsal, explicitly opt-in/non-default).

### K.4 Concurrency and collision testing

**Two-run parallel collision testing is mandatory** — at least two concurrent disposable-runtime invocations (two CI matrix legs, or one CI run plus one local/worktree run) must be demonstrated not to collide (distinct container/database/bucket names and ports, verified in evidence, not merely asserted), per the original design's own acceptance criterion, carried forward unchanged.

### K.5 Legacy `server:test` in P2 vs P4

**Not pre-decided by this contract** — per §9a item 4, this is an explicit P2-time decision with two acceptable outcomes (provision it now, or defer with a documented reason). Deferring it to a later task (candidate ID: a future F1-003-P4, if the current phase-doc's own task numbering reaches that point) is one acceptable resolution; provisioning it as part of P2 is the other. P2's own evidence must state which was chosen and why.

### K.6 Exact migration scope and rollback method

- **Migration scope:** forward-only `prisma migrate deploy` against a freshly disposable, empty database, applying the full current migration set (67+ directories as of this reconciliation's own baseline, expected to keep growing) — no new migration is created by P2 itself.
- **Rollback method:** none automated. Profile 5 (destructive rollback rehearsal) is hand-authored, opt-in, non-default, mirrors F0-011-P2's own already-completed methodology, and does not introduce new automated rollback tooling. R-070 remains open and is not addressed by any part of this contract.

## L. F1-003-P2 acceptance criteria (falsifiable)

1. Repository-committed provisioning entry points exist for local Windows (PowerShell) and Linux/CI-compatible (Bash) execution.
2. PostgreSQL is one disposable container per run, no persistent volume.
3. MinIO is one disposable container per run, no persistent volume.
4. Host ports are dynamically assigned by Docker, not pre-scanned.
5. Every run receives collision-resistant container, database, and bucket names, per the naming algorithm in §13 of the original design.
6. `DATABASE_URL` and MinIO variables are established before importing any Prisma/storage-dependent test.
7. Production-like endpoints are rejected before any migration or test starts.
8. `prisma migrate deploy` succeeds against a fresh disposable database.
9. `server:test:disposable-db` executes with exact pass/fail counts (9 members, real numbers, not `not_executed_dependency_blocked`).
10. The canonical storage-integration profile (`server:test:storage-integration`) executes its single reconciled MinIO-dependent target (`test:file-backup-db-integration`) exactly once.
11. At least two disposable runtime invocations execute concurrently without port/database/bucket collision.
12. Normal-success cleanup leaves zero labeled containers, volumes, databases, buckets, or test objects.
13. Forced test failure still triggers cleanup.
14. Forced interruption/cancellation cleanup is demonstrated where the local platform permits it.
15. Cleanup failure after successful tests produces a non-zero runtime-job exit (§12, this reconciliation's stricter rule).
16. No live external provider call occurs.
17. No production access or real patient data occurs.
18. No schema migration is created.
19. R-070 remains OPEN.
20. P2 reaches at most `AGENT_COMPLETED` / `PR_OPENED_AWAITING_REVIEW`.
21. F1 exit gate remains unsatisfied.
22. P3 workflow activation remains blocked by the overdue-installments baseline drift (§11/F1-003-B1) unless F1-003-B1 is separately completed.

---

## 28. Explicit non-claims (original design, preserved)

This task (the original F1-003-P2A pass, and this reconciliation, F1-003-R1, alike) does **not** claim: disposable-Postgres or MinIO provisioning is implemented, running, or CI-ready; R-070 is resolved, mitigated, or closed; F1's exit gate is satisfied; CI readiness or runtime readiness in any form; G1/G2 approval status has changed in any way; any application test was executed, passed, or failed by either pass (P1's own historical execution record is cited as authoritative evidence, not re-executed); a production database or production storage endpoint was accessed; F1-003-P1's script/runner/classification decisions are final or unreconciled with this design (they are now fully reconciled, §4a); F1 is complete; this task reached any status beyond `AGENT_COMPLETED`.

---

*Companion machine-readable artifact: [F1-003-P2A_disposable_runtime_contract.json](F1-003-P2A_disposable_runtime_contract.json), itself reconciled by this same pass (F1-003-R1). No separate runtime-dependency inventory JSON was produced by this reconciliation — [F1-002-P2_test_runtime_requirements.json](F1-002-P2_test_runtime_requirements.json), [F1-002-P2_disposable_environment_capabilities.json](F1-002-P2_disposable_environment_capabilities.json), and [F1-003-P1_test_execution_contract.json](F1-003-P1_test_execution_contract.json) already provide an exhaustive, independently-validated inventory this reconciliation builds directly on.*

# F2-PREP-007-E — Imaging Characterization Wave Consolidation and Program-Control Update

**Task:** F2-PREP-007-E — Stage 0 Imaging Characterization Wave Consolidation and Program-Control Update
**Phase:** F2 — Modularization Preparation / Early Implementation Gate. F1 remains `IN_PROGRESS`.
**Type:** Consolidation, permanent test-ownership wiring, and program-control update only. This task closes the Stage 0 characterization wave only. It does **not** authorize runtime modularization, caller migration, public-contract exposure, production deployment, or remediation of any characterized defect.

## 1. Pre-flight verification

```
git fetch origin main
git rev-parse origin/main
-> 0d48d9fdea5d33f0a1acf88da9060702526c8bd1

for sha in 43b92dde43e4c0606a6333997a81de7ea3ed247c \
           bfc1b7317e95881fa68306a0f190f3d0570596a3 \
           801ddbe4714b9aa92bafa4689be9c474eb2270db \
           0d48d9fdea5d33f0a1acf88da9060702526c8bd1; do
  git merge-base --is-ancestor $sha origin/main && echo ancestor-OK
done
-> ancestor-OK x4

gh pr view 293 --json number,title,state,mergeCommit,mergedAt
gh pr view 294 --json number,title,state,mergeCommit,mergedAt
gh pr view 295 --json number,title,state,mergeCommit,mergedAt
gh pr view 296 --json number,title,state,mergeCommit,mergedAt
-> all state=MERGED, mergeCommit.oid matches exactly:
   293 -> 43b92dde43e4c0606a6333997a81de7ea3ed247c (F2-PREP-007-A), mergedAt 2026-08-02T21:04:25Z
   294 -> bfc1b7317e95881fa68306a0f190f3d0570596a3 (F2-PREP-007-B), mergedAt 2026-08-02T20:21:37Z
   295 -> 0d48d9fdea5d33f0a1acf88da9060702526c8bd1 (F2-PREP-007-C), mergedAt 2026-08-02T21:33:44Z
   296 -> 801ddbe4714b9aa92bafa4689be9c474eb2270db (F2-PREP-007-D), mergedAt 2026-08-02T20:37:23Z

gh run view 30768167540 --json headSha,event,workflowName,conclusion,status
-> headSha 0d48d9fdea5d33f0a1acf88da9060702526c8bd1 (exact match to origin/main tip),
   event push, workflowName ci-main-and-nightly, conclusion success, status completed,
   9/9 ci-layers jobs success (Layer 1 x4, Layer 2, Layer 3, Layer 4, Layer 5 x2)
```

`origin/main`'s tip is exactly PR #295's own merge commit — the baseline supplied in the task brief matched the repository exactly; no reconciliation against a more-advanced `origin/main` was necessary. PR #296 (F2-PREP-007-D) merged chronologically before PR #295 (F2-PREP-007-C) but both merge commits, and PR #293/#294's, are confirmed ancestors of the final `origin/main` tip — no ordering inconsistency affects this task.

## 2. Worktree

The primary working tree (branch `claude/treatment-proposal-pdf-p1-d4k0jl`) was found mid-merge (`MERGE_HEAD` present, conflicts already resolved but not committed) on an unrelated task and was **not touched** by this task in any way. A fresh, fully isolated `git worktree` was created directly from `origin/main` @ `0d48d9fdea5d33f0a1acf88da9060702526c8bd1`, branch `docs/f2-prep-007-e-imaging-characterization-consolidation`. No sibling F2-PREP-007-A/B/C/D worktree was reused, entered, or read from directly — every sibling's content was read exclusively through its own merged evidence file and merged test file under this worktree's own `origin/main`-derived tree.

## 3. Merged sub-tasks — status and main-CI verification

| Sub-task | PR | Merge commit | Merged at (UTC) | Ancestor of `origin/main` | Post-merge main CI |
|---|---|---|---|---|---|
| F2-PREP-007-A | #293 | `43b92dde43e4c0606a6333997a81de7ea3ed247c` | 2026-08-02T21:04:25Z | Confirmed | Superseded by later pushes to `main`; final baseline CI evidence recorded against the wave's aggregate tip below |
| F2-PREP-007-B | #294 | `bfc1b7317e95881fa68306a0f190f3d0570596a3` | 2026-08-02T20:21:37Z | Confirmed | Same as above |
| F2-PREP-007-C | #295 | `0d48d9fdea5d33f0a1acf88da9060702526c8bd1` | 2026-08-02T21:33:44Z | Confirmed (**is** the current `origin/main` tip) | `gh run 30768167540`, `ci-main-and-nightly`, head SHA exactly equal to this merge commit, **9/9 `ci-layers` jobs `success`** |
| F2-PREP-007-D | #296 | `801ddbe4714b9aa92bafa4689be9c474eb2270db` | 2026-08-02T20:37:23Z | Confirmed | Same as above |

All four are `MERGED` / `MAIN_CI_PASSED` as of this task. The single authoritative post-merge run (`30768167540`) has a head SHA identical to `origin/main`'s current tip (PR #295's own merge commit) and post-dates all four sub-task merges — it is the correct, and only necessary, aggregate CI confirmation for the wave.

## 4. Stage 0 coverage matrix

Sourced from the accepted `F2-PREP-006-E_IMAGING_BOUNDARY_CONTRACT.md` §14 characterization-test gate (32 total: 21 blocking / 11 non-blocking / 0 deferred-F10) and each sub-task's own evidence document. Terminology preserved exactly from the originating documents.

### 4.1 Mandatory-before-refactor bucket (18 tests — gate: "Stage 1 (additive facade) may not begin until these pass against current behavior")

| Test ID | Suite (file) | Behavior characterized | Status |
|---|---|---|---|
| CT-02 | B — `imagingCharacterizationTenantLifecycle.test.ts` | `ListPatientImaging` rejects cross-clinic patient/study access | Expected behavior confirmed |
| CT-03 | B | `ImagingBridgePairingDevice` access stays tenant-scoped via parent pairing (`pairingId`-transitive join-scoping) | Expected behavior confirmed |
| CT-06 | A — `imagingCharacterizationAuthShape.test.ts` | `imagingBridgePublic.ts` Bearer auth rejects a clinic-session JWT (401) | Expected behavior confirmed |
| CT-07 | C — `imagingCharacterizationIngestStorage.test.ts` | Manual upload (`CreateImagingStudy`) persists correct `ImagingImage` metadata and readable bytes | Expected behavior confirmed |
| CT-08 | C | Bridge ingest with a linked open `ImagingRequest` atomically creates study/image and advances the request to `received` | Expected behavior confirmed |
| CT-10 | C | Sequential duplicate bridge ingest (`findFirst` pre-check) returns `duplicate:true`, no second write | Expected behavior confirmed |
| CT-11 | C | Concurrent identical bridge ingest — `@@unique([clinicId, ingestKey])` P2002 race, loser's file deleted | Expected behavior confirmed |
| CT-12 | C | Duplicate manual uploads are not idempotent (`NULL ingestKey` never collides) | Current behavior characterized — **documented intentional current behavior, not a defect**, matching F2-PREP-006-D's `idempotencyRules` for `CreateImagingStudy` |
| CT-13 | C | Manual-route `$transaction` failure (concurrent request-closing race) triggers catch-block file-delete compensation | Expected behavior confirmed |
| CT-14 | C | Bridge P2002 race loser deletes its own file, returns winner's `studyId` | Expected behavior confirmed |
| CT-16 | A | `legalHoldReason` redaction uniform across `GetImagingStudy`, `ListPatientImaging`, `ListUnlinkedImagingStudies`, `CreateImagingStudy` | Expected behavior confirmed |
| CT-17 | B | Archive/unarchive changes only `ImagingStudy.status`; idempotent same-status short-circuit | Expected behavior confirmed |
| CT-19 | A | No `DELETE` route exists for `ImagingStudy`/`ImagingImage` | Expected behavior confirmed |
| CT-21 | A | Legal-hold audit metadata carries `actorRole` + hold-state booleans, never `legalHoldReason` text | Expected behavior confirmed |
| CT-26 | B | Rejected/rate-limited bridge heartbeat does not mutate `lastSeenAt`/status | Expected behavior confirmed |
| CT-27 | C | Oversize (413) / invalid-type (400) / malformed-multipart (500) uploads create zero partial rows | Expected behavior confirmed |
| CT-28 | A | Deterministic response-shape snapshots for `GetImagingStudy`, `ListPatientImaging`, `CreateImagingStudy` | Expected behavior confirmed (baseline snapshot pinned) |
| CT-32 | D — `imagingRequestConcurrencyCharacterization.test.ts` | Concurrent `ImagingRequest` PATCH/cancel (`CR-03`/`BLK-02`/`FP-06`) | **Current behavior characterized — VERIFIED CONCURRENCY GAP** (see §6.2) |

All 18 pass against current behavior. Stage 1's mandatory-before-refactor gate is therefore satisfied at the test level (program-owner review/approval of Stage 1 itself is a separate, not-yet-sought decision, out of this task's scope).

### 4.2 Mandatory-before-caller-migration bucket (3 tests — gate: "Stage 3 may not begin until these pass")

| Test ID | Suite | Behavior characterized | Status |
|---|---|---|---|
| CT-05 | B | `SetImagingLegalHold` RBAC gate (`authorize(['OWNER','ORG_ADMIN'])`) | Expected behavior confirmed |
| CT-23 | B | Study-from-`ImagingRequest` relink consistency | **VERIFIED_DEFECT** (see §6.1) |
| CT-30 | B | Current Privacy/KVKK direct-Imaging-access callers (`deletionReviewInventory.ts`, `orphanFileInspection.ts`, `patientAnonymization.ts`) — baseline for a future `ImagingLifecyclePort` migration | Expected behavior confirmed |

### 4.3 Mandatory-before-direct-access-removal bucket (1 test, carried forward from §4.2 — gate: "Stage 7 may not remove the old direct-Prisma path unless this still passes")

| Test ID | Suite | Note |
|---|---|---|
| CT-30 | B | Required at both the caller-migration gate and the removal gate; not double-counted in the 21-blocking total, per the contract's own JSON note. |

### 4.4 Non-blocking regression coverage (11 tests — not implemented by this wave)

`CT-01, CT-04, CT-09, CT-15, CT-18, CT-20, CT-22, CT-24, CT-25, CT-29, CT-31` — **NOT COVERED** by A/B/C/D. None of the four sub-tasks' evidence documents implement or describe these test IDs; their full descriptive detail lives only in F2-PREP-006-D's own JSON companion (`F2-PREP-006-D_imaging_contract_test_design.json`), not read by this consolidation task (out of scope — this task consolidates what A/B/C/D actually implemented, it does not re-derive the un-implemented remainder). They remain open, explicitly non-blocking to Stage 1, and are recommended future work (§10).

### 4.5 Deferred/F10 bucket (0 tests)

No characterization test targets F10 (imaging AI/processing) directly, since no such code exists yet to characterize, per the accepted contract's own note.

**Totals reconciliation:** 32 total tests (D's 31 candidate + 1 new, `CT-32`) = 21 blocking (18 + 3, `CT-30` carried forward not double-counted) + 11 non-blocking + 0 deferred/F10. This wave (A/B/C/D) implements all 21 blocking tests and 0 of the 11 non-blocking tests.

## 5. Verified defects, gaps, and blockers — preserved terminology

### 5.1 CT-23 — VERIFIED_DEFECT

`LinkImagingStudy` (`PATCH /api/imaging/studies/:id/link`, `server/src/routes/imaging.ts:807-854`) can change `ImagingStudy.patientId` while retaining an `imagingRequestId` that still belongs to the original patient. F2-PREP-007-B's own evidence document states, verbatim:

> "The characterization-test catalogue's own assertion text (F2-PREP-006-D JSON, `characterizationTests[CT-23].assertions[0]`) states: *'a study created from an ImagingRequest cannot be relinked to an appointmentId/treatmentCaseId that is inconsistent with the originating request's own patient.'* This does **not** hold against current behavior. ... `study.imagingRequestId` itself is neither cleared nor re-validated by this route."
>
> "2/2 reproductions confirm the defect. **Disposition:** `VERIFIED_DEFECT`. **No production code was changed** ... The gap itself (no `imagingRequestId`-consistency check on relink) is a new, not-previously-catalogued finding surfaced by this task, additional to the already-known `CR-03`/`BLK-02` `ImagingRequest` PATCH-concurrency gap — it is a distinct code path ... and is **not** covered by any existing blocker decision in the F2-PREP-006-E contract."

**Classification, as required by this consolidation task:**
- **Not** a Stage 0 characterization-closure blocker — the test correctly characterizes current (permissive) behavior and passes; Stage 0's job is characterization, not remediation.
- **Is** a blocker before Stage 3 (caller migration) or before any external/public-contract exposure of `LinkImagingStudy` beyond `imaging.ts` itself.
- **Must not** be silently described as expected behavior anywhere in program-control documents. It is recorded here, and in §4.2 above, as `VERIFIED_DEFECT` — not fixed, not scheduled for a fix by this task.
- The defect's final severity/priority disposition (whether it becomes a new named blocker entry alongside `CR-03`/`BLK-02`/`BLK-01` in a future revision of the F2-PREP-006-E contract) is **not decided by this task** — F2-PREP-007-B's own evidence explicitly leaves that to "whichever task next updates the boundary contract's `blockerDecisions`," and this consolidation does not itself amend the accepted contract document. It is carried forward as an explicit unresolved item (§10).

### 5.2 CT-32 / CR-03 — VERIFIED CONCURRENCY GAP

Concurrent `ImagingRequest` PATCH and cancel can both return HTTP 200, silently clobbering each other (last-writer-wins, no re-validation, no 409). F2-PREP-007-D's own evidence document states, verbatim:

> "Per the merged contract (§10): `CR-03`/`BLK-02`/`FP-06` — **'Yes, pre-contract-exposure blocker.'** Blocking before `UpdateImagingRequest`/`CancelImagingRequest` are exposed as commands to any caller beyond `imaging.ts` itself (Stage 1's facade). **Not** a Stage 0 blocker — Stage 0's job (this task) is exactly to characterize the current clobber behavior, which it now does with a reproducible, passing, 60/60-consistent test. Must resolve no later than Stage 2."

This consolidation task independently re-ran the suite (§8) and observed the identical result: **30/30 rounds `BOTH_SUCCESS_SILENT_CLOBBER`**, 0 `SEQUENTIAL_SAFE_REJECTION`, 0 `UNEXPECTED` — deterministic, not a rare flake.

**Classification, as required by this consolidation task:**
- **Not** a Stage 0 characterization blocker — the test is designed to, and does, prove the current gap exists.
- **Is** a pre-contract-exposure blocker: `CR-03`/`BLK-02`/`FP-06` remains `OPEN`, must resolve no later than Stage 2, before `UpdateImagingRequest`/`CancelImagingRequest` are exposed as commands to any caller beyond `imaging.ts` itself.
- Remediation is explicitly **not** part of this task.

### 5.3 Storage/DB compensation gap

Post-storage-write, post-DB-write transaction-failure compensation asymmetry, as originally characterized by F2-PREP-006-C (`BLK-01`/`CR-01`/`CR-02`) and reachable-path-tested by F2-PREP-007-C (CT-11/CT-13/CT-14, all confirming the *currently reachable* compensation-delete paths work correctly today). The accepted F2-PREP-006-E contract's `blockerDecisions.storageDbCompensationGap` states, verbatim:

> "decision: NOT A BLOCKER for modular-monolith-internal boundary work (Stages 0-7 as scoped by this contract, since no network/process boundary is introduced by any of them)." ... "detail: IS a blocker before any FUTURE, separately-authorized decision to extract Imaging's storage responsibility behind a real network boundary — explicitly out of scope for this contract and for F2-PREP-005's own non-goals. Tracked as a deferred, evidenced gap, not resolved here."

**Classification, as required by this consolidation task:**
- Does **not** block this modular-monolith characterization closure.
- **Blocks** a future, separately-authorized network-boundary extraction, until an accepted compensation strategy exists.
- Not repaired, not further characterized beyond the CT-11/CT-13/CT-14 reachable-path proofs already recorded, by this task.

### 5.4 Manual and bridge ingest duplication (OVL-01)

The manual (`CreateImagingStudy`) and bridge (`IngestImagingStudy`) study/image-ingest handlers remain two separate, independently-implemented current code paths (originally documented as `OVL-01`/`F-03` by F2-PREP-006-A, characterized without convergence by F2-PREP-007-C via CT-07/CT-08/CT-10/CT-11/CT-12/CT-13/CT-14). The accepted F2-PREP-006-E contract's decision, verbatim:

> "**Decision: CONVERGE.** Introduce one shared internal application-service function (e.g. `ingestImagingStudyCore()`) called by both `IMG-RT-09` (manual upload) and `PUB-RT-02` (bridge ingest)... **Target stage: Stage 2.**"

F2-PREP-007-C's own scope statement reiterates: "It does not converge manual (`CreateImagingStudy`) and bridge (`IngestImagingStudy`) ingest... Nothing in this document authorizes any Stage 0–7 modularization work."

**Classification, as required by this consolidation task:**
- Characterization only — both paths remain separate current implementations, fully documented (CT-07/08/10/11/12/13/14).
- Eventual convergence behind one shared application service is accepted as the target design (Stage 2) but is **not** authorized, scheduled, or begun by this task.

## 6. Test count reconciliation

Each sub-task's own claimed count was independently re-verified against the actual committed test file and against a live run of the wired aggregate (§8).

| Suite | File | Claimed (own evidence doc) | Independently re-verified (file + live run) | Discrepancy |
|---|---|---|---|---|
| A | `imagingCharacterizationAuthShape.test.ts` | 36 passed, 0 failed | 36 passed, 0 failed | None |
| B | `imagingCharacterizationTenantLifecycle.test.ts` | Per-CT table sums to 30 (CT-02: 5, CT-30: 7); prose states "29 assertions total... 29 passed" | **29 passed, 0 failed** (CT-02 is actually 6 tests, not 5; CT-30 is actually 5 tests, not 7) | F2-PREP-007-B's own evidence document has a 1-off internal arithmetic inconsistency between its per-CT table and its own stated aggregate. The aggregate figure (29) is correct and matches both the actual test file and this task's live run. **Not corrected in B's own evidence file** (no sibling evidence file is modified by this consolidation, per established wave convention) — recorded and reconciled here instead. |
| C | `imagingCharacterizationIngestStorage.test.ts` | 13 assertions per run, 3/3 or equivalent per CT, 39/39 across 3 validation runs | 13 passed, 0 failed (single run) | None — the "39" figure is 13 × 3 independent validation runs performed by F2-PREP-007-C for its own reliability proof, not 39 distinct assertions; this consolidation's own live run (§8) is a fourth independent clean run at 13/13. |
| D | `imagingRequestConcurrencyCharacterization.test.ts` | 153 total (post review-fix: 152 original + 1 new "at least one round executed" guard) | **153 ✓ 153 ✗ 0** | None |

## 7. Permanent test ownership — established by this task

### 7.1 Before this task

None of the four characterization suites were owned by any explicit, stable package script or CI profile. Each sub-task's own evidence document explicitly deferred wiring to "the final consolidation task":

- Not a member of the legacy `test` chain, `server:test:non-disposable`, `server:test:disposable-db`, `server:test:storage-integration`, or `server:test:legacy-db-required`.
- Not referenced by any `.github/workflows/*.yml` file.
- All four require a live `DATABASE_URL` pointing at a disposable PostgreSQL (confirmed by direct inspection of each file's own precondition guard); none require MinIO/S3 (A explicitly clears `S3_BUCKET` and asserts `isRemoteStorageEnabled() === false` before running).
- Only indirectly reachable via ad hoc, hand-provisioned disposable-Postgres runs each sub-task performed for its own local validation — never through the repository's own `test:runtime:*` orchestrator, never through CI.
- Precedent: `server/src/tests/dbVerification/inventoryUnitConversionConcurrency.test.ts` (a comparable concurrency-characterization test) is similarly left unwired in the current repository — F2-PREP-007-D's own evidence cites this as its reason for not wiring CT-32 alone. This task's explicit mandate is different: establish ownership for the whole Stage 0 set, not leave it unwired by precedent.

### 7.2 After this task

- New script, `server/package.json`: `"test:imaging-characterization": "tsx src/tests/imagingCharacterizationAuthShape.test.ts && tsx src/tests/imagingCharacterizationTenantLifecycle.test.ts && tsx src/tests/imagingCharacterizationIngestStorage.test.ts && tsx src/tests/imagingRequestConcurrencyCharacterization.test.ts"` — runs all four Stage 0 suites in one durable, repository-visible command (`npm run test:imaging-characterization` from `server/`), following the exact `&&`-chained convention already used by every other multi-file script in this manifest (e.g. `test:auth`, `test:instagram`, `test:meta-wa`).
- `server:test:disposable-db` (an existing, already-CI-wired aggregate) extended with one additive member: `&& npm run test:imaging-characterization` appended at the end. This is the **smallest compatible change**: no new CI job, no new orchestrator profile, no `.github/workflows/*.yml` file touched. `server:test:disposable-db` is already invoked, unconditionally on every trigger (no path filter), by `ci-layers.yml`'s Layer 3 (`disposable-postgres-tests`) via `test:runtime:postgres`, which both `ci-pr.yml` (every PR) and `ci-main-and-nightly.yml` (every push to `main` + nightly) call. Extending this aggregate therefore gives the Stage 0 set genuine, durable CI ownership with a single `server/package.json` line changed.
- **Why Layer 3 is the appropriate owner:** all four suites require only a disposable PostgreSQL (no MinIO), exactly matching Layer 3's existing provisioning scope (`test:runtime:postgres` → `postgres` profile). Layer 4 (storage/MinIO integration) would be the wrong layer (no suite needs MinIO); a new Layer or new orchestrator profile would duplicate Layer 3's identical provisioning/migration/cleanup path for no benefit and was rejected as unnecessary, per the constraint against creating duplicate execution across CI layers without justification.
- **Full regression coverage:** unaffected. `server:test:non-disposable` (Layer 2, 68 members including `test:imaging`/`test:imaging-bridge-pairing`/`test:imaging-bridge-onboarding`/`test:imaging-bridge-update`) and `server:test:legacy-db-required` (Layer 5 backend, including `test:kvkk-lifecycle`) are both untouched by this task and continue to run their existing imaging coverage exactly as before. The four new characterization suites are additive, not a replacement for or narrowing of any existing suite.
- **PR critical-path impact:** Layer 3 already runs unconditionally on every PR by the existing layered-CI design (no path filtering, matching Layer 5's own precedent, per F1-003-P3's evidence). Adding four suites to an aggregate that already runs on every PR does not introduce a *new* unconditional cost category — it extends an existing one. The added wall-clock cost is the four suites' own runtime (§8: full `server:test:disposable-db` including the new suites completed in a single, successful, non-timed-out orchestrator run).
- **No duplicate execution:** the four suites are wired into exactly one aggregate (`server:test:disposable-db`) and therefore exactly one CI layer (Layer 3). They are not additionally added to the legacy `test` chain, `server:test:non-disposable`, or any other aggregate.
- **Disposable PostgreSQL requirement:** confirmed via direct inspection — `imagingCharacterizationIngestStorage.test.ts:57-58` and `imagingRequestConcurrencyCharacterization.test.ts` both throw immediately if `DATABASE_URL` is unset; `imagingCharacterizationTenantLifecycle.test.ts`'s own doc-comment states the same requirement. No MinIO/S3 requirement in any of the four (confirmed via `grep` for `S3_BUCKET`/`MinIO`/`isRemoteStorageEnabled` across all four files — only A references it, and only to force it *off*).

## 8. Validation — exact commands and results

All commands below were run from this task's own isolated worktree, against `origin/main` @ `0d48d9fdea5d33f0a1acf88da9060702526c8bd1` plus this task's own additive `server/package.json` change (no other file was modified before these runs).

```
cd server && npm run typecheck
-> npx prisma generate && tsc --noEmit
-> Generated Prisma Client (v7.8.0) — 0 tsc errors, exit 0
```

```
npm run test:runtime:postgres   (root)
-> provisions a disposable PostgreSQL (postgres profile), applies existing migration
   history unmodified, runs server:test:disposable-db (now including
   test:imaging-characterization as its final member), tears down.

Per-member results (server:test:disposable-db, this run):
  DB-Clinic-Scope-Access:                 10 passed, 0 failed
  DB-Record-Owned-Mutation-Scope:         15 passed, 0 failed
  DB-Target-Clinic-Creation:              15 passed, 0 failed
  DB-Insurance-List-Behavior:              4 passed, 0 failed
  DB-Plan-Limits-Quota:                   13 passed, 0 failed
  DB-Input-Handling:                       6 passed, 0 failed
  appointmentRequestConversionAtomicity:  16 passed, 0 failed
  externalCalendarOutboundSyncAtomicity:   9 passed, 0 failed
  platform-admin-password-recovery:       Toplam 21  ok 21  FAIL 0
  meta-whatsapp-post-booking:              6 passed, 0 failed
  test:imaging-characterization (new):
    A (imagingCharacterizationAuthShape):            36 passed, 0 failed
    B (imagingCharacterizationTenantLifecycle):      29 passed, 0 failed
    C (imagingCharacterizationIngestStorage):        13 passed, 0 failed
    D (imagingRequestConcurrencyCharacterization):  CT-32 total: 153 ✓ 153 ✗ 0
      (30/30 rounds BOTH_SUCCESS_SILENT_CLOBBER, 0 SEQUENTIAL_SAFE_REJECTION, 0 UNEXPECTED)

Orchestrator outcome JSON:
  "migration": { "code": 0, "step": "ok" }
  "test": { "scriptName": "server:test:disposable-db", "code": 0 }
  "cleanup": { "success": true, "errors": [] }
  "outcome": { "exitCode": 0, "reasons": ["tests passed", "cleanup succeeded"] }
```

```
docker ps -a --filter "label=com.noramedi.test-runtime=true" --format "{{.Names}}"   -> (empty)
docker network ls --filter "label=com.noramedi.test-runtime=true" --format "{{.Name}}" -> (empty)
```
Zero residual labeled Docker resources after the run, independently confirmed beyond the orchestrator's own self-reported `cleanup.success:true`.

```
cd server && npm run test:imaging                    -> 103 passed, 0 failed
cd server && npm run test:imaging-bridge-pairing      -> 50 passed, 0 failed
cd server && npm run test:imaging-bridge-onboarding   -> 14 passed, 0 failed
cd server && npm run test:imaging-bridge-update       -> 44 passed, 0 failed
cd server && npm run test:kvkk-lifecycle              -> 110 passed, 0 failed
```
Existing imaging route tests, all three bridge pairing/onboarding/update suites, and the KVKK attachment/imaging lifecycle suite (owned by the pre-existing, untouched `server:test:legacy-db-required` aggregate) all remain green — zero regression introduced by this task's `server/package.json` change.

```
git diff --check   -> clean (0 output, exit 0)
git status --short -- server/package.json   -> M server/package.json (only tracked change from this task's wiring step)
```

No `full-suite`/`server:test:non-disposable` re-run was required beyond the targeted regression above, since this task's only functional change is a single additive `server/package.json` aggregate member — it does not alter any script `server:test:non-disposable` already runs. No `.github/workflows/*.yml` file was modified by this task, so no actionlint/workflow-syntax re-validation was required or performed.

## 9. Migration, compatibility, rollback, and impact

- **Migration status:** none. No Prisma schema or migration file is created, modified, or authorized by this task. `npx prisma generate` regenerated the client against the unmodified schema only.
- **Runtime backward-compatibility impact:** none. No application/runtime code path is touched.
- **Production behavior impact:** none. No production system, deployment, or runtime behavior is touched or authorized by this task.
- **CI behavior impact:** the existing `server:test:disposable-db` aggregate now runs four additional characterization suites in Layer 3 (`disposable-postgres-tests`). This increases Layer 3's execution time by those four suites' own runtime (§8), but introduces no new CI job, orchestrator profile, workflow file, or duplicate execution across layers (§7.2).
- **Rollback:** revert this consolidation/test-ownership PR. The change set is additive-only (one new evidence document, index/tracker/phase-document updates, and one `server/package.json` edit adding a script and extending one existing aggregate) — a single `git revert` fully restores the prior state with zero follow-up steps.
- **Tenant impact:** none — no tenant-scoping code path touched; CT-02/CT-03/CT-05/CT-17/CT-26/CT-30's own characterization confirms current tenant-isolation behavior is correct where tested, unchanged by this task.
- **KVKK impact:** none — CT-16/CT-19/CT-21/CT-28's own characterization confirms current legal-hold redaction and audit-PII-minimization behavior is correct where tested, unchanged by this task. `test:kvkk-lifecycle` regression-confirmed green (110/110).
- **Storage impact:** none — CT-07/08/10/11/12/13/14/27's own characterization confirms current ingest/idempotency/compensation behavior where tested; the storage/DB compensation gap (§5.3) and manual/bridge duplication (§5.4) remain exactly as characterized, neither fixed nor worsened.
- **Authorization impact:** none — CT-05/CT-06/CT-21's own characterization confirms current RBAC/auth-boundary behavior where tested, unchanged by this task.
- **Concurrency impact:** none — CT-32's own characterization confirms the current `CR-03`/`BLK-02`/`FP-06` silent-clobber gap exists exactly as previously documented; this task neither fixes nor further exposes it (it remains reachable only from `imaging.ts` itself, as before).
- **Modular-boundary impact:** none — no `server/src` file is touched; the accepted F2-PREP-006-E boundary contract, its 20-command/14-query/1-event catalogue, and its 8-stage expand-migrate-contract sequence are unmodified by this task.

## 10. Unresolved risks and blockers carried forward, unchanged

- `CT-23` — `VERIFIED_DEFECT` (§5.1), new finding, not yet given a formal blocker-decision entry in the accepted contract. Recommended as an explicit blocker-decision candidate for a future task, before any Stage 3/facade exposure of `LinkImagingStudy`.
- `CR-03`/`BLK-02`/`FP-06` (`CT-32`) — remains `OPEN`, pre-contract-exposure blocker, target resolution no later than Stage 2 (§5.2).
- `BLK-01`/`CR-01`/`CR-02` (storage/DB compensation gap) — remains a deferred, evidenced, non-modular-monolith-blocking gap; blocks only a future network-boundary extraction (§5.3).
- `OVL-01` (manual/bridge ingest duplication) — remains characterized-only; convergence target is Stage 2, not authorized here (§5.4).
- `PZ-IMG-03` — remains `OPEN` (unaffected by this task; last touched by F2-PREP-006-B/E).
- 11 non-blocking characterization tests (`CT-01, CT-04, CT-09, CT-15, CT-18, CT-20, CT-22, CT-24, CT-25, CT-29, CT-31`) remain not implemented (§4.4).
- `R-070` `OPEN`, `R-046` `OPEN`, `R-071` `CLOSURE_PROPOSED_AWAITING_EXTERNAL_CONFIRMATION` — all unaffected, no Imaging-specific content, untouched by this task.
- `G1`/`G2` remain `NOT_APPROVED`. KVKK physical/architecture freeze remains `ACTIVE`. Runtime modularization remains `NOT_APPROVED`.

## 11. Files changed by this task

- `docs/program/evidence/F2-PREP-007-E_IMAGING_CHARACTERIZATION_WAVE_CONSOLIDATION_EVIDENCE.md` (this file, new)
- `server/package.json` (additive: one new script `test:imaging-characterization`; one existing aggregate `server:test:disposable-db` extended by one member)
- Additive updates to `docs/program/CURRENT_PHASE.md`, `docs/program/NORAMEDI_MASTER_TRACKER.md`, `docs/program/phases/F2_MODULAR_BOUNDARIES.md`, `docs/program/evidence/README.md`

No `F2-PREP-007-A/B/C/D_*` evidence file, no test file, no Prisma schema/migration file, no `.github/workflows/*.yml` file was modified by this task.

## 12. Exact next task recommendation

Per the accepted F2-PREP-006-E contract's 8-stage expand-migrate-contract sequence and this wave's own proposed closure: **all 10 Stage 0 technical acceptance conditions are demonstrated on this task's branch** (see §13), but closure is not yet authoritative — PR #298 is open, not merged. Three distinct next items, not to be conflated:

1. **Program-owner approval and PR #298 merge/main-CI closure** — program-owner review and approval of this Stage 0 closure proposal, followed by merging PR #298 and a passing post-merge main CI run on `main`. This is what makes Stage 0 closure authoritative (§13).
2. **Stage 1 additive facade preparation** (`ImagingLifecyclePort`/public-contract facade for the already-passing 18 mandatory-before-refactor tests, additive and unused by any caller) — a distinct, separately-gated future task. Per the accepted classification, `CT-23` is **not** a Stage 0 blocker and does **not** itself block creation of an additive, unused internal facade; Stage 1 preparation is gated only on item 1 above (Stage 0 closure becoming authoritative), not on `CT-23`'s blocker-decision disposition. **Stage 1 execution is not authorized by this task or by this correction.**
3. **`CT-23` remediation deadline** — `CT-23` must be resolved before Stage 3 caller migration or any external/public-contract exposure (not before Stage 1). Its blocker-decision disposition (§5.1/§10) — whether it is formally added to the F2-PREP-006-E contract's `blockerDecisions` — remains tracked as a precondition for that later gate, independent of Stage 1.

This task does not begin Stage 1, does not implement any of the 11 non-blocking tests, and does not remediate `CT-23`, `CR-03`/`BLK-02`, the storage/DB compensation gap, or the manual/bridge ingest duplication.

## 13. Stage 0 closure acceptance — condition by condition (technical conditions only; authoritative closure requires PR #298 merge — see below)

1. A/B/C/D are merged. — **Yes** (§3).
2. Their post-merge main CI results are recorded as passed. — **Yes**, run `30768167540`, 9/9 jobs `success`, head SHA exactly equal to `origin/main`'s tip (§3).
3. The four characterization suites exist on `main`. — **Yes**, confirmed present in this task's own `origin/main`-derived worktree.
4. There is an explicit durable test command/profile that owns them. — **Yes**, `npm run test:imaging-characterization` (§7.2).
5. That command passes from the task branch. — **Yes**, 36/29/13/153 passed, 0 failed (§8).
6. Required affected/core/full compatibility validations pass. — **Yes**: server typecheck clean; `server:test:disposable-db` (now including the new aggregate) exit 0 via the real disposable-Postgres orchestrator; existing imaging/bridge-pairing/bridge-onboarding/bridge-update regression 211/211; `test:kvkk-lifecycle` regression 110/110; `git diff --check` clean (§8).
7. CT-23 and CT-32/CR-03 are explicitly tracked as unresolved blockers. — **Yes** (§5.1, §5.2, §10).
8. Storage compensation and manual/bridge convergence remain explicitly deferred. — **Yes** (§5.3, §5.4).
9. Master tracker, current phase, and phase document agree. — **Yes**, all three updated identically by this task (§11; see each document's own new entry).
10. No production behavior, schema, migration, or deployment change was introduced. — **Yes** (§9).

**All ten technical acceptance conditions are met on this task's branch. Stage 0: `CLOSURE_PROPOSED_AWAITING_MERGE_AND_MAIN_CI`.**

The durable test-ownership change (the `server/package.json` wiring that gives the Stage 0 suites permanent CI ownership) exists only on branch `docs/f2-prep-007-e-imaging-characterization-consolidation` / PR [#298](https://github.com/MustafaBasol/DisKlinikCRM/pull/298) until that PR is merged. **Authoritative Stage 0 closure becomes effective only after PR #298 is merged to `main` and its post-merge main CI run passes.** Until then, this document's "Stage 0: CLOSED" claims in any other section, and in the program-control documents, mean "closure proposed and technically demonstrated on the PR branch," not "authoritative."

## 14. Status separation

- **Agent completed:** yes.
- **Tests passed:** yes — all commands in §8 executed for real, exact pass/fail counts recorded, zero residual Docker resources independently confirmed.
- **PR opened:** yes — [PR #298](https://github.com/MustafaBasol/DisKlinikCRM/pull/298), state `OPEN`, base `main`, head `docs/f2-prep-007-e-imaging-characterization-consolidation`.
- **Merged:** no.
- **Deployed:** no.
- **Production verified:** no.
- **Stage 0 closure:** technically demonstrated on the PR branch (§13); **not yet authoritative** — becomes effective only after PR #298 merges and its post-merge main CI passes.

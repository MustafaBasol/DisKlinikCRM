# F2-PREP-006-E — Imaging Boundary Contract Consolidation

**Phase:** F2 — Modularization Preparation
**Parent task:** F2-PREP-006 — Imaging Pilot Boundary Contract Definition
**Type:** DOCUMENTATION, ARCHITECTURE RECONCILIATION, AND PROGRAM-CONTROL ONLY. No application code, Prisma schema/migration, test, workflow, package, route, service, dependency-cruiser installation, event bus/outbox, or deployment change is authorized or made by this task.
**Status:** `AGENT_COMPLETED` / `VALIDATION_PASSED` / `PR_OPENED_AWAITING_REVIEW`. Not merged, not deployed, not production-verified.

Machine-readable companion: [architecture/evidence/F2-PREP-006-E_imaging_boundary_contract.json](evidence/F2-PREP-006-E_imaging_boundary_contract.json). Methodology/validation companion: [../evidence/F2-PREP-006-E_CONSOLIDATION_EVIDENCE.md](../evidence/F2-PREP-006-E_CONSOLIDATION_EVIDENCE.md).

---

## 0. Baseline

Per the task brief, this consolidation was created directly from current `origin/main` (not from the shared A/B/C/D frozen wave baseline, and not by reusing any sibling worktree):

```
git fetch origin --prune
git rev-parse origin/main -> 46ba7b219002c8267bf127b39718efea091657b4
git merge-base --is-ancestor 38249af95f3975af1088e03c856c1443a034f517 origin/main -> exit 0   (PR #289, F2-PREP-006-B)
git merge-base --is-ancestor 5a90eb3edd3842d107825169423bb10db53ee403 origin/main -> exit 0   (PR #290, F2-PREP-006-C)
git merge-base --is-ancestor 8e77f2fe4d82b9b6e5e1364e18c8a16bfba1711b origin/main -> exit 0   (PR #291, F2-PREP-006-D)
git merge-base --is-ancestor 46ba7b219002c8267bf127b39718efea091657b4 origin/main -> exit 0   (PR #288, F2-PREP-006-A)
gh pr view 288/289/290/291 --json mergeCommit,state -> all MERGED, merge commit SHAs match exactly
git worktree add <path> -b docs/f2-prep-006-e-imaging-boundary-consolidation origin/main
```

**Exact baseline SHA: `46ba7b219002c8267bf127b39718efea091657b4`** (merge commit of PR #288, which happens to be `origin/main`'s current tip — the four PRs merged in the order A(#288)→B(#289)→C(#290)→D(#291), and `origin/main` had not advanced beyond D's merge at task start).

Aggregate main CI prerequisite, recorded exactly as supplied: run `30756005546`, head SHA `46ba7b219002c8267bf127b39718efea091657b4`, event `push`, workflow `ci-main-and-nightly`, result `success`, 9/9 jobs green. Not independently re-queried by this task (no new CI-relevant code exists to re-verify — all four inputs are already-merged, documentation-only PRs).

This worktree is fresh and isolated; no A/B/C/D sibling worktree was reused, read, merged, or rebased onto. No rebase, no force-push.

---

## 1. Inputs reconciled

- F2-PREP-006-A (IMG/BRG ownership and implementation inventory) — MD + JSON, both read in full.
- F2-PREP-006-B (imaging data, storage, tenant and KVKK boundary assessment) — MD + JSON, both read in full. Note: the real merged filename is `F2-PREP-006-B_imaging_data_storage_kvkk.json` (no `tenant` in the name) — see contradiction CTR-02.
- F2-PREP-006-C (imaging caller, direct-access and transaction flow map) — MD + JSON, both read in full.
- F2-PREP-006-D (imaging public contract and characterization-test design) — MD + JSON, both read in full.
- F2-PREP-005 (consolidated modularization charter) — MD + JSON, read for the accepted pilot boundary charter (§10) and cross-domain access policy (§11).
- F2-PREP-002 (cross-domain dependency and direct-access map) — read for the original IMG-\* edges and F2-CC-14's original scope.
- F2-PREP-004 (modularization sequencing and pilot selection) — read for the evidence-derived 7-stage expand/migrate/contract pattern this task adapts.
- `NORAMEDI_MASTER_TRACKER.md`, `CURRENT_PHASE.md`, `phases/F2_MODULAR_BOUNDARIES.md` — read for current program state and to identify what each requires this task to append.
- `ARCHITECTURE_DECISIONS.md` (ADR-015 excerpt) — read to confirm contract syntax/versioning/enforcement remains a deferred-to-F2 decision this task operates within, not a new ADR to author.
- `RISK_REGISTER.md` (R-070, R-046, R-071 rows, read in full) — confirmed general, program-level, not Imaging-specific; unaffected by this task.

**Source-scope discipline:** no current `server/src` source file was read directly by this task. A/B/C/D each already independently re-verified the relevant source at the shared frozen baseline (`4cb334d2...`, PR #287's merge commit) with file:line evidence; this task's job is reconciliation of that evidence, not re-discovery. No scope expansion into new source roots was required or performed. This is itself a deliberate, documented choice, not an oversight — the task brief's CodeGraph-discipline instruction to log every scope expansion is satisfied by there being none.

---

## 2. Contradictions found and resolved

Full detail with exact citations in the JSON companion's `contradictions[]`. Summary:

| ID | Title | Severity | Resolution |
|---|---|---|---|
| CTR-01 | F2-PREP-005 §10 lists Notifications as an allowed inbound Imaging caller; F2-PREP-006-C and -D both independently re-read `notifications.ts` in full and found **zero** references to any Imaging-owned Prisma model — only `labWorkOrder` (Labs-owned). | Medium | **RESOLVED.** F2-PREP-002's original `IMG-09` edge grouped Imaging with Attachments/Inventory/Labs/Storage under one research-cluster code also spelled "IMG" — a naming collision with the real `IMG` domain code, not a genuine Imaging caller. Notifications is **removed** from the accepted-caller list. |
| CTR-02 | Filename mismatch: this task's own brief cites `F2-PREP-006-B_imaging_data_storage_tenant_kvkk.json`; the real merged file omits `tenant`. | Low | **RESOLVED.** Confirmed via `git ls-tree` against `origin/main`. This document and its JSON cite the real filename throughout. No sibling evidence file is altered to "fix" this. |
| CTR-03 | A/B/C leave BRG's module-vs-submodule-vs-split question open in three subtly different ways (A: "unresolved combination, split by edge, deferred to E"; B: "two sub-domains within one boundary, no further split"; C: "device edge is already a complete de-facto boundary" — silently leaving the admin edge unaddressed). | Medium | **RESOLVED** by this task's own decision (§7 below): BRG remains **one module**, two documented edges. |
| CTR-04 | F2-PREP-002's original `F2-CC-14` names only two write-side methods; F2-PREP-006-C independently found and evidenced two additional read-side direct-access sites (`DAV-01`/`DAV-02`) and one direct-storage-access site (`SB-01`) mapping to the same Privacy callers but outside `F2-CC-14`'s original scope. | Low | **RESOLVED** by revising `F2-CC-14`'s scope to add two query methods (§8/§9 below) — accepted-and-revised, not a competing second port. |
| CTR-05 | A and C both document the same two structural gaps (ingest duplication, `ImagingRequest` PATCH concurrency) using inconsistent "risk" vs. "blocker" vocabulary. | Low | **RESOLVED** by assigning each an explicit, single-vocabulary blocker classification (§10). |

No contradiction required reopening or modifying any A/B/C/D evidence file — every resolution is recorded here, in the consolidation layer that owns reconciliation by design.

---

## 3. IMG-owned responsibilities (accepted)

- **Models:** `ImagingDevice`, `ImagingRequest`, `ImagingStudy`, `ImagingImage`.
- **Routes:** `IMG-RT-01..19` (`server/src/routes/imaging.ts`).
- **Services:** `imagingRequestTransitions.ts`.
- **Helpers to formalize:** `validateClinicalLinks`, `streamStudyImage`, `setStudyStatus`, `findStudyInScope`/`findRequestInScope`; `redactStudyLegalHoldReason` is already a de-facto public (exported) symbol living in a route file — Stage 1 relocates it into a `services/imaging` module.
- **New surface to build:** a named application service for study ingest (replacing the duplication documented as `OVL-01`/`F-03`), and the `ImagingLifecyclePort` facade (§8/§9) for Privacy's existing direct callers.
- **Forbidden direct access:** no domain outside IMG (and the documented Privacy exception, §6) may read or write any of the four models above directly.

## 4. BRG-owned responsibilities (accepted)

BRG remains **one module**, organized internally as two documented edges (module-structure decision, §7):

- **Device edge** (`imagingBridgePublic.ts`, `PUB-RT-01..05`) — already a correctly-shaped anti-corruption-layer/adapter per its own header-comment design invariants (no PHI/token/filename logging, uniform `401` on every rejection reason, no storage URL ever returned, content-addressed idempotency independent of caller identity).
- **Admin edge** (`BRG-RT-01..08`, today physically inside `imaging.ts`) — ordinary same-process domain logic, stylistically indistinguishable from IMG's own routes. Scheduled for physical relocation alongside the device edge at Stage 5 (URL paths unchanged).
- **Models:** `ImagingBridgeAgent`, `ImagingBridgePairing`, `ImagingBridgePairingDevice`, `ImagingBridgeBinding`.
- **Services:** `bridgeTokens.ts`, `bridgePairing.ts`, `bridgeOnboardingConfig.ts`, `bridgeUpdateConfig.ts`.
- **Job:** `imagingBridgeOfflineJob.ts`.
- **New surface to build:** extract `authenticateBridgeAgent()` into its own importable, independently testable module (Stage 5).
- **Forbidden direct access:** no domain outside BRG may read or write any of the four BRG models directly; `imagingBridgePublic.ts` must keep deriving `clinicId` only from the server-matched agent record, never client input.

## 5. Shared infrastructure responsibilities (accepted)

| Path | Status |
|---|---|
| `server/src/services/imaging/imagingUploadValidation.ts` | SHARED (IMG+BRG), explicitly documented in its own header — preserve as-is. |
| `server/src/services/imaging/releaseMetadataValidation.ts` | BRG-internal shared (`bridgeOnboardingConfig.ts` + `bridgeUpdateConfig.ts`). Promotion to a program-wide module is **deferred** — no consumer outside BRG exists today. |
| `server/src/services/fileStorage.ts` | Program-wide shared infrastructure, not Imaging-owned. |
| `server/src/utils/fileSignature.ts` | Program-wide shared infrastructure. |
| `server/src/utils/filePreview.ts` | Program-wide shared infrastructure. |

## 6. Accepted Privacy/KVKK, Backup/Storage, and Patients caller access

- **Privacy/KVKK:** ACCEPTED, DOCUMENTED, TO-BE-FORMALIZED exception — not a violation to remediate as a violation, but a contract to introduce. Current direct callers: `deletionReviewInventory.ts` (read, `DAV-01`), `orphanFileInspection.ts` (read + direct storage check, `DAV-02`/`SB-01`; metadata write `markConfirmedMissing`, `SMB-01`), `patientAnonymization.ts` (metadata write `redactForAnonymization`, `SMB-02`). Target contract: `ImagingLifecyclePort` (§8/§9, revised).
- **Backup/Storage:** ACCEPTED as a shared-infrastructure/adapter exception (`DAV-03`/`DAV-07`), lowest migration priority. Current caller: `fileBackupService.ts` (read-only, cross-tenant sweep; never mutates Imaging models, an explicit invariant in its own header). `PZ-IMG-03` (backup RBAC) is a Storage/Platform-Admin boundary concern, not an Imaging-boundary concern, but is tracked as a closure dependency for the Backup/Storage migration stage's KVKK-safeguard claim (§10).
- **Patients, read-only:** ACCEPTED, UNCHANGED — `ListPatientImaging` is already Imaging-owned and Imaging-served, not a Patients-domain direct-Prisma call.
- **Notifications:** REMOVED from the accepted-caller list — see CTR-01. `notifications.ts` does not touch any Imaging-owned model.

## 7. BRG module structure decision

**Decision: `ONE_MODULE_TWO_EDGES`.** BRG is not split into two separate deployables or modules, and is not merged into IMG. It is one named sub-module of the Imaging domain boundary, documented internally as two edges (device-facing adapter/ACL, admin-facing domain logic). This resolves A's own explicit deferral (`brgRoleClassification.selected: "unresolved combination (split by edge)"`) and CTR-03. Physical relocation of the admin edge alongside the device edge is additive Stage 5 work; it is not required before this contract itself is defined or before Stage 0–4 proceed.

The relationship between the external `windows-bridge/` (.NET) and `bridge-agent/` (Node/TS) deployables remains **unresolved** by A/B/C/D and by this consolidation — both exist, their internals were never scanned (out of every prior task's targeted scope), and whether they are two live integration modes or a predecessor/successor pair is an open due-diligence item, non-blocking for this contract, recommended as a small separately-authorized discovery task before Stage 5 finalizes the admin-edge relocation.

## 8. Duplicate ingest convergence decision

**Decision: CONVERGE.** Introduce one shared internal application-service function (e.g. `ingestImagingStudyCore()`) called by both `IMG-RT-09` (manual upload) and `PUB-RT-02` (bridge ingest), carrying the common skeleton — file-signature validation (already shared via `imagingUploadValidation.ts`) → storage save → `prisma.$transaction` creating `ImagingStudy`+`ImagingImage` and conditionally advancing a linked `ImagingRequest` → rollback-delete-file on failure → audit log — while each route retains its own distinct pre/post logic (manual: patient/appointment/case link resolution via `validateClinicalLinks`; bridge: `ingestKey` recomputation/dedup/`P2002`-race handling and agent-status touch). This also closes `OVL-02` (the `bootstrap` route's hardcoded update-policy stub) by having it call `getBridgeUpdateConfig()` like the dedicated `update` route. Target stage: Stage 2.

## 9. F2-CC-14 decision

**Decision: ACCEPTED AND REVISED.** `ImagingLifecyclePort` now specifies both the original two command methods (`markStorageMissing(imageId)`, `redactForAnonymization(imageId)`, unchanged) **and** two new query methods added by this consolidation: `getImagesForLifecycleReview(clinicId, patientId)` (replacing `DAV-01`/`DAV-02`'s direct reads) and `checkImageStorageExists(imageId)` (replacing `SB-01`'s direct storage check). This converges all five of Privacy's current direct-access touchpoints onto one named port instead of a write-only port plus three unaddressed reads. Not split into a second port; not rejected.

## 10. Blocker decisions

| Question | Decision |
|---|---|
| Is `ImagingRequest` PATCH concurrency (`CR-03`/`BLK-02`/`FP-06`) a pre-refactor blocker? | **Yes, pre-contract-exposure blocker.** Blocking before `UpdateImagingRequest`/`CancelImagingRequest` are exposed as commands any caller beyond `imaging.ts` itself can invoke through the new facade. **Not** blocking for Stage 0 (characterization should capture the current clobber behavior) or Stage 1 (additive facade, no new external caller yet). Must resolve no later than Stage 2. |
| Is the storage-write/DB-write compensation gap (`CR-01`/`CR-02`/`BLK-01`) a pre-refactor blocker? | **No**, not for the modular-monolith-internal work scoped here (Stages 0–7; none introduces a network/process boundary). **Yes**, it is a blocker before any future, separately-authorized decision to extract Imaging's storage responsibility behind a real network boundary — explicitly out of scope here and a non-goal per the F2-PREP-005 charter. |
| Does `PZ-IMG-03` remain open? | **Yes, remains OPEN.** Refined by F2-PREP-006-B from "location unverified" to "location resolved, authentication confirmed, RBAC granularity unproven." Not a blocker for Stages 0–3. Is a blocker for Stage 4 (Backup/Storage caller migration) fully closing any KVKK-safeguard-sufficiency claim — the migration (formalizing the exception) may proceed on schedule regardless. |
| Is backup RBAC proof sufficient? | **No.** Single-tier `authenticatePlatformAdmin` only; no role/tier field on the platform-admin principal; no step-up authentication on the restore-capable endpoints specifically. |
| Are unbounded list queries blockers or deferred gaps? | **Deferred gap, non-blocking.** Pre-existing, program-wide pattern, not introduced by this contract; does not gate any stage below. |
| Is `ImagingBridgePairingDevice`'s missing tenant column required before or after boundary preparation? | **After** this document, **before** Stage 5. The contract itself (Stages 0–4) proceeds without it, since `CT-03` already characterizes the current `pairingId`-transitive join-scoping as correct. The additive schema change is a separately-authorized migration, not performed by this task, recommended complete before Stage 5's admin-edge relocation closes. |
| Is F2-CC-14 accepted, revised, split, or rejected? | **Accepted and revised** — see §9. |

## 11. Dependency-cruiser decision

**Decision: APPROVED TO PROCEED**, report-only, scoped to the Imaging pilot boundary only — consistent with F2-PREP-005 §12's own approval and F2-PREP-006-D's draft specification, which this task adopts with no material change.

- **Allowed roots:** `server/src/routes/imaging.ts`, `server/src/routes/imagingBridgePublic.ts`, `server/src/services/imaging/**`, `server/src/jobs/imagingBridgeOfflineJob.ts`.
- **Forbidden edges:** any module outside the allowed roots importing/calling `prisma.imagingStudy | imagingImage | imagingRequest | imagingDevice | imagingBridgeAgent | imagingBridgePairing | imagingBridgePairingDevice | imagingBridgeBinding` directly, once the named `ImagingLifecyclePort`/application-service contract exists to call instead.
- **Allowlist:** the Privacy KVKK lifecycle exception (migrating to `ImagingLifecyclePort` per Stage 3, not removed until that stage completes); `fileBackupService.ts`'s read-only accepted exception; `routes/attachments.ts`/`routes/labOrders.ts` → `fileStorage.ts` (shared infrastructure, not a forbidden edge).
- **Explicitly not in scope of this task:** installing the package, adding any config file, or wiring any CI step. This is a decision-to-proceed only. Target implementation stage: Stage 6.

## 12. Final readiness decision

**Decision: `READY_FOR_CHARACTERIZATION_TEST_IMPLEMENTATION`.**

Evidence across A/B/C/D is deep, mutually corroborating, and resolves into one contract with only 5 contradictions, all Low/Medium severity, all resolved above. Imaging's structural profile remains the cleanest in the program (zero live cross-domain transaction coupling per `DAV-06`; only two real cross-domain violations, both metadata-only and already mapped to a named port). Real, named blockers exist before Stage 1+ (`CR-03`/`BLK-02` before request-mutation exposure; `PZ-IMG-03` before any Backup/Storage KVKK-safeguard closure claim; a schema migration recommended before Stage 5 closes) — none of these blocks writing and running the characterization-test suite itself (Stage 0), which by design characterizes current behavior including these known gaps.

**Runtime modularization (Stage 1 and beyond) is explicitly NOT approved by this decision.** Not approved: any Stage 1+ code/route/service/schema change; dependency-cruiser installation/configuration; any caller migration; closure of `PZ-IMG-03`, `R-070`, `R-046`, or `R-071`; G1/G2 approval.

---

## 13. Contract catalogue

Full per-item detail (stable ID, owner, allowed caller, input, output, tenant context, actor/RBAC requirement, authorization-failure behavior, validation, idempotency, transaction expectation, audit requirement, storage side effects, backward compatibility, current implementation mapping, migration stage, blocker status) is in the JSON companion's `acceptedContractCatalogue`. Summary:

- **20 commands accepted** (`IMG-CMD-01..12`, `BRG-CMD-01..08`), adopted unchanged from F2-PREP-006-D's `candidateCommands` except the two F2-CC-14 revisions and the 6 explicit rejections below.
- **12 queries accepted** (`IMG-QRY-01..07`, `BRG-QRY-08..12`) + **2 new queries added by the F2-CC-14 revision** (`IMG-QRY-13` `GetImagesForLifecycleReview`, `IMG-QRY-14` `CheckImageStorageExists`) = **14 total**.
- **1 event accepted as candidate, not implemented** (`IMG-EVT-01` `ImagingStudyReceived`) — mechanism (in-process call vs. outbox) explicitly deferred to the Stage 1 implementation task.
- **6 items explicitly rejected**, none accepted without evidence:

| Item | Reason | Disposition |
|---|---|---|
| `RequestImagingProcessing` | No imaging AI/processing pipeline exists. | Excluded, future F10. |
| `GetImagingProcessingResult` | Same. | Excluded, future F10. |
| `UpdateProcessingStatus` (distinct concept) | Already covered by `UpdateImagingRequest`/`CancelImagingRequest`. | Rejected, not modeled. |
| `FinalizeImagingUpload` (separate two-phase step) | Both upload paths are single-shot; introducing one would be a real behavior change. | Rejected, not modeled. |
| `RequestSecureImagingAccess` (token-issuing) | Contradicts the current, source-regression-tested never-a-public-URL invariant. | Rejected. |
| `ExportImagingEvidence` (as Imaging-owned) | Export is Privacy-domain-owned today; this contract formally documents that. | Rejected as Imaging-owned. |

No candidate item is accepted without linked evidence; every rejection above is traceable to a specific finding in F2-PREP-006-D's own `assumptions`/`unresolvedQuestions`.

---

## 14. Characterization-test gate

Full per-test detail (behavior under characterization, test level, required infrastructure, tenant/storage fixtures, expected assertions, cleanup method, CI layer, failure interpretation) is in the JSON companion. Summary:

- **32 total tests** (D's 31 + 1 new: `CT-32`, `ImagingRequest` PATCH concurrency characterization, added by this consolidation to make `CR-03`/`BLK-02`'s current-behavior gap explicitly test-tracked rather than only narratively documented).
- **21 blocking**, **11 non-blocking**, **0 deferred/F10** (no F10 code exists yet to characterize).

| Bucket | Gate | Count | Tests |
|---|---|---|---|
| Mandatory before refactor | Stage 1 (additive facade) may not begin until these pass against current behavior | 18 | `CT-02,03,06,07,08,10,11,12,13,14,16,17,19,21,26,27,28,32` |
| Mandatory before caller migration | Stage 3 (Privacy/KVKK migration onto `ImagingLifecyclePort`) may not begin until these pass | 3 | `CT-05, CT-23, CT-30` |
| Mandatory before direct-access removal | Stage 7 may not remove the old direct-Prisma path unless this still passes | 1 (carries forward from the row above, not double-counted) | `CT-30` |
| Non-blocking regression coverage | — | 11 | `CT-01,04,09,15,18,20,22,24,25,29,31` |
| Deferred/F10 | — | 0 | none |

**Open question forwarded, not resolved by this task:** whether `IngestImagingStudy`'s missing audit call (no `auditImaging` invocation, unlike `CreateImagingStudy`) is an intentional bridge-volume design choice or a real gap. Forwarded to the next implementation task as a product/security decision.

---

## 15. Expand-migrate-contract sequence

Derived from evidence (F2-PREP-004's own evidence-grounded 7-stage pattern, C's 6-step migration order, and D's characterization-test gate), not assumed. The task brief's illustrative 8-stage skeleton is retained in shape but Stages 2–3 are reordered/merged relative to a naive default, because `CR-03` (concurrency hardening) must land in the same stage as the ingest-convergence work it is a prerequisite for, and Privacy/KVKK migration cannot start before both are done. Full per-stage detail (dependencies, files affected, compatibility requirements, rollback method, tenant/KVKK impact, tests required, merge gate, deployment gate, production verification requirement) is in the JSON companion's `expandMigrateContractStages[]`.

| Stage | Name | Blocking dependency |
|---|---|---|
| 0 | Characterization coverage | This contract approved |
| 1 | Additive public contract/facade | Stage 0 |
| 2 | Duplicate ingest convergence + `ImagingRequest` PATCH concurrency hardening | Stage 1; `CR-03` guard implemented |
| 3 | Privacy/KVKK caller migration onto `ImagingLifecyclePort` (revised) | Stage 2; `CT-30` passing |
| 4 | Backup/Storage caller migration (formalize accepted exception) | Stage 3 |
| 5 | Internal IMG/BRG route/service boundary cleanup | Stage 2; `ImagingBridgePairingDevice` tenant column recommended |
| 6 | Direct-access enforcement/reporting (dependency-cruiser, report-only) | Stage 5 (or at minimum Stages 1–3) |
| 7 | Contract removal/cleanup | Stage 3; zero remaining pre-Stage-3 imports; `CT-30` still passing |

---

## 16. Files changed by this task

Created: this document; `architecture/evidence/F2-PREP-006-E_imaging_boundary_contract.json`; `evidence/F2-PREP-006-E_CONSOLIDATION_EVIDENCE.md`.

Updated (additive): `CURRENT_PHASE.md`, `NORAMEDI_MASTER_TRACKER.md`, `phases/F2_MODULAR_BOUNDARIES.md`, `evidence/README.md`.

Not modified: any of the eight F2-PREP-006-A/B/C/D evidence files. No `server/`, `src/`, `.github/workflows/`, `prisma/`, or `package.json` file is touched.

No genuinely new ADR candidate was identified — ADR-015 (module boundaries and public contracts, `ACCEPTED_WITH_CONDITIONS`) already covers contract syntax/versioning/enforcement as a deferred-to-F2 decision this contract operates within. No risk-register status change — `R-070`/`R-046`/`R-071` are general, program-level risks unaffected by Imaging-specific evidence; `PZ-IMG-03` (an F2-PREP-002 finding ID, not a `RISK_REGISTER.md` row) remains `OPEN` per its own refinement history.

---

## 17. Validation performed

```
node -e "JSON.parse(require('fs').readFileSync('docs/program/architecture/evidence/F2-PREP-006-E_imaging_boundary_contract.json','utf8'))"
-> parse OK

node -e "const j=require('./docs/program/architecture/evidence/F2-PREP-006-E_imaging_boundary_contract.json');
console.log(j.acceptedContractCatalogue.commandsAccepted, j.acceptedContractCatalogue.commands.length);
console.log(j.acceptedContractCatalogue.queries.length);
console.log(j.characterizationTestGate.totalTestsReconciled, j.characterizationTestGate.totalBlocking, j.characterizationTestGate.totalNonBlocking);
console.log(j.contradictions.length, j.expandMigrateContractStages.length);"
-> 20 20
   14
   32 21 11
   5 8

git diff --check -> clean
```

Only `docs/program/**` files are changed by this task. No `server/`, `src/`, `.github/workflows/`, `prisma/`, or `package.json` file is touched. No A/B/C/D evidence file is modified. No absolute local filesystem path appears anywhere in this document or its JSON companion. No secret/token value appears anywhere.

## 18. Status separation

- **Agent completed:** yes.
- **Validations passed:** yes (JSON parse, deterministic counts, `git diff --check`, scope-restriction check — all above).
- **PR opened:** yes, against `main`, documentation-only.
- **Merged:** no.
- **Deployed:** no.
- **Production verified:** no.
- **Runtime implementation complete:** no.
- **Characterization tests complete:** no (this task defines the gate; it does not write or run any test).
- **Caller migration complete:** no.
- **F2 complete:** no.
- **G1/G2:** unchanged, `NOT_APPROVED`.
- **R-070/R-046:** unchanged, `OPEN`. **R-071:** unchanged, `CLOSURE_PROPOSED_AWAITING_EXTERNAL_CONFIRMATION`. **`PZ-IMG-03`:** unchanged, `OPEN`.
- **KVKK physical/architecture freeze:** unchanged, active, untouched.

Overall: `AGENT_COMPLETED` / `VALIDATION_PASSED` / `PR_OPENED_AWAITING_REVIEW`.

**Exact next task:** F2-PREP-007 (proposed) — Imaging Characterization Test Implementation (Stage 0), gated on external program-owner review and approval of this consolidated contract. Not started, not authorized to start by this document.

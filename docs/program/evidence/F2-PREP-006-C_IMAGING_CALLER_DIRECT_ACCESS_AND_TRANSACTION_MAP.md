# F2-PREP-006-C — Imaging Caller, Direct-Access and Transaction Flow Map

**Phase:** F2 — Modularization Preparation
**Parent:** F2-PREP-006 — Imaging Pilot Boundary Contract Definition
**Type:** EVIDENCE AND MIGRATION-PLANNING ONLY — no application code, schema, migration, test, workflow, or route/service/import change was made by this task.
**Status:** AGENT_COMPLETED / VALIDATION_PASSED / PR_OPENED_AWAITING_REVIEW

Machine-readable companion: [`F2-PREP-006-C_imaging_callers_transactions.json`](F2-PREP-006-C_imaging_callers_transactions.json) — every caller, outbound dependency, violation, transaction flow, failure point, compensation/idempotency requirement, and migration-order step below carries a stable ID (`IC-*`, `OD-*`, `DAV-*`/`SB-*`/`SUB-*`/`SMB-*`, `TXF-*`, `AT-*`/`EV-*`, `FP-*`, `CR-*`, `IR-*`) so this narrative and the JSON stay cross-referenceable.

---

## 1. Baseline

```
git cat-file -t 4cb334d213b4dbbac4193f1a8c1878deddb55714  -> commit
git worktree add "../DisKlinikCRM-worktrees/f2-prep-006-c-imaging-callers-transactions" \
  -b docs/f2-prep-006-c-imaging-callers-transactions 4cb334d213b4dbbac4193f1a8c1878deddb55714
```

- Branch: `docs/f2-prep-006-c-imaging-callers-transactions`
- Frozen baseline SHA: `4cb334d213b4dbbac4193f1a8c1878deddb55714` (merge of PR #287, `docs/f2-prep-005-consolidated-modularization-charter`) — the same SHA already used as the checkout point for sibling tasks `f2-prep-006-a-imaging-ownership-inventory`, `f2-prep-006-b-imaging-data-storage-kvkk`, and `f2-prep-006-d-imaging-contract-test-design` (confirmed via `git worktree list`, read-only — no sibling branch, worktree, or file was inspected, merged, cherry-picked, or rebased onto).
- Worktree: fresh, isolated, sibling of the main working tree.

This task does not merge `origin/main`, does not touch any sibling task's evidence, and does not update any sibling's live status. All cross-task reconciliation is explicitly deferred to **F2-PREP-006-E**.

## 2. Related prior evidence (read, not modified)

- [`docs/program/evidence/F2-PREP-002_CROSS_DOMAIN_DEPENDENCY_AND_DIRECT_ACCESS_MAP.md`](F2-PREP-002_CROSS_DOMAIN_DEPENDENCY_AND_DIRECT_ACCESS_MAP.md) / `F2-PREP-002_cross_domain_dependency_map.json` — the explicit starting point per this task's brief. Its Imaging/Bridge findings (`IMG-01`..`IMG-15`, `PZ-IMG-01`, `F2-CC-14`, `TX-06`, `TX-09`) were re-verified directly against source at this frozen baseline: **all confirmed still accurate, none contradicted**. This task extends them with exact file:line detail, a full 20-entry caller map, an 11-entry direct-access-violation inventory split by category, a 10-flow transaction map, a 9-point failure analysis, and a 6-step (not-implemented) caller migration order — none of which F2-PREP-002's coarser, cross-domain-wide pass itemized at this depth for Imaging specifically.

**Neither `MODULE_MAP.md`, `DEPENDENCY_MAP.md`, `NORAMEDI_MASTER_TRACKER.md`, `CURRENT_PHASE.md`, nor any other shared tracker/index/phase file was read as an input beyond what F2-PREP-002 already cites, and none was modified by this task.**

## 3. Scope

Per the task brief, inspection began with the IMG/BRG callers and violations already identified in F2-PREP-002 (`IMG-*`, `PZ-IMG-01`), then was extended only along **concrete** import/model/storage/queue/authorization dependencies actually found in source. Four scope expansions were required and are recorded in full in the JSON's `scopeExpansions` array:

1. `server/prisma/schema.prisma` (Imaging* model definitions) — to ground exact field names/constraints cited below.
2. `server/src/jobs/startBackgroundJobs.ts` (grep only) — to confirm the offline-sweep job is actually scheduled (queue dependency).
3. `server/src/routes/notifications.ts`, `dashboard.ts`, `reports.ts`, `platformAdmin.ts` (grep only) — negative-confirmation that no additional inbound Imaging caller exists among the codebase's known cross-domain read-aggregation surfaces.
4. `server/src/routes/labOrders.ts`, `attachments.ts`, `clinicBulkExport.ts`, `jobs/clinicBulkExportCleanupJob.ts` (grep only) — disambiguation, since F2-PREP-002 groups Imaging with Attachments/Inventory/Labs under one domain slice; all four were confirmed to contain **zero** references to any Imaging Prisma model despite superficial similarity (shared `fileStorage.ts` usage, analogous code comments).

No project-wide scan was performed. Full inspected-path list is in the JSON's `inspectedPaths` array (29 source files, 5 test files, plus the two F2-PREP-002 evidence files).

**CodeGraph** was not invoked beyond the task's own instruction to use it "only within the exact task-specific paths" — in practice, targeted `Read`+`Grep` over the scoped directories was used throughout, consistent with every prior F2-PREP task's own recorded experience that no CodeGraph tool is available in this environment.

## 4. Counts

| Metric | Count |
|---|---|
| Inbound caller / call-site entries (`inboundCallers`) | **20** |
| Outbound dependency entries (`outboundDependencies`) | **8** |
| Direct-access violation entries — general Prisma/deletion/DICOM/transaction/tenant categories (`directAccessViolations`) | **7** |
| Storage-bypass entries (`storageBypasses`) | **1** |
| Signed-URL-bypass entries (`signedUrlBypasses`) | **1** |
| Status/metadata-mutation-bypass entries (`statusMutationBypasses`) | **2** |
| **Total direct-access findings across all four violation arrays** | **11** |
| Transaction flows mapped (of the 10 named in the task brief) | **10** |
| Atomic operations confirmed | **6** |
| Eventual (non-atomic) operations confirmed | **8** |
| Partial-failure points identified | **9** |
| Compensation requirements identified | **6** |
| Idempotency requirements identified | **5** |
| Migration-order steps proposed (not implemented) | **6** |
| Temporary-compatibility needs identified | **2** |
| Blockers identified | **2** |
| Unresolved questions deferred to F2-PREP-006-E | **3** |

All counts are the literal lengths of the JSON's own arrays (see its `counts.methodologyNote`), so this table and the JSON cannot drift out of sync.

## 5. Headline findings

1. **Imaging has zero live cross-domain transaction coupling** (`DAV-06`) — unlike Billing (`treatmentStockDeduction.ts`) or Appointments (the conversion transaction), no other domain's writes are ever nested inside an Imaging `$transaction`, and no Imaging write is ever nested inside another domain's. This is the single most significant positive finding for Imaging's viability as a modularization pilot — it means the hardest class of extraction risk (shared transaction boundaries) simply does not exist here today.
2. **The two real cross-domain violations that matter are both in Privacy/KVKK, both metadata-only, and both already have a named target contract.** `SMB-01` (`orphanFileInspection.ts` writing `ImagingImage.storageVerifiedMissingAt` directly) and `SMB-02` (`patientAnonymization.ts` writing `ImagingImage.originalName` directly) map exactly onto F2-PREP-002's already-proposed `F2-CC-14` (`ImagingLifecyclePort.markStorageMissing()/redactForAnonymization()`) — no new contract design is required, only implementation.
3. **The storage-write/DB-write seam is the real structural risk, not any cross-domain coupling.** Both upload paths (manual web upload and bridge ingest) write to object storage *before and outside* the DB transaction that records the row, compensated only by a best-effort, non-retried `catch`-block `deleteFile()` (`FP-01`/`FP-02`/`FP-03`). No reverse-orphan reconciliation job exists anywhere in the codebase (`CR-01`) — a storage object can outlive its DB row forever, silently, if the process dies at the wrong instant. This is a pre-existing, codebase-wide convention (the same pattern is used for `PatientAttachment`/`LabOrderAttachment`), not unique to Imaging, but it is the item most likely to bite if Imaging's storage responsibility is ever moved behind a real network boundary rather than an in-process function call.
4. **Signed URLs, direct raw-DICOM access, and direct cross-domain deletion are all confirmed absent** (`SUB-01`, `DAV-05`, `DAV-04`) — three of the task's nine required violation categories have no findings because the pattern genuinely does not exist. All binary access is proxied through one authenticated, audited, streaming route (`streamStudyImage()`); this is an explicit, source-regression-tested design invariant and should be preserved as such by any future module boundary, not "fixed."
5. **The bridge-agent public surface (`imagingBridgePublic.ts`) is already a de-facto module boundary.** F2-PREP-002 called it a "well-hardened de-facto public contract" (`IMG-01`); this task's deeper read confirms every write path on that surface is either lock-guarded (`AT-03`, pairing redemption) or idempotency-guarded (`AT-05`/`IR-01`, study ingest via the `(clinicId, ingestKey)` unique constraint) — it requires documentation as the formal boundary, not remediation.
6. **The one internally-inconsistent concurrency gap Imaging itself owns** is `ImagingRequest` PATCH (`FP-06`/`CR-03`): unlike the upload path's own guarded `updateMany`, two concurrent staff PATCHes against the same request can clobber each other. This should be closed before `ImagingRequest` mutation is ever exposed as an external contract (`step 3` of the migration order, §8 below).
7. **No `Service`/`AppointmentType`-style dual-identity ownership ambiguity exists for Imaging** — every Imaging Prisma model (`ImagingStudy`, `ImagingImage`, `ImagingDevice`, `ImagingRequest`, `ImagingBridgeAgent`, `ImagingBridgePairing`, `ImagingBridgePairingDevice`, `ImagingBridgeBinding`) is exclusively read/written by Imaging's own routes/services, with the two Privacy exceptions (`SMB-01`/`SMB-02`) and the three read-only cross-domain callers (`DAV-01`/`DAV-02`/`DAV-03`) being the *complete* set of external touchpoints. This is a materially cleaner starting position than Billing's `OU-01` finding in F2-PREP-002.

## 6. Inbound caller map (summary)

Full detail — path, exact function/line, target model(s), access type, public/private/direct classification, tenant context, authorization context, transaction behavior, risk, evidence — is in the JSON's `inboundCallers` array (20 entries, IDs `IC-01`..`IC-20`). Summary by caller domain:

- **Imaging's own routes/job (`IC-01`..`IC-07`, `IC-13`, 8 entries):** device CRUD, request CRUD, manual study upload, study read/stream, study link/unlink/archive/legal-hold, bridge-agent management, bridge-pairing management, and the offline-sweep job. Two hard-deletes (device, bridge agent) are lock-guarded `$transaction`s; everything else is sequential read-then-write with no lock except the upload finalization transactions.
- **External bridge-agent client (`IC-08`..`IC-12`, 5 entries):** heartbeat, study ingest, pairing redemption, bootstrap, update-check — all on `imagingBridgePublic.ts`'s pre-authenticated (bearer bridge-token) public surface. Tenant is always resolved server-side from the token→agent lookup, never from client-claimed input.
- **Privacy/KVKK (`IC-14`..`IC-17`, 4 entries):** two read-only inventory/inspection calls and two metadata-mutation calls, all direct Prisma access (no Imaging-owned port exists yet) — see §7.
- **Backup/Storage, platform-level (`IC-18`..`IC-20`, 3 entries):** a read-only, cross-tenant `ImagingImage` enumeration for file-backup purposes, a restore path that never touches Imaging models directly, and Platform Admin's indirect delegation into the same backup service.

## 7. Direct-access violations, by required category

Full detail is in the JSON's four violation arrays (`directAccessViolations`, `storageBypasses`, `signedUrlBypasses`, `statusMutationBypasses`; 11 entries total, IDs `DAV-*`/`SB-*`/`SUB-*`/`SMB-*`). Coverage against the task's nine required categories:

| Category | Finding |
|---|---|
| Direct Prisma access | **3 found** — `DAV-01` (`deletionReviewInventory.ts`), `DAV-02` (`orphanFileInspection.ts`, read side), `DAV-03` (`fileBackupService.ts`) — all read-only |
| Direct storage access | **1 found** — `SB-01` (`orphanFileInspection.ts` calling `fileStorage.fileExists()` directly) |
| Direct signed URL generation | **Confirmed absent** — `SUB-01`, repo-wide grep, zero matches |
| Direct Imaging status mutation | **0 found** — no cross-domain caller mutates a `status` field on any Imaging model; both remaining mutation violations are metadata-only (below) |
| Direct metadata mutation | **2 found** — `SMB-01` (`storageVerifiedMissingAt`), `SMB-02` (`originalName` redaction) |
| Direct deletion | **Confirmed absent** — `DAV-04`, zero cross-domain deletion of any Imaging model; the two real hard-deletes are Imaging's own routes |
| Direct raw DICOM/CBCT access | **Confirmed absent** — `DAV-05`, all binary access proxied through one audited streaming route |
| Cross-domain transaction coupling | **Confirmed absent** — `DAV-06`, the headline positive finding (§5.1) |
| Cross-tenant risk | **1 found, accepted-by-design** — `DAV-07`, `fileBackupService.ts`'s platform-wide sweep, matching F2-PREP-002's already-accepted pattern for comparable platform jobs |

Every violation and every "confirmed absent" entry carries an exact `path`, `symbol`, and `evidence` field in the JSON, including the absence findings (evidenced by the specific grep pattern and file set searched), per this task's validation requirement.

## 8. Transaction flows, atomicity, and failure analysis

The 10 transaction flows named in the task brief are mapped in full in the JSON's `transactionFlows` array (`TXF-01`..`TXF-10`): upload initiation, object upload, upload finalization, metadata persistence, processing/conversion, linking, signed URL creation, deletion/archive, retry, and orphan cleanup. Two of the ten (processing/conversion, signed URL creation) are **confirmed not implemented** in this baseline — recorded as explicit findings, not gaps in this task's coverage.

- **Atomic operations (6, `AT-01`..`AT-06`):** the two hard-deletes, the pairing redemption, the two upload-finalization transactions (DB-only), and the offline-sweep bulk update.
- **Eventual/non-atomic operations (8, `EV-01`..`EV-08`):** every other mutation path, including — critically — the storage-write-then-DB-transaction seam itself (`EV-06`), which is the structural root cause of `FP-01`/`FP-02`.
- **Partial-failure points (9, `FP-01`..`FP-09`):** dominated by two classes — the storage/DB crash window (`FP-01`, `FP-02`, `FP-03`) and unlocked read-then-write races (`FP-04` through `FP-09`).
- **Compensation requirements (6, `CR-01`..`CR-06`)** and **idempotency requirements (5, `IR-01`..`IR-05`)** are derived directly from the failure points and are cross-referenced to them in the JSON.

## 9. Caller migration order (proposed, not implemented)

Per the task's instruction, this is a priority sequence for a **future** execution phase — nothing in this list has been implemented, and this task does not authorize starting it.

1. Replace `SMB-01`/`SMB-02` with `F2-CC-14` (`ImagingLifecyclePort`) — smallest surface, target shape already named.
2. Extend the same port to cover `DAV-01`/`DAV-02`'s read side.
3. Harden `ImagingRequest` PATCH concurrency internally (`CR-03`) — a pre-extraction fix, not a caller migration, but a blocking prerequisite for step 4's contract to be trustworthy if request-mutation is ever included in it.
4. Formalize `imagingBridgePublic.ts` as the documented external module boundary — already structurally isolated; needs documentation, not code change.
5. Close the storage/DB two-phase gap (`CR-01`/`CR-02`) before any real network boundary is introduced around Imaging's storage responsibility.
6. Leave `fileBackupService.ts`'s read-only cross-tenant enumeration (`DAV-03`/`DAV-07`) for last — lowest risk, already treated as an accepted pattern elsewhere in the program.

Two blockers (`BLK-01`, `BLK-02`) and three questions explicitly deferred to consolidation (`UQ-01`..`UQ-03`, including whether `ImagingBridgeBinding`'s unwired `active`/`error`/`disabled` states hint at a planned processing pipeline tied to the future `F10_IMAGING_DICOM_AND_AI` phase) are recorded in full in the JSON.

## 10. Validation

```
git status --short                                    # exactly 2 new, untracked files under docs/program/evidence/
git diff --check                                       # no whitespace-conflict-marker errors
python -c "import json; json.load(open('docs/program/evidence/F2-PREP-006-C_imaging_callers_transactions.json'))"   # valid JSON
git diff --stat --cached                               # after staging: 2 files changed, insertions only
git diff --name-only --cached                          # both files under docs/program/evidence/ only
```

- **JSON parse:** valid (see command above).
- **Deterministic counts:** every count in §4 is the literal length of its corresponding JSON array (`counts.methodologyNote`), not independently estimated.
- **Every violation entry contains `path`, `symbol`, and `evidence`:** confirmed for all 11 entries across the four violation arrays, including the three "confirmed absent" entries (`DAV-04`, `DAV-05`, `DAV-06`, `SUB-01`), which cite the exact grep pattern and searched file set as their evidence.
- **No absolute local paths:** all paths in both files are repository-relative (`server/src/...`, `docs/program/...`); the only machine-specific strings are the worktree-creation shell commands quoted verbatim in §1, which is the same convention F2-PREP-002 and all F2-PREP-006 siblings use.
- **Scope:** only `docs/program/evidence/F2-PREP-006-C_IMAGING_CALLER_DIRECT_ACCESS_AND_TRANSACTION_MAP.md` and `docs/program/evidence/F2-PREP-006-C_imaging_callers_transactions.json` were created. No runtime, schema, migration, test, workflow, or package file was changed. No shared tracker/index/phase file (`MODULE_MAP.md`, `DEPENDENCY_MAP.md`, `NORAMEDI_MASTER_TRACKER.md`, `CURRENT_PHASE.md`, etc.) was modified.

## 11. Output files

- `docs/program/evidence/F2-PREP-006-C_IMAGING_CALLER_DIRECT_ACCESS_AND_TRANSACTION_MAP.md` (this file)
- `docs/program/evidence/F2-PREP-006-C_imaging_callers_transactions.json` (machine-readable companion)

## 12. Explicit non-scope

Per the task brief and the wave's governing constraints, this task did **not**: implement any command/query/event/adapter/facade contract, fix any race or partial-failure gap identified above, move any file, change any Prisma schema/migration, change any test/CI/workflow file, implement dependency-cruiser, authorize module extraction or caller migration, merge `origin/main`, inspect any sibling F2-PREP-006 branch/worktree, or update any sibling's live status. R-070 OPEN, R-046 OPEN, R-071 CLOSURE_PROPOSED_AWAITING_EXTERNAL_CONFIRMATION, and G1/G2 NOT_APPROVED are all unaffected and were not touched. The active KVKK physical-architecture freeze is unaffected.

## 13. Next task

**Await:** F2-PREP-006-A, F2-PREP-006-B, and F2-PREP-006-D status (this task does not inspect their content, only awaits their existence as inputs to consolidation).

**Then execute: F2-PREP-006-E — the sole consolidation and current-status reconciliation owner**, which must reconcile this caller/transaction map against F2-PREP-006-A's ownership inventory, F2-PREP-006-B's data/storage/KVKK evidence, and F2-PREP-006-D's contract-test design, and decide triage (immediate pre-pilot blocker / pilot prerequisite / normal backlog) for `BLK-01`, `BLK-02`, and the six migration-order steps in §9. This evidence alone does not authorize starting any remediation or extraction work.

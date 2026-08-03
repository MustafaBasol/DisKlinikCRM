# F2-PREP-008 — Stage 1 Imaging Internal Facade Preparation and Authorization — Evidence

**Phase:** F2 — Modular Monolith Guardrails / Imaging Early Implementation Gate.
**Parent contract:** [F2-PREP-006-E_IMAGING_BOUNDARY_CONTRACT.md](../architecture/F2-PREP-006-E_IMAGING_BOUNDARY_CONTRACT.md) (`expandMigrateContractStages[1]`, `blockerDecisions`, `f2cc14Decision`) and its companion `docs/program/architecture/evidence/F2-PREP-006-E_imaging_boundary_contract.json`.
**Stage 0 lineage:** F2-PREP-007-A ([evidence](F2-PREP-007-A_IMAGING_CHARACTERIZATION_AUTH_SHAPE_EVIDENCE.md), PR #293), -B ([evidence](F2-PREP-007-B_IMAGING_CHARACTERIZATION_TENANT_LIFECYCLE_EVIDENCE.md), PR #294), -C ([evidence](F2-PREP-007-C_IMAGING_CHARACTERIZATION_INGEST_STORAGE_EVIDENCE.md), PR #295), -D ([evidence](F2-PREP-007-D_IMAGING_REQUEST_CONCURRENCY_EVIDENCE.md), PR #296), -E ([evidence](F2-PREP-007-E_IMAGING_CHARACTERIZATION_WAVE_CONSOLIDATION_EVIDENCE.md), PR #298).
**Type:** DOCUMENTATION/EVIDENCE AND PROGRAM-CONTROL ONLY. No application code, Prisma schema/migration, package script, CI workflow, or test file is added, removed, or modified by this task. **No imaging facade implementation exists after this task.**
**Status:** `AGENT_COMPLETED` / evidence and static validation only (see §12) / PR opened: [#301](https://github.com/MustafaBasol/DisKlinikCRM/pull/301), branch `docs/f2-prep-008-imaging-facade-stage1-prep` → `main`, state `OPEN` (re-verified by this document's own correction pass, §17). Not merged, not deployed, not production-verified.

---

## 1. Baseline and worktree isolation

- `origin/main` fetched and confirmed at `1a97d542a6c16aa58f13774588b6b987b3fbf79b` — this is exactly PR #298's own merge commit (`gh pr view 298` → `mergedAt: 2026-08-03T08:20:40Z`, `mergeCommit` = this SHA; also independently visible as `git log --oneline -1 origin/main`).
- Working branch `docs/f2-prep-008-imaging-facade-stage1-prep` created directly from `origin/main` at that exact SHA (`git checkout -b ... origin/main`).
- `git status --short` confirmed a clean tree immediately after checkout.
- This is a dedicated isolated worktree (not the primary working tree, which is on an unrelated branch, `claude/treatment-proposal-pdf-p1-d4k0jl`, and was never touched by this task).
- `AGENTS.md` (repository root) read in full — generic MVP/product-scope guidance (patient/appointment/treatment CRM, explicit non-goal "Medical imaging storage" as a *new-feature* scope warning for the MVP, not a prohibition on this preparation-only architecture task). No path-specific `AGENTS.md` exists under `docs/program/`, `server/src/routes/`, or `server/src/services/imaging/` (confirmed via `find . -iname AGENTS.md`, one result: the root file only).

## 2. Mandatory gate checks (performed before any file edit)

| Check | Result | Evidence |
|---|---|---|
| Is `F2-PREP-008` already used anywhere in the tracker? | No | `grep -n "F2-PREP-008\|F2-IMPL-001-A" docs/program/NORAMEDI_MASTER_TRACKER.md` → no matches |
| Is Stage 0 authoritatively closed per the tracker's own stated criterion? | **Yes, independently confirmed by this task** (see §3 caveat) | See below |
| Do F2-PREP-007-A through -E show `MERGED`/CI-passed status? | Yes, all five | See table below |
| Does any newer accepted tracker decision assign a different next task or a different order? | No | The tracker's own "Exact next task, three distinct items" text (F2-PREP-007-E entry) names Stage 1 prep as item (2), gated only on item (1) |

**PR merge/CI verification performed independently by this task (not assumed from the tracker's own prose, which was written pre-merge):**

| PR | Task | `gh pr view` state | `mergedAt` | Merge commit | Ancestor of `origin/main`? |
|---|---|---|---|---|---|
| #293 | F2-PREP-007-A | `MERGED` | 2026-08-02T21:04:25Z | `43b92dde43e4c0606a6333997a81de7ea3ed247c` | Yes (`git merge-base --is-ancestor`, exit 0) |
| #294 | F2-PREP-007-B | `MERGED` | 2026-08-02T20:21:37Z | `bfc1b7317e95881fa68306a0f190f3d0570596a3` | Yes (exit 0) |
| #295 | F2-PREP-007-C | `MERGED` | 2026-08-02T21:33:44Z | `0d48d9fdea5d33f0a1acf88da9060702526c8bd1` | Yes (exit 0) |
| #296 | F2-PREP-007-D | `MERGED` | 2026-08-02T20:37:23Z | `801ddbe4714b9aa92bafa4689be9c474eb2270db` | Yes (exit 0) |
| #298 | F2-PREP-007-E (Stage 0 consolidation) | `MERGED` | 2026-08-03T08:20:40Z | `1a97d542a6c16aa58f13774588b6b987b3fbf79b` | Yes — **is** `origin/main` HEAD |

**Post-merge main CI, the exact head SHA used as this task's baseline:** `gh run list --commit 1a97d542a6c16aa58f13774588b6b987b3fbf79b` → one run, `ci-main-and-nightly`, `event: push`, `conclusion: success`. `gh run view 30797032835 --json jobs` → all 9 `ci-layers` jobs `success` (Layer 1 ×4, Layer 2, Layer 3, Layer 4, Layer 5 ×2).

**Gate check result: PASS.** Proceeding to Stage 1 preparation/authorization.

## 3. Authoritative tracker status found, and one caveat this task discloses explicitly

The tracker's own top entry (F2-PREP-007-E, dated 2026-08-03) states: *"authoritative Stage 0 closure becomes effective only after PR #298 is merged to `main` and its post-merge main CI run passes"* and, because that entry was authored while PR #298 was still open, its own status line still reads *"PR opened yes (#298, `OPEN`); merged no."* Both `CURRENT_PHASE.md` and `phases/F2_MODULAR_BOUNDARIES.md` carry the identical pre-merge wording ("PR #298 (open, not merged)").

**This task independently re-verified, via live `gh`/`git` commands (§2 table above, not by trusting the tracker's own prose), that PR #298 has since merged and its post-merge main CI has passed on the exact commit this task uses as its baseline.** Both conditions the tracker itself defines for authoritative Stage 0 closure are therefore satisfied. This matches the exact program-control pattern used by every prior F2-PREP transition in this tracker (e.g. F2-PREP-006-A's own entry independently re-verifies PRs #288/#289/#290/#291 as `MERGED` and cites a post-merge CI run before treating F2-PREP-006-E as unblocked): a PR merging with passing CI is this program's operative definition of "program-owner approval," and no separate written entry has historically been required before the next task proceeds.

Per instruction, **this task does not edit F2-PREP-007-E's own entry** in any document (its text remains historically accurate as-authored). Instead, this task's own new tracker/phase-doc entries (§11) explicitly record the post-merge confirmation as *this task's own finding*, so the discrepancy between F2-PREP-007-E's pre-merge prose and the now-merged reality is fully traceable rather than silently resolved.

**Stage 0 characterization coverage (from the merged F2-PREP-007-E consolidation, re-confirmed present on `main`):** 21 of 21 blocking tests implemented and passing (all 18 mandatory-before-refactor + all 3 mandatory-before-caller-migration); 11 non-blocking tests (`CT-01,04,09,15,18,20,22,24,25,29,31`) explicitly not yet implemented, carried forward, non-gating. `server/package.json`'s `test:imaging-characterization` script exists on `main` (confirmed by direct read) and is wired into the CI-owned `server:test:disposable-db` aggregate, itself run by `ci-layers.yml`'s Layer 3 job (part of the passing run cited above).

## 4. Repository-evidence analysis — exact locations

All line numbers below were read directly from the working tree at the baseline commit `1a97d542a6c16aa58f13774588b6b987b3fbf79b`, not copied from prior evidence documents (though they corroborate them exactly).

### 4.1 Entry points

**`server/src/routes/imaging.ts` (1,303 lines, 27 routes) — authenticated, session-JWT-protected, all behind `authorize([...IMAGING_CLINICAL_ROLES])` or `authorize([...IMAGING_MANAGE_ROLES])` / `authorize(['OWNER','ORG_ADMIN'])`:**

| Route | Line | Notes |
|---|---|---|
| `POST /api/imaging/requests` | 435 | Create `ImagingRequest` |
| `PATCH /api/imaging/requests/:id` | 487 | **CT-32 surface** — status-transition mutation |
| `PATCH /api/imaging/requests/:id/cancel` | 530 | **CT-32 surface** — cancel mutation |
| `POST /api/imaging/studies` | 559 | Manual ingest (upload) — transaction at 614 |
| `GET /api/imaging/unlinked` | 692 | Unlinked-queue query |
| `GET /api/patients/:patientId/imaging` | 711 | Cross-domain read (Patients-facing) |
| `GET /api/imaging/studies/:id` | 737 | |
| `GET .../images/:imageId/preview` \| `/download` | 796, 800 | Live re-authenticated stream, never a signed URL/redirect |
| `PATCH /api/imaging/studies/:id/link` | 807 | **CT-23 surface** — `LinkImagingStudy`, see §6 |
| `PATCH /api/imaging/studies/:id/unlink` \| `/archive` \| `/unarchive` \| `/legal-hold` | 859, 916, 920, 927 | |
| `GET/POST/revoke/DELETE /api/imaging/bridges*` | 992–1080 | BRG admin edge (`BRG-RT-01..08`) |
| `POST/GET/DELETE /api/imaging/bridge-pairings*` | 1178–1268 | BRG admin edge |
| `GET /api/imaging/bridge-onboarding/config` | 1299 | BRG admin edge |
| `GET/POST/PUT/DELETE /api/imaging/devices*` | 262–339 | `ImagingDevice` CRUD |

`imaging.ts:807-854` (`LinkImagingStudy` full body) and `imaging.ts:487-524`/`530-552` (`UpdateImagingRequest`/`CancelImagingRequest`) were read in full — see §6/§7.

**`server/src/routes/imagingBridgePublic.ts` (606 lines, 5 routes) — unauthenticated at the HTTP-session layer, authenticated instead via `authenticateBridgeAgent(req)` (bearer-token-hash lookup against `ImagingBridgeAgent`), the sole BRG device-facing edge:**

| Route | Line |
|---|---|
| `POST /api/imaging/bridge/heartbeat` | 130 |
| `POST /api/imaging/bridge/studies` | 199 (bridge ingest — transaction at 301) |
| `POST /api/imaging/bridge/pair` | 399 |
| `GET /api/imaging/bridge/bootstrap` | 558 |
| `GET /api/imaging/bridge/update` | 590 |

32 total routes (27 + 5), matching F2-PREP-006-A's independently-reproduced count exactly, re-verified again by this task via `grep -n '^router\.'` on both files.

**No `server/src/modules/imaging/` directory exists** (confirmed: `ls server/src/modules/` has no `imaging` entry) — there is no existing module boundary to preserve or violate; any Stage 1 facade is genuinely additive, not a relocation.

**Services actually called by these routes** (`server/src/services/imaging/`): `bridgeOnboardingConfig.ts` (66 lines), `bridgePairing.ts` (45), `bridgeTokens.ts` (22), `bridgeUpdateConfig.ts` (208), `imagingRequestTransitions.ts` (46, exports `validateRequestTransition`/`ALLOWED_REQUEST_TRANSITIONS`, imported by `imaging.ts:54`), `imagingUploadValidation.ts` (37), `releaseMetadataValidation.ts` (80). No file named `public.ts`, `facade.ts`, or `port.ts` exists in this directory today.

### 4.2 Ownership / transaction / storage / audit / tenant-check locations

- **Tenant resolution:** `resolveEffectiveClinicId(req.user!, ...)` (`server/src/utils/clinicScope.ts`, imported `imaging.ts:33`), called at every route that accepts a `clinicId` from the caller (e.g. lines 289, 439, 570, 1017, 1192). `findStudyInScope`/`findRequestInScope` (`imaging.ts:186`, `:197`) additionally scope every by-ID lookup to the resolved clinic before any mutation proceeds.
- **RBAC:** `authorize([...])` (`server/src/middleware/auth.ts`, imported `imaging.ts:26`) wraps every route in both files; the bridge-public file uses `authenticateBridgeAgent` instead (device-token identity, not a user session).
- **Transactions:** `prisma.$transaction` at `imaging.ts:348` (device delete, `SELECT ... FOR UPDATE` pattern per F2-PREP-007-D's own citation), `imaging.ts:614` (manual ingest: create `ImagingStudy` + `ImagingImage`, conditionally `updateMany` the linked `ImagingRequest`), `imaging.ts:1089` (bridge-pairing), `imagingBridgePublic.ts:301` (bridge ingest — same create-study/create-image/conditional-request-update shape as `imaging.ts:614`, independently written, no shared function — this is `OVL-01`, see §9) and `imagingBridgePublic.ts:421`.
- **Storage:** `buildStorageKey`/`saveFile`/`deleteFile`/`fileNameFromKey`/`openFileStream` from `server/src/services/fileStorage.ts` (imported `imaging.ts:29`, `imagingBridgePublic.ts` equivalent import) — the existing internal storage abstraction; both ingest paths call `saveFile` before the DB transaction and `deleteFile` in a catch-block compensation step (`imaging.ts:679`: `if (storageKey) await deleteFile(storageKey).catch(() => {})`).
- **Audit/activity:** `auditImaging(...)` (`imaging.ts:103`, a local async function wrapping the shared audit-log write) and `logActivity(...)` (shared activity-log service) are called after every successful mutating route (e.g. `imaging.ts:596`/`612` for link, `:516`/`:547` for request update/cancel, `:653`/`:668` for upload).

### 4.3 Prisma models (scope: only the Imaging-owned ones, per this task's explicit path limit)

`server/prisma/schema.prisma:2571` `ImagingRequest` (clinicId-scoped, `patientId` required, `status` string enum-by-convention `requested|scheduled|received|cancelled|failed`, no version/optimistic-lock column); `:2598` `ImagingStudy` (`clinicId`-scoped, `patientId` nullable — unlinked queue, `imagingRequestId` nullable, `legalHold`/`legalHoldReason` fields, `@@unique([clinicId, ingestKey])` for bridge idempotency); `:2547` `ImagingDevice`; `:2652`/`:2693`/`:2718`/`:2731` the four `ImagingBridge*` models; `:2751` `ImagingImage`. No field beyond what is listed here was inspected (patient-linkage and legal-hold fields only, per the task's own scope limit). **No schema file was modified.**

### 4.4 Cross-domain dependency direction (from `F2-PREP-006-E_imaging_boundary_contract.json`, independently spot-checked against the three cited files)

- **Accepted, documented exception (to be formalized, not remediated as a violation):** three Privacy/KVKK services call Imaging models directly — `server/src/services/privacy/deletionReviewInventory.ts` (read), `server/src/services/privacy/orphanFileInspection.ts` (read + direct storage `fileExists` check + a metadata write), `server/src/services/privacy/patientAnonymization.ts` (metadata write). Target contract: **`ImagingLifecyclePort`** (F2-CC-14, `ACCEPTED_AND_REVISED` — 2 command methods `markStorageMissing`/`redactForAnonymization`, 2 query methods `getImagesForLifecycleReview`/`checkImageStorageExists`).
- **Accepted, lowest-priority shared-infrastructure exception:** `server/src/services/fileBackupService.ts` reads Imaging rows read-only for a cross-tenant backup sweep; never mutates. `PZ-IMG-03` (backup RBAC — insufficient proof) is tracked against this caller but is explicitly a Storage/Platform-Admin boundary concern, not gating Imaging's own boundary work.
- **Accepted, unchanged:** `GET /api/patients/:patientId/imaging` is Imaging-owned and Imaging-served (not a Patients-domain direct-Prisma call).
- **Forbidden (per the accepted contract's own `forbiddenDirectAccess` list, unchanged by this task):** any domain outside IMG/BRG writing directly to the eight Imaging/Bridge models except the two accepted exceptions above; any bridge-public caller deriving `clinicId` from anything other than the server-matched agent row; any route/service returning a signed URL, static path, or redirect for binary imaging content.
- **Zero live cross-domain transaction coupling** (`DAV-06`, F2-PREP-006-C's headline finding, not re-litigated by this task).

## 5. Current Imaging boundary and dependency findings — summary

Imaging (`IMG`) owns `ImagingDevice`/`ImagingRequest`/`ImagingStudy`/`ImagingImage`. `BRG` (bridge) is **one module, two documented edges**: a device-facing anti-corruption/adapter edge (`imagingBridgePublic.ts`, already correctly shaped, no PHI/token/filename logging, uniform 401, content-addressed idempotency) and an admin-facing edge that is ordinary same-process domain logic physically co-located inside `imaging.ts` (`BRG-RT-01..08`, scheduled for a future Stage 5 physical relocation, **not this task**). This task adds nothing to, and moves nothing within, either edge; see §8.

Both edges' write paths independently duplicate the same three-step transaction skeleton (create `ImagingStudy`, create `ImagingImage`, conditionally advance a linked `ImagingRequest`) — `OVL-01`, characterized (F2-PREP-007-C, 8 tests, no defect, duplication confirmed present but not a correctness bug) and its accepted resolution is to **converge** behind one shared internal application service, explicitly **not at Stage 1** (the accepted contract's Stage 2 is where convergence is scheduled; Stage 1 is additive-only and does not touch either ingest handler). This task does not converge OVL-01.

## 6. CT-23 treatment

**Route:** `PATCH /api/imaging/studies/:id/link` (`server/src/routes/imaging.ts:807-854`), handler `LinkImagingStudy`.

**Exact defect (re-confirmed by this task's own direct read, matching F2-PREP-007-B's `VERIFIED_DEFECT` finding verbatim):** the handler validates the newly-supplied `patientId`/`appointmentId`/`treatmentCaseId` against the clinic only, via `validateClinicalLinks` (line 815-820), and never reads or compares `study.imagingRequestId`'s own `patientId` at any point; `study.imagingRequestId` is neither cleared nor re-validated. A study created from an `ImagingRequest` can therefore be relinked to a different patient while still carrying a request ID that belongs to the original patient — the boundary contract's own catalogued assertion for `CT-23` ("a study created from an ImagingRequest cannot be relinked to an appointmentId/treatmentCaseId inconsistent with the originating request's own patient") does not hold against current behavior.

**Why Stage 1 facade preparation does not fix it, and must not:** this task adds no code. The proposed Stage 1 facade design (§7) does not expose `LinkImagingStudy` (or any command touching `ImagingStudy.imagingRequestId` reconciliation) as part of its initial, minimum operation inventory — see §7.2. No command in the proposed facade is defined in a way that would require, imply, or codify the current permissive relink behavior as a correct invariant; the facade's DTO/typed-error contract for any *future* study-linking command is explicitly required (§7.3) to be designed against the catalogue's own originally-intended assertion, not against today's defect.

**Contract constraint carried forward by this task, unchanged in substance from F2-PREP-007-B/E's own language:** `CT-23` remains a blocker **before** `LinkImagingStudy` (or any equivalent command) is exposed through any facade beyond `imaging.ts` itself, and before Stage 3 caller migration. Its formal addition to `F2-PREP-006-E_imaging_boundary_contract.json`'s `blockerDecisions` object remains **undecided** — F2-PREP-007-B/E explicitly left that disposition to "whichever task next updates the boundary contract." **This task does not update `blockerDecisions`** (that JSON file is not touched by this task — updating an accepted architecture contract is a materially different, larger-scoped decision than an internal facade authorization, and is out of this task's authority). This task instead records, in its own JSON companion (§ machine-readable), that `CT-23`'s blocker-decision disposition remains open and that Stage 1 authorization does not resolve it.

## 7. CT-32 / CR-03 / BLK-02 / FP-06 treatment

**Routes:** `PATCH /api/imaging/requests/:id` (`imaging.ts:487-524`) and `PATCH /api/imaging/requests/:id/cancel` (`imaging.ts:530-552`).

**Exact defect (re-confirmed by this task's own direct read, matching F2-PREP-007-D's characterization):** both handlers `findRequestInScope` (a plain `findFirst`), validate the requested transition against that in-memory snapshot via `validateRequestTransition` (synchronous, no DB re-check), then call `prisma.imagingRequest.update({ where: { id }, data })` — `where` is `{ id }` only. No `SELECT ... FOR UPDATE`, no `$transaction`, no `WHERE status = <snapshot>` guard, no optimistic-lock column on `ImagingRequest` (confirmed against `schema.prisma:2571-2596` — no `version`/`lockVersion` field exists). Two concurrent requests that both read `status: 'requested'` before either commits can both pass validation and both write — last write wins silently, no 409. F2-PREP-007-D's test (153/153 assertions, 30/30 deterministic rounds) reproduces `BOTH_SUCCESS_SILENT_CLOBBER` against this exact code path.

**Why an unused facade skeleton does not remediate it:** no code is added by this task. Even in the future Stage 1 implementation, the accepted contract already scopes Stage 1 as additive/unused with zero new callers (`expandMigrateContractStages[1].productionVerificationRequirement: "None required (additive, no new caller yet)"`) — an unused facade wrapping `UpdateImagingRequest`/`CancelImagingRequest` 1:1 would only mirror the existing race, not create a new caller that could trigger it, and per §7.2 below this task's proposed minimum operation inventory does not include either command in its Stage 1 slice at all.

**Blocker retained, unchanged:** `CR-03`/`BLK-02`/`FP-06` remain a **pre-contract-exposure blocker** — required to be resolved no later than Stage 2, and strictly before `UpdateImagingRequest`/`CancelImagingRequest` are exposed as callable commands to any caller beyond `imaging.ts` itself. This task's authorization decision (§16) explicitly does not authorize including either command in any facade surface until that guard exists.

## 8. BLK-01 and OVL-01 treatment

**`BLK-01`/`CR-01`/`CR-02` (storage/DB compensation gap):** the manual-ingest handler's own compensation is best-effort only — `imaging.ts:679`, `if (storageKey) await deleteFile(storageKey).catch(() => {})`, a fire-and-forget cleanup with no retry/reconciliation if the DB transaction fails after a successful `saveFile`. Per the accepted contract's own `blockerDecisions.storageDbCompensationGap`, this is **not a blocker for modular-monolith-internal boundary work** (no network/process boundary is introduced by Stage 0-7 as scoped), and **is** a blocker only before a future, separately-authorized decision to extract Imaging's storage responsibility behind a real network boundary. An internal, in-process facade that calls the exact same `saveFile`/`deleteFile`/`prisma.$transaction` sequence introduces no new failure mode beyond what already exists — it does not need to (and, per §7.3/§7.5, must not claim to) pretend atomicity that isn't there today.

**`OVL-01`(manual vs bridge ingest duplication):** confirmed separate — `imaging.ts:614-656` and `imagingBridgePublic.ts:301-341` are two independently-written `prisma.$transaction` blocks with no shared function either calls (re-verified by this task's own read, §4.2/§9 of this document; also F2-PREP-006-A's original finding, F2-PREP-007-C's characterization confirming no defect from the duplication itself). Convergence remains the accepted target (F2-PREP-006-E `duplicateIngestConvergenceDecision`: "CONVERGE") but is explicitly scheduled behind a **later, shared internal application service** — the accepted Stage sequence places this at Stage 2, not Stage 1. This task's proposed Stage 1 facade (§9) does not merge, wrap, or touch either ingest handler; both remain fully independent and unmodified.

## 9. Proposed internal facade/port design (paper design only — not implemented by this task)

### 9.1 Ownership / location

`server/src/services/imaging/public.ts` (new file, not created by this task) — this exact path is already named by the accepted `F2-PREP-006-E` contract's own Stage 1 definition (`expandMigrateContractStages[1].filesAffected[0]`), so this design follows an already-accepted module boundary rather than inventing a new one. It lives inside the existing `server/src/services/imaging/` directory (IMG's own owned-services location, alongside `imagingRequestTransitions.ts` et al.) — not a new top-level module, not `server/src/modules/imaging/` (which does not exist and is not created by this design).

### 9.2 Minimum operation inventory (commands vs. queries — no broad generic repository interface, no Prisma model as a contract type)

Given §6/§7's blocker analysis, the safest, smallest first slice deliberately **excludes** `LinkImagingStudy` (CT-23 surface) and `UpdateImagingRequest`/`CancelImagingRequest` (CT-32/CR-03 surface) entirely. It starts from the sub-contract that is already fully specified and accepted — `ImagingLifecyclePort` (F2-CC-14, `ACCEPTED_AND_REVISED`) — because its four methods are the only part of the 20-command/14-query catalogue with a pre-existing, named, accepted shape:

- **Commands:** `markStorageMissing(imageId: string): Promise<void>`, `redactForAnonymization(imageId: string, reason: RedactionReason): Promise<void>`.
- **Queries:** `getImagesForLifecycleReview(clinicId: string, patientId: string): Promise<ImagingLifecycleImageDto[]>`, `checkImageStorageExists(imageId: string): Promise<boolean>`.

No method takes or returns a Prisma model type; every parameter/return type is a purpose-built DTO or primitive (§9.3). No generic `findMany`/`update`-shaped passthrough is defined — each method name states a business operation, matching the accepted catalogue's own command/query framing.

### 9.3 DTO and typed-error contract

Return types are new, purpose-built interfaces (e.g. `ImagingLifecycleImageDto { id, studyId, clinicId, patientId, legalHold, storageKey }` — a strict subset of `ImagingImage`/`ImagingStudy` fields, never the Prisma model itself, never `legalHoldReason` unless the caller is already authorized to see it per the existing `canSeeLegalHoldReason` check). Errors are a small closed union (e.g. `ImagingNotFoundError`, `ImagingLegalHoldViolationError`, `ImagingStorageUnavailableError`) — never a raw Prisma `PrismaClientKnownRequestError` or a raw storage-provider exception crossing the facade boundary. This mirrors the existing route-layer discipline already visible in `imaging.ts` (routes catch and translate to sanitized JSON error bodies today; the facade continues that discipline one layer lower rather than introducing a new one).

### 9.4 Tenant/security boundary

The facade **assumes an already-authenticated, already-tenant-resolved caller context** — it does not perform its own session/JWT verification (that remains route-layer, unchanged, per `authorize()`/`authenticateBridgeAgent()`).

**Signature constraint carried forward, unchanged, from the accepted F2-CC-14 contract.** Per `F2-PREP-006-E_IMAGING_BOUNDARY_CONTRACT.md` §9 ("`ImagingLifecyclePort` now specifies both the original two command methods (`markStorageMissing(imageId)`, `redactForAnonymization(imageId)`, unchanged) **and** two new query methods added by this consolidation: `getImagesForLifecycleReview(clinicId, patientId)` ... and `checkImageStorageExists(imageId)`") and the companion JSON's `f2cc14Decision.revisedScope` field (identical wording), three of the four accepted methods — `markStorageMissing`, `redactForAnonymization`, `checkImageStorageExists` — take `imageId` only, with **no** `clinicId` parameter; only `getImagesForLifecycleReview` takes an explicit `clinicId` (plus `patientId`). This is the already-accepted shape and is **not** revised by this task. **Correction:** an earlier draft of this section incorrectly stated "every method requires an explicit `clinicId` parameter," which directly contradicted §9.2's own operation inventory (3 of 4 signatures shown there do not take `clinicId`) and has been removed as unacceptable ambiguity for a tenant/KVKK data-isolation boundary.

**Tenant-context enforcement mechanism for the three `imageId`-only methods.** These are **tenant-context-only operations** — never callable in a system/cross-tenant context, never exposed to an unauthenticated or cross-tenant caller. The facade requires the caller to already hold a tenant-scoped request context (the same `resolveEffectiveClinicId(req.user!, ...)`-derived clinic identity every existing route in `imaging.ts` establishes before calling into any service function, §4.2). Internally, each of the three `imageId`-only methods **re-derives the image's actual owning `clinicId`** via the existing `ImagingImage → ImagingStudy → clinicId` relation — the same traversal `orphanFileInspection.ts`/`patientAnonymization.ts` already rely on today (e.g. `patientAnonymization.ts:105-106`, `prisma.imagingImage.findMany({ where: { clinicId, study: { patientId } } })`) — and **throws** (`ImagingNotFoundError`, deliberately indistinguishable from a genuinely-missing row, to avoid a cross-tenant existence-leak side channel) if the derived `clinicId` does not match the caller's ambient tenant context. **No unscoped `prisma.imagingImage.findUnique`/`update` by `imageId` alone is permitted anywhere in the facade implementation** — every Prisma call the facade makes against `ImagingImage` must include the ownership traversal (a `where` clause reaching `clinicId` either directly or through `study.clinicId`), whether or not `clinicId` is one of that method's own formal parameters.

**Why this is at least as strong as current tenant isolation — no regression.** Today, `markConfirmedMissing` (`orphanFileInspection.ts:112-136`, `SMB-01`) and `redactPatientImagingImages` (`patientAnonymization.ts:103-131`, `SMB-02`) already call `prisma.imagingImage.update({ where: { id: image.id }, ... })` — `imageId`-only, exactly the accepted port's shape — and rely entirely on the `id` values having already been produced by a prior `clinicId`-scoped `findMany` earlier in the *same* function call, with no re-check at the point of mutation. The facade's re-derivation-and-throw check (previous paragraph) adds a **second, independent verification at the point of mutation that does not exist in today's code**, rather than removing the one that does — so the resulting contract is strictly stronger than, not merely equal to, today's route-level/service-level checks. `getImagesForLifecycleReview(clinicId, patientId)` is the only source of `imageId` values a caller obtains through the facade; no facade method accepts a bare, externally-supplied `imageId` with no upstream tenant provenance and no internal ownership re-check.

**`getImagesForLifecycleReview(clinicId, patientId)`** is the one method that does take an explicit `clinicId`; every internal Prisma call it makes is scoped by that `clinicId` directly (mirroring `findStudyInScope`'s existing pattern, §4.2), consistent with its accepted signature.

The facade **does not weaken, replace, or bypass** any existing route-level `authorize()`/`authenticateBridgeAgent()` check — because it has zero callers at merge time (§9.9), it cannot yet be reached by any request path, authenticated or not.

### 9.5 Transaction ownership and the compensation gap

The facade **owns** its own `prisma.$transaction` boundaries where a method's semantics require atomicity across more than one write (none of the four Stage-1 methods do — each is a single-row read or single-row metadata write). The facade does **not** claim atomicity across the storage write and the DB write for any future ingest-touching method — per §8, that gap (`BLK-01`) is explicitly out of scope for internal modular-monolith work and is represented honestly (a documented "best-effort, not atomic" comment mirroring `imaging.ts:679`'s own existing pattern) rather than papered over.

### 9.6 Storage boundary

Any facade method that needs storage access depends on the existing `server/src/services/fileStorage.ts` abstraction (`saveFile`/`deleteFile`/`openFileStream`) exactly as `imaging.ts`/`imagingBridgePublic.ts` already do — no new storage client, no S3-specific or local-specific branching inside the facade, no change to legal-hold/lifecycle behavior (`legalHold`/`legalHoldReason` fields are read, never silently cleared or bypassed).

### 9.7 Cross-domain contracts

The facade's initial four methods **are** the `ImagingLifecyclePort` that Privacy's three existing direct-Prisma callers (`deletionReviewInventory.ts`, `orphanFileInspection.ts`, `patientAnonymization.ts`) are accepted (not yet required) to migrate onto — but **this task does not migrate them**. Migrating those call sites onto the new facade is caller-migration work, explicitly a later stage (the accepted contract's Stage 3 scope), not Stage 1. At Stage 1 merge time, the facade exists, compiles, and is covered by its own tests, but **zero existing files import it** — Privacy's three services keep their current direct Prisma access entirely unchanged, and `fileBackupService.ts`'s accepted shared-infrastructure exception is likewise untouched. No new direct cross-domain Prisma/infra access is introduced by this design.

### 9.8 Observability/audit

Facade methods that mutate data emit through the same shared audit/activity-log mechanism `imaging.ts`'s own routes already call (`auditImaging`-equivalent), including a correlation/request-scoped identifier where the caller supplies one, consistent with the route layer's existing practice. No filename, token, or raw PHI/PII value is added to any log line beyond what the current routes already log (i.e., none — `imaging.ts`'s own header-level design invariant of never logging patient-identifying values is preserved, not weakened).

### 9.9 Compatibility/rollback

Zero existing callers are touched. The facade is a wholly new, self-contained file plus its own test file; nothing in `imaging.ts`, `imagingBridgePublic.ts`, or the Privacy services imports it at merge time. Rollback is `git revert` of the single facade commit (or straight file deletion) — no migration, no feature flag, no deploy-config change, no data to un-migrate, because nothing depends on it yet. This satisfies the accepted contract's own Stage 1 `rollbackMethod`: *"Delete the new public.ts/facade file(s); nothing else depends on them yet."*

### 9.10 Test ownership (for the future implementation task, not built by this task)

A focused compile/type contract test (the facade's own exported function signatures match its declared DTO/error types — a `tsc --noEmit`-level check plus a narrow runtime seam test comparing the facade method's output to the equivalent existing direct call, 1:1, per the accepted contract's own Stage 1 `testsRequired` language) and, where practical, an "unused-ness" check (e.g. a lint/grep-based assertion or a dedicated test asserting no production route file imports the new module yet). This does **not** duplicate `test:imaging-characterization`'s existing 21 assertions-worth of coverage; `test:imaging-characterization` remains owned by Layer 3's disposable-PostgreSQL CI exactly as F2-PREP-007-E wired it, unchanged. No new CI workflow file or job is proposed — the future facade's own tests are expected to run wherever `server:test:disposable-db` already runs (Layer 3), the same placement rationale F2-PREP-007-E used for the four characterization suites; this task found no repository evidence requiring a dedicated new job.

## 10. Tenant, KVKK, authentication, audit, storage, and security impact of this task

**None.** This task adds two documentation files, updates four existing program-control documents additively, and touches no application code, schema, migration, package script, or CI workflow. The design in §9 is paper-only. Tenant/RBAC/audit/storage/legal-hold behavior in the running application is byte-for-byte unchanged by this task.

## 11. Files changed by this task

| File | Change |
|---|---|
| `docs/program/evidence/F2-PREP-008_STAGE1_IMAGING_FACADE_PREP_AND_AUTHORIZATION.md` | New — this document |
| `docs/program/evidence/F2-PREP-008_stage1_imaging_facade_prep_and_authorization.json` | New — machine-readable companion |
| `docs/program/NORAMEDI_MASTER_TRACKER.md` | Additive — new top entry (prior F2-PREP-007-E entry preserved verbatim, demoted to "Prior update") |
| `docs/program/CURRENT_PHASE.md` | Additive — new top entry (same pattern) |
| `docs/program/phases/F2_MODULAR_BOUNDARIES.md` | Additive — status line and top summary paragraph updated to record Stage 0 authoritative closure and the Stage 1 authorization decision; one new change-history table row |
| `docs/program/evidence/README.md` | Additive — one new index row for this document |

No `server/**`, `.github/workflows/**`, or `server/prisma/schema.prisma` file is touched.

## 12. Validation commands and results

This is a documentation/evidence task; per this task's own instructions, the full backend test suite was **not** run (no repository rule found requiring it for tracker/phase-doc/evidence-only changes — `AGENTS.md` and the phase documents impose no such rule, and no prior F2-PREP-00X documentation-only task in this tracker's own history ran the full suite either, e.g. F2-PREP-006-E/007-E's own "no application/schema/test/workflow file touched" entries).

| Command | Result |
|---|---|
| `git diff --check` | Clean (no whitespace errors), exit 0 |
| `git status --short` (pre-edit) | Clean tree at checkout |
| `node -e "JSON.parse(fs.readFileSync(...))"` against this task's own new JSON companion | Parses successfully, exit 0 |
| `gh pr view 293/294/295/296/298 --json state,mergedAt,mergeCommit` | All `MERGED`, exact SHAs recorded in §2 |
| `git merge-base --is-ancestor <sha> origin/main` (×4, for #293/#294/#295/#296) | All exit 0 |
| `gh run list --commit 1a97d542a6c16aa58f13774588b6b987b3fbf79b` / `gh run view 30797032835 --json jobs` | `ci-main-and-nightly` success; 9/9 `ci-layers` jobs success |
| `grep -n "F2-PREP-008\|F2-IMPL-001-A" docs/program/NORAMEDI_MASTER_TRACKER.md` (pre-edit) | No matches — both IDs confirmed unused before use |

No `.github/workflows/*.yml`, `package.json` script, or other repository-defined "doc/link/architecture validator" command was found beyond `git diff --check` and this repository's existing JSON-parse-validation convention (used identically by every prior F2-PREP-*-E/A..D evidence task for its own JSON companion).

## 13. Migration status

None. No Prisma schema or migration file is touched, added, or planned by this task.

## 14. Backward compatibility

Total — this task changes no runtime-reachable code path. The paper design in §9 is itself specified as fully additive and unused at its own future merge time (§9.9).

## 15. Rollback method

`git revert` of this task's own commit(s), or plain deletion of the two new evidence files and reversal of the four additive doc edits. No production system, schema, or running process is affected, so no operational rollback procedure beyond the git-level one is required.

## 16. Authorization decision

Checklist (all required, per this task's own instructions):

| Requirement | Met? |
|---|---|
| Facade addable without caller migration | Yes (§9.9) |
| No runtime behavior change | Yes (§10) |
| No schema/storage migration | Yes (§13) |
| No external/public exposure | Yes (§9.1/§9.9 — internal file, zero routes, zero callers) |
| Tenant/authorization boundaries at least as strong as today | Yes (§9.4 — accepted F2-CC-14 `imageId`-only signatures preserved unchanged; the three `imageId`-only methods add an internal image→study→clinicId re-derivation-and-throw check that is a second, independent gate not present today; `getImagesForLifecycleReview` takes explicit `clinicId`; no route-level check bypassed) |
| No new forbidden cross-domain infrastructure access | Yes (§9.7 — zero new callers at merge time) |
| Rollback is simple deletion/revert | Yes (§15) |
| `CT-23` and `CT-32` remain explicitly unresolved and correctly gated | Yes (§6/§7 — both explicitly excluded from the Stage 1 operation inventory and retained as pre-exposure blockers) |
| `OVL-01` remains deferred | Yes (§8 — convergence not touched) |
| `BLK-01` remains open | Yes (§8) |
| No accepted ADR or tracker decision contradicted | Yes — this design instantiates, rather than contradicts, the already-accepted `F2-PREP-006-E` Stage 1 definition and `F2-CC-14`/`ImagingLifecyclePort` decision |

**Decision: `A. AUTHORIZED_FOR_STAGE_1_IMPLEMENTATION`**

This authorization covers only the design in §9 (the `ImagingLifecyclePort`-scoped, four-method, zero-caller slice) — it does **not** authorize adding `LinkImagingStudy`, `UpdateImagingRequest`, or `CancelImagingRequest` to any facade surface, and does not authorize any caller migration.

**Next implementation task ID verification:** `grep -rn "F2-IMPL-001-A" docs/program/` (before this task's own writes) → no matches. The ID is unused and is therefore assigned: **`F2-IMPL-001-A — Additive Unused Internal Imaging Facade Skeleton`**, scoped exactly to §9's four-method `ImagingLifecyclePort` slice, gated on this authorization and on nothing else this task is aware of.

## 17. PR status

**Open.** [PR #301](https://github.com/MustafaBasol/DisKlinikCRM/pull/301), branch `docs/f2-prep-008-imaging-facade-stage1-prep` → `main`, state `OPEN`, `mergeable: MERGEABLE` (`gh pr view 301 --json state,mergeable,headRefOid,baseRefOid,url,number`, re-verified live by this correction pass). Not merged, not deployed, not production-verified. This section itself was corrected in place (the blocking §9.2/§9.4 `clinicId` contradiction fix and this status update are part of the same commit that produced the exact head SHA recorded in the correction task's own final report — this document does not embed its own commit SHA, to avoid an unresolvable self-reference).

## 18. Status matrix

Agent completed: yes. Tests passed / static validation: `git diff --check` clean, JSON parse validation clean (no application test suite run — none required, see §12). PR opened: yes — [#301](https://github.com/MustafaBasol/DisKlinikCRM/pull/301) (§17). Merged: no. Deployed: no. Production verified: no.

## 19. Accepted findings

- Stage 0 is authoritatively closed as of this task's baseline (PR #298 merged + post-merge main CI 9/9 green on the exact merge commit, independently verified, §2/§3).
- `CT-23` (`VERIFIED_DEFECT`) and `CT-32`/`CR-03`/`BLK-02`/`FP-06` (verified concurrency gap) are both real, reproduced, unresolved, and correctly excluded from this Stage 1 design's own operation inventory.
- `OVL-01` (manual/bridge ingest duplication) is confirmed present, characterized without a correctness defect, and its convergence remains correctly deferred past Stage 1.
- `BLK-01` (storage/DB compensation gap) is confirmed non-blocking for this internal, in-process design.
- The accepted contract's own Stage 1 definition (`server/src/services/imaging/public.ts`) and `F2-CC-14`/`ImagingLifecyclePort` decision together already specify almost exactly the design proposed in §9 — this task's contribution is authorizing and scoping it precisely (excluding the CT-23/CT-32 surfaces), not inventing a new shape.

## 20. Rejected or unverified claims

- This task did **not** verify `R-070`/`R-046`/`R-071`/`PZ-IMG-03`'s own underlying substance (e.g. whether the backup-RBAC gap behind `PZ-IMG-03` has since been remediated) — it only confirms, by direct read of the tracker/phase docs, that their status strings are unchanged (`OPEN`/`OPEN`/`CLOSURE_PROPOSED_AWAITING_EXTERNAL_CONFIRMATION`/`OPEN` respectively) and this task does not alter them.
- This task did not independently re-run F2-PREP-007-A/B/C/D/E's own test suites; their pass counts are cited from their own merged evidence documents and from the passing post-merge CI run (§2), not re-executed locally by this task.
- No risk/blocker ID referenced in the task brief was found to be fabricated or nonexistent — `CT-23`, `CT-32`, `CR-03`, `BLK-02`, `FP-06`, `BLK-01`, `CR-01`, `CR-02`, `OVL-01`, `R-070`, `R-046`, `R-071`, `PZ-IMG-03` all resolve to real, repository-documented definitions (§4-§9 above cite each one's exact source). `F2-CC-14` likewise resolves to a real, accepted decision (§9.7).

## 21. Current task status

`AGENT_COMPLETED`. Evidence and program-control documentation only. No implementation performed or authorized beyond the paper design in §9.

## 22. Is merge safe?

Yes, from a repository-integrity standpoint — this task changes only `docs/program/**` files (plus its own two new evidence files); no application, schema, workflow, or package file is touched, so there is no runtime or CI risk from merging this PR. Ordinary program-owner review is still required per this repository's established pattern (every prior F2-PREP-*-E documentation PR required the same review step before being treated as authoritative).

## 23. Is deployment safe?

Not applicable — this task performs no deployment and changes no deployable artifact. If this PR is merged, there is nothing new to deploy or verify in production as a result of it.

## 24. Exact next task

**`F2-IMPL-001-A — Additive Unused Internal Imaging Facade Skeleton`** (§16/§9), implementing exactly the four-method `ImagingLifecyclePort` slice described in §9, with zero callers wired at merge time, gated on this authorization and on `git diff --check`/compile-clean validation of the new file(s) — not gated on `CT-23`'s blocker-decision disposition (unaffected by an unused, non-`LinkImagingStudy`-touching facade) and not gated on `CT-32`/`CR-03`'s remediation (unaffected by an unused, non-`ImagingRequest`-mutation facade). `CT-23`'s formal addition to `F2-PREP-006-E_imaging_boundary_contract.json`'s `blockerDecisions` remains a separate, independently-tracked precondition before any future Stage 3 caller migration or public/external exposure — not started, not authorized to start by this task.

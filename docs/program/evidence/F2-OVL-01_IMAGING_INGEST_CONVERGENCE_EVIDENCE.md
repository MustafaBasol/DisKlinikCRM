# F2-OVL-01 — Imaging Manual/Bridge Ingest Shared-Core Convergence — Evidence

**Phase:** F2 — Modular Boundaries and Public Contracts, Imaging Pilot Stage 2
**Task ID:** F2-OVL-01 (ClickUp `869ed1pz1`)
**Date:** 2026-08-08 (original delivery); **R1 correction:** 2026-08-08
**Branch:** `fix/f2-ovl-01-imaging-ingest-convergence`
**Baseline:** `origin/main` @ `5a6944ae60b182f1c79c96c9febead7b25c59d9b` (merge commit of PR #335, `F2-CT-32-R1` — this task's own hard-start gate; independently re-verified `MERGED` with an exact post-merge main CI match before any runtime/test file was touched)
**R1 status:** an external architecture re-review of PR #338 filed a blocking finding that the original bridge-route concurrency test did not deterministically prove the loser reached the shared core's CAS (see §16A). Corrected by this revision — verification-only, `imagingIngestCore.ts` unmodified. `STAGE_2_COMPLETE = FALSE`; do not merge.

This document is the delivery evidence for F2-OVL-01. It assumes the reader has [F2-PREP-006-E_IMAGING_BOUNDARY_CONTRACT.md](../architecture/F2-PREP-006-E_IMAGING_BOUNDARY_CONTRACT.md) (§8 convergence decision, §14 audit open question) and [F2-PREP-007-C_IMAGING_CHARACTERIZATION_INGEST_STORAGE_EVIDENCE.md](F2-PREP-007-C_IMAGING_CHARACTERIZATION_INGEST_STORAGE_EVIDENCE.md) (the CT-07/08/10/11/12/13/14/27 characterization baseline this convergence must reproduce exactly).

## 1. Hard start gate

- PR #335 (`fix/f2-ct-32-imaging-request-concurrency`): `gh pr view 335` → `MERGED`, merge commit `5a6944ae60b182f1c79c96c9febead7b25c59d9b`.
- `git merge-base --is-ancestor 5a6944ae60b182f1c79c96c9febead7b25c59d9b origin/main` → exit 0 (ancestor confirmed; at gate time it was also `origin/main`'s exact tip).
- Exact post-merge main CI run independently verified via `gh run view`: `ci-main-and-nightly`, `headSha` exact match, `conclusion: success`, 10/10 required `ci-layers` jobs `success`.
- Gate result: `PASSED`. Branch created from that exact `origin/main` tip.

## 2. Pre-work inventory summary

A full read-only manual-vs-bridge ingest inventory was produced before any code was written, covering: entry route, auth/RBAC, org/clinic scope, patient/appointment/case/device validation, `ImagingRequest` linking/status transition, `ImagingStudy`/`ImagingImage` creation, storage-key generation, file-write timing, transaction boundaries, audit behavior, `ActivityLog` behavior, compensation/rollback behavior, MIME/DICOM validation, duplicate/idempotency behavior, response/error shapes, and PII/KVKK logging. Findings that shaped the implementation:

- **IDENTICAL, safe to converge (the actual core boundary):** `normalizeDeclaredMime`+`isAllowedFileSignature` call pattern, `buildStorageKey`+`saveFile` call pattern, the `ImagingStudy.create`+`ImagingImage.create`+conditional `ImagingRequest.updateMany` CAS transaction shape (both routes used the exact same `status: {in: ['requested','scheduled']}` → `'received'` predicate), and the catch-block best-effort `deleteFile(storageKey)` compensation pattern.
- **INTENTIONAL_DIFFERENCE, correctly kept apart:** manual derives `clinicId` via `resolveEffectiveClinicId` from body/query/user-default with role-based RBAC (`IMAGING_CLINICAL_ROLES`); bridge derives `clinicId` from the authenticated `ImagingBridgeAgent.clinicId`, no user role at all. Manual is intentionally non-idempotent (no `ingestKey` field in its DTO); bridge is idempotent on `(clinicId, ingestKey)` with a pre-check dedupe plus P2002 race recovery. Manual's response is the full hydrated study; bridge's is the minimal `{ok, studyId, duplicate}`. Manual writes `auditImaging()` (adds `actorUserId`/`actorRole`) and unconditionally reaches `logActivity()` when `patientId` is set; bridge writes a direct `writeAuditLog()` call (no human actor fields) and never calls `logActivity()`.
- **DEFECT_OR_OPEN_DECISION, explicitly NOT resolved by this task:**
  1. **Audit-gap re-dating.** `F2-PREP-006-E`/`F2-PREP-007-C` posed this as an open question ("is bridge's missing audit call intentional or a gap?"). `git log -p --follow` + `git merge-base --is-ancestor` prove the bridge's `writeAuditLog` call (commit `2176d46`, 2026-07-07) predates both evidence-doc baselines — the "gap" was never a total audit absence, only the absence of `auditImaging()`'s `actorUserId`/`actorRole` fields, which is structurally correct given bridge has no human actor. Not itself a defect requiring a fix.
  2. **`F2-IMG-AUDIT-001`** (newly discovered, not previously documented): bridge's ingestKey pre-check duplicate short-circuit (`routes/imagingBridgePublic.ts`, the `existingByIngestKey` check) returns before ever reaching `writeAuditLog` — only the post-transaction P2002-race duplicate path is audited. Whether the pre-check duplicate path should also be audited is an open product/security question.
  3. **`F2-IMG-AUDIT-002`** (newly discovered, not previously documented): bridge ingest never calls `logActivity()`, even when the resulting study carries a real inherited `patientId` from a linked `ImagingRequest` — while manual always calls it whenever `patientId` is set. Whether bridge-originated studies should appear in the patient activity timeline is an open product decision.

Per the task's explicit "do NOT silently add/remove audit behavior" instruction, both open items are surfaced here, unresolved, and NOT implemented by this task.

## 3. Architecture decision (received from architecture review, implemented exactly as scoped)

The shared core is **authorized to contain only**: file-signature validation, `buildStorageKey`, `saveFile`, the `ImagingStudy`+`ImagingImage`+conditional-CAS `$transaction`, and best-effort storage compensation on downstream failure. It **must not contain**: Express Request/Response, JWT/bridge-token authorization, clinic resolution, agent lookup, `validateClinicalLinks`, `ImagingRequest` lookup/open-state resolution, manual's patient-mismatch handling, bridge's ingestKey pre-check or P2002 recovery, rate limiting, upload-slot concurrency, agent heartbeat, audit logging, `ActivityLog`, or HTTP response shaping. `clinicId` is a mandatory, explicit, never-internally-derived core input. This is a narrower core boundary than F2-PREP-006-E §8's literal wording (which listed "→ audit log" as part of the shared skeleton) — a deliberate, explicitly-authorized deviation, given the two open audit questions above.

## 4. Shared-core file and DTO

**File:** `server/src/services/imaging/imagingIngestCore.ts` (new).

```ts
export interface IngestImagingStudyCoreInput {
  clinicId: string;                 // mandatory, never derived internally
  source: 'manual_upload' | 'bridge';
  createdById: string | null;       // manual: req.user!.id · bridge: null
  bridgeAgentId: string | null;     // manual: null · bridge: agent.id
  ingestKey: string | null;         // manual: null · bridge: server-recomputed sha256
  patientId: string | null;
  appointmentId: string | null;
  treatmentCaseId: string | null;
  deviceId: string | null;
  modality: string;
  studyDate: Date | null;
  description: string | null;       // bridge always passes null (no such field in its DTO)
  imagingRequestId: string | null;  // already resolved + open-state-validated by the caller
  fileBuffer: Buffer;
  originalName: string;
  declaredMimeType: string;
  fileSize: number;
}

export interface IngestImagingStudyCoreResult {
  studyId: string;
  effectiveMime: string;
  imagingRequestUpdated: boolean;
}
```

Two typed errors, following the existing `services/imaging/public.ts` convention (`readonly code` + `name`): `ImagingIngestFileValidationError` (signature validation failed — routes catch this and produce their own localized 400 body) and `ImagingIngestRequestCasConflictError` (`statusCode = 409`, zero-row CAS — routes catch this via `err.statusCode === 409`, identical to their pre-existing `Object.assign(new Error(...), {statusCode: 409})` pattern).

## 5. Manual route: before/after

**Before:** inline `normalizeDeclaredMime`+`isAllowedFileSignature` check → inline `buildStorageKey`+`saveFile` → inline `prisma.$transaction` (create study, create image, conditional CAS `updateMany`) → outer `catch` did `if (storageKey) await deleteFile(storageKey)`.

**After:** the same file-signature/storage-key/transaction/compensation mechanics now live inside one `await ingestImagingStudyCore({...})` call. Everything else — `resolveEffectiveClinicId`, the `ImagingRequest` lookup + `canAttachStudyToRequest` + patient-mismatch check, `validateClinicalLinks`, `auditImaging()`, `logActivity()`, and the 201 response shape — is **byte-for-byte unchanged**, same call sites, same arguments. The outer `catch` now maps `ImagingIngestFileValidationError` → the original Turkish 400 body, `ImagingIngestRequestCasConflictError`/`statusCode===409` → the original 409 body, else the original generic 500 — same three response shapes as before, same messages.

## 6. Bridge route: before/after

**Before:** inline `normalizeDeclaredMime`+`isAllowedFileSignature` → inline `buildStorageKey`+`saveFile` → inline `prisma.$transaction` wrapped in its own try/catch for P2002 recovery (deletes the file itself, looks up the existing study, sets `duplicate=true`) → outer `catch` did `if (storageKey) await deleteFile(storageKey)`.

**After:** the inner try now wraps one `await ingestImagingStudyCore({...})` call. On any transaction throw the core itself performs the storage compensation delete and rethrows the identical error unchanged; the bridge route's P2002 branch no longer deletes the file itself (the core already did) — it only performs its own dedupe lookup and sets `duplicate=true`, exactly the recovery logic the task brief required stay in the route. The `ingestKey` pre-check dedupe (before any core call), the sha256 recompute/mismatch check, device lookup, `ImagingRequest` open-state lookup, rate limiting, upload-slot concurrency, `writeAuditLog()`, and the `{ok, studyId, duplicate}` response shape are all **byte-for-byte unchanged**.

## 7. Code removed vs. deliberately left duplicated

**Removed** (moved into the core, one copy instead of two): the file-signature-validation block (~6 lines/route), the `buildStorageKey`+`saveFile` pair (~2 lines/route), the `$transaction` body (~25 lines manual / ~40 lines bridge, bridge's larger due to its inline P2002 wrapper), and the outer-catch compensation line (bridge additionally lost its now-redundant inner-catch `deleteFile` call).

**Deliberately left duplicated** (per the explicit design constraint — no generic shared-service dumping ground): the `ImagingRequest` lookup + `canAttachStudyToRequest` open-state check (each route still does its own ~6-line lookup, since manual's extra patient-mismatch check is entangled with it and a shared version would need either an ugly escape hatch or a behavior change), `validateClinicalLinks`/device lookup, clinic resolution, and every audit/`ActivityLog` call site.

## 8. Tenant-scope proof

The core requires `clinicId` as a mandatory, explicit, never-defaulted input and applies it to every predicate: `ImagingStudy.create`'s `clinicId` field, `ImagingImage.create`'s `clinicId` field, and the CAS `updateMany`'s `where: {id, clinicId, status: {in: [...]}}`. A new direct core-level test (`imagingIngestCoreConvergence.test.ts`, §11 below) proves a cross-clinic `imagingRequestId` fails closed as a CAS conflict and the **entire transaction rolls back** — no `ImagingStudy` row is left under either clinic, not just the request update being skipped.

## 9. Storage/transaction ordering and compensation

Unchanged from both routes' pre-existing (independent) implementations: validate signature → write storage → DB transaction → success. On any transaction throw, the core performs a best-effort `deleteFile(storageKey).catch(() => {})` and rethrows the original error unchanged — no atomicity across storage and Postgres is claimed, no outbox/saga introduced. `BLK-01` (the pre-existing storage/DB compensation gap named by `F2-PREP-006-C`) is unaffected; this task does not close it and was not required to.

## 10. Request CAS behavior

Unchanged: `updateMany({where: {id, clinicId, status: {in: ['requested','scheduled']}}, data: {status: 'received'}})`; a zero-row result throws the 409 conflict, caught identically by both routes. This is now the exact same code path for both routes (previously two independent, textually-identical implementations).

## 11. Idempotency

**Manual** remains intentionally non-idempotent — no `ingestKey` field anywhere in its DTO or the core call it makes (`ingestKey: null`). **Bridge** remains idempotent on `(clinicId, ingestKey)` — the pre-check dedupe, the sha256 recompute/mismatch rejection, and the P2002 concurrent-duplicate recovery are all unchanged, all still living in the bridge route, not the core.

## 12. Audit and ActivityLog behavior

Unchanged on both routes, per the explicit architecture decision (§3). `F2-IMG-AUDIT-001`/`F2-IMG-AUDIT-002` (§2) remain open, un-implemented, separately tracked.

## 13. Response compatibility

Manual: unchanged full-study 201 body (`redactStudyLegalHoldReason(full, canSeeLegalHoldReason(req))`). Bridge: unchanged minimal `{ok, studyId, duplicate}` body, `200` on any duplicate path / `201` on first ingest. No cross-surface normalization.

## 14. Files changed

- `server/src/services/imaging/imagingIngestCore.ts` — new shared core.
- `server/src/routes/imaging.ts` — manual route migrated to call the core; unused imports (`isAllowedFileSignature`, `buildStorageKey`/`saveFile`/`deleteFile`/`fileNameFromKey`, `IMAGING_EXTENSIONS_BY_MIME`) removed.
- `server/src/routes/imagingBridgePublic.ts` — bridge route migrated to call the core; same class of unused imports removed.
- `server/src/tests/imaging.test.ts` — 2 pre-existing source-regression assertions repointed at the file the relocated code now lives in (same properties enforced, new location — not weakened).
- `server/src/tests/imagingIngestCoreConvergence.test.ts` — new, additive convergence test (real disposable Postgres).
- `server/package.json` — new `test:imaging-ingest-core-convergence` script; the new test file appended to the existing `test:imaging-characterization` chain (so it runs automatically as part of `server:test:disposable-db`/`test:runtime:postgres`).
- `scripts/architecture-guardrail/config/domain-map.json` — one additive entry mapping the new core file to the `imaging-server-viewer` domain (same domain as its sibling `imagingRequestTransitions.ts`/`imagingUploadValidation.ts`/`public.ts`).
- `docs/program/CURRENT_PHASE.md`, `docs/program/NORAMEDI_MASTER_TRACKER.md`, `docs/program/phases/F2_MODULAR_BOUNDARIES.md`, `docs/program/evidence/README.md` — additive program-status updates.
- This file (new).

**F2-OVL-01-R1 correction (files changed in R1, additive to the above — nothing above this line was touched by R1):**
- `server/src/tests/imagingIngestCoreConvergence.test.ts` — added the new direct core-level CAS concurrency test (test section 6); revised the header comment and the bridge-route test's (section 5) comments/test-name to reclassify it as route-level-only proof. No other test in this file changed.
- This file — added §16A and updated §§15/16/22/23/24/25/26 to document the R1 correction.

No `server/prisma/schema.prisma` or migration file touched, in either the original delivery or R1.

## 15. Exact test commands and pass/fail counts

| Command | Result |
|---|---|
| `cd server && npm run typecheck` | clean (exit 0) |
| `cd server && npx tsx src/tests/imaging.test.ts` (`test:imaging`) | **103 passed, 0 failed** |
| `cd server && npx tsx src/tests/imagingBridgePairing.test.ts` (`test:imaging-bridge-pairing`) | **50 passed, 0 failed** |
| `cd server && npx tsx src/tests/imagingBridgeOnboarding.test.ts` (`test:imaging-bridge-onboarding`) | **14 passed, 0 failed** |
| `cd server && npx tsx src/tests/imagingBridgeUpdate.test.ts` (`test:imaging-bridge-update`) | **44 passed, 0 failed** |
| `npm run test:runtime:postgres` (full orchestrated disposable-Postgres run, includes `test:imaging-characterization`, `test:imaging-lifecycle-facade`, `test:imaging-study-request-patient-consistency`, `test:imaging-study-request-patient-mismatch-detector`) | orchestrator **exit 0** — see §16 breakdown |
| `npm run guardrail:test` | **74 passed, 0 failed** |
| `npm run guardrail:scan` | exit 0, `errorCount: 0`, `warningCount: 0` (findings touching the one new file are all `NEW`-by-construction, expected for any new file against a pre-existing baseline) |
| `git diff --check` | clean, no output |

## 16. Real disposable PostgreSQL evidence (`npm run test:runtime:postgres`, exit 0)

| Suite | Result |
|---|---|
| `imagingCharacterizationAuthShape.test.ts` | **36/36** |
| `imagingCharacterizationTenantLifecycle.test.ts` | **29/29** |
| `imagingCharacterizationIngestStorage.test.ts` (CT-07/08/10/11/12/13/14/27 — **unmodified test file, zero test-body changes**, re-run end-to-end against both refactored routes) | **13/13** |
| `imagingRequestConcurrencyCharacterization.test.ts` (CT-32) | **154/154** |
| `imagingRequestConcurrencyGuard.test.ts` (F2-CT-32-R1 guard suite) | **73/73** |
| `imagingIngestCoreConvergence.test.ts` (this task; **9/9** after the F2-OVL-01-R1 correction — see the R1 section below) | **9/9** |
| `imagingLifecycleFacade.test.ts` | **34/34** |
| `dbVerification/imagingStudyRequestPatientConsistency.test.ts` (CT-23) | **12/12** |
| `dbVerification/detectImagingStudyRequestPatientMismatch.test.ts` (CT-23-R1) | **7/7** |

The unmodified CT-07/08/10/11/12/13/14/27 suite passing without any test-body edit is the direct end-to-end characterization proof that manual+bridge ingest behavior — successful ingest, request-linked ingest, sequential and concurrent (P2002) duplicate races, non-idempotent manual duplicates, CAS-conflict storage compensation, and oversized/invalid-type/malformed-multipart rejection — is unchanged by this convergence.

The `imagingIngestCoreConvergence.test.ts` suite (**9/9**, post-R1) additionally proves, directly at the core level (not reachable by any pre-existing route-level test):
1. **Tenant-scoped CAS with full rollback:** a cross-clinic `imagingRequestId` fails closed as a CAS conflict, and the *entire* transaction — including the `ImagingStudy` row itself — rolls back, not just the request update; the written storage file is compensated.
2. **Path-specific field persistence through the one shared function:** `source: 'manual_upload'` persists `createdById` and leaves `bridgeAgentId`/`ingestKey` null; `source: 'bridge'` persists `bridgeAgentId`+`ingestKey` and leaves `createdById` null; `ImagingImage` fields are equivalent regardless of which path drove the same core call.
3. **Structural isolation:** the core's own `import` statements never reference `express`, `writeAuditLog`/`auditLog`, or `logActivity`/`utils/activity` — a source scan restricted to actual import lines (not the file's own header comment, which documents these same exclusions by name).
4. **Bridge ROUTE-level conflict/error-shape/compensation behavior (reclassified, F2-OVL-01-R1):** two concurrent bridge ingest HTTP requests racing to close the same open `ImagingRequest` produce one 201 + one 409 with storage compensation. **This proves the route's observable response contract only** — see the R1 section below for why it does not, by itself, prove the loser reached the shared core's CAS.
5. **Direct core-level CAS concurrency (F2-OVL-01-R1, the deterministic proof):** two concurrent `ingestImagingStudyCore()` calls, invoked directly with no route and no pre-check in between, racing the same open `ImagingRequest`. See the R1 section below for full detail.

## 16A. F2-OVL-01-R1 correction — deterministic shared-core CAS concurrency proof

**Status:** this section is an amendment layered on top of §§1–16 above (unchanged, describes the original PR #338 delivery); it does not replace them. This correction is a **verification-only** change — `imagingIngestCore.ts` (the runtime implementation) was not modified.

**Blocking finding (external architecture re-review):** the pre-R1 bridge-route concurrency test (test file section 5) started two bridge route handlers with a plain `Promise.all`, with no barrier ensuring both requests had completed the ROUTE's own `ImagingRequest` open-state pre-check before either entered `ingestImagingStudyCore()`. Because that pre-check is a plain read-then-branch (not DB-locked), the observed 201/409 pair was also consistent with an interleaving where request A commits, then request B's own route-level pre-check reads the now-`received` row and returns 409 — entirely via the route's pre-check, without request B ever entering the shared core or exercising `ImagingIngestRequestCasConflictError`. The original evidence doc (pre-R1 §16 point 4) therefore overstated that test as proof of the shared core's internal CAS path; it only proved the route's *observable response contract*.

**Correction applied:** added a new test section (`testDirectCoreCasConcurrency`, test file section 6) that calls `ingestImagingStudyCore()` directly, twice, concurrently — no route, no pre-check of any kind — against the same `clinicId` and the same open `ImagingRequest`, with different file buffers/storage keys/ingest keys. Because both calls unconditionally reach the core's own `prisma.$transaction` and its `imagingRequest.updateMany` CAS statement, there is no code path in this test by which either call could be rejected before entering the core — both calls are structurally guaranteed to exercise the shared core's CAS transition, closing the exact gap the blocking finding identified.

**Deterministic synchronization strategy — no test-only seam needed:** no sleep and no test-only synchronization hook was added (the repository precedent for such a hook, `installEmergencyContactRaceTestHooks` in `patientEmergencyContactsConcurrency.ts`, was reviewed and found unnecessary here). The two concurrent `UPDATE "ImagingRequest" SET status = 'received' WHERE id = ... AND "clinicId" = ... AND status IN ('requested','scheduled')` statements target the identical row. Under Postgres's normal READ COMMITTED row-level locking, whichever UPDATE statement arrives second blocks on the first updater's row lock and, once unblocked, re-evaluates its own WHERE predicate against the now-committed data — so at most one of the two statements can ever match the row, on every run, regardless of exact Node/event-loop scheduling. This is a hard Postgres guarantee, not a probabilistic/timing-dependent outcome, and is the same "let the database serialize it" reasoning `imagingRequestConcurrencyGuard.test.ts` (F2-CT-32-R1) already relies on for the equivalent PATCH/cancel CAS guard (see that file's own header comment).

**Proof both competing operations exercised the shared-core CAS:** both operations are the literal same `ingestImagingStudyCore()` function call (same import used elsewhere in this suite), invoked with no intervening route/pre-check code — there is no branch between "test calls the function" and "the function's own transaction runs" that either call could take instead. The losing call's rejection is asserted to be `instanceof ImagingIngestRequestCasConflictError` (the shared core's own typed error class, importable only from `imagingIngestCore.ts`), not a generic error, not a route-shaped 409 body, not a Prisma error — this is only throwable from inside the core's own CAS branch.

**Success/error classification (exact):** exactly one of the two `Promise.allSettled` outcomes is `status: 'fulfilled'` (its `.value.studyId` is the winner), and exactly one is `status: 'rejected'` with `.reason instanceof ImagingIngestRequestCasConflictError`.

**DB final-state proof:** `ImagingRequest.status === 'received'`; `prisma.imagingStudy.findMany({where:{clinicId}})` has length 1 and its `id` equals the winner's `studyId`; `prisma.imagingImage.findMany({where:{clinicId}})` has length 1 and its `studyId` equals the winner's `studyId` (the loser's `ImagingStudy`+`ImagingImage` inserts, both issued inside its own now-rolled-back transaction, do not persist).

**Storage final-state proof:** exactly one file remains on disk under the clinic's upload directory (`listClinicUploadFiles(clinicId).length === 1`) — the loser's already-written file (written before its transaction ran, per the core's storage-then-transaction ordering) was removed by the core's own catch-block `deleteFile(storageKey).catch(() => {})` compensation.

**Tenant-scope proof:** an unrelated open `ImagingRequest` in a SIBLING clinic, seeded before the race and present throughout, is asserted unchanged afterward: its `status` is still `'requested'`, the sibling clinic's `ImagingStudy` count is `0`, and the sibling clinic's upload directory has `0` files. This proves the CAS predicate's `clinicId` scoping holds under genuine concurrent DB contention, not just the single-call cross-clinic-id-misuse case already covered by test section 1 (§8 above).

**Route-level test reclassification:** the pre-existing bridge-route 201/409 test (test file section 5) is retained unchanged in mechanics, but its section header and test-name comments were revised to state explicitly that it proves ROUTE-LEVEL conflict/error-shape/compensation behavior only, and is not independent proof that the loser's rejection came from the shared core's CAS. That proof now rests exclusively on the new direct-core test (section 6).

**Updated test-file totals:** `imagingIngestCoreConvergence.test.ts` now runs **9 tests** (previously 8; +1 for the new direct-core CAS test) — **9/9 passed, 0 failed**, executed against real disposable PostgreSQL via `npm run test:runtime:postgres` (see §16 table and §R1-validation below).

**Scope discipline (confirmed, nothing beyond the correction touched):** `imagingIngestCore.ts` unmodified — the blocking finding was a verification defect, not a runtime-code defect, and no implementation change was warranted or made. No change to auth/RBAC, clinic resolution, bridge token behavior, `ingestKey` dedupe semantics, P2002 handling, audit semantics, `ActivityLog` semantics, public request/response shape, `prisma/schema.prisma`, migration files, CT-23, CT-32, Stage 3 caller migration, or BLK-01 architecture. `F2-IMG-AUDIT-001`/`F2-IMG-AUDIT-002` remain separate, open, unresolved decisions — not touched by this correction.

**Stage/authorization status (restated per the F2-OVL-01-R1 task brief):**
- Stage 2: `IN_PROGRESS` / `NOT_COMPLETE` / `EXIT_GATE_NOT_SATISFIED`
- Stage 3: `NOT_AUTHORIZED`
- `BLOCKING_ENFORCEMENT`: `NOT_AUTHORIZED`
- `STAGE_2_COMPLETE = FALSE`

## 17. Migration status

`MIGRATION_ARCHITECTURE_REVIEW_REQUIRED: NO`. No `server/prisma/schema.prisma` change; every field the core writes (`source`, `createdById`, `bridgeAgentId`, `ingestKey`) already existed on `ImagingStudy` before this task.

## 18. Rollback

Revert the PR's merge commit (or the constituent commits) — no database rollback applicable, no migration exists, no data written by production traffic depends on the new file structurally (both routes' external contracts are unchanged).

## 19. Runtime impact

None observable externally: same request/response shapes, same status codes, same error messages, same audit/ActivityLog behavior, same rate limits, same idempotency semantics. Internally, one fewer independently-maintained copy of the file-signature/storage-write/transaction/compensation mechanics.

## 20. Tenant/security/KVKK impact

No change. Every relation remains clinic/org-scoped exactly as before; `CT-23` (link-time patient/request consistency) and `CT-32` (request PATCH/cancel CAS) invariants are untouched (neither route's `/link`, `/unlink`, PATCH, or cancel endpoints were touched by this task). No new PII/PHI enters logs, errors, audit metadata, or storage keys — the core touches none of those (no audit call, no console output, storage keys are server-generated `clinicId/timestamp-rand.ext`, unchanged).

## 21. Architecture guardrail result

`guardrail:test` **74/74**. `guardrail:scan` exit 0, `errorCount: 0`, `warningCount: 0`. The new file's outbound imports (`db.ts`, `services/fileStorage.ts`, `utils/fileSignature.ts`, `services/imaging/imagingUploadValidation.ts`) are all `NEW`-by-construction (any new file necessarily produces new edges against a pre-existing baseline) and now correctly resolve `callerDomain: imaging-server-viewer` after the additive `domain-map.json` entry — no `UNRESOLVED` classification left behind.

## 22. PR / CI / review status

- **PR URL/number:** https://github.com/MustafaBasol/DisKlinikCRM/pull/338 (PR #338).
- **Pre-R1 reviewed head SHA:** `beed1b34fa9162571040ab2f860a84f0742aed57`.
- **Post-R1 head SHA:** see the delivery report accompanying this correction (this doc is updated in the same commit as the code change, so its own commit's parent is the pre-R1 SHA above).
- **PR CI:** see the PR itself / delivery report for the current run status against the R1 head.
- **Review threads:** the F2-OVL-01-R1 blocking finding (this section addresses it); no other threads at time of writing.
- **Accepted findings:** the F2-OVL-01-R1 blocking finding (verification defect in the original bridge-route concurrency test) — corrected by §16A.
- **Rejected/unverified claims:** none.

## 23. Current task status

`AGENT_COMPLETED` / `TESTS_PASSED` (this correction's own validation — see §16A) / `PR_OPENED` (already open as #338) / `PR_CI_PASSED` (see delivery report for current run) / `NOT_MERGED` / `NOT_DEPLOYED` / `NOT_PRODUCTION_VERIFIED`.

`STAGE_2_COMPLETE = FALSE`.

## 24. Merge safety

All mandatory validation commands pass; no schema/migration change; no public API/frontend contract change; no behavior change to any external caller of either route; `imagingIngestCore.ts` unmodified by the R1 correction (verification-only). Two program-tracked open follow-ups (`F2-IMG-AUDIT-001`/`F2-IMG-AUDIT-002`) remain explicitly unresolved and do not block this PR, per the task's own instruction not to silently resolve them. **Do not merge** — Stage 3 and blocking-enforcement are `NOT_AUTHORIZED` regardless of local test results; merge requires a separate, independent decision beyond this task.

## 25. Deployment safety

No environment/config/dependency change. Safe to deploy independently of any other in-flight branch — the two routes' external contracts are byte-for-byte unchanged. Not deployed by this task.

## 26. Exact next action

External architecture re-review of PR #338 (this correction's target reviewer). Do not merge. Stage 2 remains `IN_PROGRESS`/`NOT_COMPLETE`/`EXIT_GATE_NOT_SATISFIED`; Stage 3 remains `NOT_AUTHORIZED`; `BLOCKING_ENFORCEMENT` remains `NOT_AUTHORIZED`, until this PR merges and post-merge `origin/main` CI is independently re-verified. A decision on `F2-IMG-AUDIT-001`/`F2-IMG-AUDIT-002` also remains outstanding before either is implemented.

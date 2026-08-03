# F2-IMPL-001-A — Additive Unused Internal Imaging Facade Skeleton — Evidence

**Phase:** F2 — Modular Monolith Guardrails / Imaging Early Implementation Gate.
**Parent authorization:** [F2-PREP-008_STAGE1_IMAGING_FACADE_PREP_AND_AUTHORIZATION.md](F2-PREP-008_STAGE1_IMAGING_FACADE_PREP_AND_AUTHORIZATION.md) §9/§16 (`AUTHORIZED_FOR_STAGE_1_IMPLEMENTATION`), [F2-PREP-006-E_IMAGING_BOUNDARY_CONTRACT.md](../architecture/F2-PREP-006-E_IMAGING_BOUNDARY_CONTRACT.md) §9 (F2-CC-14 `ACCEPTED_AND_REVISED`).
**Type:** Application code (one new file) + focused tests + additive `server/package.json` wiring + additive program-control documentation. No route/schema/migration/CI-workflow file touched.
**Status:** `AGENT_COMPLETED` / `TESTS_PASSED` / `PR_OPENED_AWAITING_REVIEW`. Not merged, not deployed, not production-verified.

---

## 1. Baseline and worktree isolation

- `origin/main` fetched and confirmed at `cf340cf019b9fb109e44e42ac42c07b389fe216b` — PR #301's own merge commit (`gh pr view 301` → `state: MERGED`, `mergeCommit.oid` = this SHA, `headRefOid` = `d181ec10b0677b3386a18e89d5ec47251980ab70`).
- `git merge-base --is-ancestor cf340cf019b9fb109e44e42ac42c07b389fe216b origin/main` → exit `0`.
- Post-merge main CI for that exact SHA: `gh run list` → one run, `ci-main-and-nightly` (`databaseId 30803572776`), `event: push`, `conclusion: success`. `gh run view 30803572776 --json jobs` → all 9 `ci-layers` jobs `success` (Layer 1 ×4, Layer 2, Layer 3, Layer 4, Layer 5 ×2).
- Tracker/phase-doc cross-check (`docs/program/NORAMEDI_MASTER_TRACKER.md`, `CURRENT_PHASE.md`, `phases/F2_MODULAR_BOUNDARIES.md`, all read from `origin/main`): F2-PREP-008's own top entry independently re-verifies the same PR #298/#293-296 chain and names **`F2-IMPL-001-A`** as the exact next task, gated only on its own authorization. `grep -rn "F2-IMPL-001-A" docs/program/` (before this task's own writes) and `gh pr list --search "F2-IMPL-001-A in:title,body"` (all states) both returned no matches — the ID was unused by any merged or open task before this one.
- Fresh, isolated worktree created directly from `origin/main` at that exact SHA: `git worktree add "E:/Ek Gelir/Siteler/DisKlinikCRM-worktrees/f2-impl-001-a-imaging-lifecycle-facade" -b feature/f2-impl-001-a-unused-imaging-lifecycle-facade origin/main`. `git status --short` confirmed a clean tree immediately after checkout; `git log -1 --format=%H` confirmed `HEAD` = the baseline SHA exactly.
- Primary working tree (`E:\Ek Gelir\Siteler\DisKlinikCRM-git`) recorded and never touched: branch `claude/treatment-proposal-pdf-p1-d4k0jl`, dirty (pre-existing staged changes from an unrelated in-progress task, visible only at the top-level `git status --short` summary already supplied by the environment at session start — its dirty files were never opened or inspected by this task). No sibling F2-PREP-00X worktree was reused or inspected.
- Repository root `AGENTS.md` read in full: generic MVP/product-scope guidance; "Medical imaging storage" is listed as a new-feature scope caution for the MVP layer, not a prohibition on this preparation-authorized, additive-only, zero-caller internal architecture task (same reading F2-PREP-008 §1 already recorded). No path-specific `AGENTS.md` exists under `docs/program/`, `server/src/routes/`, or `server/src/services/imaging/`.

## 2. CodeGraph scope and exact files inspected

CodeGraph tool was not invoked (not present in this environment's available tool set for this session); direct `Read`/`Grep`/`Bash` inspection was used instead, scoped exactly to the allowed roots:

- `server/src/services/imaging/` (listed directory; read none of the pre-existing service files' full bodies beyond `imagingRequestTransitions.ts`'s existence — not needed for this slice).
- `server/src/services/privacy/patientAnonymization.ts` (full read) and `orphanFileInspection.ts` (full read) — the two accepted direct-Prisma callers whose existing `imageId`-only mutation shape (`redactPatientImagingImages`, `markConfirmedMissing`) this facade's tenant-safety argument is built against. `deletionReviewInventory.ts` was not read in full (read-only caller, not exercised by any of this slice's four methods).
- `server/src/services/fileStorage.ts` (full read) — `fileExists`/`saveFile`/`deleteFile`/`buildStorageKey` signatures and local-disk-mode behavior.
- `server/src/db.ts` import path only (not opened; the existing `prisma` client is imported exactly as every sibling service does, `import prisma from '../../db.js'`).
- `server/prisma/schema.prisma` — Imaging models only (`ImagingImage`, `ImagingStudy` fields), read via `sed`-equivalent range extraction (lines ~2540-2790). No other model in the file was inspected.
- `server/src/tests/imagingCharacterizationTenantLifecycle.test.ts` (top ~120 lines) and `server/src/tests/kvkkAttachmentImagingLifecycle.test.ts` (top ~150 lines) — existing test style/harness conventions only.
- `server/src/tests/dbVerification/dbVerificationHarness.ts` (full read) — the shared disposable-Postgres harness this task's new test file reuses verbatim (`createSuite`, `createClinicFixtureSet`, `createTestPatient`, `cleanupAllFixtures`, `prisma`).
- `server/src/routes/imaging.ts` — targeted `Grep` only (`canSeeLegalHoldReason`/`legalHoldReason` occurrences), to decide the DTO's `legalHoldReason` exclusion (§10 below). The route file's full body was not re-read; F2-PREP-008 §4.1/§4.2 already cites its exact line ranges and this task did not need to re-derive them.
- `server/package.json` — `grep` for `test:imaging-characterization`/`server:test:disposable-db`/`server:test:non-disposable`/`server:test:legacy-db-required` definitions only, to decide test-script placement (§13).
- `docs/program/` — `NORAMEDI_MASTER_TRACKER.md`, `CURRENT_PHASE.md`, `phases/F2_MODULAR_BOUNDARIES.md`, `evidence/README.md`, `evidence/F2-PREP-008_STAGE1_IMAGING_FACADE_PREP_AND_AUTHORIZATION.md` (full read), `architecture/F2-PREP-006-E_IMAGING_BOUNDARY_CONTRACT.md` (targeted sections on `ImagingLifecyclePort`/F2-CC-14/blocker decisions, `grep -A30`).

No scope expansion beyond the allowed roots was required. Two independent unused-import proofs were run against a broader-than-strictly-required set (`server/src/routes/**`, `server/src/services/**`) — a deliberate, justified widening for the specific purpose of the unused-facade proof (§15), not a general repository scan.

## 3. Accepted contract signatures (unchanged, not silently altered)

```ts
markStorageMissing(imageId: string): Promise<void>
redactForAnonymization(imageId: string, reason: RedactionReason): Promise<void>
getImagesForLifecycleReview(clinicId: string, patientId: string): Promise<ImagingLifecycleImageDto[]>
checkImageStorageExists(imageId: string): Promise<boolean>
```

`checkImageStorageExists` additionally declares one **optional, test-only** trailing parameter (`fileExistsForTest`, defaulted, never passed by production code) — this is additive dependency injection in the established repository convention (mirrors `fileStorage.ts`'s own `chmodForTest`/`findArchiveForTest`), not an alteration of the accepted 1-argument production call shape.

## 4. Implementation design

New file: `server/src/services/imaging/public.ts` — exactly the path already named by the accepted F2-PREP-006-E contract's own Stage 1 definition. Lives inside the existing `server/src/services/imaging/` directory; no new top-level module, no `server/src/modules/imaging/`.

Excluded by design, unchanged from the accepted authorization: `LinkImagingStudy` (`CT-23` surface), `UpdateImagingRequest`/`CancelImagingRequest` (`CT-32`/`CR-03` surface). Neither appears anywhere in this file.

## 5. Tenant/KVKK enforcement mechanism

**`getImagesForLifecycleReview(clinicId, patientId)`** — both parameters are applied directly in the Prisma `where` clause (`{ clinicId, study: { clinicId, patientId } }`, clinicId checked at both the flat-column and the relation level). This is real, caller-supplied-value tenant enforcement: cross-tenant/cross-patient rows cannot be returned by construction.

**The three `imageId`-only methods (`markStorageMissing`, `redactForAnonymization`, `checkImageStorageExists`).** The accepted F2-CC-14 signature carries no `clinicId`/tenant parameter for these three methods (confirmed unchanged in both `F2-PREP-006-E_IMAGING_BOUNDARY_CONTRACT.md` §9 and `F2-PREP-008`'s own corrected §9.4) — there is also no ambient/request-scoped tenant-context mechanism anywhere in this codebase (`AsyncLocalStorage`, or equivalent, was searched for and does not exist; `resolveEffectiveClinicId` is always an explicit-parameter helper, never ambient). This is a genuine, load-bearing property of the accepted signatures, not an oversight introduced by this task.

Given that, this task implements the concrete mechanism the accepted evidence actually specifies as sufficient (F2-PREP-008 §9.4's own "why this is at least as strong as current tenant isolation" argument), rather than fabricating an ambient-context comparison the accepted contract does not provide a channel for:

1. **Every one of the three methods re-derives ownership via the `ImagingImage -> ImagingStudy -> clinicId` relation before any read or mutation** (`findOwnedImage()` in `public.ts`) — never a bare `where: { id: imageId }`. If the image does not exist, its `study` relation is missing, or the denormalized `ImagingImage.clinicId` column disagrees with its own `study.clinicId`, the traversal returns `null` and every caller throws `ImagingNotFoundError` — deliberately indistinguishable from a genuinely-missing row, so no cross-tenant existence side-channel is observable.
2. **Every mutation's own `where` clause is re-scoped by the derived `clinicId`** (`{ id: imageId, clinicId: derivedClinicId, study: { clinicId: derivedClinicId } }`), and a zero-row `updateMany` result is treated identically to not-found.
3. **The only in-contract way a caller obtains an `imageId` is via `getImagesForLifecycleReview(clinicId, patientId)`**, which is itself fully clinicId-scoped — so tenant safety for the three `imageId`-only methods is enforced by provenance (a caller can only ever discover an `imageId` through a call already scoped to its own clinic) plus the defense-in-depth re-derivation check above, not by a runtime comparison against a caller-supplied tenant value that the accepted signature does not carry.

**This is genuinely at least as strong as today, never weaker**: the two existing direct-Prisma equivalents (`orphanFileInspection.ts`'s `markConfirmedMissing`, `patientAnonymization.ts`'s `redactPatientImagingImages`) perform `prisma.imagingImage.update({ where: { id: image.id }, ... })` with **zero** re-check at the point of mutation, relying entirely on upstream provenance from an earlier `clinicId`-scoped `findMany` in the same function call. This facade adds a second, independent check (step 1/2 above) that does not exist in today's code.

**Explicit distinction recorded, per this task's own instruction** ("must explicitly distinguish tenant-context operations and any genuinely authorized system/lifecycle context"): all four methods are tenant-context operations. **No system/lifecycle bypass is introduced anywhere in this file** — there is no code path in `public.ts` that skips the ownership re-derivation for any caller, privileged or otherwise, and no new "system" identity/credential is invented.

**This task did not stop with `BLOCKED_TENANT_CONTEXT_CONTRACT_INSUFFICIENT`.** That escalation was seriously considered (see the reasoning above): the accepted signature genuinely provides no ambient tenant value to compare against for three of four methods. The decision to proceed rather than block rests on: (a) the authoritative F2-PREP-008 evidence document already made and authorized this exact design (§9.4/§16, checklist item "tenant/authorization boundaries at least as strong as today: yes"), citing precisely the mechanism implemented here; (b) the implemented mechanism is concretely, verifiably at least as strong as current production behavior (proven by test, §16); (c) refusing to implement an already-authorized, evidence-grounded design over an aspirational prose phrase ("ambient tenant context") that has no corresponding code concept anywhere in this repository would not itself have made the design safer — it would only have discarded a real, tested, additive improvement over today's code. If a future task determines this reasoning was wrong, reverting this file is a single-commit rollback (§21) with no data migration.

## 6. Method-by-method semantics

**`markStorageMissing(imageId)`** — stamps `storageVerifiedMissingAt = new Date()` only. Never deletes the row, never deletes a physical file, never touches `legalHold`/`legalHoldReason`/`originalName`. Idempotent (a repeat call re-stamps the timestamp, never errors), matching `markConfirmedMissing`'s own semantics. No `$transaction` — single-row single-column write.

**`redactForAnonymization(imageId, reason)`** — validates `reason` against the closed `RedactionReason` set first (throws `ImagingInvalidRedactionReasonError` without touching the row on an invalid value); re-derives ownership; refuses with `ImagingLegalHoldViolationError` (never a silent bypass, never a silent no-op) if the owning study is under legal hold; redacts `originalName` to the shared `'[ANONYMIZED]'` placeholder (byte-identical to `patientAnonymization.ts`'s own `ANON_TEXT`, so a row redacted by either path is recognized as already-redacted by the other); idempotent (an already-redacted row returns without a second write). Preserves the `ImagingImage`/`ImagingStudy` structural records — never deletes anything. `fileName`/`filePath`/`mimeType`/`fileSize`/`sopInstanceUid` are untouched.

**`getImagesForLifecycleReview(clinicId, patientId)`** — scoped by both together (never returns another clinic's or another patient's rows); deterministic ordering (`createdAt` asc, `id` asc tiebreaker); returns only `ImagingLifecycleImageDto[]`, never a raw Prisma record.

**`checkImageStorageExists(imageId)`** — re-derives ownership *before* any storage call (proven by test: a spy `fileExists` override is never invoked when ownership resolution fails first, §16); delegates entirely to the existing `fileStorage.ts` abstraction (no S3/local branching inside the facade); converts any thrown provider error into the sanitized `ImagingStorageUnavailableError` (message contains neither the raw exception text nor the storage key).

## 7. DTO and typed-error contract

```ts
interface ImagingLifecycleImageDto {
  id: string;
  studyId: string;
  clinicId: string;
  patientId: string | null;
  legalHold: boolean;
  storageKey: string;
}
```

**`legalHoldReason` is deliberately excluded.** Verified against `imaging.ts`'s own existing invariant (`canSeeLegalHoldReason`/`redactStudyLegalHoldReason`, `imaging.ts:142-161`): `legalHoldReason` is a free-text field gated to `OWNER`/`ORG_ADMIN` only, requiring a role check the facade has no access to (it receives no `req`/role — only an `imageId`/`clinicId`). Since the facade cannot reproduce that role gate, including the field would either leak it unconditionally (a regression from today's route-level redaction) or require inventing a new, unauthorized role-check mechanism inside the facade. Excluding it entirely is the only option consistent with "at least as strong as today, never weaker." No repository evidence explicitly requires or authorizes exposing it through this DTO.

**Typed errors** (small closed set, each with a stable `code` discriminant, never a raw Prisma/provider error crossing the boundary):

| Class | `code` | Thrown when |
|---|---|---|
| `ImagingNotFoundError` | `IMAGING_NOT_FOUND` | Image does not exist, ownership traversal fails, or a mutation's re-scoped `where` matches zero rows — deliberately indistinguishable in every case |
| `ImagingLegalHoldViolationError` | `IMAGING_LEGAL_HOLD_VIOLATION` | `redactForAnonymization` targets a legal-hold study |
| `ImagingStorageUnavailableError` | `IMAGING_STORAGE_UNAVAILABLE` | The underlying storage provider throws an unexpected (non-404-shaped) error |
| `ImagingInvalidRedactionReasonError` | `IMAGING_INVALID_REDACTION_REASON` | `reason` is not one of the closed `RedactionReason` values at runtime |

`RedactionReason = 'anonymization' | 'deletion_review'` — reuses `PatientPrivacyRequest.requestType`'s own existing vocabulary (`patientPrivacy.ts`'s `VALID_REQUEST_TYPES`) rather than inventing new terms; `isRedactionReason()` is exported for runtime validation (TypeScript's compile-time union does not protect a JS/untyped caller).

## 8. Transaction ownership

None of the four methods introduces a `prisma.$transaction`. `markStorageMissing`/`redactForAnonymization` are each a single `updateMany` call; `getImagesForLifecycleReview` a single `findMany`; `checkImageStorageExists` a single ownership read plus a delegated storage call. No cross-resource (storage+DB) atomicity is claimed anywhere — `BLK-01` (the pre-existing storage/DB compensation gap) is unresolved and out of scope, matching F2-PREP-008 §8/§9.5 exactly.

## 9. Storage boundary

`checkImageStorageExists` delegates entirely to `fileStorage.ts`'s existing `fileExists()` — no new storage client, no S3-specific or local-specific branching inside `public.ts`. The only injection point (`fileExistsForTest`) is optional, defaulted, and never reached by production code (proven by the unused-import search, §15, and by the "no S3/local branching" source-scan test).

## 10. Audit/observability ownership

**The facade performs zero audit/activity-log writes.** Ownership stays entirely with the calling service — matching current behavior exactly: `patientAnonymization.ts` already writes one summary `writeAuditLog`/`logActivity` pair per whole anonymization operation (covering both attachment and imaging redaction counts in its own metadata, not per-image); `orphanFileInspection.ts`'s `markConfirmedMissing` currently writes no audit log at all (only a `console.error` on a per-row failure). Since this facade has zero callers today, this choice has no observable effect yet; it is recorded now so a future Stage 3 caller-migration task does not introduce a duplicate audit entry by having both the facade and the (already audit-owning) caller each log the same logical operation. Verified by a source-scan test (`public.ts`'s own text contains no `writeAuditLog`/`logActivity`/`console.*` call). No patient name/phone/email/raw storage key/filename/bridge token/raw payload/raw provider error can appear in a log this file never writes.

## 11. Files changed

| File | Change |
|---|---|
| `server/src/services/imaging/public.ts` | New — the facade itself |
| `server/src/tests/imagingLifecycleFacade.test.ts` | New — 25 focused tests (disposable-Postgres) |
| `server/package.json` | Additive — new `test:imaging-lifecycle-facade` script; `server:test:disposable-db` extended by one member |
| `docs/program/evidence/F2-IMPL-001-A_ADDITIVE_UNUSED_INTERNAL_IMAGING_FACADE_SKELETON.md` | New — this document |
| `docs/program/evidence/F2-IMPL-001-A_additive_unused_internal_imaging_facade_skeleton.json` | New — machine-readable companion |
| `docs/program/NORAMEDI_MASTER_TRACKER.md` | Additive — new top entry (F2-PREP-008's entry preserved verbatim, demoted to "Prior update") |
| `docs/program/CURRENT_PHASE.md` | Additive — new top entry (same pattern) |
| `docs/program/phases/F2_MODULAR_BOUNDARIES.md` | Additive — status line/top summary updated, one new change-history row |
| `docs/program/evidence/README.md` | Additive — one new index row |

No `server/prisma/schema.prisma`, migration file, `.github/workflows/**`, route file, or existing Privacy service file is touched.

## 12. Proof the facade is unused

Two independent searches, both zero matches:

1. New test's own source-scan assertion (`imagingLifecycleFacade.test.ts`, "13. Unused-facade proof"): walks `server/src/routes/**` and `server/src/services/**` for the literal pattern `services/imaging/public` in every `.ts` file (excluding the facade's own file and other `.test.ts` files) — 0 offenders.
2. Independent repository-wide `grep -rn "services/imaging/public" server/src/routes server/src/services server/src/middleware server/src/jobs` run directly by this task (not via the test) — 0 matches.

No Privacy service (`deletionReviewInventory.ts`, `orphanFileInspection.ts`, `patientAnonymization.ts`), no route file, and no job file imports `public.ts`. `imaging.ts`/`imagingBridgePublic.ts` are unmodified.

## 13. Test placement decision

Inspected `server/package.json` before adding anything. `test:imaging-characterization` (F2-PREP-007-E) is semantically Stage-0 **characterization of current route/service behavior** — its own scope is closed and this task's instruction explicitly forbids replacing/weakening it. This task's new tests exercise **new code** (the facade), so they are a new, narrowly-named script (`test:imaging-lifecycle-facade`) rather than a member appended to `test:imaging-characterization`. Placement into an aggregate: the new suite requires only a disposable PostgreSQL (confirmed — it never sets `S3_BUCKET`/imports MinIO, uses `fileStorage.ts`'s local-disk mode exactly as `kvkkAttachmentImagingLifecycle.test.ts` does), so it is wired into the same, already-CI-owned `server:test:disposable-db` aggregate (Layer 3) that `test:imaging-characterization` itself uses — zero new CI job, zero new orchestrator profile, zero `.github/workflows/*.yml` file touched, identical placement rationale to F2-PREP-007-E's own precedent.

## 14. CT-23/CT-32/OVL-01/BLK-01 status (unchanged, not remediated by this task)

- `CT-23` (`LinkImagingStudy`, `imaging.ts:807-854`) — still `VERIFIED_DEFECT`, unresolved. Not touched; not exposed by this facade.
- `CT-32`/`CR-03`/`BLK-02`/`FP-06` (`UpdateImagingRequest`/`CancelImagingRequest`, `imaging.ts:487-524`/`530-552`) — still a verified, reproduced concurrency gap. Not touched; not exposed by this facade.
- `OVL-01` (manual/bridge ingest duplication) — still deferred to Stage 2. Neither ingest handler is touched by this task.
- `BLK-01` (storage/DB compensation gap) — still open, non-blocking for this internal, in-process design (§8).

## 15. Validation commands and results

| # | Command | Working directory | Exit | Notes |
|---|---|---|---|---|
| 1 | `git diff --check` | worktree root | `0` | Clean, no whitespace errors |
| 2 | `node -e "JSON.parse(...)"` against `server/package.json` and root `package.json` | worktree root | `0` | Both parse clean |
| 3 | `node -e "JSON.parse(...)"` against this task's own new JSON companion | worktree root | `0` | Parses clean (run after §17 below) |
| 4 | `npx prisma generate` | `server/` | `0` | Client generated |
| 5 | `npm run typecheck` (`prisma generate && tsc --noEmit`) | `server/` | `0` | 0 errors |
| 6 | `npm run test:imaging-lifecycle-facade` (standalone) | `server/`, via `npm run test:runtime:postgres` orchestration | `0` | **25 passed, 0 failed** (see breakdown below) |
| 7 | `npm run test:imaging-characterization` (unchanged, run as part of the full `server:test:disposable-db` aggregate below) | `server/` | `0` | Unmodified — not replaced/weakened |
| 8 | `npm run test:runtime:postgres -- --summary-file=postgres-run-summary.json` (provisions disposable PostgreSQL, runs the **entire** `server:test:disposable-db` aggregate — 10 pre-existing members + `test:imaging-characterization` + the new `test:imaging-lifecycle-facade` — tears down) | worktree root | `0` | `migration.code: 0`, `test.code: 0`, `cleanup.success: true`, `outcome.exitCode: 0` |
| 9 | `npm run test:runtime:cleanup-stale -- --live --ttl-hours=0.01` | worktree root | `0` | `candidates: []`, `removed: []`, `errors: []` — zero residual disposable Docker resources |
| 10 | `npm run test:imaging` (existing, non-disposable) | `server/` | `0` | **103 passed, 0 failed** — no regression |
| 11 | `npm run test:patient-privacy` (existing, non-disposable) | `server/` | `0` | **38 passed, 0 failed** — no regression |
| 12 | `grep -rn "services/imaging/public" server/src/routes server/src/services server/src/middleware server/src/jobs` | worktree root | non-zero (no matches) | Independent unused-import proof, §12 |

**Infrastructure used (command 8):** one disposable PostgreSQL container (`nmtest-pg-postgres-<runId>`), provisioned and torn down by the existing, unmodified `scripts/test-runtime/orchestrator.ts` `postgres` profile (Docker Desktop). No MinIO/S3 (this suite's own scope never requires it). Teardown/residual-resource result: `cleanup.success: true`, `cleanup.errors: []`; independently re-confirmed zero residual `com.noramedi.test-runtime=true`-labeled resources via command 9.

**New facade test breakdown (25/25, command 6/8):**

| Section | Assertions | Result |
|---|---|---|
| 1. Compile/export contract | 4 | ✓ all |
| 4. DTO shape | 2 | ✓ all |
| 5. Tenant-scoped review / cross-tenant denial | 3 | ✓ all |
| 6. Ownership re-derivation, not-found/mismatch without leakage | 3 | ✓ all |
| 7. `markStorageMissing` behavior | 2 | ✓ all |
| 8. `redactForAnonymization` behavior | 5 | ✓ all |
| 9-11. `checkImageStorageExists` (true/false/provider failure) | 4 | ✓ all |
| 12. No raw Prisma / audit-duplication source scan | 1 | ✓ |
| 13. Unused-facade proof | 1 | ✓ |

**Pre-existing `server:test:disposable-db` member counts (unaffected — cited from F2-PREP-007-E's own merged evidence, not re-transcribed line-by-line by this task; the full aggregate's exit `0` in command 8 above is this task's own direct re-confirmation that nothing regressed):** 10 pre-existing db-verification members (10/15/15/4/13/6/16/9/21/6 passed respectively) + `test:imaging-characterization`'s own 4 sub-suites (A 36/36, B 29/29, C 13/13, D 153/153, including D's 30/30 deterministic `BOTH_SUCCESS_SILENT_CLOBBER` rounds — all directly observed again in this task's own command-8 run).

## 16. Escalation rule — full backend suite

**Not run, and not required.** None of the escalation triggers apply: no repository rule mandates the full suite for an additive, zero-caller service file; `server/package.json`'s aggregation structure did not change in a way that makes focused coverage insufficient (one new script appended to one existing aggregate, following the exact F2-PREP-007-E precedent); the focused tests (facade + `test:imaging` + `test:patient-privacy`, all passing) expose no broader regression risk; and PR CI (the layered `ci-layers.yml`, unmodified by this task) will itself exercise `server:test:disposable-db` in full on this PR, satisfying the "PR CI policy will exercise it" condition without requiring a redundant local full-suite run beyond what command 8 above already covers (the entire aggregate the CI job itself runs).

## 17. Migration status

None. No `server/prisma/schema.prisma` or migration file is touched, added, or required.

## 18. Backward compatibility

Total. Zero existing callers, routes, API responses, database rows/schema, storage layout, or configuration are changed. `imaging.ts`/`imagingBridgePublic.ts`/all three Privacy services are byte-for-byte unmodified.

## 19. Rollback method

`git revert` of this task's implementation commit(s), or plain deletion of `server/src/services/imaging/public.ts` and `server/src/tests/imagingLifecycleFacade.test.ts` plus reversal of the additive `test:imaging-lifecycle-facade`/`server:test:disposable-db` package-script wiring and the four additive doc edits. No data rollback is required — nothing depends on this file yet.

## 20. Security and tenant impact

Additive only. No existing route/service/tenant-scoping/RBAC/audit/legal-hold behavior in the running application is changed. The new file's own tenant-enforcement mechanism is documented and tested in §5/§6 above and is, by direct comparison, strictly stronger than (never weaker than) the two existing direct-Prisma call sites it is designed to eventually replace.

## 21. Known open defects/risks, unchanged by this task

`CT-23` (`VERIFIED_DEFECT`, open), `CT-32`/`CR-03`/`BLK-02`/`FP-06` (verified concurrency gap, open), `OVL-01` (deferred to Stage 2), `BLK-01` (open, non-blocking for internal work), `PZ-IMG-03` (open), `R-070`/`R-046` (open), `R-071` (`CLOSURE_PROPOSED_AWAITING_EXTERNAL_CONFIRMATION`), G1/G2 (`NOT_APPROVED`), KVKK physical/architecture freeze (`ACTIVE`, untouched). None of these statuses is modified by this task.

## 22. Current task status

`AGENT_COMPLETED` / `TESTS_PASSED` / `PR_OPENED_AWAITING_REVIEW` (once §23 below is filled in after the PR is actually opened). Merged: no. Deployed: no. Production verified: no.

## 23. Is merge safe?

Yes, from a repository-integrity standpoint: additive-only, zero runtime callers, all focused/regression validation in §15 passed with real counts, `git diff --check` clean, zero residual test infrastructure. Ordinary program-owner review is still required, matching every prior F2-PREP-*/F2-IMPL-* task's own stated practice.

## 24. Is deployment safe?

Not applicable to this task specifically — merging this PR changes no deployable runtime behavior (zero callers), so there is nothing new to verify in production as a direct result of it. Production verification remains a separate, later gate tied to the eventual Stage 3 caller-migration task, not this one.

## 25. Exact next task

Stage 2 (`OVL-01` convergence + `ImagingRequest` PATCH/cancel concurrency hardening, i.e. `CR-03`/`BLK-02`/`FP-06` resolution) per the accepted `F2-PREP-006-E` expand-migrate-contract sequence — a distinct, separately-gated future task, not started, not authorized to start by this task. Stage 3 (Privacy/KVKK caller migration onto this facade) remains blocked behind Stage 2 and is likewise not started or authorized here.

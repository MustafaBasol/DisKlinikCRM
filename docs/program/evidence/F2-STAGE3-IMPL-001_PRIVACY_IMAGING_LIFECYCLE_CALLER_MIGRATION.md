# F2-STAGE3-IMPL-001 — Privacy/KVKK ImagingLifecyclePort Caller Migration (Initial Slice)

**Phase:** F2 — Modular Boundaries and Public Contracts, Imaging Stage 3 (initial implementation slice)
**Task ID:** F2-STAGE3-IMPL-001 (ClickUp `869efu8br`)
**Type:** Implementation — mechanical boundary migration, no product-behavior change
**Branch:** `feature/f2-stage3-impl-001-privacy-imaging-lifecycle-migration`
**Baseline:** `origin/main` @ `27c54f3aa81af4eecc33e79d77e366a0fe4915bc` (merge commit for PR #342, `fix/f2-ct-32-r2-imaging-request-residual-race`; exact post-merge main CI run `31304621261`, `GREEN` after rerun) — independently re-confirmed via `git fetch origin --prune` + `git rev-parse origin/main` + `git log -1 --oneline origin/main` before branching; no further `origin/main` advancement observed at task start.
**Commit:** `92f77f414cf64b465716c85913c6c65fead85e5e`

## 1. Authorization basis

`F2-STAGE3-AUTH-001` (merged) established `STAGE_3_ENTRY_GATE = SATISFIED` / `AUTHORIZED_TO_BEGIN_STAGE_3_IMPLEMENTATION = TRUE`, scoped to the two production-reachable, cleanly-mapping call sites: `patientAnonymization.ts`'s imaging redaction and `orphanFileInspection.ts`'s `inspectOrphans` lifecycle-review/existence-check path. `F2-CT-32-R2` (merged, PR #342) was the one late-breaking blocker on that authorization's own currency — it is now closed (see baseline above), which is what unblocks this task. This task does not re-open or re-litigate `F2-STAGE3-AUTH-001`'s own findings.

## 2. CodeGraph scope

Queried via `codegraph_explore` (`.codegraph/` index present at repo root), restricted to the authorized files only:

- `server/src/services/privacy/patientAnonymization.ts` (full source, both call sites of `redactPatientImagingImages`)
- `server/src/services/privacy/orphanFileInspection.ts` (full source, `inspectOrphans`/`markConfirmedMissing`)
- `server/src/services/imaging/public.ts` (full `ImagingLifecyclePort` contract: `getImagesForLifecycleReview`, `redactForAnonymization`, `checkImageStorageExists`, `findOwnedImage`, typed errors, DTO)
- `server/src/services/fileStorage.ts` (`fileExists`/`isSafeStorageKey` — to characterize storage-unavailable semantics precisely)
- Relevant tests: `server/src/tests/imagingCharacterizationTenantLifecycle.test.ts` (CT-05/CT-23/CT-30), `server/src/tests/imagingLifecycleFacade.test.ts`, `server/src/tests/patientPrivacy.test.ts`, `server/src/tests/dbVerification/dbVerificationHarness.ts`

No whole-repository scan performed. Three `codegraph_explore` calls issued in total, each scoped to the named symbols/files above.

## 3. Direct Imaging call sites — before

`patientAnonymization.ts`'s `redactPatientImagingImages(clinicId, patientId)`:
```ts
const images = await prisma.imagingImage.findMany({
  where: { clinicId, study: { patientId } },
  select: { id: true, originalName: true, study: { select: { legalHold: true } } },
});
// ... await prisma.imagingImage.update({ where: { id: image.id }, data: { originalName: ANON_TEXT } });
```
Called from two sites inside `anonymizePatientData`: the already-anonymized idempotent-rerun branch, and the main first-run path (step 11).

`orphanFileInspection.ts`'s `inspectOrphans`:
```ts
const imagingImages = await prisma.imagingImage.findMany({
  where: { clinicId, study: { patientId } },
  select: { id: true, filePath: true, study: { select: { legalHold: true } } },
  take: BATCH_SIZE,
});
// ... const exists = await fileExists(image.filePath);
```

## 4. Migrated call sites — after

`patientAnonymization.ts`'s `redactPatientImagingImages` now calls:
- `getImagesForLifecycleReview(clinicId, patientId)` — replaces the direct `findMany`
- `redactForAnonymization(clinicId, image.id, 'anonymization')` — replaces the direct `update`, per non-legal-hold image

`orphanFileInspection.ts`'s `inspectOrphans` now calls:
- `getImagesForLifecycleReview(clinicId, patientId)` — replaces the direct `findMany`, with caller-side `.slice(0, BATCH_SIZE)` truncation (the port has no `take` of its own)
- `checkImageStorageExists(clinicId, image.id)` — replaces the direct `fileExists(image.filePath)` call, per imaging image

Verified (grep) after migration: neither file's migrated path contains `prisma.imagingImage`/`prisma.imagingStudy` outside the explicitly deferred `markConfirmedMissing`.

## 5. clinicId provenance

Unchanged by this task — both migrated services already receive `clinicId` from callers whose own provenance was independently traced by `F2-STAGE3-AUTH-001`:
- `patientAnonymization.anonymizePatientData({ clinicId, ... })` — called from `server/src/routes/patientPrivacy.ts`'s `POST /patients/:id/privacy/anonymize`, whose `clinicId` comes from `resolvePatient(patientId, user)`'s own org+`allowedClinicIds`-scoped Prisma lookup, never a raw `req.user.clinicId`/JWT default/body/query value.
- `orphanFileInspection.inspectOrphans({ clinicId, patientId })` — called from the same route file's `GET /patients/:id/privacy/orphan-check`, identical `resolvePatient()` provenance.

This `clinicId` is passed straight through to every `ImagingLifecyclePort` call added by this task — no new source, no widening.

## 6. Patient anonymization — legal-hold adapter

`ImagingLifecycleImageDto` exposes `legalHold: boolean` (the same `study.legalHold` value the old direct query read). The migrated `redactPatientImagingImages` checks this flag **before** ever calling the port:

```ts
for (const image of images) {
  if (image.legalHold) { counters.skippedLegalHold++; continue; }
  try {
    await redactForAnonymization(clinicId, image.id, 'anonymization');
    counters.redacted++;
  } catch (err) {
    if (err instanceof ImagingLegalHoldViolationError) { counters.skippedLegalHold++; continue; }
    counters.failed++;
  }
}
```

This reproduces the pre-migration skip/count behavior for the common case (a legal-held image is never passed to the port at all). The `catch (ImagingLegalHoldViolationError)` branch additionally covers a TOCTOU race the pre-migration direct-Prisma code could not detect (a hold acquired between the lifecycle-review read and the write) — the port's own write-time predicate recheck throws in that case, and the adapter maps it back onto `skippedLegalHold`, not a new failure. Regression-tested directly (see §11, "legal-hold race" test).

**Known, documented counter divergence:** the port's DTO does not expose `originalName`, so the adapter cannot distinguish "already redacted by a prior run" from "redacted just now" the way the old `originalName === ANON_TEXT` pre-check did. Both cases now call `redactForAnonymization` (idempotent — a no-op for an already-redacted row) and both increment `redacted`. Pre-migration, an already-redacted row on a second/idempotent run was silently excluded from every counter bucket. This affects only a second/idempotent anonymization run on the same patient — `total`/`skippedLegalHold`/`failed` semantics and all first-run values are unchanged. Not authorized to fix via a port DTO extension (out of this task's scope); documented in code (`patientAnonymization.ts`'s doc comment) and locked in by an explicit new regression test.

## 7. Orphan inspection — behavior preserved

- Batch/limit: `getImagesForLifecycleReview` has no `take` of its own; caller-side `.slice(0, BATCH_SIZE)` (500) reproduces the old `take: BATCH_SIZE` cap exactly — verified by a 505-row regression test (§11, item I).
- Missing vs. present classification: unchanged (`checkImageStorageExists` delegates to the same `fileExists`-backed checker by default).
- Storage-unavailable behavior: `checkImageStorageExists` wraps a thrown storage error into `ImagingStorageUnavailableError` (a clean, typed error with no internal SDK detail) instead of letting the raw underlying error propagate — a **reduction** in exposed internal detail, not an increase. It still propagates out of `inspectOrphans` unhandled, exactly like before; the route (`GET /patients/:id/privacy/orphan-check`) already wraps the whole call in `try/catch` → generic `500 Orphan check failed`, so the HTTP-visible behavior is byte-identical regardless of which error type propagates.
- Cross-tenant scoping: `getImagesForLifecycleReview`'s nested predicate is `study: { clinicId, patientId }` (also constraining the study's own `clinicId`), stricter than the old `study: { patientId }` (image-level `clinicId` only) — a safety tightening, not a behavior-visible change for any consistent (non-corrupted) data.

## 8. Modular boundary exit condition

- `patientAnonymization.ts`: zero direct Prisma access to `ImagingImage`/`ImagingStudy` remains on the migrated redaction path (verified by grep).
- `orphanFileInspection.ts`: zero direct Imaging Prisma access remains on the migrated `inspectOrphans` lifecycle-review/existence-check path. The one remaining direct access, `markConfirmedMissing`'s `prisma.imagingImage.update`, is explicitly documented in its own doc comment and the file's header comment as a **deferred exception** (no `clinicId` parameter, zero production callers) — not confused with the migrated path. A regression test (§11, item L) statically asserts this function still has no `clinicId` parameter and still calls `prisma.imagingImage.update` directly, so any future accidental migration of it is caught.

## 9. Error mapping

| Port error | Mapped to |
|---|---|
| `ImagingLegalHoldViolationError` (redaction path) | `skippedLegalHold++` (adapter catch) |
| Any other error from `redactForAnonymization` | `failed++` (matches old catch-all `update()` failure handling) |
| `ImagingNotFoundError` / `ImagingStorageUnavailableError` (orphan inspection path) | Propagates unhandled out of `inspectOrphans`, exactly as the old unhandled `fileExists` throw did; the route's existing generic `try/catch` → `500` is unchanged |

No cross-tenant existence oracle introduced: `getImagesForLifecycleReview`/`checkImageStorageExists` both apply the caller's `clinicId` to every predicate; a wrong-clinic caller gets an empty list or `ImagingNotFoundError`, never a differentiated response. Regression-tested directly (§11, items J/K).

## 10. Audit / KVKK impact

`ImagingLifecyclePort` is audit-neutral by design (see `public.ts`'s own header doc) — it performs no audit/activity-log writes. Both migrated callers remain the sole audit owners, unchanged:
- `patientAnonymization.ts` still writes exactly one `AuditLog` row (`action: 'patient_anonymized'`) and one `ActivityLog` row per anonymization run, with the same `imagingResults` counters embedded in `metadata` as before.
- `orphanFileInspection.ts` writes no audit/activity log of its own, unchanged.

No image filename/storage key/path is newly logged — regression-tested directly (§11, item E: audit `metadata` JSON asserted to never contain the migrated images' `filePath` or pre-redaction `originalName`). No legal-hold bypass introduced — the adapter is strictly more conservative than the old code (it now also traps write-time hold races the old code could not detect).

## 11. Tests added

New file: `server/src/tests/dbVerification/privacyImagingLifecyclePortMigration.test.ts` (wired into `server:test:disposable-db` as npm script `test:privacy-imaging-lifecycle-migration`). Covers, against a real disposable PostgreSQL instance:

- **A** — port usage proof for `patientAnonymization` (via `__setRedactionPreMutationBarrierForTest` call-count hook)
- **B** — normal (non-legal-hold) redaction succeeds
- **C** — legal-held image preserves skip/count, never mutated
- **D** — first-run counters exactly match pre-migration semantics (`total=2, redacted=1, skippedLegalHold=1, failed=0`)
- **E** — audit/activity ownership unchanged, exactly one row each, no storage key/path/pre-redaction filename in metadata
- Idempotent-rerun test locking in the documented counter divergence (§6)
- Legal-hold TOCTOU race test (adapter maps the port's race-detected `ImagingLegalHoldViolationError` to `skippedLegalHold`, not `failed`)
- **F** — port usage proof for `inspectOrphans` (via `__setImagingStorageExistenceCheckerForTest` call-tracking hook)
- **G** — missing/present classification exact match (both hooked and live-storage variants)
- **H** — storage-unavailable propagates out of `inspectOrphans` unhandled
- **I** — 505-row BATCH_SIZE truncation regression (`checked === 500`)
- **J/K** — cross-clinic `clinicId` cannot act on or inspect another clinic's images/patient (empty result, no leak); `checkImageStorageExists` under a foreign `clinicId` throws `ImagingNotFoundError`, never a boolean
- **L** — `markConfirmedMissing` statically verified untouched (no `clinicId` param, still direct `prisma.imagingImage.update`, no port import) plus its live behavior re-verified
- **M** — `deletionReviewInventory.ts` statically verified untouched (still direct `prisma.imagingImage.findMany`, no `ImagingLifecyclePort` import)

## 12. Exact commands and results

See §13 for the disposable-PostgreSQL run. Non-DB commands:

- `cd server && npm run typecheck` — clean (Prisma Client regenerated, `tsc --noEmit` 0 errors)
- `npm run guardrail:test` — 74/74
- `npm run guardrail:scan` — exit 0; new `NEW` cross-domain-import findings are exactly the two migrated files' new `services/imaging/public.ts` imports (the intended sanctioned public-contract crossing); `resolvedBaselineEdgeIds` changes observed (`CDA-072`/`CDA-102`/`CDA-103`) are pre-existing baseline drift on `origin/main` unrelated to `imagingBridgePublic.ts`, not caused by this task — not touched, not claimed as this task's own resolution.
- `git diff --check` — clean (exit 0)

## 13. PostgreSQL / migration

- Migration: **NONE** (no schema/migration file touched, confirmed by `git status`/`git diff --stat` against baseline).
- Disposable PostgreSQL: `npm run test:runtime:postgres` (Docker-provisioned, digest-pinned `postgres:16-alpine`, PostgreSQL 16), running `server:test:disposable-db`. Full orchestrator outcome: `migration.code: 0` (72/72 migrations applied cleanly, `prisma migrate deploy`), `test.code: 0`, `cleanup.success: true`, `outcome.exitCode: 0` (`"tests passed"`, `"cleanup succeeded"`).
- Exact relevant results: `imagingCharacterizationAuthShape` **36/36**; **CT-02/03/05/17/23/26/30** combined (`Imaging-Characterization-Tenant-Lifecycle`) **29/29** — includes `CT-05` (legal-hold RBAC gate) and `CT-30` (the exact pre-migration Privacy/KVKK direct-callers baseline this task's migration must not regress), both pass unmodified; `imagingCharacterizationIngestStorage` **14/14**; `imagingRequestConcurrencyCharacterization` (`CR-03`/`CT-32`) **30/30 EXACTLY_ONE_WINNER**, aggregate pass; `imagingRequestConcurrencyGuard` and `imagingRequestConcurrencyForcedInterleaving` both pass (chained via `&&`, orchestrator would have stopped at first failure — none occurred); `imagingIngestCoreConvergence` **9/9**; `test:imaging-lifecycle-facade` **34/34**; `test:imaging-study-request-patient-consistency` (**CT-23**) **12/12**; `test:imaging-study-request-patient-mismatch-detector` **7/7**; **new `test:privacy-imaging-lifecycle-migration`: 17/17** (items A–M plus the idempotent-rerun and legal-hold-race regressions, §11); `whatsappPublicApiExplicitClinicBinding` **29/29** (last member of the chain, confirms full completion).

## 14. Backward compatibility

No public route, HTTP response shape, service function return shape, redaction counter meaning (except the one documented idempotent-rerun divergence), audit metadata shape, or legal-hold behavior changed. This is a mechanical internal boundary migration.

## 15. Rollback

`git revert 92f77f414cf64b465716c85913c6c65fead85e5e` restores the pre-migration direct Prisma `ImagingImage`/`ImagingStudy` access in both `patientAnonymization.ts` and `orphanFileInspection.ts` exactly, since no schema/migration/route file is touched by this commit. No schema rollback needed or possible (none was applied).

## 16. Remaining Stage 3 deferred gaps (unchanged, not addressed by this task)

- `orphanFileInspection.ts`'s `markConfirmedMissing` — no `clinicId` parameter, zero production callers, explicitly deferred (§8).
- `deletionReviewInventory.ts`'s imaging read — needs `fileSize` in the port DTO, a contract extension not authorized here.
- `F2-IMG-AUDIT-002` — not implemented by this task.

## 17. Lifecycle status

- `AGENT_COMPLETED`: TRUE
- `TESTS_PASSED`: TRUE (see §13 — full disposable-PostgreSQL `server:test:disposable-db` aggregate, `outcome.exitCode: 0`; `typecheck`/`guardrail:test`/`guardrail:scan`/`git diff --check` all clean/passing)
- `PR_OPENED`: TRUE (see final report for PR number/URL)
- `MERGED`: FALSE (explicitly not requested)
- `DEPLOYED`: FALSE
- `PRODUCTION_VERIFIED`: FALSE

Stage 3 as a whole is **not** claimed complete by this task — this is the initial slice only, per its own authorized scope.

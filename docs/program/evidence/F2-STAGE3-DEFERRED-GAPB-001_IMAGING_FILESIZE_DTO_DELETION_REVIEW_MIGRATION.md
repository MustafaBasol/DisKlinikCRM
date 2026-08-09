# F2-STAGE3-DEFERRED-GAPB-001 — ImagingLifecyclePort fileSize DTO Extension + deletionReviewInventory Migration

**Phase:** F2 — Modular Boundaries and Public Contracts (Stage 3 — Imaging public-contract caller migration)
**ClickUp:** `869efub8w`
**Status:** `AGENT_COMPLETED` — `PR_OPENED` — `NOT_MERGED` / `NOT_DEPLOYED` / `NOT_PRODUCTION_VERIFIED`.

Implements the follow-up recommended by `F2-STAGE3-DEFERRED-001`'s design review
(`docs/program/evidence/F2-STAGE3-DEFERRED-001_PRIVACY_IMAGING_GAP_DESIGN_REVIEW.md`, Gap B):
`deletionReviewInventory.ts`'s remaining direct `prisma.imagingImage.findMany` read is removed
by adding `fileSize` to the `ImagingLifecyclePort` review DTO and migrating the caller onto
`getImagesForLifecycleReview(clinicId, patientId)`. This was the reason F2-STAGE3-IMPL-001
explicitly left `deletionReviewInventory.ts` untouched: the DTO didn't expose `fileSize`, and
`estimatedBytes` needs it.

---

## 1. Baseline verification

```
git fetch origin main            -> bb50212..bb50212 (already current)
git rev-parse origin/main        -> bb50212b2c7997dc5a806927827a52ef06ab7ff6 (matches expected PR #345 merge)
```

Worktree: `feature/f2-stage3-gapb-imaging-filesize-dto`, created off `origin/main` at that
exact SHA (`git worktree add ... -b feature/f2-stage3-gapb-imaging-filesize-dto origin/main`),
at `E:\Ek Gelir\Siteler\DisKlinikCRM-worktrees\f2-stage3-gapb-imaging-filesize-dto`.

```
git status --short   -> (clean at checkout)
git log -1 --oneline -> bb50212 Merge pull request #345 from MustafaBasol/fix/f2-stage3-postmerge-securityincident-ci
```

---

## 2. Pre-work verification

### 2.1 DTO before (server/src/services/imaging/public.ts)

```ts
export interface ImagingLifecycleImageDto {
  id: string;
  studyId: string;
  clinicId: string;
  patientId: string | null;
  legalHold: boolean;
  storageKey: string;
}
```

### 2.2 Direct Prisma query before (server/src/services/privacy/deletionReviewInventory.ts)

```ts
prisma.imagingImage.findMany({
  where: { clinicId, study: { patientId } },
  select: { fileSize: true, study: { select: { legalHold: true } } },
}),
```

Note: the pre-migration predicate scoped only `ImagingImage.clinicId` — it did **not** also
require `study.clinicId` to match. `getImagesForLifecycleReview`'s existing predicate
(`{ clinicId, study: { clinicId, patientId } }`) is strictly more conservative; migrating onto
it tightens tenant scoping for this path rather than weakening it.

### 2.3 `ImagingImage.fileSize` Prisma type

`server/prisma/schema.prisma:2958` — `fileSize Int` — **not nullable** (no `?`). There is no
DB-level null/undefined case to represent, so the DTO field is `fileSize: number`, never
`number | null`. The pre-migration `(i.fileSize ?? 0)` fallback in `deletionReviewInventory.ts`
was defensive/dead code against a case Prisma's own type already rules out.

---

## 3. Contract change (additive)

```ts
export interface ImagingLifecycleImageDto {
  id: string;
  studyId: string;
  clinicId: string;
  patientId: string | null;
  legalHold: boolean;
  storageKey: string;
  fileSize: number; // NEW — mirrors ImagingImage.fileSize (Int, not nullable)
}
```

`getImagesForLifecycleReview`'s Prisma `select` gains `fileSize: true`; the mapped DTO gains
`fileSize: image.fileSize` — no unit conversion, no rounding, no fabricated default (none
needed: the column is non-nullable). No other field added. Not exposed: `originalName`,
`fileName`, `mimeType`, `legalHoldReason`, or any DICOM metadata — unchanged from before this
task, and asserted by the existing forbidden-field checks in `imagingLifecycleFacade.test.ts`.

---

## 4. Caller migration

`deletionReviewInventory.ts`'s imaging read:

```ts
// before
prisma.imagingImage.findMany({
  where: { clinicId, study: { patientId } },
  select: { fileSize: true, study: { select: { legalHold: true } } },
}),
// ...
const imagingLegalHold = imagingImageRows.filter((i) => i.study?.legalHold).length;
const imagingBytes = imagingImageRows.reduce((sum, i) => sum + (i.fileSize ?? 0), 0);
```

```ts
// after
getImagesForLifecycleReview(clinicId, patientId),
// ...
const imagingLegalHold = imagingImageRows.filter((i) => i.legalHold).length;
const imagingBytes = imagingImageRows.reduce((sum, i) => sum + i.fileSize, 0);
```

`total`/`retainedClinical` (`imagingImageRows.length`) and the blocker logic
(`IMAGING_RETENTION_NOT_APPROVED`/`IMAGING_LEGAL_HOLD`) are unchanged — they only consume
`imagingImageRows.length` and the per-row `legalHold`/`fileSize` fields, which the DTO now
supplies directly instead of via a nested `study.legalHold` shape. `prisma` import is retained
(still used for `appointment`/`appointmentRequest`/`contactRequest`/`treatmentCase`/`payment`/
`paymentPlan`/`toothRecord`/`patientAttachment` counts, all outside this task's scope) —
only the `imagingImage` access is removed.

No change to `dryRun`, blocker codes, response shape, or the `organizationId` no-op parameter.

---

## 5. Tenant rules

`clinicId` is sourced from `patient.clinicId` in `patientPrivacy.ts`'s
`GET /patients/:id/privacy/deletion-review` route (`resolvePatient(patientId, user)` —
already authorization-validated per the route's existing behavior, unchanged by this task).
No `req.user.clinicId` shortcut, no cross-clinic aggregation, no patientId-only imaging lookup
— all pre-existing route-level behavior, untouched.

Predicate change: `{ clinicId, study: { patientId } }` → `{ clinicId, study: { clinicId, patientId } }`
(via the port). This is a strict tightening — a hypothetical denormalized row where
`ImagingImage.clinicId` matched the caller's `clinicId` but `ImagingStudy.clinicId` did not
would previously have been included in the count/bytes and is now excluded. No production
data is known to be denormalized this way (both fields are set together at creation, same as
documented in `services/imaging/public.ts`'s existing tenant-authorization comment); this is a
theoretical safety improvement, not an observed behavior change.

---

## 6. Files changed

- `server/src/services/imaging/public.ts` — `ImagingLifecycleImageDto` gains `fileSize: number`;
  `getImagesForLifecycleReview`'s Prisma `select`/map gains `fileSize`.
- `server/src/services/privacy/deletionReviewInventory.ts` — imports `getImagesForLifecycleReview`
  from `../imaging/public.js`; the `prisma.imagingImage.findMany` call is replaced by a call to
  it; `imagingLegalHold`/`imagingBytes` arithmetic reads the flat DTO fields instead of a nested
  `study.legalHold` shape.
- `server/src/tests/imagingLifecycleFacade.test.ts` — DTO-shape test updated to expect `fileSize`
  (was previously asserted absent); new regression test added confirming `fileSize` is never
  null/undefined and mirrors the underlying `ImagingImage.fileSize` column exactly.
- `server/src/tests/dbVerification/privacyImagingLifecyclePortMigration.test.ts` — test **M**
  (previously: "deletionReviewInventory.ts remains untouched, out of scope") rewritten to assert
  the migration (no `prisma.imagingImage` access, calls `getImagesForLifecycleReview`, imports
  from the port); new section **N–R** added covering exact count/estimatedBytes compatibility,
  zero-imaging behavior, cross-clinic isolation (same patientId under a non-owning clinicId, and
  an unrelated cross-org clinic's imaging never bleeding into another clinic's counts), and
  no storage-key/path/filename leakage in the response.

No `ImagingLifecyclePort` method signature change beyond the additive DTO field, no Prisma
schema/migration, no route wiring change, no change to `markConfirmedMissing`,
`redactForAnonymization`'s mutation/redaction behavior, or `F2-IMG-AUDIT-003`.

---

## 7. Behavior compatibility / semantics preserved

- `dryRun: true` — unchanged.
- Blocker codes (`DRY_RUN_ONLY`, `ATTACHMENTS_LEGAL_HOLD`, `IMAGING_RETENTION_NOT_APPROVED`,
  `IMAGING_LEGAL_HOLD`) — unchanged, same trigger conditions.
- `imaging.total` / `imaging.retainedClinical` — both still `imagingImageRows.length`, now
  sourced from the port instead of a raw Prisma array; identical value for non-denormalized data
  (see §5).
- `imaging.legalHold` — identical count, now read from `dto.legalHold` (already `Boolean(...)`
  in the port) instead of `study?.legalHold`.
- `imaging.estimatedBytes` — identical sum; `?? 0` fallback removed as dead code (fileSize is
  DB-non-nullable — see §2.3), not a behavior change for any real row.
- Response shape (`DeletionReviewInventory` interface) — unchanged, no field added/removed.
- No new storage key / file path / original filename leaks into the response (regression test R).

---

## 8. Exact tests and counts

Run via the full disposable-PostgreSQL regression (`server:test:disposable-db`, orchestrated by
`test:runtime:postgres`, which includes both named scripts below plus the full suite):

| Suite | Result |
|---|---|
| `npm run typecheck` (server) | Clean — `tsc --noEmit` zero errors |
| `test:imaging-lifecycle-facade` (`Imaging-Lifecycle-Facade`) | **37 passed, 0 failed** (36 pre-existing + 1 new `fileSize` DTO regression test) |
| `test:privacy-imaging-lifecycle-migration` (`Privacy-Imaging-Lifecycle-Port-Migration`) | **23 passed, 0 failed** (includes rewritten M + new N–R) |
| `Imaging-Characterization-Tenant-Lifecycle` (CT-30, includes `buildDeletionReviewInventory`) | **29 passed, 0 failed** — unaffected, confirms output-level compatibility independently of the migration-suite's own N–R tests |
| `test:kvkk-lifecycle` | **110 passed, 0 failed** |
| `guardrail:test` | **74 passed, 0 failed** |
| `guardrail:scan` | exit 0 (report-only) — see §11 for delta |

Full `server:test:disposable-db` aggregate (everything above plus the rest of the
disposable-DB-required suite, per the orchestrator's own log): **0 failures anywhere**.

`git diff --check` — clean, no whitespace errors.

---

## 9. PostgreSQL result

```
npm run test:runtime:postgres -- --summary-file=postgres-run-summary.json
```

```json
{
  "runId": "20260809T144148Z-197b70a6-11760",
  "profile": "postgres",
  "containerNames": ["nmtest-pg-postgres-20260809t144148z-197b70a6-11760"],
  "networkName": "nmtest-net-postgres-20260809t144148z-197b70a6-11760",
  "hostPorts": { "postgres": 64532 },
  "databaseName": "nmtest_postgres_20260809t144148z_197b70a6_11760",
  "migration": { "code": 0, "step": "ok" },
  "test": { "scriptName": "server:test:disposable-db", "code": 0 },
  "cleanup": { "success": true, "errors": [] },
  "outcome": { "exitCode": 0, "reasons": ["tests passed", "cleanup succeeded"] }
}
```

---

## 10. Migration status

**NONE.** No Prisma schema change, no migration file added or modified.

---

## 11. Guardrail delta

`guardrail:scan` (report-only, exit 0 regardless of findings) shows one new edge:
`server/src/services/privacy/deletionReviewInventory.ts` (symbol `getImagesForLifecycleReview`)
→ `services/imaging/public.ts`, domain `core-privacy-consent-retention-dsr` →
`imaging-server-viewer`, `baselineStatus: NEW`. This is the same edge *shape* already present
for `patientAnonymization.ts` and `orphanFileInspection.ts`'s existing calls into the same
facade (`getImagesForLifecycleReview`, `checkImageStorageExists`, `redactForAnonymization`,
`ImagingLegalHoldViolationError`) — not a new cross-domain access pattern. The pre-existing
`deletionReviewInventory.ts → db.ts` (Prisma default import) edge is unchanged and still present
(the file still queries `appointment`/`attachment`/etc. directly; only the `imagingImage` access
was removed). Net effect: one direct cross-domain `imagingImage` read replaced by one port-import
edge matching an already-accepted pattern; no new violation category.

---

## 12. Rollback

Trivial: revert the implementation commit. `deletionReviewInventory.ts`'s only production caller
is `GET /patients/:id/privacy/deletion-review` (dry-run only, no writes) — a revert restores the
prior direct-Prisma read with no data-loss or migration implications.

---

## 13. Lifecycle status

1. Task/phase: F2-STAGE3-DEFERRED-GAPB-001, Phase F2 Stage 3.
2. Baseline SHA: `bb50212b2c7997dc5a806927827a52ef06ab7ff6` (fetched, matches expected).
3. Worktree/branch: `E:\Ek Gelir\Siteler\DisKlinikCRM-worktrees\f2-stage3-gapb-imaging-filesize-dto`,
   `feature/f2-stage3-gapb-imaging-filesize-dto`.
4. DTO before/after: §2.1, §3.
5. `fileSize` nullability: non-nullable (`Int`), per Prisma schema — §2.3.
6. Before/after `estimatedBytes`: identical arithmetic, `?? 0` fallback removed as dead code — §7.
7. Exact tenant predicates: before `{ clinicId, study: { patientId } }`, after
   `{ clinicId, study: { clinicId, patientId } }` (via the port) — §2.2, §5.
8. Files changed: §6.
9. Tenant isolation impact: §5.
10. Behavior compatibility: §7.
11. Exact tests and counts: §8.
12. PostgreSQL result: §9 — exit 0, 0 failures.
13. Migration status: **NONE**.
14. Guardrail delta: §11.
15. Rollback: §12.
16. Commit SHA: recorded once committed (§ below, updated post-commit).
17. PR number/head: recorded once opened.
18. Exact-head CI: pending PR open.
19. Agent completed? **YES**.
20. Tests passed? **YES** (typecheck, targeted suites, guardrail test/scan, full disposable
    PostgreSQL regression — all green, 0 failures).
21. PR opened? recorded once opened.
22. Merged? **NO**.
23. Deployed? **NO**.
24. Production verified? **NO**.
25. Merge safe? Yes, pending standard PR review — implementation is additive (DTO gains one
    non-nullable field) and narrowing (tenant predicate strictly tightens), fully covered by new
    regression tests, and the full disposable-PostgreSQL suite is green with zero migration.

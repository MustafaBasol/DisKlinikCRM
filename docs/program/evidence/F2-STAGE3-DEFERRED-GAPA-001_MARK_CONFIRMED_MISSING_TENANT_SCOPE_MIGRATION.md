# F2-STAGE3-DEFERRED-GAPA-001 — markConfirmedMissing Tenant Scope + ImagingLifecyclePort Delegation

**Phase:** F2 — Modular Boundaries and Public Contracts (Stage 3 — Imaging public-contract caller migration)
**ClickUp:** `869efub8m`
**Status:** `AGENT_COMPLETED` — `PR_OPENED` — `NOT_MERGED` / `NOT_DEPLOYED` / `NOT_PRODUCTION_VERIFIED`.

Implements the follow-up recommended by `F2-STAGE3-DEFERRED-001`'s design review
(`docs/program/evidence/F2-STAGE3-DEFERRED-001_PRIVACY_IMAGING_GAP_DESIGN_REVIEW.md` §3.6/§3.7,
Gap A): `orphanFileInspection.ts`'s `markConfirmedMissing` gains an explicit `clinicId`
parameter and its `imaging_image` branch is migrated from a direct, id-only
`prisma.imagingImage.update` to `ImagingLifecyclePort.markStorageMissing(clinicId, imageId)`.
The `attachment` branch is unchanged (Option C, same-domain write, no port needed).

---

## 1. Baseline verification

```
git fetch origin main            -> bb50212..bb50212 (already current)
git rev-parse origin/main        -> bb50212b2c7997dc5a806927827a52ef06ab7ff6 (matches expected)
```

Worktree: `feature/f2-stage3-gapa-mark-confirmed-missing`, created off `origin/main` at that
exact SHA (`git worktree add ... -b feature/f2-stage3-gapa-mark-confirmed-missing origin/main`).

```
git status --short   -> (clean at checkout)
git rev-parse HEAD    -> bb50212b2c7997dc5a806927827a52ef06ab7ff6 (pre-implementation)
git log -1 --oneline  -> bb50212 Merge pull request #345 from MustafaBasol/fix/f2-stage3-postmerge-securityincident-ci
```

---

## 2. Pre-work verification

### 2.1 Current implementation (before)

```ts
// server/src/services/privacy/orphanFileInspection.ts (pre-change)
export async function markConfirmedMissing(
  entries: Pick<OrphanCheckEntry, 'id' | 'kind'>[],
): Promise<{ marked: number }> {
  ...
  } else {
    await prisma.imagingImage.update({ where: { id: entry.id }, data: { storageVerifiedMissingAt: now } });
  }
  ...
}
```

No `clinicId` parameter; the `imaging_image` branch wrote by bare `{ id: entry.id }`.

### 2.2 Caller inventory (`grep -rn markConfirmedMissing`)

| File | Line | Relationship |
|---|---|---|
| `server/src/services/privacy/orphanFileInspection.ts` | def | Definition |
| `server/src/tests/imagingCharacterizationTenantLifecycle.test.ts` | 63 (import), 700 (call) | Test-only caller |
| `server/src/tests/dbVerification/privacyImagingLifecyclePortMigration.test.ts` | 41 (import), 392/402 (calls, static assertion) | Test-only caller (was asserting the OLD un-migrated shape) |

**Production callers: zero**, confirmed by exhaustive grep and by reading
`server/src/routes/patientPrivacy.ts`, whose only imaging-orphan route
(`GET /patients/:id/privacy/orphan-check`) calls `inspectOrphans` only, never
`markConfirmedMissing`. No production caller exists, so no authorization-validated
`clinicId` had to be found for an existing caller — the STOP condition in this task's brief
did not trigger.

### 2.3 `ImagingLifecyclePort` target signature

`server/src/services/imaging/public.ts:199` —
`export async function markStorageMissing(clinicId: string, imageId: string): Promise<void>`.
Confirmed: stamps `storageVerifiedMissingAt` only, idempotent, throws `ImagingNotFoundError`
identically for a missing OR cross-tenant `imageId` (via `findOwnedImage`'s
`{ id: imageId, clinicId, study: { clinicId } }` predicate, re-applied on the write) — no
existence side-channel between the two failure cases.

### 2.4 `clinicId` provenance

No production caller exists today. The new parameter follows the same contract as
`inspectOrphans` (same file) and every other `ImagingLifecyclePort` caller: `clinicId` must
already be an authorization-validated clinic scope resolved by the caller (e.g. via
`resolvePatient()` in `patientPrivacy.ts`, which scopes by `user.allowedClinicIds` unless
`canAccessAllClinics`) — never a raw `req.user.clinicId`/body/query/JWT value, and never
derived from the entry's own `id`. This is documented directly in the function's doc comment.

---

## 3. Before / after architecture

**Before:** `orphanFileInspection.ts` → direct `prisma.imagingImage.update({ where: { id } })`
— cross-domain direct Prisma access from a Privacy-domain file, no tenant predicate on the
write itself, no `clinicId` parameter to even carry one.

**After:** `orphanFileInspection.ts` → `ImagingLifecyclePort.markStorageMissing(clinicId, imageId)`
→ (inside `public.ts`, unchanged) tenant-scoped read (`findOwnedImage`) + tenant-scoped
`updateMany`. `orphanFileInspection.ts` no longer imports or calls `prisma.imagingImage` for
this path — matching the same target pattern `F2-STAGE3-IMPL-001` already applied to
`inspectOrphans` in the same file.

---

## 4. Files changed

- `server/src/services/privacy/orphanFileInspection.ts` — `markConfirmedMissing(clinicId, entries)`;
  imaging branch now calls `markStorageMissing`; doc comments updated (no longer "deferred").
- `server/src/tests/imagingCharacterizationTenantLifecycle.test.ts` — updated the one existing
  call site to pass `fx.defaultClinicId`.
- `server/src/tests/dbVerification/privacyImagingLifecyclePortMigration.test.ts` — Section L
  rewritten from "assert still deferred/unmigrated" to full tenant-safety regression coverage
  (L1–L6, see §6 below); header comment (§L bullet) updated to match.

No `ImagingLifecyclePort` signature change, no Prisma schema/migration, no route wiring, no
change to `inspectOrphans`/batching/BATCH_SIZE, no `deletionReviewInventory.ts`/`fileSize` work,
no `F2-IMG-AUDIT-003` work.

---

## 5. Tenant isolation impact

- The `imaging_image` branch can no longer mutate another clinic's `ImagingImage` row by
  `id` alone — every write is now routed through `markStorageMissing`'s
  `{ id, clinicId, study: { clinicId } }` predicate, applied on both the ownership read and
  the write itself.
- A cross-tenant or nonexistent `imageId` fails identically (`ImagingNotFoundError`, caught
  by `markConfirmedMissing`'s existing per-entry `try/catch` and simply excluded from
  `marked`) — no distinguishable count, error shape, or timing signal between the two cases
  from outside the function.
- The `attachment` branch is untouched — it still writes by bare `{ id: entry.id }`, exactly
  as before. This preserves existing behavior per this task's explicit brief; it is not a new
  gap introduced by this change (the pre-existing attachment-branch scope, out of scope here,
  is the same one `F2-STAGE3-DEFERRED-001` §3.6 Option C already characterized as same-domain
  and not requiring a port).

---

## 6. Behavior compatibility / semantics preserved

- Missing-object classification, confirmed-missing behavior, and return shape (`{ marked: number }`)
  are unchanged.
- Idempotency preserved: `markStorageMissing` re-stamps the timestamp on a repeat call without
  erroring, matching the pre-migration `prisma.update` behavior (regression test L2b).
- Error semantics preserved: any failure (attachment or imaging) is caught, logged via
  `console.error('[orphan-file-inspection] failed to mark missing', entry, err)`, and simply
  not counted — never thrown out of `markConfirmedMissing` itself.
- No storage-key/original-filename leakage: the catch block logs only the caller-supplied
  `entry` (`{ id, kind }`), never the port's internal DTO/`storageKey` — verified directly
  (regression test L5, console.error spy on a cross-tenant failure).
- No audit ownership transfer: `ImagingLifecyclePort.markStorageMissing` performs no
  audit/activity-log write (unchanged, audit-neutral); `markConfirmedMissing` itself also
  performs none, exactly as before.

---

## 7. Tenant safety tests added (`privacyImagingLifecyclePortMigration.test.ts`, Section L)

| Test | Covers |
|---|---|
| L1 | Static source check: `clinicId: string` param present, no direct `prisma.imagingImage.(update\|updateMany)` remains, `markStorageMissing(` is called, attachment branch's direct `prisma.patientAttachment.update` is unchanged |
| L2 | Same-clinic mark succeeds — target row stamped, unrelated row untouched |
| L2b | Repeated mark of the same row is idempotent (no error, still counted, still stamped) |
| L3 | Cross-clinic `imageId` (clinic B) against clinic A's scope marks nothing, row untouched |
| L4 | A nonexistent `imageId` fails identically to a cross-tenant one (`marked: 0`, no throw) — non-enumeration |
| L5 | No raw storage key or filename appears in the logged error for a failed (cross-tenant) attempt |
| L6 | Attachment branch unchanged — id-only mark still succeeds, unaffected by the `clinicId` parameter's value |

`imagingCharacterizationTenantLifecycle.test.ts`'s existing CT-30 `markConfirmedMissing` test
(same-clinic stamp, unrelated row untouched) updated to pass `clinicId` and re-verified passing.

---

## 8. Exact tests and counts

Run via the full disposable-PostgreSQL regression (`server:test:disposable-db`, which includes
both named scripts below plus the full suite):

| Suite | Result |
|---|---|
| `npm run typecheck` (server) | Clean — `tsc --noEmit` zero errors |
| `test:imaging-lifecycle-facade` (`Imaging-Lifecycle-Facade`) | **36 passed, 0 failed** |
| `test:privacy-imaging-lifecycle-migration` (`Privacy-Imaging-Lifecycle-Port-Migration`) | **24 passed, 0 failed** |
| `Imaging-Characterization-Tenant-Lifecycle` (CT-30, includes `markConfirmedMissing`) | **29 passed, 0 failed** |
| `guardrail:test` | **74 passed, 0 failed** |
| `guardrail:scan` | exit 0 (report-only); new `orphanFileInspection.ts → markStorageMissing → services/imaging/public.ts` edge appears as the same sanctioned `imaging-server-viewer` port-import pattern as the pre-existing `checkImageStorageExists`/`getImagesForLifecycleReview` edges — no new violation category |

Full `server:test:disposable-db` aggregate (everything above plus the rest of the
disposable-DB-required suite): **0 failures anywhere** (612 passing assertions in the run log;
`grep -nE "[0-9]+ failed"` against the full log matches only `, 0 failed` lines).

---

## 9. PostgreSQL result

```
npm run test:runtime:postgres -- --summary-file=postgres-run-summary.json
```

```json
{
  "runId": "20260809T143648Z-5dcb31f6-19928",
  "profile": "postgres",
  "migration": { "code": 0, "step": "ok" },
  "test": { "scriptName": "server:test:disposable-db", "code": 0 },
  "cleanup": { "success": true, "errors": [] },
  "outcome": { "exitCode": 0, "reasons": ["tests passed", "cleanup succeeded"] }
}
```

`git diff --check` — clean, no whitespace errors.

---

## 10. Migration status

**NONE.** No Prisma schema change, no migration file added or modified.

---

## 11. Guardrail delta

`guardrail:scan` (report-only, exit 0 regardless of findings) shows one new edge:
`orphanFileInspection.ts` (symbol `markStorageMissing`) → `services/imaging/public.ts`,
domain `imaging-server-viewer`. This is the same edge *shape* already present for this file's
two `F2-STAGE3-IMPL-001`-migrated calls (`checkImageStorageExists`, `getImagesForLifecycleReview`)
— not a new cross-domain access pattern, and it *removes* the prior direct
`server/src/services/privacy/orphanFileInspection.ts → prisma.imagingImage` write edge for this
path. Net effect: one direct-Prisma cross-domain write edge replaced by one port-import edge
matching an already-accepted pattern.

---

## 12. Rollback

Trivial: revert the implementation commit. `markConfirmedMissing` has zero production callers,
so there is no production-visible behavior to roll back — only the two test files' call sites
would need their own revert (bundled in the same commit).

---

## 13. Lifecycle status

1. Task/phase: F2-STAGE3-DEFERRED-GAPA-001, Phase F2 Stage 3.
2. Baseline SHA: `bb50212b2c7997dc5a806927827a52ef06ab7ff6` (fetched, matches expected).
3. Worktree/branch: `E:\Ek Gelir\Siteler\DisKlinikCRM-worktrees\f2-stage3-gapa-mark-confirmed-missing`,
   `feature/f2-stage3-gapa-mark-confirmed-missing`.
4. `markConfirmedMissing` callers found: two test-only call sites (§2.2); zero production.
5. `clinicId` provenance: no production caller exists; contract documented to require an
   already-authorization-validated scope, matching `inspectOrphans`/every other port caller.
6. Before/after architecture: §3.
7. Files changed: §4.
8. Tenant isolation impact: §5.
9. Behavior compatibility: §6.
10. Exact tests and counts: §8.
11. PostgreSQL result: §9 — exit 0, 0 failures.
12. Migration status: **NONE**.
13. Guardrail delta: §11.
14. Rollback: §12.
15. Commit SHA: `a2244ed4ebe6e055bb4de4afd38bf48b5cd8e4c7` (implementation + test commit).
16. PR number/head: recorded once opened (§ below, updated post-open).
17. Exact-head CI: pending PR open.
18. Agent completed? **YES**.
19. Tests passed? **YES** (typecheck, targeted suites, guardrail test/scan, full disposable
    PostgreSQL regression — all green, 0 failures).
20. PR opened? recorded once opened.
21. Merged? **NO**.
22. Deployed? **NO**.
23. Production verified? **NO**.
24. Merge safe? Yes, pending standard PR review — implementation is additive/narrowing (adds a
    required parameter to a zero-production-caller function; only test call sites needed
    updating), fully covered by new regression tests, and the full disposable-PostgreSQL suite
    is green with zero migration.

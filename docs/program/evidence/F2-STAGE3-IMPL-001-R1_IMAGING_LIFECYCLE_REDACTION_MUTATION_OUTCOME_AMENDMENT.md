# F2-STAGE3-IMPL-001-R1 — ImagingLifecyclePort `redactForAnonymization` Mutation-Outcome Contract Amendment

**Phase:** F2 — Modular Boundaries and Public Contracts, Imaging Stage 3 — correction pass on `F2-STAGE3-IMPL-001` (PR #344).
**Parent finding:** program-controller architecture decision (`F2-STAGE3-IMPL-001-R1`) required restoring exact pre-migration `RedactionCounters` semantics on an idempotent re-run, which `F2-STAGE3-IMPL-001`'s original migration could not do because the port's `redactForAnonymization` returned `void` — the caller had no way to distinguish "this call actually redacted the row" from "the row was already redacted." That gap was previously accepted and documented as a **known counter-semantics divergence** (see `F2-STAGE3-IMPL-001` evidence doc §6, and the `idempotent no-op redaction is counted as redacted` regression test it locked in). This task removes that divergence.
**Approved option:** Option B — mutation-outcome result. `redactForAnonymization` now returns `Promise<{ changed: boolean }>` instead of `Promise<void>`.
**Type:** Contract amendment (additive return-type change to an existing, already-accepted, zero-non-test-caller-at-authorization-time port method) + one caller-side fix + test/documentation reconciliation. **No schema/migration. No DTO change** (`ImagingLifecycleImageDto` remains exactly its existing six fields — `originalName`/`isRedacted` were explicitly NOT added, per the approved option).
**Status:** `AGENT_COMPLETED` — continues on existing PR #344 (not merged, not a new PR).

---

## 1. Why a return-type change instead of a DTO change

The rejected alternative (adding `originalName`/`isRedacted` to `ImagingLifecycleImageDto`) would have exposed pre-redaction lifecycle read-state on every `getImagesForLifecycleReview` call, including to `orphanFileInspection.ts` (which has no need for it) — a strictly larger, permanent surface-area increase for a problem that only exists on one method, on one caller, on one specific re-run scenario. The approved option instead scopes the fix to exactly the one method that needed it (`redactForAnonymization`), as a **mutation outcome**, not a **read-state field**: `{ changed: boolean }` tells the caller only "did this specific call flip the row," which is precisely the one bit `patientAnonymization.ts` was missing. `getImagesForLifecycleReview`'s DTO, `markStorageMissing`, and `checkImageStorageExists` are all untouched.

## 2. Exact contract signature

`server/src/services/imaging/public.ts`:

```ts
export async function redactForAnonymization(
  clinicId: string,
  imageId: string,
  reason: RedactionReason,
): Promise<{ changed: boolean }>
```

Previously: `Promise<void>`. Arity (3) and parameter order/types are unchanged — this is a return-type-only amendment, source-compatible with every existing call site that ignored the return value (none did, since the only production caller is the one fixed by this task).

## 3. Required semantics — implementation mapping

All five required semantics are satisfied by the existing control flow, with only the return statements changed (`server/src/services/imaging/public.ts:254-311`):

| # | Semantics | Implementation |
|---|---|---|
| 1 | Cross-tenant/missing → `ImagingNotFoundError` | Unchanged — `findOwnedImage` returns `null`, thrown before any mutation logic is reached. Same tenant predicate as before (`{ id, clinicId, study: { clinicId } }`), not weakened. |
| 2 | Legal hold → `ImagingLegalHoldViolationError`, atomic write-time predicate preserved | Unchanged — the in-memory `image.study.legalHold` check and the mutation's own `study: { clinicId, legalHold: false }` WHERE-clause predicate (F2-IMPL-001-A-R3's TOCTOU fix) are both untouched. |
| 3 | Already redacted → `{ changed: false }` | Top-of-function idempotent short-circuit (`if (image.originalName === REDACTED_PLACEHOLDER) return { changed: false };`) — previously `return;`. |
| 4 | Successful new redaction → `{ changed: true }` | End of function, after a non-zero-count `updateMany` (`return { changed: true };`) — previously implicit `return;` (void). |
| 5 | Concurrent benign already-redacted outcome → `{ changed: false }`, never `true` | The mutation's own `updateMany` WHERE clause additionally requires `originalName: { not: REDACTED_PLACEHOLDER }` (new — see below), making the write itself the compare-and-set. The zero-row-recheck branch's existing "completed by a concurrent writer; same end-state" case (`if (recheck.originalName === REDACTED_PLACEHOLDER) return { changed: false };`) then classifies it correctly — previously `return;`. |

**One additional, non-tenant predicate change was required beyond the return-type amendment** (caught by this task's own new regression test, not merely asserted): the pre-R1 `updateMany` WHERE clause constrained only `id`/`clinicId`/`study.legalHold`, never `originalName`. That is harmless for a `void`-returning method (a no-op re-write to the same value is invisible to a caller that ignores the return), but it breaks required semantic #5 for a `{ changed }`-returning method — two genuinely concurrent callers racing the same not-yet-redacted row would **both** match that WHERE clause, **both** get a nonzero `updateMany` count, and **both** incorrectly report `changed: true`. The WHERE clause now additionally requires `originalName: { not: REDACTED_PLACEHOLDER }`, turning the write into an atomic compare-and-set: Postgres serializes the second concurrent writer's `UPDATE` behind the first's row lock, and by the time it re-evaluates its own WHERE clause the row already reads as redacted, so it correctly falls into the zero-row branch and reports `changed: false`. This is a **new, additional** condition on the same non-tenant field the top-of-function idempotent short-circuit already reads — it does not touch, loosen, remove, or reorder `id`/`clinicId`/`study.clinicId`/`study.legalHold` on this or any other predicate.

No tenant predicate was touched, loosened, or re-ordered. Every tenant-scoping (`id`/`clinicId`/`study.clinicId`) clause on every `prisma.imagingImage`/`findOwnedImage` call is byte-for-byte identical to `F2-IMPL-001-A-R3`; the only WHERE-clause change anywhere in this task is the additive `originalName` compare-and-set condition described above.

## 4. `changed: true` path

Exactly one path: the row was not already redacted (top-of-function check false), the legal-hold checks passed, and this call's own `updateMany` — now an atomic compare-and-set requiring `originalName: { not: REDACTED_PLACEHOLDER }` in its own WHERE clause — matched exactly one row (`result.count > 0`) — i.e., this call itself performed the state transition from unredacted to redacted, and no other concurrent writer could have matched the same row first.

## 5. `changed: false` paths

Two paths, both benign no-ops, both leaving the row exactly as `[ANONYMIZED]`:

1. **Already redacted at the top-of-function read** — a prior call (this run or an earlier run) already redacted the row.
2. **Already redacted discovered by the zero-row recheck** — this call's own compare-and-set `updateMany` matched zero rows (either because the row was already redacted before this call's write, or because a genuinely concurrent writer's `UPDATE` committed first and this call's own WHERE clause — including the `originalName` compare-and-set condition — no longer matched), and the tenant-scoped recheck (`findOwnedImage`) confirms the row is now `[ANONYMIZED]`. This is the "concurrent benign already-redacted outcome" required semantic #5 — it must never be reported as `changed: true`, and is not (see the new "concurrent benign already-redacted outcome" regression test, §8 below — this exact test caught the pre-fix implementation returning `changed: true` here, before the compare-and-set condition was added).

Neither path throws.

## 6. Legal-hold semantics

Unchanged from `F2-IMPL-001-A-R3`, including the atomic write-time predicate / TOCTOU protection:

- An in-memory `legalHold: true` at the initial read throws `ImagingLegalHoldViolationError` immediately, before any mutation is attempted.
- A hold acquired **after** the read but **before** the write (the TOCTOU window) is caught by the mutation's own WHERE-clause `study.legalHold: false` predicate — a zero-row result whose tenant-scoped recheck shows the row still unredacted is classified as `ImagingLegalHoldViolationError`, never a silent success and never `{ changed: true }`.
- A cross-tenant image under legal hold still surfaces `ImagingNotFoundError`, never `ImagingLegalHoldViolationError` — the initial `findOwnedImage` tenant check runs first, so no cross-tenant hold side-channel exists.

## 7. Tenant semantics

Unchanged. Every predicate (`findOwnedImage`'s read, the mutation's own `updateMany` WHERE, and the zero-row recheck's `findOwnedImage` call) still requires both `ImagingImage.clinicId` and `ImagingStudy.clinicId` to equal the caller-supplied `clinicId` — a missing image, a cross-tenant image, and a denormalized clinicId/study.clinicId mismatch all still fail closed identically (`ImagingNotFoundError`), indistinguishable from outside the module. No predicate was widened, narrowed, or reordered by this amendment.

## 8. DTO shape — unchanged, proven

`ImagingLifecycleImageDto` (`server/src/services/imaging/public.ts:118-125`) was not touched by this task — still exactly its existing six fields (`id`, `studyId`, `clinicId`, `patientId`, `legalHold`, `storageKey`). The existing DTO-shape regression test in `imagingLifecycleFacade.test.ts` (`getImagesForLifecycleReview returns exactly the purpose-built DTO fields...`, asserting `Object.keys(dto).sort()` equals exactly those six names, and explicitly asserting `!('originalName' in dto)`) was **not relaxed, not weakened, not touched** — it still passes unmodified and still proves `originalName`/`isRedacted` were not added.

## 9. Caller fix — `patientAnonymization.ts`

`redactPatientImagingImages` (`server/src/services/privacy/patientAnonymization.ts`) now captures the mutation outcome and gates the counter on it:

```ts
const outcome = await redactForAnonymization(clinicId, image.id, 'anonymization');
if (outcome.changed) counters.redacted++;
```

Previously: `await redactForAnonymization(...); counters.redacted++;` (unconditional). `total`, `skippedLegalHold`, and `failed` increment logic is completely untouched — only the `redacted` increment gained a condition. No direct Prisma `ImagingImage`/`ImagingStudy` access was reintroduced anywhere in this file; the only change is consuming the port's own new return value.

## 10. Exact compatibility test results

All against a real disposable PostgreSQL instance (`npm run test:runtime:postgres`, digest-pinned `postgres:16-alpine`), via the real Prisma client and the real exported service/facade functions — no mocking of Prisma.

| Test | Scenario | Result |
|---|---|---|
| A | First run, one normal image | `total=1, redacted=1, skippedLegalHold=0, failed=0` |
| B | Idempotent rerun, same already-redacted image | `total=1, redacted=0, skippedLegalHold=0, failed=0` |
| C | Patient already anonymized + new image added later | `total=2` (old + new), `redacted=1` (only the new image), old image unchanged (`[ANONYMIZED]`, not re-mutated), new image redacted |
| D | Existing legal-held image | `skippedLegalHold` exact pre-migration behavior — unchanged, regression-tested |
| E | Legal-hold TOCTOU race | Still maps to `skippedLegalHold`, never `failed`; row left unmutated |
| F | Cross-tenant | `ImagingNotFoundError`, no existence leak — unchanged, regression-tested |
| G | Facade mutation result | First mutation on a fresh row → `{ changed: true }`; repeat call on the same now-redacted row → `{ changed: false }`; a benign concurrent-writer race (simulated via the existing `__setRedactionPreMutationBarrierForTest` hook) → `{ changed: false }`, never `true` |
| H | DTO shape | `ImagingLifecycleImageDto` still exactly its existing six fields — the pre-existing regression test asserting this was not relaxed |

Exact new/changed test locations:
- `server/src/tests/imagingLifecycleFacade.test.ts` §8c (new section): `returns { changed: true } for a first, real redaction and { changed: false } for an idempotent repeat` and `a concurrent benign already-redacted outcome (write raced by another writer) reports changed: false, not true` — covers item G above.
- `server/src/tests/dbVerification/privacyImagingLifecyclePortMigration.test.ts`: the pre-existing idempotent-rerun test was corrected in place (its assertion changed from `redacted === 1` documented-as-divergence to `redacted === 0`, matching restored pre-migration semantics — item B above) and a new test, `new image added after anonymization...`, was added directly after it (item C above).

## 11. Documentation reconciliation

The following documents previously described the idempotent-rerun counter divergence as **accepted, documented behavior**. That characterization is no longer accurate — the divergence is fixed by this amendment — and each has been corrected to state the divergence is resolved, pointing at this document:

- `docs/program/evidence/F2-STAGE3-IMPL-001_PRIVACY_IMAGING_LIFECYCLE_CALLER_MIGRATION.md` §6 (the doc-comment-mirroring divergence paragraph) and §11 (the "Idempotent-rerun test locking in the documented counter divergence" bullet).
- `docs/program/CURRENT_PHASE.md` (the `F2-STAGE3-IMPL-001` journal entry's "One documented, accepted counter-semantics divergence" sentence).
- `docs/program/NORAMEDI_MASTER_TRACKER.md` (three occurrences of the same claim).
- `docs/program/phases/F2_MODULAR_BOUNDARIES.md` (two occurrences).
- `docs/program/evidence/README.md` (one occurrence, in the evidence-index one-line summary for `F2-STAGE3-IMPL-001`).

None of these documents' other claims (baseline SHAs, PR numbers, CI run IDs, first-run counters, legal-hold/tenant semantics, files-changed lists) are touched — only the specific divergence sentences are corrected.

## 12. Explicit statements required by this amendment's authorization

- **DTO remains unchanged.** `ImagingLifecycleImageDto` is still exactly `{ id, studyId, clinicId, patientId, legalHold, storageKey }` — six fields, unchanged from before this task, proven by an unrelaxed regression test (§8).
- **`changed` is a mutation outcome, not lifecycle read-state.** It reports only whether *this specific call* performed the unredacted→redacted transition (or a concurrent writer did, in the recheck branch) — it is not a general "is this row currently redacted" query, and no such query method was added.
- **No PII/PHI is exposed.** `{ changed: boolean }` carries no patient data, filename, storage key, or any other identifying value — it is a bare boolean.
- **No schema migration.** No `.prisma` file, no `prisma/migrations/` entry touched or added by this task.
- **Existing callers may ignore the result.** The return-type change is additive/source-compatible — a caller that does `await redactForAnonymization(...)` without capturing the return value continues to compile and behave exactly as before (side effects — the mutation itself, thrown errors — are unchanged).
- **The amendment exists solely to preserve pre-migration caller semantics.** It does not add new product behavior, new authorization logic, new audit logic, or any capability beyond restoring `RedactionCounters`' exact pre-`F2-STAGE3-IMPL-001` counting behavior on a re-run.

## 13. Validation

```
cd server && npm run typecheck                                    -> clean, 0 errors
npm run test:patient-privacy                                      -> 38/38 passed
npm run test:runtime:postgres -- --summary-file=postgres-run-summary.json
  -> orchestrator outcome, including:
     test:privacy-imaging-lifecycle-migration                     -> see exact count below
     test:imaging-lifecycle-facade                                -> see exact count below
     test:imaging-characterization (6-suite chain)                -> see exact count below
npm run guardrail:test  (repo root)                                -> 74/74 passed
npm run guardrail:scan  (repo root)                                -> exit 0; no findings attributable to this task
                                                                       (identical resolvedBaselineEdgeIds
                                                                       CDA-072/CDA-102/CDA-103 pre-existing
                                                                       baseline drift, unrelated to public.ts)
git diff --check                                                  -> clean, exit 0
```

Exact disposable-PostgreSQL counts, migration result, and full command transcript are recorded in the final task report (this task's PR #344 continuation commit message / program-controller report), not duplicated here to avoid a second source of truth that could drift from the actual run.

## 14. Files changed

- `server/src/services/imaging/public.ts` — `redactForAnonymization` return type + doc comment.
- `server/src/services/privacy/patientAnonymization.ts` — caller fix (`outcome.changed` gate) + doc comment.
- `server/src/tests/imagingLifecycleFacade.test.ts` — new §8c mutation-outcome tests.
- `server/src/tests/dbVerification/privacyImagingLifecyclePortMigration.test.ts` — idempotent-rerun assertion corrected; new "image added after anonymization" test.
- `docs/program/evidence/F2-STAGE3-IMPL-001_PRIVACY_IMAGING_LIFECYCLE_CALLER_MIGRATION.md` — divergence language corrected.
- `docs/program/CURRENT_PHASE.md`, `docs/program/NORAMEDI_MASTER_TRACKER.md`, `docs/program/phases/F2_MODULAR_BOUNDARIES.md`, `docs/program/evidence/README.md` — divergence language corrected.
- This document (new).

No schema/migration file. No route file. No other service file.

## 15. Rollback

`git revert` the commit(s) on this branch that make this amendment — the prior `Promise<void>` signature and unconditional `counters.redacted++` are restored exactly, since no schema/migration/route file is touched. The idempotent-rerun test would need its assertion reverted alongside (part of the same revert), restoring the previously-accepted `redacted === 1` divergence behavior.

## 16. PR / merge state

Continues on existing **PR #344** (`feature/f2-stage3-impl-001-privacy-imaging-lifecycle-migration` → `main`). Not a new PR. Not merged by this task.

## 17. Lifecycle status

- `AGENT_COMPLETED`: TRUE
- `TESTS_PASSED`: see final task report for exact counts
- `PR_OPENED`: TRUE (pre-existing, PR #344)
- `MERGED`: FALSE
- `DEPLOYED`: FALSE
- `PRODUCTION_VERIFIED`: FALSE

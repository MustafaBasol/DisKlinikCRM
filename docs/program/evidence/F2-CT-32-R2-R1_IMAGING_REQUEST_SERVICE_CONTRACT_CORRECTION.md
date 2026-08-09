# F2-CT-32-R2-R1 — First-Party Imaging Request Service Contract Hardening — Evidence

**Phase:** F2 — Modular Boundaries and Public Contracts, Imaging Pilot — correction pass on F2-CT-32-R2 (PR #342).
**Parent finding:** program-controller review of PR #342 asserted the production NoraMedi frontend calls `imagingService.updateRequest`/`cancelRequest` without supplying `expectedStatus`, and required threading `request.status` from the calling UI component into each call.
**Type:** APPLICATION CODE (frontend service contract) + compile-time TEST. No schema/migration change. No backend route logic change (F2-CT-32-R2's route/CAS/`expectedStatus` handling is untouched).
**Status:** `AGENT_COMPLETED` / `TESTS_PASSED` / pushed to existing PR #342, not merged.

---

## 0. Premise correction (program-controller review acknowledged this before work began)

The review's premise — "the current production frontend still calls `imagingService.updateRequest`/`cancelRequest` without supplying `expectedStatus`" — does not hold. Targeted repository search (not a whole-project scan) found:

```
grep -rn "updateRequest(\|cancelRequest(" src/                        -> only src/services/api.ts (definitions), no callers
grep -rn "imagingService\." src/                                       -> ImagingQueue.tsx, PatientImagingTab.tsx call
                                                                           getUnlinked/linkStudy/getPatientStudies/getDevices/
                                                                           uploadStudy/archiveStudy/unarchiveStudy/unlinkStudy/
                                                                           downloadImage/loadDicomBlob/loadPreviewObjectUrl/
                                                                           loadDownloadObjectUrl/setStudyLegalHold — never
                                                                           updateRequest or cancelRequest
grep -rn "/imaging/requests" src/                                      -> only the 4 method definitions in api.ts
                                                                           (getRequests, createRequest, updateRequest,
                                                                           cancelRequest); zero call sites elsewhere
grep -rn "imaging/requests/\${\|updateRequest(\|cancelRequest(" .      -> src/services/api.ts, server/src/tests/
  (repo-wide, excluding node_modules)                                    imagingRequestConcurrency*.test.ts, and the
                                                                           pre-existing server/src/tests/_scratch_forced_repro.ts
                                                                           (F2-CT-32-R2 scratch file, not production code)
```

**Finding:** `imagingService.updateRequest` and `.cancelRequest` — and, further upstream, `.getRequests`/`.createRequest` — are defined in `src/services/api.ts` but have **zero production UI callers anywhere in `src/`**. There is currently no NoraMedi frontend surface that reads, creates, updates, or cancels an `ImagingRequest`; `ImagingQueue.tsx` and `PatientImagingTab.tsx` (the two imaging UI surfaces that exist) operate on `ImagingStudy`/`ImagingDevice`, not `ImagingRequest`. F2-CT-32-R2's own evidence doc already stated this in its alternatives-considered section (§4.1, item 3: *"the frontend does not currently send this field"*) without drawing the further conclusion that no call site exists at all.

**Consequence:** the original required outcome — "trace where the displayed/current ImagingRequest row came from [and] thread that exact row.status into the mutation" — is unsatisfiable as written, because no such UI component exists to trace. Fabricating one would be scope creep unrelated to closing a concurrency gap, and is explicitly out of scope per the corrected instruction that authorized this task (§"Do NOT fabricate or create UI work").

**Corrected scope (per program-controller re-authorization):** harden the first-party TypeScript service contract in `src/services/api.ts` so `expectedStatus` is *required*, not optional, at compile time — closing the gap structurally for any future first-party caller — while leaving the backend's optional `expectedStatus` (F2-CT-32-R2, unchanged) as the backward-compatible path for legacy/external callers.

---

## 1. Scope discipline

Targeted `Grep`/`Read` only, no whole-repository scan: `src/services/api.ts`, `src/pages/ImagingQueue.tsx`, `src/components/imaging/PatientImagingTab.tsx`, `server/src/schemas/index.ts` (`imagingRequestUpdateSchema`/`imagingRequestCancelSchema`/`IMAGING_REQUEST_STATUSES`), and the existing `docs/program/evidence/F2-CT-32-R2_IMAGING_REQUEST_RESIDUAL_RACE_REMEDIATION.md`. No backend route file was modified.

---

## 2. Fix

### 2.1 `src/services/api.ts`

Added two exported types and changed both mutation signatures:

```ts
export type ImagingRequestStatus = 'requested' | 'scheduled' | 'received' | 'cancelled' | 'failed';

export type ImagingRequestUpdateData = {
  expectedStatus: ImagingRequestStatus;   // required — not optional
  appointmentId?: string | null;
  treatmentCaseId?: string | null;
  requestedModality?: string;
  requestedDeviceId?: string | null;
  status?: ImagingRequestStatus;
  priority?: 'routine' | 'urgent' | null;
  notes?: string | null;
};
```

```diff
- updateRequest: (id: string, data: any) => api.patch(`/imaging/requests/${id}`, data),
- cancelRequest: (id: string) => api.patch(`/imaging/requests/${id}/cancel`),
+ updateRequest: (id: string, data: ImagingRequestUpdateData) => api.patch(`/imaging/requests/${id}`, data),
+ cancelRequest: (id: string, expectedStatus: ImagingRequestStatus) =>
+   api.patch(`/imaging/requests/${id}/cancel`, { expectedStatus }),
```

`ImagingRequestStatus` mirrors `server/src/schemas/index.ts`'s `IMAGING_REQUEST_STATUSES` literal-for-literal (`requested`/`scheduled`/`received`/`cancelled`/`failed`); the other `ImagingRequestUpdateData` fields mirror `imagingRequestUpdateSchema`'s optional fields. `api.ts` does not manufacture `expectedStatus` — it is not computed, defaulted, or looked up inside this file; the type system simply refuses to compile a call that doesn't supply one from the caller's own arguments. No second GET was added.

Nothing else in `api.ts` changed. `getRequests`/`createRequest` were left as they were (`any`/untyped `params`/`data`) — the task and the concurrency gap are specific to the two mutation endpoints; widening typing elsewhere was out of scope.

### 2.2 Compile-time regression coverage

New file: `src/services/__tests__/imagingRequestServiceContract.typecheck.ts`. It declares (and exports, but never calls) two functions:

- `assertValidCallsTypecheck()` — three valid calls (`updateRequest` with only `expectedStatus`, `updateRequest` with `expectedStatus` plus other fields, `cancelRequest` with both args) that must compile cleanly.
- `assertOmittedExpectedStatusFailsTypecheck()` — five invalid calls, each preceded by `// @ts-expect-error`: `updateRequest` with a body that has `status` but no `expectedStatus`; `updateRequest` with an empty body; `cancelRequest` with only one argument; `cancelRequest` with an invalid status-literal second argument; `updateRequest` with an invalid status-literal `expectedStatus`.

This is deliberately **not** a `tsx`-runnable `.test.ts`: `api.ts` reads `import.meta.env` at module load time, which only Vite/vitest provide (confirmed: no existing plain-`tsx`-executed test in this repo imports `services/api.ts` directly; the only files that transitively import it are `.vitest.test.tsx` files, which run under vitest/Vite). The file's functions are declared and exported solely so `tsc` retains and checks their bodies; the file is never imported or invoked anywhere. Coverage comes entirely from `tsc -b` / `npm run build`, which already includes all of `src` per `tsconfig.json`'s `"include": ["src"]` — no new script, no new test framework.

**Verified not vacuous:** temporarily removed the `@ts-expect-error` guard above `updateRequest('req-1', { status: 'scheduled' })` and re-ran `npx tsc -b --force` — it failed with `TS2345: Argument of type '{ status: "scheduled"; }' is not assignable to parameter of type 'ImagingRequestUpdateData'. Property 'expectedStatus' is missing...`. Restored the guard; `npx tsc -b --force` returned clean (0 output, exit 0) again. This proves the negative assertions are catching a real compiler error, not passing vacuously.

---

## 3. No first-party bypass

Re-ran the same targeted search after the change to confirm no other first-party code calls these two methods, or reaches the same routes directly:

```
grep -rn "imagingService\.(updateRequest|cancelRequest)|/imaging/requests/\${id}(/cancel)?" src/
  -> only the two definitions in src/services/api.ts and the new
     imagingRequestServiceContract.typecheck.ts (which only references
     imagingService.updateRequest/cancelRequest as values, never invokes them)
```

Zero production callers exist today; the type change guarantees any future first-party caller must supply `expectedStatus` or the build fails.

---

## 4. Backward compatibility — corrected wording

Do **not** claim: *"the current frontend is now protected by sending `expectedStatus`."* Accurate statement:

- There are currently **zero first-party production callers** of `imagingService.updateRequest`/`.cancelRequest`.
- The first-party TypeScript service **contract** now requires `expectedStatus` at compile time on both methods.
- Any future first-party caller (a UI component built later) **must** supply the caller-observed `request.status` — the code will not compile otherwise.
- The backend route (`server/src/routes/imaging.ts`, F2-CT-32-R2, unmodified by this task) continues to treat `expectedStatus` as **optional** in its Zod schema — this remains the backward-compatible path for legacy/external API callers outside this codebase.
- Callers (first-party or external) that omit `expectedStatus` at the HTTP layer retain exactly F2-CT-32-R1's CAS-only guarantee, including its known residual gap for the chainable `scheduled -> cancelled` pair (documented in F2-CT-32-R2's evidence doc §3) — **unchanged, not newly fixed, not newly widened** by this task.
- Route URLs, response shapes, and the `409 concurrent_transition` error contract: unchanged (F2-CT-32-R2, untouched here).

---

## 5. Commands run, exact pass/fail counts

All against real disposable PostgreSQL 16 (`postgres@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777`), no mocks.

| Command | Result |
|---|---|
| `npm run build` (root — `tsc -b && vite build`) | 0 TypeScript errors, Vite build succeeded |
| `npx tsc -b --force` (clean, non-incremental re-run) | 0 errors — confirms the typecheck file is actually checked, not skipped via cache |
| Mutation check: guard removed from one negative case, `npx tsc -b --force` | 1 error (`TS2345`, expected) — proves the negative assertions are real; guard restored, re-run clean |
| `cd server && npm run typecheck` (`prisma generate && tsc --noEmit`) | 0 errors |
| `npm run guardrail:test` | 74 passed, 0 failed |
| `npm run guardrail:scan -- --out=guardrail-report.json` | exit 0 (report-only; findings never fail this job per its own contract) |
| `npm run test:runtime:postgres -- --summary-file=postgres-run-summary.json` (full `server:test:disposable-db` orchestrator — the exact command CI's Layer 3 job runs) | `outcome.exitCode: 0`, `reasons: ["tests passed","cleanup succeeded"]`, migration `code: 0` |
| `CT32_ROUNDS=100 npx tsx src/tests/imagingRequestConcurrencyCharacterization.test.ts` (manually-provisioned disposable Postgres 16, same digest-pinned image) | 504/504 passed; `EXACTLY_ONE_WINNER` 100/100, `BOTH_SUCCESS_SILENT_CLOBBER` 0/100 |
| `npx tsx src/tests/imagingRequestConcurrencyForcedInterleaving.test.ts` | 55/55 passed |
| `npx tsx src/tests/imagingRequestConcurrencyGuard.test.ts` | 73/73 passed (no regression) |
| `CT32_ROUNDS=30 npm run test:imaging-characterization` (full chain: auth-shape, tenant-lifecycle, ingest-storage, CT-32, Guard, Forced-interleaving, ingest-core-convergence) | all sub-suites passed, including forced-interleaving 55/55 and ingest-core-convergence 9/9 |
| `npm run test:imaging` | 103 passed, 0 failed |
| `npm run test:imaging-lifecycle-facade` | 34 passed, 0 failed |
| `npm run test:imaging-study-request-patient-consistency` | 12 passed, 0 failed |
| `npm run test:imaging-study-request-patient-mismatch-detector` | 7 passed, 0 failed |
| `git diff --check` (staged) | clean, exit 0 |

Frontend-specific `lint` was not run as part of this validation set (not on the corrected task's required list, and the repo's pinned local ESLint config could not be resolved via a bare `npx eslint` invocation in this environment — a pre-existing environment characteristic, not something this change introduced or needs to fix).

---

## 6. PostgreSQL / migration

- **Postgres version:** `postgres:16-alpine`, digest `sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777` — same digest F2-CT-32-R2 used and `scripts/test-runtime/lib/postgres.ts` provisions for CI Layer 3.
- **Migration:** `npx prisma migrate deploy` applied only pre-existing, already-merged migrations. **No new migration file.** This change is frontend TypeScript-types-and-signatures only.
- **Cleanup:** both the orchestrator run's own summary (`cleanup: { success: true, errors: [] }`) and the manually-provisioned container (`docker rm -f`) were torn down after use.

---

## 7. Tenant/security impact

None. No backend route, schema, or tenant-scope predicate was touched by this task. The concurrency-guard tests (Guard 73/73, Forced-interleaving 55/55, CT-32 504/504) and the cross-tenant scenario (H: cross-org `expectedStatus` cannot probe/affect an out-of-scope row) are unchanged and re-verified, not newly introduced.

---

## 8. Rollback

`git revert <fix commit>`. No schema rollback (none was made). Reverting restores `data: any` / no second `cancelRequest` argument on `imagingService.updateRequest`/`.cancelRequest` — since there are no production callers today, reverting has zero runtime behavior impact; it only removes the compile-time guarantee for future callers.

---

## 9. Stage-3 relationship

This is a narrower correction layered on top of F2-CT-32-R2 (PR #342, already evidenced), not a new defect class. It does not reopen or alter F2-CT-32-R2's backend fix, its CAS logic, or its test suite (Guard/Forced-interleaving/Characterization all re-verified with 0 regressions above). `F2-STAGE3-IMPL-001` remains gated on PR #342 merging with green post-merge main CI, per F2-CT-32-R2's own §11 — this document does not itself claim that gate is satisfied.

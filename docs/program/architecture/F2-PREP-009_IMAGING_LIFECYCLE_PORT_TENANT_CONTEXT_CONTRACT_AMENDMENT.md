# F2-PREP-009 — ImagingLifecyclePort Tenant Context Contract Amendment (Proposal)

**Phase:** F2 — Modular Monolith Guardrails / Imaging Early Implementation Gate.
**Amends:** F2-PREP-006-E §9 (F2-CC-14, `ACCEPTED_AND_REVISED`), F2-PREP-008 §9.4 (Stage 1 authorization).
**Triggered by:** [F2-IMPL-001-A_R1_TENANT_CONTEXT_REVIEW_CORRECTION.md](../evidence/F2-IMPL-001-A_R1_TENANT_CONTEXT_REVIEW_CORRECTION.md) — `BLOCKED_TENANT_CONTEXT_CONTRACT_INSUFFICIENT`.
**Type:** Documentation/architecture proposal only. No application/schema/migration/workflow/package-script file touched. Does not implement, modify PR #304, or add any caller.
**Status:** `PROPOSED` — requires program-owner review and acceptance before F2-IMPL-001-A (or any successor) implements against it.

---

## 1. Problem statement

The accepted F2-CC-14 `ImagingLifecyclePort` signatures for three of its four methods carry no caller-tenant value:

```ts
markStorageMissing(imageId: string): Promise<void>
redactForAnonymization(imageId: string, reason: RedactionReason): Promise<void>
checkImageStorageExists(imageId: string): Promise<boolean>
```

`getImagesForLifecycleReview(clinicId: string, patientId: string): Promise<ImagingLifecycleImageDto[]>` is unaffected — both parameters are real, caller-supplied tenant/scope values applied directly in a `where` clause.

For the other three, the only implementable safety mechanism is re-deriving `ImagingImage.clinicId`/`ImagingStudy.clinicId` from the row itself and checking the two agree with each other. That is a data-integrity check (the row is internally self-consistent), not an authorization check (the caller is entitled to this row). A caller holding any syntactically valid `imageId` — regardless of tenant — can invoke any of the three methods successfully against another tenant's row, provided that row's own denormalized `clinicId` columns agree with each other, which is true for essentially every non-corrupted row. This document amends the contract so that is no longer true.

## 2. Decision: Option A — explicit tenant context on every `imageId` operation

**Chosen.** All four `ImagingLifecyclePort` methods take an explicit tenant-context parameter:

```ts
markStorageMissing(clinicId: string, imageId: string): Promise<void>
redactForAnonymization(clinicId: string, imageId: string, reason: RedactionReason): Promise<void>
checkImageStorageExists(clinicId: string, imageId: string): Promise<boolean>
getImagesForLifecycleReview(clinicId: string, patientId: string): Promise<ImagingLifecycleImageDto[]>
```

### Why Option A over Option B (context-bound port instance)

Option B (`createImagingLifecyclePort(context)` returning imageId-only-shaped methods bound to a verified clinic scope) was considered and rejected for this contract, for four reasons:

1. **No existing factory/session-scoping convention to bind to.** This codebase's authorization pattern throughout (`resolveEffectiveClinicId`, every route handler, every existing service function) is an explicit parameter passed at the call site, never a constructed, closed-over, request-lifetime object. Introducing the first such pattern for this one port is a new architectural concept the rest of the program does not use, reviewed elsewhere, or benefits from — see [caller migration implications](#8-caller-migration-implications) for what that would cost every future caller.
2. **A bound-instance API hides the authorization boundary at the call site.** With Option A, every call to `markStorageMissing(clinicId, imageId)` is self-evidently scoped by reading the call; a reviewer or future maintainer sees the tenant argument in every diff that adds a call. With Option B, a call site reads `port.markStorageMissing(imageId)` — indistinguishable, at the point of use, from today's unsafe shape. The scoping information is one indirection away, in whatever code constructed `port`. This program's own convention (`server/AGENTS.md`-adjacent practice, and every accepted contract to date) favors explicit-at-call-site over implicit-via-closure specifically because it makes a missing/wrong scope visible in code review.
3. **Option B still requires solving the same problem to build the factory.** `createImagingLifecyclePort(context)` must itself validate `context` came from an "already-authorized tenant/principal context" — which requires exactly the same "where does clinicId legitimately come from" question this amendment answers for Option A, just moved one layer up and solved once instead of per-call. That is not less work; it is the same work with a less visible result at every call site.
4. **Smaller, mechanical migration.** Option A's caller-migration diff is "add one leading parameter, threaded from the same place every existing caller already resolves `clinicId` today" (see §8) — a change reviewable line-by-line against the existing direct-Prisma callers being replaced. Option B's migration additionally requires deciding *where* in each caller's call graph the port gets constructed, whether it is constructed once per request or once per operation, and whether/how it is passed down through intermediate functions — new design surface this contract does not need to open.

Option B remains a legitimate pattern in general and is not foreclosed for some future port with a genuinely different shape (e.g. one with many more imageId-only methods, or wired into an actual request-scoped middleware). It is rejected here because Option A fully closes this contract's specific gap with strictly less new architecture.

## 3. Tenant context source

`clinicId` passed to every `ImagingLifecyclePort` method **must** be an already **authorization-validated** clinic scope — **never** a raw, unvalidated `clinicId` read directly off `req.user.clinicId`, a JWT clinic claim, or any other caller-controlled request body/query value passed through untouched.

**The normative rule this contract enforces:** a raw, unvalidated `req.user.clinicId` (or the JWT-derived default clinic it represents) is not, by itself, sufficient authorization for this port. It is a UI/session default clinic *selection*, not proof that the current principal is still authorized to act on that clinic's data — a JWT claim can be stale relative to the user's current `allowedClinicIds`/`canAccessAllClinics` grants, and nothing about possessing a JWT with a `clinicId` claim proves the accessible-clinic check has been (re-)run. This document does not assert, and does not need, a claim that no other route anywhere in this codebase ever applies `req.user.clinicId` directly to a `where` clause — that would require a complete targeted audit this document has not performed. The enforceable requirement is narrower and self-contained: whatever `clinicId` reaches *this port*, from *any* caller, must have passed through one of the following (or an equivalent) first:

- `resolveEffectiveClinicId(user, requestedClinicId?)` (`server/src/utils/clinicScope.ts`) — validates that the requested-or-default `clinicId` belongs to the user's organization **and** (`canAccessAllClinics` or is present in `allowedClinicIds`) before returning it; returns `null` (→ 403 at the route) on failure.
- `validateAndGetClinicIdScope(user, selectedClinicId, res)` / `getAccessibleClinicIds(user)` (same file) — equivalent validated-scope / accessible-clinic-id-set mechanisms for callers that need a scope object or an explicit accessible-id list rather than one resolved id.
- An **equivalent record-derived validation**: a `clinicId` read off a record whose own lookup `where` clause was already restricted to `organizationId: user.organizationId` and, when the user cannot access all clinics, `clinicId: { in: user.allowedClinicIds }` — e.g. `patientPrivacy.ts`'s `resolvePatient()` helper, whose returned `patient.clinicId` cannot be for a clinic the caller is not authorized for, precisely because the row could not have been found otherwise. See §8a for why this is the actual, verified source for this port's three currently-intended callers.

**A caller-supplied/request-supplied `clinicId` (route param, request body, or query string) must be validated against the principal's accessible clinic set — via one of the above mechanisms or an equivalent — before it is ever passed to this port. No caller may pass an arbitrary `clinicId` sourced directly from body/query/JWT-default without that validation step.** The facade itself receives an already-authorized `clinicId` as an opaque, trusted value and does **not** re-run authorization internally — but it still applies that `clinicId` in every DB predicate, in every method, with no exception (§5). This port is a fail-closed **data** boundary; it is not, and does not relocate, the **authorization** boundary, which remains the caller's responsibility exactly as it is today for every other tenant-scoped service in this codebase.

This amendment does not introduce a new tenant-resolution mechanism; it requires that one of the *existing, already-accepted* ones be threaded into this port's calls, matching how `getImagesForLifecycleReview(clinicId, patientId)` already works today (unchanged by this amendment).

## 4. Principal / system context distinction

Two caller categories exist and are treated identically by the port — the port performs no privilege escalation for either, and in **both** cases the `clinicId` supplied to the port must already be authorization-validated per §3 before the call is made; neither category may supply a raw, unvalidated default:

- **Principal-initiated (interactive):** a request-scoped call where `clinicId` is resolved via one of §3's validated mechanisms — `resolveEffectiveClinicId`, an equivalent explicit scope-validation call, or a record lookup whose own query was already scoped to `organizationId` + `allowedClinicIds` (e.g. `patientPrivacy.ts`'s `resolvePatient()`, verified in §8a for this port's three intended callers) — **never** the unvalidated `req.user.clinicId`/JWT claim taken as-is. This amendment does not claim every other route in this codebase already validates identically — only this port's own three currently-intended callers, verified in §8a — and requires that same validated value, not a new or weaker one, to be threaded into the port.
- **System/lifecycle-initiated (batch/job):** a scheduled or triggered job (e.g. a future retention/anonymization sweep — **no such caller exists in this codebase today**; all three of this port's currently-intended callers are interactive routes, see §8a) where `clinicId` comes from the job's own per-clinic iteration scope: a trusted, single-clinic DB iteration/request record (the job iterates clinics or patient-privacy-requests one at a time) and calls the port once per iteration with that iteration's own `clinicId` — never a "system" wildcard/bypass value, and never more than one clinic per call.

**No system/lifecycle bypass exists or is introduced.** There is no `clinicId: 'SYSTEM'`, no optional/nullable `clinicId`, and no code path in the port that skips the tenant check for any caller category. A system/lifecycle caller that needs to operate across multiple clinics must call the port once per independently resolved clinic, each call individually scoped to that iteration's own already-validated `clinicId` — a multi-clinic job never makes one call covering more than one clinic, exactly how `deletionReviewInventory.ts`'s existing clinic-scoped iteration already operates today.

## 5. Fail-closed DB predicates

Every method's Prisma `where` clause includes `clinicId` as a top-level, non-optional, caller-supplied predicate — never applied only as a post-fetch comparison:

```ts
async function findOwnedImage(clinicId: string, imageId: string): Promise<OwnedImage | null> {
  const image = await prisma.imagingImage.findFirst({
    where: { id: imageId, clinicId, study: { clinicId } },
    select: { /* unchanged */ },
  });
  if (!image || !image.study) return null;
  return image as OwnedImage;
}
```

- The row is only ever fetched *if* both `ImagingImage.clinicId` and `ImagingStudy.clinicId` already equal the caller-supplied `clinicId` — a cross-tenant `imageId` now returns zero rows at the database level, not "a row that is then rejected."
- The existing denormalization-consistency guarantee is preserved (both `clinicId` columns are still checked, now against the caller's value rather than each other), so the amendment strictly adds the missing authorization predicate; it does not remove the existing data-integrity predicate.
- Every mutation (`markStorageMissing`, `redactForAnonymization`) re-applies the same `{ id: imageId, clinicId }` predicate in its own `updateMany`/`update` call — never relying on a read-then-trust-the-earlier-read pattern across two separate queries.
- A zero-row result from either the read or the write is treated as `ImagingNotFoundError` — identical handling whether the row does not exist at all or exists under a different `clinicId`, preserving the existing no-side-channel property (§6).

## 6. No cross-tenant existence leakage

`ImagingNotFoundError` remains the single, undifferentiated error for: image does not exist, image exists but its `study` relation is missing, image/study `clinicId` denormalization disagrees with itself, and image exists under a **different** `clinicId` than the caller's. All four cases are indistinguishable from outside the port, exactly as today — a caller cannot use response shape, timing-independent error type, or error message text to infer that an `imageId` exists under another tenant. This amendment does not weaken that property; it extends the same undifferentiated-not-found handling to the new authorization-mismatch case.

## 7. Audit ownership

Unchanged from the current accepted design (F2-IMPL-001-A §"Audit ownership"): the port performs no audit/activity-log writes. The calling service continues to own audit entries around its own call to the port, exactly as `patientAnonymization.ts` and `orphanFileInspection.ts` already do around their current direct-Prisma calls. This amendment adds a `clinicId` parameter; it does not add, remove, or relocate any audit responsibility.

## 8. Caller migration implications

No caller exists today (F2-IMPL-001-A remains zero-caller; this amendment does not change that). For the eventual Stage 3 migration of `patientAnonymization.ts`, `orphanFileInspection.ts`, and `deletionReviewInventory.ts` onto this port:

- Each caller already resolves a `clinicId` earlier in its own function body (from the authenticated request or its own clinic-scoped iteration) before reaching the `imageId`-only mutation it currently performs directly via Prisma. Migration is: thread that already-resolved value as the new leading argument to the port call, replacing the direct Prisma call — a mechanical, per-call-site diff, not a redesign of any caller's own control flow.
- No caller needs to newly *acquire* a `clinicId` it does not already have; if a future caller is found that would need to (none identified today), that caller is out of scope for Stage 3 migration until it independently resolves one through the existing authentication/authorization boundary.
- This migration remains Stage 3 work per the existing F2-PREP-006-E eight-stage sequence — not performed by this amendment and not performed by F2-IMPL-001-A's re-implementation against the amended contract (Stage 1 remains additive-only, zero callers).

## 8a. Caller `clinicId` source verification (per-caller findings, this correction)

This document does not retain the unqualified claim that all three future callers already have a validated `clinicId` without checking their current source. Direct inspection of `server/src/routes/patientPrivacy.ts` (current `main`, 2026-08-03) confirms all three call through the same route-level helper:

```ts
async function resolvePatient(
  patientId: string,
  user: NonNullable<AuthRequest['user']>,
): Promise<{ id: string; clinicId: string; isAnonymized: boolean } | null> {
  const where: any = { id: patientId, organizationId: user.organizationId, deletedAt: null };
  if (!user.canAccessAllClinics) where.clinicId = { in: user.allowedClinicIds };
  return prisma.patient.findFirst({ where, select: { id: true, clinicId: true, isAnonymized: true } });
}
```

- **`patientAnonymization.ts` (`anonymizePatientData`):** called from `POST /patients/:id/privacy/anonymize` (`server/src/routes/patientPrivacy.ts`). Exact `clinicId` source: `patient.clinicId` returned by `resolvePatient()`. **Authorization-validated** — the `Patient` row can only be found if its `clinicId` is within `organizationId: user.organizationId` and (`user.canAccessAllClinics` or in `user.allowedClinicIds`); this is a record-derived-but-access-scoped source, equivalent in effect to `resolveEffectiveClinicId`, not a raw `req.user.clinicId`/JWT default passed through untouched. **No additional validation/threading is required at Stage 3** beyond continuing to thread this same route-resolved value into the port call, in place of today's direct-Prisma call.
- **`orphanFileInspection.ts` (`inspectOrphans`):** called from `GET /patients/:id/privacy/orphan-check`. Exact `clinicId` source: identical — `patient.clinicId` from the same `resolvePatient()` helper. **Authorization-validated**, same reasoning as above. No additional Stage 3 validation required beyond threading.
- **`deletionReviewInventory.ts` (`buildDeletionReviewInventory`):** called from `GET /patients/:id/privacy/deletion-review`. Exact `clinicId` source: identical — `patient.clinicId` from the same `resolvePatient()` helper. **Authorization-validated**, same reasoning as above. No additional Stage 3 validation required beyond threading.

**Stage 3 precondition, not a standing guarantee:** the above is verified for the *current* call sites only, as of this correction (2026-08-03). This document does not assert Stage 3 migration is therefore purely mechanical forever — whoever performs the Stage 3 migration must re-confirm, at the time each caller is actually migrated, that `resolvePatient()` (or whatever resolves `clinicId` at that future call site) has not been changed in the interim to accept an unvalidated `clinicId`. This is recorded as an explicit Stage 3 precondition, not waived by this verification.

**No batch/job/system caller exists today.** A caller search (`patientAnonymization|redactPatientData|anonymizePatient`, `orphanFileInspection|deletionReviewInventory` across `server/src`) confirms all matches are the `patientPrivacy.ts` routes above, their own test files, or non-executing doc comments (e.g. `dataRetentionPolicy.ts`'s comment referencing anonymization by name, with no actual call). The "system/lifecycle" caller category in §4 is speculative/future, not a currently-migrating caller — the caller-migration scope for Stage 3 is these three interactive routes only.

## 9. Backward compatibility

There is no backward compatibility to preserve at the production-contract level: F2-IMPL-001-A (PR #304) has zero callers and is not merged. This is a **pre-merge contract correction**, not a breaking change to a shipped API. The only "compatibility" concern is with the *unmerged* PR #304 branch itself, addressed by rollback (§10): that branch's current `public.ts`/test file are superseded, not preserved, by the amended shape.

## 10. Rollback

Rollback of this amendment (if the program owner rejects Option A after review) is: revert this document and its JSON companion; no application code, schema, or CI file is touched by this proposal, so rollback is a documentation-only revert with no data-migration, no schema-migration, and no running-system impact. Rollback of a future re-implementation against this amended contract (once F2-IMPL-001-A is redone) remains what F2-IMPL-001-A's own evidence already established: delete/revert the single new `public.ts` file, since it remains additive and unused at merge time.

## 11. Required tests (for the re-implementation, not this document)

When F2-IMPL-001-A is re-implemented against this amended contract, its test suite must add, beyond the existing data-integrity assertions:

1. **Cross-tenant rejection — precise per-method cases, not one generic case:**
   - **A. `markStorageMissing`, `redactForAnonymization`, `checkImageStorageExists`:** create an image fixture owned by Clinic B; call the method with Clinic A's authorized `clinicId` and Clinic B's valid `imageId`. Assert `ImagingNotFoundError`, indistinguishable in shape/message/timing from calling the same method with an `imageId` that does not exist at all.
   - **B. `getImagesForLifecycleReview`:** create patient/image fixtures owned by Clinic B; call with Clinic A's authorized `clinicId` and Clinic B's `patientId`. Assert an empty result array — no Clinic B row, field, or count leaks into the response.
2. **Same-clinic success unaffected:** re-run the existing full assertion suite (not-found, legal-hold, invalid-reason, idempotency, storage-provider-failure) with the correct `clinicId` supplied, confirming the amendment adds authorization without regressing any existing behavior.
3. **Denormalization-mismatch-within-the-caller's-own-clinic still fails closed:** a row where `ImagingImage.clinicId` matches the caller's `clinicId` but `ImagingStudy.clinicId` does not (or vice versa) must still resolve to not-found — confirming §5's claim that the existing data-integrity predicate is preserved, not replaced, by the new authorization predicate.
4. **No existence side-channel:** assert identical error type/shape (not just "an error") across all not-found causes (missing row, cross-tenant row, denormalization mismatch), per §6.
5. **Signature-arity assertion, corrected:** replace F2-IMPL-001-A's existing `markStorageMissing.length === 1` (etc.) assertions with `=== 2` (`=== 3` for `redactForAnonymization`), and add an explicit assertion that `checkImageStorageExists.length === 2` with **no** third parameter present on the exported function — closing Finding 2 by making the one-optional-parameter constraint itself test-enforced, not just documented.

---

## 12. Open item carried forward, not resolved here

`fileExistsForTest`'s replacement mechanism (module-private helper / internal dependency factory / repository-native mocking / real controlled-failure fixture) is an implementation-technique decision for the re-implementation task, not a contract-amendment decision — this document requires only that the exported `checkImageStorageExists` remain exactly `(clinicId: string, imageId: string): Promise<boolean>` with no test-injection parameter. The specific test-double technique is left to F2-IMPL-001-A's re-implementation to choose and justify against this codebase's existing conventions (e.g. `vi.mock`/`jest.mock` module interception, already used elsewhere in this test suite for `fileStorage.ts`).

---

## 13. PR #304 head reconciliation (this correction, 2026-08-03)

At the time [F2-IMPL-001-A_R1_TENANT_CONTEXT_REVIEW_CORRECTION.md](../evidence/F2-IMPL-001-A_R1_TENANT_CONTEXT_REVIEW_CORRECTION.md) was authored (triggering this proposal), PR #304's head was `f8a37b72c4cc1800126b67e451e35238080cfe17`. PR #304 has since advanced to head `abac5e361abd0913dadbce1e124c2ca113600fb7` — independently re-verified via `gh pr view 304` (`state: OPEN`, `mergeable: MERGEABLE`) as part of this correction. Direct inspection of `server/src/services/imaging/public.ts` at the current head finds:

- **Finding 1 (tenant-context authorization gap) — still `OPEN`, still `BLOCKING`.** `findOwnedImage(imageId)` is unchanged in substance: `prisma.imagingImage.findFirst({ where: { id: imageId }, ... })`, followed by an in-memory `image.study.clinicId !== image.clinicId` comparison. No caller-supplied `clinicId` appears in the `where` clause of any of the three `imageId`-only methods on the current head either. **This is the reason F2-PREP-009 is required** — nothing about this finding has changed between heads.
- **Finding 2 (signature drift) — `VERIFIED_ON_PRIOR_HEAD` / `CORRECTED_ON_CURRENT_PR304_HEAD`.** The optional `fileExistsForTest` parameter on `checkImageStorageExists` no longer exists on the current head. The current exported signature is exactly `checkImageStorageExists(imageId: string): Promise<boolean>` — a one-argument function, matching the accepted F2-CC-14 arity. Test-time storage-failure injection is now provided by **a separately exported test-only setter controlling module-private state**, `__setImagingStorageExistenceCheckerForTest(override)`, which is not a parameter of `checkImageStorageExists` itself, is not part of the accepted `ImagingLifecyclePort` interface, and is not itself module-private (it is an exported function; only the state it sets is module-private). **This finding is not erased** — it was real and correctly identified against the head it was reviewed against — but it no longer describes the current PR #304 head and must not be cited as an open implementation defect against `main`-bound work going forward. The existence of this separate exported setter does **not** reopen Finding 2 by itself — Finding 2 was specifically about `checkImageStorageExists`'s own arity/parameters, which are now correct. Whether an exported test-only setter mutating module-private state remains an acceptable pattern for the re-implementation (versus, e.g., module-mock interception) is an **implementation-review concern for the corrected F2-IMPL-001-A**, not a blocker to accepting this tenant-context contract, and not decided by this document.

This amended contract's target signature for `checkImageStorageExists` remains `(clinicId: string, imageId: string): Promise<boolean>` (§2) — i.e. the current head's `(imageId: string): Promise<boolean>` is still short exactly one required parameter (`clinicId`, per Finding 1/this amendment), even though it no longer also carries the extra optional test parameter Finding 2 identified. **Closing Finding 2 does not close Finding 1; F2-IMPL-001-A remains blocked on Finding 1 alone.**

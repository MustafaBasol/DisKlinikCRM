# F2-IMPL-001-A — R1 Tenant Context Review Correction

**Phase:** F2 — Modular Monolith Guardrails / Imaging Early Implementation Gate.
**Reviews:** PR [#304](https://github.com/MustafaBasol/DisKlinikCRM/pull/304) (`feature/f2-impl-001-a-unused-imaging-lifecycle-facade`), head `f8a37b72c4cc1800126b67e451e35238080cfe17`. Not merged, not deployed, not modified by this review.
**Type:** Documentation-only architecture review and status correction. No application/schema/migration/workflow/package-script file touched. No caller added. No file in PR #304's own branch/worktree edited.
**Status:** `BLOCKED_TENANT_CONTEXT_CONTRACT_INSUFFICIENT` (this document's own finding, superseding the implementation task's self-assessment below).

Consistent with this program's established reconciliation convention (see F2-PREP-006-E §2, which resolves contradictions across sibling evidence documents without editing the originals): this document does not edit `F2-IMPL-001-A_ADDITIVE_UNUSED_INTERNAL_IMAGING_FACADE_SKELETON.md` or its JSON companion on the PR #304 branch. Those files are left exactly as authored (accurate as a record of what the implementing task believed and did); this document records an independent review finding that overrides their self-assessed conclusion.

---

## 1. What the implementation's own evidence claims

`F2-IMPL-001-A_additive_unused_internal_imaging_facade_skeleton.json` (PR #304 branch) states, verbatim:

- `acceptedContractSignatures.checkImageStorageExists`: `"(imageId: string, fileExistsForTest?: (ref: string) => Promise<boolean>): Promise<boolean>"`, with `signaturesAlteredFromAccepted: false` and a note that the added parameter is "additive, not an alteration of the accepted 1-argument production call shape."
- `tenantEnforcement.imageIdOnlyMethods.blockedTenantContextContractInsufficientConsidered: true`, `blockedTenantContextContractInsufficientTriggered: false` — the escalation condition was considered and explicitly not triggered, on the reasoning that (a) F2-PREP-008 already authorized this exact mechanism, (b) the mechanism is at least as strong as today's direct-Prisma callers, and (c) refusing an authorized, tested, additive improvement over today's code would not itself increase safety.

This review finds both conclusions incorrect, for the reasons below.

## 2. Finding 1 — tenant authorization is not enforced (confirmed)

Read directly from `server/src/services/imaging/public.ts` on the PR #304 head (`findOwnedImage`, `markStorageMissing`, `redactForAnonymization`, `checkImageStorageExists`):

```ts
async function findOwnedImage(imageId: string): Promise<OwnedImage | null> {
  const image = await prisma.imagingImage.findFirst({
    where: { id: imageId },
    select: { id: true, studyId: true, clinicId: true, /* ... */ study: { select: { id: true, clinicId: true, /* ... */ } } },
  });
  if (!image || !image.study || image.study.clinicId !== image.clinicId) {
    return null;
  }
  return image as OwnedImage;
}
```

The `where` clause is `{ id: imageId }` only. `clinicId` is *read back* from the resolved row and compared against the same row's `study.clinicId` — a comparison between two values both derived from the caller-supplied `imageId`, with no independent, caller-asserted tenant value anywhere in the comparison. This is a check that `ImagingImage.clinicId` and `ImagingStudy.clinicId` agree with each other (a denormalization-consistency check); it is not a check that the row belongs to whatever tenant is calling. A row with fully self-consistent `clinicId` values belonging to **Clinic B** passes this check identically whether the caller is a principal of Clinic A or Clinic B, because no representation of "the caller's clinic" is read, passed, or compared anywhere in `findOwnedImage`, `markStorageMissing`, `redactForAnonymization`, or `checkImageStorageExists`.

`getImagesForLifecycleReview(clinicId, patientId)` is unaffected by this finding — both parameters are applied directly in its `where` clause and it is genuine, caller-supplied-value tenant enforcement, exactly as the implementation's own evidence states.

**The workflow-convention argument is not an authorization boundary.** The implementation's evidence argues that because `getImagesForLifecycleReview` is the only in-contract way to obtain an `imageId`, tenant safety for the three `imageId`-only methods is "enforced by provenance." This is true only if every caller of `markStorageMissing`/`redactForAnonymization`/`checkImageStorageExists` is guaranteed, by a mechanism the port itself can verify, to have obtained that specific `imageId` from a `getImagesForLifecycleReview` call scoped to its own clinic in the same request/operation. The accepted signatures carry no such guarantee: any code with a syntactically valid `imageId` string — from a stored reference, a cross-tenant value guessed or leaked through an unrelated channel, a bug in a future caller, or simple reuse of an ID captured earlier — can call any of the three methods and have it succeed against another tenant's row, provided that row's own `clinicId` denormalization happens to agree with itself (true for essentially every real row; the check only fails on data corruption). "Callers are expected to only pass IDs obtained the intended way" is a documentation/workflow convention enforced by nothing at runtime — it is not equivalent to a tenant check, and does not become one because it is well-intentioned or because today's zero callers happen to follow it.

**Conclusion:** `BLOCKED_TENANT_CONTEXT_CONTRACT_INSUFFICIENT` is confirmed for the three `imageId`-only methods. This is the exact condition the prior task instruction defined this status for — an accepted signature that does not carry enough runtime context to authorize the caller, independent of how carefully the implementation behaves once given an `imageId`.

## 3. Finding 2 — accepted signature was changed (confirmed)

Accepted (F2-PREP-006-E §9, F2-PREP-008 §9.4, F2-IMPL-001-A's own §3 "Accepted contract signatures (unchanged, not silently altered)"):

```ts
checkImageStorageExists(imageId: string): Promise<boolean>
```

Implemented (`server/src/services/imaging/public.ts`, PR #304 head):

```ts
export async function checkImageStorageExists(
  imageId: string,
  fileExistsForTest?: (ref: string) => Promise<boolean>,
): Promise<boolean>
```

A function's public signature is the full parameter list a caller can observe and pass arguments against, not only the subset a specific caller happens to supply. Adding a second parameter — optional, defaulted, and never invoked by any production call site today — is still an addition to that signature: TypeScript's structural type for `typeof checkImageStorageExists` changes from a one-argument to a two-argument (one optional) function type, `Function.prototype.length` changes from `1` to `1` (optional trailing params do not count, but the parameter exists and is part of the exported type regardless), and any caller — test or otherwise — gains the ability to override the storage-existence check's provider function through the public export. The `fileExists`/`chmodForTest` precedent cited in the implementation's own comments is a same-module-internal convention (`fileStorage.ts` exposing test hooks to its own test file colocated with the implementation); it is not precedent for exposing test-only dependency injection through a different module's accepted public contract. "Optional and test-only" is a mitigation of the change's severity, not a reason the change did not occur.

**Conclusion:** the public signature was altered. `signaturesAlteredFromAccepted: false` in the implementation's own evidence is incorrect and is corrected here to `true` for `checkImageStorageExists`.

## 4. Files changed (PR #304, reviewed, unmodified by this document)

`git diff` (merge-base `f18b26efad3897b11400532ce20dab560fea3381` of `main`↔PR head) touching Imaging application code:

- `server/src/services/imaging/public.ts` (new, 265 lines) — the facade under review; both findings originate here.
- `server/src/tests/imagingLifecycleFacade.test.ts` (new, 448 lines) — asserts `markStorageMissing.length === 1` etc.; does not and cannot assert tenant authorization, since the accepted signatures give the test no caller-tenant value to assert against either (see §5).
- `server/src/tests/imagingCharacterizationAuthShape.test.ts`, `imagingCharacterizationIngestStorage.test.ts`, `imagingCharacterizationTenantLifecycle.test.ts`, `imagingRequestConcurrencyCharacterization.test.ts` — pre-existing Stage 0 characterization suites, unmodified by this PR (present in the diff only because the PR branch was created before these merged to `main` and they are ancestors, not new content added by F2-IMPL-001-A).
- No route, schema, migration, or CI workflow file touched. Zero production callers of `server/src/services/imaging/public.ts` confirmed (`git grep` across `server/src`, only match is the PR's own test file).

## 5. Why passing tests do not establish tenant authorization

`imagingLifecycleFacade.test.ts` verifies: (a) each method exists and has the expected parameter count, (b) not-found/legal-hold/invalid-reason error paths, (c) that `findOwnedImage`'s clinicId-consistency check returns not-found when `ImagingImage.clinicId` and `ImagingStudy.clinicId` disagree, (d) idempotency, (e) that `checkImageStorageExists` re-derives ownership before calling storage. None of these assertions constructs two distinct tenants and asserts that a caller authenticated as/scoped to tenant A is rejected when passing an `imageId` belonging to tenant B — because the accepted signatures give the test no way to express "caller's tenant" as an input distinct from the row's own stored `clinicId` values. A green test suite here demonstrates internal data-integrity behavior, not caller authorization; the two are verified by construction to be different properties in §2 above. This review does not claim the implementation's tests are inadequate as data-integrity tests — they are not evidence of the authorization property this program requires.

## 6. Updated status matrix

| Claim | Implementation's own evidence | This review |
|---|---|---|
| `checkImageStorageExists` signature altered from accepted | `false` | **`true`** — optional test-only param added |
| `imageId`-only methods: ambient/runtime tenant-context mechanism exists | `false` (acknowledged) | `false` (confirmed) |
| `imageId`-only methods: `BLOCKED_TENANT_CONTEXT_CONTRACT_INSUFFICIENT` triggered | `false` | **`true`** |
| `ImagingImage.clinicId` == `ImagingStudy.clinicId` check constitutes caller tenant authorization | (implicit) yes, via provenance | **No** — data-integrity check only |
| Task status | `AGENT_COMPLETED` / `TESTS_PASSED` / `PR_OPENED_AWAITING_REVIEW` | **`BLOCKED_TENANT_CONTEXT_CONTRACT_INSUFFICIENT`** |
| Merge safe | (implied) awaiting review | **No** |
| Deployment safe | (implied) not deployed | **No** |

## 7. PR #304 disposition

Left **open**, unmerged, unmodified — consistent with this program's evidence-reconciliation convention (§0 above) of correcting status in a new document rather than rewriting a completed task's own record, and with this review's own instruction not to close/merge a blocked implementation PR automatically. `gh pr view 304` confirms `state: OPEN`, `mergeable: MERGEABLE`, base `main`, and a passing CI roll-up as of this review (`ci-layers` Layers 1/2/4/5 and the `windows-bridge-pr` imaging-test job all `SUCCESS`; Layer 3 disposable-Postgres and one Windows-bridge release-script job still `IN_PROGRESS` at review time) — CI passing is expected and unaffected by this finding, since CI does not and cannot test for the missing authorization channel (§5).

Next step: [F2-PREP-009](../architecture/F2-PREP-009_IMAGING_LIFECYCLE_PORT_TENANT_CONTEXT_CONTRACT_AMENDMENT.md) must be authored, reviewed, and merged to amend the accepted `ImagingLifecyclePort` contract before PR #304 can be reconciled and re-implemented against a tenant-safe signature.

## 8. Validation performed by this review

- `git diff --check` on the PR #304 diff range: clean for the facade/test files reviewed here (pre-existing trailing-whitespace findings in unrelated vendor/font assets, not part of this PR's own new content).
- JSON parse validation: `F2-IMPL-001-A_additive_unused_internal_imaging_facade_skeleton.json` and `F2-PREP-006-E_imaging_boundary_contract.json` both parse as valid JSON (`node -e "JSON.parse(...)"`).
- Exact signature search: `git grep -n "checkImageStorageExists"` and `git grep -n "fileExistsForTest"` against the PR #304 head, confirming the two-parameter export and its sole reference from the PR's own test file.
- Exact import/caller search: `git grep -n "services/imaging/public"` against the PR #304 head, excluding `/tests/`, returns no matches — zero production callers confirmed.
- `gh pr view 304 --json ...`: `state OPEN`, `mergeable MERGEABLE`, `headRefOid f8a37b72c4cc1800126b67e451e35238080cfe17`, CI roll-up as recorded in §7.
- No implementation test was run or claimed as evidence of tenant authorization (§5).

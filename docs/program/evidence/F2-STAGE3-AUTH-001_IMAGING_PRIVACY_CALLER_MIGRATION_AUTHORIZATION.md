# F2-STAGE3-AUTH-001 — Imaging Stage-3 Privacy/KVKK Caller Migration Authorization Review

**Phase:** F2 — Modular Boundaries and Public Contracts (Imaging pilot)
**Mode:** READ-ONLY ARCHITECTURE / PROGRAM-CONTROL AUTHORIZATION REVIEW — no runtime, test, schema, migration, workflow, or package file touched. Stage 3 is **not implemented** by this task.
**Status:** `AGENT_COMPLETED` / `DOC_VALIDATION_PASSED` — `PR_OPENED` once opened — `NOT_MERGED` / `NOT_DEPLOYED` / `NOT_PRODUCTION_VERIFIED`.

This document independently evaluates whether Stage 3 of the Imaging boundary-contract
expand-migrate-contract sequence (`docs/program/architecture/F2-PREP-006-E_IMAGING_BOUNDARY_CONTRACT.md`
§14/§15) — Privacy/KVKK caller migration onto `ImagingLifecyclePort` — may begin, using
current repository/GitHub evidence, not prior prose and not the assigning brief's framing.

---

## 1. Baseline verification

```
git status --short      -> only 2 pre-existing untracked files, unrelated to this task
                            (F2-IMG-AUDIT-PREP-001 evidence draft; F2-ADR-ORG-DASH-001
                            tooling JSON) — not created, not touched by this task
git fetch origin --prune -> no new refs
git rev-parse origin/main -> 5eedf8ff5e8285a4c5b623119ab173ffa8d8ed23
git log -1 --oneline origin/main -> 5eedf8f Merge pull request #339 from
                            MustafaBasol/docs/f2-doc-004-stage2-exit-gate-reconciliation
git log --oneline 5eedf8f..origin/main -> (empty — no commits since baseline)
```

`origin/main` is exactly the SHA the assigning prompt expected (`5eedf8f`). **No
reconciliation is required** — the prompt's stated baseline is current.

**Exact main CI on this SHA**, independently re-verified via `gh run list
--workflow=ci-main-and-nightly.yml --branch main`:

| Field | Value |
|---|---|
| `databaseId` | `31273018579` |
| `headSha` | `5eedf8ff5e8285a4c5b623119ab173ffa8d8ed23` (exact match) |
| `event` | `push` |
| `status` | `completed` |
| `conclusion` | `success` |

Matches the assigning prompt's claim exactly. `STAGE_2_EXIT_GATE = SATISFIED` is confirmed
current and is **not** re-litigated by this task, per the F2-DOC-004 entry this baseline
rests on.

---

## 2. Accepted Stage-3 scope (not redefined)

Per `F2-PREP-006-E` §14: Stage 3 = Privacy/KVKK caller migration onto `ImagingLifecyclePort`,
blocked on Stage 2 closed + CT-30 passing, with `CT-05`/`CT-23`/`CT-30` as the mandatory
characterization-test precondition set. This review evaluates exactly that scope — not
Backup/Storage migration, BRG relocation, guardrail CI-blocking enforcement, audit
redesign, event/outbox work, imaging AI, microservices, or Stage 4+. None of those is
touched, proposed, or authorized here.

---

## 3. Current `ImagingLifecyclePort` contract (`server/src/services/imaging/public.ts`)

Read directly at the baseline SHA (zero reliance on prior documentation). Exact exported
signatures, confirmed by source:

```ts
markStorageMissing(clinicId: string, imageId: string): Promise<void>
redactForAnonymization(clinicId: string, imageId: string, reason: RedactionReason): Promise<void>
checkImageStorageExists(clinicId: string, imageId: string): Promise<boolean>
getImagesForLifecycleReview(clinicId: string, patientId: string): Promise<ImagingLifecycleImageDto[]>
```

Matches the F2-PREP-009-accepted explicit-clinicId contract exactly — no drift.

| # | Contract requirement (task §6) | Verified against source | Result |
|---|---|---|---|
| A | `clinicId` mandatory/non-optional on every method | All 4 signatures — no optional/default param | SATISFIED |
| B | No system wildcard | No `*`/skip-filter sentinel anywhere in `public.ts` | SATISFIED |
| C | No nullable tenant bypass | `clinicId: string`, never `string \| undefined` | SATISFIED |
| D | No ambient/global tenant context | `findOwnedImage(clinicId, imageId)` — `clinicId` always an explicit param, never read from a module-level/request-local store | SATISFIED |
| E | Image+study tenant predicates fail-closed | `{ id: imageId, clinicId, study: { clinicId } }` on every read AND re-applied on every write (`public.ts:171`, `204`, `273`) | SATISFIED |
| F | Cross-tenant rows indistinguishable from not-found | Missing / cross-tenant / denormalization-mismatch all collapse to `null` in `findOwnedImage` → `ImagingNotFoundError` uniformly (`public.ts:169-185`) | SATISFIED |
| G | Legal-hold atomic predicate intact | `redactForAnonymization`'s `updateMany` where-clause includes `study: { clinicId, legalHold: false }` (`public.ts:272-274`), not only an earlier in-memory check — TOCTOU-closed per F2-IMPL-001-A-R3 | SATISFIED |
| H | Port performs no authorization re-resolution | Doc comment + source: `clinicId` is treated as trusted, pre-validated input; no `resolveEffectiveClinicId`/JWT/session read anywhere in this file | SATISFIED |
| I | Port performs no audit/activity ownership relocation | No `writeAuditLog`/`logActivity` import or call anywhere in `public.ts` | SATISFIED |
| J | No unexpected production callers already exist | `grep -rn "services/imaging/public" server/src --include=*.ts`, excluding `/tests/`, returns zero matches (one unrelated code-comment hit in `imaging.ts:844` referencing the file by name, not importing it) | SATISFIED |

No drift found on any of the ten port-contract items. This confirms the Stage-1 facade
(`F2-IMPL-001-A`/R2/R3, merged) remains exactly as previously accepted.

---

## 4. Per-caller migration-readiness matrix

Independently inspected via full-file reads of the three Stage-3 caller files. Summary
table (full per-file detail in the delivery report); **all three files' live, HTTP-reachable
call paths have VALIDATED `clinicId` provenance** — every one traces to
`patientPrivacy.ts`'s `resolvePatient(patientId, user)` (§5 below), never a raw
`req.user.clinicId`, JWT default, body param, or query param.

| # | Caller : call site | Direct access today | Target port method | clinicId provenance | Classification | Notes |
|---|---|---|---|---|---|---|
| 1 | `patientAnonymization.ts:105` `imagingImage.findMany` (redaction scan) | Direct Prisma read | `getImagesForLifecycleReview` (id list only) | VALIDATED | MIGRATE_IN_STAGE_3 | Port DTO lacks `originalName`; not needed if redaction is delegated per-id to `redactForAnonymization`, which does its own idempotency check internally |
| 2 | `patientAnonymization.ts:120` `imagingImage.update` (redaction write) | Direct Prisma write, **unscoped by clinicId** (`{id: image.id}`) | `redactForAnonymization` | VALIDATED | MIGRATE_IN_STAGE_3 — requires adapter | Legal hold: current code **skips** and counts (`skippedLegalHold`); port **throws** `ImagingLegalHoldViolationError`. Migration must catch-and-count to preserve `RedactionCounters` shape (audited in `AuditLog.metadata.imagingResults`). Migrating also **closes** the pre-existing unscoped-write gap (a safety improvement, not a scope expansion) |
| 3 | `orphanFileInspection.ts:65` `imagingImage.findMany` (orphan scan) | Direct Prisma read, `take: BATCH_SIZE` (500) | `getImagesForLifecycleReview` | VALIDATED | MIGRATE_IN_STAGE_3 | Port has no `take` param; batching must move to caller (`.slice(0, 500)` after fetch — same ordering, same observable first-500 result, higher DB read cost for >500-image patients, acceptable) |
| 4 | `orphanFileInspection.ts:84` `fileExists(image.filePath)` | Direct `fileStorage.ts` call | `checkImageStorageExists` | VALIDATED (indirect, row already scoped at #3) | MIGRATE_IN_STAGE_3 — requires adapter | Port converts a provider throw to typed `ImagingStorageUnavailableError`; current code lets it propagate uncaught to the route's generic 500 handler. Migration must preserve the same ultimate HTTP outcome (catch the typed error, keep behavior equivalent) |
| 5 | `orphanFileInspection.ts:112-128` `markConfirmedMissing` (write) | Direct Prisma write, **no `clinicId` parameter at all**, unscoped `{id: entry.id}` | `markStorageMissing` | N/A — **zero production callers** (only `imagingCharacterizationTenantLifecycle.test.ts` calls it; not wired to any `patientPrivacy.ts` route) | **DEFERRED — not in this Stage-3 slice** | Real signature gap, but poses no live tenant risk today since it is unreachable via HTTP. Adding a `clinicId` param and wiring it to `markStorageMissing` is a small, separate, non-blocking follow-up — not required to authorize or begin Stage 3 |
| 6 | `deletionReviewInventory.ts:122` `imagingImage.findMany` (byte-size aggregation) | Direct Prisma read (needs `fileSize`, a DB column) | none — **DTO gap** | VALIDATED | **DEFERRED — not in this Stage-3 slice** | `ImagingLifecycleImageDto` does not expose `fileSize`. Migrating this read requires either extending the port DTO (a contract change, its own explicit decision, not authorized by this review) or leaving it direct. This review recommends leaving it direct for the initial migration slice |

**Cross-cutting confirmations:**
- `ANON_TEXT` (`patientAnonymization.ts:166`) and `REDACTED_PLACEHOLDER` (`public.ts:140`) are byte-identical (`'[ANONYMIZED]'`) — cross-path idempotency detection is safe.
- All three files' live call paths are **principal** callers (authenticated user via `authorize(PRIVACY_MANAGE_ROLES)`), never a system/background caller.
- No file uses `prisma.$transaction` for imaging writes — all are standalone, per-row try/catch calls; migrating introduces no transaction-semantics regression, consistent with the port's own stated no-cross-write-atomicity claim.
- No `prisma.imagingStudy`/`imagingRequest`/`imagingDevice` calls exist in any of the three files — only `imagingImage`, matching the port's scope exactly.

---

## 5. `patientPrivacy.ts` clinic-scope verification

`resolvePatient(patientId, user)` (`patientPrivacy.ts:64-81`) is the single choke point every
route uses before calling into the three privacy services:

```ts
const where = { id: patientId, organizationId: user.organizationId, deletedAt: null };
if (!user.canAccessAllClinics) where.clinicId = { in: user.allowedClinicIds };
return prisma.patient.findFirst({ where, select: { id, clinicId, isAnonymized } });
```

This is a scoped-lookup pattern (the Prisma predicate itself is org/clinic-constrained, not
a fetch-then-check), fail-closed (`null` → 404), and `organizationId`/`allowedClinicIds`
originate server-side from `authenticate()` (`server/src/middleware/auth.ts`) off a verified
JWT `sub`, never from request body/query/an unverified claim.

| Route → service → imaging predicate | Verdict |
|---|---|
| `POST /patients/:id/privacy/anonymize` → `anonymizePatientData` (re-validates clinicId+organizationId a second time, `patientAnonymization.ts:211-218`) → `redactPatientImagingImages` | **VALIDATED** |
| `GET /patients/:id/privacy/deletion-review` → `buildDeletionReviewInventory` | **VALIDATED** |
| `GET /patients/:id/privacy/orphan-check` → `inspectOrphans` | **VALIDATED** |

No path was found where a raw/unvalidated clinicId reaches any imaging predicate through
`patientPrivacy.ts`. The F2-PREP-009 claim that this chain was source-verified was
independently re-checked against current source (not trusted as-is) and **still holds, not
stale** — `resolvePatient()` is unchanged since F2-PREP-009 was written, and the
F2-OVL-01 imaging-ingest-convergence work (merged since) touched only the manual/bridge
*ingest* path, not these three privacy services.

`clinicScope.ts`'s four utilities (`resolveEffectiveClinicId`, `validateAndGetClinicIdScope`,
`getAccessibleClinicIds`, `buildClinicScopeWhere`) are not actually called by
`patientPrivacy.ts` — it uses its own equivalent `resolvePatient()` scoped-lookup instead,
which is the exact "equivalent already-access-scoped record lookup" carve-out `public.ts`'s
own doc comment names by function. All four `clinicScope.ts` utilities were independently
read and confirmed to be mandatory/fail-closed/no-wildcard in their own right, for
completeness, even though this call chain doesn't use them.

---

## 6. CT-05 / CT-23 / CT-30 — hard gate

All three independently re-run against a disposable PostgreSQL instance (not merely cited
from prior evidence or trusted from ClickUp task status).

| Test | File | My run | CI-wired | Assertion fidelity | Relevance to Stage 3 |
|---|---|---|---|---|---|
| **CT-05** | `imagingCharacterizationTenantLifecycle.test.ts` (legal-hold RBAC) | 5/5 pass | Yes — `server:test:disposable-db` → `ci-layers.yml` Layer 3 | Strong — asserts DB row untouched on every negative case, not just HTTP status | **Named precondition only** — tests a route (`legal-hold` RBAC), not the migration surface; `public.ts` explicitly excludes `legalHoldReason` handling from its Stage-1 slice |
| **CT-23** | `imagingCharacterizationTenantLifecycle.test.ts` + `imagingStudyRequestPatientConsistency.test.ts` + `detectImagingStudyRequestPatientMismatch.test.ts` | 2/2 + 12/12 + 7/7 pass | Yes, same CI path | Strong — reproduced cross-clinic/cross-org anomaly rows and a 25-round concurrency race | **Named precondition only** — remediation (PR #333, merged) independently reconfirmed present in current `imaging.ts:816-898` (atomic guarded `updateMany`, 409 on violation); but `LinkImagingStudy` is explicitly excluded from `public.ts`'s facade surface by design, so this test does not cover the migration surface itself |
| **CT-30** | `imagingCharacterizationTenantLifecycle.test.ts` (Privacy/KVKK direct-access baseline) | 7/7 pass | Yes, same CI path | Strong — exercises the real exported entrypoints of all three privacy services | **Directly relevant** — the explicit pre-migration behavioral baseline for the three caller files; confirms they still perform direct `prisma.imagingImage`/`imagingStudy` access today, matching this review's own §4 findings. This is a snapshot to diff a future migration against, not proof of facade-equivalence in itself |

No `.skip`, commented-out assertion, or reduced scope found in any of the three relative to
what the evidence docs claim. No prior ClickUp reference to `F2-CT-30-VERIFY` exists
anywhere in tracked repo files (`git grep` — zero matches); its status was not trusted and
was independently reproduced from source instead, per instruction.

**"Test exists" vs. "gate satisfied":** distinguished explicitly — all three have current,
CI-wired, independently-reproduced-passing executable evidence as of this baseline SHA, not
merely a historical claim.

---

## 7. Direct-access inventory (complete for Stage-3 scope)

Six call sites found across the three files (§4 table, columns 1–6) — all touch only
`prisma.imagingImage`; zero `imagingStudy`/`imagingRequest`/`imagingDevice` calls. One
direct file-storage call (`fileExists`, `orphanFileInspection.ts:84`). No calls found
outside the three named caller files that would expand this inventory.

---

## 8. Audit / KVKK assessment

| Question | Finding |
|---|---|
| AuditLog ownership | `patientAnonymization.ts` writes both `AuditLog` (`patient_anonymized`) and `ActivityLog` around imaging redaction (`imagingResults` counters embedded in metadata) |
| `orphanFileInspection.ts`/`deletionReviewInventory.ts` audit | **Neither writes any audit/activity log today** — confirmed by absence of `writeAuditLog`/`logActivity` imports in both files and in the deletion-review route handler. This asymmetry pre-exists Stage 3 and is not created by it |
| Duplicate audit risk from migration | None — the port itself performs zero audit/activity writes (confirmed §3 item I); migrating a caller onto it cannot introduce a duplicate |
| Removed audit risk from migration | None — caller-owned audit calls are untouched by delegating the underlying Prisma access to the port |
| Error-path audit change | None found — error handling in all three files remains caller-owned regardless of which layer performs the DB call |
| New PHI/PII into logs | None — the port's typed errors (`ImagingNotFoundError`, `ImagingLegalHoldViolationError`, `ImagingStorageUnavailableError`, `ImagingInvalidRedactionReasonError`) never carry a storage key, filename, or patient-identifying field |
| Storage metadata visibility | Unchanged — `checkImageStorageExists` returns only a boolean, same as today's `fileExists` |
| Legal-hold semantics | Preserved architecturally (write predicate re-checks `legalHold: false` atomically), but the **skip-vs-throw discrepancy** (§4 row 2) requires explicit adapter logic in the migrated caller to keep the externally observed behavior (counted skip) identical |

F2-IMG-AUDIT-001/002 (bridge-ingest audit asymmetries) are unrelated to this review's scope
and are not mixed into this decision, per instruction.

---

## 9. Schema/migration requirement

**None.** No Prisma schema or migration file is touched by this review, and none is
required by the recommended Stage-3 implementation shape — the port and its underlying
tables already exist.

---

## 10. Backward compatibility

Response shapes that must remain byte-identical post-migration (all confirmed as de facto
public contracts — returned directly as `res.json(...)` or persisted into `AuditLog`):

- `RedactionCounters` (`total/redacted/skippedLegalHold/failed`) and `partialFailure` derivation in the anonymize route.
- `OrphanCheckResult` (`checked/dbRowPhysicalMissing/activeLinkedObject/entries[]/dryRun`).
- `DeletionReviewInventory.imaging` (`total/legalHold/retainedClinical/estimatedBytes`) — unaffected since this call site is deferred (§4 row 6), not migrated in this slice.
- 404/409/500 error shapes and status codes at each route.
- The pre-existing `imaging.total === imaging.retainedClinical` asymmetry in `deletionReviewInventory.ts` (legal-hold rows aren't subtracted for imaging the way they are for attachments) — a pre-existing quirk, unrelated to the port, out of scope to fix here; any future migration touching this file must preserve it exactly or flag a fix as a separate, explicitly authorized change.

---

## 11. Rollback design

Standard for this program's facade pattern: revert the caller-migration commit(s), restoring
direct Prisma access in the three caller files; `ImagingLifecyclePort` itself (`public.ts`)
remains in place, unused by any other caller, exactly as it is today. No schema/migration
exists to roll back. No data migration occurs, so no data-repair step is needed on rollback.

---

## 12. Stage-3 entry-gate matrix

| # | Requirement | Repository evidence | Status | Blocking? | Notes |
|---|---|---|---|---|---|
| A | Stage 2 exit satisfied | §1 — CI run `31273018579` success on exact baseline SHA | SATISFIED | — | Re-verified independently, not assumed |
| B | CT-05 passing/current | §6 — 5/5, CI-wired | SATISFIED | — | Named precondition; indirect coverage of migration surface |
| C | CT-23 remediation present + passing | §6 — 2/2+12/12+7/7, remediation confirmed in current source | SATISFIED | — | Named precondition; `LinkImagingStudy` out of `public.ts` scope by design |
| D | CT-30 passing/current | §6 — 7/7, CI-wired | SATISFIED | — | Directly relevant — pre-migration baseline of the 3 callers |
| E | Port signature matches accepted explicit-clinicId contract | §3 | SATISFIED | — | No drift on any of 10 sub-checks |
| F | No zero-caller contract drift | §3 item J — 0 production importers | SATISFIED | — | |
| G | `patientAnonymization` has validated clinic context | §4, §5 | SATISFIED | — | |
| H | `orphanFileInspection` has validated clinic context | §4, §5 | SATISFIED | — | True for the live route (`inspectOrphans`); `markConfirmedMissing` has no live caller and is deferred (§4 row 5), not a gate failure |
| I | `deletionReviewInventory` has validated clinic context | §4, §5 | SATISFIED | — | |
| J | No raw JWT/default clinic scope introduced | §5 | SATISFIED | — | |
| K | No cross-tenant existence leakage | §3 item F, §4 | SATISFIED | — | Current write predicates in 2 of 3 callers are unscoped-by-clinicId but not exploitable (row already read scoped); migration onto the port closes this |
| L | Legal-hold invariant preserved | §3 item G, §8 | SATISFIED | — | Requires adapter logic (skip-vs-throw) in implementation, not a gate blocker |
| M | Audit ownership compatible | §8 | SATISFIED | — | |
| N | API compatibility feasible | §10 | SATISFIED | — | Contingent on preserving documented response shapes |
| O | No schema/migration required | §9 | SATISFIED | — | |
| P | Rollback feasible | §11 | SATISFIED | — | |
| Q | No unresolved security/KVKK blocker | §8, §4 | SATISFIED | — | |
| R | Direct-access inventory complete for Stage-3 scope | §7 | SATISFIED | — | 6 call sites classified; 2 deferred (DTO/signature gaps), not blockers — see §13 |

---

## 13. Accepted findings

1. Baseline SHA/CI match the assigning prompt exactly; no reconciliation needed.
2. Port contract (`public.ts`) is unchanged and drift-free against the accepted F2-PREP-009 signatures.
3. All three privacy callers' live, HTTP-reachable clinicId provenance is validated via `resolvePatient()`.
4. CT-05/CT-23/CT-30 all have current, independently-reproduced, CI-wired passing evidence.
5. Two real, non-blocking scope gaps exist and must be explicitly excluded from the initial migration slice, not silently discovered mid-implementation: `orphanFileInspection.ts`'s `markConfirmedMissing` (no `clinicId` param, zero production callers) and `deletionReviewInventory.ts`'s imaging read (needs `fileSize`, not in the port DTO).
6. `patientAnonymization.ts`'s legal-hold skip-vs-throw discrepancy against the port requires explicit adapter logic to preserve the current `RedactionCounters` contract — a required implementation detail, not a blocker.

## 14. Rejected/unverified claims

- None. No prior claim examined by this review (F2-PREP-009's clinic-scope claim; CT-30's ClickUp status; CT-23's remediation-still-present claim) was found stale or contradicted by current source — each was independently re-verified rather than trusted, per instruction, and each held.

---

## 15. Decision

```
STAGE_3_ENTRY_GATE = SATISFIED
AUTHORIZED_TO_BEGIN_STAGE_3_IMPLEMENTATION = TRUE
```

**Exact next task: `F2-STAGE3-IMPL-001` — Privacy/KVKK ImagingLifecyclePort Caller
Migration (initial slice).**

Recommended scope (smallest authorized shape, per §12 of the assigning brief — mechanical
migration only, no port contract broadening in this task):

1. `patientAnonymization.ts`: replace the direct `imagingImage.findMany`+`update` pair in
   `redactPatientImagingImages` with `getImagesForLifecycleReview(clinicId, patientId)` for
   the id list, then `redactForAnonymization(clinicId, imageId, 'anonymization')` per row,
   catching `ImagingLegalHoldViolationError` and mapping it to the existing
   `skippedLegalHold` counter (never letting it abort the per-row loop) — preserving
   `RedactionCounters`/`partialFailure`/audit-metadata shape exactly.
2. `orphanFileInspection.ts`'s `inspectOrphans`: replace the direct `imagingImage.findMany`
   with `getImagesForLifecycleReview(clinicId, patientId)`, truncating to `BATCH_SIZE` (500)
   client-side (same ordering, same first-N result); replace the direct `fileExists(filePath)`
   call with `checkImageStorageExists(clinicId, imageId)`, catching
   `ImagingStorageUnavailableError` and preserving the current propagate-to-generic-500
   behavior.
3. **Explicitly out of scope for this slice** (deferred, not authorized here):
   `orphanFileInspection.ts`'s `markConfirmedMissing` (needs a `clinicId` parameter added
   first — separate small follow-up, zero production urgency since it has no live caller)
   and `deletionReviewInventory.ts`'s imaging read (needs a port DTO extension — `fileSize`
   — its own explicit decision, not bundled into a mechanical caller migration).
4. No `public.ts` contract change. No schema/migration. No audit-behavior change. No route
   response-shape change.

This authorization does **not** extend to CI-blocking architecture-guardrail enforcement
(remains explicitly `NOT_AUTHORIZED`, unchanged by this review) and does not redefine or
broaden Stage 3 beyond §2 above.

---

## 16. Validation

```
git status --short   -> only the 2 pre-existing untracked files noted in §1; this task adds
                         one new file: docs/program/evidence/F2-STAGE3-AUTH-001_*.md
git diff --check     -> clean (no whitespace errors)
git diff --name-only -> (no tracked-file modifications from this review at time of writing;
                         CURRENT_PHASE.md / NORAMEDI_MASTER_TRACKER.md / F2_MODULAR_BOUNDARIES.md /
                         evidence/README.md updates, if applied, are additive documentation only)
git diff --stat      -> docs-only; no server/src, no src, no prisma schema/migration,
                         no .github/workflows, no package manifest, no guardrail
                         scanner/config/baseline file touched
```

Docs-only confirmed. No `server/src`, no Prisma schema/migration, no workflow, no package
manifest, no guardrail scanner/config/baseline file modified by this task.

---

## 17. Lifecycle status

`AGENT_COMPLETED` — tests reused/independently reproduced evidence (CT-05/CT-23/CT-30 all
re-run live against a disposable PostgreSQL instance by this task, not merely cited) —
`PR_OPENED` once opened — `NOT_MERGED` — `NOT_DEPLOYED` — `NOT_PRODUCTION_VERIFIED`. This
task performs no implementation, no commit beyond documentation, no merge, and claims no
deployment or production verification.

# KVKK-HIGH-006 Batch 2 — Financial/Inventory/Insurance Centralized Clinic-Scope Remediation

## 1. Task ID and phase

**Task ID:** KVKK-HIGH-006 Batch 2 (implementation) — of the 4-batch remediation plan defined by
[KVKK-HIGH-006-S2_REQ_USER_CLINIC_ID_OCCURRENCE_CLASSIFICATION.md](KVKK-HIGH-006-S2_REQ_USER_CLINIC_ID_OCCURRENCE_CLASSIFICATION.md) §21.
**Phase:** F0 — Baseline, Program Control, and Architecture Validation (parent task KVKK-HIGH-006, `STILL_OPEN`).

This document does not close KVKK-HIGH-006. Batch 1 (`reports.ts`, `appointmentRequests.ts`,
`dentalChart.ts`) is a separately tracked, not-yet-implemented task (`KVKK-HIGH-006-S3`); this
document covers **only** Batch 2 (`paymentPlans.ts`, `inventory.ts`, `insuranceProvisions.ts`), run
in its own isolated worktree/branch per this task's instructions, not bundled with Batch 1 or any
other KVKK/F0 work.

## 2. Baseline

- Fresh `git fetch origin --prune` + `git rev-parse origin/main` immediately before starting:
  `70ac5ed9d729783c7cda492b126b1f34d6b3ca77` (merge of PR #193).
- Worktree: `D:\Mustafa\Siteler\DisKlinikCRM-worktrees\kvkk-high006-batch2`
- Branch: `fix/kvkk-high006-batch2-financial-scope`, created from `origin/main` at the commit above
  (`git worktree add -b ... origin/main`) — no drift.
- **Primary-tree and other-worktree protection:** the primary tree
  (`D:\Mustafa\Siteler\DisKlinikCRM`) and all other existing worktrees were touched only with
  read-only `git`/`grep`/`Read` operations (status, log, show, worktree list) before this isolated
  worktree was created; nothing in any of them was modified.

## 3. Scope confirmation

Read before editing:
- [KVKK-HIGH-006-S2_REQ_USER_CLINIC_ID_OCCURRENCE_CLASSIFICATION.md](KVKK-HIGH-006-S2_REQ_USER_CLINIC_ID_OCCURRENCE_CLASSIFICATION.md)
  §21 Batch 2 (exported from `origin/main`, since it is not present in the primary tree's own
  branch — this is a merged, `origin/main`-resident document, not out-of-date).
- `CURRENT_PHASE.md`, `NORAMEDI_MASTER_TRACKER.md`, `RISK_REGISTER.md`,
  `phases/F0_BASELINE_AND_VALIDATION.md` (all exported from `origin/main` for the same reason).

Confirmed: KVKK-HIGH-006-S2 (PR #191) is `MERGED` (merge commit `548bcb7c81065fc71474fdff3632f4759528ffd3`).
R-071 is `OPEN`. Parent KVKK-HIGH-006 is `STILL_OPEN`. Batch 1 (KVKK-HIGH-006-S3) has **not** been
implemented yet — it remains the tracker's own named "exact next task," and the S2 document itself
recommends batches proceed sequentially ("Batches 2-4 follow as separate PRs once Batch 1's pattern
is validated in review"). This task proceeds with Batch 2 now, per this task's own explicit
instructions to run it in a separate, isolated worktree in parallel — Batch 2 touches an entirely
disjoint set of files from Batch 1 (`paymentPlans.ts`/`inventory.ts`/`insuranceProvisions.ts` vs.
`reports.ts`/`appointmentRequests.ts`/`dentalChart.ts`), so there is no merge-conflict or
sequencing risk between the two, and the record-derived-scope pattern being applied is the
codebase's own already-established, already-reviewed contract (`getAccessibleClinicIds`,
`resolveEffectiveClinicId`, `validateAndGetClinicIdScope` — see `server/src/utils/clinicScope.ts`),
not a novel pattern awaiting Batch 1's validation.

Batch 2 scope, exactly as classified by S2 §13/§21 and re-located in this worktree (line numbers
shifted slightly from S2's capture; no occurrence was missing or added):

| File | S2-classified occurrences (old lines) | Re-located lines (this worktree, pre-fix) |
|---|---|---|
| `paymentPlans.ts` | 104, 127, 196, 261 (detail, create, installment payment, cancel) | 104, 127, 196, 261 — **unchanged**, no drift |
| `inventory.ts` | 80, 105, 158, 193, 262 (detail, create, update, transaction create, transaction list) | 80, 105, 158, 193, 262 — **unchanged**, no drift |
| `insuranceProvisions.ts` | 55, 83, 107, 145, 193, 228 (list, detail, create, update, status, cancel) | 55, 83, 107, 145, 193, 228 — **unchanged**, no drift |

Total: **15** occurrences (4 + 5 + 6), matching the S2 document's Batch 2 definition exactly. No
additional occurrence was discovered in any of the three files during this task.

**Schema verification (per this task's own instruction to verify against current source, not a
stale index):** the S2 document's §21 note "none of `PaymentPlan`/`InventoryItem`/`InsuranceProvision`
carry `organizationId`" is **incorrect for `InventoryItem`** — `server/prisma/schema.prisma:1153-1178`
shows `InventoryItem.organizationId` is a real, non-nullable column ("Phase 1b: NOT NULL after
backfill"), which is exactly why `inventory.ts`'s pre-existing list/alerts routes already correctly
call `validateAndGetScope` (the `organizationId`-bearing-model helper), not
`validateAndGetClinicIdScope`. `PaymentPlan` (`schema.prisma:1010-1032`) and `InsuranceProvision`
(`schema.prisma:642-671`) have only `clinicId`, confirming the S2 document's claim for those two.
This discrepancy does not change the fix: the record-derived-mutation routes touched in this batch
resolve scope via `getAccessibleClinicIds` (a flat `clinicId` list, independent of whether the
target model also carries `organizationId`), and the two creation endpoints resolve via
`resolveEffectiveClinicId` (which validates the target clinic against the organization directly via
`Clinic.organizationId`, also independent of the target model's own columns) — both are the
already-accepted, model-agnostic contract for exactly this shape. `inventory.ts`'s existing
list/alerts routes (`validateAndGetScope`) were left untouched, as they were already correct and are
out of this batch's scope.

## 4. Files and occurrences changed

### `server/src/routes/paymentPlans.ts` (4 occurrences)

| Route | Before | After |
|---|---|---|
| `GET /payment-plans/:id` (detail) | `clinicId = req.user!.clinicId`; `findFirst({id, clinicId})` | `getAccessibleClinicIds(req.user!)` → 403 if empty → `findFirst({id, clinicId:{in:accessibleIds}}})` |
| `POST /payment-plans` (create) | `clinicId = req.user!.clinicId` | `resolveEffectiveClinicId(req.user!, req.body.clinicId)` → 403 if null; omitted body field falls back to the caller's own default clinic (backward compatible) |
| `POST /:id/installments/:installmentId/pay` (installment payment) | `clinicId = req.user!.clinicId`; `findFirst({id:planId, clinicId})` | `getAccessibleClinicIds` → lookup within scope → `const clinicId = plan.clinicId` used for the created `Payment` row and `logActivity` |
| `PATCH /:id/cancel` (cancel) | `clinicId = req.user!.clinicId`; `findFirst({id, clinicId})` | `getAccessibleClinicIds` → lookup within scope → `const clinicId = plan.clinicId` used for `logActivity` |

### `server/src/routes/inventory.ts` (5 occurrences)

| Route | Before | After |
|---|---|---|
| `GET /inventory/:id` (detail) | `clinicId = req.user!.clinicId`; `findFirst({id, clinicId})` | `getAccessibleClinicIds` → `findFirst({id, clinicId:{in:accessibleIds}}})` |
| `POST /inventory` (create) | `clinicId = req.user!.clinicId` | `resolveEffectiveClinicId(req.user!, req.body.clinicId)`; `organizationId` on create is unchanged (`req.user!.organizationId` — `resolveEffectiveClinicId` already validates the target clinic belongs to that same organization) |
| `PUT /inventory/:id` (update) | `clinicId = req.user!.clinicId`; `findFirst({id, clinicId})` | `getAccessibleClinicIds` → lookup within scope → `const clinicId = existing.clinicId` used for `logActivity` |
| `POST /:id/transactions` (transaction create) | `clinicId = req.user!.clinicId`; `findFirst({id, clinicId})` | `getAccessibleClinicIds` → lookup within scope → `const clinicId = item.clinicId` used for the created `InventoryTransaction`, the `treatmentCaseId` validation, and `logActivity`; stock math (`item.currentStock`) is read from the found item itself, unaffected |
| `GET /:id/transactions` (transaction list) | `clinicId = req.user!.clinicId`; `findFirst({id, clinicId})`; `findMany({itemId, clinicId})` | `getAccessibleClinicIds` → lookup within scope → transactions filtered by `item.clinicId` |

`inventory.ts`'s `GET /inventory` (list) and `GET /inventory/alerts` routes were **not modified** —
they already correctly used `validateAndGetScope` before this task and are out of Batch 2's scope.

### `server/src/routes/insuranceProvisions.ts` (6 occurrences)

This file imported **no** `clinicScope.ts` helper before this change (confirmed by S2 §13: "unlike
`messages.ts`, there is no partially-correct sibling route to contrast against"). Added:
`import { validateAndGetClinicIdScope, getAccessibleClinicIds, resolveEffectiveClinicId } from '../utils/clinicScope.js';`

| Route | Before | After |
|---|---|---|
| `GET /insurance-provisions` (list) | `clinicId = req.user!.clinicId`; `where = {clinicId}`; **no clinic selector existed at all** | Added `req.query.clinicId` selector; `validateAndGetClinicIdScope(req.user!, selectedClinicId, res)` → 403 if denied; `where = {...clinicScope}` (DENTIST doctor-scope `Object.assign` preserved unchanged) |
| `GET /insurance-provisions/:id` (detail) | `clinicId = req.user!.clinicId`; `where = {id, clinicId}` | `getAccessibleClinicIds` → `where = {id, clinicId:{in:accessibleIds}}` (DENTIST doctor-scope preserved) |
| `POST /insurance-provisions` (create) | `clinicId = req.user!.clinicId` | `resolveEffectiveClinicId(req.user!, req.body.clinicId)` → 403 if null |
| `PUT /insurance-provisions/:id` (update) | `clinicId = req.user!.clinicId`; `findFirst({id, clinicId})` | `getAccessibleClinicIds` → lookup within scope → `const clinicId = existing.clinicId` used for `validateInsuranceRelations` and `logActivity` |
| `PATCH /:id/status` (status) | `clinicId = req.user!.clinicId`; `findFirst({id, clinicId})` | `getAccessibleClinicIds` → lookup within scope → `const clinicId = existing.clinicId` used for `logActivity` |
| `PATCH /:id/cancel` (cancel) | `clinicId = req.user!.clinicId`; `findFirst({id, clinicId})` | `getAccessibleClinicIds` → lookup within scope → `const clinicId = existing.clinicId` used for `logActivity` |

## 5. Implementation pattern applied

Exactly the two accepted shapes named by this task's instructions and by `clinicScope.ts`'s own
documented contract (`server/src/utils/clinicScope.ts` §8 in the S2 evidence file):

- **List/create routes:** validate an optional `clinicId`/`'all'` selector (list) or an optional
  explicit target `clinicId` (create) via `validateAndGetClinicIdScope`/`resolveEffectiveClinicId`;
  an omitted selector preserves today's default-clinic behavior for existing callers.
- **Record-specific routes:** resolve the caller's full accessible-clinic set via
  `getAccessibleClinicIds`, look the record up **within** that set, then use the **found record's
  own `clinicId`** for every dependent read/write (created `Payment`/`InventoryTransaction` rows,
  `logActivity` attribution) — never re-deriving from `req.user.clinicId`. This exactly mirrors the
  already-established pattern in `server/src/routes/labOrders.ts` and
  `server/src/utils/relationGuards.ts`, which this task followed as precedent rather than inventing
  a new shape.

No shared helper (`clinicScope.ts`, `relationGuards.ts`), Prisma schema, or migration was touched —
only the three named route files and one new test file.

## 6. Requirements verification

- **Legitimate sibling-clinic operations succeed:** verified (test suite §7, "Allowed sibling
  clinic" cases across all three files — previously false-404/false-restriction, now succeed).
- **Unauthorized clinic access remains denied:** verified ("Denied unassigned clinic" cases — 404
  for record-derived routes, matching pre-existing 404 semantics; 403 for create/list routes with an
  explicit disallowed selector).
- **Cross-organization access remains denied:** verified (`getAccessibleClinicIds` is always
  computed from the caller's own `organizationId`; `resolveEffectiveClinicId`/
  `validateAndGetClinicIdScope` independently re-verify the target clinic's `organizationId` against
  the DB, exactly as in every other file already using these helpers).
- **Financial/inventory writes use the validated or record-owned clinic:** verified — created
  `PaymentPlan`/`InventoryItem`/`InsuranceProvision` rows use the `resolveEffectiveClinicId`-returned
  clinic; created `Payment`/`InventoryTransaction` rows and every `logActivity` call on a
  record-specific route use the **found record's own** `clinicId`.
- **Response shapes remain compatible:** no field added/removed/renamed on any response; the only
  new request-side surface is an optional `clinicId` body/query field on the two create routes and
  the insurance list route. For single-clinic users this is fully backward compatible (omitted →
  prior default-clinic behavior, unchanged). For `canAccessAllClinics` users on the
  `GET /insurance-provisions` list route specifically, omitting the selector is **not**
  byte-identical to before — see §11 for the precise behavior change and why it is intentional.

## 7. Tests

New file: `server/src/tests/kvkkHigh006Batch2ClinicScope.test.ts` (not committed to `package.json`'s
`test` script by this task — run directly per the command below, matching several existing
project test files that are not wired into the aggregate `npm test` script either).

**No live/disposable Postgres database was available in this task's environment** (no Docker
daemon reachable, no `psql` on `PATH`, no `server/.env` present). Per this task's own instruction to
use disposable/local data only, and following this codebase's own established precedent for this
exact class of fix (`server/src/tests/treatmentCaseClinicScope.test.ts`, and the "Clinic isolation"
section of `server/src/tests/labOrders.test.ts`), the test suite is a **synthetic, in-memory
simulation** — it inline-replicates the real `getAccessibleClinicIds`/`buildClinicIdScope`/
`resolveEffectiveClinicId` logic from `server/src/utils/clinicScope.ts` verbatim, and mirrors each
fixed route handler's exact lookup/write shape, against disposable synthetic fixtures (`clinic-A`/
`clinic-B` in `org-1`, `clinic-X` in `org-2`). It is **not** a live Express/Prisma integration test,
and this document does not claim it is one. A second part of the suite performs source-level
regression checks (reads the three actual route files and asserts, by exact substring, that no
`req.user!.clinicId` remains at the fixed call sites, and that the correct helper is present).

Required coverage (12 dimensions per S2 §22), all present in the new suite:

1. Single-clinic compatibility — unchanged.
2. Multi-clinic user, explicit allowed sibling clinic — succeeds (was the bug).
3. Multi-clinic user, disallowed clinic — denied (404 record-derived / 403 create+list).
4. OWNER/ORG_ADMIN all-clinic behavior — succeeds across every accessible clinic.
5. Cross-organization denial — verified for detail, create, and list routes.
6. Missing clinic selector — falls back to prior default-clinic behavior.
7. Invalid clinic selector (nonexistent id, and a real cross-org clinic id) — 403, not 500/silent success.
8. No clinic access (`allowedClinicIds: []`) — 403, not an empty-but-200 narrowing.
9. Record outside scope cannot be read or mutated — verified for detail, installment-pay, cancel,
   inventory transaction create, and insurance status change.
10. Created records use the validated clinic — verified for all three create routes.
11. Installment payment / cancellation / inventory transaction / insurance status writes use the
    record's own `clinicId` — verified explicitly (asserts the written clinic equals the sibling
    clinic the record actually lives in, not the caller's JWT default clinic).
12. Financial/stock totals do not include inaccessible clinics — verified for inventory stock
    visibility and the insurance list's `requestedAmount` total under an org-wide `'all'` selection
    (confirms the org-2 provision is excluded and the total reflects only the two org-1 provisions).

**Untested condition, verified by source inspection only:** the composition of the new
scope logic with the pre-existing DENTIST doctor-scope filter (`getInsuranceDoctorScope`,
`Object.assign`'d onto `where` in both `GET /insurance-provisions` and
`GET /insurance-provisions/:id`) for a DENTIST assigned to more than one clinic is not directly
exercised by any test in this suite or in the pre-existing regression suites re-run below. Source
inspection confirms the `Object.assign` call is preserved unconditionally on both routes and is
applied on top of (not in place of) the new clinic scope, so a multi-clinic DENTIST should see the
intersection of their doctor-scope and their accessible-clinic scope — but this composition has no
dedicated test coverage as of this document.

### Results

```
cd server && npx tsx src/tests/kvkkHigh006Batch2ClinicScope.test.ts
Toplam: 37 test | Geçen: 37 | Başarısız: 0
```

Targeted pre-existing suites re-run for regressions (none introduced by this change):

```
npx tsx src/tests/overdueReceivables.test.ts        → 12 passed, 0 failed
npx tsx src/tests/treatmentCaseClinicScope.test.ts  → 11/11 passed
npx tsx src/tests/multiBranchAccess.test.ts         → 142/142 passed
npx tsx src/tests/labOrders.test.ts                 → 32 passed, 0 failed
npx tsx src/tests/paymentValidation.test.ts         → 9/9 passed
npx tsx src/tests/paymentBillingEdit.test.ts        → 25/25 passed
```

**One pre-existing, unrelated failure found and NOT fixed by this task** (out of Batch 2's scope,
and the file is not one of the three named for this task):
`npx tsx src/tests/overdueInstallments.test.ts` → 7 passed, 2 failed. The failures are a mismatch
between `server/src/utils/overdueInstallments.ts`'s actual `overdueInstallmentWhere`/
`isInstallmentOverdue` implementation (which treats `status: {in: ['pending','overdue']}` as
overdue) and the test's expectation that only the literal string `'pending'` is used — confirmed,
by reading `server/prisma`-adjacent source directly from `origin/main` (not this branch), to be a
pre-existing discrepancy on `origin/main` itself, unrelated to and unmodified by this diff. Recorded
here for visibility; not remediated, since `overdueInstallments.ts` is not a Batch 2 file and this
task's forbidden-files list does not authorize touching it.

## 8. Typecheck

```
cd server && npm run typecheck   # npx prisma generate && tsc --noEmit
Exit code: 0 — no type errors.
```

(`npm install` was run once in this worktree to obtain `node_modules`/generate the Prisma client,
neither of which existed yet; the resulting incidental `package-lock.json` drift — an unrelated
`@aws-sdk/lib-storage` version-range formatting difference — was reverted with
`git checkout -- server/package-lock.json` before finishing, so the final diff contains no
dependency changes.)

## 9. Diff checks

```
git diff --check         → exit 0, no whitespace errors
git diff --stat
 server/src/routes/insuranceProvisions.ts | 41 +++++++++++++++++++++++---------
 server/src/routes/inventory.ts           | 36 +++++++++++++++++++---------
 server/src/routes/paymentPlans.ts        | 28 +++++++++++++++-------
 3 files changed, 75 insertions(+), 30 deletions(-)
git status --short
 M server/src/routes/insuranceProvisions.ts
 M server/src/routes/inventory.ts
 M server/src/routes/paymentPlans.ts
?? server/src/tests/kvkkHigh006Batch2ClinicScope.test.ts
?? docs/program/evidence/KVKK-HIGH-006-BATCH2_IMPLEMENTATION.md
```

## 10. Remaining occurrences

```
rg -n "req\.user(!|\?)?\.clinicId" server/src/routes/paymentPlans.ts server/src/routes/inventory.ts server/src/routes/insuranceProvisions.ts
→ no matches (exit 1)
```

**All 15 Batch 2 occurrences (4 + 5 + 6) are remediated. Zero remain.**

## 11. API / migration / frontend impact

- **API:** additive-only. Two new optional request fields: `clinicId` in the `POST /payment-plans`
  and `POST /inventory` request bodies, and `clinicId` (plus `'all'`) as a
  `GET /insurance-provisions` query parameter. No existing field, route, or response shape changed.
  Single-clinic users are behaviorally unchanged for every touched route, including
  `GET /insurance-provisions` with an omitted selector.
  One route's omitted-selector behavior is **not** byte-identical to before: on
  `GET /insurance-provisions`, a `canAccessAllClinics` caller (typically OWNER/ORG_ADMIN) who omits
  the `clinicId` query parameter now receives provisions across **all clinics in their authorized
  organization scope**, via `validateAndGetClinicIdScope`'s existing no-selector fallback, instead of
  only the single clinic on their JWT (the route's behavior before this task, for every role,
  regardless of `canAccessAllClinics`). This is an intentional corrective behavior alignment: it
  brings `GET /insurance-provisions` in line with the pre-existing, unmodified sibling list routes
  `GET /payment-plans` and `GET /inventory`, which already default `canAccessAllClinics` callers to
  their full authorized scope when no selector is supplied — `insuranceProvisions.ts` was simply the
  one file that had never been wired to the shared `clinicScope.ts` contract before this task. It is
  a widening of what a multi-clinic-capable role sees by default on this one route, not a security
  regression (the data returned is still bounded by the caller's own organization and access grants),
  and not a change for single-clinic staff.
- **Migration:** none. No Prisma schema, model, or migration file was touched.
- **Frontend:** none required for correctness. An optional clinic-selector UI affordance on the
  insurance-provisions list page would be needed to let a caller actually *exercise* the new `'all'`
  capability from the UI, but nothing breaks without it — this is a follow-on product decision, not
  authorized or implemented by this task.

## 12. Confirmation

- No shared tracker (`CURRENT_PHASE.md`, `NORAMEDI_MASTER_TRACKER.md`, `RISK_REGISTER.md`, phase
  docs) was modified by this task — only this new evidence file was created, per this task's
  explicit documentation restriction. R-071 remains `OPEN` (this document does not change its
  status).
- No forbidden file (`reports.ts`, `appointmentRequests.ts`, `dentalChart.ts`, `messages.ts`,
  `postTreatment.ts`, `services.ts`, `planLimits.ts`, `clinicScope.ts`, `relationGuards.ts`, Prisma
  schema, migrations, frontend) was touched.
- No shared-helper, schema, migration, frontend, or product decision was needed — the task
  completed using only the existing, already-accepted `clinicScope.ts` contract.
- **Nothing was committed, pushed, merged, or deployed. No pull request was opened. No production
  system was accessed.** All changes exist only as uncommitted working-tree edits in the isolated
  worktree `D:\Mustafa\Siteler\DisKlinikCRM-worktrees\kvkk-high006-batch2`
  (branch `fix/kvkk-high006-batch2-financial-scope`).

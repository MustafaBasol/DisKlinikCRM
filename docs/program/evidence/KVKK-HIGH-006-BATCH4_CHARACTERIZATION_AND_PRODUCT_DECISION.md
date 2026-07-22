# KVKK-HIGH-006 Batch 4 — Characterization and Product-Decision Preparation

**Reconciliation note (2026-07-22):** this document was originally written against `origin/main` baseline `70ac5ed9d729783c7cda492b126b1f34d6b3ca77`. Before publication it was reconciled against current `origin/main` (`0a5be5e4e77cea864ea785451acb1d05f184bc9a`, PRs #194-199) — including **PR #199**, the related Batch 4 target-clinic quota fix, which merged during this reconciliation — and against that fix's independent verification verdict of `PASS`. See **§16** for the full reconciliation. §1-15 below are preserved as originally written and remain accurate as characterization/classification evidence; §16 records what has changed since, including that the fix §8-9 recommended is now merged into `origin/main` (source-level only — DB-integration and production verification remain outstanding, KVKK-HIGH-006/R-071 remain OPEN).

## 1. Task identity

**Task:** KVKK-HIGH-006 Batch 4 — characterization and product-decision preparation for the middleware and safe/non-authoritative `req.user.clinicId` occurrences named in `docs/program/evidence/KVKK-HIGH-006-S2_REQ_USER_CLINIC_ID_OCCURRENCE_CLASSIFICATION.md` §21 ("Batch 4 — Middleware and safe/non-authoritative occurrences").

**Parent task:** KVKK-HIGH-006 — direct/inconsistent use of `req.user.clinicId` in runtime authorization/data-scope paths. Status before and after this document: **`STILL_OPEN`**. This document does not close, narrow, mitigate, or otherwise change KVKK-HIGH-006's status. It is a read-only characterization and product-decision-preparation deliverable for Batch 4 specifically.

**Predecessor evidence:** `KVKK-HIGH-006-S1` (`defaultClinicId` verification, `VERIFIED_NO_VIOLATION_FOUND`, unrelated/subordinate) and `KVKK-HIGH-006-S2` (occurrence classification and 4-batch remediation plan, PR #191, merged as `548bcb7`). This document re-verifies S2's Batch 4 classification directly against current source — it does not assume S2 remains accurate without re-checking.

**This is not an implementation task.** No runtime code was changed. The only new file besides this document is one disposable, non-wired characterization test (§9).

## 2. Baseline and worktree

- Fresh `git fetch origin` immediately before starting: `origin/main` = `70ac5ed9d729783c7cda492b126b1f34d6b3ca77`.
- Isolated worktree created from that exact commit:
  - Worktree: `D:\Mustafa\Siteler\DisKlinikCRM-worktrees\kvkk-high006-batch4-characterization`
  - Branch: `docs/kvkk-high006-batch4-characterization` (tracks `origin/main`)
  - `git rev-parse HEAD` in the worktree immediately after creation: `70ac5ed9d729783c7cda492b126b1f34d6b3ca77` — confirmed match, no drift.
- **Primary-tree protection:** the primary tree `D:\Mustafa\Siteler\DisKlinikCRM` was touched only with `git fetch`, `git worktree list`, `git status --short`, and `git branch --show-current`-equivalent read-only commands before the worktree was created. No file in the primary tree was read for editing, modified, staged, committed, stashed, reset, cleaned, checked out, or rebased.
- **Note on repository state observed (informational only, not acted upon):** a separate, pre-existing worktree (`D:\Mustafa\Siteler\DisKlinikCRM-worktrees\kvkk-high006-s3-batch1`, branch `fix/kvkk-high006-s3-batch1-scope-remediation`) was found with an **uncommitted** in-progress Batch 1 implementation (modified `server/package.json`, `appointmentRequests.ts`, `dentalChart.ts`, `reports.ts`, plus untracked new test files and an evidence draft). This worktree was not touched, read further, or modified in any way by this task — it is unrelated to Batch 4 and is recorded here only because its existence is relevant context for the program's overall KVKK-HIGH-006 status (Batch 1 implementation appears to be in progress separately, not yet committed/pushed/merged).
- **CodeGraph:** not run, per this task's explicit instruction.

## 3. Evidence classification

`REPOSITORY_DISCOVERY_AND_CALL_PATH_VERIFICATION` — static, read-only source and schema review, plus one disposable, non-wired characterization test executed locally (no database, no production access). No runtime code, schema, or migration file was changed.

## 4. Re-verification of S2's Batch 4 occurrence classification (no drift found)

Every line number and code shape claimed by S2 for Batch 4 was independently re-read against the current worktree source. **No source drift was found — S2's classification remains accurate as of `70ac5ed9`.**

| File | Line(s) | S2 classification | Re-verified this pass |
|---|---|---|---|
| `server/src/middleware/planLimits.ts` | 64 (`checkUserLimit`) | **H** — `AUTHORIZATION_CONSISTENCY_DEFECT`, live, reachable only when org has no plan | Confirmed identical code at line 64 |
| `server/src/middleware/planLimits.ts` | 86 (`checkPatientLimit`) | **H** — same shape | Confirmed identical code at line 86 |
| `server/src/middleware/planLimits.ts` | 65 (`checkUserLimit` else) | **E** — `DEAD_OR_UNREACHABLE` | Confirmed identical code at line 65 |
| `server/src/middleware/planLimits.ts` | 87 (`checkPatientLimit` else) | **E** — same | Confirmed identical code at line 87 |
| `server/src/middleware/planLimits.ts` | 119 (`requireFeature` else) | **E** — same | Confirmed identical code at line 119 |
| `server/src/routes/dashboard.ts` | 249 | **C** — `SAFE_NON_AUTHORIZATION_LOOKUP` (locale/timezone only) | Confirmed: feeds `getClinicOperatingPreferences`; the route's real scope gate is `validateAndGetScope` at line 37, independent of line 249 |
| `server/src/routes/organizationBranches.ts` | 668 | **B** — `SAFE_AUDIT_OR_LOG_ATTRIBUTION` | Confirmed: `logActivity(...)` call at line 667-674, strictly after the mutation's own authorization (`verifyClinicsBelongToOrg`, `allowedClinicIds` checks, transaction at lines 590-656) |
| `server/src/routes/organizationWhatsApp.ts` | 241, 406, 610, 680, 745, 850, 1070 | **B** — same, ×7 | Confirmed at all 7 line numbers: each is a `logActivity({clinicId: req.user!.clinicId, ...})` call immediately after an independently `organizationId`-scoped mutation |

`server/src/utils/activity.ts#logActivity` was re-read in full: it performs exactly one `prisma.activityLog.create(...)` and nothing else — it never appears in a `where` clause and never gates a read or write of business/patient data. This confirms the **B** classification is structurally correct, not just plausible.

## 5. Reachability proof

### 5.1 `planLimits.ts:64,86` — live, reachable

Schema fact, re-confirmed directly (`server/prisma/schema.prisma:1342-1343`):
```
model Organization {
  ...
  planId      String?
  plan        Plan?     @relation(fields: [planId], references: [id])
```
`Organization.planId`/`plan` is nullable. `getOrgLimits()` (`planLimits.ts:11-35`) contains `if (!org?.plan) return null;` (line 24) — an organization with no assigned plan is a **real, reachable data state**, not hypothetical. When it occurs, `checkUserLimit`/`checkPatientLimit` (lines 60-102) take the `?? (await getClinicLimits(req.user!.clinicId))` branch. **Confirmed live and reachable**, matching S2.

### 5.2 `planLimits.ts:65,87,119` — dead, genuinely unreachable

Schema fact, re-confirmed directly (`server/prisma/schema.prisma:125`):
```
model User {
  ...
  organizationId      String // Phase 1b: NOT NULL after backfill
```
`User.organizationId` is non-nullable. Tracing the value into the request object (`server/src/middleware/auth.ts`):
- `AuthRequest.user.organizationId` is typed `string` — **not** `string | undefined` (`auth.ts:96`).
- It is populated exactly once, from `dbUser.organizationId` (`auth.ts:186`), where `dbUser` is the result of `prisma.user.findUnique(...)` selecting the same non-nullable column (`auth.ts:44-60`).
- There is no code path between the DB read and `req.user` assignment that can null out or clear this field.

The `if (organizationId) { ... } else { ... }` branches at `planLimits.ts:63-65`, `84-87`, and `111-119` all require `organizationId` to be falsy to take the `else` path. Given the schema and type-level guarantee above, **this cannot occur under the current type/schema contract** — confirmed independently in this pass, not merely re-asserted from S2. (The only theoretical crack is a non-empty-but-empty-string `organizationId` — TypeScript's `string` type does not forbid `""` — but no code path constructs or would allow an empty-string `organizationId` for an authenticated user: the value always originates from an existing `Organization`'s database-generated id. This is noted for completeness, not treated as a live path.)

**Removing the three dead branches would not change runtime behavior** for any request that can currently reach these middlewares, because they are provably never entered. It would only remove otherwise-unreachable code — a cosmetic/dead-code-elimination change, not a KVKK-relevant fix. This is **not required** and is explicitly out of scope for this document (no runtime code was changed).

**Additional, independent confirmation found in this pass (not present in S2):** `requireFeature` (whose else-branch is line 119) is **not currently mounted on any route in the codebase**. A repository-wide search (`grep -rn "requireFeature(" server/src`) returns exactly one hit besides the function's own `export const requireFeature = (feature: string) => {` definition line: a code comment in `server/src/services/sms/smsEntitlement.ts:8` that references it by name for contrast, not a call site. No `router.*` call anywhere applies `requireFeature(...)` as middleware today. This means line 119 is unreachable for **two independent reasons**: (a) the type/schema argument above, and (b) the entire function it lives in currently has zero live callers. This strengthens, and does not contradict, S2's "dead" classification.

## 6. Current behavior — quota-target attribution under an explicit creation target

This is the substantive finding this document adds beyond S2's classification: **tracing exactly which clinic's quota is checked when a creation request explicitly targets a clinic different from the requester's own resolved default.**

- `checkUserLimit`/`checkPatientLimit` are mounted as Express **middleware**, ahead of the route handler, on exactly two routes:
  - `POST /api/users` (`server/src/routes/users.ts:137`)
  - `POST /api/patients` (`server/src/routes/patients.ts:280`)
- In both routes, the **actual creation-target clinic** is resolved **inside the handler, after the middleware has already run**:
  ```
  // users.ts:138
  const clinicId = await resolveEffectiveClinicId(req.user!, req.query.clinicId as string | undefined);
  ```
  ```
  // patients.ts:282
  const clinicId = await resolveEffectiveClinicId(req.user!, req.query.clinicId as string | undefined);
  ```
- `resolveEffectiveClinicId` (`server/src/utils/clinicScope.ts:147-167`) resolves `requestedClinicId ?? user.clinicId`, then validates the result against the organization and the user's `allowedClinicIds`/`canAccessAllClinics`. **This is the correct, validated creation-target clinic.**
- But `checkUserLimit`/`checkPatientLimit` (the middleware, running earlier) only ever see `req.user!.clinicId` — the requester's own single, static, resolved default clinic (documented in `auth.ts:93` as *"defaultClinicId — sadece UI varsayılanı, yetkilendirme değil"*, i.e. "UI default only, not authorization"). The middleware has **no access** to `req.query.clinicId` at the point it runs its quota check, and does not read it.

**Consequence, precisely stated:** when (a) the organization has no assigned plan (§5.1's reachable state), **and** (b) the requester explicitly targets a clinic other than their own resolved default via `?clinicId=`, the quota check evaluates the **requester's own clinic's** `maxUsers`/`userCount` (or `maxPatients`/`patientCount`), not the **actual target clinic's**. This can fail in **either direction**:
- **False allow:** requester's own clinic is under quota, but the real target clinic is at/over quota → creation proceeds in the target clinic despite it being full.
- **False block:** requester's own clinic is at/over quota, but the real target clinic has room → creation is wrongly rejected (`402`) for a target clinic that could legitimately accept it.

This was confirmed concretely by the characterization test in §9 (not merely reasoned about statically).

## 7. Answers to the required questions

**Q: Under what exact schema/runtime condition can the no-plan-organization fallback execute?**
A: `Organization.planId` is `NULL` (equivalently, `Organization.plan` resolves to `null`) for the requester's organization at the time `checkUserLimit`/`checkPatientLimit` runs. This is possible for any organization that has not (yet, or ever) had a plan assigned — nothing in the schema or application code prevents this state; `getOrgLimits()` explicitly returns `null` for it (`planLimits.ts:24`). Whether any organization is *currently* in this state in production is unknown — this document does not have production access to check, and does not claim an answer either way.

**Q: Which clinic should quota enforcement target under the five listed scenarios?**
A: In every scenario, the **only** clinic-resolution logic already accepted as correct elsewhere in this codebase is `resolveEffectiveClinicId` (`clinicScope.ts:147-167`) — the same function the route handlers already call for the actual creation. Applying its semantics to the quota question:
  - **One clinic (single-clinic user):** target = that one clinic. No ambiguity; today's fallback happens to match, because `req.user!.clinicId` and the eventual `resolveEffectiveClinicId` result are the same value when no explicit `?clinicId=` is supplied.
  - **Multiple allowed clinics, no explicit target:** target = `req.user!.clinicId` (the resolved default) — matches `resolveEffectiveClinicId`'s own fallback (`requestedClinicId ?? user.clinicId`). Today's fallback is correct here too.
  - **`canAccessAllClinics=true`, no explicit target:** same as above — `resolveEffectiveClinicId` still falls back to `user.clinicId` when no `requestedClinicId` is given, so today's behavior matches, even for org-wide-access users.
  - **Explicit target clinic supplied (`?clinicId=`):** target = the validated `requestedClinicId`, **not** `req.user!.clinicId`. **This is the one scenario where today's fallback is wrong** — it checks the requester's own clinic instead of the explicit target (§6).
  - **No clinic explicitly supplied:** target = `req.user!.clinicId` — matches today's fallback in every case above.

  **Summary: today's fallback is correct in 4 of 5 scenarios and wrong in exactly one — when a creation request explicitly targets a clinic other than the requester's own default.**

**Q: Is current fallback behavior intentional, access-narrowing, or incorrect quota attribution?**
A: **Incorrect quota attribution**, not access-narrowing and not (as far as this review found) intentional. It is not access-narrowing in the sense used elsewhere in KVKK-HIGH-006 (where the defect always denies a legitimately-accessible clinic) — here the defect can go either way (§6: false-allow or false-block), which is a different failure shape than every other occurrence in this program's inventory. No comment, test, or design note anywhere in the reviewed files documents this as a deliberate choice; it reads as an incidental consequence of `checkUserLimit`/`checkPatientLimit` being wired as pre-handler middleware, before the handler's own clinic-resolution step exists to be read from.

**Q: Are the three allegedly dead branches genuinely unreachable?**
A: Yes, confirmed independently in this pass (§5.2), via both the schema/type-contract argument (identical to S2's) and a newly-found second, independent reason for line 119 specifically (`requireFeature` has zero live call sites today).

**Q: Would removing dead branches change runtime behavior?**
A: No. See §5.2 — this is explicitly not proposed or done here.

**Q: Which safe audit-attribution occurrences should remain unchanged?**
A: All 9: `dashboard.ts:249`, `organizationBranches.ts:668`, and `organizationWhatsApp.ts:241,406,610,680,745,850,1070`. None gates a read or write of business/patient data (§4); the only theoretical improvement available for the 8 `B`-classified occurrences (not the 1 `C`) is an optional, non-blocking audit-fidelity refinement (stamping `ActivityLog.clinicId` with the affected clinic rather than the actor's own, for the subset of these mutations that affect a different or multiple clinics) — explicitly optional and non-KVKK-HIGH-006-blocking per S2, unchanged by this document.

**Q: Is a code change required, or should existing behavior be formally accepted?**
A: See §8 (product decision options). This document does not decide; it is recorded as still requiring a product decision, consistent with S2's own instruction not to change plan-limit semantics without one.

**Q: What exact characterization tests would prove current behavior?**
A: See §9 — a disposable, non-database test file was written and executed, proving (a) the no-plan fallback fires exactly when `Organization.plan` is absent, (b) the dead-branch shape if it were ever entered, and (c) the quota-target mismatch under an explicit cross-clinic creation target.

**Q: What product decision options exist, with consequences and a recommendation?**
A: See §8.

## 8. Product decision options

| # | Option | What changes | Consequences | Cost/risk |
|---|---|---|---|---|
| **1** | **Accept as-is** — formally record the current fallback behavior as a known, low-severity limitation; no code change. | Nothing. | Risk remains exactly as described in §6 (bidirectional false-allow/false-block), but **only** for organizations with no assigned plan **and** only when a multi-clinic-authorized user explicitly targets a non-default sibling clinic for creation — a narrow, compound precondition. Whether any production organization is currently in the no-plan state is unverified (out of scope here). | None. Zero engineering effort. |
| **2** | **Redirect the quota check to the actual creation-target clinic** — resolve the target clinic (via the existing `resolveEffectiveClinicId`) before running the quota check, and pass that resolved clinic id into the quota check instead of `req.user!.clinicId`. Requires restructuring `checkUserLimit`/`checkPatientLimit` from pre-handler Express middleware into a function called from inside the handler, after `resolveEffectiveClinicId` runs (or equivalently, having the middleware itself read and validate `req.query.clinicId` the same way). | Quota is always checked against the clinic the record will actually be created in. For the overwhelming majority of callers (single-clinic users, or multi-clinic users who never pass an explicit `?clinicId=`), `req.user!.clinicId` and the resolved target are already identical today, so **behavior is unchanged for them** — this is additive-only for the one scenario it fixes. | Small, isolated code change in 2 files (`planLimits.ts`, plus call-site restructuring in `users.ts`/`patients.ts`); no schema/migration. Larger diff than a simple helper swap (Batches 1-3's pattern) because it changes *where* the check runs, not just *what* it reads. |
| **3** | **Remove the clinic-level fallback entirely** — treat a no-plan organization as a hard configuration error; reject with an explicit error (e.g. `403`/`409` "organization has no plan assigned") instead of silently falling back to clinic-level counts. | Simplest code (delete the fallback, keep only the `getOrgLimits` path). | **Narrows** currently-working behavior for any organization that is *currently* relying on the no-plan fallback to create users/patients (if any exist in production — unverified, unverifiable from this task's scope). Must not be adopted without a prior production check confirming no organization currently depends on it. |
| **4** | **Instrument first, decide later** — keep current behavior unchanged, but this option is a process step, not a competing design: run a one-time, read-only production/staging query (`SELECT count(*) FROM "Organization" WHERE "planId" IS NULL`) to establish whether the no-plan state is reachable in practice today, **before** committing to Option 2 or Option 3. | Nothing changes in code. | None — this is a prerequisite fact-finding step, explicitly out of this task's authorized scope (no production access permitted here). |

## 9. Recommended option

**Recommend Option 2** (redirect the quota check to the actual creation-target clinic), **gated on Option 4's production check as a prerequisite**, not as an alternative to it.

Reasoning:
- Option 2 is the only option that actually fixes the defect identified in §6 (incorrect quota attribution) without any risk of narrowing currently-legitimate access — it is strictly additive: every caller who never passes an explicit cross-clinic `?clinicId=` sees byte-identical behavior before and after.
- Option 3 fixes the same defect by elimination, but carries real risk of breaking a currently-working path if any production organization has no plan assigned — that risk is unknown, not zero, and this task is not authorized to check it.
- Option 1 (accept as-is) is a reasonable **interim** position — the precondition for the defect to matter is narrow (no-plan org **and** explicit cross-clinic targeting) — but it is not a substitute for eventually fixing a genuine, if narrow, quota-attribution defect once the underlying data state is confirmed reachable.
- Option 4 is not a fourth alternative but the necessary first step before either Option 2 or Option 3 can be responsibly scoped as an implementation task — this document surfaces it as the literal next action for whoever picks up the product decision, consistent with this task's own instruction not to propose changing plan-limit behavior without confirming organization-plan semantics first.

**If the product owner instead prefers to simply accept Option 1 outright** (e.g., because no-plan organizations are known by the business to not exist or not matter), that is an equally defensible, lower-effort closure path for Batch 4 — this document does not have the business context to rule it out, only the technical facts to inform the choice.

## 10. Tests executed

One disposable, non-database, non-wired characterization test was written and executed as part of this task:

- **File:** `server/src/tests/planLimitsNoPlanFallbackCharacterization.test.ts`
- **Convention followed:** mirrors the existing codebase convention already established in `server/src/tests/dashboard.test.ts` (inline-mirroring the exact conditional logic of the file under review with mock data, rather than importing the real module — `planLimits.ts` opens a live `pg` connection pool at import time via `server/src/db.js`, so importing it directly would require a live database, which this task does not have access to and is not authorized to use).
- **Does not alter runtime behavior:** confirmed via `git status --short` in the worktree — the only change versus `origin/main` is this one new, untracked file. `planLimits.ts` itself was not modified.
- **Not wired into `package.json`'s aggregated `test` script** — intentionally left as a standalone characterization artifact, not a CI regression gate, since Batch 4 has no approved fix yet to guard.
- **Run command:** `cd server && npx tsx src/tests/planLimitsNoPlanFallbackCharacterization.test.ts`
- **Result (executed during this task, captured verbatim):**
  ```
  planLimits.ts:64,86 — no-plan-organization fallback reachability
    ✓ org WITH an assigned plan → org-level limits used, clinic fallback never invoked
    ✓ org WITHOUT an assigned plan (Organization.planId=null) → clinic-level fallback fires
    ✓ falsy organizationId (dead branch per schema) → same clinic-lookup shape, but unreachable in practice

  planLimits.ts:64,86 — quota-target mismatch under an explicit creation target
    ✓ requester default clinic differs from the explicit creation-target clinic → quota checks the WRONG clinic today

  planLimits.ts:119 — requireFeature else-branch (dead + currently unwired)
    ✓ requireFeature is not mounted on any route today (repo-wide search found zero call sites besides its own definition and a code comment)

  5 passed, 0 failed
  ```
- **What this proves:** the exact branch-selection behavior described in §5-6, reproduced against disposable local fixtures — not a claim about production data, which was neither accessed nor required for this characterization.

**Additional tests proposed, not executed** (would require either a disposable local Postgres database or an authorized staging environment, out of this task's scope):
1. End-to-end `POST /api/users`/`POST /api/patients` against a disposable database with a no-plan organization, a requester whose default clinic is under quota, and an explicit `?clinicId=` target clinic that is at quota — confirming the false-allow direction end-to-end (not just at the middleware-logic level, as §9's test does).
2. Same setup inverted (requester's default clinic at quota, target clinic under quota) — confirming the false-block direction.
3. Single-clinic user, no-plan org, no explicit target — confirming unchanged (correct) behavior, as a regression guard once/if Option 2 is implemented.
4. `canAccessAllClinics=true` user, no-plan org, no explicit target — confirming the org-wide-access fallback still resolves to the requester's own clinic today (matches §7's stated 4-of-5-scenarios-correct finding).

## 11. Implementation scope if a fix is later approved

Scope is **not authorized by this document** — recorded here only so a future, separately-authorized implementation task does not need to re-derive it:

- **If Option 2 is approved:** modify `server/src/middleware/planLimits.ts` (`checkUserLimit`, `checkPatientLimit`) to accept an explicit target `clinicId` parameter instead of reading `req.user!.clinicId` directly, and modify `server/src/routes/users.ts:137-138` and `server/src/routes/patients.ts:280-282` to resolve the target clinic via `resolveEffectiveClinicId` **before** invoking the quota check (either by converting the quota check from Express middleware into a plain async function called from inside the handler, or by having the middleware itself read and validate `req.query.clinicId`, duplicating `resolveEffectiveClinicId`'s validation). No schema/migration required. Additive-only for all existing callers per §8's reasoning. Requires the 4 proposed tests in §10 (at minimum) executed against a disposable database, plus the general 12-case test plan already established in S2 §22 adapted to this narrower quota-check surface.
- **If Option 3 is approved:** replace the `?? (await getClinicLimits(...))` fallback in both functions with an explicit rejection branch; requires the Option 4 production check to have run first and returned zero no-plan organizations (or an accepted migration plan for any that exist) before merge.
- **If Option 1 is formally accepted:** no code change; this document, once acknowledged by the product owner, becomes the recorded risk-acceptance evidence. The three dead branches (§5.2) may optionally be deleted for code clarity in the same or a separate trivial cleanup PR — this has zero KVKK relevance and zero runtime effect either way.
- In every option, `dashboard.ts:249`, `organizationBranches.ts:668`, and `organizationWhatsApp.ts` (7 occurrences) require **no change** (§7).

## 12. Risk impact

- **Severity:** Low. Blast radius is broad (every `POST /api/users` and `POST /api/patients` request passes through the affected middleware), but the *consequence* is quota-enforcement accuracy only — never data exposure, never cross-organization access, never a confidentiality issue.
- **Tenant-isolation / cross-organization risk:** none. `resolveEffectiveClinicId` and `getClinicLimits` both operate only on clinics already validated as belonging to the requester's own organization; nothing in this defect allows access to another organization's data or quota state.
- **Preconditions required for the defect to manifest at all:** (a) the requester's organization has no assigned plan (`Organization.planId IS NULL` — reachable per schema, prevalence in production unverified by this task), **and** (b) the requester explicitly supplies a `?clinicId=` query parameter naming a clinic other than their own resolved default. Both must hold simultaneously; this is a narrow, compound precondition, not a general-purpose defect.
- **Direction of failure:** bidirectional (§6) — can either wrongly permit creation past a target clinic's quota, or wrongly reject a legitimate creation in an under-quota target clinic. Neither direction is a security defect; both are functional-correctness defects in quota bookkeeping.
- **No I (tenant-isolation) or J (cross-organization) classification applies** — consistent with S2's finding that no occurrence anywhere in the KVKK-HIGH-006 inventory demonstrates either.

## 13. Explicit statement

**No runtime code was changed by this document or this task.** `server/src/middleware/planLimits.ts`, `server/src/routes/dashboard.ts`, `server/src/routes/organizationBranches.ts`, and `server/src/routes/organizationWhatsApp.ts` on **this branch** are byte-identical to their state at baseline commit `70ac5ed9d729783c7cda492b126b1f34d6b3ca77` — this document neither modified them then nor modifies them now. **[Updated 2026-07-22, §16.3]:** `planLimits.ts`, `users.ts`, and `patients.ts` on `origin/main` itself have since changed, via the separately-merged PR #199 — not via this document or this branch; see §16.2-16.3 for the full detail and why this does not contradict the "no runtime code changed **by this document**" claim. The only filesystem change introduced by this task is this evidence document; a disposable, non-database, non-CI-wired characterization test file (`server/src/tests/planLimitsNoPlanFallbackCharacterization.test.ts`) was written and executed locally as evidence for §10 but is **not** part of this document-only commit/PR (documentation-only scope). No schema or migration file was touched. No production system was accessed. This document was committed and pushed on its existing branch and opened as a documentation-only pull request against `main` — see §16.5 for details; this does not change the "no runtime code changed by this document" statement above. KVKK-HIGH-006 (the parent task) and R-071 (`RISK_REGISTER.md`) remain exactly as they were before this document — **`STILL_OPEN`** — and neither is closed, narrowed, or reduced in scope by this characterization, by PR #199, or by this document's publication.

## 14. Status separation

- Discovery/re-verification completed: **yes** (§4-5).
- Characterization completed: **yes** (§6-7, §9).
- Product decision made: **no** — this document prepares the decision, it does not make it (§8-9 present a recommendation, not a ruling).
- Code changed: **no** (§13).
- Tests run: **yes** — one disposable characterization test (§10); no database or production tests.
- Docs written: **yes** — this file only. No shared tracker file (`NORAMEDI_MASTER_TRACKER.md`, `KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md`, `RISK_REGISTER.md`, `CURRENT_PHASE.md`) was modified, per this task's explicit instruction.
- Committed: **[Updated 2026-07-22] yes** — this document only (documentation-only scope; the disposable characterization test in §10 was not committed).
- Pushed: **[Updated 2026-07-22] yes** — existing branch `docs/kvkk-high006-batch4-characterization`.
- PR opened: **[Updated 2026-07-22] yes** — documentation-only PR against `main`; see §16. Not merged.
- Production verified: **not applicable** — no production access was in scope or used, at any point including publication.

## 15. Exact next step

The next action is a **product/business decision** (§8), not an engineering task: choose Option 1 (accept as-is), or authorize Option 4 (a one-time, read-only production check of `Organization.planId IS NULL` prevalence) as the gate before scoping Option 2 or Option 3 for implementation. Until that decision is recorded, Batch 4's `planLimits.ts` component of KVKK-HIGH-006 remains open and unimplemented, exactly as S2 left it.

**[Reconciled 2026-07-22 — see §16]:** a separate, not-yet-merged implementation task has since built and independently verified (`PASS`) an Option 2-shaped fix. This supersedes the "remains ... unimplemented" statement above as a description of *all* effort on Batch 4 — implementation and source-level verification now exist on that other branch — but the formal product-decision record, Express/Prisma/disposable-PostgreSQL integration verification, and any production verification remain outstanding, and neither KVKK-HIGH-006 nor R-071 is closed by this. See §16 for the complete, current picture.

## 16. Reconciliation update — 2026-07-22 (documentation-only publication pass)

This section reconciles §1-15 (written and completed against baseline `70ac5ed9d729783c7cda492b126b1f34d6b3ca77`) against current `origin/main` and against new information about a related implementation effort, immediately before this document was committed and opened as a documentation-only PR. §1-15 are otherwise unmodified.

**This reconciliation was itself performed in two passes, because `origin/main` moved between them — recorded here rather than silently overwritten, per this program's established convention of layered reconciliation notes.**

### 16.1 Baseline reconciliation

- Fresh `git fetch origin --prune` immediately before the first reconciliation pass showed `origin/main` = `4712870fbf9b1cc1dee582fb8981648c482014ad` (PR #198's own merge commit). A second `git fetch origin --prune`, run immediately before committing/pushing this document, showed `origin/main` had advanced again to `0a5be5e4e77cea864ea785451acb1d05f184bc9a` (PR #199's own merge commit). **`0a5be5e4e77cea864ea785451acb1d05f184bc9a` is the current, authoritative `origin/main` used for everything below** — this supersedes the `4712870` figure as merely an intermediate observation.
- `git merge-base HEAD origin/main` = `HEAD` (this branch's tip, `70ac5ed9`) — i.e., this branch is a strict, unmodified ancestor of current `origin/main`. There is no divergence and nothing to reconcile at the merge-conflict level; the branch is simply stale, not in conflict.
- `git log --oneline HEAD..origin/main` shows 6 merged PRs since this branch's baseline:
  - **#194** — Batch 1 clinic-scope centralization (`appointmentRequests.ts`, `dentalChart.ts`)
  - **#195** — Batch 2 financial clinic-scope centralization (`insuranceProvisions.ts`, `inventory.ts`, `paymentPlans.ts`, `postTreatment.ts`, `services.ts`)
  - **#196** — Batch 3 messaging clinic-scope centralization (`messages.ts`, `reports.ts`)
  - **#197** — R-061 authenticated verification package (KVKK-HIGH-008-adjacent; unrelated to KVKK-HIGH-006/Batch 4)
  - **#198** — messages record-scope reconciliation (`messages.ts`)
  - **#199** (`fix/kvkk-high006-batch4-target-clinic`) — **this is the related Batch 4 target-clinic quota fix itself**, merged into `origin/main` between this reconciliation's two fetches. See §16.2.
- `git diff --stat 4712870 origin/main -- server/src` isolates PR #199's own contribution: exactly `server/src/middleware/planLimits.ts`, `server/src/routes/patients.ts`, `server/src/routes/users.ts`, and a new test file `server/src/tests/planLimitsTargetClinicFix.test.ts`. `git diff --stat HEAD 4712870 -- server/src` (i.e., #194-198 only, excluding #199) confirms those five PRs touched only `appointmentRequests.ts`, `dentalChart.ts`, `insuranceProvisions.ts`, `inventory.ts`, `messages.ts`, `paymentPlans.ts`, `postTreatment.ts`, `reports.ts`, `services.ts`, plus their test files — **none of the files this document's §4-7 findings depend on.**
- **Conclusion: PRs #194-198 do not touch, and therefore do not invalidate, any conclusion in §4-9.** PR #199 *does* touch the exact files this document's §6 defect and §8-9 recommendation are about — by design, since #199 is the implementation of that recommendation (§16.2). This branch itself still contains no runtime code change and was not merged with `origin/main`, consistent with this remaining a non-overlapping, documentation-only PR: this document adds one new file under `docs/program/evidence/`, which does not conflict with any file PR #199 touched.

### 16.2 The related Batch 4 target-clinic implementation — now merged (PR #199)

Since this characterization was completed, a related implementation task built the Option 2 direction recommended in §9 for `checkUserLimit`/`checkPatientLimit`, on branch `fix/kvkk-high006-batch4-target-clinic`, merged into `origin/main` as **PR #199** (merge commit `0a5be5e4e77cea864ea785451acb1d05f184bc9a`) — i.e., **this implementation is now part of `origin/main`, not a separate unmerged branch.** It resolves the requested target clinic via the existing `resolveEffectiveClinicId` **before** quota evaluation (instead of after, as the defect in §6 described), stores the resolved value on `req.targetClinicId`, and both `POST /api/users` and `POST /api/patients` now read that stored value instead of re-resolving it.

This document independently re-read PR #199's diff (`git diff 4712870 origin/main -- server/src/middleware/planLimits.ts server/src/routes/users.ts server/src/routes/patients.ts`) as part of this reconciliation and confirms the diff's shape matches the description below — this is not solely a restated third-party claim.

That implementation separately received an **independent verification verdict of `PASS`**, reporting the following conclusions:

- `checkUserLimit` and `checkPatientLimit` resolve the requested target clinic before quota evaluation.
- Invalid, inaccessible, and cross-organization targets are rejected before creation.
- The resolved target is stored in `req.targetClinicId` and reused by `POST /api/users` and `POST /api/patients`.
- No-selector, single-clinic, and assigned-plan-organization behavior remain unchanged — consistent with §7's "correct in 4 of 5 scenarios" finding; this is the one scenario (§7, §9) the fix targets.
- The no-plan fallback now evaluates quota against the real target clinic, closing the gap described in §6.
- Both the false-allow and false-block directions identified in §6 are reported fixed.
- The remaining raw `req.user.clinicId` occurrence in `requireFeature` (§5.2, line 119) remains dead/unwired and is confirmed to remain **intentionally outside** that implementation's scope — consistent with, and not contradicting, this document's own §5.2/§7 classification of that branch as genuinely unreachable and non-KVKK-relevant.

**Test evidence, distinguished by kind (this distinction is load-bearing — do not conflate the two rows):**

| Kind | Evidence | Status |
|---|---|---|
| Source-level / simulation (no live DB, no running Express server) | `planLimitsTargetClinicFix.test.ts` — 11 passed, 0 failed; `test:roles` — 142 passed, 0 failed; `test:billing-patient-access` — 18 passed, 0 failed; `test:staff-onboarding` — 15 passed, 0 failed; `test:user-import-onboarding` — 10 passed, 0 failed; `typecheck` — clean | **Executed and passing**, reported by the independent verification |
| Express + Prisma + disposable-PostgreSQL integration, exercising the four DB-backed route scenarios this document proposed in §10 (end-to-end `POST /api/users`/`POST /api/patients`: false-allow direction, false-block direction, single-clinic-user unchanged-behavior regression guard, `canAccessAllClinics=true` unchanged-behavior regression guard) | **Not yet executed** |
| Staging or production verification | **Not executed** — out of scope for both this document and the related implementation task |

The source-level/simulation results are real, passing assertions against real logic — the same evidentiary category as this document's own §9-10 characterization test — but they do not exercise a live database, a running Express server, or Prisma's actual query generation. The four DB-backed route tests originally proposed in §10 remain the concrete, named gap between "source-verified" and "integration-verified" for this fix.

### 16.3 What did and did not change

- **This branch/worktree still contains no runtime code change.** This document is the only committed change on this branch. `git status --short` in this worktree, immediately before commit, showed only this document plus the disposable, non-committed characterization test named in §10; that test file was deliberately **not** committed (documentation-only scope).
- **`origin/main` itself now differs from the `70ac5ed9` baseline in exactly the way §6 asked for.** Direct re-read of `server/src/middleware/planLimits.ts`, `server/src/routes/users.ts`, and `server/src/routes/patients.ts` at current `origin/main` (`0a5be5e4`) confirms they now match PR #199's diff (§16.2) — `checkUserLimit`/`checkPatientLimit` resolve and validate `req.targetClinicId` before quota evaluation, and both POST routes reuse it. **On `origin/main`, the defect described in §6 is fixed; on this docs branch (still at the `70ac5ed9` baseline), it is not** — the two are expected to diverge on that file only because this is a documentation-only branch that was never intended to carry the fix itself, not because of any conflict or omission.
- `dashboard.ts:249`, `organizationBranches.ts:668`, and `organizationWhatsApp.ts` (7 occurrences) are unaffected by PR #199 (confirmed: not in its file list, §16.1) — the §4/§7 conclusion that these 9 occurrences require no change is unaffected.
- **KVKK-HIGH-006 (parent task) remains `STILL_OPEN`.** A merged source-level fix for one sub-component (Batch 4's quota-attribution defect) does not close the parent task, which spans all 4 batches and the full occurrence inventory in `KVKK-HIGH-006-S2`.
- **R-071 (`docs/program/RISK_REGISTER.md`) remains `OPEN`.** Neither this document nor PR #199 closes, narrows, or formally mitigates it on the record — updating `RISK_REGISTER.md` itself is explicitly out of this document's scope. The DB-backed integration tests (§16.2 table) and any production verification remain unexecuted preconditions for treating this component as verified end-to-end, independent of the source-level fix already being merged.
- **No production access, production deployment, or production verification occurred** for this reconciliation pass, for the original characterization (§1-15), or (as far as this document's sourcing extends) for PR #199.

### 16.4 Product-decision status

PR #199's shape matches this document's own §9 recommendation (Option 2) exactly, and its reported source-level test results are consistent with §6-7's technical analysis; this document's independent re-read of the diff (§16.2) corroborates that match directly, not merely by restating a third-party claim. §8's option table and §9's recommendation remain the operative record of *why* Option 2 is the correct direction, and that record is unchanged by this reconciliation — if anything, it is now corroborated by a merged, independently-verified implementation. This document does not thereby declare KVKK-HIGH-006/Batch 4 fully closed on the record: executing the four DB-backed integration tests named in §10/§16.2, and any eventual production verification, remain outstanding, separately-authorized steps that this document does not perform.

### 16.5 Publication record

- Branch: `docs/kvkk-high006-batch4-characterization` (pre-existing; not created or renamed by this pass).
- Committed: this document only (documentation-only scope), on the branch named above. The exact commit SHA and PR number/URL are recorded in that branch's git history and in the pull request opened against `main` from it, rather than restated here to avoid a self-referential edit loop.
- Pushed: yes, to the existing branch's remote tracking ref.
- Pull request: opened against `main`, documentation-only, not merged.
- Scope of the commit: exactly this file. No runtime, test, schema/migration, frontend, shared-tracker (`CURRENT_PHASE.md`, `NORAMEDI_MASTER_TRACKER.md`, `RISK_REGISTER.md`), or deployment-configuration file was committed alongside it.

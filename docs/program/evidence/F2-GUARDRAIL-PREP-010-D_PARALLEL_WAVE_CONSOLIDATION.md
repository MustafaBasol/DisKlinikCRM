# F2-GUARDRAIL-PREP-010-D — Parallel Wave Consolidation and Guardrail Enforcement Authorization

**Phase:** F2 — Modular Boundaries, Guardrails, Entitlements, and Feature Flags
**Type:** Documentation, evidence reconciliation, and program-control only. No ESLint boundary, CI guardrail, runtime module restructuring, security fix, new service, migration, or production behavior change is made by this task.
**Task status:** `AGENT_COMPLETED` / `DOCUMENTATION_VALIDATION_PASSED` / `PR_OPENED` — `NOT_MERGED` / `NOT_DEPLOYED` / `NOT_PRODUCTION_VERIFIED`.

## 1. Baseline

- Primary working tree (`E:\Ek Gelir\Siteler\DisKlinikCRM-git`) was on an unrelated, heavily-staged branch (`claude/treatment-proposal-pdf-p1-d4k0jl`, HEAD `71ed59e9e85a37785e56257a3f3a947b436a3def`) with substantial in-progress uncommitted/staged work belonging to other tasks (treatment-proposal-pdf, inventory-unit-conversion, imaging-characterization). This tree was never modified, reset, stashed, cleaned, or read beyond `git status`/`git log`.
- This task executed in a fresh, isolated worktree: `E:\Ek Gelir\Siteler\DisKlinikCRM-worktrees\f2-guardrail-prep-010-d-consolidation`, branch `docs/f2-guardrail-prep-010-d-consolidation`, created directly from freshly-fetched `origin/main` @ `c731e7af9a552dde2da45fee52fa318192da28f8` — confirmed via `git fetch origin --prune` + `git rev-parse origin/main` at task start, no drift.
- `c731e7af9a552dde2da45fee52fa318192da28f8` independently confirmed to be PR #304's own merge commit: `gh pr view 304` → `mergeCommit.oid == c731e7af9a552dde2da45fee52fa318192da28f8`, `mergedAt: 2026-08-03T17:47:49Z`, `state: MERGED`. `git merge-base --is-ancestor` confirms it is an ancestor of (in fact equal to the tip of) `origin/main`.
- Post-merge main CI independently re-verified: `gh run view 30838364039` → `headSha` exact match, `workflowName: ci-main-and-nightly`, `event: push`, `status: completed`, `conclusion: success`.
- No CodeGraph invocation was necessary or performed — this task is documentation reconciliation over already-known evidence-file paths and a small, targeted set of source files (`server/src/services/imaging/public.ts`, `server/src/routes/instagramInbox.ts`, `server/src/routes/whatsapp.ts`, `server/src/index.ts`), all located via `Grep`/`Read`, not a repository-wide scan.

## 2. PR head verification (independent, not trusted from the assigning prompt)

| PR | Head (prompt-supplied) | Head (verified via `gh pr view`) | Match | State | Base | `mergeable` | `mergeStateStatus` |
|---|---|---|---|---|---|---|---|
| #304 | `56be3e324f27f9f9ee125f6fbda1b2d386a2b554` | `56be3e324f27f9f9ee125f6fbda1b2d386a2b554` | exact | `MERGED` | `main` | n/a | n/a |
| #313 | `2f38424a26c5f0bee7ca731352cfcbe5ef74c4a7` | `2f38424a26c5f0bee7ca731352cfcbe5ef74c4a7` | exact | `OPEN` | `main` | `MERGEABLE` | `CLEAN` |
| #315 | `d14a75fc9c491b310f7b946af4b309a78f3bd8b9` | `d14a75fc9c491b310f7b946af4b309a78f3bd8b9` | exact | `OPEN` | `main` | `MERGEABLE` | `CLEAN` |
| #314 | `f1408546040eaa5fa7ddd5833a28b097ea15e3a5` | `f1408546040eaa5fa7ddd5833a28b097ea15e3a5` | exact | `OPEN` | `main` | `MERGEABLE` | `CLEAN` |

All three evidence-wave PRs already had a matching local worktree/branch pre-existing in this environment, checked out at their exact stated heads — read directly, never modified:
- `E:\Ek Gelir\Siteler\DisKlinikCRM-worktrees\f2-guardrail-prep-010-a-cross-domain-inventory` (PR #313)
- `E:\Ek Gelir\Siteler\DisKlinikCRM-worktrees\f2-guardrail-prep-010-b-tenant-scope-inventory` (PR #315)
- `E:\Ek Gelir\Siteler\f2-guardrail-prep-010-c-wt` (PR #314)

CI and review-thread status independently pulled live (not read from any branch's own self-reported prose):

| PR | `gh pr checks` | Run | Review threads (`gh api graphql reviewThreads`) |
|---|---|---|---|
| #313 | 9/9 `pass` | `30834243419` | 4/4 `isResolved:true` |
| #315 | 9/9 `pass` | `30835217833` | 2/2 `isResolved:true` |
| #314 | 9/9 `pass` | `30834413566` | 0 threads |

## 3. Evidence reconciliation table

| Evidence item | Source | Current-main conflict/drift | Verdict | Target doc(s) | Wording applied |
|---|---|---|---|---|---|
| PR #304 merge state | PR #304 | Prior program docs (`CURRENT_PHASE.md` R3 entry) still read "Merged: no" | Stale — corrected | All 4 shared docs | `MERGED` / `MAIN_CI_PASSED` / `NOT_DEPLOYED` / `NOT_PRODUCTION_VERIFIED` |
| `ImagingLifecyclePort` accepted signatures | PR #304 / `public.ts` | None — verified in merged source | Accepted, verified | `CURRENT_PHASE.md` | Signatures + legal-hold predicate quoted verbatim from source |
| 71 cross-domain edges, 12/7/5/1/10/36 | PR #313 | None on PR #313's own baseline; not yet on `main` | Verified branch evidence, not merged | All 4 shared docs | `VERIFIED_BRANCH_EVIDENCE` / `AWAITING_CONSOLIDATION` |
| Frozen exact-edge tuple `(callerPath, callerSymbol, ownerDomain, targetModelOrSymbol, accessKind)` | PR #313 | None | Accepted, adopted unchanged | `CURRENT_PHASE.md`, phase doc | No fields invented beyond the five verified |
| 127 tenant-scope records, F2-SEC-001/002 | PR #315 | None on PR #315's own baseline | Verified branch evidence + independently re-confirmed against live `main` source | All 4 shared docs | `VERIFIED_BRANCH_EVIDENCE`; security defects marked `CONFIRMED_PRESENT_ON_MAIN` |
| 7 candidates / 3 selected / CAND-07 | PR #314 | CAND-07's own classification (`REJECTED_AS_REFERENCE`) is pinned to a pre-R2 PR #304 head, now stale relative to merged R3 | Reclassification decision made by this consolidation | All 4 shared docs | `STRENGTHENED_REFERENCE_BASE`, not canonical |
| F2 phase-summary row (`NORAMEDI_MASTER_TRACKER.md` §4) | Tracker | Row read `TODO`, dated 2026-07-17 — materially stale (already flagged by REPO-HYGIENE-001-P6) | Corrected | `NORAMEDI_MASTER_TRACKER.md` §4 | `PREPARATION_IN_PROGRESS`, dated 2026-08-03 |

## 4. Security findings (independently verified against `origin/main` @ `c731e7af9a552dde2da45fee52fa318192da28f8`)

**F2-SEC-001 — Enforce Clinic Membership on Instagram Inbox Status Mutation.** `server/src/routes/instagramInbox.ts`, `PATCH /instagram/inbox/:id/status`: the handler's `findFirst`/`update` calls scope only by `organizationId`; no `allowedClinicIds`/`getAccessibleClinicIds` clinic-membership check is present, unlike the same file's own sibling `/assign-clinic` handler, which does perform that check. Consequence: any authenticated user in the organization can mutate the status of, and read full unredacted fields (`lastMessageText`, `senderUsername`, `externalSenderId`, `patientId` — no `select` narrowing) of, an Instagram inbox entry belonging to a clinic they are not a member of.

**F2-SEC-002 — Remove Global Default-Clinic Resolution from Legacy WhatsApp Public API.** `server/src/routes/whatsapp.ts`'s `getDefaultClinic()` (`prisma.clinic.findFirst({ orderBy: { createdAt: 'asc' } })`) is called directly by all 6 routes mounted at `/api/public/whatsapp/*` (`server/src/index.ts:183`), gated only by a single global `WHATSAPP_WEBHOOK_SECRET` — no clinic or organization identity is resolved per request at all; every caller with the shared secret is served against the single oldest clinic in the entire database.

Both are classified `CONFIRMED_PRESENT` on current `main`, independent of PR #315's own prose, by direct source read performed by this task.

## 5. Validation performed

1. `git diff --check` — clean, no whitespace-conflict markers, across all changed files.
2. Grepped all four changed shared documents plus the new consolidation evidence file for: `F2-SEC-001`, `F2-SEC-002`, `Instagram`, `WhatsApp` — every occurrence is mutually consistent (SEC-001↔Instagram, SEC-002↔WhatsApp); zero reversed/duplicated/ambiguous references.
3. Grepped for stale PR #304 status tokens (`POST_MERGE_MAIN_CI_PENDING`, `MAIN_CI_PENDING`, `not merged`, `merge pending`) in the newly-added text of this task's own edits — none present; all newly-authored text states `MERGED`/`MAIN_CI_PASSED` for PR #304.
4. Grepped newly-authored text for accidental authorization language (`canonical`, `approved architecture`, `implementation authorized`, `allowlist`, `wildcard`, `bypass`) — every occurrence found is a negation or scoped caveat (e.g. "NOT approved as canonical," "not authorization for... a new edge," "no wildcard... bypass value"), never an unqualified grant.
5. No dedicated `docs/program` validation script exists in this repository (confirmed: no `package.json` script matching `docs`/`tracker`/`evidence` validation, no `scripts/docs-validate*` file). Fallback used: `git diff --check` (item 1) plus the targeted `Grep` passes above (items 2-4), matching this program's own established documentation-only validation convention (see e.g. F2-PREP-005/F2-PREP-006-E evidence).
6. No repository check was unexpectedly escalated to a broader CI profile by these changes — only `docs/program/**` files were touched; no workflow file, package manifest, or CI-trigger-relevant path was modified.

The full backend test suite was not run — not required by repository policy for a documentation-only change, and explicitly out of this task's scope.

## 6. Files changed by this task

- `docs/program/CURRENT_PHASE.md`
- `docs/program/NORAMEDI_MASTER_TRACKER.md`
- `docs/program/phases/F2_MODULAR_BOUNDARIES.md`
- `docs/program/evidence/README.md`
- `docs/program/evidence/F2-GUARDRAIL-PREP-010-D_PARALLEL_WAVE_CONSOLIDATION.md` (this file, new)
- `docs/program/evidence/F2-GUARDRAIL-PREP-010-D_parallel_wave_consolidation.json` (new)

No application, schema, migration, test, workflow, package, ESLint, or dependency-cruiser file was touched. No file belonging to PR #313, #314, #315, or any other branch was written to — all three were only read from their pre-existing local worktrees.

## 7. Rollback

Documentation-only. Rollback is a single revert of this task's own commit/PR. No migration rollback, no runtime rollback, no data rollback, no deployment rollback applies — none was performed or is implied by this task.

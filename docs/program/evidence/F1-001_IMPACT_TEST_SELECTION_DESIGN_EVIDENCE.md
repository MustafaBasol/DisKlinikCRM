# F1-001 — Impact-Based Test-Selection Design: Process and Validation Evidence

Task: F1-001 — Impact-Based Test-Selection Architecture and Test-Scope Classification. Phase: F1 — CI and Test Architecture. Type: documentation/design/evidence-only — no runtime, test, CI, schema, migration, dependency, or deployment file touched (verified in §5 below).

## 1. Baseline and repository-path note

The task instructions supplied a primary-repository path (`D:\Mustafa\Siteler\DisKlinikCRM`) that does not exist in this execution environment. This environment's actual repository is `E:\Ek Gelir\Siteler\DisKlinikCRM-git` (confirmed by the session's own environment metadata and by `E:\Ek Gelir\Siteler\` already containing a sibling `DisKlinikCRM-worktrees\` directory matching the instructions' expected structure, just on a different drive/path). This is a path-template mismatch, not a history-divergence or safety issue, so the equivalent real path was substituted and the substitution is recorded here rather than silently assumed. `VERIFIED_GIT`.

- Initial expected baseline (F0-014/PR #235 merge commit): `3b078370156dd606b983ccbe95fc55210c1231db`.
- `git fetch origin --prune` (primary repo) → no new refs printed (already current).
- `git rev-parse origin/main` → `d03116368e6c55cfa87ff1e35b95c485f7ff240d` — **advanced** from the expected baseline.
- `git merge-base --is-ancestor 3b078370156dd606b983ccbe95fc55210c1231db origin/main` → exit `0` (ancestor confirmed). `VERIFIED_GIT`.
- `git log --oneline 3b07837..origin/main` → 7 intervening commits: `d031163` (merge PR #239), `8f2d920`, `af7a9b8`, `487ffa4` (HTTP log privacy hardening — PR #239), `cadc078` (KVKK final reconciliation, docs), `f6677f4` (booking post-booking-state fix, PR #237), `f1cb150` (WhatsApp booking-flow log redaction, PR #234).
- `git diff --stat 3b07837..origin/main`: 14 files changed — `server/package.json` (+6/-1, two new named test scripts appended to the existing flat `test` chain), `server/src/index.ts`, four `server/src/services/whatsapp*.ts`/`whatsappBookingFlow.ts`/`whatsappStepAwareNlu.ts` files, four new `server/src/tests/*.test.ts` files, `server/src/utils/{logRedaction,logger}.ts`, two new evidence markdown files. **No `.github/workflows/**` change, no root `package.json` change.** `VERIFIED_GIT` + `VERIFIED_REPOSITORY`.
- Determination: ordinary forward progression (KVKK/WhatsApp logging hardening and one booking-flow fix), no CI/module-boundary/public-contract change requiring this design's inventory to be revised before starting. This advancement is independently reflected in the design document itself (§0, scenario SC-06 cites the exact same commits).
- Primary-tree safety: `git status --short` in the primary repo returned clean (no output) at task start; the task instructions' warning about a possible stray untracked file did not materialize as anything requiring caution — nothing was opened, read, diffed, moved, deleted, stashed, cleaned, staged, or committed in the primary tree beyond the read-only startup checks themselves.
- Primary tree branch at task start: `feature/kvkk-crit-003-security-incident-foundation` (an active KVKK branch) — not checked out, not modified, not touched beyond `git branch --show-current`/`git status`.
- `git worktree list` (primary repo) showed 6 active worktrees at task start, including `DisKlinikCRM-http-log-privacy-closeout` (branch `docs/http-log-privacy-production-closeout`, at `d031163`, i.e. current `origin/main` tip) and `DisKlinikCRM-worktrees/{f0-001-program-tracker,f0-002-baseline}`. None was opened, read, or modified by this task. `OBSERVED_LOCAL_ONLY`.

## 2. Isolated worktree

- Branch: `docs/f1-001-impact-test-selection-architecture`.
- Worktree path (substituted, see §1): `E:\Ek Gelir\Siteler\DisKlinikCRM-worktrees\f1-001-impact-test-selection`.
- Created via `git worktree add <path> -b docs/f1-001-impact-test-selection-architecture origin/main`.
- `git rev-parse HEAD` immediately after creation → `d03116368e6c55cfa87ff1e35b95c485f7ff240d` (matches `origin/main` exactly — this is the **execution baseline** for this task). `git status --short` → clean. `VERIFIED_GIT`.
- No KVKK branch was checked out in this worktree at any point; no other worktree's files were opened, read, or modified; no rebase, no force-push, no cherry-pick, no `--ours`/`--theirs` conflict resolution was performed.

## 3. Required document reading

Read fully or in targeted, cited sections (grep-then-read for the three largest files, per this task's own instruction not to blindly scan huge documents): `NORAMEDI_MASTER_TRACKER.md` (270KB — targeted sections around F1-001/G1/G2/R-046/R-071/ADR mentions), `CURRENT_PHASE.md` (121KB — targeted "Aktif F1 görevi" section), `phases/F1_CI_AND_TEST_ARCHITECTURE.md` (11KB, full), `DEPENDENCY_MAP.md` (20KB, full), `TEST_OWNERSHIP.md` (18KB, full), `MODULE_MAP.md` (13KB, full), `ARCHITECTURE_DECISIONS.md` (27KB, full), `RISK_REGISTER.md` (144KB — targeted sections per risk category), `RELEASE_GATES.md` (13KB, full), `LAUNCH_GATES.md` (63KB — targeted "test"/"CI"/"G1"/"G2" sections), `KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md` (24KB, full), `evidence/README.md` (5.7KB, full), `evidence/F0-014_G0_APPROVAL_F0_CLOSURE_F1_TRANSITION.md` (16KB, full), `AGENTS.md` (repo root, full). Also read: `server/package.json` (test-script inventory), `docs/program/evidence/F0-005_TEST_INVENTORY_AND_RUNTIME_EVIDENCE.md` (full), and sampled (schema + targeted grep, not full reads) `F0-003_module_ownership_inventory.json` (75KB), `F0-004_dependency_inventory.json` (984KB), `F0-005_test_inventory.json` (204KB). No file listed in this task's instructions was skipped. `VERIFIED_REPOSITORY`.

**Findings recorded, not acted on:** (a) F1-001's own program-doc entries (tracker §6/§13, `CURRENT_PHASE.md`, the phase document) are internally consistent with each other and with `RELEASE_GATES.md`/`ARCHITECTURE_DECISIONS.md`/`KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md` — no status contradiction found. (b) `AGENTS.md` is a generic MVP-scope product document with no reference to the `docs/program/` phase-gate apparatus; this design followed `docs/program/evidence/README.md`'s own conventions for process matters, not `AGENTS.md`, since the two operate at different altitudes and do not conflict. (c) The F0-005 evidence-staleness gap described in §0 of the design document.

## 4. CodeGraph usage

`ToolSearch` was queried for a CodeGraph tool before starting targeted inspection; **no matching tool was found in this environment.** Per this task's own required fallback, no broad replacement scan was performed. Instead, targeted `Grep`/`Read`/directory-listing inspection was used against `server/src/routes/`, `server/src/services/`, `server/src/utils/`, `server/src/tests/`, and `src/services|pages|components`, for the representative domains named in this task's instructions (auth, clinic/tenant scope, patient, appointment, payments, WhatsApp/messaging, privacy/KVKK, storage/attachments, audit, AI, imaging). This inspection confirmed: `server/src/routes/` (57 files, flat, one-per-domain-noun), `server/src/services/` (flat plus domain subfolders for `appointments/`, `communicationConsent/`, `imaging/`, `instagram/`, `labOrders/`, `privacy/`, `security/`, `sms/`, `whatsapp/`), `server/src/utils/` (34 flat cross-cutting files), `server/src/tests/` (96 files today vs. 72 at the F0-005 evidence baseline — the staleness gap recorded in §0/R-072), and the frontend's single shared `src/services/api.ts` client plus 52 top-level `src/pages/` entries and 46 top-level `src/components/` entries including two new co-located `*.vitest.test.tsx` files. Each result directly supports a specific design-document claim: the flat-npm-script test-invocation pattern (§0, confidence model), the domain-subfolder pattern (module-domain inventory in the classification JSON), and the file-count staleness figures (§0, R-072). `OBSERVED_LOCAL_ONLY` for the directory listings themselves; `VERIFIED_REPOSITORY` for anything cross-checked against F0-003/F0-004/F0-005.

## 5. Files changed by this task

1. `docs/program/architecture/F1-001_IMPACT_BASED_TEST_SELECTION_ARCHITECTURE.md` (new)
2. `docs/program/architecture/evidence/f1-001-test-scope-classification.json` (new)
3. `docs/program/architecture/evidence/f1-001-impact-selection-rules.json` (new)
4. `docs/program/evidence/F1-001_IMPACT_TEST_SELECTION_DESIGN_EVIDENCE.md` (new, this file)
5. `docs/program/phases/F1_CI_AND_TEST_ARCHITECTURE.md` (updated — F1-001 status, change history)
6. `docs/program/NORAMEDI_MASTER_TRACKER.md` (updated — top entry, §6/§7/§13)
7. `docs/program/CURRENT_PHASE.md` (updated — active-task status/dependency)
8. `docs/program/evidence/README.md` (updated — one new index row)
9. `docs/program/RISK_REGISTER.md` (updated — new row **R-072**, evidence-staleness risk discovered by this task; a real newly-discovered risk, not an activity edit)

No `.github/workflows/**`, `package.json`, `package-lock.json`, test file, Prisma schema, migration, Docker/deployment file, environment file, or KVKK implementation file is in this list. Confirmed by `git diff --name-only origin/main...HEAD` (§6) matching this exact list, nothing more.

## 6. Validation commands and results

```
$ git diff --check
(no output — no whitespace/conflict-marker errors)

$ git status --short
(clean except the 9 files listed in §5, all in the allowed-changes list)

$ git diff --name-only origin/main...HEAD
docs/program/CURRENT_PHASE.md
docs/program/NORAMEDI_MASTER_TRACKER.md
docs/program/RISK_REGISTER.md
docs/program/architecture/F1-001_IMPACT_BASED_TEST_SELECTION_ARCHITECTURE.md
docs/program/architecture/evidence/f1-001-impact-selection-rules.json
docs/program/architecture/evidence/f1-001-test-scope-classification.json
docs/program/evidence/F1-001_IMPACT_TEST_SELECTION_DESIGN_EVIDENCE.md
docs/program/evidence/README.md
docs/program/phases/F1_CI_AND_TEST_ARCHITECTURE.md

$ git diff --name-only origin/main...HEAD | grep -E "\.github/workflows|package\.json|package-lock\.json|schema\.prisma|migrations|server/src|^src/"
(no output — zero matches, confirmed no prohibited path touched)

$ node -e "JSON.parse(require('fs').readFileSync('docs/program/architecture/evidence/f1-001-test-scope-classification.json','utf8')); console.log('classification valid')"
classification valid

$ node -e "JSON.parse(require('fs').readFileSync('docs/program/architecture/evidence/f1-001-impact-selection-rules.json','utf8')); console.log('rules valid')"
rules valid
```

(Exact `git diff --stat` and `git grep` status-consistency output recorded in the delivery report accompanying this PR, not duplicated here.) No repository-native documentation validator (markdown linter, doc-schema checker) was found configured in this repository as of this task's writing; none was invented. `VERIFIED_REPOSITORY`.

## 7. Parallel main-advancement reconciliation (pre-PR)

Repeated immediately before opening the PR: `git fetch origin --prune`, `git rev-parse origin/main`, `git merge-base --is-ancestor d03116368e6c55cfa87ff1e35b95c485f7ff240d origin/main`. Result and any further reconciliation (merge commit, conflicts, re-validation) recorded in the delivery report's §22, since it necessarily happens after this document's own content is otherwise finalized.

## 8. Concurrent KVKK work observed

At task start, six other worktrees existed in the primary repository, including at least one active KVKK-labeled branch (`feature/kvkk-crit-003-security-incident-foundation`, the primary tree's own checked-out branch) and one docs-closeout worktree (`docs/http-log-privacy-production-closeout`). Neither was inspected beyond `git worktree list`'s own summary line. No KVKK PR's code was incorporated into this design beyond what is already merged into `origin/main` at this task's execution baseline (§1). If any KVKK PR merges after this task's own PR opens, a future task (not this one) must reconcile this design's evidence-staleness note (§0/R-072) against the newly-merged state — this is recorded as a forward-looking note, not resolved here.

## 9. Evidence classification key

Per `evidence/README.md`'s own vocabulary: `VERIFIED_GIT` (local git metadata), `VERIFIED_REPOSITORY` (direct file inspection), `OBSERVED_LOCAL_ONLY` (observed but not cross-checked against an external system of record). No production access occurred; no `UNVERIFIED_PRODUCTION`/`VERIFIED_PRODUCTION_OBSERVED` classification applies to any claim in this document.

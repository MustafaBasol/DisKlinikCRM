# F1-003-P3 — Layered CI Workflows and Full-Suite Fail-Safe: Implementation and Verification

**Status: `AGENT_COMPLETED` — implementation complete, locally validated, PR opened, not merged. Maximum status: `AGENT_COMPLETED` / `PR_OPENED_AWAITING_REVIEW`.**

**Updated by F1-003-P3-R1 (2026-07-30) — see §17 below.** §1-§16 are preserved verbatim as originally authored; §11's "actionlint... zero findings" and other point-in-time claims are historical as of the original P3 commit and superseded where §17 says so. R1 found and fixed a real defect that only manifests on a from-scratch CI checkout (§17.4), closed the backend compatibility gap §5/§16 explicitly deferred, and replaced the `null` GitHub Actions evidence in §13/the companion JSON with actual run data.

## 1. Task identity and phase

| Field | Value |
|---|---|
| Task ID | F1-003-P3 |
| Title | Layered CI Workflows and Full-Suite Fail-Safe |
| Phase | F1 — CI and Test Architecture |
| Parent task | F1-003 — Baseline CI Test Execution and Disposable Runtime Readiness |
| Task type | IMPLEMENTATION (CI workflow YAML only) + LOCAL VALIDATION + EVIDENCE |
| Initial status | Blocked until PR #260 (F1-003-P2) externally reviewed and merged — now satisfied (see §2) |

## 2. Baseline commit and PR #260 ancestry proof

- `git fetch origin --prune` run at task start.
- Fetched `origin/main`: `04723f9add600b6c432fb517f0607235944d6c2e` — `git log -1 --format='%H%n%cI%n%s' origin/main` shows this is itself PR #260's own merge commit ("Merge pull request #260 from MustafaBasol/feature/f1-003-p2-disposable-runtime"), committed `2026-07-30T11:45:38+02:00`.
- `gh pr view 260 --repo MustafaBasol/DisKlinikCRM --json number,state,mergedAt,mergeCommit,baseRefName,headRefName,headRefOid` independently confirmed: `state: MERGED`, `mergedAt: 2026-07-30T09:45:38Z`, `mergeCommit: 04723f9add600b6c432fb517f0607235944d6c2e`, `base: main`, `head: feature/f1-003-p2-disposable-runtime`, `headSha: 64aa152311238aba7d7ec90a33021a168f7bce67`.
- `git merge-base --is-ancestor 04723f9add600b6c432fb517f0607235944d6c2e origin/main` exited `0` (trivially — the two SHAs are identical; zero intervening commits).
- Conclusion: PR #260 is merged and is the baseline; F1-003-P3 is unblocked. No baseline conflict.

## 3. Primary worktree and isolated worktree

- Primary repository (`E:\Ek Gelir\Siteler\DisKlinikCRM-git`, branch `fix/revenue-report-group-by`, HEAD `6f3ef853e521d527eb6fa7bf1f9938c4ec85c1f9`): confirmed clean (`git status --short` empty) and untouched by this task — not inspected further, not diffed, not stashed.
- Fresh, isolated worktree created via `git worktree add -b feature/f1-003-p3-layered-ci-workflows E:/Ek Gelir/Siteler/DisKlinikCRM-worktrees/f1-003-p3-layered-ci-workflows origin/main`.
- Verified inside the new worktree immediately after creation: `git status --short` empty, `git branch --show-current` = `feature/f1-003-p3-layered-ci-workflows`, `git rev-parse HEAD` = `04723f9add600b6c432fb517f0607235944d6c2e`, `git merge-base --is-ancestor 04723f9a... HEAD` exit `0`.

## 4. Authoritative sources read

`AGENTS.md`; root `package.json`; `server/package.json` (full scripts block); `.github/workflows/windows-bridge-pr.yml` and `windows-bridge-release.yml` (full); `docs/program/CURRENT_PHASE.md` (recent entries); `docs/program/phases/F1_CI_AND_TEST_ARCHITECTURE.md` (full, including the F1-003-P1/B1/P2 subsections); `docs/program/RISK_REGISTER.md` (R-070, R-072 rows, direct read); `docs/program/evidence/README.md` (full); `docs/program/evidence/F1-003-P1_test_execution_contract.json` (`f1003p2Handoff` and `futureCiCommandMatrix` sections — the accepted forward-looking PR/main/nightly/release CI command matrix this task implements); `docs/program/evidence/F1-003-P2_DISPOSABLE_RUNTIME_IMPLEMENTATION_AND_VERIFICATION.md`; `scripts/test-runtime/orchestrator.ts` (full), `lib/profiles.ts`, `lib/process.ts`, `lib/sweep.ts`, `lib/outcome.ts`, `provision.sh` (full).

CodeGraph was not invoked — per this program's own repeated prior findings (six independent confirmations of unavailability across F1-001 through F1-003-P2), bounded `Read`/`Grep`/`Glob` was used instead, scoped to package scripts, `scripts/test-runtime/**`, and existing workflow files, per this task's own CodeGraph-restriction instruction.

## 5. Design decision: no orchestrator or `server/package.json` change

An initial design considered adding a `--full-suite` flag to the disposable-PostgreSQL orchestrator profile (to run legacy `server:test` instead of `server:test:disposable-db` under Layer 5), so the full-suite fail-safe could also cover legacy `server:test`'s own ~14 additional silently-DB-required members not already inside `server:test:disposable-db`. This edit was **not made** — it would have touched `scripts/test-runtime/orchestrator.ts` and `lib/profiles.ts`, which are the accepted, merged F1-003-P2 implementation, and this task's authorization is scoped to the CI workflow layer, not to extending or rewriting the accepted test-runtime architecture.

**Consequence, stated explicitly:** legacy `server:test`'s own additional DB-required members (beyond the 9 already covered by `server:test:disposable-db`) remain unprovisioned in CI by this task — an unchanged continuation of the same deferral F1-003-P1 and F1-003-P2 already, explicitly, recorded (see `F1-003-P1_TEST_SCRIPT_CLOSURE_AND_EXECUTION_CONTRACT.md` §18 and the F1-003-P2 phase-doc row, "No legacy `server:test` provisioning ... explicitly deferred"). This is not a silent omission: it is documented here, in the PR description, and in the tracker updates below.

All other Layer 5 content (the 7 frontend leaf scripts and `test:vitest`, previously reached by zero CI workflow per F1-002-P1's own evidence) required no test-runtime or `server/package.json` change — every workflow job invokes an already-existing npm script by name.

## 6. Existing workflow inventory (preserved unchanged)

| File | Purpose | Touched by this task? |
|---|---|---|
| `.github/workflows/windows-bridge-pr.yml` | PR validation for the Windows Imaging Bridge (backend/frontend imaging, .NET tests, installer PowerShell tests, unsigned structural release-script dry run) | No |
| `.github/workflows/windows-bridge-release.yml` | Manual, protected, signed production release of the Windows Imaging Bridge installer | No |

Neither file is replaced, superseded, or path-overlapped by the new workflows below — the new workflows have no `paths:` filter and run on every PR into `main` regardless of which files changed, which is a deliberate property of the Layer 5 fail-safe (see §7).

## 7. New workflow architecture

Three new files, none touching `scripts/test-runtime/**`, `server/package.json`, root `package.json`, Prisma schema, or any application/route/service file:

- **`.github/workflows/ci-layers.yml`** — reusable workflow (`on: workflow_call`), the single source of truth for all 8 jobs / 5 conceptual layers. Never triggered directly.
- **`.github/workflows/ci-pr.yml`** — thin caller, `on: pull_request: branches: [main]`, no path filter. `concurrency: group: ci-pr-${{ github.event.pull_request.number }}, cancel-in-progress: true` (mirrors the existing `windows-bridge-pr.yml` pattern).
- **`.github/workflows/ci-main-and-nightly.yml`** — thin caller, `on: push: branches: [main]`, `schedule: '17 2 * * *'` (daily), `workflow_dispatch: {}`. `concurrency: group: ci-main-and-nightly, cancel-in-progress: false` (a fixed, single group scoped to this workflow name only — never shared with `ci-pr.yml`'s per-PR groups).

`permissions: contents: read` at every level (top-level and per-job `uses:` calls) — no write permission is granted anywhere; no job needs to comment, label, release, or push.

### Job graph (defined once in `ci-layers.yml`, run by both callers)

| Job | Layer | Runs on | Needs | Script(s) invoked |
|---|---|---|---|---|
| `frontend-typecheck-and-build` | 1 | ubuntu-latest | — | `npm run build` (`tsc -b && vite build`) |
| `server-typecheck` | 1 | ubuntu-latest | — | `npm run typecheck` (`server/`; `prisma generate && tsc --noEmit`) |
| `tooling-typecheck-and-unit` | 1 | ubuntu-latest | — | `npm run typecheck:runtime`, `npm run test:runtime:unit` |
| `workflow-and-syntax-lint` | 1 | ubuntu-latest | — | actionlint (downloaded + checksum-verified), `bash -n` on `scripts/test-runtime/*.sh`, PowerShell `Parser::ParseFile` on `scripts/test-runtime/*.ps1`, `node -e JSON.parse` on both `package.json` manifests |
| `non-disposable-backend-tests` | 2 | ubuntu-latest | all 4 Layer-1 jobs | `npm run server:test:non-disposable` (68 members) |
| `disposable-postgres-tests` | 3 | ubuntu-latest | all 4 Layer-1 jobs | `npm run test:runtime:postgres` (→ `server:test:disposable-db`, 9 members) + `npm run test:runtime:cleanup-stale -- --live --ttl-hours=0.01` (`if: always()`) |
| `storage-integration-tests` | 4 | ubuntu-latest | all 4 Layer-1 jobs | `npm run test:runtime:storage` (→ `server:test:storage-integration`, 21 assertions) + same cleanup-check pattern |
| `full-suite-compatibility-failsafe` | 5 | ubuntu-latest | `frontend-typecheck-and-build` | 7 frontend leaf scripts + `npm run test:vitest` |

Static failure (Layer 1) blocks the three expensive/Docker-based jobs (Layers 2-4) via `needs:`, so a broken typecheck/lint/build never spins up disposable PostgreSQL/MinIO containers. Layer 5 depends only on the frontend build (cheap, fast-fail) since it shares no infrastructure with Layers 2-4. All four Layer-1 jobs, and Layer 5, can run in parallel with each other.

### Why no separate `ci-release.yml`

`docs/program/evidence/F1-003-P1_test_execution_contract.json`'s own `futureCiCommandMatrix.release` entry defines the release contract as "nightly set + migration deployment/upgrade verification ... Rollback evidence boundary: physical migration rollback rehearsal/tooling remains blocked on R-070." Forward-only `prisma migrate deploy` against a disposable PostgreSQL is already exercised by **every** `disposable-postgres-tests` and `storage-integration-tests` run (the orchestrator's `runMigrations()` always runs it before any test script) — on every PR, every push to main, and every nightly/manual run. A dedicated release workflow would duplicate that coverage without adding the one thing that would make it distinct (physical rollback verification), which R-070 (still `OPEN`) explicitly blocks. `workflow_dispatch` on `ci-main-and-nightly.yml` already provides the manual/on-demand trigger path. No release workflow is created by this task.

## 8. Action and image pinning

| Action | Tag | SHA | Independently verified this task via |
|---|---|---|---|
| `actions/checkout` | v4.2.2 | `11bd71901bbe5b1630ceea73d27597364c9af683` | `gh api repos/actions/checkout/commits/<sha>` — commit exists, dated 2024-10-23 |
| `actions/setup-node` | v4.4.0 | `49933ea5288caeca8642d1e84afbd3f7d6820020` | same method, dated 2025-04-02 |
| `actions/upload-artifact` | v4.6.2 | `ea165f8d65b6e75b540449e92b4886f43607fa02` | same method, dated 2025-03-19 |

All three SHAs are reused, byte-identical, from the existing `windows-bridge-pr.yml` — no new third-party GitHub Action is introduced by this task.

**actionlint** (used only for local/CI YAML+semantic validation, not a GitHub Action): version `v1.7.12`, binary downloaded directly from `https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_linux_amd64.tar.gz`, verified against the upstream-published checksum before extraction/execution:

```
8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8  actionlint_1.7.12_linux_amd64.tar.gz
```

matched via `sha256sum -c -` both locally (this task, on the Windows machine, using the linux binary's checksum only — see §11 for how it was actually executed locally) and as a `workflow-and-syntax-lint` CI step (downloads and verifies the same URL/checksum on the `ubuntu-latest` runner).

**Container images inherited from F1-003-P2, unchanged:**

- PostgreSQL: `postgres@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777` (observed runtime `16.14`)
- MinIO: `minio/minio@sha256:8834ae47a2de3509b83e0e70da9369c24bbbc22de42f2a2eddc530eee88acd1b`

Neither image reference is touched by this task; both are invoked exactly as the merged P2 orchestrator already invokes them.

## 9. Concurrency, cancellation, and cleanup interaction

- `ci-pr.yml`: cancelling a superseded push's run does **not** guarantee the disposable-PostgreSQL/MinIO jobs' own teardown finishes — GitHub Actions cancellation delivers a signal but does not wait indefinitely for graceful shutdown. This is the same, already-documented F1-003-P2 limitation (best-effort `SIGINT`/`SIGTERM` cleanup, no guarantee against a hard kill) — cancellation on GitHub-hosted runners is exactly this class of hard interruption. Any resource a cancelled run's own cleanup did not reach is still label-scoped and disposable-per-run (unique run ID, container names, database names, dynamic host ports — F1-003-P2's collision-resistant naming), so a leaked resource from a cancelled run cannot corrupt or block a later run; it can only accumulate as harmless orphaned Docker state on that ephemeral GitHub-hosted runner VM, which is destroyed with the runner at job end regardless.
- `ci-main-and-nightly.yml`: `cancel-in-progress: false` — a nightly run in progress is not cancelled by a same-day push to main, and vice versa. Both runs, if concurrent, execute on separate GitHub-hosted runner VMs; F1-003-P2's dynamic ports and unique run-ID-derived naming make this safe even in the (unlikely) case both land on jobs in the same physical Docker environment, which GitHub-hosted runners are not shared across concurrent workflow runs.
- **Windows graceful-interruption limitation, preserved and not hidden:** F1-003-P2-R3's own finding — that Windows `SIGINT` delivery to a running orchestrator process was not conclusively, end-to-end verified on this Windows development machine (Node's own `child.kill('SIGINT')` does not invoke the child's own handler on Windows; the stronger `GenerateConsoleCtrlEvent` approach was attempted but not completed) — is unaffected by this task. All new CI jobs run on `ubuntu-latest`, where POSIX `SIGINT`/`SIGTERM` delivery and handling is the normal, well-supported case; this task does not claim to resolve or newly test the Windows-specific gap, and does not claim GitHub Actions cancellation on Linux proves anything about Windows signal delivery.
- No job uses `continue-on-error` or `|| true` around a required gate. Every `if: always()` cleanup-check step's own exit code is allowed to fail the job (no swallowing).

## 10. Timeouts

Set from this task's own measured local runtimes (§11), with headroom, capped conservatively rather than left unbounded:

| Job | Measured locally | `timeout-minutes` |
|---|---|---|
| `frontend-typecheck-and-build` | build ~13s (excludes `npm ci`) | 15 |
| `server-typecheck` | prisma generate ~2s + tsc clean | 15 |
| `tooling-typecheck-and-unit` | typecheck near-instant; 68 unit tests well under 1 min | 10 |
| `workflow-and-syntax-lint` | actionlint + shell/PS/JSON checks, seconds | 10 |
| `non-disposable-backend-tests` | 68-member chain, several minutes locally | 20 |
| `disposable-postgres-tests` | provision + migrate (67 migrations) + 9-member test + teardown, a few minutes | 15 |
| `storage-integration-tests` | provision (PG+MinIO) + migrate + 21-assertion test + teardown, a few minutes | 15 |
| `full-suite-compatibility-failsafe` | 7 leaf scripts + vitest, well under 1 min combined locally | 10 |

`npm ci` time on GitHub-hosted runners is not included in the measurements above (this task's local `npm ci` ran once, unmeasured precisely, prior to any timed step) — the headroom in each `timeout-minutes` value is intended to absorb GitHub-hosted-runner `npm ci` latency plus CI-specific overhead, not just the measured local step time.

## 11. Local validation — exact commands and results

All commands run from the isolated worktree `E:\Ek Gelir\Siteler\DisKlinikCRM-worktrees\f1-003-p3-layered-ci-workflows`, Node `v24.18.0`, npm `11.16.0`, Docker `29.6.2` (Docker Desktop, started and confirmed reachable before any Docker-dependent command).

**Node-version caveat, stated honestly:** the three new CI workflows pin `node-version: '20'` (matching the existing `windows-bridge-pr.yml` convention, the only prior evidence in this repository for a CI Node version). This task's own local validation ran under the locally-installed Node `v24.18.0`, not Node 20 — the two were not cross-verified against each other locally. This is a residual limitation; actual GitHub Actions execution under Node 20 remains unverified until real workflow runs complete (§13).

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `git status --short` (post-changes) | — | only 3 new files listed (§14); one incidental `vite.config.d.ts` line-ending-only byproduct from running `npm run build` was discarded via `git checkout -- vite.config.d.ts` before this table was finalized, since it was not part of this task's intended change |
| 2 | `git diff --check` | 0 | clean (one CRLF/LF advisory warning on `vite.config.d.ts`, resolved by discarding that file, not part of the final diff) |
| 3 | `git diff --stat origin/main...HEAD` / `--name-only` | — | see §14 |
| 4 | `node -e "JSON.parse(...)"` on `package.json` | 0 | `package.json OK` |
| 5 | `node -e "JSON.parse(...)"` on `server/package.json` | 0 | `server/package.json OK` |
| 6 | `actionlint -color` (all 5 `.github/workflows/*.yml`, including the 2 pre-existing files) | 0 | zero findings |
| 7 | `bash -n scripts/test-runtime/provision.sh` | 0 | clean |
| 8 | `bash -n scripts/test-runtime/sweep.sh` | 0 | clean |
| 9 | PowerShell `Parser::ParseFile` on `provision.ps1` | 0 errors | clean |
| 10 | PowerShell `Parser::ParseFile` on `sweep.ps1` | 0 errors | clean |
| 11 | `npm run typecheck:runtime` | 0 | clean |
| 12 | `npm run test:runtime:unit` | 0 | **68 passed, 0 failed** (matches documented P2-R3 baseline exactly) |
| 13 | `npm run build` (root) | 0 | Vite build succeeded in 13.26s (one pre-existing, unrelated chunk-size advisory warning, not a new finding) |
| 14 | `npm run lint` (root) | 2 | **confirmed non-functional** — ESLint 9.39.4: "ESLint couldn't find an `eslint.config.(js\|mjs\|cjs)` file." No `eslint.config.js` exists anywhere in the repository. Not wired into any CI job (§ Layer 1 design) — this is the documented truth, not a fabricated passing gate. |
| 15 | `server`: `npm run typecheck` | 0 | `prisma generate` (1.83s) + `tsc --noEmit` clean |
| 16 | `server`: `npm run server:test:non-disposable` | 0 | **68/68 members** — last member `test:overdue-installments`: `Total: 9 Passed: 9 Failed: 0` |
| 17 | `npm run test:runtime:postgres` | 0 | runId `20260730T101740Z-9126f60f-11424`; migration `{code:0, step:"ok"}` (67 migrations applied to the disposable DB only); test `{scriptName:"server:test:disposable-db", code:0}` (9/9); cleanup `{success:true, errors:[]}` |
| 18 | `npm run test:runtime:storage` | 0 | runId `20260730T101823Z-9e006cd9-22716`; migration ok; test `{scriptName:"server:test:storage-integration", code:0}`, **21/21 assertions**; cleanup `{success:true, errors:[]}` |
| 19 | `docker ps -a` / `docker network ls`, filtered `label=com.noramedi.test-runtime=true`, after #17+#18 | — | **zero resources** of either kind |
| 20 | `npm run test:vitest` | 0 | 2 test files, **29/29 tests passed** |
| 21 | 7× frontend leaf scripts (`test:dicom-helpers`, `test:onboarding-helpers`, `test:pairing-poller`, `test:booking-widget-helpers`, `test:clinic-bulk-export-selection`, `test:communication-consent-matrix`, `test:patient-detail-tabs-helpers`) | 0 each | 36, 21, 8, 26, 24, 29, 12 passed respectively — 156 total assertions, 0 failed |
| 22 | `npm run test:runtime:parallel` (verify-parallel regression) | 0 | `generation: {succeeded:true, code:0}`; all 4 children (2×postgres, 2×storage) `exitCode:0`; `collisionCheck`: `uniqueRunIds/uniqueContainerNames/uniqueDatabaseNames/uniqueHostPorts` all `true`; exactly **1** "Generated Prisma Client" line; **0** `EBUSY` occurrences; zero labeled Docker resources remaining afterward |

Command #22 (verify-parallel) is the section-15.10-required regression proof that this task's workflow-only changes did not alter the F1-003-P2 orchestrator's contract — no orchestrator file was touched, and the result is byte-for-byte consistent with the documented P2-R3 baseline (collision-free, single generation, zero EBUSY).

**Full-suite/compatibility command (Layer 5) — locally executed, not "not run":** commands #20 and #21 above together constitute the exact Layer 5 job content; both ran locally with 0 exit codes. The one Layer-5-adjacent item explicitly **not** executed by this task, anywhere, is legacy `server:test` (see §5) — correctly marked `UNVERIFIED`/deferred, not claimed passing.

## 12. Files changed

```
.github/workflows/ci-layers.yml            (new)
.github/workflows/ci-pr.yml                (new)
.github/workflows/ci-main-and-nightly.yml  (new)
docs/program/NORAMEDI_MASTER_TRACKER.md
docs/program/CURRENT_PHASE.md
docs/program/phases/F1_CI_AND_TEST_ARCHITECTURE.md
docs/program/evidence/README.md
docs/program/evidence/F1-003-P3_LAYERED_CI_WORKFLOWS_AND_FULL_SUITE_FAIL_SAFE.md  (new, this file)
docs/program/evidence/F1-003-P3_layered_ci_verification.json                     (new)
```

No application, route, service, domain, Prisma schema/migration, `server/package.json`, root `package.json`, or `scripts/test-runtime/**` file is touched.

## 13. GitHub Actions evidence

To be completed after push and PR creation — see the PR description and the final delivery report for the actual PR number, head SHA, and initial `gh pr checks` / `gh run list` output. **No GitHub Actions run exists at the time this evidence file was authored.** Any run status reported after the PR is opened will explicitly distinguish `queued`/`in_progress`/`completed`, and will never describe a queued or in-progress run as "passed."

## 14. Migration, production, tenant, and KVKK boundaries

- Migration files created: **none**.
- Prisma schema changed: **no**.
- Existing migrations applied: **only to disposable databases**, during this task's own local validation runs (§11, commands #17-18 and #22) — 67 migrations per disposable-PostgreSQL invocation, exactly as the merged F1-003-P2 orchestrator already does; no schema/migration file was created or edited.
- Production migration: **not run**. Production database: **not accessed**.
- No patient/clinic/consent/messaging/storage-production data is used anywhere — every disposable-runtime invocation provisions and tears down synthetic, ephemeral fixtures exactly as F1-003-P2 already does; this task adds no new fixture or seed data.
- No authentication, authorization, consent, retention, tenant-scope, or KVKK-relevant application code path is touched. KVKK physical-architecture freeze: unaffected, still active.
- R-070 (migration-rollback tooling gap): **remains `OPEN`**, unaffected — this task's forward-only `prisma migrate deploy` verification (already inherited from P2) does not touch rollback tooling, and no release/rollback workflow is introduced (§7).

## 15. Rollback

- Revert this task's single commit (or the PR's merge commit, once/if merged) via `git revert` — removes all three new workflow files and all documentation/evidence changes in one operation.
- If emergency CI recovery is needed before a revert can land, the three new workflow files may be individually disabled/removed without affecting `windows-bridge-pr.yml`/`windows-bridge-release.yml` or any P1/P2 package script/test-runtime tooling, none of which this task modifies.
- No database, storage, deployment, or production rollback is applicable — none of those surfaces were touched.
- Branch-protection/required-check configuration is out of this repository task's scope; if a future task wires any of these new workflow names into required status checks, that GitHub-settings change must be separately reverted in repository settings, not by reverting this commit.

## 16. What this task does not claim

- Does not claim F1's exit gate is satisfied.
- Does not claim F1-003 is complete.
- Does not claim R-070, R-046, or R-071 are resolved or closed.
- Does not claim the KVKK baseline is stable.
- Does not implement affected-test/impact-based selection (F1-001's design remains unimplemented at the CI-wiring level; Layer 5's "no path filter" property is deliberately what keeps this safe in the meantime).
- Does not claim legacy `server:test`'s own additional DB-required members are now covered by CI (§5) — an explicit, continued deferral, not a silent one.
- Does not claim actual GitHub Actions execution has passed — no remote run exists until the PR in §13 is opened and inspected.
- Does not claim Windows graceful-interruption behavior is now verified (§9) — unchanged, still an open, explicitly-documented limitation from F1-003-P2-R3.

## 17. F1-003-P3-R1 — Main Reconciliation, Backend Compatibility Fail-Safe, and Remote CI Evidence Closure

### 17.1 Baseline reconciliation

- Existing worktree/branch reused (`feature/f1-003-p3-layered-ci-workflows`), not recreated.
- `git fetch origin --prune`; fetched `origin/main` = `cc31aeb7a0c379a641e7ab4558031e9adcdf1e59` (PR #266 merge, calendar drag/resize hardening) — **not** `04723f9a...` (the original P3 baseline) and **not** `cc31aeb7...`'s own earlier-reported value from GitHub's PR UI at task-assignment time; the freshly fetched SHA was used, not assumed.
- `git merge-base --is-ancestor origin/main HEAD` (pre-merge) → exit `1` — origin/main had advanced, reconciliation required.
- `git diff --name-only 04723f9a... origin/main` → 6 files, all under `src/components/CalendarTimelineView.*` and `src/locales/*/appointments.json` — completely disjoint from this task's own changed paths (`.github/workflows/**`, `docs/program/**`, `scripts/test-runtime/**`, `server/package.json`, `package.json`).
- `git merge --no-ff origin/main` → merge commit `7ab630c9a5a54acc7bb757b06c908b772c5f138d`, **zero conflicts** (disjoint file sets). No `--ours`/`--theirs`, no rebase, no force push, no reset.
- Post-merge: `git merge-base --is-ancestor origin/main HEAD` exit `0`; `git merge-base --is-ancestor <pre-merge-P3-HEAD e99dd096...> HEAD` exit `0` — both ancestries confirmed.
- Side effect noted: the merge pulled in a new `src/components/CalendarTimelineView.vitest.test.tsx`, raising `test:vitest`'s file count from 2 to 3 (29→35 tests) — reflected in this task's own Layer 5 regression run (§17.6).

### 17.2 Exact uncovered-test inventory (before this task's remediation)

Computed programmatically (not estimated) by diffing legacy `server:test`'s own chain against the union of the three existing safe aggregates:

```
legacy server:test chain:        77 npm-run references
server:test:non-disposable:      68 members
server:test:disposable-db:        9 members
server:test:storage-integration:  1 member
uncovered (in legacy chain, in none of the three above): 23 members, exact names:
```

| # | Script | postgresRequired | minioRequired | Source |
|---|---|---|---|---|
| 1 | `test:auth` | true | false | F1-003-P1_test_execution_contract.json |
| 2 | `test:instagram` | true | false | ″ |
| 3 | `test:overlap-safety` | true | false | ″ |
| 4 | `test:availability-service` | true | false | ″ |
| 5 | `test:public-booking` | true | false | ″ |
| 6 | `test:public-booking-slots` | true | false | ″ |
| 7 | `test:notice-evidence` | true | false | ″ |
| 8 | `test:payments-list-field-scope` | true | false | ″ |
| 9 | `test:kvkk-lifecycle` | true | false | ″ |
| 10 | `test:clinic-bulk-export` | true | false | ″ |
| 11 | `test:security-incidents` | true | false | ″ |
| 12 | `test:communication-consent` | true | false | ″ |
| 13 | `test:communication-consent-backfill` | true | false | ″ |
| 14 | `test:communication-consent-reconciliation-report` | true | false | ″ |
| 15 | `test:communication-consent-reconciliation` | true | false | ″ |
| 16 | `test:communication-consent-audit-report` | true | false | ″ |
| 17 | `test:communication-consent-matrix-route` | true | false | ″ |
| 18 | `test:legacy-consent-correction` | true | false | ″ |
| 19 | `test:kvkk-high007-high008-schema-integrity` | true | false | ″ |
| 20 | `test:messages-consent-gate` | true | false | ″ |
| 21 | `test:recall-consent-gate` | true | false | ″ |
| 22 | `test:messaging-connection-scope` | true | false | ″ |
| 23 | `test:retention-manual-run-audit` | true | false | ″ |

Cross-referenced against `docs/program/evidence/F1-003-P1_test_execution_contract.json`'s own per-script `postgresRequired`/`minioRequired` fields (not re-derived from scratch): all 23 are `postgresRequired: true`, `minioRequired: false` — this matches, and gives exact machine-readable confirmation to, the previously-narrative-only F1-003-P1/P2 finding of "23 silently-DB-required members" (this task's own original §16 non-claim had mis-stated this as "roughly 14," which is corrected here to the exact, verified figure of **23**).

### 17.3 Coverage reconciliation table (by aggregate group)

| Group | Members | CI job (this workflow) | Directly executed? | Infra required | Uncovered before this task? | Closure |
|---|---|---|---|---|---|---|
| `server:test:non-disposable` | 68 | `non-disposable-backend-tests` | yes | none | No | unchanged |
| `server:test:disposable-db` | 9 | `disposable-postgres-tests` (`postgres` profile) | yes | disposable PostgreSQL | No | unchanged |
| `server:test:storage-integration` | 1 | `storage-integration-tests` (`storage` profile) | yes | disposable PostgreSQL + MinIO | No | unchanged |
| `server:test:legacy-db-required` (**new**) | 23 | `full-suite-compatibility-failsafe-backend` (**new**, `postgres-compat` profile) | yes | disposable PostgreSQL | **Yes** | **new aggregate + new profile, closes gap this task** |
| 7 frontend leaf scripts + `test:vitest` (3 files) | 10 | `full-suite-compatibility-failsafe-frontend` | yes | none | No (closed by original P3) | unchanged |
| `typecheck:runtime` + `test:runtime:unit` | n/a (tooling) | `tooling-typecheck-and-unit` | yes | none | No | unchanged |
| Legacy `server:test` itself (as one aggregate script) | n/a | none — never directly invoked | No | disposable PostgreSQL (whole chain) | still not directly invoked | **not** required — its own 101 members (68+9+1+23, minus overlaps the legacy chain itself doesn't contain) are now each reachable via one of the four rows above; invoking the legacy aggregate script itself remains unnecessary and is not attempted, consistent with never modifying it |

No canonical PostgreSQL-required/MinIO-free script is left unreachable by any CI-safe aggregate as of this task.

### 17.4 Root-caused GitHub Actions defect (found via real remote evidence, not local testing)

The original P3 PR run (`30536185063`, head `e99dd096d2d6d1222c9f7c7f59c0735ab4380979`) **completed with overall conclusion `failure`** — `ci-layers / Layer 2: non-disposable backend tests` failed with:

```
SyntaxError: The requested module '@prisma/client' does not provide an export named 'PrismaClient'
```

**Root cause:** `non-disposable-backend-tests` ran `npm ci` in `server/` and then directly invoked `npm run server:test:non-disposable` — it never generated the Prisma Client. `server/package.json` has no `postinstall` script that does this; the only two places that ever ran `npx prisma generate` were `npm run typecheck` (a different job, `server-typecheck` — separate runner, separate checkout, does not share state) and the F1-003-P2 orchestrator's own `runMigrations()` (used by Layers 3/4 and the new Layer 5 backend job, §17.5 — which is exactly why those three jobs succeeded on the very same run). This did not reproduce in this task's own local validation only because the local working directory had already generated the client via earlier, unrelated commands in the same persistent environment — a from-scratch checkout (every real CI run) hits it every time.

**Fix:** added an explicit `npx prisma generate` step to `non-disposable-backend-tests` in `ci-layers.yml`, before the test-aggregate step. No test file, application file, or Prisma schema changed — this is a CI-workflow-only fix for a CI-workflow-only defect introduced by the original P3 task.

### 17.5 Backend compatibility closure design

Reuses 100% of the existing F1-003-P2 disposable-runtime orchestrator; no second PostgreSQL implementation.

- `server/package.json`: one new, additive aggregate, `server:test:legacy-db-required`, chaining exactly the 23 scripts in §17.2, in their original legacy-chain relative order. Legacy `server:test` itself is not read or modified.
- `scripts/test-runtime/lib/profiles.ts`: `RUNTIME_PROFILES` extended with `'postgres-compat'`; new pure function `resolvePostgresOnlyTestScript(profile)` — `'postgres'` → `server:test:disposable-db` (unchanged), `'postgres-compat'` → `server:test:legacy-db-required` (new). Unit-tested (Docker-free).
- `scripts/test-runtime/orchestrator.ts`: `RunOptions.profile` widened to include `'postgres-compat'`; the single `if (opts.profile === 'storage')` MinIO-provisioning branch is unaffected (unchanged equality check), so `postgres-compat` correctly gets PostgreSQL-only provisioning, identical to `postgres` — same guard (`assertNoInheritedOverride`, `assertSafeDatabaseUrl`), same digest-pinned image (`postgres@sha256:57c72fd2a1...`), same migration path (`prisma migrate deploy` against the disposable DB only), same fail-fatal cleanup (`teardown()` via the concurrency-safe registry), same collision-resistant naming (`nmtest-pg-postgres-compat-<runid>`).
- root `package.json`: one new, additive script, `test:runtime:postgres-compat`.
- `ci-layers.yml`: new job `full-suite-compatibility-failsafe-backend` (part of Layer 5), gated on all 4 Layer-1 jobs (Docker-based, like Layers 3/4), `timeout-minutes: 20`, same `if: always()` residual-cleanup-check and failure-only sanitized-artifact-upload pattern as Layers 3/4.
- Legacy `server:test`, the existing `postgres`/`storage` profiles, and all P2 provisioning/guard/cleanup/pinning code are unmodified — verified by full regression (§17.6).

### 17.6 Artifact-generation correction

**Problem (as reported):** `npm run test:runtime:postgres | tee postgres-run-summary.json` captured combined human-readable stdout (test-runner progress lines, migration output) plus the final JSON — the file was not valid, parseable JSON as a whole.

**Fix chosen: Option 1 (preferred).** Added `maybeWriteSummaryFile(args, data)` in a new module, `scripts/test-runtime/lib/summaryFile.ts` — an additive `--summary-file=<path>` CLI flag that writes the exact same already-redacted object passed to `console.log` to a dedicated file as pure JSON, independent of stdout. Wired into all three orchestrator output sites (`postgres`/`postgres-compat`/`storage` summary, `verify-parallel` result, `cleanup-stale` report) for consistency, though only the first is required by this task. `ci-layers.yml`'s three Layer 3/4/5-backend jobs now run e.g. `npm run test:runtime:postgres -- --summary-file=postgres-run-summary.json`, then (failure-only) validate the file is real JSON via `node -e "JSON.parse(...)"`, then scan it for prohibited secret-like patterns (`postgresql://`, `AKIA[0-9A-Z]{16}`, PEM key headers, `secretAccessKey`, `accessKeyId`/`password` key-value shapes) before uploading — refusing the upload step if any pattern matches. The RunSummary object contains no credentials by construction (`runId`, `profile`, `containerNames`, `networkName`, `hostPorts`, `databaseName`, `migration`, `test`, `cleanup`, `outcome` only), so this scan is defense-in-depth, not a fix for an actual leak.

**A second, real defect found and fixed during this work:** an initial implementation let `writeFileSync` throw on a bad path, which propagated out of `main()` to the top-level `.catch()` handler — overriding the correctly-computed real test-outcome exit code with a generic "Fatal orchestrator error" exit `1`. This was caught by this task's own local verification (an accidental bad path during testing) before it could reach CI. Fixed: `maybeWriteSummaryFile` now catches and logs any write failure to stderr, never throws — an artifact-handling failure must never conceal the real test/cleanup exit code (per this task's own explicit requirement). Verified by 4 new Docker-free unit tests (no-op when flag absent; exact round-trip JSON when present; tolerant of flag position in argv; never throws on an unwritable path).

### 17.7 Local validation (P3-R1, exact commands/results)

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `git merge --no-ff origin/main` | 0 | merge commit `7ab630c9a5a54acc7bb757b06c908b772c5f138d`, 0 conflicts |
| 2 | `npm run typecheck:runtime` | 0 | clean (after profiles.ts/orchestrator.ts/summaryFile.ts changes) |
| 3 | `npm run test:runtime:unit` | 0 | **74/74 passed** (was 68; +2 profile-resolution, +4 summary-file, net +6) |
| 4 | `npm run test:runtime:postgres-compat` (first live run, no `--summary-file`) | 1 | **116 passed, 1 failed** — see §17.8 for root cause of the 1 failure (not a defect) |
| 5 | `npm run test:runtime:postgres-compat -- --summary-file=postgres-compat-run-summary.json` (second run) | 1 | same result; summary file confirmed valid, re-parseable JSON with `test.code:1`, `cleanup.success:true`, `outcome.exitCode:1` — proves the artifact fix and proves cleanup runs and succeeds even when the test phase fails |
| 6 | `docker ps -a` / `network ls`, label-filtered, after run #5 | — | **zero** residual resources despite the test failure |
| 7 | `npm run test:runtime:postgres` (regression) | 0 | still resolves to `server:test:disposable-db` (unaffected by the new profile), 9/9, cleanup clean |
| 8 | `npm run test:runtime:storage` (regression) | 0 | 21/21, cleanup clean |
| 9 | `npm run test:runtime:parallel` (regression) | 0 | collision-free, 1 Prisma generation, 0 `EBUSY`, zero residual resources — unaffected by the new profile (verify-parallel does not invoke `postgres-compat`) |
| 10 | `server: npx prisma generate && tsc --noEmit` (`npm run typecheck`) | 0 | clean |
| 11 | `server: npm run server:test:non-disposable` | 0 | **68/68** |
| 12 | `npm run build` (root, after merge added `CalendarTimelineView.vitest.test.tsx`) | 0 | 23.43s |
| 13 | `npm run lint` | 2 | still confirmed non-functional (unchanged finding) |
| 14 | `npm run test:vitest` | 0 | **3 files, 35/35 tests** (was 2 files/29 before the main-reconciliation merge) |
| 15 | 7× frontend leaf scripts | 0 each | 156 assertions total, unchanged |
| 16 | `actionlint -color` (all 3 workflow files) | 0 | zero findings, after the Prisma-generate fix and new job |
| 17 | `git diff --check` | 0 | clean (one CRLF/LF advisory on the modified `.yml`/`.md`/`.json` files, expected on this Windows checkout, not part of the committed diff) |

### 17.8 The one local `postgres-compat` failure: root-caused, not a defect, expected to pass on Linux CI

`server:test:legacy-db-required`'s `test:clinic-bulk-export` member has one assertion, `status DTO never serializes sensitive fields`, that does `source.indexOf('res.json({\n      jobId: row.id,')` against the literal text of `server/src/routes/clinicBulkExport.ts`. This machine's git checkout has `core.autocrlf=true` (confirmed: `git config --get core.autocrlf` → `true`) and the file is confirmed on disk with CRLF line terminators (`file` reports "CRLF line terminators"). A direct Node reproduction proved the mechanism exactly:

```
CRLF-as-read indexOf (LF-only needle against a CRLF file): -1  (not found -> assertion fails)
LF-normalized indexOf (same content, \r\n -> \n):           10363 (found -> assertion passes)
```

This is a pre-existing property of the test file (an exact-whitespace source-text match) interacting with this one Windows machine's line-ending conversion — unrelated to F1-003-P3-R1's own changes, to the disposable-runtime infrastructure, or to any real defect in `routes/clinicBulkExport.ts`. GitHub Actions' `ubuntu-latest` checkout does not perform this conversion (no `core.autocrlf=true` is set there), so this exact assertion is expected to pass in real CI — confirmed against the actual new-head-SHA run in §17.9, not merely predicted. The test file was not modified, weakened, or skipped.

### 17.9 GitHub Actions evidence

**Run associated with the original P3 head SHA (`e99dd096d2d6d1222c9f7c7f59c0735ab4380979`, pre-R1) — historical, not acceptance evidence for this update:**

| Field | Value |
|---|---|
| Run ID | `30536185063` |
| URL | https://github.com/MustafaBasol/DisKlinikCRM/actions/runs/30536185063 |
| Event | `pull_request` |
| Status | `completed` |
| Conclusion | **`failure`** |
| Failing job | `ci-layers / Layer 2: non-disposable backend tests` — root-caused and fixed in §17.4 |
| Other jobs | Layer 1 (all 4): `success`; Layer 3: `success`; Layer 4: `success`; Layer 5 (frontend, original): `success` |

**Run associated with the new head SHA produced by this task's remediation push — the actual acceptance evidence:**

| Field | Value |
|---|---|
| Head SHA | `930cc70620c6431da9425df5d7ad3ee6971c156a` |
| Run ID | `30542271302` |
| URL | https://github.com/MustafaBasol/DisKlinikCRM/actions/runs/30542271302 |
| Status | `completed` (checked twice: initial run, then one `gh run rerun --failed` to distinguish a one-off flake from a deterministic result) |
| Overall conclusion | **`failure`**, both times |
| Layer 1 (all 4 jobs) | `success`, both times |
| Layer 2 (`non-disposable-backend-tests`) | **`success`** — confirms the §17.4 Prisma-generate fix works; this exact job failed on the pre-R1 run |
| Layer 3 (`disposable-postgres-tests`) | `success` |
| Layer 4 (`storage-integration-tests`) | `success` |
| Layer 5 frontend (`full-suite-compatibility-failsafe-frontend`) | `success` |
| Layer 5 backend (`full-suite-compatibility-failsafe-backend`, new) | **`failure`, reproducibly (2/2)** — see §17.10 |

`test:clinic-bulk-export` (the script with the Windows-local CRLF-only failure documented in §17.8) passed **117/117** on this real Linux run, confirming that root-cause hypothesis directly rather than merely predicting it.

### 17.10 New finding: a genuine, previously-invisible concurrency race in `test:retention-manual-run-audit` — not fixed, out of this task's scope

The one assertion that failed, both times, in `full-suite-compatibility-failsafe-backend`:

```
✗ concurrent live runs: the shared job lock serializes execution — only one run actually
  deletes; both attempts get their own started+terminal audit pair, the loser terminal is
  manual_run_blocked/concurrent_run_in_progress
      exactly one concurrent live run must execute (200) and the other must be rejected as
      already-in-progress (409)
      + actual - expected
        [ 200, +200 -409 ]
```

Both concurrent `POST /privacy/data-retention/run` requests returned `200` (both executed) instead of one `200` + one `409` — the shared job-lock did not serialize the two requests in this run's timing.

**Reproducibility:** `2/2` on GitHub Actions `ubuntu-latest` (the initial run and one `gh run rerun --failed`), `0/2` on this task's own local Windows + Docker Desktop environment (§17.7 command #4-5) — a genuine, deterministic environment-specific timing difference, not a one-off flake and not caused by this task's own CI wiring.

**Significance:** this is the **first time this script has ever executed against a live disposable PostgreSQL in any CI environment** — legacy `server:test` (which silently contains it) was never wired into any workflow before this task. This finding is a direct, positive consequence of this task's own closure work (§17.5) exposing a previously-invisible, pre-existing behavior — exactly the kind of thing a full-suite fail-safe exists to surface, and exactly why F1-003-P1 and F1-003-P2 each transparently reported the real bugs their own live-verification work found rather than hiding them.

**Why this task does not fix it:** the underlying job-lock/concurrency implementation lives in `server/src` (application runtime code); modifying it, or altering the test's own timing assumptions to make it pass, is explicitly outside F1-003-P3-R1's CI-workflow-only authorized scope ("do not modify application runtime," "do not weaken tests"). No application, lock, or test file was touched in response to this finding.

**Recommendation:** a separate, explicitly-authorized follow-up task should investigate the data-retention job-lock's concurrency guarantees under real concurrent HTTP load (not just this task's own scope), and/or evaluate this specific test against F1's own already-planned, not-yet-started backlog item 4 ("Flaky test tespiti ve karantina süreci" / flaky-test detection and quarantine).

**What this does and does not mean for this task's own acceptance:** the `full-suite-compatibility-failsafe-backend` job's own provisioning, migration, test-execution, and cleanup all worked exactly as designed — its own summary artifact shows `cleanup: {success:true, errors:[]}` even though the test phase itself failed, and 19 of that script's own 20 assertions (plus all 22 other scripts' assertions, ~745 total) passed. The CI-workflow implementation this task built is not the source of the one failing assertion; it is precisely what correctly surfaced it. This task's own overall CI conclusion is honestly reported as `failure` — it is not described as passing, and P4 remains blocked pending both external review and a resolution path for this new finding (which may be "accepted as a known, separately-tracked issue" — an external/product decision, not this task's own to make).

## §18. F1-003-P3-R2 — Main Reconciliation and Full-Green Layered CI Closure

Continued on the existing open PR #268 branch `feature/f1-003-p3-layered-ci-workflows` — no new branch, no new PR, not merged, not rebased, not force-pushed.

**Background this task closes:** §17.10 above (the `p3r1NewFindingRetentionLockRace` finding) was root-caused and fixed by a separate, explicitly-authorized task in two increments — **F1-003-B2** (initial fix: reorder `acquireJobLock` ahead of the two variable-latency DB round trips the manual route previously performed first) and **F1-003-B2-R1** (closed a residual admission-timing gap by moving lock acquisition ahead of the policy read too, via a new exported `createDataRetentionRunHandler` factory and a deterministic barrier-based concurrency test) — both merged to `main` as **PR #280** (merge commit `c68317f76bd682381864e895de5a784e54b90538`). This task's job was to reconcile PR #268 with that now-considerably-advanced `main`, preserve everything accepted since the original P3 baseline, and obtain a genuine, fully-green layered-CI run on the reconciled head.

**§18.1 Pre-flight, independently re-verified (not assumed from the prompt):** `git fetch origin --prune`; `origin/main` = `c68317f76bd682381864e895de5a784e54b90538` (exact match to the prompt's supplied value); old PR head = `e292e677b4065af098cf8b0b8a6688c4e31ae04f` (exact match); merge-base = `cc31aeb7a0c379a641e7ab4558031e9adcdf1e59` (exact match); `git rev-list --left-right --count` confirmed 61 ahead / 4 behind for `origin/main...origin/feature/f1-003-p3-layered-ci-workflows` (branch 4 ahead, 61 behind — exact match). `gh pr view 268` confirmed `state: OPEN`, `mergeable: CONFLICTING`, `mergeStateStatus: DIRTY`, and the exact same 8-pass/1-fail `statusCheckRollup` the prompt described. `git log --graph` on `origin/main` independently confirmed the PR #280 merge commit, the PR #282 dependency-remediation merge commit (`fix/npm-audit-nonbreaking-remediation`), and all four F2-PREP merge commits (#276/#279/#277/#278) are present and reachable from `origin/main`.

**§18.2 Worktree/primary-tree protection:** the primary working tree (`E:\Ek Gelir\Siteler\DisKlinikCRM-git`) was on an unrelated already-merged branch (`claude/treatment-proposal-pdf-p1-d4k0jl`, clean) and was never touched. A pre-existing isolated worktree for `feature/f1-003-p3-layered-ci-workflows` (created by the original F1-003-P3 task) was reused rather than duplicated, after confirming its `HEAD` matched the observed old PR head exactly and its only local state was one untracked, non-tracked leftover summary artifact from a prior local test run (never committed).

**§18.3 Inspection before merge:** `git diff --stat/--name-status origin/main...HEAD` confirmed PR #268's own diff is exactly the 15 files the original P3/P3-R1 work produced (3 workflow files, 2 evidence files + JSON, 4 program docs, `package.json`/`server/package.json`, 4 `scripts/test-runtime` files) — **no overlap at all** with `server/src/routes/platformAdmin.ts`, `server/src/utils/jobLock.ts`, or `server/src/tests/retentionManualRunAudit.test.ts` (PR #268 never touched those files; the retention fix lives entirely in PR #280's own history). Diffing `origin/main` since the old merge-base confirmed exactly which files changed there: the same three retention-fix files, `server/package.json`, and the F2-PREP evidence docs/tracker/phase-doc/README — a large, disjoint set of unrelated feature work (external-calendar/DigiDentiS integration, treatment-proposal PDF, calendar timeline view, etc.) was also present on `main` via other merged PRs but touched none of PR #268's own files, so no additional conflict risk existed beyond the 5 files ultimately reported by `git merge`.

**§18.4 Reconciliation merge — `git merge --no-ff origin/main`, merge commit `6da0bf43234e2dbb0b7ef1a4db80090e12a047b6`, exactly 5 conflicts, all resolved manually (no `--ours`/`--theirs`):**

1. **`docs/program/CURRENT_PHASE.md`** — both branches had independently prepended their own newest-first log entry onto an identical shared tail (verified byte-identical via `diff` on the tail from the shared "F1-003-P2-R3" entry onward). PR #268's own entry (`F1-003-P3-R1`, dated 2026-07-30) and main's two newer entries (`F1-003-B2-R1`/`F1-003-B2`, dated 2026-08-02) both needed to survive. **Resolution:** layered chronologically — main's `F1-003-B2-R1` became the new `Son güncelleme` (top), `F1-003-B2` next, then PR #268's own `F1-003-P3-R1` (its label demoted from `Son güncelleme` to `Prior update`) and `F1-003-P3` below that, all above the untouched shared tail. **Why this preserves current authoritative state:** the most current fact (main's B2/B2-R1 retention-lock closure) is on top, exactly as a reader needs; PR #268's own historical P3-R1 narrative is preserved verbatim, not deleted or overwritten — satisfying "do not restore stale tracker/current-phase text from the PR branch" while still keeping the PR's own history intact.
2. **`docs/program/NORAMEDI_MASTER_TRACKER.md`** — identical structural conflict at the top log entries; resolved the same way. A second, non-conflicting spot further down (the `F1` phase summary row) had auto-merged to PR #268's own updated text (main's own diff never touched that row), which was itself still stale relative to the true post-B2/B2-R1 state — corrected explicitly in §18.9 below, not left stale.
3. **`docs/program/evidence/README.md`** — both branches appended one new table row each at the identical insertion point (PR #268: the P3/P3-R1 evidence row; main: the B2 and B2-R1 evidence rows). **Resolution:** kept all three rows — PR #268's first, then main's two — a purely additive conflict with zero overlapping content.
4. **`docs/program/phases/F1_CI_AND_TEST_ARCHITECTURE.md`** — two independent additive conflicts at the same two locations both branches touched: (a) a new subsection block (PR #268: `#### F1-003-P3` + `#### F1-003-P3-R1`; main: `#### F1-003-B2` + `#### F1-003-B2-R1`) inserted at the identical point before `## Required evidence`; (b) one new change-history table row appended by each branch at the identical point at the end of that table. **Resolution:** for both, concatenated PR #268's content first, then main's, matching real chronological order (P3/P3-R1 on 2026-07-30 precede B2/B2-R1 on 2026-08-02). The file's own top `Faz durumu` line and several status-table rows (lines 1–178 in the pre-merge diff) had already been updated by PR #268 alone — main's own diff carried no hunk there — so git's three-way merge resolved those automatically with no conflict.
5. **`server/package.json`** — both branches added new keys inside the same `scripts` object. PR #268 added `server:test:legacy-db-required` (its own P3-R1 closure). Main expanded `server:test:non-disposable` and `server:test:disposable-db` with new members (`test:treatment-proposal-pdf`, `test:treatment-proposal-pdf-route`, six `test:external-calendar-*`/`test:digidentis-*` scripts, `test:external-calendar-outbound-sync-atomicity`) and added the two new leaf script definitions themselves. **Resolution:** kept main's fully expanded `server:test:non-disposable`/`server:test:disposable-db` (every new test main added is preserved) and its two new leaf scripts, and added PR #268's own `server:test:legacy-db-required` unchanged as an additional key — no script definition from either side was dropped, shortened, or altered. Validated as syntactically valid JSON post-resolution.

**Post-merge verification, all required by the task and all passed:** `git status --short` clean except the one pre-existing untracked local artifact (never staged); `git diff --check` exit `0` (no whitespace-conflict residue); `git merge-base --is-ancestor origin/main HEAD` exit `0` (ancestry proof); `git log -1 --oneline` confirms the merge commit; `git show --stat --oneline --summary HEAD` confirms 15 PR-268-owned files plus the full set of files `main` had accumulated since the old merge-base (F2-PREP evidence docs, the external-calendar/DigiDentiS feature tree, `server/prisma/schema.prisma` + 3 new migrations, the retention-lock fix files, `package-lock.json`/`server/package-lock.json`).

**§18.5 Preservation proof:**
- **PR #280's retention fix:** `server/src/routes/platformAdmin.ts`, `server/src/utils/jobLock.ts`, and `server/src/tests/retentionManualRunAudit.test.ts` were never touched by PR #268's own diff, so the merge brought them in from `main` byte-for-byte, unmodified by this task. Directly re-verified (§18.7 below) with 5 consecutive fresh test runs.
- **PR #282's dependency remediation:** `npm ci` at both the repo root and in `server/` completed with exit `0` and mutated zero tracked files (`git status --short` after each showed nothing for `package.json`/`package-lock.json`), confirming the lockfiles main carried forward from PR #282 remained authoritative and were not rewritten.
- **F2-PREP-001 through F2-PREP-004:** all four evidence `.md`/`.json` pairs are present in the merged tree (confirmed via `git show --stat` on the merge commit) and were not opened, edited, or referenced by this task beyond confirming their continued presence — their own accepted findings are untouched.
- **F2-PREP-005 was not started, referenced as scope, or scaffolded by this task.**

**§18.6 Local CI-equivalent validation, every PR #268 CI job re-executed for real:**

| Layer | Command(s) | Working dir | Exit code | Result | Disposable infra |
|---|---|---|---|---|---|
| 1 (build) | `npm run build` | root | 0 | clean build, no tracked-file mutation | no |
| 1 (server typecheck) | `npm run typecheck` (`npx prisma generate && tsc --noEmit`) | server | 0 | clean | no |
| 1 (tooling typecheck+unit) | `npm run typecheck:runtime`, `npm run test:runtime:unit` | root | 0 | **74/74** | no |
| 1 (syntax) | actionlint v1.7.12 (windows_amd64, checksum-verified `6e7241b5...`), `bash -n` ×2, PowerShell `Parser::ParseFile` ×2, JSON validation ×2 | root | 0 (all) | 0 findings | no |
| 2 | `npm run server:test:non-disposable` | server | 0 | 68 member scripts, 0 failure markers | no |
| 3 | `npm run test:runtime:postgres` | root | 0 | `server:test:disposable-db` 9/9, cleanup `success:true` | yes (postgres) |
| 4 | `npm run test:runtime:storage` | root | 0 | `server:test:storage-integration` 21/21, cleanup `success:true` | yes (postgres+minio) |
| 5 (frontend) | 7 leaf scripts + `npm run test:vitest` | root | 0 (all) | 156 leaf assertions + **7 files/64 vitest tests** (grew from 3 files/35 pre-reconciliation — main added new `PatientDetail`/`AppointmentDetail`/`TreatmentCaseDetail` vitest suites) | no |
| 5 (backend) | `npm run test:runtime:postgres-compat` | root | 1 | 116/117 — see §18.7 | yes (postgres) |
| regression | `npm run test:runtime:parallel` (verify-parallel) | root | 0 | collisionCheck all 4 fields `true`, exactly 1 "Generated Prisma Client" line, 0 `EBUSY`, zero residual resources | yes (2×postgres+2×storage) |
| regression | `npm run test:runtime:cleanup-stale -- --live --ttl-hours=0.01` | root | 0 | 0 candidates | no |
| non-CI, confirmatory | `npm run lint` | root | 0 | still confirmed non-functional (no `eslint.config.js`), unchanged from prior findings | no |

**§18.7 The Layer-5-backend local-only environment finding, reproduced and classified, not hidden:** `server:test:legacy-db-required` is a shell `&&`-chained aggregate of 23 scripts. Its 10th member, `test:clinic-bulk-export`, has one assertion (`status DTO never serializes sensitive fields`) that fails **only on this Windows machine** because `core.autocrlf=true` checks `server/src/routes/clinicBulkExport.ts` out as CRLF while the test performs an exact LF-based substring match — independently re-confirmed via `git ls-files --eol` showing `i/lf w/crlf` on that exact file, the same root cause F1-003-P3-R1 already documented (§17.8 above) for the same test. **This is not a regression from this task's reconciliation** — reproduced twice, both times stopping at the identical assertion. Because the aggregate is `&&`-chained (not a test-runner suite that continues past one failing member), this pre-existing Windows-local artifact prevented the chain from ever reaching `test:retention-manual-run-audit` (member 23, last) **on this local machine** — it does not fail or skip the retention test; it simply never gets the chance to run it locally. GitHub Actions' `ubuntu-latest` runners do not perform this CRLF conversion, so the real CI run (§18.10 below) executes the full 23-script chain, including the retention test, without this artifact.

**§18.8 Retention concurrency, proven directly (not merely inferred from the environment finding above):** with the local aggregate structurally unable to reach the retention test, `test:retention-manual-run-audit` was run **directly, 5 consecutive times**, against a disposable PostgreSQL container manually provisioned to exactly mirror the accepted `scripts/test-runtime/lib/postgres.ts` convention (identical digest-pinned image `postgres@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777`, identical `com.noramedi.test-runtime=true`/`test-run-id`/`test-profile`/`test-created-at`/`test-task` labels, `prisma migrate deploy` applying all 67+3 migrations including the 3 main brought in). **Result: 29/29 assertions, exit `0`, all 5 runs.** Post-run direct SQL inspection (`psql`) confirmed **0** residual `JobLock` rows and **0** residual `OperationalEvent` rows — no orphaned lock, no leftover race-gate marker. The manual container was then removed and the label-scoped filter confirmed zero remaining resources. This directly re-confirms PR #280's fix (both the initial B2 reordering and the B2-R1 admission-point closure) holds unchanged after this reconciliation, independent of the local CRLF-caused chain interruption.

**§18.9 Program documentation corrected in this same commit:** `NORAMEDI_MASTER_TRACKER.md`'s `F1` phase summary row (previously reflecting only the pre-B2 P3-R1 state, per §18.4 item 2 above) rewritten to state the true current status — PR #280 merged (B2 + B2-R1 retention-lock closure), current-main reconciliation complete (0 unresolved conflicts, 5 resolved), and the real, fully-green GitHub Actions result from §18.10. `CURRENT_PHASE.md` and `phases/F1_CI_AND_TEST_ARCHITECTURE.md` both received a new top-of-log entry for this task. R-070/R-046/R-071/G1/G2/KVKK-freeze status lines were carried forward unchanged in every updated document — this task did not touch, resolve, or reinterpret any of them.

**§18.10 GitHub Actions, the actual new-head run, checked and re-checked (not predicted):** pushed to the existing branch; new head `6da0bf43234e2dbb0b7ef1a4db80090e12a047b6`; `gh pr view 268` confirmed `headRefOid` matches exactly and `mergeable` flipped from `CONFLICTING` to `MERGEABLE`. Run `30747523882` (event `pull_request`, `headSha` verified equal to the pushed head) watched via `gh pr checks --watch` to genuine terminal completion — **all 9 expected jobs `success`, overall run `conclusion: success`:**

- Layer 1 frontend typecheck+build — success, 41s
- Layer 1 server typecheck — success, 52s
- Layer 1 tooling typecheck+unit — success, 22s
- Layer 1 workflow/syntax validation — success, 9s
- Layer 2 non-disposable backend tests — success, 1m17s
- Layer 3 disposable PostgreSQL tests — success, 5m0s
- Layer 4 disposable PostgreSQL+MinIO tests — success, 34s
- Layer 5 full-suite/compatibility fail-safe (frontend) — success, 26s
- **Layer 5 full-suite/compatibility fail-safe (backend, legacy `server:test` DB-required members) — success, 5m54s** — the exact job that previously failed with the retention-concurrency race (§17.9–§17.10 above); it now passes on real, unmodified GitHub Actions infrastructure, confirming PR #280's fix through the actual CI-reachable path this task's own reconciliation restores.

No job was skipped, cancelled, or left queued. `gh api graphql` against `reviewThreads` returned zero threads (none to resolve or leave open). `REMOTE_CI_VERIFIED` is genuinely established for head `6da0bf43234e2dbb0b7ef1a4db80090e12a047b6`.

**§18.11 What this task does not claim:** PR #268 merged; F1 phase complete; F1-003 parent complete (P4 not started); production deployed or verified; R-070/R-046/R-071 status changed; G1/G2 approved; KVKK freeze lifted; F2-PREP-005 started. **Task status: agent completed yes; current-main reconciled yes (5 conflicts, all resolved manually); PR #280's retention-lock fix preserved and directly re-verified yes (5/5 runs, 29/29 each); dependency remediation and F2-PREP-001..004 preserved yes; local CI-equivalent validation passed yes (all commands above); zero residual disposable Docker/network/volume resources throughout yes; pushed to the existing branch yes; real GitHub Actions run on the new head fully green, 9/9 jobs, confirmed by direct terminal-state inspection yes; merged no; deployed no; production verified no — `AGENT_COMPLETED` / `TESTS_PASSED` / `REMOTE_CI_VERIFIED` / `PR_OPENED_AWAITING_REVIEW`.** **Exact next task:** F2-PREP-005 (Consolidated Modularization Charter) remains next-after-F1, **not started, not authorized to start by this entry** — it is gated on the user reviewing and merging PR #268, plus reviewing post-merge `main` CI evidence, neither of which this task performs.

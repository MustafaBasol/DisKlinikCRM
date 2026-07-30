# F1-003-P3 — Layered CI Workflows and Full-Suite Fail-Safe: Implementation and Verification

**Status: `AGENT_COMPLETED` — implementation complete, locally validated, PR opened, not merged. Maximum status: `AGENT_COMPLETED` / `PR_OPENED_AWAITING_REVIEW`.**

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

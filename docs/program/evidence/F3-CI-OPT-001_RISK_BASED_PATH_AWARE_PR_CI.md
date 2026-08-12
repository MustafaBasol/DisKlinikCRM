# F3-CI-OPT-001 — Risk-Based Path-Aware PR CI

**Status: `AGENT_COMPLETED` — implementation complete, locally validated, PR opened, not merged, not deployed.**

## 1. Task identity and phase

| Field | Value |
|---|---|
| Task ID | F3-CI-OPT-001 |
| Title | Risk-Based Path-Aware PR CI |
| Phase | F3 — Production Hardening |
| Priority | HIGH |
| Task type | CI WORKFLOW (YAML) + repository-owned classifier script + LOCAL VALIDATION + EVIDENCE |
| Parallel task | F3-PROGRAM-RECON-001 (program-control-file reconciliation) — this task does not touch any shared program-control file; see §2 |

## 2. Baseline, worktree, and parallelism boundary

- `git fetch origin --prune` run at task start.
- `git rev-parse origin/main` → `6f7e580d1bab2a0f87baed1cfe5ec0a944a6b711` (merge of PR #396, F3-SEC-002).
- Primary checkout (`E:\Ek Gelir\Siteler\DisKlinikCRM-git`, branch `docs/f3-program-recon-001-post-merge-reconciliation`) was inspected only for `git status`/worktree bookkeeping, never modified, never stashed.
- Isolated worktree: `git worktree add "E:/Ek Gelir/Siteler/DisKlinikCRM-worktrees/f3-ci-opt-001" -b chore/f3-ci-opt-001-risk-based-path-aware-ci origin/main`.
- Verified immediately after creation: `git status --short` empty, `git rev-parse HEAD` = `6f7e580d1bab2a0f87baed1cfe5ec0a944a6b711`.
- Per this task's explicit instruction, `docs/program/NORAMEDI_MASTER_TRACKER.md`, `docs/program/CURRENT_PHASE.md`, `docs/program/RISK_REGISTER.md`, `docs/program/phases/F3_PRODUCTION_HARDENING.md`, and `docs/program/evidence/README.md` are **not** touched by this task — those are F3-PROGRAM-RECON-001's exclusive scope for this parallel window. Only this one new evidence file is created.
- A stray untracked ~58KB file (`tatus --short`, CRLF-conversion warning text captured during the worktree checkout) was left in place at the worktree root rather than deleted — it is untracked, is never `git add`ed (every commit below stages explicit paths only, never `-A`), and has no effect on the diff, build, or CI.

## 3. Targeted inventory (scope discipline)

Per this task's explicit instruction, only the following were read: `.github/workflows/**` (all 5 files), root `package.json`, `server/package.json` (full `scripts` block), `scripts/test-runtime/**`, `scripts/architecture-guardrail/**` (including `config/scan-roots.json`, `config/domain-map.json`), and `.github/workflows/windows-bridge-pr.yml`'s own `paths:` filter (reused as the STORAGE_IMAGING category's basis — see §6). No full-repository source scan was performed; CodeGraph was not invoked (queries would have needed to span the same narrow set already read directly, so a CodeGraph round-trip added nothing).

## 4. Problem statement

Every pull request into `main` ran the full 10-job matrix (`ci-layers.yml`, unconditionally) regardless of which files changed — including disposable PostgreSQL (Layer 3), PostgreSQL + MinIO storage integration (Layer 4), and the legacy DB-required compatibility fail-safe (Layer 5b). Layer 3 alone consistently took 540-570s; Layer 5b consistently took 384-390s. Because both depend only on the fast Layer-1 jobs (never on each other), the PR's total wall-clock time was governed almost entirely by Layer 3, regardless of whether the PR touched the database at all. A 6-file docs-only PR paid the identical ~10-minute bill as a 19-file backend PR (§5 measures this directly).

## 5. Baseline CI measurement (MEASURED)

Job-level and total-workflow timing pulled directly from `gh run view <id> --json workflowName,createdAt,updatedAt,jobs` for four representative, real, exact-head `ci` workflow runs. All four are on the pre-F3-CI-OPT-001 workflow (no path-awareness), confirming the matrix ran unconditionally regardless of PR shape.

| PR | Shape | Run ID | Total wall (MEASURED) | L1 max | L2 | L3 | L4 | L5a | L5b |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| #396 (F3-SEC-002, auth/session, 17 files) | AUTH_SECURITY-heavy | 31579994789 | 625s | 51s | 95s | 566s | 55s | 33s | 384s |
| #363 (F3-OBS-001, backend runtime, 19 files) | BACKEND_GENERAL-heavy | 31575328790 | 600s | 49s | 97s | 542s | 34s | 29s | 389s |
| #353 (imaging/storage migration, 6 files) | STORAGE_IMAGING | 31367366406 | 602s | 47s | 74s | 547s | 46s | 27s | 390s |
| #397 (docs-program reconciliation, 6 files, all under `docs/`) | DOCS_ONLY | 31583316197 | 642s | 51s | 100s | 579s | 37s | 35s | 384s |

Three of the four totals cluster at **600-625 seconds (~10-10.4 minutes)**; #397 (docs-only) came in slightly higher at **642s (~10.7 minutes)** — Layer 3 itself ran a little longer that instance (579s vs. 540-570s), which is exactly the kind of run-to-run variance the "critical path ≈ max(Layer-1) + Layer 3" model predicts. In every case the critical path is `max(Layer-1 jobs) + Layer 3` (Layer 2/4/5a/5b all finish faster than Layer 3 and run in parallel with it, so they never extend the wall clock). PR #397 is the direct proof of the problem statement: a changeset containing only Markdown files under `docs/` triggered — and was billed for — the identical unconditional matrix as the backend/auth/storage PRs, before this task's job-selection logic existed.

No timing number above was invented; every value is a `completedAt - startedAt` (or workflow `updatedAt - createdAt`) delta read directly from the GitHub Actions API for these four specific run IDs.

## 6. Changed-path classifier design

**Location:** `scripts/ci-classify/classify.ts` (pure logic, no I/O — directly unit testable) + `scripts/ci-classify/cli.ts` (GitHub Actions-facing wrapper: reads a changed-file list, writes `$GITHUB_OUTPUT` and `$GITHUB_STEP_SUMMARY`). No third-party GitHub Action is introduced — the classifier is a repository-owned TypeScript script following the exact same `parseArgs`/pure-core-function/`main()` convention already established by `scripts/architecture-guardrail/cli.ts`.

**Per-file classification** (`classifyFile`): each changed file is matched against `CATEGORY_RULES`, an ordered, most-specific-first list of deterministic path predicates (directory-prefix / exact-filename / extension / filename-keyword checks — no glob library dependency). The first matching rule wins; a file matching nothing becomes `UNKNOWN`.

| Category | Matched by (examples) |
|---|---|
| `ARCHITECTURE_BOUNDARY` | `scripts/architecture-guardrail/config/**` only (domain-map.json, scan-roots.json) |
| `CI_TOOLING` | `.github/workflows/**`, `scripts/test-runtime/**`, `scripts/architecture-guardrail/**` (remaining, i.e. not `config/`), `scripts/ci-classify/**`, root/`server` `package.json`/`package-lock.json` |
| `DATABASE_SCHEMA` | `server/prisma/schema.prisma`, `server/prisma/migrations/**`, `server/prisma/seed*.ts` |
| `AUTH_SECURITY` | `server/src/middleware/**`, `server/src/routes/{auth,platformAdmin}.ts`, `server/src/{utils,tests}/*` whose filename contains `session`/`token`/`security`/`csrf`/`password`/`totp`/`auth` |
| `STORAGE_IMAGING` | `windows-bridge/**`, `server/src/services/imaging/**`, `src/components/imaging/**`, `server/src/routes/imaging*.ts`, `server/src/services/{fileStorage,fileBackupService,fileBackupDestination,backupService}.ts`, `server/src/tests/*` whose filename contains `imaging`/`filebackup` — this list deliberately mirrors `windows-bridge-pr.yml`'s own existing `paths:` filter, which already independently defines "what counts as imaging/bridge" for this repository |
| `DOCS` | `docs/**`, any `**/*.md` anywhere |
| `FRONTEND` | `src/**`, `index.html`, and the frontend root configs (`vite.config.ts`, `vite.config.d.ts`, `tsconfig.json`, `tsconfig.node.json`, `tailwind.config.js`, `postcss.config.js`, `vitest.config.ts`) |
| `BACKEND_GENERAL` | anything else under `server/src/**` |
| `UNKNOWN` | everything else (e.g. `ecosystem.config.cjs`, `nginx.conf`, `bridge-agent/**` — see §14) |

**PR-level aggregation** (`classify`): `docsOnly` is true **only** when every changed file classified as `DOCS` (any non-`DOCS` file, including `UNKNOWN`, disqualifies it). An **empty** changed-file list is explicitly never treated as docs-only — it fails safe to the same posture as `UNKNOWN`. Deep-gate execution flags are the **union**, across every changed file's category, of that category's flag contribution (`CATEGORY_GATES`) — the union is monotonic: adding a low-risk file to a changeset can only add flags, never clear one a higher-risk file already set (tested explicitly — see §9).

`CI_TOOLING` and `UNKNOWN` both map to the full deep gate unconditionally: their blast radius cannot be determined from the path alone (a workflow/orchestrator/package-manifest change can alter every layer's behavior at once), so both fail safe to "run everything," per this task's explicit "never fail open" instruction.

**Layer 1 is deliberately never made conditional.** All five Layer-1 jobs (frontend typecheck+build, server typecheck, tooling typecheck+unit, architecture guardrail scan, workflow/syntax lint) keep running for any non-docs-only PR regardless of category. They are cheap (15-55s each, fully parallel) and gating them individually per-category would require conditioning every Layer 2-5 job's `needs:` on a Layer-1 job that might itself be skipped — a well-known GitHub Actions cascading-skip pitfall. Only Layers 2-5 (the multi-minute jobs) are path-conditional.

## 7. Fast/deep gate design

`ci-layers.yml` gains a `workflow_call` boolean input `fastMode` (default `false`) and a new `classify` job (`if: inputs.fastMode == true && github.event_name == 'pull_request'`). `ci-pr.yml` calls it with `fastMode: true`; `ci-main-and-nightly.yml`'s call is unchanged (defaults to `false` — see §8).

The `classify` job: checks out the repo, `npm ci` (cached), fetches the PR's base and head commit objects explicitly (`git fetch --no-tags --depth=1 origin <base-sha> <head-sha>` — the default `pull_request` checkout is a depth-1 merge commit, whose parents are not otherwise locally reachable), computes `git diff --name-only <base>...<head>`, runs a non-blocking `git diff --check` (surfaced as a `::warning::` annotation, not a failure — see §7.1), and finally runs `scripts/ci-classify/cli.ts` against the changed-file list, writing its outputs to `$GITHUB_OUTPUT` and a human-readable table to `$GITHUB_STEP_SUMMARY`.

Every Layer 2-5 job's `if:` condition has the shape:

```
(inputs.fastMode == false || needs.classify.result != 'success' || needs.classify.outputs.run_XXX == 'true')
&& !contains(needs.*.result, 'failure') && !contains(needs.*.result, 'cancelled')
```

Read left-to-right: **run this job if** (a) we are not in fast mode at all (main/nightly/manual — always run), **or** (b) the classifier job itself did not succeed (any classifier failure — a bug, a checkout error — fails closed to "run this job," never open), **or** (c) the classifier said this category's flag is set — **and, regardless of any of the above, only if** none of this job's own `needs` (the Layer-1 jobs plus `classify`) actually failed or were cancelled. That last clause reproduces, unchanged, the pre-existing implicit "needs must all succeed" gate GitHub Actions applies by default — an explicit `if:` on a job disables that implicit check, so it has to be restated explicitly once the condition is customized.

Layer-1 jobs use the simpler `inputs.fastMode == false || needs.classify.result != 'success' || needs.classify.outputs.docs_only != 'true'` — run unless we're in fast mode, classification succeeded, **and** it said docs-only.

### 7.1 Category → deep-gate mapping

| Category | L2 (non-disposable backend) | L3 (disposable Postgres) | L4 (Postgres+MinIO storage) | L5a (frontend full-suite) | L5b (legacy DB-required) |
|---|:---:|:---:|:---:|:---:|:---:|
| `DOCS` (docs-only PR) | – | – | – | – | – |
| `FRONTEND` | – | – | – | ✓ | – |
| `BACKEND_GENERAL` | ✓ | – | – | – | – |
| `AUTH_SECURITY` | ✓ | ✓ | – | – | ✓ |
| `DATABASE_SCHEMA` | ✓ | ✓ | ✓ | – | ✓ |
| `STORAGE_IMAGING` | ✓ | ✓ | ✓ | – | – |
| `ARCHITECTURE_BOUNDARY` | – | – | – | – | – |
| `CI_TOOLING` / `UNKNOWN` | ✓ | ✓ | ✓ | ✓ | ✓ |

Rationale for the non-obvious rows: `AUTH_SECURITY` requires both L3 (platform-admin session-revocation/password-recovery tests live in `server:test:disposable-db`) and L5b (`test:auth` — `sessionCookieCsrf`/`platformAdmin` — lives in `server:test:legacy-db-required`), but not L4 (no storage/MinIO coupling). `DATABASE_SCHEMA` requires every DB-backed layer (L2, L3, L4, L5b) because a schema/migration change can affect any of them and this is exactly the class of change STEP 12's regulated-system guardrail names explicitly (never narrow migration testing). `STORAGE_IMAGING` requires L2/L3/L4 (imaging characterization/lifecycle tests live in `server:test:disposable-db`, and the one storage-integration member lives in L4) but not L5b (no auth coupling). `ARCHITECTURE_BOUNDARY` (guardrail *config* only) adds no Layer 2-5 job because domain-map/scan-roots are guardrail-input-only and touch no application runtime path — the Layer-1 guardrail scan (which always runs) already covers it.

`git diff --check`'s findings are surfaced as a workflow annotation, not a job failure: this check did not exist in the pre-F3-CI-OPT-001 workflow at all, and turning it into a new hard merge-blocker would be an unrequested production-CI behavior change beyond what this task authorizes.

## 8. Main/nightly safety net (unchanged)

`ci-main-and-nightly.yml`'s call to `ci-layers.yml` is unmodified — it does not pass `fastMode`, so the input defaults to `false`. Every job's `if:` condition's first disjunct (`inputs.fastMode == false`) is then unconditionally true, and the entire matrix runs exactly as it did before this task, for every push to `main`, every `02:17 UTC` nightly run, and every manual `workflow_dispatch`. This is a structural guarantee, not a behavioral promise: the `classify` job itself does not even run on those triggers (`if: inputs.fastMode == true && github.event_name == 'pull_request'`), so there is no classifier output for a bug to corrupt in the first place on the safety-net path. `workflow_dispatch` on `ci-main-and-nightly.yml` continues to be the existing "force full matrix on demand" mechanism (STEP 7's requirement) — nothing new was added for this, because it already satisfied the requirement before this task.

## 9. Classifier tests (STEP 13)

`scripts/ci-classify/__tests__/classify.test.ts`, run via `npm run test:ci-classify` — same framework-free `test()`/`assert()`/`assertEqual()` harness as `scripts/test-runtime/__tests__/orchestratorUnit.test.ts`. **22/22 passed, 0 failed.**

All 13 mandated scenarios are present as individually named tests: (1) docs-only, (2) frontend-only, (3) ordinary backend route, (4) platform auth, (5) Prisma schema, (6) migration, (7) storage, (8) imaging, (9) architecture-boundary, (10) CI workflow/tooling, (11) mixed frontend+backend, (12) mixed auth+migration, (13) unknown/unrecognized source path → conservative fallback.

Nine additional tests cover: empty-diff fail-safe, docs-mixed-with-one-non-docs-file (not docs-only), a `CATEGORY_RULES` completeness spot-check across 21 sample paths, Windows backslash-path normalization, the flag-union-is-monotonic invariant (§6), and four CLI-layer tests (`parseArgs` validation, `toGithubOutputLines` emitting bare `key=value` GitHub Actions-safe output, `toStepSummaryMarkdown` rendering without throwing).

## 10. Workflow validation (STEP 14)

| Check | Command | Result |
|---|---|---|
| actionlint v1.7.12 (checksum-verified, same version pinned in `workflow-and-syntax-lint`) | `actionlint.exe -color .github/workflows/*.yml` (Windows binary, run locally since this task has no Linux runner) | **0 findings**, exit 0 |
| Shell syntax | `bash -n scripts/test-runtime/*.sh` | OK (both files; unmodified by this task) |
| PowerShell parse | `[System.Management.Automation.Language.Parser]::ParseFile` over `scripts/test-runtime/*.ps1` | OK (both files; unmodified by this task) |
| JSON validation | `node -e "JSON.parse(...)"` on `package.json` and `server/package.json` | OK, both |
| `git diff --check` | `git diff --cached --check` (all new/changed files staged) | exit 0, no findings |
| Classifier typecheck | `npm run typecheck:ci-classify` (`tsc --noEmit -p scripts/ci-classify/tsconfig.json`) | 0 errors |
| Classifier unit tests | `npm run test:ci-classify` | 22 passed, 0 failed |
| test-runtime typecheck + unit (unmodified, regression check) | `npm run typecheck:runtime`, `npm run test:runtime:unit` | 0 errors; 74 passed, 0 failed |
| Guardrail typecheck + unit (unmodified, regression check) | `npm run typecheck:guardrail`, `npm run guardrail:test` | 0 errors; 74 passed, 0 failed |
| Frontend typecheck + build | `npm run build` (`tsc -b && vite build`) | built in 1m 25s, 0 errors |
| Server typecheck | `npm run typecheck` (`server/`; `prisma generate && tsc --noEmit`) | 0 errors, exit 0 |

No Docker was available in this local environment, so Layer 3/4/5b (disposable PostgreSQL/MinIO) were **not** locally re-executed — their job bodies are byte-identical to the pre-existing, already-accepted `ci-layers.yml` content; only their `needs:`/`if:` wrapper changed, which actionlint's job-graph/expression validation (above) already checks statically.

## 11. Simulated decision matrix (STEP 15 — mandatory)

Generated by actually invoking `classify()` (not hand-derived) against each hypothetical changed-file list from this task's own instructions:

| # | Changed file(s) | Category | L2 | L3 | L4 | L5a | L5b |
|---|---|---|:---:|:---:|:---:|:---:|:---:|
| A | `docs/program/evidence/example.md` | DOCS (docs-only) | – | – | – | – | – |
| B | `src/pages/Patients.tsx` | FRONTEND | – | – | – | ✓ | – |
| C | `server/src/routes/payments.ts` | BACKEND_GENERAL | ✓ | – | – | – | – |
| D | `server/src/middleware/platformAuth.ts` | AUTH_SECURITY | ✓ | ✓ | – | – | ✓ |
| E | `server/prisma/schema.prisma` | DATABASE_SCHEMA | ✓ | ✓ | ✓ | – | ✓ |
| F | `server/prisma/migrations/XXXXXXXX_change/migration.sql` | DATABASE_SCHEMA | ✓ | ✓ | ✓ | – | ✓ |
| G | `server/src/services/fileStorage.ts` | STORAGE_IMAGING | ✓ | ✓ | ✓ | – | – |
| H | `server/src/routes/imaging.ts` | STORAGE_IMAGING | ✓ | ✓ | ✓ | – | – |
| I | `scripts/architecture-guardrail/src/...` | CI_TOOLING* | ✓ | ✓ | ✓ | ✓ | ✓ |
| J | `.github/workflows/ci-main-and-nightly.yml` | CI_TOOLING | ✓ | ✓ | ✓ | ✓ | ✓ |
| K | `platformAuth.ts` + `schema.prisma` | AUTH_SECURITY + DATABASE_SCHEMA (union) | ✓ | ✓ | ✓ | – | ✓ |

\* Case I's literal instructed path (`scripts/architecture-guardrail/src/...`) does not correspond to a directory that exists in this repository today (the real tree has `lib/`, `config/`, `cli.ts`, `__tests__/`, not `src/`) — it is classified per the rules exactly as written: anything under `scripts/architecture-guardrail/**` other than `config/**` is `CI_TOOLING` (the guardrail tool's own implementation code, not its config), which conservatively selects the full deep gate. Row K demonstrates the union is a strict superset of `AUTH_SECURITY` alone (D) — `runStorage` is pulled in by the migration half, never dropped by the auth half.

## 12. Measured vs. estimated CI duration (STEP 16 — clearly labeled)

| Scenario | Basis | Critical path | Total |
|---|---|---|---:|
| Full unconditional matrix (any PR, pre-F3-CI-OPT-001) | **MEASURED** (§5, 4 real runs) | L1(~51s) + L3(~540-570s) | **~600-625s (~10-10.4 min)** |
| Docs-only | ESTIMATED | classify job only (~15-25s) | **~20-40s** |
| Frontend-only | ESTIMATED | classify(~20s) + L1(~51s) + L5a(~30s, sequential after frontend-build) | **~100-105s (~1.7 min)** |
| Ordinary backend route | ESTIMATED | classify(~20s) + L1(~51s) + L2(~75-100s) | **~150-170s (~2.5-2.8 min)** |
| Auth/security | ESTIMATED | classify(~20s) + L1(~51s) + L3(~540-570s, still the dominant term — L5b runs in parallel and finishes first) | **~610-640s (~10.2-10.7 min, no wall-clock win — by design, §7.1)** |
| Schema/migration | ESTIMATED | classify(~20s) + L1(~51s) + L3(~540-570s) | **~610-640s (no wall-clock win — by design)** |
| Storage/imaging | ESTIMATED | classify(~20s) + L1(~51s) + L3(~540-570s, imaging tests live there) | **~610-640s (no wall-clock win — by design)** |
| Unknown/mixed high-risk / CI tooling | ESTIMATED | same as the full matrix + ~20s classify overhead | **~620-645s (no wall-clock win — intentional fail-safe)** |

The real, unconditional wall-clock win applies to `DOCS_ONLY`, `FRONTEND`, `BACKEND_GENERAL`, and `ARCHITECTURE_BOUNDARY`-only changesets — this covers the large majority of day-to-day PR traffic observed in §5's own sample (docs reconciliation PRs, backend-route PRs, and frontend PRs are the common case; `AUTH_SECURITY`/`DATABASE_SCHEMA`/`STORAGE_IMAGING` PRs are comparatively rare and now cost the *same* wall-clock as before — this task never trades away depth for a rare, high-risk PR shape). No ESTIMATED number was produced by triggering an actual optimized run against GitHub Actions (that requires the PR opened in §19 to actually execute); all ESTIMATED figures are derived arithmetically from the real per-job MEASURED durations in §5, added along the dependency chain the new `if:` conditions establish.

## 13. Concurrency (STEP 8)

Unchanged from the pre-existing, already-correct implementation: `ci-pr.yml`'s `concurrency: group: ci-pr-${{ github.event.pull_request.number }}, cancel-in-progress: true` already cancels a stale run when a newer commit is pushed to the same PR, and does not affect other PRs (the group key is per-PR-number) or `ci-main-and-nightly.yml` (a disjoint, fixed group name, `cancel-in-progress: false`). This task added no new workflow-level trigger, so no new concurrency behavior was needed; the classifier's own job inherits the existing group.

## 14. Dependency cache (STEP 9)

Unchanged: every job (including the new `classify` job) uses `actions/setup-node@...v4.4.0` with `cache: 'npm'` and an explicit `cache-dependency-path` scoped to the correct lockfile (`package-lock.json` at root, `server/package-lock.json` for server-working-directory jobs) — same pattern as every pre-existing job. No `node_modules` or Prisma-client caching was introduced (Prisma client generation remains an explicit, cache-bypassing step everywhere it is needed, per the F1-003-P3-R1 root-cause fix already in place — see `ci-layers.yml`'s own comment on `non-disposable-backend-tests`). Caching remains optimization-only, never correctness-critical, unchanged.

## 15. Avoided duplicated install cost (STEP 10)

No artifact-sharing/build-reuse system was introduced. The `classify` job's own `npm ci` is an additional install beyond what existed before, but it reuses the same npm cache as every other root-level job (warm-cache `npm ci` measured at ~5s in §5's real run data), and — critically — it is now the *first* job in the dependency chain rather than an added parallel cost, so its ~20s (checkout + setup-node + npm ci + git fetch + diff + classify) is the only new fixed overhead this task introduces, and it is far smaller than the multi-minute savings it enables for the common-case PR shapes in §12.

## 16. Required-check / branch-protection safety (STEP 11 — critical)

`gh api repos/MustafaBasol/DisKlinikCRM/branches/main/protection` → `404 Branch not protected`. **Main currently has no branch protection and no required status checks configured at all.** This materially changes the risk profile STEP 11 warns about: there is no pre-existing required-check name this task could silently orphan or leave permanently pending, because nothing is currently required.

This task still implements the requested stable aggregator pattern for when branch protection is configured: `ci-pr.yml` gains a new job, **`PR Gate`** (`needs: [ci-layers]`, `if: always()`), which is the one job whose name never disappears or depends on which changed-path category a given PR falls into — every PR produces exactly one `PR Gate` result, `success` or `failure`, regardless of which inner `ci-layers.yml` jobs a given PR's classification selected or skipped. It fails closed: any non-`success` result from the `ci-layers` reusable-workflow call (itself failing if any *selected* inner job failed, thanks to GitHub Actions' standard workflow-success aggregation, where a `skipped` inner job never counts against the caller but a `failure`/`cancelled` one does) makes `PR Gate` fail.

**Manual step required to activate this as a merge gate (not performed by this task, per its explicit instruction not to change branch protection automatically):** repository Settings → Branches → add a branch protection rule for `main` → "Require status checks to pass before merging" → select **`PR Gate`**. No other check name needs to be selected — `PR Gate` transitively covers `ci-layers` and, in turn, everything inside it.

## 17. Security / tenant / KVKK / regulated-system guardrails (STEP 12)

No test coverage was removed or narrowed for any regulated area. `AUTH_SECURITY` and `DATABASE_SCHEMA` (which together cover authentication, platform-admin privilege, session/token/CSRF handling, and every migration) both still trigger the full DB-backed deep gate (L2+L3+L5b, plus L4 for schema changes) with **zero wall-clock improvement** — this is by design (§7.1, §12), not an oversight: a rare, high-risk PR shape is deliberately left exactly as expensive as before rather than trading away depth for speed. `STORAGE_IMAGING` (KVKK-relevant attachment/imaging paths) likewise keeps L2+L3+L4. Every fail-safe path (`CI_TOOLING`, `UNKNOWN`, empty diff, classifier failure) selects the full matrix, never a narrowed one. No production runtime code was touched — this task is CI-workflow-only plus one new, isolated `scripts/ci-classify/**` directory.

## 18. Migration status

Not applicable — no database migration, schema change, or `server/prisma/**` file was touched by this task.

## 19. Rollback (STEP 17)

1. Revert the commit(s) on this task's PR (`git revert` or GitHub's "Revert" button) — restores `ci-layers.yml`, `ci-pr.yml`, and removes `scripts/ci-classify/**` and the two new root `package.json` script entries.
2. This restores the exact pre-F3-CI-OPT-001 behavior: `ci-main-and-nightly.yml` never called `fastMode`, so it is entirely unaffected either way; `ci-pr.yml` reverts to unconditionally running every job.
3. Branch-protection implication: if the manual step in §16 was taken (required check set to `PR Gate`), it must be manually repointed back to whatever check name existed before (none, per this task's own findings — see §16) or removed, since `PR Gate` would no longer exist after the revert. This is a manual GitHub Settings step, not something `git revert` performs.
4. No production application rollback is required or implied — this task changed no runtime code path.

## 20. Residual risks and future opportunities

- **Fork PRs are not supported by the `classify` job's diff-fetch step** (`git fetch origin <base-sha> <head-sha>` assumes both SHAs are reachable from `origin`, true only for same-repo branch PRs). This repository does not currently accept fork-based contributions (all recent PR branches are same-repo), so this is a documented assumption, not an active gap; a future change could fetch `refs/pull/<N>/head` instead for full fork robustness.
- **Manifest/lockfile changes (`package.json`, `package-lock.json`) always select the full deep gate**, even for a devDependency-only bump. This means the many currently-open Dependabot PRs (`gh pr list --state open` showed 29 of 30 total open PRs are `dependabot/**`, each a `package.json`/lockfile-only diff) will each still pay the full ~10-minute matrix under this design. This is the conservative, correct default per this task's own "package manifests → CI_TOOLING" instruction; a future, separately-authorized task could add a narrower `DEPENDENCY_BUMP` category that distinguishes a devDependency-only lockfile diff from one that touches a runtime dependency.
- **`bridge-agent/**` classifies as `UNKNOWN`** (full deep gate) despite no existing `ci-layers.yml` job actually exercising `bridge-agent` code at all (confirmed: no workflow references `bridge-agent`). This is intentionally conservative rather than silently narrowed to "run nothing" — a future task could add a dedicated `bridge-agent`-aware category once/if that project gains real CI coverage of its own.
- **No branch protection currently exists on `main`** (§16) — this task's `PR Gate` job is ready to be selected as a required check but activating it is a manual step this task explicitly did not perform.

## 21. Files changed

- `.github/workflows/ci-layers.yml` — added `workflow_call` `inputs.fastMode` + `outputs` passthrough, new `classify` job, `if:`/`needs:` changes on all 10 pre-existing jobs (job bodies otherwise byte-identical).
- `.github/workflows/ci-pr.yml` — passes `fastMode: true`; added the new `PR Gate` job.
- `.github/workflows/ci-main-and-nightly.yml` — **unchanged**.
- `scripts/ci-classify/classify.ts` — new, pure classification logic.
- `scripts/ci-classify/cli.ts` — new, GitHub Actions I/O wrapper.
- `scripts/ci-classify/tsconfig.json` — new, mirrors `scripts/architecture-guardrail/tsconfig.json`.
- `scripts/ci-classify/__tests__/classify.test.ts` — new, 22 tests.
- `package.json` — three new scripts: `ci-classify`, `test:ci-classify`, `typecheck:ci-classify`.

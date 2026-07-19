# F0-002 — Repository and Deployment Baseline Inventory (Stage A: Repository Evidence)

Task: F0-002 — Repository and Deployment Baseline Inventory
Phase: F0 — Baseline, Program Control, and Architecture Validation
Stage: **A — Repository evidence.** Collected 2026-07-18, described in this document. Stage B (production/VPS evidence) is a separate document — [F0-002_PRODUCTION_BASELINE_EVIDENCE.md](F0-002_PRODUCTION_BASELINE_EVIDENCE.md), evidence timestamp `2026-07-19T13:43:12+03:00` — and is now complete; §6.9 below has been reconciled against it.
Evidence collected: 2026-07-18 (Stage A); reconciled against Stage B on 2026-07-19
Evidence worktree: `docs/f0-002-repository-deployment-baseline` @ `4302825abcdf4f5dbb90b4ded92b2e44a947df18` (Stage A collection point, = refreshed `origin/main` at that time). The branch has since been merged with `origin/main` (now at `d9fc40883afc8791098865d4d185de3336774c7a`, which includes F0-003/F0-004/F0-005) — repository facts below reflect the Stage A collection point and remain accurate; the repository migration head fact in §6.5 is additionally cross-checked at the merged HEAD in the note there.

This document is a factual inventory. It does not recommend or implement architecture changes. See [README.md](README.md) for the evidence-classification legend.

---

## 6.1 Git and repository identity

| Fact | Value | Evidence source | Classification |
|---|---|---|---|
| Repository full name | `MustafaBasol/DisKlinikCRM` | `gh repo view` | `VERIFIED_GITHUB` |
| Remote URL | `https://github.com/MustafaBasol/DisKlinikCRM.git` (fetch+push, `origin`) | `git remote -v` | `VERIFIED_GIT` |
| Default branch | `main` | `gh repo view --json defaultBranchRef` | `VERIFIED_GITHUB` |
| `main` branch protection | **Not protected** — `gh api repos/MustafaBasol/DisKlinikCRM/branches/main/protection` returned HTTP 404 `"Branch not protected"` | GitHub API, authenticated as `MustafaBasol` | `VERIFIED_GITHUB` |
| GitHub CLI authentication | Available — `gh auth status` → logged in to github.com as `MustafaBasol`, scopes `gist, read:org, repo, workflow` | `gh auth status` | `VERIFIED_GITHUB` |
| Refreshed `origin/main` SHA | `4302825abcdf4f5dbb90b4ded92b2e44a947df18` | `git fetch origin --prune && git rev-parse origin/main` | `VERIFIED_GIT` |
| PR #166 state | `MERGED`, base `main`, head `docs/f0-001-program-tracker-foundation`, merged at `2026-07-18T08:08:10Z`, merge commit `4302825abcdf4f5dbb90b4ded92b2e44a947df18` | `gh pr view 166 --json ...` | `VERIFIED_GITHUB` |
| PR #166 merge-commit ancestry | Confirmed ancestor of refreshed `origin/main` (in fact **identical** to `origin/main` HEAD — no commits landed on `main` after PR #166) | `git merge-base --is-ancestor 4302825abcdf4f5dbb90b4ded92b2e44a947df18 origin/main` → exit 0 | `VERIFIED_GIT` |
| Most recent merged PRs (context) | #166 (F0-001, `4302825`), #165 (KVKK-HIGH-004, `f18b26e`), #164 (docs/kvkk, `6872155`), #163 (kvkk attachment legal hold, `59b9a33`), #162 (kvkk storage-key fix, `b59a146`) | `gh pr list --state merged --limit 5` | `VERIFIED_GITHUB` |
| Tags | None (`git tag -l` → empty, 0 tags) | `git tag -l` | `VERIFIED_GIT` — repository does not currently use Git tags for releases; absence noted, not assumed to mean anything about release process |
| Submodules | None (`.gitmodules` does not exist in the worktree) | `git config --file .gitmodules --list` → file not found | `VERIFIED_GIT` |

### Worktree isolation record

All facts about the original KVKK working tree below are classified `OBSERVED_LOCAL_ONLY` — they describe what was seen in one local environment via read-only commands, are not confirmed against any external system of record, and are **not repository baseline evidence** for F0-002. They must not be read as implying the KVKK branch is merged, production-deployed, or otherwise part of `main`.

| Fact | Value | Classification |
|---|---|---|
| Original active working-tree path | `D:\Mustafa\Siteler\DisKlinikCRM` | `OBSERVED_LOCAL_ONLY` |
| Original active branch | `feature/kvkk-crit-003-security-incident-foundation` | `OBSERVED_LOCAL_ONLY` — local branch only; remote/PR/scope/completion status not verified in this task |
| Original working-tree status **before Stage A** (2026-07-18, Stage A start) | Clean — `git status` → "nothing to commit, working tree clean"; branch up to date with `origin/feature/kvkk-crit-003-security-incident-foundation` | `OBSERVED_LOCAL_ONLY` |
| Original working-tree status **after Stage A / before this checkpoint** | **Not clean** — `git status --short --branch` (read-only, re-run at this checkpoint) shows: `M .gitignore`, `M server/src/routes/platformSecurityIncidents.ts`, `M server/src/services/security/securityDetectionRules.ts`, `M server/src/services/security/securityIncidentService.ts`, `M server/src/services/security/securitySignalService.ts`, `M server/src/tests/securityIncident.test.ts`, `M src/locales/{de,en,fr,tr}/securityIncidents.json`, `M src/pages/platform/PlatformSecurityIncidents.tsx`, and untracked `.gitignore.backup`. **This task never ran any write/edit/stash/reset/checkout/commit command against this working tree** — every command executed against this path across both the Stage A session and this checkpoint session was strictly read-only (`git status`, `git branch`, `git fetch`, `git rev-parse`, `git merge-base`). The change set has grown between the Stage A check and this checkpoint (additional modified files appeared), consistent with active, ongoing concurrent development on that branch outside this task's control. This is a factual observation, not F0-002 evidence, and not a finding about repository or production state. | `OBSERVED_LOCAL_ONLY` |
| Original working-tree status **at this external-review remediation checkpoint** (2026-07-18, re-check) | Clean again — `git status --short --branch` (read-only, re-run) → "nothing to commit, working tree clean", branch up to date with `origin/feature/kvkk-crit-003-security-incident-foundation`. The intermediate "not clean" state recorded above was a snapshot at one earlier checkpoint, not a persistent state; the tree's contents have continued to change independently under active, ongoing concurrent development on that branch. This task still issued no write/edit/stash/reset/checkout/commit command against that tree at any point. | `OBSERVED_LOCAL_ONLY` |
| F0-002 worktree path | `D:\Mustafa\Siteler\DisKlinikCRM-worktrees\f0-002-baseline` — **deviates from the task's preferred path** `E:\Ek Gelir\Siteler\DisKlinikCRM-worktrees\f0-002-baseline` because this execution environment has no `E:` drive mounted (only `C:` and `D:` are available; verified via `mount` and a failed `ls "E:/"`). See "Deviations from instructions" below. | `VERIFIED_GIT` |
| F0-002 branch | `docs/f0-002-repository-deployment-baseline` (created fresh from `origin/main`; did not already exist locally or on remote before creation) | `VERIFIED_GIT` |
| `git worktree list` after creation | `D:/Mustafa/Siteler/DisKlinikCRM` → `910545e [feature/kvkk-crit-003-security-incident-foundation]`; `D:/Mustafa/Siteler/DisKlinikCRM-worktrees/f0-002-baseline` → `4302825 [docs/f0-002-repository-deployment-baseline]` | `VERIFIED_GIT` |
| F0-002 worktree tracked/untracked state at HEAD | Clean immediately after `git worktree add` — `git status --short --branch` → `## docs/f0-002-repository-deployment-baseline...origin/main`, no file changes | `VERIFIED_GIT` |
| F0-001 worktree/branch | Not touched, not removed. (No separate F0-001 worktree existed at task start — only the single KVKK working tree above and the newly created F0-002 worktree exist.) | `VERIFIED_GIT` |

**Deviation from instructions:** §1 of the task specifies the preferred worktree path as `E:\Ek Gelir\Siteler\DisKlinikCRM-worktrees\f0-002-baseline`. This environment has no `E:` drive (`mount` shows only `C:` and `D:` mounted; `ls "E:/"` fails with "No such file or directory"). The fallback path `D:\Mustafa\Siteler\DisKlinikCRM-worktrees\f0-002-baseline` was used instead, as a sibling directory to the primary repository following the same naming convention. This is flagged for external review; it does not affect any evidence content, only the local filesystem location of the isolated worktree.

---

## 6.2 Repository layout

Top-level structure of the worktree at `4302825abcdf4f5dbb90b4ded92b2e44a947df18` (`VERIFIED_REPOSITORY`, via `ls`/`git ls-files`):

| Root | Purpose (repository-evidenced) |
|---|---|
| `src/` | Frontend source (React/Vite SPA) — `App.tsx`, `components/`, `pages/`, `services/`, `hooks/`, `context/`, `i18n/`, `layouts/`, `constants/`, `types/`, `utils/` |
| `server/` | Backend source — `src/`, `prisma/`, `scripts/`, own `package.json`/`package-lock.json`/`tsconfig.json`, plus `prisma.config.ts` |
| `server/src/` | `index.ts` (API entrypoint), `worker.ts` (worker entrypoint), `db.ts`, `jobs/`, `middleware/`, `routes/`, `schemas/`, `scripts/`, `services/`, `tests/`, `types/`, `utils/` |
| `server/prisma/` | Prisma schema root — `schema.prisma`, `migrations/` (60 directories), `seed.ts`, `seed.e2e-booking.ts` |
| `bridge-agent/` | Node.js Windows Imaging Bridge Agent (folder-watch) — own `package.json`, `src/`, `tests/`, `scripts/`, `config/` |
| `windows-bridge/` | .NET Windows Bridge solution — `NoraMedi.Bridge.sln`, `src/` (Core, Service, Manager), `tests/`, `installer/`, `release/`, `docs/`, `global.json`, `Directory.Build.props`, `Directory.Packages.props` |
| `scripts/` | Two repository-root deployment scripts: `noramedi-deploy.sh`, `noramedi-healthcheck.sh` |
| `docs/` | Product/architecture/compliance documentation, including `docs/program/` (the authoritative tracker) and `docs/compliance/` |
| `.github/workflows/` | Two workflow files, both windows-bridge/imaging-scoped (see §6.8) |
| `public/` | Static assets served by the frontend (`assets/`, `favicon.ico`, `robots.txt`, `site.webmanifest`, `sitemap.xml`) |
| Root config files | `package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `vite.config.d.ts`, `tailwind.config.js`, `postcss.config.js`, `nginx.conf`, `index.html`, `.env.example`, `AGENTS.md`, `README.md`, `FILE_INDEX.md`, `SECURITY_TODO.md` |

No tracked build-output directory exists at the repository root (`dist/` is `.gitignore`d — vite's default build output directory, confirmed by `vite.config.ts` using default `build` options with no custom `outDir`).

This is a top-level/deployment-relevant inventory only. Domain/module ownership mapping within `src/`, `server/src/`, etc. is explicitly out of scope for F0-002 and belongs to F0-003.

---

## 6.3 Runtime and toolchain definitions

| Component | Declared version | Evidence source | Classification |
|---|---|---|---|
| Frontend runtime — React | `^18.3.1` (react, react-dom) | `package.json:30-31` | `VERIFIED_REPOSITORY` |
| Frontend build tool — Vite | `^5.4.8` | `package.json:47` | `VERIFIED_REPOSITORY` |
| Frontend TypeScript | `^5.5.3` | `package.json:46` | `VERIFIED_REPOSITORY` |
| Backend framework — Express | `^5.2.1` | `server/package.json:91` | `VERIFIED_REPOSITORY` |
| Backend TypeScript | `^6.0.3` | `server/package.json:115` | `VERIFIED_REPOSITORY` |
| Prisma ORM / client | `7.8.0` (both `prisma` and `@prisma/client`, pinned exact) | `server/package.json:82-83,113` | `VERIFIED_REPOSITORY` |
| Prisma Postgres driver adapter | `@prisma/adapter-pg` `7.8.0` + `pg` `8.22.0` (driver-adapter pattern, not Prisma's built-in connector) | `server/package.json:80-82,97`; usage at `server/src/db.ts:2-3,14-21` | `VERIFIED_REPOSITORY` |
| Prisma datasource provider | `postgresql` | `server/prisma/schema.prisma:6-8` | `VERIFIED_REPOSITORY` |
| Redis client library | `ioredis` `^5.11.1` | `server/package.json:92` | `VERIFIED_REPOSITORY` (capability only — see §6.7 for required/optional behavior) |
| Node runtime (CI-declared) | `20` (`node-version: '20'` in `actions/setup-node@v4.4.0`) | `.github/workflows/windows-bridge-pr.yml:41` | `VERIFIED_REPOSITORY` |
| Node runtime (bridge-agent `engines`) | `>=20` | `bridge-agent/package.json:7-9` | `VERIFIED_REPOSITORY` |
| Node runtime (root/server) | **Not declared** — no `engines` field in root `package.json` or `server/package.json` | `grep '"engines"' **/package.json` → only `bridge-agent/package.json` matched | `VERIFIED_REPOSITORY` (absence) |
| `.nvmrc` / `.node-version` / Volta | **Not present anywhere in the repository** | Repository-wide search | `VERIFIED_REPOSITORY` (absence) |
| Windows Bridge target framework | `net10.0-windows`, SDK `10.0.301` (`rollForward: latestFeature`) | `windows-bridge/Directory.Build.props:9`; `windows-bridge/global.json:1-4` | `VERIFIED_REPOSITORY` |
| Bridge-agent runtime | Node.js `>=20`, TypeScript `6.0.3`, `tsx` `4.22.4`, `esbuild` `0.24.2` | `bridge-agent/package.json:8,22-25` | `VERIFIED_REPOSITORY` |
| Lockfiles | 3 present, all `lockfileVersion: 3` (npm) — root `package-lock.json`, `server/package-lock.json`, `bridge-agent/package-lock.json` | `grep lockfileVersion` in each | `VERIFIED_REPOSITORY` |

**Conflict noted (see §6.10):** root frontend declares TypeScript `^5.5.3` while the backend (`server/`) declares TypeScript `^6.0.3` — two different major TypeScript versions across the same repository, each installed independently (separate `node_modules`/lockfiles per root). No `.nvmrc`/`engines` pin at the repository or server root means the actual Node version used to run either half is whatever is installed locally or in CI (`20`, per CI evidence above) — this is inferred from the one CI job that exists, not declared as a repository-wide requirement.

---

## 6.4 Package scripts and entrypoints

Script names and purposes as declared in package manifests. **Not executed.**

### Root (`package.json`) — frontend

| Script | Command | Declared purpose |
|---|---|---|
| `dev` | `vite` | Development server |
| `build` | `tsc -b && vite build` | Production build (typecheck + bundle) |
| `preview` | `vite preview` | Preview built bundle |
| `lint` | `eslint . --ext ts,tsx` | Lint |
| `test:dicom-helpers`, `test:onboarding-helpers`, `test:pairing-poller`, `test:booking-widget-helpers`, `test:clinic-bulk-export-selection` | `tsx <path>.test.ts` | Individual frontend unit test files (5 total) |

### `server/package.json` — backend

| Script | Command | Declared purpose |
|---|---|---|
| `dev` | `tsx watch src/index.ts` | API dev entrypoint |
| `dev:worker` | `tsx watch src/worker.ts` | Worker dev entrypoint |
| `start` | `npx prisma generate && tsx src/index.ts` | **Production API entrypoint** |
| `start:worker` | `npx prisma generate && tsx src/worker.ts` | **Production worker entrypoint** — separate process from `start` |
| `typecheck` | `npx prisma generate && tsc --noEmit` | Typecheck (regenerates Prisma client first) |
| `test` | Chained `npm run test:fixtures && ... && npm run test:clinic-bulk-export` | Full backend test aggregate — chains ~50 individual `test:*` scripts, each a standalone `tsx src/tests/<name>.test.ts` invocation |
| `test:*` (≈50 scripts) | `tsx src/tests/<name>.test.ts` | Individual test files; not enumerated further here — full inventory with runtimes/dependencies belongs to F0-005 |

No `deploy` or `smoke`/`healthcheck` npm script exists inside `server/package.json` — those live as standalone shell scripts at the repository root (`scripts/noramedi-deploy.sh`, `scripts/noramedi-healthcheck.sh`; see §6.6).

### `bridge-agent/package.json`

| Script | Command | Declared purpose |
|---|---|---|
| `dev` | `tsx watch src/index.ts --config config/config.example.json` | Dev entrypoint |
| `typecheck` | `tsc --noEmit` | Typecheck |
| `test` | Chained `tsx tests/*.test.ts` (9 files) | Test aggregate |
| `build` | `node scripts/build.mjs` | Build |
| `package` | `node scripts/package.mjs` | Packaging |

### `windows-bridge/` (.NET — no npm scripts; MSBuild/dotnet-driven)

Entrypoints are project files, not package-manager scripts: `src/NoraMedi.Bridge.Service` (service), `src/NoraMedi.Bridge.Manager` (manager UI), `src/NoraMedi.Bridge.Core` (shared library), plus 4 test projects under `tests/`. Build/test orchestration is not npm-based; not executed in this task.

None of the above scripts were run during Stage A, per task scope (no builds, tests, typechecks, or installs).

---

## 6.5 Prisma and migration baseline

| Fact | Value | Evidence source | Classification |
|---|---|---|---|
| Prisma schema path | `server/prisma/schema.prisma` | File presence | `VERIFIED_REPOSITORY` |
| Prisma config | `server/prisma.config.ts` — schema path `prisma/schema.prisma`, migrations path `prisma/migrations`, seed `tsx prisma/seed.ts`, datasource URL from `process.env.DATABASE_URL` | `server/prisma.config.ts:1-13` | `VERIFIED_REPOSITORY` |
| Datasource provider | `postgresql` | `server/prisma/schema.prisma:6-8` | `VERIFIED_REPOSITORY` |
| Client generator | `prisma-client-js` | `server/prisma/schema.prisma:1-3` | `VERIFIED_REPOSITORY` |
| Connection adapter | `@prisma/adapter-pg` (driver-adapter pattern), pool `max` configurable via `DB_POOL_MAX` (default 10), `connectionTimeoutMillis` via `DB_POOL_CONNECT_TIMEOUT_MS` (default 10 000 ms), `idleTimeoutMillis` via `DB_POOL_IDLE_TIMEOUT_MS` (default 30 000 ms) | `server/src/db.ts:9-21` | `VERIFIED_REPOSITORY` |
| Migration directory count | 60 dated migration directories + 1 `migration_lock.toml` | `ls server/prisma/migrations` | `VERIFIED_REPOSITORY` |
| Migration lock metadata | Present — `provider = "postgresql"` | `server/prisma/migrations/migration_lock.toml` | `VERIFIED_REPOSITORY` |
| Earliest migration | `20260513115238_init_postgres_baseline` | Directory listing, sorted | `VERIFIED_REPOSITORY` |
| Repository migration head (latest) | `20260716120000_add_clinic_bulk_export` | Directory listing, sorted | `VERIFIED_REPOSITORY` |
| Migration ordering | Linear by `YYYYMMDDHHMMSS_name` timestamp prefix; sorted directory listing matches chronological/logical order (e.g. imaging-foundation → imaging-bridge-agent → imaging-bridge-ingest → imaging-bridge-pairing → public-booking → KVKK attachment lifecycle → clinic-bulk-export) | Directory listing inspection | `VERIFIED_REPOSITORY` |
| Duplicate timestamp anomalies | **None found** — `sed`-extracted 14-digit prefixes deduplicated with `sort \| uniq -d` produced no output | Shell inspection of all 60 directory names | `VERIFIED_REPOSITORY` |
| Missing/incomplete migrations | **None found** — every migration directory contains a non-empty `migration.sql`; no directory lacks the file | Shell inspection (`find ... -empty`, per-directory existence check) | `VERIFIED_REPOSITORY` |
| Latest migration corresponds to | `add_clinic_bulk_export` — consistent with PR #165 (KVKK-HIGH-004, merged 2026-07-17) being the most recent feature merge before the F0-001 documentation-only PR #166 | Cross-reference with §6.1 PR history | `VERIFIED_REPOSITORY` |
| **Production-applied migration status** | **`VERIFIED_PRODUCTION_OBSERVED`** — Stage B confirmed via production evidence request §F: latest applied migration `20260718164142_add_communication_preference_and_consent`, 0 incomplete, no `rolled_back_at` values in the latest 10. See [F0-002_PRODUCTION_BASELINE_EVIDENCE.md](F0-002_PRODUCTION_BASELINE_EVIDENCE.md) §B.7. | Database query performed by the user, read-only, per the production evidence request | `VERIFIED_PRODUCTION_OBSERVED` |
| Repository migration head at merged `origin/main` HEAD (`d9fc40883afc8791098865d4d185de3336774c7a`, post F0-003/004/005) | `20260718164142_add_communication_preference_and_consent` — **same as the production-applied migration above**; directory listing re-checked after this branch merged `origin/main` | `ls server/prisma/migrations` at merge commit | `VERIFIED_REPOSITORY` |

No `prisma migrate deploy`, `prisma migrate dev`, `prisma generate`, or any database connection was performed **by this agent**. Stage B's production database query was performed by the user, read-only, outside this task's tool access. No schema modification was made at any point.

---

## 6.6 Deployment definition inventory

| Fact | Repository evidence | Classification |
|---|---|---|
| Production app path (repository-declared) | `/var/www/noramedi` (default of `NORAMEDI_APP_DIR` env var) | `scripts/noramedi-deploy.sh:26` — `VERIFIED_REPOSITORY` (matches the task's stated expectation). **Stage B confirmed this is the actual production path** — see [F0-002_PRODUCTION_BASELINE_EVIDENCE.md](F0-002_PRODUCTION_BASELINE_EVIDENCE.md) §B.2, `VERIFIED_PRODUCTION_OBSERVED` |
| Deploy script | `scripts/noramedi-deploy.sh` — sequence: `git pull --ff-only` → (`server/`) `npm ci` → `npx prisma migrate deploy` → `npx prisma generate` → `pm2 reload noramedi-api --update-env` → 2s sleep → `noramedi-healthcheck.sh --local --max-attempts 12 --interval 5`. Each step individually skippable via `--skip-*` flags. | `VERIFIED_REPOSITORY` |
| PM2 API process name | `noramedi-api` (hardcoded `PM2_NAME` in the deploy script; also referenced in `docs/51-public-booking-required-slot-hotfix.md` and an archived compliance doc) | `scripts/noramedi-deploy.sh:27` | `VERIFIED_REPOSITORY` — matches the task's stated expectation. **Stage B confirmed `noramedi-api` runs online in production** (fork mode, 0 unstable restarts at evidence time) — see [F0-002_PRODUCTION_BASELINE_EVIDENCE.md](F0-002_PRODUCTION_BASELINE_EVIDENCE.md) §B.4, `VERIFIED_PRODUCTION_OBSERVED` |
| PM2 worker process name | **No repository evidence found.** The string `noramedi-worker` does not appear anywhere in the repository (source, scripts, docs, workflows). The deploy script only reloads `noramedi-api`; it never references, starts, or reloads a worker PM2 process. | Repository-wide grep, zero matches | `VERIFIED_REPOSITORY` (absence) for the repository claim. **Stage B confirmed `noramedi-worker` exists and runs online in production as a separate PM2 process** (fork mode, 0 unstable restarts at evidence time) — see [F0-002_PRODUCTION_BASELINE_EVIDENCE.md](F0-002_PRODUCTION_BASELINE_EVIDENCE.md) §B.4, `VERIFIED_PRODUCTION_OBSERVED`. The repository-absence finding and the production-presence finding are **both true at once**: the process runs, but nothing in this repository defines how it gets deployed or reloaded — see the updated §6.10 item 3 below. |
| Deployment manages API and worker separately? | **Not from this script.** `noramedi-deploy.sh` runs migrations/generate once (shared by both processes) but only reloads the API PM2 process. There is no repository-defined mechanism that restarts/reloads a worker process after deploy. | `scripts/noramedi-deploy.sh` (full file read) | `VERIFIED_REPOSITORY` — this is a gap, not an assumption; see §6.10 |
| Deployment verifies migrations | Runs `prisma migrate deploy` unconditionally unless `--skip-migrate` is passed; does not separately query `_prisma_migrations` to confirm success beyond the command's own exit code (`set -euo pipefail` aborts the script on failure) | `scripts/noramedi-deploy.sh:71-74`, `24` | `VERIFIED_REPOSITORY` |
| Deployment verifies health after restart | Yes — `noramedi-healthcheck.sh --local --max-attempts 12 --interval 5` runs after the PM2 reload | `scripts/noramedi-deploy.sh:91-93` | `VERIFIED_REPOSITORY` |
| Rollback instructions | **None found in `scripts/` or root docs for the PM2/bare-VPS path.** `noramedi-deploy.sh` has no rollback subcommand or documented rollback procedure. | Absence, repository-wide | `VERIFIED_REPOSITORY` (absence) |
| Healthcheck script | `scripts/noramedi-healthcheck.sh` — probes `https://api.noramedi.com/api/health` (public, default) or `http://127.0.0.1:5000/api/health` (`--local`); treats HTTP `200/204` and `401/403` as healthy (401/403 = "auth wall reached, API is up"); retries on `000/502/503/504` up to `--max-attempts` (default 12) at `--interval` seconds (default 5) | `scripts/noramedi-healthcheck.sh:24-25,74-98` | `VERIFIED_REPOSITORY` — this is the first place the hostname `api.noramedi.com` and local port `5000` appear in the repository; they are repository-declared, not invented for this report |
| Application health endpoint | `GET /api/health` — runs `SELECT 1` via Prisma with a 3s timeout race; returns `{status:"ok"}` (200) or `{status:"degraded"}` (503); unauthenticated, no detail leaked | `server/src/index.ts:158-170` | `VERIFIED_REPOSITORY` |
| Graceful shutdown — API | `SIGTERM`/`SIGINT` handler: stops accepting new connections (`server.close`), waits for in-flight requests, disconnects Prisma and Redis, force-exits after 10s | `server/src/index.ts:264-283` (approx.; handler block + `process.on` at 283-284) | `VERIFIED_REPOSITORY` |
| Graceful shutdown — worker | Same pattern independently implemented in the worker entrypoint: `SIGTERM`/`SIGINT` → disconnect Prisma + Redis → force-exit after 10s | `server/src/worker.ts:29-44` | `VERIFIED_REPOSITORY` |
| `RUN_BACKGROUND_JOBS` behavior | If unset or not `'false'`, the API process starts background jobs itself (single-process default, unchanged legacy behavior). If explicitly `'false'`, the API skips starting jobs and logs that they are delegated to the worker process. The worker (`worker.ts`) always starts jobs unconditionally — it does not read this flag itself. | `server/src/index.ts:257-261`; `server/src/worker.ts:23-25` | `VERIFIED_REPOSITORY` |
| Nginx configuration (repository) | `nginx.conf` at repo root — serves **only the static SPA** from `/usr/share/nginx/html` inside a container; explicitly comments that TLS termination, HTTP→HTTPS redirect, and HSTS are the responsibility of an external reverse proxy, and instructs not to add `listen 443 ssl` to this file | `nginx.conf:1-31` | `VERIFIED_REPOSITORY` |
| TLS assumptions | Not terminated by the repository's own `nginx.conf`; assumed to be handled by an external proxy layer (per the comment in `nginx.conf:1-8`); backend sends HSTS itself in production (comment references `server/src/index.ts`) | `nginx.conf:1-8` | `VERIFIED_REPOSITORY` for the repository-declared expectation. **Stage B confirmed**: host Nginx `1.24.0` terminates TLS via a Let's Encrypt (`YE2`) certificate (CN `app.noramedi.com`, SAN covering `api.noramedi.com`/`app.noramedi.com`/`noramedi.com`/`www.noramedi.com`, expiry `2026-09-26`), `nginx -t` successful — see [F0-002_PRODUCTION_BASELINE_EVIDENCE.md](F0-002_PRODUCTION_BASELINE_EVIDENCE.md) §B.6, `VERIFIED_PRODUCTION_OBSERVED`. TLS hostname coverage: **VERIFIED**. |
| API/frontend build-output expectations | Frontend: Vite default (`dist/`, not tracked, no custom `outDir` in `vite.config.ts`). Backend: no build step in the `start` script — `tsx` runs TypeScript directly at runtime (no compiled `dist/` for the server; `prisma generate` runs first) | `vite.config.ts` (no `outDir` override); `server/package.json:10-11` | `VERIFIED_REPOSITORY` |
| Static frontend serving | Container-style `nginx.conf` serving the Vite build output as an SPA (`try_files ... /index.html`) | `nginx.conf:9-31` | `VERIFIED_REPOSITORY` — see §6.10 for the contradiction between this Docker-style nginx config and the non-Docker `noramedi-deploy.sh` path |
| Deployment reproducible from repository evidence alone? | **Partially.** The bare-VPS path (`noramedi-deploy.sh` + PM2 + host nginx) is fully scripted and reproducible for the API process, assuming the target host already has Node, PM2, and PostgreSQL client tools installed (none of that provisioning is scripted in this repository). The worker process has **no** deploy/reload automation at all — its production lifecycle is not reproducible from repository evidence. The container-style `nginx.conf` and `docs/35-docker-deploy-runbook.md` describe a different (Docker Compose) topology with no corresponding `Dockerfile`/`docker-compose.yml` anywhere in the repository, so that path is **not** reproducible from repository evidence — see §6.10. | Synthesis of the above rows | `VERIFIED_REPOSITORY` for what exists; `CONFLICTING_EVIDENCE` for which topology is authoritative |

---

## 6.7 Runtime dependency capability

| Capability | Repository evidence | Required/optional | Classification |
|---|---|---|---|
| PostgreSQL connection | `@prisma/adapter-pg` over `pg`, connection string from `DATABASE_URL` | Required | `VERIFIED_REPOSITORY` |
| Pool-size configuration | `DB_POOL_MAX` (default 10), `DB_POOL_CONNECT_TIMEOUT_MS` (default 10 000), `DB_POOL_IDLE_TIMEOUT_MS` (default 30 000) — all overridable via env, all optional with fallback defaults | Optional (has defaults) | `VERIFIED_REPOSITORY` — `server/src/db.ts:9-21` |
| Redis support | `ioredis` client, lazily constructed only if `REDIS_URL` is set; `enableOfflineQueue: false` + `maxRetriesPerRequest: 1` so a Redis outage fails fast rather than queuing | **Optional** — explicitly designed as fail-open | `VERIFIED_REPOSITORY` — `server/src/utils/redis.ts:1-51` |
| Rate-limit fallback behavior | If `REDIS_URL` unset or Redis errors, rate-limit counters fall back to an in-process `Map` (per the file's own header comment); single-process behavior is unchanged; multi-replica deployments lose cross-replica rate-limit sharing without Redis | Comment-documented, not independently re-derived from the rate-limit middleware itself in this task | `VERIFIED_REPOSITORY` |
| Worker scheduling | Separate `server/src/worker.ts` entrypoint calling `startBackgroundJobs()` unconditionally; intended to run as `npm run start:worker`, a distinct OS process from the API | Present | `VERIFIED_REPOSITORY` |
| Job locks | `server/src/utils/jobLock.ts` — Postgres-table-backed (`JobLock` Prisma model) lease lock with atomic claim-if-expired / create-if-absent logic; explicitly chosen over a Redis `SET NX PX` lock so no extra infrastructure is required (comment at file header) | Present, DB-based | `VERIFIED_REPOSITORY` |
| Queue implementation | **None found.** No BullMQ, no RabbitMQ, no SQS, no generic message-queue library in any `package.json`. Scheduling is `node-cron` (`server/package.json:95`) with the DB job-lock above; not a durable/retryable job queue. | Absence, repository-wide | `VERIFIED_REPOSITORY` (absence) — relevant context for later phase F6 (Queue, Outbox, Idempotency), not addressed here |
| Storage — local mode | Default. `BASE_UPLOAD_DIR = uploads/` (relative to `process.cwd()`), clinic-isolated | Default | `VERIFIED_REPOSITORY` — `server/src/services/fileStorage.ts:41` |
| Storage — S3-compatible mode | Enabled when `S3_BUCKET` is set (`isRemoteStorageEnabled()`); supports `S3_REGION` (default `"auto"`), `S3_ENDPOINT` (non-AWS S3-compatible targets, e.g. MinIO/R2), `S3_FORCE_PATH_STYLE`, optional explicit `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` (falls back to SDK default credential chain, e.g. IAM role) | Optional, env-gated | `VERIFIED_REPOSITORY` — `server/src/services/fileStorage.ts:43-64` |
| Storage-key scheme | New records: `"{clinicId}/{timestamp}-{rand}{ext}"`, generated server-side (no path-traversal input from client, extension taken from validated original filename). Legacy records: absolute filesystem paths, always read from local disk regardless of storage mode. | — | `VERIFIED_REPOSITORY` — `server/src/services/fileStorage.ts:66-79` |
| Backup service | `server/src/services/backupService.ts` — repository-declared, fixed paths: `BACKUP_DIR=/root/noramedi-backups`, `BACKUP_SCRIPT=/usr/local/sbin/noramedi-db-backup.sh`, `BACKUP_LOG=/var/log/noramedi-db-backup.log`, cron unit expected at `/etc/cron.d/noramedi-db-backup`, retention `7` days, filename pattern `noramedi_crm-YYYYMMDD-HHMMSS.dump` | Repository defines the *client-side* status/trigger code; the backup script itself (`/usr/local/sbin/noramedi-db-backup.sh`) is **not** part of this repository | `VERIFIED_REPOSITORY` for the status/trigger/retention logic; `NOT_APPLICABLE` for the backup script's own contents (out of repo); production existence of the script/cron unit is `UNVERIFIED_PRODUCTION` |
| Restore-test capability | `runRestoreTest()` — creates a temp DB (`noramedi_restore_test_<ts>_<rand>`), `pg_restore`s the latest (or a named) backup into it, runs read-only verification queries (table count, `PlatformAdmin` count, `Plan` count, `_prisma_migrations` count) | Present, repository-defined | `VERIFIED_REPOSITORY` — `server/src/services/backupService.ts:9-14,161-247` |
| PITR / WAL archiving | **No repository evidence found** — no `archive_mode`, `wal-g`, `pgbackrest`, or equivalent configuration/reference in application code or scripts (the string `WAL` matched only unrelated binary/cache content and an unrelated `.cs` queue file) | Absence | `VERIFIED_REPOSITORY` (absence) — Stage B must check for PITR at the PostgreSQL/host configuration level, since repository code alone cannot prove or disprove it |
| Error tracking | **No Sentry/Bugsnag/equivalent SDK found** in `server/package.json` or `package.json` dependencies | Absence | `VERIFIED_REPOSITORY` (absence) |
| Metrics/tracing | **No Prometheus/OpenTelemetry/equivalent SDK found** in dependencies | Absence | `VERIFIED_REPOSITORY` (absence) |
| Structured logging | `pino` + `pino-http` present as dependencies | Present | `VERIFIED_REPOSITORY` — `server/package.json:98-99` |
| Request/correlation ID | Not independently re-verified in this task (would require reading `pino-http`/middleware configuration in depth); flagged as an open item rather than asserted either way | — | `NOT_APPLICABLE` (not assessed this task; avoid guessing) |
| Health/liveness/readiness endpoints | Single endpoint `GET /api/health` (DB-backed liveness+readiness combined; no separate liveness-only endpoint) | Present, single endpoint | `VERIFIED_REPOSITORY` |
| Docker/Compose | **No `Dockerfile` or `docker-compose*`/`compose.yml` file anywhere in the repository** (repository-wide search) despite `docs/35-docker-deploy-runbook.md` describing a Docker Compose deployment and `nginx.conf` being written for in-container use | Absence vs. stale doc | `VERIFIED_REPOSITORY` (absence) — see §6.10 |
| PgBouncer | **No repository evidence found** — no PgBouncer config, no reference in scripts/docs beyond generic future-architecture mentions in `docs/program/phases/F5_TENANT_RLS_AND_DATABASE.md` (a forward-looking phase document, not a current-state claim) | Absence | `VERIFIED_REPOSITORY` (absence) |
| Read replica support | **No repository evidence found** — single `DATABASE_URL` used everywhere; no read/write connection splitting in `server/src/db.ts` or elsewhere | Absence | `VERIFIED_REPOSITORY` (absence) |

---

## 6.8 CI and repository automation

| Fact | Evidence | Classification |
|---|---|---|
| Workflow files | Exactly two: `.github/workflows/windows-bridge-pr.yml`, `.github/workflows/windows-bridge-release.yml` | `VERIFIED_REPOSITORY` |
| `windows-bridge-pr.yml` trigger scope | `pull_request` targeting `main`, restricted to `paths:` = `windows-bridge/**`, `server/src/services/imaging/**`, `server/src/routes/imaging*.ts`, `server/src/tests/imaging*.ts`, `src/components/imaging/**`, and the two workflow files themselves | `.github/workflows/windows-bridge-pr.yml:8-18` | `VERIFIED_REPOSITORY` |
| `windows-bridge-pr.yml` jobs | `backend-imaging` (Node 20, `npm ci` + `npm run typecheck` + 4 imaging test scripts, working directory `server`), `frontend-imaging` (typecheck + build) | `.github/workflows/windows-bridge-pr.yml:30-53+` | `VERIFIED_REPOSITORY` |
| General backend/frontend PR CI | **Does not exist.** A PR that changes, e.g., `server/src/routes/patients.ts` or any non-imaging backend/frontend file triggers **no** workflow at all — the only workflow's `paths:` filter would not match. | Path-filter inspection above | `VERIFIED_REPOSITORY` (absence) — significant gap, directly relevant to future phase F1 (CI and Test Architecture) |
| `bridge-agent/` CI coverage | **None.** The string `bridge-agent` does not appear in either workflow file. | Repository-wide grep within `.github/workflows/` | `VERIFIED_REPOSITORY` (absence) |
| Nightly/release workflows | `windows-bridge-release.yml` exists (release-scoped for the Windows Bridge only — not inspected in depth beyond confirming its existence and imaging/bridge scope, per task instruction not to duplicate F1's CI inventory) | File presence | `VERIFIED_REPOSITORY` |
| Branch protection on `main` | **Not enabled** (see §6.1 — `VERIFIED_GITHUB`, HTTP 404 "Branch not protected") — this means the absence of general CI in §6.8 is not offset by any required-status-check gate either | `gh api` | `VERIFIED_GITHUB` |

No workflow file was created or modified in this task.

---

## 6.9 Baseline evidence matrix (reconciled with Stage B)

Stage B is complete; see [F0-002_PRODUCTION_BASELINE_EVIDENCE.md](F0-002_PRODUCTION_BASELINE_EVIDENCE.md) for the full sanitized production evidence. The "Production status" and "Evidence classification" columns below are updated accordingly. Rows still `UNVERIFIED_PRODUCTION`/`UNVERIFIED` remain so **because no evidence resolved them**, not because they were skipped.

| Area | Repository evidence | Repository status | Production status | Evidence classification | Risk/impact | Stage B reference |
|---|---|---|---|---|---|---|
| Git/main revision | `origin/main` = `d9fc40883afc8791098865d4d185de3336774c7a` (post F0-003/004/005 merge; was `4302825` at Stage A collection) | Current | — | `VERIFIED_GIT` | None | N/A |
| Application revision | Same as Git/main (no separate app versioning scheme found) | N/A | Production `HEAD` = `7fcf2f850f151241266f07349c4bf4442c72bbca`, one documentation-only PR (#171) behind `origin/main`; working tree `CLEAN` | `VERIFIED_PRODUCTION_OBSERVED` | None — doc-only gap, not runtime drift | §B.2 |
| Production revision | Not checked | N/A | Same as above | `VERIFIED_PRODUCTION_OBSERVED` | Same as above | §B.2 |
| Frontend runtime | React `^18.3.1`, Vite `^5.4.8`, TS `^5.5.3` | Declared | Not independently checked (no build-artifact-vs-source comparison performed) | `VERIFIED_REPOSITORY` | Low | N/A — out of Stage B's read-only command scope |
| Backend runtime | Express `^5.2.1`, TS `^6.0.3`, Node (CI-inferred) `20`, no `engines` pin | Declared | Node `22.23.1` observed — **2 majors ahead of the only CI evidence (20), unenforced** | `VERIFIED_PRODUCTION_OBSERVED` | Medium — no enforced Node version; drift is real, not hypothetical | §B.3, §6.10 item 3 |
| Worker runtime | Same Node/TS as backend (shared `server/` package) | Declared | Same Node `22.23.1` (shared host); `noramedi-worker` process confirmed online, fork mode | `VERIFIED_PRODUCTION_OBSERVED` | Medium (same Node-drift risk as backend) | §B.3, §B.4 |
| Database provider | PostgreSQL, via `@prisma/adapter-pg` | Declared | PostgreSQL `16.14` | `VERIFIED_PRODUCTION_OBSERVED` | None | §B.3, §B.7 |
| Repository migration head | `20260718164142_add_communication_preference_and_consent` (at merged `origin/main` HEAD; was `20260716120000_add_clinic_bulk_export` at Stage A collection) | Current | — | `VERIFIED_REPOSITORY` | None | §6.5 |
| Production migration head | Not checked | N/A | `20260718164142_add_communication_preference_and_consent`, finished `2026-07-19 13:03:58+03`, 0 incomplete — **matches repository migration head and deployed commit** | `VERIFIED_PRODUCTION_OBSERVED` | None — clean, consistent state | §B.7 |
| Process manager | PM2 (deploy script assumes it is already installed/running) | Declared | PM2 `7.0.1` | `VERIFIED_PRODUCTION_OBSERVED` | None | §B.3 |
| API process | PM2 name `noramedi-api` (repository-defined) | Declared | `noramedi-api` online, fork mode, ~38 min uptime, 14 restarts, 0 unstable | `VERIFIED_PRODUCTION_OBSERVED` | None (restart count is a Medium operational-review item, not a failure claim) | §B.4 |
| Worker process | **No repository-defined PM2 name exists** — `noramedi-worker` is the *task's stated expectation*, not something found in the repository | **Not declared in repository** | `noramedi-worker` online, fork mode, ~39 min uptime, 13 restarts, 0 unstable | `VERIFIED_REPOSITORY` (absence, repo side) + `VERIFIED_PRODUCTION_OBSERVED` (existence, production side) — **both true simultaneously** | Medium — process exists but has **no repository-defined deploy/reload automation** (§6.10 item 3); background-jobs-in-process hypothesis is now moot (the separate process exists) but its update mechanism is unknown | §B.4, §B.9 |
| Redis | Optional, code supports `REDIS_URL`; fail-open if absent/down | Optional capability | Redis CLI `7.0.15`, service **active**; `REDIS_URL` `SET` | `VERIFIED_PRODUCTION_OBSERVED` | Low (fail-open by design; also actually configured and running) | §B.3, §B.8 |
| Queue | No queue library present; DB-backed `JobLock` used instead of a durable queue | Absent by design | N/A — repository fact, not production-dependent | `VERIFIED_REPOSITORY` (absence) | Relevant to future F6 | N/A |
| Storage mode | Local disk default; S3-compatible mode if `S3_BUCKET` set | Both supported | **`LOCAL_VPS_STORAGE`** — `S3_BUCKET`/`S3_REGION`/`S3_ENDPOINT` all `MISSING`, local `uploads/` dir exists (~3.1 MB) | `VERIFIED_PRODUCTION_OBSERVED` | Medium/High — see risk register (§B.11): patient/imaging data on the same VPS, no object storage | §B.8, §B.9 |
| Storage location | `uploads/` (local) or S3-compatible bucket (remote) | Both supported | `/var/www/noramedi/server/uploads`, ~3.1 MB | `VERIFIED_PRODUCTION_OBSERVED` | Medium | §B.9 |
| Backup type | `pg_dump`-style `.dump` file via external script, not in this repository | Client-side logic only | Script/cron/log all present; 7 matching backups; latest 38,160s (~10.6h) old, 434,585 bytes | `VERIFIED_PRODUCTION_OBSERVED` (partial — script contents themselves remain out-of-repository) | High (offsite gap, see below) | §B.10 |
| Offsite backup | **No repository evidence found** (no S3/offsite-upload step referenced in `backupService.ts`) | Not found | Backup directory (`/root/noramedi-backups`) is local to the same VPS; **no offsite copy evidence found** | `VERIFIED_PRODUCTION_OBSERVED` (absence) | **High** — confirmed absent, not merely unchecked | §B.10, §B.11 |
| PITR | **No repository evidence found** | Not found | `archive_mode: off`, `wal_level: replica` (WAL format setting only, not replica proof) — **`NOT_CONFIGURED` / `NOT_AVAILABLE`** | `VERIFIED_PRODUCTION_OBSERVED` | **High** — confirmed absent | §B.10, §B.11 |
| Restore test | Repository-defined capability (`runRestoreTest()`) exists | Present (capability) | No matching automated restore-test job found; no durable manual record supplied | `UNVERIFIED_PRODUCTION` — **remains `UNVERIFIED`, not "never happened"** | **High** — capability existing ≠ ever exercised, and this remains unconfirmed either way | §B.10, §B.11 |
| Nginx/TLS | Repository `nginx.conf` is container-internal, static-only; TLS assumed external | Declared (partial) | Host Nginx `1.24.0`, `nginx -t` successful; Let's Encrypt `YE2` cert, CN `app.noramedi.com`, SAN covers all 4 confirmed public hostnames, expires `2026-09-26`. TLS hostname coverage: **VERIFIED**. | `VERIFIED_PRODUCTION_OBSERVED` — resolves the prior `CONFLICTING_EVIDENCE` (bare-VPS confirmed, Docker runbook confirmed stale) | Low (was High while unconfirmed) | §B.6 |
| Health endpoint | `GET /api/health`, DB-backed | Present | Local `200`, public `200` | `VERIFIED_PRODUCTION_OBSERVED` | Low | §B.5 |
| Error tracking | Not found in dependencies | Absent | N/A — repository fact | `VERIFIED_REPOSITORY` (absence) | Medium | N/A |
| Metrics/tracing | Not found in dependencies; `pino`/`pino-http` present for logging only | Absent (metrics); present (logging) | N/A — repository fact | `VERIFIED_REPOSITORY` | Medium | N/A |
| CI | 2 workflows, both windows-bridge/imaging-scoped; no general backend/frontend CI; `main` unprotected | Confirmed | N/A (GitHub-side, already `VERIFIED_GITHUB`) | `VERIFIED_GITHUB`/`VERIFIED_REPOSITORY` | High — no CI gate gates any non-imaging change before merge | N/A |
| Docker/Compose | No Dockerfile/compose file in repository despite Docker-oriented doc/nginx.conf | Absent (contradicts doc) | **Confirmed not running** — production topology is bare-VPS + PM2 + host Nginx (§B.6); the Docker Compose runbook is stale/aspirational | `VERIFIED_REPOSITORY` (absence) + `VERIFIED_PRODUCTION_OBSERVED` (bare-VPS topology confirmed) | Medium — stale doc could still mislead a future deploy attempt; no longer a topology-identity risk | §B.6 |
| PgBouncer | Not found | Absent | Not checked in Stage B (not part of the read-only command set) | `VERIFIED_REPOSITORY` (absence, repo side only) | Relevant to future F5 | N/A — not assessed |
| Read replica | Not found | Absent | Not checked; `wal_level: replica` explicitly not treated as replica evidence | `VERIFIED_REPOSITORY` (absence, repo side only) | Relevant to future F7 | N/A — not assessed |
| Production smoke verification | Not performed this task | N/A | Local + public health checks both `200` at evidence time (§B.5) | `VERIFIED_PRODUCTION_OBSERVED` — point-in-time only, **not** a `PRODUCTION_VERIFIED` release-gate status | — | §B.5 |

---

## 6.10 Contradictions and stale documentation

These are recorded for later review. **No documentation file was modified to "fix" these** — that is out of scope for F0-002 Stage A.

1. **Docker vs. bare-VPS deployment topology — RESOLVED by Stage B.** `docs/35-docker-deploy-runbook.md` describes a Docker Compose deployment with containers `disklinikcrm_api`/`disklinikcrm_frontend`, compose files under `/docker/disklinikcrm/`, database name `dis_klinik_crm`, and the old product name "Aile Dis CRM" throughout. The repository's `nginx.conf` is written for in-container static serving, consistent with that doc. However, **no `Dockerfile` or `docker-compose*` file exists anywhere in the repository**, and the only working deploy automation (`scripts/noramedi-deploy.sh`) is a bare-VPS `git pull` + `npm ci` + PM2 script targeting `/var/www/noramedi`, with a backup service hardcoded to database name `noramedi_crm`. **Stage B confirmed production runs the bare-VPS + PM2 + host-Nginx topology** (app path `/var/www/noramedi`, PM2 `noramedi-api`/`noramedi-worker`, host Nginx `1.24.0` with a Let's Encrypt certificate — see [F0-002_PRODUCTION_BASELINE_EVIDENCE.md](F0-002_PRODUCTION_BASELINE_EVIDENCE.md) §B.2/§B.4/§B.6). The Docker runbook is confirmed stale/aspirational, not the running architecture.
2. **PM2 process naming mismatch across docs.** `docs/22-hostinger-vps-postgres-deploy-plan.md:88` shows `pm2 start npm --name aile-dis-crm-api -- start` (old product name, no worker process registered), while the current deploy script uses `noramedi-api` and defines no worker PM2 registration at all. Three different naming schemes appear across the repository's history of documentation (`aile-dis-crm-api`, `disklinikcrm_api`, `noramedi-api`), none of which have been reconciled into a single current-state document.
3. **No repository evidence for a `noramedi-worker` PM2 process, but Stage B confirms it exists and runs — with no deploy automation of its own.** The worker has its own entrypoint (`server/src/worker.ts`) and start script (`npm run start:worker`), but nothing in the repository names, starts, or reloads a `noramedi-worker` PM2 process. **Stage B confirmed `noramedi-worker` is online in production as a separate PM2 process** (fork mode, ~39 min uptime, 13 restarts, 0 unstable restarts at evidence time — see [F0-002_PRODUCTION_BASELINE_EVIDENCE.md](F0-002_PRODUCTION_BASELINE_EVIDENCE.md) §B.4). This resolves the *existence* question (background jobs are not running in-process inside the API by default; a genuinely separate worker process is running) but sharpens a different gap: **how that process gets deployed, updated, or restarted is not defined anywhere in this repository** — `scripts/noramedi-deploy.sh` only ever touches `noramedi-api`. This is an operational gap for later review (F0-006), not something F0-002 remediates.
4. **Node version drift — new finding from Stage B.** The repository declares no `engines` field anywhere (root or `server/`), and the only CI evidence (`.github/workflows/windows-bridge-pr.yml`) pins Node `20`. **Stage B observed production actually running Node `22.23.1`** — two major versions ahead of the only CI evidence, on both the API and worker processes (same host, same Node installation). Nothing in the repository tests against, documents, or enforces this. Health checks pass and migrations are clean at this Node version, so there is no evidence of a current functional problem — but the gap between "what CI tests" (Node 20) and "what production runs" (Node 22) is real and unmonitored. See [F0-002_PRODUCTION_BASELINE_EVIDENCE.md](F0-002_PRODUCTION_BASELINE_EVIDENCE.md) §B.3.
5. **`.env.example` gaps.** `REDIS_URL`, `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, and `RUN_BACKGROUND_JOBS` are all read by application code (`server/src/utils/redis.ts`, `server/src/services/fileStorage.ts`, `server/src/index.ts`) but **none appear in `server/.env.example`**, so a fresh deployment following only the example file would not discover these options.
6. **`CORS_ORIGINS` duplicate key in `server/.env.example`.** Lines 17 and 21 both set `CORS_ORIGINS=` uncommented (one intended as a "Development" example, one as "Production"); in a real `.env` file only the last assignment would take effect. Minor documentation-quality issue, not a runtime bug (this is an example file, not a loaded config).
7. **Stray debug artifacts committed to the repository.** `server/check_db.ts`, `server/err.txt`, `server/out.txt`, and `server/test_isolation.ts` are tracked files at the `server/` root that read as ad hoc debugging scratch output rather than intentional source/config. Not modified in this task (out of scope), but noted since they clutter the "top-level structure" inventory in §6.2.
8. **A tracked file literally named `tatus --short`** (58 001 bytes) exists at the repository root, introduced in commit `0936867` ("Add secure cookie auth and signed CSRF migration"). Its content is the captured terminal output of a `git status --short` command (visible CRLF/LF warning lines at the top), strongly suggesting an accidental `git add` of redirected shell output rather than an intentional file. Not modified in this task.
9. **A committed npm cache directory.** `server/.npm-cache3/` (at least 7 files, including binary `_cacache` blobs) is tracked in Git. The repository's `.gitignore` excludes `.npm-cache/` (no trailing digit) but not `.npm-cache3/`, so this directory is not excluded and was committed. Not modified in this task.
10. **`docs/program/NORAMEDI_MASTER_TRACKER.md` §3 baseline table** records the repository's local path as `E:\Ek Gelir\Siteler\DisKlinikCRM-git`. The primary working tree used for this and prior sessions is actually `D:\Mustafa\Siteler\DisKlinikCRM` (confirmed via `git status`/`pwd` at task start). This is a stale local-path reference from an earlier environment; it does not affect any Git/GitHub evidence (remote URL, SHAs, PR data are all independent of local path) but is corrected in the tracker update accompanying this task (§8 below) since it is a direct, in-scope §3 baseline field.

---

## Files touched by this Stage A + Stage B delivery

Only files under `docs/program/` were created or modified. No application source, schema, migration, package manifest, lockfile, test, CI workflow, deployment script, nginx file, environment file, or runtime configuration was modified. No production system was changed — every command executed against production was read-only, run by the user outside this task's tool access. See the final delivery report for the exact file list.

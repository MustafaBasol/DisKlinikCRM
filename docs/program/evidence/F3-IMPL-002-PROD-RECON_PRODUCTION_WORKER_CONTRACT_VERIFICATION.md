# F3-IMPL-002-PROD-RECON — Production Worker Contract Verification and Deploy-Script Drift Reconciliation

**Task ID:** F3-IMPL-002-PROD-RECON · **Phase:** F3 — Production Hardening · **Date:** 2026-08-12

**Type:** documentation / program-control reconciliation only. No runtime, application, dependency, schema, migration, CI-workflow, or deployment-script file is changed by this task. The diff is limited to `docs/program/**`.

**Evidentiary class:** the production facts in §3 are **user/operator-supplied**. This task performed **no production access** — no SSH, no `pm2` command, no HTTP request to `api.noramedi.com`, no file read on `disklinik-prod-01`. It does not re-derive any supplied figure. This is the same evidentiary class as `F3-PROD-001_PRODUCTION_DEPLOYMENT_AND_VERIFICATION.md`, `KVKK-HIGH-006-PRODUCTION_DEPLOYMENT_AND_SMOKE_VERIFICATION.md`, and the R-061 residual entries in `RISK_REGISTER.md`.

**However**, §4 records a set of checks this task *did* run — entirely against the repository, with no production access — that **independently corroborate several supplied facts and identify the stale artifact exactly**. Those are labelled `REPOSITORY_VERIFIED` and are separated from the supplied facts throughout.

---

## 1. Baseline

| Item | Value |
|---|---|
| `origin/main` at task start | `aa18b064267ff5846ae60f73889c3322030bd4a8` — `git fetch origin` + `git rev-parse origin/main`, no drift |
| Supplied production deployed SHA | `aa18b064267ff5846ae60f73889c3322030bd4a8` |
| Match | **Exact.** Production and `origin/main` are at the same commit; this task's baseline *is* the deployed tree. |
| What that commit is | `fix(security): remediate production dependency vulnerabilities (F3-SEC-003) (#401)` — PR #401's squash-merge onto `main` |
| Working branch | `docs/f3-impl-002-prod-recon`, created from `origin/main` @ `aa18b06`, clean |
| Prior program-doc baseline | `aa8c467a62a75f845d99c9690ebaff69210a1a47` (PR #400 / F3-PROD-001). `aa18b06` is one commit ahead. |

Documents read first, as required by the task brief: `docs/program/NORAMEDI_MASTER_TRACKER.md`, `docs/program/CURRENT_PHASE.md`, `docs/program/phases/F3_PRODUCTION_HARDENING.md`, `docs/program/evidence/F3-IMPL-002_PRODUCTION_WORKER_PROCESS_CONTRACT.md`, `docs/program/evidence/F3-PROD-001_PRODUCTION_DEPLOYMENT_AND_VERIFICATION.md`, `docs/program/RISK_REGISTER.md` (R-033 / R-034 / R-040, plus R-036 / R-037 context).

## 2. Purpose

`F3-IMPL-002` (2026-08-10, PR #357) defined a repository-level production worker contract: `ecosystem.config.cjs`, a `NORAMEDI_PROCESS_ROLE` startup guard, and a `scripts/noramedi-deploy.sh` that reloads **both** PM2 apps from that ecosystem file and then verifies the worker reached PM2 `online` before the deploy is allowed to succeed. Its own evidence closed with `NOT_DEPLOYED` / `NOT_PRODUCTION_VERIFIED`, and R-033 / R-034 / R-040 were deliberately left `OPEN`.

`F3-PROD-001` (2026-08-12, PR #400) then reconciled the first production deployment of the F3 train and recorded, in its §3, that production process topology matched that contract.

This task reconciles a **second, later set of operator-supplied production evidence** (§3) that materially changes what is proven — in one direction it strengthens the worker-side verification, and in another it **falsifies a specific claim `F3-PROD-001` made about which deploy procedure actually ran** (§5). It produces criteria-anchored dispositions for R-033 / R-034 / R-040 (§6), a re-assessed F3 exit gate (§7), and one new risk row (§8).

## 3. Accepted production evidence (as supplied, not independently re-verified)

### 3.1 Deployed revision

| Item | Value |
|---|---|
| Production deployed SHA | `aa18b064267ff5846ae60f73889c3322030bd4a8` |

### 3.2 API — `noramedi-api`

| Check | Result |
|---|---|
| PM2 process | `online` |
| `GET /api/health` | `200` |
| `GET /api/livez` | `200` |
| `GET /api/readyz` | `200`, `database=ok`, `redis=ok` |

### 3.3 Worker — `noramedi-worker`

| Item | Value |
|---|---|
| Condition discovered | A **stale worker instance** was found *after* the deployment, because the installed `/usr/local/sbin/noramedi-deploy.sh` was older than the repository script |
| Stale instance | PID `603932`, `restart_count` `10` |
| Reconciliation command | `pm2 startOrReload /var/www/noramedi/ecosystem.config.cjs --only noramedi-worker --update-env` |
| Replacement instance | PID `605889`, `restart_count` `11` |
| Shutdown of stale instance | clean `SIGINT`, clean exit |
| Prisma Client in new instance | `v7.9.1` |
| Startup log | `role=worker (declared=true)`, `ownsJobs=true`, `All background jobs scheduled.` |

### 3.4 Deploy-script drift and synchronization

| Item | Value |
|---|---|
| Installed (stale) script | `/usr/local/sbin/noramedi-deploy.sh`, SHA-256 `8dffcd134f508c0a12699220354dd3074a95f6b98342da6cd53533043e7b675d` |
| Repository script | `/var/www/noramedi/scripts/noramedi-deploy.sh` |
| Root cause (as supplied) | the installed script **did not reload or verify `noramedi-worker`**; the repository script does API **and** worker `startOrReload` plus worker PM2 verification |
| Rollback backup taken | `/usr/local/sbin/noramedi-deploy.sh.bak.20260812-174738` |
| Repository script syntax check | `bash -n` — pass |
| Installed to | `/usr/local/sbin/noramedi-deploy.sh`, owner `root:root`, mode `0755` |
| Installed script syntax check | `bash -n` — pass |
| Post-sync hash (both copies) | `794375b4249b063e167a8d6f885df1a590bd9de9df367e91a0d3eaaf635f5012` — **identical** |
| Installed `--help` smoke | lists API `startOrReload`, worker `startOrReload`, API healthcheck, worker PM2-status verification |
| Deploy executed during synchronization | **No.** API and worker remained online. |

**No hash, PID, restart count, log line, health response, file mode, or `bash -n` result above was re-run or re-derived by this task.**

## 4. Repository-side corroboration performed by this task (`REPOSITORY_VERIFIED`, no production access)

These checks were run locally against the repository at the baseline SHA. They do not observe production; they identify exactly *which repository artifacts* the supplied hashes correspond to, which is what makes the drift finding precise rather than approximate.

| # | Check | Command / basis | Result |
|---|---|---|---|
| 1 | Deployed SHA is `origin/main`'s tip | `git fetch origin`, `git rev-parse origin/main` | `aa18b064267ff5846ae60f73889c3322030bd4a8` — **exact match** with the supplied production SHA |
| 2 | Deployed SHA identity | `git log -1 aa18b06` | PR #401 squash-merge, `fix(security): remediate production dependency vulnerabilities (F3-SEC-003)` |
| 3 | **Post-sync hash matches the repository script byte-for-byte** | `git show HEAD:scripts/noramedi-deploy.sh \| sha256sum` | `794375b4249b063e167a8d6f885df1a590bd9de9df367e91a0d3eaaf635f5012` — **exact match** with the supplied post-sync hash |
| 4 | **The stale installed script identified exactly** | sha256 of every historical blob of `scripts/noramedi-deploy.sh` across `git log --follow` | `8dffcd13…` == the blob at commit `96313f39edc063f246f8c2ba74b6a6f2c6ed6364`, `2026-06-29`, *"fix: run deploy backend commands from server directory"* |
| 5 | When the current version entered the repository | same enumeration | `794375b4…` first appears at `b4ff47cc4f7fff3f2c34895e525f4018b56b56e5`, `2026-08-10`, *"feat(hardening): F3-IMPL-002 production worker process contract"* — unchanged from there through `aa18b06` |
| 6 | What the stale script actually did | `git show 96313f39:scripts/noramedi-deploy.sh` | 95 lines, **6** steps, step 5 = `pm2 reload noramedi-api --update-env`. **No** reference to `ecosystem.config.cjs`. **No** worker reload step. **No** worker verification step. |
| 7 | What the synced script does | `scripts/noramedi-deploy.sh` @ `aa18b06` | 160 lines, **8** steps: `git pull` → `npm ci` → `prisma migrate deploy` → `prisma generate` → `pm2 startOrReload … --only noramedi-api --update-env` → `… --only noramedi-worker --update-env` → API healthcheck → `verify_pm2_online noramedi-worker 12 5` |
| 8 | Ecosystem path the synced script uses | `scripts/noramedi-deploy.sh:33,36` | `APP_DIR="${NORAMEDI_APP_DIR:-/var/www/noramedi}"`, `ECOSYSTEM_FILE="$APP_DIR/ecosystem.config.cjs"` → `/var/www/noramedi/ecosystem.config.cjs` — **the exact path used in the supplied manual reconciliation command** (§3.3) |
| 9 | `--help` output provenance | `scripts/noramedi-deploy.sh:44-47` — `usage()` prints the file's own `#` header block | The supplied `--help` smoke output is exactly what the hash-verified file's header block contains. **Caveat: `--help` prints comments and exits; it executes no deploy step and therefore proves file identity, not runtime behaviour.** |
| 10 | Worker role/env contract | `ecosystem.config.cjs` | `noramedi-worker` declares `NORAMEDI_PROCESS_ROLE: 'worker'` and **no** `RUN_BACKGROUND_JOBS` — consistent with the supplied startup log `role=worker (declared=true)`, `ownsJobs=true` |
| 11 | Prisma version corroborates the worker now runs the deployed tree | `server/package.json:202,234` | `@prisma/client` and `prisma` both pinned `7.9.1` — the exact version F3-SEC-003 (`7.8.0` → `7.9.1`) introduced at `aa18b06`, and the exact version the replacement worker reports |

**Line-ending note (for reproducibility):** check 3 hashes the **git-stored blob** (LF), which is what a Linux checkout of `/var/www/noramedi` materializes. The Windows working copy used by this session has CRLF line endings and therefore hashes differently (`917ee40a…`); that is a checkout artifact, not a content difference.

**Conclusion of §4:** the installed deploy script had been frozen at the **2026-06-29** revision — **44 days stale**, and specifically **predating F3-IMPL-002 entirely**. The drift is not approximate: the supplied `8dffcd13…` is byte-identical to a known repository commit, and the supplied post-sync `794375b4…` is byte-identical to the repository script at the deployed SHA.

## 5. Correction to `F3-PROD-001`'s recorded deploy procedure

`evidence/F3-PROD-001_PRODUCTION_DEPLOYMENT_AND_VERIFICATION.md` §2 records:

> | Deploy procedure used | `scripts/noramedi-deploy.sh` (`git pull --ff-only` → `npm ci` → `prisma migrate deploy` → `prisma generate` → `pm2 startOrReload ecosystem.config.cjs --only noramedi-api` → `--only noramedi-worker` → healthcheck) — matches the repository-defined procedure this session's own preflight read directly |

**This is now known to be incorrect as to what actually executed.** Production deploys invoke the **installed** script at `/usr/local/sbin/noramedi-deploy.sh`, not the repository copy; per §3.4 and §4, that installed copy was the pre-F3-IMPL-002 (2026-06-29) six-step version. Both 2026-08-12 production deploys — the F3 train deploy (`f0ff4c70…`) and the F3-SEC-003 deploy (`aa18b064…`) — therefore ran a procedure that:

- reloaded **only** `noramedi-api`, via `pm2 reload noramedi-api --update-env`;
- **never referenced `ecosystem.config.cjs`** for either process;
- **never reloaded `noramedi-worker`**;
- **never verified** the worker's PM2 status, and so could not fail the deploy on a stale or dead worker.

Two consequences follow, and both narrow what earlier documents proved:

1. **`F3-PROD-001` §3's worker row (`noramedi-worker` `ONLINE`, `role=worker`, `ownsJobs=true`) described the *stale* instance.** PM2 `online` was true; "running the deployed code" was not. The worker process could not have been restarted by either deploy, so its loaded module graph predates both — while `npm ci` had already replaced `node_modules` underneath it. The replacement instance's `Prisma Client v7.9.1` (§3.3, corroborated by §4 check 11) is the first evidence of a worker actually running the deployed tree.
2. **`F3-PROD-001` §3's API row does not demonstrate that `ecosystem.config.cjs` is the API's config source.** The observed `RUN_BACKGROUND_JOBS=false` / `ownsJobs=false` is a real, valid observation of the API's *effective* value — but it came from PM2's own stored environment for that app (created out-of-band, before F3-IMPL-002), not from the repository-defined ecosystem file. The API has still never been started or reloaded from `ecosystem.config.cjs`.

Per this program's convention, `F3-PROD-001`'s body is **not rewritten in place**; an additive superseding-correction banner pointing at this document has been added at the top of that file, and its original text is preserved unedited as dated evidence.

**What is *not* invalidated by this correction:** the deployed SHA, the pre-deploy backup, the migration state (73 migrations, schema up to date), the API health/livez/readyz results, the Platform Admin login check, and the `npm audit` counts behind R-075 are all independent of which deploy script ran, and stand unchanged.

## 6. Risk disposition — R-033, R-034, R-040

Each risk is assessed **only** against the closure criteria its own `RISK_REGISTER.md` row states. None is closed.

### 6.1 R-033 — no repository-defined deploy/reload automation for `noramedi-worker`

- **Row's missing control (`Eksik kontrol`):** deploy automation covering the worker.
- **Row's status before this task:** `OPEN — repository-level fix implemented, production not yet verified`.
- **New evidence for closure:** the repository script — which does perform worker `startOrReload` **and** worker PM2 verification — is now installed at the **actual production invocation path** `/usr/local/sbin/noramedi-deploy.sh`, `root:root`, `0755`, `bash -n` clean, and **hash-identical to the repository script at the deployed SHA** (independently confirmed, §4 check 3). A rollback copy exists. The gap between "automation exists in the repository" and "automation exists where production runs it" is closed.
- **New evidence *against* closure — and this is the decisive part:** the automation **has never executed**. Item 11 of the supplied evidence is explicit that no deploy was run during synchronization. Worse, §5 establishes that the worker-covering automation was **not in effect for either production deploy on 2026-08-12** — the very deploys `F3-PROD-001` recorded. The single worker reload that did occur was performed **manually**, not by the script. The script's steps 6 and 8 (worker `startOrReload`, `verify_pm2_online`) have zero production execution evidence.
- **Disposition: `OPEN` — not closed, status wording upgraded.** New wording: *repository-level fix implemented **and now installed at the production invocation path (hash-verified)**; end-to-end deploy execution still not observed.*
- **Exact remaining evidence to close:** one successful run of the installed `/usr/local/sbin/noramedi-deploy.sh` in which steps 5–8 are captured — API `startOrReload` from `ecosystem.config.cjs`, worker `startOrReload` from the same file, API healthcheck pass, and `verify_pm2_online noramedi-worker` reaching `online` — with the script exiting `0`. A `--skip-pull --skip-build --skip-migrate --skip-generate` invocation exercises exactly steps 5–8 and nothing else, and is the smallest sufficient run; note that per `ecosystem.config.cjs`'s own operational comment the **first** ecosystem-driven API `startOrReload` may fall back to a full restart rather than a zero-downtime reload, so it needs a maintenance window. That is an operator action, not a coding task.

### 6.2 R-034 — API and worker may both register the same 9 jobs

- **Row's missing control:** verification of `RUN_BACKGROUND_JOBS`'s real production value, or explicit standardization of the flag to `false` on the API side (the standardization half was completed at repository level by F3-IMPL-002).
- **Row's status before this task:** `OPEN — repository-level mitigation implemented, production not yet verified`.
- **New evidence:** the worker side is now firmly verified — the replacement instance logs `role=worker (declared=true)`, `ownsJobs=true`, `All background jobs scheduled.`, matching `resolveWorkerBackgroundJobsOwnership()` and the `ecosystem.config.cjs` worker app exactly (§4 check 10). Combined with `F3-PROD-001` §3's API-side `ownsJobs=false` observation, the **currently observed** ownership matrix is the intended one: exactly one owner, no duplicate registration, no zero-owner state.
- **New evidence against closure:** §5 shows the API-side guarantee is **weaker than `F3-PROD-001` implied**. The API's `RUN_BACKGROUND_JOBS=false` is supplied by PM2's out-of-band stored environment, not by the repository-defined `ecosystem.config.cjs` — nothing repository-managed currently enforces it, and a `pm2 delete` / process-table loss / box rebuild would drop it. The row's criterion is about the flag's *production* value being under a verified, durable control, not about a single point-in-time reading. In addition, the API's value has not been re-read since this task's evidence window; only the worker was re-observed.
- **A newly surfaced, related failure mode worth recording (not a duplicate-registration event):** during the stale-worker window the *worker* ran pre-deploy code while the *API* ran post-deploy code. Job ownership stayed single-owner throughout, so R-034's specific risk did not materialize — but the window is a concrete instance of the deploy topology diverging from the repository contract without any signal.
- **Disposition: `OPEN` — not closed, evidence updated on both sides** (worker strengthened, API-side sourcing qualified).
- **Exact remaining evidence to close:** the API process observed with `role=api (declared=true)` **after** an `ecosystem.config.cjs`-driven `startOrReload`, together with `ownsJobs=false` — i.e. the flag proven to be delivered *by the repository-defined config source*, not by PM2's cached environment. This is satisfied by the same single deploy run named in §6.1.

### 6.3 R-040 — configuration-source ambiguity; no repository-defined PM2 config source

- **Row's missing control:** a repository-defined process/config contract — **added** by F3-IMPL-002 — with the explicit further condition, quoted from the row itself: *"gerçek production `cwd`'nin bu dosyayla eşleştiği ilk deploy'da doğrulanmalı"* (the real production `cwd` must be verified to match this file on the first deploy).
- **Row's status before this task:** `OPEN — repository-level mitigation implemented, production not yet verified`.
- **New evidence — this is the strongest advance of the three:** `pm2 startOrReload /var/www/noramedi/ecosystem.config.cjs --only noramedi-worker --update-env` **succeeded in production**, and the resulting process reported `role=worker (declared=true)` and `Prisma Client v7.9.1`. That is a genuine **first-application** of the repository-defined config source in production, and it proves three things at once for the worker app: the file resolves at the production path (the same path the synced deploy script computes, §4 check 8); its `env` block reaches the process (`declared=true` can only come from `NORAMEDI_PROCESS_ROLE=worker` being delivered); and the resolved `cwd` points at a tree carrying the deployed dependency versions.
- **New evidence against closure:** this covers **the worker app only**. The `noramedi-api` app has never been started or reloaded from `ecosystem.config.cjs` (§5) — its `cwd`, `script`, `args`, and `env` in production remain whatever the original out-of-band `pm2 start` recorded, unverified against the file. The row's criterion is about the process/config contract as a whole, both apps.
- **Disposition: `OPEN` — not closed; upgraded to *partially verified*.** New wording: *worker app's first production application of `ecosystem.config.cjs` confirmed (path resolves, `env` delivered, `declared=true`); **API app's `cwd`/`env` still not verified against the file***.
- **Exact remaining evidence to close:** an `ecosystem.config.cjs`-driven `startOrReload` of `noramedi-api` with the resulting process confirming `role=api (declared=true)`, plus a `pm2 describe noramedi-api` (or `pm2 jlist`) reading showing `cwd` equal to `/var/www/noramedi/server` and `script`/`args` matching the file. Satisfied by the same single deploy run named in §6.1.

### 6.4 Risks touched incidentally — no status change proposed

- **R-037** (PM2 restart counts require operational review): the supplied worker `restart_count` of `10` → `11` is **lower** than the `13` recorded for the same process by F0-002 on 2026-07-19, which means PM2's counter for `noramedi-worker` was reset at some point between the two observations (process deleted and re-added, or the PM2 daemon's process table recreated). This is consistent with R-033's own thesis — the worker's lifecycle has been managed out-of-band — and is recorded here as an observation. **R-037's row is not edited**; no closure criterion of that row is met, and the reset's cause is not established.
- **R-036** (PM2 processes run as `root`): the synced script was installed `root:root` `0755`, which neither improves nor worsens this row. **Not edited.**
- **R-018, R-019, R-073, R-074, R-075:** untouched by this evidence. **Not edited.**

## 7. F3 exit gate — re-assessment

Exit gate per `phases/F3_PRODUCTION_HARDENING.md` §"Exit gate (Çıkış kapısı)", unchanged, three criteria:

| # | Criterion | Status before this task | What this task's evidence adds | Status after this task |
|---|---|---|---|---|
| 1 | Observability standard demonstrably working live | `OPEN` | Nothing. `/livez` / `/readyz` re-confirmed `200` with `database=ok` / `redis=ok`, which is endpoint correctness, not a prober/alert channel/dashboard. **Indirect, negative signal:** a worker ran stale for an unknown period and was discovered manually, not by any monitor — a concrete illustration of R-074's gap. | **`OPEN`, unchanged** |
| 2 | Security hardening checklist closed | `PASS_WITH_EXTERNAL_VERIFICATION` | Mixed. **Positive:** the worker now demonstrably runs the deployed tree, including F3-SEC-003's remediated `7.9.1` Prisma family — the first production evidence that the dependency remediation is actually loaded in the job-executing process. **Negative:** §5 removes a claim the prior assessment relied on (deploy procedure == repository procedure), and adds a new open item (deploy-script drift, R-077 §8). | **`PASS_WITH_EXTERNAL_VERIFICATION`, unchanged** |
| 3 | Incident-response procedure verified via drill | `OPEN` | Nothing directly. Worth noting for whoever decides criterion 3: F3-IR-001's tabletop **Scenario A was a worker-stop scenario**, and a real (silent, undetected) worker-staleness event has now occurred in production — relevant input to the "is a simulated drill sufficient?" decision, but not a drill and not a decision this task can make. | **`OPEN`, unchanged** |

**F3 exit gate: `NOT SATISFIED` — unchanged.** No criterion's status changes. This task's evidence is production-topology verification, which none of the three criteria names.

**F3 COMPLETE: `NO`. F4 transition authorized: `NO`.**

## 8. New risk proposed — R-077 (installed-vs-repository operational script drift)

Recorded per this program's convention that a concrete supplied production finding gets a row (the same convention under which `F3-PROD-001` created R-075).

**Risk:** nothing guarantees that the operational scripts installed under `/usr/local/sbin/` match the repository copies under `scripts/`. The deploy path is `/usr/local/sbin/noramedi-deploy.sh`, but `git pull` only updates `/var/www/noramedi/scripts/noramedi-deploy.sh`; installation is a separate, manual, unverified step. **Demonstrated, not hypothetical:** the installed deploy script was 44 days and one F3 hardening change stale (§4), which silently voided F3-IMPL-002's entire worker deploy contract across at least two production deploys, and neither deploy failed or warned. The drift was invisible from inside the deploy.

**Scope beyond the one file that was fixed:** `scripts/noramedi-deploy.sh:37` invokes `HEALTHCHECK="/usr/local/sbin/noramedi-healthcheck.sh"` — a second installed-out-of-repository script whose sync state against `scripts/noramedi-healthcheck.sh` **was not verified** in the supplied evidence and is therefore `UNVERIFIED`. Any future edit to either repository script has the same silent-no-op failure mode until a sync mechanism exists.

**Missing control:** any mechanism that either (a) makes the deploy invoke the repository copy directly, (b) has the deploy self-verify the installed copy's hash against the repository copy and abort on mismatch, or (c) installs the scripts as an explicit, evidenced deploy step. **None is implemented by this task** — this is a documentation-only reconciliation and implementing any of them is a runtime/deployment change outside its scope.

**Status:** `OPEN`. **Phase:** F3. **Domain:** Deployment.

## 9. State distinctions preserved

Per the task brief and `NORAMEDI_MASTER_TRACKER.md` §2.2/§2.3, these are tracked separately and not collapsed:

| Item | Agent completed | Tests passed | PR opened | Merged | Deployed | Production verified |
|---|---|---|---|---|---|---|
| **F3-IMPL-002** (worker contract implementation) | yes (2026-08-10) | yes (2026-08-10) | yes (PR #357) | **yes** | **yes** — code present in `aa18b06` | **PARTIAL** — worker app's `ecosystem.config.cjs` start confirmed (§6.3); worker deploy **automation** installed but **never executed** (§6.1); API app's ecosystem contract **not** verified (§6.3) |
| **F3-SEC-003** (dependency remediation) | yes | yes | yes (PR #401) | **yes** — `aa18b064267ff5846ae60f73889c3322030bd4a8` | **yes** — deployed SHA *is* that merge commit | **PARTIAL** — worker confirmed loading remediated `Prisma Client v7.9.1`; no post-deploy production `npm audit` re-run supplied (R-075's own closure evidence remains outstanding) |
| **F3-PROD-001** (deployment reconciliation) | yes | n/a (docs-only) | yes (PR #400) | **yes** | n/a | n/a — **one recorded fact corrected by §5** |
| **F3-IMPL-002-PROD-RECON** (this task) | yes | n/a — no code changed; no test suite applies | yes (see §11) | **no** | n/a — docs-only | n/a |

Note the distinctions this task deliberately refuses to blur: *PM2 `online`* ≠ *running the deployed code*; *script installed* ≠ *script executed*; *flag observed `false`* ≠ *flag enforced by the repository-defined config source*; *worker app verified* ≠ *both apps verified*.

## 10. Validation performed by this task

```
git diff --check      → clean, exit 0 (no whitespace errors, no conflict markers)
```

No test suite was run: this task changes no application, test, dependency, schema, migration, CI-workflow, or script file, so no suite is in scope. No program-level `docs` / `validate:docs` script exists in this repository (re-checked at this baseline — `package.json` has no such script), so none was run.

Files changed — all under `docs/program/**`:

1. `docs/program/evidence/F3-IMPL-002-PROD-RECON_PRODUCTION_WORKER_CONTRACT_VERIFICATION.md` — **new**, this file
2. `docs/program/evidence/F3-PROD-001_PRODUCTION_DEPLOYMENT_AND_VERIFICATION.md` — additive superseding-correction banner only; body preserved unedited (§5)
3. `docs/program/evidence/README.md` — index row for this file
4. `docs/program/NORAMEDI_MASTER_TRACKER.md` — top entry, §11 production-verification-history row, §13 exact-next-task entry
5. `docs/program/CURRENT_PHASE.md` — top entry
6. `docs/program/phases/F3_PRODUCTION_HARDENING.md` — top status line + entry, change-history row
7. `docs/program/RISK_REGISTER.md` — new "Son güncelleme" entry; R-033 / R-034 / R-040 rows updated (evidence + status wording, **none closed**); new row R-077

**Documentation-hygiene gap noted, not fixed** (consistent with F3-PROGRAM-RECON-001's precedent for such notes): the `phases/F3_PRODUCTION_HARDENING.md` change-history table and `evidence/README.md` index both stop at F3-PROGRAM-RECON-001 — they have no rows for F3-IMPL-005(+R1), F3-IMPL-007, F3-CI-OPT-001, F3-PROD-001, or F3-SEC-003, all of which are covered in prose elsewhere. This task adds only its own rows; back-filling the others is left to a dedicated documentation-hygiene pass.

## 11. Task state

`AGENT_COMPLETED` · `PR_OPENED` — see the pull-request reference recorded in `NORAMEDI_MASTER_TRACKER.md` §13 and `CURRENT_PHASE.md` · **`NOT_MERGED`** · `NOT_DEPLOYED` (documentation-only; nothing to deploy) · `NOT_PRODUCTION_VERIFIED` (this task performed no production access).

No risk was self-closed. No merge decision is claimed. Per §2.3 of the tracker, `MERGED` / `DEPLOYED` / `PRODUCTION_VERIFIED` are external-confirmation states this task cannot assign.

## 12. Exact next task

**F3-PROD-002 — Deploy-Script Execution Verification and API Ecosystem-Contract Confirmation.** A single operator-executed production action, followed by a small reconciliation: run the now-synced `/usr/local/sbin/noramedi-deploy.sh` (the minimal sufficient form being `--skip-pull --skip-build --skip-migrate --skip-generate`, which exercises exactly steps 5–8, in a maintenance window because the first ecosystem-driven API `startOrReload` may be a full restart), and capture:

1. step 5 — API `startOrReload` from `/var/www/noramedi/ecosystem.config.cjs`, and the API's resulting startup log line showing `role=api (declared=true)`, `ownsJobs=false` → **closes R-034's remaining half and R-040's API half**;
2. `pm2 describe noramedi-api` showing `cwd` = `/var/www/noramedi/server` and `script`/`args` matching the file → **completes R-040's stated `cwd` criterion**;
3. steps 6 and 8 — worker `startOrReload` and `verify_pm2_online noramedi-worker` reaching `online`, with the script exiting `0` → **closes R-033's execution gap**;
4. `sha256sum /usr/local/sbin/noramedi-healthcheck.sh` compared against the repository copy → resolves the second half of R-077's exposure.

Not blocking, and separate: R-077 itself needs a decision on which of the three sync mechanisms in §8 to adopt; and the F3 exit gate's three criteria remain exactly as `F3-PROD-001` §13 listed them — external observability wiring, external security-checklist verification, and a program-owner decision on incident-drill sufficiency. None of those is a coding task, and none is started by this task.

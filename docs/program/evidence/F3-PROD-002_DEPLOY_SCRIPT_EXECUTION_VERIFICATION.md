# F3-PROD-002 — Deploy-Script Execution Verification and API Ecosystem-Contract Confirmation

**Phase:** F3 — Production Hardening. **Type:** documentation/program-control reconciliation of **operator-executed, user-supplied production evidence** — this task itself performed **no production access**. Every production fact recorded in §3 was supplied by the operator and is **not** independently re-derived by this task; every repository fact in §4, §5 and §15 **was** independently derived here from local git/file inspection and is labelled as such.

**Production execution date (as supplied):** 2026-08-12. **Reconciliation date:** 2026-08-12.

---

## 1. Baseline

| Item | Value |
|---|---|
| Branch | `docs/f3-prod-002-deploy-script-execution-verification` |
| Baseline | `origin/main` @ `0d1b4ae9597b07dc0509f992a2a05663c015388f` — PR #402's merge commit (F3-IMPL-002-PROD-RECON), confirmed by `git fetch origin` + `git rev-parse origin/main`; working tree clean, no drift |
| Production deployed SHA (as supplied, unchanged by this deploy) | `aa18b064267ff5846ae60f73889c3322030bd4a8` |
| Baseline vs production SHA | **Not equal, and this is expected and harmless.** `git diff --name-only aa18b06… 0d1b4ae… \| grep -v '^docs/'` returns **0 files** — PR #402 was documentation-only |
| Contract files at both SHAs | **Byte-identical**, verified blob-by-blob (§15). `ecosystem.config.cjs`, `scripts/noramedi-deploy.sh`, `scripts/noramedi-healthcheck.sh`, `server/package.json`, `server/src/index.ts`, `server/src/worker.ts`, `server/src/utils/processRole.ts`, `server/src/utils/backgroundJobsOwnership.ts` |

The last row is what makes this reconciliation sound: the repository contract this task compares production against is the *same bytes* production is running, even though `origin/main` is ahead of production — the complete delta is docs-only and the 8 runtime-contract files are byte-identical.

**Superseded branch note.** `docs/f3-impl-002-prod-recon-v2` @ `06ff0b0` — carried into this session as an in-progress branch — is the head of **closed, unmerged PR #403** (`mergedAt: null`, `state: CLOSED`). It is a *sibling* of `origin/main`, not an ancestor: both branched from `aa18b06` and solved the F3-IMPL-002 reconciliation independently, and `origin/main` won, additionally carrying the R1/R2 corrections that branch lacks. It was **not** built on. Its untracked 236-line draft evidence file was preserved (moved to a scratch location, not deleted) before this branch was created; the merged 347-line file at the same path is a strict superset of it.

---

## 2. Purpose

F3-IMPL-002 (PR #357, merged) defined a repository-owned PM2 lifecycle for **both** production processes: `ecosystem.config.cjs` as the single source of truth, and `scripts/noramedi-deploy.sh` steps 5–8 as the mechanism that applies it. F3-IMPL-002-PROD-RECON (PR #402) then discovered that the *installed* deploy script at `/usr/local/sbin/noramedi-deploy.sh` had been frozen at the 2026-06-29 pre-F3-IMPL-002 revision for 44 days, silently no-op'ing that entire contract, and synchronized it — **without executing it**.

That left one precise, named gap, which three open risk rows were all waiting on: **the repository-synchronized deploy mechanism had never actually run.** Not "the code exists"; not "the worker was manually restarted once."

This task closes exactly that gap, and nothing wider. Its acceptance standard is that the repository-synchronized production deploy mechanism itself has performed the API and worker lifecycle end-to-end, produced exit `0`, left both processes healthy under the correct ecosystem contract, and produced reproducible evidence.

---

## 3. Accepted production evidence (as supplied, not independently re-verified)

Classification: `VERIFIED_PRODUCTION_OBSERVED` — operator-executed on the production VPS, point-in-time. No secret value, environment dump, message payload, patient identifier, or other PII/PHI appears anywhere in this document.

### 3.1 Invocation and result

| Item | Value |
|---|---|
| Command | `/usr/local/sbin/noramedi-deploy.sh --skip-pull --skip-build --skip-migrate --skip-generate` |
| Production HEAD before | `aa18b064267ff5846ae60f73889c3322030bd4a8` |
| Production HEAD after | `aa18b064267ff5846ae60f73889c3322030bd4a8` — **unchanged**, as `--skip-pull` requires |
| Exit code | `deploy_exit=0` |
| Production mutation sequences | Exactly **one**. No second deploy, no ad-hoc fix-forward edit, no repository mutation on the host |

The four skip flags were chosen deliberately as the **minimal sufficient invocation**: they suppress steps 1–4 (`git pull`, `npm ci`, `prisma migrate deploy`, `prisma generate`) and exercise steps 5–8 — the four steps that constitute the previously-unexercised contract — and nothing else. Blast radius is therefore PM2 process state only; see §11.

### 3.2 API — `noramedi-api`

| Item | Value |
|---|---|
| Lifecycle action | PM2 reloaded via step 5 |
| PID | → `607545` |
| `restart_time` | `11` → `12` |
| Status | `online` |
| Unstable restarts | `0` |
| Exec `cwd` | `/var/www/noramedi/server` |
| Script / args | `npm run start` |
| Runtime ownership log | `[jobs] API background-jobs ownership: role=api (declared=true) ownsJobs=false (RUN_BACKGROUND_JOBS=false — jobs delegated to a dedicated worker process)` |

### 3.3 Worker — `noramedi-worker`

| Item | Value |
|---|---|
| Lifecycle action | PM2 reloaded via step 6 |
| PID | → `607578` |
| `restart_time` | `11` → `12` |
| Status | `online` |
| Unstable restarts | `0` |
| Exec `cwd` | `/var/www/noramedi/server` |
| Script / args | `npm run start:worker` |
| Step 8 verification output | `OK — PM2 process 'noramedi-worker' is online after 1 attempt(s).` |
| Runtime ownership log | `[worker] Background job worker starting... role=worker (declared=true) ownsJobs=true` |
| Job registration log | `[worker] All background jobs scheduled.` |

**Lineage continuity, independently notable.** F3-IMPL-002-PROD-RECON recorded the manually-reconciled worker at PID `605889` / `restart_count` `11`. This run observes `11` → `12`. The counter is continuous across the two observations, which corroborates that this deploy acted on the *same* PM2 app record created by that reconciliation — it did not create a duplicate app entry — and that it restarted the worker exactly once.

### 3.4 API healthcheck behaviour (step 7)

| Attempt | HTTP code |
|---|---|
| 1 | `000` |
| 2 | `000` |
| 3 | `000` |
| 4 | `200` |

API became healthy approximately **19 seconds** after deploy start. The step-7 invocation is `--local --max-attempts 12 --interval 5`, so this consumed 4 of a 12-attempt budget and succeeded well inside it. See §7 for the disposition of this observation.

### 3.5 Post-deploy verification

| Check | Result |
|---|---|
| External `GET /api/health` | `{"status":"ok"}`, `api_health_exit=0` |
| Installed healthcheck re-run | `OK (200) — API healthy after 1 attempt(s).`, `healthcheck_exit=0` |
| `sha256sum` — deploy script, installed vs repository copy | `794375b4249b063e167a8d6f885df1a590bd9de9df367e91a0d3eaaf635f5012` — **exact match** |
| `sha256sum` — healthcheck script, installed vs repository copy | `14a148982d74eda76d7adf757e09a32c0329b65195413961ca32cd4b8c6cef7e` — **exact match** |

Both hashes are independently reproduced from this repository in §15. The healthcheck hash is the **first measurement ever taken** of that file's installed copy — see §9.4.

### 3.6 Rollback anchor, re-examined on production

| Check | Result |
|---|---|
| Object exists in the production repository's object database | **YES** |
| Object type | `commit` |
| `git show` | succeeds |
| Commit subject | `fix(external-calendar): enforce practitioner eligibility on the mapping write path (F3-DIGIDENTIS-MAP-001-R1)` |
| `git merge-base --is-ancestor b21cae91… aa18b06…` | exit **`1`** — **not an ancestor of current production** |

Dispositioned in §11.

---

## 4. Repository contract reconciliation

This is the core of the task: does the observed production lifecycle match the *intended* `startOrReload` implementation as defined in the repository? Every "contract" cell below is read from the repository at `0d1b4ae`, whose relevant blobs are byte-identical to the deployed SHA (§1, §15). Every "observed" cell is from §3.

| # | Repository contract (file:line) | Observed in production | Verdict |
|---|---|---|---|
| 1 | Steps 1–4 gated behind `--skip-pull` / `--skip-build` / `--skip-migrate` / `--skip-generate` (`scripts/noramedi-deploy.sh:49-58`, `65-89`) | No pull, no `npm ci`, no `migrate deploy`, no explicit generate phase; HEAD unchanged | **MATCH** |
| 2 | Step 5 — `pm2 startOrReload "$ECOSYSTEM_FILE" --only noramedi-api --update-env` (`:134`), `ECOSYSTEM_FILE="$APP_DIR/ecosystem.config.cjs"`, `APP_DIR` default `/var/www/noramedi` (`:33,36`) | API reloaded, PID → `607545`, `restart_time` `11`→`12` | **MATCH** |
| 3 | `apps[noramedi-api].cwd = path.join(__dirname,'server')` (`ecosystem.config.cjs:44,50`) → `/var/www/noramedi/server` | exec `cwd` = `/var/www/noramedi/server` | **MATCH** |
| 4 | `apps[noramedi-api].script='npm'`, `args='run start'` (`:51-52`) | script `npm run start` | **MATCH** |
| 5 | `apps[noramedi-api].env.NORAMEDI_PROCESS_ROLE='api'` (`:56`) | `role=api (declared=true)` | **MATCH** — see the `declared` argument below |
| 6 | `apps[noramedi-api].env.RUN_BACKGROUND_JOBS='false'` (`:57`) | `ownsJobs=false`, reason string `RUN_BACKGROUND_JOBS=false — jobs delegated to a dedicated worker process` | **MATCH** — see the `ownsJobs` argument below |
| 7 | Step 6 — `pm2 startOrReload … --only noramedi-worker --update-env` (`:140`) | Worker reloaded, PID → `607578`, `restart_time` `11`→`12` | **MATCH** |
| 8 | `apps[noramedi-worker].cwd` same `SERVER_DIR` (`:62`); `script='npm'`, `args='run start:worker'` (`:63-64`) | exec `cwd` = `/var/www/noramedi/server`, script `npm run start:worker` | **MATCH** |
| 9 | `apps[noramedi-worker].env.NORAMEDI_PROCESS_ROLE='worker'` (`:68`) | `role=worker (declared=true)` | **MATCH** |
| 10 | Worker owns jobs unconditionally — `resolveWorkerBackgroundJobsOwnership()` returns `ownsJobs:true` with no env read (`backgroundJobsOwnership.ts:65-70`); `worker.ts:41-46` logs it, `:45-46` schedules and logs | `ownsJobs=true`; `All background jobs scheduled.` | **MATCH** |
| 11 | Step 7 — `"$HEALTHCHECK" --local --max-attempts 12 --interval 5` (`:147`), `HEALTHCHECK=/usr/local/sbin/noramedi-healthcheck.sh` (`:37`); `000` is retryable, `200` is success (`noramedi-healthcheck.sh:74-92`) | 3× `000` then `200` at attempt 4 of 12 | **MATCH** — inside the declared retry budget |
| 12 | Step 8 — `verify_pm2_online "$PM2_WORKER_NAME" 12 5` (`:154`); success message format `OK — PM2 process '$name' is online after $attempt attempt(s).` (`:119`) | `OK — PM2 process 'noramedi-worker' is online after 1 attempt(s).` | **MATCH** — the emitted string is the exact format literal at `:119` |
| 13 | `set -euo pipefail` (`:31`); step 8 failure path `exit 1` (`:157`); success falls through to the final echo (`:160`) | `deploy_exit=0` | **MATCH** |
| 14 | `exec_mode: 'fork'`, single instance, both apps (`:54,66`) | single-instance fork lifecycle (§7's unavailability window is its direct consequence) | **MATCH** |

**Why `declared=true` is the load-bearing token, not `role=api`.** `assertProcessRole()` (`processRole.ts:48-76`) returns `{declared:false, role:expectedRole}` when `NORAMEDI_PROCESS_ROLE` is **unset** — i.e. an un-configured process still reports its entrypoint's own role. `role=api` alone therefore proves nothing about where the configuration came from. `declared:true` is reachable on exactly one path (`:75`), reached only after the value is present, recognized, *and* equal to the entrypoint's expected role. `role=api (declared=true)` is consequently direct runtime proof that `ecosystem.config.cjs`'s `env` block was delivered into the API process — which is precisely R-040's outstanding criterion.

**Why `ownsJobs=false` proves the flag's value.** `resolveApiBackgroundJobsOwnership()` (`backgroundJobsOwnership.ts:38-53`) returns `ownsJobs:false` on **one** branch only: `env.RUN_BACKGROUND_JOBS === 'false'`, exact string equality. Unset yields `true`; any other value yields `true`. The observed reason string is the verbatim literal from `:41`. This is runtime evidence of the real production value, not an inference from configuration.

**Runtime, not grep.** Both ownership facts above come from process startup logs emitted by the running production processes, not from static inspection of a config file. This distinction was an explicit requirement: no HTTP endpoint exposes `ownsJobs` — `/api/livez` and `/api/readyz` (`server/src/routes/health.ts:45-58`) return `role` only — so PM2 log inspection is the only supported runtime proof of job ownership, and it is what was captured.

---

## 5. Required evidence — A–F verdicts

| # | Required evidence | Status | Source |
|---|---|---|---|
| A | Step 5 API `startOrReload` from the ecosystem file actually executed | **SATISFIED** | §3.2; contract row 2 |
| B | Runtime (not grep) proof of `role=api`, `declared=true`, `ownsJobs=false` | **SATISFIED** | §3.2 startup log; contract rows 5–6 |
| C | API `cwd` = `/var/www/noramedi/server` | **SATISFIED** | §3.2; contract row 3 |
| D | Step 6 worker `startOrReload` executed | **SATISFIED** | §3.3; contract row 7 |
| E | Step 8 `verify_pm2_online noramedi-worker` reached `online` | **SATISFIED** | §3.3, exact `:119` format literal; contract row 12 |
| F | `exit 0` explicitly captured | **SATISFIED** | §3.1 `deploy_exit=0`; contract row 13 |

All six are satisfied by a single deploy run. No item is partially satisfied, inferred, or substituted.

---

## 6. Operational-contract nuance — Prisma Client generation

Recorded accurately, and **not** classified as a failure.

`--skip-generate` suppressed the deploy script's **explicit** generation phase (step 4, `scripts/noramedi-deploy.sh:86-89`). It did **not** prevent Prisma Client generation from occurring, because generation also lives inside the package start scripts themselves:

```
server/package.json:10   "start":        "npx prisma generate && tsx src/index.ts"
server/package.json:11   "start:worker": "npx prisma generate && tsx src/worker.ts"
```

Since `ecosystem.config.cjs` starts both apps via `npm run start` / `npm run start:worker`, every PM2 start or restart runs `npx prisma generate` before the entrypoint executes. Production logs confirm generation occurred for both process startups.

**Accurate classification:**

| Item | Value |
|---|---|
| Migration executed | **NO** |
| `git pull` executed | **NO** |
| `npm ci` / build executed by the deploy phase | **NO** |
| Explicit deploy generate phase (step 4) | **SKIPPED** |
| Prisma Client generation during process startup | **YES**, both processes |

**Assessment.** This is a naming/redundancy nuance in the operational contract, not a contract violation: nothing in the repository claims `--skip-generate` suppresses *all* generation, and step 4's own comment describes it as "cheap; ensures client matches schema after migration" — a post-migration safeguard, not the only generation path. The substantive consequence is that `--skip-generate` cannot deliver the startup-time saving an operator might reasonably expect from its name, and that `prisma generate` remains on the critical path of every process start.

**This is already tracked.** R-063's own row states the root cause verbatim — *"the API's startup command is `npm run start` → `npx prisma generate && tsx src/index.ts`; the process only begins listening … after Prisma Client generation completes"* — and its named remediation is *"pre-generate the Prisma Client at build/deploy time (not at process start)."* No new risk row is created. This evidence **strengthens R-063** and is recorded there. A dedicated cleanup task is warranted but is **not** opened by this PR (§18).

---

## 7. Availability observation

Measured deployment behaviour, recorded as fact:

> **The single-instance PM2 fork-mode lifecycle causes a short API unavailability/startup window.** Three consecutive local health probes returned `000` before the API returned `200` on the fourth attempt, ≈19 s after deploy start.

**This is not called zero-downtime, and it is not called a failure.**

- It is **not a failure of F3-PROD-002.** The acceptance criteria permit bounded startup recovery explicitly: step 7 is specified with a 12-attempt / 5-second retry budget (`noramedi-deploy.sh:147`), `000` is an explicitly retryable code (`noramedi-healthcheck.sh:84-92`), and recovery consumed 4 of 12 attempts. The mechanism behaved exactly as designed.
- It is **the documented, expected shape.** `ecosystem.config.cjs:25-33` warns that the **first** ecosystem-driven `startOrReload` falls back to a full restart rather than a zero-downtime reload when the app was originally `pm2 start`-ed outside this repository with a different script/cwd/args — "expected and one-time, not a bug." This run is exactly that first application for `noramedi-api`.
- It is **already tracked as R-063**, which describes the same phenomenon from the 2026-07-20 deployment (transient 502 on the first health check after reload). This run supplies the **first raw, committed measurement** of the window: previously R-063 was `PARTIALLY_VERIFIED` on an operator description with "no raw log excerpt committed to the repository."
- It is **input to later HA / rolling-deployment work** (F7 — Horizontal Scaling and High Availability), not a trigger for an unrelated implementation in this PR. No cluster mode, no `wait_ready`, no readiness-gated reload is implemented here.

One secondary observation, recorded without attribution: a live uptime prober would have caught this 19-second window, and none exists. That is **R-074**'s gap (no live observability/alerting) and F3 exit-gate criterion 1. It is a negative signal about the gap's cost, not progress toward closing it.

---

## 8. Historical log findings — attribution discipline

The supplied `pm2 logs --lines` output contains historical errors and warnings. **None is attributed to F3-PROD-002**, because the supplied output carries no temporal evidence tying any of them to this deploy. Each is mapped to its existing tracked item rather than duplicated:

| Log finding | Existing tracked item | Disposition |
|---|---|---|
| Revenue report PostgreSQL `GROUP BY` error | Fixed by PR #252 / commit `08f2eaf82a205cf3f997c57e6a295fedd66b142d` (2026-07-28, `fix(reports): repair revenue period grouping`), **independently verified by this task to be an ancestor of the deployed SHA `aa18b06…`** | Historical, predates the fix now live in production. No risk row, no follow-up |
| Redis `ECONNREFUSED` with in-memory fallback | — | **Explicitly not a current fault.** The current API startup reports `[redis] Shared store enabled via REDIS_URL.` (`server/src/utils/redis.ts:41`), and F3-IMPL-002-PROD-RECON recorded `/api/readyz` `redis=ok`. Historical lines only |
| WhatsApp step-aware NLU parse error | **R-066** | Existing row, referenced, not duplicated. `OPEN`, unchanged |
| Reminder messages lacking approved Meta templates | **R-069** | Existing row, referenced, not duplicated. `OPEN`, unchanged |
| Historical `node-cron` missed executions | **R-068** | Existing row, referenced, not duplicated. `OPEN`, unchanged |
| `pg` client deprecation warning | **R-067** | Existing row, referenced, not duplicated. `OPEN`, unchanged |

No new risk row is minted from historical log content, and this production-verification PR is not broadened to address any of them.

---

## 9. Risk disposition

Each row is assessed **only** against the closure criteria its own `RISK_REGISTER.md` row states. Two rows close; the rest do not.

### 9.1 R-033 — no repository-defined deploy/reload automation for `noramedi-worker` → **`CLOSED`**

R-033's row states its remaining closure evidence verbatim:

> *"Kalan tam kapanış kanıtı: steps 5-8'in tek bir başarılı koşuda yakalanması (API `startOrReload` + worker `startOrReload` + API healthcheck + `verify_pm2_online noramedi-worker` `online`, script `exit 0`)."*

| R-033's own stated closure element | Status | Evidence |
|---|---|---|
| API `startOrReload` | **SATISFIED** | §3.2, contract row 2 |
| Worker `startOrReload` | **SATISFIED** | §3.3, contract row 7 |
| API healthcheck | **SATISFIED** | §3.4, contract row 11 |
| `verify_pm2_online noramedi-worker` → `online` | **SATISFIED** | §3.3, exact `:119` literal, contract row 12 |
| Script `exit 0` | **SATISFIED** | §3.1 |
| Single successful run capturing all of the above | **SATISFIED** | One invocation, §3.1 |

Every element the row itself named is met, in one run, from the installed production invocation path. **Disposition: `CLOSED`.**

**Not self-closure.** The remediating task was F3-IMPL-002 (repository fix) and the installation was F3-IMPL-002-PROD-RECON; the execution and evidence were produced by the operator. This task is an independent reconciliation of externally-supplied evidence, matching the precedent under which R-034 and R-075 were closed (`R-019/R-071/R-072/R-073` no-self-closure rule honoured).

**Caveats retained, not absorbed by this closure:**

- **Reboot persistence is unverified.** `pm2 save` was not evidenced; whether the PM2 process table survives a host reboot is unknown. That exposure belongs to **R-077** and remains open.
- **Drift prevention is unchanged.** Nothing stops the installed script from going stale again — **R-077**, open.
- **Registration-level, not execution-level.** `All background jobs scheduled.` is job *registration*. No completed job tick and no `JobLock` lease acquisition is observed or claimed.
- The observation is **point-in-time**.
- This closure does **not** close R-040 by implication (argued separately below), R-063, R-074, R-076 or R-077, and does **not** satisfy the F3 exit gate.

### 9.2 R-040 — configuration-source ambiguity → **`CLOSED`**

R-040's row states its remaining closure evidence verbatim:

> *"Kalan tam kapanış kanıtı: ecosystem-kaynaklı API `startOrReload` + `role=api (declared=true)` + `pm2 describe noramedi-api` ile `cwd` = `/var/www/noramedi/server` teyidi"*

| R-040's own stated closure element | Status | Evidence |
|---|---|---|
| Ecosystem-sourced API `startOrReload` | **SATISFIED** | §3.2; step 5 resolves `$APP_DIR/ecosystem.config.cjs`, contract row 2 |
| `role=api (declared=true)` | **SATISFIED** | §3.2 startup log; `declared:true` reachable only via `processRole.ts:75` — §4 |
| PM2 process metadata: `cwd` = `/var/www/noramedi/server` | **SATISFIED** | §3.2; contract row 3 |

The row's prior state was `OPEN — partially verified: worker app confirmed; API app's cwd/env still unverified against the file`. The API half is now verified on all three of its own named criteria, and `script`/`args` match the file additionally. Both PM2 apps now demonstrably derive their `cwd`, `script`, `args` and role-specific `env` from the repository-defined `ecosystem.config.cjs`. **Disposition: `CLOSED`.**

**Caveats retained:**

- `dotenv.config()`'s `process.cwd()` dependence at each entrypoint is now *anchored* by a repository-defined, verified `cwd` — the ambiguity this row named is resolved. It is not a claim that every configuration value is repository-defined: secrets (`DATABASE_URL`, `REDIS_URL`, `ENCRYPTION_KEY`, …) continue to come from the process environment by design (`ecosystem.config.cjs:35-38`), and this task neither read nor recorded any of them.
- Reboot persistence of the PM2 process table is **unverified** (R-077).
- Point-in-time observation.
- Does not close R-063, R-074, R-076 or R-077, and does not satisfy the F3 exit gate.

### 9.3 R-034 — duplicate job registration → **already `CLOSED`, corroborated, not re-closed**

R-034 was closed by F3-IMPL-002-PROD-RECON **[R2]** on its own criterion (verification of the real production `RUN_BACKGROUND_JOBS` value). This run **corroborates** that closure and strengthens its provenance: the same `ownsJobs=false` is now observed on an API process demonstrably started from `ecosystem.config.cjs` (`declared=true`), rather than from PM2's out-of-repository cached environment. The observed ownership matrix is again **exactly one job owner** — API opted out, worker unconditional, all jobs scheduled.

No status change is made here, and none is needed. The stale tracker statement that F3-PROD-002 would *"close R-034's remaining half"* is corrected in §14.

### 9.4 R-077 — installed-vs-repository operational script drift → **remains `OPEN`, one half resolved**

R-077 has two distinct halves. They resolve differently:

| Half | Prior state | Now | Reason |
|---|---|---|---|
| **(a)** `noramedi-healthcheck.sh` installed-vs-repository sync state | `UNVERIFIED` | **RESOLVED** | `14a148982d74eda76d7adf757e09a32c0329b65195413961ca32cd4b8c6cef7e` on both copies — **the first measurement ever taken** of this file's installed copy. F0-002 had only ever confirmed "present and executable" |
| **(b)** No mechanism enforces installed-vs-repository parity | `OPEN` | **STILL `OPEN`** | None of the row's own three options — (a) deploy invokes the repository copy directly, (b) deploy hash-verifies and aborts on mismatch, (c) script installation becomes an explicit evidenced deploy step — is implemented. All three are runtime/deployment changes and are out of this documentation task's scope |

**Disposition: `OPEN`** — status wording updated to record that both installed operational scripts are now hash-verified in sync, while the recurrence mechanism is unaddressed.

**Behavioural corroboration of the hash match, worth recording.** Beyond the `sha256sum` comparison, this run supplies *behavioural* proof that the installed script is the post-F3-IMPL-002 version: it executed steps 5–8, referenced `ecosystem.config.cjs`, reloaded the worker, and emitted `verify_pm2_online`'s exact `:119` format literal — none of which exists in the 2026-06-29 revision that was installed until 2026-08-12. A hash can be matched against the wrong basis; this cannot.

**Line-ending caveat, for whoever repeats the comparison.** A Windows checkout of this repository materializes both scripts with CRLF, hashing to `917ee40a…` (deploy) and `0d42ccfb…` (healthcheck). Comparing *those* against the Linux host's copies would produce a **false mismatch**. The correct basis is the LF blob hash, reproduced in §15.

### 9.5 R-063 — startup unavailability window on reload → **remains `OPEN`, evidence strengthened**

Two new pieces of evidence, no status change:

1. The **first raw committed measurement** of the window (§7): 3 consecutive local `000` probes, `200` at attempt 4, ≈19 s. R-063's evidence column previously noted "no raw log excerpt committed to the repository."
2. A sharper statement of the root cause (§6): because `npx prisma generate` lives in the package `start` scripts and not only in deploy step 4, **the deploy script's `--skip-generate` flag cannot suppress it.** This is direct support for R-063's own named remediation — pre-generate at build/deploy time rather than at process start.

Not closed; no remediation implemented here.

### 9.6 Risks touched incidentally — no status change

- **R-037** (PM2 restart counts require operational review): worker `11`→`12` is continuous with F3-IMPL-002-PROD-RECON's `11`, which is clean. API `11`→`12`, however, is *lower* than the `14` F0-002 recorded on 2026-07-19 — the same counter-reset phenomenon R-037 already carries for the worker (`10`→`11` versus F0-002's `13`). Recorded as an observation consistent with the existing row. **Not edited beyond an evidence note.**
- **R-036** (PM2 processes run as `root`): unchanged; this run neither improves nor worsens it.
- **R-018, R-019, R-073, R-074, R-075, R-076:** untouched by this evidence. **Not edited.**
- **R-066 / R-067 / R-068 / R-069:** referenced in §8 as the existing homes of historical log findings. **Not edited, not duplicated.**

---

## 10. F3-IMPL-002 — final status

F3-IMPL-002's production status was tracked in two halves. Both are now resolved:

| Half | Prior classification | New classification | Basis |
|---|---|---|---|
| Role / job-ownership contract | `VERIFIED_PRODUCTION_OBSERVED` (point-in-time, partial — API's value observed but not sourced from the repository config) | **`PRODUCTION_VERIFIED`** | Both processes now observed with `declared=true` under an ecosystem-driven lifecycle; ownership matrix verified with exactly one owner |
| Deploy lifecycle | `INSTALLED_NOT_YET_EXERCISED` | **`PRODUCTION_VERIFIED`** | The repository-synchronized deploy mechanism performed the full API + worker lifecycle end-to-end, exit `0`, both processes healthy under the correct contract (§4, §5) |

**F3-IMPL-002 final status: `PRODUCTION_VERIFIED`.** The repository contract reconciliation in §4 confirms the observed lifecycle matches the intended `startOrReload` implementation on all 14 contract points, with zero mismatches.

**Explicitly not claimed by this status:** background-job *execution* (no completed tick, no `JobLock` lease observed); PM2 reboot persistence; protection against future installed-script drift; zero-downtime reload.

---

## 11. Rollback — correction and current anchor

### 11.1 Correction to the prior classification

F3-IMPL-002-PROD-RECON §5.2 **[R2]**, and this session's own pre-execution analysis, classified `b21cae911a0aa3444ebcd6e714a92c4f0802608a` as *unresolvable*. Fresh production evidence (§3.6) **narrows that**, and the earlier statement is corrected additively — not deleted.

**What remains true and is unchanged:**

- The object does **not** exist in this repository's object database. Re-verified at this baseline: `git cat-file -t` → `fatal: could not get object info`; `git cat-file -e` → exit `1`; `git rev-parse --verify --quiet …^{commit}` → exit `1`.
- `origin` denies it server-side: `git fetch origin b21cae91…` → `upload-pack: not our ref`.
- *(Method note: `git rev-parse --verify b21cae91…` echoes the SHA back with exit `0`. That is syntax validation of a well-formed 40-hex string, **not** object existence, and must not be used for this check.)*

**What is now corrected:**

- The object **does exist locally on the production host**, type `commit`, `git show` succeeds, subject `fix(external-calendar): enforce practitioner eligibility on the mapping write path (F3-DIGIDENTIS-MAP-001-R1)`.
- **It is therefore no longer accurate to say the object is globally nonexistent.**

**What the new evidence establishes:**

- `git merge-base --is-ancestor b21cae91… aa18b06…` exits `1` on production — the commit is **not on current production's lineage**.
- Independently verified by this task in the repository: `origin/main` carries commit `152ebaf5e9ad9b2da822d286c9354a9755d63440` (2026-08-11) with the **byte-identical commit subject**, and `152ebaf` **is** an ancestor of `aa18b06`.

**Inference, labelled as such and not asserted as fact:** the pairing above is most consistent with `b21cae91…` being a pre-squash PR-branch commit for F3-DIGIDENTIS-MAP-001-R1, whose squash-merged equivalent on `main` is `152ebaf`. This would explain both origin's `not our ref` (the branch was deleted after squash-merge) and the object's continued presence in the production clone's object database. This is **not** claimed as proven, and no rollback decision should rest on it.

**Corrected classification:**

> `b21cae911a0aa3444ebcd6e714a92c4f0802608a` is **locally resolvable on production, but invalid as the documented rollback-lineage anchor for current production.**

### 11.2 Current valid anchor

| Item | Value |
|---|---|
| Valid production rollback anchor | **`aa18b064267ff5846ae60f73889c3322030bd4a8`** — resolvable in this repository, ancestor of `origin/main`, reachable on `origin`, and simultaneously the current production deployed SHA |
| Repository tags available as anchors | **none** — `git tag --list` returns 0 entries |
| Rollback method | `git -C /var/www/noramedi checkout <sha>` + reload-only deploy, per `runbooks/F3_FIRST_CUSTOMER_INCIDENT_RESPONSE.md` §4.1 |
| Migration rollback | **Not possible and not needed** — no migration ran (§6); never roll back an additive migration (R-046) |
| Rollback tested? | **INSPECTION-ONLY.** Not executed |

### 11.3 Rollback exposure of this specific deploy

Low, but not "PM2 state only" — the precise classification, restated from §6:

| Action | Occurred |
|---|---|
| `git pull` | **NO** |
| `npm ci` / build | **NO** |
| Migration | **NO** |
| Explicit deploy generate phase (step 4) | **SKIPPED** |
| Prisma Client generation at process startup | **YES** — both processes, proven by production logs (§6) |
| Source / schema / lockfile changes | **NO** — HEAD unchanged at `aa18b06` |
| PM2 lifecycle (reload/restart, `restart_time` counters) | **mutated as intended** |

`--skip-pull` left production HEAD unchanged and no source, schema, or lockfile file changed. But both `npm run start` and `npm run start:worker` run `npx prisma generate` unconditionally, and production logs prove this executed at both startups — the on-disk generated Prisma Client artifacts were refreshed by this deploy. **The byte-level before/after delta of those generated artifacts was not measured**, and this document does not claim they are unchanged — only that no *source* of them (schema, lockfile) changed. **It is not accurate to say "no client change occurred" without that measurement.**

Rollback exposure is therefore: the PM2 lifecycle mutation (recovered via `pm2 restart`/`startOrReload` back to the prior process state) plus a regenerated — not byte-verified — Prisma Client, which regenerates deterministically from the same unchanged schema/lockfile on any subsequent start. **There is no source code to roll back.**

---

## 12. F3 exit gate — independent re-assessment

Exit gate per `phases/F3_PRODUCTION_HARDENING.md` §"Exit gate (Çıkış kapısı)", unchanged, three criteria:

| # | Criterion | Status before | What this task's evidence adds | Status after |
|---|---|---|---|---|
| 1 | Observability standard demonstrably working live (log/metrik/trace/alarm) | `OPEN` | **Nothing positive.** No dashboard, alert channel, uptime probe or telemetry sink was created. One *negative* signal: a 19-second API outage passed with no automated detection — the exact cost of R-074's gap | **`OPEN`** |
| 2 | Security hardening checklist closed | `PASS_WITH_EXTERNAL_VERIFICATION` | **Marginal positive, insufficient.** The deploy path is now proven to apply the repository-defined process contract, and both installed operational scripts are hash-verified in sync. None of the criterion's outstanding external items (GitHub Code-security settings, TLS, Redis/replica topology, platform-admin MFA coverage) is touched | **`PASS_WITH_EXTERNAL_VERIFICATION`** |
| 3 | Incident-response procedure verified via drill | `OPEN` | **Nothing directly.** Worth noting for whoever decides this criterion: this is the first real-world confirmation that the runbook's reload-only deploy invocation behaves as documented, which is *input* to that decision, not satisfaction of it. Also relevant: §11 shows the runbook's rollback anchor was invalid until corrected here | **`OPEN`** |

**F3 exit gate: `NOT_SATISFIED`.** No criterion's status changes.

**R-033's and R-040's closures do not advance the gate.** Both are F0-006/F3 deployment/configuration-topology rows. Neither is named by any of the three criteria, and this program's own precedent (R-034's and R-075's closures, both explicitly non-advancing) applies directly. Closing a deployment-topology risk is not observability, is not the security checklist, and is not an incident-response drill.

**F3 COMPLETE: `NO`. F4 transition authorized: `NO`.**

**(A) Formal exit-gate criterion blockers** — items the authoritative three-criterion gate (`phases/F3_PRODUCTION_HARDENING.md` §"Exit gate", reproduced in the table above) actually names, independently recalculated:

1. External observability wiring against the now-live `/livez` / `/readyz` — criterion 1 / **R-074**, `OPEN`.
2. External verification of GitHub Code-security settings, TLS, Redis/replica topology, platform-admin MFA coverage — criterion 2.
3. Decision-owner acceptance records for **R-073** and **R-019** (both `CLOSURE_PROPOSED_AWAITING_EXTERNAL_CONFIRMATION`) — criterion 2, per this program's own precedent (`phases/F3_PRODUCTION_HARDENING.md`'s F3-PROD-001 entry) of treating their acceptance as part of the security-hardening checklist.
4. A program-owner decision on whether F3-IR-001's simulated tabletop satisfies criterion 3.

**(B) Additional open F3 risks / phase-closure considerations** — open items that are **not** named by any of the gate's three criteria, and therefore do not block the formal gate on current repository evidence, but remain outstanding before F3 as a whole is closed out:

5. **R-076** (stored XSS, `ClinicLegalProfile.website`) — `OPEN`, unaffected by this task; F3-SEC-003's own record already classifies it as untouched by the three named criteria.
6. **R-077**(b) — drift-prevention mechanism — `OPEN`; an operational/deployment risk, not named by any of the three criteria.

None of these is a coding task started here.

---

## 13. Security, tenant-isolation, and KVKK impact

| Dimension | Impact |
|---|---|
| Tenant isolation | **NONE** — no tenant-scoped code path, query, or data semantic is touched |
| KVKK / PII / PHI | **NONE.** No secret value, environment dump, message payload, patient identifier, or credential is recorded anywhere in this document or in the captured evidence. The deploy script's own `pm2_status_of()` (`:96-108`) prints only the status word by design, and the healthcheck prints only an HTTP status code. Historical log findings are referenced by *category* (§8), never by payload content |
| Authentication / authorization | **NONE** |
| Storage | **NONE** |
| Job / queue | **HIGH OPERATIONAL RELEVANCE — positive.** Job ownership is now proven correct at runtime under a repository-defined lifecycle: exactly one owner, no duplicate registration, no zero-owner state |
| Availability | **Bounded negative, measured and disclosed** (§7): ≈19 s API startup window under the single-instance fork-mode lifecycle |

---

## 14. Program-record corrections made by this task

Both are **additive**. No historical text is rewritten or deleted.

1. **`NORAMEDI_MASTER_TRACKER.md` §13's stale claim.** The superseded entry states that F3-PROD-002's evidence *"closes R-034's remaining half and R-040's API half."* **R-034 was already `CLOSED`** independently by F3-IMPL-002-PROD-RECON **[R2]**, on its own criterion, before this task ran. The accurate statement is: this evidence **closes R-040's API half (and therefore R-040)** and **corroborates** R-034's existing closure with stronger provenance. It closes nothing of R-034 that was still open, because nothing was. The superseded entry's own text is left unedited as dated history.

2. **The rollback-anchor classification** (§11.1) — corrected additively in `RISK_REGISTER.md`'s **[R2]** narrative, on `evidence/F3-PROD-001_PRODUCTION_DEPLOYMENT_AND_VERIFICATION.md`'s correction banner, and on `evidence/F3-IMPL-002-PROD-RECON_PRODUCTION_WORKER_CONTRACT_VERIFICATION.md` §5.2. In all three the original wording is preserved and the correction is appended.

---

## 15. Repository-side verification performed by this task

`REPOSITORY_VERIFIED` — all local git/file inspection, no production access.

| # | Check | Result |
|---|---|---|
| 1 | `git diff --name-only aa18b06… 0d1b4ae… \| grep -v '^docs/'` | **0 files** — PR #402 is documentation-only |
| 2 | Blob-identity of the 8 contract files at `aa18b06…` vs `0d1b4ae…` | **all 8 identical** (§1) |
| 3 | `git cat-file -p HEAD:scripts/noramedi-deploy.sh \| sha256sum` | `794375b4249b063e167a8d6f885df1a590bd9de9df367e91a0d3eaaf635f5012` — **matches** the supplied installed and repository-copy hash |
| 4 | `git cat-file -p HEAD:scripts/noramedi-healthcheck.sh \| sha256sum` | `14a148982d74eda76d7adf757e09a32c0329b65195413961ca32cd4b8c6cef7e` — **matches** the supplied installed and repository-copy hash |
| 5 | `noramedi-healthcheck.sh` history (`git log --follow`) | **one commit in its entire history** (`4600c3e`); byte-identical at the stale-era commit `96313f39` (2026-06-29) and at `origin/main` today — which is why a 44-day-stale installed copy still matched |
| 6 | Ownership-log source strings | `index.ts:330-331` and `worker.ts:42-46` produce exactly the supplied strings |
| 7 | `ownsJobs=false` provenance | `backgroundJobsOwnership.ts:38` — `env.RUN_BACKGROUND_JOBS === 'false'` is the sole path |
| 8 | `declared=true` provenance | `processRole.ts:75` — sole path, requires the env var present, recognized, and matching |
| 9 | `GET /api/health` response shape | `index.ts:194` — `res.json({ status: 'ok' })`, matching the supplied `{"status":"ok"}` |
| 10 | `verify_pm2_online` success-message format | `noramedi-deploy.sh:119` — the supplied line is the exact format literal |
| 11 | Prisma generation in start scripts | `server/package.json:10-11` — both contain `npx prisma generate &&` |
| 12 | Revenue-report `GROUP BY` fix ancestry | `08f2eaf…` (PR #252) **is** an ancestor of `aa18b06…` |
| 13 | Rollback anchor `b21cae91…` | absent from this repository's object DB — `cat-file -t` fatal, `cat-file -e` exit `1`, `rev-parse --verify --quiet ^{commit}` exit `1` |
| 14 | Same-subject commit on the deployed lineage | `152ebaf5e9ad9b2da822d286c9354a9755d63440` is an ancestor of `aa18b06…` |
| 15 | Replacement anchor `aa18b06…` | resolvable, ancestor of `origin/main`, present on `origin` |
| 16 | Repository tags | `git tag --list` → **0** |
| 17 | Migration set | 73 migrations, newest `20260811120000_add_platform_admin_password_changed_at`; `git diff` on `server/prisma/migrations` between `aa18b06…` and `0d1b4ae…` is **empty** |
| 18 | PR #403 state | `state: CLOSED`, `mergeCommit: null`, `mergedAt: null` — superseded duplicate, not built on |

---

## 16. State distinctions preserved

Per `NORAMEDI_MASTER_TRACKER.md` §2.2/§2.3, tracked separately and not collapsed:

| Item | Agent completed | Tests passed | PR opened | Merged | Deployed | Production verified |
|---|---|---|---|---|---|---|
| **F3-IMPL-002** (worker contract implementation) | yes (2026-08-10) | yes | yes (PR #357) | **yes** — in `aa18b06…` | **yes** | **yes — `PRODUCTION_VERIFIED` (2026-08-12, this task)** |
| **F3-IMPL-002-PROD-RECON** (drift reconciliation) | yes | n/a — docs only | yes (PR #402) | **yes** — `0d1b4ae…` | n/a | n/a |
| **F3-PROD-002** (this task) | yes | n/a — no code changed; no test suite applies | see §17 | **no** | n/a — the production action is the *subject* of this evidence, not a deployment of it | n/a |

Distinctions this task deliberately refuses to blur: *operator execution* ≠ *repository-task completion*; *jobs scheduled* ≠ *jobs executed*; *PM2 `online`* ≠ *reboot-persistent*; *hashes match today* ≠ *drift is prevented*; *deploy succeeded* ≠ *zero-downtime*.

---

## 17. Validation performed

```
git diff --check                                      → clean, exit 0
git status --porcelain | grep -v ' docs/program/'     → 0 lines (scope containment)
```

**Consistency / structural checks — exact commands and results:**

| # | Check | Command | Result |
|---|---|---|---|
| V1 | Whitespace / conflict markers | `git diff --check` | **PASS** — exit `0`, clean |
| V2 | Change scope containment | `git status --porcelain \| grep -v ' docs/program/' \| wc -l` | **PASS** — `0`. Every changed file is under `docs/program/**` |
| V3 | Risk-table column integrity for every row this task edited | `awk -F'\|'` field count vs. the `\| ID \|` header row (13 awk-fields) on R-033, R-034, R-037, R-040, R-077 | **PASS** — all 13, unchanged from `HEAD`. R-077 reads 14 raw because one pipe is a deliberate `\|` escape inside a code span; 13 real columns |
| V4 | Table-row integrity for the three index/history rows added | field counts vs. their own headers in `NORAMEDI_MASTER_TRACKER.md` §11, `phases/F3_PRODUCTION_HARDENING.md` change history, `evidence/README.md` | **PASS** — `8/8/8`, `5/5/5`, `5/5/5` (header / previous row / new row) |
| V5 | Cross-document links to this file resolve | path existence test from each referring file's own directory | **PASS** — 4/4 program docs (`RISK_REGISTER.md`, `NORAMEDI_MASTER_TRACKER.md`, `CURRENT_PHASE.md`, `phases/F3_PRODUCTION_HARDENING.md`) and 4/4 evidence files (`F3-PROD-001…`, `F3-IMPL-002-PROD-RECON…`, `F3-IMPL-002…`, `README.md`) |
| V6 | No document asserts F3 complete or F4 authorized | `grep -rn 'F4 transition authorized: \`YES\`\|F3 COMPLETE: \`YES\`\|F4_TRANSITION_AUTHORIZED: YES' docs/program/` | **PASS** — `0` matches |
| V7 | Exit-gate wording is consistently `NOT SATISFIED` | `grep -rno` over the gate phrasings across `docs/program/*.md`, the F3 phase doc and this file | **PASS** — 18 occurrences, all `NOT SATISFIED`; `0` contradicting |
| V8 | No stale "R-033/R-040 remain OPEN" claim survives as a *current* statement | `grep -rn` over `docs/program/` | **PASS** — 1 match, and it is inside `RISK_REGISTER.md`'s **`Prior update:`** (F3-IMPL-002-PROD-RECON) entry, i.e. dated history preserved by the additive-correction convention. No current-status text contradicts the closures |
| V9 | Zero "two commits ahead" claims survive (R1) | `grep -rniE 'two commits ahead\|two docs-only commits ahead\|moved two commits' docs/program/` | **PASS** — `0` matches. `aa18b06…0d1b4ae` is actually **4** commits (`git rev-list --count`); §1 and `evidence/README.md` now say `origin/main` is ahead of production without asserting a count |
| V10 | Zero misleading "PM2 state only / no client change" *current* claims survive (R1) | `grep -rn 'no dependency, schema, or client change occurred\|only mutation was PM2 process state\|nothing beyond PM2' docs/program/` | **PASS** — `0` matches. §11.3 now states the precise classification (pull/build/migrate NO, explicit generate SKIPPED, startup Prisma generation YES, source/schema/lockfile NO, generated-artifact byte-delta not measured, PM2 lifecycle mutated as intended) and does not claim "no client change" |
| V11 | R-076/R-077 not classified as both non-gate and formal exit-gate blocker (R1) | `grep -rn 'R-076.*exit-gate blocker\|exit-gate blocker.*R-076\|R-077.*formal exit-gate\|formal exit-gate.*R-077'` over this file and `NORAMEDI_MASTER_TRACKER.md` | **PASS** — `0` contradictory matches. §12 and the tracker's top entry now separate **(A) formal exit-gate criterion blockers** (the four items actually named by the three-criterion gate) from **(B) additional open F3 risks** (R-076, R-077(b) — neither named by any of the three criteria) |

**Pass/fail count: 11 checks executed, 11 passed, 0 failed.**

**R1 correction (2026-08-12), edited in place on this same PR/branch, per this program's `+R1` same-task-revision convention** — not a new dated layer, since this task's own PR has not yet merged: (1) corrected the "two commits ahead" claims in §1 and `evidence/README.md` to a count-independent statement, since the actual delta `aa18b06…0d1b4ae` is 4 commits, not 2; (2) corrected §11.3's rollback-exposure claim, which understated the deploy's effect by asserting "no client change occurred" and "the only mutation was PM2 process state" — §6's own table already correctly showed startup-time Prisma Client generation occurred, and §11.3 now matches it, disclosing that the generated-artifact byte-delta was not measured rather than asserting no change; (3) split §12's single six-item "exit-gate blockers" list, and the equivalent list in `NORAMEDI_MASTER_TRACKER.md`'s top entry, into formal exit-gate criterion blockers (named by the three-criterion gate) versus additional open F3 risks (R-076, R-077(b), named by neither).

**Documentation-hygiene gap noted, deliberately not fixed** (consistent with F3-PROGRAM-RECON-001's precedent for such notes): the **R-063** row in `RISK_REGISTER.md` has **12 columns where the table header declares 11** — it carries an extra `Not a KVKK-HIGH-008 blocker` cell. This is **pre-existing**, present identically at `HEAD` before this task's edits (verified: 14 awk-fields both before and after), and was not introduced here. Correcting it means deciding which cell to merge, which is a judgement call outside a production-verification task's scope.

**No test suite was run, and none applies.** This task changes no application, test, dependency, schema, migration, CI-workflow, or script file — the diff is confined to `docs/program/**`. The repository has **no** documentation/program validation npm script (independently re-confirmed at this baseline against the root and `server/` `package.json` script sets), consistent with what every prior documentation-only task in this program recorded. Per release policy, a full application regression suite is not run for a documentation-only change.

Files changed — all under `docs/program/**`:

1. `docs/program/evidence/F3-PROD-002_DEPLOY_SCRIPT_EXECUTION_VERIFICATION.md` — **new**, this file
2. `docs/program/evidence/README.md` — index row
3. `docs/program/NORAMEDI_MASTER_TRACKER.md` — top entry, §11 production-verification-history row, §13 exact-next-task
4. `docs/program/CURRENT_PHASE.md` — top entry
5. `docs/program/phases/F3_PRODUCTION_HARDENING.md` — top status line + entry, risk line, change-history row
6. `docs/program/RISK_REGISTER.md` — new "Son güncelleme" entry; **R-033 → `CLOSED`**, **R-040 → `CLOSED`**, R-077 updated (half (a) resolved, half (b) open), R-063 evidence strengthened, R-037 evidence note
7. `docs/program/evidence/F3-IMPL-002_PRODUCTION_WORKER_PROCESS_CONTRACT.md` — additive `PRODUCTION_VERIFIED` banner
8. `docs/program/evidence/F3-IMPL-002-PROD-RECON_PRODUCTION_WORKER_CONTRACT_VERIFICATION.md` — additive correction banner (rollback anchor + risk-disposition supersession)
9. `docs/program/evidence/F3-PROD-001_PRODUCTION_DEPLOYMENT_AND_VERIFICATION.md` — additive third correction (rollback anchor)

---

## 18. Task state

`AGENT_COMPLETED` · `PR_OPENED` — `NOT_MERGED` · `NOT_DEPLOYED` (nothing to deploy; the diff is documentation-only) · the production action that this evidence *documents* is itself `PRODUCTION_VERIFIED`.

**Operator execution is not task completion.** F3-PROD-002 is complete only once this evidence document, the tracker reconciliation, the validation, and PR review are all done. Review is pending.

**Risks closed by this task: R-033, R-040** — both on their own rows' explicitly stated closure criteria, from operator-supplied external evidence, by a task that is neither the remediating task nor the confirming party for either row. **No risk was self-closed.**

---

## 19. Exact next task

**None assigned by this task.** F3-PROD-002 is the last item the prior §13 entry named, and its execution gap is now closed. The remaining F3 work is the four-item formal exit-gate blocker list plus the two-item additional-open-risk list in §12, none of which is a coding task and none of which this task starts.

Two follow-ups are **recommended, not opened**, and neither is folded into this PR:

1. **`prisma generate` on the process start path** (§6, §7) — R-063's own named remediation: pre-generate the Prisma Client at build/deploy time and/or add a readiness-gated PM2 reload, so the ≈19 s startup window stops being a property of every reload. Warranted; a dedicated runtime/deployment task, deliberately out of scope for a production-verification PR.
2. **R-077(b) drift prevention** (§9.4) — a decision on which of the row's three mechanisms to adopt. Also a runtime/deployment change.

Separately, **the rollback anchor** (§11): `runbooks/F3_FIRST_CUSTOMER_INCIDENT_RESPONSE.md` §4.1 and the F3-PROD-001 record should reference `aa18b06…` (or a purpose-created tag — the repository currently has none) rather than `b21cae91…`, which is off-lineage.

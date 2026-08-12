# F3-IMPL-002-PROD-RECON — Production Worker Process Contract Verification and Installed Deploy-Script Drift Reconciliation

**Status: `AGENT_COMPLETED` — documentation-only reconciliation of user-supplied production evidence; no runtime, schema, migration, CI, or deployment-script file changed by this task; not merged, not deployed by this task.**

**Phase:** F3 — Production Hardening. **Type:** documentation-only reconciliation of **user-supplied, operator-executed production evidence** — this task itself performed no production access, ran no command on `disklinik-prod-01`/`api.noramedi.com`, and did not execute any deployment. This is the same evidentiary class as this program's prior operator-executed-evidence reconciliations (`KVKK-HIGH-006-PRODUCTION_DEPLOYMENT_AND_SMOKE_VERIFICATION.md`, [F3-PROD-001_PRODUCTION_DEPLOYMENT_AND_VERIFICATION.md](F3-PROD-001_PRODUCTION_DEPLOYMENT_AND_VERIFICATION.md)) — supplied facts are recorded and reconciled against program documents, not re-derived.

**Verification date (as supplied):** 2026-08-12.

## 1. Task identity and phase

| Field | Value |
|---|---|
| Task ID | F3-IMPL-002-PROD-RECON |
| Title | Production Worker Process Contract Verification and Installed Deploy-Script Drift Reconciliation |
| Phase | F3 — Production Hardening |
| Reconciles | F3-IMPL-002 (PR #357, merged 2026-08-10); F3-SEC-003 (PR #401, merged 2026-08-12); [F3-PROD-001_PRODUCTION_DEPLOYMENT_AND_VERIFICATION.md](F3-PROD-001_PRODUCTION_DEPLOYMENT_AND_VERIFICATION.md) |
| Risks touched | R-033, R-034, R-040 (evaluated independently); R-075 (evidence updated, token unchanged); R-077 (new) |
| Risks reviewed and deliberately NOT changed | R-074, R-073, R-019, R-018 |
| Task type | DOCUMENTATION / PROGRAM-CONTROL RECONCILIATION |
| Schema/migration change | **NO** |
| Runtime/application code change | **NO** |

## 2. Purpose

Two distinct things happened on 2026-08-12 and this document keeps them separate:

1. **A production verification** of the process-topology contract that F3-IMPL-002 introduced — the first time both `noramedi-api` and `noramedi-worker` were observed against that contract at a known SHA.
2. **A drift discovery and its remediation** — the deploy executable actually installed on the production host was found to be a **pre-F3-IMPL-002 copy**, meaning the deploy automation F3-IMPL-002 shipped had never been in force on the deployment path. This is a finding *against* the prior evidence chain, not a confirmation of it.

The second finding materially qualifies the first. F3-IMPL-002 delivered two coupled halves; production evidence now separates them cleanly, and this document refuses to collapse them into a single "production verified" claim.

## 3. Baseline and git identity

| Item | Value |
|---|---|
| Branch | `docs/f3-impl-002-prod-recon` |
| Baseline `origin/main` | `aa18b064267ff5846ae60f73889c3322030bd4a8` |
| Working tree at start | clean, no drift (`git status --porcelain` empty) |
| Deployment target SHA | `aa18b064267ff5846ae60f73889c3322030bd4a8` |
| Relationship | The deployed SHA **is** current `origin/main` and **is** the PR #401 merge commit |

Independently verified by this task from the repository (not operator-supplied):

```
gh pr view 401 --json state,mergedAt,mergeCommit
    → state MERGED, mergedAt 2026-08-12T14:28:58Z,
      mergeCommit.oid aa18b064267ff5846ae60f73889c3322030bd4a8
git merge-base --is-ancestor aa18b064… origin/main   → exit 0 (ancestor)
git rev-parse origin/main                            → aa18b064267ff5846ae60f73889c3322030bd4a8
```

This establishes the `MERGED` lifecycle stage for F3-SEC-003 from repository evidence alone. The `DEPLOYED` and `PRODUCTION_VERIFIED` stages rest on operator-supplied evidence, recorded as such in §4–§7.

## 4. Production deployment facts (as supplied, not independently re-verified)

| Item | Value |
|---|---|
| Deployed SHA verified in production | `aa18b064267ff5846ae60f73889c3322030bd4a8` |
| Previous production SHA (per F3-PROD-001) | `f0ff4c70abe08b192233d17cdcd1b7a77dbe4b08` |
| Prisma CLI | `7.9.1` |
| `@prisma/client` | `7.9.1` |
| `npm audit --omit=dev` | **0 vulnerabilities** |
| Migrations | 73 migrations; `Database schema is up to date` |
| Pending migrations | none |
| API process | `noramedi-api` `online`; restarted/reloaded onto the new release; startup generated Prisma Client `v7.9.1` |

**No SHA256 value, version string, audit result, migration count, or health-endpoint response in §4–§7 and §9–§10 was independently re-run or re-derived by this task — all are recorded as supplied.**

Two supplied facts were nonetheless corroborated against the repository at the deployed SHA, and matched exactly:

| Supplied fact | Repository check by this task | Result |
|---|---|---|
| 73 migrations | count of `server/prisma/migrations/2*` at `aa18b064…` | `73` — match |
| Prisma CLI and client both `7.9.1` | `server/package.json` at `aa18b064…` | `"prisma": "7.9.1"`, `"@prisma/client": "7.9.1"` — match |

## 5. Process topology and job-ownership evidence (as supplied)

| Item | API (`noramedi-api`) | Worker (`noramedi-worker`), after reconciliation |
|---|---|---|
| PM2 status | `online` | `online` |
| Role | `role=api` | `role=worker` |
| Role explicitly declared | not reported (see §5.1) | `declared=true` |
| `RUN_BACKGROUND_JOBS` | `false` | n/a |
| Job ownership | `ownsJobs=false` — jobs delegated to dedicated worker | `ownsJobs=true` |
| Background jobs | not registered | **all background jobs scheduled** |

Exactly one job owner was observed. Neither the duplicate-registration state nor the zero-owner state that R-034 tracks was present.

### 5.1 What `role=api` does and does not prove

This task read `server/src/utils/processRole.ts` at the deployed SHA. `assertProcessRole()` returns `{ declared: false, role: expectedRole }` when `NORAMEDI_PROCESS_ROLE` is **unset** — the role reported is the entrypoint's own hardcoded expectation, not a value read from the environment. Therefore:

- `/api/livez` returning `role=api` is **not** evidence that `ecosystem.config.cjs` supplied the API's environment. It would report `role=api` either way.
- The worker's `declared=true` **is** affirmative evidence that `NORAMEDI_PROCESS_ROLE` was explicitly set, and that variable exists only in `ecosystem.config.cjs` — so for the worker, the repository-defined config contract is confirmed as the actual config source.
- `ownsJobs=false` on the API **is** direct evidence of the effective runtime value: per `server/src/utils/backgroundJobsOwnership.ts`, the API opts out only when `RUN_BACKGROUND_JOBS === 'false'` exactly. This confirms the *value*, independently of its *provenance*.

This distinction is load-bearing for R-040 (§12.3) and is the reason this document does not claim `ecosystem.config.cjs` is confirmed as the API's config source. §8.1.1 goes further and establishes from git history that it is **not** the API's config source.

## 6. Health and readiness evidence (as supplied)

| Endpoint | Result |
|---|---|
| `/api/health` | `200` / `{"status":"ok"}` |
| `/api/livez` | `200` / `role=api` |
| `/api/readyz` | `200` / `database=ok`, `redis=ok` |

**Qualifier, carried forward verbatim from [F3-PROD-001_PRODUCTION_DEPLOYMENT_AND_VERIFICATION.md](F3-PROD-001_PRODUCTION_DEPLOYMENT_AND_VERIFICATION.md) §6 and R-074's own register row:** this is reachability/correctness evidence for the endpoints themselves — it is **not** dashboard, alert-channel, or uptime-probe evidence. An endpoint responding correctly is not the same as an external monitor watching it. Nothing here bears on F3 exit-gate criterion 1 or on R-074.

## 7. Dependency and migration state in production (as supplied)

`npm audit --omit=dev` reporting **0 vulnerabilities** on the production host is the single highest-value new fact in this reconciliation. It is **not** a restatement of F3-SEC-003's result:

- F3-SEC-003 measured `8 → 0` in a repository/clean-room `npm ci` context and explicitly left open: *"post-deploy `npm audit --omit=dev` on `disklinik-prod-01` has not been run (this task performed no production access)."*
- That named gap is now closed by direct production measurement.

Additionally, F3-SEC-003 §13 flagged `binaries.prisma.sh` egress from the production host as an **unverified deployment prerequisite**, because the Prisma engine binary is an unhashed CDN download whose changed hash the production host had never fetched. Both processes independently generating Prisma Client `v7.9.1` at startup in production (API in §4, worker in §9) is direct evidence that this fetch succeeded. See §12.4.

Migration state: 73 migrations, `Database schema is up to date`, no pending migrations. This is unchanged from the count [F3-PROD-001_PRODUCTION_DEPLOYMENT_AND_VERIFICATION.md](F3-PROD-001_PRODUCTION_DEPLOYMENT_AND_VERIFICATION.md) recorded at the previous SHA — F3-SEC-003 was a dependency-only change and added no migration.

## 8. Installed deploy-script drift — discovery, root cause, and impact

### 8.1 The finding

The executable actually installed on the production host was not the version the repository ships.

| Item | Value |
|---|---|
| Installed path | `/usr/local/sbin/noramedi-deploy.sh` |
| Repository path | `scripts/noramedi-deploy.sh` (deployed to the host as a manual copy) |
| Old installed SHA256 | `8dffcd134f508c0a12699220354dd3074a95f6b98342da6cd53533043e7b675d` |
| What the old installed script did | reloaded `noramedi-api` **only** |
| What it did **not** do | did **not** reload `noramedi-worker`; did **not** verify `noramedi-worker` |

F3-IMPL-002 (PR #357, merged 2026-08-10) added both the worker `startOrReload` step and the fail-closed worker PM2-status verification step to `scripts/noramedi-deploy.sh`. The installed host copy had never been re-synced after that merge, so the repository-level mitigation recorded for R-033 was **never actually in force on the deployment path**.

### 8.1.1 Exact provenance of the stale script — identified from git history

This task identified precisely which repository revision the stale installed copy corresponded to, using only read-only git commands:

```
git show 96313f39edc063f246f8c2ba74b6a6f2c6ed6364:scripts/noramedi-deploy.sh | sha256sum
    → 8dffcd134f508c0a12699220354dd3074a95f6b98342da6cd53533043e7b675d
git log -1 --format="%H %ci %s" 96313f39…
    → 96313f39… 2026-06-29 22:56:17 +0200
       "fix: run deploy backend commands from server directory"
```

The stale installed script was **byte-identical to the repository version at commit `96313f39edc063f246f8c2ba74b6a6f2c6ed6364`, dated 2026-06-29** — approximately 44 days stale at the time of discovery, and predating F3-IMPL-002 entirely.

Direct inspection of that revision confirms what it actually did:

```
git show 96313f39:scripts/noramedi-deploy.sh | grep -n "pm2\|ecosystem\|worker"
    11:#   5. pm2 reload noramedi-api --update-env
    86:pm2 reload "$PM2_NAME" --update-env
```

It contains **exactly one `pm2` invocation**, `pm2 reload noramedi-api --update-env`. It makes **no reference to `ecosystem.config.cjs`**, no worker reload, and no worker verification.

This is the decisive fact for R-040 (§12.3). `pm2 reload <name> --update-env` re-reads the environment from **PM2's own stored record for that app**, not from a repository config file. Therefore the API's observed `RUN_BACKGROUND_JOBS=false` originates from PM2's out-of-band stored environment — **`ecosystem.config.cjs` has never governed the `noramedi-api` process via any deployment.** This is no longer a suspicion to be resolved by reading the host backup; it is established from repository history.

### 8.2 The impact — API updated while the worker remained old

This is not a theoretical exposure. It materialized and was observed:

| Worker state before reconciliation | Value |
|---|---|
| PID | `603932` |
| `restart_time` | `10` |
| PM2 status | `online` |
| Runtime startup evidence | still showed **Prisma Client v7.8.0** |

The API was running Prisma Client `7.9.1` while the worker was still running `7.8.0`. The `aa18b064…` deployment updated the API and left the worker on the previous release — precisely the failure mode F3-IMPL-002's step 6/step 8 were written to prevent. The two processes ran mismatched Prisma Client versions for a window of undetermined length.

Because the worker was `online` throughout, PM2 process status — the liveness signal `LAUNCH_GATES.md` accepts and F3-IMPL-002 §6 relies on — did **not** surface this. A process can be `online` and simultaneously running stale code.

### 8.3 Scope limit — what is NOT established

It is **established** that the `aa18b064…` deployment did not reload the worker.

It is **not established** whether the earlier F3-PROD-001 deployment of `f0ff4c70abe08b192233d17cdcd1b7a77dbe4b08` also ran this stale script. The stale copy predates both deployments and no evidence of an intervening sync-and-revert exists, but no record of that deployment's actually-executed steps was captured. This is recorded as an **open question requiring evidence**, not as a finding.

A second, narrower open question follows for the same reason. [F3-PROD-001_PRODUCTION_DEPLOYMENT_AND_VERIFICATION.md](F3-PROD-001_PRODUCTION_DEPLOYMENT_AND_VERIFICATION.md) §3 records the worker as `role=worker`, `ownsJobs=true` and concludes this was *"the first production evidence confirming that repository-defined contract is actually what production runs."* This task verified against git history that:

- `ownsJobs=true` in the worker's startup log **predates** F3-IMPL-002 — the pre-F3-IMPL-002 `server/src/worker.ts` at `1909b186a01611c8be90313b7166085a887d05f4` logged `[worker] Background job worker starting... ownsJobs=true (…)` as a hardcoded string.
- `role=worker` and `declared=` were **introduced by** F3-IMPL-002.

The worker observed at F3-PROD-001 time was PID `603932` / `restart_time` 10 — the same process still running immediately before this reconciliation, and still on Prisma Client v7.8.0. Whether that process had F3-IMPL-002's code loaded (and so could genuinely emit `role=worker`) depends on when it last restarted, which was not recorded. If it could not, the `role=worker` field in that row was inferred from the repository contract rather than read from production. This is flagged as an **open question about the prior record**, not asserted as an error, and is resolvable from the worker's PM2 `created_at`/uptime or its historical startup log line.

One consequence follows regardless, and is recorded as a correction rather than left implicit: [F3-PROD-001_PRODUCTION_DEPLOYMENT_AND_VERIFICATION.md](F3-PROD-001_PRODUCTION_DEPLOYMENT_AND_VERIFICATION.md) §2's "Deploy procedure used" row describes the procedure read from the **repository** script during that session's preflight. It is now known that the repository script and the installed script were not the same file. That row must therefore be read as describing the repository-defined procedure, not as a verified record of what the installed executable did. Its own text is left unedited as dated capture-time evidence, per this program's convention.

## 9. Worker manual reconciliation (restart evidence)

Command executed by the operator:

```bash
pm2 startOrReload /var/www/noramedi/ecosystem.config.cjs \
  --only noramedi-worker \
  --update-env
```

| Worker state after reconciliation | Value |
|---|---|
| PID | `605889` (was `603932`) |
| `restart_time` | `11` (was `10`) |
| PM2 status | `online` |
| Shutdown of prior process | clean `SIGINT`, clean exit |
| Restart path | via `server start:worker` |
| Prisma Client | `Generated Prisma Client v7.9.1` |
| Role | `role=worker`, `declared=true` |
| Job ownership | `ownsJobs=true` |
| Background jobs | all background jobs scheduled |

The PID change and the `restart_time` increment 10 → 11 together confirm a real process replacement rather than a no-op. The clean `SIGINT`/exit confirms the graceful-shutdown path in `server/src/worker.ts` behaved as designed.

**This reconciliation was performed by a direct manual `pm2` invocation, not by the deploy script.** It therefore proves the repository-defined *reload command* works against real production; it does **not** prove the deploy *script* works. See §12.1.

### 9.1 What "all background jobs scheduled" does and does not prove

In `server/src/worker.ts` the sequence is:

```
startBackgroundJobs();
console.log('[worker] All background jobs scheduled.');
```

The log line is emitted **synchronously immediately after cron registration returns**, before any scheduled tick has fired. It therefore proves that all 9 jobs were *registered*, not that any job has *executed*. A worker that registers 9 crons and then fails every subsequent tick on a database, Redis, or permissions error would emit exactly the same line.

This repository's own worker-recovery standard is stricter: `runbooks/F3_FIRST_CUSTOMER_INCIDENT_RESPONSE.md` requires PM2 `online` **plus** `[worker] All background jobs scheduled.` **plus** watching the next reminder tick complete (`[reminders] Notification reminder job complete.`). That third artifact was not captured, and no `JobLock` lease acquisition by the new PID was observed. Job **execution** in production is therefore unverified — see §12.2 and §16.1.

## 10. Deploy-script integrity evidence

| Item | Value |
|---|---|
| Backup of old installed script | `/usr/local/sbin/noramedi-deploy.sh.bak.20260812-174738` |
| Repository script `bash -n` | `PASS` |
| Installed to | `/usr/local/sbin/noramedi-deploy.sh` |
| Owner | `root:root` |
| Mode | `0755` |
| Installed script `bash -n` | `PASS` |
| Installed **and** repository SHA256, post-sync | `794375b4249b063e167a8d6f885df1a590bd9de9df367e91a0d3eaaf635f5012` |
| Deployment executed during synchronization | **NO** |
| API and worker during synchronization | remained `online` |

Installed `--help` smoke output reports the installed script now contains:

- `noramedi-api` `startOrReload`
- `noramedi-worker` `startOrReload`
- API healthcheck
- worker PM2-status verification

**This `--help` output must not be read as behavioral verification.** `usage()` in `scripts/noramedi-deploy.sh` is literally `grep '^#' "$0" | grep -v '^#!/' | sed 's/^# \{0,1\}//'; exit 0` — it prints the file's comment header and exits before the argument loop reaches any executable step. It never invokes `pm2`, `node`, `$HEALTHCHECK`, or `$ECOSYSTEM_FILE`. The `--help` output therefore confirms only that the installed file's **comment block** describes those four steps. The SHA256 identity in §10.1 is strictly stronger evidence and is what this document relies on; the `--help` result is recorded for completeness and adds no independent signal.

Likewise, `bash -n` is a parse check only. It executes nothing and is not a lint or behavioral check.

### 10.1 Independent repository-side corroboration of the post-sync hash

This is the one integrity claim this task could verify without production access, and it was verified:

```
git show aa18b064…:scripts/noramedi-deploy.sh | sha256sum
    → 794375b4249b063e167a8d6f885df1a590bd9de9df367e91a0d3eaaf635f5012
```

This matches the supplied post-sync installed hash exactly, confirming the installed executable is byte-identical to the repository version at the deployed SHA. (The Windows working-tree copy hashes differently, `917ee40a…`, because it carries CRLF line endings; the committed LF form is what a Linux host receives.)

This task also confirmed by direct read of `scripts/noramedi-deploy.sh` at the deployed SHA that it contains `pm2 startOrReload "$ECOSYSTEM_FILE" --only "$PM2_API_NAME"`, `… --only "$PM2_WORKER_NAME"`, the API healthcheck invocation, and `verify_pm2_online "$PM2_WORKER_NAME" 12 5` — matching the `--help` smoke output above.

## 11. What this task did NOT change and did NOT do

- No application/runtime code changed (`server/src/**`, `src/**`).
- No schema, no Prisma migration, no `prisma/**` file.
- No `package.json` / `package-lock.json`.
- No CI workflow, no deployment script, no `ecosystem.config.cjs`, no runtime configuration.
- No deployment executed; no production access performed by this task.
- No test suite modified, skipped, or weakened.
- No historical evidence file rewritten in place.
- The merged F3-IMPL-002 evidence document is **not** edited — it is frozen history. This document is additive.

## 12. Risk reconciliation

Each risk is evaluated independently against its own documented closure criteria. Runtime health is **not** treated as evidence of closure.

### 12.1 R-033 — no repository-defined deploy/reload automation for `noramedi-worker`

**Current status:** `OPEN — repository-level fix implemented, production not yet verified`.

**Disposition: `OPEN`. Not closed, and not proposed for closure.**

New evidence *for*: the repository-defined worker reload command is now proven to work against real production (§9), and the installed script now matches the repository (§10).

New evidence *against*: this risk's production-side exposure is now shown to have been **live** from 2026-08-10 until 2026-08-12, not closed as the prior evidence chain implied. The deploy script's step 6 (worker `startOrReload`) and step 8 (`verify_pm2_online noramedi-worker`, the fail-closed gate that is the substance of this mitigation) have **executed zero times in production**. The synchronization was explicitly performed with no deployment executed, and the worker was brought current by an out-of-band manual command.

Closure requires one full production run of the now-synced `/usr/local/sbin/noramedi-deploy.sh` in which steps 6 and 8 execute and the worker verification passes, with output captured. `CLOSURE_PROPOSED_AWAITING_EXTERNAL_CONFIRMATION` is **not** appropriate here: that token is used in this register when the technical evidence set is complete and only external sign-off is missing. Here a concrete technical criterion is missing.

### 12.2 R-034 — API and worker may both register the same 9 jobs

**Current status:** `OPEN — repository-level mitigation implemented, production not yet verified`.

**Disposition: `CLOSURE_PROPOSED_AWAITING_EXTERNAL_CONFIRMATION`. Explicitly NOT closed.**

This row's own named missing control is *"production'da gerçek değerin doğrulanması"* — verification of the real production value of `RUN_BACKGROUND_JOBS`. That criterion is now directly and literally satisfied: the API was observed with `ownsJobs=false`, which per `backgroundJobsOwnership.ts` occurs only when `RUN_BACKGROUND_JOBS === 'false'` exactly (§5.1). The complementary worker-side fact (`ownsJobs=true`, all jobs scheduled) was observed on the same host in the same window. Exactly one owner; no duplicate registration, no zero-owner state.

Unlike R-040, this criterion concerns the **effective runtime value**, so it holds regardless of whether the value originated from `ecosystem.config.cjs` or from PM2's cached record. The drift finding does not undermine it.

What remains is external confirmation only, per this program's standing rule (R-019/R-071/R-072/R-073/R-075 precedent) that a task cannot close a risk on its own supplied evidence. Two scope notes carried forward rather than absorbed silently:

- `LAUNCH_GATES.md` §2.C's `JobLock` sub-criterion (*"confirmed functioning, no duplicate-run evidence"*) is conditional on `RUN_BACKGROUND_JOBS` being set **inconsistently** between the two processes. The observed configuration is consistent, so the condition does not bite — but no production job-execution log or `JobLock` lease observation exists, and this remains a named G1 item.
- The observation is point-in-time, taken immediately after a manual worker reload. The drift finding is itself direct proof that production state can silently diverge from the repository contract.
- The evidence is **registration-level, not execution-level** (§9.1). It establishes which process *owns* the jobs, which is exactly what R-034 tracks; it does not establish that any job ran. The absence of API-side job execution rests on the API's own `ownsJobs=false` self-report, not on an independent observation.
- No `pm2 save` was recorded, so it is unknown whether the reconciled worker definition survives a host reboot / `pm2 resurrect`. If PM2's dump was not re-saved, a reboot could restore the prior externally-registered worker definition and silently revert the observed state.

### 12.3 R-040 — configuration source ambiguity

**Current status:** `OPEN — repository-level mitigation implemented, production not yet verified`.

**Disposition: `OPEN`. Not closed, and not proposed for closure.**

New evidence *for*: `ecosystem.config.cjs` is confirmed to be the config source for `noramedi-worker` in production for the first time — the worker was started from that exact file path and reports `declared=true`, which is only possible if `NORAMEDI_PROCESS_ROLE` was explicitly set, and that variable exists nowhere else (§5.1).

Unsatisfied:

1. **The row's own literal criterion is unmet.** It requires that *"gerçek production `cwd`'nin bu dosyayla eşleştiği ilk deploy'da doğrulanmalı"* — direct verification that production's actual PM2 `cwd` matches the file. **No `cwd` reading appears anywhere in the evidence.** Concretely missing: `pm2 describe` / `pm2 jlist` output showing `pm2_env.pm_cwd` (and `pm_exec_path`/`args`) for either app. The row's `Mevcut kontrol` cell still literally reads `UNVERIFIED (gerçek PM2 cwd teyit edilmedi)`, and nothing supplied changes it.
2. **The API half is now positively disconfirmed, not merely unverified.** Per §8.1.1, the stale installed script is byte-identical to revision `96313f39` (2026-06-29) and contains exactly one `pm2` call — `pm2 reload noramedi-api --update-env` — with no reference to `ecosystem.config.cjs`. That form re-reads the environment from PM2's own stored record for the app, not from a repository config file. **`ecosystem.config.cjs` has therefore never governed the `noramedi-api` process via any deployment**, and the API's observed `RUN_BACKGROUND_JOBS=false` is an out-of-band PM2-stored value that happens to match the repository contract rather than evidence of it. Since R-040 is precisely a config-source-provenance risk, this is disqualifying for the API half.
3. The `dotenv`/`process.cwd()` concern the row names is untouched — nothing confirms which `.env` file was loaded, from which directory, by which process.

**Net effect on R-040:** genuinely *narrowed* for the worker (first real evidence that the repository-defined `cwd`/`script`/`args`/`env` block resolves correctly on the production host) and *sharpened into a confirmed gap* for the API. Closure now requires both a `pm2 describe` `cwd` reading and at least one API start sourced from `ecosystem.config.cjs` — which the next deployment under the re-synced script would produce, since that script's step 5 is `pm2 startOrReload "$ECOSYSTEM_FILE" --only "$PM2_API_NAME" --update-env`.

### 12.4 R-075 — production dependency vulnerability audit

**Current status:** `CLOSURE_PROPOSED_AWAITING_EXTERNAL_CONFIRMATION`. **Token unchanged by this task.**

Both gaps this row named as outstanding are now satisfied by supplied production evidence:

- *"post-deploy `npm audit --omit=dev` on `disklinik-prod-01` has not been run"* → now run: **0 vulnerabilities** (§7).
- *"`binaries.prisma.sh` egress from the production host, required for the changed Prisma engine hash"* → both processes generated Prisma Client `v7.9.1` at startup in production, so the engine fetch demonstrably succeeded (§4, §9).

The row is already at `CLOSURE_PROPOSED_AWAITING_EXTERNAL_CONFIRMATION`, so no token transition is required or made; only its evidence is updated. External confirmation remains outstanding.

### 12.5 R-077 (new) — installed production scripts can silently diverge from the repository

The drift discovered in §8 is a failure mode **no existing register row covers**. It is distinct from R-033 (which asks whether the *repository* defines worker automation — it does, since 2026-08-10) and from R-040 (config-source ambiguity). This risk asks whether what the production host actually executes matches what the repository defines, and whether anything would detect divergence. The answers are: it did not, and nothing would.

It is registered as `R-077` (next free ID; the register ended at R-076), status `OPEN`, with the one-time synchronization recorded as a point-in-time control carrying no ongoing enforcement.

Three facts verified by this task from the repository establish that recurrence is unprevented and that the exposure is broader than the one file that was fixed:

| Check by this task | Result |
|---|---|
| `grep -rl "noramedi-deploy" .github/` | **no matches** — no CI job references the deploy script; no content test or installed-vs-repository hash check exists anywhere |
| `scripts/noramedi-healthcheck.sh` header | carries the identical `# Deploy to: /usr/local/sbin/noramedi-healthcheck.sh` manual-copy pattern — **same drift class, never hash-compared**, and it is the file the deploy script's step 7 invokes |
| Installation mechanism | a documented manual copy (`scripts/noramedi-deploy.sh` header comment) — a human instruction, not a control |

The correct claim is therefore: **drift was detected once and corrected once. Drift is not prevented, and the same pattern remains unverified for `noramedi-healthcheck.sh`.**

### 12.6 Risks reviewed and deliberately NOT changed

| Risk | Status | Why unchanged |
|---|---|---|
| R-074 | `OPEN` | The health/livez/readyz observations are the same class of evidence already recorded in that row and already ruled insufficient. No uptime monitor, alert channel, or Sentry DSN was wired or verified. The drift finding *reinforces* this risk's severity — a worker silently running stale code is exactly what the missing alerting would surface — but reinforcement never narrows a risk. |
| R-073 | `CLOSURE_PROPOSED_AWAITING_EXTERNAL_CONFIRMATION` | No destructive credential-revocation test performed; nothing supplied bears on it. |
| R-019 | `CLOSURE_PROPOSED_AWAITING_EXTERNAL_CONFIRMATION` | Untouched by this evidence. |
| R-018 | `OPEN` | Untouched; 103 grandfathered + 92 review-only sites remain. |

## 13. Rollback

This reconciliation changed only documentation, so the repository-side rollback is a plain revert of the PR. The operational rollback below covers the two host-side actions the operator performed.

**Rollback is operational and script-only. There is no data, schema, migration, or application-code component to roll back.**

**Installed deploy script** — restore the preserved backup:

```bash
cp -a /usr/local/sbin/noramedi-deploy.sh.bak.20260812-174738 \
  /usr/local/sbin/noramedi-deploy.sh
chmod 0755 /usr/local/sbin/noramedi-deploy.sh
```

Verify by re-computing SHA256; the restored file should hash to `8dffcd134f508c0a12699220354dd3074a95f6b98342da6cd53533043e7b675d`.

Note that rolling this back **reinstates the defect** described in §8 — the restored script does not reload or verify `noramedi-worker`. It is recorded for completeness, not recommended.

**Worker process** — the worker reconciliation has no distinct rollback: it moved the worker onto the same release the API was already running. Reverting it would recreate the mismatched-version state. If a full release rollback is ever required, that is the pre-existing application rollback path documented in [F3-IMPL-002_PRODUCTION_WORKER_PROCESS_CONTRACT.md](F3-IMPL-002_PRODUCTION_WORKER_PROCESS_CONTRACT.md) §12 and [F3-SEC-003_PRODUCTION_DEPENDENCY_VULNERABILITY_REMEDIATION.md](F3-SEC-003_PRODUCTION_DEPENDENCY_VULNERABILITY_REMEDIATION.md) §13 (lockfile-deterministic but **not** hermetic — the Prisma engine binary is an unhashed CDN download). No third rollback procedure is authored here.

**Rollback of this documentation change:** `git revert` of the merge commit for this PR. No runtime impact.

### 13.1 Rollback evidence is documented, not tested

**No rollback of any scope was executed.** The supportable statement is: *a byte-preserving backup of the prior installed script exists and a restore procedure is documented.* Do not write "rollback verified", "rollback validated", or "rollback path confirmed". Three scopes, with honest status:

| Scope | Documented | Executed |
|---|---|---|
| Installed **script** rollback (restore the `.bak`) | Yes (above) | **No** — the backup was never restored to a temp path and re-hashed, so "the `.bak` is a valid, complete copy" is assumed, not shown. The stale script's content was never captured into repository evidence, so the pre-drift script is now knowable only from that one file on that one host. |
| **PM2 state** rollback (undoing the worker reconciliation) | **No** — not addressed | **No** — and it may not be recoverable, since `startOrReload --update-env` overwrote PM2's prior record for that app |
| **Application/release** rollback | Partially, elsewhere — [F3-IMPL-002_PRODUCTION_WORKER_PROCESS_CONTRACT.md](F3-IMPL-002_PRODUCTION_WORKER_PROCESS_CONTRACT.md) §12 and [F3-SEC-003_PRODUCTION_DEPENDENCY_VULNERABILITY_REMEDIATION.md](F3-SEC-003_PRODUCTION_DEPENDENCY_VULNERABILITY_REMEDIATION.md) §13 (explicitly **non-hermetic**) | **No** |

One further defect in the existing record, found by this task and recorded rather than silently inherited: F3-PROD-001's documented previous-production SHA and rollback anchor `b21cae911a0aa3444ebcd6e714a92c4f0802608a` **is not resolvable in this repository** (`git cat-file -t` fails; it appears in no branch). It may exist only on the production checkout, but it cannot be inspected or diffed from the repository, which weakens that documented release-rollback anchor. Flagged for follow-up in §17; not corrected here.

## 14. Tenant, security, KVKK, schema, and backward-compatibility impact

Assessed for **this reconciliation and the operator actions it records**:

- Tenant isolation impact: **NONE**
- KVKK/privacy impact: **NONE**
- Auth impact: **NONE**
- Schema/migration impact: **NONE**
- Backward compatibility impact: **NONE**
- Patient data read, modified, or exported: **NO**
- Verification messaging sent: **NO**
- Destructive database action: **NO**
- Rollback scope: **operational/script-only**

No query path, authorization check, or tenant-scoping logic was touched. The worker reload restarted an existing process onto the already-deployed release; the 9 background jobs' own tenant-scoping behavior is unchanged. The deploy script prints only PM2 status words and never logs environment variables, connection strings, or secrets (`F3-IMPL-002` §4.6/§10, unchanged).

One security-relevant **observation**, not an impact of this task: between 2026-08-10 and 2026-08-12 the worker ran a Prisma Client version one patch-family behind the API, including the `7.9.1` remediation F3-SEC-003 shipped. F3-SEC-003 established that none of the 8 advisories was reachable from any NoraMedi request or job path, so no exploitable exposure follows — but the window existed and is recorded rather than omitted.

## 15. Validation performed by this task

No program-level `docs`/`validate:docs` script exists in this repository, so none was run. Running application test suites for a documentation-only change is not required by repository policy and was not done.

```
git status --porcelain                 → clean at start
git rev-parse origin/main              → aa18b064267ff5846ae60f73889c3322030bd4a8
git diff --check                       → exit 0, clean (no whitespace/conflict markers)
git diff --name-only origin/main       → docs/program/** only
git show aa18b064…:scripts/noramedi-deploy.sh | sha256sum
                                       → 794375b4249b063e167a8d6f885df1a590bd9de9df367e91a0d3eaaf635f5012
git show 96313f39…:scripts/noramedi-deploy.sh | sha256sum
                                       → 8dffcd134f508c0a12699220354dd3074a95f6b98342da6cd53533043e7b675d
git log -1 --format="%H %ci" 96313f39… → 2026-06-29 22:56:17 +0200
ls server/prisma/migrations | grep -c ^2
                                       → 73
gh pr view 401 --json state,mergeCommit → MERGED, aa18b064…
grep -rl "noramedi-deploy" .github/    → no matches (no CI drift guard)
git cat-file -t b21cae91…              → fatal: could not get object info
```

All commands above are read-only. No production access was performed. The two `sha256sum` results are the load-bearing repository-side corroborations: the first confirms the installed script now matches the repository at the deployed SHA; the second identifies exactly which historical revision the stale copy was (§8.1.1).

Exact commands, exit codes, and results are restated in §15 of the delivery report accompanying this PR.

## 16. F3 exit-gate and completion verdict

### 16.1 F3-IMPL-002 lifecycle — the two halves must not be collapsed

| F3-IMPL-002 component | Production state |
|---|---|
| `ecosystem.config.cjs` role/job-ownership contract + `NORAMEDI_PROCESS_ROLE` startup guard | **`VERIFIED_PRODUCTION_OBSERVED`** (point-in-time, partial scope) for the worker; for the API the *effective values* are observed but the *config source* is not (§5.1, §12.3) |
| `scripts/noramedi-deploy.sh` deploy-lifecycle contract (steps 5–6 + step 8 worker verification) | **`INSTALLED_NOT_YET_EXERCISED`** — corrected on the host, but no deployment has run under it; steps 6 and 8 have never been observed executing in production |

The evidence-quality label is deliberate. Per `evidence/README.md`, `VERIFIED_PRODUCTION_OBSERVED` is *"an observed operational fact, point-in-time — **not** a `PRODUCTION_VERIFIED` task-status/release-gate claim."* The task-status token `PRODUCTION_VERIFIED` (tracker §2.2) requires a live smoke/acceptance test performed and recorded. **That bar is not met here**, and this task does not assign that token to F3-IMPL-002.

What is specifically **not** verified, and must not be implied:

- **Job execution.** No completed tick, no `JobLock` lease acquisition, no downstream effect (§9.1). This repository's own worker-recovery standard requires a completed reminder tick, which was not captured.
- **The automated deploy lifecycle.** Steps 6 and 8 have never executed in production; the worker was reconciled by hand (§12.1).
- **API config-source provenance.** The API's `declared` flag was never reported, so `ecosystem.config.cjs` is unproven as the API's environment source (§5.1, §12.3).
- **Reboot survival.** No `pm2 save` evidence; the reconciled PM2 definition may not be persisted.
- **Restart-count anomaly review (R-037).** `restart_time` 10 → 11 was recorded but no anomaly review was performed, which `LAUNCH_GATES.md` requires.
- **Worker code attestation.** No `git rev-parse HEAD` was captured on the production checkout at worker restart, so "the worker runs the target SHA's code" is inference from a verified Prisma version plus assumed non-mutation, not attestation.
- **Any rollback.** None was executed at any scope (§13.1).

**Is F3-IMPL-002 complete? NO.** Its job-ownership half is observed correct in production; its deploy-lifecycle half is not, and R-033 — the risk that half exists to close — remains `OPEN` with a now-documented production failure against it.

### 16.2 F3 exit gate

The three repository-defined F3 exit criteria (`phases/F3_PRODUCTION_HARDENING.md` lines 82–84) are:

1. *Gözlemlenebilirlik standardı canlıda kanıtla çalışıyor (log/metrik/trace/alarm)* — observability standard proven working live
2. *Güvenlik sertleştirme kontrol listesi kapatılmış* — security hardening checklist closed
3. *Olay müdahale prosedürü tatbikatla doğrulanmış* — incident response procedure verified by drill

**None is touched by this evidence. `F3_EXIT_GATE = NOT_SATISFIED`, unchanged.**

This task must not be read as implying any of the following, none of which repository evidence supports:

- R-074 is closed — it is **not**; it remains `OPEN`.
- Security sign-off is done — it is **not**; criterion 2 remains `PASS_WITH_EXTERNAL_VERIFICATION` with GitHub security-settings, TLS, Redis-replica, and MFA-enrollment verification outstanding, and R-073/R-019 awaiting external confirmation.
- The incident-response exit is done — it is **not**; F3-IR-001's drill remains `SIMULATED`, and its sufficiency is an undecided program-owner call.
- The first-customer launch gate is approved — it is **not**. `LAUNCH_GATES.md` §3.F still lists the R-033 worker-deploy-automation blocker, and this evidence shows that blocker was genuinely still live in production until 2026-08-12.

**Program-state tokens:** `F3_DEPLOYMENT = DONE` · `F3_PRODUCTION_VERIFICATION = PARTIAL` · `F3_EXIT_GATE = NOT_SATISFIED` · `F3_COMPLETE = NO` · `F4_TRANSITION_AUTHORIZED = NO`.

## 17. Exact remaining actions

Not begun by this task. Ordered by value.

**0. Five read-only commands on the production host would settle most of the residual gaps cheaply.** None requires a deployment or a rollback:

```bash
pm2 logs noramedi-worker --lines 200 --nostream   # capture one completed job tick
pm2 describe noramedi-api                          # read env provenance / declared flag / pm_cwd
pm2 describe noramedi-worker                       # pm_cwd / pm_exec_path / args  (R-040's own criterion)
git -C /var/www/noramedi rev-parse HEAD            # attest the deployed source SHA
sha256sum /usr/local/sbin/noramedi-healthcheck.sh  # same drift class, never checked
```

Plus `pm2 save`, if the reconciled worker definition is intended to survive a reboot.

1. **Run the next production deployment under the re-synced `/usr/local/sbin/noramedi-deploy.sh` and capture step 6 and step 8 output.** This is the single missing piece of evidence for R-033.
2. **Capture `pm2 describe noramedi-api` / `pm2 describe noramedi-worker`** (or `pm2 jlist`) showing `pm_cwd`/`pm_exec_path`/`args` — R-040's own literal named criterion. (The related question of whether `ecosystem.config.cjs` ever governed the API is already settled in §8.1.1 — it did not — so reading the host backup is no longer needed.)
3. **Risk-owner decision on R-034's proposed closure** and on the new R-077 row.
4. **Establish an installed-vs-repository script equivalence check** (candidates for a future task, not built here: run the deploy from a repository checkout; or have the script self-verify an embedded commit SHA and abort on mismatch; or add a pre-deploy SHA256 comparison to the operator runbook). Coverage should include `noramedi-healthcheck.sh`.
5. **Documentation-hygiene follow-up**, deliberately out of scope here: `PRODUCTION_TOPOLOGY.md` §3/§4 and `LAUNCH_GATES.md` §3.F still carry pre-F3-IMPL-002 text; `evidence/README.md` is missing rows for F3-PROD-001, F3-SEC-003, and this document. `runbooks/F3_FIRST_CUSTOMER_INCIDENT_RESPONSE.md` directs operators to `/usr/local/sbin/noramedi-deploy.sh` during incidents and is operationally affected by §8's finding.
6. **Resolve or re-anchor `b21cae911a0aa3444ebcd6e714a92c4f0802608a`** — F3-PROD-001's documented previous-production SHA and rollback anchor, which is not resolvable from this repository (§13.1).
7. Unchanged and not begun here: the six external/decision actions in [F3-PROD-001_PRODUCTION_DEPLOYMENT_AND_VERIFICATION.md](F3-PROD-001_PRODUCTION_DEPLOYMENT_AND_VERIFICATION.md) §13.

## 18. Delivery state

```
Agent implementation completed: YES  (documentation reconciliation)
Doc validation passed:          YES  (git diff --check clean, docs/program/** only)
PR opened:                      YES
Merged:                         NO
Deployed:                       NO   (no deployment performed by this task)
Production verified:            NO for the F3-IMPL-002 task-status token.
                                Evidence class is VERIFIED_PRODUCTION_OBSERVED
                                (point-in-time, partial scope) for the
                                job-ownership half only; the deploy-lifecycle
                                half is INSTALLED_NOT_YET_EXERCISED. See §16.1.
```

This task does **not** close F3. F3's three named exit-gate criteria are untouched by it. It does not authorize deployment, does not authorize the F4 transition, and closes no risk.

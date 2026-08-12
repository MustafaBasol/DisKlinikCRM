# F3-PROD-001 — Production Deployment and Verification Evidence

> **⚠ SUPERSEDING CORRECTION (added 2026-08-12 by `F3-IMPL-002-PROD-RECON`, additive — nothing below is rewritten).**
> Later operator-supplied production evidence establishes that **§2's "Deploy procedure used" row is incorrect as to what actually executed.** Production deploys invoke the *installed* script `/usr/local/sbin/noramedi-deploy.sh`, not the repository copy, and that installed copy was frozen at the **2026-06-29** revision (SHA-256 `8dffcd13…`, byte-identical to the blob at commit `96313f39edc063f246f8c2ba74b6a6f2c6ed6364` — independently confirmed against git history). That version predates F3-IMPL-002: it reloads **only** `noramedi-api` via `pm2 reload noramedi-api --update-env`, never references `ecosystem.config.cjs`, never reloads `noramedi-worker`, and never verifies the worker's PM2 status.
> Two claims below are narrowed as a result: **(1)** §3's `noramedi-worker` row described a **stale** worker instance — PM2 `online` was true, but the process could not have been restarted by this deploy and was not running the deployed code; **(2)** §3's API row observes the API's *effective* `RUN_BACKGROUND_JOBS=false`, but that value comes from PM2's out-of-band stored environment, **not** from `ecosystem.config.cjs` — the API has still never been started or reloaded from the repository-defined config source.
> **Unaffected and still standing:** the deployed SHA, the pre-deploy backup, the migration state (73 migrations, schema up to date), the API health/`livez`/`readyz` results, the Platform Admin login check, and the `npm audit` counts behind R-075.
> Full analysis, repository-side corroboration, and re-assessed R-033/R-034/R-040 dispositions: [F3-IMPL-002-PROD-RECON_PRODUCTION_WORKER_CONTRACT_VERIFICATION.md](F3-IMPL-002-PROD-RECON_PRODUCTION_WORKER_CONTRACT_VERIFICATION.md) §4–§6.

**Phase:** F3 — Production Hardening. **Type:** documentation-only reconciliation of **user-supplied, operator-executed production evidence** — this task itself performed no production access, ran no command on `disklinik-prod-01`/`api.noramedi.com`, and does not independently re-verify any figure below. This is the same evidentiary class as this program's prior operator-executed-evidence reconciliations (e.g. `KVKK-HIGH-006-PRODUCTION_DEPLOYMENT_AND_SMOKE_VERIFICATION.md`, the R-061 residual-safe-reset entries in `RISK_REGISTER.md`) — supplied facts are recorded and reconciled against program documents, not re-derived. A companion task in this same session (`F3-PROD-001`, preflight) independently confirmed this session's own environment has no SSH/remote-execution path to production; the facts below originate from the user/operator, not from this session's own tool use.

**Deployment date (as supplied):** 2026-08-12.

## 1. Purpose

Reconcile the confirmed F3-PROD-001 production deployment facts (supplied verbatim in the assigning task) into `NORAMEDI_MASTER_TRACKER.md`, `phases/F3_PRODUCTION_HARDENING.md`, `CURRENT_PHASE.md`, and `RISK_REGISTER.md`, and produce an updated F3 exit-gate assessment. Per this task's own brief: no feature implementation, no runtime/schema change, no migration, no further deployment, no risk self-closure, no F4 start.

## 2. Deployment facts (as supplied, not independently re-verified)

| Item | Value |
|---|---|
| Previous production SHA | `b21cae911a0aa3444ebcd6e714a92c4f0802608a` |
| Deployed/target SHA | `f0ff4c70abe08b192233d17cdcd1b7a77dbe4b08` (confirmed by this session's own prior `git rev-parse origin/main`, in the F3-PROD-001 preflight task earlier this session, to be `origin/main`'s tip at PR #398's merge) |
| Rollback safety ref | `prod-pre-f3-20260812-b21cae9` → `b21cae911a0aa3444ebcd6e714a92c4f0802608a` |
| Pre-deploy DB backup | `/var/backups/noramedi/pre-f3-prod-20260812T120309Z/noramedi_crm.dump` — `pg_dump_exit=0`, `pg_restore --list exit=0`, SHA-256 `de8bf3989f52a8d800319c3c778e3b347b5b61f53285f07ac29923a80edb1934` |
| Deploy procedure used | `scripts/noramedi-deploy.sh` (`git pull --ff-only` → `npm ci` → `prisma migrate deploy` → `prisma generate` → `pm2 startOrReload ecosystem.config.cjs --only noramedi-api` → `--only noramedi-worker` → healthcheck) — matches the repository-defined procedure this session's own preflight read directly from the script |
| Migration applied | `20260811120000_add_platform_admin_password_changed_at` (the F3-SEC-002/R-073 column) |
| Post-deploy migration state | 73 migrations found; database schema up to date |

**No SHA256/backup-tooling output, migration count, or health-endpoint response above was independently re-run or re-derived by this task — all are recorded as supplied.**

## 3. Process topology evidence (as supplied)

| Item | Value |
|---|---|
| `noramedi-api` | `ONLINE`, `role=api`, `RUN_BACKGROUND_JOBS=false`, `ownsJobs=false` |
| `noramedi-worker` | `ONLINE`, `role=worker`, `ownsJobs=true` |
| Duplicate processes | None observed |

This matches the repository-defined `ecosystem.config.cjs` contract (F3-IMPL-002) this session's own preflight read directly — API/worker role separation and API-side `RUN_BACKGROUND_JOBS=false` are exactly what that file specifies. This is the first production evidence confirming that repository-defined contract is actually what production runs, closing the "not yet deployed/verified" gap the F3-IMPL-002 evidence chain and `RISK_REGISTER.md` R-033/R-034/R-040 previously carried for this specific contract.

## 4. Health/readiness evidence (as supplied)

| Endpoint | Result |
|---|---|
| `GET https://api.noramedi.com/api/health` | `200 {"status":"ok"}` |
| `GET https://api.noramedi.com/api/livez` | `200 {"status":"ok","role":"api"}` |
| `GET https://api.noramedi.com/api/readyz` | `200`, `database=ok`, `redis=ok` |
| `GET https://app.noramedi.com/login` | `200` |

This is the first production evidence that F3-OBS-001's `/livez`/`/readyz` endpoints are deployed and responding correctly with real dependency checks (`database=ok`/`redis=ok`) — previously these existed only as repository-side, unit-tested code (F3-OBS-001's own evidence explicitly limited its claim to that). **This is reachability/correctness evidence for the endpoints themselves — it is not dashboard, alert-channel, or uptime-probe evidence** (see §6 R-074).

## 5. Platform Admin security evidence (as supplied)

Normal, real production Platform Admin login manually verified successful post-deploy. **No password reset/session-revocation destructive test was performed** — explicitly and deliberately, per the assigning task's own instruction not to reset a real production admin credential merely for verification.

## 6. Risk reconciliation

**R-018** (sensitive data in logs) — **status unchanged: `OPEN`.** Per the assigning task's explicit instruction, not self-closed by this deployment. **Correction discovered during this reconciliation:** this session's own preceding branch state was stale — `origin/main` had already advanced 10 commits beyond it, including **F3-IMPL-007 ("Sensitive Runtime Logging Regression Guard", PR #399, `380cf045f29a2aec713b1909497effba3436e280`) and F3-CI-OPT-001 (PR #398, `f0ff4c70abe08b192233d17cdcd1b7a77dbe4b08`, which wires the guard into Layer 1 PR CI)**. Both are independently confirmed ancestors of the F3-PROD-001-deployed SHA — the regression guard is therefore **already live in the deployed production codebase**, not merely repository-side or unimplemented as this document's own earlier draft (and the F3-PROGRAM-RECON-001-R1 entry it supersedes) stated. Per F3-IMPL-007's own evidence (`evidence/F3-IMPL-007_SENSITIVE_RUNTIME_LOGGING_REGRESSION_GUARD.md` §14/§16), this closes the "no automated regression-prevention mechanism" gap going forward but explicitly does **not** remediate the 103 grandfathered/baseline-excepted sites nor the 92 `POTENTIAL_PII_SAFE_AFTER_REVIEW` sites — R-018 remains `OPEN`, per that document's own repeated explicit statement, unaffected by deployment.

**R-019** (platform-admin authority overreach / audit coverage) — **status unchanged: `CLOSURE_PROPOSED_AWAITING_EXTERNAL_CONFIRMATION`.** Deployment does not supply the external/program-owner confirmation this row's closure requires; the underlying audit-coverage implementation (F3-IMPL-005, 37/37 endpoints `AUDITED_DURABLY`) is now deployed to production (same deploy, same SHA) but that is not, by itself, the missing external confirmation.

**R-073** (PlatformAdmin JWT session revocation) — **status unchanged: `CLOSURE_PROPOSED_AWAITING_EXTERNAL_CONFIRMATION`, evidence updated.** New evidence this task supplies: the `passwordChangedAt` migration is now confirmed applied in production (73 migrations, schema up to date), and normal Platform Admin authentication is confirmed still working post-deploy — this resolves the row's own previously-named "no production migration-application evidence" gap. **What remains open and was deliberately not exercised:** a real behavioral proof that a credential change actually invalidates a previously issued token in production (the destructive revocation test). Per this program's own R-071/R-072/R-073 precedent, a task cannot self-close a risk on its own supplied evidence — this remains a two-path closure, not a coding task:
  - **Path A:** the named risk owner/decision owner explicitly accepts non-destructive evidence (migration applied + code/test review already on record + normal-login confirmation) as sufficient, recorded in writing; or
  - **Path B:** an authorized, controlled, non-patient-impacting revocation test is performed against a designated test/ops Platform Admin account during a defined window, with the before/after token-validity proof captured as evidence.

  Neither is performed by this task. See §8 for the exact acceptance-record template prepared for whichever path is chosen.

**R-074** (no live production observability/alerting) — **status unchanged: `OPEN`, evidence updated.** New evidence: `/livez` and `/readyz` are confirmed live in production, returning correct dependency-checked responses (§4). Per the assigning task's explicit instruction, this is **not** sufficient to close R-074 — an endpoint responding correctly is not the same as an external uptime-prober, log-aggregation/alert-channel, or dashboard actually watching it. **Exact minimum remaining evidence to close R-074:** at least one of — (a) an external uptime monitor actively probing `/livez` or `/readyz` with a configured alert route (e.g. paging/email/Slack on failure), demonstrated live, not merely configured; (b) a log-aggregation pipeline on the structured `pino` output with an alert rule wired to at least one of the conditions F3-OBS-001's own evidence doc names (API unreachable, readiness failing, worker offline, backup stale, elevated 5xx); (c) `SENTRY_DSN` (or equivalent) provisioned in production with `@sentry/node` installed and at least one real captured event verified in the provider's dashboard. None of these external actions is a repository/coding task — this task does not implement any of them, consistent with its own instruction not to implement observability tooling.

**R-075 (new, this task)** — see `RISK_REGISTER.md`: production `npm audit` reports 0 critical / 2 high / 5 moderate / 1 low. Recorded as a new risk row per this program's convention that every concrete supplied finding gets a row; **not remediated here** — assigned to the separate follow-up task **F3-SEC-003 — Production Dependency Vulnerability Remediation and Exploitability Classification**, not started. No dependency file touched by this task.

## 7. F3 exit-gate matrix (re-assessed)

Exit gate per `phases/F3_PRODUCTION_HARDENING.md` §"Exit gate" (unchanged, three items):

| # | Criterion | Status before this task | New evidence this task adds | Status after this task | Exact remaining evidence |
|---|---|---|---|---|---|
| 1 | Observability standard demonstrably working live | `OPEN` | `/livez`/`/readyz` confirmed live and correct in production (§4) — real dependency checks passing | **`OPEN`, unchanged** | External uptime-prober + alert-channel wiring, or log-aggregation/alert-channel setup, or Sentry DSN with a verified captured event (R-074, §6) — none performed |
| 2 | Security hardening checklist closed | `PASS_WITH_EXTERNAL_VERIFICATION` | R-073's production-migration gap closed (§2, §6); PM2/process-role/job-ownership contract confirmed matching production (§3) | **`PASS_WITH_EXTERNAL_VERIFICATION`, unchanged** | GitHub repo Code security & analysis settings verification (Dependabot alerts/security updates/code scanning/`npm audit` in CI); TLS cert/protocol production verification; Redis/replica topology verification; platform-admin MFA-enrollment coverage; external confirmation of R-073/R-019 — none of these is supplied by this deployment |
| 3 | Incident-response procedure verified via drill | `OPEN` | None — this deployment does not touch the drill question | **`OPEN`, unchanged** | Program-owner decision on whether F3-IR-001's simulated/repository-based tabletop satisfies "tatbikatla doğrulanmış," or whether a live/production-adjacent drill is required — unchanged, not decided by this task |

**F3 exit gate: `NOT SATISFIED`** — unchanged in substance; deployment resolves the concrete "nothing in the merge train protects a real customer until deployed" blocker (`F3-PROGRAM-RECON-001` §6 Bucket A, item 1) but does not touch any of the three named exit-gate criteria directly.

## 8. First-customer blocker bucket reclassification (relative to `F3-PROGRAM-RECON-001` §6)

**Bucket A → now resolved:** "Deploying the merged F3 train to production" — **done**, this task's own subject. The second Bucket-A item, "independent/external confirmation of R-073's remediation," **remains open** — production deployment supplies new evidence toward it (§6) but is not itself the confirmation.

**Bucket B (production-verification required) — partially resolved:**
- Production migration application + behavioral evidence for R-073's column: migration-application now **confirmed** (§2); full behavioral (destructive) proof still open (§6).
- PM2/process topology, worker/API role separation, job-ownership: **confirmed** matching the repository contract (§3).
- Health/readiness endpoints live: **confirmed** (§4).
- Still open, untouched by this deployment: GitHub repo Code security & analysis settings; TLS certificate/protocol; Redis/replica topology; webhook-secret-per-connection completeness; platform-admin MFA-enrollment coverage; live observability wiring (R-074).

**Bucket C (non-blocking hardening/backlog) — unchanged, plus one addition:**
- R-018's 92 review-only sites + missing lint rule (F3-IMPL-007, still not implemented) — unchanged.
- R-019's break-glass procedure — unchanged.
- **New: R-075 / F3-SEC-003** — production dependency vulnerabilities (0 critical/2 high/5 moderate/1 low), classified non-blocking to F3's own exit gate (not named by any of the three criteria), assigned to its own dedicated follow-up task, not started, not remediated here.

**Bucket D (already satisfied) — unchanged**, plus: F3 implementation-train deployment itself is now also satisfied (was Bucket A before this task).

## 9. R-073 / R-019 acceptance-record templates (prepared for review, not executed)

Per this task's own instruction: repository policy does not permit an agent to self-close either risk. The following templates are prepared for the named decision owner (per this program's established pattern — see `RISK_REGISTER.md` R-072's closure: "external confirmation authority: ChatGPT architecture review and Mustafa Basol (merge decision)") to complete and sign, if and when they choose to accept the evidence on record. **No signature line below is filled in; no approval is claimed or implied by this document.**

```
RISK: R-019 — Platform-admin yetki aşımı (audit-coverage component)
Evidence on record: F3-IMPL-005(+R1), 37/37 platform-admin mutation endpoints AUDITED_DURABLY,
  0 UNAUDITED_PERSISTED_MUTATION, deployed to production 2026-08-12 (this document, §2).
Remaining named gap NOT covered by this closure: break-glass procedure, scope-boundary mitigations
  (RISK_REGISTER.md R-019 row, "Eksik kontrol" column) — unaffected by this acceptance.
Decision:            [ ] ACCEPT evidence as sufficient for audit-coverage component closure
                      [ ] REQUEST further evidence — specify:
Decision owner:       ______________________  Date: ______
Resulting status:    [ ] CLOSED (audit-coverage component only)  [ ] remains OPEN
```

```
RISK: R-073 — PlatformAdmin JWT session revocation
Evidence on record: F3-SEC-002 implementation + DB-backed tests (RISK_REGISTER.md R-073 row);
  production migration 20260811120000_add_platform_admin_password_changed_at CONFIRMED APPLIED
  (73 migrations, schema up to date); normal production Platform Admin login CONFIRMED working
  post-deploy (this document, §2, §5). Destructive revocation behavioral test NOT performed.
Decision:            [ ] ACCEPT non-destructive evidence as sufficient (Path A, §6)
                      [ ] AUTHORIZE a controlled destructive revocation test on a designated
                          test/ops account, scheduled window: __________ (Path B, §6)
                      [ ] REQUEST further evidence — specify:
Decision owner:       ______________________  Date: ______
Resulting status:    [ ] CLOSED  [ ] remains CLOSURE_PROPOSED_AWAITING_EXTERNAL_CONFIRMATION
```

## 10. Tenant / KVKK / security impact of this verification (as supplied)

- Tenant isolation regression observed: **NO**
- Patient data modified by verification: **NO**
- Verification messaging sent: **NO**
- Destructive DB action: **NO**

## 11. Validation performed by this task

```
git diff --check      → clean (no whitespace-conflict markers), run against this task's own doc-only diff
```

No program-level `docs`/`validate:docs` script exists in this repository (checked in the F3-PROD-001 preflight task, unchanged) — none run. No application/schema/migration/test file touched by this task; diff limited to `docs/program/**`.

## 12. F3 completion verdict

- **F3 implementation-merge-train:** materially complete. **F3-IMPL-007 is no longer outstanding** — corrected during this reconciliation: it is confirmed `MERGED` (PR #399) and CI-wired (PR #398, F3-CI-OPT-001), both ancestors of the deployed SHA (§6). It remains non-blocking to F3's own three named exit-gate criteria either way, and does not close R-018 (§6).
- **F3 deployment:** **DONE** (this task's own subject) — first F3 production deployment evidence in this repository.
- **F3 production verification:** **PARTIAL** — process topology, migration application, and health/readiness endpoints are now production-confirmed; the three named exit-gate criteria (observability wiring, full security-checklist external verification, incident-response drill sufficiency) remain unconfirmed.
- **F3 exit gate:** **NOT SATISFIED.**
- **F3 COMPLETE:** **NO.**
- **F4 transition authorized:** **NO.**

## 13. Exact smallest remaining actions (all external/operator/decision actions — no further coding task implied by any of these)

1. Wire at least one external observability signal (uptime-prober, log-alert channel, or Sentry) against the now-live `/livez`/`/readyz` and verify it fires — closes exit-gate criterion 1 / R-074.
2. Verify GitHub repository Code security & analysis settings (Dependabot alerts/security updates, code scanning, `npm audit` in CI), TLS cert/protocol, Redis/replica topology, and platform-admin MFA-enrollment coverage — closes the remaining `PASS_WITH_EXTERNAL_VERIFICATION` items under exit-gate criterion 2.
3. Program-owner decision recorded in writing on whether F3-IR-001's simulated drill satisfies exit-gate criterion 3, or whether a live/production-adjacent drill is required.
4. Decision owner completes one of the two R-073 template paths in §9 (accept evidence, or authorize a controlled revocation test).
5. Decision owner completes the R-019 template in §9 (accept the audit-coverage evidence, or request more).
6. Separately, and not part of F3's own exit gate: begin **F3-SEC-003** (dependency-vulnerability remediation) as its own dedicated task when scheduled.

None of the above is a coding task this session should invent or start on its own initiative, per this task's own explicit instruction.

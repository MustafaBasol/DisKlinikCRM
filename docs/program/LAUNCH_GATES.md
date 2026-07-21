# LAUNCH_GATES — Controlled Pilot (G1) and General Commercial Launch (G2) Evidence Definition

**Source task:** F0-012 — Controlled Pilot and General Launch Gate Definition
**Baseline commit used:** `origin/main` @ `c49466e15daa66933bf5c2e36fe46343e08bfcdd` (`docs(program): F0-011-P1 — Active KVKK-HIGH-008 Work Baseline and Architecture Freeze Boundary (#181)`), verified via `git fetch origin --prune` + `git rev-parse origin/main` at this task's start — **no drift was present at that time.** `origin/main` later advanced to `cf12b05e9a65730e39b0aa667469e312fade5cc8` (PR #184, "post-deployment production-evidence reconciliation pass") during this document's own external-review correction pass; that commit does not itself touch this file, but it does supply new KVKK-HIGH-007/008 production-deployment evidence, integrated into §1 below to the evidence level it actually supports (via `git merge --no-ff origin/main`) — this is history, not a claim of current no-drift; re-verify `origin/main` before relying on this document again.
**Companion documents (do not restate, cross-reference):** [RELEASE_GATES.md](RELEASE_GATES.md) (G0–G6 index — this document is the detailed evidence specification for G1/G2, referenced from there), [NORAMEDI_MASTER_TRACKER.md](NORAMEDI_MASTER_TRACKER.md), [RISK_REGISTER.md](RISK_REGISTER.md), [KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md](KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md), [KVKK_HIGH008_FREEZE_BOUNDARY.md](KVKK_HIGH008_FREEZE_BOUNDARY.md), [PRODUCTION_TOPOLOGY.md](PRODUCTION_TOPOLOGY.md), [ENVIRONMENT_MATRIX.md](ENVIRONMENT_MATRIX.md), [TEST_OWNERSHIP.md](TEST_OWNERSHIP.md), [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md), [../compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md](../compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md), [../architecture/object-storage-backup-migration-design.md](../architecture/object-storage-backup-migration-design.md).

## 0. Non-authorization and non-collapse statement

**This document defines evidence requirements. It does not itself satisfy any of them.** No status below is asserted as met merely because this document names it. Neither gate below is `APPROVED` or `CONDITIONALLY_APPROVED` by virtue of this document existing — both start `NOT_EVALUATED` (see §5). Approval is an external (ChatGPT/user) decision per [NORAMEDI_MASTER_TRACKER.md §2.3](NORAMEDI_MASTER_TRACKER.md#23-ajan-yetki-sınırları); no agent may self-assign `CONDITIONALLY_APPROVED` or `APPROVED`.

The following states are **never collapsed** into one another anywhere in this document or its evidence trail:

| State | Distinct from |
|---|---|
| Agent completed | Reviewed, tested, merged |
| Tests reportedly passed (author-run) | Tests independently verified |
| PR opened | Merged |
| Merged (repository fact) | Migration applied to production |
| Migration applied | Deployed / process restarted with new code |
| Deployed | Feature activated (flag/config on) |
| Feature activated | Production-verified (smoke/acceptance test executed and recorded) |
| Production-verified (technical) | Legally/externally compliant (KVKK/VERBİS/DPA/contractual) |

Any evidence entry in §§2-3 that cannot cite a concrete artifact (commit hash, PR number + state, `gh pr view` output, test run output, production command output, signed-off document) must be recorded as `UNVERIFIED` or `NOT_EVALUATED` — never inferred as satisfied.

## 1. Current repository state this document is grounded in (do not restate elsewhere, cite this section)

| Item | Value | Evidence |
|---|---|---|
| `origin/main` HEAD | `c49466e15daa66933bf5c2e36fe46343e08bfcdd` | `git rev-parse origin/main`, this task |
| KVKK-HIGH-008 (legacy consent correction) | `MERGED` — [PR #180](https://github.com/MustafaBasol/DisKlinikCRM/pull/180), merge commit `e972bfef918471074137bb0f11705d43a1ca2ce5`. Migration `20260719155318_kvkk_high008_legacy_consent_correction` present in `main`. **Status separation (see §0 non-collapse table):** code merged — confirmed. Migration present in repository — confirmed. **Production migration applied — confirmed** (`origin/main` @ `cf12b05e9a65730e39b0aa667469e312fade5cc8`, PR #184, 2026-07-20 reconciliation pass: user-supplied, read-only production evidence — 64/64 migrations present, `prisma migrate status` clean, `PatientLegacyConsentCorrection`/`PatientLegacyConsentField` present with 0 rows). **Deployment — confirmed** (same evidence: `noramedi-api`/`noramedi-worker` healthy at the deployed commit). Deployment has made the endpoint/UI workflow reachable/available to authorized roles (OWNER/ORG_ADMIN/CLINIC_MANAGER); it is a manual, authenticated API/UI-invoked administrative workflow, not startup-, cron-, job-, or worker-driven — no automatic invocation path was found (KVKK-HIGH-008-PMVR Phase B1, [PR #185](https://github.com/MustafaBasol/DisKlinikCRM/pull/185), author-reported/`OPEN`, not independently re-verified by this document). **Whether any authorized user has actually invoked the workflow (feature activation in the sense of "used," not "reachable") remains unverified** — 0 correction rows recorded as of the 2026-07-20 evidence. No explicit kill switch — confirmed repository finding, still true in production (R-061); PMVR (PR #185) proposes an unimplemented `PlatformSetting`-backed runtime toggle (`privacy.legacyConsentCorrection.runtimeEnabled`, default disabled, no Prisma migration required) as one option — not adopted or authorized by this document. Rollback/tenant-impact independent verification — not performed (freeze-boundary condition 4, R-046/R-062). External "KVKK baseline stable" declaration — not made (freeze-boundary condition 5). | [KVKK_HIGH008_FREEZE_BOUNDARY.md](KVKK_HIGH008_FREEZE_BOUNDARY.md), [RISK_REGISTER.md](RISK_REGISTER.md) R-061/R-062, [PR #185](https://github.com/MustafaBasol/DisKlinikCRM/pull/185) |
| KVKK-HIGH-007 continuation (consent reconciliation) | `MERGED` — [PR #175](https://github.com/MustafaBasol/DisKlinikCRM/pull/175), commit `1da9586995b625624b7385c14e70ba6a322def73`. Migration `20260719120821_kvkk_high007_consent_reconciliation` present in `main`. Enforcement flag `COMMUNICATION_CONSENT_ENFORCEMENT_ENABLED=false`, mode `audit`; reconciliation flag `COMMUNICATION_CONSENT_LEGACY_RECONCILIATION_ENABLED=false`. **Production migration application: confirmed** (same `cf12b05`/PR #184 evidence as KVKK-HIGH-008 above — the same `prisma migrate status` check that confirmed 64/64 migrations also confirms this one). **Production backfill: confirmed NOT executed**, flags confirmed still disabled in production (`../compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md` 2026-07-19 row; reconfirmed by the 2026-07-20 production evidence). Rollback/tenant-impact independent verification and external "KVKK baseline stable" declaration — not performed/not made (freeze-boundary §5 conditions 4/5). | [KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md](KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md) §5 |
| F0-011 (storage/backup design) | `MERGED` — [PR #182](https://github.com/MustafaBasol/DisKlinikCRM/pull/182), merge commit `87b7dcd9bfe5d27956e32e8b61590667e36bac86`. Documentation-only; no runtime effect. | tracker §6 F0-011 |
| F0-011-P1 (KVKK-HIGH-008 baseline) | `MERGED` — [PR #181](https://github.com/MustafaBasol/DisKlinikCRM/pull/181), merge commit `c49466e15daa66933bf5c2e36fe46343e08bfcdd` (`mergedAt: 2026-07-19T21:12:26Z`, confirmed via `gh pr view 181`; this is also this document's own baseline commit — self-reference-lag corrected by F0-012, same pattern as every prior F0 task). | tracker §6 F0-011-P1 |
| Note on `docs/compliance/` drift (R-042) | `docs/compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md`'s own change-history narrative describes the KVKK-HIGH-007 continuation as "not merged" — this is stale relative to `git`/`gh` evidence (PR #175 is `MERGED`, per source hierarchy §2.1 rule 1). This document follows the git/tracker record, not the compliance doc's narrative text, per the authoritative source order. The compliance doc itself is out of scope for `docs/program`/`docs/architecture`-rooted F0 tasks to edit; this drift remains open as R-042. | [RISK_REGISTER.md](RISK_REGISTER.md) R-042 |
| KVKK compliance program's own self-assessment | "**KOŞULLU KONTROLLÜ PİLOT (Conditional Controlled Pilot) — not yet cleared**"; unlimited production use with real patient data "still not recommended" (as of the audit doc's own last full assessment). VERBİS per-clinic decision tree: waiting for legal review. DPA/subprocessor agreement: not yet drafted. | `../compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md` |
| ADRs relevant to launch readiness | ADR-004 (Prisma/PgBouncer), ADR-005 (RLS), ADR-006 (outbox), ADR-007 (queue), ADR-013 (backup/PITR/DR): all `NEEDS_POC` or `DEFERRED` — no implementation authorized. ADR-008 (object storage): `ACCEPTED_WITH_CONDITIONS`, provider/residency decision still external. ADR-012 (observability): `DEFERRED` — no monitoring/alerting inventory exists. | [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md) |
| Production topology | Bare VPS + PM2 (`noramedi-api`, `noramedi-worker`), no `ecosystem.config.*` in-repo, `GET /api/health` (API only, no worker health endpoint), deploy via `scripts/noramedi-deploy.sh` (fail-fast, **no rollback capability**), backup via external cron `pg_dump` (same-host, no offsite copy, PITR `NOT_CONFIGURED`, restore-test `UNVERIFIED`), Node 22.23.1 observed but not pinned in-repo (no `engines`/`.nvmrc`), local disk storage only (S3 vars `MISSING`). | [PRODUCTION_TOPOLOGY.md](PRODUCTION_TOPOLOGY.md), [ENVIRONMENT_MATRIX.md](ENVIRONMENT_MATRIX.md) |
| Test infrastructure | 100 test/verification targets; `server` `npm run test` chains 56/62 `test:*` scripts (6 defined but never invoked); 6 backend `.test.ts` files have **no** package.json script at all; exactly **one** CI workflow exists (`.github/workflows/windows-bridge-pr.yml`), scoped only to `windows-bridge/**`/imaging paths — **68/72 backend test files, 3/6 frontend test files, and 9/9 bridge-agent test files run in zero CI coverage today.** No root `typecheck` script (covered by `build`'s `tsc -b`); `server` has `typecheck` (`npx prisma generate && tsc --noEmit`) but no `lint`; no root-level aggregate `test` script (only per-suite `test:*` + `test:vitest`). | [TEST_OWNERSHIP.md](TEST_OWNERSHIP.md) |

---

## 2. G1 — Controlled Pilot Ready

### Gate ID
`G1` (per [RELEASE_GATES.md](RELEASE_GATES.md); this section is its detailed evidence specification, referenced there rather than duplicated).

### Scope
Operating a small, named set of real clinics (pilot cohort, program-decided count) on production infrastructure, with active human (ChatGPT/user) monitoring, reversible onboarding, and an explicit pilot exit/rollback plan. **Not** self-service or unlimited-clinic onboarding — that is G2.

### Entry criteria
- F0-002, F0-003, F0-004, F0-005, F0-006, F0-007, F0-008 (ADR foundation), F0-011 all `MERGED` — **satisfied** (tracker §6/§7).
- F0-012 (this document) itself reviewed and accepted — **not yet; this document's own task status is `PR_OPENED`** ([PR #183](https://github.com/MustafaBasol/DisKlinikCRM/pull/183), not merged; `mergeable`/`mergeStateStatus` reported `UNKNOWN` as of this correction pass), **per tracker §2.3 an agent cannot self-assign further.**
- No open program-wide architecture-freeze condition that the pilot's own scope would violate (see §3 below — pilot scope must not require any item in [KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md](KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md) §3 or [KVKK_HIGH008_FREEZE_BOUNDARY.md](KVKK_HIGH008_FREEZE_BOUNDARY.md) §3).

### A. Program and governance

| Requirement | Detail |
|---|---|
| Required completed task IDs | F0-001…F0-011 `MERGED`; F0-012 externally reviewed/accepted; F0-013 not required for G1 (F0-013 gates G0, a separate, F0-phase-exit gate — G1 may be evaluated independently of G0 per program direction #17, "controlled pilot gates and general launch gates are separate," but the decision owner may choose to require G0 first — record that choice explicitly in the approval record, §6). |
| Accepted ADR dependencies | ADR-001, ADR-002, ADR-003, ADR-014, ADR-015, ADR-016 (all `ACCEPTED`/`ACCEPTED_WITH_CONDITIONS`) govern the architecture the pilot runs on **as-is** — no ADR marked `NEEDS_POC`/`DEFERRED` (ADR-004/005/006/007/012/013/017) may be treated as a pilot precondition; the pilot runs on the *current*, non-RLS, non-outbox, non-PITR architecture, with those gaps carried as accepted temporary risk (see below), not as blockers requiring the PoC to complete first. |
| Allowed open risks | R-029…R-032 (local storage, no offsite backup, no PITR, restore-test unverified) — **allowed only if** the pilot cohort size and data volume are explicitly bounded and the decision owner accepts the stated RPO/RTO exposure in writing (approval record §6). R-033…R-040 (worker deploy-automation gap, Node version drift, PM2-as-root, etc.) — allowed as documented operational debt, not silently. R-054/R-055 (nullable-tenant RLS-design open question) — allowed, no RLS exists yet regardless. |
| Prohibited open risks | R-046 (KVKK-HIGH-007 migration deployed without independently-verified rollback/tenant-impact evidence) — **must be resolved or explicitly downgraded with evidence before G1**, because the pilot will exercise real patient consent data on this exact schema. R-061 (KVKK-HIGH-008 has no kill switch) — **must have an explicit accept/reject decision recorded** (see §7) before the workflow may be active during the pilot; silence is not acceptance. R-062 (migration-ordering risk between KVKK-HIGH-007 and KVKK-HIGH-008) — **must be resolved by confirming production-application order and both migrations' individual production status** before either touches the pilot's database. |
| Freeze-boundary requirements | [KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md](KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md) §5 conditions 3-5 (production migration confirmed applied, rollback/tenant-impact independently verified, external "KVKK baseline stable" declaration) are **not required to be fully satisfied program-wide** before G1, but **are required specifically for whichever migrations the pilot's own database will carry** — i.e., before the pilot clinics' database receives KVKK-HIGH-007-continuation and KVKK-HIGH-008 migrations, conditions 3-4 must be satisfied *for those two migrations specifically*, with evidence recorded here. §3's 16 broad-refactor freeze items remain in force unconditionally — none of them may be en route during the pilot. |
| External legal or supplier dependencies | Qualified legal counsel must complete a **documented applicability determination** — covering legal registration, notice, DPA/subprocessor, contractual, data-controller/data-processor obligations, and VERBİS applicability specifically — **for each selected pilot clinic, before real patient data is processed for that clinic**. This is a legal-counsel determination, not a technical risk-acceptance decision: the decision owner may accept residual **technical or operational** risk (§7), but **may not waive or override an applicable legal prohibition** identified by counsel. "Time-boxed" may be used **only** for non-blocking follow-up actions that counsel has confirmed do not prohibit the pilot from proceeding (e.g., a registration-evidence filing action after applicability is already determined non-prohibitive) — it may **not** be used to defer an unresolved applicability determination, an unresolved VERBİS registration where counsel has determined registration is required, or an unexecuted DPA where one is legally/contractually required. KVKK compliance program's own self-assessment ("Conditional Controlled Pilot — not yet cleared") is a program-level indicator, not a substitute for the per-clinic counsel determination above, and does not itself authorize proceeding. |
| Decision owner | User (with ChatGPT review), per [RELEASE_GATES.md](RELEASE_GATES.md) G1 row. |
| Evidence owner | Whichever task/agent is assigned the pre-pilot verification pass (not yet assigned — see §8 exact next task guidance). |
| Sign-off requirements | Written approval record (§7 template) signed by the decision owner, dated, referencing the exact commit/PR set and exact clinic list the approval covers. Approval is scoped to that snapshot — any subsequent merge to `main` re-triggers re-evaluation (§5). |

### B. Code and test readiness

| Requirement | Detail |
|---|---|
| Required focused tests | Every backend `.test.ts` file touching consent, communication preference, tenant scoping, security incident, or patient-privacy domains (see [TEST_OWNERSHIP.md](TEST_OWNERSHIP.md) §3.1 domain table) must be run and pass, **including the 6 files with no package.json script** (`aiPrivacyBoundary.test.ts`, `channelConsentGate.test.ts`, `clinicLegalProfile.test.ts`, `patientSharedPhone.test.ts`, `platformBackup.test.ts`, `treatmentPackagePermissions.test.ts`) — these must be run directly via `tsx` (or added to `package.json` first) since `npm run test` does not include them today. |
| Required affected dependency/contract tests | Every test file covering any of F0-004's 9 highest-risk cross-module edges (8/9 currently `NOT_COVERED`, 1/9 `PARTIALLY_COVERED` per [TEST_OWNERSHIP.md](TEST_OWNERSHIP.md) §5) must either already pass or have a documented, accepted gap — G1 may not proceed with an *undocumented* gap on these edges. |
| Required core/security tests | All tenant-isolation/cross-tenant-negative/permission-matrix/auth-regression tests in [TEST_OWNERSHIP.md](TEST_OWNERSHIP.md)'s "Tenant Security and Scope" and "Identity and Access" domains (currently 4+4 tests) must run and pass. `securityIncident.test.ts` (blocked in F0-005 by disposable-Postgres unavailability) must be executed at least once in an isolated environment before G1 — a documentation task cannot substitute for this. |
| When full regression is mandatory | Before the *first* pilot clinic's data migration/onboarding, and before *any* subsequent production deployment during an active pilot that touches Prisma schema, consent/communication/tenant-scoping code, or the deploy script itself. Full regression = `server`'s `npm run test` (56/62 scripts) + the 6 orphaned test files run directly + frontend `test:*`/`test:vitest` scripts + bridge-agent `npm test` (all currently outside CI, per [TEST_OWNERSHIP.md](TEST_OWNERSHIP.md) §7 — running them manually does not retroactively make them CI-gated, but is the minimum substitute until CI coverage exists, an F1 concern). |
| Exact test evidence format | Command invoked (verbatim), exit code, pass/fail/skip count per suite, timestamp, and the commit hash tested — recorded in the pre-pilot evidence file this gate requires (not yet created; see §8). Screenshots or prose summaries alone are insufficient; raw command output must be attached or linked. |
| Pass/fail count requirements | 100% pass on required focused/core/security tests. Zero tolerance for a *new* failure introduced since the F0-005 baseline (2532+ assertions, 1 known deterministic source-drift failure `overdueInstallments.test.ts`, 1 known environment-sensitive failure `clinicBulkExport.test.ts` — both already documented, not new). |
| Flaky or skipped test treatment | Any skip must be individually justified in the evidence file with a reason (env-sensitivity, missing SDK, etc.) — a blanket "some tests skipped" note is not acceptable. Flaky tests (pass/fail non-deterministically across repeated runs) must be re-run at least 3× and the variance recorded; a flaky core-security/tenancy test blocks G1 until stabilized. |
| Frontend build/typecheck requirements | Root `npm run build` (`tsc -b && vite build`) must exit 0 — this is the only mechanism that performs a frontend typecheck (no separate `typecheck` script exists at root; do not invent one). `npm run lint` must exit 0 or have every warning/error triaged. |
| Backend build/typecheck requirements | `npx prisma generate && npm run typecheck` (as defined in `server/package.json`) must exit 0. There is no `server` `lint` script — do not require one that doesn't exist; if lint coverage is desired, that is a separate, out-of-scope task to add the script first. |
| Migration rehearsal requirements | See §D below — migration rehearsal is a distinct dimension from test-suite execution and is required in addition to, not instead of, the above. |

### C. Tenant and security readiness

| Requirement | Detail |
|---|---|
| Tenant scoping | R-001's `PARTIALLY_VERIFIED` application-layer scoping (`clinicScope.ts`/`clinicAccess.ts`, ~40+ call sites) is the **only tenant-isolation layer currently deployed in production**. RLS (ADR-005) and a Prisma tenant guard (ADR-004) are **not implemented** — both remain `NEEDS_POC`. For **G1 only**, this gap may be carried as an explicitly accepted, **time-limited temporary risk** — never as the target architecture — and only if all of the following hold: (1) every existing cross-tenant negative test (row below) passes at the exact commit being evaluated; (2) the pilot cohort is a small, named, bounded set of clinics, not open enrollment; (3) the approval record (§7) names a risk owner, an expiry/review date, and an explicit exit criterion for this specific risk, per §3's temporary-risk governance requirement. This does **not** satisfy ADR-004 (Prisma tenant guard) or ADR-005 (RLS), and carrying it for G1 does not authorize deferring their implementation indefinitely. **G2** requires either an independent security review that affirmatively supports the remaining application-layer-only risk at general-launch scale, or the ADR-004/005 PoC outcome incorporated (§3.C) — this task does not authorize RLS/Prisma-guard implementation itself. Pilot clinics must be informed (at the program/business level, not this document's concern) that isolation is application-layer only. |
| Cross-tenant negative tests | The 13+ existing cross-tenant/cross-clinic rejection test files (per R-001 evidence) must all pass; any of the 6 currently package.json-unwired files that cover cross-tenant behavior must be run manually per §B. |
| Role/permission checks | `treatmentPackagePermissions.test.ts` and other permission-matrix tests (currently package.json-unwired) must be run and pass. |
| Authentication and secret safety | `server/src/index.ts:75-89`'s fail-hard behavior (`process.exit(1)` if `JWT_SECRET`/`PLATFORM_JWT_SECRET`/`CSRF_SECRET`/`ENCRYPTION_KEY` unset or invalid when `NODE_ENV=production`) must be confirmed still present and unmodified at the exact commit being deployed for the pilot (a `git show <commit>:server/src/index.ts` diff-free check, or equivalent). |
| Production secret fail-hard status | Confirmed present (see above) — this is an existing control, not a gap; G1 evidence only needs to reconfirm it was not regressed. |
| Worker/job tenant behavior | `noramedi-worker`'s 9 registered jobs must be confirmed tenant-scoped where applicable (most jobs iterate all tenants by design — e.g. reminders, recall — this is expected, not a violation; but any job that writes cross-tenant data by accident is a blocker). `JobLock` (R-034's mitigating control) must be confirmed functioning (no duplicate-run evidence) if `RUN_BACKGROUND_JOBS` is ever set inconsistently between `noramedi-api` and `noramedi-worker` — production's actual value for this flag is currently unverified (ENVIRONMENT_MATRIX.md §1) and **must be confirmed** before G1. |
| Audit records | `AuditLog`/`ActivityLog` (existing, `MERGED`) and the new consent-specific audit logging (`communicationConsentAuditLogging.ts`, merged via PR #175) must both be confirmed writing records during a pilot-representative smoke test — not merely present in code. |
| Feature flag and kill-switch expectations | See §G below — this is a first-class, separate dimension per this task's brief, not folded into this row. |
| Sensitive workflow activation control | KVKK-HIGH-007's three flags (`COMMUNICATION_CONSENT_ENFORCEMENT_ENABLED`, `_MODE`, `COMMUNICATION_CONSENT_LEGACY_RECONCILIATION_ENABLED`) must have an explicit, recorded decision for what value they run at during the pilot (currently all default-disabled/audit-mode) — running the pilot in audit-only mode is acceptable **if explicitly chosen**, not by default inaction. |
| Production log redaction | No dedicated PII/PHI log-redaction policy exists yet (R-018 `UNVERIFIED`, ADR-012 `DEFERRED`). G1 must record this as an accepted risk for a small, monitored pilot cohort — it is not acceptable to carry into G2 unaddressed (see G2 below). |
| Privacy/KVKK regression | Full consent/communication-preference test suite (per §B) plus a manual review confirming no pilot-clinic-specific data was used to develop/test the merged KVKK-HIGH-007/008 code (per their own non-authorization/read-only-review statements). |

### D. Database and migration readiness

| Requirement | Detail |
|---|---|
| Migration chain verification | **Reported performed** by KVKK-HIGH-008-PMVR Phase B1 ([PR #185](https://github.com/MustafaBasol/DisKlinikCRM/pull/185), author-reported, not yet independently re-verified by this document): PR #175 and PR #180's migrations independently rehearsed against disposable PostgreSQL 16.14; clean database 64/64 migrations applied. This reduces (does not eliminate) the "not yet performed" gap — the state distinction in §0 ("Tests reportedly passed (author-run)" vs. "independently verified") still applies; G1 evidence collection must independently confirm this before treating it as closed. |
| Disposable PostgreSQL upgrade rehearsal | **Reported performed** (PR #185): previous-schema upgrade scenarios passed against disposable PostgreSQL 16.14, both migrations applying without error; 483 assertions across 19 commands completed with zero KVKK-HIGH-008/#175/#180-attributable failures, including independently reproduced cross-org/cross-clinic negative scenarios. Author-reported, not yet independently re-verified — same distinction as above. This reduces migration-ordering *schema-level* uncertainty; it does **not** by itself prove production application order (see R-062, "Production migration status evidence" row below). |
| Clean-database migration rehearsal | **Reported performed** (PR #185): `npx prisma migrate deploy` from zero through the full chain reported succeeding (64/64), author-reported pending independent re-verification. |
| Previous-release-to-current upgrade rehearsal | **Reported performed** (PR #185): forward application through PR #175 and PR #180's migrations in a disposable environment reported confirming order and idempotency at the *schema* level, author-reported pending independent re-verification — this is distinct from, and does not establish, the *production* application order R-062 tracks. |
| Backfill status | KVKK-HIGH-007's backfill (`backfillCommunicationPreferences.ts` / `legacyReconciliationResolver.ts` gated by `COMMUNICATION_CONSENT_LEGACY_RECONCILIATION_ENABLED`) — confirmed **not executed** in production (compliance doc 2026-07-19 row). Must run in a disposable/dry-run mode first, with output reviewed, before any production run considered for pilot clinics. |
| Enforcement/reconciliation flag status | All three flags confirmed default-`false`/`audit` in the merged code. G1 requires an explicit, recorded decision on what value they run at for the pilot (see §C) — not a requirement that they be enabled. |
| Rollback/cutback method | **None exists today** for `scripts/noramedi-deploy.sh` (fail-fast, not transactional, per [PRODUCTION_TOPOLOGY.md](PRODUCTION_TOPOLOGY.md)). For G1, at minimum a manual, documented rollback runbook (which migration(s) to reverse, `pm2 reload` to which prior commit, order of operations) must exist and be rehearsed once in a disposable environment before the pilot's first production migration. An automated rollback mechanism is **not** required for G1 (it is a reasonable G2/F3 requirement — see below) but its absence must be an explicit accepted risk, not silent. **Rollback-tier distinction (PMVR, PR #185):** application-level cutback (redeploying the prior code version) is expected to be backward-compatible because the migrations are purely additive. Schema-level rollback (dropping the new tables/columns) is data-loss-free **only while those new tables remain empty** — once any `PatientLegacyConsentCorrection`/consent-conflict record actually exists, dropping the new tables would destroy that KVKK evidence and is **not** an acceptable default rollback; the runbook must treat schema-drop as a last-resort, explicitly-decided action, not the default rollback step, once real rows exist. |
| Migration duration and lock-risk evidence | PR #175/#180's migrations must each be reviewed for lock duration/blocking-DDL risk (e.g., `ALTER TABLE ADD COLUMN` with a default on a large table) against the *pilot's actual expected table sizes* — small pilot cohorts likely make this low-risk, but the review itself, not the assumption, is the required evidence. |
| Tenant-impact verification | Confirm both migrations are additive-only and do not alter existing tenant-scoped columns' semantics (per read-only review already performed by F0-011-P1 for KVKK-HIGH-008 — that review is evidence *of narrowness*, not evidence of *production rollback safety*, which remains a separate, unmet requirement per R-046). **Reported (PR #185, author-reported, not independently re-verified):** cross-org and cross-clinic negative scenarios independently reproduced in the disposable rehearsal — this strengthens, but does not by itself close, R-046's production rollback/tenant-impact requirement. |
| Production migration status evidence | **Updated 2026-07-20 (`origin/main` @ `cf12b05e9a65730e39b0aa667469e312fade5cc8`, PR #184):** both PR #175's and PR #180's migrations are now **confirmed applied to production** (64/64 migrations present, `prisma migrate status` clean, user-supplied read-only production evidence). This resolves the "neither confirmed" gap this row previously recorded and the *ordering-uncertainty* component of R-062. **It does not resolve R-046/R-062's rollback/tenant-impact-verification component**, which remains the concrete G1 blocker — production migration application alone is not sufficient evidence that either migration is safe to roll back or is tenant-isolation-safe. Disposable-environment rehearsal evidence (PR #185) corroborates the migrations apply cleanly at the schema level but is likewise not a substitute for rollback/tenant-impact evidence. |
| Migration applied vs. migration present distinction | Explicitly: "migration file exists in `main`" ≠ "migration applied to the production database." Evidence for the latter requires a read-only production query (e.g., `SELECT * FROM "_prisma_migrations" WHERE migration_name IN (...)`, same pattern as F0-002 Stage B) — **this has now been performed** (2026-07-20 reconciliation pass, `cf12b05`) for both migrations. **R-062's ordering-uncertainty component is resolved by this evidence; its rollback/tenant-impact component remains `OPEN`** — do not read "migration applied" as "safe to roll back" or "tenant-isolation verified." |
| **PR #175 / PR #180 explicit incorporation** | Both are `MERGED` repository facts, and both migrations are now **confirmed applied to production** (2026-07-20, `cf12b05`/PR #184). Deployment/feature-activation reachability confirmed for KVKK-HIGH-008 (§1 above); PR #180 still has no kill-switch by design (R-061). Production verification (rollback/tenant-impact) has **not** been performed for either migration. R-046 (rollback/tenant-impact unconfirmed) and R-062 (now: production-application confirmed, rollback/tenant-impact unconfirmed) apply directly to any pilot-clinic database that receives these migrations. **G1 requires both R-046 and R-062 to move from `OPEN` to at least `MITIGATED` (with cited rollback/tenant-impact evidence) before the pilot's first clinic onboarding** — "applied to production" and "rehearsed in a disposable environment" (PR #185) are each a contribution toward this, not a substitute for it. |

### E. Storage, backup, and restore readiness

| Requirement | Blocker / Accepted temporary risk / Mandatory production evidence for G1 |
|---|---|
| Local/S3 dual-mode storage abstraction exists (`fileStorage.ts`) | Accepted as-is — code capability, not a gate item itself. |
| Production currently believed `LOCAL_VPS_STORAGE` | **Mandatory production evidence**: reconfirm via the same read-only method as F0-011 (env var presence check) immediately before pilot go-live — must not have silently drifted. |
| S3 capability ≠ proof of production S3 use | Restated as a standing rule — no future task may claim S3-in-production without a fresh env-var/behavior check. |
| Migration must be expand-migrate-contract if ever performed | **Not applicable to G1** — no storage-key migration is planned or authorized for the pilot; local storage continues unchanged. This row exists to record that if a migration is later proposed *during* an active pilot, it must follow F0-011's 13-stage design, not an ad hoc approach. |
| DB authorization precedes storage-key access | Existing `fileStorage.ts` behavior — reconfirm unchanged at the pilot's deployed commit (no code change expected; regression check only). |
| No default bucket-per-clinic | Not applicable — no bucket exists. Recorded so a future G2/F4 decision does not silently default to it. |
| No custom PACS implementation | Not applicable to G1 pilot scope (no imaging-AI/DICOM feature is part of this pilot's scope unless explicitly stated by the decision owner — if it is, G4, not G1/G2, governs it). |
| No unapproved lossy compression of diagnostic originals | Same as above — not applicable unless imaging is explicitly in pilot scope. |
| Backup/restore design exists but not implemented | **Accepted temporary risk for G1**, conditioned on: (a) pilot cohort size and data volume are explicitly bounded (small number of named clinics), (b) the decision owner explicitly accepts the current ~11-hour observed backup-interval RPO exposure and unverified restore capability in the approval record (§7), (c) at least one restore-test *is* rehearsed against a disposable environment (see F0-011's 35-experiment test matrix, Experiments 25-27) before the pilot's first clinic goes live — this is the one item promoted from "design" to "mandatory rehearsal" for G1, because a pilot without any restore rehearsal ever performed is an unacceptable RTO gap even at small scale. |
| PITR | **Accepted temporary risk for G1 only** (R-031), bounded strictly to a small, named, monitored controlled-pilot cohort — not a standing exemption. The approval record (§7) must name a risk owner, the maximum accepted RPO (currently the ~11-hour observed backup-interval, unless the decision owner sets a different figure), an expiry/review date, and an exit criterion, per §3's governance requirement. A successful disposable-environment restore rehearsal (see below) is mandatory before the pilot's first clinic go-live, independent of PITR's own accepted-risk status. **Mandatory, unconditionally, before G2** (§3.E) — this is not deferred to a future clinic-count or data-value threshold. |
| Off-site backup | **Accepted temporary risk for G1 only** (R-030), under the same named-risk-owner/expiry/exit-criterion governance as PITR above, bounded to the small, monitored pilot cohort. **Mandatory, unconditionally, before G2** (§3.E) — not deferred to a clinic-count or data-value threshold. |
| File-tree (attachment/imaging) backup | **Accepted temporary risk for G1 only**, evaluated explicitly per pilot clinic (not accepted blanket) and subject to the same governance fields (§3) if the pilot clinics' expected attachment/imaging volume is low and loss would be recoverable/re-obtainable. **Mandatory before G2** (§3.E) for any clinic (pilot or pre-launch) with accumulated attachment/imaging data — not deferred to an undefined future threshold. |
| Restore-test evidence | **Mandatory for G1** — see above (promoted from design to rehearsal requirement, not a blanket accepted risk, precisely because it is cheap to rehearse once and the cost of skipping it is unbounded). |

### F. Operations and deployment readiness

| Requirement | Detail |
|---|---|
| Exact deployed commit | Must be recorded at pilot go-live time via the same read-only method as F0-002 Stage B (`git log -1` on the production checkout, or equivalent) — not assumed to equal `origin/main`'s latest without verification, since deploy is a separate, manual step (`scripts/noramedi-deploy.sh` is not auto-triggered by merge). |
| Actual production topology | Reconfirm bare-VPS + PM2 + host Nginx unchanged (no drift to the stale Docker-Compose runbook, R-039) immediately before go-live. |
| PM2 process inventory | Both `noramedi-api` and `noramedi-worker` confirmed `online`, restart counts reviewed for anomalies (R-037) at go-live time — not merely "were online at some point during F0-002/F0-006." |
| Worker process status | Same as above; additionally confirm `RUN_BACKGROUND_JOBS`'s actual production value (currently unverified per ENVIRONMENT_MATRIX.md — **must be confirmed before G1**, since it directly affects whether jobs double-register per R-034). |
| Repository path | Confirm `/var/www/noramedi` still matches; do not assume the prompt-supplied hypothesis without a fresh check. |
| Database identity | Confirm `noramedi_crm` (or actual current name) via read-only query, not assumption. |
| Migration history | Per §D — read-only production query of `_prisma_migrations`. |
| Health endpoint | `GET /api/health` confirmed `200` immediately before and after go-live. **Gap**: the worker has no health endpoint — G1 must accept PM2 "online" status as the only worker liveness signal, or add a lightweight worker health check before go-live (recommended, not mandated — record the choice). |
| Logs | Confirm log output exists and is reviewable for the pilot period (even absent formal redaction/aggregation, per ADR-012 `DEFERRED`) — silence here is not acceptable; "some logging exists" must be evidenced, not assumed. |
| Smoke tests | A pilot-specific smoke-test script/checklist (login, create patient, book appointment, send a WhatsApp/SMS message respecting consent, view/export data) must be executed and recorded immediately after go-live and after any subsequent deploy during the pilot. Not yet defined — creating it is in-scope pre-pilot work, not this document's job to author the script itself. |
| Rollback command/runbook | Per §D — manual runbook required, rehearsed once, before G1. |
| Backup freshness | Confirm most recent backup is within the observed ~11-hour interval immediately before go-live; do not accept a stale backup as current. |
| Restore evidence | Per §E — rehearsed once before G1. |
| Monitoring/alert evidence | **Gap, accepted for G1**: no monitoring/alerting stack exists (ADR-012 `DEFERRED`). For a small, actively-watched pilot this may be substituted by manual/human monitoring (the decision owner or designated evidence owner checking health/logs on a defined cadence) — this substitution must be explicit in the approval record, not silently assumed. **This gap escalates to mandatory tooling before G2** (see below). |

### G. Feature activation readiness

Explicit gate progression required for every high-risk workflow (privacy, consent, enforcement, retention, deletion, AI, messaging, integrations) before it may be considered active for pilot clinics:

```
code merged → migration applied (production-confirmed) → feature disabled (default state)
  → internal activation (staff-only / non-patient-facing verification)
  → pilot activation (named pilot clinics, explicitly enabled, monitored)
  → general availability (G2 scope — not evaluated here)
```

| Workflow | Current stage | Requires before pilot activation |
|---|---|---|
| KVKK-HIGH-007 consent enforcement (`COMMUNICATION_CONSENT_ENFORCEMENT_ENABLED`) | Merged, migration present, flag `false`/`audit` | Explicit decision to move to `audit` (recommended default for pilot) or `enforce` — either is acceptable **if recorded**, not by default. |
| KVKK-HIGH-007 legacy reconciliation (`COMMUNICATION_CONSENT_LEGACY_RECONCILIATION_ENABLED`) | Merged, flag `false`, backfill not run | Requires a dry-run backfill review (§D) before any pilot clinic has the flag enabled. |
| KVKK-HIGH-008 legacy consent correction | **[Updated 2026-07-20, F0-011-P3]** A kill-switch now exists and is deployed: PR #186 (`privacy.legacyConsentCorrection.runtimeEnabled`, default-disabled `PlatformSetting` gate) merged and, as of deployed HEAD `85e3ffbca7ee1b53789564e16c5e58c5ec498cf2` (PR #187), confirmed deployed to production — migration `20260720180000_add_platform_admin_audit_event` applied/schema-verified, the setting row **absent** (effective `false` via fail-closed default), `PlatformAdminAuditEvent` `0` rows. This is a **state observation**, not a live test of the mutation endpoint's `403`/audit-on-attempt behavior against production. Deployment/table/row evidence per §6/§7 of `KVKK_HIGH008_FREEZE_BOUNDARY.md` — the workflow's routes remain reachable to authorized roles (OWNER/ORG_ADMIN/CLINIC_MANAGER, manual authenticated API/UI action) and no automatic startup/cron/job/worker/UI invocation path was found by PMVR. Whether the workflow has actually been *used* by an authorized user remains unverified; 0 rows across both the correction and audit tables is consistent with, but does not prove, zero invocations. Do not state or imply automatic activation on deployment. | **The kill-switch itself is no longer missing, but this row is not reduced to a single remaining item.** Two distinct things are still required before pilot activation: (1) a production-safe behavioral verification of the gate — authenticated disabled mutation-route fail-closed behavior, the expected production response/status while disabled, authorized read/history-endpoint behavior while disabled, a successful `PlatformSetting` PATCH creating a `PlatformAdminAuditEvent` row with real actor attribution and previous/new values, absence of a `SecuritySignalEvent` during an actual toggle, and absence of PII/PHI/secrets in an actual audit row — none of which have been exercised against production (see `RISK_REGISTER.md` R-061); and (2) the explicit controlled-activation decision itself: the decision owner must explicitly record, in writing (§7), who may PATCH the setting to `true`, under what governance/monitoring, and for which pilot clinics — the flag remaining `false` by default does not itself satisfy this row. Both remain **outstanding** — see `RISK_REGISTER.md` R-061 (remains `OPEN`). |
| Any future AI/messaging/integration feature | Not in current pilot scope unless explicitly named | If added to pilot scope, this table must be extended with that workflow's own row before it activates. |

### H. External and legal readiness

| Item | Status | G1 requirement |
|---|---|---|
| KVKK legal review | Per-item, ongoing (compliance doc §2/§3) — several items still "waiting for legal review" | Qualified legal counsel must complete a documented applicability/compliance determination — registration, notice, DPA/subprocessor, contractual, and data-controller/data-processor obligations — **for each specific pilot clinic**, before real patient data is processed for that clinic. Only non-blocking follow-up actions counsel has confirmed do not prohibit the pilot may be time-boxed; an unresolved applicability determination itself may not be. |
| VERBİS | Per-clinic decision tree, waiting for legal review | VERBİS registration is **not** universally mandatory for every clinic. The required artifact is a documented VERBİS applicability determination made by qualified legal counsel for each pilot clinic, and, where counsel determines registration is required, evidence of registration (or an in-progress registration counsel has confirmed does not itself prohibit the pilot) before real patient data is processed. |
| Subprocessor/DPA review | Platform↔clinic processor agreement not yet drafted | A DPA/data-processing agreement must be **executed** for each pilot clinic, before its data is processed, wherever legally or contractually required — this is a legal/contractual artifact this document cannot itself verify, only require citation of (signed document reference) in the approval record. Where counsel determines a DPA is not legally/contractually required for a given clinic, that determination itself must be recorded. |
| Official registrations | Not evaluated in this document's scope (no official-integration feature is part of typical pilot scope; if added, G5 governs). | N/A unless scope expands. |
| Supplier/storage residency confirmation | Not applicable — no external storage supplier selected (local VPS only). | N/A for G1. |
| Clinical validation | Not applicable unless an AI/imaging feature is explicitly in pilot scope (G4 territory). | N/A unless scope expands. |
| Contractual SLA commitments | Not evaluated here — a business/legal artifact. | Must be recorded as existing or explicitly waived for pilot clinics in the approval record. |

**The system must not be labeled legally compliant based solely on satisfying the technical items (§§A-G) above.** Technical readiness and legal/external readiness are tracked and signed off separately (§7 approval record has distinct signature lines for each). **Technical or operational risk acceptance by the decision owner never waives, substitutes for, or overrides an applicable legal obligation or prohibition determined by qualified counsel** — §7's "Decision owner final approval" line covers technical/operational residual risk only, not legal sufficiency.

### Blockers (G1 must not proceed while any of these remain unresolved)
1. R-046 unresolved (KVKK-HIGH-007 continuation migration deployed without independently-verified rollback/tenant-impact evidence).
2. R-062 unresolved (migration-ordering risk between the two KVKK-consent-adjacent migrations, relative to each one's own unconfirmed production-application status).
3. R-061 unresolved — **[Updated 2026-07-20, F0-011-P3]: the "no-kill-switch design" framing is corrected, not the risk itself.** The kill switch (PR #186) is now merged, deployed, and confirmed disabled by fail-closed default in production, but this blocker is not reduced to the activation decision alone: authenticated disabled mutation-route behavior, authorized read/history behavior while disabled, and a successful platform-admin audit creation/attribution cycle remain unverified against production, in addition to the still-unresolved explicit human decision on who may activate the gate and under what governance.
4. No production migration-application evidence for either PR #175 or PR #180's migration, if either workflow is to be active for pilot clinics.
5. No restore-test rehearsal ever performed (§E).
6. No manual rollback runbook rehearsed at least once (§D/§F).
7. Legal/VERBİS/DPA items unresolved *for the specific pilot clinics chosen* (§H).

### Accepted temporary risks (may proceed only with the governance record below, per item — not silently, and never open-ended)

A **temporary risk** is not valid for G1 unless the approval record (§7) documents, for **each** item, all of the following fields:

1. Risk ID (cross-referenced to [RISK_REGISTER.md](RISK_REGISTER.md))
2. Named risk owner (a person, not a role/team placeholder)
3. Rationale (why this specific gap is acceptable for this specific pilot)
4. Exact scope / named pilot cohort the acceptance is bounded to
5. Maximum accepted impact — and RPO/RTO specifically, where applicable
6. Mitigation currently in place
7. Expiry or mandatory review date (a concrete date, not "future"/"later")
8. Exit criterion (what closes or downgrades this risk)
9. Re-evaluation trigger(s) that void it early (§5)
10. Explicit sign-off (name + date)

A permanent or open-ended "accepted temporary risk" is **not valid** — every item below requires its own bounded expiry/review date; listing an item here is not itself acceptance.

Candidate items requiring this governance record: R-029 (local storage), R-030 (no offsite backup, conditioned on §E), R-031 (no PITR, conditioned on §E), R-033…R-040 (operational debt), R-054/R-055 (RLS/Prisma-guard design open question — see §C "Tenant scoping"), the CI-coverage gap (manual test execution substitutes until F1 exists), the monitoring/alerting gap (manual monitoring substitutes for a small pilot).

### External dependencies
KVKK legal counsel sign-off (per pilot clinic), VERBİS determination (per pilot clinic), signed DPA/subprocessor agreement (per pilot clinic), decision owner's explicit risk acceptance for §E/§F gaps.

### Decision authority
User, with ChatGPT review (matches [RELEASE_GATES.md](RELEASE_GATES.md) G1 row). No agent may self-approve.

---

## 3. G2 — General Commercial Launch Ready

### Gate ID
`G2` (per [RELEASE_GATES.md](RELEASE_GATES.md)).

### Scope
Uncontrolled-count, self-service clinic onboarding. Everything accepted as a *temporary* risk for G1 in §2 either becomes mandatory here or requires a distinct, separately-justified acceptance — **G1 passing does not imply G2 passes; each dimension below is evaluated independently, not inherited.**

### A. Program and governance
Same required task IDs as G1, **plus**: F0-013 (F0 consolidated validation report) `MERGED` and G0 externally approved (general launch should not proceed while the foundational architecture-validation gate itself remains `NOT_APPROVED`). All G1 blockers (§2 "Blockers") must be at `MITIGATED` or `CLOSED` with evidence, not merely accepted-as-temporary. Prohibited open risks: everything listed as prohibited for G1, **plus** R-029…R-032 must each be `MITIGATED` (not merely `OPEN`-but-accepted) — general launch removes the "small, bounded, monitored" framing that justified accepting them for G1.

### B. Code and test readiness
Everything required for G1, **plus**:
- CI coverage gap (currently 1 workflow, scoped to `windows-bridge/**` only) must be closed — an F1-CI-architecture-equivalent outcome (affected-test selection running in CI on every PR touching backend/frontend code) is required before general launch, not merely "tests exist and were run manually once." This does not require F1 to be fully built exactly as scoped; it requires *some* CI gate broader than the current one.
- Release regression scope (per [RELEASE_GATES.md](RELEASE_GATES.md) G2 row: "Release regresyon kapsamı + E2E geçer") — full suite (all 100 targets, not a focused subset) must pass, evidenced with exact command/exit-code/count per §2.B format.
- The 6 currently package.json-unwired test files must be wired into `server`'s `test` script (or an equivalent aggregate) — relying on manual invocation is acceptable for a bounded pilot, not for ongoing general-launch operation.

### C. Tenant and security readiness
Everything required for G1, **plus**:
- Independent (non-author) security review of tenant-isolation controls — R-001's application-layer-only scoping, still without RLS, must have either (a) an independent security review confirming acceptable risk at general-launch scale, or (b) RLS/PgBouncer PoC (ADR-004/005) executed and its outcome incorporated — this document does **not** authorize RLS/PgBouncer implementation; it only records that general launch is the point at which the PoC's absence becomes a governance question, not a G1-scale-acceptable gap.
- Production log redaction (R-018) must move from `UNVERIFIED` to an implemented, evidenced PII/PHI-safe logging policy — no longer acceptable as an open gap at general-launch scale.
- Entitlement enforcement (R-025) must be confirmed backend/service/job-layer enforced, not frontend-only, across all commercial-gated modules — self-service onboarding directly exercises entitlement boundaries in a way a small manual pilot does not.

### D. Database and migration readiness
Everything required for G1, **plus**:
- Both PR #175 and PR #180's migrations (and any migration merged between G1 and G2 evaluation) must show `PRODUCTION_VERIFIED`-grade evidence of successful application, not merely "rehearsed in disposable environment."
- An automated (or at minimum, fully-scripted single-command) rollback mechanism must exist for `scripts/noramedi-deploy.sh` — the manual runbook accepted for G1 is not sufficient once onboarding volume removes the "small, monitored" safety margin.
- Migration duration/lock-risk evidence must be gathered against **actual, not pilot-scale**, table sizes before general launch, given self-service onboarding can grow tables faster than a bounded pilot.

### E. Storage, backup, and restore readiness
Everything accepted as temporary for G1 becomes **mandatory**:
- Off-site backup copy: **mandatory**, evidenced (R-030 must be `MITIGATED`).
- PITR: **mandatory**, evidenced (R-031 must be `MITIGATED`) — `archive_mode` must be confirmed `on` with WAL archiving verified functioning, not merely configured.
- File-tree (attachment/imaging) backup: **mandatory** for any pilot or pre-launch clinic that has accumulated attachment/imaging data — no longer clinic-by-clinic accepted risk, and not deferred to a subjective volume/value threshold.
- Restore-test evidence: **mandatory, recurring** (not one-time) — a scheduled, evidence-producing restore-test job/runbook must exist and have at least one successful scheduled (not merely ad hoc) execution on record.
- Object-storage migration itself (F0-011's 13-stage design) is **not required** to be executed before G2 purely on relevance grounds — local storage can, in principle, scale further — but the *backup/PITR/restore* gaps above are independent of storage location and are required regardless of whether object storage migration happens.

### F. Operations and deployment readiness
Everything required for G1, **plus**:
- Monitoring/alerting: **mandatory**, evidenced (ADR-012 must move off `DEFERRED` with an implemented, not merely designed, log/metric/alert baseline) — manual human monitoring, acceptable for G1, is not a substitute at general-launch scale/volume.
- Node version pinning: `engines` field or `.nvmrc` must be added and CI/production alignment confirmed (currently CI pins Node 20, production runs 22.23.1, with zero enforcement — R-035) — general launch should not run on an unpinned, drifted runtime.
- Worker deploy automation gap (R-033) must be closed — `scripts/noramedi-deploy.sh` must cover `noramedi-worker`, not `noramedi-api` alone.
- PM2-as-root (R-036) should be resolved or explicitly risk-accepted by the decision owner at general-launch scale (an operational hardening item, F3-scoped — recorded here as a G2 gate item, not silently deferred).

### G. Feature activation readiness
Everything in §2.G, **plus**: general availability requires each high-risk workflow to have completed a monitored pilot-activation period (§2.G's third stage) with no unresolved incident before moving to the fourth stage (general availability) — this document does not pre-approve that transition for any specific workflow; each is evaluated on its own pilot outcome.

### H. External and legal readiness
Everything in §2.H, **plus**: KVKK compliance program's own self-assessment must have moved off "Conditional Controlled Pilot — not yet cleared" as a whole-platform statement (not just per-pilot-clinic) before self-service onboarding is offered generally, since general launch by definition removes the ability to vet each clinic individually before onboarding. Contractual SLA/DPA templates (not per-clinic bespoke agreements) must exist for self-service sign-up flows.

### Blockers
Every G1 blocker, plus: R-029/R-030/R-031/R-032 not yet `MITIGATED`; CI coverage gap not closed; monitoring/alerting gap not closed; automated rollback not implemented; Node version not pinned; KVKK compliance self-assessment still "Conditional Controlled Pilot."

### Accepted temporary risks
Materially fewer than G1 — most G1-accepted risks graduate to mandatory here. Only genuinely scale-independent, low-severity items (e.g., R-039 stale Docker runbook doc, R-038 frontend-artifact-hash verification) may remain accepted-temporary, each individually justified.

### External dependencies
Everything in §2, generalized to the full clinic base rather than a named pilot cohort; standardized (not per-clinic-bespoke) contractual/DPA templates.

### Decision authority
User (per [RELEASE_GATES.md](RELEASE_GATES.md) G2 row: "Kullanıcı"). No agent may self-approve.

---

## 4. Result states

Both `G1` and `G2` use the same five-state model, matching this task's required format (a superset of [RELEASE_GATES.md](RELEASE_GATES.md)'s existing `NOT_APPROVED`/binary model — this document's richer model does not contradict that file; see §7 cross-reference):

| State | Meaning |
|---|---|
| `NOT_EVALUATED` | No formal evaluation against this document's criteria has occurred yet. **Both G1 and G2 start here and remain here as of this document's authoring.** |
| `BLOCKED` | Evaluated; one or more items in the gate's "Blockers" list is unresolved. |
| `CONDITIONALLY_APPROVED` | Evaluated; all blockers resolved; one or more items remain in "Accepted temporary risks" with explicit, recorded sign-off. Requires re-evaluation triggers (§5) to be monitored. |
| `APPROVED` | Evaluated; all blockers resolved; no unresolved accepted-risk items remain outstanding beyond what the decision owner has explicitly and permanently accepted as standing operating risk (rare — most accepted risks are temporary by nature). |
| `REVOKED` | Previously `CONDITIONALLY_APPROVED`/`APPROVED`, but a re-evaluation trigger (§5) fired and the gate no longer meets its criteria — approval is void until re-evaluated. |

**Current state: `G1 = NOT_EVALUATED`, `G2 = NOT_EVALUATED`.** This document does not change either state — it defines what evaluation must check.

## 5. Re-evaluation triggers

Either gate's approval (once granted) is automatically void (moves to `REVOKED`, pending re-evaluation) upon any of:
- A new merge to `main` touching Prisma schema, migrations, consent/communication/tenant-scoping code, the deploy script, or any file the approval's evidence record cited.
- Any production incident affecting the areas covered by §§C/D/E/F.
- Any change to KVKK-HIGH-007/008 flag defaults in production.
- Passage of a decision-owner-set time interval since the last evidence collection (recommended: no longer than 30 days for `CONDITIONALLY_APPROVED` states, given how fast this program's own evidence has been shown to go stale — see the repeated self-reference-lag pattern documented throughout [NORAMEDI_MASTER_TRACKER.md](NORAMEDI_MASTER_TRACKER.md)).
- Any expansion of pilot scope (more clinics, new high-risk workflow added) beyond what the approval record explicitly named.

## 6. Evidence links

All evidence cited in §§1-3 is linked inline at first use. No new evidence is created by this document — it is a specification of what must be collected, not a collection of it. The pre-pilot/pre-launch evidence-collection task (§8) is expected to produce a companion evidence file (e.g. `evidence/F0-012_<gate>_EVIDENCE.md`, following this program's established naming convention) the first time either gate is actually evaluated.

## 7. Approval record template

```
GATE: [G1 | G2]
Evaluation date:
Evaluator (evidence owner):
Repository commit evaluated (origin/main HEAD):
Exact pilot clinic list (G1 only) / launch scope (G2):

Section A (Program/governance):      [BLOCKED | CONDITIONAL | SATISFIED] — notes:
Section B (Code/test):                [BLOCKED | CONDITIONAL | SATISFIED] — notes:
Section C (Tenant/security):          [BLOCKED | CONDITIONAL | SATISFIED] — notes:
Section D (Database/migration):       [BLOCKED | CONDITIONAL | SATISFIED] — notes:
Section E (Storage/backup/restore):   [BLOCKED | CONDITIONAL | SATISFIED] — notes:
Section F (Operations/deployment):    [BLOCKED | CONDITIONAL | SATISFIED] — notes:
Section G (Feature activation):       [BLOCKED | CONDITIONAL | SATISFIED] — notes:
Section H (External/legal):           [BLOCKED | CONDITIONAL | SATISFIED] — notes: [SIGNED OFF SEPARATELY by qualified legal counsel — the decision owner's technical/operational risk acceptance below does not substitute for or override this section]

Accepted temporary risks (G1 only — EVERY item requires ALL fields below; a permanent/open-ended acceptance is not valid; see §2 "Accepted temporary risks"):
1. Risk ID:
   Named risk owner:
   Rationale:
   Exact scope / named pilot cohort:
   Maximum accepted impact / RPO / RTO (if applicable):
   Mitigation currently in place:
   Expiry / mandatory review date:
   Exit criterion:
   Re-evaluation trigger (see §5):
   Sign-off: ______________________  Date: ______

Unresolved blockers (must be empty for CONDITIONAL/APPROVED):
1. ...

RESULT: [NOT_EVALUATED | BLOCKED | CONDITIONALLY_APPROVED | APPROVED | REVOKED]

Technical readiness sign-off:        ______________________  Date: ______
Legal/compliance readiness sign-off: ______________________  Date: ______
Decision owner final approval:       ______________________  Date: ______

This approval is void upon any re-evaluation trigger in LAUNCH_GATES.md §5.
```

## 8. Exact next task after this evidence definition

This document (F0-012) defines evidence requirements; it does not collect the evidence. Per [NORAMEDI_MASTER_TRACKER.md §13](NORAMEDI_MASTER_TRACKER.md#13-exact-next-task-kesin-sonraki-görev), the next KVKK-specific action already identified is a dedicated **KVKK-HIGH-008 post-merge deployment-readiness and production-migration verification task** (independent test evidence review, migration ordering, rollback, tenant impact, kill-switch/activation-control decision, production verification requirements) — this task directly produces much of §2's Section D/G evidence and should be sequenced before any G1 evaluation attempt. Separately, **F0-013** (F0 consolidated architecture validation report) remains blocked until F0-002…F0-012 all complete; F0-012 (this document) being externally reviewed and merged is one of its remaining preconditions.

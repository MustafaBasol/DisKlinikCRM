# PILOT_PRODUCTION_READINESS_EVIDENCE

**Task ID:** PILOT-PROD-READINESS-001
**Type:** Read-only production and repository verification
**Worktree:** `D:\Mustafa\Siteler\DisKlinikCRM-worktrees\pilot-production-readiness`
**Branch:** `audit/pilot-production-readiness` (base: `origin/main`)
**Evidence-gathering date:** 2026-07-22

## 0. Scope correction — no production access was performed

The task brief called for direct, read-only production verification (SSH into `noramedi-vps`, run `pm2 list`, query the database, inspect backups, tail logs, etc.).

This could not be carried out: the configured SSH key (`~/.ssh/noramedi_vps`, host alias `noramedi-vps` → `185.210.92.141:2210`, user `root`) is **passphrase-protected**, and the passphrase was not available to this session. Attempting to unlock it, prompt for it, or otherwise obtain production access was explicitly declined by the user, who directed this task to a **repository-only** readiness check instead, plus preparation of a **separate operator command package** for the user to run manually.

**Consequence:** every item below that requires a live production observation is classified `UNVERIFIED — requires operator-run production command evidence`, regardless of what prior evidence documents in this repository claim about production's past state. Prior-evidence claims are cited for context (with their own date), never presented as current fact.

**No production access of any kind occurred in this task.** No SSH connection was established (the one connection attempt failed with `Permission denied (publickey)` before any command executed on the remote host). No command was run against `185.210.92.141`. No secret, credential, or passphrase was requested, printed, or used.

**Precise record of the failed SSH attempt (for the audit trail):**
- Authentication failed (`Permission denied (publickey)`) **before** any remote command execution — the SSH handshake completed key exchange and offered the configured key, the server accepted the key's fingerprint as a candidate, but signature/authentication itself failed (locked private key, batch mode, no passphrase available).
- **No production command ran** as a result — the session never reached a remote shell.
- **No production state changed** — there is nothing a failed authentication attempt could have altered on the remote host.
- **Further SSH attempts are not authorized** by this task. Any future production access requires either an unlocked key or a decision-owner-supplied passphrase, obtained through a separate, explicit authorization — not attempted, requested, or implied here.

---

## 1. Repository baseline

| Item | Value |
|---|---|
| Worktree | `D:\Mustafa\Siteler\DisKlinikCRM-worktrees\pilot-production-readiness` (freshly created this task) |
| Branch | `audit/pilot-production-readiness`, tracking `origin/main` |
| Base commit (current, refreshed 2026-07-22) | `origin/main` @ `7c2aea5a084c38de5732fda65ca0874aa8d46024` ("Merge pull request #208 from MustafaBasol/docs/pilot-customer-onboarding-package") |
| Prior base commit (superseded by the refresh below) | `origin/main` @ `3b4ec9d468f6f93dc67aae5c1fe8fbfe6c7ce80c` ("Merge pull request #206 from MustafaBasol/docs/kvkk-high006-production-verification-close-r071") |
| `git fetch origin main` | Ran successfully before worktree creation; no drift detected between fetch and worktree checkout |
| Worktree clean status | Clean — worktree created directly from `origin/main`; only this evidence file added (untracked), not staged, not committed. The operator command package is §12 of this same file, not a separate file. |
| Migration directory count | 65 migration directories under `server/prisma/migrations/` (plus one non-directory `migration_lock.toml`, not a migration) |
| Latest migration (by filename) | `20260720180000_add_platform_admin_audit_event` |

Note: the *original* task branch/name suggestion (`audit/pilot-production-readiness`) was used as given.

### 1.1 Baseline drift check (requested this review)

The prior task's baseline, `origin/main` @ **`3b4ec9d468f6f93dc67aae5c1fe8fbfe6c7ce80c`** (full 40-character SHA), was checked against an earlier reference SHA supplied for this review, `cf947ea244f274c60b71085bab1025ca3bc3803a`.

`git merge-base --is-ancestor cf947ea244f274c60b71085bab1025ca3bc3803a origin/main` → exit `0`: **confirmed, `origin/main` advanced from `cf947ea244f274c60b71085bab1025ca3bc3803a` to `3b4ec9d468f6f93dc67aae5c1fe8fbfe6c7ce80c`.**

**Intervening commits:** 37 commits (`git log --oneline cf947ea244f274c60b71085bab1025ca3bc3803a..origin/main`), spanning PR #193 through PR #206 — the KVKK-HIGH-006 batch remediations (tenant/clinic-scope centralization across `reports.ts`, `dentalChart.ts`, `appointmentRequests.ts`, `paymentPlans.ts`, `inventory.ts`, `insuranceProvisions.ts`, `messages.ts`, `postTreatment.ts`, `services.ts`, `planLimits.ts`, `patients.ts`, `users.ts`), their disposable-Postgres and combined post-merge verification passes, the HIGH-006 production deployment gate, and the final production deployment/smoke evidence that closed R-071.

**Files touched in that range, by category (`git diff --name-only cf947ea244f274c60b71085bab1025ca3bc3803a origin/main`):**

| Category | Changed in range? | Detail |
|---|---|---|
| Deployment scripts (`scripts/*.sh`) | **No** | Zero matches for `scripts/` in the diff. `noramedi-deploy.sh`/`noramedi-healthcheck.sh` unchanged. |
| Migrations (`server/prisma/migrations/`) | **No** | Zero matches. Migration directory count (65) is unaffected by this range — confirmed via a scoped `git diff --name-only ... -- server/prisma/migrations/`, empty result. |
| Backup/restore documentation (`docs/architecture/**`) | **No** | Zero matches. `f0-011-backup-restore-gap-matrix.json` and `object-storage-backup-migration-design.md` unchanged in this range. |
| Production topology (`docs/program/PRODUCTION_TOPOLOGY.md`) | **No** | Not in the changed-file list. |
| Security configuration (`server/.env.example`, env templates) | **No** | Zero matches for `*.env.example`. `ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK`/webhook-token template lines are unaffected. |
| Launch gates (`docs/program/LAUNCH_GATES.md`) | **No** | Not in the changed-file list — the G1/G2 gate specification cited throughout §10 of this document is unaffected by this range. |
| Pilot readiness assumptions (`docs/program/CURRENT_PHASE.md`, `NORAMEDI_MASTER_TRACKER.md`, `RISK_REGISTER.md`, `docs/compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md`) | **Yes** | All four changed — this is exactly the R-071 closure and HIGH-006 production deployment/smoke-verification narrative already read and incorporated into §§2, 10 of this document from the current `origin/main` tip (not from any stale intermediate state). No further correction to this document's content was needed on this account. |
| Application code (`server/src/routes/*.ts`, `server/src/middleware/planLimits.ts`) and tests | Yes (not a category this review asked about) | Tenant/clinic-scope centralization for KVKK-HIGH-006 — authorization-*logic* changes, not security *configuration* (no env var, secret, or webhook-token template touched). Not itself evidence for or against this document's `UNVERIFIED` production-config items in §7, which concern runtime environment values, not source code. |

**Net effect on this document:** none of the categories this review asked about (deploy scripts, migrations, backup/restore docs, topology, security config, launch gates) changed in the `cf947ea244f274c60b71085bab1025ca3bc3803a..3b4ec9d468f6f93dc67aae5c1fe8fbfe6c7ce80c` range, so no citation to those documents in this file needed correction. The one category that did change (pilot-readiness/program-tracker docs) was already read at the current tip when this document was first authored, so its content was already current — this drift check confirms that, it does not surface a new gap.

### 1.2 Baseline refresh (this review, 2026-07-22) — `origin/main` advanced again

`git fetch origin --prune` + `git rev-parse origin/main` this review returned **`7c2aea5a084c38de5732fda65ca0874aa8d46024`** — one merge ahead of this document's prior baseline (`3b4ec9d468f6f93dc67aae5c1fe8fbfe6c7ce80c`). The local worktree/branch (`audit/pilot-production-readiness`) was fast-forwarded to this commit (`git merge --ff-only origin/main`; it had zero local commits ahead of its old base, so the fast-forward was clean, no conflicts, nothing lost).

**Single intervening change** (`git log --oneline 3b4ec9d468f6f93dc67aae5c1fe8fbfe6c7ce80c..7c2aea5a084c38de5732fda65ca0874aa8d46024`, 2 commits — one content commit, one merge commit — both from **PR #208**, "docs/pilot-customer-onboarding-package"):

```
7c2aea5 Merge pull request #208 from MustafaBasol/docs/pilot-customer-onboarding-package
84bf152 docs(pilot): add controlled customer onboarding package
```

**Files added** (`git diff --name-only 3b4ec9d468f6f93dc67aae5c1fe8fbfe6c7ce80c 7c2aea5a084c38de5732fda65ca0874aa8d46024`, confirmed — 5 new files, 342 insertions, 0 deletions, 0 modifications to any pre-existing file):
- `docs/operations/pilot/PILOT_CLINIC_ACCEPTANCE_CRITERIA.md`
- `docs/operations/pilot/PILOT_CUSTOMER_ONBOARDING_CHECKLIST.md`
- `docs/operations/pilot/PILOT_FEATURE_ENABLEMENT_MATRIX.md`
- `docs/operations/pilot/PILOT_FIRST_WEEK_MONITORING_PLAN.md`
- `docs/operations/pilot/PILOT_INCIDENT_AND_ROLLBACK_PLAYBOOK.md`

**Assessment:**
- PR #208 added the controlled-pilot **onboarding documentation package** (acceptance criteria, customer onboarding checklist, feature-enablement matrix, first-week monitoring plan, incident/rollback playbook) — planning/process documentation for *how* a pilot would be run, not a change to what runs in production.
- **No runtime, schema, migration, deployment, backup, production topology, or security configuration changed** — confirmed by the file list above (all 5 additions are new files under `docs/operations/pilot/`; zero touches to `server/`, `scripts/`, `server/prisma/migrations/`, `server/.env.example`, or any `docs/program/PRODUCTION_TOPOLOGY.md`/`docs/architecture/**` file).
- **This does not change the `NOT_PILOT_READY` classification in §11** — none of the P0/P1 blockers listed in §10 (no live evidence, missing restore rehearsal, missing file-tree backup coverage, unresolved legal/VERBİS/DPA, existing `LAUNCH_GATES.md` blockers) are addressed by planning documentation alone.
- **It reinforces, rather than changes, that gate `G1` remains `NOT_EVALUATED` / effectively not-approved per `docs/program/LAUNCH_GATES.md` §4** ("Current state: `G1 = NOT_EVALUATED`, `G2 = NOT_EVALUATED`") — an onboarding *plan* is a precondition artifact for eventually running G1's evaluation, not evidence that G1 itself has been evaluated, approved, or conditionally approved. No agent may self-assign `CONDITIONALLY_APPROVED`/`APPROVED` per that document's §0, and this task does not attempt to.

---

## 2. Production HEAD

**Status: UNVERIFIED — requires operator-run production command evidence.**

No live read of the production checkout's `git rev-parse HEAD` / `git branch --show-current` / `git status --short` was performed this task (no SSH access — see §0).

For context only (not current-state evidence): the repository's own program tracker (`docs/program/CURRENT_PHASE.md`, entry dated 2026-07-22) records a **prior, separately-executed** deployment reporting production HEAD `1aa741d1dc1e1888b1dfdb9b911d0123b4eea1ab`, clean working tree, 65 migration directories, `prisma migrate status` clean. That record was produced by a different task/operator action, not by this task, and this task did not re-verify it. Treat it as history, not as this task's finding.

**Operator action required:** run §12 Group 1 commands and record actual output here.

---

## 3. Service health

**Status: UNVERIFIED — requires operator-run production command evidence.**

Not checked this task: `pm2 list`, `noramedi-api` status/restart count, `noramedi-worker` status/restart count, five local `/api/health` probes, public site HTTP status (`noramedi.com`, `app.noramedi.com`, `api.noramedi.com`), app login redirect behavior (`app.noramedi.com` → `/login`).

Repository-derived context (architecture only, not live state):
- Two PM2 processes are expected: `noramedi-api` (deploy-managed, reloaded by `scripts/noramedi-deploy.sh`) and `noramedi-worker` (**no deploy-managed reload/restart mechanism exists in this repository** — `docs/program/PRODUCTION_TOPOLOGY.md` §2/§3).
- Health endpoint: `GET /api/health`, API only. The worker has **no HTTP health endpoint**; PM2 "online" status is its only liveness signal (`scripts/noramedi-healthcheck.sh`, `PRODUCTION_TOPOLOGY.md` §3).
- Healthcheck script treats HTTP `401`/`403` as healthy (auth wall expected on an unauthenticated probe) — do not misread a `401` from `/api/health` as a failure.
- `RUN_BACKGROUND_JOBS`'s actual production value is recorded elsewhere in this repository as **unverified** (`docs/program/ENVIRONMENT_MATRIX.md` per `LAUNCH_GATES.md` §F) — this affects whether the API registers background jobs in addition to the worker; a `JobLock` DB-lease table prevents duplicate *execution* regardless.

**Operator action required:** run §12 Group 2 and Group 3 commands and record actual output here.

---

## 4. Migration status

**Status: PARTIALLY VERIFIABLE FROM REPOSITORY — production application status UNVERIFIED.**

Repository-verifiable facts (checked this task, direct file count):
- 65 migration directories present in `server/prisma/migrations/` on `origin/main` @ `7c2aea5a084c38de5732fda65ca0874aa8d46024` (unchanged from the prior baseline `3b4ec9d468f6f93dc67aae5c1fe8fbfe6c7ce80c` — PR #208 added documentation only, per §1.2, no migration file was added or removed).
- `server/prisma/schema.prisma` and the migrations directory are present and structurally consistent with a Prisma-managed PostgreSQL schema (not independently diffed line-by-line this task).

Not checked this task (requires live production database access): `npx prisma migrate status` against the production `DATABASE_URL`, actual row count/contents of `_prisma_migrations`, whether all 65 migrations are applied, whether schema drift exists between `schema.prisma` and the live database.

**No migration was executed, proposed for execution, or rehearsed against production by this task.**

**Operator action required:** run §12 Group 4 commands and record actual output here.

---

## 5. Backup status

**Status: UNVERIFIED (live values) — architecture is repository-documented but the documentation is explicit that key facts (encryption, offsite copy, uploads-tree inclusion) are themselves unverified, not merely unchecked by this task.**

Repository-documented backup architecture (`docs/program/PRODUCTION_TOPOLOGY.md` §6, `docs/architecture/evidence/f0-011-backup-restore-gap-matrix.json` GAP-A):
- Mechanism: cron-driven (`/etc/cron.d/noramedi-db-backup`, no systemd timer), external script `/usr/local/sbin/noramedi-db-backup.sh` — **script content is not part of this repository** and was not inspected.
- Location: `/root/noramedi-backups` — **same host as the database**. No offsite copy found or supplied at the time of that document's evidence.
- Retention: 7 days declared (`backupService.ts`); enforcement mechanism external, unverified.
- Encryption at rest: **UNVERIFIED_PRODUCTION** per the F0-011 gap matrix — the backup script itself was never available to inspect.
- `server/uploads/` (patient attachment/imaging local storage, ~3.1 MB observed at a past evidence timestamp) is **not confirmed** to be included in the backup pipeline; repository evidence suggests the pipeline targets the database only.
- PITR: **not configured** (`archive_mode=off`), confirmed via a past production observation cited in `PRODUCTION_TOPOLOGY.md` — this task did not re-confirm it live.

None of the following were checked live by this task: latest backup file timestamp, file existence, file size, file permissions, checksum, or `pg_restore --list` validation against any custom-format dump.

**Operator action required:** run §12 Group 5 commands and record actual output here.

---

## 6. Restore-evidence status

**Classification: MISSING** (repository-evidence-based; not re-confirmed live this task; **not upgraded to VERIFIED or downgraded further without operator evidence**).

Basis for this classification: `docs/program/PRODUCTION_TOPOLOGY.md` §6 states restore-test evidence is `"UNVERIFIED — capability exists (admin-triggered runRestoreTest()), no durable evidence of it ever having been exercised"`; `docs/architecture/evidence/f0-011-backup-restore-gap-matrix.json` GAP-A states `"restore_test_status": "Capability exists (runRestoreTest(), backupService.ts:167-277); no durable evidence of actual execution"`; and `docs/program/LAUNCH_GATES.md` §2.E explicitly lists a successful disposable-environment restore rehearsal as a **mandatory, not-yet-satisfied** precondition for a G1 (controlled pilot) gate approval, and blocker #5 in that same document ("No restore-test rehearsal ever performed") is listed as an unresolved G1 blocker as of that document's own evidence.

Per this task's classification scheme (VERIFIED / STALE / MISSING): the absence of any durable evidence of a restore ever having been exercised — as opposed to evidence of a stale-but-real past restore — places this at **MISSING**, not **STALE**.

**No restore was performed, proposed, or rehearsed in production by this task**, consistent with the task's read-only constraint. A restore rehearsal, if ever performed, belongs in a **disposable/non-production environment**, per `LAUNCH_GATES.md` §2.E.

**Operator action:** §12 Group 6 provides a read-only lookup for any restore-log/evidence artifact that may exist on the production host; it does not authorize or request a restore to be performed.

---

## 7. Security/configuration findings

**Status: UNVERIFIED (production values) — repository defaults/templates only were inspected.**

Checked this task (repository files, not production environment):
- `server/.env.example` line 121: `ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK=false` — this is the **template default**, not production's actual configured value. Production's actual value was not read.
- `server/.env.example` lines 133-134: `META_WEBHOOK_VERIFY_TOKEN=` and `INSTAGRAM_WEBHOOK_VERIFY_TOKEN=` are declared as empty template placeholders in `.env.example` (as expected for a template) — this confirms the template does not ship a real or test value, but says nothing about what value production is actually running with.
- No secret values of any kind were retrieved, printed, or exist in this repository's tracked files (checked by inspecting `.env.example`, which is the tracked template file; the real `.env` is git-ignored and was not read since it does not exist in this checkout).

Not checked (requires live production inspection, presence/strength metadata only, per task constraints — never the literal secret value): whether production's `META_WEBHOOK_VERIFY_TOKEN` / `INSTAGRAM_WEBHOOK_VERIFY_TOKEN` are set to a non-empty, non-placeholder, non-test-looking value; whether production's `ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK` is actually `false` at runtime (a `.env.example` default does not guarantee the deployed `.env` matches it); `JWT_SECRET`/`PLATFORM_JWT_SECRET`/`CSRF_SECRET`/`ENCRYPTION_KEY` presence (the repository's own fail-hard check at `server/src/index.ts:75-89` — confirmed present in source, not confirmed still unmodified at the exact deployed commit, since production HEAD is unverified per §2).

**Operator action required:** run §12 Group 9 commands (presence/length/format checks only — the package is designed to never print a secret value) and record actual output here.

---

## 8. Logging findings

**Status: UNVERIFIED — requires operator-run production command evidence.**

No production log was read this task (no SSH access). No claim is made about recent API errors, worker errors, tenant/authorization errors, database errors, or WhatsApp/Meta errors in the current production log state.

For context only: `docs/program/LAUNCH_GATES.md` §1 cites a past evidence snapshot noting "pre-existing WhatsApp-agent JSON parse errors and `pg` deprecation warnings present but non-blocking" as of a prior deployment's log review — that is a historical note from a different task, not this task's finding, and may no longer reflect current log contents.

**Operator action required:** run §12 Group 8 commands. The command package is written to avoid ever matching or displaying patient-identifying fields (patient name, phone, email, TC kimlik no, address) — it filters to error/exception/stack-trace lines and known error-category keywords only. The operator should still visually scan output before sharing it further, since log-line content is outside this package's control.

---

## 9. Capacity snapshot

**Status: UNVERIFIED — requires operator-run production command evidence.**

Not checked: CPU load, memory usage, disk usage, active database connection count, per-process (PM2) memory usage.

**Operator action required:** run §12 Group 7 commands and record actual output here.

---

## 10. Pilot blockers

This section classifies blockers using only: (a) what this task itself verified from the repository, and (b) what the repository's own pre-existing pilot-gate document (`docs/program/LAUNCH_GATES.md`, task F0-012) already specifies as required evidence for a controlled-pilot (`G1`) gate. It does **not** assert that any blocker below has newly appeared or newly cleared — most are carried forward from `LAUNCH_GATES.md`'s own blocker list, re-stated here in this task's required taxonomy, dated to this task's evidence-gathering date.

### P0 (must resolve before any pilot go-live)

1. **No live production verification was performed by this task for identity, health, migrations, backups, security config, logs, or capacity** (this task's own scope gap, not a pre-existing repository finding) — every item in §§2-3, 5, 7-9 above is `UNVERIFIED` and must be independently confirmed via the operator command package (§12) before any pilot decision relies on this document.
2. **No restore-test rehearsal has ever been performed** (§6, MISSING) — `LAUNCH_GATES.md` §2.E names this a mandatory-before-G1 item, not an acceptable temporary risk, "because a pilot without any restore rehearsal ever performed is an unacceptable RTO gap even at small scale." A rehearsal must occur in a disposable, non-production environment.
3. **No manual rollback runbook has been rehearsed** for `scripts/noramedi-deploy.sh`, which is explicitly fail-fast and non-transactional with no automated rollback (`PRODUCTION_TOPOLOGY.md` §4, `LAUNCH_GATES.md` §2.D/blocker #6).
4. **Legal/VERBİS/DPA determinations remain unresolved for specific pilot clinics** (`LAUNCH_GATES.md` §2.H/blocker #7) — this is an external legal-counsel deliverable this task cannot verify or substitute for.
5. **File-tree (patient attachment / imaging) backup coverage is confirmed absent** (`f0-011-backup-restore-gap-matrix.json` GAP-C, GAP-G — "the single largest gap identified," zero backup coverage of attachment/imaging file bytes). `LAUNCH_GATES.md` §2.E treats this as an *acceptable temporary risk for G1 only* if evaluated and explicitly accepted per pilot clinic with a named risk owner and expiry — it is **not** self-clearing and requires that explicit governance record before pilot go-live, not merely being named here.

### P1 (should resolve before pilot go-live; may be explicitly risk-accepted with named owner/expiry per `LAUNCH_GATES.md` §2 governance fields)

6. **R-061 (KVKK-HIGH-008 legacy consent correction) — per the program's own tracker, remains `OPEN`** as of the 2026-07-22 `CURRENT_PHASE.md` entries reviewed this task: authenticated disabled-mutation-route behavior, authorized read/history behavior while disabled, and a successful platform-admin audit-creation/attribution cycle are recorded as not yet independently verified against production. This task did not re-check this live.
7. **Off-site database backup copy not found** (R-030) and **PITR not configured** (R-031) — both explicitly listed in `LAUNCH_GATES.md` §2.E as acceptable-only-as-a-governed-temporary-risk for G1, mandatory before G2. Requires the named-owner/expiry/exit-criterion governance record per `LAUNCH_GATES.md` §3 before being treated as accepted rather than open.
8. **Backup encryption-at-rest status is unverified** (F0-011 gap matrix GAP-A) — the external backup script was never available for inspection by any prior task, and this task did not obtain SSH access to check it either.
9. **`RUN_BACKGROUND_JOBS`'s actual production value is unverified** (`ENVIRONMENT_MATRIX.md`, cited by `LAUNCH_GATES.md` §F as something that "must be confirmed before G1").
10. **No CI coverage exists beyond one workflow scoped to `windows-bridge/**`** (`LAUNCH_GATES.md` §1 Test infrastructure row) — acceptable for G1 per that document (manual test execution substitutes), but not a clean bill of health.

### Acceptable warnings (known, bounded, and already explicitly scoped as G1-acceptable by `LAUNCH_GATES.md`, contingent on the governance record being completed)

11. Application-layer-only tenant isolation (no RLS, no Prisma tenant guard) — `LAUNCH_GATES.md` §2.C names this an acceptable *temporary* risk for a small, named, bounded pilot cohort, conditioned on all existing cross-tenant negative tests passing and a governance record being completed. This task did not re-run those tests.
12. No monitoring/alerting stack (`ADR-012` `DEFERRED`) — acceptable for a small, actively human-monitored pilot per `LAUNCH_GATES.md` §2.F, provided the substitution is explicitly recorded, not silently assumed.
13. Worker has no deploy-automation path and no HTTP health endpoint of its own — documented, long-standing operational debt (R-033/R-037-class), acceptable for G1 per `LAUNCH_GATES.md` §2.F provided PM2 "online" status is accepted as the liveness signal.

### Non-blocking observations

14. `docs/35-docker-deploy-runbook.md` describes a Docker Compose topology that does not exist as running infrastructure (`PRODUCTION_TOPOLOGY.md` §4) — stale documentation, not a runtime risk, but could mislead an operator who reads it as current.
15. Migration-directory counting surface note: 65 directories + 1 `migration_lock.toml` file — a naive `ls | wc -l` yields 66; this is a counting artifact, not schema drift (per `CURRENT_PHASE.md`'s own prior reconciliation of this exact point).

---

## 11. Readiness classification

# **NOT_PILOT_READY**

**Rationale:** This task performed zero live production verification (§0) — every operationally material item this task's brief asked about (service health, migration application status, backup freshness/integrity, restore evidence currency, security configuration values, log error state, and capacity) is `UNVERIFIED` for the current moment, not merely "not re-checked this week." Independent of that gap, the repository's own pre-existing controlled-pilot gate specification (`docs/program/LAUNCH_GATES.md`) already lists multiple unresolved mandatory blockers as of its own evidence (no restore-test rehearsal ever performed, no rollback runbook rehearsal, unresolved legal/VERBİS/DPA determinations, and file-tree backup coverage that is confirmed completely absent). None of these are resolved by this task, and this task did not find evidence that they have been resolved by any other task since `LAUNCH_GATES.md` was last updated.

**This classification does not claim** general-launch readiness, KVKK compliance, high-scale verification, or that production is currently unhealthy — only that the mandatory evidence for a pilot-ready determination is currently incomplete, per this task's own read-only, repository-only scope.

**Path to `PILOT_READY_WITH_RESTRICTIONS`:** the operator runs the §12 command package, records actual results in §§2-3, 5, 7-9 above, confirms no P0 item is contradicted by that evidence, and either resolves or formally accepts (with the named-owner/expiry/exit-criterion record `LAUNCH_GATES.md` §2 requires) each P1 item — at which point a follow-up task should re-evaluate this document's classification against the completed evidence, not silently upgrade it here.

---

## 12. Operator command package (read-only, run manually by the user)

**Purpose:** a minimal, read-only, non-destructive command set to close the `UNVERIFIED` items above. **This package was authored without any production access — it is derived entirely from repository documentation of the expected topology (`PRODUCTION_TOPOLOGY.md`) and must be sanity-checked by the operator against the actual host before or while running**, since this task could not confirm the documented paths/process names are still current.

**Ground rules for every command below:**
- Read-only. No `pm2 restart`/`reload`/`stop`, no `prisma migrate dev`/`deploy`/`reset`, no `git pull`/`checkout`/`reset`, no `INSERT`/`UPDATE`/`DELETE`/`DROP`, no file writes outside a throwaway local temp path, no `systemctl restart`, no `kill`.
- Never print a secret value — only presence, length, and format-shape checks are used for tokens/secrets.
- Never select/print patient-identifying columns (name, phone, email, TC kimlik no, address, date of birth) from the database — only counts, aggregates, and schema/metadata.
- Verify the named PM2 process names, file paths, and database name against your actual host before running — this package assumes `noramedi-api`/`noramedi-worker`, `/var/www/noramedi`, database `noramedi_crm`, backup path `/root/noramedi-backups`, per repository documentation as of 2026-07-22; if any of these have changed, adjust before running.

### Group 1 — Server identity and git state

```bash
hostname
whoami
pwd
cd /var/www/noramedi && pwd
git -C /var/www/noramedi rev-parse HEAD
git -C /var/www/noramedi branch --show-current
git -C /var/www/noramedi status --short
git -C /var/www/noramedi log -1 --format='%H %ci %s'
```

### Group 2 — PM2 / service health

```bash
pm2 list
pm2 describe noramedi-api
pm2 describe noramedi-worker
pm2 jlist | grep -E '"name"|"status"|"restart_time"|"pm_uptime"'
```

### Group 3 — HTTP health checks

```bash
for i in 1 2 3 4 5; do
  curl -s -o /dev/null -w "attempt $i: %{http_code}\n" http://127.0.0.1:5000/api/health
  sleep 1
done

curl -s -o /dev/null -w "noramedi.com: %{http_code}\n" https://noramedi.com
curl -s -o /dev/null -w "app.noramedi.com: %{http_code} -> redirect: %{redirect_url}\n" -L --max-redirs 0 https://app.noramedi.com
curl -s -o /dev/null -w "api.noramedi.com/api/health: %{http_code}\n" https://api.noramedi.com/api/health
```
Note: `401`/`403` on `/api/health` is expected/healthy behavior per `scripts/noramedi-healthcheck.sh` — do not treat it as a failure by itself.

### Group 4 — Prisma migration status (read-only)

```bash
cd /var/www/noramedi/server
npx prisma migrate status
ls prisma/migrations | grep -c '^[0-9]'
```
Do **not** run `prisma migrate deploy`, `prisma migrate dev`, or `prisma migrate reset` as part of this task.

### Group 5 — Backup existence and validation (read-only)

```bash
ls -la /root/noramedi-backups
ls -lat /root/noramedi-backups | head -5
stat /root/noramedi-backups/<latest-file-name-from-above>
sha256sum /root/noramedi-backups/<latest-file-name-from-above>
crontab -l 2>/dev/null | grep -i backup
cat /etc/cron.d/noramedi-db-backup 2>/dev/null

# Only if the latest backup is a pg_dump custom-format (.dump/.pgcustom) file —
# lists archive contents, does NOT restore anything:
pg_restore --list /root/noramedi-backups/<latest-file-name-from-above>
```

### Group 6 — Restore-test evidence lookup (read-only; do not perform a restore)

```bash
grep -ril "restore" /root/noramedi-backups /var/log 2>/dev/null | head -20
find / -maxdepth 4 -iname "*restore-test*" -o -iname "*restore_test*" 2>/dev/null
# If backupService.ts's runRestoreTest() writes its own evidence file/table, inspect it read-only —
# check application logs or an admin-facing evidence path if one is documented; do not trigger the function.
```
**Do not invoke `runRestoreTest()` or any admin restore-test endpoint as part of this task.** This step only looks for evidence of a *prior* execution.

### Group 7 — Capacity snapshot (read-only)

```bash
nproc
uptime
free -h
df -h
pm2 jlist | grep -E '"name"|"memory"|"cpu"'

# Active DB connection count only — no query content, no row data:
psql "$DATABASE_URL" -c "SELECT count(*) FROM pg_stat_activity;" 2>/dev/null || echo "skip if DATABASE_URL not exported in this shell"
```

### Group 8 — Recent error-log summary (timestamp + severity + category + count only — no raw message bodies, no patient data)

**Revised this review** — the original draft `grep | tail -100` form returned raw log lines, which can carry PHI/PII embedded in error messages or stack traces. Replaced with a category-and-count reduction: every command below emits `category`, `count`, `first_seen`, `last_seen` — never the log message body itself.

```bash
# --- API log: error/severity category counts, no message content ---
TMPLOG=$(mktemp)
pm2 logs noramedi-api --lines 1000 --nostream --timestamp > "$TMPLOG" 2>&1

for cat in error exception stack fatal unauthorized forbidden tenant cross-org cross-clinic whatsapp meta instagram webhook; do
  count=$(grep -ic "$cat" "$TMPLOG")
  if [ "$count" -gt 0 ]; then
    first_ts=$(grep -i "$cat" "$TMPLOG" | head -1 | cut -d' ' -f1-2)
    last_ts=$(grep -i "$cat" "$TMPLOG" | tail -1 | cut -d' ' -f1-2)
    echo "app=noramedi-api severity=UNSPECIFIED category=$cat count=$count first_seen=$first_ts last_seen=$last_ts"
  fi
done
rm -f "$TMPLOG"

# --- API log, split by stream (stderr ≈ ERROR severity, stdout ≈ INFO severity),
#     if this pm2 version supports --err/--out; omit the flag pair and treat as
#     severity=UNSPECIFIED (loop above) if it errors on your version ---
for stream_flag in "--err:ERROR" "--out:INFO"; do
  flag="${stream_flag%%:*}"; sev="${stream_flag##*:}"
  count=$(pm2 logs noramedi-api --lines 1000 --nostream --timestamp "$flag" 2>/dev/null | grep -icE 'error|exception|stack|fatal')
  echo "app=noramedi-api severity=$sev error_line_count=$count"
done

# --- Worker log: same category-count pattern ---
TMPWLOG=$(mktemp)
pm2 logs noramedi-worker --lines 1000 --nostream --timestamp > "$TMPWLOG" 2>&1
for cat in error exception stack fatal jobfail joblock; do
  count=$(grep -ic "$cat" "$TMPWLOG")
  if [ "$count" -gt 0 ]; then
    first_ts=$(grep -i "$cat" "$TMPWLOG" | head -1 | cut -d' ' -f1-2)
    last_ts=$(grep -i "$cat" "$TMPWLOG" | tail -1 | cut -d' ' -f1-2)
    echo "app=noramedi-worker severity=UNSPECIFIED category=$cat count=$count first_seen=$first_ts last_seen=$last_ts"
  fi
done
rm -f "$TMPWLOG"

# --- Nginx: 5xx status-code counts only, no full request line/URL ---
TMPNGINX=$(mktemp)
journalctl -u nginx --since "24 hours ago" --no-pager > "$TMPNGINX" 2>/dev/null
for code in 500 501 502 503 504; do
  count=$(grep -c " $code " "$TMPNGINX")
  if [ "$count" -gt 0 ]; then
    first_ts=$(grep " $code " "$TMPNGINX" | head -1 | cut -d' ' -f1-3)
    last_ts=$(grep " $code " "$TMPNGINX" | tail -1 | cut -d' ' -f1-3)
    echo "service=nginx severity=ERROR http_status=$code count=$count first_seen=$first_ts last_seen=$last_ts"
  fi
done
rm -f "$TMPNGINX"
```

Every temp file above is created with `mktemp` (private to the operator's own session, mode `0600` by default), read-only relative to production (no production file is written), and explicitly removed (`rm -f`) at the end of its own block — nothing persists on disk beyond the command's own runtime. **Do not** modify this script to `cat`, `head`, or otherwise print `$TMPLOG`/`$TMPWLOG`/`$TMPNGINX` directly — only the count/category/timestamp reduction above should ever be echoed or recorded.

### Group 9 — Security configuration presence checks (presence / length / placeholder-detection only — no secret values printed)

**Revised this review** — added explicit test-value/placeholder detection (task requirement item 6), still without ever printing the literal value.

```bash
cd /var/www/noramedi/server

# Presence + length + placeholder/test-value detection only (never the value itself):
PLACEHOLDER_REGEX='^(test|test_?token|changeme|change_?me|your_.*_here|xxx+|000+|123456+|replace_?me|dummy|sample|example|placeholder|verify_token(_123)?|)$'

for var in JWT_SECRET PLATFORM_JWT_SECRET CSRF_SECRET ENCRYPTION_KEY META_WEBHOOK_VERIFY_TOKEN INSTAGRAM_WEBHOOK_VERIFY_TOKEN; do
  val=$(grep "^${var}=" .env 2>/dev/null | cut -d= -f2-)
  if [ -z "$val" ]; then
    echo "$var: ABSENT_OR_EMPTY"
  else
    lower_check=$(printf '%s' "$val" | tr '[:upper:]' '[:lower:]')
    if printf '%s' "$lower_check" | grep -Eq "$PLACEHOLDER_REGEX"; then
      flag="LIKELY_PLACEHOLDER_OR_TEST_VALUE"
    else
      flag="no_known_placeholder_pattern_matched"
    fi
    echo "$var: present, length=${#val}, placeholder_check=$flag"
  fi
  unset val lower_check
done

# Boolean config flag — not a secret, safe to print the literal value (this is the
# actual check the task requires: confirm it reads exactly 'false'):
grep "^ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK=" .env 2>/dev/null

# Fail-hard secret check still present in the deployed source (source presence only, not a runtime secret):
grep -n "process.exit(1)" src/index.ts | head -5
```
**Never run `cat .env`, `echo $SECRET_VAR`, `set -x` (which would echo the value into the trace), or any command whose output includes a full secret value.** The placeholder regex above is intentionally generic (common default/example strings) — it cannot prove a value is a *good* secret, only flag values that look like they were never rotated from an example/template. A `no_known_placeholder_pattern_matched` result is evidence of absence-of-an-obvious-placeholder, not proof of secret strength.

---

## 13. Production changes

**None.** No SSH connection succeeded; no command executed on the production host; no file, database row, environment variable, or PM2 process state was read, let alone modified, by this task.

## 14. Files changed

**Authored by this task's line of work (evidence review/refresh), committed:**
- `docs/operations/pilot/PILOT_PRODUCTION_READINESS_EVIDENCE.md` (this file)

**Arrived via the clean fast-forward of `audit/pilot-production-readiness` onto the refreshed `origin/main` (§1.2) — not authored by this task, not this task's change, listed here only for completeness of what the branch now contains:**
- `docs/operations/pilot/PILOT_CLINIC_ACCEPTANCE_CRITERIA.md`
- `docs/operations/pilot/PILOT_CUSTOMER_ONBOARDING_CHECKLIST.md`
- `docs/operations/pilot/PILOT_FEATURE_ENABLEMENT_MATRIX.md`
- `docs/operations/pilot/PILOT_FIRST_WEEK_MONITORING_PLAN.md`
- `docs/operations/pilot/PILOT_INCIDENT_AND_ROLLBACK_PLAYBOOK.md`

These five files are already merged into `origin/main` via PR #208 — they are **not part of this task's commit** (only `PILOT_PRODUCTION_READINESS_EVIDENCE.md` is staged/committed by this task); they appear in the branch purely because the branch was fast-forwarded to current `origin/main` before committing, so a PR from this branch will not re-propose them.

No file under `docs/program/`, `docs/architecture/`, `docs/compliance/`, or any other shared program tracker document was modified by this task.

## 15. Commit/PR safety

Committed and pushed this task, per explicit instruction. Safe: no secret value, credential, patient data, or destructive command is present in the committed file (`PILOT_PRODUCTION_READINESS_EVIDENCE.md`); it is a new, additive documentation file with zero code/schema/migration/config changes, so it carries no deployment or runtime risk. See §12 "Merge safety"/"Deployment applicability" in this task's own response for the full statement.

## 16. Exact next task

The operator must manually run the read-only §12 production command package and return the sanitized outputs for review. No agent SSH access, passphrase sharing, or credential unlocking is authorized.

Once those results are supplied:
1. Record them back into a revision of this same document (§§2-3, 5, 7-9), upgrading each item from `UNVERIFIED` to an actual observed value.
2. A follow-up task re-evaluates §§10-11 (blockers, classification) against the completed live evidence — this document's `NOT_PILOT_READY` classification should not be silently treated as resolved by running the commands alone; it requires a document owner to review the recorded results against the P0/P1 list in §10.
3. Independently of the above, the pre-existing, unresolved `LAUNCH_GATES.md` §2 G1 blockers (restore-test rehearsal in a disposable environment, rollback runbook rehearsal, legal/VERBİS/DPA determinations per pilot clinic, file-tree backup governance record) remain open work items regardless of what the live production check finds, since none of them are observable via a read-only production command — they each require a distinct action (a disposable-environment rehearsal, a legal-counsel review, a written governance record).

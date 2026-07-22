# KVKK-HIGH-006 — Production Deployment Gate

**Task type:** Documentation and program-control only. No deployment, no production access, no runtime/test/migration change performed by this task.
**Worktree:** `D:\Mustafa\Siteler\DisKlinikCRM-worktrees\kvkk-high006-deployment-gate`, branch `docs/kvkk-high006-production-deployment-gate`, created from freshly-fetched `origin/main` @ `6b51f8d4520acc2e2cf56001e8a85d1737f16e1f` (PR #203's own merge commit) — re-verified via `git fetch origin` + `git rev-parse origin/main` at task start, no drift. **Reconciled 2026-07-22** with `origin/main` @ `e84d60b7dfbba8986c424accae9699552b194189` (PR #204's own merge commit) via a normal `git merge` (no rebase, no force-push) — see the reconciliation note after §1's table.
**Related risks:** R-071, R-061 ([RISK_REGISTER.md](../RISK_REGISTER.md)).
**Related trackers:** [CURRENT_PHASE.md](../CURRENT_PHASE.md), [NORAMEDI_MASTER_TRACKER.md](../NORAMEDI_MASTER_TRACKER.md), [phases/F0_BASELINE_AND_VALIDATION.md](../phases/F0_BASELINE_AND_VALIDATION.md).
**Prior evidence this document builds on (not modified by this task):** [KVKK-HIGH-006-COMBINED_POST_MERGE_VERIFICATION.md](KVKK-HIGH-006-COMBINED_POST_MERGE_VERIFICATION.md) (PR #202), [KVKK-HIGH-006-DISPOSABLE_POSTGRES_VERIFICATION.md](KVKK-HIGH-006-DISPOSABLE_POSTGRES_VERIFICATION.md) (PR #203), [R061_REMAINING_AUTHENTICATED_VERIFICATION_PACKAGE.md](R061_REMAINING_AUTHENTICATED_VERIFICATION_PACKAGE.md) (PR #197).

## 0. Purpose and non-authorization statement

This document defines the exact, safe execution sequence for the **next** production task on KVKK-HIGH-006: a controlled deployment of PR #194–#204 to production, followed by a production-safe smoke verification. **It does not execute any of that sequence.** No production command in §3, §4, or §5 below has been run by this task or any prior task. R-071 and R-061 both remain `OPEN` at the end of this document — neither is proposed for closure here; closure criteria for each are stated in §7 and require future evidence this task does not supply.

## 1. Verified authoritative state at task start

`origin/main` was freshly fetched and confirmed at `6b51f8d4520acc2e2cf56001e8a85d1737f16e1f` (PR #203's own merge commit — matched the task's expected SHA exactly at original authoring time). All ten named PR merge commits were independently confirmed both to exist as objects in the local mirror and to be ancestors of that `origin/main` tip via `git merge-base --is-ancestor <sha> origin/main` (exit `0` for all ten), and independently cross-checked against `gh pr view <n> --json state,mergeCommit` (all `MERGED`, `mergeCommit.oid` matching the task's supplied SHA in every case):

| PR | Merge commit | Content |
|---|---|---|
| #194 | `7ee68ef73c203a1d239086c9f2c2e5090011e08a` | Batch 1 clinic scope (`reports.ts`, `appointmentRequests.ts`, `dentalChart.ts`) |
| #195 | `b372406a191e4c557c58a1823cd441bd67f7ae27` | Batch 2 clinic scope (`paymentPlans.ts`, `inventory.ts`, `insuranceProvisions.ts`) |
| #196 | `47dea4d534aa8e464e186e448e51a31a31e61cf3` | Batch 3 clinic scope (`messages.ts`, `postTreatment.ts`, `services.ts`) |
| #197 | `965b0288248175174174cfa0da25730974d5c03b` | R-061 authenticated verification package ("Package A") — prepared, not executed |
| #198 | `4712870fbf9b1cc1dee582fb8981648c482014ad` | Message read/send record-scope follow-up on `messages.ts` |
| #199 | `0a5be5e4e77cea864ea785451acb1d05f184bc9a` | Batch 4 target-clinic quota-scope fix, `middleware/planLimits.ts` |
| #200 | `6ec61ba036849153382c965fe333af9a176a35e5` | Batch 4 characterization/product-decision document |
| #201 | `fd520300aeafada0dff5ea479e064493c76dbffc` | Program status reconciliation (docs-only) |
| #202 | `b1c9cada54d5ec00d877e0d1fd3f833a0ed22883` | Combined post-merge source verification |
| #203 | `6b51f8d4520acc2e2cf56001e8a85d1737f16e1f` | Disposable-PostgreSQL DB-backed verification, current `origin/main` tip at original authoring time |
| #204 | `e84d60b7dfbba8986c424accae9699552b194189` | Test-only fix: replaced a brittle literal-string WABA-binding assertion with a resilient regex assertion of the same security property; no production code changed — current `origin/main` tip |

### 1.1 Reconciliation with PR #204 (2026-07-22)

After this document was originally authored and PR #205 (this document's own PR) opened, [PR #204](https://github.com/MustafaBasol/DisKlinikCRM/pull/204) (`test(messages): make WABA binding assertion resilient`) merged into `main` at merge commit `e84d60b7dfbba8986c424accae9699552b194189`. This was independently re-confirmed via `git fetch origin` + `git rev-parse origin/main` (now `e84d60b7dfbba8986c424accae9699552b194189`), `git merge-base --is-ancestor e84d60b7dfbba8986c424accae9699552b194189 origin/main` (exit `0`), and `gh pr view 204 --json state,mergeCommit` (`state: MERGED`, `mergeCommit.oid` matching).

PR #204 touches exactly one file — `server/src/tests/messageTemplateWabaBinding.test.ts` (6 insertions, 2 deletions) — no `server/src/routes`, `server/src/middleware`, `server/prisma`, or frontend file changed. This branch (`docs/kvkk-high006-production-deployment-gate`) was reconciled with the new `origin/main` tip via a normal `git merge` commit — **no rebase, no force-push** — after confirming no overlap between PR #204's diff and this branch's own five documentation files.

**The authoritative baseline for this document is now `e84d60b7dfbba8986c424accae9699552b194189`** (PR #204's merge commit), superseding `6b51f8d4520acc2e2cf56001e8a85d1737f16e1f` (PR #203's merge commit) recorded above and at the top of this document. The PR chain this document's ancestry/accounting covers is now **PR #194–#204** (eleven PRs), not #194–#203 (ten). See §10 for the updated WABA test status and §4.3 for the migration-count reassessment.

This test-only reconciliation does not change, expand, or invalidate any part of §4's deployment-impact matrix, §4.3's migration determination, or §5's deployment sequence — it introduces no backend/frontend/schema/dependency change of its own. Only the target SHA referenced in §3.2, §5.1, and §8 is updated to reflect the new baseline.

## 2. Deployment-gate document scope note

This document is program control and a runbook — it does not repeat PR #202/#203's own findings in full. It cites them where a deployment decision depends on their content, and independently re-derives the `git diff`/migration facts in §4 below (not merely restated from those documents) because this document's own job is to decide deployment mechanics, not to re-litigate verification results.

---

## 3. Preconditions (read-only, before any deployment step)

All of the following must be captured and satisfied **before** any command in §5 is run. None of these commands mutate state.

1. **Record current production commit/branch before any change.** `git -C /var/www/noramedi rev-parse HEAD` and `git -C /var/www/noramedi rev-parse --abbrev-ref HEAD`, recorded verbatim as the pre-deploy baseline (this is the SHA §6's rollback plan targets).
2. **Revalidate current `origin/main` immediately before deploying** — `git ls-remote origin main` (or a `git fetch --dry-run`) from the production host, confirmed to still read `e84d60b7dfbba8986c424accae9699552b194189` (the baseline as of the §1.1 reconciliation; supersedes the originally-recorded `6b51f8d4520acc2e2cf56001e8a85d1737f16e1f`) or a later fast-forward tip explicitly re-approved, before the fetch/merge step in §5 runs. A mismatch against this document's own recorded SHA is an abort condition — do not deploy an unreviewed tip.
3. **Production working tree must be clean.** `git -C /var/www/noramedi status --short` must return empty output. A non-empty result is an abort condition — investigate before proceeding (do not `git checkout .`/`git clean -fd` on production without first understanding what is present).
4. **Do not print production environment variables.** No step in this document, nor any step a human runs interactively on the host, should `cat`/`printenv`/echo `.env` or any secret-bearing variable to a terminal, log, or committed file. Where a variable's *presence* (not value) must be confirmed, use a presence-only check (e.g. `[ -n "$VAR" ] && echo set || echo unset`).
5. **Record current PM2 process state and API health before deploying.** `pm2 jlist` filtered to `noramedi-api`/`noramedi-worker` (name, status, `restart_time`) and a local health probe (`scripts/noramedi-healthcheck.sh --local --max-attempts 1 --interval 0` or the equivalent single `curl` in §5.6) — both recorded as the pre-deploy baseline that §5's post-deploy health check is compared against.
6. **Confirm database connectivity safely.** A read-only check only — `npx prisma migrate status` (from `server/`) or an equivalent `SELECT 1` — never a write probe. This also surfaces the current applied-migration count for comparison against §4.3 below.
7. **Check backups before deployment.** Confirm at least one recent backup file exists and is of plausible size/age: list `/root/noramedi-backups` (matching `BACKUP_FILENAME_RE` in `server/src/services/backupService.ts`, pattern `noramedi_crm-YYYYMMDD-HHMMSS.dump`) and record the newest file's timestamp and size. Per [PRODUCTION_TOPOLOGY.md](../PRODUCTION_TOPOLOGY.md) §6, retention is a declared 7 days with no confirmed offsite copy — a backup older than the declared retention window, or absent entirely, is an abort condition for any migration step until resolved.
8. **Backup integrity/restore evidence.** Per R-032 ([RISK_REGISTER.md](../RISK_REGISTER.md)) and [PRODUCTION_TOPOLOGY.md](../PRODUCTION_TOPOLOGY.md) §6, `runRestoreTest()` exists (admin-triggered, `platformAdmin.ts`) but has **no durable evidence of ever having been exercised** — this remains `UNVERIFIED`, not "confirmed working." This document does not require running a restore test before this deployment (the migration set in §4.3 is empty, so restore capability is not on the critical path this time), but it must not be misrepresented as verified. If a restore-test run is desired before this deployment for extra assurance, that is a separate, explicitly-authorized action, not a step of this runbook.
9. **No destructive migration or schema-reset command is permitted anywhere in this document.** `prisma migrate dev`, `prisma migrate reset`, `prisma db push --force-reset`, or any manual `DROP`/`TRUNCATE` against production is explicitly out of scope and must never be run under this document's authorization.

---

## 4. Expected deployment content (independently determined, not assumed)

Determined directly from `git diff 7ee68ef73c203a1d239086c9f2c2e5090011e08a^1 6b51f8d4520acc2e2cf56001e8a85d1737f16e1f` (i.e. everything PR #194–#203 collectively changed) plus the current production deploy script (`scripts/noramedi-deploy.sh`) and topology reference ([PRODUCTION_TOPOLOGY.md](../PRODUCTION_TOPOLOGY.md)).

### 4.1 Full changed-file inventory (40 files)

- **Backend runtime code (12 files):** `server/src/middleware/planLimits.ts`, `server/src/routes/{appointmentRequests,dentalChart,insuranceProvisions,inventory,messages,patients,paymentPlans,postTreatment,reports,services,users}.ts`. All changes are additive/corrective clinic-scope logic (routing through `validateAndGetClinicIdScope`/`validateAndGetScope`) — no new route, no removed route, no changed request/response shape beyond scope-filtering behavior.
- **Backend test code (13 new files):** `server/src/tests/{appointmentRequestRecordScope,dentalChartClinicScope,kvkkHigh006Batch2ClinicScope,kvkkHigh006Batch3ClinicScope,messagesRecordScope,planLimitsTargetClinicFix,reportsClinicScope}.test.ts` and 6 files under `server/src/tests/dbVerification/`. **Reconciliation note (§1.1):** PR #204, merged after this inventory was taken, additionally modified one *existing* test file in this same directory — `server/src/tests/messageTemplateWabaBinding.test.ts` — to replace a brittle assertion; see §10.
- **`server/package.json`:** test-script entries only (new `test:*` aliases and their inclusion in the aggregate `test` script). **No dependency version changed** — confirmed by direct diff of this file; `dependencies`/`devDependencies` blocks are untouched.
- **Documentation (13 files):** `docs/program/{CURRENT_PHASE,NORAMEDI_MASTER_TRACKER,RISK_REGISTER}.md`, `docs/program/phases/F0_BASELINE_AND_VALIDATION.md`, and 9 new files under `docs/program/evidence/`.
- **Frontend:** **zero files changed** anywhere under any client/frontend path — confirmed by an explicit `git diff --stat ... -- client/ frontend/ web/` returning empty.
- **Prisma schema/migrations:** **zero files changed** — confirmed by an explicit `git diff --stat ... -- '**/schema.prisma' '**/prisma/migrations/*'` returning empty. No migration is introduced by PR #194–#203.
- **`server/package-lock.json` / root `package-lock.json`:** **unchanged** — confirmed by explicit diff; no dependency tree change accompanies this deployment.

### 4.2 What this means for deployment mechanics

This is a **backend-only, non-migration, dependency-unchanged** change set. The 66-line `server/package.json` diff is script-alias additions only (new `npm run test:*` entries), not a `dependencies`/`devDependencies` change — so a full `npm ci` is not strictly required by this diff alone, but is still the safe default (see matrix below) because the deploy script's own baseline assumption is that `npm ci` runs on every deploy regardless of whether this specific diff needed it, and skipping it introduces a class of drift this document does not want to introduce as a one-off exception.

### 4.3 Migration determination

**No new Prisma migration is introduced by PR #194–#203.** The migrations directory at this commit contains exactly **65** migration directories (independently recounted by directory listing at `server/prisma/migrations/`, most recent: `20260720180000_add_platform_admin_audit_event`, applied by the pre-existing PR #186/KVKK-HIGH-008 work, not by this PR chain).

**Discrepancy note:** [KVKK-HIGH-006-DISPOSABLE_POSTGRES_VERIFICATION.md](KVKK-HIGH-006-DISPOSABLE_POSTGRES_VERIFICATION.md) (PR #203) states "all 66 existing migrations applied cleanly." This document's own independent recount of the same commit's `server/prisma/migrations/` directory finds **65**, not 66.

**Reassessment (2026-07-22):** the two counts use different counting surfaces, not different underlying schema state. `server/prisma/migrations/` contains **65 migration directories** plus exactly one non-directory entry, `migration_lock.toml` (Prisma's own provider-lock metadata file, not a migration). A naive `ls -1 server/prisma/migrations | wc -l` — the shape of command most likely to have produced the prior "66" — returns **66** because it counts `migration_lock.toml` alongside the 65 real migration directories; a directories-only count (`find server/prisma/migrations -mindepth 1 -maxdepth 1 -type d | wc -l`, independently run three ways in the original pass) returns **65**. This fully accounts for the ±1 discrepancy: it is a counting-surface artifact (directory count vs. naive listing count), not schema drift, not a missing/extra migration, and not evidence of divergence between the repository's migration directory and the database's own `_prisma_migrations` applied-migration table. Neither this document nor PR #203's evidence file inspected `_prisma_migrations` row counts directly at authoring time — that is a third, separate counting surface (applied-migration *records* in the database, as opposed to migration *directories* in the repository) and remains the one production authoritative source for "is the database schema up to date," not either directory-listing count above.

This is not classified as a functional defect in either document. **Production `npx prisma migrate status` and `npx prisma migrate deploy` (§5.3) remain the authoritative check during deployment** — they report against `_prisma_migrations`, not a directory listing, and are unaffected by which of the two directory-counting methods a prior document used.

### 4.4 Deployment-impact matrix

| Action | Required? | Basis |
|---|---|---|
| `git update` (fetch + fast-forward pull) | **Required** | New commits (#194–#203) must reach production |
| `npm install` / `npm ci` | **Verify before execution** | No `dependencies`/`devDependencies` change in this diff; safe default is to still run it (deploy script's standing behavior) unless the operator deliberately chooses `--skip-build` after confirming the lockfile is byte-identical to what's already installed |
| Prisma `generate` | **Required** | Already runs unconditionally on every process start (`npm run start` → `prisma generate && tsx src/index.ts`) regardless of this diff; also required as step 4 of the standard deploy script |
| Prisma `migrate deploy` | **Not required, but must still run (safe no-op)** | No new migration in this diff (§4.3); running it anyway is the deploy script's standing behavior and is a confirmed safe no-op when there is nothing pending — skipping it is not necessary but running it is also not harmful and keeps the deploy procedure uniform |
| Backend build | **Not applicable** | No compiled-build step exists — production runs `tsx` directly against TypeScript source (`server/package.json` `start`/`start:worker`); "build" in this codebase means `prisma generate` only |
| Frontend build | **Not required** | Zero frontend files changed (§4.1) |
| PM2 API reload (`noramedi-api`) | **Required** | Backend runtime files changed (§4.1); this is the process serving the changed routes |
| PM2 worker reload (`noramedi-worker`) | **Verify before execution** | No changed file is imported by `server/src/worker.ts`'s own job registration path in a way that changes worker behavior (the changed routes are all Express route handlers, not job files) — a worker reload is not required by this diff's content, but per [PRODUCTION_TOPOLOGY.md](../PRODUCTION_TOPOLOGY.md) §3, **no repository script reloads the worker at all**; if a worker reload is desired for consistency (e.g. to pick up the same commit's `tsx`-interpreted source for any shared module it also imports), it must be done manually/externally — this document does not assume a mechanism that does not exist in the repository |
| Nginx/Traefik changes | **Not required** | No route path, hostname, or proxy-relevant surface changed |
| Environment variable changes | **Not required** | No new `process.env.*` reference was introduced anywhere in the changed backend files (confirmed by an explicit diff-scoped grep for `process.env` additions in `server/src/routes` and `server/src/middleware` — zero matches) |

---

## 5. Controlled deployment sequence (prepared, **not executed**)

All commands below are to be run manually by an authorized operator on the production host, from `/var/www/noramedi`. **This document does not execute any of them.** Each numbered step corresponds to a matrix row in §4.4.

```bash
# ── 5.0 Preconditions (read-only; see §3 for the full checklist) ────────────
cd /var/www/noramedi || exit 1

echo "--- Pre-deploy baseline ---"
PRE_DEPLOY_SHA=$(git rev-parse HEAD)
echo "Pre-deploy SHA: $PRE_DEPLOY_SHA"
git rev-parse --abbrev-ref HEAD
git status --short   # MUST be empty — abort if not

echo "--- Current PM2 state ---"
pm2 jlist | node -e "
const procs = JSON.parse(require('fs').readFileSync(0, 'utf8'));
for (const p of procs) {
  if (p.name === 'noramedi-api' || p.name === 'noramedi-worker') {
    console.log(p.name, p.pm2_env.status, 'restarts=' + p.pm2_env.restart_time);
  }
}
"

echo "--- Current API health ---"
curl -s -o /dev/null -w 'health status: %{http_code}\n' http://127.0.0.1:5000/api/health

echo "--- Current migration status (read-only) ---"
(cd server && npx prisma migrate status)

echo "--- Backup freshness check (read-only) ---"
ls -lt /root/noramedi-backups | head -5

# ── 5.1 Fetch and fast-forward only (never merge/rebase on production) ──────
git fetch origin
echo "Target SHA (origin/main): $(git rev-parse origin/main)"
echo "Expected target SHA: e84d60b7dfbba8986c424accae9699552b194189"
# (supersedes the originally-recorded 6b51f8d4520acc2e2cf56001e8a85d1737f16e1f
# after PR #204 merged — see §1.1.)
# Abort here if these two values do not match, unless a newer tip has been
# separately and explicitly reviewed/approved for this deployment.
git merge-base --is-ancestor "$PRE_DEPLOY_SHA" origin/main || {
  echo "ABORT: current production HEAD is not an ancestor of origin/main — do not force."
  exit 1
}
git pull --ff-only

# ── 5.2 Install dependencies (verify-before-execution — see §4.4) ───────────
cd server
npm ci   # safe default; may be skipped only after confirming package-lock.json is unchanged from the currently-installed tree

# ── 5.3 Prisma migrate deploy (confirmed safe no-op — never `migrate dev`) ──
npx prisma migrate deploy
npx prisma migrate status   # confirm "Database schema is up to date", expect 65 applied migrations (§4.3)

# ── 5.4 Prisma generate ──────────────────────────────────────────────────────
npx prisma generate
cd ..

# ── 5.5 Reload only the required PM2 process(es) ─────────────────────────────
pm2 reload noramedi-api --update-env
sleep 2
# noramedi-worker: NOT reloaded by default — see §4.4. Only reload it if a
# separate, explicit decision extends this deployment's scope to the worker.

# ── 5.6 API and frontend health checks ───────────────────────────────────────
scripts/noramedi-healthcheck.sh --local --max-attempts 12 --interval 5
curl -s -o /dev/null -w 'public API health: %{http_code}\n' https://api.noramedi.com/api/health
curl -s -o /dev/null -w 'public frontend: %{http_code}\n' https://app.noramedi.com/

echo "--- Post-deploy PM2 state ---"
pm2 jlist | node -e "
const procs = JSON.parse(require('fs').readFileSync(0, 'utf8'));
for (const p of procs) {
  if (p.name === 'noramedi-api' || p.name === 'noramedi-worker') {
    console.log(p.name, p.pm2_env.status, 'restarts=' + p.pm2_env.restart_time);
  }
}
"

# ── 5.7 Narrowly-scoped log collection (no secrets) ──────────────────────────
pm2 logs noramedi-api --lines 100 --nostream | grep -E \
  "error|Error|5[0-9][0-9]" \
  | sed -E 's/("email":")[^"]*(")/\1[REDACTED]\2/g'

# ── 5.8 Record rollback information ──────────────────────────────────────────
echo "Pre-deploy SHA (rollback target): $PRE_DEPLOY_SHA"
echo "Post-deploy SHA: $(git rev-parse HEAD)"
```

Note: `scripts/noramedi-deploy.sh` already implements steps 5.1–5.6 in this same order (`git pull --ff-only` → `npm ci` → `migrate deploy` → `generate` → `pm2 reload noramedi-api` → healthcheck) and may be used directly in place of hand-run commands; it does not, however, perform 5.0's baseline capture, 5.7's log collection, or 5.8's rollback-SHA recording, so those three should still be run around it manually.

---

## 6. Production-safe KVKK-HIGH-006 smoke plan

**Hard constraint for every scenario below: no real patient name, phone number, email address, medical/clinical data, or message content is used at any step.** Per this task's instructions, a dedicated synthetic test organization/clinic/user set is preferred if one already exists in production; this document does not confirm whether one does (that confirmation is itself a precondition of executing this plan, not assumed here). Where no safe synthetic fixture is confirmed available, the scenario is marked **read-only / not safely executable** rather than improvised around.

| # | Scenario | Precondition | Action | Expected result | Cleanup | Evidence to capture | Abort condition |
|---|---|---|---|---|---|---|---|
| S1 | Authorized sibling-clinic access | Two synthetic clinics (A, B) under the same organization; a synthetic OWNER/ORG_ADMIN user with `canAccessAllClinics` or explicit `userClinics` rows for both | Authenticated request to a scoped list/detail endpoint (e.g. `GET /api/reports/no-show-analysis?clinicId=B`) for clinic B while acting as the multi-clinic user | `200`, response scoped to clinic B's synthetic data only | None (read-only) | Response status + clinic-id field of returned rows | Any `403`/`404` for a genuinely authorized sibling clinic |
| S2 | Unauthorized/cross-org denial | A second synthetic organization with its own synthetic clinic C, and a user scoped only to organization 1 | Same endpoint pattern as S1, requesting clinic C (different organization) | `403` or `404` (fail-closed, per the codebase's existing AND-filtered-lookup pattern) | None (read-only) | Response status; confirm response body contains no clinic-C data | A `200` or any clinic-C field appearing in the response |
| S3 | Message detail scope | A synthetic message/template row owned by clinic A | `GET` the message-templates list/detail route as a user scoped to clinic A vs. a user scoped only to clinic B | Clinic-A-scoped user: `200` with the row; clinic-B-scoped user: row absent/`403`/`404` | None (read-only) | Response status + presence/absence of the synthetic row's id | Clinic-B-scoped user can see or mutate the row |
| S4 | Message send path | A safe mock/test WhatsApp provider configured in production, if one is confirmed available | If confirmed: send exactly one message to a synthetic/test-only recipient number via the mock provider. **If not confirmed:** do not send — instead verify provider/template configuration and logs read-only | Mock path: message accepted, delivered to the mock sink, no real carrier call. No-mock path: **not safely executable — mark as such** and instead confirm via `GET` on template/connection-status endpoints and log inspection that the send path is reachable without invoking it | If sent: delete/expire the synthetic message record if the schema supports it, else document it as a permanent synthetic artifact | Provider response / log line confirming mock vs. real path; template/connection status snapshot | Any indication the request would reach a real WhatsApp Business API recipient outside the confirmed mock/test provider |
| S5 | Target-clinic user/patient quota behavior | A synthetic organization at or near a low, test-configured plan limit, with synthetic patient/user fixtures only | Attempt to create one more synthetic user/patient against the target clinic via the quota-checked route (`planLimits.ts` path) | Request correctly accepted or correctly rejected with the plan-limit error, matching the configured synthetic limit — not evaluated against real tenant data | Delete the synthetic user/patient created (if accepted) | Response status/body; row created (if any) and its immediate deletion confirmation | A quota check silently passes/fails against real-tenant data instead of the synthetic fixture, or a created synthetic row is not cleaned up |
| S6 | Insurance all-authorized-clinics behavior | A synthetic user authorized across multiple clinics via the insurance-provisions route's "all clinics" selector | `GET` the insurance-provisions list with an all-clinics selector | `200`, response includes only clinics the user is actually authorized for — no clinic outside that set | None (read-only) | Response status + the set of clinic ids present in the response | A clinic outside the user's authorized set appears in the response |
| S7 | Absence of cross-tenant data leakage | Combination of S1/S2/S3/S6 fixtures | Aggregate check across S1–S6's captured evidence: no response body from any authorized-user request contains a row/field attributable to a different organization | All captured responses in S1–S6 contain zero foreign-organization data | None (analysis of already-captured evidence, no new request) | A short written confirmation cross-referencing S1–S6's captured evidence | Any single foreign-organization field found in any S1–S6 response |
| S8 | Audit/activity-log clinic attribution | Any one state-changing synthetic action from S1–S6 above (e.g. S5's synthetic user creation) | Query the relevant activity/audit log entry for that action | Logged entry attributes the action to the correct synthetic clinic/organization, not a default/incorrect one | None (read-only after the triggering action, whose own cleanup is S5's) | Log entry's clinic/organization attribution field | Log entry attributes the action to the wrong clinic or omits clinic attribution entirely |

**Order of execution:** S1 → S2 → S6 → S3 → S5 → S8 → S7 (aggregate) → S4 (attempt only if a mock provider is confirmed; otherwise perform its read-only variant at any point). Running the read-only scenarios (S1, S2, S3, S6, S7) before the one write-bearing scenario (S5) and S4 keeps the abort blast-radius smallest if an early scenario already indicates a problem.

**Global abort condition for this entire smoke plan:** if any scenario touches, returns, or logs anything resembling real patient PII/PHI at any point — even accidentally, even in a field not under test — stop immediately, do not proceed to the next scenario, and treat it as a P0 finding requiring its own incident handling, separate from this smoke plan's own pass/fail result.

---

## 7. R-061 Package A coordination

[R061_REMAINING_AUTHENTICATED_VERIFICATION_PACKAGE.md](R061_REMAINING_AUTHENTICATED_VERIFICATION_PACKAGE.md) (PR #197) defines "Package A" — a prepared, non-activating, authenticated retry of two previously credential-blocked checks (Test C1: authenticated read-only policy `GET`; Test C3: authenticated invalid-payload `PATCH`, must be rejected) for the **unrelated KVKK-HIGH-008** `privacy.legacyConsentCorrection.runtimeEnabled` gate — not KVKK-HIGH-006. This document does not execute Package A; it identifies coordination boundaries only, since both this deployment and Package A would use the same production window and the same class of operator access.

- **Safe to run in the same production window as this deployment:** Package A's §A.1 (baseline capture: git/PM2/health/migration-status/10 DB invariants), §A.6 (log filtering), §A.7 (health/PM2 restart-count recheck), and §A.8 (cleanup) — all pure reads plus a guaranteed cleanup step, none of which write anything, and all of which are compatible with (and in fact overlap in spirit with) this document's own §3/§5.6/§5.7 checks. Running them back-to-back with this deployment's own baseline/health captures is efficient and introduces no additional risk.
- **Must remain separate, not combined into the same command block or PR:** Package A's §A.2 (authenticated platform-admin login), §A.3 (Test C1), and §A.4 (Test C3) are KVKK-HIGH-008-specific, require a *platform-admin* session (distinct from any clinic-level user this deployment's own §6 smoke plan uses), and their own document's stop conditions (credential rejection → skip A.3/A.4 entirely; unexpected `200` on A.4 → stop and report) are independent trip-wires that must not be conflated with this deployment's own abort conditions in §3/§6. If both are run in the same maintenance window, they should be run as two clearly delimited, separately-logged sequences — this deployment's own §5 sequence first (since it changes running code), then Package A's read-only-safe subset, then (only if a valid platform-admin credential is available) §A.2–§A.4 as its own distinct block.
- **Required authenticated role for Package A:** platform-admin (obtained through the application's own normal login flow — never supplied to or requested by this or any prior task). This is distinct from the clinic-level OWNER/ORG_ADMIN/CLINIC_MANAGER roles this document's own §6 smoke plan uses.
- **Read-only vs. write behavior:** every command in Package A's safe subset (§A.1, §A.6–§A.8) is read-only or pure cleanup. §A.2's login is a session-establishment call with no application-data write. §A.3 (Test C1) is a pure `GET`. §A.4 (Test C3) is a `PATCH` whose body is deliberately invalid and is designed to be rejected (`400`) before any transaction opens — per Package A's own source, "no command in this package can create, update, or delete a `PlatformSetting` row, and none can create a `PlatformAdminAuditEvent` row."
- **Cleanup requirements:** Package A's own §A.8 (remove the cookie-jar temp file; unset every secret-bearing shell variable) applies regardless of whether A.2's login succeeded, and is independent of this document's own §5/§6 cleanup steps — both should be performed if both are run in the same session.
- **Explicitly not authorized by this document, and not proposed here:** Package B (any explicit-`false` `PlatformSetting` PATCH, real-patient route verification, or controlled activation of `runtimeEnabled`). This document does not extend, narrow, or otherwise alter Package A or Package B's own authorization boundaries — see R061_REMAINING_AUTHENTICATED_VERIFICATION_PACKAGE.md directly for those.
- **KVKK-HIGH-006 DB verification does not close R-061.** R-061 tracks the KVKK-HIGH-008 legacy-consent-correction runtime gate, an unrelated feature; KVKK-HIGH-006's disposable-Postgres DB verification (PR #203) provides no evidence toward R-061's own closure criteria, and this document does not claim otherwise.

---

## 8. Rollback plan

- **Pre-deploy SHA:** captured live at §5.0/§3.1 as `PRE_DEPLOY_SHA` — record it before any other step in §5 runs. At the time this document was authored, the expected pre-deploy production SHA is whatever `origin/main` was at before this deployment (not independently re-confirmed here, since this document does not execute the deployment — the operator must capture the real value at execution time).
- **Target SHA:** `e84d60b7dfbba8986c424accae9699552b194189` (supersedes the originally-recorded `6b51f8d4520acc2e2cf56001e8a85d1737f16e1f` after PR #204 merged — see §1.1; or a later, separately-reviewed `origin/main` tip if one exists by execution time — see §3.2's abort condition if it silently differs).
- **Application rollback method:** `git checkout <PRE_DEPLOY_SHA>` (or `git reset --hard <PRE_DEPLOY_SHA>` only with explicit confirmation the working tree has no other uncommitted state — re-run §3.3's clean-tree check first) followed by `npm ci` (only if the lockfile differs from what's currently installed), `npx prisma generate`, and `pm2 reload noramedi-api --update-env`. Since PR #194–#203 introduces **no migration** (§4.3), no schema-level rollback consideration applies to this specific deployment — an application-only rollback is fully sufficient.
- **When database rollback is unsafe:** not applicable to this specific deployment (no migration is applied), but as a standing program rule (R-070, [RISK_REGISTER.md](../RISK_REGISTER.md)): physical/hand-authored DDL rollback of any migration is unsafe by default because `_prisma_migrations` does not self-reconcile after a manual schema rollback, and `prisma migrate resolve --rolled-back` refuses to act on a cleanly-applied migration (`P3012`). This deployment does not exercise that risk, but any *future* deployment in this same window that does apply a migration must re-read R-070 before considering a DB-level rollback.
- **Preference for forward-fix:** since this deployment is additive/corrective route-scoping logic with no migration, if a defect is found post-deploy, prefer a forward-fix commit over a rollback unless the defect is severe enough (e.g. an active cross-tenant leak) to warrant immediate reversion — in which case the application-only rollback above is safe and sufficient (no additive schema to preserve/lose either way).
- **PM2 recovery:** `pm2 reload noramedi-api --update-env` after checking out the rollback SHA; if `pm2 reload` itself is unhealthy, `pm2 restart noramedi-api` as a harder fallback, followed immediately by the health check in §8's own verification step below. The worker was not reloaded by this deployment (§4.4), so no worker-side rollback action is needed for this specific change.
- **Frontend rollback:** not applicable — no frontend file changed by this deployment (§4.1), so there is no frontend artifact to roll back.
- **Health verification after rollback:** re-run §5.6 in full (`scripts/noramedi-healthcheck.sh --local --max-attempts 12 --interval 5` plus the public health/frontend checks) and confirm PM2 `restart_time` only incremented by the expected rollback-triggered restart, not repeatedly (a crash-loop signature).
- **Explicit abort thresholds (during §5, before rollback is even considered):** (a) `git merge-base --is-ancestor` fails in §5.1 (production HEAD not an ancestor of `origin/main` — do not force-pull); (b) `npx prisma migrate deploy` in §5.3 reports anything other than "no pending migrations"/clean apply (should be a no-op per §4.3 — any actual migration attempt here is unexpected and must stop the sequence for investigation before continuing); (c) the healthcheck in §5.6 fails after its full 12-attempt/60-second retry window; (d) any `5xx` (other than the healthcheck script's own tolerated transient `502`/`503`/`504` during its retry window) appears in the narrowly-scoped log collection (§5.7) that is not present in the pre-deploy baseline. Any of these triggers immediate rollback per this section, not a "wait and see."

---

## 9. Closure criteria

**R-071** may only be proposed for closure after **all** of the following exist as recorded evidence:

1. Successful production deployment per §5 above (post-deploy SHA confirmed, no abort condition triggered).
2. API and frontend health checks passing per §5.6/§8's verification step.
3. Production-safe smoke evidence per §6 above, captured for at least S1, S2, S3, S6, S7 (S4/S5 as feasible per their own preconditions).
4. No cross-tenant regression observed in §6's S1/S2/S7 evidence.
5. No high-severity log errors in §5.7's narrowly-scoped log collection.
6. Tracker reconciliation — [CURRENT_PHASE.md](../CURRENT_PHASE.md), [NORAMEDI_MASTER_TRACKER.md](../NORAMEDI_MASTER_TRACKER.md), and [RISK_REGISTER.md](../RISK_REGISTER.md) updated to record the above, in a future task, not this one.

Until all six exist, R-071 remains `OPEN`, and this document's own contribution to its record is the composite status `IMPLEMENTATION_MERGED — SOURCE_AND_DB_VERIFIED — PRODUCTION_VERIFICATION_PENDING` (see the tracker updates accompanying this document).

**Superseded 2026-07-22 — [KVKK-HIGH-006-PRODUCTION_DEPLOYMENT_AND_SMOKE_VERIFICATION.md](KVKK-HIGH-006-PRODUCTION_DEPLOYMENT_AND_SMOKE_VERIFICATION.md):** the "none exist yet as of this document" parenthetical above is now stale — all six items exist as recorded evidence. Production deployment (pre-deploy SHA `85e3ffbca7ee1b53789564e16c5e58c5ec498cf2` → deployed SHA `1aa741d1dc1e1888b1dfdb9b911d0123b4eea1ab`) executed cleanly per §5 above; API/frontend health checks passed; the S1/S2/S3/S6/S7 minimum smoke set (item 3) passed with zero cross-tenant regression (item 4) and zero new high-severity log errors (item 5); trackers were reconciled (item 6). **S4 and S5 were not executed** (optional, outside the minimum closure set — see that document's §6 for the recorded rationale) and are not claimed to have passed. **R-071 is proposed `CLOSED`** by that document — this document's own composite status string above (`SOURCE_AND_DB_VERIFIED — PRODUCTION_VERIFICATION_PENDING`) is itself now superseded by `IMPLEMENTATION_MERGED — SOURCE_DB_AND_PRODUCTION_VERIFIED — COMPLETE`. This paragraph is added for historical continuity only — it does not restate or duplicate that document's own evidence, which remains the authoritative source for the production deployment and smoke results themselves.

**R-061** may only be proposed for closure after its own, separate Package A production evidence succeeds (§7 above) — specifically, a successful platform-admin login (§A.2) followed by the expected `200`/`{"runtimeEnabled": false}` on Test C1 (§A.3) and the expected `400` rejection on Test C3 (§A.4), with all before/after invariants in §A.1/§A.5 unchanged. This document's own KVKK-HIGH-006 deployment and smoke evidence, however successful, **does not** and cannot satisfy R-061's closure criteria — the two risks are tracked, and must be closed, independently.

---

## 10. WABA binding test — resolved (PR #204)

**Original finding (superseded below):** `server/src/tests/messageTemplateWabaBinding.test.ts` contained one known stale literal-string assertion: the test at lines 194–197 asserted the source contained the exact literal `const { metaTemplateConnectionId, metaWabaIdSnapshot, ...safeTemplate } = template;`, but the actual source at `server/src/routes/messages.ts:776` reads `const { metaTemplateConnectionId, metaWabaIdSnapshot, clinicId: _clinicId, ...safeTemplate } = template;` — Batch 3 (PR #196) inserted a `clinicId: _clinicId` extraction into the same destructure as part of KVKK-HIGH-006's record-owned-scope remediation, which broke this test's brittle exact-substring match. The underlying security property the test guards — `metaTemplateConnectionId`/`metaWabaIdSnapshot` never present in the API response — held throughout; this was a test-assertion staleness, not a functional or security regression.

**Resolved (2026-07-22, [PR #204](https://github.com/MustafaBasol/DisKlinikCRM/pull/204), merge commit `e84d60b7dfbba8986c424accae9699552b194189`):** the brittle literal-string assertion at lines 194–197 was replaced with a resilient regex assertion — `/const\s*\{\s*metaTemplateConnectionId\s*,\s*metaWabaIdSnapshot\s*,[^}]*\.\.\.\w+\s*\}\s*=\s*template;/` — that verifies `metaTemplateConnectionId` and `metaWabaIdSnapshot` are excluded from the response via a rest spread, tolerating any additional destructured fields (such as `clinicId: _clinicId`) in between, rather than matching one exact field list. **No production code changed** — confirmed by `git show --stat` on PR #204's sole commit (`fdaded7`), which touches only the one test file (6 insertions, 2 deletions). `server/src/tests/messageTemplateWabaBinding.test.ts` now passes **20/20**, independently re-confirmed by this reconciliation.

This resolves the sole documented test failure referenced by PR #202's 549/550 combined post-merge verification result (§1); no other test file or assertion in that verification is affected.

This test-only cleanup did not block the deployment gate before PR #204 merged (§5's `npx prisma migrate deploy`/`pm2 reload` never depended on this test file's own exit status), and does not need to be re-checked as a precondition now that it is fixed. The production deployment gate defined above was, and remains, not blocked by this item.

---

## 11. What this task did and did not do

- Verified `origin/main` and all ten PR merge commits' ancestry (§1) — did not modify any of them.
- Independently re-derived the deployment-impact matrix and migration count from `git diff`/directory listing (§4) — did not assume PR #202/#203's own claims without re-checking.
- Authored this document, plus updates to [CURRENT_PHASE.md](../CURRENT_PHASE.md), [NORAMEDI_MASTER_TRACKER.md](../NORAMEDI_MASTER_TRACKER.md), [RISK_REGISTER.md](../RISK_REGISTER.md), and [phases/F0_BASELINE_AND_VALIDATION.md](../phases/F0_BASELINE_AND_VALIDATION.md).
- Did not deploy anything, did not access production, did not run any command in §5, §6, or §7 against a real environment.
- Did not modify runtime code, tests, migrations, or environment configuration.
- Did not close, mitigate, or otherwise change the status of R-071 or R-061 beyond the composite in-progress status recorded in the accompanying tracker updates — both remain `OPEN`.
- **Reconciliation (2026-07-22):** fetched `origin/main`, confirmed PR #204 merged and an ancestor of the new tip, inspected its diff for overlap (none), and merged it into this branch via a normal merge commit (no rebase, no force-push). Updated this document's baseline SHA, PR table (§1), migration-count reassessment (§4.3), and WABA test status (§10) accordingly. Did not deploy anything, did not access production, and did not modify any file outside the five documentation files this task is scoped to.

# DATA-INTEGRITY-001 — Production Deployment Gate and Synthetic Smoke Package

**Task type:** Documentation and program-control only. No deployment, no production access, no SSH, no credentials requested, no runtime code modified by this task.
**Worktree:** `D:\Mustafa\Siteler\DisKlinikCRM-worktrees\data-integrity-001-production-gate`, branch `docs/data-integrity-001-production-gate`, created from freshly-fetched `origin/main` @ `8906e66af5169220a4aed48fe4cfea8524976fb8`.
**Baseline:** [PR #212](https://github.com/MustafaBasol/DisKlinikCRM/pull/212) (`fix/appointment-request-conversion-atomicity`), merge commit `8906e66af5169220a4aed48fe4cfea8524976fb8` — independently re-verified as the current `origin/main` tip via `git fetch origin && git rev-parse origin/main`, both returning the identical SHA. No drift between the assigned baseline and live `origin/main` at task start.
**Prior evidence this document builds on (not modified by this task):** [DATA-INTEGRITY-001-F1_APPOINTMENT_REQUEST_CONVERSION_ATOMICITY_IMPLEMENTATION.md](DATA-INTEGRITY-001-F1_APPOINTMENT_REQUEST_CONVERSION_ATOMICITY_IMPLEMENTATION.md) (implementation evidence, pre-merge), `DATA-INTEGRITY-001-R2_INDEPENDENT_VERIFICATION.md` (independent diff/DB-backed re-verification, pre-merge, PR #212 still `OPEN` at authoring time). Both predate the merge this document's baseline SHA represents.

## 0. Purpose and non-authorization statement

This document defines the exact, safe, operator-run sequence for deploying PR #212's merged commit (`8906e66`) to production — a backend-only restart with no migration and no frontend rebuild — followed by a production-safe synthetic smoke package exercising the appointment-request conversion atomicity fix. **It does not execute any of that sequence.** No production command anywhere below has been run by this task. Production has not been accessed, SSH has not been used, and no credential of any kind was requested or handled. This document's own classification (§8) is `PREPARED_NOT_EXECUTED`.

---

## 1. Files reviewed for this task

Exactly these paths were read, at the baseline commit `8906e66` unless otherwise noted:

- `server/src/routes/appointmentRequests.ts` (conversion route, lines 208–460)
- `server/src/services/appointmentRequestSafety.ts` (advisory-lock and conflict-assertion helpers)
- `server/src/services/appointments/appointmentAvailabilityService.ts` (overlap/conflict detection)
- `server/src/schemas/index.ts` (lines ~397–410, `appointmentRequestConvertSchema`)
- `scripts/noramedi-deploy.sh`, `scripts/noramedi-healthcheck.sh` (production deploy/health conventions)
- `docs/program/evidence/KVKK-HIGH-006-PRODUCTION_DEPLOYMENT_GATE.md`, `docs/program/evidence/F0-011-P3_KVKK_HIGH008_F1_PRODUCTION_DEPLOYMENT_EVIDENCE.md` (house style/precedent for this genre of document)
- `docs/program/evidence/DATA-INTEGRITY-001-F1_APPOINTMENT_REQUEST_CONVERSION_ATOMICITY_IMPLEMENTATION.md` (direct technical parent)
- `server/src/tests/dbVerification/appointmentRequestConversionAtomicity.test.ts` (fixture-naming and scenario-shape precedent)
- `server/package.json` (script names only — `start`, `start:worker`, `typecheck`)
- `git diff --stat bda3880^1 bda3880` and `git diff --stat ... -- '**/schema.prisma' '**/prisma/migrations/*'` (independently re-confirmed empty — no migration/schema file in this diff)
- `docs/22-hostinger-vps-postgres-deploy-plan.md`, `docs/35-docker-deploy-runbook.md` were opened but found to be generic/stale from-scratch setup templates that do not match the actual production conventions demonstrated in `scripts/noramedi-deploy.sh` and the evidence docs above (different PM2 process name, different install method) — **not used as the basis for §5 below**; the deploy-script/evidence-doc convention was used instead as it reflects what is demonstrably in production use.

No other file was read. No file was modified except this new document.

---

## 2. Pre-deployment identity evidence (commands only — none executed against production)

All of the following must be captured **on the production host** by the operator before any command in §5 runs. This task supplies the exact commands and the expected/target values; it does not supply live production readings, since this task does not access production.

| Field | How to capture (operator, on `disklinik-prod-01`) | Expected/target value |
|---|---|---|
| Current production SHA | `git -C /var/www/noramedi rev-parse HEAD` | Whatever is currently deployed — **not independently known by this task**; record verbatim, this is `PRE_DEPLOY_SHA` for §7's rollback |
| Current production branch | `git -C /var/www/noramedi rev-parse --abbrev-ref HEAD` | `main` |
| Target SHA | — (fixed by this document) | `8906e66af5169220a4aed48fe4cfea8524976fb8` (PR #212 merge commit) |
| Production git status | `git -C /var/www/noramedi status --short` | Must be **empty**. Non-empty is a stop condition (§8) — do not `git checkout .` / `git clean -fd` without investigating first |
| PM2 backend service identity | `pm2 jlist \| node -e "const p=JSON.parse(require('fs').readFileSync(0,'utf8'));for(const x of p){if(x.name==='noramedi-api'||x.name==='noramedi-worker')console.log(x.name,x.pm2_env.status,'restarts='+x.pm2_env.restart_time)}"` | Both processes `online`; restart counts recorded as the pre-deploy baseline for post-deploy comparison |
| Health endpoint (local) | `curl -s -o /dev/null -w 'health status: %{http_code}\n' http://127.0.0.1:5000/api/health` | `200` |
| Health endpoint (public) | `curl -s -o /dev/null -w 'public health: %{http_code}\n' https://api.noramedi.com/api/health` | `200`, body `{"status":"ok"}` per prior deployment evidence ([F0-011-P3](F0-011-P3_KVKK_HIGH008_F1_PRODUCTION_DEPLOYMENT_EVIDENCE.md) §5) |
| Migration status (read-only) | `(cd /var/www/noramedi/server && npx prisma migrate status)` | `Database schema is up to date` — must show **zero pending migrations**, since this deployment ships none (§3) |

This task does not know, and does not claim to know, the live production SHA/PM2 state/health response at the moment this document is read — those are operator-captured facts at execution time, not facts this document can supply in advance.

---

## 3. Deployment impact

Independently re-derived from `git diff bda3880^1 bda3880` (PR #212's single fix commit, identical in content to merge commit `8906e66` — confirmed by matching diffstat):

| Action | Required? | Basis |
|---|---|---|
| Backend rebuild | **Not applicable** | No compiled-build step exists for the backend — production runs `tsx` directly against TypeScript source (`server/package.json` `start` = `npx prisma generate && tsx src/index.ts`). "Rebuild" here means: install deps (if lockfile changed), regenerate the Prisma client, restart the process. |
| Backend restart/reload | **Required** | `server/src/routes/appointmentRequests.ts`, `server/src/services/appointmentRequestSafety.ts`, `server/src/services/appointments/appointmentAvailabilityService.ts` all changed — these serve the live conversion route |
| Frontend rebuild | **Not required** | Zero files under any client/frontend path changed — diffstat is 8 files, all under `server/` plus one `docs/program/evidence/` file |
| Migration | **Not required — none exists** | `git diff --stat bda3880^1 bda3880 -- '**/schema.prisma' '**/prisma/migrations/*'` returns empty. Independently confirmed: no `server/prisma/**` path appears anywhere in the 8-file diffstat |
| Schema change | **None** | Same basis as above — no Prisma schema file touched |
| Environment variable change | **None** | No new `process.env.*` reference introduced — the diff adds one advisory-lock helper and a transaction wrapper, no new configuration surface |
| `npm ci` (backend deps) | **Verify before executing** | `server/package.json` diff (part of the 3-line change) is confirmed to be `test:*` script-alias/description only — no `dependencies`/`devDependencies` block touched. Safe default is to still run it (standing deploy-script behavior), skippable only after confirming the lockfile is unchanged |
| `prisma generate` | **Required (standing behavior)** | Runs unconditionally on every process start (`start` script) and is step 4 of the standard deploy script regardless of this diff |
| `prisma migrate deploy` | **Confirmed safe no-op** | No pending migration exists in this diff; running it anyway keeps the deploy sequence uniform per standing convention |
| PM2 `noramedi-api` reload | **Required** | Serves the changed routes |
| PM2 `noramedi-worker` reload | **Not required** | No file imported by `server/src/worker.ts`'s job-registration path changed — the diff is Express route handlers and services, not a worker job file |
| Nginx/proxy config | **Not required** | No route path, hostname, or proxy-relevant surface changed |

**Net classification: backend-only, non-migration, non-schema, dependency-unchanged, environment-unchanged restart.**

---

## 4. Exact operator commands (prepared, **not executed**)

To be run manually by an authorized operator on the production host, from `/var/www/noramedi`. This task does not run any of these.

```bash
# ── 4.0 Preconditions (read-only; see §2 for the full checklist) ────────────
cd /var/www/noramedi || exit 1

echo "--- Pre-deploy baseline ---"
PRE_DEPLOY_SHA=$(git rev-parse HEAD)
echo "Pre-deploy SHA: $PRE_DEPLOY_SHA"
git rev-parse --abbrev-ref HEAD
git status --short   # MUST be empty — abort if not (§8)

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

# ── 4.1 Fetch and fast-forward only — never merge/rebase on production ──────
git fetch origin
TARGET_SHA=$(git rev-parse origin/main)
echo "Target SHA (origin/main): $TARGET_SHA"
echo "Expected target SHA:      8906e66af5169220a4aed48fe4cfea8524976fb8"
# Abort here if these two values do not match, unless a newer tip has been
# separately and explicitly reviewed/approved for this deployment (§8).
git merge-base --is-ancestor "$PRE_DEPLOY_SHA" origin/main || {
  echo "ABORT: current production HEAD is not an ancestor of origin/main — do not force."
  exit 1
}
git pull --ff-only

# ── 4.2 Install dependencies (verify-before-execution — see §3) ─────────────
cd server
npm ci   # safe default; skip only after confirming package-lock.json is unchanged

# ── 4.3 Migration status confirmation (no pending migration expected) ───────
npx prisma migrate deploy     # confirmed safe no-op — no new migration ships (§3)
npx prisma migrate status     # MUST report "Database schema is up to date"

# ── 4.4 Typecheck (backend has no compiled build; this is the closest gate) ─
npx prisma generate && npx tsc --noEmit   # server/package.json "typecheck" script
cd ..

# ── 4.5 Reload only the required PM2 process ────────────────────────────────
pm2 reload noramedi-api --update-env
sleep 2
# noramedi-worker: NOT reloaded — see §3. Only reload it if a separate,
# explicit decision extends this deployment's scope to the worker.

# ── 4.6 Health verification ──────────────────────────────────────────────────
scripts/noramedi-healthcheck.sh --local --max-attempts 12 --interval 5
curl -s -o /dev/null -w 'public API health: %{http_code}\n' https://api.noramedi.com/api/health

echo "--- Post-deploy PM2 state ---"
pm2 jlist | node -e "
const procs = JSON.parse(require('fs').readFileSync(0, 'utf8'));
for (const p of procs) {
  if (p.name === 'noramedi-api' || p.name === 'noramedi-worker') {
    console.log(p.name, p.pm2_env.status, 'restarts=' + p.pm2_env.restart_time);
  }
}
"

# ── 4.7 Narrowly-scoped log collection (no secrets) ──────────────────────────
pm2 logs noramedi-api --lines 100 --nostream | grep -E \
  "error|Error|5[0-9][0-9]" \
  | sed -E 's/("email":")[^"]*(")/\1[REDACTED]\2/g'

# ── 4.8 Record rollback information ──────────────────────────────────────────
echo "Pre-deploy SHA (rollback target): $PRE_DEPLOY_SHA"
echo "Post-deploy SHA: $(git rev-parse HEAD)"
```

Note: `scripts/noramedi-deploy.sh` already implements steps 4.1–4.6 in this order (`git pull --ff-only` → `npm ci` → `migrate deploy` → `prisma generate` → `pm2 reload noramedi-api` → healthcheck) and may be used directly (`noramedi-deploy.sh`, no flags needed — nothing in this deploy should be skipped) in place of the hand-run commands above. It does not perform 4.0's baseline capture, 4.4's typecheck, 4.7's log collection, or 4.8's rollback-SHA recording — those four should still be run around it manually. **No broad cleanup/reset command (`git clean`, `git checkout .`, `git reset --hard` beyond the documented rollback in §7) appears anywhere in this sequence, and none should be added.**

---

## 5. Synthetic smoke scenarios (production-safe)

**Hard constraint for every scenario: no real patient name, phone number, email address, or clinical data is used at any step.** Fixture naming follows the codebase's own established synthetic-data convention (confirmed in `appointmentRequestConversionAtomicity.test.ts`): `555`-prefixed Turkish-format phone numbers and `@example.invalid` email addresses (RFC 2606-reserved, guaranteed never to resolve or deliver), plus an explicit "synthetic" label on every fixture row.

**Suggested fixture-naming pattern for this run**, using a run-specific suffix (e.g. last 8 hex digits of a generated UUID, `<SFX>` below) so repeated smoke runs never collide:

- Patient display name: `DI001 Smoke Patient <SFX>`
- Phone: `+905550001<NNN>` (`<NNN>` = 3-digit scenario index, e.g. `001` for SM-1, `002` for SM-2, …)
- Email (new-patient path only): `di001-smoke-<SFX>@example.invalid`
- Appointment/request notes: `DI001 production smoke test — synthetic, safe to delete`

All scenarios require a pre-existing synthetic clinic, a synthetic `AppointmentType`, and a synthetic `DENTIST`-role practitioner already assigned to that clinic (or freshly created synthetic ones, cleaned up alongside the rows below) — none of these should be a real clinic's live scheduling resource.

| # | Scenario | Precondition | Action | Expected result | Rows created |
|---|---|---|---|---|---|
| SM-1 | Successful conversion, existing synthetic patient | One synthetic `Patient` (`DI001 Smoke Patient <SFX>-existing`) and one `pending` `AppointmentRequest` referencing it, targeting a free synthetic slot | `POST /api/appointment-requests/:id/convert` with `patientId` set to the existing synthetic patient's id | `201`, body `{ appointment, request }`; `request.status === 'converted'`, `request.convertedAppointmentId === appointment.id`, `request.patientId` unchanged | 1 `Appointment` |
| SM-2 | Successful conversion, new synthetic patient | One `pending` `AppointmentRequest` with **no** `patientId` set on the request itself, `patientName`/`phone`/`email` populated with synthetic values, targeting a free synthetic slot | `POST .../convert` with body omitting `patientId` | `201`; a new `Patient` row created with the request's synthetic name/phone/email, `communicationConsent: true`; `request.patientId` now points at the new patient | 1 `Patient`, 1 `Appointment` |
| SM-3 | Duplicate conversion rejected | The request from SM-1 or SM-2, now `status: 'converted'` | Repeat the identical `POST .../convert` call against the same request id | `400 { error: 'Appointment request is already converted' }`. No new `Appointment`, no new `Patient` | none |
| SM-4 | Same request, different override, still rejected | Same already-converted request as SM-3 | `POST .../convert` again on the same request id, this time with a **different** `practitionerId`/`startTime` override than the original conversion used | `400 { error: 'Appointment request is already converted' }` — the request-scoped advisory lock (`acquireAppointmentRequestConversionLock`) serializes on the request id regardless of which slot the override targets, so a different override cannot bypass the already-converted check. No new `Appointment`, no new `Patient` | none |
| SM-5 | Occupied slot conflict | A second `pending` synthetic `AppointmentRequest` (different request, same synthetic practitioner) whose preferred slot exactly overlaps SM-1/SM-2's now-booked `Appointment` | `POST .../convert` on this second request, with no override (uses its own preferred slot) | `409`, body `code: 'APPOINTMENT_OVERLAP'` (if the conflict is against the created `Appointment`) — request remains `pending`, no rows created | none |
| SM-6 | No orphan synthetic `Patient` after failed conversion | A third `pending` synthetic `AppointmentRequest` with no `patientId` (new-patient path) whose preferred slot is deliberately the same occupied slot as SM-5 | `POST .../convert` on this request, no override | `409 APPOINTMENT_OVERLAP` or `APPOINTMENT_REQUEST_CONFLICT`. Query `Patient` table for any row matching this request's synthetic name/phone created during/after this call — **must find none** (transaction rolled back before patient-create commits, per the fix's transaction boundary) | none (verified absence) |
| SM-7 | No orphan `Appointment` after failed conversion | Same request as SM-6 | Same call as SM-6 | Query `Appointment` table for any row with this request's synthetic practitioner + the conflicting slot beyond the one already created by SM-1/SM-2/SM-5 — **must find none** | none (verified absence) |
| SM-8 | Request references only the winning `Appointment` | SM-1 or SM-2's converted request | Query the request row directly (`GET` the request, or a direct read) | `convertedAppointmentId` equals exactly one `Appointment.id` — the one created by the winning (first, successful) conversion attempt; never a second/different id from any of SM-3–SM-7's rejected attempts | none (read-only) |

**Order of execution:** SM-1 (or SM-2) → SM-3 → SM-4 → SM-5 → SM-6 → SM-7 → SM-8. Running the successful conversion first is required — SM-3 through SM-8 all depend on a request already in the `converted` state or a slot already occupied by it.

**Global abort condition for this smoke package:** if any scenario touches, returns, or logs anything resembling real patient PII/PHI at any point — even accidentally, even in a field not under test — stop immediately and treat it as a P0 finding requiring its own incident handling, separate from this smoke package's own pass/fail result.

---

## 6. Safety, row identification, and cleanup

**Safety constraint (repeated for emphasis):** every fixture above uses synthetic names, `555`-prefixed phone numbers, and `@example.invalid` email addresses. No real patient identifier of any kind is used, queried against, or returned in any evidence capture.

**Row identification (every row created by §5 must be individually identifiable before cleanup):**

```sql
-- Run read-only, before any DELETE, to enumerate every row this smoke run created.
-- Replace <SFX> with the actual run-specific suffix used.

SELECT id, "firstName", "lastName", phone, email, "createdAt"
FROM "Patient"
WHERE phone LIKE '+905550001%' AND email LIKE 'di001-smoke-%@example.invalid';

SELECT id, "patientId", "practitionerId", "startTime", "endTime", notes, "createdAt"
FROM "Appointment"
WHERE notes LIKE '%DI001 production smoke test%';

SELECT id, status, "patientName", phone, "convertedAppointmentId", "createdAt"
FROM "AppointmentRequest"
WHERE phone LIKE '+905550001%';
```

**Deterministic cleanup (delete in FK-safe order — requests reference appointments via `convertedAppointmentId`, appointments/requests reference patients):**

```sql
-- 1. Clear the FK from AppointmentRequest to Appointment first.
UPDATE "AppointmentRequest" SET "convertedAppointmentId" = NULL
WHERE phone LIKE '+905550001%';

-- 2. Delete the AppointmentRequest rows.
DELETE FROM "AppointmentRequest" WHERE phone LIKE '+905550001%';

-- 3. Delete the Appointment rows.
DELETE FROM "Appointment" WHERE notes LIKE '%DI001 production smoke test%';

-- 4. Delete the Patient rows created by the new-patient path (SM-2).
DELETE FROM "Patient"
WHERE phone LIKE '+905550001%' AND email LIKE 'di001-smoke-%@example.invalid';
```

Every `DELETE` above is scoped by the run-specific phone/email/notes pattern established in §5 — **no unrelated record can match these filters** as long as no real patient is ever assigned a `555`-prefixed synthetic phone or an `@example.invalid` email (neither pattern is used anywhere else in the schema per the codebase's own convention). Re-run the read-only `SELECT`s above after cleanup and confirm zero rows remain before considering cleanup complete. If a synthetic clinic/practitioner/appointment-type was created solely for this smoke run (rather than reused from an existing test fixture set), delete those last, after confirming no other row still references them.

**Do not delete unrelated records.** No cleanup command in this section uses a broad predicate (no bare `DELETE FROM "Appointment"`, no date-range-only filter, no clinic-wide filter) — every filter is anchored to this run's own synthetic phone/email/notes markers.

---

## 7. Rollback

- **Previous commit/artifact:** `PRE_DEPLOY_SHA`, captured live at §4.0 — the operator must record the actual value at execution time; this document does not know it in advance.
- **Backend rollback commands:**
  ```bash
  cd /var/www/noramedi
  git status --short   # confirm clean before rolling back
  git checkout "$PRE_DEPLOY_SHA"
  cd server
  npm ci   # only if package-lock.json differs from what's currently installed
  npx prisma generate
  cd ..
  pm2 reload noramedi-api --update-env
  # Harder fallback if reload is unhealthy:
  # pm2 restart noramedi-api
  ```
- **Health verification after rollback:** re-run §4.6 in full — `scripts/noramedi-healthcheck.sh --local --max-attempts 12 --interval 5` plus the public health curl — and confirm PM2 `restart_time` incremented only by the expected rollback-triggered restart, not repeatedly (a crash-loop signature).
- **No DB rollback required.** This deployment ships no migration and no schema change (§3) — an application-only rollback (checkout previous SHA, regenerate Prisma client, reload PM2) is fully sufficient. `prisma migrate deploy`/`migrate status` do not need to be re-run as part of rollback since nothing was migrated forward.
- **Preference for forward-fix:** since this deployment is a backend-only concurrency-safety fix with no migration, prefer a forward-fix commit over a rollback unless the defect found post-deploy is severe (e.g. the fix itself is causing an active regression in the conversion path) — in which case the rollback above is safe and sufficient.

---

## 8. Evidence classification and stop conditions

**Classification: `PREPARED_NOT_EXECUTED`.** Deployment has not been performed. Production has not been accessed, verified, or modified by this task. No command in §4, §5, §6, or §7 has been run against a real environment.

**Stop conditions — any one of the following must halt the sequence in §4 before proceeding further, and must be resolved (not worked around) before continuing:**

1. **Dirty production tree** — §4.0's `git status --short` returns non-empty output. Investigate before proceeding; do not `git checkout .` / `git clean -fd` without first understanding what is present.
2. **Target SHA mismatch** — §4.1's `git rev-parse origin/main` does not equal `8906e66af5169220a4aed48fe4cfea8524976fb8`, and no newer tip has been separately, explicitly reviewed and approved for this deployment.
3. **Build/typecheck failure** — §4.4's `npx tsc --noEmit` reports any error.
4. **Health failure** — §4.6's healthcheck script exhausts its full 12-attempt/60-second retry window without a healthy response, or the public health endpoint returns anything other than `200 {"status":"ok"}`.
5. **Unexpected migration** — §4.3's `npx prisma migrate deploy` reports anything other than "no pending migrations"/a clean no-op apply. Since this diff ships zero migration files (§3), any actual migration activity here is unexpected and must stop the sequence for investigation before continuing — do not assume it is safe because the tool ran without erroring.
6. **Inability to isolate synthetic fixtures** — if, at execution time, no confirmed-safe synthetic clinic/practitioner/appointment-type set is available and one cannot be created and clearly labeled per §5/§6's naming convention, the smoke package in §5 must not be run against real clinic data as a substitute. Mark the affected scenarios "not safely executable" rather than improvising around missing fixtures.

Any of these triggers a stop and, where a change has already been made, the rollback in §7 — not a "wait and see."

---

## 9. What this task did and did not do

- Reviewed `server/src/routes/appointmentRequests.ts`, `server/src/services/appointmentRequestSafety.ts`, `server/src/services/appointments/appointmentAvailabilityService.ts` at baseline `8906e66` — did not modify any of them.
- Independently re-confirmed the PR #212 diff introduces no migration/schema file, no frontend file, no new environment variable, and no dependency version change (§3).
- Reviewed `scripts/noramedi-deploy.sh`, `scripts/noramedi-healthcheck.sh`, and three prior deployment-gate evidence docs to derive house-consistent PM2 process names (`noramedi-api`), the health-check convention (401/200 = healthy, local + public URLs), and the "prepared, not executed" document genre.
- Authored this single document (`docs/program/evidence/DATA-INTEGRITY-001_PRODUCTION_DEPLOYMENT_GATE.md`). Did not update `RISK_REGISTER.md`, `NORAMEDI_MASTER_TRACKER.md`, `CURRENT_PHASE.md`, or any phase file — those were not part of this task's scope and no tracker entry for `DATA-INTEGRITY-001` exists at this baseline to reconcile.
- Did not deploy anything, did not access production, did not run any command in §4, §5, §6, or §7 against a real environment.
- Did not run SSH, did not request or handle any credential.
- Did not modify runtime code, tests, migrations, or environment configuration.
- Did not commit, push, or open a pull request — this document exists only in the local worktree listed above.

---

## 10. Exact operator next step

A human operator with production access must:
1. Capture the §2 pre-deployment identity evidence table on the production host.
2. Confirm no stop condition (§8) is already present.
3. Run §4's sequence (or `scripts/noramedi-deploy.sh` plus the four manual steps it doesn't cover).
4. Execute the §5 synthetic smoke package in order, capturing evidence for each scenario.
5. Run §6's cleanup and re-verify zero synthetic rows remain.
6. If any stop condition triggers, execute §7's rollback and re-verify health.
7. Record the outcome in a follow-up execution-evidence document (this document's own companion, analogous to `KVKK-HIGH-006-PRODUCTION_DEPLOYMENT_AND_SMOKE_VERIFICATION.md`) — not produced by this task.

This document does not perform any of the above itself.

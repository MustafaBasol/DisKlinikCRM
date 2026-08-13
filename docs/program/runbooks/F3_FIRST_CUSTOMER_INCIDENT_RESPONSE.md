# F3-IR-001 — First-Customer Incident Response Runbook

**Task ID:** F3-IR-001
**Phase:** F3 — Production Hardening
**Type:** Documentation/runbook only. **No production application behavior was modified by this task.**
**Baseline:** `origin/main` @ `92fc0c0c5eee34ae71bd2508bbfcc2f0309e3055`, clean, no drift at task start.
**Status:** `AGENT_COMPLETED` / `DOC_VALIDATION_PASSED` — `NOT_MERGED` / `NOT_DEPLOYED` / `NOT_PRODUCTION_VERIFIED` / `NOT_A_REAL_INCIDENT_DRILL` (see the companion tabletop-drill evidence file for the `SIMULATED`/`NOT_PRODUCTION_VERIFIED` tabletop exercise this runbook was validated against).

## 0. Purpose, scope, and non-authorization statement

This document defines NoraMedi's first-customer incident-response procedures: severity classification, per-scenario runbooks, and the KVKK personal/health-data breach path. It does **not** itself constitute a legally-approved breach-response plan (see [docs/compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md](../../compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md), which records "written breach-response plan content — not yet legally approved"), does not authorize any destructive production action, and does not itself close any [`RISK_REGISTER.md`](../RISK_REGISTER.md) row. Every command below is either read-only or a documented, already-existing operational action (`pm2 restart`, `scripts/noramedi-deploy.sh`, the platform-admin API); none of them were newly invented by this task, and none are destructive (no `DROP`, no `rm -rf`, no force-push, no production data mutation outside the platform-admin API's own existing, audited mutation routes).

This runbook covers the **first-customer / controlled-pilot scale** described in [LAUNCH_GATES.md](../LAUNCH_GATES.md) §2 (G1) — a small, monitored cohort on the current bare-VPS + PM2 + single-Postgres topology. It does not assume monitoring/alerting tooling that does not yet exist (ADR-012 `DEFERRED` — see [PRODUCTION_TOPOLOGY.md](../PRODUCTION_TOPOLOGY.md) §7, [LAUNCH_GATES.md](../LAUNCH_GATES.md) §2.F "Monitoring/alert evidence"); every "Detection" section below is written for manual/human-operator detection (log inspection, health-check polling, platform-admin dashboard review), consistent with LAUNCH_GATES.md's own accepted G1-scale substitution of manual monitoring for tooling that is mandatory only at G2.

**Decision authority.** Per [NORAMEDI_MASTER_TRACKER.md](../NORAMEDI_MASTER_TRACKER.md) §2.3 and [LAUNCH_GATES.md](../LAUNCH_GATES.md)'s repeated "no agent may self-approve" rule, no automated process or agent may unilaterally suspend a paying clinic/organization, rotate a platform-wide secret, or declare an incident closed. Every SEV-1 action in this document that has a customer-visible or irreversible consequence (tenant suspension, secret rotation, schema rollback) requires the decision owner (User, per LAUNCH_GATES.md's established pattern) in the loop — the runbooks below say so explicitly at each such step, not just here.

## 1. Incident severity classification

Severity is assigned by the responding operator at first triage (the `open` → `acknowledged` transition in the [`SecurityIncident`](../../../server/src/services/security/securityIncidentService.ts) lifecycle, where applicable) and may be escalated as impact becomes clearer. This SEV-1/2/3 scale is this document's own incident-response classification; it is distinct from, but references, the existing `SecurityIncident.severity` field (`low`/`medium`/`high`/`critical`, [`securityIncidentService.ts`](../../../server/src/services/security/securityIncidentService.ts) `INCIDENT_SEVERITIES`) used by the automated detection rules in [`securityDetectionRules.ts`](../../../server/src/services/security/securityDetectionRules.ts) — a `critical`/`high` automated `SecurityIncident` is a strong signal for SEV-1, not an automatic override of operator judgment.

| SEV | Meaning | Response expectation |
|---|---|---|
| **SEV-1** | Confirmed or strongly suspected: cross-tenant data exposure, credential compromise, database corruption/loss, patient/PHI exposure, or total production outage. | Immediate, all-available-hands, decision owner notified without delay. |
| **SEV-2** | Worker failure, messaging-provider outage, backup failure, major API degradation, or payment/integration operational failure — service is degraded, not fully down, and no confirmed data exposure/loss. | Urgent, same-business-day response; escalate to SEV-1 if scope grows. |
| **SEV-3** | A bounded single-tenant issue, a recoverable background-job failure (self-heals or resolves with a routine restart), or non-critical provider degradation. | Scheduled/next-business-day response; no emergency action required. |

### SEV-1 — concrete NoraMedi examples

- **Cross-tenant exposure:** a `SecurityIncident` with `category: 'cross_tenant_access'` (detected by [`securityDetectionRules.ts`](../../../server/src/services/security/securityDetectionRules.ts)) is confirmed, not a false positive — e.g. one organization's patients, appointments, or WhatsApp/Instagram conversation records become visible to another organization's users. This program has already found and traced one related raw-SQL scoping question ([`F0-009-S1_SECURITY_INCIDENT_TENANT_OWNERSHIP_EVIDENCE.md`](../evidence/F0-009-S1_SECURITY_INCIDENT_TENANT_OWNERSHIP_EVIDENCE.md), confirmed safe on inspection) — the pattern of concern is real, not hypothetical.
- **Credential compromise:** `JWT_SECRET`, `PLATFORM_JWT_SECRET`, or `ENCRYPTION_KEY` leaked; a platform-admin account password/session compromised (see [`R061_PLATFORM_ADMIN_PASSWORD_RECOVERY_RUNBOOK.md`](../evidence/R061_PLATFORM_ADMIN_PASSWORD_RECOVERY_RUNBOOK.md) for the precedent of a platform-admin account needing operator recovery).
- **Database corruption/loss:** the single production PostgreSQL instance (no PITR — `RISK_REGISTER.md` R-031, no offsite backup — R-030) suffers unrecoverable data loss, or a manual schema rollback desynchronizes `_prisma_migrations` from actual schema state (R-070).
- **Patient/PHI exposure:** any patient medical history, dental chart, imaging/DICOM record, or KVKK consent record is disclosed to an unauthorized party (outside its owning clinic, or to an unauthenticated caller).
- **Total production outage:** `GET /api/health` unreachable/failing on both the public endpoint and `127.0.0.1:5000` — `noramedi-api` down, or the VPS itself unreachable.

### SEV-2 — concrete NoraMedi examples

- **Worker failure:** `noramedi-worker` PM2 process crashed or stuck — since [F3-IMPL-002](../evidence/F3-IMPL-002_PRODUCTION_WORKER_PROCESS_CONTRACT.md), the worker is the intended sole owner of all 9 background jobs (`RUN_BACKGROUND_JOBS=false` on the API app in [`ecosystem.config.cjs`](../../../ecosystem.config.cjs)) — reminders, data-retention cleanup, file-backup, and external-calendar sync all silently stop.
- **Messaging provider outage:** Meta Cloud WhatsApp API or the Evolution WhatsApp provider, or the Instagram provider, returns persistent errors — patient-facing reminders/messages fail to send.
- **Backup failure:** `GET /api/platform/backups/status` shows no recent successful run, or the file-backup job ([`fileBackupJob.ts`](../../../server/src/jobs/fileBackupJob.ts)) fails — recovery *capability* is degraded even though no data has been lost yet.
- **Major API degradation:** `/api/health` intermittently returns `503 {"status":"degraded"}` (the 3-second DB-timeout race in [`index.ts`](../../../server/src/index.ts)), or an elevated 5xx rate on a subset of routes — not a full outage.
- **Payment/integration operational failure:** SMS-provider failures, DigiDentiS external-calendar sync failures, Meta template-sync job failures.

### SEV-3 — concrete NoraMedi examples

- **Bounded tenant issue:** a single clinic's WhatsApp connection or external-calendar mapping is misconfigured (e.g. the class of bug fixed in [`F3-DIGIDENTIS-MAP-001`](../evidence/F3-DIGIDENTIS-MAP-001_NORAMEDI_PRACTITIONER_DROPDOWN_ROOT_CAUSE.md)) — no evidence of a systemic defect.
- **Recoverable background-job failure:** a single job tick fails and is naturally retried/self-heals on the next tick (the `JobLock`-protected, 5-minute-interval reminder jobs — see §5.2 below) with no patient-facing impact.
- **Non-critical provider degradation:** a single imaging-bridge instance reports offline via [`imagingBridgeOfflineJob.ts`](../../../server/src/jobs/imagingBridgeOfflineJob.ts), or a single external-calendar inbound retry needs another attempt.

## 2. Common operator toolkit

Every runbook below reuses this toolkit. All commands are read-only unless explicitly marked **[MUTATING]**. Never paste a secret value (`DATABASE_URL`, session cookie, JWT, provider token) into a shared incident channel — reference it by name only, matching this repository's own `getSecret()`/backup-script convention of never printing secret values (see [`server/src/utils/secrets.ts`](../../../server/src/utils/secrets.ts), [`server/src/services/backupService.ts`](../../../server/src/services/backupService.ts) `runRestoreTest()`'s `tempDbName: '[redacted-test-db]'` pattern).

```bash
# ── Git SHA verification (run from APP_DIR on the VPS, default /var/www/noramedi) ──
cd /var/www/noramedi && git log -1 --format='%H %ci'
cd /var/www/noramedi && git status --short          # confirm no uncommitted drift

# ── PM2 process inventory ──
pm2 list
pm2 jlist                                            # machine-readable status/restart-count/uptime
pm2 describe noramedi-api
pm2 describe noramedi-worker

# ── Bounded log tail (never an unbounded `pm2 logs` with no --lines/--nostream during
#    an incident — it streams forever and the actual error scrolls off under new noise) ──
pm2 logs noramedi-api --lines 200 --nostream
pm2 logs noramedi-worker --lines 200 --nostream

# ── API health ──
curl -s -o /dev/null -w '%{http_code}\n' https://api.noramedi.com/api/health
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5000/api/health
/usr/local/sbin/noramedi-healthcheck.sh --local --max-attempts 3 --interval 5

# ── Worker liveness — no HTTP endpoint exists by design (LAUNCH_GATES.md §3.F accepts
#    PM2 status as the sole worker liveness signal); this is the exact status-extraction
#    pattern scripts/noramedi-deploy.sh's own verify_pm2_online() helper uses ──
pm2 jlist | node -e '
  let raw = ""; process.stdin.on("data", c => raw += c);
  process.stdin.on("end", () => {
    const apps = JSON.parse(raw);
    const w = apps.find(a => a.name === "noramedi-worker");
    console.log(w && w.pm2_env ? w.pm2_env.status : "missing");
  });'

# ── Database reachability (read-only) ──
pg_isready -h 127.0.0.1 -p 5432
psql "$DATABASE_URL" -c 'SELECT 1;'                  # never echo $DATABASE_URL itself

# ── Disk / memory (a full-disk or memory-pressure event underlies several runbooks) ──
df -h /
free -m

# ── Platform-admin API (authenticated platform-admin session cookie required;
#    $PLATFORM_SESSION_COOKIE below is a placeholder, never a literal value) ──
curl -s -b "$PLATFORM_SESSION_COOKIE" https://api.noramedi.com/api/platform/backups/status
curl -s -b "$PLATFORM_SESSION_COOKIE" 'https://api.noramedi.com/api/platform/backups/logs?lines=200'
curl -s -b "$PLATFORM_SESSION_COOKIE" https://api.noramedi.com/api/platform/file-backups/status
curl -s -b "$PLATFORM_SESSION_COOKIE" https://api.noramedi.com/api/platform/security/summary
curl -s -b "$PLATFORM_SESSION_COOKIE" 'https://api.noramedi.com/api/platform/security/incidents?status=open'
curl -s -b "$PLATFORM_SESSION_COOKIE" 'https://api.noramedi.com/api/platform/security/incidents/<id>/activity'

# ── Deploy / restart — the ONLY repository-defined deploy path (scripts/noramedi-deploy.sh);
#    reloads/starts BOTH PM2 apps via ecosystem.config.cjs and fails closed if either
#    does not reach 'online' (F3-IMPL-002) ── [MUTATING]
/usr/local/sbin/noramedi-deploy.sh                    # full sequence: pull, install, migrate, generate, reload both
/usr/local/sbin/noramedi-deploy.sh --skip-pull --skip-build --skip-migrate --skip-generate   # reload/restart only
pm2 startOrReload /var/www/noramedi/ecosystem.config.cjs --only noramedi-api --update-env     # [MUTATING]
pm2 startOrReload /var/www/noramedi/ecosystem.config.cjs --only noramedi-worker --update-env  # [MUTATING]
pm2 restart noramedi-api                              # [MUTATING] — process-level restart only, no code/config change
pm2 restart noramedi-worker                            # [MUTATING]
```

**Deployment topology reference** (see [PRODUCTION_TOPOLOGY.md](../PRODUCTION_TOPOLOGY.md) for the full evidence): single VPS (`disklinik-prod-01`), host Nginx TLS termination, two PM2 `fork`-mode processes (`noramedi-api` → `server/src/index.ts`, `noramedi-worker` → `server/src/worker.ts`), both running as `root` (R-036, open), both defined in the repository's own [`ecosystem.config.cjs`](../../../ecosystem.config.cjs), single-host PostgreSQL 16.14 (`noramedi_crm`), optional fail-open Redis (rate-limit counters only, not a queue/session store), local-disk file storage (`/var/www/noramedi/server/uploads`, `LOCAL_VPS_STORAGE`, no S3 in production), same-host `pg_dump` backups (`/root/noramedi-backups`, no offsite copy — R-030, no PITR — R-031).

## 3. Runbook index

| # | Runbook | Default SEV |
|---|---|---|
| 1 | [API outage](#41-api-outage) | 1 |
| 2 | [Worker offline / background jobs stopped](#42-worker-offline--background-jobs-stopped) | 2 (→1 if crash-looping) |
| 3 | [PostgreSQL unavailable](#43-postgresql-unavailable) | 1 |
| 4 | [Suspected tenant data exposure](#44-suspected-tenant-data-exposure) | 1 |
| 5 | [Leaked/revoked secret](#45-leakedrevoked-secret) | 1 (secrets/admin credential) or 2 (webhook secrets) |
| 6 | [Meta/WhatsApp provider outage](#46-metawhatsapp-provider-outage) | 2 or 3 |
| 7 | [Backup failure / restore requirement](#47-backup-failure--restore-requirement) | 2 (failure) or 1 (restore required) |
| 8 | [Object/file storage unavailable](#48-objectfile-storage-unavailable) | 2 (→1 if the shared root disk is full) |
| 9 | [High 5xx/error spike](#49-high-5xxerror-spike) | 2 (→1 if core patient-facing path, sustained) |
| 10 | [Security incident / suspicious privileged access](#410-security-incident--suspicious-privileged-access) | 1 (confirmed) or 2 (suspected) |

Every runbook below follows the same nine-part structure: **Detection → Immediate containment → Evidence preservation → Customer/data impact determination → Recovery → Validation → Rollback → Escalation → Post-incident review.**

## 4. Runbooks

### 4.1 API outage

**Detection.** `GET /api/health` returns anything other than `200`/`204`/`401`/`403` on repeated probes (both the public and local URL), or a user/clinic report of total unreachability. No automated alerting exists yet (ADR-012 `DEFERRED`) — this is a manual polling / user-report detection until that gap closes. **F3-OBS-002 status:** repository-side external-monitor design exists (§4.11) — an external uptime prober against `/api/livez`/`/api/readyz` is proposed but **not yet activated in production**; this remains manual detection until that activation happens and is evidenced.

**Immediate containment.** There is no distinct "contain" step for a full outage beyond starting recovery — the priority is restoring service. If any incident-communication channel exists for clinics, note the outage start time there (this repository defines no such channel — record its absence as a gap in the post-incident review, don't invent one mid-incident).

**Evidence preservation.** Capture `pm2 logs noramedi-api --lines 200 --nostream` **before** restarting — a restart can lose in-memory/recent log buffer state depending on PM2's own log-rotation behavior, so capture first, restart second.

**Customer/data impact determination.** Distinguish "API process down" (PM2 shows `errored`/`stopped`) from "API up but DB unreachable" (→ 4.3) from "process running but hung" (PM2 shows `online` but health check still fails). Run the DB-reachability commands in §2 to disambiguate.

**Recovery.**
```bash
pm2 describe noramedi-api                              # confirm actual status/restart count first
pm2 restart noramedi-api                                # [MUTATING] simple process restart, no code change
# If a recent deploy is implicated, redeploy the current committed code (does not
# change what commit is checked out unless combined with a git operation):
/usr/local/sbin/noramedi-deploy.sh --skip-pull --skip-build --skip-migrate --skip-generate   # [MUTATING]
```

**Validation.** `/usr/local/sbin/noramedi-healthcheck.sh --local --max-attempts 12 --interval 5` passes; `pm2 describe noramedi-api` restart count has stopped climbing; spot-check 2–3 authenticated smoke routes (login, patient list, appointment list) manually.

**Rollback.** If the outage began immediately after a deploy, the recovery path is redeploying the **prior known-good commit** — there is no automated rollback (`LAUNCH_GATES.md` §2.D: "None exists today"). On the VPS: `git -C /var/www/noramedi log --oneline -5` to identify the prior commit, `git -C /var/www/noramedi checkout <prior-sha>` **[MUTATING]**, then re-run the reload-only form of `noramedi-deploy.sh` above. Per `RISK_REGISTER.md` R-046's standing rule, do **not** roll back any additive schema/migration as part of this — retain the schema, redeploy only the application code, forward-fix afterward.

**Escalation.** SEV-1, immediate, decision owner notified without delay — every patient-facing workflow depends on this single API process.

**Post-incident review.** Record the outage window, root cause, whether it correlates with the unexplained PM2 restart-count pattern already tracked as `RISK_REGISTER.md` R-037, and whether a new risk-register row is warranted.

### 4.2 Worker offline / background jobs stopped

**Detection.** `pm2 jlist`'s `noramedi-worker` entry reports a status other than `online`; or a downstream symptom is noticed first — reminders not arriving, data-retention/file-backup/external-calendar-sync jobs not progressing, a climbing PM2 restart count for `noramedi-worker` specifically (`pm2 describe noramedi-worker`). **F3-OBS-002 status:** `scripts/noramedi-opscheck.sh`'s `pm2` check covers exactly this condition for both `noramedi-api` and `noramedi-worker` via a dead-man's-switch ping (§4.11) — reviewed and tested, **not yet installed on the production host**.

**Immediate containment.** Confirm the API process has **not** silently taken over job ownership — `RUN_BACKGROUND_JOBS=false` is set explicitly for `noramedi-api` in [`ecosystem.config.cjs`](../../../ecosystem.config.cjs) (per [F3-IMPL-002](../evidence/F3-IMPL-002_PRODUCTION_WORKER_PROCESS_CONTRACT.md)), so the API does **not** pick up jobs on its own — check `pm2 logs noramedi-api --lines 50 --nostream | grep '\[jobs\]'` for the startup line confirming `ownsJobs=false`, so nobody assumes reminders are still being sent from a second source while diagnosing.

**Evidence preservation.** `pm2 logs noramedi-worker --lines 200 --nostream`; `pm2 describe noramedi-worker` for exit code / restart count / uptime.

**Customer/data impact determination.** All 9 jobs registered in [`startBackgroundJobs.ts`](../../../server/src/jobs/startBackgroundJobs.ts) are affected: reminder notifications, post-treatment messaging, Meta template sync, data-retention cleanup, inbound-event retry, imaging-bridge-offline detection, public-booking-notice-evidence cleanup, patient-privacy-export cleanup, clinic-bulk-export worker + cleanup, file-backup, external-calendar inbound retry, external-calendar outbound sync. Estimate the backlog window as `(now − last known-good tick)`; the reminder job's own tick interval is 5 minutes (`cron.schedule('*/5 * * * *', ...)`, [`reminders.ts`](../../../server/src/jobs/reminders.ts)).

**Recovery.**
```bash
pm2 startOrReload /var/www/noramedi/ecosystem.config.cjs --only noramedi-worker --update-env   # [MUTATING]
# or, if only a process-level restart is needed (no config change):
pm2 restart noramedi-worker                              # [MUTATING]
```

**Validation.** Poll worker status with the §2 `pm2 jlist` liveness snippet until `online`; confirm `pm2 logs noramedi-worker --lines 50 --nostream` shows the startup line `[worker] All background jobs scheduled.`; watch the next reminder tick complete (`[reminders] Notification reminder job complete.`).

**Duplicate-send protection (why a backlog does not become a flood of duplicate patient messages).** Two independent layers apply here, and both matter for this specific scenario:
1. **`JobLock` (run-level, [`jobLock.ts`](../../../server/src/utils/jobLock.ts)):** a Postgres-table-backed lease lock (`withJobLock('reminders:notification', 30-minute TTL, ...)` and `withJobLock('reminders:post-treatment', ...)`) ensures only one process runs a given job tick at a time, even if the worker restarts mid-tick or briefly overlaps with another process — it prevents *concurrent* duplicate runs, not backlog itself.
2. **Per-recipient dedup keys (send-level, [`reminders.ts`](../../../server/src/jobs/reminders.ts)):** each reminder type checks a `prisma.sentMessage.findFirst(...)` or `prisma.setting.findUnique(...)` keyed by a value that includes the local calendar `dateKey` (or an installment/appointment id) **before** sending — e.g. `` `notification.lastSent.practitionerSchedule.${practitioner.id}.${dateKey}` ``, `` `payment-installment-reminder:${installment.id}:${dateKey}` ``. This means a worker outage of several ticks (even hours) does **not** cause the reminder job, once resumed, to resend a reminder it already successfully sent earlier the same local day — the resumed run naturally catches up on genuinely-unsent reminders only.

**Edge case to flag explicitly, not silently assume away:** if the worker outage spans a local-day boundary, the `dateKey` for "today" changes — a reminder that should have gone out yesterday and did not is **not** retroactively sent (the dedup/query logic is scoped to the *current* local day's window), and a reminder scheduled for today will be evaluated fresh, independent of yesterday's miss. A multi-day worker outage therefore does not produce duplicates, but it can produce **silently missed** reminders for the skipped day(s) — this must be called out in the post-incident review, not treated as automatically self-healed.

**Rollback.** No code change is involved in a simple restart — nothing to roll back. If the worker crash-loops after restart, treat it as a possible code/config regression: escalate to SEV-1 and follow 4.1's prior-commit-redeploy path.

**Escalation.** SEV-2 initially; escalate to SEV-1 if the worker is crash-looping (`pm2 describe` shows a rapidly climbing restart count with `errored` status) or the outage has already spanned a local-day boundary (silently-missed reminders, per the edge case above, are a patient-facing failure even though no duplicate was sent).

**Post-incident review.** Cross-reference `RISK_REGISTER.md` R-037 (unexplained PM2 restart counts) if the root cause is unclear; record which jobs, if any, produced a silently-missed (not merely delayed) execution.

### 4.3 PostgreSQL unavailable

**Detection.** `/api/health` returns `503 {"status":"degraded"}` (the 3-second DB-timeout race in `index.ts`); `pg_isready -h 127.0.0.1 -p 5432` fails; `pm2 logs` for either process shows repeated Prisma connection errors.

**Immediate containment.** Scope the failure before acting: is the PostgreSQL OS service itself down, is it a connection-pool exhaustion (`DB_POOL_MAX=10` per process × 2 processes ≤ 20 connections total, per [PRODUCTION_TOPOLOGY.md](../PRODUCTION_TOPOLOGY.md) §1), or a disk-full condition (`df -h /`)? Check disk space first — it is a common, easily-checked root cause and rules out the most dangerous scenario (data-directory corruption from a full disk mid-write) quickly.

**Evidence preservation.** Capture the PostgreSQL service's own error log (path is OS-dependent, typically under `/var/log/postgresql/`), `pm2 logs` for both processes around the failure window, `df -h` / `free -m` output, and the timestamp of the first failed health check.

**Customer/data impact determination.** Total outage, SEV-1 by default — the database is single-host with no read replica and no PITR (R-031); both `noramedi-api` and `noramedi-worker` depend on it identically, so every patient-facing feature is affected simultaneously.

**Recovery.** Restarting the PostgreSQL OS service itself is outside this repository's scope (no repository script manages the Postgres service — it is OS-provisioned per [PRODUCTION_TOPOLOGY.md](../PRODUCTION_TOPOLOGY.md) §2). If the service crashed but the data directory is intact, the standard OS-level action (performed by whoever holds VPS access, not a repository script) is restarting the PostgreSQL service, then re-running the reachability checks in §2. If the cause is disk-full: free space **without** deleting anything under PostgreSQL's own data/WAL directories, then restart the service.

**Validation.** `pg_isready` succeeds; `/api/health` returns `200`; if the API/worker processes remain in a bad connection-pool state after the DB recovers (Prisma normally reconnects automatically, but this is a reasonable next diagnostic step if health stays `degraded`), `pm2 restart noramedi-api noramedi-worker` **[MUTATING]**.

**Rollback.** Not applicable to an infrastructure recovery, **unless** the outage was caused by a bad migration — in that case follow `RISK_REGISTER.md` R-046's documented cutback path exactly: do **not** drop or physically roll back any additive table once real rows exist (this destroys the newly-created operational/KVKK evidence irrecoverably, independently confirmed destructive in [F0-011-P2](../evidence/F0-011-P2_KVKK_HIGH007_HIGH008_ROLLBACK_TENANT_VERIFICATION.md)); redeploy the prior compatible application commit, retain the schema, forward-fix.

**Escalation.** SEV-1, immediate — also triggers runbook 4.7 (backup failure / restore requirement) as a parallel workstream if data loss is suspected, not sequentially after service is restored.

**Post-incident review.** A real DB-unavailable incident is exactly the class of event `RISK_REGISTER.md` R-031 (no PITR) and `LAUNCH_GATES.md`'s PITR gate item are meant to flag as high-RPO-risk — this is a natural re-evaluation trigger for that accepted-temporary-risk's governance record, independent of any calendar expiry date.

### 4.4 Suspected tenant data exposure

**Detection.** An automated `SecurityIncident` with `category: 'cross_tenant_access'` surfaces via `GET /api/platform/security/incidents?category=cross_tenant_access&status=open` ([`securityDetectionRules.ts`](../../../server/src/services/security/securityDetectionRules.ts) already runs this detection category in production); or a manual report (support ticket, clinic complaint, an ad hoc code-review finding in the style of [F0-009-S1](../evidence/F0-009-S1_SECURITY_INCIDENT_TENANT_OWNERSHIP_EVIDENCE.md)).

**Immediate containment.** `POST /api/platform/security/incidents/:id/acknowledge` **[MUTATING]** to start the auditable clock. If the exposure is confirmed **and actively ongoing/reproducible** (not merely historical), the decision owner may authorize suspending the affected tenant(s) — this is a real, already-implemented capability, not a hypothetical: `PATCH /api/platform/organizations/:id/status {"status":"suspended"}` **[MUTATING]** or `PATCH /api/platform/clinics/:id/status {"status":"suspended"}` **[MUTATING]** blocks further login/API use for that tenant without deleting any data. **Do not suspend a tenant unilaterally without the decision owner** — but do not leave a confirmed, live, reproducible leak unmitigated pending approval either; escalate in parallel with containment, not after it.

**Evidence preservation.** `POST /api/platform/security/incidents/:id/investigate` **[MUTATING]** — itself creates an audited `SecurityIncidentActivity` row; `GET /api/platform/security/incidents/:id/activity` for the full timeline. **Never delete or edit** any `AuditLog`, `SecurityIncidentActivity`, or `PlatformAdminAuditEvent` row touched by this incident, even ones that might reflect poorly on the platform — they are the evidentiary record for both technical root-cause analysis and the KVKK breach-path determination in §5.

**Customer/data impact determination.** Use the incident's `organizationId`/`clinicId`/`affectedResourceType`/`affectedResourceId` fields plus a *targeted*, read-only re-run of the exact query/endpoint the detection rule flagged (scoped, logged, and reviewed) to determine exactly which clinics/organizations/patients were exposed and to whom. Never run a blanket cross-tenant scan as part of "impact determination" — that itself risks additional exposure.

**Recovery.** This runbook does not authorize writing an unreviewed fix on the spot. File the root cause as a tracked task/risk (this program's own established pattern: R-054/R-055 for raw-SQL tenant-scoping questions, with F0-009-S1 as a worked example of tracing one to a confirmed-safe conclusion). If a specific route/query is the confirmed vector and a code fix cannot land immediately, the fastest safe mitigation is a temporary route/WAF-level block — the same "disable-feature/route-block, not a rushed patch" pattern `RISK_REGISTER.md` R-061's own rollback note already establishes for a different feature.

**Validation.** After a fix deploys, re-run the exact reproduction steps that originally confirmed the leak and confirm they now fail or return correctly-scoped data only; `POST /api/platform/security/incidents/:id/contain` **[MUTATING]** with a `containmentSummary` once verified.

**Rollback.** If the fix itself regresses something else, redeploy the prior commit **only if** doing so does not re-expose the same leak; otherwise keep the affected route/feature disabled until a correct fix lands, per the recovery step above.

**Escalation.** SEV-1, always. Cross-tenant patient data exposure is the highest-priority category in this document. Escalate immediately to the decision owner and begin the KVKK breach-path determination (§5) **in parallel** with technical containment, not sequentially after it.

**Post-incident review.** `POST .../resolve` **[MUTATING]** with a `resolutionSummary`, then `POST .../close` **[MUTATING]** — but only after **both** the technical fix is verified **and** the KVKK legal-path determination is recorded. Do not close an incident whose `legalReviewRequired` is `true` while `legalReviewStatus` is still pending.

### 4.5 Leaked/revoked secret

**Detection.** A secret appears somewhere it should not (a public repository, a log line, a support channel); a provider (Meta/WhatsApp/SMS) reports anomalous API usage; or an internal audit finds a secret was logged (cross-reference [F3-IMPL-004](../evidence/F3-IMPL-004_PII_PHI_LOG_HYGIENE_WAVE1.md)'s already-remediated `SECRET_TOKEN`-class findings — an Instagram/Facebook access-token prefix and two Google AI Studio API-key-in-URL leaks were found and fixed by that task, evidence that this class of leak has occurred in this codebase before).

**Immediate containment — identify which secret, since blast radius differs:**

| Secret | Blast radius if leaked | Default severity |
|---|---|---|
| `JWT_SECRET` | Attacker can forge clinic-user session tokens | SEV-1 |
| `PLATFORM_JWT_SECRET` | Attacker can forge platform-admin tokens — the highest privilege level in the system | SEV-1 |
| `ENCRYPTION_KEY` | Attacker can decrypt every stored provider credential (WhatsApp/SMS tokens) at rest; rotating the key does **not** un-leak values already decrypted with the old one | SEV-1 |
| `CSRF_SECRET` | Lower severity alone (requires an attacker who can already trigger a victim's browser) but still rotate | SEV-2 |
| `WHATSAPP_WEBHOOK_SECRET` / `META_WEBHOOK_VERIFY_TOKEN` / `INSTAGRAM_WEBHOOK_VERIFY_TOKEN` | Attacker can forge inbound webhook calls (fake incoming messages/delivery receipts) | SEV-2 |
| Platform-admin account credential | Full platform-admin privilege; stateless-JWT sessions cannot be selectively revoked (see [R-061 evidence](../evidence/R061_AUTHENTICATED_PRODUCTION_SAFE_RESET_VERIFICATION.md): `sessionsInvalidated: 0` is a **documented limitation**, not an oversight) — only rotating `PLATFORM_JWT_SECRET` invalidates the compromised session, and doing so logs out **every** platform admin, not just the compromised one | SEV-1 |

**Evidence preservation.** Record where/how the secret was found. **Never** paste the actual secret value into an incident ticket or log — reference it by name and, if needed, a hash or last-4-characters only.

**Customer/data impact determination.** `getSecret()` ([`server/src/utils/secrets.ts`](../../../server/src/utils/secrets.ts)) only guarantees a strong value was configured at process start in production — it proves nothing about whether that configured value has since leaked. Determine the actual exposure window using whatever external evidence exists (git history for an accidentally-committed value, a provider dashboard's own access log, etc.).

**Recovery.**
```bash
# 1. Rotate the value in the environment (systemd unit / .env / shell profile —
#    the actual storage mechanism is outside this repository's scope, per
#    PRODUCTION_TOPOLOGY.md §7's own "unverified" configuration-source gap).
# 2. Propagate to BOTH processes — an env-var change alone does not reach an
#    already-running PM2 process without --update-env: [MUTATING]
pm2 startOrReload /var/www/noramedi/ecosystem.config.cjs --only noramedi-api --update-env
pm2 startOrReload /var/www/noramedi/ecosystem.config.cjs --only noramedi-worker --update-env
```
If the leaked value was a *provider* credential (WhatsApp/Instagram/SMS token stored encrypted at rest), it must additionally be rotated at the provider itself and re-saved through the normal authenticated admin connection flow — rotating `ENCRYPTION_KEY` alone does not revoke a provider-side token.

**Validation.** `getSecret()` throws at next process start if the *new* value is itself short/default in production — a failed restart immediately after rotation is a signal the replacement value is weak, not that rotation failed for an unrelated reason. Confirm both processes reach PM2 `online` (same `verify_pm2_online` pattern `noramedi-deploy.sh` already uses) and `/api/health` returns the expected `200`/`401`.

**Rollback.** Rotating back to a known-leaked secret is **never** an acceptable rollback. If the new secret breaks something, issue a second new secret — do not revert to the compromised one.

**Escalation.** SEV-1 for `JWT_SECRET` / `PLATFORM_JWT_SECRET` / `ENCRYPTION_KEY` / platform-admin credential; SEV-2 for webhook secrets/lower-privilege tokens pending confirmed exploitation.

**Post-incident review.** Record exactly which sessions/tokens were invalidated by the rotation — `JWT_SECRET`/`PLATFORM_JWT_SECRET` rotation invalidates **every** existing session of that type, a customer-visible side effect that must be communicated, not left as an internal footnote. File a new risk-register row if the leak vector itself (e.g. a new PII/secret log site) is not already tracked.

### 4.6 Meta/WhatsApp provider outage

**Detection.** Outbound WhatsApp send failures via [`MetaCloudWhatsAppProvider.ts`](../../../server/src/services/whatsapp/MetaCloudWhatsAppProvider.ts) or [`EvolutionWhatsAppProvider.ts`](../../../server/src/services/whatsapp/EvolutionWhatsAppProvider.ts) (check [`whatsappProviderFactory.ts`](../../../server/src/services/whatsapp/whatsappProviderFactory.ts) for which is configured per clinic); rising error counts from [`whatsappOutboundMessaging.ts`](../../../server/src/services/whatsapp/whatsappOutboundMessaging.ts)'s `OUTBOUND_ERRORS`; the Meta status page; or clinics reporting reminders not arriving.

**Immediate containment.** No destructive action is needed — outbound messaging naturally retries on the next 5-minute reminder tick, since the per-recipient dedup key (§4.2) is only set once a send is confirmed, not on an attempt. Verify this holds for the specific failure being observed (confirm the actual send-then-record ordering in the affected code path) before relying on it operationally.

**Evidence preservation.** `pm2 logs noramedi-api --lines 200 --nostream` and the same for `noramedi-worker`, around the failure window. Determine whether failures are provider-wide (Meta Cloud API returning 5xx) or NoraMedi-side (a webhook secret rotated without updating the app, an expired provider token).

**Customer/data impact determination.** Distinguish "outbound broken, inbound fine" vs. "both broken" vs. one clinic's connection only (SEV-3, bounded) vs. every clinic on a given provider (SEV-2).

**Recovery.** If the outage is on Meta's side, no action is possible beyond monitoring their status. If a token/credential has expired, reconnect through the existing authenticated WhatsApp Embedded Signup / connection flow ([`organizationWhatsApp.ts`](../../../server/src/routes/organizationWhatsApp.ts), `WhatsAppConnections.tsx`) — note that [F3-WA-META-COEX-002](../evidence/F3-WA-META-COEX-002_META_APP_PRODUCTION_READINESS.md) found the OAuth `state` parameter is not validated (a confirmed, unfixed CSRF gap) and there is no server-side WABA/phone-number ownership verification on the callback path; reconnection during an incident should still go through this existing authenticated flow, not an ad hoc bypass, and this known gap should be kept in mind if the incident itself involves a suspicious reconnection attempt.

**Validation.** Send a single, clearly-marked test message through the reconnected provider before declaring resolved; confirm `OUTBOUND_ERRORS`'s rate has returned to baseline.

**Rollback.** Not applicable — provider outages are waited out or worked around, not rolled back.

**Escalation.** SEV-2 (multi-clinic) or SEV-3 (single-clinic); escalate to SEV-1 only if the outage coincides with, or is being used as cover for, a security incident (e.g. a webhook-forgery attempt during the same window — see runbook 4.10).

**Post-incident review.** Compare the actual downtime window against the patient-facing reminder cadence to distinguish reminders that were merely *delayed* (later succeeded, not a duplicate per §4.2's dedup keys) from reminders that were *lost* (never retried past the dedup window) — this distinction is worth checking explicitly, not assuming away.

### 4.7 Backup failure / restore requirement

**Detection.** `GET /api/platform/backups/status` shows `latestBackup` older than the expected cadence (cron-scheduled; the currently-observed production interval is ~11 hours per [PRODUCTION_TOPOLOGY.md](../PRODUCTION_TOPOLOGY.md)), or `cronExists`/`scriptExists`/`scriptExecutable` reporting `false`; separately, `GET /api/platform/file-backups/status` for the off-host file/attachment backup job — **first confirm `FILE_BACKUP_ENABLED`'s actual production value** before treating a file-backup "failure" as an emergency, since this capability is `IMPLEMENTED_NOT_PRODUCTION_VERIFIED` and defaults to disabled ([FILE_BACKUP_COVERAGE_001.md](../evidence/FILE_BACKUP_COVERAGE_001.md)) — a "failure" report for a feature that is not even enabled is a false alarm, not an incident. **F3-OBS-002 status:** `scripts/noramedi-opscheck.sh`'s `backup` check computes freshness directly from `/root/noramedi-backups` (same source `backupService.ts` reads) and pings a dead-man's-switch on staleness (§4.11) — reviewed and tested, **not yet installed on the production host**.

**Immediate containment.** If backups are failing but the database itself is healthy, this is a degraded-*recovery-capability* risk, not an active data-loss emergency — respond with urgency proportional to how long the gap has existed, not with panic.

**Evidence preservation.** `GET /api/platform/backups/logs?lines=200` (or `tail -n 200 /var/log/noramedi-db-backup.log` directly on the VPS); `df -h /root` (a full disk is a common silent backup-failure cause).

**Customer/data impact determination.** Compute the current RPO exposure: `now − last successful backup timestamp`. Cross-reference `RISK_REGISTER.md` R-030 (no offsite copy) and R-031 (no PITR) — a backup failure on top of those already-accepted gaps materially raises real data-loss exposure and must be communicated as such.

**Recovery — backup failure (no data lost yet).** The backup script itself (`/usr/local/sbin/noramedi-db-backup.sh`) is **not** in this repository — a script-level fix (disk space, cron config, script bug) must be applied directly on the VPS. Once fixed, trigger a manual run to confirm before waiting for the next cron tick:
```bash
curl -s -b "$PLATFORM_SESSION_COOKIE" -X POST https://api.noramedi.com/api/platform/backups/run    # [MUTATING]
```

**Recovery — restore requirement (data loss has actually occurred).** This is the highest-stakes action in this document. **Do not restore over the production database.** Use the reviewed, evidenced rehearsal tooling first, even in a real incident:
```bash
scripts/backup-restore-rehearsal.sh                    # builds an isolated, RAM-backed (/dev/shm)
                                                          # disposable PostgreSQL cluster and restores
                                                          # the candidate backup into IT — never touches
                                                          # the production DATABASE_URL target
```
This confirms the backup file is actually restorable and produces row counts/checksums before any real cutover decision — see [`BACKUP_RESTORE_REHEARSAL_001.md`](../evidence/BACKUP_RESTORE_REHEARSAL_001.md) (`CLOSED_VERIFIED` for the database-restore-rehearsal gap specifically; an operator has run this exact script against a real production backup file and confirmed a passing result). **A real production cutover (pointing `DATABASE_URL` at a restored copy, or restoring in place) is not scripted anywhere in this repository and is explicitly out of scope for this task to invent** — it requires an explicit, human-approved plan (export/backup of current state first, an approved reverse/forward plan, DBA-level review), matching the same standard `RISK_REGISTER.md` R-046 already sets for any exceptional physical rollback. For file/attachment backups, `POST /api/platform/file-backups/restore-rehearsal` exists in code but is `IMPLEMENTED_NOT_PRODUCTION_VERIFIED` — treat any of its results as unverified until independently confirmed.

**Validation.** The rehearsal script's own pass/fail output (table counts, `PlatformAdmin`/`Plan` counts, foreign-key spot checks, checksum match) — see [`BACKUP_RESTORE_REHEARSAL_001.md`](../evidence/BACKUP_RESTORE_REHEARSAL_001.md) §5 for the exact fields checked.

**Rollback.** Not applicable to a backup-failure fix. For an actual restore rehearsal, "rollback" means aborting before any real cutover — the rehearsal's disposable cluster and its tmpfs-backed data are simply released (no persistent disk write occurred), zero production impact regardless of outcome.

**Escalation.** SEV-2 for a backup-failure-only incident (capability degraded, no data lost yet); SEV-1 the moment an actual restore is required (implies data loss already occurred — this is typically triggered *from* runbook 4.3 or 4.10, not standalone).

**Post-incident review.** A live backup-failure or restore-required incident is exactly the kind of event that should trigger re-evaluation of R-030/R-031/R-032's "accepted temporary risk" governance record (`LAUNCH_GATES.md` §2's expiry/review-date/exit-criterion fields) — this is a natural re-evaluation trigger independent of any calendar date.

### 4.8 Object/file storage unavailable

**Detection.** Patient attachment/imaging upload or download failures; `fileStorage.ts` errors in `pm2 logs`; disk-full on `/var/www/noramedi/server/uploads`. Production storage today is confirmed `LOCAL_VPS_STORAGE` (local disk, same VPS as everything else) — no S3 in production despite S3-capable code existing dormant ([PRODUCTION_TOPOLOGY.md](../PRODUCTION_TOPOLOGY.md) §6).

**Immediate containment.** Since storage is local disk on the same host as the database and both PM2 processes, "storage unavailable" in production today most likely means either disk-full or a filesystem/permissions problem on that specific path — check `df -h /var/www/noramedi` first.

**Evidence preservation.** Capture the exact error (`ENOSPC` vs. permission-denied vs. path-not-found) from `pm2 logs noramedi-api --lines 200 --nostream`; note which domain is affected (`PatientAttachment` / `LabOrderAttachment` / `ImagingImage` — all three share the same `fileStorage.ts` abstraction and physical-path convention, per [FILE_BACKUP_COVERAGE_001.md](../evidence/FILE_BACKUP_COVERAGE_001.md) §2).

**Customer/data impact determination.** Uploads/downloads fail but the rest of the DB-backed API keeps working — a partial outage. Determine whether new writes are being cleanly rejected or silently lost by checking the actual write-path error handling for the affected route — do not assume either way without checking.

**Recovery.** Free disk space or fix permissions. **Do not delete anything under `server/uploads/**`** — local disk is the **sole** copy of patient attachments/imaging in production today, since the off-host `FileBackupJob` coverage exists in code but is `FILE_BACKUP_ENABLED=false`/`IMPLEMENTED_NOT_PRODUCTION_VERIFIED` (per [FILE_BACKUP_COVERAGE_001.md](../evidence/FILE_BACKUP_COVERAGE_001.md)) — treat local disk as irreplaceable until that changes. If the process is stuck in a bad state after the underlying issue is fixed: `pm2 restart noramedi-api` **[MUTATING]**.

**Validation.** A single test upload/download round-trip through the actual running application (not just a raw filesystem write) before declaring resolved.

**Rollback.** Not applicable (infra fix) unless a recent deploy changed `fileStorage.ts`'s configured mode/path — in that case, the same prior-commit-redeploy pattern as 4.1.

**Escalation.** SEV-2 (bounded to attachment/imaging features; the rest of the API keeps working) **unless** the disk-full condition is shared with the database's own root filesystem (same VPS, single-host topology per `PRODUCTION_TOPOLOGY.md`) — in that case escalate to SEV-1 immediately, since a full root disk threatens Postgres, PM2, and logging simultaneously, not just file storage.

**Post-incident review.** This incident directly evidences why `RISK_REGISTER.md` R-029 (local-only storage) and the still-`FILE_BACKUP_ENABLED=false` off-host coverage remain open program risks — record whether this incident should change the urgency of enabling it in production (a decision this document does not make).

### 4.9 High 5xx/error spike

**Detection.** Elevated 5xx responses observed via `logUnhandledError`'s structured logs (`pm2 logs noramedi-api --lines 200 --nostream`, filter for the `"unhandled error"` message / `status >= 500` entries — no dedicated metrics/alerting stack exists yet, ADR-012 `DEFERRED`, so this is manual log inspection until that gap closes), or repeated user/clinic-reported failures. **F3-OBS-002 status:** out of this task's scope — no aggregation/rate computation is proposed here (see the F3-OBS-002 evidence doc's explicit scope boundary); this stays manual-only for now.

**Immediate containment.** Identify whether the spike is scoped to one route (the `route` field in the structured error log — a safe, allowlisted route template, never a raw path with embedded ids, per [`logger.ts`](../../../server/src/utils/logger.ts)'s own design) or system-wide. A system-wide spike escalates directly to runbook 4.1 or 4.3 instead of this one.

**Evidence preservation.** Capture the bounded log window (`--lines 200 --nostream`, repeated with fresh timestamps if the spike is ongoing); note `errType`/`reqId` values. **`errMessage` is deliberately stripped to the fixed string `'internal error'` in production** ([`logger.ts`](../../../server/src/utils/logger.ts) `safeErrorLog()`) — root-causing a production 5xx spike from logs alone may require reproducing the same `errType`/route/timing pattern in a non-production environment, since the real message/stack is intentionally not in the production log stream.

**Customer/data impact determination.** Determine whether the affected route is patient-facing (booking, messaging, payments) or internal/admin-only, and scope severity accordingly. Check whether the spike correlates with a recent deploy (git-SHA-verification command in §2, compared against the incident start time) or a traffic pattern (a client stuck retrying, a specific clinic's bulk operation).

**Recovery.** If deploy-correlated: redeploy the prior known-good commit (4.1's manual-rollback pattern — no automated rollback exists). If traffic-pattern-correlated: identify and, if necessary, block the specific caller pattern at the Nginx layer — this is host-level configuration outside this repository ([PRODUCTION_TOPOLOGY.md](../PRODUCTION_TOPOLOGY.md) §5 already flags the actual host Nginx config as unconfirmed/not matching the repository's own `nginx.conf`); coordinate with whoever holds that config rather than guessing at it.

**Validation.** The 5xx rate returns to baseline over a sustained window (not just the next single request); spot-check the previously-failing route directly.

**Rollback.** Per the recovery step: prior-commit redeploy if deploy-correlated, retaining any additive schema per R-046's standing rule.

**Escalation.** SEV-2 by default; SEV-1 if the affected route is a core patient-facing path (booking, payments, WhatsApp inbound) and the spike is sustained rather than transient.

**Post-incident review.** This is precisely the gap `LAUNCH_GATES.md` §2.F/§3.F names as mandatory tooling before G2 (ADR-012 `DEFERRED`) — an incident that had to be caught by manual log-grepping rather than an alert is itself supporting evidence for that gate item; cite it explicitly.

### 4.10 Security incident / suspicious privileged access

**Detection.** A `SecurityIncident` with `category: 'auth_brute_force'` (or another detected category) surfaces via `GET /api/platform/security/incidents?category=auth_brute_force&status=open`; or a manual `AuditLog`/`PlatformAdminAuditEvent` review finds an unexpected privileged action (an MFA disable, an SMS-provider credential change, a data-retention-settings toggle — the six highest-risk platform-admin routes [F3-IMPL-003](../evidence/F3-IMPL-003_PLATFORM_ADMIN_AUDIT_COVERAGE.md) specifically instrumented) by an unrecognized actor or at an unexpected time.

**Immediate containment.** For a confirmed-compromised **clinic-level** account: `PATCH /api/platform/users/:id/status {"isActive": false}` **[MUTATING]**. For a confirmed-compromised **platform-admin** account, no equivalent single-account-disable route was found in this task's scope — the only confirmed mechanism to invalidate that admin's existing session is rotating `PLATFORM_JWT_SECRET` (runbook 4.5), which logs out every platform admin, not just the compromised one; this is a real operational cost to weigh explicitly with the decision owner, not silently avoid or silently accept.

**Evidence preservation.** `POST /api/platform/security/incidents/:id/acknowledge` **[MUTATING]** then `POST .../investigate` **[MUTATING]** to build the immutable `SecurityIncidentActivity` trail; pull `GET .../:id/activity` and the relevant `PlatformAdminAuditEvent`/`AuditLog` rows for the actor/time window. Read-only — never edit or delete audit rows, even ones recording an attacker's own actions; they are the evidence.

**Customer/data impact determination.** Use the incident's `affectedResourceType`/`affectedResourceId` plus a targeted review of what that actor's privileges actually allowed. **Note the coverage gap explicitly:** [F3-IMPL-003](../evidence/F3-IMPL-003_PLATFORM_ADMIN_AUDIT_COVERAGE.md)'s own 70-route inventory found 25/37 mutation endpoints durably audited via `PlatformAdminAuditEvent` and 12 (org/clinic/plan/user lifecycle, backup triggers) intentionally deferred — a genuinely suspicious actor using one of those 12 may leave no `PlatformAdminAuditEvent` trail at all, only whatever coarser `AuditLog`/access-log evidence exists, if any. Do not conclude "no audit row found" means "no action taken" without checking which of the 12 unaudited routes could explain the gap.

**Recovery.** Rotate the compromised credential (password and/or the relevant JWT secret, per runbook 4.5). Review and, where needed, manually reverse any privileged mutation the actor made (e.g. re-enable MFA if disabled, restore a prior SMS-provider config) — perform each reversal through the normal authenticated platform-admin path so it is itself audited, never as a raw database edit.

**Validation.** Confirm the compromised credential/token is rejected on a follow-up attempt; confirm no new suspicious activity in a subsequent log/audit review window.

**Rollback.** Not applicable beyond the mutation reversals above.

**Escalation.** SEV-1 always for a confirmed privileged-account compromise; SEV-2 for a suspicious-but-unconfirmed signal pending investigation — matches the incident's own `open` → `acknowledged` → `investigating` lifecycle; do not pre-declare a final severity before acknowledgment, but do not leave an `open` incident past the SEV-2 response window either.

**Post-incident review.** `POST .../resolve` **[MUTATING]** with a `resolutionSummary`, then `POST .../close` **[MUTATING]**. If the incident involved patient data, the KVKK breach path (§5) applies in parallel, exactly as in runbook 4.4.

### 4.11 Automated monitoring / alerting (F3-OBS-002)

**Added by F3-OBS-002, not F3-IR-001** — this subsection documents the automated-monitoring design proposed and repository-side-implemented by [F3-OBS-002](../evidence/F3-OBS-002_LIVE_OBSERVABILITY_WIRING_ALERT_VERIFICATION.md); it does not change this runbook's own F3-IR-001 status header above. **Nothing in this subsection is active in production yet** — every "Detection" line above that references it (4.1, 4.2, 4.7) still describes manual/human detection as the current reality until the external activation steps below are executed and evidenced; see the F3-OBS-002 evidence doc for the exact pending steps and the required approval gate before that activation happens.

**Design (once activated):**

| Check | Mechanism | Ping/alert on |
|---|---|---|
| API unreachable | External uptime monitor → `GET /api/livez` | Non-2xx / no response |
| DB readiness | External uptime monitor → `GET /api/readyz`, root `status` field | `"status":"degraded"` / HTTP 503 |
| Redis readiness | External uptime monitor → `GET /api/readyz`, **body assertion specifically on the `redis` check entry** (`"name":"redis","status":"ok"`) — the root `status`/HTTP code alone does **not** reflect Redis, because `evaluateReadiness()` ([`readiness.ts`](../../../server/src/utils/readiness.ts)) deliberately never fails readiness on a Redis-only outage (fail-open policy, documented in that file's own module docstring) | Body no longer contains `"name":"redis","status":"ok"` |
| `noramedi-api` / `noramedi-worker` PM2 status | Host-local: `scripts/noramedi-opscheck.sh` `pm2` check (systemd timer, independent of the two monitored processes) → dead-man's-switch ping | Either process not `online`, or no ping arrives within the provider's configured grace period |
| Disk usage | Host-local: `noramedi-opscheck.sh` `disk` check (`df -P`) → dead-man's-switch ping | Usage ≥ `NORAMEDI_OPSCHECK_DISK_THRESHOLD_PERCENT` (default 90) |
| Backup freshness | Host-local: `noramedi-opscheck.sh` `backup` check (reads `/root/noramedi-backups` directly — the same directory `backupService.ts` reads, not the authenticated HTTP admin route) → dead-man's-switch ping | No file younger than `NORAMEDI_OPSCHECK_BACKUP_MAX_AGE_HOURS` (default 30) matching the backup filename pattern |

**Owner and escalation.** No dedicated on-call rotation exists for NoraMedi today (consistent with §0/§4.1's existing statement that this repository defines no such channel). Once activated, the human alert channel (minimum: email) delivers to the production operator identified at activation time — that recipient address is configured directly in the external provider's console, is operational contact information, and is therefore **never committed to this repository**. Until an on-call rotation is formally defined elsewhere in this program, that operator is this runbook's own "decision owner" (§0).

**What this does NOT cover.** Elevated 5xx rate (4.9) and TLS/certificate expiry remain explicitly out of this task's scope (see the F3-OBS-002 evidence doc's scope boundary) — both stay manual/log-inspection-only for now.

## 5. KVKK personal/health-data breach path

This section distinguishes what this program's own repository/technical controls already do from what remains an **explicit, unresolved legal dependency**. Per this task's own instructions, no legal deadline or process is asserted here unless it is already recorded in this program's own accepted legal documentation — where none exists, the item is marked `LEGAL_VERIFICATION_REQUIRED` rather than invented.

### 5.1 Technical incident handling (this program's existing, repository-verified scope)

The [`SecurityIncident`](../../../server/src/services/security/securityIncidentService.ts) model and its lifecycle (§4.4/§4.10 above) are, by the service module's own documented statement, **"a TECHNICAL foundation only"** — `legalReviewRequired`/`legalReviewStatus` fields exist on the model specifically as placeholders for a pending human legal decision, and are never themselves a legal conclusion (see [`securityIncidentService.ts`](../../../server/src/services/security/securityIncidentService.ts) lines 1–29, and `docs/compliance/55-kvkk-security-incident-response-foundation.md`). Technical handling — detection, containment, evidence preservation, resolution — is fully covered by runbooks 4.4 and 4.10 above and does not, by itself, satisfy any KVKK legal obligation.

### 5.2 Legal/controller notification responsibility — `LEGAL_VERIFICATION_REQUIRED`

Whether NoraMedi (the platform) or each individual clinic is the KVKK **data controller** versus **data processor** for a given incident has **not been determined program-wide** as of this document. `LAUNCH_GATES.md` §2.H records this as an outstanding, per-clinic legal dependency: *"Qualified legal counsel must complete a documented applicability determination — covering legal registration, notice, DPA/subprocessor, contractual, data-controller/data-processor obligations, and VERBİS applicability specifically — for each selected pilot clinic, before real patient data is processed for that clinic."* Until that determination exists for a given clinic, **who is responsible for notifying whom** in a breach involving that clinic's data is itself unresolved — this document does not, and per its own instructions must not, assume an answer.

### 5.3 Evidence preservation for legal review

The technical evidence trail built by runbooks 4.4/4.10 (`SecurityIncidentActivity`, `PlatformAdminAuditEvent`, `AuditLog`) is also the evidentiary record a future legal breach determination would rely on. **Do not destroy or alter this evidence even after an incident is technically `closed`** — a `resolve`/`close` transition ends the *technical* lifecycle, it does not end any pending legal-review obligation the incident's own `legalReviewRequired`/`legalReviewStatus` fields may still carry.

### 5.4 Data processor/controller communication — `LEGAL_VERIFICATION_REQUIRED`

`LAUNCH_GATES.md` §2.H additionally records: *"Platform↔clinic processor agreement not yet drafted"* — no DPA/data-processing agreement currently exists for any clinic. There is therefore **no contractually-defined notification channel, format, or timeline from NoraMedi to any clinic today.** This is an explicit, already-documented program blocker (also listed in `docs/compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md` as awaiting legal review), not a new finding of this task — this runbook does not invent an interim substitute for a missing legal instrument.

### 5.5 Regulatory notification process (to the KVK Kurulu and/or affected data subjects) — `LEGAL_VERIFICATION_REQUIRED`

`docs/compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md` records, as its own current state: *"Written breach-response plan content — not yet legally approved."* No specific notification deadline, notification-content requirement, or regulator-communication process is recorded anywhere in this program's accepted legal documentation as of this task. Per this task's own explicit instruction not to invent a legal deadline unsupported by accepted project legal documentation, **the exact timing and process for KVKK Kurulu / data-subject notification is recorded here as `LEGAL_VERIFICATION_REQUIRED`**, not asserted. (General Turkish KVKK regulatory practice is understood by qualified counsel to include Board-notification and data-subject-notification obligations following a breach; this document deliberately does not state a specific figure or process, since none has been adopted into this program's own accepted legal documentation — qualified legal counsel must confirm the applicable requirement before any commitment is made to a regulator, a clinic, or a patient.)

### 5.6 How the technical and legal tracks run together

For any SEV-1 incident that touches patient/PHI data (runbook 4.4 or, when patient data is implicated, 4.10), the technical containment/evidence-preservation steps and the legal-path determination above run **in parallel**, starting at the moment of escalation — not sequentially, and not gated on each other's completion. Per `LAUNCH_GATES.md` §0's own "non-collapse" principle (*"Production-verified (technical)"* is explicitly listed as distinct from *"Legally/externally compliant"*), a technically `resolved`/`closed` incident is never itself evidence that any KVKK legal obligation has been satisfied, and vice versa.

## 6. Related documents

- [NORAMEDI_MASTER_TRACKER.md](../NORAMEDI_MASTER_TRACKER.md) — program status source of truth
- [CURRENT_PHASE.md](../CURRENT_PHASE.md) / [phases/F3_PRODUCTION_HARDENING.md](../phases/F3_PRODUCTION_HARDENING.md) — F3 phase status and exit gate
- [RISK_REGISTER.md](../RISK_REGISTER.md) — R-018, R-019, R-029…R-040, R-046, R-061, R-062, R-070 all directly informed this document
- [PRODUCTION_TOPOLOGY.md](../PRODUCTION_TOPOLOGY.md) — deployment topology this document's commands assume
- [LAUNCH_GATES.md](../LAUNCH_GATES.md) — G1/G2 evidence requirements this document's own gaps (no monitoring/alerting, no automated rollback, no per-account platform-admin disable) trace back to
- [evidence/BACKUP_RESTORE_REHEARSAL_001.md](../evidence/BACKUP_RESTORE_REHEARSAL_001.md) — the restore-rehearsal script this document's runbook 4.7 relies on
- [evidence/FILE_BACKUP_COVERAGE_001.md](../evidence/FILE_BACKUP_COVERAGE_001.md) — off-host file-backup capability status (not production-enabled)
- [evidence/F0-009-S1_SECURITY_INCIDENT_TENANT_OWNERSHIP_EVIDENCE.md](../evidence/F0-009-S1_SECURITY_INCIDENT_TENANT_OWNERSHIP_EVIDENCE.md) — worked example of tracing a cross-tenant scoping question
- [evidence/F3-IMPL-002_PRODUCTION_WORKER_PROCESS_CONTRACT.md](../evidence/F3-IMPL-002_PRODUCTION_WORKER_PROCESS_CONTRACT.md), [evidence/F3-IMPL-003_PLATFORM_ADMIN_AUDIT_COVERAGE.md](../evidence/F3-IMPL-003_PLATFORM_ADMIN_AUDIT_COVERAGE.md), [evidence/F3-IMPL-004_PII_PHI_LOG_HYGIENE_WAVE1.md](../evidence/F3-IMPL-004_PII_PHI_LOG_HYGIENE_WAVE1.md) — the worker/audit/log-hygiene hardening this document builds directly on
- [docs/compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md](../../compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md) — source for §5's `LEGAL_VERIFICATION_REQUIRED` determinations
- [docs/program/evidence/F3-IR-001_INCIDENT_RESPONSE_TABLETOP_DRILL.md](../evidence/F3-IR-001_INCIDENT_RESPONSE_TABLETOP_DRILL.md) — the companion tabletop-drill evidence this runbook was exercised against (`SIMULATED`, `NOT_PRODUCTION_VERIFIED`)

## 7. Document maintenance

This document should be re-validated whenever: `scripts/noramedi-deploy.sh`, `scripts/noramedi-healthcheck.sh`, `scripts/backup-restore-rehearsal.sh`, or `ecosystem.config.cjs` change; a new background job is added to [`startBackgroundJobs.ts`](../../../server/src/jobs/startBackgroundJobs.ts); a new platform-admin route relevant to containment (tenant/user suspension, security-incident lifecycle, backup triggers) is added, removed, or its path changes; or `PRODUCTION_TOPOLOGY.md`/`RISK_REGISTER.md` records a materially different production topology or a newly closed/opened risk this document cites. It is not re-validated automatically — no CI/tooling enforcement exists for runbook-to-code drift (a gap, consistent with this program's currently-manual F3 operational-readiness posture).

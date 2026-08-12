# F3-IR-001 — Incident Response Tabletop Drill Evidence

**Task ID:** F3-IR-001
**Phase:** F3 — Production Hardening
**Type:** Repository-based tabletop simulation. **`SIMULATED` — `NOT_PRODUCTION_VERIFIED`. No production system, database, secret, or process was accessed, modified, or restarted by this drill.**
**Baseline:** `origin/main` @ `92fc0c0c5eee34ae71bd2508bbfcc2f0309e3055`, clean, no drift at task start.
**Companion document:** [docs/program/runbooks/F3_FIRST_CUSTOMER_INCIDENT_RESPONSE.md](../runbooks/F3_FIRST_CUSTOMER_INCIDENT_RESPONSE.md) — every step below cites the runbook section it exercises.
**Status:** `AGENT_COMPLETED` / `DOC_VALIDATION_PASSED` — `NOT_A_REAL_INCIDENT_DRILL`. Never read any part of this document as evidence that a real incident occurred, that any production command was executed, or that the runbook has been validated against real production behavior.

## 0. Method statement

This is a **tabletop exercise**: a structured, repository-grounded walkthrough of how an operator would use the F3-IR-001 runbook and the actual current codebase/topology to respond to two scenarios, run entirely by reading source code and constructing the commands/decisions an operator would issue — **no command in this document was actually executed against any environment, disposable or production.** Every command block below is explicitly marked `[SIMULATED]`. Every log line, timestamp, incident id, organization id, and clinic id shown as "example output" is **illustrative**, invented for readability, and must never be mistaken for real production data — they are marked `[ILLUSTRATIVE]` at first use in each scenario.

This drill's purpose is to verify the runbook is internally consistent with the actual current repository (correct file paths, correct command syntax, correct endpoint paths, correct field names) and to surface any gap in the runbook's own coverage — not to demonstrate production readiness, which remains `NOT_EVALUATED` per `LAUNCH_GATES.md`.

## 1. Scenario A — `noramedi-worker` stops while API remains healthy

**Premise:** `noramedi-worker` (PM2 process, `server/src/worker.ts`) has stopped or crashed. `noramedi-api` continues running normally and `/api/health` continues returning `200`. Outbound reminders accumulate because the reminder job's own 5-minute tick (`cron.schedule('*/5 * * * *', ...)`, [`server/src/jobs/reminders.ts`](../../../server/src/jobs/reminders.ts)) is no longer running anywhere. The issue is discovered only after the expected job interval has passed, not at the moment of failure.

**Runbook reference:** [§4.2 Worker offline / background jobs stopped](../runbooks/F3_FIRST_CUSTOMER_INCIDENT_RESPONSE.md#42-worker-offline--background-jobs-stopped).

### 1.1 Detection

`[SIMULATED]` Because no alerting/monitoring stack exists yet (ADR-012 `DEFERRED`, per `PRODUCTION_TOPOLOGY.md` §7 and `LAUNCH_GATES.md` §2.F), detection in this scenario is manual: an operator either (a) is doing a routine check, or (b) receives a report that a clinic did not get an expected appointment reminder. The operator's first action is the worker-liveness snippet from the runbook's §2 toolkit:

```bash
# [SIMULATED] — not actually executed
pm2 jlist | node -e '
  let raw = ""; process.stdin.on("data", c => raw += c);
  process.stdin.on("end", () => {
    const apps = JSON.parse(raw);
    const w = apps.find(a => a.name === "noramedi-worker");
    console.log(w && w.pm2_env ? w.pm2_env.status : "missing");
  });'
```

`[ILLUSTRATIVE]` example output: `stopped` (or `errored`) — confirming the worker is down while the operator separately confirms `noramedi-api` is `online` via `pm2 describe noramedi-api` and `/api/health` returns `200`, matching this scenario's own premise ("API remains healthy").

### 1.2 Operator commands and scope determination

`[SIMULATED]` The operator next confirms the API is **not** silently covering for the missing worker (per the runbook's explicit containment step — `RUN_BACKGROUND_JOBS=false` is set for `noramedi-api` in [`ecosystem.config.cjs`](../../../ecosystem.config.cjs) since [F3-IMPL-002](F3-IMPL-002_PRODUCTION_WORKER_PROCESS_CONTRACT.md)):

```bash
# [SIMULATED]
pm2 logs noramedi-api --lines 50 --nostream | grep '\[jobs\]'
```

`[ILLUSTRATIVE]` expected line (from [`index.ts`](../../../server/src/index.ts)'s own startup log): `[jobs] API background-jobs ownership: role=api (declared=true) ownsJobs=false (RUN_BACKGROUND_JOBS=false — jobs delegated to a dedicated worker process)`. This confirms scope: **all 9 background jobs are down**, not just some — reminders, post-treatment messaging, Meta template sync, data-retention cleanup, inbound-event retry, imaging-bridge-offline detection, public-booking-notice-evidence cleanup, patient-privacy-export cleanup, clinic-bulk-export worker + cleanup, file-backup, and both external-calendar jobs (enumerated in [`startBackgroundJobs.ts`](../../../server/src/jobs/startBackgroundJobs.ts)).

The operator then captures evidence before restarting, per the runbook's evidence-preservation step:

```bash
# [SIMULATED]
pm2 logs noramedi-worker --lines 200 --nostream
pm2 describe noramedi-worker
```

`[ILLUSTRATIVE]` example `pm2 describe` fields an operator would read: `status: stopped`, `restart time: 4`, `uptime: 0`, giving a rough estimate of how long ago the worker actually died (distinct from when it was *noticed*, which is this scenario's own stated premise — detection lags the actual failure by at least one missed 5-minute tick, plausibly much longer given no alerting exists).

### 1.3 Safe restart

`[SIMULATED]` Following the runbook's recovery step exactly:

```bash
# [SIMULATED]
pm2 startOrReload /var/www/noramedi/ecosystem.config.cjs --only noramedi-worker --update-env
```

This is the same command `scripts/noramedi-deploy.sh`'s own step 6 uses — the operator does not invent a different restart mechanism ad hoc. **This does not touch `noramedi-api`, does not run a database migration, and does not pull new code** — `--only noramedi-worker` scopes the action to exactly the failed process, minimizing blast radius during an active incident.

### 1.4 Duplicate-send protection and JobLock/idempotency implications

This is the scenario's central risk, and the runbook (§4.2) addresses it directly with two independent mechanisms, both traced to their actual source in this repository — not assumed:

1. **`JobLock` (run-level).** [`server/src/utils/jobLock.ts`](../../../server/src/utils/jobLock.ts) implements a Postgres-table-backed lease lock. `startReminderJobs()` in [`reminders.ts`](../../../server/src/jobs/reminders.ts) wraps each 5-minute tick in `withJobLock('reminders:notification', 30 * 60 * 1000, runDailyReminderJob)` and `withJobLock('reminders:post-treatment', 30 * 60 * 1000, processScheduledPostTreatmentMessages)`. When the worker restarts and its cron scheduler fires its first tick, `withJobLock` will attempt to claim the lock row; since no other process holds it (the old worker process is gone, its lease will have expired or was never held for the missed ticks), the restarted worker acquires the lock cleanly and runs. **This mechanism's role in this scenario is preventing two processes from running the same tick concurrently** — it does not, by itself, prevent duplicate *sends* across separate, non-overlapping ticks; that is the second mechanism.
2. **Per-recipient dedup keys (send-level).** Each reminder type in `reminders.ts` checks a `prisma.sentMessage.findFirst(...)` or `prisma.setting.findUnique(...)` keyed by a value that includes the local calendar `dateKey` (or an installment/appointment id) — e.g. `` `notification.lastSent.practitionerSchedule.${practitioner.id}.${dateKey}` `` (line ~376) and `` `payment-installment-reminder:${installment.id}:${dateKey}` `` (line ~465) — **before** sending, `continue`-ing past any recipient already marked sent for that key. This is what actually prevents the "accumulated" reminders from causing a flood of duplicates once the worker resumes: a reminder already sent earlier the same local day is not resent, no matter how many ticks were missed in between.

**Verified edge case, called out explicitly (not silently assumed away), per the runbook's own text:** if the outage spans a local-day boundary, `dateKey` changes for "today," and a reminder that should have gone out on the missed day is **not** retroactively sent — the dedup/query window is scoped to the *current* local day only. So: no duplicate risk across a multi-day outage, but a real risk of a **silently missed** (not duplicated) reminder for any fully-skipped day. This drill confirms the runbook states this correctly against the actual source, rather than asserting a stronger "fully self-healing" claim the code does not actually support.

### 1.5 Verification

`[SIMULATED]` Following restart, the operator polls until online (same pattern as `noramedi-deploy.sh`'s own `verify_pm2_online`):

```bash
# [SIMULATED]
pm2 jlist | node -e '... same snippet as §1.1 ...'
pm2 logs noramedi-worker --lines 50 --nostream
```

`[ILLUSTRATIVE]` expected confirmation lines: `[worker] Background job worker starting... role=worker (declared=true) ownsJobs=true (worker process always owns jobs — RUN_BACKGROUND_JOBS does not apply here, only to the API process)`, then `[worker] All background jobs scheduled.`, then — after the next 5-minute tick fires — `[reminders] Notification reminder job complete.` The operator watches at least one full tick complete cleanly before considering the incident resolved, not just the process reaching `online`.

### 1.6 Rollback / escalation

`[SIMULATED]` No code change occurred, so there is nothing to roll back for a clean restart. Per the runbook: **if** the restarted worker crash-loops (`pm2 describe noramedi-worker` shows a rapidly climbing restart count with `status: errored`), the operator escalates from SEV-2 to SEV-1 and treats it as a possible code/config regression, following the API-outage runbook's (§4.1) prior-commit-redeploy path instead of retrying the same restart indefinitely. This scenario, as posed (worker stopped, API healthy, discovered after the expected interval), resolves at SEV-2 with a clean restart — escalation to SEV-1 is a documented contingency, not this scenario's own outcome.

### 1.7 Drill outcome

`SIMULATED` / `NOT_PRODUCTION_VERIFIED`. The runbook's §4.2 steps were checked command-by-command against the actual current repository (`ecosystem.config.cjs`, `reminders.ts`, `jobLock.ts`, `startBackgroundJobs.ts`, `index.ts`, `worker.ts`) and found internally consistent — every file path, function name, log line, and command syntax cited exists in the repository as described. No gap was found in this scenario's runbook coverage during this drill.

## 2. Scenario B — suspected cross-tenant patient data exposure

**Premise:** A signal (automated detection or manual report) suggests one organization's patient data has become visible to a different organization. The scenario is worked as a **suspected**, not yet fully confirmed, exposure — the drill exercises the decision points an operator faces before full confirmation exists, which is the harder and more realistic case.

**Runbook reference:** [§4.4 Suspected tenant data exposure](../runbooks/F3_FIRST_CUSTOMER_INCIDENT_RESPONSE.md#44-suspected-tenant-data-exposure) and [§5 KVKK personal/health-data breach path](../runbooks/F3_FIRST_CUSTOMER_INCIDENT_RESPONSE.md#5-kvkk-personalhealth-data-breach-path).

### 2.1 Detection

`[SIMULATED]` Two plausible detection paths, both real capabilities of this repository, not invented for the drill:

```bash
# [SIMULATED] — automated-signal path
curl -s -b "$PLATFORM_SESSION_COOKIE" \
  'https://api.noramedi.com/api/platform/security/incidents?category=cross_tenant_access&status=open'
```

`[ILLUSTRATIVE]` example response shape (fields per [`platformSecurityIncidents.ts`](../../../server/src/routes/platformSecurityIncidents.ts)'s `toIncidentDTO`):
```json
{
  "total": 1,
  "data": [{
    "id": "[ILLUSTRATIVE-incident-id]",
    "organizationId": "[ILLUSTRATIVE-org-A]",
    "clinicId": "[ILLUSTRATIVE-clinic-A1]",
    "category": "cross_tenant_access",
    "severity": "high",
    "status": "open",
    "affectedResourceType": "[ILLUSTRATIVE-resource-type]",
    "affectedResourceId": "[ILLUSTRATIVE-resource-id]"
  }]
}
```
Or, the manual-report path: a support ticket names a clinic that reports seeing a patient it does not recognize — the operator's first action either way is the same acknowledgment step below.

### 2.2 Containment

`[SIMULATED]`
```bash
# [SIMULATED] — starts the auditable clock
curl -s -b "$PLATFORM_SESSION_COOKIE" -X POST \
  'https://api.noramedi.com/api/platform/security/incidents/[ILLUSTRATIVE-incident-id]/acknowledge'
```
This transition itself writes an audited `SecurityIncidentActivity` row (per [`securityIncidentService.ts`](../../../server/src/services/security/securityIncidentService.ts)'s lifecycle-mutation design — every status change is one DB transaction that updates `SecurityIncident` and inserts an activity row together), so the drill confirms the very first response action is itself part of the evidence trail, not a side-channel note.

### 2.3 Access-freeze decision point

`[SIMULATED]` The runbook is explicit that suspension is a **decision-owner-gated** action, not an automatic one — this drill exercises that decision point rather than skipping it. The operator has two real, already-implemented options, neither hypothetical:

```bash
# [SIMULATED] — suspend the exposed organization, requires decision-owner approval first
curl -s -b "$PLATFORM_SESSION_COOKIE" -X PATCH \
  'https://api.noramedi.com/api/platform/organizations/[ILLUSTRATIVE-org-A]/status' \
  -H 'Content-Type: application/json' \
  -d '{"status":"suspended"}'

# [SIMULATED] — or suspend only the specific affected clinic
curl -s -b "$PLATFORM_SESSION_COOKIE" -X PATCH \
  'https://api.noramedi.com/api/platform/clinics/[ILLUSTRATIVE-clinic-A1]/status' \
  -H 'Content-Type: application/json' \
  -d '{"status":"suspended"}'
```

**Decision point walked through explicitly:** the runbook instructs the operator to escalate to the decision owner **in parallel with**, not sequentially before, initial containment/evidence steps — but the actual suspension call itself is not issued without that approval, because it is a customer-visible, business-impacting action (a paying clinic loses access) that this document's own non-authorization statement (§0) reserves for the decision owner. This drill treats "escalate and wait for the suspension decision" as the correct simulated action at this step, **not** issuing the PATCH — mirroring how a real operator should behave when the exposure is *suspected* (per this scenario's premise) rather than fully confirmed and actively ongoing.

### 2.4 Logs / audit evidence

`[SIMULATED]`
```bash
# [SIMULATED]
curl -s -b "$PLATFORM_SESSION_COOKIE" -X POST \
  'https://api.noramedi.com/api/platform/security/incidents/[ILLUSTRATIVE-incident-id]/investigate'
curl -s -b "$PLATFORM_SESSION_COOKIE" \
  'https://api.noramedi.com/api/platform/security/incidents/[ILLUSTRATIVE-incident-id]/activity'
```
`[ILLUSTRATIVE]` the activity feed would show, in order: `acknowledge` (§2.2) then `investigate`, each with `actorPlatformAdminId` and a timestamp — an immutable, actor-attributed record per [`securityIncidentService.ts`](../../../server/src/services/security/securityIncidentService.ts)'s own design statement that `SecurityIncidentActivity`, not the general-purpose `AuditLog`, is the dedicated audit trail for these lifecycle mutations (chosen specifically because `AuditLog` is user/org-centric and has no `actorPlatformAdminId` column, and a platform-wide incident may have no `organizationId` at all).

### 2.5 Scope determination

`[SIMULATED]` The runbook is explicit that scope determination must use a **targeted, read-only re-run of the exact flagged query/endpoint**, never a blanket cross-tenant scan (which would itself risk further exposure). In this drill, the operator's simulated action is: identify the exact resource type/id from the incident's `affectedResourceType`/`affectedResourceId` fields, then construct the narrowest possible read-only query that confirms which specific patient/clinic records were actually exposed and to which specific unauthorized viewer(s) — not a general "scan everything" query. No such query is executed in this drill (repository-based tabletop only); the drill confirms the runbook's instruction is unambiguous about *how narrow* the scope-determination query must be, which is the actual point being exercised.

### 2.6 Tenant notification decision point

`[SIMULATED]` The runbook does not, and per its own instructions must not, assert a specific notification deadline or process here — it routes this decision to §5 of the runbook (the KVKK breach path), which records:
- **Legal/controller responsibility** (§5.2) is itself `LEGAL_VERIFICATION_REQUIRED` — whether NoraMedi or the affected clinic bears the primary notification duty for this specific exposure has not been determined program-wide (`LAUNCH_GATES.md` §2.H).
- **Data processor/controller communication** (§5.4) is `LEGAL_VERIFICATION_REQUIRED` — no DPA/processor agreement exists yet for any clinic, so there is no contractually-defined channel to notify the affected clinic(s) through.
- **Regulatory/data-subject notification timing** (§5.5) is `LEGAL_VERIFICATION_REQUIRED` — `docs/compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md`'s own recorded state is "written breach-response plan content — not yet legally approved," and this drill does not invent a deadline in its place.

This drill's simulated decision at this point is: **escalate to the decision owner and flag all three items above for qualified legal counsel, in parallel with continuing technical investigation** — exactly matching the runbook's §5.6 instruction that the technical and legal tracks run together, not sequentially, and that a technically-resolved incident is never itself evidence of legal compliance.

### 2.7 No destructive evidence cleanup

`[SIMULATED]` The drill explicitly checks this negative requirement: at no point in this scenario does the runbook instruct deleting, editing, or truncating any `SecurityIncidentActivity`, `PlatformAdminAuditEvent`, or `AuditLog` row — including rows that might reflect poorly on the platform (e.g. showing the exposure existed for some period before detection). The runbook states this explicitly (§4.4 evidence-preservation step, §5.3) and this drill confirms no step in the walkthrough contradicts it. If a real incident's remediation required, say, correcting a misconfigured scope on a record, the correction itself would be a **new**, audited mutation — never a retroactive edit/deletion of the incident's own evidence trail.

### 2.8 Security escalation

`[SIMULATED]` Per the runbook: SEV-1, always, for this category, regardless of whether the exposure is ultimately confirmed or downgraded to a false positive after investigation — the *initial* classification at detection is SEV-1 given the category (`cross_tenant_access` involving patient data), and de-escalation only happens after investigation concludes, via the incident's own `false_positive` transition (`POST .../false-positive`), never by silently downgrading severity without that recorded transition.

### 2.9 Drill outcome

`SIMULATED` / `NOT_PRODUCTION_VERIFIED`. The runbook's §4.4 and §5 steps were checked against the actual current repository (`securityIncidentService.ts`'s lifecycle model and transition graph, `platformSecurityIncidents.ts`'s exact route paths and request/response shapes, `platformAdmin.ts`'s organization/clinic suspension routes, and the three `LAUNCH_GATES.md`/compliance-doc citations backing the KVKK breach-path's `LEGAL_VERIFICATION_REQUIRED` markers) and found internally consistent. One point worth naming as a genuine, not-yet-closed gap this drill surfaced rather than resolved: **there is no dedicated, single-call "freeze this specific patient's record" action** in the platform-admin API as inspected in this task's scope — only organization-level and clinic-level suspension exist. For an exposure that is scoped to a small number of specific patient records rather than an entire clinic, the runbook's current containment options (§4.4/§2.3 above) are coarser than the actual incident may warrant; this is recorded here as a finding for a future task, not fixed by this documentation-only task.

## 3. Cross-cutting findings from this drill

1. **JobLock/dedup-key interaction (Scenario A) is correctly documented but relies on reading three separate files together** (`jobLock.ts`, `reminders.ts`, `backgroundJobsOwnership.ts`) — an operator under incident pressure benefits from the runbook's own consolidated explanation (§4.2) rather than needing to re-derive it from source during a live incident; this drill confirms that consolidated explanation matches the source exactly.
2. **Tenant-suspension granularity (Scenario B) stops at the clinic/organization level** — no verified per-patient-record freeze action exists in the inspected route surface. Recorded as a finding (§2.9), not remediated here (this task's scope is documentation-only, and adding a new containment endpoint would be a runtime-code change explicitly out of scope for F3-IR-001).
3. **Every KVKK-breach-path timing/process question in Scenario B correctly resolves to `LEGAL_VERIFICATION_REQUIRED`** rather than an invented deadline — this drill specifically checked that no step in the walkthrough was tempted into asserting a number (e.g. "72 hours") not actually present in this program's own accepted legal documentation, per this task's explicit instruction.
4. **No monitoring/alerting gap was newly discovered** — both scenarios' detection sections correctly describe today's actual manual-detection reality (ADR-012 `DEFERRED`), consistent with `LAUNCH_GATES.md`'s own accepted G1-scale substitution.

## 4. What this drill does not, and cannot, establish

- It does not establish that the runbook's commands will actually succeed when run against the real production VPS (no production command was executed).
- It does not establish operator response-time performance under real incident pressure (a tabletop walkthrough has no time-pressure component).
- It does not establish that the automated `cross_tenant_access` detection rule in `securityDetectionRules.ts` would actually fire correctly for a real exposure of the kind hypothesized in Scenario B (that would require a real or disposable-environment reproduction, out of this task's documentation-only scope).
- It does not close, mitigate, or otherwise change the status of any `RISK_REGISTER.md` row (R-018, R-019, R-029…R-040, R-046, R-054, R-055, R-061, R-062, R-070 are all referenced by the runbook this drill exercises, and none are modified by this drill).
- It does not constitute, and must never be cited as, a real incident, a real production verification, or a legally-reviewed breach-response exercise.

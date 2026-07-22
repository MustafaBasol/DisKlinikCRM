# PILOT_FIRST_WEEK_MONITORING_PLAN — First-Day Smoke and First-Week Daily Monitoring

**Task ID:** PILOT-ONBOARDING-001
**Baseline commit:** `origin/main` @ `3b4ec9d468f6f93dc67aae5c1fe8fbfe6c7ce80c`.
**Companion documents (do not restate, cross-reference):** [PILOT_CUSTOMER_ONBOARDING_CHECKLIST.md](PILOT_CUSTOMER_ONBOARDING_CHECKLIST.md), [PILOT_CLINIC_ACCEPTANCE_CRITERIA.md](PILOT_CLINIC_ACCEPTANCE_CRITERIA.md), [PILOT_INCIDENT_AND_ROLLBACK_PLAYBOOK.md](PILOT_INCIDENT_AND_ROLLBACK_PLAYBOOK.md), [PILOT_FEATURE_ENABLEMENT_MATRIX.md](PILOT_FEATURE_ENABLEMENT_MATRIX.md).
**Upstream program documents (do not restate, cross-reference):** [../../program/LAUNCH_GATES.md](../../program/LAUNCH_GATES.md) §2.F/§2.G, [../../36-smoke-test-checklist.md](../../36-smoke-test-checklist.md) (existing general manual smoke checklist — this plan is pilot-specific and additive to it, not a replacement), [../../program/PRODUCTION_TOPOLOGY.md](../../program/PRODUCTION_TOPOLOGY.md).

## 0. Scope and non-authorization statement

This plan defines what to check and how often during a pilot clinic's first week live. It does not itself perform any check — every row below is executed and recorded by the evidence owner named in [PILOT_CUSTOMER_ONBOARDING_CHECKLIST.md](PILOT_CUSTOMER_ONBOARDING_CHECKLIST.md) §6, against a real, accepted, onboarded pilot clinic, never against production without that clinic already having passed [PILOT_CLINIC_ACCEPTANCE_CRITERIA.md](PILOT_CLINIC_ACCEPTANCE_CRITERIA.md) §4. No result in this plan may be reported as passed without the concrete command/action and output that produced it, per [../../program/LAUNCH_GATES.md](../../program/LAUNCH_GATES.md) §0's evidence rule.

## 1. Monitoring window

The **first-week monitoring window** begins at go-live (immediately after the first-day smoke checklist in §2 passes) and covers the following 7 calendar days for that specific clinic. Each of up to 3 pilot clinics has its own independent first-week window, tracked separately — do not average or roll up across clinics.

## 2. First-day smoke checklist

Run immediately after go-live, and again after any deploy touching this clinic's environment during the pilot (per [../../program/LAUNCH_GATES.md](../../program/LAUNCH_GATES.md) §5 re-evaluation triggers). All steps use the enabled-only feature set from [PILOT_FEATURE_ENABLEMENT_MATRIX.md](PILOT_FEATURE_ENABLEMENT_MATRIX.md) — do not exercise a restricted module as part of this smoke check.

| # | Step | Expected result | Evidence to record |
|---|---|---|---|
| 1 | `GET /api/health` | `200`, `{"status":"ok"}` | Timestamp, response body |
| 2 | PM2 process check (`noramedi-api`, `noramedi-worker`) | Both `online`, no crash-loop restart count since deploy | `pm2 list`/`pm2 show` output |
| 3 | Log in as the clinic's OWNER user created during onboarding | Successful authentication, correct clinic/tenant context shown | Screenshot or log line reference (no credentials recorded) |
| 4 | Create one real (clinic's own) patient record | Record created, visible only within this clinic's tenant | Patient ID (no PHI beyond what the clinic itself entered) |
| 5 | Book one appointment for that patient | Appointment created and visible on the calendar | Appointment ID |
| 6 | Record one payment against the appointment/patient, if payments are enabled for this clinic | Payment recorded, ledger reflects it | Payment ID |
| 7 | Send one basic communication message respecting consent state, if communication is enabled for this clinic | Message sent or correctly blocked by consent gate — either is a valid pass depending on the patient's actual consent state; document which occurred | Message/consent-gate log reference |
| 8 | Submit one contact request, if that module is enabled | Request recorded and visible to clinic staff | Contact request ID |
| 9 | View one basic report, if limited reporting is enabled | Report renders with this clinic's own data only, no cross-tenant leakage | Report screenshot/reference |
| 10 | Confirm `AuditLog`/`ActivityLog` entries exist for steps 3-9 | Entries present, attributable to the correct actor and clinic | Audit log query result |
| 11 | Confirm no unexpected error-level log entries were produced by steps 3-9 | Clean log window, or every anomaly explained | Log excerpt |

**First-day smoke pass criteria:** all 11 steps produce their expected result, or any deviation is individually triaged and does not indicate a tenant-isolation, data-loss, or security failure. Any such failure halts the pilot for this clinic and moves directly to [PILOT_INCIDENT_AND_ROLLBACK_PLAYBOOK.md](PILOT_INCIDENT_AND_ROLLBACK_PLAYBOOK.md).

## 3. First-week daily monitoring checklist

Run once per day (recommended: same time each day) for the 7-day window in §1, for each active pilot clinic.

| # | Item | What to check | Escalation trigger |
|---|---|---|---|
| 1 | Health endpoint | `GET /api/health` returns `200` | Any non-`200` response, or any `degraded` status |
| 2 | PM2 process status | `noramedi-api` and `noramedi-worker` both `online`; restart counts unchanged or explained | New unexplained restart since previous check |
| 3 | Migration/schema drift | `_prisma_migrations` still shows no pending migrations (only relevant if a deploy occurred that day) | Any pending or failed migration |
| 4 | Backup freshness | Most recent backup timestamp within the observed interval (~11 hours as of this baseline — reconfirm the actual current interval, do not assume it is unchanged) | Backup older than 2x the expected interval, or missing |
| 5 | Error-level log review | Review application logs for this clinic's tenant for new error-level entries since the previous check | Any new error involving tenant scoping, authentication, payments, or consent/communication logic |
| 6 | Audit log activity | Confirm `AuditLog`/`ActivityLog` entries continue to be produced for this clinic's activity (absence of any entries on an active day is itself a signal, not reassuring) | Zero entries on a day with confirmed clinic activity |
| 7 | WhatsApp/Meta delivery status, if communication is enabled | Confirm outbound messages are delivering (not silently failing) and the webhook is receiving delivery/consent-relevant events | Delivery failure rate spike, or webhook silence |
| 8 | Tenant-isolation spot check | Confirm this clinic's data is not visible to, or from, any other pilot clinic's session (manual spot check, not a full regression) | Any cross-tenant visibility |
| 9 | Feature-enablement drift check | Confirm the enabled/disabled state in [PILOT_FEATURE_ENABLEMENT_MATRIX.md](PILOT_FEATURE_ENABLEMENT_MATRIX.md) still matches production configuration for this clinic — nothing restricted was silently enabled | Any drift from the matrix |
| 10 | Open-incident review | Confirm no incident opened per [PILOT_INCIDENT_AND_ROLLBACK_PLAYBOOK.md](PILOT_INCIDENT_AND_ROLLBACK_PLAYBOOK.md) remains untriaged past its response-time target | Any stale untriaged incident |

**Daily record format:** date, evidence owner, each of the 10 items' result (pass/fail/note), and any escalation raised. A day with no entry is a gap, not an implicit pass.

## 4. End-of-week review

At the end of the 7-day window for a given clinic, the evidence owner produces a short written summary (referencing the daily records above, not restating them) covering:
- Whether any incident occurred (link to [PILOT_INCIDENT_AND_ROLLBACK_PLAYBOOK.md](PILOT_INCIDENT_AND_ROLLBACK_PLAYBOOK.md) records, if any).
- Whether any item in [PILOT_FEATURE_ENABLEMENT_MATRIX.md](PILOT_FEATURE_ENABLEMENT_MATRIX.md) should be reconsidered based on the week's evidence.
- Whether the decision owner should be asked to re-evaluate this clinic's G1 approval before onboarding the next clinic, per [PILOT_CLINIC_ACCEPTANCE_CRITERIA.md](PILOT_CLINIC_ACCEPTANCE_CRITERIA.md) §4 item 5.

This summary is an input to the decision owner's judgment. It does not itself constitute G1 approval, general-launch readiness, or a production-verified statement for any feature — see [PILOT_FEATURE_ENABLEMENT_MATRIX.md](PILOT_FEATURE_ENABLEMENT_MATRIX.md) §3 for that distinction.

## 5. Beyond the first week

After the first-week window, monitoring continues for the duration of the pilot at a cadence the decision owner sets (this package does not define a post-week-1 cadence — that is intentionally out of scope, to be defined once first-week evidence exists to inform it).

# PILOT_INCIDENT_AND_ROLLBACK_PLAYBOOK — Customer Support, Incident Escalation, and Rollback/Cutback

**Task ID:** PILOT-ONBOARDING-001
**Baseline commit:** `origin/main` @ `3b4ec9d468f6f93dc67aae5c1fe8fbfe6c7ce80c`.
**Companion documents (do not restate, cross-reference):** [PILOT_CUSTOMER_ONBOARDING_CHECKLIST.md](PILOT_CUSTOMER_ONBOARDING_CHECKLIST.md), [PILOT_CLINIC_ACCEPTANCE_CRITERIA.md](PILOT_CLINIC_ACCEPTANCE_CRITERIA.md), [PILOT_FIRST_WEEK_MONITORING_PLAN.md](PILOT_FIRST_WEEK_MONITORING_PLAN.md), [PILOT_FEATURE_ENABLEMENT_MATRIX.md](PILOT_FEATURE_ENABLEMENT_MATRIX.md).
**Upstream program documents (do not restate, cross-reference):** [../../program/LAUNCH_GATES.md](../../program/LAUNCH_GATES.md) §2.D ("Rollback/cutback method"), [../../program/RISK_REGISTER.md](../../program/RISK_REGISTER.md) R-046, R-061, R-062, R-070, [../../compliance/55-kvkk-security-incident-response-foundation.md](../../compliance/55-kvkk-security-incident-response-foundation.md), [../../program/PRODUCTION_TOPOLOGY.md](../../program/PRODUCTION_TOPOLOGY.md).

## 0. Scope and non-authorization statement

This playbook defines the escalation path and rollback/cutback decision procedure for the controlled pilot. It does not itself perform any rollback, and no step here authorizes an agent to execute a production rollback unilaterally — every rollback action requires the decision owner (or their explicitly delegated on-call operator) to approve it, consistent with [../../program/LAUNCH_GATES.md](../../program/LAUNCH_GATES.md) §0's "no agent may self-assign" rule. This playbook does not create a general-purpose incident-response process for the whole platform — [../../compliance/55-kvkk-security-incident-response-foundation.md](../../compliance/55-kvkk-security-incident-response-foundation.md) is the broader security-incident foundation; this document is the pilot-specific operational supplement to it, scoped to the (at most 3) pilot clinics.

## 1. Support and incident escalation contacts

**No named support/escalation roster exists in this repository as of this baseline.** The table below is a template that must be completed with real, reachable people **before** the first pilot clinic's go-live — it is listed as pre-onboarding check 10 in [PILOT_CUSTOMER_ONBOARDING_CHECKLIST.md](PILOT_CUSTOMER_ONBOARDING_CHECKLIST.md) §2. Leaving any row blank at go-live is itself a go/no-go blocker.

| Role | Name | Contact method | Availability window |
|---|---|---|---|
| Pilot support first point of contact (clinic-facing) | *[to be named]* | | |
| Technical on-call (production/infrastructure) | *[to be named]* | | |
| Database/migration owner | *[to be named]* | | |
| Decision owner (rollback/activation approval) | *[to be named — per [../../program/LAUNCH_GATES.md](../../program/LAUNCH_GATES.md), this is the User, with ChatGPT review; a specific reachable channel must still be recorded here]* | | |
| Legal/compliance contact | *[to be named]* | | |
| Clinic's own point of contact | *[per clinic, recorded during onboarding — see [PILOT_CLINIC_ACCEPTANCE_CRITERIA.md](PILOT_CLINIC_ACCEPTANCE_CRITERIA.md) §2 item 9]* | | |

## 2. Incident severity classification

| Severity | Definition | Example | Response target |
|---|---|---|---|
| SEV-1 | Data loss, cross-tenant data exposure, or a security/privacy incident (including any suspected KVKK-relevant exposure) | A pilot clinic can see another clinic's patient data; a migration rollback destroys rows | Immediate — page technical on-call and decision owner; treat as a candidate KVKK security incident per [../../compliance/55-kvkk-security-incident-response-foundation.md](../../compliance/55-kvkk-security-incident-response-foundation.md) in parallel, not instead of, this playbook |
| SEV-2 | Service unavailable or a core allowed module (patients, appointments, payments, basic communication, contact requests, limited reporting) broken for a pilot clinic | `GET /api/health` failing; appointment booking erroring for all users | Same business day; notify clinic contact per §1 |
| SEV-3 | Degraded but workable — a non-blocking bug, a delayed message, a report rendering issue | WhatsApp delivery delay under Meta's own SLA; a report column formatting issue | Next business day |
| SEV-4 | Cosmetic or clarification request, no functional impact | UI wording feedback | Normal support queue, no rollback consideration |

Any SEV-1 or SEV-2 incident automatically triggers a review of whether §4 rollback/cutback should be invoked — that review's outcome (invoke or not) must be recorded even if the answer is "not invoked."

## 3. Escalation procedure

1. Whoever detects the incident (daily monitoring per [PILOT_FIRST_WEEK_MONITORING_PLAN.md](PILOT_FIRST_WEEK_MONITORING_PLAN.md), a clinic report, or an automated alert if one exists) classifies severity per §2 and notifies the roles in §1 appropriate to that severity.
2. Technical on-call triages: is this a code/infrastructure issue, a data issue, or a feature-activation issue (i.e. does it implicate one of the modules in [PILOT_FEATURE_ENABLEMENT_MATRIX.md](PILOT_FEATURE_ENABLEMENT_MATRIX.md))?
3. If the incident implicates a restricted or manual-approval-required module, the technical on-call confirms it was not, in fact, silently enabled — if it was, that is itself a SEV-1/SEV-2-worthy governance failure independent of the original symptom.
4. Decision owner is briefed and decides: monitor, forward-fix, or invoke rollback/cutback per §4.
5. Once resolved, the incident and its resolution are recorded in the same evidence format as [PILOT_FIRST_WEEK_MONITORING_PLAN.md](PILOT_FIRST_WEEK_MONITORING_PLAN.md)'s daily records, and cross-referenced from that day's entry.
6. If a SEV-1 exposes or is suspected to expose personal data, the legal/compliance contact (§1) is notified in parallel — this playbook does not determine whether a KVKK-reportable event occurred; that determination is [../../compliance/55-kvkk-security-incident-response-foundation.md](../../compliance/55-kvkk-security-incident-response-foundation.md)'s and counsel's, not this document's.

## 4. Rollback/cutback steps

**Read this section together with [../../program/LAUNCH_GATES.md](../../program/LAUNCH_GATES.md) §2.D and §2.G, and [../../program/RISK_REGISTER.md](../../program/RISK_REGISTER.md) R-046/R-061/R-062/R-070 — this playbook restates their operational consequence for the pilot, it does not supersede them.**

### 4.1 General principle: cutback, not physical rollback, is the default

As of this baseline, `scripts/noramedi-deploy.sh` is fail-fast and **not transactional** — there is no automated rollback capability ([../../program/PRODUCTION_TOPOLOGY.md](../../program/PRODUCTION_TOPOLOGY.md)). The default incident response is:

1. **Disable the feature/flag**, if the incident is isolated to a specific feature and a disable control exists (e.g. the HIGH-008 correction workflow's `privacy.legacyConsentCorrection.runtimeEnabled` `PlatformSetting`, per [PILOT_FEATURE_ENABLEMENT_MATRIX.md](PILOT_FEATURE_ENABLEMENT_MATRIX.md) — that workflow is disabled by default for the pilot in the first place, so this step mainly applies if it were ever enabled).
2. **Redeploy a known-good, compatible prior application commit**, keeping all additive database tables/columns in place.
3. **Retain, do not drop, additive schema objects.** Per R-046/R-062, physical schema rollback (dropping newly added tables/columns) is data-loss-free **only while those tables are empty**. Once any pilot clinic has real rows in a newly added table (e.g. consent-correction or audit tables), dropping it destroys that data and, where it is KVKK-relevant evidence, is not an acceptable default action.
4. **Forward-fix** rather than physically reverse a migration, once real data exists.
5. If a schema-level physical rollback is nonetheless judged necessary (an exceptional action, not the default path), it requires: a fresh backup/export first, decision-owner approval, reviewed reverse DDL, and post-rollback reconciliation of `_prisma_migrations` bookkeeping with actual schema state — per R-070, manual DDL rollback can desynchronize `_prisma_migrations` from reality, and `prisma migrate resolve --rolled-back` refuses to act on a cleanly-applied migration (`P3012`) as observed during this program's own rehearsals. This is exceptional-path guidance, not a step-by-step DBA runbook this document is positioned to author.

### 4.2 HIGH-008-specific rollback constraint

Because [PILOT_FEATURE_ENABLEMENT_MATRIX.md](PILOT_FEATURE_ENABLEMENT_MATRIX.md) keeps the HIGH-008 legacy-consent-correction workflow disabled for the entire pilot, the primary rollback risk for this specific workflow (an unsafe blind rollback to a pre-kill-switch commit re-exposing the mutation route, per R-061) should not arise during a correctly configured pilot. If it is ever discovered enabled when it should not be, treat that discovery itself as a SEV-1 (§2) regardless of whether any correction was actually performed, and follow §4.1 — do not blind-rollback the application commit; instead confirm the `PlatformSetting` is `false` and redeploy only a gate-aware compatible commit.

### 4.3 Tenant-scoped cutback

Because each pilot clinic is a separate tenant, an incident isolated to one clinic (e.g. a data-quality issue introduced by that clinic's own usage) may be addressable by suspending that single clinic (disabling its users' access / marking it inactive via the clinic-status control referenced in [PILOT_CUSTOMER_ONBOARDING_CHECKLIST.md](PILOT_CUSTOMER_ONBOARDING_CHECKLIST.md) §2 check 5's `PATCH /clinics/:id/status` endpoint) without affecting the other pilot clinics or requiring an application-wide rollback. Prefer this narrower action over a platform-wide rollback whenever the incident is genuinely single-tenant — verify it is single-tenant first (per §3 step 3's cross-tenant check), since assuming isolation without checking is exactly the kind of gap R-001's accepted temporary risk warns about.

### 4.4 Full pilot cutback (removing a clinic from the pilot, or pausing the pilot entirely)

If an incident's severity or recurrence leads the decision owner to end a specific clinic's participation, or pause the pilot program entirely:
1. Suspend the affected clinic(s)' access (§4.3) or, for a full pause, suspend all pilot clinics.
2. Preserve all data — pilot cutback is an access/activation change, not a data-deletion event, unless a separate, explicit, legally-reviewed data-deletion request is made by the clinic.
3. Notify the clinic contact(s) per §1.
4. Record the cutback decision, reason, and scope in the same evidence trail as §3.
5. Before re-admitting any clinic or resuming the pilot, re-run [PILOT_CLINIC_ACCEPTANCE_CRITERIA.md](PILOT_CLINIC_ACCEPTANCE_CRITERIA.md) §4's go/no-go gate for that clinic — a prior `GO` does not carry forward automatically across a pause.

## 5. Decision authority

Consistent with [../../program/LAUNCH_GATES.md](../../program/LAUNCH_GATES.md) §0 and §2 "Decision authority": the decision owner (User, with ChatGPT review) approves any rollback/cutback, any clinic suspension, and any pilot pause or termination. No agent may self-approve any of these actions. Technical on-call may take immediate protective action to stop active data exposure or loss (e.g. suspending a clinic mid-SEV-1) before the decision owner responds, but must notify the decision owner immediately after and treat the action as provisional pending their review.

# PILOT_CUSTOMER_ONBOARDING_CHECKLIST — Controlled Pilot Customer Onboarding

**Task ID:** PILOT-ONBOARDING-001
**Type:** Documentation-only operational readiness package. No runtime code, migration, configuration, or shared program tracker file is changed by this package.
**Baseline commit:** `origin/main` @ `3b4ec9d468f6f93dc67aae5c1fe8fbfe6c7ce80c`, verified via `git fetch origin main` + `git rev-parse origin/main` at this task's start.
**Companion documents in this package (do not restate, cross-reference):** [PILOT_CLINIC_ACCEPTANCE_CRITERIA.md](PILOT_CLINIC_ACCEPTANCE_CRITERIA.md), [PILOT_FIRST_WEEK_MONITORING_PLAN.md](PILOT_FIRST_WEEK_MONITORING_PLAN.md), [PILOT_INCIDENT_AND_ROLLBACK_PLAYBOOK.md](PILOT_INCIDENT_AND_ROLLBACK_PLAYBOOK.md), [PILOT_FEATURE_ENABLEMENT_MATRIX.md](PILOT_FEATURE_ENABLEMENT_MATRIX.md).
**Upstream program documents (do not restate, cross-reference):** [../../program/LAUNCH_GATES.md](../../program/LAUNCH_GATES.md) (G1/G2 evidence specification — this checklist operationalizes G1 §2 into a step-by-step procedure, it does not replace it), [../../program/RELEASE_GATES.md](../../program/RELEASE_GATES.md), [../../program/RISK_REGISTER.md](../../program/RISK_REGISTER.md), [../../program/KVKK_HIGH008_FREEZE_BOUNDARY.md](../../program/KVKK_HIGH008_FREEZE_BOUNDARY.md), [../../program/PRODUCTION_TOPOLOGY.md](../../program/PRODUCTION_TOPOLOGY.md), [../../program/TEST_OWNERSHIP.md](../../program/TEST_OWNERSHIP.md), [../../compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md](../../compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md), [../../36-smoke-test-checklist.md](../../36-smoke-test-checklist.md).

## 0. Non-authorization statement

**This package defines a procedure and evidence checklist. It does not itself authorize onboarding any clinic, activate any feature, or evaluate G1.** As of this document's baseline commit, [../../program/RELEASE_GATES.md](../../program/RELEASE_GATES.md) records `G1 = NOT_APPROVED` and [../../program/LAUNCH_GATES.md](../../program/LAUNCH_GATES.md) §4 records `G1 = NOT_EVALUATED`. Nothing in this package changes either state. Onboarding the first pilot clinic requires a separate, explicit G1 evaluation and decision-owner approval per [../../program/LAUNCH_GATES.md](../../program/LAUNCH_GATES.md) §7, performed by a task with production/administrative access — a task this documentation-only package does not have and does not claim to have exercised.

This package **does not make a legal conclusion** about KVKK, VERBİS, or any other regulatory compliance, and **does not claim KVKK compliance is complete**. Every legal/VERBİS/DPA item below is a pointer to the qualified-counsel determination [../../program/LAUNCH_GATES.md](../../program/LAUNCH_GATES.md) §2.H already requires per clinic — this package neither performs nor substitutes for that determination.

No clinic identity, contact detail, or configuration value belonging to the repository owner or any other real person or organization (including "Mustafa Basol" or any other demo/test identity used elsewhere in this repository) may be used as the default or example clinic in this package or in the pilot itself. All examples below use a placeholder (`[Pilot Clinic Name]`, `[Clinic Contact]`, etc.) to be filled in per real, consented pilot clinic at onboarding time.

## 1. Pilot limit (fixed scope — do not exceed without a new, explicit decision)

| Parameter | Value |
|---|---|
| Initial pilot size | **1 clinic** |
| Maximum pilot size | **3 clinics**, added one at a time, each going through this checklist independently |
| Onboarding model | **Managed onboarding only** — every clinic is onboarded by an authorized operator following this checklist end to end |
| Self-service signup | **Not offered.** No open, unattended, or self-service clinic-creation flow may be enabled during the pilot. `POST /api/platform/clinics` (`server/src/routes/platformAdmin.ts`) exists as a platform-admin API and is the mechanism used in step 3.2 below — it is not, and must not be exposed as, a public signup form during the pilot. |
| Scope expansion | Adding a 4th clinic, opening self-service signup, or exceeding 3 concurrent pilot clinics is **general launch (G2) scope**, not an extension of this pilot — see [../../program/LAUNCH_GATES.md](../../program/LAUNCH_GATES.md) §3. It requires its own G2 evaluation, not a repeat of this checklist. |

Each of the (at most 3) pilot clinics is onboarded, monitored, and can be rolled back **independently**. A second or third clinic's onboarding does not begin until the first clinic has completed at least [PILOT_FIRST_WEEK_MONITORING_PLAN.md](PILOT_FIRST_WEEK_MONITORING_PLAN.md)'s first-week monitoring window with no unresolved incident, unless the decision owner explicitly records a reason to proceed in parallel.

## 2. Required pre-onboarding checks

None of the checks below may be marked complete on the basis of "believed to be true" or "was true earlier in the program." Each requires a fresh, dated, evidence-citing check at or immediately before the specific clinic's onboarding date, per the state-distinction rules in [../../program/LAUNCH_GATES.md](../../program/LAUNCH_GATES.md) §0.

| # | Check | What "done" means | Primary evidence source |
|---|---|---|---|
| 1 | **Production health** | `GET /api/health` returns `200`/`{"status":"ok"}` (`server/src/index.ts`); PM2 shows both `noramedi-api` and `noramedi-worker` `online` with no unexplained recent restarts | [../../program/LAUNCH_GATES.md](../../program/LAUNCH_GATES.md) §2.F; `scripts/noramedi-healthcheck.sh` |
| 2 | **Migration status** | Read-only query of `_prisma_migrations` (or `prisma migrate status`) shows zero pending migrations at the exact commit deployed to production | [../../program/LAUNCH_GATES.md](../../program/LAUNCH_GATES.md) §2.D; [../../program/RISK_REGISTER.md](../../program/RISK_REGISTER.md) R-062 |
| 3 | **Backup evidence** | Most recent `pg_dump` backup timestamp is within the currently observed backup interval (documented as ~11 hours as of this baseline); backup existence and freshness are confirmed by a fresh check, not assumed | [../../program/RISK_REGISTER.md](../../program/RISK_REGISTER.md) R-030; [../../program/LAUNCH_GATES.md](../../program/LAUNCH_GATES.md) §2.E |
| 4 | **Restore-test evidence** | At least one successful restore rehearsal against a disposable environment is on record, with dated output. As of this baseline, [../../program/RISK_REGISTER.md](../../program/RISK_REGISTER.md) R-032 records the capability (`runRestoreTest()`, `server/src/services/backupService.ts`) exists but **no evidence of an actual run exists** — this is a **currently unmet** pre-onboarding check, not a formality; it blocks the first clinic's onboarding until closed (see §5 below) | [../../program/RISK_REGISTER.md](../../program/RISK_REGISTER.md) R-032; [../../architecture/f0-011-storage-backup-test-matrix.md](../../architecture/f0-011-storage-backup-test-matrix.md) Experiments 25-27 |
| 5 | **Tenant creation** | The clinic's `Organization`/`Clinic` records are created via `POST /api/platform/clinics` (`server/src/routes/platformAdmin.ts`) by an authorized platform operator, using the clinic's real (not placeholder/demo) name, and the resulting `clinicId`/`orgId` are recorded in the onboarding evidence record for this clinic | §3.2 below |
| 6 | **User/role creation** | At least one `OWNER`-role user exists for the clinic and can authenticate. **Known gap**: `POST /api/users` (`server/src/routes/users.ts`) requires an already-authenticated `OWNER`/`ORG_ADMIN`/`CLINIC_MANAGER` — no bootstrap/invite flow for a brand-new tenant's first user was found in this repository as of this baseline. The operator must use whatever first-user creation path exists in the actual deployed operational tooling (e.g. a direct, evidenced, audited administrative action) and **record exactly how the first user was created** — this must not be silently assumed to be self-evident | §3.3 below |
| 7 | **Clinic legal profile** | `ClinicLegalProfile` for the clinic is completed and `isPublished`, with all fields the existing validation requires present: `dataControllerTitle`, `address`, `privacyNoticeText`, `privacyNoticeVersion`, `effectiveDate`, and either `email` or `privacyRequestEmail` (per `server/src/tests/clinicLegalProfile.test.ts`) | §3.4 below |
| 8 | **Audit/log access** | The evidence owner (§6) confirms they can read `AuditLog`/`ActivityLog` records and application logs for this clinic's tenant before go-live — access is demonstrated, not assumed | [../../program/LAUNCH_GATES.md](../../program/LAUNCH_GATES.md) §2.C, §2.F |
| 9 | **WhatsApp/Meta configuration** | If basic communication (see [PILOT_FEATURE_ENABLEMENT_MATRIX.md](PILOT_FEATURE_ENABLEMENT_MATRIX.md)) is in scope for this clinic: `META_APP_ID`, `META_APP_SECRET`, `META_GRAPH_API_VERSION`, `META_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_WEBHOOK_SECRET`, and the connection-token encryption key are confirmed present/valid in the production environment; `ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK` is confirmed `false`; at least one message template the clinic will use is Meta-approved, not merely drafted | §3.5 below |
| 10 | **Support and escalation contacts** | The named escalation contacts in [PILOT_INCIDENT_AND_ROLLBACK_PLAYBOOK.md](PILOT_INCIDENT_AND_ROLLBACK_PLAYBOOK.md) §1 are filled in with real, reachable people **before** this clinic's go-live — this package does not itself name anyone, since no such contact roster exists in the repository as of this baseline | [PILOT_INCIDENT_AND_ROLLBACK_PLAYBOOK.md](PILOT_INCIDENT_AND_ROLLBACK_PLAYBOOK.md) §1 |
| 11 | **G1-blocking risk status** | [../../program/RISK_REGISTER.md](../../program/RISK_REGISTER.md) R-046, R-061, R-029, R-030, R-031, R-032 are individually reviewed at their current status immediately before onboarding (not from memory of an earlier read) — see §5 go/no-go gates | [../../program/LAUNCH_GATES.md](../../program/LAUNCH_GATES.md) §2 "Blockers" |

## 3. Step-by-step onboarding procedure

This is the operational sequence an authorized operator follows once §2 and [PILOT_CLINIC_ACCEPTANCE_CRITERIA.md](PILOT_CLINIC_ACCEPTANCE_CRITERIA.md) are both satisfied for a specific candidate clinic and the decision owner has recorded G1 approval or conditional approval covering this clinic.

1. **Confirm gate status.** Re-read [../../program/LAUNCH_GATES.md](../../program/LAUNCH_GATES.md) §4 and §7 and this checklist's §5 for the current commit. Do not proceed on a stale read.
2. **Create the tenant.** Call `POST /api/platform/clinics` with the clinic's real legal name, contact email/phone, address, `currency`, `timezone`, `defaultLanguage`, and plan limits appropriate to a pilot (do not accept silent defaults — `maxUsers=10`/`maxPatients=500` are the code's own defaults, confirm they are intentional for this clinic, not merely unconsidered). Record the returned `clinicId`/`orgId`, the exact request payload (minus secrets), and the operator identity and timestamp.
3. **Create the first user(s).** Follow whatever first-user bootstrap procedure the deployed environment actually supports (§2 check 6) and record it verbatim, since no such procedure is documented in this repository as of this baseline. Create the OWNER, then any additional named roles the clinic needs, via the authenticated `POST /api/users` path.
4. **Complete the clinic legal profile.** Populate `ClinicLegalProfile` for the clinic and set `isPublished` only once every required field is complete and reviewed — this document does not assert the content is legally sufficient, only that the fields the application enforces are present.
5. **Configure WhatsApp/Meta, if in scope.** Complete §2 check 9. If the clinic does not yet have an approved template or a connected WhatsApp Business number, communication features stay disabled for that clinic per [PILOT_FEATURE_ENABLEMENT_MATRIX.md](PILOT_FEATURE_ENABLEMENT_MATRIX.md) until they do.
6. **Set feature enablement.** Apply [PILOT_FEATURE_ENABLEMENT_MATRIX.md](PILOT_FEATURE_ENABLEMENT_MATRIX.md) exactly — enable only the "allowed initial modules," leave every "restricted" item disabled, and record any manual-approval-required item's approval evidence before touching it.
7. **Run the first-day smoke checklist.** Per [PILOT_FIRST_WEEK_MONITORING_PLAN.md](PILOT_FIRST_WEEK_MONITORING_PLAN.md) §2, immediately after go-live.
8. **Enter the first-week monitoring cadence.** Per [PILOT_FIRST_WEEK_MONITORING_PLAN.md](PILOT_FIRST_WEEK_MONITORING_PLAN.md) §3.
9. **Record the onboarding evidence.** Every step above is recorded with command/action, actor, timestamp, and result — a prose summary without concrete evidence is not acceptable, matching [../../program/LAUNCH_GATES.md](../../program/LAUNCH_GATES.md) §0's evidence rule.

## 4. Do-not list (explicit, per this task's constraints)

This package, and the pilot it describes, must not:
- Modify runtime code, configuration, or migrations to perform onboarding steps — all onboarding actions use existing, already-merged application capability.
- Access production directly as part of authoring this documentation package (this package was authored without production access; all facts about existing endpoints/models are repository-source citations, not live production observations).
- Create a clinic as part of authoring this documentation package.
- Use real patient data anywhere in this package or its examples.
- Update [../../program/NORAMEDI_MASTER_TRACKER.md](../../program/NORAMEDI_MASTER_TRACKER.md), [../../program/RISK_REGISTER.md](../../program/RISK_REGISTER.md), [../../program/RELEASE_GATES.md](../../program/RELEASE_GATES.md), [../../program/LAUNCH_GATES.md](../../program/LAUNCH_GATES.md), or any other shared program tracker file — this package only cross-references them.
- Use Mustafa Basol or any other demo/test identity as a clinic default.

## 5. Go/no-go criteria

See [PILOT_CLINIC_ACCEPTANCE_CRITERIA.md](PILOT_CLINIC_ACCEPTANCE_CRITERIA.md) §4 for the authoritative go/no-go gate list. Summary: onboarding may proceed for a given clinic **only if**, at the time of the decision:
- G1 has been evaluated (not merely defined) by the decision owner for this specific clinic, per [../../program/LAUNCH_GATES.md](../../program/LAUNCH_GATES.md) §7's approval-record template, and recorded as `APPROVED` or `CONDITIONALLY_APPROVED` for this clinic;
- every item in [../../program/LAUNCH_GATES.md](../../program/LAUNCH_GATES.md) §2 "Blockers" is resolved or the decision owner has explicitly accepted it as a governed temporary risk per §2's "Accepted temporary risks" rules — as of this baseline, R-046 and R-061 are `OPEN` (not resolved) and R-032 (restore-test evidence) has no recorded execution, so **the go/no-go decision for the first clinic cannot yet be `GO` on the evidence available at this baseline**;
- qualified legal counsel has completed the per-clinic applicability determination required by [../../program/LAUNCH_GATES.md](../../program/LAUNCH_GATES.md) §2.H for this specific clinic.

## 6. Roles

| Role | Responsibility |
|---|---|
| Decision owner | Evaluates and records G1 status per clinic; the only role that may approve onboarding. Never an agent (per [../../program/LAUNCH_GATES.md](../../program/LAUNCH_GATES.md) §0). |
| Evidence owner | Executes and records §2-§3; not yet assigned as of this baseline — assignment is a prerequisite for the first onboarding, not something this package can assign on its own. |
| Legal counsel | Performs the per-clinic KVKK/VERBİS/DPA applicability determination — external to this repository. |

## 7. Explicit readiness-state distinction

See [PILOT_FEATURE_ENABLEMENT_MATRIX.md](PILOT_FEATURE_ENABLEMENT_MATRIX.md) §3 for the full pilot-ready / general-launch-ready / production-verified distinction, applied per module. At the package level: **this checklist is a pilot-onboarding procedure definition. It is not itself pilot-ready evidence, general-launch-ready evidence, or production-verified evidence for any clinic** — those states are only produced by actually executing this checklist against a real, approved clinic and recording the result.

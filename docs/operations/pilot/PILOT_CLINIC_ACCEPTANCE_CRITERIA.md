# PILOT_CLINIC_ACCEPTANCE_CRITERIA — Which Clinics May Enter the Controlled Pilot

**Task ID:** PILOT-ONBOARDING-001
**Baseline commit:** `origin/main` @ `3b4ec9d468f6f93dc67aae5c1fe8fbfe6c7ce80c`.
**Companion documents (do not restate, cross-reference):** [PILOT_CUSTOMER_ONBOARDING_CHECKLIST.md](PILOT_CUSTOMER_ONBOARDING_CHECKLIST.md), [PILOT_FEATURE_ENABLEMENT_MATRIX.md](PILOT_FEATURE_ENABLEMENT_MATRIX.md), [PILOT_FIRST_WEEK_MONITORING_PLAN.md](PILOT_FIRST_WEEK_MONITORING_PLAN.md), [PILOT_INCIDENT_AND_ROLLBACK_PLAYBOOK.md](PILOT_INCIDENT_AND_ROLLBACK_PLAYBOOK.md).
**Upstream program documents (do not restate, cross-reference):** [../../program/LAUNCH_GATES.md](../../program/LAUNCH_GATES.md) §2, [../../program/RISK_REGISTER.md](../../program/RISK_REGISTER.md).

## 0. Non-authorization and non-legal-conclusion statement

This document defines criteria a candidate clinic must meet before it may be considered for onboarding. It does not itself approve any clinic, and it does not make or imply any legal conclusion about KVKK, VERBİS, DPA, or any other regulatory compliance for any clinic. "Meets these criteria" means the criteria as evaluated by the decision owner and, where stated, qualified legal counsel — never self-assessed by an agent.

## 1. Pilot cohort shape (restated from [PILOT_CUSTOMER_ONBOARDING_CHECKLIST.md](PILOT_CUSTOMER_ONBOARDING_CHECKLIST.md) §1 for context, not redefined here)

1 clinic initially, maximum 3, managed onboarding only, no self-service signup. A clinic is a **candidate**, not accepted, until it passes every check in §2 below and the decision owner records a `GO` per §4.

## 2. Structural eligibility criteria (a candidate clinic must satisfy all of these)

| # | Criterion | Rationale |
|---|---|---|
| 1 | **Single branch / single physical location.** The clinic operates from one location it wants represented as one `Clinic` record. | Application-layer tenant scoping (R-001, `clinicScope.ts`/`clinicAccess.ts`) is the only isolation layer in production today ([../../program/LAUNCH_GATES.md](../../program/LAUNCH_GATES.md) §2.C) — it is accepted as a temporary G1 risk for a small, bounded cohort, not for uncontrolled multi-branch operation. See [PILOT_FEATURE_ENABLEMENT_MATRIX.md](PILOT_FEATURE_ENABLEMENT_MATRIX.md) for the multi-branch restriction. |
| 2 | **Bounded, named data volume.** The clinic can state, in advance, an approximate patient count and expected monthly appointment/message volume, and that volume is small enough that the decision owner is willing to accept the current backup/restore posture (§3 below) for it. | [../../program/RISK_REGISTER.md](../../program/RISK_REGISTER.md) R-029…R-032 (local-only storage/backup, no PITR, restore-test unverified) are accepted only for an *explicitly bounded* pilot cohort, per [../../program/LAUNCH_GATES.md](../../program/LAUNCH_GATES.md) §2.E. |
| 3 | **Owns a WhatsApp Business presence, if basic communication is in its scope.** The clinic can provide or obtain a WhatsApp Business number and complete Meta's embedded-signup/template-approval flow before go-live. | See [PILOT_CUSTOMER_ONBOARDING_CHECKLIST.md](PILOT_CUSTOMER_ONBOARDING_CHECKLIST.md) §2 check 9. A clinic without this cannot use basic communication at go-live; it may still be onboarded with communication disabled. |
| 4 | **No dependency on the HIGH-008 legacy-consent-correction workflow.** The clinic does not require, as a condition of joining, the ability to bulk-correct or migrate pre-existing legacy consent records. | Controlled activation of this workflow is explicitly **not authorized** as of this baseline ([../../program/RISK_REGISTER.md](../../program/RISK_REGISTER.md) R-061, gap 9: `CONTROLLED_ACTIVATION_NOT_AUTHORIZED`). See [PILOT_FEATURE_ENABLEMENT_MATRIX.md](PILOT_FEATURE_ENABLEMENT_MATRIX.md). |
| 5 | **No dependency on bulk data export or bulk/campaign messaging at go-live.** The clinic does not require these as a condition of joining the pilot. | See [PILOT_FEATURE_ENABLEMENT_MATRIX.md](PILOT_FEATURE_ENABLEMENT_MATRIX.md) — bulk export exists in code but is manual-approval-required for the pilot; a bulk/campaign-sending feature does not exist in this codebase at all as of this baseline. |
| 6 | **No dependency on DICOM/imaging, official health-registry integrations, or medical AI decision support at go-live.** | These are out of scope for the pilot entirely — see [PILOT_FEATURE_ENABLEMENT_MATRIX.md](PILOT_FEATURE_ENABLEMENT_MATRIX.md); DICOM/imaging is explicitly G4-gated program territory ([../../program/ARCHITECTURE_DECISIONS.md](../../program/ARCHITECTURE_DECISIONS.md) ADR-011, [../../47-imaging-bridge-contract.md](../../47-imaging-bridge-contract.md)). |
| 7 | **Willing to operate under active, disclosed monitoring.** The clinic accepts that its usage is monitored by the pilot team for the duration of the pilot (per [PILOT_FIRST_WEEK_MONITORING_PLAN.md](PILOT_FIRST_WEEK_MONITORING_PLAN.md)) as a condition of pilot participation, consistent with [../../program/LAUNCH_GATES.md](../../program/LAUNCH_GATES.md) §2 scope ("active human monitoring, reversible onboarding"). | G1 is defined as a monitored pilot, not an unmonitored production deployment. |
| 8 | **Real clinic, not an internal/demo/test identity.** The candidate is a genuine prospective customer with its own legal identity, contacts, and data — never the repository owner, a demo persona, or synthetic test data used elsewhere in this repository. | Explicit constraint of this task; also required for the legal determination in §3 to be meaningful. |
| 9 | **Willing and able to name a single point of contact** for onboarding communication and for receiving incident notifications per [PILOT_INCIDENT_AND_ROLLBACK_PLAYBOOK.md](PILOT_INCIDENT_AND_ROLLBACK_PLAYBOOK.md). | Needed for §1's "managed onboarding" model to function. |

## 3. Legal/compliance prerequisite (gate, not this document's own determination)

Before any real patient data of a candidate clinic is processed, qualified legal counsel must complete the documented, per-clinic applicability determination required by [../../program/LAUNCH_GATES.md](../../program/LAUNCH_GATES.md) §2.H — covering legal registration, notice, DPA/subprocessor, contractual, data-controller/data-processor obligations, and VERBİS applicability specifically for that clinic. This document:
- does **not** perform that determination,
- does **not** assert any clinic currently meets it,
- and treats an unresolved determination as an absolute block on that clinic's onboarding, not a "time-boxed" follow-up item, per [../../program/LAUNCH_GATES.md](../../program/LAUNCH_GATES.md) §2.H's own rule on what may and may not be time-boxed.

The KVKK compliance program's own self-assessment, as of the most recent record cited in [../../program/LAUNCH_GATES.md](../../program/LAUNCH_GATES.md) §1, is **"Conditional Controlled Pilot — not yet cleared."** This document does not upgrade, close, or reinterpret that self-assessment; it is restated here only so a reader of this acceptance-criteria document is not misled into thinking clinic-level structural eligibility (§2) is sufficient on its own.

## 4. Go/no-go gate for a specific candidate clinic

A candidate clinic may move from "candidate" to "accepted, proceed to onboarding" **only if all of the following hold simultaneously**, recorded with evidence, not asserted from memory:

1. Every criterion in §2 is met and recorded.
2. The §3 legal/compliance determination for this specific clinic is complete and does not prohibit the pilot from proceeding for this clinic.
3. [PILOT_CUSTOMER_ONBOARDING_CHECKLIST.md](PILOT_CUSTOMER_ONBOARDING_CHECKLIST.md) §2's eleven pre-onboarding checks are all satisfied as of a fresh check at or immediately before the onboarding date.
4. G1 (per [../../program/LAUNCH_GATES.md](../../program/LAUNCH_GATES.md) §7's approval-record template) has been evaluated by the decision owner and recorded as `APPROVED` or `CONDITIONALLY_APPROVED` covering this specific clinic and the exact commit deployed for it. `NOT_EVALUATED` or `BLOCKED` means **no** — proceeding anyway is out of scope for any agent and requires the decision owner to act outside this documentation package.
5. The current pilot cohort size (including this clinic) does not exceed 3, and if this is not the first clinic, the previous clinic's first-week monitoring window (per [PILOT_FIRST_WEEK_MONITORING_PLAN.md](PILOT_FIRST_WEEK_MONITORING_PLAN.md) §3) completed with no unresolved incident, or the decision owner has explicitly recorded a reason to proceed regardless.

**As of this document's baseline commit**, [../../program/RISK_REGISTER.md](../../program/RISK_REGISTER.md) records R-046 and R-061 `OPEN` and G1 as `NOT_EVALUATED`/`NOT_APPROVED` ([../../program/LAUNCH_GATES.md](../../program/LAUNCH_GATES.md) §4, [../../program/RELEASE_GATES.md](../../program/RELEASE_GATES.md)) — condition 4 above is therefore **not currently met for any clinic**. This is a factual restatement of upstream program state at this task's baseline, not a new finding of this document, and it will go stale as soon as those upstream documents change; re-check them before relying on this section.

## 5. Rejection criteria (explicit — a candidate clinic is not accepted, or is removed from the pilot, if any apply)

- Requires multi-branch operation, bulk export, bulk/campaign messaging, the HIGH-008 correction workflow, DICOM/imaging, official health-registry integration, or medical AI decision support as a condition of participation (§2 items 1, 4, 5, 6).
- Cannot name a single point of contact, or is unwilling to be actively monitored.
- Legal counsel's per-clinic determination prohibits the pilot from proceeding, or is unresolved.
- Data volume is not boundable to a size the decision owner is willing to accept given the current backup/restore/PITR gaps ([../../program/RISK_REGISTER.md](../../program/RISK_REGISTER.md) R-029…R-032).
- Would bring the concurrent pilot cohort above 3 clinics.
- Is the repository owner, a demo persona, or would use synthetic/non-real patient data in place of its own real operational data (a clinic using entirely synthetic test data for its own internal evaluation purposes is not a "pilot clinic" in this package's sense and should use a separate, non-production-pilot evaluation path instead — out of scope for this package to define).

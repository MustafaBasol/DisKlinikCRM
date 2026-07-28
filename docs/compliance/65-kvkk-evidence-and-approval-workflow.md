# 65 — KVKK Legal/Incident Readiness Package: Evidence and Approval Workflow

**STATUS: `DRAFT_FOR_COUNSEL_REVIEW`.**

## 0. Purpose

Documents 56–59 (`docs/compliance/61-kvkk-data-processing-agreement.md`,
`62-kvkk-subprocessor-register.md`, `63-kvkk-personal-data-breach-procedure.md`,
`64-kvkk-incident-contact-roster.md` — together "the Readiness Package") define
*what* must exist. This document defines *how the Readiness Package moves from draft
to something that can actually be relied upon* — what evidence is required at each
step, who may approve what, and how that approval is recorded, so that "we wrote a
document" is never silently mistaken for "this was reviewed/approved/executed."

This document borrows its non-collapse discipline directly from
`docs/program/LAUNCH_GATES.md` §0, which already established this pattern for the
broader launch-readiness program — this document applies the same discipline
specifically to the Readiness Package, without restating or superseding that document.

## 1. Non-collapse states for this package

The following states are distinct and must never be merged into one another in any
status line, commit message, or PR description referencing the Readiness Package:

| State | Distinct from |
|---|---|
| Document drafted (this task) | Reviewed by legal counsel |
| Reviewed by legal counsel | Approved by legal counsel |
| Approved by legal counsel (the template/procedure) | Executed (a clinic-specific DPA instance signed; `docs/compliance/64-...md`'s roster populated with real names) |
| Executed for one clinic | Executed for all onboarded clinics |
| Subprocessor register fact confirmed (e.g. hosting provider identity) | Subprocessor's own DPA/contract obtained and reviewed |
| Breach procedure drafted | Breach procedure rehearsed (a tabletop exercise or real incident walkthrough) |
| Contact roster structure created | Contact roster populated with real, reachable people |
| Roster populated | Roster's people actually reachable when tested (a populated but stale/wrong contact is not equivalent to a verified one) |

Any status claim about the Readiness Package that cannot cite which of these states it
means is incomplete and must not be treated as "done."

## 2. Roles and authority (who may do what)

| Action | Who | Notes |
|---|---|---|
| Draft or edit the Readiness Package's structure/content | Any contributor (engineering, this task) | Drafting is not approval — see §1. |
| Review the Readiness Package for legal accuracy/completeness | Qualified legal counsel (KVKK; GDPR counsel where `docs/compliance/63-...md` §8 applies) | Required before any document's `DRAFT_FOR_COUNSEL_REVIEW` marker is removed or downgraded. |
| Approve the Readiness Package's template/procedure as fit for use | Qualified legal counsel, jointly with the decision owner where the approval has operational/business consequences (e.g. accepting a specific liability-cap placeholder in `docs/compliance/61-...md` §12) | Per `docs/program/LAUNCH_GATES.md` §0's "no agent may self-assign" rule, applied equally here — **no agent/automated process may mark any Readiness Package document as legally approved.** |
| Execute a clinic-specific DPA instance | The clinic's authorized signatory and NoraMedi's authorized signatory (`docs/compliance/61-...md` Annex A), after counsel review | Not an engineering action. |
| Populate the contact roster with real names/contacts | The operator (Mustafa) or their delegate | Per `docs/compliance/64-...md` §4's checklist — an engineering/documentation task cannot invent these. |
| Confirm a subprocessor-register fact (e.g. hosting provider identity, SMTP vendor) | The operator, via direct verification (provider panel, billing record, configuration read) | Not resolvable by repository inspection alone — `docs/compliance/62-...md` marks these `TO BE VERIFIED` for exactly this reason. |
| Decide whether to invoke a rollback/cutback during an actual incident | Decision owner (User, with ChatGPT review), per `docs/operations/pilot/PILOT_INCIDENT_AND_ROLLBACK_PLAYBOOK.md` §5 | Restated here only to keep this document's role table complete — the pilot playbook remains the authoritative source. |

## 3. Evidence requirements per document

| Document | What "reviewed" requires as evidence | What "approved"/"executed" requires as evidence |
|---|---|---|
| `61-...md` (DPA) | A record of counsel's review comments/redline, dated, referencing the exact document version (commit hash) reviewed. | A signed instance per clinic, filed outside this repository (see `docs/compliance/61-...md` §0 item 4), with a reference (clinic name, date, filing location) recorded in that clinic's onboarding evidence trail. |
| `62-...md` (Subprocessor register) | Each `TO BE VERIFIED` row has either been resolved (with a cited evidence source — e.g. "confirmed via provider billing panel, screenshot on file at `<location>`, 2026-MM-DD") or explicitly re-confirmed as still unresolved with a date, so staleness is visible. | Counsel sign-off that the register, as resolved, is complete and that any required subprocessor DPA/SCC is in place per row. |
| `63-...md` (Breach procedure) | Counsel review of the procedure itself (not a specific incident). | Counsel approval of the procedure, **plus** — before it is relied upon as adequate — at least one rehearsal (tabletop or real-incident walkthrough) with its own decision log per that document's §9, demonstrating the procedure is actually usable, not merely readable. |
| `64-...md` (Contact roster) | N/A — a roster is not "reviewed" in the legal sense, it is populated or not. | Every row in `docs/compliance/64-...md` §1's completion checklist (§4 of that document) checked, with the underlying contact verified reachable (a test message/call, not just a recorded phone number). |
| `65-...md` (this document) | Counsel review of the workflow itself. | N/A — this document does not itself require "execution," only that its process is actually followed for the other four. |

## 4. Evidence storage and format

- Evidence citations within the Readiness Package (this document and 56–59) should
  reference either: (a) another file in this repository (relative path), (b) a dated,
  named external record (e.g. "signed DPA on file, `<clinic>`, `<date>`, filed at
  `<location>`") — this repository does not itself store signed agreements or personal
  contact details, consistent with `docs/compliance/61-...md` §0 item 4 and
  `docs/compliance/64-...md` §0.
- Where a production-environment fact is the evidence (e.g. confirming the actual
  configured SMTP host per `docs/compliance/62-...md` §4), follow the same read-only,
  non-destructive verification discipline already established in this program's other
  evidence-gathering tasks (`docs/program/evidence/F0-002_PRODUCTION_BASELINE_EVIDENCE.md`
  is the reference example) — read the fact, do not change production state to gather
  it.
- Do not record secrets (passwords, API keys, raw tokens) as "evidence" anywhere in this
  repository, including in this document's own future updates — reference that a secret
  was confirmed present/valid without reproducing its value, mirroring the existing
  discipline in `docs/compliance/55-...md` §6 ("Raw IP addresses are never stored...")
  applied here to operational secrets rather than patient data.

## 5. Approval record template

Use this template (or an equivalent) each time a Readiness Package document moves from
`DRAFT_FOR_COUNSEL_REVIEW` to a more advanced state (§1). File the completed record
alongside the relevant pilot/onboarding evidence, not as a silent edit to the document's
own status line without a backing record.

```
DOCUMENT: [56 | 57 | 58 | 59]
Document version reviewed (commit hash):
Reviewer (name, qualification — e.g. "KVKK counsel", "GDPR counsel"):
Review date:
Review outcome: [CHANGES REQUIRED | APPROVED AS-IS | APPROVED WITH NOTED CONDITIONS]
Conditions (if any):
Evidence reference (redline, comments, or approval email/letter — where filed):

If this record also constitutes EXECUTION (56 only) or COMPLETION (57/59) or
REHEARSAL (58), additionally record:
  Clinic (if applicable):
  Execution/completion/rehearsal date:
  Signatories / participants:
  Evidence reference:

Sign-off: ______________________  Date: ______
```

## 6. Relationship to the broader launch-gate program

- `docs/program/LAUNCH_GATES.md` §2.H ("External and legal readiness") independently
  requires, for G1 (controlled pilot): a documented per-clinic legal applicability
  determination, a per-clinic VERBİS determination where required, and an **executed**
  DPA per clinic where legally/contractually required. **This Readiness Package
  provides the template and register that determination and execution would use — it
  does not itself satisfy G1 §2.H.** Only a counsel-reviewed, per-clinic-executed
  instance does, per §1's non-collapse table.
- This document does not modify, and is not a substitute for,
  `docs/program/NORAMEDI_MASTER_TRACKER.md`, `docs/program/RISK_REGISTER.md`, or any
  final-reconciliation/gate-status document — those remain owned by the program-tracking
  workstream. Where this Readiness Package's completion becomes relevant evidence for a
  gate evaluation (e.g. G1 §2.H), that evaluation is expected to cite these documents by
  path, not duplicate their content.

## 7. Explicit non-claims

- No document in the Readiness Package (56–60) is, by virtue of existing, legally
  approved, executed, or a certification of KVKK compliance.
- Creating this workflow document does not itself advance any of documents 56–59 past
  `DRAFT_FOR_COUNSEL_REVIEW` — that requires the actual review/approval/execution steps
  in §§2–5 to occur and be evidenced.
- This document does not authorize any agent to self-approve any part of the Readiness
  Package (§2).

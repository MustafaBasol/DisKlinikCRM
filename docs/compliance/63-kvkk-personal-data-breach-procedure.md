# 63 — KVKK Personal Data Breach Notification Procedure

**STATUS: `DRAFT_FOR_COUNSEL_REVIEW`.**

## 0. Scope, authority, and non-authorization statement

This document defines the **operational procedure** NoraMedi follows when a suspected
personal-data breach ("veri ihlali") is detected, up to and including the point where a
legal notification decision is required. **It does not itself make any legal
determination**, and no step in this document may be read as:

- a statement that any specific KVKK Art. 12 notification deadline is fixed at a
  specific number of hours or days — **this document does not invent or assert one**,
  consistent with `docs/compliance/55-kvkk-security-incident-response-foundation.md`'s
  explicit statement that "no statutory deadline is hard-coded anywhere in this codebase
  as legally conclusive, and none should ever be added without counsel sign-off";
- a determination of whether a specific incident is a reportable breach under KVKK Art.
  12, GDPR (where applicable), or any other regime — that determination belongs to
  qualified legal counsel, informed by, but not decided by, this procedure or the
  technical system it describes;
- legal advice, a compliance certification, or evidence that NoraMedi/DisKlinikCRM is
  KVKK-compliant.

This document is the **legal/operational overlay** on top of the technical foundation in
`docs/compliance/55-kvkk-security-incident-response-foundation.md` ("the Technical
Foundation"). The Technical Foundation defines the `SecurityIncident` /
`SecuritySignalEvent` / `SecurityIncidentActivity` data model, detection rules, technical
severity levels, and the Platform Admin triage lifecycle. **This document does not
redefine those** — it defines what happens *next*, from the moment a technical incident
is suspected to be, or is confirmed to be, a personal-data breach requiring a legal
determination, through notification and post-incident review. Where this document
references "the incident record," it means the `SecurityIncident` row and its linked
`SecurityIncidentActivity` timeline in the Technical Foundation, unless the trigger is
something the Technical Foundation does not itself capture (e.g. a report from clinic
staff, a lost device, a paper-record incident) — see §1.2.

## 1. Detection

### 1.1 Technical (in-platform) detection

The Technical Foundation's three mandatory detection rules — authentication
brute-force, cross-tenant access, and clinic-export anomalies — are the platform's
current automated detection surface (`docs/compliance/55-...md` §5). Any incident these
rules surface is visible to a Platform Admin at `/platform/security-incidents`.

### 1.2 Non-technical detection (must not be overlooked)

Not every personal-data breach originates in, or is detectable by, the Technical
Foundation. This procedure applies equally to breaches reported through:

- A clinic staff member noticing something wrong (e.g. a misdirected message, a lost
  laptop/phone, a paper file left accessible).
- A patient complaint or inquiry suggesting their data was exposed.
- A third-party report (a security researcher, a subprocessor's own breach notice to
  NoraMedi under §11 of `docs/compliance/61-kvkk-data-processing-agreement.md`).
- An internal discovery during unrelated work (a developer noticing an authorization
  bug, an operator noticing a misconfigured export).

Whoever first becomes aware of a suspected breach through any of these channels must
report it immediately to the technical on-call contact in
`docs/compliance/64-kvkk-incident-contact-roster.md` — **do not wait to confirm it is
"real" before reporting**; §2 provides for a `false_positive`/no-further-action outcome
if it turns out not to be a breach.

### 1.3 Recording a non-technical-origin incident

If the trigger did not originate from one of the Technical Foundation's own detection
rules, the responding Platform Admin should still create or link a `SecurityIncident`
record (manually, if the platform ever adds that capability, or by another durable
record if not) so the same lifecycle, evidence trail, and audit history apply uniformly
— this avoids a two-tier system where only automatically-detected incidents get a durable
record. `[COUNSEL/OPERATOR: confirm the operational mechanism for this if the platform
UI does not yet support manually opening an incident — until then, use the same
evidence-preservation discipline in §4 via whatever contemporaneous written record is
available, and note the gap in the post-incident review, §11.]`

## 2. Severity and initial classification

Use the Technical Foundation's technical severity scale (`low`/`medium`/`high`/
`critical`, `docs/compliance/55-...md` §3) for the *technical* triage step. This is
**not** the same as a legal breach-risk classification (which considers likelihood and
severity of risk to data subjects' rights and freedoms, a KVKK/GDPR legal concept) —
do not conflate the two. A `low`-technical-severity signal can still turn out to be a
legally significant breach (e.g. a single but highly sensitive record exposed to the
wrong party), and a `high`-technical-severity signal can turn out to be a false positive
or a contained non-breach.

| Step | Who | Action |
|---|---|---|
| 1 | Whoever detects/receives the report | Classify technical severity if applicable (Technical Foundation §3), or note "non-technical, severity not yet assessed" if the trigger came through §1.2. |
| 2 | Technical on-call (§64 roster) | Acknowledge and begin investigation within the response target implied by `docs/operations/pilot/PILOT_INCIDENT_AND_ROLLBACK_PLAYBOOK.md` §2's SEV classification, if the pilot playbook's severity scale also applies to this incident (it does, for any pilot-clinic-affecting incident — that document's SEV-1 explicitly includes "a security/privacy incident (including any suspected KVKK-relevant exposure)"). |
| 3 | Technical on-call | Determine whether personal data (of any category, not only health data) was or may have been involved. If yes, or if uncertain, escalate to the privacy lead (§64 roster) immediately — uncertainty is escalated, not resolved unilaterally by engineering. |

## 3. Containment

1. Take whatever *technical* containment action is appropriate and available, consistent
   with the Technical Foundation §8 (e.g. force a password reset, disable a compromised
   account/clinic, rotate a leaked secret, revoke an exposed token).
2. Prefer the narrowest effective containment action — per
   `docs/operations/pilot/PILOT_INCIDENT_AND_ROLLBACK_PLAYBOOK.md` §4.3, a single-tenant
   incident should be contained at the tenant (clinic) level where possible, rather than
   a platform-wide action, once cross-tenant scope has actually been verified (not
   assumed).
3. Record the containment action taken in the incident's `containmentSummary` (Technical
   Foundation §8) or, for a non-platform incident, in the decision log (§9 below).
4. Containment is a technical action and does **not** itself constitute, replace, or
   pre-empt the legal breach determination in §6.

## 4. Evidence preservation

1. Do not delete, overwrite, or modify any `SecuritySignalEvent` or
   `SecurityIncidentActivity` row related to the incident — both are already append-only
   by design (Technical Foundation §9) and are excluded from the general data-retention
   cleanup job.
2. For evidence outside the platform's own tables (server logs, database query results
   used during investigation, screenshots, third-party provider logs obtained from a
   subprocessor per `docs/compliance/61-...md` §11), preserve copies in a location
   accessible to the privacy lead and legal counsel, with a timestamp and the name of
   who collected them. `[OPERATOR: define the exact storage location for this —
   this document does not assume one exists yet.]`
3. **Never include raw patient content, unredacted patient identifiers, credentials,
   tokens, or secrets in the incident record's operator-facing text fields** — the
   Technical Foundation's `sanitizeSecurityOperatorText()` (§5's four-blocker
   remediation, `docs/compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md` 2026-07-18
   rows) already rejects some of these categories at the code level for
   Platform-Admin-entered incident text; this rule applies with equal force to any
   evidence stored *outside* that system (item 2 above) — do not defeat the platform's
   own sanitization by pasting the same sensitive content into an external document.
4. Preserve a chronological timeline as evidence accumulates (see §9's decision log) —
   reconstructing a timeline after the fact from memory is a known failure mode this
   step exists to prevent.

## 5. Assessment: is this a KVKK Art. 12 "veri ihlali"?

This is the step where technical findings are handed to a human legal determination —
**this system does not, and must not, automate this determination.**

1. The privacy lead compiles: what data, what categories (including whether special
   categories / health data per KVKK Art. 6 were involved — this materially affects risk
   level), how many data subjects, which clinic(s) (data controller(s)), root cause, and
   containment status, from the incident record and any external evidence (§4).
2. This compilation is provided to legal counsel — **not** to the incident's technical
   severity field, and not asserted as a conclusion by this document or any code in this
   repository.
3. Counsel determines: (a) whether this is a reportable "veri ihlali" under KVKK Art. 12,
   (b) which controller(s) (clinic(s)) must be notified, (c) whether the KVKK Board must
   be notified (§6), (d) whether data subjects must be directly notified (§7), and (e)
   the applicable timing for each (§0 — this document does not assert a fixed figure).
4. Until counsel's determination is complete, the incident is treated as a
   **candidate breach** internally (contained, investigated, evidence-preserved) but no
   external communication asserting or denying a breach occurred is made (§6/§7).

## 6. Controller notification and KVKK Board notification decision workflow

Per the technical/legal responsibility boundary already established in
`docs/compliance/55-...md` §2 and §12:

1. **Clinic (data controller) notification is NoraMedi's obligation as processor**,
   independent of whether the clinic itself later decides to notify the KVKK Board — the
   clinic cannot make its own Art. 12 decision without first knowing about the incident.
   NoraMedi notifies the affected clinic(s) as soon as the assessment in §5 identifies
   them as involved, using the contact recorded per
   `docs/compliance/64-kvkk-incident-contact-roster.md` and
   `docs/operations/pilot/PILOT_CLINIC_ACCEPTANCE_CRITERIA.md` §2 item 9 (each pilot
   clinic's own point of contact).
2. **The decision of whether, and when, to notify the KVKK Board (Kişisel Verileri
   Koruma Kurumu) is the data controller's (the clinic's) legal decision**, made with its
   own or NoraMedi-facilitated legal counsel — consistent with
   `docs/compliance/55-...md` §2's role table ("Any determination of whether a
   clinic-facing incident is a reportable 'veri ihlali' ... is the clinic's/counsel's
   call"). NoraMedi, as processor, supports this decision with technical evidence (§4)
   and does not make it unilaterally.
3. **Decision workflow (draft, for counsel confirmation):**

   ```
   Candidate breach identified (§5)
     → Privacy lead compiles technical findings + evidence package
     → Legal counsel reviews: reportable under KVKK Art. 12? [COUNSEL DETERMINATION]
         → NO  → document the negative determination and rationale in the decision log (§9); close
         → YES → identify affected controller(s) (clinic(s))
                 → notify each affected clinic without undue delay (item 1 above)
                 → clinic (with its own/shared counsel) decides: notify KVKK Board? [CONTROLLER DETERMINATION]
                     → the clinic's decision and, if made, the Board notification itself,
                       are the clinic's own actions — this document does not perform them
                       and does not assert a specific timing requirement for them (§0)
                 → proceed to §7 (data-subject communication decision)
   ```
4. **On timing:** KVKK Art. 12 requires the data controller to notify the Board "in the
   shortest time" ("en kısa sürede") following the controller's own learning of the
   breach — this repository's source documents (`docs/compliance/archive/NoraMedi_KVKK_Denetim_Raporu_2026-07-15_v3_REVIZE_full.md`)
   do not establish a specific fixed hour/day figure for this phrase, and this document
   does not invent one. `[COUNSEL: confirm the applicable interpretation of "en kısa
   sürede" for this program, including whether any KVKK Board guidance or precedent the
   platform should follow specifies a benchmark figure — do not treat any number
   appearing in general public commentary as authoritative until counsel confirms it
   against the primary source.]`

## 7. Data-subject communication

1. Whether, when, and how affected data subjects (patients) are directly notified is
   also a controller (clinic)/counsel decision, not a NoraMedi-unilateral action — see
   the communication decision checklist already established in
   `docs/compliance/55-...md` §13, which this document incorporates by reference rather
   than restating.
2. NoraMedi's role is to provide the clinic with the technical facts needed to draft that
   communication (if the clinic requests support) and to ensure no unauthorized/premature
   patient-facing communication is sent from any NoraMedi-controlled channel (e.g. the
   platform's own WhatsApp/email/SMS integrations) without the clinic's and counsel's
   sign-off, per §5 item 4's "no external communication before assessment is complete"
   rule.
3. Any data-subject-facing notification template used must itself go through the same
   `DRAFT_FOR_COUNSEL_REVIEW` discipline as this document — no template is pre-approved
   by this procedure.

## 8. GDPR 72-hour consideration (where applicable)

1. GDPR's Article 33 72-hour supervisory-authority notification requirement applies only
   where the processing falls within GDPR's territorial/material scope (e.g. the
   controller/processor is established in the EU/EEA, or the processing relates to
   offering services to, or monitoring the behavior of, individuals in the EU/EEA) — this
   document does **not** assert that NoraMedi's or any given clinic's processing meets
   that scope; it is a `[COUNSEL: confirm applicability]` question, informed by whether
   the clinic serves any EU/EEA-resident patients and by the international-transfer
   relationships in `docs/compliance/62-kvkk-subprocessor-register.md` (Google/Meta).
2. **If** counsel confirms GDPR applicability for a specific incident, the 72-hour clock
   runs from the controller becoming aware of the breach (GDPR Art. 33(1)) — this is a
   materially different, and separately tracked, timing requirement from the KVKK Art. 12
   "en kısa sürede" standard in §6.4; the two must not be merged into one countdown or
   one notification action without counsel confirming that a single combined notification
   satisfies both regimes.
3. Whether GDPR applies is assessed **per incident**, not assumed to apply platform-wide
   by default, and not assumed to never apply — the presence of EU/EEA subprocessor
   relationships alone does not establish GDPR territorial scope for the *clinic's*
   processing of *its own patients*' data.

## 9. Incident timeline and decision log

Every candidate/confirmed breach must have a decision log recording, at minimum:

| Field | Description |
|---|---|
| Incident reference | `SecurityIncident.id`/`incidentKey`, or a manually-assigned reference for a non-platform-origin incident (§1.3) |
| Detection timestamp | When first detected/reported, and by what channel (§1.1 or §1.2) |
| Severity (technical) | Per Technical Foundation §3, if applicable |
| Containment actions | What, when, by whom (§3) |
| Evidence collected | What, where stored, by whom (§4) |
| Assessment outcome | Counsel's Art. 12 reportability determination and date (§5) — recorded even when the outcome is "not reportable" |
| Controller(s) notified | Which clinic(s), when (§6 item 1) |
| Board notification decision | Recorded as the clinic's decision, with date, even if the decision is "not to notify" (§6 item 3) |
| Data-subject communication decision | Recorded per §7, even if the decision is "no direct communication" |
| GDPR applicability determination | Per §8, even if the outcome is "not applicable" |
| Resolution/closure | Date and summary (Technical Foundation §10/§11 activity-log entry, if platform-tracked) |

This log is the authoritative chronological record for the post-incident review (§11)
and for any future external inquiry — it must be contemporaneous, not reconstructed
after the fact from memory.

## 10. Roles

This document uses the same role definitions as
`docs/compliance/55-kvkk-security-incident-response-foundation.md` §12, plus the named
individuals recorded in `docs/compliance/64-kvkk-incident-contact-roster.md`. It does not
redefine roles independently.

## 11. Post-incident review

1. Once an incident reaches resolution (§9's "Resolution/closure"), the incident owner
   (privacy lead or technical on-call, per §64 roster) schedules a post-incident review
   covering: root cause, what worked in detection/containment, what did not, whether the
   decision log (§9) is complete, and whether this procedure itself needs a correction —
   consistent with the Technical Foundation §11's statement that the activity-log
   timeline is currently the review record; this document adds the legal/decision-log
   dimension the Technical Foundation intentionally does not cover.
2. Any process gap identified (e.g. a missing contact in §64's roster, a step in this
   procedure that did not work in practice) must be corrected as a follow-up action with
   an owner and a due date, not merely noted and forgotten.
3. This document itself should be periodically reviewed against actual incident
   experience once the platform has processed real patient data and, ideally, before
   then as part of pilot-readiness review (`docs/program/LAUNCH_GATES.md` §2.C "Privacy/
   KVKK regression").

## 12. Explicit non-claims

- This document does not claim any incident to date required KVKK Board or data-subject
  notification — no such incident is asserted or implied to have occurred.
- This document does not claim legal approval of its own procedure — see §0.
- This document does not supersede or narrow `docs/compliance/55-...md`'s existing
  communication decision checklist (§13 of that document) — both apply together.

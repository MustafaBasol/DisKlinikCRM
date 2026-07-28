# 61 — KVKK-CRIT-002 / Processor Agreement: Platform↔Clinic Data Processing Agreement (DPA) Framework

**STATUS: `DRAFT_FOR_COUNSEL_REVIEW`.**

This document is **not** an executed legal agreement, is **not** legal advice, and is **not**
a statement that NoraMedi/DisKlinikCRM is KVKK-compliant. It is a structural framework —
a fill-in-the-blanks template plus the technical facts needed to fill it in — prepared so
that Turkish legal counsel (and, where GDPR/international-transfer exposure applies,
counsel qualified on that regime) can review, correct, and finalize an executed
data-processing agreement (Veri İşleyen Sözleşmesi) between each clinic (as data
controller / veri sorumlusu) and NoraMedi (as data processor / veri işleyen). No clause
below may be treated as binding, complete, or sufficient until counsel has reviewed and
the parties have signed a final version.

This document sits alongside, and does not replace:
- `docs/compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md` §3 ("Platform↔clinic
  data-processor agreement and sub-processor list — not yet drafted/approved"), which
  this document is the first drafting pass toward, not the closure of.
- `docs/compliance/62-kvkk-subprocessor-register.md` (this DPA's Annex C references
  that register rather than duplicating it).
- `docs/compliance/55-kvkk-security-incident-response-foundation.md` (this DPA's breach
  cooperation clause references `docs/compliance/63-kvkk-personal-data-breach-procedure.md`
  rather than restating it).
- `docs/program/LAUNCH_GATES.md` §2.H, which independently requires an **executed** DPA
  per pilot clinic before that clinic's real patient data is processed, wherever legally
  or contractually required — this framework document does not itself satisfy that
  requirement; only a counsel-reviewed, signed instance per clinic does.

## 0. How to use this document

1. Legal counsel reviews and edits every clause below — nothing here is final wording.
2. For each clinic, counsel (or an authorized platform representative under counsel's
   guidance) fills in Annexes A–D with that clinic's specifics.
3. Both parties (clinic and NoraMedi's contracting entity) sign.
4. The signed, clinic-specific instance is filed and referenced by clinic name/date in
   the pilot onboarding evidence trail (see `docs/operations/pilot/PILOT_CUSTOMER_ONBOARDING_CHECKLIST.md`),
   not committed to this repository (this repository holds the template only, not
   executed agreements containing counterparties' identifying details).
5. Any field below marked `TO BE VERIFIED` or `[COUNSEL: ...]` must be resolved before
   an instance of this DPA is executed for any real clinic.

## 1. Parties and roles

| Field | Value |
|---|---|
| Data controller (Veri Sorumlusu) | The clinic — legal name, address, and representative to be entered per Annex A for each executed instance. |
| Data processor (Veri İşleyen) | NoraMedi / DisKlinikCRM's operating legal entity. `TO BE VERIFIED` — the exact contracting entity name/registration has not been confirmed in this repository and must not be assumed. |
| Relationship basis | The clinic determines the purposes and means of processing its own patients' personal data (data controller under KVKK Art. 3). NoraMedi processes that data solely to provide the platform, on the clinic's documented instructions (data processor under KVKK Art. 3), consistent with the role analysis in `docs/compliance/archive/NoraMedi_KVKK_Denetim_Raporu_2026-07-15_v3_REVIZE_full.md` §4 ("Veri sorumlusu / veri işleyen ayrımı"). |
| Effective date | Per executed instance (Annex A). |
| Governing law | `[COUNSEL: confirm — presumed Türkiye/KVKK as primary framework, with GDPR relevance limited to the international-transfer analysis in §7]`. |

**This agreement does not, by itself, legalize any processing activity that is otherwise
unlawful.** It documents roles, instructions, and safeguards; the clinic remains
independently responsible for identifying and documenting its own KVKK Art. 5/Art. 6
lawful-processing basis for each processing activity (see the lawful-basis matrix in the
archive report §4, still `Waiting for legal review` per the compliance tracker).

## 2. Subject matter, duration, nature, and purpose of processing

| Field | Detail |
|---|---|
| Subject matter | Provision of the NoraMedi/DisKlinikCRM clinic-management platform (patient records, appointment scheduling, treatment/imaging documentation, billing, and clinic-initiated patient communication via WhatsApp/Instagram/SMS/email where the clinic enables those channels). |
| Duration | For the term of the clinic's subscription/services agreement with NoraMedi, plus any post-termination retention/return/deletion period agreed under §11. |
| Nature of processing | Collection, storage, structured retrieval, transmission (including to the subprocessors in Annex C), and — where the clinic enables AI-assisted messaging features — automated text drafting via a third-party AI subprocessor (see §7 and `docs/compliance/62-kvkk-subprocessor-register.md`). |
| Purpose | Operating the platform's clinical, scheduling, communication, and billing functions for the clinic's own patients, strictly as instructed by the clinic; NoraMedi does not use clinic patient data for its own independent purposes (e.g. platform-wide analytics using identifiable patient data, resale, or unrelated product development) except where §9 explicitly documents an exception. `[COUNSEL: confirm whether any current or planned product-analytics use of aggregated/de-identified data needs a separate disclosure or carve-out here.]` |
| Categories of data subjects | Patients (and, where recorded, their legal guardians/representatives) of the contracting clinic; the clinic's own staff/user accounts (separately, as the clinic's employees/agents, not as the clinic's patients). |
| Categories of personal data, purposes, and retention periods | See Annex B (categories/purposes/retention) — deliberately left as an annex because it should reflect the exact modules/features the clinic actually enables, not a maximal list assumed for every clinic. |

## 3. Processing instructions

- NoraMedi processes personal data **only on the clinic's documented instructions**,
  which are constituted by: (a) this agreement, (b) the clinic's configuration choices
  within the platform (which modules/channels/features it enables — e.g. whether
  AI-assisted WhatsApp drafting is turned on for that clinic), and (c) any additional
  written instruction the clinic gives NoraMedi outside the platform (support tickets,
  signed change requests, etc.).
- NoraMedi must inform the clinic if, in NoraMedi's assessment, an instruction appears to
  infringe KVKK or other applicable data-protection law — and may suspend the specific
  instructed processing pending clarification, without that suspension itself being a
  breach of this agreement. `[COUNSEL: confirm the exact suspension/notice mechanics and
  any liability allocation for a good-faith suspension.]`
- NoraMedi does not process clinic patient data for any purpose outside this agreement's
  subject matter (§2) without the clinic's prior written authorization.

## 4. Confidentiality

- NoraMedi ensures that persons authorized to process the clinic's patient data (its own
  employees, contractors, and any subprocessor's personnel) are bound by a duty of
  confidentiality, whether by contract or statutory obligation, before they may access
  that data.
- Access is restricted to what is necessary to provide the platform (role-based access
  within the application — `OWNER`/`ORG_ADMIN`/clinic-scoped roles, Platform Admin roles
  for platform-operational purposes only) — see `docs/compliance/55-kvkk-security-incident-response-foundation.md`
  §6 for the technical data-minimization controls applied to security-signal capture as
  one concrete example of this principle in the codebase.
- Confidentiality survives termination of this agreement. `[COUNSEL: confirm/insert a
  specific post-termination confidentiality survival period.]`

## 5. Security measures (technical and organizational)

This section records **what technical controls currently exist in the codebase and, where
separately noted, what remains unverified in production** — it must not be read as a
certification that these controls are complete or sufficient; that determination belongs
to counsel and, for infrastructure items, to independent operational verification.

| Control area | Current state | Evidence / gap |
|---|---|---|
| Authentication / secrets | Production fails hard (`process.exit(1)`) if `JWT_SECRET`/`PLATFORM_JWT_SECRET`/`CSRF_SECRET`/`ENCRYPTION_KEY` are unset/weak when `NODE_ENV=production`. | `docs/program/LAUNCH_GATES.md` §2.C. |
| Tenant isolation | Application-layer scoping (`clinicScope.ts`/`clinicAccess.ts`, ~40+ call sites) — the **only** tenant-isolation layer currently deployed; no database-level row-level security exists yet. | `docs/program/RISK_REGISTER.md` R-001, `docs/program/LAUNCH_GATES.md` §2.C. |
| Security incident detection | Durable signal capture, 3 detection rules (auth brute-force, cross-tenant access, export anomalies), Platform Admin triage lifecycle. | `docs/compliance/55-kvkk-security-incident-response-foundation.md` — technical foundation only, not yet deployed to production as of that document's own status line. |
| Transport encryption | TLS termination at host Nginx, Let's Encrypt certificate covering the platform's hostnames. | `docs/program/PRODUCTION_TOPOLOGY.md` §5. |
| Storage-at-rest encryption (database, disk, backups) | `TO BE VERIFIED` — not confirmed in the repository; the compliance audit and `docs/program/PRODUCTION_TOPOLOGY.md` §7 both list this as unverified. | `docs/compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md` §4; `docs/program/PRODUCTION_TOPOLOGY.md` §7. |
| Backup security | Same-host backups only, no confirmed offsite copy, no confirmed encryption, retention 7 days (declared), restore-test capability exists but is `UNVERIFIED` as ever having been exercised. | `docs/program/PRODUCTION_TOPOLOGY.md` §6. |
| Audit logging | `AuditLog`/`ActivityLog` (application-level) plus `SecurityIncidentActivity` (security-incident lifecycle, append-only). | `docs/compliance/55-...md` §9. |
| Data minimization in security telemetry | IP addresses, account identifiers, and user-agents are never stored raw — only HMAC/SHA-256 hashed or fingerprinted; patient content is never captured into security signal metadata. | `docs/compliance/55-...md` §6. |

NoraMedi will notify the clinic of material adverse changes to the above during the term
of this agreement (§8's change-notification mechanic applies analogously to security
posture changes, not only subprocessor changes). `[COUNSEL: confirm whether a more
formal security-review/audit cadence clause is needed — see §12 Audit rights.]`

## 6. Subprocessor authorization

- NoraMedi may engage subprocessors (third parties that process clinic patient data on
  NoraMedi's behalf, e.g. hosting, AI-assisted messaging, communication delivery
  providers) only as listed in `docs/compliance/62-kvkk-subprocessor-register.md`
  ("the Register"), which is incorporated into this agreement by reference (Annex C).
- **General authorization model** (default, subject to counsel confirmation of which
  model to actually use per clinic): the clinic gives general written authorization for
  NoraMedi to engage the subprocessors listed in the Register, subject to NoraMedi
  notifying the clinic of any new subprocessor addition or replacement with a reasonable
  advance notice period. `[COUNSEL: confirm notice period — a common range is 15–30
  days; this document does not assert one.]` During that notice period, the clinic may
  object to a new subprocessor on reasonable data-protection grounds; if the parties
  cannot resolve the objection, `[COUNSEL: define the resolution/termination mechanic]`.
- NoraMedi remains fully liable to the clinic for a subprocessor's acts and omissions in
  processing the clinic's patient data, to the same extent NoraMedi would be liable for
  its own processing. `[COUNSEL: confirm this liability-flow-through clause and its
  interaction with §13 (Liability) placeholders.]`
- Each subprocessor engagement is subject to a written agreement imposing data-protection
  obligations no less protective than this agreement, to the extent applicable to that
  subprocessor's role. `TO BE VERIFIED`, per subprocessor, in the Register — this
  document does not itself confirm any specific subprocessor's contract terms.

## 7. International data transfers

- Certain subprocessors listed in the Register (notably the AI-assisted messaging
  provider and the messaging-channel providers) are, on current evidence, non-Turkish
  entities, meaning use of them very likely constitutes an international transfer of
  personal data under KVKK Art. 9 (post-2024 regime) and, if EU/EEA data-subject
  connections exist, potentially GDPR Chapter V. **Neither this document nor any other
  document in this repository selects or asserts a specific Art. 9 transfer mechanism
  (explicit consent, Board-approved standard contractual clauses, Binding Corporate
  Rules, or an adequacy-equivalent finding) as already satisfied** — this is an open,
  counsel-level decision.
- Known/likely cross-border processing touchpoints as of this document's drafting (see
  the Register, Annex C, for the full classification):
  - Google (Gemini API) — AI-assisted message drafting, where enabled by the clinic;
    only a masked message excerpt and the patient's first name are sent, per the
    data-minimization measure documented in the archive report §7 — this reduces risk,
    it does **not** eliminate the Art. 9 transfer obligation.
  - Meta (WhatsApp Business Cloud API, Instagram) — clinic-patient messaging, where
    enabled by the clinic.
- **Required before this clause can be finalized for any clinic:** counsel selects and
  documents the specific Art. 9 mechanism per subprocessor (and, if relevant, per
  GDPR mechanism), and Annex C is updated to record that selection with a citation to
  the underlying contractual instrument (SCCs, DPA addendum, etc.) once available.
- Until that determination is made, this agreement records the transfer **as a known,
  disclosed fact to the clinic** (satisfying, at minimum, a transparency baseline) without
  asserting that a specific transfer mechanism has been validated.

## 8. Cooperation on data-subject requests

- NoraMedi will, taking into account the nature of the processing, provide the clinic
  with reasonable technical assistance to respond to a data-subject request (access,
  correction, deletion, objection, or other rights under KVKK Art. 11) directed at the
  clinic, insofar as the clinic cannot reasonably fulfill that request using the
  platform's own self-service tooling.
- Existing self-service tooling relevant to this clause: the patient-privacy export
  package and deletion-review dry-run inventory documented in
  `docs/compliance/53-kvkk-attachment-imaging-lifecycle.md`. That document's own scope
  note applies here unchanged: no live-delete endpoint exists for
  attachments/imaging/clinical records as of that document's status — a data-subject
  deletion request that would require actual deletion of such records currently requires
  manual, clinic/NoraMedi-coordinated handling outside the platform's automated tooling,
  under legal guidance on what may lawfully be deleted (see that document and
  `docs/compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md` KVKK-HIGH-003).
- If a data-subject request is misdirected to NoraMedi instead of the clinic (e.g. a
  patient contacts the platform operator directly), NoraMedi will promptly forward it to
  the relevant clinic without acting on it substantively, except as necessary to relay
  it securely. `[COUNSEL: confirm the exact forwarding SLA/timeline expected.]`

## 9. Deletion and return of data on termination

- On termination of the clinic's platform subscription, NoraMedi will, at the clinic's
  election, either delete or return all clinic patient data processed under this
  agreement, subject to:
  - Any legal-hold flag the clinic itself placed on specific records
    (`legalHold`/`legalHoldReason` on `PatientAttachment`/`ImagingStudy`, per
    `docs/compliance/53-...md`), which must be resolved by the clinic before deletion can
    proceed for those specific records.
  - Any retention obligation imposed on NoraMedi by applicable law independent of the
    clinic's instruction (e.g. financial/audit-record retention, `TO BE VERIFIED` for
    exact statutory periods — `[COUNSEL: confirm]`).
  - The current absence of a live medical-record deletion capability (see §8) — until
    that capability exists and a retention-period legal decision is made
    (`KVKK-HIGH-003`, currently `Waiting for legal review`), "deletion" of medical/DICOM
    records on termination is **not** a capability this agreement can currently promise
    to fulfill on a specific timeline; this gap must be disclosed to the clinic, not
    silently assumed away.
- "Return" means providing the clinic an export of its data in a structured, accessible
  format — the existing clinic bulk-export capability
  (`docs/compliance/54-kvkk-secure-clinic-bulk-export.md`) and patient-level export
  package (`docs/compliance/53-...md`) are the current technical mechanisms for this,
  subject to those documents' own scope/feature-flag status.
- Backup copies are **not** immediately purged on termination — they persist per the
  backup retention window (currently ~7 days declared, `docs/program/PRODUCTION_TOPOLOGY.md`
  §6) before natural rotation. `[COUNSEL: confirm whether this needs an explicit
  disclosure clause — likely yes.]`

## 10. Audit rights

- The clinic (or a mutually agreed independent auditor bound by confidentiality) may
  request evidence of NoraMedi's compliance with this agreement's security and processing
  obligations, on reasonable notice and no more than `[COUNSEL: confirm frequency —
  e.g. once annually, or upon a reasonable security concern]`.
- NoraMedi may satisfy an audit request via: (a) providing existing documentation (this
  compliance-document set, relevant test/verification evidence already on record), (b)
  a scoped technical review under NDA, or (c) another mechanism `[COUNSEL: define]` —
  a full unrestricted on-premises audit of shared multi-tenant infrastructure is likely
  impractical and should be scoped narrowly; counsel should define the actual mechanism.
- This clause does not create an obligation for NoraMedi to disclose other clinics' data
  or proprietary source code beyond what is reasonably necessary to demonstrate
  compliance for the requesting clinic's own data.

## 11. Breach cooperation

- If NoraMedi becomes aware of a personal data breach (as defined in
  `docs/compliance/63-kvkk-personal-data-breach-procedure.md`) affecting the clinic's
  patient data, NoraMedi will notify the clinic without undue delay and cooperate with
  the clinic's own KVKK Art. 12 breach-notification obligations, providing available
  technical facts (per that document's evidence-preservation procedure) to support the
  clinic's determination — **NoraMedi does not make the clinic's breach-notification
  determination on the clinic's behalf**, consistent with the technical/legal
  responsibility boundary already established in
  `docs/compliance/55-kvkk-security-incident-response-foundation.md` §2.
- This clause does not itself set a specific notification-time commitment (e.g. "NoraMedi
  will notify within N hours") — `[COUNSEL: confirm whether a specific contractual SLA
  should be added here, separate from and not to be confused with any statutory KVKK
  Art. 12 deadline, which this repository does not assert as fixed — see
  `docs/compliance/63-...md` §0 for why.]`

## 12. Liability

`[COUNSEL: this section is intentionally a placeholder — liability allocation (caps,
carve-outs for gross negligence/willful misconduct, indemnification scope, insurance
requirements) is a commercial/legal negotiation this document cannot pre-populate without
counsel and business-side input.]`

| Placeholder field | Status |
|---|---|
| Liability cap | `TO BE DEFINED BY COUNSEL` |
| Indemnification scope | `TO BE DEFINED BY COUNSEL` |
| Carve-outs (data-protection breach, gross negligence, willful misconduct, IP infringement) | `TO BE DEFINED BY COUNSEL` |
| Insurance requirements (cyber liability, professional liability) | `TO BE DEFINED BY COUNSEL` |

## 13. Term, amendment, and precedence

- This agreement's term tracks the underlying clinic services agreement (§2 Duration).
- Amendments require written agreement of both parties, except where §6 (subprocessor
  notice) provides a specific notice-and-object mechanic.
- `[COUNSEL: confirm precedence order between this DPA, the underlying services/
  subscription agreement, and any clinic-specific order form, in case of conflict.]`

---

## Annex A — Clinic-specific execution details (fill in per instance)

| Field | Value |
|---|---|
| Clinic legal name | `OPERATOR_INPUT_REQUIRED` |
| Clinic address | `OPERATOR_INPUT_REQUIRED` |
| Clinic authorized signatory | `OPERATOR_INPUT_REQUIRED` |
| NoraMedi contracting entity | `TO BE VERIFIED` |
| NoraMedi authorized signatory | `OPERATOR_INPUT_REQUIRED` |
| Effective date | `OPERATOR_INPUT_REQUIRED` |
| Governing law / venue | `[COUNSEL: confirm]` |

## Annex B — Categories of personal data, purposes, and retention (fill in per instance, or adopt a platform-wide default once counsel approves one)

| Category | Purpose(s) | Retention | Notes |
|---|---|---|---|
| Patient identity/contact data | Appointment scheduling, clinic-patient communication | `TO BE VERIFIED` (KVKK-HIGH-003, `Waiting for legal review`) | |
| Health/clinical data (diagnosis, treatment, dental charting, imaging) | Care delivery, medical record-keeping | `TO BE VERIFIED` (KVKK-HIGH-003) | No hard-delete path currently exists — see §9 above. |
| Billing/financial data | Invoicing, payment tracking | `TO BE VERIFIED` — likely subject to independent statutory financial-record retention `[COUNSEL: confirm period]` | |
| Messaging content (WhatsApp/Instagram/SMS/email) | Patient communication, where the clinic enables the channel | `TO BE VERIFIED` | Subject to `ChannelConsentLog`/communication-preference controls (`KVKK-HIGH-007`). |
| Security/audit telemetry (hashed identifiers, not raw patient data) | Security-incident detection, audit trail | Currently indefinite/no automated deletion (`docs/compliance/55-...md` "Retention and privacy") pending a separately-approved retention policy | Does not contain patient content by design. |

## Annex C — Subprocessor list

Incorporated by reference: `docs/compliance/62-kvkk-subprocessor-register.md`. Do not
duplicate that register's content here — reference the current version at execution time
and re-confirm it has not materially changed since the clinic's last review.

## Annex D — Security measures reference

Incorporated by reference: §5 of this document, plus
`docs/compliance/55-kvkk-security-incident-response-foundation.md` and
`docs/program/PRODUCTION_TOPOLOGY.md` for current technical/operational detail. Re-confirm
currency at execution time — both source documents are living documents subject to change.

---

**Repeated for emphasis: this document is a drafting aid, not an executed agreement, not
legal advice, and not a KVKK-compliance certification. Every `[COUNSEL: ...]`,
`TO BE VERIFIED`, and `OPERATOR_INPUT_REQUIRED` marker above must be resolved, and the
resulting instance reviewed and approved by qualified legal counsel, before it is signed
or relied upon for any real clinic's real patient data.**

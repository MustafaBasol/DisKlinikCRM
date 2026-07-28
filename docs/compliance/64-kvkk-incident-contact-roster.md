# 64 — KVKK Security Incident Escalation and Rollback Contact Roster

**STATUS: `DRAFT_FOR_COUNSEL_REVIEW`** (the roster structure and process are drafted;
the roster itself is **not populated** — see §0).

## 0. What this document is and is not

This document defines the **required roles** that must have a named, reachable owner
before real patient data is processed, and provides the structured table to fill them
in. **It does not itself name any individual, phone number, or email address** — this
repository is not the appropriate place to invent or guess personal contact details, and
doing so would create a false impression that a roster exists when it does not.

Every unresolved field below is marked `OPERATOR_INPUT_REQUIRED`. Leaving any required
row incomplete at go-live is itself a go/no-go blocker, consistent with the existing
pilot playbook's own rule: `docs/operations/pilot/PILOT_INCIDENT_AND_ROLLBACK_PLAYBOOK.md`
§1 already states "No named support/escalation roster exists in this repository as of
this baseline... Leaving any row blank at go-live is itself a go/no-go blocker" and
lists a similar, narrower table scoped specifically to the pilot's own support/incident
process. **This document does not replace that table** — it is the broader, KVKK/security-
incident-scoped roster (covering the full escalation path required by
`docs/compliance/63-kvkk-personal-data-breach-procedure.md` and
`docs/compliance/55-kvkk-security-incident-response-foundation.md`), of which the pilot
playbook's table is a pilot-specific subset. When both are eventually filled in, they
should name the same people for overlapping roles — keep them consistent, not
independently drifting; whichever is completed first should be used as the source when
completing the other, rather than each being filled in from scratch independently.

## 1. Required-role contact table

| # | Role | Responsibility | Name | Contact method (primary) | Contact method (backup) | Availability window | Status |
|---|---|---|---|---|---|---|---|
| 1 | Incident commander | Owns the incident end-to-end once declared (Technical Foundation + breach procedure); coordinates all other roles below; makes or obtains the go/no-go call on containment actions that affect production. | `OPERATOR_INPUT_REQUIRED` | `OPERATOR_INPUT_REQUIRED` | `OPERATOR_INPUT_REQUIRED` | `OPERATOR_INPUT_REQUIRED` | `OPERATOR_INPUT_REQUIRED` |
| 2 | Security / engineering on-call | Technical triage, containment, and investigation (`docs/compliance/55-...md` §7/§8); the first technical responder for any detected or reported incident. | `OPERATOR_INPUT_REQUIRED` | `OPERATOR_INPUT_REQUIRED` | `OPERATOR_INPUT_REQUIRED` | `OPERATOR_INPUT_REQUIRED` | `OPERATOR_INPUT_REQUIRED` |
| 3 | Privacy lead | Compiles the assessment package for legal counsel (`docs/compliance/63-...md` §5); owns the decision log (§9 of that document); the point of contact between engineering and counsel. | `OPERATOR_INPUT_REQUIRED` | `OPERATOR_INPUT_REQUIRED` | `OPERATOR_INPUT_REQUIRED` | `OPERATOR_INPUT_REQUIRED` | `OPERATOR_INPUT_REQUIRED` |
| 4 | Clinic contact | Per-clinic, not platform-wide — recorded separately for **each** onboarded/pilot clinic, per `docs/operations/pilot/PILOT_CLINIC_ACCEPTANCE_CRITERIA.md` §2 item 9. This row is a pointer, not a single name — see §2 below for the per-clinic sub-table. | N/A — see §2 | N/A — see §2 | N/A — see §2 | N/A — see §2 | `OPERATOR_INPUT_REQUIRED` (per clinic) |
| 5 | Hosting / infrastructure contact | Reaches the hosting provider (`docs/compliance/62-kvkk-subprocessor-register.md` §1 — provider identity itself `TO BE VERIFIED`) for infrastructure-level incidents (VPS access, network, provider-side security events). Cannot be finalized until the provider identity is confirmed. | `OPERATOR_INPUT_REQUIRED` | `OPERATOR_INPUT_REQUIRED` | `OPERATOR_INPUT_REQUIRED` | `OPERATOR_INPUT_REQUIRED` | `OPERATOR_INPUT_REQUIRED` |
| 6 | Communications lead | Drafts/reviews any external communication (clinic-facing, patient-facing per `docs/compliance/63-...md` §7, or public) — ensures no premature or unauthorized communication is sent from a NoraMedi-controlled channel. | `OPERATOR_INPUT_REQUIRED` | `OPERATOR_INPUT_REQUIRED` | `OPERATOR_INPUT_REQUIRED` | `OPERATOR_INPUT_REQUIRED` | `OPERATOR_INPUT_REQUIRED` |
| 7 | Legal counsel (KVKK) | Makes the Art. 12 reportability, Board-notification-workflow, and data-subject-communication determinations (`docs/compliance/63-...md` §5–§7); reviews this document set's `DRAFT_FOR_COUNSEL_REVIEW` status. | `OPERATOR_INPUT_REQUIRED` | `OPERATOR_INPUT_REQUIRED` | `OPERATOR_INPUT_REQUIRED` | `OPERATOR_INPUT_REQUIRED` | `OPERATOR_INPUT_REQUIRED` |
| 8 | Legal counsel (GDPR, if applicable) | Only required if `docs/compliance/63-...md` §8's applicability question is answered yes for a given clinic/incident — may be the same person/firm as row 7, or a separate specialist; record which. | `OPERATOR_INPUT_REQUIRED` | `OPERATOR_INPUT_REQUIRED` | `OPERATOR_INPUT_REQUIRED` | `OPERATOR_INPUT_REQUIRED` | `OPERATOR_INPUT_REQUIRED` |
| 9 | Backup / restore owner | Executes or directs a database restore-test or an actual recovery (`docs/program/PRODUCTION_TOPOLOGY.md` §6 restore capability — currently `UNVERIFIED` as ever exercised); owns the mandatory pre-G1 restore rehearsal (`docs/program/LAUNCH_GATES.md` §2.E). | `OPERATOR_INPUT_REQUIRED` | `OPERATOR_INPUT_REQUIRED` | `OPERATOR_INPUT_REQUIRED` | `OPERATOR_INPUT_REQUIRED` | `OPERATOR_INPUT_REQUIRED` |
| 10 | Decision owner (rollback / activation approval) | Approves any rollback/cutback, clinic suspension, or pilot pause — per `docs/operations/pilot/PILOT_INCIDENT_AND_ROLLBACK_PLAYBOOK.md` §5 and `docs/program/LAUNCH_GATES.md` §0, this is the User, with ChatGPT review; a specific reachable channel for time-sensitive escalation must still be recorded here. | User (per program documents) | `OPERATOR_INPUT_REQUIRED` (reachable channel) | `OPERATOR_INPUT_REQUIRED` | `OPERATOR_INPUT_REQUIRED` | `OPERATOR_INPUT_REQUIRED` |
| 11 | Database / migration owner | Same role as `docs/operations/pilot/PILOT_INCIDENT_AND_ROLLBACK_PLAYBOOK.md` §1's "Database/migration owner" row — repeated here so this broader roster is self-contained; keep both in sync. | `OPERATOR_INPUT_REQUIRED` | `OPERATOR_INPUT_REQUIRED` | `OPERATOR_INPUT_REQUIRED` | `OPERATOR_INPUT_REQUIRED` | `OPERATOR_INPUT_REQUIRED` |

## 2. Provider escalation contacts

Each subprocessor category in `docs/compliance/62-kvkk-subprocessor-register.md`
requires its own escalation path for the case where the incident originates at, or
requires cooperation from, that provider. These cannot be filled in ahead of the
corresponding register entry being resolved (e.g. row 2 below cannot be completed
meaningfully until §1 of the register confirms the hosting provider's identity).

| Provider | Escalation channel | Account/contract reference | Status |
|---|---|---|---|
| Google (Gemini) | `OPERATOR_INPUT_REQUIRED` (e.g. Google Cloud/AI Studio support channel tied to the account in use) | `OPERATOR_INPUT_REQUIRED` | `OPERATOR_INPUT_REQUIRED` |
| Meta (WhatsApp Business Cloud API / Instagram) | `OPERATOR_INPUT_REQUIRED` (Meta Business Support, tied to the Business Manager/App ID in `server/.env.example`'s `META_APP_ID`) | `OPERATOR_INPUT_REQUIRED` | `OPERATOR_INPUT_REQUIRED` |
| Hosting / VPS | `OPERATOR_INPUT_REQUIRED` — blocked on confirming provider identity, `docs/compliance/62-...md` §1 | `OPERATOR_INPUT_REQUIRED` | `OPERATOR_INPUT_REQUIRED` |
| Email (SMTP provider, once confirmed) | `OPERATOR_INPUT_REQUIRED` — blocked on confirming which SMTP vendor is configured, `docs/compliance/62-...md` §4 | `OPERATOR_INPUT_REQUIRED` | `OPERATOR_INPUT_REQUIRED` |
| SMS provider | Not applicable — `docs/compliance/62-...md` §5 confirms no real SMS provider is integrated yet; add this row's detail when one is. | N/A | `NOT YET APPLICABLE` |

## 3. Per-clinic contact sub-table (deliverable D "clinic contact" row)

To be duplicated for each onboarded/pilot clinic, consistent with
`docs/operations/pilot/PILOT_CLINIC_ACCEPTANCE_CRITERIA.md` §2 item 9. Do not leave this
blank for any clinic that has gone live.

| Clinic name | Clinic contact name | Contact method | Role at clinic | Availability window |
|---|---|---|---|---|
| `OPERATOR_INPUT_REQUIRED` | `OPERATOR_INPUT_REQUIRED` | `OPERATOR_INPUT_REQUIRED` | `OPERATOR_INPUT_REQUIRED` | `OPERATOR_INPUT_REQUIRED` |

## 4. Completion checklist (for Mustafa / the operator to work through)

- [ ] Row 1 (Incident commander) named and reachable.
- [ ] Row 2 (Security/engineering on-call) named and reachable, including a backup for
      when the primary is unavailable.
- [ ] Row 3 (Privacy lead) named and reachable.
- [ ] §3 per-clinic contact table completed for every clinic that has gone live or is
      about to.
- [ ] Row 5 (Hosting contact) — first requires resolving
      `docs/compliance/62-kvkk-subprocessor-register.md` §1's hosting-provider-identity
      `TO BE VERIFIED` item; then record the actual support/escalation channel that
      provider offers (account rep, emergency support line, ticketing portal).
- [ ] Row 6 (Communications lead) named and reachable.
- [ ] Row 7 (Legal counsel — KVKK) named, reachable, and has been engaged to review
      `docs/compliance/61-...md`, `62-...md`, and `63-...md` (i.e. this document set is
      no longer sitting in `DRAFT_FOR_COUNSEL_REVIEW` limbo indefinitely).
- [ ] Row 8 (Legal counsel — GDPR) — decide whether this is needed at all first
      (`docs/compliance/63-...md` §8), then name if so.
- [ ] Row 9 (Backup/restore owner) named, reachable, and has actually rehearsed a
      restore at least once (`docs/program/LAUNCH_GATES.md` §2.E mandatory-rehearsal
      requirement) — naming the role without the rehearsal does not satisfy that gate.
- [ ] Row 10 (Decision owner) — reachable channel recorded (name is already known to be
      the User per program documents; what's missing is the *channel* for
      time-sensitive escalation, not the identity).
- [ ] Row 11 (Database/migration owner) named and reachable; confirmed consistent with
      the same role in `docs/operations/pilot/PILOT_INCIDENT_AND_ROLLBACK_PLAYBOOK.md`
      §1.
- [ ] §2 provider escalation table — Google and Meta rows completed (these are
      `ACTIVE` subprocessors today per `docs/compliance/62-...md`, so these two rows are
      higher priority than the still-`TO BE VERIFIED`/`NOT YET INTEGRATED` rows).
- [ ] Once all of the above are complete, update this document's status line at the top
      from `DRAFT_FOR_COUNSEL_REVIEW` to reflect actual completion — but note that legal
      counsel review of the *procedure* (§0's scope) is a separate checkbox from
      *roster population*; populating names does not itself constitute legal approval of
      `docs/compliance/63-kvkk-personal-data-breach-procedure.md`.

## 5. Maintenance

This roster must be reviewed and reconfirmed:
- Before any new clinic's go-live (§3 addition).
- Whenever a listed individual changes role or becomes unreachable (do not let a stale
  contact silently persist).
- At minimum every 90 days during an active pilot, and immediately upon any
  re-evaluation trigger in `docs/program/LAUNCH_GATES.md` §5 that touches operational
  readiness.
- `[OPERATOR: assign an explicit owner for this recurring review — this document does
  not self-assign one.]`

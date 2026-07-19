# 56 — KVKK-HIGH-007: Communication Preference and Consent Management

Status: **In progress — code review blockers remediated (scope-before-exception
ordering, mandatory WhatsApp consent context, advisory-lock + revision-based
concurrent history, timestamp policy, notice-version/evidence matrix), pending
further review, merge, deployment, production verification, and legal-policy
validation.** Not marked completed, merged, deployed, production-verified,
legally approved, KVKK-compliant, or İYS-compliant.

Branch: `feature/kvkk-high-007-communication-consent-management`, based on
`main` at merge commit `368bcc8d0a9f4c0ea185ca33d4dd1193d8def9ef` (PR #167,
KVKK-CRIT-003); current `main` has since advanced to `131c7cc` (PR #168,
docs-only, no file overlap with this branch — not merged into this branch, as
it is not needed for validation and there is no conflict). Not merged, not
deployed.

This document is **not** a legal compliance certificate and this PR is
**not** legal approval of anything. It records a technical control only.
This PR does **not** constitute legal approval of:

- marketing-consent legal basis or wording;
- İYS (İleti Yönetim Sistemi) integration or obligations;
- mandatory notice text or retention periods;
- controller/processor role determinations;
- KVKK/GDPR compliance in general.

Legal basis, mandatory wording, retention periods, marketing-consent
requirements, İYS obligations, and controller/processor responsibilities
remain subject to Turkish legal counsel. Nothing in this PR should be read
as a substitute for that review.

## 1. Scope

Design and implement a centralized, auditable, channel-specific
communication preference and consent-management foundation so that:

1. Every patient-facing outbound message has an explicit purpose.
2. A single service can answer "is this send allowed?" for any
   patient + clinic + channel + purpose combination.
3. Consent state has both a fast current-state lookup and an immutable
   audit history.
4. Enforcement is off by default and rolls out through an explicit,
   documented flag — this PR changes no default production behavior.

Out of scope: campaign/bulk-messaging functionality (none exists in this
codebase today and none was added), İYS submission, legal notice wording,
webhook subscriptions beyond what already existed, and any change to
account/security email behavior (verification, password reset, invitations
— these were already, and remain, outside patient marketing-consent scope).

## 2. Current-state findings (discovery, pre-implementation)

Performed via CodeGraph + direct reads of `server/prisma/schema.prisma`,
`server/src/services/sms/*`, `server/src/services/whatsapp/*`,
`server/src/services/emailService.ts`, `server/src/services/channelConsentGate.ts`.

### 2.1 Prisma models found

- `Patient` already has four legacy consent-adjacent fields:
  `communicationConsent` (bool), `marketingConsent` (bool), `smsOptOut`
  (bool), `smsOptOutAt` (DateTime?). No channel or purpose dimension.
- `ChannelConsentLog` exists, but is a **narrower, different-purpose**
  model: it records WhatsApp/Instagram inbound-reply opt-in to Meta's
  24-hour messaging window, keyed by `contactIdentifier` (phone or external
  sender id), `channel` ∈ {`whatsapp`, `instagram`} only, no `purpose`
  dimension, and it is append-only history with no "current state" row.
  It is authoritative for its narrow purpose (conversational opt-in
  evidence via `checkChannelConsent`/`logChannelConsent` in
  `channelConsentGate.ts`) and is **left unchanged** by this PR — it solves
  a different problem (Meta's technical messaging-window requirement, not
  KVKK patient communication preference).
- No `PatientCommunicationPreference` / `PatientCommunicationConsentEvent`
  (or equivalent) existed before this PR.
- `MessageTemplate` has its own `purpose` field (per-channel, used for
  Meta template selection) — reused conceptually but not the same
  taxonomy as the new `CommunicationPurpose` enum (see §4).

### 2.2 Outbound communication paths found

| Path | Consent check before this PR? |
|---|---|
| `sendClinicSms` (`services/sms/smsService.ts`) | **Yes** — `evaluateSmsConsent()` gates every send on `smsOptOut` / `marketingConsent` / `communicationConsent`, purpose-aware (`SmsPurpose`, 9 values). The only channel with any centralized consent gate before this PR. |
| `sendProactiveWhatsAppMessage`, `sendNoShowRecoveryWhatsApp`, `sendAppointmentConfirmationWhatsApp`, `sendPostTreatmentWhatsApp` (`services/whatsapp/whatsappOutboundMessaging.ts`) | **No.** Purely template/connection-routing logic (Meta-approved-template requirement, Evolution plain-text fallback). No patient consent field was ever read. |
| `sendWhatsAppMessage` (`services/whatsapp/whatsappService.ts`, used for inbound AI replies and internal staff notifications) | N/A for patient marketing — inbound-triggered/staff-only, out of scope. |
| `sendMail` (`services/emailService.ts`) | N/A — used **only** for account/system email: verification, password reset, staff invitation, clinic registration, platform admin notices. No patient-facing marketing/clinical email path exists anywhere in this codebase today. |
| Recall / no-show recovery / post-treatment follow-up (`jobs/reminders.ts`, `routes/noShows.ts`, `services/postTreatmentMessaging.ts`) | Routed through the WhatsApp/SMS paths above — inherited whichever gate (or lack thereof) that channel had. |
| Bulk/campaign messaging | **Does not exist** in this codebase. Not built as part of this PR (explicitly out of scope per task boundaries). |
| `ChannelConsentLog`-gated flows (`channelConsentGate.ts`, WhatsApp/Instagram AI booking assistant) | Gates conversational data collection consent, not send-time marketing/purpose consent. Unchanged. |

### 2.3 Bypasses identified

- Every WhatsApp send path (proactive reminders, no-show recovery,
  appointment confirmation, post-treatment follow-up) could send to any
  patient regardless of `smsOptOut`/`communicationConsent`/
  `marketingConsent` — those legacy fields were never read outside the SMS
  module.
- No channel had a purpose taxonomy broader than SMS's 9 values, and none
  distinguished `marketing`/`campaign` from `recall`/`clinical_followup`/
  `no_show_recovery` as this PR's taxonomy does.

### 2.4 Transactional vs marketing distinction found

- SMS: `evaluateSmsConsent()` already distinguished `marketing` (needs
  `marketingConsent`) from everything else (needs `communicationConsent`),
  but had no distinct transactional/legal/security exception.
- System emails (verification, password reset, invitations, legal notices)
  are structurally separate — `sendMail()` is only ever called from
  `routes/auth.ts`, `routes/users.ts`, `routes/usersImport.ts`,
  `routes/clinicRegistration.ts`, `routes/platformAdmin.ts` — never from a
  patient-messaging code path. This PR's policy formalizes that existing
  separation (`transactional`/`security_notice`/`legal_notice` are policy
  exceptions — see §5) rather than changing it.

## 3. Data model

Two tables, as required by the task's own design guidance (never rely on
append-only history alone when every send needs a fast lookup; never rely
on a mutable row alone or audit history is lost):

### `PatientCommunicationPreference` — current effective state

One row per `(patientId, clinicId, channel, purpose)` — enforced by
`@@unique([patientId, clinicId, channel, purpose])`. Fields: `status`
(`granted`/`denied`/`withdrawn`/`unknown`/`not_required`), `effectiveAt`,
`grantedAt`, `withdrawnAt`, `expiresAt`, `source`, `evidenceType`,
`noticeVersion`, `policyVersion`, `actorUserId`, `actorPlatformAdminId`,
`requestIpHash`, `userAgentHash`, `externalProviderRef`, `notes`
(sanitized/bounded), `createdAt`, `updatedAt`. A missing row means
`unknown` — the decision service never treats "no row" as `granted`.

### `PatientCommunicationConsentEvent` — immutable history/evidence

One row inserted every time a preference is created or its status
changes. Same evidence fields as above plus `previousStatus`/`newStatus`.
**Never updated or deleted by application code.**

### Concurrency

**Correction (post-review):** an earlier version of this document claimed
that the atomic `INSERT ... ON CONFLICT DO UPDATE` upsert alone was
sufficient to guarantee authoritative concurrent history. That claim was
wrong: the upsert serializes the *current row* at the database level, but
`setCommunicationPreference()` also reads the current row (to compute
`previousStatus`) **before** the upsert runs. Without an explicit lock,
two concurrent transactions can both read the same pre-transition
`previousStatus`, and although exactly one row survives, the recorded
`previousStatus` values would not reflect the actual serialized commit
order.

The fix: `setCommunicationPreference()` now acquires a
`pg_advisory_xact_lock` keyed to the exact `(patientId, clinicId, channel,
purpose)` tuple as the **first statement** inside its `$transaction` —
before the read of the current row. `computeCommunicationPreferenceLockKey()`
derives two signed int32 values from `SHA-256("comm-consent-pref:" +
patientId + ":" + clinicId + ":" + channel + ":" + purpose)`, domain-separated
from other advisory locks in this codebase (e.g. the appointment-slot lock in
`appointmentRequestSafety.ts`) by the fixed `"comm-consent-pref:"` prefix.
This is the same idiom already used for appointment-slot locking, clinic
bulk export, security incidents, and public booking.

The lock makes the read-current-row → upsert → insert-event sequence a true
critical section for one key: concurrent callers for the same key fully
serialize, so `previousStatus` is always the actually-preceding committed
state.

**Deterministic ordering — `revision`, not `createdAt`.** A lock alone still
does not give the event history a deterministic order independent of
timestamps: PostgreSQL `TIMESTAMP(3)` is millisecond-precision, and several
lock-serialized transactions can commit within the same millisecond. Both
`PatientCommunicationPreference` and `PatientCommunicationConsentEvent` carry
a `revision` integer column. `setCommunicationPreference()` computes
`newRevision = (existing?.revision ?? 0) + 1` under the lock and writes it to
both the current row and the event row in the same transaction. Because
writers for one key are fully serialized by the lock, revisions are
contiguous and gap-free by construction; `@@unique([preferenceId, revision])`
on the event table is a DB-enforced backstop, not the primary mechanism.
**`revision` is authoritative only within one `patientId + clinicId + channel
+ purpose` key — it is never a global chronological sequence across
different keys.** Two unrelated chains (e.g. `sms/reminder` and
`whatsapp/marketing`) each start at revision 1 independently, so a query that
returns events from more than one key must not order by `revision` alone —
doing so would interleave unrelated chains and present a misleading
timeline. Every place that reads consent history reflects this:
- when the history endpoint is called with **both** `channel` and `purpose`
  supplied, exactly one chain is selected and it orders by `revision desc`
  — the authoritative, gap-free order for that key;
- when either is omitted (the result may span multiple chains), it orders
  by `createdAt desc` with deterministic tie-breakers (`channel`, `purpose`,
  `revision`, `id`) instead;
- the whole-patient evidence export endpoint always aggregates across every
  channel/purpose key, so it always orders by `createdAt asc` with the same
  tie-breakers (`channel`, `purpose`, `revision`, `id`) — never by `revision`
  alone.

Verified in `server/src/tests/communicationConsent.test.ts` with fixtures
spanning at least two channel/purpose keys whose revisions overlap (e.g.
both chains independently reaching revision 1–3), proving the unfiltered
history endpoint does not treat `revision` as a global sequence.

The transition timestamp (`effectiveAt`, `grantedAt`/`withdrawnAt` — see
"Timestamp policy" below) is computed **after** the lock is acquired, so a
caller that had to wait cannot record an earlier timestamp than one that
committed while it was waiting.

Verified in `server/src/tests/communicationConsent.test.ts`:
- tests #3–#4 (two-way race) now also assert the `revision` chain;
- section F: 20 concurrent mixed grant/deny/withdraw calls against both an
  already-seeded key and a brand-new key, each run twice — exactly one
  current row, exactly the expected number of contiguous gap-free-revision
  events, `event[n].previousStatus === event[n-1].newStatus` for the full
  chain ordered by `revision`, current-row `revision` equals the final
  event's `revision`, and no unhandled rejection.

## 4. Purpose and channel taxonomy

`server/src/services/communicationConsent/taxonomy.ts` (backend, source of
truth) / `src/components/communicationConsentMatrixHelpers.ts` (frontend
mirror — kept in sync manually, no shared package in this monorepo).

**Channels**: `sms`, `email`, `whatsapp`, `phone_call`, `push`.

**Purposes**: `transactional`, `appointment_reminder`,
`appointment_followup`, `clinical_followup`, `recall`, `no_show_recovery`,
`operational`, `marketing`, `campaign`, `survey`, `legal_notice`,
`security_notice`.

**Policy-exception purposes** (always allowed, never need a preference
row): `transactional`, `legal_notice`, `security_notice`. This is a fixed,
closed list — not configurable at runtime, so a future code change is
required (and reviewable) to add to it, rather than a data-driven
allowlist that could be silently widened.

## 5. Decision matrix / central enforcement

`server/src/services/communicationConsent/communicationConsentPolicy.ts`:

- `evaluateCommunicationPermission(args)` — pure decision, **always**
  computes the real answer from the current preference table, regardless
  of rollout flags. Returns `{ allowed, reasonCode, channel, purpose,
  effectiveStatus, preferenceId?, evaluatedAt }`. (`consentEventId` was
  removed from this contract post-review — it was declared but never
  populated by any code path, a misleading dead field. This is a read-only
  decision with no associated event to honestly reference without an extra
  query on every send-time check.)
- `assertCommunicationPermission(args)` — the flag-aware wrapper every
  outbound sender calls. Applies the rollout mode on top of the real
  decision (see §6). Returns the above plus `blocked`, `enforcementMode`,
  and `evaluatedAllowed` (the real, mode-independent `allowed` value — see
  §6 "Audit-mode observability").

Reason codes: `consent_granted`, `consent_denied`, `consent_withdrawn`,
`consent_unknown`, `consent_not_required`, `transactional_exception`,
`legal_notice_exception`, `security_notice_exception`, `patient_missing`,
`clinic_scope_mismatch`, `channel_unavailable`, `purpose_not_supported`,
`consent_enforcement_disabled`.

**Scope-before-exception ordering (post-review fix).** `evaluateCommunicationPermission()`
resolves channel/purpose validity, then the patient, then organization
scope, then clinic/`PatientClinic` scope, and only *after* all of that
passes does it check whether the purpose is a policy exception. An earlier
version of this function checked the policy-exception branch first, which
meant a missing patient or a cross-org/cross-clinic identifier could receive
an `allowed` decision for `transactional`/`legal_notice`/`security_notice` —
contradicting this module's own fail-closed design. Policy exceptions are
now the last branch, reachable only once scope is confirmed. Verified by
`communicationConsent.test.ts` tests #14a–d: nonexistent patient +
`transactional` → `patient_missing`; wrong organization + `transactional` →
`clinic_scope_mismatch`; wrong clinic + `legal_notice` →
`clinic_scope_mismatch`; a real `PatientClinic`-linked clinic +
`security_notice` → allowed (scope resolved, then the exception applies).

Fail-closed guarantees (tests in §11):

- Unknown/missing preference → **denied**, never allowed.
- Withdrawn → **denied**.
- Only the three fixed policy-exception purposes bypass the preference
  lookup; every other purpose, including `marketing`/`campaign`, requires
  an explicit `granted` row.
- Clinic/organization scope mismatch and missing patient → denied, **and
  this is checked before the policy-exception branch**, never after.
- Unsupported channel/purpose strings → denied (never silently coerced).

## 6. Feature flags and rollout modes

```
COMMUNICATION_CONSENT_ENFORCEMENT_ENABLED=false   # default — existing behavior, untouched
COMMUNICATION_CONSENT_ENFORCEMENT_MODE=audit|enforce   # only read when ENABLED=true, default 'audit'
```

- `ENABLED=false` (default, current production state): `assertCommunicationPermission()`
  returns `allowed=true` immediately and **never queries the database**.
  Zero behavioral or performance impact.
- `ENABLED=true, MODE=audit`: the real decision is computed and returned
  for observability (`reasonCode` reflects the true state), but `allowed`
  is forced to `true` — nothing is blocked.
- `ENABLED=true, MODE=enforce`: a denied decision blocks the send.

This PR does **not** enable enforcement in production and does not change
`server/.env` in any deployed environment.

### Audit-mode observability (post-review fix)

`assertCommunicationPermission()`'s audit-mode branch overwrites `allowed`
to `true` so the caller's send proceeds, but it was at risk of reading as
"audit mode silently discards the real decision." It does not: `reasonCode`
and `effectiveStatus` already reflected the real decision, and the result
now additionally carries `evaluatedAllowed` — the real, mode-independent
`allowed` value, present in all three modes (`disabled`→always `true`;
`audit`/`enforce`→the real evaluated decision). A caller or a future
dashboard can always answer "would this have been blocked" from
`evaluatedAllowed`, independent of what `allowed`/`blocked` say for the
current mode.

### Missing consent-context behavior by rollout mode (WhatsApp, post-review fix)

Before this fix, `checkWhatsAppConsent()` (`whatsappOutboundMessaging.ts`)
returned "proceed" whenever any of `organizationId`/`patientId`/`consentPurpose`
was missing, **regardless of rollout mode** — including `enforce` mode. Since
all four public dispatchers declared these fields optional, any caller could
silently bypass audit/enforcement simply by omitting one field, and this
remained true even after a future production switch to `enforce`.

Fixed: `WhatsAppConsentCheckArgs` now makes `organizationId`/`patientId`/
`consentPurpose` **mandatory** at the TypeScript boundary (mirroring
`SendClinicSmsArgs` in `services/sms/smsService.ts`, which has always
required these three fields). `checkWhatsAppConsent()` additionally performs
a defensive runtime check (TS-mandatory doesn't stop an empty string or an
`as any` cast) with mode-specific behavior:

| Mode | Missing consent context |
|---|---|
| `disabled` | Unchanged legacy behavior — the flag check short-circuits before the context check ever runs. |
| `audit` | An explicit, safe audit observation is logged (`logger.info({ clinicId, purpose }, 'communication-consent: audit decision - consent context missing')` — clinicId/purpose only, no PII) and the send proceeds. Never blocks. |
| `enforce` | Blocks **before** any connection resolution or provider call, with a dedicated code `COMMUNICATION_CONSENT_CONTEXT_REQUIRED` (`OUTBOUND_ERRORS.CONSENT_CONTEXT_REQUIRED`) — distinct from `BLOCKED_BY_CONSENT` (context supplied, decision was deny) and never classified as a provider failure. |

**Caller audit.** Every current caller of the four public dispatchers
(`sendProactiveWhatsAppMessage`, `sendNoShowRecoveryWhatsApp`,
`sendAppointmentConfirmationWhatsApp`, `sendPostTreatmentWhatsApp`) already
supplied full context — `jobs/reminders.ts` (both call sites),
`routes/noShows.ts`, `services/postTreatmentMessaging.ts` — **except one real
gap**: `services/appointmentRequestNotification.ts`'s only caller,
`routes/appointmentRequests.ts` (the appointment-request approval flow), did
not pass `organizationId`/`patientId` even though both were already in scope
in that handler. Fixed: `organizationId`/`patientId` are now mandatory
parameters on `sendAppointmentRequestConfirmationNotification`, and the
approval-flow call site passes `req.user!.organizationId` and the resolved
`patientId`. No patient-facing caller of these four dispatchers remains
unplumbed. (`sendWhatsAppMessage` in `whatsappService.ts` — inbound AI
replies and internal staff notifications — is a different function, out of
this module's scope by the task's own definition of "patient communication";
nothing there needed wiring.)

## 7. Outbound enforcement — paths integrated

| Path | Integrated? | Purpose mapping |
|---|---|---|
| `sendClinicSms` (`smsService.ts`) | **Yes.** Central check runs after the existing legacy `evaluateSmsConsent()` gate (which is unchanged), additive and flag-gated. A blocked send is recorded with status `blocked_by_consent` (distinct from the legacy `blocked_consent`) and the provider is never called. | `SMS_PURPOSE_TO_COMMUNICATION_PURPOSE` map in `smsCommunicationPurposeMap.ts`. |
| `sendProactiveWhatsAppMessage`, `sendNoShowRecoveryWhatsApp`, `sendAppointmentConfirmationWhatsApp`, `sendPostTreatmentWhatsApp` (`whatsappOutboundMessaging.ts`) | **Yes**, via **mandatory** `{ organizationId, patientId, consentPurpose }` args (a compile-time forcing function, mirroring `SendClinicSmsArgs` — no optional-argument bypass exists). Blocked sends return `code: 'BLOCKED_BY_CONSENT'` (context supplied, denied) or `code: 'COMMUNICATION_CONSENT_CONTEXT_REQUIRED'` (context missing, enforce mode) and the provider is never called either way. See §6 "Missing consent-context behavior by rollout mode". | `appointment_reminder`, `no_show_recovery`, `clinical_followup`, `operational` per call site (see §7.1). |
| `jobs/reminders.ts` → `runPatientAppointmentRemindersForClinic` (WhatsApp reminder) | **Wired.** `consentPurpose: 'appointment_reminder'`. |
| `jobs/reminders.ts` → `runPaymentRemindersForClinic` (WhatsApp payment reminder) | **Wired.** `consentPurpose: 'operational'`. |
| `routes/noShows.ts` → `POST /appointments/:id/no-show/send-message` | **Wired.** `consentPurpose: 'no_show_recovery'`. |
| `services/postTreatmentMessaging.ts` → `sendQueueEntry` | **Wired.** `consentPurpose: 'clinical_followup'`. Re-evaluated at actual send time (queue processing time), not at enqueue time — see §7.2. |
| `services/appointmentRequestNotification.ts` → `sendAppointmentRequestConfirmationNotification` | **Fully wired (gap closed post-review).** `organizationId`/`patientId` are now mandatory parameters and `routes/appointmentRequests.ts`'s approval-flow call site passes `req.user!.organizationId` and the resolved `patientId` through, alongside `consentPurpose: 'appointment_reminder'`. |
| Email (`sendMail`) | **Not integrated — no patient-facing email path exists to integrate.** Only account/system emails exist (§2.2), which are the exact `transactional`/`security_notice` policy exceptions this PR's central service already always allows. Nothing to gate. |
| Instagram outbound / manual staff replies / `sendWhatsAppMessage` (inbound-triggered) | **Not integrated** — see §12. |

### 7.1 Why these purpose mappings

`appointment_reminder` covers confirmation/reminder/cancellation/reschedule
notices (all "your appointment state changed" communications);
`no_show_recovery` and `clinical_followup` map 1:1 to their SMS-taxonomy
equivalents; `operational` covers payment reminders (non-marketing,
non-appointment administrative notices). None of these are policy
exceptions — they require an explicit preference row once enforcement is
turned on, distinguishing them from true `transactional`/`security_notice`
system messages.

### 7.2 Send-time re-evaluation (not enqueue-time)

`assertCommunicationPermission()` never caches: every call re-reads the
current `PatientCommunicationPreference` row. `postTreatmentMessaging.ts`'s
queue processor calls it inside `sendQueueEntry()`, which runs when a
`PostTreatmentMessageQueue` row is actually dispatched — not when it was
enqueued. A withdrawal recorded after enqueue but before the scheduled
send time is therefore honored. Verified generically (not caching between
two evaluations) by `communicationConsent.test.ts` tests #18–#19.

### 7.3 Denied-send status

Denied sends are never recorded as ordinary provider failures. SMS:
`SmsMessage.status = 'blocked_by_consent'` (test #21). WhatsApp: the
dispatcher returns `code: 'BLOCKED_BY_CONSENT'` (or
`'COMMUNICATION_CONSENT_CONTEXT_REQUIRED'` for missing context) without
calling the provider.

**Correction (post-review).** Returning a distinct code from the dispatcher
is necessary but was not sufficient: the three real WhatsApp callers that
persist send history — `jobs/reminders.ts` (both call sites),
`routes/noShows.ts`, and `services/postTreatmentMessaging.ts`'s
`sendQueueEntry()` — all folded any `!result.success` outcome, including a
consent block, into their generic `'failed'` status path. This polluted
`platformAdmin.ts`'s `sentMessage.count({ where: { status: 'failed' } })`
dashboard metric with policy blocks that are not technical failures. Fixed:
all three now special-case `code === 'BLOCKED_BY_CONSENT'` /
`'COMMUNICATION_CONSENT_CONTEXT_REQUIRED'` to record a distinct
`'blocked_by_consent'` status (added to `SentMessage.status` and
`PostTreatmentMessageQueue.status` — both plain Prisma `String` columns with
no enum type or CHECK constraint, so no migration was needed, exactly like
`SmsMessage.status` already works) and log via the structured `logger`
instead of `console.error`, so it is never confused with a provider error in
logs or on the dashboard. `routes/noShows.ts`'s synchronous send endpoint
additionally returns a distinct `409` for these two codes instead of folding
into the generic `400` branch. No queue/retry job in this codebase
automatically reprocesses `status: 'failed'` rows (confirmed by repo-wide
grep), so introducing the new status value changes no selection/retry
behavior — it only removes the mislabeling.

## 8. Legacy-data strategy

`server/src/scripts/backfillCommunicationPreferences.ts`. Deliberately
minimal: **only** `Patient.smsOptOut = true` is materialized, as a
`withdrawn` row (channel `sms`, every non-policy-exception purpose,
`source: 'legacy'`, `evidenceType: 'legacy_sms_opt_out_field'`).

`Patient.communicationConsent` / `Patient.marketingConsent` are
**deliberately not used to auto-grant anything** — the task requires that
unknown legacy consent never silently becomes `granted`, and an explicit
opt-out is the one direction that is always safe to encode automatically
(denying is never a privacy risk; granting is). Everything else — every
patient without `smsOptOut`, every purpose for `marketing`/`campaign`/
`recall`/etc., and every channel other than `sms` — is left with **no
row**, which `evaluateCommunicationPermission()` treats as `unknown` →
denied for consent-gated purposes.

Properties: dry-run by default (`--execute` to write), idempotent (skips
any key that already has a row, never overwrites), bounded batches (500
patients/page via cursor pagination), reports counts by
clinic/channel/purpose/status only (no raw PII in logs), and creates an
immutable `PatientCommunicationConsentEvent` alongside every row it
writes. Rollback: `DELETE FROM "PatientCommunicationPreference" WHERE
source = 'legacy' AND "evidenceType" = 'legacy_sms_opt_out_field'` removes
only rows this script created; their history events are left in place as
an audit trail of the rollback having happened.

**Not executed in production as part of this PR.**

## 9. API

`server/src/routes/communicationPreferences.ts`, mounted at `/api`.
Roles: `OWNER`/`ORG_ADMIN`/`CLINIC_MANAGER`/`RECEPTIONIST`/`DENTIST`.
`BILLING` is excluded (no operational need to edit legal evidence fields).

| Method | Path | Purpose |
|---|---|---|
| GET | `/patients/:patientId/communication-preferences` | Full channel×purpose decision matrix (live decision + stored preference row) |
| GET | `/patients/:patientId/communication-preferences/history` | Immutable event history, optional `channel`/`purpose` filter |
| GET | `/patients/:patientId/communication-preferences/export` | Full evidence export (current state + full history), audit-logged |
| PUT | `/patients/:patientId/communication-preferences/:channel/:purpose` | grant / deny / withdraw / reset one preference |
| POST | `/patients/:patientId/communication-preferences/bulk` | Apply up to 50 explicit channel+purpose+action items independently |
| GET | `/clinics/:clinicId/communication-preferences/aggregate` | Clinic-level counts only — never exposes individual patient data |

Every mutation validates clinic + patient scope (including multi-branch
`PatientClinic` linkage), validates channel/purpose against the closed
taxonomy, runs inside a transaction, requires `evidenceType` for
grant/deny/withdraw (not for reset), sanitizes notes, and writes an
`AuditLog` entry. Stable error codes: `preference_not_found`,
`invalid_channel`, `invalid_purpose`, `invalid_transition`,
`scope_denied`, `evidence_required`, `notice_version_required`,
`unsafe_note`.

The history endpoint orders by `revision desc` only when both `channel` and
`purpose` are supplied (exactly one chain selected); otherwise — since the
result may span multiple independent chains — it orders by `createdAt desc`
with `channel`/`purpose`/`revision`/`id` tie-breakers. The export endpoint
always aggregates every channel/purpose key for the patient, so it always
orders by `createdAt asc` with the same tie-breakers. See "Concurrency"
above for why `revision` alone is never used across more than one chain.

### 9.1 Notice-version / evidence matrix (Blocker 5 — technical policy, not a legal determination)

`setCommunicationPreference()` enforces this matrix for `action: 'grant'`
only — `deny`/`withdraw`/`reset` never require `noticeVersion` or a source
description, regardless of source, so an opt-out is never blocked on
paperwork:

| Source (grant only) | Requirement | Error code if missing |
|---|---|---|
| `patient_portal`, `public_booking`, `whatsapp`, `sms_keyword`, `email_unsubscribe` (patient-facing digital sources) | Non-empty `noticeVersion` (the notice/KVKK text version shown at the time of the decision, or a documented-equivalent evidence reference) | `notice_version_required` |
| `staff` (staff-recorded verbal decision) | Non-empty, sanitized `notes` (a bounded source description — what was said/shown, and when), in addition to the already-required `evidenceType` | `evidence_required` |
| `api`, `import`, `legacy`, `system` | No additional requirement beyond the existing `evidenceType` check — an explicit, narrower scope decision (these are not patient-facing digital sources in the same sense) | — |

Only the short `noticeVersion` reference/version string is ever stored —
never the raw notice/KVKK text body — on both the current-state row and the
immutable event row. `not_required` is not user-settable through this
function: `ACTION_TO_STATUS` never maps any of `grant`/`deny`/`withdraw`/
`reset` to it, so it is structurally unreachable here (it can only ever
appear as a policy-exception decision from `evaluateCommunicationPermission()`).

### 9.2 Timestamp policy (Blocker 4)

Exact, tested policy for `grantedAt`/`withdrawnAt` on the current-state row
(`communicationConsentAdmin.ts`'s `statusTimestampFields()`). An earlier
version used `undefined` (a Prisma no-op that leaves the existing DB value
untouched) for fields that should have been explicitly cleared, letting
stale timestamps leak across transitions:

| New status | `grantedAt` | `withdrawnAt` |
|---|---|---|
| `granted` | `now` | `null` (never a stale prior withdrawal) |
| `withdrawn` (row already existed) | **preserved** — evidence of when the later-withdrawn consent was originally granted; unambiguous once `withdrawnAt` + `status='withdrawn'` are set | `now` |
| `withdrawn` (first-ever row for this key) | `null` (there was no prior grant to preserve) | `now` |
| `denied` | `null` — a denial must never retain a misleading active grantedAt | `null` — nor a stale withdrawnAt |
| `unknown` (`reset`) | `null` | `null` |

History events (`PatientCommunicationConsentEvent`) are never updated, so
they retain their `previousStatus`/`newStatus`/`createdAt` evidence
regardless of any later transition clearing the *current row's* timestamps.

## 10. Frontend

`src/components/CommunicationPreferencesPanel.tsx`, added as a new
**"Communication Preferences" / "İletişim Tercihleri"** tab on Patient
Detail (`src/pages/PatientDetail.tsx`). Channel×purpose matrix, per-cell
grant/deny/withdraw actions (each requires an explicit confirmation modal
— no one-click grant-all), history timeline per cell, evidence export
download. Required warning banner (exact wording per task spec, all four
locales) always visible above the matrix. Uses
`disclaimer: "Technical communication preference record — not a legal
determination."` wording, never "KVKK compliant". No optimistic mutation —
every action reloads the authoritative server state afterward. Mobile
responsive (horizontally scrollable matrix table). Translations added for
`tr`/`en`/`fr`/`de` under the new `communicationConsent` i18n namespace.

## 11. Tests and results

Backend (`server/src/tests/communicationConsent.test.ts`, 89 tests;
`communicationPreferenceBackfill.test.ts`, 7 tests) — all against a real
disposable Postgres, all passing (run twice for the concurrency sections):

- Model/transaction: exactly-one-row constraint, immutable history,
  concurrent grant/withdraw race → exactly one row + revision-consistent
  events, DB unique-constraint enforcement, rejected mutation leaves no
  partial state.
- Decision service: granted/unknown/withdrawn outcomes, all three policy
  exceptions, clinic scope mismatch, missing patient, unsupported purpose,
  disabled/audit/enforce mode behavior, re-evaluation-not-caching, retry
  does not bypass a block, **scope-before-exception ordering** (§5: missing
  patient / wrong org / wrong clinic + a policy-exception purpose are still
  denied; a real `PatientClinic` link still resolves to allowed).
- SMS send-time integration: enforce mode blocks and never calls the
  provider, blocked send gets `blocked_by_consent` status, disabled mode
  preserves existing (legacy-gate-only) behavior.
- Admin service validation: invalid channel/purpose, policy-exception
  purposes reject explicit writes, evidence-required, cross-clinic scope
  denial, bulk update applies independent items with per-item errors.
- Evidence sanitization: secret-like content rejected, email/phone
  redaction, overlong input bounded.
- **Concurrency / revision-authoritative ordering (§F, real disposable
  Postgres, each run twice):** 20 concurrent mixed grant/deny/withdraw calls
  against an existing key and against a brand-new key — exactly one current
  row, contiguous gap-free revisions, `event[n].previousStatus ===
  event[n-1].newStatus` ordered by `revision`, current-row revision equals
  the final event's revision, no unhandled rejection.
- **Timestamp policy (§G):** withdrawn→granted clears `withdrawnAt`;
  granted→denied nulls both `grantedAt`/`withdrawnAt`; withdrawn→unknown
  (reset) clears both; grant→withdraw→grant preserves the original
  `grantedAt` across the withdrawal and refreshes it on re-grant; history
  events retain their evidence after a later transition clears the current
  row's timestamps.
- **Notice-version / evidence matrix (§H):** grant from each of the 5
  digital sources requires `noticeVersion`; staff-sourced grant requires a
  source description; deny/withdraw never require either, regardless of
  source; raw notice text is never stored.
- **WhatsApp send-time integration (§I):** for all 4 public dispatchers,
  against a real DB-backed `evolution_api` connection with
  `EvolutionWhatsAppProvider.prototype.sendMessage` patched to a spy —
  enforce+missing org/patient/purpose → blocked
  (`COMMUNICATION_CONSENT_CONTEXT_REQUIRED`), provider never called;
  audit/disabled+missing context → provider called; fully-supplied granted
  → provider called; fully-supplied denied+enforce → blocked
  (`BLOCKED_BY_CONSENT`), provider never called.
- Backfill: dry-run makes no changes, `--execute` only touches
  `smsOptOut` patients, never sets `granted`, policy-exception purposes
  get no row, idempotent re-run, history event per created row.

Frontend (`src/components/__tests__/communicationConsentMatrixHelpers.test.ts`,
13 tests): taxonomy regression guards, cell-variant resolution (unknown
never silently renders as allowed), matrix indexing, bulk-selection
validation (no accidental grant-all, API item cap enforced, no
duplicates).

Exact pass counts and full-suite/migration results are recorded in the
final delivery report for this PR (see PR description) rather than
hard-coded here, since this document is expected to remain accurate as a
static reference after the PR merges and CI re-runs.

## 12. Paths not integrated, and why

- **Instagram outbound messaging** — no dedicated proactive/campaign
  Instagram sender exists in this codebase (Instagram flows are
  inbound-reply-driven through the AI conversation processor, gated by
  `ChannelConsentLog`, a different and already-adequate mechanism for that
  narrow purpose). Nothing to integrate.
- **`sendWhatsAppMessage` (inbound AI replies, internal staff
  notifications)** — not patient marketing; replies to a patient-initiated
  conversation and staff-internal schedule notifications are out of this
  PR's scope by the task's own definition of "patient communication".
- **Manual staff messaging UI** (`routes/messages.ts` /
  `Messages.tsx`) — a staff member composing a one-off message to a
  patient. Not wired in this PR; the volume/risk profile (a human
  reviewing the message before sending, versus an automated batch job) is
  different, and wiring it requires UI-level consent visibility at
  compose time, deferred as a follow-up.
- **`sendAppointmentRequestConfirmationNotification`'s callers — RESOLVED.**
  This was previously a known, documented gap (the function accepted
  optional consent-check identifiers but its only caller didn't pass them).
  Fixed post-review: `organizationId`/`patientId` are now mandatory
  parameters, and `routes/appointmentRequests.ts`'s approval-flow call site
  passes them through (both were already resolved in scope there). No
  patient-facing caller of the four WhatsApp dispatchers remains unplumbed.
- **Bulk/campaign messaging** — does not exist in this codebase; not
  created, per explicit task instruction not to add campaign functionality
  that doesn't already exist.

### 12.1 Unrelated items noted during review, explicitly deferred

Code review of this PR also surfaced three items that are **not** caused by,
or fixable within, the files this PR touches, and are recorded here as
follow-up items rather than addressed in this PR (to keep the diff scoped to
KVKK-HIGH-007):

- Content-Security-Policy blocks the `fonts.googleapis.com` stylesheet.
- Content-Security-Policy blocks an inline script.
- Platform Admin performs an unnecessary `/api/auth/me` request that
  receives a 401.

These are pre-existing, unrelated to communication consent/preference
management, and should be tracked as separate follow-up work.

## 13. Privacy and security controls

- Notes are sanitized (`consentEvidenceSanitizer.ts`): control characters
  stripped, secret/credential-like content rejected outright (never
  logged, even the rejected raw value), email/phone-like substrings
  redacted, bounded to 1000 chars after a 20,000-char processing ceiling.
- IP/user-agent are **only ever stored as HMAC-SHA256 hashes**
  (`COMMUNICATION_CONSENT_EVIDENCE_HASH_SECRET`, dedicated — never reused
  from `SECURITY_SIGNAL_IP_HASH_SECRET`, `ENCRYPTION_KEY`, or any other
  secret), and only when a caller explicitly opts in
  (`captureRequestMeta: true` on the PUT endpoint) — not collected by
  default on every mutation. Fails closed in production if the secret is
  missing/weak; falls back to a clearly-labelled non-production dev secret
  otherwise (mirrors `securitySignalService.ts`'s established pattern).
- No message bodies, tokens, phone numbers, or email addresses are ever
  logged in raw form by the decision service or the admin mutation
  service.
- Retention: consent evidence (`PatientCommunicationConsentEvent`) is
  never automatically deleted by this PR. It is kept separate from
  transient operational logs (`OperationalEvent`) and from the narrower
  `ChannelConsentLog`. Retention-period policy is explicitly deferred to
  legal review (§ "legal review boundaries" below) — no TTL/expiry job was
  added.

## 14. Limitations

- Enforcement is off by default; this PR ships the *capability*, not a
  live consent gate. No patient will experience any behavior change from
  this PR alone.
- The purpose taxonomy is fixed at 12 values; adding a 13th requires a
  code change and migration, by design (no runtime-configurable purpose
  list that could silently widen the policy-exception set).
- Email channel has no live integration target yet (§7 table) — the
  taxonomy/decision-service support it, but there is nothing to gate until
  a patient-facing email sender is built.
- No İYS (İleti Yönetim Sistemi) submission or reconciliation exists or
  was added.

## 15. Legal review boundaries / İYS follow-up items

The following remain explicitly for Turkish legal counsel, not resolved
by this PR:

1. Whether/when İYS registration and message-type submission is required
   for `marketing`/`campaign` sends once any are actually made.
2. Exact legal wording for consent prompts, notice text, and the
   `noticeVersion` versioning scheme's legal sufficiency.
3. Retention period for `PatientCommunicationPreference` /
   `PatientCommunicationConsentEvent` rows (this PR keeps them
   indefinitely pending that determination).
4. Whether `RECEPTIONIST`/`DENTIST` are the correct roles to record
   patient-verbal consent evidence, or whether that should be narrower.
5. Whether the `legacy_sms_opt_out_field` backfill's conservative
   (opt-out-only, never opt-in) interpretation is legally sufficient, or
   whether additional historical evidence should be sought before any
   `marketing`/`campaign` sends are enabled for pre-existing patients.

## 16. Operational dashboards / log checks (for a future rollout)

- `SmsMessage.status = 'blocked_by_consent'` count, filterable by
  clinic — indicates enforce-mode is blocking SMS sends.
- `PatientCommunicationPreference` groupBy counts via the
  `/api/clinics/:clinicId/communication-preferences/aggregate` endpoint —
  clinic-level visibility without exposing individual patient rows.
- `AuditLog` entries with `action` starting `communication_consent_` —
  every grant/deny/withdraw/bulk/export action.
- Application logs prefixed `[communication-consent]` — evidence-hash
  secret configuration warnings only (no PII).

## 17. Known non-goals

- Not a legal compliance certificate.
- Not IYS integration.
- Not a campaign/bulk-messaging feature.
- Not an email-sending feature (no patient-facing email sender exists to
  gate).
- Not a change to any existing production default.

## 18. Rollback plan

Schema: the migration
(`server/prisma/migrations/20260718164142_add_communication_preference_and_consent/`)
only **adds** two new tables, three new indexes, and their foreign keys —
it does not alter or drop any existing column, table, or index. Rolling
back is a pure `DROP TABLE "PatientCommunicationConsentEvent"; DROP TABLE
"PatientCommunicationPreference";` (child table first) with no data-loss
risk to any other table. Application rollback is a plain revert of this
PR's commits — every integration point is additive and flag-gated, so
reverting the code changes alone (without touching the schema) is also
safe and leaves the tables unused but harmless.

## 19. Production deployment plan (for a future PR/rollout, not this one)

1. Merge to `main` after review.
2. Deploy `server` with the new migration applied
   (`npx prisma migrate deploy`) — additive-only, no downtime expected.
3. Confirm `COMMUNICATION_CONSENT_ENFORCEMENT_ENABLED` is unset/`false` in
   the production `.env` (the code's own default, but verify explicitly).
4. Deploy frontend; confirm the new Patient Detail tab renders and the
   matrix loads for a real patient (read-only smoke test).
5. Run `backfillCommunicationPreferences.ts` in dry-run against
   production data; review counts with the clinic/product owner before
   ever running `--execute`.
6. Only after legal sign-off (§15): flip `ENABLED=true`,
   `MODE=audit` first, observe `blocked_by_consent`/audit reason-code
   volumes for a full rollout window, then `MODE=enforce` per clinic or
   globally.

## 20. Production verification plan (for a future rollout, not this one)

- Confirm migration applied cleanly (`npx prisma migrate status` shows no
  pending migrations, no drift beyond the pre-existing, unrelated drift
  documented in the PR).
- Confirm the new API routes respond for an authorized test account and
  reject an unauthorized role (`BILLING`) with 403.
- Confirm `COMMUNICATION_CONSENT_ENFORCEMENT_ENABLED` is `false` (or
  unset) — i.e. confirm this PR changed nothing observable in production
  yet.

## 21. KVKK-HIGH-007 follow-up: legacy/central reconciliation, audit-mode readiness, UX hardening

Branch `feature/kvkk-high007-consent-reconciliation-ux`. This follow-up does
**not** enable enforcement, the new reconciliation flag, or audit logging in
any deployed environment, and does not execute the production backfill. It
closes the operational gaps §6–§9 above left open: the legacy fields still
actively gate SMS/recall independently of the central system (§21.1), the
matrix endpoint re-queries the database per cell (§21.4), and the production
"Onaylar ve Kaynak" sidebar card contradicted the new matrix (§21.6).

### 21.1 Legacy-field ownership map (confirmed by direct code reading)

| Field/model | Current meaning | Written by | Read by | Classification | Can disagree with central? |
|---|---|---|---|---|---|
| `Patient.communicationConsent` | General "may we contact" boolean, default `false` | Staff CRUD (`patients.ts`), auto-`true` on approved public-booking signup, auto-`false` on WhatsApp/Instagram auto-created patients | `evaluateSmsConsent()` (SMS gate, all non-marketing purposes), `recallCandidateService.ts` (recall drafting) | Legacy, **actively enforced**, no evidence trail | **Yes** — was structurally unable to see an explicit central grant at all before this PR (see §21.2) |
| `Patient.marketingConsent` | Marketing-specific SMS boolean, default `false` | Staff CRUD | `evaluateSmsConsent()` (marketing purpose only) | Legacy, actively enforced, no evidence trail | Yes — same gap |
| `Patient.smsOptOut` / `smsOptOutAt` | Hard SMS opt-out | **No write path anywhere in the app** — dormant; only `backfillCommunicationPreferences.ts` reads it | `evaluateSmsConsent()` (hard block, checked first), the backfill script | Legacy, dormant, migration-signal only | Yes — a stale, uncorrectable hard veto if it ever disagrees with an explicit central grant (see §21.3, `legacy_central_conflict`) |
| `ChannelConsentLog` | WhatsApp/Instagram inbound-reply KVKK Art.5 processing consent (accept/decline), evidenced (`consentTextVersion`/`consentTextSnapshot`) | `channelConsentGate.ts`, called from the Evolution/Meta WhatsApp and Instagram inbound flows | Same gate, before auto-creating a patient/appointment-request/contact | Legacy, **actively enforced**, evidence-grade, provider-specific | No central equivalent — deliberately out of scope (different purpose/lifecycle); keyed by raw `contactIdentifier`, not `patientId`, so it is never joined against `Patient`/`PatientCommunicationPreference` (§21.5) |
| Meta 24-hour messaging window | Platform delivery-mechanism rule (template vs. free text) | N/A — **no backing data model exists anywhere in the codebase** | N/A | Not a consent model; a documented platform constraint only | N/A |

Recommended target state (not implemented in this PR — see §21.9): once
enough patients have real central evidence, retire the SMS/recall legacy
gate's independent authority in favor of the central system exclusively;
until then, the reconciliation resolver (§21.2) is the bridge. `smsOptOut`
has no supported write path today; adding one is a separate, larger feature
(a legacy-field correction workflow), not a "delete the dead field" cleanup,
since it is still read at send time.

### 21.2 Dual-gate reconciliation — decision table and orchestration function

`smsService.ts` and `recallCandidateService.ts` each ran their own legacy
gate completely independently of the central decision service — the legacy
gate ran first, unconditionally, and returned immediately on failure, so an
explicit central `granted` row had **zero effect** on either sender. New
single orchestration point,
`server/src/services/communicationConsent/legacyReconciliationResolver.ts`
(`resolveCommunicationConsent`), gated by a new, independent, default-`false`
flag `COMMUNICATION_CONSENT_LEGACY_RECONCILIATION_ENABLED` (separate from
`COMMUNICATION_CONSENT_ENFORCEMENT_ENABLED` — that flag continues to govern
only the channels that never had a legacy gate). Both senders now call this
one function instead of chaining two independent checks:

| Scenario | Reconciliation flag OFF (default — today, unchanged) | Reconciliation flag ON (opt-in) |
|---|---|---|
| central `granted` + legacy false/default | legacy blocks → blocked (the pre-existing bug, byte-for-byte unchanged) | central grant wins → **allowed**, but only once `enforcementMode === 'enforce'` too (see below) |
| central `denied`/`withdrawn` + legacy true | legacy allows → sent (central has no teeth today) | central restriction wins → **blocked**, immediately, regardless of `enforcementMode` |
| central `unknown` + legacy true | legacy allows → sent | falls back to legacy → sent (unchanged — holds even in `enforce` mode, so fail-closed-on-unknown never nukes pre-reconciliation communications) |
| central `unknown` + legacy false/default | legacy blocks → blocked | falls back to legacy → blocked (unchanged) |
| `smsOptOut=true` + central `granted` | hard veto blocks → blocked | **conflict** — fails closed, `legacy_central_conflict`, never silently resolved either direction (§21.3) |
| no central row + no legacy signal | legacy blocks → blocked | falls back to legacy → blocked (unchanged) |

Full mode matrix (reconciliation × enforcement), tested exhaustively in
`legacyReconciliationResolver.test.ts`:

| reconciliation | enforcement | Real send behavior |
|---|---|---|
| OFF | disabled / audit / enforce | Byte-identical to the pre-existing two-step code in all three modes — this is the current production configuration and is unaffected by this PR. |
| ON | disabled | Restrictive signals (hard veto, central denied/withdrawn, conflict) take effect immediately — pure safety-tightening. The one permissive behavior (central grant overriding legacy false) is **observed only** — real `finalAllowed` still falls back to legacy. |
| ON | audit | Same real send behavior as ON+disabled (audit never blocks/unblocks); the would-be-enforce answer is computed for observability. |
| ON | enforce | Full policy live: restrictive signals block, conflict blocks, and a central `granted` row now genuinely overrides a stale legacy false/default. |

Restrictive signals get to act as soon as reconciliation is on, regardless of
enforcement mode, because honoring a restriction early is never a compliance
risk. The one permissive behavior is additionally gated behind
`enforcementMode === 'enforce'` because it is the one direction that could
cause unwanted messaging if wrong — both flags must be deliberately set, and
neither is touched by this PR.

**Named policy-exception branch, not an accidental fallback.** The resolver
explicitly checks `central.effectiveStatus === 'not_required'`
(`transactional`/`legal_notice`/`security_notice`/`consent_not_required`)
before the granted/denied/unknown switch, mirroring
`evaluateCommunicationPermission()`'s own pre-existing, already-shipped
unconditional exception rule, so an ambiguous legacy false/default can never
block a legal/transactional message by falling through the `unknown` branch.
Scope validity is still checked first and always blocks, exception or not.
**Whether a hard channel opt-out like `smsOptOut` should be able to suppress
a legal/security notice is an open question left to legal review — this is a
technical default, not a legal conclusion**, and is inert today: SMS's own
purpose taxonomy has no value mapping to those three purposes, and recall's
purpose is always `'recall'`.

### 21.3 The `legacy_central_conflict` state — never silently resolved

A hard-veto legacy signal (`smsOptOut=true`) disagreeing with an explicit
central `granted` row is a genuine data-integrity conflict, not something
either side should silently win. It fails closed (blocks the send),
regardless of enforcement mode once reconciliation is on, and is recorded via
an atomic Postgres upsert into a new table, `CommunicationConsentConflictBucket`
(`id, organizationId, clinicId, channel, purpose, reasonCode, bucketStartedAt,
firstDetectedAt, lastDetectedAt, occurrenceCount` — deliberately **no**
patientId, name, phone, email, message text, raw/hashed contact identifier,
IP, or user-agent). One row per (org, clinic, channel, purpose, reasonCode,
hourly bucket); a process-local mechanism was explicitly rejected because
NoraMedi runs multiple API/worker instances with PM2 reloads and horizontal
scaling — an in-memory `Map` would deduplicate differently per process, lose
counts on restart, and produce duplicate rows across instances. First
detection surfaces immediately; repeated detections in the same hour
increment `occurrenceCount` atomically. Concurrency-tested: 20 parallel
identical detections produce exactly one row with `occurrenceCount === 20`.

**Resolution is not automatic and is not a one-click override.** An
authorized user can use the already-existing `withdraw`/`deny` action on that
channel/purpose (already evidenced, already writes an immutable
`PatientCommunicationConsentEvent` + audit log) — but this only **accepts the
restrictive legacy signal**, bringing the central record into agreement with
it. It does not prove the legacy `smsOptOut` value is correct, and if that
value is actually stale, **there is currently no supported way to clear it**
— a dedicated legacy-signal correction workflow with its own immutable audit
trail is a separate, unimplemented follow-up. The UI labels this state
"Manuel İnceleme Gerekli" (Manual Review Required), distinct from
denied/withdrawn/unknown/granted, and its modal explicitly states that
Deny/Withdraw does not resolve the underlying contradiction.

This table gets its own retention category in `dataRetentionCleanupJob.ts`
(`communicationConsentConflictBucketsDays`, default 180 days, same
bounded-batch pattern as every other category) — it does not grow unbounded
either, even though it is already PII-free.

### 21.4 Matrix endpoint N+1 fix

The matrix route looped 5 channels × 12 purposes and called
`evaluateCommunicationPermission()` per cell, which re-queried the patient
and the already-loaded preference row on every call (~120 redundant queries
per page load). Fix: the pure, I/O-free post-scope-check logic was extracted
into `deriveCommunicationDecision(args, purpose, status, preferenceId)`;
`evaluateCommunicationPermission()` is now a thin wrapper (existing DB checks,
then the pure function — identical behavior, all existing tests unchanged),
and the matrix route calls the pure function directly per cell using the
already-loaded preference map. Zero extra queries. Verified structurally in
`communicationPreferencesRoute.test.ts` (the pure function is asserted to not
return a `Promise`) and functionally (route-level tests covering scoping,
the new `legacyConflict` field, and history filters/pagination — this route
previously had **no** HTTP-level test coverage at all).

The route's existing home-clinic-only scoping (it never considers a
patient's `PatientClinic` links, only `patient.clinicId`) is **documented as
a deliberate boundary, not changed** — a multi-branch-linked patient's matrix
is always scoped to their home clinic; no `clinicId` selector was added to
the route.

The history endpoint (`GET .../history`) now additionally accepts `status`
and `source` filters and a bounded `limit`/`cursor` pagination pair
(default 50, max 200), replacing the previous hardcoded `take: 200` — used
by the new "View full history" filter UI.

### 21.5 Backfill dry-run reconciliation report

`backfillCommunicationPreferences.ts` gained an additive `--report[=path.json]`
flag (never gated by `--execute`, never writes regardless of any flag
combination) that scans **all** patients (not just `smsOptOut=true`) and
classifies legacy-vs-central signals:

- `legacy_opt_out_vs_central_granted` — `smsOptOut=true` and a central `sms`
  row is `granted`. Real conflict, flagged for human review, corresponds
  exactly to the runtime `legacy_central_conflict` state (§21.3).
- `legacy_false_or_default_vs_central_unknown` — both legacy booleans are
  `false` and no central row exists. Reported explicitly as
  **ambiguous/non-affirmative** — never as an explicit denial or as
  agreement, since the booleans carry no "was this explicitly captured" flag.
- `legacy_yes_without_evidence` — either legacy boolean is `true` with no
  evidenced central `granted` row. Flagged; never auto-granted.
- `already_reconciled` — `smsOptOut=true` and the standard backfill's own
  `withdrawn`/`legacy`/`legacy_sms_opt_out_field` row already exists.
- `channel_consent_log_summary` (a separate section, not a per-patient
  category) — real aggregate counts (`groupBy`, no PII) from
  `ChannelConsentLog` by clinic/channel/`consentStatus`. Deliberately **not**
  joined against `Patient`/`PatientCommunicationPreference` — that model is
  keyed by raw `contactIdentifier`, not `patientId`, and a phone-normalization
  join would be an unreliable, silent linkage.

Output: total patients inspected, would-create/skip counts (existing),
conflict counts by category (overall and per-clinic), the
`ChannelConsentLog` summary, zero raw PII (counts only). Tested in
`communicationPreferenceReconciliationReport.test.ts` (9 tests): never
writes, each category populates correctly, idempotent, no PII in output.

**Exact future production command (not run in this PR):**

```
cd server && npx tsx src/scripts/backfillCommunicationPreferences.ts --report=./communication-consent-reconciliation-report.json
```

### 21.6 Audit-mode observability — bounded, deterministic, PII-free

New env flags (all in `enforcementConfig.ts`): `COMMUNICATION_CONSENT_AUDIT_LOGGING_ENABLED`
(default `false`), `COMMUNICATION_CONSENT_AUDIT_LOG_SAMPLE_RATE` (**no
default** — unset or outside `[0,1]` fails safe to fully disabled), and a
**dedicated** `COMMUNICATION_CONSENT_AUDIT_SAMPLE_SALT` (separate from
`COMMUNICATION_CONSENT_EVIDENCE_HASH_SECRET` — different purpose, different
rotation lifecycle; required whenever sampling is active).

Sampling is **deterministic per evaluation**, not per clinic/channel/purpose/
hour bucket — an earlier design that hashed only those coarse dimensions
would have made every evaluation in a bucket sample identically (an
all-or-nothing burst each hour, not representative sampling). The final
design hashes `${organizationId}:${clinicId}:${channel}:${purpose}:${stableEventKey}:${hourBucket}:${salt}`
(stable FNV-1a hash) where `stableEventKey` defaults to `patientId` — used
only as an in-memory hash input, **never persisted**, so individual
evaluations for the same clinic/channel/purpose/hour distribute
independently across patients, while the same logical evaluation (same
patient + hour) always reproduces the same decision. `EventSource` on
`OperationalEvent` was widened to include `'communication_consent'`
(additive, no migration). Persisted metadata: `{ evaluatedAllowed,
reasonCode, channel, purpose, enforcementMode, wouldBlock, sampled: true,
samplingRate, samplingVersion }` — no `patientId`, no `stableEventKey`, no
phone/email/text/IP/UA/credentials, ever. `samplingVersion` is bumped
whenever the sampling algorithm changes, so historical rows remain correctly
interpretable even if the method changes later; the audit-summary report
never assumes the *current* configured rate applied to past rows.

`getCommunicationConsentAuditSummary()` (`communicationConsentAuditReport.ts`,
exposed at `GET /api/communication-consent/audit-summary`,
`OWNER`/`ORG_ADMIN` only) enforces a **mandatory bounded** date range
(default 7 days, hard max 90 days) and aggregates entirely in Postgres —
`groupBy` for plain columns, parameterized raw SQL (`metadata->>'reasonCode'`
etc.) for JSON-held breakdown fields, and a direct aggregate query against
`CommunicationConsentConflictBucket` for conflict figures — never an
unbounded row fetch into Node memory. Breakdown rows are capped at 50 per
dimension. If a queried range spans multiple `(samplingRate, samplingVersion)`
combinations, the response reports them as **separate groups**, states
plainly that sampled counts are not exact totals, and never extrapolates an
estimated total. Conflict figures are reported as aggregate bucket/occurrence
counts, explicitly **never** as a unique-patient count (impossible by
construction — no patient identifier is ever persisted). A new
`@@index([source, organizationId, clinicId, createdAt])` on `OperationalEvent`
supports this query pattern (one of two small additive migrations in this
PR, alongside the new conflict-bucket table).

**Rollout sequence:** `disabled → audit (logging off) → audit (logging on,
sampled/observed) → review the audit-summary report → enforce`. Enforcement
and the new reconciliation flag both stay off by default; nothing in this PR
changes production env.

### 21.7 WhatsApp generic-send consent gap — closed

`POST /api/messages/:id/send` (the shared dispatch endpoint for the manual
message composer and recall-drafted messages) called `sendWhatsAppMessage()`
directly for `channel === 'whatsapp'` with **zero consent check of either
generation** — the one wired-in gap among the app's WhatsApp senders (every
other dispatcher already calls `assertCommunicationPermission`). Fixed: a new
`whatsappCommunicationPurposeMap.ts` maps `MessageTemplatePurpose` →
`CommunicationPurpose` (mirroring `smsCommunicationPurposeMap.ts` value-for-
value except `general_message`/no-template → `operational`, the
least-privileged non-exception bucket, which fails closed by construction
once enforcement is active). The route now calls
`assertCommunicationPermission` before dispatch, governed purely by the
existing `enforcementMode` (no new flag — there was no pre-existing legacy
gate on this path to reconcile with). Blocked sends get `status:
'blocked_by_consent'` and a `403 {code: 'consent_blocked'}` response,
mirroring the SMS branch of the same route. Tested in
`messagesConsentGate.test.ts`, including that a marketing-mapped template is
not let through by an unrelated `operational` grant (proves the purpose map
actually discriminates, not just defaults everything through).

**Deliberately not touched, documented as a separate deferred finding**: three
patient-initiated conversation reply paths call a WhatsApp send function with
zero consent context —

- `POST /api/whatsapp/inbox/:id/reply` (staff replying inside an inbound
  conversation)
- the Evolution WhatsApp AI auto-responder send (Evolution webhook handler)
- the Meta Cloud WhatsApp AI auto-responder send
  (`server/src/services/whatsapp/metaWhatsAppAiProcessor.ts`, the
  `provider.sendMessage()` call inside the inbound-reply flow)

These are patient-initiated conversation reply paths with different
ChannelConsentLog/provider-window semantics and are not yet mapped into the
central purpose-based consent model. This finding does not claim every
WhatsApp sender is covered by this PR — these three remain open, needing
their own design decision, not a hasty default classification.

### 21.8 Frontend redesign

`CommunicationPreferencesPanel.tsx` (rewritten) + `communicationConsentMatrixHelpers.ts`
(additive: `PURPOSE_GROUPS`, `computeConsentSummary`, `shouldShowLegacySignals`,
`isCellActionable`, a new `conflict` cell variant checked before the existing
status switch, never merged visually with denied/withdrawn/unknown/granted).

- **One authoritative summary bar** at the top (allowed / denied+withdrawn /
  unknown / not-required / conflict counts), replacing the two-conflicting-
  systems problem described in production.
- **Default view is channel tabs + purpose-group accordion cards** (6
  categories: essential/operational, appointment communication, treatment
  follow-up, recall/reactivation, marketing/campaigns, surveys/informational)
  — no default horizontal scroll. An explicit **"Matris Görünümü" (Matrix
  view) toggle** keeps the original sticky-header table for power users.
- Actions collapsed into a **single "Yönet" (Manage) button per row**
  opening a modal with an action selector (Grant/Deny/Withdraw/Reset)
  instead of three permanently-visible inline text links; the same
  evidenceType/source/noticeVersion/notes fields and validation rules
  (`noticeVersionRequired`, `sourceDescriptionRequired`) are unchanged, only
  how the action is invoked changed.
- `not_required` cells are visually subdued and non-actionable
  (`isCellActionable` returns `false` unconditionally for policy exceptions,
  regardless of role); `conflict` cells get their own distinct warning
  treatment, "Manuel İnceleme Gerekli", with copy stating Deny/Withdraw only
  accepts the legacy signal, it does not resolve the conflict.
- **The legacy "Onaylar ve Kaynak" sidebar card is deleted** (both the
  desktop and mobile duplicate in `PatientDetail.tsx`) — this was the direct
  cause of the production contradiction. In its place, a collapsed,
  `canManage`-only "Eski Kayıt Sinyalleri" (Legacy Signal) disclosure lives
  *inside* the Communication tab, clearly labeled as historical/pre-migration
  data that does not reflect current consent status.
- A top-level "Geçmişi Görüntüle" (View History) entry point, in addition to
  per-cell history, with channel/purpose/status/source filters wired to the
  extended history endpoint (§21.4).
- Verified live in a browser (dev server, real login/patient/data flow) at
  320/375/768/1024/1440px — no required horizontal scroll at any width,
  accordion/tabs/summary bar/legacy-signal section all render and function
  correctly; the only console error observed was the pre-existing, unrelated,
  already-documented Platform-Admin `/api/auth/me` 401 (§12.1) — not
  introduced by this change.
- All 22 pure-logic tests in `communicationConsentMatrixHelpers.test.ts`
  pass. This repository has no React render-testing infrastructure
  (no RTL/jsdom/vitest anywhere in ~100+ existing test files, consistent
  with the backend's "no supertest" convention) — introducing one solely for
  this component was judged out of proportion to the task, so the
  component's decision logic (`shouldShowLegacySignals`, `isCellActionable`,
  `computeConsentSummary`, `resolveCellVariant`) was extracted into pure,
  directly-tested functions instead, and live rendering was verified via the
  dev server as described above rather than an automated render test.

### 21.9 Deferred/out-of-scope items from this follow-up

- Retiring the SMS/recall legacy gate's independent authority once real
  central evidence exists broadly (§21.1) — requires the reconciliation flag
  and, eventually, enforcement to actually be turned on, both explicit future
  decisions.
- A legacy-signal correction workflow (clearing a stale `smsOptOut`) — no
  write path exists today; building one is a distinct, larger feature.
- The three patient-initiated conversation reply paths named in §21.7 —
  `POST /api/whatsapp/inbox/:id/reply`, the Evolution WhatsApp AI
  auto-responder send, and the Meta Cloud WhatsApp AI auto-responder send
  (`metaWhatsAppAiProcessor.ts`) — different ChannelConsentLog/provider-window
  semantics, needs its own design decision. Not claimed as covered by this PR.
- Instagram channel is still not part of the consent taxonomy/model — adding
  a channel is a data-model decision, not a readiness fix.
- The CSP (Google Fonts, inline script) and Platform-Admin `/api/auth/me`
  401 findings remain documented-only follow-ups (§12.1), unchanged by this
  PR — none were isolated/already-touched by this diff.
- General HTTP request logs still contain raw `x-real-ip`/`x-forwarded-for`/
  `remoteAddress`/user-agent — a separate, pre-existing backlog item, not
  hot-edited as part of this task.
- Whether a hard channel opt-out may suppress a legal/security notice
  (§21.2) — pending legal review, not decided by this PR.

### 21.10 Explicit non-claims

This follow-up does not claim: KVKK/İYS/marketing-consent legal compliance;
that enforcement, audit logging, or the legacy-reconciliation flag are
enabled anywhere; that the production backfill (dry-run or execute) has been
run; or that any legal-basis, notice-wording, retention, or controller/
processor question from §15 has been resolved. All of §15's open items
remain open and are unchanged by this PR.

### 21.11 Production migration deployment runbook

This PR's migration
(`server/prisma/migrations/20260719120821_kvkk_high007_consent_reconciliation/migration.sql`)
is purely additive — one new table
(`CommunicationConsentConflictBucket`, with its own indexes) and one new
index on the existing `OperationalEvent` table
(`OperationalEvent_source_organizationId_clinicId_createdAt_idx`). Prisma's
`migrate deploy` runs each migration inside a transaction, so this index is
created with plain `CREATE INDEX`, not `CREATE INDEX CONCURRENTLY` — that is
intentional and is **not** being changed as part of this PR
(`CONCURRENTLY` cannot run inside a transaction block at all). On a large
`OperationalEvent` table this holds `ACCESS EXCLUSIVE` for the duration of
the index build, which blocks concurrent reads/writes to that table for that
window. The steps below exist to make that window observable and safe, not
to avoid it.

**Pre-deploy (read-only, run first, in a low-traffic window):**

1. Check `OperationalEvent` size, so the expected duration of the index
   build is known in advance rather than discovered live:

   ```sql
   sudo -u postgres psql -d noramedi_crm -P pager=off <<'SQL'
   SELECT
     pg_size_pretty(pg_total_relation_size('"OperationalEvent"')) AS total_size,
     pg_size_pretty(pg_relation_size('"OperationalEvent"')) AS table_size,
     pg_size_pretty(pg_indexes_size('"OperationalEvent"')) AS indexes_size,
     COUNT(*) AS row_count
   FROM "OperationalEvent";
   SQL
   ```

2. Take a verified database backup and confirm it is restorable before
   proceeding — this is a prerequisite for any production schema change in
   this app, not specific to this migration.

3. Confirm all consent flags remain at their default/disabled values in the
   target environment before and after this deploy — this migration does not
   require, and must not be paired with, flipping
   `COMMUNICATION_CONSENT_LEGACY_RECONCILIATION_ENABLED`,
   `COMMUNICATION_CONSENT_AUDIT_LOGGING_ENABLED`,
   `COMMUNICATION_CONSENT_AUDIT_LOG_SAMPLE_RATE`,
   `COMMUNICATION_CONSENT_AUDIT_SAMPLE_SALT`, or
   `COMMUNICATION_CONSENT_ENFORCEMENT_ENABLED`/`_MODE`.

**Deploy:**

4. Run the migration in a genuinely low-traffic window (its lock duration
   scales with the current `OperationalEvent` size measured in step 1):

   ```sh
   npx prisma migrate deploy
   ```

5. Verify status immediately after:

   ```sh
   npx prisma migrate status
   ```

**Post-deploy monitoring:**

6. While the migration runs (and immediately after), watch for locks held
   against `OperationalEvent` and anything waiting on them:

   ```sql
   sudo -u postgres psql -d noramedi_crm -P pager=off <<'SQL'
   SELECT
     pid,
     now() - query_start AS duration,
     wait_event_type,
     wait_event,
     state,
     left(query, 120) AS query
   FROM pg_stat_activity
   WHERE query ILIKE '%OperationalEvent%'
     AND state <> 'idle'
   ORDER BY duration DESC;
   SQL
   ```

   A companion lock-specific view, if the above shows unexpected waiters:

   ```sql
   sudo -u postgres psql -d noramedi_crm -P pager=off <<'SQL'
   SELECT
     l.pid,
     l.mode,
     l.granted,
     a.state,
     now() - a.query_start AS duration,
     left(a.query, 120) AS query
   FROM pg_locks l
   JOIN pg_stat_activity a ON a.pid = l.pid
   WHERE l.relation = '"OperationalEvent"'::regclass
   ORDER BY l.granted, duration DESC;
   SQL
   ```

7. Confirm API and worker health (error rates, request latency,
   `OperationalEvent`-writing paths in particular — e.g. audit logging call
   sites, though those remain no-ops while
   `COMMUNICATION_CONSENT_AUDIT_LOGGING_ENABLED=false`) show no sustained
   stall or elevated error rate correlated with the deploy window.

8. Confirm no query against `OperationalEvent` was left waiting for a
   prolonged period during the deploy — i.e., that steps 6/7 showed only the
   expected transient lock, not a lasting write stall.

This runbook does not change the migration to use `CREATE INDEX
CONCURRENTLY` — doing so would require splitting the index creation out of
Prisma's transactional migration entirely, which is a larger, separate
change and out of scope for this follow-up.

# 55 — KVKK-CRIT-003: Security Incident Response Foundation and Baseline Security Alerting

Status: **In progress — technical foundation, not merged.**
Branch: `feature/kvkk-crit-003-security-incident-foundation` (based on `main`
after PR #165 merged). Not merged, not deployed.

This document is **not** a legal compliance certificate and this PR is **not**
legal approval of anything. It records a technical control only. This PR does
**not** constitute legal approval of:

- breach classification;
- notification obligations;
- notification deadlines;
- notification recipients;
- legal wording;
- regulator communication;
- data-subject communication.

Legal notification timing and wording remain explicitly subject to Turkish
legal counsel review. No statutory deadline is hard-coded anywhere in this
codebase as legally conclusive, and none should ever be added without
counsel sign-off.

## 1. Purpose and scope

KVKK-CRIT-003 was `Not started` in the compliance tracker: no mechanism
existed to durably capture security-relevant signals, detect suspicious
patterns, or give a Platform Admin a place to triage and track a security
incident's lifecycle. This PR adds that technical foundation:

1. A sanitizing, HMAC-hashing signal-capture service.
2. Three real, end-to-end detection rules (authentication brute-force,
   cross-tenant access, clinic-export anomalies).
3. A durable, deduplicated `SecurityIncident` record with an enforced
   lifecycle.
4. An immutable `SecurityIncidentActivity` audit trail.
5. A Platform Admin API + UI to triage incidents.
6. This runbook.

Out of scope: legal breach classification, KVKK Art. 12 notification
timing/content, regulator/data-subject communication templates, external
alert delivery (email/SMS/Slack), and any change to existing production
behavior beyond the specific signal-capture points listed in Section 5.

## 2. Technical vs legal responsibility boundary

| Role | Responsibility |
|---|---|
| Detection code (this PR) | Capture safe, sanitized signals; aggregate into incidents; provide Platform Admin visibility and a lifecycle to work through. |
| NoraMedi Platform Admin | Triage, acknowledge, investigate, contain, resolve technical incidents; escalate to legal counsel and the clinic data controller when an incident may involve personal data. |
| Clinic data controller | Under KVKK, the clinic is generally the data controller for its own patient data. Any determination of whether a clinic-facing incident is a reportable "veri ihlali" (data breach) under KVKK Art. 12 is the clinic's/counsel's call, informed by — but not decided by — this system's technical classification. |
| NoraMedi platform/technical operator | Provides the processing infrastructure; supports investigation with technical evidence (this PR's `SecuritySignalEvent`/`SecurityIncident`/`SecurityIncidentActivity` records); does not unilaterally decide notification obligations. |
| Legal counsel | Determines breach classification, notification obligations/deadlines/recipients, wording, and regulator/data-subject communication. **Nothing in this PR pre-empts that determination.** |

## 3. Severity definitions

Technical severity only — never a legal-risk rating.

| Severity | Meaning here |
|---|---|
| `low` | A single occurrence of raw evidence; not yet incident-worthy on its own (e.g. one failed login, one accidental cross-tenant denial). |
| `medium` | A detection rule's threshold was crossed once; worth a Platform Admin's attention but not (yet) indicative of a broad/severe attack. |
| `high` | Escalated: a larger burst, multi-resource/multi-clinic probing, or a rare infra-level integrity failure (e.g. `TEMP_STORAGE_UNSAFE`). |
| `critical` | Escalated further: very large bursts, or a persistent/repeated high-severity condition. |

Severity may only escalate, never silently downgrade (enforced by a
conditional SQL update — see Section 6's "Incident dedupe/concurrency"
subsection in the implementation report, and `securityIncidentService.ts`'s
`escalateSeverityAtomic`).

## 4. Incident statuses and transition rules

Statuses: `open`, `acknowledged`, `investigating`, `contained`, `resolved`,
`closed`, `false_positive`.

```
open           -> acknowledged | investigating | false_positive
acknowledged   -> investigating | contained | false_positive
investigating  -> contained | resolved | false_positive
contained      -> investigating | resolved
resolved       -> closed | investigating
closed         -> investigating   (ONLY via the explicit "reopen" action)
false_positive -> investigating   (ONLY via the explicit "reopen" action)
```

Enforced server-side in `securityIncidentService.ts`'s `ALLOWED_TRANSITIONS`
— there is no endpoint that sets an arbitrary status. `contain` and
`resolve` require a non-empty `containmentSummary`/`resolutionSummary`.
`false_positive` and `reopen` require a non-empty note (the reason).

**Reopen / new-incident policy**: once an incident reaches `closed` or
`false_positive`, a Platform Admin has explicitly decided that occurrence
stream is over. Further occurrences of the *same* detection rule + scope do
**not** silently reopen that incident or keep incrementing its
`occurrenceCount` forever. Instead, a **new** incident is created, keyed by
the original deterministic key plus the current UTC date (so at most one
fresh incident per rule+scope can be spawned this way per day — bounded,
not an alert storm), with `metadata.reopenedFromIncidentId` linking back to
the prior terminal incident for continuity. A Platform Admin can still
explicitly `reopen` a terminal incident directly if they want to continue
working the original row instead.

## 5. Detection rules implemented

All three mandatory rules are implemented end-to-end. See
`server/src/services/security/securityDetectionRules.ts` for the exact
logic and `securitySignalService.ts` for the shared sanitization/hashing
primitives they call.

### Rule 1 — Authentication brute-force suspicion

- **Where**: `routes/auth.ts` (clinic login) and `routes/platformAdmin.ts`
  (`/auth/login`, including the MFA-code-rejected path) — every failure
  branch these routes already had.
- **Signal**: `auth_login_failed`, deduplicated by an HMAC-hashed,
  normalized account identifier (never plaintext email).
- **Threshold**: `SECURITY_ALERT_AUTH_FAILURE_THRESHOLD` (default 10)
  failures within `SECURITY_ALERT_AUTH_FAILURE_WINDOW_MINUTES` (default 15)
  creates/escalates an incident at `medium`, escalating toward `high`/
  `critical` (`SECURITY_ALERT_AUTH_FAILURE_CRITICAL_THRESHOLD`, default 30)
  for larger bursts.
- **Never reveals account existence**: the signal/incident path runs
  *after* the route has already decided its (generic) response; it never
  changes what the caller sees.
- **Successful login does not erase evidence**: nothing in this rule
  deletes `SecuritySignalEvent` rows on success — only `resetLoginAttempts`
  (the existing separate rate-limit counter) is reset, which is unrelated
  to the incident evidence trail.

### Rule 2 — Cross-tenant access suspicion

- **Where**: the two shared scope-rejection helpers,
  `validateAndGetScope`/`validateAndGetClinicIdScope`
  (`server/src/utils/clinicScope.ts`, 40+ existing callers) and the two
  `clinicAccess.ts` middleware functions — **not** individual routes.
- **Signal**: `clinic_scope_denied`, fired only when a *specific* clinicId
  was requested and denied (a bare "no clinics assigned at all" state is
  account configuration, not a targeted probe, and is intentionally
  excluded to avoid noise).
- **Threshold**: `SECURITY_ALERT_CROSS_TENANT_THRESHOLD` (default 3) within
  `SECURITY_ALERT_CROSS_TENANT_WINDOW_MINUTES` (default 15). A single
  accidental denial stays low-level evidence only. Repeated denials across
  **multiple distinct target resources** escalate to `high`; repeated
  denials of the same single resource stay at `medium`.
- **Never stores**: patient data, request bodies, raw query strings, or
  unhashed guessed identifiers — only an HMAC-hashed attempted clinicId,
  the actor's user id (hashed for dedup), HTTP method, and a normalized
  route template (`req.route.path`, never the raw URL).

### Rule 3 — Sensitive clinic export anomaly

Integrated with the merged KVKK-HIGH-004 clinic bulk export feature
(`clinicBulkExport.ts` routes + `clinicBulkExportPackage.ts`):

- **Step-up lockout** (`export.step_up_lockout.v1`) — fires when the
  existing `ClinicBulkExportPasswordAttempt` brute-force lockout
  (`verifyStepUpPasswordWithLockout`) is reached, at both the create-job and
  download-token-issuance routes. Surfaced at `medium` on first occurrence
  (a lockout is already meaningful, not an "ordinary mistake"), escalating
  to `high` if repeated (`SECURITY_ALERT_EXPORT_LOCKOUT_ESCALATE_THRESHOLD`,
  default 3) within `SECURITY_ALERT_EXPORT_LOCKOUT_WINDOW_MINUTES` (default
  60).
- **Download-token replay/expired/invalid** (`export.token_replay.v1`) —
  fires on `already_downloaded`/`expired`/`invalid_token` validation or
  claim failures. Thresholded
  (`SECURITY_ALERT_EXPORT_REPLAY_THRESHOLD`, default 3, within
  `SECURITY_ALERT_EXPORT_REPLAY_WINDOW_MINUTES`, default 15) so an ordinary
  double-click never creates an incident.
- **Generation integrity failure** (`export.generation_integrity.v1`) —
  fires on `TEMP_STORAGE_UNSAFE` (the existing `fileStorage.ts` unsafe-temp-
  directory error code) or a `ZIP_INTEGRITY_FAILED` generation failure.
  Surfaced at `high` immediately (a single occurrence is a rare, infra-level
  misconfiguration, not an ordinary mistake), escalating to `critical` if it
  recurs 3+ times within an hour.
- **Persistent artifact cleanup failure** (`export.cleanup_failure.v1`) —
  fires on every failed storage-object deletion attempt for a job, but only
  escalates to an incident (at `high`) once the *same* job has failed
  `SECURITY_ALERT_EXPORT_CLEANUP_PERSISTENT_THRESHOLD` (default 3) times —
  i.e. it survived retries, not a one-off transient error.
- **Abnormal repeated export requests** (`export.request_burst.v1`) —
  fires on every successful export-job creation; escalates once the same
  actor creates `SECURITY_ALERT_EXPORT_REQUEST_BURST_THRESHOLD` (default 5)
  jobs within `SECURITY_ALERT_EXPORT_REQUEST_BURST_WINDOW_MINUTES` (default
  60), at `high` if they span multiple clinics.
- **Never stores**: raw download token, token hash, password, `storageKey`,
  ZIP path, `restrictedNote`, or export contents — only HMAC-hashed job/
  clinic identifiers and stable failure codes.

### Optional Rule 4 — Webhook signature verification attack

**Not implemented in this PR** — the mandatory three-rule delivery was
prioritized per the task instructions ("do not delay the mandatory
three-rule delivery for this optional rule"). `routes/metaWhatsAppWebhook.ts`
already has a `logWebhookEvent`/`writeAuditLog` call on invalid-signature
rejection (`meta_webhook_invalid_signature`) that a future PR can wire into
`recordSecuritySignal`/`evaluateXSignal` the same way the three mandatory
rules were. Flagged as a follow-up item (Section 20).

## 6. Signal sanitization / data-minimization rules

Enforced in `server/src/services/security/securitySignalService.ts`:

- Raw IP addresses are **never** stored — only
  `HMAC-SHA256(SECURITY_SIGNAL_IP_HASH_SECRET, ip)`.
- `SECURITY_SIGNAL_IP_HASH_SECRET` is dedicated — never `JWT_SECRET`,
  `ENCRYPTION_KEY`, any webhook secret, or
  `CLINIC_BULK_EXPORT_IP_HASH_SECRET`.
- In production, a missing/weak (< 32 char) secret makes hashing throw;
  `recordSecuritySignal` swallows that (see rule 6 below) so the primary
  request is never broken, but the signal itself is simply not recorded and
  a loud `console.error` is emitted. In non-production, a safe warning is
  logged and a fixed, clearly-labelled non-production fallback secret is
  used so local dev/tests keep working without configuration.
- Account identifiers are normalized (trim + lowercase) then HMAC-hashed
  with the same dedicated secret, domain-separated from the IP hash via a
  purpose prefix (`account:` vs `ip:` vs `resource:`) so the two hash
  spaces can never collide.
- User-agent is never stored raw — only a SHA-256 fingerprint of a
  512-char-bounded, trimmed string.
- `safeMetadata` passes an explicit allowlist/sanitizer: any key matching
  `password|passwordHash|token|secret|authoriz|cookie|body|rawPayload|
  messageText|accessToken|storageKey|filePath|exportPath` (case-insensitive)
  is **dropped entirely**, not merely redacted. Every remaining string value
  additionally has email- and phone-shaped substrings redacted, is
  truncated to 200 chars, and the whole object is bounded to 20 keys / 2
  levels of nesting / 4000 bytes of JSON.
- No patient names, emails, phone numbers, clinical notes, treatment
  content, message content, or exported data are ever passed into
  `safeMetadata` by any of the three detection rules — each only passes
  counts, stable codes, and already-hashed identifiers.

## 7. Triage procedure

1. Open `/platform/security-incidents`. The summary cards (open critical,
   open high, unacknowledged, investigating, last-24h) are the first thing
   to check.
2. Open an incident to see its safe metadata, occurrence count, and
   affected (hashed) resource.
3. `Acknowledge` it (moves `open` → `acknowledged`) to signal it has been
   seen.
4. `Start investigation` when you begin actively looking into it.

## 8. Containment procedure

1. From `investigating` (or `acknowledged`), take whatever *technical*
   containment action is appropriate outside this system (e.g. force a
   password reset, temporarily disable an account/clinic, rotate a
   compromised secret).
2. Record what was done in the required `containmentSummary` when calling
   `contain`. This is stored on the incident and in the immutable activity
   log — it is not itself a notification.

## 9. Evidence-preservation procedure

- `SecuritySignalEvent` rows are append-only and are the immutable raw
  evidence trail underlying every incident. Nothing in this PR updates or
  deletes them.
- `SecurityIncidentActivity` rows are append-only and record every
  lifecycle mutation with its actor, previous/new status, and any note.
- Neither model is included in the existing general data-retention cleanup
  job (`dataRetentionCleanupJob.ts`) — see Section 14.

## 10. Recovery procedure

Once contained and the underlying cause is fixed, move the incident to
`resolved` with a `resolutionSummary` describing the fix and any recovery
steps taken (outside this system). Move to `closed` once fully done.

## 11. Post-incident review

Use the incident's full `SecurityIncidentActivity` timeline as the record
of what happened and when. There is no separate "post-incident review"
model in this PR — the activity log is the review record. A future PR
could add a structured review field if a real incident here reveals the
need.

## 12. Roles

- **NoraMedi Platform Admin** — operates this system; triages and works
  incidents.
- **Clinic data controller** — the clinic itself, for its own patient data;
  makes/participates in the KVKK Art. 12 breach determination for
  clinic-facing incidents.
- **Platform/technical operator** — NoraMedi as processor; provides
  evidence, does not decide notification obligations.
- **Legal counsel** — decides classification, notification, wording.

## 13. Communication decision checklist

Before any external communication (to a clinic, a data subject, or KVKK)
about an incident found through this system:

- [ ] Has a human (not this system) reviewed the incident's underlying
      evidence?
- [ ] Has legal counsel been consulted on whether this is a KVKK Art. 12
      "veri ihlali" (personal data breach)?
- [ ] Has counsel determined the notification deadline (this system does
      **not** compute or assert one)?
- [ ] Has counsel approved the wording of any notification?
- [ ] Has the affected clinic (as data controller) been looped in, where
      applicable?

**Explicit statement**: legal notification timing is not determined by any
code in this PR. `legalReviewRequired`/`legalReviewStatus` on
`SecurityIncident` are technical placeholders recording that a human legal
decision is pending — they are never set to imply a legal conclusion.

## 14. Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `SECURITY_SIGNAL_IP_HASH_SECRET` | none — **required in production** | Dedicated HMAC key for IP/account-identifier/resource-id hashing. Fails closed (throws, swallowed by `recordSecuritySignal`) in production if missing/weak; logs a safe warning and uses a fixed non-production fallback otherwise. |
| `SECURITY_ALERT_AUTH_FAILURE_THRESHOLD` | 10 | Rule 1 incident-creation threshold. |
| `SECURITY_ALERT_AUTH_FAILURE_WINDOW_MINUTES` | 15 | Rule 1 rolling window. |
| `SECURITY_ALERT_AUTH_FAILURE_CRITICAL_THRESHOLD` | 30 | Rule 1 critical-severity threshold. |
| `SECURITY_ALERT_CROSS_TENANT_THRESHOLD` | 3 | Rule 2 incident-creation threshold. |
| `SECURITY_ALERT_CROSS_TENANT_WINDOW_MINUTES` | 15 | Rule 2 rolling window. |
| `SECURITY_ALERT_EXPORT_LOCKOUT_ESCALATE_THRESHOLD` | 3 | Rule 3 (lockout) escalation threshold. |
| `SECURITY_ALERT_EXPORT_LOCKOUT_WINDOW_MINUTES` | 60 | Rule 3 (lockout) rolling window. |
| `SECURITY_ALERT_EXPORT_REPLAY_THRESHOLD` | 3 | Rule 3 (token replay) incident-creation threshold. |
| `SECURITY_ALERT_EXPORT_REPLAY_WINDOW_MINUTES` | 15 | Rule 3 (token replay) rolling window. |
| `SECURITY_ALERT_EXPORT_CLEANUP_PERSISTENT_THRESHOLD` | 3 | Rule 3 (cleanup failure) persistence threshold. |
| `SECURITY_ALERT_EXPORT_REQUEST_BURST_THRESHOLD` | 5 | Rule 3 (request burst) incident-creation threshold. |
| `SECURITY_ALERT_EXPORT_REQUEST_BURST_WINDOW_MINUTES` | 60 | Rule 3 (request burst) rolling window. |
| `SECURITY_INCIDENT_EXTERNAL_ALERTS_ENABLED` | `false` | Reserved for a future external (email/SMS/Slack) alert adapter. **Not implemented in this PR** — no external provider integration was added. Must stay `false` until such an adapter exists. |

All threshold/window env vars fail open to their documented default on
missing/garbage input (consistent with the existing
`CLINIC_BULK_EXPORT_*_MS` pattern in `docs/compliance/54-...md`) — a
misconfigured threshold degrades detection sensitivity, it does not disable
detection or weaken any existing security rejection.

## 15. Deployment checklist

- [ ] Set `SECURITY_SIGNAL_IP_HASH_SECRET` to a strong (32+ char), unique
      value in production (generate with `openssl rand -hex 32` or similar).
      Confirm it differs from `JWT_SECRET`, `ENCRYPTION_KEY`, every webhook
      secret, and `CLINIC_BULK_EXPORT_IP_HASH_SECRET`.
- [ ] Run `npx prisma migrate deploy` (adds `SecuritySignalEvent`,
      `SecurityIncident`, `SecurityIncidentActivity` — no changes to any
      existing table).
- [ ] Confirm `SECURITY_INCIDENT_EXTERNAL_ALERTS_ENABLED` is unset or
      `false` (no external adapter exists yet regardless).
- [ ] Verify a Platform Admin can load `/platform/security-incidents`
      (empty list is expected immediately after deploy).
- [ ] Do not change any threshold env var without understanding it may
      raise/lower detection sensitivity, not any existing security control.

## 16. Rollback procedure

This PR adds new tables and new code paths only — it does not modify any
existing table, alter any existing security decision (login, clinic-scope
check, or export step-up/lockout continues to allow/deny exactly as
before), or change any existing response shape. Rollback is therefore
low-risk:

1. Redeploy the previous release (or revert the merge commit).
2. The three new tables (`SecuritySignalEvent`, `SecurityIncident`,
   `SecurityIncidentActivity`) can remain in the database unused — nothing
   else depends on them.
3. If a full schema rollback is desired, use
   `npx prisma migrate resolve --rolled-back 20260717180000_add_security_incident_foundation`
   and manually `DROP TABLE` the three new tables (bookkeeping-only per
   Prisma's own semantics — this does not "undo" a schema in place, see
   the correction note about this in `docs/compliance/53-...md`).

## 17. Test evidence

See Section 18 of the accompanying implementation report (this PR's
description) for exact test counts/results, run against a fresh disposable
PostgreSQL database. Summary categories covered by
`server/src/tests/securityIncident.test.ts`:

- Sanitization (IP never raw, blocked-key rejection, bounded UA, patient-
  content redaction, stable HMAC with a test secret, fail-closed production
  behavior).
- Deduplication/concurrency (single incident from concurrent identical
  signals, accurate `occurrenceCount`, stable `firstDetectedAt`, advancing
  `lastDetectedAt`, monotonic severity escalation, documented
  closed/false-positive-then-new-incident behavior).
- Lifecycle (valid/invalid transitions, transactional incident+activity
  writes, required summaries, actor recorded, clinic-user denial,
  Platform-Admin allowed, deleted-Platform-Admin history survival).
- Detection rules (threshold/below-threshold behavior for all three rules,
  no account-existence leak, no raw token/storage-path in any stored
  field).
- Tenant isolation (org/clinic filters, no clinic-user access to Platform
  routes, no patient data in response DTOs).
- API (pagination cap, filter validation, stable error on invalid
  transition, no stack traces, summary counts).
- Migration (fresh disposable PostgreSQL applies all 61 migrations,
  DB-level unique constraint on `incidentKey`, all documented indexes
  present, zero *additional* drift beyond pre-existing unrelated drift
  already present on `main` before this branch — see Section 19).

## 18. Known limitations

- Optional Rule 4 (webhook signature attack) is not implemented — see
  Section 5.
- No external alert delivery (email/SMS/Slack) — durable in-app Platform
  Admin visibility only, per the task's explicit instruction not to add a
  new external provider integration in this PR.
- Rule 1 dedupes by account-identifier hash only, not IP hash — a
  distributed "low-and-slow" credential-spray attack across many accounts
  from a shared IP pool is not separately detected by this rule (the
  existing, unrelated `loginIpLimiter`/`platformLoginIpLimiter` rate
  limiters still apply independently). Flagged as a follow-up.
- The pre-existing schema/migration-history drift documented in Section 19
  is **not** fixed by this PR — fixing it is out of scope and was already
  present on `main` before this branch.
- Reopening a terminal incident's *original* row does not "un-spawn" any
  dated recurrence incident that may have been created in the meantime;
  both remain as separate, linked rows.

## 19. Pre-existing repository drift (not introduced by this PR)

While validating this PR's migration against a fresh disposable PostgreSQL
database, `npx prisma migrate diff` showed additional statements (dropped/
re-added FKs on `ImagingStudy`/`WhatsAppConversationMessage`, a dropped
`User_organizationId_email_key` index, several `updatedAt` default-drop
`ALTER TABLE`s, a `WhatsAppConnection` column-type change, and four
`RenameIndex` statements) that are **unrelated** to the `SecurityIncident`/
`SecuritySignalEvent`/`SecurityIncidentActivity` tables. These statements
were present in the diff computed against a freshly-migrated database
running only the pre-existing migration history on `main` (before this
branch's migration was even added) — confirming this is pre-existing
drift between `schema.prisma` and the migration history on `main`, not
something this branch introduced or something specific to a locally-dirty
dev database. This PR's own migration
(`20260717180000_add_security_incident_foundation/migration.sql`) was
hand-edited to contain **only** the three new tables' `CREATE TABLE`/
`CREATE INDEX`/`ADD FOREIGN KEY` statements, deliberately excluding all of
the above pre-existing, unrelated drift. Fixing that pre-existing drift is
out of scope for KVKK-CRIT-003 and is recorded here as a follow-up item.

## 20. Follow-up items

- Optional Rule 4 (webhook signature verification attack detection).
- IP-hash-based (in addition to account-hash-based) dedup dimension for
  Rule 1, to catch a distributed credential-spray pattern.
- A feature-flagged external alert adapter (email/SMS/Slack) behind
  `SECURITY_INCIDENT_EXTERNAL_ALERTS_ENABLED`, once a safe recipient-
  configuration story exists (explicitly deferred — see Section 18).
- Fix the pre-existing, unrelated schema/migration-history drift described
  in Section 19 (separate from this feature).
- A structured post-incident-review model, if real incident history shows
  the plain activity-log timeline is insufficient.
- A documented retention policy activation for `SecuritySignalEvent`/
  `SecurityIncident`/`SecurityIncidentActivity` (see below) once legal/
  operational sign-off exists.

## Retention and privacy

`SecurityIncident` and `SecurityIncidentActivity` are **not** included in
the existing `dataRetentionCleanupJob.ts` general cleanup in this PR — they
are durable by default until an explicit, separately-approved retention
policy is activated. `SecuritySignalEvent` (raw evidence) may eventually
follow its own, likely shorter, retention window, but only once that would
not destroy evidence still needed by an open/recent incident — this PR
does **not** add automatic deletion for any of the three new tables.

Proposed (not yet activated) retention policy: retain `SecurityIncident`/
`SecurityIncidentActivity` indefinitely (they are small, low-cardinality
records of genuine security events, not bulk personal data), and consider a
12–24 month rolling window for `SecuritySignalEvent` once incident-linkage
evidence needs are better understood operationally. This is a proposal
only — activating any deletion requires the same legal/operational
approval process as `dataRetentionCleanupJob.ts`'s existing categories.

No medical/clinical records are ever copied into any of these three models
— only hashed identifiers, stable codes, and sanitized, bounded metadata.

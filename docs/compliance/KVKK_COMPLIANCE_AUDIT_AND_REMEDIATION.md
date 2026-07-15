# NoraMedi (DisKlinikCRM) — KVKK Compliance Audit & Remediation Tracker

**Report date:** 2026-07-15
**Last updated:** 2026-07-15 (KVKK-CRIT-001a implemented)
**Current Git commit / branch:** `feature/kvkk-public-booking-notice-evidence` (recorded at time of writing; update this line whenever the document changes)
**Audit scope:** NoraMedi/DisKlinikCRM platform's compliance with Law No. 6698 (KVKK). Based on source-code review plus verification against official Turkish sources (kvkk.gov.tr, Official Gazette references). No access to Google/Meta contracts, VPS/backup infrastructure, or clinic-level legal documents — those items are explicitly marked "not verified" below and require separate production/legal verification.
**Legal disclaimer:** This document is **not** a legal compliance certificate. No item in this document may be read as a declaration that the system is "fully KVKK compliant." Final legal determinations belong to Turkish legal counsel. Status labels here describe engineering/documentation state only, except where explicitly marked as legally approved with a recorded approval reference.

**Full narrative report (all matrices, correction logs, lawful-basis analysis, decision trees):**
`docs/compliance/archive/NoraMedi_KVKK_Denetim_Raporu_2026-07-15_v3_REVIZE_full.md` (this is the authoritative detailed narrative; this tracker is the authoritative status/progress view — the two are companions, not duplicates).
Original (superseded) first-pass report: `docs/compliance/archive/NoraMedi_KVKK_Denetim_Raporu_2026-07-15_v1_original.md`.

---

## 1. Current controlled-pilot status

**KOŞULLU KONTROLLÜ PİLOT (Conditional Controlled Pilot) — not yet cleared.** Unlimited production use with real patient data is not recommended until all Phase 0 items below are either `Completed and verified`, `N/A` with documented justification, or `[L]`/`[O]` items are resolved by legal counsel / production verification. A limited single-clinic pilot with marketing features disabled is technically reasonable once Phase 0 closes.

## 2. Current remediation progress (summary)

| Status | Count (Phase 0 items) |
|---|---|
| Completed and verified | 0 |
| Implemented — awaiting deployment/operational verification | 1 (KVKK-CRIT-001a) |
| In progress | 0 |
| Not started | 8 |
| Blocked | 0 |
| Waiting for legal review | 5 (overlaps with legal-dependency items below) |
| Waiting for operational/infrastructure evidence | 1 |
| N/A | 0 |

## 3. Outstanding legal dependencies

- International transfer mechanism selection for Google (Gemini) and Meta (WhatsApp/Instagram Cloud API) under Art. 9 (post-2024 regime) — contracts/DPAs not yet reviewed by counsel.
- Platform↔clinic data-processor agreement and sub-processor list — not yet drafted/approved.
- Lawful-basis matrix (Section 4 of the full report) — not yet approved by counsel.
- Per-clinic VERBİS decision tree outcome — not yet finalized per clinic, and depends on each clinic's own bookkeeping method (balance-sheet vs. non-balance-sheet, per Board Decision 2025/2393).
- Written breach-response plan content — not yet legally approved.

## 4. Outstanding production-verification controls

- VPS disk/volume encryption status.
- PostgreSQL storage-level encryption.
- Backup script (`noramedi-db-backup.sh`) encryption step.
- VPS provider (Hostinger) snapshot encryption settings.
- TLS/HSTS reverse-proxy configuration.
- `server/.env` file permissions and production `ENCRYPTION_KEY` fail-closed behavior.
- Key rotation policy.
- Primary legal texts of Board Decisions 2025/2393 (25.12.2025) and 2026/1026 (13.05.2026) — this tracker's dates were cross-verified via search summaries and one official kvkk.gov.tr page (Icerik/8577); the primary decision texts themselves were not directly viewed and should be pulled from kvkk.gov.tr before relying on them in a legal filing.

---

## 5. Living remediation checklist — Phase 0 (before first real patient data)

Status legend: `[ ]` Not started · `[-]` In progress · `[x]` Completed and verified · `[!]` Blocked · `[L]` Waiting for legal review · `[O]` Waiting for operational/infrastructure evidence · `[N/A]` Not applicable

- `[-]` KVKK-CRIT-001a — Public booking privacy-notice display and automatic notice-version evidence record (no consent/acknowledgment checkbox) — **Implemented on `feature/kvkk-public-booking-notice-evidence`, awaiting deployment + browser/production verification**
- `[ ]` KVKK-HIGH-007 — Normalized channel+purpose `CommunicationPreference` model and `resolveOutboundPolicy`
- `[L]` KVKK-CRIT-002 — International transfer inventory and mechanism decision (Google/Meta)
- `[ ]` KVKK-CRIT-003 — Breach-response plan and baseline security alerting
- `[L]` KVKK-CRIT-005 — Lawful-basis matrix documentation + notice-evidence at patient intake
- `[O]` HIGH-001 (conditional) — Backup/disk/file-permission/download-authorization infrastructure verification (determines whether attachment encryption stays Phase 1)
- `[L]` Platform↔clinic data-processor agreement + sub-processor list
- `[ ]` KVKK-HIGH-004 — Full-clinic export: step-up auth + rate limit + audit alert, **or** server-enforced feature flag disabling the endpoint
- `[L]` Per-clinic VERBİS decision-tree outcome (bookkeeping-method-aware, per 2025/2393)

The detailed remediation table (Section 6) is the source of truth for status — the checkbox markers above are a quick-glance view only, per the custom-marker limitation of standard Markdown.

---

## 6. Detailed remediation table

| ID | Remediation | Status | Evidence | Completed in | Verified by | Notes |
|---|---|---|---|---|---|---|
| KVKK-CRIT-001a | Public booking privacy notice display + automatic notice-version evidence record | Implemented — awaiting deployment/operational verification | See Section 10 below (implementation evidence) | `feature/kvkk-public-booking-notice-evidence` | Automated tests + Node-level HTTP smoke test against a disposable Postgres (this session); no production/browser verification yet | No consent/acknowledgment checkbox of any kind (see full report Section 10, item 1). New model `PublicBookingNoticeEvidence` reuses the existing `ClinicLegalProfile` publish/versioning architecture; does not touch `ChannelConsentLog` |
| KVKK-HIGH-007 | Normalized `CommunicationPreference` model (channel+purpose) + migration of `smsOptOut` to `channel=sms` scope | Not started | — | — | — | `smsOptOut` must NOT be interpreted as blocking WhatsApp without explicit WhatsApp-specific evidence |
| KVKK-CRIT-002 | International transfer contracts, DPA review, Art. 9 mechanism selection (Google/Meta) | Waiting for legal review | Google/Meta contracts required | — | Legal counsel | Physical processing country not asserted; see full report Section 7 matrix |
| KVKK-CRIT-003 | Written incident-response plan + baseline security alerting (≥3 scenarios) | Not started | — | — | — | Absence of "breach" keyword in repo is not evidence of a past breach |
| KVKK-CRIT-005 | Lawful-basis matrix (per processing activity) approved + intake-time notice-evidence recording | Waiting for legal review | Matrix drafted in full report Section 4 | — | Legal counsel | Default basis is NOT explicit consent; Art. 6/3 (unlettered) is the health-data candidate condition |
| KVKK-HIGH-001 | Application-level attachment encryption (`fileStorage.ts`) | Waiting for operational evidence | — | — | — | Conditional: stays Phase 1 only if infra encryption checklist (Section 4 above) passes; otherwise becomes a Phase 0 blocker for real patient files |
| Processor agreement | Platform↔clinic data-processing agreement + sub-processor list | Waiting for legal review | — | — | Legal counsel | Agreement documents roles/instructions only; does not independently legalize processing |
| KVKK-HIGH-004 | Full-clinic export protection (step-up+rate-limit+alert) OR server-enforced disable flag | Not started | `gdprExport.ts` reviewed — no step-up/limit currently | — | — | Pilot must not run with an unrestricted bulk export path enabled |
| VERBİS decision tree | Per-clinic VERBİS registration assessment, aware of each clinic's bookkeeping method | Waiting for legal review | Decision tree in full report Section 6 | — | Legal counsel / clinic accountant | Uses official 04.09.2025 (2025/1572) and 25.12.2025 (2025/2393) criteria |
| KVKK-HIGH-006 | Reclassify 63 `req.user.clinicId` usages via targeted CodeGraph analysis; fix only confirmed-incorrect ones | Not started | 15 files / 63 usages identified (prior audit grep) | — | — | No mechanical bulk replacement; each fixed route needs its own regression test |
| KVKK-HIGH-005 | İYS integration (only if marketing/campaign features are ever built) | N/A (feature not active) | No active marketing send path found in code | — | — | Re-evaluate if/when a marketing feature is scoped |
| KVKK-HIGH-003 | Medical-record retention period + periodic anonymization policy | Waiting for legal review | `dataRetentionPolicy.ts` explicitly excludes medical/financial records from cleanup | — | Legal counsel | Hard-delete of medical records is explicitly NOT recommended |

---

## 6.1 KVKK-CRIT-001a — Implementation evidence

**Status:** Implemented — awaiting deployment/operational verification (technical sub-item). Legal-text approval for each clinic's own privacy notice remains a separate, still-outstanding dependency (see Section 3) — publishing/approving the notice *content* is not part of this remediation item, only the delivery/evidence mechanism.

**Root cause / previous behavior:** The public booking widget (`src/pages/BookingWidget.tsx`, `server/src/routes/publicBooking.ts`) collected and stored patient personal data (name, phone, email, notes) with no Art. 10 privacy-notice display and no record of which notice version, if any, was shown at the time of collection. `ClinicLegalProfile` and its publish/versioning flow already existed for the clinic KVKK page (`publicClinicKvkk.ts`) but was never consulted by the booking flow.

**Chosen architecture:** Public booking now resolves and reuses the clinic's currently published `ClinicLegalProfile` (no second legal-content system). Because `ClinicLegalProfile` is mutable in place (POST `/publish` can re-save an already-published profile), a new table `PublicBookingNoticeEvidence` snapshots the notice text, controller identity, version, and effective date at issuance time, so historical attribution survives later edits. Evidence is issued automatically (no acknowledgment action), server-validated, and atomically linked to the created `AppointmentRequest`. Full design rationale is in the module docstring of `server/src/services/publicBookingNoticeEvidence.ts`.

**Database model / migration:**
- Model: `PublicBookingNoticeEvidence` (`server/prisma/schema.prisma`) — organization/clinic-scoped, snapshots `noticeTextSnapshot`, `controllerNameSnapshot`, `privacyContactSnapshot`, `noticeVersion`, `noticeEffectiveDate`, `noticeHash`; `channel` fixed to `web_booking`; opaque unique `token`; unique `appointmentRequestId` (one evidence row per booking request); `legalProfileId`/`appointmentRequestId` FKs use `onDelete: SetNull` so historical evidence is never destroyed by later profile edits or (hypothetical) request deletion.
- Migration: `server/prisma/migrations/20260715090000_add_public_booking_notice_evidence/migration.sql` — hand-authored to contain **only** this table's DDL (an initial `prisma migrate dev` run picked up unrelated pre-existing drift between migration history and `schema.prisma` that predates this change; that drift was discarded from this migration and is not part of this remediation item).
- No changes to `ChannelConsentLog` or its columns.

**Backend changes:**
- `server/src/services/publicBookingNoticeEvidence.ts` (new) — `resolvePublishedLegalProfile`, `issueOrReuseNoticeEvidence` (idempotent per clinic+session+version), `validateNoticeEvidenceToken`, `linkNoticeEvidenceToRequest` (race-safe via guarded `updateMany`).
- `server/src/routes/publicBooking.ts` — `GET /api/public/booking/:clinicId` now also returns `legalNotice` (no internal IDs exposed); new `POST /api/public/booking/:clinicId/notice-evidence` issues/reuses evidence (rate-limited, no side effects on GET); `POST /api/public/booking/:clinicId` now requires and server-validates `noticeEvidenceToken` before creating any `AppointmentRequest`, and links evidence atomically inside the same transaction as request creation (both the full-slot-info and partial-request code paths).

**Frontend changes:**
- `src/pages/BookingWidget.tsx` — fetches `legalNotice` from the bootstrap response; blocks the entire form (no data collection) with a neutral message when no published profile exists; silently issues notice evidence via a per-tab-session id (`sessionStorage`, not a patient identifier); displays clinic controller name + an expandable full-notice text section before submission; disables submit until evidence is ready; no acknowledgment/consent checkbox anywhere.
- `src/services/api.ts` — added `publicBookingService.getNoticeEvidence`; `submit` now carries `noticeEvidenceToken`.
- Translations added to `src/locales/{tr,en,fr,de}/booking.json` under `notice.*` (all 4 shipped app locales).

**Tenant isolation / security:**
- Evidence lookups always re-derive the clinic from the URL param and check `evidence.clinicId === clinicId` server-side — a client cannot use one clinic's token for another (verified in the smoke test below).
- Client-supplied clinic ID, legal-profile ID, notice text, and notice version are never trusted; only the opaque evidence token is accepted, and it is resolved against the database.
- Booking submission is rejected (400, generic message, no info leak) when the clinic has no published profile, when the token is missing/unknown/expired/wrong-clinic/wrong-channel/already-linked.
- Rate limiting on both the booking-submit endpoint (existing) and the new notice-evidence endpoint.

**WhatsApp/Instagram non-regression:** `channelConsentGate.test.ts` (28/28) and `channelConsentFlowResume.test.ts` (17/17) pass unchanged; `publicClinicKvkk.ts` and `clinicLegalProfile.ts` were not modified; `clinicLegalProfile.test.ts` (29/29) passes unchanged.

**Files changed:**
- `server/prisma/schema.prisma`, `server/prisma/migrations/20260715090000_add_public_booking_notice_evidence/migration.sql`
- `server/src/services/publicBookingNoticeEvidence.ts` (new)
- `server/src/routes/publicBooking.ts`
- `server/src/tests/publicBookingNoticeEvidence.test.ts` (new), `server/package.json` (test script wiring)
- `src/pages/BookingWidget.tsx`, `src/services/api.ts`
- `src/locales/tr/booking.json`, `src/locales/en/booking.json`, `src/locales/fr/booking.json`, `src/locales/de/booking.json`
- `docs/compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md` (this file)

**Tests added:** `server/src/tests/publicBookingNoticeEvidence.test.ts` — 16 unit tests: language normalization, evidence-token validation (missing/not-found/wrong-clinic/wrong-channel/expired/already-linked/valid), atomic-link race behavior, static no-consent-wording checks on the Prisma model and service exports, channel/language constants.

**Exact validation commands and results (this session, 2026-07-15):**
- `npx prisma validate` → `The schema at prisma\schema.prisma is valid`
- Disposable Postgres 16 (Docker, ephemeral, destroyed after validation) seeded with the pre-existing 57 committed migrations via `prisma migrate deploy`, then the new isolated migration applied the same way → `npx prisma migrate status` → `Database schema is up to date!`
- `npx prisma generate` → succeeded
- `npm run typecheck` (server; `prisma generate && tsc --noEmit`) → 0 errors
- `npx tsx src/tests/publicBookingNoticeEvidence.test.ts` → **16 passed, 0 failed**
- `npx tsx src/tests/clinicLegalProfile.test.ts` → **29 passed, 0 failed** (unchanged)
- `npx tsx src/tests/channelConsentGate.test.ts` → **28 passed, 0 failed** (unchanged)
- `npx tsx src/tests/channelConsentFlowResume.test.ts` → **17 passed, 0 failed** (unchanged)
- `npx tsx src/tests/publicBookingAvailability.test.ts` → **19/19 passed** (unchanged)
- `npm test` (server, full suite, 48 test scripts including the new one) → **all passed, 0 failed**
- `npx tsc -b` (frontend project references) → 0 errors
- `npm run build` (frontend, `tsc -b && vite build`) → succeeded (pre-existing chunk-size warnings only, unrelated to this change)
- Ad hoc Node-level HTTP smoke test (not committed — run against the same disposable Postgres, exercised the real Express router with real Prisma queries, then deleted): bootstrap with/without published profile, submission blocked with no evidence, idempotent re-issuance (1 row for repeated bootstrap calls), cross-clinic token rejection, successful submission + atomic evidence linking, rejected reuse of an already-linked token, historical snapshot unchanged after publishing a new notice version, forged/unknown token rejection — **all 10 scenarios passed**.

**Browser acceptance:** **Not performed.** No frontend dev server + browser was exercised in this session; only `tsc -b`/`vite build` (build-time validation) and the Node-level HTTP smoke test above were run. The Section 10 browser checklist in the remediation instructions (open booking page, confirm controller name, submit, publish new version, confirm old booking still points to old snapshot, missing-profile clinic, WhatsApp/Instagram flows) still needs to be executed manually against a running deployment before this item can move to `Completed and verified`.

**Remaining dependencies before `Completed and verified`:**
1. Manual browser acceptance testing (checklist above) against a real running frontend+backend.
2. Deployment of the migration to any shared/staging/production database.
3. Post-deployment production verification that public booking pages for real clinics correctly block/allow based on their actual published-profile state.
4. (Separate, longer-running dependency, not blocking this technical sub-item) Legal-text approval of each clinic's own privacy-notice content remains with legal counsel / clinic operators — this remediation item only fixes *delivery and evidence*, not notice wording.

---

## 7. Rules for marking work completed

An item may only be set to **Completed and verified** when all applicable conditions hold:
1. Implementation present. 2. Required migrations present and validated. 3. Backend/frontend type checks pass. 4. Focused regression tests pass. 5. Authorization/tenant-scope tests pass where relevant. 6. Production verification done where required. 7. Legal approval obtained for legal-dependent controls. 8. Evidence recorded in this table.

Never mark a legal dependency complete based only on code. Never mark an infrastructure control complete based only on repository inspection. Never mark a control complete if required tests are missing or failing. Never downgrade/remove a finding without a correction-log entry (see full report Section 1/1.1). Never silently delete checklist items — if a finding becomes not applicable, mark `N/A` and record why in Section 8 below.

---

## 8. Remediation Change History

| Date | Finding ID | Previous status | New status | Commit/PR | Summary | Verified by |
|---|---|---|---|---|---|---|
| 2026-07-15 | (all Phase 0 items) | (n/a — first tracked entry) | Not started / Waiting for legal review / Waiting for operational evidence (see Section 6) | — | Initial repository-tracked baseline created from third-pass revised audit report | — |
| 2026-07-15 | KVKK-CRIT-001a | Not started | Implemented — awaiting deployment/operational verification | branch `feature/kvkk-public-booking-notice-evidence` | Added `PublicBookingNoticeEvidence` model/migration, public-booking notice bootstrap + evidence issuance + server-validated linking, BookingWidget notice display (no checkbox), 4-language translations, 16 focused tests + full regression suite pass; browser/production verification and legal-text approval still outstanding (see Section 6.1) | Automated tests only (this session) |

Every future status change adds a new row here. Do not rewrite or delete existing rows.

---

## 9. Next recommended remediation item

**KVKK-CRIT-001a is now implemented** (see Section 6.1) — awaiting deployment/operational verification and legal-text approval, not further technical implementation.

**Next: KVKK-HIGH-007 — Normalized `CommunicationPreference` model (channel+purpose) + migration of `smsOptOut` to `channel=sms` scope.**

Rationale: it is the next `Not started` Phase 0 item in Section 5's ordering that is purely technical (no legal-counsel dependency, unlike KVKK-CRIT-002/KVKK-CRIT-005/VERBİS/processor-agreement which are `Waiting for legal review`, and unlike HIGH-001 which is `Waiting for operational evidence`). Per the existing correction-log context (Section 0.1 of the full narrative report), `smsOptOut` must **not** be mechanically interpreted as blocking WhatsApp — the fix requires an explicit channel-scoped preference model, not a blanket reinterpretation. This item was not started in this task.

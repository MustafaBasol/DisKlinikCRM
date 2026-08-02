# US-07.5 — Attribution, CAC, ROI and Lead Funnel Architecture Review

```text
ClickUp task:        86eydm678 — https://app.clickup.com/t/86eydm678
Task type:            ARCHITECTURE REVIEW AND DATA-READINESS ASSESSMENT ONLY
Execution baseline:   3d96d650e98153d73cac2c2b308d93d40db1aadb
Branch:               docs/us-07-5-attribution-architecture
Future implementation risk: HIGH
```

This document is documentation and architecture analysis only. It changes no application code, no Prisma
schema, no tests, no CI, and no `docs/program/**` tracker content. Every claim below is traced to exact
source locations in the frozen baseline (`server/prisma/schema.prisma`, `server/src/routes/**`,
`server/src/services/**`, `server/src/jobs/**`, `src/pages/**`, `src/components/**`, `src/services/**`,
`src/locales/**`). Where a claim cannot be verified from the code, it is explicitly marked as an assumption
requiring a product/legal decision — no metric in this document is presented as reliable without a cited
source-data path.

## Wave isolation note

This review runs independently and in parallel with PR #268. It does not inspect, fetch, merge, cherry-pick,
rebase onto, or reconcile PR #268 or any sibling branch/PR. The baseline above is frozen for the duration of
this task regardless of what merges elsewhere in the meantime. Reconciliation is explicitly out of scope and
is owned by ChatGPT / Mustafa (see final report).

---

## 1. Executive summary

NoraMedi (the DisKlinikCRM product) currently has **one real acquisition-channel signal**:
`Patient.source`, a nullable, free-text `String` column (`server/prisma/schema.prisma:230`) with no
database-level enum or check constraint. A second, more heavily used signal exists one hop upstream —
`AppointmentRequest.source` (`server/prisma/schema.prisma:383`) — which is stamped consistently and
automatically by the WhatsApp (two providers), Instagram, and public-booking-widget integrations, and is
already indexed for reporting (`@@index([source, status, createdAt])`).

A basic "revenue and patient count by source" report already exists in production
(`GET /api/reports/patient-sources`, `server/src/routes/reports.ts:374-443`, surfaced as the "Sources" tab
in `src/pages/Reports.tsx`). This is the only existing analytics surface that touches attribution, and it
has three material gaps: (1) it reads only `Patient.source`, never `AppointmentRequest.source` or
`ContactRequest.channel`, so leads that never convert to a patient are invisible; (2) it folds `NULL`
source and staff-selected `'other'` into the same bucket, destroying the "we don't know" vs. "staff said
other" distinction; (3) it has no cost/spend input of any kind, so it can show revenue-by-channel but
**cannot** compute CAC or ROI today — no `adSpend`, `campaign`, `marketingSpend`, or channel-cost model
exists anywhere in the schema.

Beyond the missing cost model, four structural gaps block reliable funnel and CAC/ROI reporting even before
a channel-cost model is added:

1. **Source taxonomy is fragmented and inconsistent across four independent free-text vocabularies** —
   the manual patient-creation form (9 values), the Excel importer (5 different values, one of which
   overlaps only partially), the AppointmentRequest writers (4 real values: `widget`, `whatsapp`,
   `meta_whatsapp`, `instagram`), and the reports-tab locale file (11 values, some never produced by any
   writer). Converting an `AppointmentRequest` to a `Patient` copies the request's raw source value onto
   `Patient.source` **without validating it against the patient-form's enum**, so values like `'widget'`
   that the manual UI dropdown doesn't even offer can and do land in the database.
2. **Attribution is never backfilled onto an existing patient.** If a walk-in patient (created with
   `source = 'walk_in'`) later books through WhatsApp, the `AppointmentRequest.source = 'whatsapp'` is
   recorded on the request only — `Patient.source` is never updated. Multi-channel patients are silently
   attributed to whichever channel happened to create the first `Patient` row.
3. **`TreatmentCase.closedAt`, which two existing reports already filter on
   (`reports.ts:327`, `organizationDashboard.ts:178`), is only populated by one narrow code path** — the
   automatic TreatmentCase created when a staff member marks an `Appointment` `completed`
   (`server/src/routes/appointments.ts:555-573`). The normal manual quote → accept → complete workflow
   (`PUT /api/treatment-cases/:id`, a generic partial update) never sets `closedAt`, because
   `closedAt` is not even part of `treatmentCaseSchema`. **Existing "completed treatments this period"
   reports are already silently under-counting** for any case that went through a real sales pipeline
   rather than the auto-generated single-visit path.
4. **Appointment attendance is 100% manually staff-reported, with no automatic completion job.** An
   appointment that occurred and that nobody subsequently touched stays `scheduled`/`confirmed`
   indefinitely — there is no cron job anywhere in `server/src/jobs/startBackgroundJobs.ts` that
   transitions past-dated appointments. This means "not marked no-show" **cannot** be used as a proxy for
   "attended," and the instruction in this task's brief not to make that inference is directly confirmed
   by the code.

None of the eight required metrics (new patients by channel, channel share, channel-attributed revenue,
average revenue per acquired patient, CAC, ROI, patient referrals, lead conversion funnel) can be certified
production-ready today. Channel share and channel-attributed revenue are **partially inferable** from
existing data with clearly documented caveats; CAC, ROI, and the lead-conversion funnel require new data
model work (a channel/cost model, funnel-stage instrumentation, and either backfill or forward-only
reporting); patient referral analytics requires a product decision before any schema work, because no
referral model or field exists at all today (`Patient.source` merely accepts `'referral'` as one of nine
free-text label options — there is no `referredByPatientId` or equivalent).

The recommended path is an **additive, backward-compatible, multi-phase build** (§12) that never retroactively
fabricates historical timestamps, introduces a managed `AcquisitionChannel` + `AcquisitionChannelCostPeriod`
model to replace the fragmented free-text taxonomies (§6–§7), and instruments new writes going forward while
leaving historical gaps honestly labeled as `unknown`/`not available` rather than backfilled with guesses.

---

## 2. Current data-lineage inventory

All models below were read directly from `server/prisma/schema.prisma` (single monolithic file, 3360 lines,
no schema splitting) at the frozen baseline. Field names, types, and enum/comment values are quoted verbatim.
The only true Prisma `enum` in the schema, anywhere, is `PatientLegacyConsentField { SMS_OPT_OUT }`
(`schema.prisma:2218`) — unrelated to attribution. Every "status"/"source"/"channel" value discussed below is
an **unconstrained `String` column**; the canonical value set (where one exists) lives only in a Zod validator
in `server/src/schemas/index.ts`, and in several cases the Prisma inline comment has drifted out of sync with
the real Zod enum (flagged per-model below).

### 2.1 `Patient` (`schema.prisma:216–285`)

| Field | Type | Nullable | Notes |
|---|---|---|---|
| `id` | String | No | uuid |
| `clinicId` | String | No | FK → Clinic |
| `organizationId` | String | No | FK → Organization |
| `primaryClinicId` | String? | Yes | "Default/preferred branch (not exclusive)" |
| `firstName`, `lastName` | String | No | — |
| `email`, `phone` | String? | Yes | no unique constraint on either (see §2.16) |
| `patientStatus` | String | No, default `"new"` | comment: `new, active, inactive, archived` |
| **`source`** | String? | **Yes** | comment: `// google, referral, social_media, etc.` — the sole acquisition-channel field in the schema |
| `communicationConsent`, `marketingConsent`, `smsOptOut` | Boolean | No | consent flags |
| `isAnonymized`, `anonymizedAt`, `anonymizedById`, `anonymizationReason` | mixed | Yes | anonymization support exists |
| `createdAt` / `updatedAt` | DateTime | No | `now()` / `@updatedAt` |
| `deletedAt` | DateTime? | Yes | soft-delete |

- **Creation path / canonical or free-text:** `source` is `String?` with **no DB enum or check constraint**.
  The canonical value set lives only in `patientSchema` (`server/src/schemas/index.ts:35`):
  `z.enum(['google','referral','social_media','instagram','website','phone','walk_in','doctolib','other']).optional().nullable()`.
- **User-editable / system-generated:** both. Manual staff entry via `PatientForm.tsx` sets one of the 9
  enum values; automated writers (WhatsApp/Instagram/public-booking conversion) set values **outside** that
  enum (`'whatsapp'`, `'meta_whatsapp'`, `'instagram'`, `'widget'`) via a raw `tx.patient.create()` call in
  the appointment-request conversion route that bypasses `patientSchema` validation entirely
  (`server/src/routes/appointmentRequests.ts:362`: `source: request.source || 'whatsapp'`).
- **Historical reliability:** LOW. Four independent, partially-overlapping vocabularies write to this one
  field (see §2.17 "source taxonomy fragmentation" table). Omitted on create → `NULL` (no server-side
  default despite the Zod field description).
- **Tenant/clinic scope:** `clinicId` + `organizationId` both present directly on the row.
- **Audit/history:** none — no history table; only a flat `ActivityLog` description string on updates
  (see §2.8) and only when the patient record itself is updated through a route that logs activity, not
  specifically for `source` changes.
- **Anonymization behavior:** dedicated fields exist (`isAnonymized`/`anonymizedAt`/`anonymizedById`/
  `anonymizationReason`); attribution reporting must explicitly decide whether to exclude or aggregate-only
  anonymized patients (§10.7).
- **Legacy-data limitation:** imported patients (Excel) can have `source` values (`'online'`) not present in
  the manual-entry enum, and vice versa; a converted `AppointmentRequest` can leave `source` values
  (`'widget'`, `'meta_whatsapp'`) that the patient-edit form's own dropdown does not list, so re-editing that
  patient in the UI would silently reset/misrepresent their source.

### 2.2 `ContactRequest` (`schema.prisma:406–435`)

| Field | Type | Nullable | Notes |
|---|---|---|---|
| `clinicId` | String | No | FK |
| `patientId` | String? | Yes | FK |
| **`channel`** | String | No | comment: `whatsapp, meta_whatsapp, instagram, manual` |
| `sourceConversationId`, `sourceMessageId`, `externalSenderId` | String? | Yes | provenance |
| `type` | String | No, default `"staff_handoff"` | `callback_request, staff_handoff, information_request, complaint, other` |
| `status` | String | No, default `"pending"` | `pending, in_progress, resolved, closed` |
| `resolvedById`, `resolvedAt` | mixed | Yes | resolution audit |

- **Creation path:** **there is no HTTP POST route to create a `ContactRequest`.** The only writer is the
  exported helper `upsertContactRequest()` (`server/src/routes/contactRequests.ts:20-74`), called exclusively
  from `metaWhatsAppAiProcessor.ts:991`, `instagramAiConversationProcessor.ts:975`, and `whatsapp.ts:1682,1730`.
  There is no staff-facing "create contact request" form and no public form.
- **`channel: 'manual'`** is documented in the schema comment but **never set by any production code path** —
  confirmed via search, the only occurrences are in test fixtures. This is dead/aspirational schema
  documentation.
- **Dedup:** `upsertContactRequest` looks for an existing open request with the same
  `clinicId + channel + externalSenderId` and updates rather than duplicates
  (`contactRequests.ts:33-54`).
- **Historical reliability:** HIGH for the value that *is* recorded (channel is always one of `whatsapp`,
  `meta_whatsapp`, `instagram` in practice), but this model represents a **messaging inbox construct**
  (human handoff within a chat), not a marketing lead-source signal — do not conflate `ContactRequest.channel`
  with `Patient.source`/`AppointmentRequest.source`.
- **Tenant scope:** `clinicId` only (no direct `organizationId` — derived transitively via `Clinic`).

### 2.3 `AppointmentRequest` (`schema.prisma:367–404`)

| Field | Type | Nullable | Notes |
|---|---|---|---|
| `clinicId` | String | No | FK |
| `patientId` | String? | Yes | FK, nullable until conversion |
| `patientName`, `phone`, `email` | mixed | phone required | pre-conversion contact info |
| **`source`** | String | **No, default `"whatsapp"`** | no enum comment in schema; real values confirmed by reading every writer (see §2.17) |
| `externalSenderId`, `sourceConnectionId`, `sourceInboxEntryId`, `sourceConversationId` | String? | Yes | provenance metadata (added by migration `20260610110000_add_appointment_request_source_metadata`) |
| `status` | String | No, default `"pending"` | `pending, approved, rejected, converted, closed` |
| `convertedAppointmentId` | String? | Yes | FK → Appointment |
| relation `noticeEvidence` | 1:1 optional | — | link to `PublicBookingNoticeEvidence` when the request came from the public widget |

- **This is the strongest existing funnel-entry signal in the schema** — `source` is always explicitly set
  by every production writer (no code path relies on the schema default silently), and it is already indexed
  for reporting: `@@index([source, status, createdAt])`.
- **Creation path — full inventory** (every site, exact value, exact file:line):

  | Site | File:line | `source` value |
  |---|---|---|
  | Public booking widget | `publicBooking.ts:380` | `'widget'` (hardcoded) |
  | WhatsApp (Evolution) AI slot booking | `whatsapp.ts:1459` | `'whatsapp'` |
  | WhatsApp (Evolution) staff-approval request | `whatsapp.ts:1644` | `'whatsapp'` |
  | WhatsApp (Evolution) external API `/appointment-requests` | `whatsapp.ts:3935` | `'whatsapp'` |
  | WhatsApp (Evolution) external API `/cancel-request` | `whatsapp.ts:3974` | `'whatsapp'` |
  | WhatsApp inbox → manual staff conversion | `whatsappInbox.ts:637` | `'whatsapp'` (hardcoded — **indistinguishable from bot-created**) |
  | Meta WhatsApp AI staff-approval | `metaWhatsAppAiProcessor.ts:820-844` | `'meta_whatsapp'` |
  | Meta WhatsApp AI slot booking | `metaWhatsAppAiProcessor.ts:918-943` | `'meta_whatsapp'` |
  | Instagram AI staff-approval | `instagramAiConversationProcessor.ts:704-729` | `'instagram'` |
  | Instagram AI slot booking | `instagramAiConversationProcessor.ts:807-833` | `'instagram'` |
  | Instagram inbox → manual staff conversion | `instagramInbox.ts:554-575` | `'instagram'` (same bot/staff ambiguity) |

- **Known limitation:** the inbox-driven "staff manually converts a chat thread into a request" paths stamp
  the exact same `source` value as the fully-automated AI-bot paths — the data cannot currently distinguish
  "a human replied and typed the request" from "the AI bot auto-detected intent and created the request."
  This matters for a future "human-assisted vs. self-service" funnel breakdown, which is **not currently
  measurable**.
- **Legacy synthesis:** `resolveAppointmentRequestSourceFilter` (`appointmentRequests.ts:44-47,100-144`)
  synthesizes a display-only `source: 'whatsapp'` value for pre-migration WhatsApp-created appointments that
  have no real `AppointmentRequest` row — this is a display-time construct, not a stored value, and must not
  be treated as ground truth in any aggregate query.
- **Tenant scope:** `clinicId` only.

### 2.4 `Appointment` (`schema.prisma:316–365`)

| Field | Type | Nullable | Notes |
|---|---|---|---|
| `clinicId`, `patientId`, `practitionerId`, `appointmentTypeId` | String | No | — |
| `startTime`, `endTime` | DateTime | No | — |
| **`status`** | String | No, default `"scheduled"` | Zod enum (`schemas/index.ts:172-179`): `scheduled, confirmed, completed, cancelled, rescheduled, no_show` (schema comment is stale — omits `rescheduled`) |
| `noShowReason`, `noShowMarkedAt`, `noShowMarkedById` | mixed | Yes | no-show audit trail |
| `recoveryStatus` | String? | Yes | `unresolved \| contacted \| recovered` |
| `treatmentCaseId` | String? | Yes | FK |
| `deletedAt` | DateTime? | Yes | soft-delete |

- **No `source`/`channel` field exists on `Appointment` at all.** A staff-created appointment for an
  existing patient (`POST /api/appointments`, `server/src/routes/appointments.ts:314-409`) requires an
  existing `patientId`, never creates a `Patient` or `AppointmentRequest`, and carries **zero** attribution
  signal of its own — it is a complete bypass of the lead pipeline (§4, stage "appointment created").
- **Attendance is manual only.** `status: 'completed'` is set exclusively via the generic
  `PUT /api/appointments/:id`; there is no dedicated check-in endpoint and, critically,
  `server/src/jobs/startBackgroundJobs.ts:24-37` (the complete list of cron jobs: reminders, meta template
  sync, data retention, inbound-event retry, imaging-bridge offline, notice-evidence cleanup, privacy-export
  cleanup, clinic-bulk-export worker/cleanup, file backup, external-calendar sync) contains **no job that
  auto-transitions a past appointment to `completed` or `no_show`**. Past appointments nobody touched remain
  `scheduled`/`confirmed` indefinitely.
- **`no_show` is a dedicated, staff-triggered, idempotent, audited action:** `PATCH /api/appointments/:id/no-show`
  (`server/src/routes/noShows.ts:80-125`), role-gated to
  `OWNER/ORG_ADMIN/CLINIC_MANAGER/RECEPTIONIST/DENTIST`, guards against marking already-`cancelled`/`completed`
  appointments. There is no automatic no-show detection based on elapsed time.
- **Status-change audit is genuinely good here** (unlike TreatmentCase, §2.5): every status transition writes
  both a structured `ActivityLog` entry and a `writeAuditLog` call recording
  `{ previousStatus, newStatus }` (`appointments.ts:589-606`).
- **Side effect relevant to funnel accuracy:** marking an appointment `completed` when it has no
  `treatmentCaseId` **auto-creates** a `TreatmentCase` with `stage: 'completed'`, `estimatedAmount =
  acceptedAmount = appointmentType.basePrice`, and `closedAt = new Date()` (`appointments.ts:555-573`). This
  conflates single-visit auto-generated "cases" with genuine multi-step sales-pipeline cases in any naive
  `TreatmentCase.stage`-based funnel query (§4, stage "treatment proposed"/"accepted").

### 2.5 `TreatmentCase` (`schema.prisma:478–517`)

| Field | Type | Nullable | Notes |
|---|---|---|---|
| `clinicId`, `patientId` | String | No | — |
| `practitionerId` | String? | Yes | — |
| **`stage`** | String | No, default `"new"` | Zod enum (`schemas/index.ts:228-238`): `new, consultation_scheduled, consultation_done, quote_sent, waiting_patient_decision, accepted, in_progress, completed, lost` — **schema inline comment is stale** (`// new, quote_sent, in_progress, completed, lost` — omits 4 real values) |
| `estimatedAmount`, `acceptedAmount` | Float? | Yes | plain `Float`, not `Decimal` — rounding risk |
| `currency` | String? | Yes | one of 6 validated currencies (§2.9) |
| `closedAt` | DateTime? | Yes | **see critical gap below** |
| `lostReason` | String? | Yes | free text |
| `deletedAt` | DateTime? | Yes | soft-delete |

- **"Proposed" = `stage === 'quote_sent'`; "Accepted" = `stage === 'accepted'`; "Completed" (closed-won) =
  `stage === 'completed'`; "Lost" = `stage === 'lost'`.** These are the only reasonable current-code mappings
  onto the funnel's `treatment proposed` / `treatment accepted` stages; there is no separate "acceptance
  event" field beyond the stage value itself.
- **CRITICAL GAP — no reliable stage-transition timestamp:** `closedAt` is **not part of
  `treatmentCaseSchema`** (confirmed absent, `server/src/schemas/index.ts:222-244`), so the normal
  `PUT /api/treatment-cases/:id` transition route (`treatmentCases.ts:272-334`, a generic partial update with
  **no state-machine guard** — any field including `stage` can be set directly in one call) **can never set
  `closedAt`**. The only writer of `closedAt` is the unrelated auto-create-on-appointment-completion path
  (§2.4). Two existing reports already filter on this field and are therefore **already silently
  under-counting** real sales-pipeline completions: `reports.ts:327` (doctor-performance "completed this
  period") and `organizationDashboard.ts:178` (org-wide "completed treatment cases").
- **No status-history table.** The only trail is a flat `ActivityLog` description
  (`treatmentCases.ts:319-322`: `'"${updated.title}" tedavi vakası güncellendi'`) that does **not** record
  old/new `stage` values — unlike `Appointment`'s structured audit (§2.4). Reconstructing "when did this case
  move from `quote_sent` to `accepted`" is **not currently possible** from stored data.
  A confirmed dead/broken parameter: `GET /api/treatment-cases` accepts a `status` query param
  (`treatmentCases.ts:39,51`) but the Prisma field is `stage`, not `status` — this filter would throw a
  Prisma "unknown argument" error, silently caught by a generic 500 handler.
- **Mutability:** `estimatedAmount`/`acceptedAmount`/`stage` can all be changed together in one PUT with no
  lock once `accepted`/`in_progress` — no proposal versioning exists.
- **Tenant scope:** `clinicId` only.

### 2.6 `TreatmentPlanProcedure` (`schema.prisma:1216–1255`)

Procedure-level line items under a `TreatmentCase`: `status` (`planned | in_progress | completed |
cancelled`), `estimatedCost` (Float?, no `acceptedCost` at this level — only case-level `acceptedAmount`
aggregates the whole proposal), `completedAt`. The proposal PDF service sums non-cancelled procedures'
`estimatedCost` for the printed total (`server/src/services/treatmentProposalPdf.ts`, invoked from
`treatmentCases.ts:144-215`). No source/channel field. Tenant scope: `clinicId` + `patientId` +
`treatmentCaseId`.

### 2.7 `Payment` (`schema.prisma:703–728`)

| Field | Type | Nullable | Notes |
|---|---|---|---|
| `clinicId`, `patientId` | String | No | — |
| `treatmentCaseId` | String? | Yes | payment can exist with no case (standalone charge) |
| `amount` | Float | No | not `Decimal` |
| `currency` | String | No | free string, 6-value Zod-validated set at write time only |
| `paymentMethod` | String | No | `cash, card, bank_transfer, etc.` |
| **`paymentStatus`** | String | No, default `"pending"` | Zod (`schemas/index.ts:298`): `pending, partial, paid, refunded, cancelled` |
| `paidAt` | DateTime? | Yes | collection-date timestamp — **this is what existing reports use for period filtering**, not `createdAt` |

- **What the code already treats as "revenue":** `{ paymentStatus: { in: ['paid','partial'] } }` filtered
  on `paidAt` — confirmed at `reports.ts:51-52` and `dashboard.ts:98-99`. `pending` is tracked separately as a
  receivable (`dashboard.ts:102-105`, `reports.ts:68-72`).
  **`refunded` is never netted against previously-reported "collected" totals** — a payment counted while
  `paid` and later flipped to `refunded` simply drops out of subsequent queries with no reversal ledger entry.
- **Refund path is incomplete:** there is a dedicated `PATCH /api/payments/:id/cancel`
  (`payments.ts:210-249`) setting `paymentStatus: 'cancelled'`, but **no dedicated refund endpoint** —
  `refunded` is only reachable via the generic `PUT /api/payments/:id` accepting any
  `paymentSchema.partial()` field. There is no `refundedAt`, `refundAmount`, or `refundReason` field.
- **No `appointmentId` field** — payment-to-appointment correlation must go through
  `treatmentCase.appointments`. **No `organizationId` column directly** — derived transitively via `Clinic`.
- **Currency:** no FX normalization anywhere in aggregate reporting queries — a multi-currency clinic's
  summed totals in existing reports are already not currency-safe.

### 2.8 `ActivityLog` (`schema.prisma:815–841`) and audit logging generally

Generic, free-text `entityType`/`action`/`description` log, written manually per-route. Structured
before/after values (like `{previousStatus, newStatus}`) are only present for `Appointment` status changes
via a separate `writeAuditLog()` call; `TreatmentCase` and `Patient` updates use the flat description-only
form. **Not a substitute for a real funnel event log** (§9).

### 2.9 Currency (`server/src/schemas/index.ts:4`)

`validCurrencies = ['USD', 'EUR', 'TRY', 'GBP', 'CAD', 'CHF']` — enforced only at Zod validation time on
write, not at the database level, and not normalized to a single organization-reporting currency anywhere in
aggregate queries.

### 2.10 WhatsApp conversation/connection models

Two independent, production, real (not stub) integrations:

- **Meta Cloud API** (current/primary): `WhatsAppConnection` (org-level, `provider` default
  `"evolution_api"` — comment lists `evolution_api | meta_cloud_api`), `ClinicWhatsAppConnection` (join
  table), `WhatsAppConversationMessage` (persisted history, `direction` field, dedup unique on
  `[clinicId, providerMessageId]`), `WhatsAppInboxEntry` (unresolved inbound, `status: open | resolved`).
  Webhook (`metaWhatsAppWebhook.ts`) does HMAC `X-Hub-Signature-256` verification and idempotent inbound
  storage via `MessagingInboundEvent`.
- **Legacy Evolution API** provider (`server/src/routes/whatsapp.ts`, 4000 lines).
- First-contact patient auto-creation stamps `source: 'meta_whatsapp'` or `source: 'whatsapp'` respectively
  (`metaWhatsAppAiProcessor.ts:754-767`, `whatsapp.ts:1179-1188`).

### 2.11 Instagram conversation/connection models

Structurally symmetric to WhatsApp and equally real/wired-up:
`InstagramConnection`, `ClinicInstagramConnection`, `InstagramInboxEntry`, `InstagramConversationMessage`
(dedup unique on `[organizationId, externalMessageId]`). Webhook (`instagramWebhook.ts`, 577 lines) is
HMAC-verified. Patient auto-creation stamps `source: 'instagram'`
(`instagramAiConversationProcessor.ts:924-937`).

### 2.12 `PublicBookingNoticeEvidence` (`schema.prisma:1975–2022`)

**Not a booking/lead record.** Per its own doc comment, this is explicitly "NOT a consent record" — it is
KVKK privacy-notice-display evidence for the public web-booking widget, 1:1-optionally linked to the
`AppointmentRequest` it accompanies. `channel` is fixed to `"web_booking"` and kept as a column only so
future channels can reuse the table. **There is no dedicated `PublicBooking` model** — public-widget
bookings flow entirely through `AppointmentRequest` with `source = 'widget'`.

### 2.13 Referral

**NOT FOUND IN SCHEMA.** No `Referral`, `PatientReferral`, `ReferralSource`, `referredBy`, or
`referredByPatientId` field or model exists anywhere in `server/prisma/`. `'referral'` is only ever a
free-text *value* inside `Patient.source`'s 9-option enum — there is no structural link from a referred
patient to the referring patient (or staff member, or partner).

### 2.14 `Clinic` (`schema.prisma:9–108`) and `Organization` (`schema.prisma:1339–1368`)

Standard two-level tenancy: `Organization` is the top-level tenant; `Clinic` is a branch under it
(`Clinic.organizationId`, NOT NULL after a documented "Phase 1b" backfill). No source/channel fields on
either. `Clinic.currency` and `Clinic.timezone` exist per-branch (`schema.prisma`) and are relevant defaults
for date-boundary and currency decisions in any acquisition-date/cost-period model (§5.1, §5.5).

### 2.15 `User` role/access (`schema.prisma:110–183`, `UserClinic` `schema.prisma:1370–1384`)

`role` (comment enum): `OWNER | ORG_ADMIN | CLINIC_MANAGER | DENTIST | RECEPTIONIST | BILLING | ASSISTANT`.
`canAccessAllClinics: Boolean` and `allowedClinicIds` (derived via `UserClinic`) govern cross-branch access;
`defaultClinicId` is explicitly commented "UI default only — NOT used for authorization." `UserClinic` allows
a per-branch role override. This is the access-control matrix any attribution/CAC/ROI dashboard must respect
(§10).

### 2.16 Duplicate-patient handling

`Patient` has **no DB-level unique constraint on `phone` or `email`** — only
`@@index([clinicId, phone])` / `@@index([clinicId, email])` for lookup performance. The Excel importer
(`patientsImport.ts`) does an **application-level, organization-wide** pre-check for existing phone/email
before insert (`patientsImport.ts:114-123,148-151,158-161`) — this check is a race-prone pre-query, not a
database constraint, and duplicate patients across concurrent writes (e.g. simultaneous WhatsApp-first-touch
+ manual creation) are possible.

### 2.17 Source taxonomy fragmentation (cross-model summary)

| Vocabulary | Location | Values |
|---|---|---|
| Manual patient-creation enum | `patientSchema`, `schemas/index.ts:35` | `google, referral, social_media, instagram, website, phone, walk_in, doctolib, other` (9) |
| Excel import allowed values | `patientsImport.ts:104` | `walk_in, referral, online, social_media, other, ''` (5 + blank) — **`online` not in manual enum; `google/instagram/website/phone/doctolib` not accepted here** |
| Real `AppointmentRequest.source` writers | see §2.3 table | `widget, whatsapp, meta_whatsapp, instagram` (4) — **none of these except `instagram` overlap with the manual patient enum** |
| Reports-tab locale labels | `src/locales/en/reports.json:55-78` | `referral, social_media, instagram, website, phone, walk_in, google, facebook, whatsapp, doctolib, other` (11) — includes `facebook`/`whatsapp` that the patient-form locale (`patients.json`) does not |
| Patient-form locale labels | `src/locales/en/patients.json:231-241` | matches the 9-value manual enum, missing `facebook`/`whatsapp` |

**Consequence:** the same underlying event ("this patient came from WhatsApp") is represented as `'whatsapp'`
on an `AppointmentRequest`, potentially copied verbatim and unvalidated onto `Patient.source` on conversion,
but a staff member manually creating that same patient via the UI has no `'whatsapp'` option at all in the
dropdown (only `'phone'`, `'other'`, etc.). This is the central problem §9 (source normalization) addresses.

---

## 3. Current-data readiness matrix

Classifications: **READY** (source data exists, semantics are clear, tenant-scoped, historically reliable) ·
**PARTIAL** (usable with caveats/gaps) · **NOT AVAILABLE** (no source data) · **AMBIGUOUS** (data exists but
its meaning is not proven by current code semantics) · **UNSAFE TO INFER** (a plausible-looking inference
that current code does not actually support and must not be made).

| Row | Source model/field | Reliability | Historical coverage | Tenant scope | Backfillable? | Required instrumentation | Metric impact |
|---|---|---|---|---|---|---|---|
| Patient acquisition channel | `Patient.source` | AMBIGUOUS — 4 conflicting vocabularies (§2.17), never backfilled on later channel touches | Partial — NULL for many manually-omitted and legacy rows | `clinicId` + `organizationId` present | Only truthfully for rows with a real, mappable raw value | Normalized channel taxonomy (§9) + validation on write | Blocks channel share / CAC / ROI until normalized |
| Lead source (pre-patient) | `AppointmentRequest.source`, `ContactRequest.channel` | PARTIAL — reliable per-writer but only 4 real values, no top-of-funnel report reads it today | Good since migration `20260610110000` added source metadata; earlier `AppointmentRequest` rows may predate metadata columns | `clinicId` only | Yes, going forward; not retroactively fabricatable pre-migration | New funnel report must join this in (currently `reports/patient-sources` ignores it) | Blocks lead-conversion funnel entirely without this join |
| Lead received timestamp | `AppointmentRequest.createdAt`, `ContactRequest.createdAt` | READY | Good | `clinicId` | N/A | None needed | Usable now as funnel-entry timestamp |
| Contacted timestamp | — | **NOT AVAILABLE** | — | — | No | Requires new event/status semantics (see §4, do not infer from message existence) | Funnel stage "contacted" not measurable |
| Appointment conversion | `AppointmentRequest.status = 'converted'`, `convertedAppointmentId` | READY | Good since request model existed | `clinicId` | N/A | None | Usable now |
| Appointment attendance | `Appointment.status = 'completed'` | **UNSAFE TO INFER as "not no_show"** — PARTIAL as an explicit self-reported flag only | Poor — no auto-completion job, large tail of appointments stay `scheduled` forever | `clinicId` | No (cannot fabricate historical attendance) | Auto-completion job or check-in event (product decision, §11) | Attendance-stage funnel accuracy capped by staff diligence |
| Treatment proposal | `TreatmentCase.stage = 'quote_sent'` | AMBIGUOUS — no timestamp of when this transition happened, no audit trail (§2.5) | Only current `stage` value is known; historical transition timestamps do not exist | `clinicId` | No | Structured stage-timestamp fields or event log (§9.6, §12 Phase C) | Cannot measure lead-time in-stage or reconstruct historical funnel dates |
| Treatment acceptance | `TreatmentCase.stage = 'accepted'` | AMBIGUOUS — same as above; also conflated with auto-generated single-visit cases (§2.4, §2.5) | Same as above | `clinicId` | No | Same as above, plus exclude/flag auto-generated cases | CAC/ROI "acceptance" numerator needs a clean definition first |
| Revenue | `Payment.amount` + `paymentStatus in (paid,partial)` + `paidAt` | READY for collected-revenue but no FX normalization; refunds not netted | Good | `clinicId` | N/A | Refund ledger + currency normalization for multi-currency orgs (§5.3) | Usable now for single-currency clinics; unsafe to sum across mixed-currency clinics |
| Channel cost | — | **NOT AVAILABLE** | — | — | No | New `AcquisitionChannel`/`AcquisitionChannelCostPeriod` model (§7) | CAC and ROI are both blocked entirely without this |
| Patient referral | — | **NOT AVAILABLE** (only a free-text label option) | — | — | No, historical free text can at best be normalized as "self-reported referral, identity unknown" | Product decision required: durable referral identity model (§8, §14) | Referral analytics blocked pending decision |
| Branch attribution | `clinicId` on nearly every model | READY | Good | Direct | N/A | None | Usable now |
| Organization attribution | `organizationId` (present on `Patient`, `User`, `Clinic`, not on `Payment`/`Appointment`/`TreatmentCase` directly — derived via `Clinic`) | READY (via join) | Good | Direct or one-hop join | N/A | None for correctness, but every aggregation query must join through `Clinic.organizationId` where the field isn't direct | Usable now, must use the existing `clinicScope.ts` pattern (§10) |

---

## 4. Canonical metric definitions

### 4.1 New patient attribution — canonical acquisition date

Evaluated candidates: `Patient.createdAt`, first `Appointment.createdAt`, first *attended* appointment,
first `Payment`, first accepted `TreatmentCase`.

**Recommended canonical default: `Patient.createdAt`.**

- **Business meaning:** "the date this person became a patient record in NoraMedi" — the closest available
  proxy for "when did this clinic actually acquire this person," and it is the only timestamp that is always
  set, non-null, and consistently written across every creation path (manual, import, WhatsApp, Instagram,
  request-conversion).
- **Limitations:**
  - For patients created via `AppointmentRequest` conversion, `Patient.createdAt` can trail the *lead's*
    true first-touch (`AppointmentRequest.createdAt`) by however long the request sat pending — the true
    "when did marketing acquire this lead" date is earlier and lives on the request, not the patient. A
    funnel report (§4.7) should use the lead's own `createdAt` for top-of-funnel dating; a *patient*-count
    report should use `Patient.createdAt`. **Do not mix the two silently** — this document treats "new
    patient attribution" and "lead entry attribution" as two distinct dated events.
  - For Excel-imported patients, `Patient.createdAt` is the **import date**, not the true historical
    acquisition date — there is no separate "originally acquired on" field, so bulk-imported cohorts will
    cluster on their import date rather than their real onboarding history. This must be labeled in any
    report showing pre-migration data (§3, row "Patient acquisition channel", and §12 Phase D).
  - **Timezone:** stored as UTC (Prisma `DateTime`); day-boundary bucketing for period reports must convert
    to the owning `Clinic.timezone` (default `"UTC"` per-clinic field, `schema.prisma`) — not to server or
    browser local time. No report code currently confirmed to do this consistently; flag for verification in
    any new report (§16, risk).
  - **Branch behavior:** `Patient.clinicId` is the branch of record; a patient can additionally have
    `PatientClinic` rows for other branches they've visited (`schema.prisma:1386-1399`,
    `firstVisitAt`/`lastVisitAt` per clinic) — cross-branch acquisition-date conflicts (same person, two
    branches, two different "first" dates) are possible under `PatientClinic` and must be explicitly decided
    (§14): does acquisition belong to the branch of the *first* `Patient` row, or the branch of first visit
    per `PatientClinic`? Recommend the former as the simpler, canonical default, with the latter available as
    a drill-down.
  - **Duplicate-patient behavior:** because there is no unique constraint on phone/email (§2.16), the same
    real person can exist as two `Patient` rows with two different `createdAt`/`source` values — a channel
    report is only as correct as patient-dedup discipline, which today is manual/best-effort. This is a known
    accuracy ceiling, not something instrumentation alone fixes.

Revenue date and acquisition date must **never be silently mixed**: a patient's acquisition date is fixed at
`Patient.createdAt`; a payment's date is `Payment.paidAt`. §4.3 defines exactly how these two independent
dates combine for the canonical revenue metric.

### 4.2 Channel share

```
channel_share(channel, period) = new_patient_count(channel, period) / total_attributed_new_patient_count(period)
```

- **Denominator:** all `Patient` rows with `createdAt` in `period`, scoped to the requesting
  organization/clinic set (§10), **regardless of whether `source` is set** — an unset/unknown source is a
  real cohort member, not something to silently drop from the denominator.
- **Unknown/unmapped/NULL source:** bucketed into an explicit `unknown` channel — **never merged into
  `other`**, because `other` is a staff-selected, intentional answer while `NULL`/unmapped is an absence of
  data. The existing `/reports/patient-sources` endpoint currently conflates these
  (`reports.ts:419,425,431`, `p.patient?.source || 'other'`) — this is a defect to fix in the rebuilt
  endpoint (§13, slice G), not a pattern to carry forward.
- **Manually entered values that don't match the normalized taxonomy** (e.g. free-text remnants, `'widget'`
  landing unvalidated on `Patient.source`): mapped through the source-normalization layer (§9); anything that
  cannot be confidently mapped stays in `unknown`, visible on a data-quality dashboard (§12 Phase G), never
  silently reassigned to a guessed channel.
- **Inactive channel:** a channel later marked `isActive = false` (§6) still appears in historical
  channel-share denominators for the periods in which it was active — deactivation is forward-looking only
  and must not rewrite historical shares.
- **Imported historical values:** included in the denominator and numerator using whatever mapped channel is
  truthfully derivable; imported rows with no source information at all are `unknown`, not silently excluded.

### 4.3 Attributed revenue

Evaluated candidates: all-time collected payments from patients acquired in the selected period; collected
payments received during the selected period; treatment proposal value; accepted treatment value; invoice
value; cash received.

**Recommended canonical default: cohort-collected revenue** — *"the sum of all `Payment` rows with
`paymentStatus ∈ {paid, partial}`, for patients whose `Patient.createdAt` falls in the selected period,
regardless of when the payment itself was collected."*

```
attributed_revenue(channel, period) =
  Σ Payment.amount
  WHERE Payment.paymentStatus IN ('paid','partial')
    AND Payment.patient.source →(normalized)→ channel
    AND Payment.patient.createdAt ∈ period
```

- **Why cohort-collected, not period-collected:** the purpose of this metric is channel ROI — "was the money
  spent acquiring this period's patients worth it, considering everything they've paid so far." A
  period-collected view (sum of payments *received* in the period, regardless of which cohort the paying
  patient belongs to) answers a different, complementary cash-flow question and is already what the existing
  **Revenue tab** in `Reports.tsx` shows (via `reports.ts:27-204`, filtered on `paidAt`). Both views should
  ship: cohort-collected as the canonical **channel attribution** metric (this document's default), and the
  existing period-collected view retained unchanged as general cash-flow reporting. **Do not merge them into
  one number** — the task brief's zero-inference guardrail applies equally to conflating two legitimately
  different revenue definitions.
- **Collected-only, per the task's guidance to prefer collected revenue when Payment semantics support it:**
  confirmed supported — `paymentStatus`/`paidAt` semantics already distinguish collected (`paid`/`partial`)
  from pending/refunded/cancelled (§2.7).
- **Refunds:** a refunded payment is excluded from the sum from the moment `paymentStatus` flips to
  `refunded` — because there is no netting ledger (§2.7), a payment counted as revenue in one query run and
  refunded before the next run will simply disappear from that run's total rather than showing as a negative
  adjustment. This is a known limitation inherited from the current `Payment` model, not something a
  reporting layer can fix without a schema change (§16, risk).
- **Cancellations:** `paymentStatus = 'cancelled'` payments are excluded (never counted).
- **Partial payments:** counted at their recorded `amount` (the amount actually paid to date), not at the
  underlying treatment's full proposed/accepted value.
- **Multiple branches:** revenue attributed to the channel is summed across every clinic the organization
  scope permits (§10); branch-level breakdown is a drill-down dimension, not a separate metric.
- **Payment date vs. acquisition date:** intentionally decoupled per the definition above — a payment made
  two years after acquisition still counts toward that patient's acquisition-cohort revenue. Report UIs must
  visually distinguish "revenue attributed to this cohort" from "revenue collected in this period" to avoid
  the exact silent-mixing failure mode the task brief warns against.
- **Currency:** summed only within a single currency; multi-currency organizations require either (a)
  per-currency reporting (no summed total) or (b) an explicit FX-conversion product decision (§14) — there is
  no FX infrastructure in the codebase today (§2.9), so (a) is the only currently-implementable default.
- **Anonymized patients:** included in aggregate sums (money collected is a business fact independent of
  patient PII), but any patient-identifying drill-down must respect `isAnonymized` (§11.9).

### 4.4 Average revenue per acquired patient

```
avg_revenue_per_patient(channel, period) = attributed_revenue(channel, period) / new_patient_count(channel, period)
```

- **Zero-denominator guard:** if `new_patient_count(channel, period) = 0`, the metric is `null`/"not
  applicable" — never `0` or `Infinity` — and the UI must render a missing-data state, not a zero bar (§13,
  slice I).
- Numerator and denominator use the **same cohort definition** (§4.1/§4.3) — this guards against the classic
  error of averaging period-collected revenue over cohort patient counts.

### 4.5 CAC

```
CAC(channel, period) = eligible_channel_cost(channel, period) / new_patient_count(channel, period)
```

- **Cost period vs. acquisition period:** must be the **same period**, aligned to the requesting clinic's
  (or organization's, for org-level campaigns) timezone-adjusted month/quarter boundaries — this is the
  purpose of the recommended `AcquisitionChannelCostPeriod` model (§7), which stores an explicit
  `effectiveFrom`/`effectiveTo` range rather than a single mutable "current monthly cost" field.
- **Branch allocation:** organization-level campaigns (one cost, spent across all branches) must define an
  explicit allocation strategy before CAC can be computed per-branch — this is a **product decision** (§14),
  not something inferable from data. Safe default recommendation: allocate organization-level cost
  proportionally to each branch's new-patient count for that channel/period (avoids fabricating a
  per-branch spend figure that was never actually tracked per-branch).
- **Zero-patient behavior:** if `new_patient_count = 0` for a period with nonzero cost, CAC is `undefined`/
  "no patients acquired" — never divide-by-zero to `Infinity` silently; the UI must show the raw cost and
  flag zero acquisitions explicitly, since this is itself an actionable signal (money spent, nothing
  acquired).
- **Missing-cost behavior:** if a channel has no `AcquisitionChannelCostPeriod` row covering the requested
  period, CAC is **NOT AVAILABLE** for that channel/period — never silently computed as `0` (which would
  make CAC look infinitely good) or omitted from the UI without an explicit "cost not recorded" label.
- **Multi-currency:** cost-period rows carry their own `currency` (§7); CAC is only computable when cost
  currency and attributed-revenue currency match, or after an explicit FX decision (§14).
- **Tax inclusion:** whether recorded channel cost is tax-inclusive or exclusive is a bookkeeping convention
  that must be decided and documented per organization (§14) — the cost-period model should carry a
  `notes` field for this rather than a rigid schema assumption.
- **Inactive channels:** cost history for a deactivated channel remains queryable for historical CAC —
  deactivation stops new cost-period entry, not historical reporting.
- **Historical cost corrections:** because `AcquisitionChannelCostPeriod` rows are period-scoped and
  immutable once a report has been generated against them (recommended convention, §7), a correction should
  be modeled as a new row with a note, not an in-place edit of a historical amount — this preserves
  reproducibility of previously-published reports. **Do not assume one mutable `costPerMonth` field is
  historically correct** — a single mutable field would silently rewrite every past CAC calculation the
  moment someone updates "this month's" cost, which is the exact trap this model is designed to avoid.

### 4.6 ROI

```
ROI(channel, period) = (attributed_revenue(channel, period) - eligible_channel_cost(channel, period)) / eligible_channel_cost(channel, period)
```

- **Display:** as a percentage by default (e.g. `(60,000 - 10,000) / 10,000 = 5.0 → "500%"`), with the raw
  decimal available for calculations/export.
- **Zero-cost behavior:** ROI is **undefined** (not `Infinity`) when cost is `0` but revenue is nonzero —
  render as "no cost recorded" rather than a nonsensical percentage.
- **Missing-cost behavior:** same as CAC — ROI is NOT AVAILABLE, not computed as if cost were `0`.
- **Negative values:** fully valid and expected (cost exceeded attributed revenue) — must render as a
  negative percentage, not clamped to zero.
- **Currency consistency:** revenue and cost must share a currency per the same rule as CAC (§4.5).
- **Period alignment:** revenue is cohort-based (§4.3: patients acquired in `period`, revenue collected any
  time up to the report's "as of" date) while cost is period-incurred (§4.5) — this is an intentional,
  standard marketing-ROI shape (spend now, collect later), but it means ROI for a *recent* period will be
  systematically understated relative to its eventual full value, because not all of that cohort's lifetime
  revenue has been collected yet. Any ROI report must display the "as of" date and, ideally, patient-cohort
  age, so a recent period's understated-but-still-accruing ROI isn't misread as a bad channel.

### 4.7 LTV

**Current data can support realized, collected-to-date revenue per patient. It cannot support predictive
LTV.** There is no cohort-decay model, no retention-curve infrastructure, and no forecasting logic anywhere
in the codebase.

- **Realized collected revenue (supported today, with the gaps noted in §4.3):** sum of a patient's `paid`/
  `partial` payments to date.
- **Accepted treatment value (supported today):** sum of `TreatmentCase.acceptedAmount` for a patient's
  accepted/completed cases — this is a *committed*, not necessarily *collected*, figure and must be labeled
  as such (a patient can accept a treatment plan and never pay in full).
- **Predicted LTV (NOT supported today):** would require a statistically modeled retention/spend curve per
  channel or cohort — out of scope for this review and explicitly **not** to be approximated by projecting
  current average revenue forward, which the task brief's zero-inference guardrail rules out as presenting an
  inferred metric as reliable without source-data proof.

Recommendation: ship "realized revenue to date" and "accepted treatment value to date" as two clearly
labeled, distinct figures; do not ship anything called "LTV" until a real predictive model is scoped as a
separate, later initiative.

### 4.8 Referral analytics

**No durable identity model exists to support this today (§2.13).** `'referral'` is one of nine free-text
`Patient.source` values with no link to *who* referred the patient.

Two paths are evaluated:

1. **A dedicated `referredByPatientId` field on `Patient`** — precise, but raises real design questions that
   must be resolved before building it (all flagged for product decision, §14):
   - **Circular referrals:** A refers B, B refers A — must be prevented at the write layer (reject
     self-referential cycles) or simply allowed as harmless data (two independent true events) — no cycle
     *traversal* logic (e.g. commission chains) is implied by a single-hop field, so this is likely a
     non-issue, but should be explicitly decided.
   - **Self-reference:** `referredByPatientId = self.id` must be rejected at the application layer.
   - **Cross-clinic references:** should a referral be allowed to cross clinics within the same organization
     (patient acquired at Branch A refers a friend who books at Branch B)? Recommend: allowed, since it's the
     same organization's patient relationship, but must be logged for the cross-branch attribution.
     Cross-**organization** references must never be possible (tenant isolation, §10).
   - **Anonymized patients:** if the referring patient is later anonymized, the referred patient's
     `referredByPatientId` foreign key either needs to be nulled out or preserved as an opaque, non-displayed
     reference — this is a privacy decision (§11), not a technical one.
   - **Minimum necessary identity display:** front-of-house staff arguably don't need to see the referring
     patient's full name/contact info to act on a referral report — a report showing "3 referred patients"
     without exposing the referring patient's PII may be the more privacy-conserving default; full identity
     visible only on the individual patient record where the relationship is already contextually visible.
   - **Consent implications:** does referencing Patient A by name in Patient B's record (or in an aggregate
     report) require Patient A's marketing-consent flag to be set? This is a KVKK/GDPR question flagged for
     legal review (§11).
   - **Imported historical free-text data:** an imported/legacy `source = 'referral'` value carries no
     identity at all and can never be safely backfilled into a `referredByPatientId` field — it should remain
     visible only as "self-reported referral, referrer unknown."

2. **A more general source/referral model** (e.g. `AcquisitionChannel` with a `channelType = 'referral'` and
   an optional free-text or structured "referred by" note, without a hard FK) — lower-precision, but avoids
   the identity/privacy questions above entirely, and is sufficient to answer "how many new patients came
   from referrals" (already answerable today via normalized `source`) without answering "referrals *by
   whom*."

**Recommendation:** ship the general channel-level referral count now (it's already derivable from
`Patient.source` once normalized, §9), and treat `referredByPatientId` as a **separate, later, product-owned
decision** gated on the privacy questions above — it is not required to satisfy the "patient referrals"
metric in this task's minimum bar, only to satisfy a more granular "who referred whom" view.

---

## 5. Funnel measurability matrix

Stages, in the required order: **incoming lead → contacted → appointment created → appointment attended →
treatment proposed → treatment accepted.**

| Stage | Proving event | Model/field | Timestamped? | Immutable/audited? | Clinic scoped? | Historically reliable? | Backfillable? | 1 lead → N appts? | 1 patient → N leads? | Duplicate handling | Classification |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Incoming lead** | `AppointmentRequest` or `ContactRequest` row created | `AppointmentRequest.createdAt` / `ContactRequest.createdAt` | Yes | Not audited (no history table) but row itself is immutable-by-convention (no update-in-place of the creation fact) | Yes (`clinicId`) | Yes, from migration `20260610110000` onward for full source metadata; earlier rows less complete | Not further backfillable pre-migration | Yes — one `AppointmentRequest` converts to at most one `Appointment` (`convertedAppointmentId`), but a lead can also submit multiple separate requests over time | Yes, no cross-request identity link exists (§8) — same phone number across two requests is not automatically merged | Dedup only within `ContactRequest` (open-request upsert by `clinicId+channel+externalSenderId`, §2.2); **no dedup at all for `AppointmentRequest`** — a repeat caller creates a new row every time | **Reliably measurable** |
| **Contacted** | — | — | — | — | — | — | No | — | — | — | **Not measurable.** No field or status anywhere records "staff contacted this lead." A `ContactRequest` being `resolved` reflects an inbound-message handoff being closed out, not evidence staff proactively reached the lead. **Do not infer "contacted" from message existence** — a stored WhatsApp/Instagram message only proves a message exists, not that a staff member engaged; this is exactly the inference the task brief prohibits. |
| **Appointment created** | `AppointmentRequest.status = 'converted'` + `convertedAppointmentId` set, **or** a directly staff-created `Appointment` with no request at all | `AppointmentRequest.convertedAppointmentId`, `Appointment.id` | Yes (`Appointment.createdAt`) | `Appointment` status changes are structurally audited (§2.4); the request→appointment link itself is not separately versioned | Yes | Yes | N/A going forward | A converted request maps to exactly one appointment via `convertedAppointmentId`, but **a staff-created appointment for an existing patient has no lead behind it at all** (§2.4) — these two populations must be reported separately, never merged into one "conversion rate" | N/A | N/A | **Reliably measurable for the request→appointment path; the direct-staff-booking path is by definition outside the funnel (no lead exists to convert)** |
| **Appointment attended** | `Appointment.status = 'completed'` | `Appointment.status` | No dedicated timestamp beyond `updatedAt` (which is a shared audit column, not stage-specific) | Yes, structurally audited (§2.4) | Yes | **No** — no auto-completion job exists; a large, unknown fraction of past appointments were never explicitly marked either way | No — cannot fabricate historical attendance for appointments left in `scheduled`/`confirmed` | N/A | N/A | N/A | **Partially inferable, with an important caveat: only appointments explicitly marked `completed` count as attended. `scheduled`/`confirmed` (i.e., "not yet updated") must be reported as `unknown`, never as `no_show` or as `attended`.** Explicitly do NOT infer attendance from absence of `no_show`, per the task brief and confirmed by the code (§2.4). |
| **Treatment proposed** | `TreatmentCase.stage = 'quote_sent'` (current value only) | `TreatmentCase.stage` | No — no transition timestamp exists (§2.5) | **Not audited** — no structured history | Yes | Only the *current* stage is known; historical "was this ever quote_sent" for a case now further along is unrecoverable without an event log | No | A treatment case can, in principle, be preceded by multiple prior appointments; the model doesn't restrict cardinality | A patient can have multiple `TreatmentCase` rows over time | No explicit dedup — a duplicate case could be created by mistake with no system prevention | **Partially inferable (current-state only) — cannot reconstruct historical funnel dates.** Do NOT infer "proposed" purely from a `TreatmentCase` existing (a case can be auto-created already `completed` via the appointment side-effect, §2.4, and never pass through `quote_sent` at all) — this is exactly the false inference the task brief warns against. |
| **Treatment accepted** | `TreatmentCase.stage = 'accepted'` (current value only) | `TreatmentCase.stage` | Same as above | Same as above | Yes | Same as above | No | Same as above | Same as above | Same as above | **Partially inferable (current-state only), with the same auto-generated-case conflation risk as "proposed."** A canonical acceptance *event* does not exist — only a canonical acceptance *state*, which is a materially weaker guarantee for any time-series funnel-conversion-rate metric. |

**Summary:** two of six stages are reliably measurable today (incoming lead, appointment created via the
request path); one is not measurable at all (contacted); three are partially inferable with specific,
material caveats that must be surfaced in any UI built on top of them (attended, proposed, accepted). No
stage in this funnel should be presented to an end user without the caveat column above attached, at least
in a tooltip/footnote.

---

## 6. Recommended acquisition-channel model

A managed `AcquisitionChannel` entity is **required** — the current four-vocabulary free-text fragmentation
(§2.17) cannot support reliable channel share, CAC, or ROI, because there is no single place that defines
"what counts as a channel" independent of whichever form happened to write the value.

```
AcquisitionChannel
  id              String   @id
  organizationId  String              // owning org; channels are org-level, shared across branches unless scoped
  clinicId        String?             // optional: null = organization-wide channel, set = branch-specific channel
  name            String              // display name, e.g. "Instagram Ads"
  code            String              // stable machine key, e.g. "instagram_ads" — used by normalization mapping (§9)
  channelType     String              // e.g. organic | paid | referral | walk_in | partner | unknown
  isActive        Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([organizationId, code])
```

- **Overlapping periods:** handled entirely by `AcquisitionChannelCostPeriod` (§7), not by this table —
  `AcquisitionChannel` itself has no cost or date-range concept, keeping the channel identity model simple
  and cost history append-only.
- **Organization-level costs allocated to branches:** supported via the `clinicId: null` (org-wide) vs.
  `clinicId: set` (branch-specific) distinction on the channel itself, plus the allocation-strategy product
  decision in §4.5/§14 for how an org-wide channel's cost is split across branches in a per-branch report.
- **Immutable historical reporting:** because cost lives in a separate, period-scoped, append-only table
  (§7), changing a channel's `name` or `isActive` flag never rewrites a previously-generated report's
  numbers — only `code`-based joins matter for historical correctness, and `code` is intended to be stable
  (renaming the *display* `name` is safe; changing `code` after data has been written against it is not, and
  should be blocked at the application layer).
- **Channel deactivation:** `isActive = false` stops the channel from appearing in "create new cost period"
  UI pickers but does not hide it from historical reports — deactivation is a going-forward UI convenience,
  not a data-deletion or archival operation.
- **Old free-text source mapping:** handled by the normalization layer (§9), not by this table directly —
  `AcquisitionChannel.code` is the target of the mapping, `Patient.source`/`AppointmentRequest.source` remain
  the raw, preserved-for-audit source of truth.
- **Default "unknown" treatment:** every organization should be seeded with a system-managed `unknown`
  channel (`code = 'unknown'`, `channelType = 'unknown'`, `isActive = true`, not deletable) as the fallback
  target for any raw source value that cannot be confidently mapped — this is what §4.2's channel-share
  definition requires to avoid silently dropping unknown-source patients from reporting.
- **Duplicate channels:** prevented by `@@unique([organizationId, code])`; duplicate *display names* are not
  prevented (two channels can both be called "Instagram" with different `code`s if a clinic genuinely runs
  two distinct Instagram campaigns) — this is intentional flexibility, not a gap.

---

## 7. Recommended cost-period model

```
AcquisitionChannelCostPeriod
  id              String   @id
  channelId       String              // FK -> AcquisitionChannel
  clinicId        String?             // allocation scope: null = organization-wide spend, set = branch-specific spend
  currency        String              // one of the existing validCurrencies set (§2.9), or org's reporting currency
  amount          Float               // cost incurred in this period
  effectiveFrom   DateTime
  effectiveTo     DateTime            // half-open [effectiveFrom, effectiveTo) — no implicit "current" row
  notes           String?             // tax treatment, campaign name, correction rationale, etc.
  createdById     String
  createdAt       DateTime @default(now())

  @@index([channelId, effectiveFrom, effectiveTo])
```

- **Overlapping periods:** the application layer should warn (not necessarily hard-block, since a genuine
  correction may intentionally overlap) when a new row's `[effectiveFrom, effectiveTo)` overlaps an existing
  row for the same `channelId`+`clinicId` — CAC/ROI computation over an overlapping range must sum all
  overlapping rows rather than picking one arbitrarily, and the report should surface "overlapping cost data"
  as a data-quality flag (§12 Phase G) rather than silently picking a winner.
- **Organization-level costs allocated to branches:** an org-wide row (`clinicId: null`) is allocated at
  report-time per the strategy decided in §4.5/§14 (recommended default: proportional to branch new-patient
  count for that channel/period) — the allocation is a *reporting-time computation*, not a schema-time
  fan-out into N branch-specific rows, so the allocation strategy can be changed later without rewriting
  historical cost data.
- **Immutable historical reporting:** rows are **append-only by convention** — a correction is a new row
  with a `notes` explanation, not an in-place update, so that a report generated last month and a report
  generated today over the same historical period return the same number unless a deliberate correction was
  added (in which case the change itself is visible in the `notes` trail). This directly satisfies the task
  brief's instruction not to assume one mutable `costPerMonth` field is historically correct — a mutable
  field would let someone editing "this month's spend" silently rewrite every historical CAC/ROI number ever
  computed against it.
- **Currency:** per-row, matching `validCurrencies`; multi-currency channels require either separate rows per
  currency (no cross-currency summing) or an FX decision (§14).
- **Channel deactivation:** cost-period rows for a deactivated channel remain valid and queryable; only
  *new* rows against an inactive channel should be blocked (or require explicit confirmation) at the
  application layer.

---

## 8. Lead/funnel identity recommendation

**Question:** does the system need a durable identity linking `ContactRequest → AppointmentRequest → Patient
→ Appointment → TreatmentCase → Payment`?

**Finding: current data cannot provide durable lineage today**, for concrete, code-verified reasons:

- `Patient.source` is never backfilled when a later `AppointmentRequest`/`ContactRequest` on the same person
  arrives through a different channel (§2.1, §2.3) — so even where a link *could* be traced (same phone
  number), the attribution value itself would be stale/wrong if inferred naively.
- `Patient.phone`/`email` have **no uniqueness constraint** (§2.16) — "same phone number" is not a safe
  dedup key without an explicit identity-resolution step, because duplicate `Patient` rows for the same
  real person are already possible today.
- `AppointmentRequest` has **no dedup at all** (§5, stage "incoming lead") — a repeat caller on the same
  phone number creates a new, unlinked row every time.
- `ContactRequest` dedup only applies to *open* requests on the same channel+external-sender-id
  (`upsertContactRequest`, §2.2) — once resolved, a new inbound message starts a fresh, unlinked row.

Given this, a **new, append-only funnel-event log plus a lightweight identity key is recommended**, rather
than relying on ad hoc joins across the five existing models:

```
FunnelEvent
  id              String   @id
  organizationId  String
  clinicId        String
  leadKey         String              // normalized E.164 phone (+ optional normalized email) within the org — NOT a hard FK
  eventType       String              // lead_received | contacted | appointment_created | appointment_attended | treatment_proposed | treatment_accepted
  occurredAt      DateTime            // event time, distinct from row-insert time
  sourceModel     String              // 'AppointmentRequest' | 'ContactRequest' | 'Appointment' | 'TreatmentCase' | ...
  sourceId        String              // id of the row that produced this event
  channelId       String?             // FK -> AcquisitionChannel, resolved at write time via the normalization layer (§9)
  metadata        Json?               // free-form, e.g. raw source string preserved for audit
  createdAt       DateTime @default(now())

  @@index([organizationId, leadKey, occurredAt])
  @@index([clinicId, eventType, occurredAt])
```

- **`leadKey` is a soft, normalized-phone-based grouping key, not a foreign key to a new heavyweight `Lead`
  aggregate.** This avoids introducing a new authoritative identity model (which the task brief says to avoid
  unless current data genuinely cannot provide lineage — here it explicitly cannot, but the *minimal* fix is
  an event log with a soft grouping key, not a full CRM "Lead" object that would duplicate `Patient`/
  `AppointmentRequest` responsibilities).
- **One lead → one patient:** the common case; `leadKey` groups events until a `Patient` is created, at which
  point subsequent events reference `sourceModel: 'Patient'`/downstream models directly.
- **One lead → multiple requests:** naturally supported — multiple `FunnelEvent` rows share the same
  `leadKey`.
- **Duplicate phone / shared family phone:** a known, accepted limitation — a shared household phone number
  will group multiple real people's leads under one `leadKey`. This is a data-quality caveat to surface on
  any funnel dashboard, not a solvable problem without a stronger identity signal (e.g. requiring email, which
  isn't always collected). Flag as a product decision (§14) whether to attempt secondary disambiguation
  (name + phone) — recommend not attempting this initially, since false-splitting is arguably worse than
  false-merging for funnel *counts* (it would undercount, not overcount, conversions).
- **Patient created before/after lead:** both orders are handled — `FunnelEvent.eventType = 'lead_received'`
  is written at `AppointmentRequest`/`ContactRequest` creation regardless of whether a `patientId` is already
  set on that row; `appointment_created` through `treatment_accepted` events are written as those downstream
  models change, each carrying its own `occurredAt` and resolved `channelId`.
- **Channel source preservation:** `channelId` is resolved once, at event-write time, via the normalization
  layer (§9) and stored on the event — so later remapping the normalization rules doesn't retroactively
  change what a historical event was attributed to (append-only correctness, same principle as §7).
- **Idempotency:** each event write should be keyed by `(sourceModel, sourceId, eventType)` to prevent
  duplicate events if a route handler retries — recommend a unique constraint on that triple in the actual
  migration (deferred to implementation, §13 slice D).
- **Cross-clinic safety:** `clinicId` is required on every event and must be validated through the existing
  `clinicScope.ts` pattern (§10) at both write and read time — a `leadKey` must never be allowed to group
  events across two different clinics' patients into one funnel row in a way that leaks cross-tenant data;
  since `leadKey` is scoped by `organizationId` in the index above, cross-*organization* leakage is
  structurally prevented, but cross-*clinic within the same org* grouping is a deliberate choice (a patient
  visiting two branches under one org is a legitimate single funnel) that must be confirmed as a product
  decision (§14) before implementation, not assumed.

This is explicitly a **new, minimal, additive model** (Phase B, §12) — not a retrofit of existing tables —
because retrofitting `AppointmentRequest`/`ContactRequest`/`Patient` to reference each other directly would
require backfilling relationships current data cannot truthfully support (per the bullet list above).

---

## 9. Source-normalization strategy

Given the four-vocabulary fragmentation in §2.17, raw values must be **preserved for audit** while reports
run against a normalized channel. Recommended shape (fields to add alongside — not replacing — the existing
`Patient.source` / `AppointmentRequest.source` / `ContactRequest.channel` columns, or captured on
`FunnelEvent.metadata`, depending on implementation-phase scoping in §13):

```
rawSource            String    // the exact, unmodified value as originally written (e.g. "widget", "meta_whatsapp", "google")
normalizedChannelId  String?   // FK -> AcquisitionChannel.id, resolved via a mapping table/config
sourceProvider       String?   // e.g. "evolution_api" | "meta_cloud_api" | "instagram" | null for manual/import
sourceCampaign        String?   // reserved for future campaign-level tracking (§14) — NOT populated retroactively
sourceMetadata        Json?     // existing provenance fields (externalSenderId, sourceConnectionId, etc.) carried through
```

- **Mapping mechanism:** an admin-configurable mapping table (`code` lookups keyed by `rawSource` string,
  scoped per organization since different clinics may want the same raw value mapped differently — e.g. one
  clinic's `'phone'` might mean "inbound call" while another's is a walk-in follow-up call) resolves
  `rawSource → normalizedChannelId` at read/report time for historical data, and at write time going forward
  once instrumentation lands (§12 Phase C). Values with no configured mapping resolve to the seeded
  `unknown` channel (§6), never to a guessed channel.
- **Preserve raw values for audit:** `rawSource` is never overwritten or deleted — it remains the ground
  truth for "what did the system actually record," independent of how mapping rules evolve over time. This
  also protects against the exact conflation risk noted in §2.1 (unvalidated values like `'widget'` landing
  in `Patient.source`) by making the raw value an explicit, first-class, always-visible field rather than
  something silently coerced into a fixed enum on write.
- **Do not retroactively fabricate campaign data.** `sourceCampaign` stays `null` for all historical data and
  for any current writer that doesn't yet capture a real campaign identifier — it is reserved for a future
  paid-ads integration (§14), not backfilled with guesses about which campaign a historical patient might
  have come from.
- **Reconciliation surface:** an admin-facing "unmapped sources" view (§12 Phase G) lists distinct
  `rawSource` values with no `normalizedChannelId` mapping yet, so staff can progressively map legacy/odd
  values (e.g. `'online'` from the Excel importer, §2.17) to real channels over time, without ever silently
  auto-mapping on their behalf.

---

## 10. Tenant and authorization boundaries

The codebase already has a mature, tested, reusable tenant-scoping pattern that any new attribution/CAC/ROI
endpoint **must** reuse rather than reinvent: `server/src/utils/clinicScope.ts`.

- **Two helper families** exist because some models carry `organizationId` directly (e.g. `Patient`) and
  others are clinic-scoped only, with organization derived transitively via `Clinic` (e.g. `Appointment`,
  `Payment`, `TreatmentCase`, and the proposed `FunnelEvent`/cost-period models):
  `buildClinicScopeWhere`/`validateAndGetScope` (org-aware models) and
  `buildClinicIdScope`/`validateAndGetClinicIdScope` (clinic-only models, `clinicScope.ts:171-222`).
- **Frontend-selected clinic IDs are explicitly untrusted input**, and the code already treats them that way:
  every report route calls `validateAndGetClinicIdScope(req.user!, selectedClinicId, res)`, which re-validates
  any client-supplied `clinicId` against (a) the clinic actually belonging to the caller's `organizationId`,
  and (b) the caller's own `allowedClinicIds`/`canAccessAllClinics` — a request for a `clinicId` the caller
  doesn't own returns `403` **and** is fed into a cross-tenant-denial security-signal detector
  (`clinicScope.ts:23-41`) rather than merely being silently rejected. A prior defect in this exact area (an
  org-wide `'all'` request silently narrowing to just the requester's own clinic) is documented as fixed and
  regression-tested (`server/src/tests/reportsClinicScope.test.ts`).
- **Role behavior for reporting access** (`User.role`, `schema.prisma:110-183`, and `UserClinic` per-branch
  overrides): the existing reports (`GET /reports/revenue`, etc.) are role-gated to
  `OWNER/ORG_ADMIN/CLINIC_MANAGER/BILLING` (confirmed via the `authorize([...])` guard on
  `reports.ts` routes). Any new CAC/ROI/funnel endpoint should use the same role set as a starting default,
  pending a product decision (§14) on whether `DENTIST`/`RECEPTIONIST` should see channel-level financial
  data at all (arguably not, given commission-sensitivity and marketing-spend confidentiality).
- **Single-clinic users:** scope resolves to exactly their assigned clinic(s) via `allowedClinicIds`.
- **Clinic managers:** scoped to their assigned clinic(s) via `UserClinic`.
- **Organization admins / owners with `canAccessAllClinics`:** scope resolves to every clinic under their
  `organizationId`, computed server-side from the DB (`clinicScope.ts:190-193`) — never trusted from a
  client-supplied clinic list.
- **Users without reporting access:** the `authorize([...])` middleware pattern already used by
  `reports.ts`/`financeDashboard.ts`/`organizationDashboard.ts` should gate any new attribution endpoint the
  same way — a role not in the allowed list gets `403` before any query runs.
- **Platform administrators:** none of the existing report routes reference a platform-superadmin role
  distinct from `OWNER`/`ORG_ADMIN` — if one is later introduced for cross-organization operational tooling,
  it is explicitly out of scope for tenant-facing CAC/ROI reporting and should never be able to query across
  organizations through the same endpoints patients/clinics use.
- **Cross-clinic patient/payment joins:** must always route through the `clinicId`/`organizationId` scope
  object returned by the helper functions, spread into every Prisma `where` clause — including raw SQL via
  the existing `clinicScopeSql()` helper (`reports.ts:16-24`) for any `$queryRaw` used in period-bucketed
  time-series queries (the existing revenue-by-period report already uses raw SQL `DATE_TRUNC`, so a new
  CAC/ROI time-series endpoint will likely need the same pattern).
- **Preventing leakage through totals or chart labels:** an org-wide "channel share" chart must not display a
  channel that only exists at one branch as if it were organization-wide without a branch breakdown
  available on drill-down for authorized users only — and a clinic-scoped user must never see an
  organization-wide total that implicitly reveals another branch's volume (e.g. "your branch is 12% of a
  total you can't otherwise see" already leaks the existence and rough size of clinics outside your scope).
  Any percentage/share metric shown to a clinic-scoped user must be computed **within their own scope only**,
  never against an organization-wide denominator they can't otherwise query.

**All aggregation for the new attribution/CAC/ROI/funnel module must be server-side, using this exact
established pattern — no exceptions, and no new ad hoc scope-resolution logic** (the codebase already shows
one instance of duplicated scope logic — `financeDashboard.ts`'s local `resolveClinicScope` reimplements
rather than reuses the shared helper — which should be treated as an anti-pattern to avoid repeating, not a
precedent to follow).

---

## 11. Privacy, KVKK and GDPR assessment

**This section flags decisions for Mustafa/legal review. It is not final legal advice.**

1. **Is channel attribution operational analytics or marketing profiling?** Counting new patients per channel
   and computing CAC/ROI is, on its face, operational business analytics (measuring the effectiveness of the
   clinic's own acquisition spend), not profiling of individual patients for third-party marketing purposes.
   However, once campaign-level tracking (`sourceCampaign`, §9, §14) is introduced, per-campaign
   patient-level conversion tracking edges closer to marketing profiling territory and may trigger additional
   KVKK/GDPR obligations (e.g. a documented legitimate-interest or consent basis distinct from the clinical
   treatment relationship). **Flagged for legal review before Phase C campaign-level fields are populated.**
2. **Does campaign-level profiling raise additional obligations?** Likely yes if/when implemented — flagged,
   not resolved, here. This document does not recommend building campaign-level tracking in the near term
   (§14) specifically because of this open question.
3. **Is raw message text necessary for attribution reporting? No.** `WhatsAppConversationMessage.text` /
   `InstagramConversationMessage.text` should never be read by the attribution/CAC/ROI/funnel module —
   structured `source`/`channel` metadata (already captured, §2.10/§2.11) is sufficient. **Do not propose
   using message content when structured source metadata is sufficient** — consistent with the task's
   explicit instruction, and there is no code path in the current reports module that reads message text, a
   pattern that should be preserved.
4. **Is phone/email needed in reports?** Aggregate channel/funnel reports (counts, revenue sums, CAC, ROI)
   need none. Only individual-patient drill-down views (already gated by existing patient-record permissions)
   would show phone/email, and that's an existing, unrelated authorization surface, not something this
   feature should introduce a new path to.
5. **Data minimization:** the recommended `FunnelEvent` model (§8) stores a normalized `leadKey` (phone-
   derived) rather than raw PII fields — this is a deliberate minimization choice, but a normalized phone
   number is still personal data under GDPR/KVKK and must be covered by the same retention/deletion policy as
   the rest of the patient data (see point 9 below), not treated as anonymous.
6. **Referral privacy:** covered in detail at §4.8/§14 — the core tension is precision (a real
   `referredByPatientId` FK) vs. minimization (no stored link at all, only an aggregate count). Flagged for
   product/legal joint decision.
7. **Anonymized patients in aggregate metrics:** `Patient.isAnonymized` already exists (§2.1). Recommendation:
   include anonymized patients in aggregate sums/counts (the business fact "a patient was acquired and paid
   X" doesn't depend on retaining their identity), but exclude them from any drill-down list or export that
   would re-expose identity — this needs explicit confirmation from legal that aggregate-only inclusion of
   anonymized records doesn't itself constitute a form of re-identification risk, given small-cell sizes
   (e.g. "1 anonymized patient in the 'Instagram' channel this month, revenue $X" can be de-anonymizing in a
   small clinic). **Flag small-cell suppression as a required design element**, deferred to implementation
   (§12 Phase F) pending this legal confirmation.
8. **Export behavior:** any CSV/export capability added to a new CAC/ROI report (mirroring the existing
   `reports.ts:207-270` revenue export) must go through the same authorization gate as the underlying report
   — the existing pattern already does this correctly and should be replicated, not reinvented.
9. **Deletion/anonymization behavior:** `Patient.deletedAt`/anonymization fields already exist; the new
   `FunnelEvent`/cost-period/channel models must be included in whatever retention-cleanup jobs already exist
   for patient-linked data (`server/src/jobs/` already has retention and privacy-export cleanup jobs per the
   research above) — this is a concrete implementation requirement for Phase C/E (§12), not merely a
   suggestion.
10. **Retention periods:** not determined by this review — existing retention job configuration should be
    consulted and extended to cover new models; final period is a legal/product decision (§14).
11. **Audit logging:** the recommended append-only `FunnelEvent`/`AcquisitionChannelCostPeriod` designs are
    inherently audit-friendly (no in-place mutation of historical facts) — this satisfies general
    auditability expectations but does not by itself satisfy any formal audit-logging *requirement* that
    legal may separately impose (e.g. who viewed a given report) — access-to-reports logging is not currently
    proposed and would be a separate, explicit addition if required.
12. **Access controls:** covered in §10 — reuse `clinicScope.ts`, role-gate to the same roles as existing
    financial reports, pending confirmation (§14) on exact role list.
13. **Marketing-consent separation:** `Patient.marketingConsent` already exists and is structurally separate
    from `communicationConsent`/`smsOptOut` (§2.1). Any future campaign-level tracking (point 2 above) must
    be gated on `marketingConsent`, not on the mere existence of a patient record — this is a hard
    requirement if campaign-level tracking is ever built, not merely a recommendation.

---

## 12. Backward-compatible migration and instrumentation sequence

No phase below fabricates a historical timestamp, a historical cost figure, or a historical channel
attribution that isn't truthfully derivable from data that already exists. Where data doesn't exist, the
report says "not available," never a guess.

### Phase A — Canonical definitions
Ratify the metric definitions in §4, the source taxonomy in §9, and the funnel-event definitions in §8 as
the team's shared reference (this document is the Phase A deliverable). No code changes.

### Phase B — Additive data model
Add, without touching any existing table: `AcquisitionChannel` (§6), `AcquisitionChannelCostPeriod` (§7),
normalized source-reference fields (§9), and the optional `FunnelEvent` model (§8). All additive — no
existing column is renamed, retyped, or dropped. Seed the `unknown` fallback channel per organization.

### Phase C — New-write instrumentation
Going forward only, instrument: patient creation (all paths — manual, import, WhatsApp, Instagram,
request-conversion) to resolve and store `normalizedChannelId` alongside the existing raw `source`;
contact/appointment requests to do the same; appointment attendance to emit a `FunnelEvent` on explicit
`completed`/`no_show` transitions (not on a fabricated auto-completion); treatment proposal/acceptance to
emit `FunnelEvent`s on explicit `stage` transitions to `quote_sent`/`accepted` **and**, ideally, to finally
close the `closedAt` gap identified in §2.5 by having the `PUT /api/treatment-cases/:id` route set `closedAt`
whenever `stage` transitions to `completed`/`lost` (this is a small, targeted fix to an existing bug, not new
scope, and should be called out explicitly to whoever picks up implementation — it independently improves the
two existing reports that already filter on `closedAt`).

### Phase D — Historical mapping
Map only truthful free-text values through the source-normalization layer (§9) — a distinct-values sweep of
existing `Patient.source`/`AppointmentRequest.source`/`ContactRequest.channel` values, mapped by an admin to
real `AcquisitionChannel`s where the mapping is unambiguous (e.g. `'whatsapp'` → the WhatsApp channel),
left as `unknown` where it is not. **No `contacted`/`attended`/`accepted` timestamps are fabricated** for
historical rows that never recorded them — historical funnel-stage reporting is limited to whatever the
existing partial data (§5) actually supports, clearly labeled as such.

### Phase E — Scoped backend aggregation
Build the new CAC/ROI/funnel/channel-share endpoints using the existing `clinicScope.ts` pattern (§10)
exclusively. Implement the zero/missing-cost guards (§4.5, §4.6) and consistent single-currency-only
aggregation (§4.3, §4.5) as hard requirements, not follow-up polish.

### Phase F — Frontend reports
New filters (channel, period, clinic/org scope per existing patterns), tables/charts (dataviz skill should be
consulted at implementation time for chart design), explicit missing-data states (never a zero bar for "not
available," per §4.4/§4.5/§4.6), negative-ROI rendering as a real negative percentage, and drill-down
authorization enforced server-side (§10) — never assume a hidden UI tab is a security boundary.

### Phase G — Verification and governance
A source-quality dashboard (§9, "unmapped sources" view) and an admin channel-mapping control surface;
reconciliation reports comparing, e.g., channel-share totals against total new-patient counts to catch
drift; auditability review confirming the append-only conventions in §7/§8 are actually being honored in
production (no in-place edits to historical cost or event rows).

**Deployment order:** strictly A → B → C → D → E → F → G. Each phase's endpoints/UI must only be exposed
once its data dependencies from prior phases exist — e.g. Phase F's CAC chart must not ship before Phase B's
cost-period model and Phase E's aggregation endpoint exist, or it will render against nonexistent data.

**Rollback limitations:** Phases A–D are purely additive and safely revertible (drop the new tables/columns,
no existing data touched). Phase C's small `closedAt`-on-completion fix to the existing `PUT
/api/treatment-cases/:id` route is the **one phase that touches existing write behavior** — its rollback is
also safe (the field simply reverts to being unset, matching current behavior), but it should be flagged to
reviewers as the one line item in this entire sequence that isn't a pure schema/report addition.

---

## 13. Implementation slices

| Slice | Scope | Expected modules | Depends on | Migration | Authz implications | Privacy implications | Tests | Risk | Parallelizable? | Merge order | Prod verification |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **A. Acquisition channel master** | `AcquisitionChannel` model + CRUD admin endpoint | `server/prisma/schema.prisma`, new `server/src/routes/acquisitionChannels.ts` | Phase A definitions ratified | Additive migration | Admin-only write (`OWNER/ORG_ADMIN`) | None beyond standard tenant scoping | Unit + route tests for CRUD + uniqueness constraint | Low | Yes, first | 1st | Confirm seeded `unknown` channel exists per org after deploy |
| **B. Historical channel cost periods** | `AcquisitionChannelCostPeriod` model + CRUD | Same route file or sibling; depends on A's `channelId` FK | A | Additive migration | Admin-only write, same roles as finance reports | Cost figures are business-confidential — same access tier as revenue reports | Unit tests for overlap-warning logic, currency validation | Low–Medium (overlap-handling logic) | After A | 2nd | Spot-check a manually entered cost period round-trips correctly |
| **C. Patient and request source normalization** | `rawSource`/`normalizedChannelId`/mapping table (§9) | `server/src/services/sourceNormalization.ts` (new), touches `patients.ts`, `patientsImport.ts`, `appointmentRequests.ts`, all WhatsApp/Instagram writers | A | Additive columns | None new | Preserves raw values for audit (§9) — no new PII exposure | Unit tests per writer confirming raw value preserved + mapping resolution correctness | Medium (many call sites, §2.17's fragmentation makes this the most sprawling slice) | Can start once A exists; independent of B | 3rd, can overlap with D | Verify a sample of each writer's real production traffic maps correctly, not just tests |
| **D. Lead/funnel identity and event semantics** | `FunnelEvent` model + `leadKey` derivation logic | `server/prisma/schema.prisma`, new `server/src/services/funnelEvents.ts` | A (for `channelId` FK) | Additive migration | Standard tenant scoping (§10), plus the cross-clinic `leadKey` grouping decision (§8, §14) | Normalized phone is still PII — retention policy must cover this table (§11.9) | Unit tests for idempotency key, leadKey normalization edge cases (missing phone, malformed number) | Medium–High (new identity concept, cross-clinic grouping decision must land before this ships) | No — needs the §14 product decision on cross-clinic leadKey grouping first | 4th | Confirm no duplicate events for the same `(sourceModel, sourceId, eventType)` in production after a burst of retries |
| **E. New-write instrumentation** | Wire C's normalization + D's event emission into every creation path (§2.3's full table, plus appointment/treatmentCase transitions) | Every route/service file listed in §2.3/§2.4/§2.5's creation-path inventories | C, D | No new migration (uses C/D's models) | None new | None new beyond C/D | Integration tests per writer confirming an event is actually emitted, not just that a mapping function exists | High (this is the slice most likely to introduce a regression in existing hot-path routes — WhatsApp/Instagram webhook handlers are latency-sensitive) | No — sequenced after C and D | 5th | Watch webhook processing latency/error rate for the first 24–48h post-deploy per channel |
| **F. Historical mapping/admin tooling** | Distinct-values sweep UI + bulk-mapping admin action (§9, Phase D) | New admin page under `src/pages/`, new backend endpoint | C | No schema change (data-only operation) | Admin-only | Must not fabricate timestamps (§12 Phase D) — enforce in code review, not just docs | Tests confirming bulk-map only touches `normalizedChannelId`, never rawSource or timestamps | Low–Medium | Yes, parallel to G | 6th, can overlap with G | Confirm mapped/unmapped counts sum correctly post-run |
| **G. Server-side attribution aggregation** | New `GET /reports/attribution/*` endpoints implementing §4's formulas | New `server/src/routes/attribution.ts` reusing `clinicScope.ts` | A, B, C (D optional for revenue/CAC/ROI; required for funnel) | No schema change | Same role gate as `reports.ts` (§10), pending §14 confirmation | Small-cell suppression for anonymized patients (§11.7) must land here | Unit tests per formula (zero-denominator, missing-cost, currency-mismatch guards from §4) | Medium | No — needs A, B, C at minimum | 7th | Reconcile a known-good manually computed example against the endpoint's output before wider rollout |
| **H. Funnel aggregation** | `GET /reports/funnel/*` implementing §5's stage classifications | Same route file as G, or sibling | D, E | No schema change | Same as G | Same as G | Unit tests confirming "contacted" never appears as measurable, "attended" never inferred from absent no-show | Medium–High (highest risk of accidentally implementing a prohibited inference, §5) | No — needs D and E | 8th | Manual review of funnel numbers against a small sample of real leads before trusting the dashboard |
| **I. Reports frontend** | New "Attribution / CAC / ROI" tab(s) in `Reports.tsx` or a new page | `src/pages/`, `src/components/`, `src/services/api.ts` (`reportService` additions) | G, H | None | Drill-down authorization enforced server-side (§10), not just hidden in UI | Missing-data states must not silently show `0` (§4.4–§4.6) | Manual browser verification per this repo's UI-change testing standard, plus component tests | Medium | No — needs G/H | 9th | Load the tab against real org data in a staging-equivalent environment; verify negative ROI renders correctly |
| **J. Referral analytics** | Depends entirely on the §4.8/§14 product decision (general count vs. `referredByPatientId`) | TBD pending decision | Product decision (§14) | TBD | TBD | High — see §4.8, §11.6 | TBD | High (blocked on decision, and privacy-sensitive once unblocked) | No — explicitly blocked | Last, after decision lands | TBD |
| **K. Data-quality and reconciliation reporting** | Phase G's admin surfaces (§12) — unmapped-source dashboard, overlap warnings, reconciliation checks | New admin page + lightweight scheduled check (or on-demand endpoint) | F, G | None | Admin-only | None new | Tests confirming reconciliation math itself is correct | Low | Yes, parallel to I | 10th, can overlap with I | Run reconciliation against a full month of real data before declaring the module "trustworthy" |

**Slices that must not be combined:** C (normalization) and E (instrumentation) touch a large, sensitive
surface area (every patient/lead creation path, including latency-sensitive webhook handlers) — combining
them with D (new identity model) in one PR would make a regression in any of the three far harder to bisect.
Similarly, G (aggregation) and H (funnel) should ship as separate PRs even though they may share a route
file, because H carries materially higher inference risk (§5) and deserves its own focused review pass.
J (referral) must never be bundled with any other slice, since it is explicitly gated on an unresolved
product/privacy decision (§14) and could otherwise become a forcing function to make that decision under
implementation-deadline pressure rather than deliberately.

---

## 14. Product/legal decisions requiring Mustafa

1. **Canonical acquisition date** — this document recommends `Patient.createdAt` (§4.1); confirm, or choose
   an alternative (first appointment, first payment, first accepted treatment) with the tradeoffs in §4.1
   explicitly accepted.
2. **Canonical revenue definition** — this document recommends cohort-collected revenue as the primary
   attribution metric, with period-collected retained separately as existing cash-flow reporting (§4.3);
   confirm both should ship, and confirm they must always be visually distinguished in any UI.
3. **Whether CAC costs are clinic- or organization-scoped by default** — the model (§7) supports both; the
   *default* UI/entry assumption (does a new clinic manager naturally think in "my branch's marketing spend"
   or is spend always entered at the org level) needs a product answer.
4. **Branch allocation strategy for organization-level campaigns** — this document recommends
   proportional-to-new-patient-count as a safe default (§4.5); confirm, or specify an alternative (e.g. equal
   split, headcount-weighted).
5. **Supported currencies for cost/revenue matching** — confirm whether multi-currency organizations are a
   real near-term case, and if so whether per-currency-only reporting (no cross-currency summing, this
   document's recommended default) is acceptable or whether FX-conversion infrastructure needs to be
   commissioned as a prerequisite.
6. **Meaning of treatment acceptance** — confirm `TreatmentCase.stage = 'accepted'` is the correct canonical
   acceptance signal (§4.1, §5), and confirm whether the auto-generated single-visit `TreatmentCase` path
   (§2.4) should be excluded from acceptance-rate funnel metrics or reported as its own separate category.
7. **Whether a durable `FunnelEvent`/`leadKey` model is desired** — this document recommends building it
   (§8) because current data structurally cannot provide durable lineage; confirm the scope is acceptable
   (a soft phone-based grouping key, not a full `Lead` aggregate), and specifically confirm whether
   cross-clinic (same organization, different branch) `leadKey` grouping is desired or should be
   clinic-isolated instead.
8. **Whether patient-to-patient referral identity is shown** — confirm whether a `referredByPatientId` field
   is wanted at all (§4.8, §11.6), and if so, resolve the circular/self-reference/cross-clinic/anonymization
   questions listed there before any schema work begins.
9. **Retention period** for the new funnel-event and cost-period data — no default is proposed here; existing
   retention-job configuration should inform this, but the final period is a legal/product call (§11.10).
10. **Treatment of anonymized patients in aggregates** — this document recommends aggregate-inclusion with
    small-cell suppression (§11.7); confirm, especially the small-cell-suppression threshold, which is not
    specified here and needs a concrete number (e.g. suppress any cell with fewer than N patients).
11. **Campaign-level tracking scope** — this document recommends **not** building campaign-level
    (`sourceCampaign`) tracking in the near term, pending the KVKK/GDPR question raised in §11.2; confirm this
    is acceptable, or commission the legal review needed to proceed sooner.
12. **Marketing-consent implications** — confirm that any future campaign-level tracking will be hard-gated
    on `Patient.marketingConsent` (§11.13), and confirm whether the *existing* `/reports/patient-sources`
    channel-share report (which does not check `marketingConsent` today, since it's non-marketing operational
    analytics) needs any consent gate at all, or whether operational-analytics framing is legally sufficient
    as-is.
13. **Reporting role list for the new module** — this document recommends starting from the existing
    `OWNER/ORG_ADMIN/CLINIC_MANAGER/BILLING` set used by `reports.ts` (§10); confirm whether `DENTIST`
    (who can already see a pipeline-by-stage breakdown on the existing dashboard) should also see
    channel-level CAC/ROI, which is more sensitive (marketing spend, not just clinical pipeline).

---

## 15. Risks

- **Silent under-counting is already happening today**, independent of any new feature: `closedAt`
  (§2.5) and the reports that filter on it are under-counting real sales-pipeline completions right now.
  Building new attribution features on top of this without the targeted Phase C fix (§12) would propagate
  the same gap into the new module.
- **Currency mixing:** every revenue aggregation in the current codebase, and every one proposed here, is
  currency-unsafe for multi-currency organizations unless the org-level currency decision (§14 item 5) is
  resolved before Phase E ships.
- **Fragmented source taxonomy is a moving target:** four independent vocabularies (§2.17) are actively
  written to by production code today; the normalization layer (§9) must be treated as an ongoing
  maintenance surface (new raw values will keep appearing), not a one-time migration.
- **Funnel over-claiming:** the single highest product/legal risk in this entire feature area is presenting
  the "contacted," "attended," or "proposed"/"accepted" stages as more reliable than the code actually
  supports (§5). A UI that doesn't visibly carry the caveats in §5's table risks staff making real business
  decisions (e.g. firing a "low-performing" channel) off data that was actually just "unknown" rows
  misclassified as failures.
- **`leadKey` phone-collision risk (§8):** shared family/household phone numbers will under-split distinct
  leads; this is an accepted, documented limitation, not a bug to be silently "fixed" by an over-aggressive
  disambiguation heuristic that would itself introduce false-splitting risk.
- **Webhook latency regression (§13, slice E):** instrumenting the WhatsApp/Instagram webhook handlers (which
  are latency-sensitive, real-time conversational flows) with new normalization/event-emission logic carries
  real risk of introducing latency or error-rate regressions in production messaging — this slice needs
  explicit production monitoring before/after rollout (§13's "prod verification" column), not just passing
  tests.
- **No FX/predictive-LTV infrastructure exists** — any pressure during implementation to "just approximate"
  either (e.g. a rough currency conversion, or a naive LTV projection) must be resisted per the task's
  zero-inference guardrail; both are explicitly out of scope for this phase (§4.3, §4.7).
- **Referral privacy is the single highest-risk unresolved item** (§4.8, §11.6, §14 item 8) — building
  `referredByPatientId` before the circular/anonymization/consent questions are resolved risks having to
  retrofit privacy controls onto already-collected identity-linkage data, which is a much harder position
  than deciding the scope up front.

---

## 16. Production verification strategy

For each implementation slice (§13), the "Prod verification" column above specifies a concrete,
slice-specific check. At the module level, once Phases E–H (§12) are live:

1. **Reconciliation check:** for a representative recent month, manually recompute channel share and
   attributed revenue for one channel from raw `Payment`/`Patient` data (a spreadsheet pull, not the new
   endpoint) and compare against the new endpoint's output — they must match exactly for that channel/period.
2. **Zero/missing-data state audit:** manually query for a channel/period combination with genuinely no cost
   data recorded and confirm the CAC/ROI UI renders "not available," not `0%` or `∞`.
3. **Cross-tenant isolation check:** as a clinic-scoped test user, attempt to request another clinic's
   `clinicId` on the new endpoints directly (bypassing the UI) and confirm a `403` plus a logged cross-tenant
   denial signal, consistent with the existing `clinicScope.ts` behavior (§10).
4. **Funnel-stage caveat audit:** confirm the "contacted" stage is never rendered as a measured number
   anywhere in the shipped UI (only as "not measurable" or simply absent from the funnel chart), and that
   "attended" visibly separates `completed` from `unknown` (never folding `unknown` into either "attended" or
   "no-show").
5. **Webhook regression watch (slice E):** monitor WhatsApp/Instagram webhook p95 latency and error rate for
   24–48h post-deploy of the instrumentation slice, comparing against pre-deploy baseline.
6. **Small-cell suppression spot-check (if anonymized-patient inclusion ships, §11.7):** confirm a
   single-patient channel/period cell is suppressed or aggregated per the threshold decided in §14 item 10,
   not displayed as an identifiable single-patient figure.
7. **Historical-mapping audit trail (slice F):** confirm the bulk-mapping admin action only ever writes
   `normalizedChannelId`, never touches `rawSource`, `createdAt`, or any other historical field, by diffing a
   sample of rows before/after a mapping run.

No production database write, migration, or deploy was performed as part of this review — all of the above
is a proposed verification plan for whoever implements §12–§13, not something executed here.

---

## Standard final report

### 1. Task identity

- ClickUp ID: `86eydm678`
- ClickUp URL: https://app.clickup.com/t/86eydm678
- Task name: US-07.5 · Kanal attribution, CAC / ROI ve lead dönüşüm hunisi

### 2. Frozen execution context

- Execution baseline: `3d96d650e98153d73cac2c2b308d93d40db1aadb`
- Branch: `docs/us-07-5-attribution-architecture`
- Worktree: `E:\Ek Gelir\Siteler\DisKlinikCRM-worktrees\us-07-5-attribution-architecture`
- Final head SHA: recorded after commit in §12 of the final report (see chat response)

```text
Execution baseline: 3d96d650e98153d73cac2c2b308d93d40db1aadb
Current repository status: not evaluated by this independent task
PR #268 status: intentionally not reconciled
Sibling task status: intentionally not evaluated
Final reconciliation owner: ChatGPT / Mustafa
```

### 3–15

See the corresponding numbered sections above (§3–§16 of this document map directly to the required final
report sections 3–15; §16 covers "production verification strategy," which is final-report section 15).

### Safety confirmation

- Architecture-only scope: confirmed — this document is the only intended change.
- No production code modified.
- No Prisma schema or migration created.
- No tests, package manifests, CI, or test-runtime files modified.
- No direct push to `main`.
- No merge performed.
- No deploy performed.
- No production access or real patient data used — all findings are static-code analysis of the frozen
  baseline.
- No secrets or `.env` content exposed.
- No destructive Git/database commands run.
- PR #268 was not inspected, fetched, merged, cherry-picked, rebased onto, or reconciled.

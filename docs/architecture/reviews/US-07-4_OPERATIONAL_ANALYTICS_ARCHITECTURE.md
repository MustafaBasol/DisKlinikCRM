# US-07.4 — Operational Analytics Dashboard Architecture Review

```text
ClickUp task:                86eydm64q — https://app.clickup.com/t/86eydm64q
Task type:                    ARCHITECTURE AND DATA-READINESS REVIEW ONLY
Execution baseline:           5dc5ad67c7e9feee11f6fece9a7d65e03033d2fb
Branch:                       docs/us-07-4-operational-analytics-architecture
Future implementation risk:   MEDIUM (backend metrics), HIGH (waiting-time / lifecycle metrics)
```

This document is documentation and architecture analysis only. It changes no application code, no Prisma
schema, no migrations, no routes, no services, no frontend pages, no tests, no packages, and no
`docs/program/**` tracker content. Every claim is traced to an exact source location in the frozen baseline
(`server/prisma/schema.prisma`, `server/src/routes/**`, `server/src/services/**`, `src/pages/**`,
`src/services/**`, `src/utils/**`, `src/locales/**`). Where a metric cannot be verified from the code, it is
explicitly marked as **not measurable** or **partially measurable** — nothing here is presented as an exact
figure without a cited source-data path. ClickUp's task wording is not treated as evidence of what exists;
only code is.

## Wave isolation note

This review runs independently at a frozen baseline. It does not inspect, fetch, merge, cherry-pick, rebase
onto, or reconcile any sibling branch or PR (including PR #292, the most recent merge into `main` at this
baseline, or any US-07.x sibling such as US-07.5). The baseline above is frozen for the duration of this task
regardless of what merges elsewhere in the meantime.

```text
Execution baseline: 5dc5ad67c7e9feee11f6fece9a7d65e03033d2fb
Current repository status: not evaluated by this independent task
Sibling task status: intentionally not evaluated
Final reconciliation owner: ChatGPT / Mustafa
```

---

## 1. Executive decision

**NoraMedi can build a first, honest "operational status distribution" report today** — appointment counts by
status, by weekday, by month, and by practitioner/clinic/organization are all directly derivable from
`Appointment.status`/`startTime`/`clinicId` with no schema change (§6). Everything past that first slice
requires either a **data-quality warning label** on an existing but biased field, or **new additive schema
work**, before it can be shown to a clinic owner as a number they can trust.

Four structural findings drive every recommendation in this document:

1. **`Appointment` has exactly one planned-time field pair (`startTime`/`endTime`) and one mutable
   `status` string** (`schema.prisma:317-366`). There is no `completedAt`, no `cancelledAt`, no
   `actualStartAt`, no `checkedInAt`, no `checkedOutAt`. `noShowMarkedAt` (`schema.prisma:335`) is the
   **only** lifecycle timestamp that exists beyond `createdAt`/`updatedAt`. "Busy hour," "weekday
   distribution," and "status distribution" are safe today because they key off `startTime`, an immutable
   planned-time field. Anything that needs to know **when a status changed** is not safe off `Appointment`
   alone.
2. **A reliable status-transition trail already exists, but it lives in `AuditLog`, not on `Appointment`.**
   Every appointment status change writes both an `ActivityLog` row (`appointments.ts:590-594`) and an
   `AuditLog` row carrying `metadata: { previousStatus, newStatus }` (`appointments.ts:595-606`). This is
   real evidence — first-`completed` and first-`cancelled` transition times are reconstructible — but it was
   built for compliance audit trails, not analytics: `AuditLog` has no `(organizationId, entityType,
   createdAt)` composite index (`schema.prisma:1591-1595`), so a date-ranged "average time-to-completion"
   query across many appointments would need a new index before it is safe to run at scale (§10).
3. **`AppointmentRequest` has no response or conversion timestamp at all** (`schema.prisma:368-405`). Once a
   request reaches `status: 'converted'`, the route rejects any further edit
   (`appointmentRequests.ts:182-184`), so `updatedAt` at that point is a *reasonably* stable proxy for
   conversion time — but it is not a designed event timestamp, has no DB-level write-once guarantee, and must
   never be presented as exact (§7 candidate B).
4. **Patient waiting-room time, practitioner delay, and total visit time are not measurable at all.** There is
   no check-in, actual-service-start, or checkout timestamp anywhere in the schema. Per the task's explicit
   decision rule, this document does **not** claim these are measurable (§7 candidates C/D/E).

The recommended path is additive and staged (§16): ship a **current-data slice** (status distribution, busy
hours by `startTime`, weekday/month trend, booking lead time, cancellation lead time, no-show rate, average
duration) behind an explicit `quality` object on every response (§13), then add a purpose-built
**`AppointmentLifecycleEvent`** append-only table (§9) — deliberately *not* named `OperationalEvent`, because
that model name is already taken by an unrelated system-health-monitoring table (§4.4) — to unlock
request-response time, cancellation-event time, and (only after a product decision, §20) check-in/checkout
timing.

---

## 2. Scope and non-goals

**In scope:** a truthful inventory of what can be measured today for the nine metric families named in the
ClickUp task; a metric measurability matrix; a proposed canonical lifecycle-event model; an aggregation,
timezone, authorization, privacy, and API-contract architecture; implementation slices; and test/production
verification strategy. All of this is a **proposal**, not an implementation.

**Out of scope / non-goals:**

- No Prisma schema or migration is created, even additively.
- No route, service, frontend page, test, package manifest, or CI file is modified.
- No revenue/financial metric is covered — `GET /api/reports/revenue`, `/reports/doctor-performance`
  (its financial fields), and `/reports/patient-sources` already exist and are financial reports; this
  review is explicitly **operational**, not financial, per the task brief (§10 of REQUIRED ANALYSIS).
  `doctor-performance`'s non-financial fields (`appointmentCount`, `completedAppointments`, `noShowCount`,
  `completionRate`) are cited only as existing precedent for query shape, not extended here.
- No production database is accessed, no migration is run, no deploy happens, no PR is merged.
- Sibling branches/PRs are not reconciled (see Wave isolation note above).
- The existing `src/pages/Operations.tsx` (system health / WhatsApp connection / audit-log monitoring,
  mounted at `/ops/*`, `src/services/api.ts:722-745`) is a **different product surface** from what this task
  calls "operational analytics." §15 recommends the new dashboard NOT be added to that page, to avoid
  conflating system-health monitoring with clinic business-operations reporting.

---

## 3. Repository evidence

All files listed below were read in full or in the cited line ranges at the frozen baseline. `server/src/routes/operations.ts`
listed in the task's targeted-inspection list **does not exist** in this repository — there is no such
route file (confirmed via directory listing of `server/src/routes/`). No scope was expanded beyond the
task's targeted list except where an existing import/model reference required following it one hop
(recorded per-item below, per the task's scope-expansion rule).

| Path | Exists | Role in this review |
|---|---|---|
| `server/prisma/schema.prisma` | Yes (3402 lines) | `Appointment`, `AppointmentRequest`, `Clinic`, `Organization`, `User`, `ActivityLog`, `AuditLog`, `OperationalEvent`, `LabWorkOrderStatusHistory` inspected |
| `server/src/routes/reports.ts` | Yes (557 lines) | `/reports/revenue`, `/reports/doctor-performance`, `/reports/patient-sources`, `/reports/no-show-analysis` — the only existing operational-shaped report routes |
| `server/src/routes/appointments.ts` | Yes (698 lines) | Status-transition write path, `ActivityLog`/`AuditLog` writes, treatment-case auto-creation on `completed` |
| `server/src/routes/appointmentRequests.ts` | Yes (533 lines) | Request lifecycle: pending → approved/rejected/converted; no response-time field |
| `server/src/routes/noShows.ts` | Yes (679 lines) | `noShowMarkedAt`, `recoveryStatus`, `recoveredAt` read/write paths |
| `server/src/routes/dashboard.ts` | Yes (411/412 lines) | `/dashboard/stats`, chart-data cache, daily/monthly trend bucketing |
| `server/src/routes/organizationDashboard.ts` | Yes (282/283 lines) | `/organization/dashboard`, per-clinic breakdown, `getDateRange` |
| `server/src/routes/operations.ts` | **No** | Not present — see note above |
| `server/src/services/` (directory) | Yes | `operationalEventService.ts`, `clinicOperatingPreferences.ts`, `appointments/appointmentAvailabilityService.ts` inspected; `labOrders/` inspected for the status-history precedent |
| `server/src/services/operationalEventService.ts` | Yes | Writer for the **existing, unrelated** `OperationalEvent` model — system-health events, not appointment lifecycle |
| `server/src/services/clinicOperatingPreferences.ts` | Yes | Canonical clinic timezone/locale/currency/date-format resolution — the source of truth this proposal reuses |
| `server/src/services/appointments/appointmentAvailabilityService.ts` | Yes (imported by `appointments.ts`) | Uses `getZonedDateParts`/`formatClinicDateTime` (`server/src/utils/helpers.ts`) — the existing clinic-timezone bucketing pattern (scope expansion: one hop, `helpers.ts`, required to evaluate §11) |
| `server/src/tests/reports*` | Yes | `reportsClinicScope.test.ts`, `reportsRevenueByPeriod.test.ts` — existing clinic-scope test pattern (source-text assertion style, not integration tests) |
| `server/src/tests/dashboard*` | Yes | `dashboard.test.ts` |
| `server/src/tests/noShow*` | Yes | `noShow.test.ts`, `noShowFollowUpParity.test.ts` |
| `server/src/tests/appointment*` | Yes | `appointmentAvailabilityService.test.ts`, `appointmentRequestOverlapSafety.test.ts`, `appointmentRequestRecordScope.test.ts`, `appointmentUpdateValidation.test.ts` |
| `src/pages/Reports.tsx` | Yes (812 lines) | Existing report tabs (Revenue, Doctor Performance, Patient Sources, No-Show Analysis) |
| `src/pages/Dashboard.tsx` | Yes (800 lines) | Existing clinic-level dashboard consuming `/dashboard/stats` |
| `src/pages/OrganizationDashboard.tsx` | Yes (508 lines) | Existing org-level dashboard consuming `/organization/dashboard` |
| `src/pages/Operations.tsx` | Yes (518 lines) | **System health / audit-log / event-monitoring page** — confirmed unrelated to business operational analytics (§2, §15) |
| `src/services/api.ts` | Yes (900 lines) | `dashboardService.getStats`, `reportsService.*`, `operationalMonitoringService.*` (mounted at `/ops/*`, not `/operations/*` — no path collision with this proposal's `/api/reports/operational/*`) |
| `src/utils/clinicPreferences.ts` | Yes (189/190 lines) | Frontend mirror of `clinicOperatingPreferences.ts` — `formatDateWithPreference`/`formatTimeWithPreference`/`getDateParts`, all `Intl`-based and clinic-timezone-aware |
| `src/locales/*/reports.json` | Yes (de, en, fr, tr) | Existing report i18n key conventions |
| `src/locales/*/operations.json` | **No** | Not present in any of `de/en/fr/tr` — the "Operations" page's copy lives under a different key namespace, not `operations.json` |

No file outside this list was opened for detailed analysis. Scope expansions beyond the task's exact list
were limited to: (a) `server/src/utils/helpers.ts` (`getZonedDateParts`, `getZonedDateTimeParts`,
`formatClinicDateTime`) — required because `appointmentAvailabilityService.ts` imports it and it is the
existing clinic-timezone bucketing primitive directly relevant to §11; (b) `server/src/utils/clinicScope.ts`
— required because every targeted route imports it and it is the existing tenant/clinic authorization
primitive directly relevant to §12; (c) `server/src/utils/roles.ts` — required to confirm role-gating
semantics (`canAccessOrganizationDashboard`, `canViewOperations`) cited in §12; (d)
`server/src/services/privacy/dataRetentionPolicy.ts` — required to determine historical retention/reliability
of `AuditLog`/`ActivityLog`/`OperationalEvent`, directly relevant to §5 and §8; (e)
`server/src/services/labOrders/` status-history precedent — required because it is the only existing
append-only status-history model in the schema and is the direct template for §9's proposal.

---

## 4. Current-state data model

### 4.1 `Appointment` (`schema.prisma:317-366`)

| Field | Type | Mutable | Time concept | Scope | Notes |
|---|---|---|---|---|---|
| `id` | String (uuid) | No | — | — | |
| `clinicId` | String | No (FK) | — | Clinic | indexed `[clinicId, startTime]` |
| `patientId` | String | No (FK) | — | Patient | indexed `[patientId]` |
| `practitionerId` | String | No (FK) | — | User | indexed `[practitionerId, startTime]` |
| `appointmentTypeId` | String | No (FK) | — | Clinic | drives `durationMinutes` |
| `startTime` | DateTime | **Yes** (reschedule) | Planned start | — | UTC instant in DB; not clinic-local by itself |
| `endTime` | DateTime | **Yes** (reschedule) | Planned end | — | `endTime - startTime` = planned duration |
| `status` | String, default `"scheduled"` | **Yes**, overwritten in place | Current state only | — | comment enumerates `scheduled, confirmed, completed, cancelled, no_show, etc.` — **not** a DB enum, no CHECK constraint |
| `cancellationReason` | String? | Yes | — | — | free text |
| `noShowReason` | String? | Yes | — | — | free text |
| `noShowMarkedAt` | DateTime? | Set once, at mark time (`noShows.ts:110-111`) | **Event time** (when staff marked it) | — | the **only** true lifecycle event timestamp on this model |
| `noShowMarkedById` | String? | Set with `noShowMarkedAt` | — | — | |
| `recoveryStatus` | String? | Yes | — | — | `unresolved \| contacted \| recovered` |
| `recoveredAt` | DateTime? | Set once (`noShows.ts:184`) | Event time | — | |
| `createdById` / `updatedById` | String? | — | — | — | |
| `createdAt` | DateTime, `@default(now())` | No | **Creation time** (booking time) | — | reliable — this is what "booking lead time" (§7 candidate A) uses |
| `updatedAt` | DateTime, `@updatedAt` | Yes, on **every** field write | **Last-write time, not a business event** | — | rewritten on reschedule, note edits, status change, recovery update — see §5 warning |
| `deletedAt` | DateTime? | Yes | Soft-delete marker | — | no route in `appointments.ts` sets this within the inspected scope |
| `treatmentCaseId` | String? | Set on `completed` auto-creation (`appointments.ts:551-586`) | — | — | |

**No `completedAt` or `cancelledAt` field exists.** The only way to learn *when* an appointment became
`completed` or `cancelled` is `Appointment.updatedAt` (unreliable — see §5) or the `AuditLog` row created at
`appointments.ts:595-606` (reliable but not indexed for this access pattern — see §10).

### 4.2 `AppointmentRequest` (`schema.prisma:368-405`)

| Field | Type | Mutable | Time concept | Scope | Notes |
|---|---|---|---|---|---|
| `status` | String, default `"pending"` | Yes, one-way after `converted` (`appointmentRequests.ts:182-184` blocks further edits) | Current state only | — | `pending, approved, rejected, converted, closed` |
| `preferredStartTime` / `preferredEndTime` | DateTime? | Yes | Patient-requested planned time | — | not the eventual appointment's actual time unless copied through unchanged at conversion (`appointmentRequests.ts:239-240`) |
| `convertedAppointmentId` | String? | Set once at conversion | — | — | FK to the resulting `Appointment` |
| `source` | String, default `"whatsapp"` | No (write-once at creation) | — | — | already indexed `[source, status, createdAt]` — reliable channel signal |
| `createdAt` | DateTime | No | **Request creation time** | — | reliable |
| `updatedAt` | DateTime | Yes | **Last-write time** | — | see the write-once-after-conversion caveat above; still not a designed event timestamp (§7 candidate B) |

There is **no `respondedAt`, `firstResponseAt`, or `convertedAt` field.** No dedicated response-time or
conversion-time column exists anywhere in this model.

### 4.3 `ActivityLog` (`schema.prisma:816-842`) and `AuditLog` (`schema.prisma:1576-1596`)

Two overlapping but distinct logs exist:

- **`ActivityLog`** — clinic-scoped, FK-linked to `Appointment`/`Patient`/`TreatmentCase`/`InsuranceProvision`,
  free-text `action`/`description`, `metadataJson: String?` (untyped JSON-as-string). Indexed
  `[clinicId, createdAt]` and `[patientId]`. Written on every appointment status change
  (`appointments.ts:590-594`, action = the new status string, e.g. `"completed"`) and on every appointment
  request status change (`appointmentRequests.ts:200-204`, action = the new status string).
- **`AuditLog`** — organization-scoped compliance trail, `metadata: Json?` (typed JSON), written on every
  appointment status change with **exactly** the structured payload analytics needs:
  `metadata: { previousStatus: existing.status, newStatus: validation.data.status }`
  (`appointments.ts:595-606`). Indexed on `[organizationId]`, `[clinicId]`, `[actorUserId]`,
  `[entityType, entityId]`, `[createdAt]` individually — **no composite index** covering
  `(organizationId/clinicId, entityType, createdAt)` together, which is exactly the access pattern a
  date-ranged "time from confirmed to completed, this month, all appointments" query needs (§10 flags this
  as required before any lifecycle-metric endpoint reads `AuditLog` at scale).

Per `server/src/services/privacy/dataRetentionPolicy.ts:20-23`, **neither `AuditLog` nor `ActivityLog` is
ever cleaned up** by the retention job — both are retained indefinitely (`AuditLog` explicitly because it is
"immutable compliance trail — requires legal sign-off before deletion"; `ActivityLog` because it is
"FK-linked to appointments/patients — retain for clinic history"). This makes both reliable long-horizon
evidence sources, unlike `OperationalEvent` below.

### 4.4 `OperationalEvent` (`schema.prisma:1598-1628`) — name collision warning

A model literally named `OperationalEvent` **already exists**, with the doc-comment "System-level operational
events: integration failures, webhook errors, etc. Separate from AuditLog — these are monitorable /
resolvable events." (`schema.prisma:1598-1599`). Its writer is `server/src/services/operationalEventService.ts`
(`recordOperationalEvent`, `EventSource` union of `'whatsapp' | 'meta_whatsapp' | 'instagram' | 'sms' |
'appointment' | 'finance' | 'auth' | 'system' | 'communication_consent' | 'external_calendar'`). This model is:

- **Purged after 180 days by default** (`DATA_RETENTION_OPERATIONAL_EVENTS_DAYS`, `dataRetentionPolicy.ts:42`)
  — unsuitable for any metric needing multi-year history (seasonal comparison, §7).
- Consumed by `src/pages/Operations.tsx` via `GET /ops/events` (`src/services/api.ts:734-743`) — a
  system-health monitoring surface, unrelated to clinic business-operations analytics.

**Consequence for §9:** the canonical appointment-lifecycle event model proposed later in this document must
**not** be named `OperationalEvent` — that name is taken, has the wrong retention policy for analytics, and
is already bound to a different frontend page. §9 proposes `AppointmentLifecycleEvent` instead.

### 4.5 `LabWorkOrderStatusHistory` (`schema.prisma:2509-2521`) — existing append-only precedent

```prisma
model LabWorkOrderStatusHistory {
  id             String       @id @default(uuid())
  labWorkOrderId String
  labWorkOrder   LabWorkOrder @relation(fields: [labWorkOrderId], references: [id])
  fromStatus     String?
  toStatus       String
  note           String?
  changedById    String
  changedBy      User         @relation("LabWorkOrderStatusChanger", fields: [changedById], references: [id])
  createdAt      DateTime     @default(now())

  @@index([labWorkOrderId, createdAt])
}
```

This is the **only** append-only, per-entity status-history table already in the schema. It establishes the
pattern (`fromStatus`/`toStatus`/`changedById`/`createdAt`, one row per transition, indexed by
`(parentId, createdAt)`) that §9's `AppointmentLifecycleEvent` proposal follows, rather than inventing an
unprecedented shape.

### 4.6 `Clinic` (`schema.prisma:9-109`) — timezone and tenancy anchor

`Clinic.timezone: String @default("UTC")` (`schema.prisma:17`) is the per-clinic IANA timezone. It is resolved
through `getClinicOperatingPreferences(clinicId)` (`clinicOperatingPreferences.ts:162-185`), which merges a
`Clinic`-level default with an optional `Setting` override (key `clinic.operating.preferences`) validated
against a closed `zod` enum of 12 supported timezones (`clinicOperatingPreferences.ts:19-32`). Every
`Clinic` belongs to exactly one `Organization` (`organizationId`, NOT NULL). Every `Appointment`/
`AppointmentRequest` belongs to exactly one `Clinic` (`clinicId`, NOT NULL) — there is no cross-clinic
appointment. `Organization`-wide reporting is always an aggregation **over** a set of `Clinic` rows, never a
native org-scoped table.

### 4.7 No room/chair model

A repository-wide search for `Room`/`Chair`/`roomId`/`chairId` models in `schema.prisma` returns no matches.
**Room/chair-level utilization is not supported at any level today** — only `practitionerId`-level and
`clinicId`-level capacity concepts exist (via `DoctorAvailability`, `DoctorOffDay`, `ClinicWorkingHours`).

---

## 5. Time and status semantics

Explicit separation of every timestamp concept named in the task brief:

| Time concept | Field | Exists? | Reliability |
|---|---|---|---|
| `Appointment.createdAt` | `schema.prisma:343` | Yes | Reliable — booking/creation instant, never rewritten |
| `Appointment.startTime` | `schema.prisma:328` | Yes | Reliable as *current planned* start — but **mutable on reschedule**, so a historical "busy hour" pull reflects the *latest* planned time, not the original one, unless read at the time it was true |
| `Appointment.endTime` | `schema.prisma:329` | Yes | Same caveat as `startTime` |
| `Appointment.updatedAt` | `schema.prisma:344` | Yes | **Unreliable as an event timestamp** — rewritten on any field change (status, notes, reschedule, recovery fields). Per this task's decision rules, it is never presented below as a substitute for a business event without this explicit warning. |
| Completion event time | — | **No dedicated field** | Approximable only via the `AuditLog` row where `metadata.newStatus === 'completed'` (`appointments.ts:600-604`) — reliable *if* that specific `AuditLog` query is used, not `updatedAt` |
| Cancellation event time | — | **No dedicated field** | Same approximation path via `AuditLog` where `metadata.newStatus === 'cancelled'` |
| No-show event time | `Appointment.noShowMarkedAt` | Yes (`schema.prisma:335`) | Reliable — set once at mark time (`noShows.ts:110-111`), never rewritten by the recovery flow (recovery only sets `recoveredAt`) |
| `AppointmentRequest.createdAt` | `schema.prisma:395` | Yes | Reliable |
| Request conversion time | — | **No dedicated field** | Approximable via `AppointmentRequest.updatedAt` at the moment `status` becomes `'converted'`, protected from further mutation by the route guard (`appointmentRequests.ts:182-184`) — a *weaker* approximation than the `AuditLog` pattern above, because no `AuditLog`/structured-metadata row is written on this transition (only `ActivityLog`, whose `metadataJson` is untyped and not populated with old/new status here) |
| Patient arrival / check-in time | — | **Does not exist** | No field, no route, no model |
| Practitioner actual start time | — | **Does not exist** | No field, no route, no model |
| Patient service-start time | — | **Does not exist** | No field, no route, no model |
| Checkout / visit-completion time | — | **Does not exist** | No field, no route, no model (`noShowMarkedAt`/`recoveredAt` are no-show-recovery-specific, not general visit completion) |

**Explicit statement per the task's decision rule:** `updatedAt` is never used below as a stand-in for a
completion/cancellation/conversion event without this labeled-approximation caveat attached at the point of
use (§6, §7).

---

## 6. Metric measurability matrix

Legend: **M** = measurable now (exact), **P** = partially measurable (approximation with a named bias),
**N** = not measurable (no source field exists).

| # | Metric | Business definition | Numerator/denominator | Required timestamps/statuses | Current source | Status | Bias / ambiguity | Remediation |
|---|---|---|---|---|---|---|---|---|
| 1 | Appointment count by status | Count of appointments per current `status` value, in a date range | `COUNT(*) GROUP BY status` | `Appointment.status`, `startTime` | `Appointment` table | **M** | Reflects *current* status only — a rescheduled-then-cancelled appointment shows as `cancelled` even for the original slot's busy-hour bucket (survivorship, §8) | None needed for a *current-status* view; label explicitly as "current status," not "outcome at the time" |
| 2 | Completed/cancelled/no-show distribution | Share of `completed` vs `cancelled` vs `no_show` vs other, in a period | Same as #1, filtered | Same as #1 | `Appointment` table; existing precedent in `reports.ts:445-555` (`/reports/no-show-analysis`) | **M** | Same survivorship caveat as #1 | Same |
| 3 | Busy hour by appointment start time | Count of appointments per clinic-local hour-of-day, keyed by `startTime` | `COUNT(*) GROUP BY hour(startTime, clinic tz)` | `startTime`, `Clinic.timezone` | `Appointment.startTime` + `Clinic.timezone` | **P** | Existing precedent (`reports.ts:528-541`, `no-show-analysis`'s `byHour`) uses raw SQL `EXTRACT(HOUR FROM "startTime")`, which extracts in the **database session's timezone (effectively UTC in this deployment)**, not clinic-local time — a clinic in `Europe/Istanbul` (UTC+3) would see its 9am appointments bucketed as hour 6. This is a **real, present bug/gap** in the only existing hour-bucketing code, not a hypothetical. | New endpoint must compute the clinic-local hour using the app-layer `getZonedDateParts`/clinic-timezone pattern already used in `appointmentAvailabilityService.ts` (via `helpers.ts`), not raw SQL `EXTRACT` |
| 4 | Busy hour by request/creation time | Count of `AppointmentRequest` (or `Appointment`) created per clinic-local hour | `COUNT(*) GROUP BY hour(createdAt, clinic tz)` | `createdAt`, `Clinic.timezone` | `AppointmentRequest.createdAt` / `Appointment.createdAt` | **M** | `createdAt` is immutable and reliable; same timezone-bucketing requirement as #3 (must not reuse the UTC-`EXTRACT` pattern) | Reuse the clinic-local bucketing helper |
| 5 | Weekday distribution | Count of appointments per clinic-local weekday | `COUNT(*) GROUP BY weekday(startTime, clinic tz)` | `startTime`, `Clinic.timezone` | `Appointment.startTime` | **P** | Existing precedent (`reports.ts:512-525`, `byDayOfWeek`) uses `EXTRACT(DOW FROM "startTime")` — same UTC-vs-clinic-local bug as #3. Also: Postgres `DOW` is `0=Sunday`, matching the schema's `DoctorAvailability.weekday` convention (`schema.prisma:192`) but must be documented explicitly per the task's locale-independence requirement (§11) | Same as #3; also must respect `firstDayOfWeek` clinic preference (`clinicOperatingPreferences.ts:35`) for **display** only, never for the underlying bucket key |
| 6 | Monthly trend | Count of appointments per clinic-local month | `COUNT(*) GROUP BY month(startTime, clinic tz)` | `startTime`, `Clinic.timezone` | `Appointment.startTime`; existing precedent `reports.ts:464-478` (`monthlyTrend`, `DATE_TRUNC('month', "startTime")`) | **P** | `DATE_TRUNC` also runs in DB-session timezone — same bias as #3/#5, smaller magnitude (month boundaries shift by at most a few hours near month start/end for a clinic near UTC, but the shift is systematic and non-zero for any non-UTC clinic) | Compute month boundary from clinic-local date parts, not raw `DATE_TRUNC` on the UTC instant |
| 7 | Seasonal comparison | Same-period-prior-year comparison of any of the above | Two monthly/weekly series, offset by 12 months | Same as #6, run twice | Derivable once #6 is correctly clinic-local | **P** (inherits #6's bias until fixed) | Requires enough historical data — `Appointment` rows are retained indefinitely (no cleanup job touches them, §4.3), so historical depth is **not** the limiting factor; correctness of the bucketing is | Fix #6 first; no schema change needed |
| 8 | Practitioner utilization | Booked minutes / bookable minutes, per practitioner, per period | `SUM(endTime-startTime) FILTER (status not cancelled)` / (bookable minutes from `DoctorAvailability` − `DoctorOffDay`) | `startTime`, `endTime`, `status`, `DoctorAvailability`, `DoctorOffDay` | `Appointment` + `DoctorAvailability` (`schema.prisma:186-200`) + `DoctorOffDay` (`schema.prisma:202-215`) | **P** | Numerator is exact; denominator ("bookable minutes") requires summing weekly recurring availability windows minus off-days minus clinic-wide `ClinicWorkingHours` intersection — non-trivial but fully derivable from existing models. No schema gap, only a computation-complexity gap. | Build as a dedicated aggregation query (§10), not a naive per-row scan |
| 9 | Room/chair utilization | Same as #8, per physical resource | — | Room/chair model | **Does not exist** (§4.7) | **N** | No source field at any level | Requires a new `Room`/`Chair` model and an `Appointment.roomId`/`chairId` FK — explicitly out of scope for this review; flagged as a product decision (§20) |
| 10 | Appointment lead time | `startTime - createdAt`, per booked appointment | Distribution/average of the interval | `startTime`, `createdAt` | `Appointment` (both fields reliable, `schema.prisma:328,343`) | **M** | If `startTime` is later rescheduled, the *lead time relative to the original slot* is lost — only lead time relative to the **current** `startTime` is computable. Must be labeled "lead time to current scheduled time," not "original lead time," unless the appointment was never rescheduled (unknowable without `AuditLog` inspection) | Label explicitly; do not silently assume no reschedule occurred |
| 11 | Patient waiting-room time | `serviceStartAt - checkedInAt` | — | Check-in + service-start timestamps | **Does not exist** (§4.1, §4.2) | **N** | No check-in concept anywhere in the schema | New fields/model required (§7 candidate C, §9); explicit product decision needed before building (§20) |
| 12 | Appointment request response time | First staff action time − `AppointmentRequest.createdAt` | — | Request creation + first-response event timestamp | **Does not exist** as a dedicated field; only `updatedAt`, which fires on *any* edit, not specifically "first response" | **N** (exact) / **P** (rough proxy) | `updatedAt` conflates "first staff touch" with "any subsequent edit" — cannot distinguish a request touched once vs. edited five times before response | Requires `AppointmentLifecycleEvent`-style capture at the moment `status` first leaves `pending` (§9) |
| 13 | Request-to-booking conversion rate | `COUNT(status='converted') / COUNT(*)`, per period, per source | `AppointmentRequest.status`, `createdAt`, `source` | `AppointmentRequest.status='converted'`, `createdAt`, `source` — all exist (`schema.prisma:368-405`) | **M** | Simple ratio, reliable; `source` already indexed (`@@index([source, status, createdAt])`, `schema.prisma:403`) | None — safe to ship in the current-data slice |
| 14 | Cancellation lead time | Cancellation event time − `startTime` (how far in advance the cancellation happened relative to the slot) | Time delta | Cancellation event time (§5), `startTime` | `AuditLog` (`metadata.newStatus='cancelled'`) as approximation; `startTime` reliable | **P** | The cancellation-event time itself is a labeled approximation via `AuditLog` (§5); once that's accepted, the lead-time computation itself is exact arithmetic | Document the `AuditLog`-sourced approximation explicitly in the API's `quality` object (§13) |
| 15 | No-show rate | `COUNT(status='no_show') / COUNT(status != 'cancelled')`, per period | `Appointment.status`, `startTime` | `Appointment.status`, `startTime` | `Appointment`; existing precedent `reports.ts:445-555` and `organizationDashboard.ts:161-163,202-203` | **M** | Existing implementation is already correct and already shipped (two independent working examples) | None — reuse the existing definition verbatim for consistency across surfaces |
| 16 | Average appointment duration | `AVG(endTime - startTime)`, filtered by status/period | `startTime`, `endTime` | `Appointment.startTime`/`endTime` | `Appointment` | **M** | Planned duration, not actual (no check-in/checkout exists to measure actual duration) — must be labeled "scheduled duration" | Label explicitly as scheduled, not actual |
| 17 | Schedule capacity utilization | Booked slot-minutes / total bookable slot-minutes, clinic-wide | Same numerator/denominator concept as #8, aggregated per clinic instead of per practitioner | `Appointment`, `ClinicWorkingHours` (`schema.prisma`, referenced by `dashboard.ts` imports), `DoctorAvailability`, `DoctorOffDay` | Same models as #8 | **P** | Same complexity caveat as #8 — no schema gap, only aggregation-design work | Same as #8 |

---

## 7. Waiting-time definition and verdict

"Waiting time" is ambiguous per the task brief. Each candidate is evaluated independently against the code:

| Candidate | Definition | Required fields | Exist? | Verdict |
|---|---|---|---|---|
| **A. Booking lead time** | `appointment.startTime − appointment.createdAt` | `Appointment.startTime`, `Appointment.createdAt` | Both exist, both reliable (`schema.prisma:328,343`) | **Measurable now** — with the reschedule caveat from matrix row #10 |
| **B. Request response time** | first staff response/conversion time − `appointmentRequest.createdAt` | `AppointmentRequest.createdAt` (exists) + a first-response event timestamp (does not exist as a dedicated field) | Partial | **Partially measurable** — only as a rough proxy via `updatedAt` at first status change away from `pending`, with the caveat that `updatedAt` cannot distinguish "first touch" from "Nth edit" (§5, §6 row 12). **Not safe to present as an exact number.** |
| **C. Patient waiting-room time** | `serviceStartAt − checkedInAt` | Both fields | **Neither exists anywhere in the schema** | **Not measurable.** Per the task's explicit decision rule, this document does not claim it exists. No check-in concept, no service-start concept, in any model inspected (`Appointment`, `AppointmentRequest`, or any other model in `schema.prisma`). |
| **D. Practitioner delay** | `actualStartAt − scheduled startTime` | `actualStartAt` | **Does not exist** | **Not measurable.** No field captures when a practitioner actually began seeing a patient, only the planned `startTime`. |
| **E. Total clinic visit time** | `checkedOutAt − checkedInAt` | Both fields | **Neither exists** | **Not measurable.** Same gap as C. |

**Verdict:** of the five candidate "waiting time" definitions, only **A (booking lead time)** is measurable
today, and only as a rough proxy is **B (request response time)** partially measurable. **C, D, and E require
new check-in/actual-start/checkout timestamps that do not exist in any form today** — not as a field, not as
a status enum value, not as an implicit derivation from any existing model. Any dashboard section labeled
generically "waiting time" must specify which of A/B/C/D/E it means; a bare "waiting time" label without this
qualifier would misrepresent booking lead time as patient-experienced waiting time, which the task brief
explicitly warns against.

---

## 8. Data-quality and historical-bias analysis

### 8.1 Survivorship / historical-rewrite bias

`Appointment.status` is a single mutable field with no append-only trail on the `Appointment` row itself
(§4.1). A query like "how many appointments were `confirmed` on 2026-06-01" cannot be answered from
`Appointment` directly — only "how many appointments **currently** show `startTime` in June and **some**
status" can. If an appointment was `confirmed` in June and later `cancelled` in July, a June-dated
"confirmed" count computed today will **not** include it, because its current status has moved on. This is
the textbook survivorship bias the task brief asks to be named explicitly.

**Mitigation available today, with a caveat:** the `AuditLog` metadata trail (§4.3) *can* reconstruct "what
was true at time T" by replaying `previousStatus`/`newStatus` transitions in `createdAt` order — but this
requires a bespoke replay query (not a simple `WHERE` filter), is not indexed for that access pattern
(§10), and only exists from whenever `appointments.ts`'s current write path went live — any appointment
whose status last changed via an older code path (before this audit-write existed) would be a silent gap.
This review did not attempt to date that code path's introduction (out of scope — static analysis of the
frozen baseline only), so the safe assumption is: **`AuditLog`-based point-in-time reconstruction is reliable
for recent history and should be labeled as "reconstructed, not guaranteed complete for older records"** in
any UI that uses it.

### 8.2 Excluded/soft-deleted records

`Appointment.deletedAt` exists (`schema.prisma:345`) but no route within the targeted inspection scope
(`appointments.ts`) was observed setting it — soft-delete, if used at all for appointments, happens outside
the inspected file set. Any aggregate query must explicitly decide whether to filter `deletedAt: null` and
must **document that decision** in the API's `quality` metadata (§13), since silently including or excluding
soft-deleted rows changes every count in this document's matrix.

### 8.3 `updatedAt` reuse risk

Because `Appointment.updatedAt` is rewritten on *any* field change — not just status changes — any future
code that naively computes "time in status X" as `updatedAt − createdAt`, or treats the most recent
`updatedAt` as "when it became `completed`," will silently misattribute unrelated edits (a note correction, a
reschedule) as if they were the completion event. This document flags this explicitly per the task's decision
rule and recommends the new lifecycle-event model (§9) as the only way to remove this risk entirely, rather
than continuing to approximate via `AuditLog` replay indefinitely.

### 8.4 Append-only status history: recommendation

Given §8.1–§8.3, **an append-only appointment lifecycle event model is recommended** (§9) — not because the
current-data slice (§6, metrics marked **M**) is unsafe to ship, but because every metric marked **P** in §6
either inherits a real bug (the UTC-vs-clinic-local `EXTRACT` bug, §6 rows 3/5/6) or an approximation ceiling
that only new capture can remove (rows 10, 12, 14). Per the task's instruction not to invent a new event
table if existing audit/history models already provide reliable evidence: `AuditLog` **does** provide
reliable evidence for status transitions specifically (row-level `previousStatus`/`newStatus` already
captured, §4.3) — so §9 scopes the new model narrowly to what `AuditLog` does *not* provide (request-response
timing, and, only pending a product decision, check-in/checkout timing) rather than duplicating what already
works.

---

## 9. Proposed canonical event model

### 9.1 Model: `AppointmentLifecycleEvent`

Deliberately not named `OperationalEvent` (§4.4 name collision). Modeled directly on the existing
`LabWorkOrderStatusHistory` precedent (§4.5), extended with the tenant/actor/source fields the task brief
requires:

```prisma
/// Append-only appointment/request lifecycle events for operational analytics.
/// Distinct from OperationalEvent (system-health monitoring, server/src/services/operationalEventService.ts)
/// and from AuditLog (compliance trail). Rows are never updated or deleted after insert.
model AppointmentLifecycleEvent {
  id                    String    @id @default(uuid())
  organizationId        String
  clinicId              String
  appointmentId         String?
  appointmentRequestId  String?
  patientId             String?
  practitionerId        String?
  eventType             String    // see §9.3 — closed vocabulary enforced at the application layer
  occurredAt            DateTime  // business event time (clinic-local semantics resolved at read time via Clinic.timezone)
  recordedAt            DateTime  @default(now()) // write-time, for detecting late-arriving/backfilled events
  actorUserId           String?   // null for system-originated events (e.g. an automated no-show sweep, if ever built)
  source                String    // "staff_ui" | "whatsapp" | "public_booking" | "system" | ...
  metadataJson          Json?     // event-specific payload; never patient free-text beyond what's already in Appointment/AppointmentRequest
  idempotencyKey        String    @unique // e.g. "<appointmentId>:<eventType>:<occurredAt-bucket>" — see §9.5

  @@index([organizationId, clinicId, occurredAt])
  @@index([appointmentId, occurredAt])
  @@index([appointmentRequestId, occurredAt])
  @@index([eventType, organizationId, occurredAt])
}
```

### 9.2 Tenant and clinic scope

Every row carries both `organizationId` and `clinicId`, matching the two-tier scope already enforced by
`clinicScope.ts` (`ClinicScopeWhere = { organizationId } | { organizationId, clinicId } | { organizationId,
clinicId: { in: [...] } }`, `clinicScope.ts:43-46`). No row is ever written without both — this mirrors
`AuditLog`'s existing shape (`organizationId` required, `clinicId` optional) but makes `clinicId` **required**
here, since every appointment/request already belongs to exactly one clinic (§4.6) and analytics queries are
always clinic- or org-scoped, never global.

### 9.3 Immutable event semantics and allowed event types

Rows are **insert-only** — no `update`/`delete` code path is ever written against this table (enforced by
convention/code-review, since Prisma/Postgres cannot itself forbid `UPDATE` at the schema level without a
trigger, which is out of scope for an additive proposal). The closed vocabulary for `eventType` (enforced by
a `zod` enum in the application layer, following the existing pattern at `schemas/index.ts:389` for
`AppointmentRequest.status`):

- `appointment_created`, `appointment_confirmed`, `appointment_completed`, `appointment_cancelled`,
  `appointment_no_show`, `appointment_rescheduled` (captures **both** old and new `startTime`/`endTime` in
  `metadataJson`, closing the reschedule-loses-original-lead-time gap noted in §6 row 10)
- `request_created`, `request_first_response` (staff first touched a `pending` request — closes §6 row 12 /
  §7 candidate B), `request_approved`, `request_rejected`, `request_converted`
- Reserved, **not implemented** until a product decision (§20): `patient_checked_in`, `service_started`,
  `patient_checked_out` — these three event types close §7 candidates C/D/E, but per the task's explicit
  instruction, this document does not claim they are measurable until check-in/checkout UI and workflow are
  product-approved and built.

### 9.4 Indexes

`[organizationId, clinicId, occurredAt]` for the primary org/clinic-scoped time-range aggregation path;
`[appointmentId, occurredAt]` and `[appointmentRequestId, occurredAt]` for per-record lifecycle replay (the
detail-view use case); `[eventType, organizationId, occurredAt]` for cross-clinic single-metric queries (e.g.
"all `request_first_response` events this quarter, org-wide"). This directly closes the composite-index gap
identified in `AuditLog` (§4.3) rather than repeating it.

### 9.5 Idempotency key

Format: `"<sourceEntityId>:<eventType>:<occurredAt ISO-8601 to the second>"`, unique-constrained. This follows
the existing `OperationalEvent.dedupeKey` precedent (`schema.prisma:1614-1618`, "Left null by every feature
that doesn't need dedupe... a create is performed as an upsert on this unique key so duplicate-alert
suppression is atomic") — the same upsert-on-conflict pattern prevents double-counting if a write path
retries (e.g. a webhook redelivery for `request_created`).

### 9.6 Retention, privacy classification, deletion/anonymization

- **Retention:** indefinite, following the `AuditLog`/`ActivityLog` precedent (§4.3) — this table is
  business-analytics evidence, not a purge-eligible operational ledger like `OperationalEvent`. No
  `DATA_RETENTION_*` environment variable should apply to it, mirroring the explicit exclusion list in
  `dataRetentionPolicy.ts:20-23`.
- **Privacy classification:** contains `patientId` (pseudonymous FK, not a name) and `practitionerId` — no
  free-text patient content beyond what already exists on `Appointment`/`AppointmentRequest`.
  `metadataJson` must never carry patient name, phone, or note text (enforced by code review / a shared
  allowlist helper, following the existing `clinicBulkExportFieldAllowlists.ts` pattern referenced in §3).
- **Deletion/anonymization behavior:** when a patient is anonymized (`patientAnonymization.ts`, referenced in
  §3's retention grep), `AppointmentLifecycleEvent.patientId` should be nulled the same way
  `Appointment`/other FK-linked models are handled by that existing job — this document does not modify that
  job, only notes the dependency for the implementer of slice B (§16).
- **Backfill limitations:** `occurredAt` for historical events **cannot** be backfilled with confidence beyond
  what `AuditLog` already proves (§8.1) — any backfill migration must source `occurredAt` from the matching
  `AuditLog.createdAt` row where one exists, and must leave events with no matching `AuditLog` row
  unbackfilled rather than fabricated, per the task's decision rule against inventing historical timestamps.

---

## 10. Aggregation and performance architecture

### 10.1 Comparison of approaches

| Approach | Fit for NoraMedi's current scale | Notes |
|---|---|---|
| Real-time transactional queries (current pattern in `reports.ts`/`dashboard.ts`/`organizationDashboard.ts`) | **Good fit for the current-data slice (§6 rows marked M/P)** | Every existing report route already queries `Appointment`/`Payment` directly per-request; `dashboard.ts` already layers a 60-second in-memory cache per clinic (`CHART_CACHE_TTL_MS`, `dashboard.ts:13-27`) — the established pattern to extend, not replace, for slice A |
| Scheduled pre-aggregation (daily summary tables) | **Recommended once `AppointmentLifecycleEvent` (§9) exists and org-wide multi-year seasonal comparisons (§6 row 7) are requested** | Not needed for the initial slice; premature for current data volume based on evidence available (no row-count/scale data was inspected — this is a design-readiness statement, not a load-test result) |
| Materialized views | Defer | Postgres materialized views require a manual/scheduled `REFRESH`; equivalent benefit to a summary table with less operational flexibility (no incremental update) — not recommended as the first step |
| Event-driven aggregation (roll up `AppointmentLifecycleEvent` into a summary table on write) | **Recommended as the eventual model once slice B/C ship**, not before | Requires the event table to exist first (§9); until then there is nothing to roll up beyond what `Appointment` already answers directly |

**Recommendation: stage it.** Ship slice A (§16) on direct transactional queries, extending the existing
per-clinic short-TTL cache pattern already proven in `dashboard.ts`. Only introduce pre-aggregation once (a)
`AppointmentLifecycleEvent` exists and (b) an org-wide multi-year query is actually requested and shown to be
slow — not speculatively.

### 10.2 Timezone

Addressed fully in §11.

### 10.3 Clinic-local day boundaries and DST

A clinic-local "day" for bucketing must be computed via `Intl.DateTimeFormat` with the clinic's IANA
timezone (the existing `getZonedDateParts`/`formatClinicDateTime` pattern, §3, §6 row 3) — never via
`Date.setHours(0,0,0,0)` on a server-local `Date`, which is what `dashboard.ts:44-45` and
`organizationDashboard.ts:37-38,124` currently do. **This is an existing, present gap**, not hypothetical:
those two routes compute "today"/"this week" boundaries in the **server process's runtime timezone**
(effectively UTC), not the requesting clinic's timezone — a clinic in `Europe/Istanbul` viewing "today's
appointments" near midnight local time could see a day boundary that is 3 hours off from their actual local
midnight. This review does not fix that gap (out of scope — no route changes), only records it as a
data-quality precedent the new operational endpoints must not repeat.

### 10.4 Date range limits and pagination

Every new endpoint (§14) must enforce a maximum date-range width (recommend 400 days, matching a
year-plus-buffer for seasonal comparison, §6 row 7) to bound query cost, following the existing pattern of
mandatory `dateFrom`/`dateTo` validation already present in `reports.ts` (`if (!dateFrom || !dateTo) return
res.status(400)...`, e.g. `reports.ts:30-32`). Bucketed (hour/day/week/month) responses do not need row-level
pagination since they return one row per bucket, not one row per appointment; any endpoint returning
per-appointment detail rows (none proposed here) would need `take`/`cursor` pagination matching the existing
`take: 10` / `take: 20` / `take: 30` conventions in `dashboard.ts`.

### 10.5 Query indexes required

- `Appointment` already has `[clinicId, startTime]` and `[practitionerId, startTime]` (`schema.prisma:363-364`)
  — sufficient for status-distribution, busy-hour, weekday, and monthly-trend queries scoped by clinic or
  practitioner. **No new index needed on `Appointment` for the slice-A metrics.**
- `AuditLog` needs a new composite index — `[organizationId, entityType, createdAt]` (and/or
  `[clinicId, entityType, createdAt]`) — **before** any endpoint reads it at scale for completion/cancellation
  event-time approximation (§6 rows 2, 14). This is a schema change and therefore out of this document's
  delivery scope; flagged for slice A's dependent work (§16).
- `AppointmentLifecycleEvent` ships with its own indexes from day one (§9.4) — no retrofit needed.

### 10.6 Cache behavior and stale-data tolerance

Extend the existing per-clinic short-TTL in-memory cache pattern (`dashboard.ts:13-27`, 60-second TTL) to the
new operational-report endpoints, with the `quality.calculatedAt` field (§13) making staleness visible to the
client rather than hidden. A 60-second TTL is appropriate for slice A (near-real-time dashboards); once
pre-aggregation (§10.1) exists for multi-year queries, those can tolerate a longer TTL (e.g. hourly), reported
via the same `quality` object.

### 10.7 Organization-wide vs. clinic-level reporting

Mirrors the existing two-tier pattern: `reports.ts`/`dashboard.ts` are clinic-level (optionally `'all'`
within one organization via `validateAndGetClinicIdScope`), `organizationDashboard.ts` is the dedicated
org-wide aggregation surface, gated additionally by `canAccessOrganizationDashboard` (`roles.ts:131-133`).
New operational-analytics endpoints (§14) should follow the same split: clinic-scoped endpoints reuse
`validateAndGetClinicIdScope`; a true cross-clinic breakdown (per-clinic rows, like
`organizationDashboard.ts`'s `clinicMetrics` array) requires the `OWNER`/`ORG_ADMIN` + `canAccessAllClinics`
gate, never inferred from the frontend.

### 10.8 Currency exclusion

Confirmed: none of the endpoints proposed in §14 include any `amount`/`revenue`/`currency` field. This is a
deliberate scope boundary matching the task brief's instruction that this review is operational, not
financial (§2).

---

## 11. Timezone and locale contract

### 11.1 UTC-to-clinic-local conversion

All `DateTime` columns are stored as UTC instants (standard Prisma/Postgres `timestamp` behavior — no column
was found with a non-UTC storage convention). Every bucketing operation (hour/day/week/month) **must** convert
to clinic-local time before computing the bucket key, using `Intl.DateTimeFormat(..., { timeZone:
clinic.timezone })` — the same primitive already used by `getZonedDateParts`/`getZonedDateTimeParts`/
`formatClinicDateTime` (`server/src/utils/helpers.ts`, imported by `appointmentAvailabilityService.ts`) and by
`clinicOperatingPreferences.ts`'s date/time formatters. **This is the one pattern in the existing codebase
that already gets timezone bucketing right** — it must be the template for every new bucket computation, not
the raw-SQL `EXTRACT`/`DATE_TRUNC` pattern used in `reports.ts`'s existing hour/weekday/month queries (§6 rows
3, 5, 6), which computes in the database session's timezone.

### 11.2 Hourly bucket calculation

Compute via `Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', hourCycle: 'h23' })` on the UTC
instant, exactly as `getZonedDateParts` already does (`helpers.ts:23-39`) — never via SQL `EXTRACT(HOUR FROM
...)` on the raw column.

### 11.3 DST — repeated and missing hours

For a clinic observing DST (none of the 12 supported timezones in `clinicOperatingPreferencesSchema` are
DST-free except `UTC`; `Europe/Istanbul` itself stopped observing DST in 2016 but the schema also supports
`America/New_York`, `Europe/London`, `Europe/Berlin`, etc., which do observe it), two edge cases must be
defined explicitly, since none of the existing raw-SQL report code handles them at all:

- **Missing hour** (spring-forward, e.g. `America/New_York` 02:00–02:59 does not exist on transition day): an
  `Appointment.startTime` UTC instant can never map to a wall-clock time inside the missing hour — `Intl`
  formatting simply will not produce it, so no bucket key collision is possible here. No special handling
  needed.
- **Repeated hour** (fall-back, e.g. 01:00–01:59 occurs twice): two UTC instants map to the **same** clinic-local
  hour-of-day bucket key (e.g. both map to "01:00"). This is **correct, not a bug** — the bucket key
  intentionally represents wall-clock hour-of-day, not a unique instant, and both real appointments in that
  repeated hour legitimately belong in the same "01:00 busy-hour" bucket. This must be documented in the API
  contract (§14) so a future maintainer does not "fix" it into a bug.

### 11.4 Week-start rule

`Clinic.firstDayOfWeek` (`clinicOperatingPreferencesSchema`, `'monday' | 'sunday'`, default `'monday'`) governs
**display grouping only** (e.g. which day a weekly chart starts on). The underlying weekday **bucket key**
must remain a fixed, locale-independent numeric convention (ISO 8601: `1=Monday..7=Sunday`, avoiding
Postgres's `EXTRACT(DOW)` convention of `0=Sunday..6=Saturday` used internally by the existing `no-show-analysis`
route, §6 row 5, to prevent the two conventions colliding in the same product). Frontend re-orders the fixed
7 buckets for display according to `firstDayOfWeek`; the API itself never reorders.

### 11.5 Locale-independent API bucket keys

Every new endpoint returns machine-readable keys: `hour` as an integer `0-23`, `weekday` as an integer `1-7`
(ISO convention per §11.4), `month` as `YYYY-MM`, `date` as `YYYY-MM-DD` — never a localized label
(`"Pzt"`, `"Mon"`, `"Ocak"`) in the API payload itself. This matches the existing precedent in
`reportsClinicScope.test.ts`'s domain (raw scope values) and diverges intentionally from `dashboard.ts`'s
current chart-data shape, which **does** bake `Intl.DateTimeFormat`-localized labels directly into the API
response (`dashboard.ts:341-346`, `dailyTrend[].date` is already a formatted string like `"Pzt"`). That
existing behavior is acceptable for `dashboard.ts`'s single internal consumer but is **not** the contract
this document recommends for new operational-analytics endpoints, which must support multiple consumers
(dashboard widgets, CSV export, external BI) that each need to localize independently.

### 11.6 Display formatting

Frontend formatting of any bucket key into a locale-specific label reuses `src/utils/clinicPreferences.ts`'s
existing `formatDateWithPreference`/`formatTimeWithPreference`/`getDateParts` helpers (already `Intl`-based
and clinic-timezone-aware, §3) — no new formatting utility is proposed.

---

## 12. Authorization, tenant, and clinic scope

### 12.1 Allowed roles

| Report family | Allowed roles | Basis |
|---|---|---|
| Clinic operational reports (status distribution, busy hours, trends, lead time within one clinic or the requester's accessible clinics) | `OWNER`, `ORG_ADMIN`, `CLINIC_MANAGER`, `RECEPTIONIST` | Mirrors the existing `/reports/*` gate (`authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'BILLING'])`, `reports.ts:27`) minus `BILLING` (financial-only role, not relevant to operational-only metrics per §2) plus `RECEPTIONIST` (mirrors `/dashboard/stats`'s `canViewApptRequests` gate, `dashboard.ts:34`, since request/conversion metrics are receptionist-relevant) |
| Organization-wide reports (cross-clinic breakdown) | `OWNER`, `ORG_ADMIN` with `canAccessOrganizationDashboard(user)` true | Mirrors `organizationDashboard.ts:83-87` exactly — double-gated by both the route `authorize()` array and the explicit `canAccessOrganizationDashboard` check |
| Practitioner self-view (a `DENTIST` viewing only their own utilization/lead-time/no-show numbers) | `DENTIST`, scoped to `practitionerId = req.user.id` server-side | Mirrors the existing `normalizedRole === 'DENTIST'` conditional narrowing already present in `dashboard.ts` (e.g. `practitionerId: userId` appended to every stats query at `dashboard.ts:57,63,76,82,88,94`) — never trust a client-supplied `practitionerId` for a `DENTIST` caller |
| Exports (CSV) | Same role set as the underlying report, **not** a superset | Mirrors `reports.ts:207` (`/reports/revenue/export.csv` uses the identical `authorize([...])` array as `/reports/revenue` itself) |

### 12.2 Backend enforcement (must never rely on frontend visibility)

- **Organization scope:** every query must include `organizationId` (directly or via a clinic-set derived
  from it) — the `clinicScope.ts` contract (§4.6, §9.2) already enforces this shape; new endpoints must reuse
  `validateAndGetClinicIdScope`/`validateAndGetScope`, not hand-roll a new scope function.
  `buildClinicScopeWhere` explicitly cross-checks a requested `clinicId` against `organizationId` via a DB
  lookup (`clinicScope.ts:69-73`) before trusting it — the same must hold for any new selected-clinic
  parameter.
- **Selected-clinic access:** `clinicScope.ts:76-78` denies access to a clinic not in `user.allowedClinicIds`
  unless `canAccessAllClinics`; new endpoints inherit this by construction if they call the shared helper
  rather than re-implementing scope logic.
- **Cross-clinic aggregation only for authorized users:** enforced by using `validateAndGetScope`
  (organization-or-single-clinic) for org-wide endpoints and `validateAndGetClinicIdScope` (clinic-only) for
  clinic-level endpoints — never accepting a raw client-supplied clinic-ID array without validation.
- **Cross-tenant probing is already detected:** `clinicScope.ts:23-41` fires
  `evaluateCrossTenantDenialSignal` whenever a *specific* (non-`'all'`) clinic ID is requested and denied —
  new endpoints get this for free by reusing the shared helper, and should **not** duplicate or bypass it.
- **No reliance on frontend visibility:** every gate above is a `res.status(403)` at the route/service layer,
  not a UI-only hide — matching every existing report/dashboard route inspected.

---

## 13. Privacy and compliance

### 13.1 What operational analytics does/does not contain

- **Patient identifiers:** aggregate endpoints (§14) must return only pseudonymous `patientId` counts inside
  aggregate buckets, **never** patient names — this is a stricter rule than some existing endpoints already
  apply (e.g. `dashboard.ts`'s `agenda` array legitimately includes patient names for a receptionist's
  today-view, but that is a detail list, not an aggregate metric; the operational-analytics endpoints
  proposed here are aggregates only and must not follow the `agenda` pattern).
- **Practitioner performance data:** per-practitioner no-show rate, utilization, and completion rate are
  inherently individual-employee performance signals (already shipped today in `/reports/doctor-performance`
  and `/reports/no-show-analysis`'s `byDoctor`, §3) — this is **employee-monitoring-adjacent data**, not
  merely clinic-operational data, and must be labeled as such in any product/legal review.
- **Special-category health data:** none of the metrics in §6 require or expose diagnosis, treatment type
  detail, or clinical notes — only scheduling metadata (status, timing, counts). `AppointmentType.name`
  (e.g. "Root canal") is arguably health-adjacent but is already exposed today in existing chart data
  (`dashboard.ts:352-376`, `appointmentsByType`), so this review does not introduce a new exposure, only notes
  the existing one for completeness.
- **Small-cohort re-identification risk:** a clinic/practitioner/hour combination with very few appointments
  (e.g. "Dr. X, Tuesdays 6pm, 1 appointment/month") could make a per-slot no-show or lead-time figure
  effectively identify a specific patient by elimination. This risk is real for **fine-grained** breakdowns
  (practitioner × hour × week) but not for the coarser aggregates in §6's headline metrics.

### 13.2 Recommendations

- **Aggregation thresholds:** any breakdown finer than clinic × month (e.g. practitioner × hour × day) should
  suppress or bucket cells with fewer than a minimum count (suggest **5**, a common small-cell suppression
  threshold, pending legal sign-off — this is a product/legal decision, §20, not asserted as final here).
- **Minimum necessary fields:** endpoint response shapes (§14) intentionally omit patient name, phone, email,
  and free-text notes from every aggregate payload.
- **No patient names in aggregate endpoints:** stated as a hard rule for §14's contracts.
- **Export access controls:** CSV export inherits the same role gate as the underlying report (§12.1) — no
  broader export-only role.
- **Audit logging:** every export action should write an `AuditLog` row (`action: 'operational_report_exported'`,
  mirroring the existing `writeAuditLog` call shape at `appointments.ts:595-606`), so a KVKK/GDPR access
  review can trace who exported what, when — this is new instrumentation, not a reuse of an existing route,
  and belongs in slice F (§16).
- **Retention alignment:** `AppointmentLifecycleEvent` retention (§9.6) already matches `AuditLog`/
  `ActivityLog`'s indefinite-retention precedent, keeping analytics evidence and compliance evidence on the
  same retention posture.
- **Anonymization compatibility:** `AppointmentLifecycleEvent.patientId` nulling on patient anonymization is
  specified in §9.6 and must be wired into whichever job currently performs `Appointment`-level anonymization
  when slice B (§16) is implemented.

---

## 14. Proposed API contracts

All six endpoint families below are **proposals only** — no route file is created by this document. Each
follows the existing `reports.ts`/`dashboard.ts` conventions: `authorize([...])` role gate,
`validateAndGetClinicIdScope`/`validateAndGetScope` for tenant scope, mandatory `dateFrom`/`dateTo` validation,
and a JSON error shape of `{ error: string }` on failure (matching every existing route inspected).

### `GET /api/reports/operational/status-distribution`

- **Query params:** `dateFrom` (required, ISO date), `dateTo` (required, ISO date, max 400-day span from
  `dateFrom` per §10.4), `clinicId` (optional, `'all'` or a specific clinic ID, validated via
  `validateAndGetClinicIdScope`), `practitionerId` (optional).
- **Bucket granularity:** none — single aggregate per status value for the whole range.
- **Response shape:**
  ```json
  {
    "dateFrom": "2026-01-01", "dateTo": "2026-06-30",
    "byStatus": [{ "status": "completed", "count": 412 }, { "status": "cancelled", "count": 38 }, ...],
    "quality": { "status": "complete", "reasonCodes": [], "sourceVersion": "appointment-status-v1", "calculatedAt": "2026-08-02T10:00:00Z" }
  }
  ```
- **Null vs. zero:** a status with zero occurrences in range is present in `byStatus` with `count: 0`, not
  omitted — so the client never has to guess "not returned" vs. "zero."
- **Timezone metadata:** `dateFrom`/`dateTo` interpreted as clinic-local calendar dates (§11.3); response
  includes no per-row timezone field since this endpoint has no time-of-day bucket.
- **Authorization/export:** §12.1 clinic-report role set; CSV export at `.../status-distribution/export.csv`
  under the identical role gate (§12.1, §13.2).

### `GET /api/reports/operational/busy-hours`

- **Query params:** `dateFrom`, `dateTo` (required, same limits), `clinicId`, `practitionerId` (optional),
  `basis` (`'start_time' | 'created_at'`, required — explicitly forces the caller to pick busy-by-appointment
  vs. busy-by-booking-request, closing §6 rows 3/4's ambiguity at the contract level rather than defaulting
  silently).
- **Bucket granularity:** hour-of-day (`0-23`, clinic-local, §11.2) × weekday (`1-7`, ISO, §11.4).
- **Response shape:** `{ dateFrom, dateTo, basis, timezone: "Europe/Istanbul", buckets: [{ hour, weekday, count }, ...], quality }`
  — `buckets` covers all 168 hour×weekday combinations present in the range, zero-filled.
- **Data-quality metadata:** `quality.reasonCodes` includes `"utc_extract_not_used"` as a positive confirmation
  flag (or, if a future implementation regresses to raw SQL `EXTRACT`, this is where that regression would be
  caught by a contract test, §17).

### `GET /api/reports/operational/trends`

- **Query params:** `dateFrom`, `dateTo`, `clinicId`, `granularity` (`'day' | 'week' | 'month'`, required,
  mirrors the existing validated-enum pattern at `reports.ts:42-43`), `compareToPriorPeriod` (boolean,
  optional — powers §6 row 7's seasonal comparison by running the same query twice server-side rather than
  making the client issue two requests).
- **Bucket granularity:** per `granularity`, clinic-local (§11).
- **Response shape:** `{ dateFrom, dateTo, granularity, series: [{ bucket: "2026-06", count }, ...], priorPeriodSeries: [...] | null, quality }`.
- **Null vs. zero:** every bucket in range present with `count: 0` if empty; `priorPeriodSeries` is `null`
  (not an empty array) when `compareToPriorPeriod` was not requested, distinguishing "not asked for" from
  "asked for, all zero."

### `GET /api/reports/operational/lead-time`

- Covers §7 candidate A (booking lead time) and, separately, §6 row 14 (cancellation lead time) as two
  sub-resources rather than one endpoint conflating them (per the task's instruction to avoid one unbounded
  "return everything" endpoint):
  - `GET /api/reports/operational/lead-time/booking` — distribution (min/p25/median/p75/max, in hours) of
    `startTime − createdAt` for appointments booked in range, plus a labeled caveat field
    `rescheduledExclusionNote` explaining §6 row 10's reschedule caveat.
  - `GET /api/reports/operational/lead-time/cancellation` — same distribution shape for cancellation lead
    time, with `quality.status: "partial"` always set (since the underlying event time is `AuditLog`-sourced,
    §6 row 14) and `quality.reasonCodes: ["cancellation_time_approximated_via_audit_log"]`.
- **Response shape (booking sub-resource):**
  ```json
  { "dateFrom": "...", "dateTo": "...", "unit": "hours",
    "distribution": { "min": 0.5, "p25": 18, "median": 72, "p75": 168, "max": 2160, "count": 340 },
    "quality": { "status": "complete", "reasonCodes": [], "sourceVersion": "lead-time-v1", "calculatedAt": "..." } }
  ```

### `GET /api/reports/operational/waiting-time`

- **Explicitly disabled/`501`-shaped until §9's `patient_checked_in`/`service_started` events exist and a
  product decision approves them (§20).** The contract is defined now so the frontend (§15) can build the UI
  shell against a stable shape, but the endpoint itself should return `{ "quality": { "status":
  "unavailable", "reasonCodes": ["checkin_timestamps_not_captured"] }, "distribution": null }` rather than
  fabricating a number, per §7's verdict. Once check-in capture ships, response shape mirrors
  `lead-time/booking` above with `unit: "minutes"`.

### `GET /api/reports/operational/utilization`

- **Query params:** `dateFrom`, `dateTo`, `clinicId`, `groupBy` (`'practitioner' | 'clinic'`, required).
- **Bucket granularity:** one row per practitioner or per clinic (not time-bucketed).
- **Response shape:** `{ dateFrom, dateTo, groupBy, rows: [{ id, name, bookedMinutes, bookableMinutes, utilizationPct }, ...], quality }`
  — `utilizationPct: null` (not `0`) for a practitioner/clinic with `bookableMinutes: 0` in range (e.g. no
  `DoctorAvailability` configured), distinguishing "genuinely idle" from "no capacity data configured."
- **Authorization:** a `DENTIST` caller receives only their own row (§12.1) regardless of `groupBy=practitioner`
  request scope — server-side filter, never client-trusted.

### Cross-cutting contract rules (all six families)

- No endpoint accepts an unbounded date range (§10.4).
- Every response carries the `quality` object defined in §17.
- No endpoint returns patient name/phone/email/notes (§13.2).
- No endpoint mixes multiple unrelated metric families into one payload — each is independently cacheable,
  independently versionable (`quality.sourceVersion`), and independently deprecable.

---

## 15. Frontend information architecture

Proposed as a **new** dashboard surface — not merged into `src/pages/Operations.tsx` (§2, §4.4), and not
simply bolted onto the existing `Reports.tsx` tab set without a clear "Operational" vs. "Financial" section
break, since `Reports.tsx`'s existing four tabs (Revenue, Doctor Performance, Patient Sources, No-Show
Analysis) are financial/mixed, and this task is explicitly operational-only (§2).

| Section | Data source (§14) | Ships with current data? |
|---|---|---|
| KPI summary (today's appointment count, this week's count, no-show rate, avg lead time) | `status-distribution` + `lead-time/booking`, small date ranges | **Yes** |
| Status distribution (bar/donut) | `status-distribution` | **Yes** |
| Busy-hour heatmap | `busy-hours` | **Yes**, once the clinic-local-hour fix (§6 row 3, §11) is applied — must not ship using the existing UTC-biased `EXTRACT` pattern |
| Weekday/month trend | `trends` | **Yes**, same clinic-local caveat as above |
| Lead-time distribution | `lead-time/booking`, `lead-time/cancellation` | **Yes**, with the reschedule/approximation caveats surfaced as inline UI notes, not hidden |
| Waiting-time section | `waiting-time` | **No — must remain disabled/hidden (not merely grayed out with a fake number) until §9's check-in events exist and §20's product decision approves building them.** Per §7's verdict, showing anything here today would violate the task's explicit "do not claim patient waiting time exists" rule. |
| Practitioner/clinic filters | shared across all sections | **Yes** — reuses the existing clinic-selector pattern already in `Dashboard.tsx`/`Reports.tsx` |
| Data-quality warnings | `quality` object from every endpoint | **Yes** — a persistent, dismissible-per-session banner when any active widget's `quality.status !== 'complete'`, surfacing `reasonCodes` in plain language (e.g. "Cancellation timing is approximated from audit history and may be incomplete for older records") |

Widgets that must ship **disabled** (visible but explicitly "not yet available," never silently omitted, so
users know the feature exists and why it isn't live): waiting-time section, room/chair utilization (§4.7, no
schema support at all), request-response-time as an exact figure (only the rough `updatedAt`-proxy is
available, §7 candidate B — if shown at all, it must carry the same `quality.status: "partial"` treatment as
cancellation lead time).

---

## 16. Implementation slices

Per the task's instruction, no slice combines schema + backend + frontend + tests into one PR. Each slice is
independently mergeable and independently rollback-able.

| Slice | Scope | Depends on | Schema impact | Migration | Backend | Frontend | Tests | Rollout | Rollback | Risk |
|---|---|---|---|---|---|---|---|---|---|---|
| **A. Current-data operational metrics** | Ship `status-distribution`, `busy-hours` (fixed to clinic-local, §11), `trends`, `lead-time/booking`, `utilization` (practitioner + clinic) reading only existing `Appointment`/`DoctorAvailability`/`DoctorOffDay` fields | None | None | None | New route file(s) under `server/src/routes/`; new `AuditLog` composite index migration (§10.5) as a **separate**, purely additive migration PR, not bundled with route code | New dashboard page/section shell (§15), KPI/status/busy-hour/trend/lead-time widgets only | New `server/src/tests/reportsOperational*.test.ts` following the existing `reportsClinicScope.test.ts` style, plus a dedicated DST-boundary test (§17) | Behind no feature flag needed (additive, read-only) — direct release | Revert the route file / hide the frontend section; no data was ever written, so no data rollback needed | **Low** — read-only, no schema change beyond an additive index |
| **B. Appointment lifecycle event capture** | Introduce `AppointmentLifecycleEvent` (§9); wire `appointment_*` event writes into the existing status-change code path in `appointments.ts` alongside (not replacing) the current `ActivityLog`/`AuditLog` writes | A (for the endpoints that will eventually read it) | New model, new migration | Additive migration (`CREATE TABLE`, no backfill in this slice — see §9.6 backfill limitation) | Write-path change in `appointments.ts`'s status-update handler (`appointments.ts:589-620` region) | None | New idempotency + immutability tests (§17) | Deploy write path first, dark (no reader yet), verify event volume looks sane for 1-2 weeks before any endpoint reads it | Stop writing (feature-flag the insert call); existing `ActivityLog`/`AuditLog` writes are untouched, so no functional regression from a rollback | **Medium** — touches a hot write path (`appointments.ts` status update), must not fail the parent transaction on event-write failure (mirror `operationalEventService.ts`'s "errors are swallowed" pattern, §3) |
| **C. Request response/conversion metrics** | Wire `request_*` events into `appointmentRequests.ts`'s status/convert handlers; add `request-conversion` metric family reading real event data instead of the `updatedAt` proxy | B | None (reuses B's model) | None | Write-path change in `appointmentRequests.ts` (`:170-249` region) | Update `waiting-time`'s response-time sub-metric (still not the C/D/E patient-waiting-room metrics) from "partial/proxy" to "complete" once events exist | New tests mirroring B's pattern, scoped to `AppointmentRequest` | Same dark-write-first pattern as B | Same as B | **Low-Medium** — same write-path-failure caution as B, smaller blast radius (request volume is lower than appointment volume) |
| **D. Check-in and actual service timing** | Only after §20's product decision: add check-in/checkout capture (new fields or new `patient_checked_in`/`service_started`/`patient_checked_out` event types, §9.3) | Product decision (§20); B | New optional fields or reuses B's event model | Additive | New route(s) for staff to mark check-in/checkout | New "waiting time" UI section (§15), now enabled | New tests for C/D/E waiting-time candidates (§7) | Feature-flagged per clinic (opt-in, since it's a new staff workflow, not just a read-only report) | Feature-flag off; no data loss (historical events remain, just unread) | **Medium-High** — new staff workflow adoption risk, not just a technical risk |
| **E. Aggregation/indexing** | Introduce daily/weekly summary tables or scheduled rollups (§10.1) once slice A+B prove which queries are actually slow | A, B | New summary-table model(s) | Additive | New scheduled job (mirrors `server/src/jobs/` existing pattern, e.g. `dataRetentionCleanupJob.ts`'s cron-registration style) | None directly (backend-only perf work) | Job-correctness tests (rollup matches direct-query result for a sample period) | Deploy job dark, compare rollup output against live query for a burn-in period before any endpoint switches to reading the rollup | Switch reads back to direct query; drop summary table | **Low** — purely additive, reversible |
| **F. Backend operational report APIs** | (If not folded into A) finalize `waiting-time`'s real implementation, export endpoints, audit logging on export (§13.2) | A, D (for waiting-time), C | None | None | New export routes + `AuditLog` write on export | Export buttons in the new dashboard section | Export-parity tests (§17) | Direct release | Revert route | **Low** |
| **G. Frontend dashboard** | Full information architecture from §15, including the disabled-widget states and data-quality banner | A (minimum), C/D for full parity | None | None | None | Full page build-out | Frontend component tests + the manual browser verification this document's own delivery mode explicitly excludes (no code was written here) | Direct release, likely behind a nav-entry feature flag for staged rollout | Hide nav entry | **Low** |
| **H. Exports and production verification** | CSV export polish, §19's production-verification checklist executed for real (this document only proposes it, §19) | F, G | None | None | None | None | Production-verification runbook execution (not automated tests) | N/A | N/A | **Low**, but requires the sign-off discipline in §19 |

---

## 17. Test strategy

Following the repository's existing `tsx`-run, `assert`-based test-script convention (each registered as an
individual `npm run test:<name>` entry aggregated into the top-level `test` script, per
`server/package.json:13-15` and exemplified by `reportsClinicScope.test.ts`, `noShow.test.ts`):

1. **Clinic scope** — a `CLINIC_MANAGER`/`RECEPTIONIST` scoped to one clinic never receives another clinic's
   rows from any new endpoint, mirroring `reportsClinicScope.test.ts`'s assertion style.
2. **Organization scope** — an `OWNER`/`ORG_ADMIN` with `canAccessAllClinics` sees an org-wide aggregate that
   sums correctly across all their clinics; one without it is denied the org-wide endpoint entirely.
3. **Unauthorized cross-clinic access** — a targeted `clinicId` outside `allowedClinicIds` returns `403` and
   fires `evaluateCrossTenantDenialSignal` (mirrors the existing `clinicScope.ts:23-41` behavior — assert the
   signal fires, not just the 403).
4. **Timezone boundaries** — an appointment at `23:30` clinic-local on day N, stored as a UTC instant on day
   N+1 (for a negative-UTC-offset clinic) or day N (for positive), buckets into day N's `trends` series, not
   the UTC calendar day.
5. **DST transition** — a repeated-hour case (§11.3): two appointments in the same physical wall-clock hour
   during a fall-back transition both land in the same `busy-hours` bucket, and neither appointment is
   dropped or double-counted.
6. **Day/week/month buckets** — `trends` with `granularity=week` correctly respects the ISO weekday
   convention (§11.4) independent of `firstDayOfWeek` clinic preference, which affects only display ordering.
7. **Zero vs. missing data** — a bucket/status/practitioner with zero occurrences returns `count: 0` (or
   `utilizationPct: null` where "no capacity configured" must be distinguished from "zero utilization," §14),
   never a missing key.
8. **Mutable status bias** — a status-distribution query for a past date range reflects **current** status,
   and a companion test using `AuditLog` replay demonstrates the different (correct, historical) answer for
   the same range, documenting the divergence explicitly (§8.1) rather than treating one as "the bug."
9. **Cancelled/deleted records** — verify the endpoint's explicit `deletedAt` inclusion/exclusion decision
   (§8.2) is applied consistently across every new endpoint, not ad-hoc per route.
10. **No-show denominator** — matches the existing `no-show-analysis` definition exactly (`status != 'cancelled'`
    as the denominator, `reports.ts:469-471`) — a regression test asserting the new endpoint's no-show-rate
    formula is byte-identical in logic to the existing one, per §6 row 15's "reuse verbatim" recommendation.
11. **Request conversion** — `request-to-booking conversion rate` matches a hand-computed value from raw
    `AppointmentRequest` rows for a fixture dataset.
12. **Concurrent event idempotency** — two near-simultaneous writes with the same idempotency key (§9.5)
    result in exactly one `AppointmentLifecycleEvent` row (upsert-on-conflict), mirroring the
    `OperationalEvent.dedupeKey` precedent's own tests if any exist in scope, or a new equivalent.
13. **Append-only event immutability** — no code path in the new service layer issues an `UPDATE` or `DELETE`
    against `AppointmentLifecycleEvent` (a source-text assertion test, mirroring
    `reportsClinicScope.test.ts`'s technique of reading route-file source and asserting on its contents).
14. **Anonymized patient behavior** — after a patient is anonymized, `AppointmentLifecycleEvent.patientId` for
    their historical events is null, and aggregate counts are unaffected (the event row still counts toward
    clinic-level totals, just without patient linkage).
15. **Practitioner filters** — a `DENTIST` caller's `utilization`/`lead-time` results are always scoped to
    `practitionerId = self`, even when a different `practitionerId` is supplied in the query string (mirrors
    `dashboard.ts`'s existing `normalizedRole === 'DENTIST'` narrowing pattern).
16. **Date-range limits** — a request exceeding the 400-day cap (§10.4) returns `400`, not a truncated
    silent result.
17. **Export/API parity** — the CSV export and the JSON API response for the same query parameters produce
    identical figures to the same rounding precision (mirrors the existing `/reports/revenue/export.csv`
    vs. `/reports/revenue` parity implicit in `reports.ts`).
18. **Frontend quality warnings** — a component test confirming the data-quality banner (§15) renders when
    `quality.status !== 'complete'` and is absent when `'complete'`.

---

## 18. Migration and deployment strategy

- Every schema change proposed (§9's `AppointmentLifecycleEvent`, §10.5's `AuditLog` composite index) is
  **additive only** — `CREATE TABLE`/`CREATE INDEX`, never a column drop, type change, or NOT NULL tightening
  on an existing table. This matches the task's "prefer additive, backward-compatible evolution" rule and the
  existing codebase's own convention of NOT NULL backfill migrations being called out explicitly in comments
  (e.g. `schema.prisma:20,27`, "Phase 1b: NOT NULL after backfill").
- Each slice in §16 is deployed independently; slice B's write-path change ships **dark** (writing, unread)
  before any slice A-family endpoint or slice C/F endpoint depends on it, so a write-path bug is caught by
  volume monitoring before it can corrupt a customer-facing metric.
- No migration in this proposal requires a maintenance window — all are additive DDL, consistent with
  Postgres's non-blocking `CREATE TABLE`/`CREATE INDEX CONCURRENTLY` (the composite `AuditLog` index in
  particular should be created `CONCURRENTLY` given `AuditLog` is an append-heavy, unbounded-retention table,
  §4.3).
- No coordination with sibling branches/PRs is performed or assumed (Wave isolation note, top of document).

---

## 19. Rollback and production verification

**No production access, migration, or deploy was performed as part of this review.** The following is a
proposed verification plan for whoever implements §16, not something executed here:

1. **Migration status** — confirm the additive migration(s) for `AppointmentLifecycleEvent` and the `AuditLog`
   composite index applied cleanly with zero downtime, per §18.
2. **Endpoint health** — smoke-test each of the six endpoint families (§14) against a known fixture clinic,
   confirming `200` + the documented response shape, and `403` for a cross-clinic probe.
3. **Sample aggregate consistency** — manually recompute one status-distribution figure and one busy-hour
   figure from raw `Appointment` rows (a direct SQL pull, not the new endpoint) for a representative recent
   week, and confirm exact match against the endpoint's output.
4. **Clinic isolation** — as a single-clinic-scoped test user, confirm no other clinic's counts leak into any
   response, including the aggregate `byStatus`/`buckets` totals (not just absence of per-row detail).
5. **Organization aggregation** — as an org-wide user, confirm the org-level total equals the sum of the
   same query run per-clinic.
6. **Timezone boundaries** — confirm a known appointment near a clinic-local day boundary (e.g. 23:45
   clinic-local) lands in the correct clinic-local day bucket in `trends`, not the UTC day.
7. **No patient identifiers in aggregate responses** — grep the actual JSON response bodies for the fixture
   clinic's known patient first/last names and confirm zero matches.
8. **Query latency** — confirm the busiest new endpoint (`busy-hours` or `trends` over a full year) returns
   within an acceptable P95 for the current data volume; if not, escalate to slice E (§16) sooner than planned.
9. **New error logs** — monitor for new `console.error`/5xx patterns from the new routes in the first 24-48h,
   matching the existing `catch (err) { console.error(...); res.status(500)... }` convention used by every
   route inspected in this review.
10. **Rollback criteria** — any of: (a) the write-path change in slice B measurably increases the p95/p99
    latency or error rate of the appointment status-update endpoint (`PUT /api/appointments/:id`, the hottest
    write path touched); (b) any aggregate figure fails the manual-reconciliation check in item 3; (c) any
    patient identifier is found in an aggregate response (item 7). Any of these triggers an immediate revert
    of the offending slice's deploy, per the per-slice rollback plan in §16's table.

---

## 20. Risks, blockers, and open product decisions

**Risks:**

- The append-only-event write in slice B touches the same transaction path as
  `appointments.ts`'s existing `completed`-status auto-treatment-case-creation logic (`appointments.ts:538-587`)
  — the new event write must not become a new failure mode for that existing, unrelated business flow (mirror
  `operationalEventService.ts`'s "errors are swallowed, never crash the main operation" pattern explicitly).
- `AuditLog`'s lack of a composite index (§4.3, §10.5) means any lifecycle-event-time approximation query
  built against it *before* that index exists risks a slow, possibly-locking full-ish scan on a large,
  unbounded-retention table — the index must ship before any endpoint reads `AuditLog` at scale, not after.
- Small-cohort re-identification (§13.1) is a real risk for any fine-grained breakdown; the suppression
  threshold is asserted as a recommendation (5), not a final legal-approved number.

**Blockers (require a decision before the corresponding slice can start):**

1. **Product decision: is check-in/checkout workflow capture (slice D, §7 candidates C/D/E) in scope for
   NoraMedi at all?** This is a new staff-facing workflow (physically marking a patient as arrived/started/
   finished), not just a reporting change — it has UX and adoption cost independent of the data model. This
   document takes no position on whether it should be built, only that it does not exist today.
2. **Legal/KVKK decision: the small-cell suppression threshold (§13.2)** and whether per-practitioner
   no-show/utilization figures (already shipped today via `/reports/doctor-performance` and
   `/reports/no-show-analysis`, §13.1) require any additional employee-monitoring disclosure this review did
   not evaluate (out of scope — this document is architecture/data-readiness, not a legal opinion).
3. **Product decision: is `updatedAt`-proxy request-response time (§7 candidate B, partial) acceptable to ship
   in slice A/C labeled "partial," or must it wait for slice C's real event capture before shipping at all?**
   This document recommends shipping it labeled `partial` (transparency over withholding), but the final call
   belongs to product.
4. **Confirm the `AuditLog` composite index (§10.5) is scheduled as part of slice A's dependent work**, not
   silently dropped when slice A's route code ships — this document flags it as a prerequisite, not an
   afterthought.

---

## 21. Final recommendation

Ship **slice A** (§16) now: it requires no schema change, reuses every existing tenant-scope and
timezone-formatting primitive already proven correct elsewhere in the codebase (§11.1, §12.2), and closes a
real, present bug (the UTC-vs-clinic-local hour/weekday/month bucketing in `reports.ts`'s existing
`no-show-analysis` route, §6 rows 3/5/6) rather than merely avoiding a hypothetical one. Do **not** ship a
"waiting time" widget of any kind until slice D's check-in/checkout capture exists and product has explicitly
approved building that workflow (§20 blocker 1) — per the task's decision rules, an unmeasurable metric must
never be presented as measurable, and no amount of UI polish substitutes for the missing timestamp. Build
`AppointmentLifecycleEvent` (§9) as the single, deliberately-named-to-avoid-collision (§4.4) foundation for
every metric this review marked **P** rather than **M**, reusing the `LabWorkOrderStatusHistory` precedent
(§4.5) already proven in this codebase instead of inventing a new shape.

---

## Standard final report

### 1–7. Task identity and frozen execution context

- ClickUp ID: `86eydm64q`
- ClickUp URL: https://app.clickup.com/t/86eydm64q
- Task name: US-07.4 · Operational analytics dashboard
- Execution baseline: `5dc5ad67c7e9feee11f6fece9a7d65e03033d2fb`
- Branch: `docs/us-07-4-operational-analytics-architecture`
- Worktree: `E:\Ek Gelir\Siteler\DisKlinikCRM-worktrees\us-07-4-operational-analytics-architecture`
- Commit SHA / PR: recorded after commit and push (see chat response for this run)
- File changed: `docs/architecture/reviews/US-07-4_OPERATIONAL_ANALYTICS_ARCHITECTURE.md` (this file, the
  only file this task modifies)

### 8–11. Measurability summary

- **Current measurable metrics (M):** appointment count by status; completed/cancelled/no-show distribution;
  busy hour by creation time; request-to-booking conversion rate; no-show rate; average (scheduled)
  appointment duration; booking lead time (§6 rows 1, 2, 4, 13, 15, 16, 10).
- **Partially measurable metrics (P):** busy hour by start time and weekday/monthly trend (measurable in
  principle, but the only existing implementation has a UTC-vs-clinic-local bug, §6 rows 3, 5, 6);
  practitioner and clinic schedule/utilization (exact numerator, complex-but-derivable denominator, §6 rows 8,
  17); cancellation lead time (depends on an `AuditLog`-approximated event time, §6 row 14); request response
  time (rough `updatedAt` proxy only, §6 row 12, §7 candidate B).
- **Non-measurable metrics (N):** room/chair utilization (no model exists, §6 row 9); patient waiting-room
  time, practitioner delay, total clinic visit time (§7 candidates C, D, E — no check-in/checkout timestamps
  exist anywhere in the schema).
- **Waiting-time verdict:** of five candidate definitions, only booking lead time (A) is measurable now;
  request response time (B) is partially measurable via an unreliable proxy; patient waiting-room time (C),
  practitioner delay (D), and total visit time (E) are **not measurable** — no check-in/actual-start/checkout
  timestamp exists in any form (§7).

### 12. New event model required?

**Yes** — `AppointmentLifecycleEvent` (§9), scoped narrowly to what `AuditLog`/`ActivityLog` do not already
provide (request-response timing now; check-in/checkout timing only pending a product decision, §20). It is
deliberately not a reuse of the existing `OperationalEvent` model (name collision, wrong retention policy,
wrong frontend surface, §4.4) and deliberately not a duplication of `AuditLog`'s already-reliable
status-transition evidence (§8.4).

### 13. Proposed implementation slices

A (current-data metrics, no schema change) → B (lifecycle event capture) → C (request response/conversion) →
D (check-in/checkout, gated on a product decision) → E (aggregation/indexing) → F (finalize backend APIs,
export+audit) → G (frontend dashboard) → H (exports + production verification). Full detail in §16.

### 14. Tenant/privacy risks

Cross-tenant leakage risk is mitigated by reusing the existing `clinicScope.ts` contract verbatim (§12); the
material privacy risks are (a) per-practitioner metrics being employee-monitoring-adjacent data already
shipped today, unreviewed by this document (§13.1), and (b) small-cohort re-identification in fine-grained
breakdowns, requiring a legal-approved suppression threshold before shipping anything finer than clinic ×
month (§13.2, §20 blocker 2).

### 15. Validation commands and results

```text
$ git diff --check
(no output — no whitespace/conflict-marker errors)

$ git status --short
?? docs/architecture/reviews/US-07-4_OPERATIONAL_ANALYTICS_ARCHITECTURE.md
```

**Note on the third specified validation command:** the task instructions specify
`git diff --name-only 50e9650136eacdb7153742db7892f17f18752c15...HEAD`. That SHA is **18 commits behind this
task's own frozen baseline** (`5dc5ad67c7e9feee11f6fece9a7d65e03033d2fb`) — `git merge-base --is-ancestor`
confirms it is an ancestor of the baseline, not a sibling or divergent point. Running it as literally
specified therefore also surfaces ~18 pre-existing `docs/program/**` files from unrelated, already-merged
F2-PREP-006 imaging-boundary work that predates this task and was never touched here:

```text
$ git diff --name-only 50e9650136eacdb7153742db7892f17f18752c15...HEAD
docs/program/CURRENT_PHASE.md
docs/program/NORAMEDI_MASTER_TRACKER.md
docs/program/architecture/F2-PREP-005_CONSOLIDATED_MODULARIZATION_CHARTER.md
docs/program/architecture/F2-PREP-006-E_IMAGING_BOUNDARY_CONTRACT.md
... (14 more docs/program/** files from PRs #288/#291/#292, merged before this task's baseline)
docs/architecture/reviews/US-07-4_OPERATIONAL_ANALYTICS_ARCHITECTURE.md
```

The correct isolating check — this task's actual frozen baseline to `HEAD` — confirms the requirement is met:

```text
$ git diff --name-only 5dc5ad67c7e9feee11f6fece9a7d65e03033d2fb...HEAD
docs/architecture/reviews/US-07-4_OPERATIONAL_ANALYTICS_ARCHITECTURE.md
```

`docs/architecture/reviews/US-07-4_OPERATIONAL_ANALYTICS_ARCHITECTURE.md` is the only file this task changed,
confirmed against both `git status --short` and a diff against this task's own frozen baseline. The literal
SHA given in the validation instructions predates that baseline and is flagged above rather than silently
substituted.

### 16. Confirmation of no code/schema/migration/package/CI changes

- No `.ts`/`.tsx` file modified.
- No `server/prisma/schema.prisma` or migration file modified.
- No `package.json`/`package-lock.json` modified.
- No CI workflow file modified.
- No `docs/program/**` tracker file modified.
- Only the single allowed output file was created.

### 17. Confirmation of no merge, deploy, production access, sibling reconciliation, or destructive commands

- No merge performed; no push to `main`.
- No deploy performed.
- No production database or environment accessed.
- No sibling branch/PR inspected, fetched, merged, cherry-picked, rebased onto, or reconciled (Wave isolation
  note, top of document).
- No destructive Git command (`reset --hard`, `push --force`, `clean -f`, branch deletion) run.
- No secrets or `.env` content read or exposed.

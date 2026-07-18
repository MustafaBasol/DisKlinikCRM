# F0-004 Evidence — Cross-Module Dependency Map

Task: F0-004 — Cross-Module Dependency Map · Phase: F0 · Scope: repository-only, documentation-only.

This document is the detailed evidence base behind [`DEPENDENCY_MAP.md` §10](../DEPENDENCY_MAP.md#10-bağımlılık-matrisi-f0-004--depo-kanıtıyla-dolduruldu). The structured/machine-readable form is [`F0-004_dependency_inventory.json`](F0-004_dependency_inventory.json) (833 edges, 35 cycles, 15 contract candidates, 16 raw-SQL locations). This document explains methodology, correction candidates, the high-risk findings, cycle analysis, fan-in/fan-out, hotspots, raw SQL, frontend composition, and contract candidates in prose with citations.

## 1. Methodology and scope

- Baseline: commit `131c7cc398fde6c72fea275a40b7efcc1253b828` (`origin/main` HEAD, PR #168 merge commit — confirmed via `gh pr view 168`: `state: MERGED`, `mergedAt: 2026-07-18T18:27:09Z`). Work was performed in an isolated git worktree (`git worktree add`) checked out from `origin/main`, so the working tree is byte-identical to the committed baseline — no `git show` indirection was needed.
- **Domain set:** the 37-entry domain list from [`F0-003_module_ownership_inventory.json`](F0-003_module_ownership_inventory.json) `domains[]` (F0-003, merged). No domain was renamed, merged, or split.
- **Primary method — mechanical scan, not a single broad CodeGraph pass:** a Node script built a file→domain map from F0-003's committed `backend.{routes,services,middleware,jobs,utils}` file lists, then scanned every domain-owned file (after stripping `/* */` and `//` comments, to avoid matching JSDoc usage examples) for:
  1. Relative (`./`/`../`) `import`/`require` statements resolving into a file owned by a **different** domain → `IMPORT` edge.
  2. `prisma.<model>.<method>(` and `tx.<model>.<method>(` call sites where `<model>` is owned (per F0-003 §3's Prisma-model-ownership table) by a **different** domain → `DATA_READ` edge (read methods: `findMany/findFirst/findUnique(OrThrow)/count/aggregate/groupBy`) or `DATA_WRITE` edge (write methods: `create(Many)/update(Many)/upsert/delete(Many)`).
  3. Each match also records the nearest enclosing Express route (`router.METHOD('/path', ...)`, walking forward across line-wrapped route declarations) or named function, so every edge has a `sourceSymbol` in addition to `file:line` — 525/526 data edges and all import edges resolved a symbol.
- This produced **307 IMPORT edges and 526 DATA edges (833 total)** across **224 populated matrix cells**, each with `file:line` + code snippet.
- **Manual/targeted supplement:** the 6 F0-003 hotspot files, all 16 raw-SQL locations, the highest fan-out/fan-in domain pairs, and a handful of frontend pages were individually read (`Read`/`Grep`) to confirm context, operation semantics (e.g. distinguishing a genuine booking write from a generic-utility read-on-behalf-of-owner), and to catch cases the mechanical scan could mis-signal.
- **Governance classification:** every edge received one of the 8 letter classifications (A–H) defined in the task instructions. **264 of 833 edges (32%) were individually reviewed** (pair-level or single-edge overrides, each with a written rationale — see `final edges' uncertaintyNotes`/`recommendedFutureBoundary` fields). The remaining 569 use **documented, deterministic default rules**, disclosed here so a rule-derived classification is never mistaken for individually-verified judgment:
  - Source domain `core-tenant-security` → always `A` (ACCEPTED_PLATFORM): its only outbound file, `utils/relationGuards.ts`, is a generic cross-model tenant-ownership check invoked *on behalf of* the calling domain, not Core consuming Feature business logic.
  - Target domain in `{Identity and Access, Tenant Security and Scope, Permissions/Roles, Audit and Activity, Configuration and Secrets, Observability/Operational Events, Shared Events/Queue/Idempotency, Storage Abstraction, Notifications}` → `A` (these are exactly the domains `DEPENDENCY_MAP.md` §7/§8 already names as "Core bileşenleri").
  - Target domain `Organization/Clinic/User Membership` on a **read/import** → `A` (root tenant entities, "read by nearly every domain" per F0-003 §3); on a **write** → falls through to the default write rule below (not blanket-accepted).
  - Any remaining cross-domain **write** → `D` (TRANSITIONAL_COMMAND_COUPLING), risk `medium`.
  - Any remaining cross-domain **read** → `C` (TRANSITIONAL_QUERY_COUPLING), risk `low`.
  - Any remaining **import/service-call** → `B` (ACCEPTABLE_CURRENT_COLLABORATION), risk `low`.
- **Known limitations** (also recorded in the JSON `coverage.knownLimitations`):
  1. The scanner resolves only relative in-repo imports and direct `prisma`/`tx` model-method calls; it does not follow dynamic imports, barrel re-exports, or a same-domain wrapper function that itself calls into another domain deeper in the call graph. Spot checks (hotspot files, `channelConsentGate.ts`, `treatmentStockDeduction.ts`) did not surface this pattern, but it is not exhaustively ruled out.
  2. `bridge-agent/` and `windows-bridge/` internals remain out of scope per F0-003's CODEGRAPH-DISCIPLINE-scoped roots; `imaging-device-bridge` edges reflect only `server/src/` evidence.
  3. Frontend coverage is targeted, not exhaustive across all 64 pages (see §8).
  4. `server/src/index.ts`'s raw SQL and `services/security/securityIncidentService.ts`'s raw SQL were not audited statement-by-statement (F0-003 already flagged this; F0-004 did not close it — see §7 and `unresolved[]` in the JSON).

## 2. F0-003 correction candidates (recorded, not silently rewritten)

Per task instructions, these are recorded as correction candidates with exact evidence; **no domain taxonomy change was made**.

### 2.1 Four backend files listed under two F0-003 domains simultaneously

`F0-003_module_ownership_inventory.json`'s committed `domains[].backend` arrays list the following 4 files under **two** domains each, without a "shared" annotation:

| File | Listed under | F0-004 resolution for edge-counting purposes |
|---|---|---|
| `server/src/routes/organizationDashboard.ts` | `core-org-clinic-membership` AND `reporting-analytics` | Canonical owner = `reporting-analytics`. Content is pure dashboard/count aggregation (`prisma.appointment.count`, etc.), matching its sibling `dashboard.ts`/`reports.ts` in the same domain; it owns no Prisma models itself (consistent with Reporting/Analytics having none). |
| `server/src/utils/encryption.ts` | `core-privacy-consent-retention-dsr` AND `core-config-secrets` | Canonical owner = `core-config-secrets`. F0-003 §7 itself lists `encryption.ts`/`secrets.ts` under "True platform primitives, correctly placed" — a single canonical home is the more defensible reading; Privacy's use of it is a normal `ACCEPTED_PLATFORM` import. |
| `server/src/utils/secrets.ts` | `core-privacy-consent-retention-dsr` AND `core-config-secrets` | Same as above. |
| `server/src/services/treatmentStockDeduction.ts` | `clinical-dental-chart-procedures` AND `inventory` | Canonical owner = `inventory`. This file **is** the exact cross-domain write F0-003 §4 already flagged ("Dental Chart / Procedures → Inventory ... direct write of InventoryTransaction"); treating it as Inventory-owned and Dental-Chart-importing-it produces the correct single directional edge instead of double-counting. |

**Why this matters:** without resolving these to one canonical owner, the mechanical scan would double-count each file's outbound edges under two different "source domains" (verified: `organizationDashboard.ts` alone produced 11 edges attributed to `core-org-clinic-membership` and 15 attributed to `reporting-analytics` from the *same* 26 call sites, before resolution). This is flagged for external review of `F0-003_module_ownership_inventory.json`; F0-004 did not edit that file.

### 2.2 No taxonomy-level errors found

Beyond the file-ownership duplicates above, no domain was found to be materially misclassified. `ContactRequest`/`Messaging — Email`'s ambiguous ownership (already flagged by F0-003 §10 item 7) was re-observed but not resolved here — it remains an F0-003-owned open question.

## 3. High-risk boundary violations (9 edges, all `G` / `X`)

All 9 are `Messaging — WhatsApp`/`Messaging — Instagram` → `Patients`/`Appointments and Availability`, matching the task instructions' own worked example ("messaging directly writes Patient/User records") almost exactly.

| Edge ID | Source → Target | File:Line | What |
|---|---|---|---|
| F0004-E0695 | WhatsApp → Patients | `routes/whatsapp.ts:1179` | `Patient.create` |
| F0004-E0696 | WhatsApp → Patients | `routes/whatsapp.ts:1212` | `Patient.update` |
| F0004-E0702 | WhatsApp → Patients | `services/whatsapp/metaWhatsAppAiProcessor.ts:708` | `Patient.update` |
| F0004-E0703 | WhatsApp → Patients | `services/whatsapp/metaWhatsAppAiProcessor.ts:724` | `Patient.create` |
| F0004-E0608 | Instagram → Patients | `services/instagram/instagramAiConversationProcessor.ts:924` | `Patient.create` |
| F0004-E0670 | WhatsApp → Appointments | `routes/whatsapp.ts:1518` | `Appointment.update` (status change, AI conversation flow) |
| F0004-E0674 | WhatsApp → Appointments | `routes/whatsapp.ts:2625` | `Appointment.update` |
| F0004-E0675 | WhatsApp → Appointments | `routes/whatsapp.ts:2646` | `Appointment.update` |
| F0004-E0684 | WhatsApp → Appointments | `routes/whatsappInbox.ts:757` (`route POST /whatsapp/inbox/:id/create-appointment`) | `Appointment.create` |

**Why `routes/whatsappInbox.ts:757` is the most severe of the nine:** it is a staff-facing "book an appointment from the WhatsApp inbox" action that re-implements its own overlap check (`prisma.appointment.findFirst({ where: { ..., status: { notIn: ['cancelled'] }, OR: [...] } })`, lines 740-749) and then calls `prisma.appointment.create` directly — **without** the `pg_advisory_xact_lock` concurrency guard that the Appointments domain already uses for the identical class of operation elsewhere in the same domain (`server/src/services/appointmentRequestSafety.ts`, used by `routes/publicBooking.ts`). Two staff members clicking "book" for the same practitioner/slot at the same moment from two different WhatsApp conversations could both pass the overlap check before either commits — a real double-booking race condition that the domain's own safer pattern already exists to prevent, just not here.

Patient-write edges (`E0608`, `E0695`, `E0696`, `E0702`, `E0703`) bypass whatever validation/dedup logic `routes/patients.ts` applies to Patient creation — matching patients purely by phone number inside the messaging layer.

**Recommendation:** `CC-04` (Appointment booking/cancellation command, §10 below) is the single highest-priority contract candidate — it would close all 4 Appointment-write violations and force reuse of the existing advisory-lock pattern. `CC-02` (Patient creation/update command) would close the remaining 5.

## 4. Data access review (cross-domain Prisma access summary)

Full detail is in the JSON `edges[]` array (526 `DATA_READ`/`DATA_WRITE` entries). Headline patterns, grouped by the models named in the task's "pay special attention to" list:

- **Patient / User:** read cross-domain by Messaging (WhatsApp/Instagram, both directions of the god-module pattern — see §6), Privacy (anonymization/export), Public Booking (existing-patient lookup only, no create), Dental Chart, Tenant Security (`relationGuards.ts`, accepted-platform). **Written** cross-domain only by Messaging (the 5 `X`-flagged Patient writes in §3) and by Organization/Clinic/Membership's own `User` writes (staff onboarding — `User` is Identity-and-Access-owned but managed through Org/Membership's routes; see the `core-org-clinic-membership↔core-identity-access` cycle note in §5).
- **Appointment / AppointmentRequest / ContactRequest:** written cross-domain by Public Booking (`AppointmentRequest.create`, inside an advisory-lock transaction — the safe pattern), Messaging WhatsApp/Instagram (`AppointmentRequest.create` — accepted multi-source-intake per the schema's `source` field — **plus** the 4 direct `Appointment.create/update` violations in §3), and Privacy (`ContactRequest.updateMany`/`AppointmentRequest.updateMany` for anonymization redaction).
- **Payment / PaymentPlan / PractitionerEarning:** read cross-domain by Advanced Finance (`earningService.ts` reads `Payment` directly — F0-003's own "legitimate business collaboration" example) and Reporting (`routes/reports.ts` — aggregate + raw-SQL reads). No cross-domain writes found to Payment models.
- **InventoryItem / InventoryTransaction:** written directly by **both** Treatment Cases (`routes/treatmentCases.ts`, `routes/treatmentPackages.ts`) and Dental Chart/Procedures (via `services/treatmentStockDeduction.ts`, canonically Inventory-owned per §2.1) — two independent cross-domain write paths into the same target domain, both candidates for `CC-10` (Inventory stock-adjustment command).
- **TreatmentCase / Procedure records:** read cross-domain by Dental Chart (own procedures need their parent case), Inventory, Reporting, Advanced Finance, Recall/Automation.
- **MessageTemplate:** confirmed genuinely shared (used by both WhatsApp's Meta-template binding and SMS's `templateId`) — F0-003 already classified this correctly as "Shared Contract/Reference Data"; excluded from per-edge cross-domain counting as designed.
- **Messaging conversation/message/state models** (`WhatsAppConversationMessage`, `WhatsAppInboxEntry`, `InstagramInboxEntry`, `InstagramConversationMessage`): read cross-domain by Patients (`routes/patients.ts` — communication-history tab) and **written** cross-domain by Privacy's raw-SQL redaction (§7) — the most sensitive cross-domain write pattern found (PII inside conversation payloads, mutated outside the owning domain's write path).
- **AuditLog / ActivityLog:** written by many domains as designed (F0-003 already documented this); Privacy additionally redacts `ActivityLog.description` during anonymization — expected DSR behavior.
- **Privacy/consent models** (`PatientPrivacyRequest`, `ChannelConsentLog`, `PublicBookingNoticeEvidence`): read by Messaging (`channelConsentGate.ts` — WhatsApp/Instagram checking consent before sending), consistent with F0-003's positive "legitimate collaboration" framing of `ChannelConsentLog`.
- **Imaging models:** `ImagingImage`/`ImagingStudy` written cross-domain by Privacy (legalHold-aware redaction). `ImagingBridgeAgent`/`ImagingBridgePairing` (Device Bridge-owned) read/locked via raw SQL from `routes/imaging.ts` (Server/Viewer-owned) and vice versa — the imaging cycle (§5).
- **Platform settings/provider credentials:** `ClinicSmsSettings` (SMS-owned) written directly by Platform Administration (`platformAdmin.ts:652`, `.upsert`) — Platform Admin's designed cross-tenant configuration role.

No instance was found of a non-owning domain importing another domain's *provider adapter* internals (e.g. a non-messaging file importing `EvolutionWhatsAppProvider.ts`) — consistent with F0-003 §4's spot-check finding that violations in this codebase are direct-table-access-shaped, not adapter-leak-shaped.

## 5. Cycle analysis

**35 two-domain mutual dependency pairs** were detected (both `A→B` and `B→A` have at least one proven edge). 5 were individually reviewed; the remaining 30 are low-signal (most are a single trivial import in one direction against a substantial dependency in the other — e.g. `Appointments→Recall` is one import while `Recall→Appointments` is 10 real reads; not a meaningful cycle in practice). Full list with edge-ID references is in the JSON `cycles[]` array.

### 5.1 Individually-reviewed cycles

| Domains | Cause | Risk | Recommended direction to break |
|---|---|---|---|
| Appointments and Availability ↔ Organization/Clinic/Membership | Platform primitive misuse — `routes/users.ts` (Org/Membership) directly creates/deletes `DoctorAvailability` (Appointments-owned) | medium | Move `DoctorAvailability` CRUD out of `routes/users.ts` into Appointments' own `routes/schedules.ts`. This is a **file-ownership fix**, not a new contract — Appointments already has the right route file. |
| Privacy/Consent/Retention/DSR ↔ Messaging — WhatsApp | Orchestration (Privacy writes WhatsApp tables) + service call (WhatsApp reads Privacy's consent gate) | high | Keep WhatsApp→Privacy (`channelConsentGate.ts` check) as the correct accepted-platform direction. Replace Privacy→WhatsApp redaction writes with a `PatientAnonymized` event consumed by Messaging-WhatsApp (`CC-09`). |
| Treatment Cases ↔ Inventory | Shared data model — both write into each other's stock/application state | medium | Introduce `CC-10` (Inventory stock-adjustment command); Treatment Cases calls it instead of writing `InventoryItem`/`InventoryTransaction` directly. Inventory→TreatmentCases (updating `TreatmentPackageApplication` status after deduction) can remain as the command's synchronous return value. |
| Imaging — Server/Viewer ↔ Imaging — Device Bridge | Shared data model — both sides run row-locking raw SQL against the other's tables | medium | Introduce a `BridgeStatus` query contract (Server/Viewer reads bridge state) and a `StudyIngested` event (bridge notifies Server/Viewer of new studies) instead of direct/raw-SQL cross-reads. Given how tightly coupled these two domains already are, also worth flagging as an ADR-001 input on whether they belong in one bounded context (observation only — not proposed here as a taxonomy change). |
| Identity and Access ↔ Organization/Clinic/Membership | Shared data model — `User` is Identity-owned but created/updated through Org/Membership's staff-management routes (`clinicRegistration.ts`, `users.ts`, `usersImport.ts`, `organizationBranches.ts`) | low | Expected for two core-platform domains sharing the tenant/user graph. Flagged as an ADR-001 input on whether "who can access this tenant" (Identity + Membership) should be one bounded context, not an enforcement target. |

## 6. Fan-in / fan-out

Computed from the final 833-edge set (counts = number of distinct cross-domain edges, not distinct pairs).

**Highest fan-out (god-module signal):**

| Domain | Outbound edges |
|---|---|
| Messaging — WhatsApp | 106 |
| Privacy / Consent / Retention / DSR | 97 |
| Reporting / Analytics | 67 |
| Platform Administration | 64 |
| Automations / Reminders / Follow-up / Recall | 62 |
| Appointments and Availability | 57 |
| Messaging — Instagram | 54 |

**Highest fan-in (core-platform signal — expected and healthy for these domains):**

| Domain | Inbound edges |
|---|---|
| Organization / Clinic / User Membership | 128 |
| Appointments and Availability | 116 |
| Identity and Access | 114 |
| Audit and Activity | 68 |
| Patients | 52 |
| Messaging — WhatsApp | 49 |
| Tenant Security and Scope | 39 |

Messaging — WhatsApp is the only domain that is simultaneously in **both** top-7 lists (106 out, 49 in) — the clearest single "god module" signature in the codebase, directly corroborating F0-003's file-level finding that `routes/whatsapp.ts` (3999 lines) embeds conversation-AI, patient-matching, and booking-flow business logic inside what should be a thin webhook route. Privacy's high fan-out (97) is driven almost entirely by the anonymization/export/retention orchestration described in §3/§4 — a single legally-mandated cross-cutting concern touching many domains' tables, not diffuse coupling.

## 7. Hotspots (no refactor performed)

Per task instructions, the following were investigated for dependency edges only — **no code was changed**.

- **`server/src/routes/whatsapp.ts`** (3999 lines, F0-003 hotspot): source of 5 of the 9 high-risk edges (§3), plus the bulk of the 106 WhatsApp-domain outbound edges. Confirms F0-003's strangler-sequence recommendation (extract patient-matching/creation first, then booking flow, leaving a thin webhook route) as the correct priority order — the patient/appointment writes found here are exactly what F0-003 predicted would be found.
- **`server/src/routes/platformAdmin.ts`** (1201 lines/40 routes, F0-003 hotspot): 64 outbound edges spanning Identity, Org/Membership, SMS, Security-Incident, Privacy, Appointments, Patients — confirms the file spans 5+ admin sub-areas with no internal module split, as F0-003 found. Its one raw-SQL statement is a harmless `SELECT 1` health check.
- **`server/src/routes/reports.ts`** (512 lines, F0-003 hotspot): 3 raw-SQL statements over `Payment` and `Appointment` (all single-table, `clinicId`-parameterized — see §8), plus ordinary Prisma aggregate/read edges into Payments, Appointments, and Treatment Cases. No cross-table raw-SQL joins were found (each raw-SQL statement queries exactly one table).
- **`server/src/routes/imaging.ts`** (1303 lines/27 routes, F0-003 hotspot): stays within the Imaging domain as F0-003 predicted, except for the `imaging-server-viewer↔imaging-device-bridge` cycle documented in §5.
- **Messaging AI processors** (`metaWhatsAppAiProcessor.ts`, `instagramAiConversationProcessor.ts`): source of 4 of the 9 high-risk Patient-write edges (§3) — the AI conversation flow auto-creates Patient records from inbound message matching.
- **Reminder/follow-up jobs** (`jobs/reminders.ts`): `JOB_TRIGGER`-shaped — directly creates/updates `SentMessage` (WhatsApp-owned) when dispatching reminders, the exact pattern `CC-11` (Messaging send command) would replace.

No hotspot file was modified, split, or refactored in this task.

## 8. Raw SQL inventory (16/16 reconciled with F0-003)

F0-003 counted 16 files containing `$queryRaw`/`$executeRaw`/`$queryRawUnsafe`/`$executeRawUnsafe`. An independent `Grep -r '\$queryRaw|\$executeRaw' server/src` in this task found the same 16 files (12 production + 4 test). Full structured detail is in the JSON `rawSql[]` array; summary:

| File | Domain | Tables touched | Cross-domain? | Op | Parameterization | Risk |
|---|---|---|---|---|---|---|
| `routes/reports.ts` | Reporting/Analytics | Payment, Appointment | yes (both are foreign to Reporting, which owns no models) | read | Positional params for values; the `groupBy` period unit ("day"/"week"/"month") is whitelist-validated then string-interpolated into the SQL text (not a bind parameter, but not user-controlled either) | medium |
| `routes/platformAdmin.ts` | Platform Administration | none | no | health-check (`SELECT 1`) | n/a | low |
| `routes/operationalMonitoring.ts` | Observability | none | no | health-check (`SELECT 1`) | n/a | low |
| `routes/imaging.ts` | Imaging — Server/Viewer | ImagingDevice, **ImagingBridgeAgent** | yes (ImagingBridgeAgent is Device-Bridge-owned) | read (`FOR UPDATE` row lock, in-transaction) | `Prisma.sql` tagged template — safely parameterized | low |
| `routes/imagingBridgePublic.ts` | Imaging — Device Bridge | ImagingBridgePairing | no | read (`FOR UPDATE` row lock, in-transaction) | `Prisma.sql` tagged template — safely parameterized | low |
| `services/security/securityIncidentService.ts` | Security Incident Detection | not audited line-by-line | unresolved | unresolved | unresolved | medium |
| `services/privacy/clinicBulkExportPackage.ts` | Privacy | none (advisory lock only) | no | `pg_advisory_xact_lock` | tagged template, parameterized | low |
| `services/privacy/clinicBulkExportPasswordAttempts.ts` | Privacy | none (advisory lock only) | no | `pg_advisory_xact_lock` | tagged template, parameterized | low |
| `services/privacy/patientPrivacyExportPackage.ts` | Privacy | none (advisory lock only) | no | `pg_advisory_xact_lock` | tagged template, parameterized | low |
| `services/privacy/patientAnonymization.ts` | Privacy | **WhatsAppConversationMessage, WhatsAppInboxEntry, InstagramInboxEntry, InstagramConversationMessage** | **yes — 4 foreign tables, direct UPDATE** | write (`UPDATE ... SET "rawPayload" = NULL`) | tagged template, parameterized — safe from injection | **high** (not an injection risk — the risk is the direct cross-domain write path bypassing Messaging's own write path; see §3/§4/`CC-09`) |
| `services/appointmentRequestSafety.ts` | Appointments | none (advisory lock only) | no | `pg_advisory_xact_lock` | tagged template, parameterized | low — this is the **safe pattern** `routes/whatsappInbox.ts:757` (§3) should have reused |
| `server/src/index.ts` | core bootstrap (unowned by any F0-003 domain file list) | not audited; F0-003 assumed startup/health-check | unresolved | unresolved | unresolved | low |
| 4 test files (`publicBookingAvailability.test.ts`, `publicBookingSlotConsistency.test.ts`, `imaging.test.ts`, `appointmentRequestOverlapSafety.test.ts`) | test-only | n/a | n/a | test fixture/assertion | n/a | n/a — F0-005 scope |

**Net finding:** every raw-SQL statement that touches a real table uses parameterized `Prisma.sql`/tagged-template syntax or positional bind parameters — **no SQL-injection pattern was found** in any of the 16 locations (the one string-interpolated fragment in `reports.ts` is whitelist-validated, not user-controlled). The risk in this domain is architectural (cross-domain writes bypassing owning-domain write paths), not an injection vulnerability. 2 files (`securityIncidentService.ts`, `index.ts`) remain unaudited line-by-line, carried forward to F1 per F0-003's own deferral.

## 9. Frontend cross-domain composition

Targeted, not exhaustive (see §1 limitations). `src/services/api.ts` (842 lines) is confirmed as a single shared axios client used by every frontend domain — CSRF header injection and clinic-scope query-param injection happen once, centrally, in its interceptors (a genuine `SHARED_PLATFORM`/`ACCEPTED_PLATFORM` example, already noted by F0-003 under Identity and Access's frontend services).

- **`src/pages/PatientDetail.tsx`** (Patients-owned) directly imports components from **8 other domains**: `DentalChart` (Dental Chart/Procedures), `PatientPrivacyPanel` (Privacy), `TaskForm` (Tasks), `TreatmentCaseForm` (Treatment Cases), `PaymentForm` (Basic Payments), `PrepareMessageModal` (Messaging-WhatsApp), `InsuranceProvisionForm` (Insurance), `PatientImagingTab` (Imaging), plus `FilePreviewModal` (Storage, accepted-platform). This is the frontend mirror of Patient's highest-fan-in backend position (§6) — a legitimate "patient-360" composition hub, but any breaking change in any of those 8 domains' shared components has a wide blast radius through this one page. No test-coverage claim is made here (F0-005 scope).
- **`routes/organizationDashboard.ts`/`routes/dashboard.ts`** (Reporting-owned, see §2.1) back `src/pages/Dashboard.tsx`/`OrganizationDashboard.tsx`, composing counts across Appointments, Payments, Patients, Treatment Cases — the frontend side of Reporting's wide fan-out.
- **`WhatsAppInbox.tsx`/`InstagramInbox.tsx`** compose Messaging conversation state with Patient linking, consistent with the backend inbox routes' `Patient.findMany` reads (§4).
- **`publicBooking.ts`** (backend) imports `services/whatsappAvailability.ts` (Messaging AI Orchestration-owned) to compute available slots for the public booking widget — a **misplaced-shared-utility** finding: channel-agnostic slot-computation logic currently lives inside the WhatsApp-named domain rather than a shared Appointments-owned utility. Recorded as an observation with a low-cost fix (relocate the function), not a data-safety risk.

## 10. Contract candidates

All 15 candidates below are derived only from proven edges (never from roadmap intent). Full field detail (minimum fields, sensitive fields excluded, tenant context, versioning) is in the JSON `contractCandidates[]` array; summary:

| ID | Contract | Owner | Replaces (edge count) | Sync/Async | Phase |
|---|---|---|---|---|---|
| CC-01 | PatientDirectory / PatientReferenceQuery | Patients | all cross-domain Patient reads | sync | F2 |
| CC-02 | Patient creation/update command | Patients | Messaging's Patient writes (incl. 5 of the 9 `X` edges) | sync | F2 |
| CC-03 | AppointmentReferenceQuery | Appointments | all cross-domain Appointment/AppointmentType/etc. reads | sync | F2 |
| CC-04 | Appointment booking/cancellation command | Appointments | the 4 direct `Appointment.create/update` `X` edges (§3) | sync, must reuse `pg_advisory_xact_lock` | **F2 — highest priority** (closes the most severe violations) |
| CC-05 | AppointmentCompleted / ProcedureCompleted event | Appointments / Dental Chart | (future — no current edge to replace) | async | F6 |
| CC-06 | PaymentReceived event | Basic Payments | Finance/Reporting/Recall's Payment reads | async (event) + sync (query) | F6 / F2 |
| CC-07 | ImagingStudyReceived event | Imaging — Server/Viewer | the imaging-server-viewer↔imaging-device-bridge cycle edges | async | F6 / F10 |
| CC-08 | LegalHold contract | Privacy | Privacy's ImagingImage/Patient legalHold writes | sync | F2 |
| CC-09 | PatientAnonymized domain event | Privacy | Privacy's WhatsApp/Instagram redaction writes (§3/§4/§8) | async | F6 (until then, current direct-write pattern remains the pragmatic KVKK mechanism) |
| CC-10 | Inventory stock-adjustment command | Inventory | Treatment Cases' + Dental Chart's InventoryItem/InventoryTransaction writes | sync | F2 |
| CC-11 | Messaging send command (channel-agnostic) | new shared messaging layer (no current owner) | Recall/Automation's direct SentMessage writes | sync | F2 |
| CC-12 | Consent/Privacy evidence service | Privacy | Messaging's consent-gate reads (already exists informally as `channelConsentGate.ts`) | sync | F2 |
| CC-13 | Reporting read-model boundary | Reporting | all of Reporting's cross-domain reads (67 edges) | sync, against a derived read model | F11 |
| CC-14 | StoragePort | Storage Abstraction | all cross-domain reads of `core-storage-abstraction` | sync | F4 |
| CC-15 | AiProvider / AiGateway port | AI Platform/Gateway (not yet implemented) | (future — `messaging-ai-orchestration` calls `googleAiStudio.ts` directly today) | sync + async metering | F8 |

No contract, event, or port was implemented in this task.

## 11. Unresolved / explicitly unverified items

1. `services/security/securityIncidentService.ts` raw SQL — table(s) and tenant-predicate unknown (not audited line-by-line). Follow-up: F1.
2. `server/src/index.ts` raw SQL — assumed health-check per F0-003, not independently confirmed. Follow-up: F1.
3. 569 of 833 edges (68%) use documented rule-derived default classification rather than individual narrative review (§1) — treat these as real, evidenced edges with a provisional governance label, not as individually-vetted findings. Follow-up: F1/F2, before any contract implementation depends on a specific rule-derived edge.
4. The 3 F0-003 dual-ownership file listings (§2.1) are flagged, not corrected in `MODULE_MAP.md`/`F0-003_module_ownership_inventory.json`. Follow-up: F0-003 owner / external review.
5. Frontend cross-domain composition (§9) is targeted, not exhaustive across all 64 pages.
6. Whether `ContactRequest` and `Messaging — Email`'s F0-003-flagged ambiguous ownership should be resolved remains open (F0-003's own unresolved item, re-observed not re-litigated here).
7. `bridge-agent/`/`windows-bridge/` internals remain unscanned (out of CODEGRAPH-DISCIPLINE scope per F0-003 and this task).
8. Whether F0-002 Stage B (production evidence, still `BLOCKED`) would confirm or contradict any assumption here — none was made; this map is 100% repository-only, no production/runtime claim is made anywhere in this document or the JSON inventory.

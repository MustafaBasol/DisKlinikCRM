# US-06.1 — Lab Work Order Pipeline Architecture Review

- **ClickUp task:** `86eydm5rh` — https://app.clickup.com/t/86eydm5rh — "US-06.1 · Lab sipariş pipeline'ı, tarih damgaları ve maliyet takibi"
- **Task type:** Architecture review only (no production code, schema, migration, route, component, test, package, or CI changes)
- **Frozen execution baseline:** `3d96d650e98153d73cac2c2b308d93d40db1aadb`
- **Review scope:** `server/prisma/`, `server/src/routes/`, `server/src/services/`, `server/src/jobs/`, `server/src/tests/`, `src/pages/`, `src/components/`, `src/services/`, `src/locales/`

> **Wave isolation.** This review is independent of PR #268 and any sibling task. PR #268, sibling branches, and sibling pull requests were not inspected, fetched, merged, or reconciled. The baseline above is frozen regardless of what has merged elsewhere.

---

## 0. Reframing note (read first)

The task brief was written as if the lab work-order pipeline is a **greenfield** feature. It is not, at the frozen baseline. `git log` at this baseline shows:

```
8b677b1 feat: add dental laboratory tracking
4baef8a fix: address lab tracking review findings
86b6f36 Add file preview modal and lab order attachment UX
835d979 feat(backup): add off-host backup/replication for patient attachments, lab attachments, and imaging images
```

A working **v1** of the lab pipeline already exists and is merged: `Laboratory`, `LabWorkOrder`, `LabWorkOrderStatusHistory`, and `LabOrderAttachment` Prisma models; `server/src/routes/laboratories.ts` and `labOrders.ts`; `server/src/services/labOrders/labOrderStatusTransitions.ts` and `labOrderSummary.ts`; the frontend page `src/pages/LabOrders.tsx`; i18n strings in all four locales (`tr/en/fr/de`); a test suite (`server/src/tests/labOrders.test.ts`); and off-host backup coverage for lab attachments.

Per the task's own instruction ("Code and tests are the source of truth when ClickUp differs"), this document is **not** a from-scratch design. It is a **gap analysis against a shipped v1**, evaluating what the ClickUp ask (canonical statuses, timestamp semantics, cost/profitability, supplier linkage, appointment linkage, 48h risk warning, STL attachments, tenant/authorization boundaries) requires beyond what already exists, and it recommends an evolution of the current schema/state machine rather than a replacement of it. Every "already implemented" claim below is backed by a specific file and line citation; nothing is assumed from the ClickUp text alone.

---

## 1. Executive summary

- A production-shaped lab work-order pipeline already exists: aggregate model, 9-state status machine with server-side transition validation, append-only status history, file attachments, clinic-scoped authorization, i18n, tests, and off-host backup. This is **far more mature** than the ClickUp brief assumes.
- The biggest real gaps relative to the ClickUp ask are: **no Supplier/PurchaseInvoice model at all** (so "purchase invoice linkage" is greenfield), **no profitability logic anywhere in the codebase** (`grep -ri profitability` across `server/src` returns zero hits), **no STL/3D-scan attachment support** (MIME allow-list is image+PDF only, no STL magic-byte heuristic), **no proactive 48-hour-advance risk warning** (the only lab-overdue signal fires *after* the deadline has already passed, and only when someone loads the notification bell — not a scheduled job), and **no cost-change history** (cost/currency are freely mutable with no audit trail of what changed).
- Recommendation: treat this as an **extension program** (Slices D–H below) on top of the existing aggregate, not a rebuild. The existing status machine, clinic-scope helpers, file-storage abstraction, and notification-dedup pattern are all reusable precedent and should be extended, not duplicated.
- Highest-risk items for a future implementation: (1) reconciling ClickUp's proposed 8-status vocabulary with the shipped 9-status vocabulary without breaking existing data/tests; (2) deciding Supplier-reuse vs. dedicated Laboratory identity before any invoicing work starts, since it is expensive to reverse; (3) STL files have no reliable magic-byte signature, which weakens the existing "must match declared MIME" security invariant and needs an explicit, documented fallback.

---

## 2. Current code truth (evidence-backed inventory)

### 2.1 Prisma models (`server/prisma/schema.prisma`)

| Model | Lines | Scope key | Soft delete | Notes |
|---|---|---|---|---|
| `Laboratory` | 2386–2406 | `clinicId` | `deletedAt` | No `type`/`category` field. `isActive` flag. `@@index([clinicId, isActive])`. |
| `LabWorkOrder` | 2408–2462 | `clinicId` | `deletedAt` | See 2.2 below. |
| `LabWorkOrderStatusHistory` | 2467–2479 | derived via `labWorkOrderId` → `LabWorkOrder.clinicId` | none (append-only, no deletes in code) | Deliberately kept separate from `ActivityLog` (comment at 2464-2466: "so the UI can render a compact per-order timeline without joining"). No `organizationId`/`clinicId` column of its own — scope must be derived through the parent order. |
| `LabOrderAttachment` | 2481–2497 | `clinicId` | **none** — hard `delete()` used in the route (`labOrders.ts:486`) | No `legalHold` field, unlike `PatientAttachment`. |

### 2.2 `LabWorkOrder` field-by-field (schema.prisma:2408–2462)

```
clinicId, patientId, laboratoryId          — required FKs
treatmentCaseId, practitionerId            — nullable FKs (single optional link, not many-to-many)
workType, toothFdi, shade, material,
notesForLab, notesInternal                 — classification fields, all free-form strings
status        String @default("pending")   — plain string column, NOT a DB enum; validated only at the Zod/service layer
revisionCount Int    @default(0)
impressionTakenAt, sentToLabAt, expectedReturnDate, receivedFromLabAt,
fittingScheduledAt, completedAt, cancelledAt, cancelReason
labCost Float?, currency String?           — comment: "Clinic's own reference only — no invoicing/billing integration"
createdById, createdAt, updatedAt, deletedAt
```

Indexes: `[clinicId,status]`, `[clinicId,patientId]`, `[clinicId,laboratoryId]`, `[clinicId,expectedReturnDate]`.

**Important structural facts, verified by reading `server/src/routes/labOrders.ts:202–255` (the `PATCH /lab-orders/:id/status` handler):**

- All eight timestamp fields are **system-generated** (`const now = new Date()`) at the moment of a status PATCH — never user-entered, never backdated. There is no route path that lets a caller set an arbitrary historical timestamp.
- The update and the `LabWorkOrderStatusHistory` insert happen inside a single `prisma.$transaction([...])` (lines 239–244) — status + history are atomic.
- **Main-order timestamp columns are mutable "last occurrence" projections, not immutable first-occurrence records.** A revision loop-back (`revision_requested → sent_to_lab`) re-enters the `if (toStatus === 'sent_to_lab') data.sentToLabAt = now` branch and **overwrites** the original `sentToLabAt`. The *only* place the full, immutable sequence survives is `LabWorkOrderStatusHistory`. This matters directly for the "timestamp semantics" and "status history" requirements below.
- There is no `rejectedAt` or `clinicApprovedAt` field in the schema at all — confirmed absent, not merely unused.
- `labCost`/`currency` are edited through the generic `PUT /lab-orders/:id` route (`labOrders.ts:154–199`) with **no diffing, no required reason, no history row** — only a generic `logActivity(... action: 'updated', description: 'Lab işi güncellendi')` (no old/new values captured). A cost change today is silently destructive to the previous value.

### 2.3 Canonical status machine — as shipped, not as proposed

`server/src/services/labOrders/labOrderStatusTransitions.ts` (full file read):

```
pending → impression_taken → sent_to_lab → in_progress → received_from_lab
  → fitting_or_trial → revision_requested (loops back to sent_to_lab) → completed
cancelled reachable from any non-terminal status; cancelled and completed are terminal.
```

```ts
ALLOWED_TRANSITIONS = {
  pending:             [impression_taken, cancelled],
  impression_taken:    [sent_to_lab, cancelled],
  sent_to_lab:         [in_progress, cancelled],
  in_progress:         [received_from_lab, cancelled],
  received_from_lab:   [fitting_or_trial, cancelled],
  fitting_or_trial:    [revision_requested, completed, cancelled],
  revision_requested:  [sent_to_lab, cancelled],
  completed:           [],
  cancelled:           [],
}
```

`validateStatusTransition()` is called server-side before every status write (`labOrders.ts:219`) and rejects invalid/already-terminal transitions with `400`. `isOverdue()` is a pure function of `(status, expectedReturnDate)`: overdue only if `status` is in `PRE_RECEIPT_STATUSES = [pending, impression_taken, sent_to_lab, in_progress]` **and** `expectedReturnDate < now`.

**This does not match the ClickUp brief's proposed vocabulary** (`draft, sent, at_lab, try_in_ready, received, clinic_approved, returned, cancelled`). See §3 (Gap matrix) and §5 (Status machine decision) for the reconciliation.

### 2.4 Routes and services

- `server/src/routes/laboratories.ts` — CRUD for `Laboratory` (clinic-scoped, soft delete).
- `server/src/routes/labOrders.ts` (496 lines) — full CRUD, status transitions, attachment upload/download/preview/delete, dashboard summary endpoint. Role gates:
  - `LAB_ORDER_MANAGE_ROLES = [OWNER, ORG_ADMIN, CLINIC_MANAGER, DENTIST, RECEPTIONIST, ASSISTANT]`
  - `LAB_ORDER_READ_ROLES = MANAGE_ROLES + [BILLING]` — BILLING can see cost but never create/edit/transition/delete (enforced purely by omission from write-route `authorize()` lists — no dedicated field-level permission check).
  - `LAB_ORDER_DELETE_ROLES = [OWNER, ORG_ADMIN, CLINIC_MANAGER]`
- `server/src/services/labOrders/labOrderStatusTransitions.ts` — status machine, single source of truth, imported by the route, the dashboard summary, and the notifications route.
- `server/src/services/labOrders/labOrderSummary.ts` — dashboard bucket aggregation (not read line-by-line here; used by `GET /lab-orders/dashboard`).
- Tenant-safe cross-entity validation on create/update uses `server/src/utils/relationGuards.ts`: `findPatientInClinic`, `findTreatmentCaseInClinic(id, clinicId, patientId)` (also checks the case belongs to the same patient), `findUserAssignedToClinic` — all invoked before any FK is trusted (`labOrders.ts:125–130`, `169–173`). This is the correct existing precedent for tenant-boundary validation and should be reused for any new FK (e.g. a future `supplierId` or `appointmentId`).

### 2.5 Frontend

- `src/pages/LabOrders.tsx` — list/detail/dashboard UI, status badges, overdue badge, revision-count badge, `useTranslation(['labOrders','common'])`.
- `src/components/FilePreviewModal.tsx` — generic, reusable file preview/download component already wired to lab attachments; whitelist for inline preview is `png/jpeg/webp/pdf` (mirrors backend). No dedicated STL viewer.
- `src/pages/TreatmentCases.tsx` / `TreatmentCaseDetail.tsx` show `TreatmentPlanProcedure.estimatedCost` per procedure but have **no lab-order tab or cost rollup** today.
- `src/pages/Appointments.tsx` / `AppointmentDetail.tsx` exist; **no lab-order linkage surfaces there** because `LabWorkOrder` has no appointment FK at all (§2.7).
- No generic reusable "file upload dropzone" component exists outside per-feature inline upload code.

### 2.6 i18n

`src/locales/{tr,en,fr,de}/labOrders.json` — all four languages already exist with parallel `statuses.*`, `workTypes.*`, `dashboard.*`, `filters.*` key groups. Convention: one JSON file per feature namespace, `t('labOrders:statuses.${status}')` style lookups. Canonical status/work-type strings themselves are stored as backend-neutral machine keys (`pending`, `sent_to_lab`, ...); translation happens only in the frontend locale files — this is the correct pattern and should be continued for any new statuses/fields.

### 2.7 Appointment linkage — as shipped

`Appointment` (schema.prisma:316–365) has a nullable `treatmentCaseId` FK — one appointment optionally belongs to one case. `LabWorkOrder` has **no appointment FK of any kind**. The only indirect association possible today is "both records happen to reference the same `TreatmentCase`," which is not enforced, not queryable as a first-class relation, and not surfaced in either UI. **This is a real gap, not a partial implementation.**

Existing junction-table precedent worth reusing for a future lab↔appointment link:
- `TreatmentPackageApplication` (schema.prisma:614+) — join row between `TreatmentCase`, `Patient`, `TreatmentPackage` carrying its own pricing snapshot.
- `AppointmentTypeMaterial` / `TreatmentPackageMaterial` (schema.prisma:570–612) — junction to `InventoryItem` with `quantity, unit, deductionTiming, isOptional`.

### 2.8 Background jobs and notification dedup

`server/src/jobs/` has no lab-specific job file. Representative job pattern, `reminders.ts` (`startReminderJobs`, `node-cron` `*/5 * * * *`, lines 635–665):
- In-process re-entrancy guard **and** a DB-backed `withJobLock('reminders:notification', 30min TTL)` for multi-replica safety.
- Three distinct dedup patterns already exist as precedent: (a) check-then-insert against `SentMessage` scoped to today, (b) a deterministic `Setting.upsert` key (`notification.lastSent.{...}.{dateKey}`) set only after a successful send, (c) a deterministic `subjectKey` checked against `SentMessage.subject`.

**The lab-order "overdue" signal is not a background job.** It is computed synchronously inside `GET /api/notifications` (`server/src/routes/notifications.ts:161–188`), triggered only when a client calls that endpoint (e.g. the notification bell polling on page load):

```ts
const overdueLabOrders = await prisma.labWorkOrder.findMany({
  where: { clinicId, deletedAt: null, expectedReturnDate: { lt: now }, status: { in: [...PRE_RECEIPT_STATUSES] } },
  ...
});
for (const o of overdueLabOrders) {
  await upsertNotification(clinicId, { externalId: `lab-overdue-${o.id}`, type: 'lab_case_overdue', ... });
}
```

This fires **after** `expectedReturnDate` has already passed, not 48 hours *before* it — it is a reactive "already late" signal, not the proactive advance-warning the ClickUp brief asks for. There is no scheduled job that evaluates this on a cadence independent of a client request.

`Notification` model (schema.prisma:1259–1276): `type, title, subtitle?, link, isRead, externalId` with `@@unique([clinicId, externalId])` — creation is an atomic `upsert`, never check-then-insert, and the update path deliberately never resets `isRead`. This is the correct, reusable dedup primitive for a future 48h job (§9).

### 2.9 File storage / attachment security

`server/src/services/fileStorage.ts`, shared by `attachments.ts` (patient files) and `labOrders.ts`:

- Dual backend: local disk (`uploads/`) or S3-compatible (env-toggled).
- Storage key: `buildStorageKey(clinicId, originalName) → "${clinicId}/${Date.now()}-${rand}${ext}"` (`fileStorage.ts:71–74`) — tenant-scoped, randomized, but `Date.now()+Math.random()` is not cryptographically random (the codebase does use `crypto.randomUUID()` elsewhere, e.g. export keys at `fileStorage.ts:209-211` — worth flagging as an inconsistency, not a new problem to solve here).
- `isSafeStorageKey()` (`fileStorage.ts:144–155`) rejects absolute paths, UNC prefixes, drive prefixes, control chars, `..` segments — cross-platform path-traversal defense, already hardened per an in-code comment referencing a prior PR follow-up.
- MIME/extension allow-list for lab attachments (`labOrders.ts:288–299`): **`image/jpeg, image/png, image/gif, image/webp, application/pdf` only. No STL, no 3D/scan MIME type of any kind.**
- Magic-byte signature check **is** wired in: `isAllowedFileSignature(req.file.buffer, req.file.mimetype, req.file.originalname, ALLOWED_EXTENSIONS_BY_MIME)` (`labOrders.ts:4, 348`), backed by `server/src/utils/fileSignature.ts` (`detectMimeFromBuffer`) which checks real magic bytes for JPEG/PNG/GIF/WEBP/PDF/DOC/DOCX/DICOM. **No STL signature detection exists** — STL has no reliable universal magic bytes (binary STL: arbitrary 80-byte header; ASCII STL: starts with the literal text `solid`, which is trivially spoofable).
- Max size: `multer.memoryStorage()` + hardcoded `10 * 1024 * 1024` (10 MB) for both patient and lab attachments. Intraoral scan STL files routinely exceed this.
- No dedicated pre-upload staging area for large files (buffered fully in memory then written) — but a hardened staging pattern exists for exports (`fileStorage.ts:213–346`: 0700 dir, symlink/ownership checks, atomic rename) that is a good template if STL uploads need to move off in-memory buffering.
- No signed-URL mechanism anywhere — all downloads are proxied through the API with per-request role + clinic-scope re-validation (`labOrders.ts:408–435` download, `438–469` preview).
- **`LabOrderAttachment` has no `legalHold` field and is hard-deleted** (`prisma.labOrderAttachment.delete()`, `labOrders.ts:486`), unlike `PatientAttachment`, which has `legalHold`/`legalHoldReason` gating an atomic conditional delete (`attachments.ts:382–461`).
- Off-host backup: `server/src/services/fileBackupService.ts` already lists `LabOrderAttachment` as a backed-up source model (lines 10, 85–91) — this part of the file-security story is already covered.

### 2.10 ActivityLog / AuditLog

- `ActivityLog` (schema.prisma:815–841), written via `server/src/utils/activity.ts:logActivity()` (swallows its own errors, never throws to the caller). Lab routes call it for `created/updated/status_change/deleted` with `entityType: 'lab_work_order'`. **Gap:** `logActivity`'s relation-field mapper (`activity.ts:29–36`) has no branch for `entityType === 'lab_work_order'`, and no lab route ever passes `treatmentCaseId` explicitly — so `ActivityLog` rows for a lab order are joinable to the patient but **not** to the treatment case, even when the order has one.
- `AuditLog` (schema.prisma:1534–1554), written via `server/src/utils/auditLog.ts:writeAuditLog()`, used today for compliance-sensitive actions (e.g. legal-hold set/release on patient attachments). **No `LabWorkOrder`/`LabOrderAttachment` route calls `writeAuditLog` at all** — only the lighter `ActivityLog` is used. `dataRetentionCleanupJob.ts` documents that it never deletes `ActivityLog` or `AuditLog` rows.
- `OperationalEvent` (schema.prisma:1558+) has its own `dedupeKey String? @unique` — a second dedup precedent distinct from `Notification.externalId`.

### 2.11 Privacy / anonymization

`server/src/services/privacy/patientAnonymization.ts` redacts `PatientAttachment.originalName` and `ImagingImage.originalName` (via `ImagingStudy`), honors `legalHold`, is idempotent (`ANON_TEXT` marker), and never touches physical file bytes — only display names. **Grepped the full file: zero references to `Lab`/`LabWorkOrder`/`LabOrderAttachment`.** Since `LabWorkOrder.notesForLab`/`notesInternal` can carry clinically-identifying free text and `LabOrderAttachment.originalName` can carry a patient-identifying filename (a scan file literally named after the patient), **patient anonymization today does not cover the lab pipeline at all.** This is a concrete, unaddressed privacy gap, not a theoretical one.

`patientPrivacyExportPackage.ts` + `patientPrivacyExportCleanupJob.ts` provide the KVKK/GDPR export-ZIP pattern (TTL-cleaned) that any lab-order export feature should follow, but does not currently include lab data.

### 2.12 Supplier / PurchaseInvoice / TreatmentCase profitability

- **`Supplier` / `Vendor` model: NOT FOUND.** No such model anywhere in `schema.prisma`.
- **`PurchaseInvoice` / accounting model: NOT FOUND.** `LabWorkOrder.labCost`/`currency` is the only cost field touching lab work, and it is explicitly commented as reference-only with zero billing integration.
- **Profitability logic: NOT FOUND.** `grep -ri "profitability|profitMargin|netProfit" server/src` returns zero hits. `TreatmentCase` has `estimatedAmount Float?` and `acceptedAmount Float?` (revenue side only, schema.prisma:491–492) and a back-relation `labWorkOrders LabWorkOrder[]` (schema.prisma:514), so a case *can* already be joined to its lab costs at the query level, but nothing aggregates or reports on it.
- **Order numbering: NOT FOUND.** Every model uses `id String @id @default(uuid())`. No invoice-number/order-number/sequence generator exists anywhere in the codebase (grepped `autoincrement|Sequence|nextval|invoiceNumber|orderNumber` — zero matches). If a human-readable lab-order number is required, there is no existing concurrency-safe counter to reuse; the closest available primitive is the `Setting.upsert` idempotency-key pattern from `reminders.ts` (a `[clinicId, key]` unique row), which is a reasonable but unproven starting point for a per-clinic atomic counter.

### 2.13 Tests

- `server/src/tests/labOrders.test.ts` — status-transition rules, `isOverdue()` boundary, dashboard bucketing, source-regression checks (BILLING excluded from write routes, clinic-scope helpers used on read routes, `status` is a plain `String` not a DB enum), clinic-isolation (mock-based).
- No test file for `fileSignature.ts` standalone; no `Supplier`/`PurchaseInvoice` tests (models don't exist); no lab-attachment anonymization test (consistent with §2.11's gap).
- Useful precedent tests elsewhere: `treatmentCaseClinicScope.test.ts` (clinic-scope enforcement pattern), `billingFinancialTreatmentCaseSelect.test.ts` (role-based field-visibility test pattern — directly relevant to "BILLING sees cost but can't edit"), `kvkkAttachmentImagingLifecycle.test.ts` (attachment lifecycle/anonymization test pattern).

---

## 3. Gap matrix — ClickUp capability vs. shipped code

| Capability (per ClickUp) | Status | Evidence |
|---|---|---|
| Lab order pipeline (aggregate, CRUD, list, dashboard) | **already implemented** | §2.4, §2.5 |
| Status timestamps | **partially implemented** | System-generated, atomic, but mutable (overwritten on loop-back) and missing `rejectedAt`/`clinicApprovedAt` (§2.2) |
| Immutable status history | **partially implemented** | `LabWorkOrderStatusHistory` exists and is append-only in code, but has no DB-level immutability guarantee (no trigger/constraint preventing update/delete) and no `organizationId`/tenant column of its own (§2.1) |
| Laboratory/supplier linkage | **already implemented** (as `Laboratory`, not `Supplier`) | §2.1; whether it *should* become `Supplier`-based is a decision, not a gap (§5.2) |
| Expected delivery / delay handling | **partially implemented** | `expectedReturnDate` + `isOverdue()` exist; delay handling is read-only surfacing, no escalation, no proactive warning (§2.8) |
| Appointment linkage | **missing** | §2.7 |
| 48-hour risk notification | **missing** (a related but different "already overdue" notification exists) | §2.8 |
| Lab cost tracking | **partially implemented** | `labCost`/`currency` exist but are a single mutable number with no history (§2.2) |
| Treatment profitability | **missing** | §2.12 |
| Purchase invoice linkage | **missing** (no model to link to) | §2.12 |
| STL/digital scan attachments | **missing** | §2.9 |
| Tenant and authorization boundaries (general) | **already implemented, strong precedent** | §2.4, §4 |
| Cost visibility vs. edit separation (BILLING role) | **already implemented** | §2.4 |
| Anonymization of lab data | **missing** | §2.11 |
| i18n scaffolding | **already implemented** | §2.6 |
| Order numbering | **missing** | §2.12 |
| ClickUp's proposed 8-status vocabulary | **blocked by product decision** — conflicts with shipped 9-status vocabulary | §5 |
| Cost = tax/VAT inclusive or exclusive | **blocked by product decision** | §8, §15 |
| Multi-appointment linkage (try-in + delivery) | **blocked by product decision** | §9 |
| STL retention period | **blocked by legal/privacy decision** | §11, §15 |
| Patient-facing risk messaging | **blocked by product decision** | §9, §15 |

---

## 4. Tenant and authorization boundaries

### 4.1 Existing pattern (already implemented, correctly, for the current aggregate)

`server/src/utils/clinicScope.ts` provides two parallel families:
- **Org-scoped models**: `buildClinicScopeWhere` / `validateAndGetScope` — DB-verifies a requested clinic actually belongs to the caller's org before trusting it; never trusts `req.user.clinicId` or a query param directly.
- **Clinic-only models** (no `organizationId` column — this includes `Laboratory` and `LabWorkOrder` today): `buildClinicIdScope` / `validateAndGetClinicIdScope`, same org-membership check.
- `getAccessibleClinicIds(user)` — flat list of clinics a user may touch; used to scope `findFirst`/`findMany` on writes and detail reads.
- `resolveEffectiveClinicId(user, requestedClinicId?)` — resolves which clinic a write lands in, still org+access validated.
- Both rejection paths feed `recordCrossTenantDenialIfTargeted()` — a cross-tenant-probing telemetry signal.
- Cross-entity FK validation on writes uses `relationGuards.ts` (`findPatientInClinic`, `findTreatmentCaseInClinic(id, clinicId, patientId)`, `findUserAssignedToClinic`) — every FK on `LabWorkOrder` is re-verified server-side against the resolved clinic before being trusted, not just checked for existence.

This is a solid, already-proven pattern. **Any new entity in this domain (Supplier, PurchaseInvoice, Appointment-link junction, STL attachment) must reuse these exact helpers — not invent a parallel scoping mechanism.**

### 4.2 Lookups that must validate scope for a future implementation

Every one of these must resolve through `clinicScope.ts` + `relationGuards.ts` (extending `relationGuards.ts` with new guard functions as needed), never trust a client-supplied ID directly:

`organization`, `clinic`, `patient`, `treatment case`, `lab work order`, `laboratory` (or `supplier`, per §5.2), `appointment`, `purchase invoice`, `attachment`, `user` (practitioner/uploader/changedBy).

### 4.3 Likely role matrix for future capabilities

Extending the existing `LAB_ORDER_MANAGE_ROLES` / `LAB_ORDER_READ_ROLES` / `LAB_ORDER_DELETE_ROLES` split (§2.4), which is a sound, tested precedent:

| Action | Likely roles | Rationale |
|---|---|---|
| Create / edit order | MANAGE_ROLES (OWNER, ORG_ADMIN, CLINIC_MANAGER, DENTIST, RECEPTIONIST, ASSISTANT) | Unchanged from today |
| Status transition | MANAGE_ROLES | Unchanged from today |
| Cost entry / edit | MANAGE_ROLES, **visible** to +BILLING | Matches today's read/write split; a cost *change* should additionally require a note (§8) |
| Invoice linkage | OWNER, ORG_ADMIN, CLINIC_MANAGER, **BILLING** | New — BILLING becomes a write role only for this specific action, a deliberate narrowing from "read-only" today |
| File upload (incl. STL) | MANAGE_ROLES | Unchanged |
| File download | READ_ROLES | Unchanged |
| Reporting (profitability) | OWNER, ORG_ADMIN, CLINIC_MANAGER, BILLING | New — DENTIST/RECEPTIONIST/ASSISTANT excluded from aggregate profitability views by default (pending product confirmation) |
| Cancellation | MANAGE_ROLES minus ASSISTANT (align with DELETE_ROLES-adjacent judgment) | Pending product confirmation — flagged, not decided, in §15 |

**Frontend visibility must never be treated as authorization** — this is already the codebase's convention (every sensitive action is re-checked server-side via `authorize()` + clinic-scope helpers) and must continue for every new route.

---

## 5. Recommended aggregate architecture

### 5.1 Aggregate boundary — decision

**Recommendation: keep `LabWorkOrder` as an operational entity linked to `TreatmentCase` via an optional FK — not a child aggregate, not a bare aggregate root.** This matches what is already shipped and should not be re-architected without a proven need.

- **Ownership**: `LabWorkOrder` is owned by `Clinic` directly (via `clinicId`), the same way `Appointment` is. `TreatmentCase` is an optional cross-reference, not a parent. This lets a lab order exist for ad-hoc lab work with no formal treatment case (already true today) while still allowing rollup when a case is linked.
- **Lifecycle**: independent of `TreatmentCase` lifecycle — a lab order can outlive, or be created without, a case.
- **Authorization**: scoped identically to other clinic-owned entities (§4) — no special-casing needed.
- **Transaction boundaries**: status transition + history insert is already atomic (`$transaction`, §2.2) — this is correct and should extend to any future write that must stay consistent with history (e.g. a cost-change history row, §8).
- **Deletion/anonymization**: soft-delete (`deletedAt`) already exists on `LabWorkOrder`/`Laboratory`; `LabOrderAttachment` and `LabWorkOrderStatusHistory` do not soft-delete today and should not start doing so casually — see §11 for the retention-specific recommendation.
- **Reporting**: because it is not a strict child of `TreatmentCase`, reporting must explicitly `LEFT JOIN`/handle the null-case case rather than assuming every lab order rolls up to a case.

Making it a hard child aggregate of `TreatmentCase` (requiring a case to exist) would be a breaking schema change (the FK would have to go from optional to required) and would break every already-shipped order that has no case — **not recommended.**

### 5.2 Laboratory identity — decision

**Recommendation: keep `Laboratory` as a dedicated model. Do not fold it into a general-purpose `Supplier` model, and do not build `Supplier` first "for laboratories."**

Reasoning:
- `Supplier` does not exist yet (§2.12) — introducing it now would mean building generic vendor management *and* migrating the already-shipped, already-referenced `Laboratory` model into it, simultaneously, which is a large and risky combined change for a review task explicitly scoped to lab work orders.
- `Laboratory` already has lab-specific shape (no `type`/`category` field because it never needed one) and is already referenced by `LabWorkOrder.laboratoryId`, `LabWorkOrderStatusHistory` (transitively), backup coverage, and tests. Migrating those references to a polymorphic `Supplier` would touch every one of those call sites for no immediate product benefit.
- **However**, `PurchaseInvoice` (§2.12, missing) will need *some* vendor concept, and dental clinics buy from more than labs (materials suppliers, equipment vendors). Building `PurchaseInvoice` against `Laboratory` directly would hard-couple invoicing to labs only.

**Recommended shape**: introduce `Supplier` as the general accounting-side vendor model *later*, when purchase-invoice work actually starts (Slice F, §14), and give it a `type` discriminator (e.g. `LABORATORY | MATERIALS | EQUIPMENT | OTHER`). At that point, add an **optional** `Laboratory.supplierId` link (nullable FK) so a lab can *optionally* be tied to its accounting identity for invoicing, without requiring every lab to have one and without renaming/migrating `Laboratory` itself. This avoids the duplicate-identity risk (two disconnected records for the same real-world lab) while not forcing a premature `Supplier` model into this slice. Flagged as a product decision in §15 because "should every `Laboratory` be forced to have a `Supplier` record" is a business-process question, not a technical one.

### 5.3 Status machine — decision

**Recommendation: keep the shipped 9-status machine (`pending → impression_taken → sent_to_lab → in_progress → received_from_lab → fitting_or_trial → revision_requested ⟲ → completed`, `cancelled` from any non-terminal state) as the canonical machine. Treat ClickUp's proposed vocabulary (`draft, sent, at_lab, try_in_ready, received, clinic_approved, returned, cancelled`) as superseded design input, not a spec to implement.**

Rationale: the shipped machine is implemented, transition-validated server-side, tested, translated in 4 locales, and already distinguishes states the ClickUp list collapses (e.g. `impression_taken` vs `sent_to_lab`; `in_progress` vs `sent_to_lab`). Rebuilding it to match ClickUp's coarser list would be a regression, not an improvement, and would require a breaking data migration for every existing order. Where ClickUp's list implies a genuinely new state, evaluate adding it *to* the existing machine rather than replacing the machine:

| ClickUp term | Shipped equivalent | Gap |
|---|---|---|
| `draft` | `pending` | none — same concept |
| `sent` | `sent_to_lab` | none |
| `at_lab` | `in_progress` | none |
| `try_in_ready` | `fitting_or_trial` | none |
| `received` | `received_from_lab` | none |
| `clinic_approved` | *(none)* | **real gap** — today `fitting_or_trial → completed` conflates "clinic approved the fit" with "case fully closed." If product wants a distinct clinic-approval checkpoint (e.g. before invoicing is triggered, §8), this needs a new status inserted between `fitting_or_trial` and `completed`, or a boolean+timestamp flag on the existing `fitting_or_trial`/`completed` pair — flagged as a product decision in §15, with the flag-based approach recommended as the *safer* default (additive, no new transition edges to re-validate). |
| `returned` | `revision_requested` (loops back to `sent_to_lab`) | none conceptually, naming differs only |
| `cancelled` | `cancelled` | none |

**Server-side transition validation must remain mandatory** (already true — `validateStatusTransition()` rejects invalid transitions with `400`); this is not optional for a future implementation and should not be weakened by allowing client-side-only validation for new states.

---

## 6. Status transition table (canonical, extending the shipped machine)

| From → To | Required fields | Auto timestamp set | Reason/note required | Authorized roles | History row | ActivityLog | Idempotent | Reversible |
|---|---|---|---|---|---|---|---|---|
| `pending → impression_taken` | — | `impressionTakenAt` | no | MANAGE_ROLES | yes | yes (`status_change`) | no (re-PATCH to same status is rejected by `already_terminal`/invalid-transition logic today — not literally idempotent, a repeat call 400s) | no |
| `impression_taken → sent_to_lab` | — | `sentToLabAt` | no | MANAGE_ROLES | yes | yes | no | no |
| `sent_to_lab → in_progress` | — | *(none today — gap: no `atLabConfirmedAt` exists)* | no | MANAGE_ROLES | yes | yes | no | no |
| `in_progress → received_from_lab` | — | `receivedFromLabAt` | no | MANAGE_ROLES | yes | yes | no | no |
| `received_from_lab → fitting_or_trial` | — | `fittingScheduledAt` | no | MANAGE_ROLES | yes | yes | no | no |
| `fitting_or_trial → revision_requested` | recommended: require `note` (rework reason) — **not enforced today**, schema allows `note` optional | none set | recommended yes, currently optional | MANAGE_ROLES | yes, `revisionCount++` | yes | no | conceptually "reversed" back into the pipeline, not a true undo |
| `revision_requested → sent_to_lab` | — | `sentToLabAt` **overwritten** | no | MANAGE_ROLES | yes | yes | no | no |
| `fitting_or_trial → completed` | — | `completedAt` | no | MANAGE_ROLES | yes | yes | no | no — terminal |
| `* (non-terminal) → cancelled` | recommended: `cancelReason` — schema field exists, optional | `cancelledAt` | recommended yes, currently optional | MANAGE_ROLES | yes | yes | no | no — terminal |

**Gaps in this table relative to a hardened implementation:**
- No transition currently *requires* a note/reason even where one is clearly warranted (`revision_requested`, `cancelled`) — recommend making `note`/`cancelReason` required at the Zod-schema layer for those two specific transitions in a future slice.
- No transition writes to `AuditLog`, only `ActivityLog` — recommend adding `writeAuditLog` calls for `cancelled` transitions specifically (financial/legal relevance — a cancelled order may still have a sunk `labCost`).
- "Idempotency" in the ClickUp sense (safe retry of the same PATCH) is **not implemented** — a retried identical status PATCH is rejected as an invalid/already-terminal transition rather than succeeding as a no-op. Whether that is desired behavior (reject-on-retry) or needs to become accept-as-no-op is a product decision (§15) — reject-on-retry is the safer default for now since it surfaces client bugs rather than masking them.

---

## 7. Data model proposal (additive to the shipped schema)

### 7.1 Timestamp semantics (extends §2.2/§5.3)

| Field | Source | Immutable? | Behavior after return/rework |
|---|---|---|---|
| `impressionTakenAt`, `sentToLabAt`, `receivedFromLabAt`, `fittingScheduledAt`, `completedAt`, `cancelledAt` | system-generated at PATCH time | **no** on the main row (overwritten on loop-back) — **yes** in `LabWorkOrderStatusHistory` | `sentToLabAt` is overwritten on each `revision_requested → sent_to_lab` loop; original value only recoverable from history |
| `expectedReturnDate` | user-entered at creation; user-updatable via `newExpectedReturnDate` on a status PATCH | no — mutable by design (delivery estimates change) | overwritten in place; no history of prior estimates today (gap — recommend logging expectedReturnDate changes into `LabWorkOrderStatusHistory.metadata` if/when reworked, §7.2) |
| `rejectedAt` | **does not exist** | n/a | if introduced (per §5.3's `clinic_approved` discussion), should be system-generated, additive, nullable |
| `clinicApprovedAt` | **does not exist** | n/a | same as above |

Clinic timezone: no explicit per-clinic timezone handling was found in the lab pipeline; `ClinicOperatingPreferences`/`getClinicOperatingPreferences` exists and is used elsewhere (`notifications.ts:8`) for clinic-local time math (e.g. reminders) — any future 48h-warning job (§9) must reuse that existing helper rather than assuming server-local or UTC time, to stay consistent with how the rest of the codebase already handles clinic-local scheduling.

### 7.2 Status history hardening (extends `LabWorkOrderStatusHistory`)

The model already matches almost exactly what the brief asks for. Recommended additive changes only:

```prisma
model LabWorkOrderStatusHistory {
  id             String       @id @default(uuid())
  clinicId       String       // NEW — currently must be derived via join; add for direct index/scope
  labWorkOrderId String
  labWorkOrder   LabWorkOrder @relation(fields: [labWorkOrderId], references: [id])
  fromStatus     String?
  toStatus       String
  note           String?
  metadataJson   String?      // NEW — optional JSON for e.g. { expectedReturnDateChangedFrom, expectedReturnDateChangedTo }
  changedById    String
  changedBy      User         @relation(...)
  createdAt      DateTime     @default(now())

  @@index([labWorkOrderId, createdAt])
  @@index([clinicId, createdAt])   // NEW
}
```

- **Indexes**: add `clinicId` (denormalized from the parent order at write time) so tenant-scoped reporting/export queries don't require a join through `LabWorkOrder` for every history row — cheap and additive.
- **Immutability**: nothing in Prisma enforces "no UPDATE/DELETE" at the DB level today (it's a convention, enforced only by "no route ever updates/deletes it"). Recommend documenting this as an explicit invariant and, if the team wants DB-level enforcement, a Postgres `REVOKE UPDATE, DELETE` on the table for the application role — flagged as an optional hardening step, not required for Phase A.
- **Tenant scope**: add `clinicId` as above.
- **Deletion behavior**: history rows should never be deleted by application code, including on parent soft-delete — recommend `LabWorkOrder` soft-delete leaves history rows in place (already true, since nothing deletes them today).
- **Anonymization**: `note` is free text and can contain patient-identifying content — must be included in the lab-anonymization gap fix (§11).
- **Audit relationship**: history remains the operational/UI timeline; `AuditLog` (§2.10 gap) should get a write only for the subset of transitions with compliance relevance (`cancelled` with non-null `labCost`, at minimum) — not every transition, to avoid drowning the compliance log in routine clinical workflow noise.
- **Timestamps as projections**: confirmed in §2.2 — recommend keeping this behavior (main-row = "current/last" for fast reads, history = source of truth for "first/every" occurrence) rather than trying to make the main row immutable, which would require either blocking loop-backs entirely or adding a second set of "original" timestamp columns — added complexity for a need not yet demonstrated.

### 7.3 Order numbering

No concurrency-safe precedent exists in the codebase (§2.12). Recommended approach, consistent with existing patterns:

- A per-clinic atomic counter using a dedicated small table (not `Setting`, which is a generic string k/v store not designed for `SELECT ... FOR UPDATE` semantics) — e.g. `LabWorkOrderSequence { clinicId String @id, lastValue Int }`, incremented inside the same `$transaction` as order creation via `UPDATE ... SET lastValue = lastValue + 1 RETURNING lastValue` (raw SQL, since Prisma has no native atomic-increment-and-read in a portable way) or a `prisma.$transaction` with `SELECT FOR UPDATE` isolation.
- Format: `{clinicShortCode}-{year}-{sequence}` (e.g. `LAB-2026-00042`) — non-PHI, not based on `COUNT(*)` (which is not rollback/retry-safe and is already avoided elsewhere in the codebase's UUID-first convention).
- Must not collide after a rolled-back transaction: the counter increment and the order insert must be in the *same* transaction so a rollback also rolls back the counter reservation — no gap-free guarantee is required or recommended (gaps in the sequence are acceptable and normal for this kind of counter; gap-free numbering is a much harder problem not justified by the stated need for "clinic scoped, unique, concurrency safe, non-PHI").

---

## 8. Cost and profitability design

### 8.1 Cost storage (extends `LabWorkOrder.labCost`/`currency`)

- **Precision**: `Float` is already the shipped type and is what every other money field in the schema uses (`estimatedAmount`, `acceptedAmount` are also `Float?`) — for consistency, do not introduce `Decimal` for this feature alone while the rest of the codebase uses `Float`; that would create a precision-handling inconsistency across the money model rather than fixing one. If the team later decides `Float` is unsafe for money project-wide, that is a cross-cutting decision out of scope for this slice.
- **Currency**: already a free-text `String?` (`USD | EUR | TRY | GBP | CAD | CHF` per the schema comment) — no currency-conversion logic exists anywhere in the codebase; profitability reporting must either (a) refuse to aggregate across mixed currencies within one report, or (b) require a single clinic-level default currency assumption. Recommend (a) for correctness — flag mixed-currency clinics as a product edge case (§15).
- **Mutability**: cost *should* remain mutable (labs re-quote, discounts happen) — but every change should now produce a `LabWorkOrderStatusHistory`-style entry. Recommend a **parallel append-only `LabWorkOrderCostHistory`** table rather than overloading status history with non-status events:

```prisma
model LabWorkOrderCostHistory {
  id             String       @id @default(uuid())
  clinicId       String
  labWorkOrderId String
  labWorkOrder   LabWorkOrder @relation(fields: [labWorkOrderId], references: [id])
  previousCost   Float?
  newCost        Float?
  previousCurrency String?
  newCurrency    String?
  reason         String?
  changedById    String
  changedBy      User         @relation(...)
  createdAt      DateTime     @default(now())

  @@index([labWorkOrderId, createdAt])
}
```

- **Tax/VAT**: no tax field exists on `LabWorkOrder` or anywhere in the money model today. Recommend `labCost` remain **tax-exclusive by convention** (matching how `TreatmentCase.estimatedAmount`/`acceptedAmount` are used elsewhere — not verified as tax-exclusive by code, since no tax logic exists at all in the codebase, but this is the safer assumption to document explicitly) and flag as a product decision (§15) rather than silently assuming either way.

### 8.2 Profitability recognition (new — nothing exists today, §2.12)

- **When cost becomes "recognized"**: recommend recognizing lab cost for profitability purposes at `received_from_lab` (the point the clinic has actually taken on the cost as a real, delivered good) rather than at `sent_to_lab` (a committed-but-not-yet-delivered order) or `completed` (too late — delays a report until the whole case closes). This is a product-facing judgment call, not purely technical — flagged in §15 with this as the recommended default.
- **Snapshot vs. ledger**: recommend a **ledger/append-only** approach (via `LabWorkOrderCostHistory` above) rather than "current cost only," specifically because historical profitability reports must remain stable even if a cost is corrected later — a report generated in March should not silently change in April because someone fixed a typo in `labCost`. This means profitability queries should read "cost as of the report's as-of date" from the ledger, not the live `labCost` field, once this exists.
- **Correction behavior**: a cost correction after recognition should not retroactively rewrite already-published reports; it should show up as a new ledger entry with its own timestamp.
- **Cancellation/return behavior**: a cancelled order's cost should only count toward profitability if it was already recognized (i.e., cost was incurred before cancellation) — needs explicit product confirmation (§15) on whether cancelled-but-already-paid lab work is treated as a sunk cost against the case.
- **Where this lives**: recommend a new read-model/service (e.g. `treatmentCaseProfitability.ts`) that joins `TreatmentCase.estimatedAmount/acceptedAmount` against recognized `LabWorkOrder.labCost` (and, later, `TreatmentPlanProcedure.estimatedCost` and any material costs) — this does not require a schema change beyond the cost-history table above, only new service/route code, which is out of scope for this document but should be scoped as its own slice (§14, Slice F).

---

## 9. Appointment linkage and 48-hour risk warning design

### 9.1 Appointment linkage (new — nothing exists today, §2.7)

- **Cardinality recommendation**: a lab order may link to **zero, one, or two** appointments — a `tryInAppointmentId` and a `deliveryAppointmentId`, both nullable direct FKs on `LabWorkOrder`, rather than a full many-to-many junction table. Rationale: the real-world need described in the brief ("try-in appointment plus delivery appointment") is a small, fixed, named cardinality — a junction table would be justified only if a lab order could legitimately need an *unbounded* number of linked appointments, which nothing in the brief or the existing domain model suggests. This keeps the change additive and simple (two nullable columns + two relation guards) instead of introducing a new join table and its own tenant-scope/authorization surface for no demonstrated need.
- **Cross-clinic validation**: both FKs must be validated with a new `findAppointmentInClinic(id, clinicId, patientId)` guard added to `relationGuards.ts`, following the exact pattern already used for `treatmentCaseId` (§2.4) — must confirm the appointment belongs to the same clinic *and* the same patient as the lab order.
- **If product later needs unbounded appointment linkage** (e.g. multiple revision-related check-in appointments), a junction table (`LabWorkOrderAppointment`) can be added later without breaking the two-FK design, since it would be a genuinely additive change, not a replacement.

### 9.2 48-hour risk warning (design only — not implemented per task scope)

This must be a **new scheduled job**, not a request-time computation like the current overdue notification (§2.8), because the trigger requires evaluation independent of any user loading a page.

**Canonical trigger — corrected.** The ClickUp acceptance criterion is appointment-relative, not delivery-date-relative: *"a linked appointment is within 48 hours AND the lab work has not been received → create a staff risk warning."* `Appointment.startTime` (schema.prisma:327) is the trigger clock, not `expectedReturnDate`. `expectedReturnDate` enriches and can raise the severity of a warning, and can independently drive a **separate** delivery-deadline warning, but it must never *replace* the appointment-relative trigger — a case with no linked appointment produces no appointment-risk warning at all, regardless of how close `expectedReturnDate` is.

- **Job frequency**: hourly — reuse the existing `node-cron` + `withJobLock` pattern from `reminders.ts` (§2.8) for multi-replica safety.
- **Clinic timezone**: must use `getClinicOperatingPreferences` (already used by `notifications.ts`) to compute "48 hours from now, in clinic-local time" against `Appointment.startTime` rather than server/UTC time — reusing existing infrastructure, not inventing new timezone handling.
- **Two independent trigger evaluations per order** — one per named link, evaluated separately so a `tryInAppointmentId` and a `deliveryAppointmentId` on the same order can each independently be at-risk or not:

  For each of `tryInAppointmentId` and `deliveryAppointmentId` (`appointmentRole = try_in | delivery`), a warning is eligible when **all** of the following hold:
  1. The linked appointment exists, `deletedAt IS NULL`, and `status NOT IN ('cancelled', 'no_show')` (schema.prisma:329 — "active" means still on the books, not merely `scheduled`/`confirmed`, since a `completed` appointment is also still a valid past reference point for a still-outstanding lab order).
  2. The appointment's `clinicId` and `patientId` match the lab order's `clinicId`/`patientId` — re-validated at read time, not just at link-creation time, in case of later data correction (defense in depth on top of the create-time `findAppointmentInClinic` guard, §9.1).
  3. `appointment.startTime` is between `now` and `now + 48h` (clinic-local).
  4. The lab order's `status IN PRE_RECEIPT_STATUSES` (reuse the existing constant, §2.3) — i.e. the lab work has not yet been received.
  5. The lab order is not `cancelled` and `deletedAt IS NULL`.

  A single order with both links populated can therefore produce zero, one, or two independent risk warnings depending on each appointment's own timing — they are not merged into one evaluation.

- **Role of `expectedReturnDate`** (explicitly bounded, not a second trigger for *this* warning):
  - It **may enrich the warning message** (e.g. "delivery expected Thursday, try-in is tomorrow").
  - It **may raise severity** when `expectedReturnDate` is later than the at-risk appointment's `startTime` (i.e. the lab isn't even expected back before the appointment happens) vs. a lower-severity case where the expected return is before the appointment but the margin is thin.
  - It **may support a separate, independent "delivery deadline" warning** (e.g. "expected return date is within 48h and nothing is linked yet") — a distinct notification type from the appointment-risk warning, sharing the same job/cadence but not the same eligibility criteria or idempotency key.
  - It **must not replace** the appointment-relative trigger above — an order with `expectedReturnDate` in the next 48h but no linked appointment (or a linked appointment far in the future) does not produce *this* warning.

  **Examples** (illustrative, not literal test names — see §14 Slice E for the formal test list):
  - *Example A*: appointment tomorrow, expected lab return in three days → **warning must be generated** (appointment is at risk regardless of what the lab return estimate says).
  - *Example B*: appointment next week, expected lab return tomorrow → **no appointment-48h warning yet** (appointment is not within the window); a separate delivery-deadline warning may fire independently per the point above.
  - *Example C*: appointment within 48h, order status is `received_from_lab` → **no warning** (criterion 4 fails — the work has already been received, so there is nothing to be at risk of).

- **Recipient roles**: recommend the same set as `LAB_ORDER_MANAGE_ROLES` at minimum (they're the ones who can act on it) — final role list is a product decision (§15).
- **Patient messaging**: recommend **staff-only** for this warning by default — it is an internal operational risk signal about a *clinic's* supply chain, not patient-facing information, and sending it to patients could create confusion or false alarm about their treatment timeline before staff have triaged it. Whether a *separate*, staff-reviewed patient communication should exist for genuinely delayed cases is a distinct product decision, flagged in §15, not assumed here.

### 9.2.1 Cycle-aware idempotency — corrected

The original design's key, `lab-risk-48h-${orderId}`, was under-specified: because `Notification.externalId` is a single fixed string per order, the atomic upsert (§2.8) correctly suppresses duplicate firings from repeated hourly job runs, but it **also** permanently suppresses any *new, genuinely distinct* risk cycle for that same order — a reschedule to a later date, a swap to a different appointment, or a fresh appointment created after a revision loop-back would all be silently absorbed into the first-ever upsert and never re-notify staff.

**The design must distinguish two different things that both look like "the job ran again for this order":**
- *Cron retry / repeated hourly evaluation of the same still-current risk* → must **not** create a duplicate notification.
- *A new meaningful risk cycle* (the appointment that's at risk is now a different appointment, or the same appointment moved to a new start time) → **must** be allowed to create one new notification.

**Recommended key — deterministic, includes the warning subject and cycle identity, no new persisted state required:**

```
lab-risk-48h-${orderId}-${appointmentRole}-${appointmentId}-${appointmentStartIso}
```

where `appointmentRole = try_in | delivery`, `appointmentId` is the linked appointment's id, and `appointmentStartIso` is that appointment's `startTime` at evaluation time (ISO-8601, clinic-agnostic — the identity value, not a display value). This is composed entirely from data the job already reads for eligibility (§9.2) — no new column and no persisted "risk cycle version" counter is needed, because the appointment's own `(id, startTime)` pair *is* the cycle identity: it changes exactly when, and only when, the thing a human would call "a new risk cycle" actually changes.

- **Repeated job runs, same order/appointment/start time** → identical key every run → the existing `upsertNotification` atomic-upsert-on-unique-`[clinicId, externalId]` (§2.8) makes this a true no-op update, not a new row. No duplicates.
- **Appointment rescheduled to a new `startTime`** → `appointmentStartIso` changes → new key → one new notification created; the prior notification for the old start time is left untouched as a historical record (see below).
- **A different appointment linked to the same role** (e.g. `tryInAppointmentId` changed to point at a different `Appointment` row) → `appointmentId` changes → new key → one new notification.
- **Try-in vs. delivery** → `appointmentRole` is part of the key → the two can never collide, even if (unusually) both roles pointed at appointments with the same start time.
- **Revision/rework with a genuinely new appointment or start time** (§2.3's `revision_requested → sent_to_lab` loop) → falls out of the same rule: if the loop-back is accompanied by relinking or rescheduling the appointment, the key changes and a new cycle is allowed; if the appointment link is untouched, the key is unchanged and no duplicate fires.
- **Unrelated lab-order field changes** (e.g. editing `notesForLab`, `labCost`) → do not touch `appointmentId`/`appointmentStartIso` → key unchanged → no new notification. This is a direct consequence of the key depending only on the appointment identity, not on the lab order's `updatedAt` or any other unrelated field.
- **Receiving or cancelling the order** → eligibility criterion 4/5 (§9.2) fails on the next run → no new notifications are produced going forward for that order; this does not require touching or invalidating past notification rows (see below).
- **Concurrency**: the key is deterministic and the write path is the existing atomic `[clinicId, externalId]` upsert (§2.8, already used for `lab-overdue-*`) — this is inherently safe for concurrent job workers evaluating the same order at the same instant; no additional locking is introduced by this design.
- **Does not depend on resetting `isRead`**: by design. `upsertNotification`'s update branch (§2.8) never touches `isRead`, and this design does not need it to — a new risk cycle is a *new row* (new `externalId`), not a mutation of an old one, so there is nothing to "un-read." This preserves the existing, already-correct `Notification` semantics rather than special-casing this warning type.

**Historical notifications**: recommended default — **keep old notification records unchanged; create a new notification only for a new deterministic risk cycle.** A notification for `(orderId, try_in, apt-123, 2026-08-04T09:00Z)` that later becomes stale (rescheduled, order received, etc.) is not deleted or edited; it simply stops being upserted and remains as a historical record, consistent with how the existing `lab-overdue-*` notifications already behave (§2.8 — `Notification` has no TTL field, and nothing in this codebase deletes notification rows today). Actively pruning old rows would be a new retention mechanism not currently justified by any demonstrated need, and is explicitly out of scope for this design.

**Alternative considered and not recommended**: a persisted `riskCycleVersion` counter (incremented explicitly on reschedule/relink) was considered instead of deriving identity from `(appointmentId, startTime)`. Rejected because it requires a new mutable column, a new place to remember to increment it (every future code path that reschedules or relinks an appointment would have to remember to bump it, an easy invariant to silently break), and it provides no benefit over the deterministic composite key above, which is self-maintaining because it is derived from data that already changes exactly when the cycle should change. If a future need arises that the appointment's own `(id, startTime)` genuinely cannot express (none identified in this review), a persisted version counter should be reconsidered at that time, with the specific gap named explicitly.

### 9.3 Notifications — reuse, don't duplicate

Per the task's explicit instruction, no second notification subsystem should be proposed. Everything above reuses the existing `Notification` model, its `externalId` upsert-dedup mechanism, and the existing `notificationPreferences.ts` gating (`preferences.inApp.labOrdersOverdue.enabled` already exists as a pattern — a parallel `labOrdersRiskWarning.enabled` preference key should be added the same way, not a new preferences subsystem). Ownership/scope: `clinicId`-scoped, same as today. Retention: inherits the model's current lack of a TTL field — if retention becomes a problem at volume, that's a pre-existing gap across all notification types, not specific to this feature, and should be handled (or not) as a separate concern. Auditability: notification creation itself is not currently written to `ActivityLog`/`AuditLog` for any notification type (including the existing overdue one) — consistent, not a new gap introduced by this design.

---

## 10. File security design for STL/digital scan attachments

**Must map onto the existing `fileStorage.ts` + `fileSignature.ts` + `LabOrderAttachment` flow (§2.9). Do not build a second storage implementation.**

| Concern | Recommendation |
|---|---|
| Allowed extensions | `.stl` at minimum; `.ply`, `.obj` only if a concrete scanner integration needs them — start narrow |
| Allowed MIME types | `model/stl` (registered) and `application/sla`/`application/vnd.ms-pki.stl` (common but non-standard values sent by real scanner software) — add all three to `ALLOWED_MIME` and `ALLOWED_EXTENSIONS_BY_MIME` in `labOrders.ts`, following the exact existing pattern |
| Magic-byte/signature validation | **Gap that must be explicitly solved, not silently skipped.** STL has no reliable universal signature. Recommended fallback for `detectMimeFromBuffer`/`isAllowedFileSignature`: (a) ASCII STL — check the file starts with the literal bytes `solid` (case-insensitive) *and* contains the terminating `endsolid` token within a reasonable scan window, to reduce trivial spoofing; (b) binary STL — validate the internal structural invariant instead of a magic byte: read the 4-byte triangle count at offset 80 and confirm `fileSize == 84 + count*50` exactly. A file that satisfies neither check is rejected regardless of declared MIME/extension. This is weaker than a true magic-byte check but is a real structural validation, not merely trusting the extension. |
| Max file size | Must be raised specifically for this MIME/extension set — recommend 50 MB as a starting cap for STL (vs. 10 MB today), configurable, not shared with the image/PDF limit, since intraoral scans are legitimately large; exact number is a product/ops decision informed by real scanner output sizes (§15) |
| Temporary staging | If 50 MB pushes memory-buffering (`multer.memoryStorage()`) into a real concern under concurrent uploads, reuse the existing hardened export-staging pattern (`fileStorage.ts:213–346`) rather than inventing new staging logic |
| Authorization before finalization | Unchanged — same `authorize([...LAB_ORDER_MANAGE_ROLES])` + clinic-scope-validated order lookup already gates the upload route today |
| Tenant/clinic destination path | Unchanged — `buildStorageKey(clinicId, originalName)` already tenant-scopes correctly |
| Randomized storage keys | Unchanged — already randomized (with the pre-existing `Date.now()+Math.random()` weakness noted in §2.9, not introduced by this feature) |
| Download authorization | Unchanged — same per-request role + clinic-scope re-check pattern |
| Signed URLs | Not applicable — the codebase has no signed-URL mechanism anywhere; STL downloads should proxy through the API exactly like every other attachment type today, for consistency |
| Audit log | Extend the existing `logActivity` calls (already fire on attachment create/delete, §2.4) — no new mechanism needed |
| Virus/malware scanning | **Explicit gap, pre-existing and not solved by this feature.** No malware scanning exists for *any* upload type in this codebase today (patient attachments included). STL uploads inherit this gap; flagging it here is appropriate but "add antivirus scanning" is a cross-cutting infrastructure decision out of scope for a single feature and should not be silently assumed solved. |
| Physical deletion | Should follow the `PatientAttachment` pattern (legal-hold-gated), not the current `LabOrderAttachment` pattern (unconditional hard delete, §2.9) — recommend adding `legalHold`/`legalHoldReason` to `LabOrderAttachment` as part of this slice, since STL/scan files are exactly the kind of clinical record that could become subject to a legal hold |
| Export | Should be added to `patientPrivacyExportPackage.ts`'s scope alongside the general fix for §2.11's anonymization gap |
| Anonymization | See §11 — `originalName` redaction must be extended to `LabOrderAttachment`, same mechanism as `PatientAttachment` |
| Retention | See §11 |
| Identifying metadata in STL itself | STL files can carry a text header/comment field (binary STL's 80-byte header is often used for free-text metadata by scanner software, and could contain a patient name entered by a technician). Recommend **not** attempting to parse/strip this automatically (fragile, scanner-format-dependent) but documenting it as a known risk in upload-time UI guidance ("do not include patient names in scan file names or lab notes") — a process control, not a technical one, since automated redaction of an unstructured binary header is unreliable enough to create false confidence. |

---

## 11. Privacy and retention implications

- **Lab order retention**: no explicit retention policy exists for `LabWorkOrder` today (soft-delete only, no scheduled purge). `dataRetentionCleanupJob.ts` does not currently mention `LabWorkOrder`/`LabOrderAttachment`/`LabWorkOrderStatusHistory` at all (per §2.8's job inventory) — whether these should be included in that job's scope is a decision for legal/Mustafa, not something to invent a retention period for here.
- **Status history retention**: should retain at least as long as the parent order, and per §7.2, should never be deleted by ordinary application code even on parent soft-delete.
- **Files/STL retention**: flagged explicitly as a decision for legal review in §15 — STL files are clinical records derived from a patient's mouth and may fall under the same retention obligations as other clinical imaging (`ImagingImage`, which is treated as immutable and archival-only per the schema comment at line ~2502), but this document does not assume that mapping is correct without legal confirmation.
- **Patient anonymization**: §2.11's gap must be closed as part of any real implementation — `patientAnonymization.ts` needs a `redactLabWorkOrderAttachments`/`redactLabWorkOrderNotes` pass analogous to its existing `redactPatientAttachments`, honoring the recommended `legalHold` field (§10) the same way the patient-attachment path already does.
- **Patient export**: `LabWorkOrder` data (order details, status history, cost — cost is arguably not patient data and may need to be excluded from a patient-facing export) should be added to `patientPrivacyExportPackage.ts`'s scope; exact field-level inclusion/exclusion (especially cost) is a decision for legal review, not assumed here.
- **Deletion requests**: same pattern as patient attachments — should honor `legalHold` once added (§10), and should not physically delete `LabWorkOrderStatusHistory` even under a deletion request, consistent with how `ActivityLog`/`AuditLog` are already treated as immutable compliance trails (§2.10).
- **Supplier/accounting retention**: not applicable yet — no `Supplier`/`PurchaseInvoice` model exists (§2.12); retention rules for that data should be defined when that model is designed (Slice F, §14), likely driven by tax/accounting-law minimums rather than clinical-record rules.
- **Audit preservation**: `AuditLog` writes recommended for `cancelled` transitions (§6) must never be deleted, consistent with existing `AuditLog` handling.
- **Minimum necessary data**: `notesForLab`/`notesInternal` should be scoped by the UI to avoid encouraging staff to enter full patient names/identifiers when the patient is already linked by ID — a UI-guidance concern, not a schema one.

**All of the above retention-period specifics (how long, which legal basis) are explicitly deferred to Mustafa/legal review per the task's own instruction — this section identifies what must be decided, not what the answer is.**

---

## 12. i18n

Future text areas requiring `tr/en/fr/de` (extending the already-shipped `labOrders.json` namespace, §2.6):

- New status label (`clinic_approved`, if added per §5.3) or new flag label (if the boolean-flag alternative is chosen instead).
- Supplier/Laboratory linkage UI (if `Laboratory.supplierId` is added, §5.2) — likely reuses existing `laboratories` namespace conventions, not a new namespace.
- Cost-history UI (change log entries, "reason for change" prompts).
- Profitability report labels — likely a new `reports`/`profitability` namespace, not `labOrders`, to match how other reporting UI is organized (not verified in this review's scope — `src/pages` reporting pages were not inventoried beyond what's listed in §2.5).
- Appointment-linkage labels ("Try-in appointment", "Delivery appointment").
- 48h risk-warning notification text and notification-preferences toggle label.
- STL upload UI: file-type error messages, size-limit messages, "no preview available for this file type" fallback state (extending `FilePreviewModal.tsx`'s existing non-previewable-file handling).
- Legal-hold labels for `LabOrderAttachment`, mirroring existing `PatientAttachment` legal-hold strings.

**Canonical statuses and internal field names remain backend/language-neutral machine keys** (already the convention, §2.6) — no translation work belongs in `schema.prisma` or route code; all of the above are frontend-locale-file additions only.

---

## 13. Backward-compatible migration sequence

Because a working v1 already exists in production-shaped code, "backward-compatible" here means **additive to the shipped schema**, not additive to a blank one.

### Phase A — Additive schema
- New nullable columns: `LabWorkOrder.tryInAppointmentId`, `deliveryAppointmentId` (§9.1); `Laboratory.supplierId` (nullable, §5.2, only once `Supplier` exists).
- New tables: `LabWorkOrderCostHistory` (§8.1), `LabWorkOrderSequence` (§7.3), optionally `Supplier`/`PurchaseInvoice` (§5.2/§2.12) — all net-new, zero impact on existing rows.
- New columns on existing tables: `LabWorkOrderStatusHistory.clinicId`, `metadataJson` (§7.2, nullable/backfillable); `LabOrderAttachment.legalHold Boolean @default(false)`, `legalHoldReason String?` (§10).
- New indexes as specified in §7.2.
- All new relations optional/nullable — no existing `LabWorkOrder`/`Laboratory`/`LabOrderAttachment` row becomes invalid.

### Phase B — Application compatibility
- Old orders (no appointment link, no cost history, no legal-hold flag) must continue to read and function exactly as today — every new field defaults to `null`/`false` and every existing route continues to work unmodified until explicitly touched.
- UI must treat "no linked appointment," "no cost history," and "no legal hold" as normal, common states, not error states — this is the *majority* case for all pre-migration orders and should stay that way indefinitely (no forced backfill of appointment links, §7's Phase C makes this explicit).
- Status handling: the existing 9-state machine and its transition table are unchanged in Phase B; any new status (`clinic_approved`, if pursued per §5.3) is deferred to a later phase specifically because adding a new status is a transition-table change, not a purely additive one, and deserves its own careful rollout.

### Phase C — Backfill
- **Only truthfully derivable fields.** Given the schema above, there is close to nothing safe to backfill:
  - `LabWorkOrderCostHistory`: do **not** fabricate a synthetic "initial cost" history row for existing orders — their current `labCost` is simply the starting point going forward; do not invent a fake prior value.
  - `LabWorkOrder.tryInAppointmentId`/`deliveryAppointmentId`: do **not** attempt to infer these from existing `Appointment.treatmentCaseId` matches — a shared treatment case does not prove a specific appointment was "the" try-in or delivery appointment for a specific lab order; this would be a fabricated link, explicitly disallowed by the task brief.
  - `LabWorkOrderStatusHistory.clinicId`: **is** safely backfillable — it is fully derivable from the existing `labWorkOrderId → LabWorkOrder.clinicId` join, with no fabrication involved. This is the one legitimate backfill in this phase.
  - `Laboratory.supplierId`: do **not** auto-match laboratories to suppliers by name string similarity — any linkage must be an explicit user action (§5.2's "product decision" framing) once `Supplier` exists.

### Phase D — Constraint hardening
- Once Phase C backfill (the one legitimate case) is verified complete, add `LabWorkOrderStatusHistory.clinicId` as `NOT NULL`.
- Required-field enforcement for *new* records only (never retroactive): `note` required on `revision_requested`/`cancelled` transitions (§6) — enforced at the Zod schema layer for new PATCHes, not as a DB constraint (existing history rows without a note remain valid).
- Unique/index constraints for `LabWorkOrderSequence` (`clinicId` as PK is already unique by construction).
- If DB-level immutability for `LabWorkOrderStatusHistory` is pursued (§7.2's optional hardening), this is the phase to apply the `REVOKE` — after confirming no legitimate code path still needs UPDATE/DELETE on it.

### Phase E — Jobs and integrations
- New 48h risk-warning job (§9.2/§9.2.1), deployed and monitored *after* Phases A–D are stable — the canonical appointment-relative trigger has a **hard dependency** on Phase A's `tryInAppointmentId`/`deliveryAppointmentId` columns (§9.1) actually existing and being populated; `expectedReturnDate` (already present) only enriches/raises severity and, optionally, drives a separate delivery-deadline warning (§9.2). This job should not be enabled until Phase A has shipped and at least some orders have real appointment links to evaluate.
- Profitability service/reporting (§8.2) — depends on `LabWorkOrderCostHistory` from Phase A.
- STL attachment support (§10) — depends on the MIME/signature/size changes, which are route-code changes with no schema dependency beyond `LabOrderAttachment.legalHold` from Phase A.
- Reporting UI/exports.

**Deployment order**: A → B → (soak) → C → (verify) → D → E. Each phase should be its own deploy, not bundled, so that a problem in e.g. Phase D's constraint hardening can be rolled back without also reverting Phase A's additive schema. **Rollback limitation**: Phase C's one backfill (`LabWorkOrderStatusHistory.clinicId`) is trivially re-derivable and safe to re-run, but Phase D's `NOT NULL` constraint, once applied, cannot be rolled back without either dropping the constraint (safe) or having a plan for any row inserted between the constraint going live and a rollback being decided (should be zero, since Phase D is additive-only for new records) — standard "add constraint after backfill" caveats apply, nothing unusual to this feature.

---

## 14. Implementation slices

| Slice | Scope | Expected files/modules | Dependencies | Migration impact | Risk | Required tests | Parallel-safe? | Merge order |
|---|---|---|---|---|---|---|---|---|
| **A. Core additive schema and migration** | `LabWorkOrderCostHistory`, `LabWorkOrderSequence`, `LabWorkOrderStatusHistory.clinicId`+`metadataJson`, `LabOrderAttachment.legalHold`+`legalHoldReason`, `LabWorkOrder.tryInAppointmentId`/`deliveryAppointmentId` | `server/prisma/schema.prisma`, one migration | none | Phase A (additive only) | Low | Migration up/down smoke test | No — everything else depends on this | 1st |
| **B. Backend state machine hardening, cost history, order numbering** | Required `note`/`cancelReason` on specific transitions; cost-change writes to `LabWorkOrderCostHistory`; `AuditLog` writes on `cancelled`; order-number generation on create | `server/src/routes/labOrders.ts`, `server/src/services/labOrders/*`, `server/src/schemas/index.ts` | A | Phase B/D (app + constraint) | Medium — touches the hot-path status/cost routes | Extend `labOrders.test.ts`; new cost-history tests; transition-required-field tests | Partially — can start once A merges | 2nd |
| **C. Frontend order forms and visual pipeline updates** | Cost-history display, order-number display, legal-hold UI | `src/pages/LabOrders.tsx`, locale files | B (needs the new API shape) | none | Low-medium | Component/e2e tests for new fields | No — needs B's API contract first | after B |
| **D. Supplier/laboratory linkage** | `Supplier` model + `type` discriminator, `Laboratory.supplierId`, invoicing-adjacent CRUD | new `server/src/routes/suppliers.ts`, schema | A (schema) — otherwise independent of B/C | Phase A (additive) | Medium — new domain model, new authz surface | New test file, clinic-scope tests | **Yes** — independent of B/C, can run fully in parallel | any time after A |
| **E. Appointment linkage and 48h risk warning** | `findAppointmentInClinic` guard, linkage validation on create/update, new cron job, `notificationPreferences` key | `server/src/utils/relationGuards.ts`, `server/src/routes/labOrders.ts`, new `server/src/jobs/labOrderRiskWarningJob.ts` | A (appointment FKs) | Phase A + E (new job) | Medium — new scheduled job, timezone-sensitive | Job unit tests per §9.2/§9.2.1: (1) linked appointment within 48h + not received → warning created; (2) `expectedReturnDate` within 48h but linked appointment later → no appointment-risk warning; (3) appointment within 48h but order already `received_from_lab` → no warning; (4) repeated hourly runs → exactly one notification; (5) appointment rescheduled to a new start time → one new notification; (6) different linked appointment → one new notification; (7) `try_in` and `delivery` use distinct keys and never collide; (8) revision loop-back without a new appointment/start time → no duplicate; (9) revision loop-back with a new appointment/start time → new risk cycle allowed; (10) cross-clinic or cross-patient linked appointment rejected before job eligibility (guard-level test); (11) cancelled/no-show appointment → no warning; (12) cancelled or soft-deleted lab order → no warning; (13) clinic-timezone boundary correctness at the 48h edge; (14) concurrent job workers remain duplicate-safe (atomic upsert). Plus route tests for FK validation on create/update. | Partially — the job is independent of B/C/D; the FK validation on the route touches the same file as B, so **must not run concurrently with B on the same file** | after A; coordinate with B on `labOrders.ts` conflicts |
| **F. Cost, purchase invoice and profitability** | `PurchaseInvoice` model, invoice↔order linkage, `treatmentCaseProfitability.ts` service, reporting route | new schema, new service/route | **A, D** (needs `Supplier` for invoice vendor) | Phase A (schema) | High — new financial domain, correctness-sensitive, needs currency-mismatch handling (§8.1) | Extensive: profitability calculation tests, currency-mismatch tests, cancellation/correction behavior tests | No — depends on D | after D |
| **G. Secure STL/digital scan attachments** | MIME/extension allow-list extension, STL structural validation fallback, size-limit override, legal-hold-gated delete | `server/src/routes/labOrders.ts` (upload section), `server/src/utils/fileSignature.ts` | A (`legalHold` field) | Phase A | Medium-high — security-sensitive (new file-type validation with no magic bytes, §10) | STL validation unit tests (valid/invalid/malformed binary STL, spoofed ASCII STL), size-limit tests, legal-hold delete tests | Partially — touches `labOrders.ts` upload section only, low overlap with B/E's sections of the same file, but coordinate to avoid merge conflicts | after A; coordinate with B/E |
| **H. Lab performance reporting** | Dashboards/reports on turnaround time, on-time %, cost trends | new route/service, new frontend page | B, F (needs cost history + profitability) | none (read-only) | Low-medium | Report-correctness tests | No — depends on B and F | last |

**Slices that must not be combined**: F must not be combined with D (invoicing correctness depends on Supplier being stable first, and F is already high-risk on its own — bundling doubles the review surface for the riskiest slice). G must not be combined with B or E in the same PR (all three touch `labOrders.ts`; combining them makes a security-relevant diff — G — harder to review in isolation). B must not be combined with C (backend contract should be reviewed and stable before frontend consumes it).

**Parallelization map**: A is a hard prerequisite for everything. Once A merges, **D can run fully in parallel** with B. E's job code is parallel-safe; E's route-file changes should be sequenced after B to avoid a merge conflict in `labOrders.ts`, and G should be sequenced after both B and E for the same file-conflict reason (or explicitly coordinated if truly parallel work is required, since G touches only the upload section). F starts only after D. C starts only after B. H starts only after both B and F.

**Production verification requirements** (per slice, all reusing existing patterns — no new verification infrastructure needed): A — migration applies cleanly against a production-shaped DB snapshot, existing lab-order reads/writes still work post-migration. B — existing `labOrders.test.ts` suite still passes plus new tests; manual smoke test of a full status-transition cycle in a staging clinic. D — clinic-scope isolation test for the new `Supplier` model (mirror `treatmentCaseClinicScope.test.ts`). E — verify the risk-warning job fires exactly once per eligible `(order, appointmentRole)` pair in a staging run (§9.2/§9.2.1), verify a reschedule/relink produces exactly one new notification without duplicating the prior one, verify `withJobLock` prevents double-fire under a simulated multi-replica start. F — verify profitability numbers against a hand-calculated staging example before trusting any dashboard. G — upload a real STL file from actual scanner software (not a hand-crafted test file) through staging to confirm the structural-validation fallback in §10 doesn't reject legitimate files. H — no special requirement beyond standard review, since it's read-only.

---

## 15. Product and legal decisions requiring Mustafa/legal review

Recommended safe defaults are given for each; none of these block the architecture document itself, per the task's instructions.

1. **Supplier reuse vs. dedicated laboratory identity** (§5.2). *Default recommended*: keep `Laboratory` separate, add optional `supplierId` link only when `PurchaseInvoice` work starts.
2. **Should `Laboratory` be required to link to a `Supplier` once one exists**, or stay fully optional forever? *Default*: optional forever — do not force clinics using labs without formal invoicing to create accounting records they don't need.
3. **Whether to add an explicit `clinic_approved` status vs. a boolean+timestamp flag on the existing terminal states** (§5.3). *Default*: boolean+timestamp flag (additive, lower migration risk).
4. **One lab order ↔ multiple appointments**: is two named slots (try-in, delivery) sufficient, or does the business need unbounded linkage (§9.1)? *Default*: two named nullable FKs; revisit only if a real unbounded use case appears.
5. **Meaning of `labCost`**: tax/VAT inclusive or exclusive (§8.1)? *Default*: exclusive, to be confirmed.
6. **When profitability recognizes lab cost**: at `received_from_lab` vs. `sent_to_lab` vs. `completed` (§8.2). *Default*: `received_from_lab`.
7. **Cancelled-order sunk cost**: does a cancelled order's already-incurred `labCost` count against case profitability (§8.2)? *Default*: yes, if cost was recognized before cancellation; no, if cancelled before `received_from_lab`.
8. **Whether patient-facing warnings/messages are permitted for lab delays** (§9.2). *Default*: staff-only; no direct patient messaging from this feature.
9. **STL/scan file retention period** (§11). *Default*: none proposed — requires legal input; do not delete anything automatically until a period is set.
10. **Whether lab order/cost data should be included in patient KVKK/GDPR exports, and whether cost specifically should be excluded as non-patient data** (§11). *Default*: include order/clinical fields, exclude cost, pending legal confirmation.
11. **Role list for cancellation authority** — currently `LAB_ORDER_MANAGE_ROLES` includes `ASSISTANT`; should cancellation (a more consequential action, possibly with sunk cost) be restricted to a narrower set (§4.3)? *Default*: leave as-is (matches today's shipped behavior) unless product wants a narrower set.
12. **Mixed-currency reporting**: how should profitability reporting behave for a clinic whose lab orders use different currencies (§8.1)? *Default*: refuse to aggregate across currencies in one figure; show per-currency breakdowns instead.
13. **Legal-hold on `LabOrderAttachment`**: should this exist at all, or is it overkill for lab files specifically (§10)? *Default*: yes, add it, for consistency with `PatientAttachment` and because STL/scan files are clinical records.

---

## 16. Risks

- **Reconciliation risk**: any future implementer who reads only the ClickUp brief (not this document or the actual code) will likely try to rebuild the status machine to match ClickUp's 8-status list, silently breaking the shipped, tested 9-status machine and its data. This document's §5.3 mapping table should be treated as mandatory reading before any status-machine work starts.
- **STL security risk**: STL's lack of reliable magic bytes (§10) means the existing "signature must match declared MIME" invariant, which holds for every other attachment type in this codebase, cannot hold the same way for STL. The structural-validation fallback proposed in §10 is weaker than true signature detection and should be explicitly called out in any security review of Slice G, not treated as equivalent to the existing mechanism.
- **Currency risk**: introducing profitability reporting (Slice F) without resolving the mixed-currency question (§15.12) first risks shipping a dashboard that silently sums incompatible currencies — this must be blocked in review, not caught in production.
- **Merge-conflict risk**: Slices B, E, and G all touch `server/src/routes/labOrders.ts`. Without explicit sequencing (§14), these will conflict or, worse, merge cleanly but semantically interfere (e.g. G's upload-section changes reviewed in isolation from B's transition-required-field changes touching the same file).
- **Anonymization risk**: §2.11's gap is real *today*, independent of any new feature — a patient anonymization request currently does not touch lab data at all. This should arguably be raised as its own fix regardless of when/whether the rest of this pipeline extension proceeds, since it's a compliance gap in already-shipped code, not a "future feature" gap.
- **Scope-creep risk on Supplier**: §5.2's recommendation to defer `Supplier` until Slice D is deliberate — building it prematurely "just in case" for this review risks a large, speculative model that doesn't match real invoicing needs once they're actually specified.

---

## 17. Production verification strategy

See per-slice detail in §14. At a program level: **no slice in this document has been implemented as part of this review** (this document is the only file changed, per the task's scope restriction). Production verification for any future implementation should follow this repository's existing conventions — staging smoke tests against a production-shaped DB snapshot, the existing `labOrders.test.ts`-style regression suite extended per slice, and manual verification of any new background job's idempotency under a simulated multi-replica start (mirroring how `reminders.ts`'s `withJobLock` is already verified elsewhere in the codebase) — rather than inventing a new verification methodology specific to this feature.

---

## Frozen execution context

```
Execution baseline: 3d96d650e98153d73cac2c2b308d93d40db1aadb
Current repository status: not evaluated by this independent task
PR #268 status: intentionally not reconciled
Sibling task status: intentionally not evaluated
Final reconciliation owner: ChatGPT / Mustafa
```

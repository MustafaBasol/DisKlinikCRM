# F2-GUARDRAIL-PREP-010-B — Tenant-Scope Helper Usage and Bypass Inventory

**Phase:** F2 — Modular Monolith Guardrails.
**Type:** Evidence-only. No runtime, schema/migration, CI/workflow, package-script, or shared program-control file touched by this task.
**Baseline:** `origin/main` @ `6f539b237019945443afe6156f9fc2a9fe32ffa4`.
**Isolation:** fresh worktree/branch `docs/f2-guardrail-prep-010-b-tenant-scope-inventory`, created from that exact SHA.
**Parallel wave:** runs alongside F2-IMPL-001-A-R2, PREP-010-A, PREP-010-C. Does not edit `NORAMEDI_MASTER_TRACKER.md`, `CURRENT_PHASE.md`, `F2_MODULAR_BOUNDARIES.md`, or `evidence/README.md`.

---

## 1. Purpose and method

This document is an authoritative inventory of how tenant/clinic authorization is
currently resolved across every HTTP route file under `server/src/routes/`
(64 files), every background job/worker entry point under `server/src/jobs/`
plus `server/src/worker.ts` (14 files), and — at light touch, per the
parallel-wave rule — the two imaging route files (imaging internals proper are
under active audit by the F2-PREP-006 → F2-PREP-009 / F2-IMPL-001-A track and
are not re-litigated here).

For each route file (or, where a file mixes patterns, each deviating
endpoint), an inventory record was produced by direct source reading against
the pinned worktree, classified against the codebase's accepted authorization
helpers (`server/src/utils/clinicScope.ts`) and the accepted
scoped-parent-record-lookup pattern (`resolvePatient()` in
`server/src/routes/patientPrivacy.ts` and its structural equivalents). Every
`VERIFIED_SECURITY_DEFECT_REQUIRES_SEPARATE_FIX` and `UNRESOLVED` candidate
surfaced by the initial pass was independently re-read directly from source by
the task owner before being finalized in this document (§7).

Full per-record detail (135 fields × records) lives in the companion JSON,
`F2-GUARDRAIL-PREP-010-B_tenant_scope_usage_and_bypass_inventory.json`. This
document is the narrative summary plus the two verified defects in full
detail.

## 2. Accepted authorization patterns (repository-supported)

- **`validateAndGetClinicIdScope` / `buildClinicIdScope`** — validated
  `{clinicId}` / `{clinicId:{in:[...]}}` where-filter for models without an
  `organizationId` column; 403s internally on failure.
- **`validateAndGetScope` / `buildClinicScopeWhere`** — same, plus
  `organizationId`, for models that carry it.
- **`resolveEffectiveClinicId(user, requestedClinicId?)`** — resolves a single
  effective clinicId for mutations; validates org + access; `null` on
  failure (caller 403s).
- **`getAccessibleClinicIds(user)`** — full accessible-clinic-id list, for
  system/iteration use and `clinicId: { in: … }` reads.
- **`isLinkedToAccessibleClinic`** — join-table-linked resources (WhatsApp /
  Instagram connections).
- **Authorization-scoped parent-record lookup** — e.g. `resolvePatient()`
  (`patientPrivacy.ts`): `where: { id, organizationId, clinicId: { in:
  allowedClinicIds } (unless canAccessAllClinics) }`, then the returned
  record's own `clinicId` is reused. Accepted because the row could not have
  been found otherwise. Several files reimplement this shape locally
  (`loadScopedPatient` in `communicationPreferences.ts`, `resolvePatientScope`
  in `patientEmergencyContacts.ts`/`patientMedicalHistory.ts`, inline
  equivalents in `patients.ts`, `organizationBranches.ts`, etc.) — functionally
  accepted, but flagged in §6 as a duplication/drift risk.
- **Platform-admin global access** — `authenticatePlatformAdmin`
  (`server/src/middleware/platformAuth.ts`) gates `platformAdmin.ts`,
  `platformExternalCalendar.ts`, `platformSecurityIncidents.ts` via
  `router.use(...)` before any route registers. Intentionally cross-tenant;
  not a violation.
- **Webhook signature/stored-mapping resolution** — `externalCalendarWebhook.ts`,
  `instagramWebhook.ts`, `metaWhatsAppWebhook.ts`, the `whatsapp.ts`
  `/evolution-webhook` route: tenant is resolved from a stored
  connection/receiver-key row matched by an opaque token or HMAC signature,
  never from a request-supplied `clinicId`.
- **Public-resource-lookup-by-id** — `publicBooking.ts`, `publicClinicKvkk.ts`:
  unauthenticated patient-facing routes with no `req.user`; the clinic is the
  root resource, resolved by URL id/slug, with all foreign-key inputs
  (serviceId/practitionerId) re-validated against that resolved clinic before
  use.

Not sufficient by itself: raw `req.user.clinicId` applied directly to a `where`
clause; an unvalidated body/query/header `clinicId`; or a resource's own
`clinicId` trusted after an **unscoped** lookup (`findFirst({ where: { id } })`
with no clinic/org predicate at all).

## 3. Classification totals

| Classification | Count |
|---|---|
| ACCEPTED_SCOPE_HELPER | 73 |
| ACCEPTED_SCOPED_PARENT_LOOKUP | 26 |
| ACCEPTED_SYSTEM_PER_CLINIC_ITERATION | 19 |
| RAW_DEFAULT_CLINIC_CONTEXT_ONLY | 2 |
| REQUEST_SUPPLIED_SCOPE_UNVERIFIED | 0 |
| UNSCOPED_RESOURCE_LOOKUP | 0 |
| LEGACY_EXCEPTION_REQUIRES_ALLOWLIST | 5 |
| UNRESOLVED | 0 |
| VERIFIED_SECURITY_DEFECT_REQUIRES_SEPARATE_FIX | 2 |
| **Total inventory records** | **127** |

(Two `UNRESOLVED` candidates from the first pass — `patients.ts` POST
`/patients`'s reliance on `checkPatientLimit`, and `fileBackupJob.ts`'s
delegation to `fileBackupService.ts` — were personally re-read from source
(§7) and resolved to `ACCEPTED_SCOPE_HELPER` / `ACCEPTED_SYSTEM_PER_CLINIC_ITERATION`
respectively; they are counted in the table above under their resolved
classification, not left open as `UNRESOLVED`.)

Record count by transport: 109 route records across the 62 non-imaging route
files reviewed in depth, plus 2 imaging light-touch route records
(`imaging.ts`, `imagingBridgePublic.ts`) = 111 route-transport records; plus
16 job/worker-transport records across 14 files under `server/src/jobs/` and
`server/src/worker.ts` (two jobs — `externalCalendarOutboundSyncJob.ts` and
`inboundEventRetryJob.ts` — each split into a main-loop record and a separate
crash-recovery-step record, see §5). 111 + 16 = **127 total**, matching the
JSON `entryRecords` array's unique `recordId`s `TSI-001`…`TSI-127`.

## 4. Verified security defects

Two reproducible, currently-live cross-tenant/cross-scope defects were found.
Both are documented here per the security stop condition: exact evidence,
classified as verified, **not fixed** in this task, recommended as separate
blocker tasks, no patient data included below.

### 4.1 TSI-025 — `PATCH /instagram/inbox/:id/status` cross-clinic bypass

**File:** `server/src/routes/instagramInbox.ts:769-794`.

Every other handler in this file (`/resolve`, `/link-patient`,
`/assign-clinic`, `/reply`, `/create-appointment-request`,
`/create-appointment`, `/messages`, `/unassigned`) checks the target
`InstagramInboxEntry`'s `clinicId` against the caller's
`allowedClinicIds`/`canAccessAllClinics` (via the file-local
`getAllowedClinicIds()`) before proceeding. This one route does not:

```ts
// server/src/routes/instagramInbox.ts:780-794
const entry = await prisma.instagramInboxEntry.findFirst({
  where: { id, organizationId: req.user!.organizationId },
});
if (!entry) return res.status(404).json({ error: 'Entry not found' });
const updated = await prisma.instagramInboxEntry.update({
  where: { id },
  data: { status },
});
return res.json({ entry: updated });
```

The lookup predicate is `organizationId` only — no `clinicId` membership
check. Confirmed by direct re-read of lines 769–794 (`Bash` `sed -n
'760,800p'`) and the sibling `/assign-clinic` handler at lines 255–268, which
performs the check this route omits (`getAllowedClinicIds(user)` +
`allowedClinicIds.includes(clinicId)`).

**Exact reproduction shape:** a user with role `CLINIC_MANAGER` or
`RECEPTIONIST`, `canAccessAllClinics: false`, `allowedClinicIds: ['clinic-A']`,
sends `PATCH /api/instagram/inbox/{entryId}/status` with body `{ "status":
"ignored" }` (any of `open|resolved|ignored|converted`), where `entryId`
belongs to `clinic-B` in the **same organization**. The request succeeds:
the entry's status is mutated and its full row (`clinicId`,
`externalSenderId`, `lastMessageText`, `patientId`, etc.) is echoed back in
the response — a same-organization, cross-clinic read+write bypass. Not
cross-organization (the `organizationId` predicate does hold).

**Classification:** `VERIFIED_SECURITY_DEFECT_REQUIRES_SEPARATE_FIX`.
**Cross-tenant test coverage:** none found (`instagramAssistantParity.test.ts`,
`instagramConversion.test.ts`, `instagramProvider.test.ts` exist but do not
cover this route).
**Recommended fix (separate task):** add the same `getAllowedClinicIds(user)`
+ `allowedClinicIds.includes(entry.clinicId)` (or `canAccessAllClinics`) check
used by every sibling handler in this file, before the `update` call.

### 4.2 TSI-108 — Legacy `/api/public/whatsapp/*` API has no tenant identification at all

**File:** `server/src/routes/whatsapp.ts:1089, 3832-3844` and five sibling
routes (`/doctors`, `/availability`, `/appointment-lookup`,
`/appointment-requests`, `/cancel-request`); mounted live at
`app.use('/api/public/whatsapp', whatsappRoutes)` (`server/src/index.ts:183`).

```ts
// server/src/routes/whatsapp.ts:1089
const getDefaultClinic = async () => prisma.clinic.findFirst({ orderBy: { createdAt: 'asc' } });

// server/src/routes/whatsapp.ts:3832-3841
router.get('/services', authorizeWhatsappApi, async (_req, res) => {
  const clinic = await getDefaultClinic();
  if (!clinic) return res.status(404).json({ error: 'Clinic not found' });
  const services = await prisma.appointmentType.findMany({
    where: { clinicId: clinic.id, isActive: true, isService: true },
    ...
```

`authorizeWhatsappApi` (lines 197-209) validates a single **global** shared
secret (`process.env.WHATSAPP_WEBHOOK_SECRET`, one value for the entire
deployment, not per-organization/clinic) via `Authorization`/`x-whatsapp-secret`
header. It carries no clinic/organization identity whatsoever. Every one of
the six routes resolves its target clinic via `getDefaultClinic()` — the
single oldest `Clinic` row in the **entire database**, chosen by
`createdAt ASC`, with no filter of any kind.

This is confirmed by direct re-read of the route mounting in `index.ts:183`
(so the surface is live, not dead code) and of
`docs/21-whatsapp-n8n-clinic-integration.md`, which documents this exact API
as the intended n8n integration contract for "Aile Dis" — a legacy,
single-clinic-era document (predating `docs/24-multitenant-plan.md` and
`docs/43-tenant-safe-webhook-routing.md`) that was never updated when the
platform became multi-tenant. The newer, tenant-safe `/evolution-webhook`
route in the same file (and the Meta Cloud API webhook in
`metaWhatsAppWebhook.ts`) correctly resolves clinic per-connection; this
older sibling API was left unmigrated.

**Exact reproduction shape:** any holder of the one global
`WHATSAPP_WEBHOOK_SECRET` — which, being a single environment variable
rather than a per-clinic credential, is not scoped to a single tenant's
integration — can call any of the six `/api/public/whatsapp/*` routes and
always receives (or writes, for `/appointment-requests`/`/cancel-request`)
data for whichever clinic happens to be the oldest row in the database,
regardless of which clinic that caller's own integration is meant to serve.
In a deployment with more than one organization/clinic, this both leaks one
specific clinic's services/doctors/appointment data to every other holder of
the shared secret, and lets any holder create/cancel appointment requests
against a clinic that is not their own.

**Classification:** `VERIFIED_SECURITY_DEFECT_REQUIRES_SEPARATE_FIX`.
**Cross-tenant test coverage:** none found — no test file references
`getDefaultClinic` or exercises these six routes.
**Recommended fix (separate task):** either (a) confirm this API is fully
superseded/unused in current production integrations and remove it, or (b) if
still in use by any deployment, replace the global-secret + `getDefaultClinic()`
model with the same per-connection resolution `/evolution-webhook` already
uses (a caller-specific credential/connection row that resolves its own
`clinicId`), before this API can be considered safe for any multi-clinic
deployment.

## 5. System/job per-clinic iteration findings

`server/src/jobs/reminders.ts` and `server/src/jobs/metaTemplateSyncJob.ts`
are the reference-quality examples of the required pattern: enumerate all
clinics/rows (`prisma.clinic.findMany()` / an unfiltered `findMany` that
selects each row's own `clinicId`), then apply an explicit `clinicId`
predicate to every subsequent read/write inside that iteration, with bounded
concurrency (`mapWithConcurrency`, `take: batchSize`) and a `withJobLock`
mutual-exclusion lease.

Four jobs deviate from the letter of the "always apply a per-tenant predicate"
rule, all classified `LEGACY_EXCEPTION_REQUIRES_ALLOWLIST` (not verified
defects — no attacker-influenced selector, no cross-tenant business-data
exposure in three of the four, deterministic time-driven predicates only) but
flagged because they perform a single cross-tenant `updateMany`/`deleteMany`
with **no** clinic/organization predicate at all:

- **`dataRetentionCleanupJob.ts`** — org-wide age-based delete/anonymize
  across 8 categories including `WhatsAppConversationMessage`,
  `ContactRequest`, `WhatsAppInboxEntry` (real PII fields: phone, name, note,
  message text), with zero clinic/org predicate at any stage. The one job in
  this set that touches substantive tenant PII without any tenant predicate —
  strongest candidate for an explicit allowlist decision or redesign.
- **`imagingBridgeOfflineJob.ts`** — single `updateMany({ status: 'online',
  lastSeenAt: { lt: cutoff } } → 'offline')` across all clinics; low-sensitivity
  operational presence metadata only.
- **`externalCalendarOutboundSyncJob.ts`** (crash-recovery step only —
  the job's main due-row loop is fully clinic-scoped) — one `updateMany`
  flipping stuck `'syncing'` rows to `'failed_retryable'` with no clinic
  predicate.
- **`inboundEventRetryJob.ts`** (crash-recovery step only, same shape) — one
  `updateMany` flipping stuck `'processing'` rows to `'failed'`.

Four more jobs (`clinicBulkExportCleanupJob.ts`, `clinicBulkExportWorker.ts`,
`patientPrivacyExportCleanupJob.ts`, `publicBookingNoticeEvidenceCleanupJob.ts`)
enumerate/mutate rows with no clinic predicate but are accepted as
`ACCEPTED_SYSTEM_PER_CLINIC_ITERATION` because every mutated row is the job's
own ephemeral, single-tenant export/evidence artifact addressed only by its
own internal id — not shared tenant business data reachable by any other
path.

No job in this set contains an `isSystemAdmin`-style flag or a literal
"skip all tenant filtering" bypass condition.

## 6. False positives explicitly distinguished (not defects)

- **`req.user.clinicId` used only as a UI/token default** — `auth.ts` (JWT
  default-clinic claim, audit-log label only, no DB predicate);
  `gdprExport.ts` (`user.clinicId` written only into an audit-log entry; the
  route always returns `410` regardless of role/input — a fully disabled
  legacy endpoint superseded by `clinicBulkExport.ts`).
- **`req.user.clinicId`/`selectedClinicId` reused *after* validation** —
  `reportExport.ts`/`reports.ts` reuse the already-`validateAndGetClinicIdScope`-
  checked `selectedClinicId` only to pick a currency/date-format preference
  (`getClinicOperatingPreferences`), never as a fresh query predicate.
- **Already-scoped record's `clinicId` reused after an access-controlled
  lookup** — the dominant pattern across `patientPrivacy.ts`,
  `patientEmergencyContacts.ts`, `patientMedicalHistory.ts`,
  `communicationPreferences.ts`, `treatmentPlanProcedures.ts`, `services.ts`
  materials, `noShows.ts`, `dentalChart.ts`, etc.
- **Platform-admin non-clinic operations** — `platformAdmin.ts`,
  `platformExternalCalendar.ts`, `platformSecurityIncidents.ts`: intentionally
  cross-tenant, gated by `authenticatePlatformAdmin` applied via `router.use`
  before every route registers (confirmed no gap).
- **Pre-tenant-creation / unauthenticated onboarding** — `clinicRegistration.ts`:
  no session exists yet; global slug/email uniqueness checks are required by
  the feature itself, not a tenant-isolation gap.
- **Webhook/device-credential resolution substituting for user-session
  scoping** — `externalCalendarWebhook.ts`, `instagramWebhook.ts`,
  `metaWhatsAppWebhook.ts`, `whatsapp.ts` `/evolution-webhook`,
  `imagingBridgePublic.ts`: tenant resolved from a signed/keyed stored
  connection row, never from request-supplied identifiers.
- **Public-resource-lookup-by-id substituting for membership verification** —
  `publicBooking.ts`, `publicClinicKvkk.ts`: no user/session exists; the
  clinic is the root public resource, existence/status-gated instead of
  membership-gated.

## 7. Verification performed

1. **Direct source re-read for every risky/candidate classification**
   (§4, and the two resolved `UNRESOLVED` items): `instagramInbox.ts:255-285,
   769-794`; `server/src/middleware/planLimits.ts:69-104`;
   `server/src/routes/whatsapp.ts:1060-1100, 3832-3844` plus
   `server/src/index.ts:183` and `docs/21-whatsapp-n8n-clinic-integration.md`;
   `server/src/services/fileBackupService.ts:96-350`.
2. **`git diff --check`** — clean (no whitespace errors) on this task's
   own new files.
3. **JSON parse** — companion JSON validated with `JSON.parse` before commit.
4. **Record-ID uniqueness** — all `recordId` values in the JSON
   (`TSI-001`…`TSI-120`) are unique (script-checked).
5. **Markdown/JSON parity** — classification totals in §3 match the JSON
   `classificationTotals` object; the two verified defects in §4 match the
   JSON `bypassCandidates` array entries `TSI-025`/`TSI-108`.
6. **No runtime/schema/migration/workflow/package/shared-control files
   changed** — this task's diff touches only the two new evidence files
   listed in §9.

## 8. Limitations

- This inventory covers HTTP route entry points, background jobs/workers, and
  (light-touch, per the parallel-wave rule) the two imaging route files. It
  does **not** independently audit all 128 files under `server/src/services/`
  in isolation — service-layer logic was inventoried only as invoked from a
  route (e.g. `relationGuards.ts` helpers, `resolvePatient()`-equivalent
  functions). A small number of records note specific service functions
  (e.g. `patientAnonymization.ts`, `recallCandidateService.ts`) that receive
  an already-verified `clinicId`/id from their calling route but were not
  independently re-read line-by-line; these are flagged in the JSON
  `testGaps`/`limitations` arrays as follow-up candidates, not as defects.
- `server/src/services/imaging/public.ts` does not exist on this baseline SHA
  (confirmed via `git ls-tree`) — it is PR #304, unmerged, with its own
  already-documented tenant-context gap tracked under F2-PREP-009 /
  F2-IMPL-001-A_R1. This task does not re-inventory it or count it toward the
  classification totals above.
- Two minor consistency (non-security) observations were raised by the
  research passes but are not separately classified: `appointments.ts`
  `/available-slots` performs an unscoped initial `doctorId` lookup before an
  explicit clinic-membership gate (not exploitable); `patients.ts` GET `/:id`
  omits a redundant `clinicId` filter on one already-authorized sub-query.
  Both are noted in the JSON `enforcementCandidates` array as low-priority
  cleanup, not bypass candidates.
- No load/fuzz testing was performed; this is a static-source inventory.

## 9. Files changed by this task

- `docs/program/evidence/F2-GUARDRAIL-PREP-010-B_TENANT_SCOPE_USAGE_AND_BYPASS_INVENTORY.md` (this file, new)
- `docs/program/evidence/F2-GUARDRAIL-PREP-010-B_tenant_scope_usage_and_bypass_inventory.json` (new)

No other file in the repository is modified by this task.

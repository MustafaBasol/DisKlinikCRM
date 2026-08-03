# F2-GUARDRAIL-PREP-010-B — Tenant-Scope Helper Usage and Bypass Inventory

**Phase:** F2 — Modular Monolith Guardrails.
**Type:** Evidence-only. No runtime, schema/migration, CI/workflow, package-script, or shared program-control file touched by this task.
**Baseline:** `origin/main` @ `6f539b237019945443afe6156f9fc2a9fe32ffa4`.
**Isolation:** fresh worktree/branch `docs/f2-guardrail-prep-010-b-tenant-scope-inventory`, created from that exact SHA.
**Parallel wave:** runs alongside F2-IMPL-001-A-R2, PREP-010-A, PREP-010-C. Does not edit `NORAMEDI_MASTER_TRACKER.md`, `CURRENT_PHASE.md`, `F2_MODULAR_BOUNDARIES.md`, or `evidence/README.md`.
**R1 correction (this revision):** resolves PR #315 review threads on the stale `TSI-001…TSI-120` reference (now `TSI-001…TSI-127`) and the `server/src/jobs/*.ts` file count (12→13); adds an explicit count-reconciliation proof (§3), separates platform-global-maintenance jobs from tenant-scoping defects with precise subtypes (§5), adds exploit-precondition/response-shape precision to both verified defects with stable task IDs `F2-SEC-001`/`F2-SEC-002` (§4), and adds reproducible validation commands (§7). See the companion JSON's `countReconciliation`, `legacyExceptionAnalysis`, and `reviewThreadResolutions` keys for full detail.

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

**On the zero counts** — none of the three `0` rows above mean "not checked
for":

- `REQUEST_SUPPLIED_SCOPE_UNVERIFIED = 0`: no record has a user-supplied
  `clinicId` reaching a query/mutation predicate without validation, that
  isn't already captured at higher precedence below.
- `UNSCOPED_RESOURCE_LOOKUP = 0`: the two entry points whose lookup is
  effectively unscoped (§4) are recorded under the higher-precedence
  `VERIFIED_SECURITY_DEFECT_REQUIRES_SEPARATE_FIX` label instead of also
  being counted here — a confirmed live defect is recorded once, under the
  security-defect label, not double-counted under the pattern label
  describing its mechanism.
- `UNRESOLVED = 0`: all three initially-uncertain records (see above, plus
  the legacy WhatsApp API's live-reachability question) were independently
  re-verified by direct source re-read before this document was finalized —
  see §7 item 1.

Record count by transport: 109 route records across the 62 non-imaging route
files reviewed in depth, plus 2 imaging light-touch route records
(`imaging.ts`, `imagingBridgePublic.ts`) = 111 route-transport records; plus
16 job/worker-transport records across 14 files under `server/src/jobs/` and
`server/src/worker.ts` (two jobs — `externalCalendarOutboundSyncJob.ts` and
`inboundEventRetryJob.ts` — each split into a main-loop record and a separate
crash-recovery-step record, see §5). 111 + 16 = **127 total**, matching the
JSON `entryRecords` array's unique `recordId`s `TSI-001`…`TSI-127`.

**Reconciliation proof (physical files vs. records):**

- Physical route files: 64 (`server/src/routes/*.ts`, including `imaging.ts`
  and `imagingBridgePublic.ts` as 2 of the 64 — they are **not** additional
  files layered on top of the 64).
- Physical job/worker files: 13 under `server/src/jobs/*.ts` + 1
  `server/src/worker.ts` = **14** (corrects the prior `12`-file figure flagged
  in PR #315 review; verified directly via `ls server/src/jobs/*.ts | wc -l` →
  `13`).
- `nonImagingRouteRecords (109) + imagingLightTouchRecords (2) + jobWorkerRecords (16) = 127 = totalRecords`. ✓
- `nonImagingRouteRecords (109) + imagingLightTouchRecords (2) = 111 = routeTransportRecords`, spread across all 64 route files. ✓
- Job/worker classification decomposition: `acceptedSystemPerClinicIteration (12) + legacyExceptions (4) + verifiedSecurityDefects (0) + otherJobClassifications (0) = 16 = jobWorkerRecords`. ✓
- The 2 files that each produce 2 records (`externalCalendarOutboundSyncJob.ts`,
  `inboundEventRetryJob.ts`) plus the other 12 job/worker files producing 1
  record each account for all 14 physical files → 16 records (see §5).

Full machine-checkable versions of every count above live in the companion
JSON's `countReconciliation` key.

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
**Recommended task ID:** `F2-SEC-001` — *Enforce Clinic Membership on
Instagram Inbox Status Mutation*.

**Precision notes (R1 correction):**

- **Scope, precisely:** same-organization, cross-**clinic** only. The
  `organizationId` predicate is present and correct, so this is **not**
  unrestricted or cross-organization access — it is scoped to a caller who is
  a legitimate peer in the same organization but lacks membership in the
  target entry's specific clinic.
- **Exploit precondition, precisely:** the caller needs (a) one of the 5
  allowed roles in the same organization, assigned to a *different* clinic
  than the target entry, and (b) the target entry's UUID. Every listing route
  in this same file (`GET /instagram/inbox/clinics`, the inbox list/unassigned
  routes) is itself correctly clinic-scoped, so the id is **not** discoverable
  through this codebase's own in-app browsing/search flow — some other
  channel (a notification, a log line, a prior legitimate cross-clinic
  interaction, or brute-forcing a 128-bit UUID) would be needed to obtain it
  in practice. This does not make the defect safe; it narrows what "reachable"
  means for this specific finding.
- **What is disclosed, precisely:** the response is not status-only. `update()`
  is called with no `select` clause, so the full row — `lastMessageText`,
  `senderUsername`, `externalSenderId`, `patientId`, `messageCount`,
  `rawPayload` — is returned alongside the mutated `status`. This is a
  mutation **and** disclosure defect, not mutation-only.

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
**Recommended task ID:** `F2-SEC-002` — *Remove Global Default-Clinic
Resolution from Legacy WhatsApp Public API*. (Deliberately a separate ID from
`F2-SEC-001` — different file, different root cause, different fix.)

**Precision notes (R1 correction):**

- **Production reachability, precisely:** all 6 routes are unconditional —
  none are gated by `isLegacyFallbackEnabled()`. That flag guards two *other*
  code paths in this same file (`whatsapp.ts:1092` and `:3760`); it does not
  wrap any of the 6 handlers at lines 3832/3848/3864/3879/3913/3962. They are
  reachable in every environment, including production, whenever
  `WHATSAPP_WEBHOOK_SECRET` is configured — this is a live production surface,
  not a dev-only or feature-flagged one.
- **Scope, precisely — misdirection, not a "pick any tenant" bypass:** an
  attacker cannot use this API to *choose* which clinic's data to read or
  write. Every single call, from every caller holding the shared secret,
  always resolves the same one clinic (`getDefaultClinic()`'s result — the
  oldest `Clinic` row database-wide). In a deployment with more than one
  clinic attempting to use this legacy contract, every clinic *other than the
  oldest* would silently receive or mutate the oldest clinic's data instead of
  its own. The risk is therefore a **tenant-resolution/misdirection defect**
  as much as a disclosure one — distinct from a defect where a caller can
  target an arbitrary tenant of their choosing.
- **What is disclosed, precisely:** `GET /appointment-lookup` returns real
  appointment scheduling data (date, time, service name, practitioner name,
  status) for whatever phone number is queried, scoped only to the single
  resolved clinic. `POST /appointment-requests`/`/cancel-request` create real
  `AppointmentRequest` rows against that same clinic. No actual patient
  name/phone/appointment record from any real database is reproduced in this
  evidence document — only the query/response shape is documented.

## 5. System/job per-clinic iteration findings

`server/src/jobs/reminders.ts` and `server/src/jobs/metaTemplateSyncJob.ts`
are the reference-quality examples of the required pattern: enumerate all
clinics/rows (`prisma.clinic.findMany()` / an unfiltered `findMany` that
selects each row's own `clinicId`), then apply an explicit `clinicId`
predicate to every subsequent read/write inside that iteration, with bounded
concurrency (`mapWithConcurrency`, `take: batchSize`) and a `withJobLock`
mutual-exclusion lease.

Five records are classified `LEGACY_EXCEPTION_REQUIRES_ALLOWLIST` — four
job/worker records and one route record. **This label covers two genuinely
different situations, and R1 adds an explicit subtype to each record so they
are not conflated:**

- **`PLATFORM_GLOBAL_MAINTENANCE_ACCEPTED`** — an internal cron job whose
  cross-tenant `updateMany`/`deleteMany` is the deliberate, correct design
  (platform-wide policy enforcement or bounded state-machine repair), not a
  missed clinic filter. Four of the five records carry this subtype, and none
  of them is a tenant-isolation defect.
- **`DRIFT_REFACTOR_RECOMMENDED`** — a route whose local reimplementation of
  the accepted scoping pattern is functionally correct today but should be
  refactored to call the canonical `clinicScope.ts` helper directly, to close
  a maintainability/drift risk (not an active bypass). One record carries this
  subtype.

None of the five contains an `isSystemAdmin`-style flag or a literal "skip all
tenant filtering" bypass condition. Full field-by-field detail (job owner,
runtime enable/disable gate, per-tenant policy dependency, eligibility
predicate, batch bound, transaction behavior, legal-hold applicability,
audit/metrics, cross-tenant leak potential) for every record below lives in
the companion JSON's `legacyExceptionAnalysis` array.

**`PLATFORM_GLOBAL_MAINTENANCE_ACCEPTED` (4 records):**

- **`dataRetentionCleanupJob.ts` (TSI-114)** — org-wide, age-based
  delete/anonymize across 8 categories (`WhatsAppConversationMessage`,
  `ContactRequest`, `WhatsAppInboxEntry`, etc. — real PII fields: phone, name,
  note, message text), by deliberate design: KVKK/GDPR retention is a
  platform-wide legal policy, not a per-clinic one. Gated by a build-time
  enable flag *and* a live runtime toggle re-checked every tick; every batch
  is `findMany({take: batchSize})` → `{id:{in:...}}`-scoped, never an
  open-ended mutation; each of the 8 categories fails independently without
  blocking the others; a distributed job lock prevents concurrent runs. The
  job's own header comment hard-excludes Patient/Appointment/Treatment/
  Payment/Insurance/Attachment/AuditLog/ActivityLog rows and prefers
  anonymization over deletion for PII. **Distinguishing disclosure risk from
  legal/policy risk:** this job never reads-and-returns cross-tenant data to
  any caller (no `crossTenantLeakPossible`) — its risk category is
  `OPERATIONAL_BLAST_RADIUS` (a misconfigured global threshold could
  over-delete platform-wide in one run) and **`POLICY_COUPLING`**: one global
  retention schedule applies to every organization today, with no
  per-organization override. Whether per-org retention overrides should be
  supported is an open **product/legal decision**, not a tenant-isolation
  defect — it is the one item in this set that still warrants a named
  follow-up (see §9/enforcement candidates), but not as a security fix.
- **`imagingBridgeOfflineJob.ts` (TSI-119)** — single `updateMany({status:
  'online', lastSeenAt: {lt: cutoff}} → 'offline')` across all clinics: a
  heartbeat/liveness flag flip only (one enum field), scoped by its own
  status+timestamp predicate, job-locked against overlap. No row content is
  read or returned to any caller.
- **`externalCalendarOutboundSyncJob.ts` (TSI-117, crash-recovery step only —
  the job's main due-row loop, TSI-116, is fully clinic-scoped)** — one
  `updateMany` flipping rows stuck in `'syncing'` for 30+ minutes to
  `'failed_retryable'`, so they re-enter the same per-row, clinic-scoped retry
  path as TSI-116. A pure status-field flip on rows already in one specific
  transient state; no business data mutated, no row content returned.
- **`inboundEventRetryJob.ts` (TSI-121, crash-recovery step only, same shape
  as above — the main retry loop, TSI-120, is fully clinic-scoped)** — one
  `updateMany` flipping rows stuck in `'processing'` for 60+ minutes to
  `'failed'`. Same self-healing, status-field-only pattern as TSI-117.

**`DRIFT_REFACTOR_RECOMMENDED` (1 record):**

- **`financeDashboard.ts` GET `/finance/dashboard` (TSI-022)** — not a job at
  all; a route whose local `resolveClinicScope()` helper independently
  computes `allowedIds` from org+role and validates any requested `clinicId`
  query param against it before use — functionally equivalent to
  `validateAndGetClinicIdScope`, just not calling it directly. Read-only, no
  mutation predicate. The only risk is drift: a future edit to this local
  copy could silently diverge from the canonical helper's semantics. This is
  the same category of local-reimplementation risk noted for `resolveClinicScope`-
  style helpers throughout §2/§6, surfaced here under its own record because
  its independent implementation is more extensive than a one-line inline
  check.

Four other jobs (`clinicBulkExportCleanupJob.ts`, `clinicBulkExportWorker.ts`,
`patientPrivacyExportCleanupJob.ts`, `publicBookingNoticeEvidenceCleanupJob.ts`)
enumerate/mutate rows with no clinic predicate but are accepted as
`ACCEPTED_SYSTEM_PER_CLINIC_ITERATION` because every mutated row is the job's
own ephemeral, single-tenant export/evidence artifact addressed only by its
own internal id — not shared tenant business data reachable by any other
path.

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
   (§4, §5's `LEGACY_EXCEPTION_REQUIRES_ALLOWLIST` records, and the two
   resolved `UNRESOLVED` items): `instagramInbox.ts:62-90, 255-285, 768-796`;
   `server/src/middleware/planLimits.ts:69-104`;
   `server/src/routes/whatsapp.ts:190-215, 1060-1103, 3830-3980` plus
   `server/src/index.ts:183` and `docs/21-whatsapp-n8n-clinic-integration.md`;
   `server/src/services/fileBackupService.ts:96-350`;
   `server/src/jobs/dataRetentionCleanupJob.ts` (full file);
   `server/src/jobs/externalCalendarOutboundSyncJob.ts:1-60`;
   `server/src/jobs/inboundEventRetryJob.ts:1-55`;
   `server/src/jobs/imagingBridgeOfflineJob.ts` (full file);
   `server/src/routes/financeDashboard.ts:1-115`;
   `server/prisma/schema.prisma:1938-1968` (InstagramInboxEntry model shape,
   confirming the unselected `update()` return includes message content).
2. **`git diff --check`** — clean (no whitespace errors) on this task's
   own new files.
3. **Exact reproducible validation commands** (working directory: this
   worktree's root; full copy-paste commands with expected output live in the
   companion JSON's `validationCommands` key):
   - JSON parse → `PARSE_OK`.
   - Record-ID uniqueness → `count=127 unique=127 UNIQUE_OK`.
   - Required-field validation on every `entryRecords` object →
     `ALL_FIELDS_PRESENT`.
   - Classification enum validation (all 9 mandated labels only) →
     `ALL_CLASSIFICATIONS_VALID`.
   - Classification-total parity (declared `classificationTotals` vs.
     computed from `entryRecords`) → `sumComputed=127 declaredTotal=127
     TOTALS_MATCH`.
   - Markdown/JSON record-ID citation parity (every `TSI-###` cited by name
     in this document exists in the JSON) → `mdCitedIds=7 [...]
     ALL_MD_CITATIONS_EXIST_IN_JSON`.
   - Route/imaging/job-worker decomposition parity → `109 + 2 + 16 = 127
     DECOMPOSITION_OK`.
   - Job-classification decomposition parity → `16 vs
     jobWorkerRecordsTotal=16 JOB_DECOMPOSITION_OK`.
   - Physical jobs-file count → `ls server/src/jobs/*.ts | wc -l` = `13`.
   - Final TSI range → `first=TSI-001 last=TSI-127`.
   - Changed-file scope → `git diff origin/main --name-only` lists exactly
     the two evidence files in §9.
   - Forbidden absolute local path check → no match (pass).
   - Sensitive-data/secret-pattern sanity check → no match (pass); only the
     env-var *name* `WHATSAPP_WEBHOOK_SECRET` appears, never a value.
4. **No runtime/schema/migration/workflow/package/shared-control files
   changed** — this task's diff touches only the two new evidence files
   listed in §9 (confirmed via the changed-file-scope command above).
5. **PR #315 review threads resolved** — the stale `TSI-001…TSI-120` range
   (comment 3705959120) and the `server/src/jobs/*.ts` "12 files" count
   (comment 3705959158) are both corrected in this revision; see the JSON's
   `reviewThreadResolutions` key.

## 8. Limitations and exact scope

**In scope (read and classified):**

- All 64 route files under `server/src/routes/*.ts`, including the 2 imaging
  light-touch files (`imaging.ts`, `imagingBridgePublic.ts` — 2 of the 64,
  not additional files).
- All 14 job/worker physical files: 13 under `server/src/jobs/*.ts` +
  `server/src/worker.ts`.
- Webhook and public-integration routes specifically: `externalCalendarWebhook.ts`,
  `instagramWebhook.ts`, `metaWhatsAppWebhook.ts`, `whatsapp.ts`'s
  `/evolution-webhook` and its 6 legacy `/api/public/whatsapp/*` routes,
  `imagingBridgePublic.ts`, `publicBooking.ts`, `publicClinicKvkk.ts` — these
  are exactly the routes that produced TSI-108 and several of the
  false-positive rules in §6.
- Middleware/utility roots: `server/src/middleware/auth.ts`,
  `server/src/middleware/platformAuth.ts`, `server/src/utils/clinicScope.ts`,
  `server/src/utils/tenantGuard.ts`, `server/src/utils/relationGuards.ts`.

**Explicitly out of scope (not read or inventoried):**

- Frontend code (`client/*`) — excluded per the task's CodeGraph focused-roots
  instruction.
- Scripts/CLI tools and Prisma migrations/seed data — the roots list never
  named these; they were not read.
- Test files as entry points — consulted only to check existing cross-tenant
  coverage for specific records (§ testGaps in the JSON), not classified as
  entry points themselves.
- All ~128 files under `server/src/services/` in isolation — service-layer
  logic was inventoried only as invoked from a route/job (e.g.
  `relationGuards.ts` helpers, `resolvePatient()`-equivalent functions). A
  small number of records note specific service functions (e.g.
  `patientAnonymization.ts`, `recallCandidateService.ts`) that receive an
  already-verified `clinicId`/id from their calling route but were not
  independently re-read line-by-line; these are flagged in the JSON
  `testGaps` array as follow-up candidates, not as defects.
- `server/src/services/imaging/public.ts` does not exist on this baseline SHA
  (confirmed via `git ls-tree`) — it is PR #304, unmerged, with its own
  already-documented tenant-context gap tracked under F2-PREP-009 /
  F2-IMPL-001-A_R1. This task does not re-inventory it or count it toward the
  classification totals above.

**Other limitations:**

- **Dynamic registration:** this inventory is based on static reads of each
  file's literal `router.get/post/patch/delete` calls at the pinned SHA. No
  runtime/configuration-driven route registration was observed in the files
  read, but a purely static pass cannot fully rule out an indirect
  registration path outside those files.
- Two minor consistency (non-security) observations were raised by the
  research passes but are not separately classified: `appointments.ts`
  `/available-slots` performs an unscoped initial `doctorId` lookup before an
  explicit clinic-membership gate (not exploitable); `patients.ts` GET `/:id`
  omits a redundant `clinicId` filter on one already-authorized sub-query.
  Both are noted in the JSON `enforcementCandidates` array as low-priority
  cleanup, not bypass candidates.
- No load/fuzz testing was performed; this is a static-source inventory.
- **This inventory does not claim repository-wide completeness** — it claims
  completeness only over the CodeGraph-scoped roots listed above and in the
  JSON's `roots` array.

## 9. Files changed by this task

- `docs/program/evidence/F2-GUARDRAIL-PREP-010-B_TENANT_SCOPE_USAGE_AND_BYPASS_INVENTORY.md` (this file, new)
- `docs/program/evidence/F2-GUARDRAIL-PREP-010-B_tenant_scope_usage_and_bypass_inventory.json` (new)

No other file in the repository is modified by this task.

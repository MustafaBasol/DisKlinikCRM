# F2-PREP-001 — Modular Monolith Domain Ownership and Boundary Inventory

Task: F2-PREP-001 · Phase: F2 PREPARATION — Modular Monolith Boundary Definition · Type: READ-ONLY ARCHITECTURE DISCOVERY (evidence files only — no code, schema, migration, or index-document change). Max status: `AGENT_COMPLETED` / `PR_OPENED_AWAITING_REVIEW`. Not merged, not deployed, not production-verified.

The structured/machine-readable form of this same evidence is [`F2-PREP-001_domain_ownership_inventory.json`](F2-PREP-001_domain_ownership_inventory.json).

## 1. Baseline

- Branch: `origin/main`
- Baseline SHA: `70b1690c1a656c95cead7b42812cc9ae6447bfb7`
- Baseline commit date: `2026-08-01T22:13:44+02:00`
- Baseline commit subject: "Merge pull request #275 from MustafaBasol/feature/external-calendar-outbound-sync-phase2"
- Working tree at task start: clean (`git status --short` empty)
- New branch: `docs/f2-prep-001-domain-ownership-inventory`
- New isolated worktree: a fresh isolated git worktree was created via `git worktree add -b ... origin/main`, separate from the primary worktree and from PR #268's worktree (neither was touched). The author-machine local filesystem path is deliberately omitted from this evidence — it is not portable/reproducible information.
- No rebase performed. No force push performed.

## 2. Methodology — this task inherits, reconciles, and extends prior evidence; it does not re-derive from zero

This repository already contains a repository-evidence-verified, program-accepted domain/module ownership map:

- **F0-003** — [`MODULE_MAP.md`](../MODULE_MAP.md) / [`F0-003_module_ownership_inventory.json`](F0-003_module_ownership_inventory.json) / [`F0-003_MODULE_OWNERSHIP_EVIDENCE.md`](F0-003_MODULE_OWNERSHIP_EVIDENCE.md) — 37 domains, 88 committed Prisma models, pinned to commit `368bcc8d0a9f4c0ea185ca33d4dd1193d8def9ef`.
- **F0-004** — [`DEPENDENCY_MAP.md`](../DEPENDENCY_MAP.md) / `F0-004_dependency_inventory.json` — 37×37 cross-domain dependency matrix, 833 edges, 9 high-risk boundary violations, 35 two-domain cycles, 15 contract candidates.
- Both are already cited as accepted evidence by **ADR-001** (Modular monolith, `ACCEPTED`), **ADR-014** (Feature flags/entitlements/permissions, `ACCEPTED`), and **ADR-015** (Module boundaries and public contracts, `ACCEPTED_WITH_CONDITIONS`) per [`ARCHITECTURE_DECISIONS.md`](../ARCHITECTURE_DECISIONS.md).

Re-deriving all of this from a whole-project scan would duplicate already-accepted work, cost far more tokens than necessary, and risks silently contradicting evidence three ADRs already rely on. Consistent with this task's own instruction to prefer targeted queries over whole-project exploratory scans, this task instead:

1. **Reconciled** the F0-003/F0-004 baseline commit (`368bcc8d`) against the current baseline (`70b1690c`) via `git diff --stat` / `git diff --name-status` scoped to `server/src/routes`, `server/src/services`, `server/prisma/schema.prisma`, `src/pages`, `src/components` — **164 files changed, 37354 insertions(+), 530 deletions(-)** since the F0-003/F0-004 evidence was captured.
2. Classified every route/service/model touched by that diff.
3. Added **one new domain** (External Calendar Integration) whose routes/services/models did not exist at the F0-003/F0-004 baseline commit and are absent from `MODULE_MAP.md`/`DEPENDENCY_MAP.md`.
4. Extended **three existing domains** whose evidence materially changed since the baseline: Privacy / Consent / Retention / DSR (Communication Consent + Legacy Consent Correction + Retention Manual-Run Audit subsystems), Platform Administration (`PlatformAdminAuditEvent` + `platformAdminAudit.ts`), and Storage Abstraction (File Backup subsystem).
5. Added the **4-bucket Prisma-model ownership-category classification** (`DOMAIN_OWNED` / `SHARED_KERNEL_CANDIDATE` / `PLATFORM_INFRASTRUCTURE` / `OWNERSHIP_AMBIGUOUS`) this task's brief requires, which F0-003 did not use (F0-003 used per-domain primary-owner + tenant-scope + sensitivity only).
6. Added the **target module shape** recommendation per domain this task's brief requires, which F0-003/F0-004 did not produce.

All 37 inherited domains are **unchanged in identity, name, and model set** from the accepted `MODULE_MAP.md` unless explicitly flagged in that domain's evidence below. No domain was renamed, merged, or invented beyond the one addition above, and no boundary already accepted by ADR-001/014/015 was second-guessed.

### 2.1 CodeGraph usage

`codegraph status` and `which codegraph` were both attempted. Result: **CodeGraph is unavailable** in this environment (`command not found`). This is at minimum the **seventh independent confirmation** of CodeGraph unavailability recorded across this program (see `CURRENT_PHASE.md`'s F1-003-P2-R2 entry: "CodeGraph confirmed unavailable — sixth+ independent confirmation this program"). Per this task's own fallback instruction, targeted `Read`/`Grep`/`Glob`/`git diff` was used instead, scoped strictly to `server/src/{routes,services,jobs}`, `server/prisma/schema.prisma`, `server/src/index.ts` (route mounting table), `server/package.json`, root `package.json`, `src/pages`, `src/components` — matching the same CODEGRAPH-DISCIPLINE-scoped root set F0-003 used. No whole-project exploratory scan was run.

### 2.2 Paths inspected

`AGENTS.md`; `docs/program/NORAMEDI_MASTER_TRACKER.md` (targeted grep for F2/F2-PREP entries — no matches, confirming F2 has not started; not read in full, as the file exceeds a single read's token budget); `docs/program/CURRENT_PHASE.md` (head section, confirming F1 is the active phase); `docs/program/phases/F2_MODULAR_BOUNDARIES.md`; `docs/program/MODULE_MAP.md`; `docs/program/DEPENDENCY_MAP.md`; `docs/program/ARCHITECTURE_DECISIONS.md` (ADR-001 through ADR-017 read in full); `docs/program/evidence/F0-003_MODULE_OWNERSHIP_EVIDENCE.md` and `F0-003_module_ownership_inventory.json` (read in full); root `package.json` and `server/package.json` (manifests, single-app monolith confirmed — no workspaces); `server/prisma/schema.prisma` (model count, 11 new model definitions read directly); `server/src/index.ts` (route-mounting table, lines ~178–260); `server/src/jobs/` (directory listing); `src/pages/platform/` (directory listing); `git diff --stat`/`--name-status 368bcc8d..HEAD` scoped as above.

## 3. Domain summary (38 domains: 37 inherited from F0-003/F0-004 + 1 new)

Security/Tenant-Isolation/KVKK sensitivity and Coupling columns are this task's own additions (not present in `MODULE_MAP.md`), derived from the F0-003 per-model sensitivity/scope evidence and the F0-004 dependency-matrix fan-in/fan-out ranking (§10.3 of `DEPENDENCY_MAP.md`) respectively.

| Code | Domain | Classification | Criticality | Security | Tenant-Isolation | KVKK | Coupling | Ownership ambiguity |
|---|---|---|---|---|---|---|---|---|
| IDA | Identity and Access | core platform | regulatory/tenant-critical | HIGH | MEDIUM-HIGH (organization-scoped data) | HIGH (personal data or credentials present) | HIGH (high fan-in — root tenant/platform center, expected) | YES |
| ORG | Organization / Clinic / User Membership | core platform | regulatory/tenant-critical | HIGH | HIGH (clinic-scoped data — primary tenant-isolation boundary) | HIGH (personal data or credentials present) | HIGH (high fan-in — root tenant/platform center, expected) | YES |
| TSC | Tenant Security and Scope | core platform | regulatory/tenant-critical | HIGH | N/A or inherited from core Tenant Security and Scope | LOW-INDIRECT (no owned models; reads/orchestrates other domains' PD/HD data) | MEDIUM (core platform dependency, narrow surface) | — |
| PRM | Permissions / Roles | core platform | high-risk | HIGH | N/A or inherited from core Tenant Security and Scope | LOW-INDIRECT (no owned models; reads/orchestrates other domains' PD/HD data) | LOW-MEDIUM (feature domain, bounded dependency set — see DEPENDENCY_MAP.md §10.2 row) | YES |
| AUD | Audit and Activity | core platform | regulatory/tenant-critical | HIGH | HIGH (clinic-scoped data — primary tenant-isolation boundary) | LOW (operational/audit data only) | HIGH (high fan-in — root tenant/platform center, expected) | — |
| PRV | Privacy / Consent / Retention / Data Subject Rights | core platform | regulatory/tenant-critical | HIGH | HIGH (clinic-scoped data — primary tenant-isolation boundary) | HIGH (personal data or credentials present) | HIGH (high fan-out — DEPENDENCY_MAP.md §10.3, "god module" signature) | YES |
| SEC | Security Incident Response and Detection | core platform | regulatory/tenant-critical | HIGH | N/A or inherited from core Tenant Security and Scope | LOW (operational/audit data only) | MEDIUM (core platform dependency, narrow surface) | YES |
| CFG | Configuration and Secrets | core platform | high-risk | HIGH | HIGH (clinic-scoped data — primary tenant-isolation boundary) | LOW (operational/audit data only) | MEDIUM (core platform dependency, narrow surface) | — |
| OBS | Observability / Operational Events | core platform | elevated | MEDIUM | MEDIUM-HIGH (organization-scoped data) | LOW (operational/audit data only) | MEDIUM (core platform dependency, narrow surface) | — |
| EVQ | Shared Events / Queue Contracts / Idempotency | core platform | high-risk | HIGH | LOW (global/platform reference data, not tenant data) | LOW (operational/audit data only) | MEDIUM (core platform dependency, narrow surface) | — |
| STG | Storage Abstraction | core platform | high-risk | HIGH | N/A or inherited from core Tenant Security and Scope | LOW-INDIRECT (no owned models; reads/orchestrates other domains' PD/HD data) | MEDIUM (core platform dependency, narrow surface) | YES |
| NTF | Notifications | core platform | normal | LOW | HIGH (clinic-scoped data — primary tenant-isolation boundary) | LOW (operational/audit data only) | MEDIUM (core platform dependency, narrow surface) | — |
| PAD | Platform Administration | platform capability | high-risk | HIGH | LOW (global/platform reference data, not tenant data) | HIGH (personal data or credentials present) | HIGH (high fan-out — DEPENDENCY_MAP.md §10.3, "god module" signature) | YES |
| PAT | Patients | core clinical | regulatory/tenant-critical | HIGH | HIGH (clinic-scoped data — primary tenant-isolation boundary) | HIGH (health/special-category data present) | LOW-MEDIUM (feature domain, bounded dependency set — see DEPENDENCY_MAP.md §10.2 row) | — |
| APT | Appointments and Availability | core clinical | regulatory/tenant-critical | HIGH | HIGH (clinic-scoped data — primary tenant-isolation boundary) | HIGH (personal data or credentials present) | HIGH (high fan-in — root tenant/platform center, expected) | — |
| TRC | Treatment Cases | core clinical | elevated | MEDIUM | HIGH (clinic-scoped data — primary tenant-isolation boundary) | HIGH (health/special-category data present) | LOW-MEDIUM (feature domain, bounded dependency set — see DEPENDENCY_MAP.md §10.2 row) | — |
| DEN | Dental Chart / Procedures | core clinical | elevated | MEDIUM | HIGH (clinic-scoped data — primary tenant-isolation boundary) | HIGH (health/special-category data present) | LOW-MEDIUM (feature domain, bounded dependency set — see DEPENDENCY_MAP.md §10.2 row) | — |
| PUB | Public Booking | core clinical | elevated | MEDIUM | N/A or inherited from core Tenant Security and Scope | LOW-INDIRECT (no owned models; reads/orchestrates other domains' PD/HD data) | LOW-MEDIUM (feature domain, bounded dependency set — see DEPENDENCY_MAP.md §10.2 row) | YES |
| PAY | Basic Payments | core clinical | elevated | MEDIUM | HIGH (clinic-scoped data — primary tenant-isolation boundary) | MEDIUM (financial data, KVKK-adjacent) | LOW-MEDIUM (feature domain, bounded dependency set — see DEPENDENCY_MAP.md §10.2 row) | — |
| TSK | Tasks and Follow-up | core clinical | normal | LOW | HIGH (clinic-scoped data — primary tenant-isolation boundary) | LOW (operational/audit data only) | LOW-MEDIUM (feature domain, bounded dependency set — see DEPENDENCY_MAP.md §10.2 row) | — |
| WHA | Messaging — WhatsApp | optional operational | elevated | MEDIUM | HIGH (clinic-scoped data — primary tenant-isolation boundary) | HIGH (personal data or credentials present) | HIGH (high fan-out — DEPENDENCY_MAP.md §10.3, "god module" signature) | YES |
| IGM | Messaging — Instagram | optional operational | elevated | MEDIUM | HIGH (clinic-scoped data — primary tenant-isolation boundary) | HIGH (personal data or credentials present) | LOW-MEDIUM (feature domain, bounded dependency set — see DEPENDENCY_MAP.md §10.2 row) | — |
| SMS | Messaging — SMS | optional operational | elevated | MEDIUM | HIGH (clinic-scoped data — primary tenant-isolation boundary) | HIGH (personal data or credentials present) | LOW-MEDIUM (feature domain, bounded dependency set — see DEPENDENCY_MAP.md §10.2 row) | — |
| EML | Messaging — Email | optional operational | normal | LOW | N/A or inherited from core Tenant Security and Scope | LOW-INDIRECT (no owned models; reads/orchestrates other domains' PD/HD data) | LOW-MEDIUM (feature domain, bounded dependency set — see DEPENDENCY_MAP.md §10.2 row) | YES |
| AIO | Messaging AI Orchestration | optional operational | elevated | MEDIUM | N/A or inherited from core Tenant Security and Scope | LOW-INDIRECT (no owned models; reads/orchestrates other domains' PD/HD data) | LOW-MEDIUM (feature domain, bounded dependency set — see DEPENDENCY_MAP.md §10.2 row) | YES |
| REC | Automations / Reminders / Follow-up / Recall | optional operational | elevated | MEDIUM | HIGH (clinic-scoped data — primary tenant-isolation boundary) | HIGH (personal data or credentials present) | HIGH (high fan-out — DEPENDENCY_MAP.md §10.3, "god module" signature) | — |
| IMG | Imaging — Server Ingest and Viewer | optional operational | elevated | MEDIUM | HIGH (clinic-scoped data — primary tenant-isolation boundary) | HIGH (health/special-category data present) | LOW-MEDIUM (feature domain, bounded dependency set — see DEPENDENCY_MAP.md §10.2 row) | YES |
| BRG | Imaging — Device Bridge / Windows Bridge | external adapter/integration | elevated | MEDIUM | HIGH (clinic-scoped data — primary tenant-isolation boundary) | HIGH (personal data or credentials present) | LOW-MEDIUM (feature domain, bounded dependency set — see DEPENDENCY_MAP.md §10.2 row) | YES |
| INV | Inventory | optional operational | normal | LOW | HIGH (clinic-scoped data — primary tenant-isolation boundary) | LOW (operational/audit data only) | LOW-MEDIUM (feature domain, bounded dependency set — see DEPENDENCY_MAP.md §10.2 row) | — |
| INS | Insurance | optional operational | normal | LOW | HIGH (clinic-scoped data — primary tenant-isolation boundary) | HIGH (personal data or credentials present) | LOW-MEDIUM (feature domain, bounded dependency set — see DEPENDENCY_MAP.md §10.2 row) | — |
| FIN | Advanced Finance — Compensation and Payouts | optional operational | elevated | MEDIUM | HIGH (clinic-scoped data — primary tenant-isolation boundary) | MEDIUM (financial data, KVKK-adjacent) | LOW-MEDIUM (feature domain, bounded dependency set — see DEPENDENCY_MAP.md §10.2 row) | — |
| RPT | Reporting / Analytics | optional operational | normal | LOW | N/A or inherited from core Tenant Security and Scope | LOW-INDIRECT (no owned models; reads/orchestrates other domains' PD/HD data) | HIGH (high fan-out — DEPENDENCY_MAP.md §10.3, "god module" signature) | YES |
| LAB | Dental Laboratory / Prosthetics Tracking | optional operational | normal | LOW | HIGH (clinic-scoped data — primary tenant-isolation boundary) | HIGH (health/special-category data present) | LOW-MEDIUM (feature domain, bounded dependency set — see DEPENDENCY_MAP.md §10.2 row) | — |
| PAI | AI Platform / AI Gateway | planned/not implemented | normal | LOW | N/A or inherited from core Tenant Security and Scope | LOW-INDIRECT (no owned models; reads/orchestrates other domains' PD/HD data) | NONE (not implemented) | YES |
| PIG | Integration Platform (Official/Ministry Adapters) | planned/not implemented | normal | LOW | N/A or inherited from core Tenant Security and Scope | LOW-INDIRECT (no owned models; reads/orchestrates other domains' PD/HD data) | NONE (not implemented) | YES |
| PBL | Billing / Subscription Engine | planned/not implemented | normal | LOW | N/A or inherited from core Tenant Security and Scope | LOW-INDIRECT (no owned models; reads/orchestrates other domains' PD/HD data) | NONE (not implemented) | — |
| PCM | Campaign Management / Health Tourism / Invoicing | planned/not implemented | normal | LOW | N/A or inherited from core Tenant Security and Scope | LOW-INDIRECT (no owned models; reads/orchestrates other domains' PD/HD data) | NONE (not implemented) | YES |
| EXC | External Calendar Integration | external adapter/integration | elevated | HIGH (encrypted OAuth2 client secret + webhook HMAC secret; write-only credential API) | HIGH (clinic-scoped, ExternalCalendarIntegration.clinicId @unique — one active integration per clinic) | MEDIUM-HIGH (ExternalCalendarAppointmentLink references Appointment, which is PD-adjacent via patient link; rawPayload on ExternalCalendarInboundEvent may echo provider-side PII — see sanitization notes in schema comments) | LOW-MEDIUM (new domain; direct FK/read dependency on Appointments and Availability [Appointment], Identity and Access [User via practitioner mapping], and Organization/Clinic/Membership [Clinic] — not yet present in the accepted F0-004 matrix, so not independently verified against that matrix's C/E/S/X coding by this task) | YES |

**Coupling-level legend:** `HIGH` domains named in F0-004 §10.3 as top-5 fan-out (`WHA` 106 edges, `PRV` 97, `RPT` 67, `PAD` 64, `REC` 62 — "god module" signature) or top-4 fan-in (`ORG` 128, `APT` 116, `IDA` 114, `AUD` 68 — expected root-tenant/platform centers). `MEDIUM`/`LOW-MEDIUM` derived qualitatively from each domain's own `DEPENDENCY_MAP.md` §10.2 matrix row. `NONE` = not implemented. External Calendar Integration (`EXC`) is **not yet coded into the F0-004 matrix** — its coupling level is this task's own bounded estimate from the FK/import evidence gathered below, not an F0-004-equivalent evidence tier (see §9 non-claims).

## 4. Domain-to-route / domain-to-service / domain-to-frontend map

Full per-domain file lists (all routes, all services, all frontend files, all Prisma models, external providers, scheduled jobs, target module shape) are in the JSON inventory's `domains[]` array. This table is a compact summary satisfying the "domain-to-route/service/frontend map" acceptance-criteria items directly in this document.

| Code | Domain | Routes | Services (top-level, see JSON for full list) | Frontend |
|---|---|---|---|---|
| IDA | Identity and Access | auth.ts | 7 files — auth.ts; csrf.ts; authFallback.ts; totp.ts, … | 6 files — Login.tsx; Register.tsx; ForgotPassword.tsx, … |
| ORG | Organization / Clinic / User Membership | clinicRegistration.ts; organizationBranches.ts; organizationDashboard.ts; users.ts; usersImport.ts | 2 files — clinicOperatingPreferences.ts; planLimits.ts | 7 files — Branches.tsx; OrganizationDashboard.tsx; Users.tsx, … |
| TSC | Tenant Security and Scope | — | 4 files — clinicAccess.ts; clinicScope.ts; tenantGuard.ts; relationGuards.ts | — |
| PRM | Permissions / Roles | — | 1 file — roles.ts | — |
| AUD | Audit and Activity | — | 2 files — activity.ts; auditLog.ts | — |
| PRV | Privacy / Consent / Retention / Data Subject Rights | patientPrivacy.ts; gdprExport.ts; clinicBulkExport.ts; clinicLegalProfile.ts; publicClinicKvkk.ts; communicationPreferences.ts | 25 files — clinicBulkExportConfig.ts; clinicBulkExportFieldAllowlists.ts; clinicBulkExportPackage.ts; clinicBulkExportPasswordAttempts.ts, … | 17 files — ClinicKvkkPublicPage.tsx; CommunicationsNoticePage.tsx; ConsentTemplatePage.tsx, … |
| SEC | Security Incident Response and Detection | platformSecurityIncidents.ts | 3 files — securityDetectionRules.ts; securityIncidentService.ts; securitySignalService.ts | 1 file — PlatformSecurityIncidents.tsx |
| CFG | Configuration and Secrets | settings.ts | 3 files — platformSettings.ts; secrets.ts; encryption.ts | 1 file — Settings.tsx |
| OBS | Observability / Operational Events | operationalMonitoring.ts | 2 files — operationalEventService.ts; logger.ts | 2 files — PlatformSystem.tsx; Operations.tsx |
| EVQ | Shared Events / Queue Contracts / Idempotency | — | 3 files — messagingInboundIdempotency.ts; jobLock.ts; concurrency.ts | — |
| STG | Storage Abstraction | — | 5 files — fileStorage.ts; fileSignature.ts; filePreview.ts; fileBackupService.ts, … | 1 file — FilePreviewModal.tsx |
| NTF | Notifications | notifications.ts | 2 files — notificationPreferences.ts; taskAssignmentNotifier.ts | 1 file — NotificationBell.tsx |
| PAD | Platform Administration | platformAdmin.ts | 3 files — backupService.ts; platformAuth.ts; platformAdminAudit.ts | 8 files — PlatformAdmin.tsx; PlatformBackups.tsx; PlatformClinics.tsx, … |
| PAT | Patients | patients.ts; patientsImport.ts; attachments.ts | 2 files — patientName.ts; excelImport.ts | 5 files — Patients.tsx; PatientDetail.tsx; PatientForm.tsx, … |
| APT | Appointments and Availability | appointments.ts; appointmentRequests.ts; schedules.ts; contactRequests.ts; services.ts; noShows.ts | 4 files — appointmentAvailabilityService.ts; appointmentRequestSafety.ts; appointmentRequestNotification.ts; noShowFollowUp.ts | 11 files — Appointments.tsx; AppointmentDetail.tsx; AppointmentRequests.tsx, … |
| TRC | Treatment Cases | treatmentCases.ts; treatmentPackages.ts | — | 4 files — TreatmentCases.tsx; TreatmentCaseDetail.tsx; TreatmentCaseForm.tsx, … |
| DEN | Dental Chart / Procedures | dentalChart.ts; treatmentPlanProcedures.ts | 1 file — treatmentStockDeduction.ts | 5 files — DentalChart.tsx; dentalChart.types.ts; DentalChartFullscreenModal.tsx, … |
| PUB | Public Booking | publicBooking.ts | — | 4 files — BookingWidget.tsx; bookingWidgetHelpers.ts; LandingPage.tsx, … |
| PAY | Basic Payments | payments.ts; paymentPlans.ts | 2 files — overdueInstallments.ts; overdueReceivables.ts | 5 files — Payments.tsx; PaymentPlans.tsx; PaymentForm.tsx, … |
| TSK | Tasks and Follow-up | tasks.ts | — | 2 files — Tasks.tsx; TaskForm.tsx |
| WHA | Messaging — WhatsApp | whatsapp.ts; whatsappInbox.ts; metaWhatsAppWebhook.ts; organizationWhatsApp.ts | 18 files — clinicResolver.ts; conversationMessageStore.ts; EvolutionWhatsAppProvider.ts; MetaCloudWhatsAppProvider.ts, … | 7 files — WhatsAppConnections.tsx; WhatsAppInbox.tsx; MetaCallbackPage.tsx, … |
| IGM | Messaging — Instagram | instagramInbox.ts; instagramWebhook.ts; organizationInstagram.ts | 3 files — instagramAiConversationProcessor.ts; instagramClinicResolver.ts; InstagramMessagingProvider.ts | 2 files — InstagramConnections.tsx; InstagramInbox.tsx |
| SMS | Messaging — SMS | sms.ts | 8 files — platformSmsProviders.ts; smsEntitlement.ts; SmsProvider.ts; smsProviders.ts, … | 1 file — SmsSettingsSection.tsx |
| EML | Messaging — Email | — | 2 files — emailService.ts; emailTemplates.ts | — |
| AIO | Messaging AI Orchestration | — | 12 files — whatsappAgentPrompt.ts; whatsappAgentSchema.ts; whatsappAvailability.ts; whatsappBookingFlow.ts, … | — |
| REC | Automations / Reminders / Follow-up / Recall | recall.ts; postTreatment.ts | 4 files — recallCandidateService.ts; recallSettings.ts; postTreatmentMessaging.ts; noShowFollowUp.ts (shared with clinical-appointments-availability) | 8 files — RecallDashboard.tsx; RecallActionModal.tsx; RecallCandidateStatusBadge.tsx, … |
| IMG | Imaging — Server Ingest and Viewer | imaging.ts | 3 files — imagingRequestTransitions.ts; imagingUploadValidation.ts; releaseMetadataValidation.ts | 5 files — ImagingQueue.tsx; DicomViewer.tsx; dicomHelpers.ts, … |
| BRG | Imaging — Device Bridge / Windows Bridge | imagingBridgePublic.ts | 4 files — bridgeOnboardingConfig.ts; bridgePairing.ts; bridgeTokens.ts; bridgeUpdateConfig.ts | 6 files — bridgeHelpers.ts; BridgeOnboardingCard.tsx; BridgeSetupWizard.tsx, … |
| INV | Inventory | inventory.ts | 2 files — inventoryAlerts.ts; treatmentStockDeduction.ts | 1 file — Inventory.tsx |
| INS | Insurance | insuranceProvisions.ts | — | 3 files — InsuranceProvisions.tsx; InsuranceProvisionDetail.tsx; InsuranceProvisionForm.tsx |
| FIN | Advanced Finance — Compensation and Payouts | financeDashboard.ts; compensationRules.ts; practitionerEarnings.ts; practitionerPayouts.ts | 1 file — earningService.ts | 3 files — FinanceDashboard.tsx; MyEarnings.tsx; PractitionerEarnings.tsx |
| RPT | Reporting / Analytics | reports.ts; dashboard.ts; organizationDashboard.ts | — | 2 files — Reports.tsx; Dashboard.tsx |
| LAB | Dental Laboratory / Prosthetics Tracking | laboratories.ts; labOrders.ts | 2 files — labOrderStatusTransitions.ts; labOrderSummary.ts | 1 file — LabOrders.tsx |
| PAI | AI Platform / AI Gateway | — | 1 file — googleAiStudio.ts (only generic AI-provider file found) | — |
| PIG | Integration Platform (Official/Ministry Adapters) | — | — | — |
| PBL | Billing / Subscription Engine | — | — | 2 files — PricingPage.tsx (marketing page, not a billing engine); comparison UI, not billing logic) |
| PCM | Campaign Management / Health Tourism / Invoicing | — | — | — |
| EXC | External Calendar Integration | externalCalendarWebhook.ts (public); platformExternalCalendar.ts (platform admin config); externalCalendarOutboundSyncStatusRoutes.ts (tenant API, exact filename externalCalendarOutboundSyncStatus.ts) | 13 files — ExternalCalendarProvider.ts; externalCalendarConnectionService.ts; externalCalendarErrors.ts; externalCalendarIdempotency.ts, … | 1 file — PlatformExternalCalendar.tsx |

## 5. Complete Prisma model ownership table (99 models, current HEAD)

88 models are the F0-003 committed baseline (unchanged ownership, carried forward from `F0-003_MODULE_OWNERSHIP_EVIDENCE.md` §3). 11 models are new since that baseline (`PlatformAdminAuditEvent`, `PatientCommunicationPreference`, `PatientCommunicationConsentEvent`, `CommunicationConsentConflictBucket`, `PatientLegacyConsentCorrection`, `FileBackupRun`, `FileBackupEntry`, `ExternalCalendarIntegration`, `ExternalCalendarMapping`, `ExternalCalendarInboundEvent`, `ExternalCalendarAppointmentLink`) — confirmed via `git diff 368bcc8d..HEAD -- server/prisma/schema.prisma` (`grep -E "^\+model "`) and each read directly from `server/prisma/schema.prisma` in full for this task.

**Ownership-category definitions** (this task's own 4-bucket classification, applied on top of F0-003's per-domain primary-owner evidence):

- **`DOMAIN_OWNED`** — exactly one feature/business domain owns this model's data; other domains that touch it do so transitionally (direct read/write, no contract) or not at all.
- **`SHARED_KERNEL_CANDIDATE`** — a root identity/tenant-backbone entity (`User`, `Clinic`, `Organization`, `Plan`, join tables `UserClinic`/`PatientClinic`, `ClinicWorkingHours`, `ClinicInvitation`) or an explicitly cross-channel reference model (`MessageTemplate`) that essentially every domain legitimately needs read access to — a DDD "shared kernel," not a single domain's private data.
- **`PLATFORM_INFRASTRUCTURE`** — a technical/audit/security/config primitive (`JobLock`, `PlatformSetting`, audit/security-event ledgers, password/verification tokens) rather than clinic business data, even when its owning domain is classified "core platform."
- **`OWNERSHIP_AMBIGUOUS`** — F0-003 itself flagged this as genuinely unresolved (`ContactRequest` — "shared/ambiguous owner" per F0-003 §3, "channel-agnostic intake" candidate per F0-003 §8).

**Coverage: 99/99 committed Prisma models mapped to exactly one ownership-category row. No model was silently omitted.**

| Model | Owning domain | Ownership category | Tenant scope | Sensitivity | Crosses boundary | Reference type | Direct Prisma temp-allowed | Recommended contract direction |
|---|---|---|---|---|---|---|---|---|
| Clinic | Organization/Clinic/Membership | SHARED_KERNEL_CANDIDATE | OS | OP | YES | identity | yes | expose via a shared-kernel read contract (e.g. ClinicDirectory/OrganizationDirectory/AuthenticatedUserContext) — remains readable by all modules but only through a stable contract, not raw joins |
| User | Identity and Access | SHARED_KERNEL_CANDIDATE | OS(+CS home) | CR+PD | YES | identity | yes | expose via a shared-kernel read contract (e.g. ClinicDirectory/OrganizationDirectory/AuthenticatedUserContext) — remains readable by all modules but only through a stable contract, not raw joins |
| DoctorAvailability | Appointments and Availability | DOMAIN_OWNED | CS | OP | — | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| DoctorOffDay | Appointments and Availability | DOMAIN_OWNED | CS | OP | — | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| Patient | Patients | DOMAIN_OWNED | OS(+CS primary) | PD/HD-adjacent | YES | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| AppointmentType | Appointments and Availability | DOMAIN_OWNED | CS | OP | YES | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| Appointment | Appointments and Availability | DOMAIN_OWNED | CS | OP (PD-adjacent via patient link) | YES | transaction | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| AppointmentRequest | Appointments and Availability | DOMAIN_OWNED | CS | PD | YES | transaction | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| ContactRequest | Appointments and Availability (channel-agnostic intake) | OWNERSHIP_AMBIGUOUS | CS | PD | YES | identity_or_reference_data | yes | ownership must be resolved (Appointments vs. a channel-agnostic intake domain) before any contract is designed |
| WhatsAppConversationState | Messaging — WhatsApp | DOMAIN_OWNED | CS | PD | — | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| WhatsAppConversationMessage | Messaging — WhatsApp | DOMAIN_OWNED | CS | PD | — | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| TreatmentCase | Treatment Cases | DOMAIN_OWNED | CS | HD-adjacent | YES | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| TreatmentPackage | Treatment Cases | DOMAIN_OWNED | CS | OP | YES | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| TreatmentPackageItem | Treatment Cases | DOMAIN_OWNED | CS | OP | — | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| AppointmentTypeMaterial | Inventory | DOMAIN_OWNED | CS | OP | YES | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| TreatmentPackageMaterial | Inventory | DOMAIN_OWNED | CS | OP | YES | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| TreatmentPackageApplication | Treatment Cases | DOMAIN_OWNED | CS | OP | YES | transaction | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| InsuranceProvision | Insurance | DOMAIN_OWNED | CS | FIN/PD | — | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| Task | Tasks and Follow-up | DOMAIN_OWNED | CS | OP | YES | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| Payment | Basic Payments | DOMAIN_OWNED | CS | FIN | YES | transaction | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| MessageTemplate | Shared Contract/Reference Data | SHARED_KERNEL_CANDIDATE | CS | OP | YES | identity_or_reference_data | yes | expose via a shared-kernel read contract (e.g. ClinicDirectory/OrganizationDirectory/AuthenticatedUserContext) — remains readable by all modules but only through a stable contract, not raw joins |
| SentMessage | Messaging — WhatsApp (primary) | DOMAIN_OWNED | CS(+OS) | PD | YES | transaction | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| ActivityLog | Audit and Activity | PLATFORM_INFRASTRUCTURE | CS | AU | YES | evidence | yes | expose via Core public contract (e.g. AuditService.record(), StoragePort, SecuritySignalIngest) — no direct cross-module table access once F2 boundaries are enforced |
| Setting | Configuration and Secrets | PLATFORM_INFRASTRUCTURE | CS | OP | — | identity_or_reference_data | yes | expose via Core public contract (e.g. AuditService.record(), StoragePort, SecuritySignalIngest) — no direct cross-module table access once F2 boundaries are enforced |
| ClinicRecallSetting | Automations / Recall / Follow-up | DOMAIN_OWNED | CS | OP | — | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| RecallCandidate | Automations / Recall / Follow-up | DOMAIN_OWNED | CS | PD | YES | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| RecallAction | Automations / Recall / Follow-up | DOMAIN_OWNED | CS | PD | YES | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| PatientAttachment | Patients | DOMAIN_OWNED | CS | PD/HD | YES | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| ToothRecord | Dental Chart / Procedures | DOMAIN_OWNED | CS | HD | — | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| PaymentPlan | Basic Payments | DOMAIN_OWNED | CS | FIN | — | transaction | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| PaymentPlanInstallment | Basic Payments | DOMAIN_OWNED | PI (via planId) | FIN | — | transaction | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| PractitionerCompensationRule | Advanced Finance | DOMAIN_OWNED | CS | FIN | — | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| ServiceCompensationRule | Advanced Finance | DOMAIN_OWNED | CS | FIN | — | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| PractitionerEarning | Advanced Finance | DOMAIN_OWNED | CS | FIN | YES | transaction | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| PractitionerPayout | Advanced Finance | DOMAIN_OWNED | CS | FIN | — | transaction | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| InventoryItem | Inventory | DOMAIN_OWNED | OS | OP | — | identity_or_reference_data | yes | wrap in an explicit command/event (e.g. Inventory stock-adjustment command, LegalHold contract) so the existing direct cross-domain write is replaced |
| InventoryTransaction | Inventory | DOMAIN_OWNED | CS | OP | YES | transaction | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| TreatmentPlanProcedure | Dental Chart / Procedures | DOMAIN_OWNED | CS | HD | YES | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| Notification | Notifications | DOMAIN_OWNED | CS | OP | — | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| Plan | Organization/Clinic/Membership (reference) | SHARED_KERNEL_CANDIDATE | G | OP | YES | identity | yes | expose via a shared-kernel read contract (e.g. ClinicDirectory/OrganizationDirectory/AuthenticatedUserContext) — remains readable by all modules but only through a stable contract, not raw joins |
| PlatformAdmin | Platform Administration | PLATFORM_INFRASTRUCTURE | G | CR | — | identity_or_reference_data | yes | expose via Core public contract (e.g. AuditService.record(), StoragePort, SecuritySignalIngest) — no direct cross-module table access once F2 boundaries are enforced |
| ClinicInvitation | Organization/Clinic/Membership | SHARED_KERNEL_CANDIDATE | CS(+OS) | PD | — | identity | yes | expose via a shared-kernel read contract (e.g. ClinicDirectory/OrganizationDirectory/AuthenticatedUserContext) — remains readable by all modules but only through a stable contract, not raw joins |
| Organization | Organization/Clinic/Membership | SHARED_KERNEL_CANDIDATE | OS (root) | OP | — | identity | yes | expose via a shared-kernel read contract (e.g. ClinicDirectory/OrganizationDirectory/AuthenticatedUserContext) — remains readable by all modules but only through a stable contract, not raw joins |
| UserClinic | Organization/Clinic/Membership | SHARED_KERNEL_CANDIDATE | CS | OP | — | identity | yes | expose via a shared-kernel read contract (e.g. ClinicDirectory/OrganizationDirectory/AuthenticatedUserContext) — remains readable by all modules but only through a stable contract, not raw joins |
| PatientClinic | Patients | SHARED_KERNEL_CANDIDATE | CS | PD | — | identity | yes | expose via a shared-kernel read contract (e.g. ClinicDirectory/OrganizationDirectory/AuthenticatedUserContext) — remains readable by all modules but only through a stable contract, not raw joins |
| ClinicWorkingHours | Organization/Clinic/Membership | SHARED_KERNEL_CANDIDATE | CS(+OS) | OP | — | identity | yes | expose via a shared-kernel read contract (e.g. ClinicDirectory/OrganizationDirectory/AuthenticatedUserContext) — remains readable by all modules but only through a stable contract, not raw joins |
| WhatsAppConnection | Messaging — WhatsApp | DOMAIN_OWNED | OS | CR | — | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| ClinicWhatsAppConnection | Messaging — WhatsApp | DOMAIN_OWNED | CS(+OS) | OP | — | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| WhatsAppInboxEntry | Messaging — WhatsApp | DOMAIN_OWNED | OS | PD | — | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| AuditLog | Audit and Activity | PLATFORM_INFRASTRUCTURE | OS | AU | — | evidence | yes | expose via Core public contract (e.g. AuditService.record(), StoragePort, SecuritySignalIngest) — no direct cross-module table access once F2 boundaries are enforced |
| OperationalEvent | Observability / Operational Events | PLATFORM_INFRASTRUCTURE | OS(+CS) | OP | — | identity_or_reference_data | yes | expose via Core public contract (e.g. AuditService.record(), StoragePort, SecuritySignalIngest) — no direct cross-module table access once F2 boundaries are enforced |
| MessagingInboundEvent | Shared Events / Queue / Idempotency | PLATFORM_INFRASTRUCTURE | MA (nullable org/clinic) | OP | YES | projection | yes | expose via Core public contract (e.g. AuditService.record(), StoragePort, SecuritySignalIngest) — no direct cross-module table access once F2 boundaries are enforced |
| JobLock | Shared Events / Queue / Idempotency | PLATFORM_INFRASTRUCTURE | G | OP | — | projection | yes | expose via Core public contract (e.g. AuditService.record(), StoragePort, SecuritySignalIngest) — no direct cross-module table access once F2 boundaries are enforced |
| InstagramConnection | Messaging — Instagram | DOMAIN_OWNED | OS | CR | — | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| ClinicInstagramConnection | Messaging — Instagram | DOMAIN_OWNED | CS(+OS) | OP | — | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| InstagramInboxEntry | Messaging — Instagram | DOMAIN_OWNED | OS | PD | — | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| InstagramConversationMessage | Messaging — Instagram | DOMAIN_OWNED | OS(+CS) | PD | — | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| PostTreatmentMessageTemplate | Automations / Recall / Follow-up | DOMAIN_OWNED | CS(+OS) | OP | — | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| PostTreatmentMessageQueue | Automations / Recall / Follow-up | DOMAIN_OWNED | CS(+OS) | PD | — | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| PlatformSetting | Configuration and Secrets | PLATFORM_INFRASTRUCTURE | G | OP | YES | identity_or_reference_data | yes | expose via Core public contract (e.g. AuditService.record(), StoragePort, SecuritySignalIngest) — no direct cross-module table access once F2 boundaries are enforced |
| PatientPrivacyRequest | Privacy / Consent / Retention / DSR | DOMAIN_OWNED | CS | PD | — | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| PasswordResetToken | Identity and Access | PLATFORM_INFRASTRUCTURE | US | CR | — | identity_or_reference_data | yes | expose via Core public contract (e.g. AuditService.record(), StoragePort, SecuritySignalIngest) — no direct cross-module table access once F2 boundaries are enforced |
| EmailVerificationToken | Identity and Access | PLATFORM_INFRASTRUCTURE | US | CR | — | identity_or_reference_data | yes | expose via Core public contract (e.g. AuditService.record(), StoragePort, SecuritySignalIngest) — no direct cross-module table access once F2 boundaries are enforced |
| ClinicLegalProfile | Privacy / Consent / Retention / DSR | DOMAIN_OWNED | CS(+OS) | PD/legal | — | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| PublicBookingNoticeEvidence | Privacy / Consent / Retention / DSR | DOMAIN_OWNED | CS(+OS) | AU | YES | evidence | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| ChannelConsentLog | Privacy / Consent / Retention / DSR | DOMAIN_OWNED | CS(+OS) | PD | YES | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| ClinicSmsSettings | Messaging — SMS | DOMAIN_OWNED | CS(+OS) | OP | — | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| SmsMessage | Messaging — SMS | DOMAIN_OWNED | CS(+OS) | PD | — | transaction | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| SmsUsageCounter | Messaging — SMS | DOMAIN_OWNED | CS | OP | — | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| PlatformSmsProvider | Platform Administration | PLATFORM_INFRASTRUCTURE | G | CR | — | identity_or_reference_data | yes | expose via Core public contract (e.g. AuditService.record(), StoragePort, SecuritySignalIngest) — no direct cross-module table access once F2 boundaries are enforced |
| Laboratory | Dental Laboratory / Prosthetics Tracking | DOMAIN_OWNED | CS | OP | — | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| LabWorkOrder | Dental Laboratory / Prosthetics Tracking | DOMAIN_OWNED | CS | HD-adjacent | YES | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| LabWorkOrderStatusHistory | Dental Laboratory / Prosthetics Tracking | DOMAIN_OWNED | PI (via labWorkOrderId) | AU | YES | evidence | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| LabOrderAttachment | Dental Laboratory / Prosthetics Tracking | DOMAIN_OWNED | CS | PD/HD | — | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| ImagingDevice | Imaging — Server Ingest and Viewer | DOMAIN_OWNED | CS | OP | — | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| ImagingRequest | Imaging — Server Ingest and Viewer | DOMAIN_OWNED | CS | HD | YES | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| ImagingStudy | Imaging — Server Ingest and Viewer | DOMAIN_OWNED | CS | HD (special-category) | YES | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| ImagingBridgeAgent | Imaging — Device Bridge | DOMAIN_OWNED | CS | CR (tokenHash)+device metadata | — | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| ImagingBridgePairing | Imaging — Device Bridge | DOMAIN_OWNED | CS | CR (codeHash) | — | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| ImagingBridgePairingDevice | Imaging — Device Bridge | DOMAIN_OWNED | PI (via pairingId) | OP | — | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| ImagingBridgeBinding | Imaging — Device Bridge | DOMAIN_OWNED | CS | OP | — | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| ImagingImage | Imaging — Server Ingest and Viewer | DOMAIN_OWNED | CS | HD (special-category) | — | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| PatientPrivacyExportArchive | Privacy / Consent / Retention / DSR | DOMAIN_OWNED | CS(+OS) | PD | — | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| ClinicBulkExportArchive | Privacy / Consent / Retention / DSR | DOMAIN_OWNED | CS(+OS) | PD/FIN | — | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| ClinicBulkExportPasswordAttempt | Privacy / Consent / Retention / DSR | DOMAIN_OWNED | CS | AU | — | evidence | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| SecuritySignalEvent | Security Incident Response and Detection | PLATFORM_INFRASTRUCTURE | MA (nullable org/clinic) | AU | — | evidence | yes | expose via Core public contract (e.g. AuditService.record(), StoragePort, SecuritySignalIngest) — no direct cross-module table access once F2 boundaries are enforced |
| SecurityIncident | Security Incident Response and Detection | PLATFORM_INFRASTRUCTURE | MA (nullable org/clinic) | AU | — | evidence | yes | expose via Core public contract (e.g. AuditService.record(), StoragePort, SecuritySignalIngest) — no direct cross-module table access once F2 boundaries are enforced |
| SecurityIncidentActivity | Security Incident Response and Detection | PLATFORM_INFRASTRUCTURE | PI (via incidentId) | AU | — | evidence | yes | expose via Core public contract (e.g. AuditService.record(), StoragePort, SecuritySignalIngest) — no direct cross-module table access once F2 boundaries are enforced |
| PlatformAdminAuditEvent | Platform Administration | PLATFORM_INFRASTRUCTURE | MA (nullable actor, resource-scoped not tenant-scoped) | AU | YES | evidence | yes | expose via Core public contract (e.g. AuditService.record(), StoragePort, SecuritySignalIngest) — no direct cross-module table access once F2 boundaries are enforced |
| PatientCommunicationPreference | Privacy / Consent / Retention / DSR | DOMAIN_OWNED | CS(+OS) | PD | YES | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| PatientCommunicationConsentEvent | Privacy / Consent / Retention / DSR | DOMAIN_OWNED | CS(+OS) | PD/AU | — | evidence | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| CommunicationConsentConflictBucket | Privacy / Consent / Retention / DSR | DOMAIN_OWNED | CS(+OS) | AU (deliberately patient-de-identified) | — | projection | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| PatientLegacyConsentCorrection | Privacy / Consent / Retention / DSR | DOMAIN_OWNED | CS(+OS) | PD/AU | — | evidence | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| FileBackupRun | Storage Abstraction | DOMAIN_OWNED | G (platform-run, spans clinics) | OP | — | evidence | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| FileBackupEntry | Storage Abstraction | DOMAIN_OWNED | CS | OP (references PD/HD source records by id, stores no content) | YES | evidence | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| ExternalCalendarIntegration | External Calendar Integration | DOMAIN_OWNED | CS (clinicId @unique) | CR (encrypted client secret/webhook secret) | YES | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| ExternalCalendarMapping | External Calendar Integration | DOMAIN_OWNED | CS | OP | YES | identity_or_reference_data | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |
| ExternalCalendarInboundEvent | External Calendar Integration | PLATFORM_INFRASTRUCTURE | MA (nullable org/clinic, mirrors MessagingInboundEvent pattern) | OP | — | evidence | yes | expose via Core public contract (e.g. AuditService.record(), StoragePort, SecuritySignalIngest) — no direct cross-module table access once F2 boundaries are enforced |
| ExternalCalendarAppointmentLink | External Calendar Integration | DOMAIN_OWNED | CS | PD (appointmentId FK; no independent patient content) | YES | transaction | yes | owning domain's own public query/command contract (per DEPENDENCY_MAP.md §4/§6) |

**"Direct Prisma temp-allowed" column:** `yes` for all 99 models, program-wide — a single shared `PrismaClient` is used everywhere today (confirmed by F0-003 §1 and re-confirmed by this task's own `server/src/db.ts` awareness via `ARCHITECTURE_DECISIONS.md` ADR-004's F0-009 review); no module boundary is enforced at compile/lint/CI time (F2's own, not-yet-started job per `F2_MODULAR_BOUNDARIES.md`). This column exists to make explicit that "temporarily allowed" is the correct, evidence-backed answer for every row today, not a placeholder.

## 6. Model reference-type breakdown

Per this task's brief, each model's reference type is one of `identity` (root tenant/user backbone), `transaction` (a business event/record), `evidence` (append-only audit/consent/security trail), or `projection` (a derived/aggregate/idempotency-ledger row), with a residual `identity_or_reference_data` bucket for domain-owned reference/config-shaped rows that are none of the above. See the JSON inventory's `prismaModelOwnership[].referenceType` field for the full per-model assignment (summarized in the table above).

## 7. External Calendar Integration — new domain since F0-003/F0-004 (evidence)

Not present in `MODULE_MAP.md` or `DEPENDENCY_MAP.md`. Identified via `git diff 368bcc8d..70b1690c` — confirmed new: `server/src/routes/externalCalendarWebhook.ts` (public, mounted at `app.use('/api/public', externalCalendarWebhookRoutes)`), `server/src/routes/platformExternalCalendar.ts` (mounted under `/api/platform`), `server/src/routes/externalCalendarOutboundSyncStatus.ts` (mounted under `/api`); 13 service files under `server/src/services/externalCalendar/` including a `digidentis/` provider subdirectory (`DigiDentisApiClient.ts`, `DigiDentisProvider.ts`, `DigiDentisSigning.ts`, `digidentisConfig.ts`); 4 new Prisma models (`ExternalCalendarIntegration`, `ExternalCalendarMapping`, `ExternalCalendarInboundEvent`, `ExternalCalendarAppointmentLink`, read directly from `server/prisma/schema.prisma` lines 3169–3360+); 1 new frontend page (`src/pages/platform/PlatformExternalCalendar.tsx`); 2 new scheduled jobs (`server/src/jobs/externalCalendarInboundRetryJob.ts`, `server/src/jobs/externalCalendarOutboundSyncJob.ts`); a design doc referenced in schema comments at `docs/architecture/external-calendar-integration.md` (not read by this task — out of the CODEGRAPH-DISCIPLINE-scoped root set; flagged as an unread source, not claimed absent).

**Business responsibility:** synchronizes NoraMedi appointments with an external dental-practice-management calendar/software provider — DigiDentiS is the first and only implemented provider, but the framework (`ExternalCalendarProvider.ts` port + `externalCalendarProviderFactory.ts`) is explicitly designed provider-agnostic (schema comment: "provider is a free-form key ... never assumed to be DigiDentiS-only in shape"). Inbound webhook ingestion is idempotent (mirrors `MessagingInboundEvent`'s dedupe-by-unique-constraint pattern); outbound appointment-create sync is idempotent via a client-generated idempotency key and an atomic conditional-`updateMany` claim so immediate/retry-job/manual-retry paths can never double-book a provider-side appointment.

**Cross-domain direct access (transitional, no contract exists yet):** `ExternalCalendarAppointmentLink.appointmentId` is a direct FK read/write into `Appointment` (owned by Appointments and Availability); `ExternalCalendarMapping.localId` resolves against `User.id` (Identity and Access) or `AppointmentType.id` (Appointments and Availability) by direct id lookup — deliberately never by name, per `externalCalendarMappingService.ts resolveMapping()`, which blocks synchronization with an administrative error when a mapping is missing or inactive. This is the same "transitional direct FK/read, no contract yet" pattern F0-004 already documented for other domains (e.g. Advanced Finance reading Payment) — not a new class of violation.

**Pilot-module candidate observation (not a selection):** of all 38 domains in this inventory, External Calendar Integration is the only one that already exhibits essentially the full target module shape (provider port + factory, dedicated idempotency/retry ledger, orchestration layer, dedicated public/platform/webhook routes, no legacy code to migrate) — see `F2_MODULAR_BOUNDARIES.md`'s own backlog item "Pilot modül sınır uygulaması ve kanıtı." This is a factual observation from repository evidence, not a recommendation this task is authorized to act on, and it is **not** a selected or approved F2 pilot module — no such selection has been made by this or any other task.

**Explicitly flagged:** this domain's own cross-domain edges are **not yet coded into the F0-004 833-edge matrix**. Per §11, this is not an independent follow-up task — its dependency-edge coding should be reconciled through F2-PREP-002 evidence once available, and only split into a separate dependency-matrix task if the F2-PREP-005 external review proves it necessary, before this domain is treated as equally authoritative to the other 37.

## 8. Delta evidence for existing domains (Privacy, Platform Administration, Storage Abstraction)

### 8.1 Privacy / Consent / Retention / Data Subject Rights (`PRV`)

F0-003 §1 itself flagged this domain's evidence as incomplete: an uncommitted `services/communicationConsent/` directory and 2 uncommitted Prisma models (`PatientCommunicationPreference`, `PatientCommunicationConsentEvent`) were observed in the working tree at F0-003's baseline commit and were explicitly excluded ("not evidence of established architecture" — F0-003 §1). That work is now **committed** (KVKK-HIGH-007/008 lineage, confirmed via `git diff --name-status 368bcc8d..HEAD`) and is folded into this domain's evidence here:

- **+4 Prisma models:** `PatientCommunicationPreference` (central per-channel/per-purpose consent register, supersedes legacy per-channel opt-out fields as source of truth going forward), `PatientCommunicationConsentEvent` (append-only evidence trail, ordered by a monotonic `revision` field rather than `createdAt` — createdAt/updatedAt are only millisecond-precision and can tie under concurrency), `CommunicationConsentConflictBucket` (deliberately patient-de-identified aggregate conflict counter — no patientId, no name/phone/email, no message text, no IP/user-agent, by explicit schema-comment design), `PatientLegacyConsentCorrection` (KVKK-HIGH-008 immutable correction ledger for legacy consent-adjacent fields, e.g. `Patient.smsOptOut` — create-only, no update/delete route exists or should ever exist).
- **+10 services** under `server/src/services/communicationConsent/` (admin, audit logging, audit report, conflict tracker, policy, evidence sanitizer, enforcement config, legacy correction, legacy reconciliation resolver, taxonomy) plus `server/src/services/privacy/dataRetentionManualRunAudit.ts` (new — RETENTION-MANUAL-RUN-AUDIT-001, records a "started" audit row before any live cleanup mutation, then exactly one terminal row).
- **+1 route:** `server/src/routes/communicationPreferences.ts` (mounted at `/api`).
- **+4 frontend files:** `src/components/CommunicationPreferencesPanel.tsx`, `src/components/LegacyConsentCorrectionHistory.tsx`, `src/components/LegacyConsentCorrectionModal.tsx`, `src/components/communicationConsentMatrixHelpers.ts`.

Ownership remains squarely within this domain — no new ambiguity introduced; this is a maturation of the same domain F0-003 already identified as "the most actively-developed domain in the repo."

### 8.2 Platform Administration (`PAD`)

- **+1 Prisma model:** `PlatformAdminAuditEvent` — append-only platform-admin audit ledger recording e.g. `platform_setting.updated`, plus multi-outcome operation audits (`data_retention.manual_run_started`/`_completed`/`_partial_failure`/`_blocked`/`_failed`) on behalf of the Privacy domain's retention-manual-run-audit work (cross-domain evidence-writing relationship, by schema-comment design).
- **+1 service:** `server/src/services/platformAdminAudit.ts`.

### 8.3 Storage Abstraction (`STG`)

- **+2 Prisma models:** `FileBackupRun` (off-host backup run ledger — scanned/copied/verified/skipped/failed/missing counters, byte totals), `FileBackupEntry` (immutable per-run per-file entry; a file verified once is never mutated, only re-recorded as `skipped_unchanged` in a later run — durable per-run audit trail, not just current state). `sourceModel` values (`PatientAttachment | LabOrderAttachment | ImagingImage`) reference Patients-, Dental-Laboratory-, and Imaging-owned attachment records by id — an evidence/ledger reference, not a content copy.
- **+2 services:** `server/src/services/fileBackupService.ts`, `server/src/services/fileBackupDestination.ts`.
- **+1 scheduled job:** `server/src/jobs/fileBackupJob.ts`.

This is the concrete implementation of the **ADR-013/F0-011 "gap-C" (object storage / file-tree backup) remediation** — `ARCHITECTURE_DECISIONS.md` ADR-013's F0-011 review explicitly named this as the single largest backup/DR gap ("no file-tree backup implementation was found"). This task does not re-verify whether the implementation fully closes that gap (out of scope — read-only discovery); it only records that implementation work now exists and assigns it to Storage Abstraction.

## 9. Explicit non-claims

- Does **not** claim module boundaries are enforced today — a single shared `PrismaClient` is used everywhere; no lint/CI rule blocks cross-domain imports (unchanged from the F0-003/F0-004 finding).
- Does **not** independently re-verify the 37-domain F0-003/F0-004 baseline's per-file evidence line-by-line — it is treated as already-accepted (ADR-001/014/015) prior evidence and reconciled only against the diff since its pinned commit.
- Does **not** claim the new External Calendar Integration domain or the PRV/PAD/STG deltas have been through the same F0-008-style external-review cycle as the original 37 domains — flagged explicitly as this task's own, not-yet-externally-reviewed classification.
- Does **not** audit raw SQL statement-by-statement for tenant-predicate correctness (F0-003/F0-004's own stated deferral, unchanged).
- Does **not** independently re-scan `bridge-agent/` or `windows-bridge/` internals, or `docs/architecture/external-calendar-integration.md` (out of the CODEGRAPH-DISCIPLINE-scoped root set, consistent with F0-003's own scope limit).
- Does **not** propose database-per-domain — Prisma/PostgreSQL remains shared per ADR-001/ADR-003 (`ACCEPTED`/`ACCEPTED_WITH_CONDITIONS`).
- Does **not** re-run or re-verify F0-004's 833-edge dependency matrix for the 37 inherited domains — cited as-is. The new External Calendar Integration domain's cross-domain edges are **not** yet coded into that matrix.
- Does **not** move any file, rename any code, edit `server/prisma/schema.prisma`, or touch `NORAMEDI_MASTER_TRACKER.md` / `CURRENT_PHASE.md` / any phase document / `evidence/README.md` / `package.json` / `server/package.json` / any workflow file, per this task's explicit shared-document restriction and prohibited-work list.
- Does **not** authorize, begin, or imply any code modularization, service extraction, or physical file move — `F2_MODULAR_BOUNDARIES.md`'s own prohibited-work list ("Büyük patlama (big-bang) refactoring", "Microservice bölünmesi") remains fully in force; this task performed pure documentation discovery.

## 10. Target module shape recommendations

Per this task's brief §5, a minimal `server/src/modules/<domain>/{domain,application,infrastructure,http,public}/` shape is proposed **only where repository evidence supports each layer** — not forced uniformly. `yes` in a column below means this domain's current evidence (owned models, multi-file services, dedicated routes, scheduled jobs, or external provider adapters) supports that layer existing; a domain with no owned models and no services (e.g. Public Booking) is not given an `infrastructure/` layer since nothing evidences one today.

| Code | Domain | domain/ | application/ | infrastructure/ | http/ | public/ | internal | jobs | providers | DTO boundary |
|---|---|---|---|---|---|---|---|---|---|---|
| IDA | Identity and Access | yes | yes | yes | yes | yes | yes | — | — | yes |
| ORG | Organization / Clinic / User Membership | yes | yes | yes | yes | yes | yes | — | — | yes |
| TSC | Tenant Security and Scope | yes | — | — | — | yes | — | — | — | — |
| PRM | Permissions / Roles | yes | — | — | — | yes | — | — | — | — |
| AUD | Audit and Activity | yes | yes | yes | — | yes | yes | — | — | — |
| PRV | Privacy / Consent / Retention / Data Subject Rights | yes | yes | yes | yes | yes | yes | yes | — | yes |
| SEC | Security Incident Response and Detection | yes | yes | yes | yes | yes | yes | — | — | yes |
| CFG | Configuration and Secrets | yes | yes | yes | yes | yes | yes | — | — | yes |
| OBS | Observability / Operational Events | yes | yes | yes | yes | yes | yes | — | — | yes |
| EVQ | Shared Events / Queue Contracts / Idempotency | yes | yes | yes | — | yes | yes | yes | — | — |
| STG | Storage Abstraction | yes | — | — | — | yes | — | yes | yes | — |
| NTF | Notifications | yes | yes | yes | yes | yes | yes | — | — | yes |
| PAD | Platform Administration | yes | yes | yes | yes | yes | yes | — | — | yes |
| PAT | Patients | yes | yes | yes | yes | yes | yes | — | — | yes |
| APT | Appointments and Availability | yes | yes | yes | yes | yes | yes | — | — | yes |
| TRC | Treatment Cases | yes | yes | yes | yes | yes | yes | — | — | yes |
| DEN | Dental Chart / Procedures | yes | yes | yes | yes | yes | yes | — | — | yes |
| PUB | Public Booking | yes | — | — | yes | yes | — | — | — | yes |
| PAY | Basic Payments | yes | yes | yes | yes | yes | yes | — | — | yes |
| TSK | Tasks and Follow-up | yes | yes | yes | yes | yes | yes | — | — | yes |
| WHA | Messaging — WhatsApp | yes | yes | yes | yes | yes | yes | yes | yes | yes |
| IGM | Messaging — Instagram | yes | yes | yes | yes | yes | yes | — | yes | yes |
| SMS | Messaging — SMS | yes | yes | yes | yes | yes | yes | — | yes | yes |
| EML | Messaging — Email | yes | — | — | — | yes | — | — | yes | — |
| AIO | Messaging AI Orchestration | yes | — | — | — | yes | — | — | yes | — |
| REC | Automations / Reminders / Follow-up / Recall | yes | yes | yes | yes | yes | yes | yes | — | yes |
| IMG | Imaging — Server Ingest and Viewer | yes | yes | yes | yes | yes | yes | — | — | yes |
| BRG | Imaging — Device Bridge / Windows Bridge | yes | yes | yes | yes | yes | yes | yes | yes | yes |
| INV | Inventory | yes | yes | yes | yes | yes | yes | — | — | yes |
| INS | Insurance | yes | yes | yes | yes | yes | yes | — | — | yes |
| FIN | Advanced Finance — Compensation and Payouts | yes | yes | yes | yes | yes | yes | — | — | yes |
| RPT | Reporting / Analytics | yes | yes | — | yes | yes | — | — | — | yes |
| LAB | Dental Laboratory / Prosthetics Tracking | yes | yes | yes | yes | yes | yes | — | — | yes |
| PAI | AI Platform / AI Gateway | *(not implemented — no shape applies)* | | | | | | | | |
| PIG | Integration Platform (Official/Ministry Adapters) | *(not implemented — no shape applies)* | | | | | | | | |
| PBL | Billing / Subscription Engine | *(not implemented — no shape applies)* | | | | | | | | |
| PCM | Campaign Management / Health Tourism / Invoicing | *(not implemented — no shape applies)* | | | | | | | | |
| EXC | External Calendar Integration | yes | yes | yes | yes | yes | yes | yes | yes | yes |

The 4 planned/not-implemented domains (`PAI`/`PIG`/`PBL`/`PCM`) have no shape recommendation — nothing exists to shape, consistent with F0-003's "confirmed absent, not merely unverified" finding, unchanged by this task.

## 11. Recommended next discovery task

Await completion of F2-PREP-002, F2-PREP-003, and F2-PREP-004 (already running/authorized in parallel per this task's own brief). Then execute **F2-PREP-005 — Consolidated Modularization Charter**.

External Calendar Integration dependency-edge coding (the `EXC`→`APT`/`IDA`/`ORG` cells and the `PRV` row's new Communication Consent edges into `WHA`/`IGM`/`SMS`/`EML` send paths, both flagged qualitatively in §7/§8 above but not yet coded into the accepted 37×37 `DEPENDENCY_MAP.md` §10.2 matrix) must be reconciled through F2-PREP-002 evidence and only split into a separate task if the F2-PREP-005 external review proves it necessary. This document does not itself propose or authorize a new standalone dependency-matrix task.

## 12. Rollback

Revert this task's single documentation commit. No schema, migration, application-code, or shared-index-document change was made; rollback is a plain `git revert` of the evidence-file-only commit with no other side effects.

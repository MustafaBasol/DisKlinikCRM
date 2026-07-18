# F0-003 Evidence — Domain and Module Ownership Map

Task: F0-003 — Domain and Module Ownership Map · Phase: F0 · Scope: repository-only, documentation-only.

This document is the detailed evidence base behind [`MODULE_MAP.md`](../MODULE_MAP.md). The structured/machine-readable form of the same evidence is [`F0-003_module_ownership_inventory.json`](F0-003_module_ownership_inventory.json). Read that file's `domains[]` array for the full backend/frontend file-level assignment per domain — this document focuses on the Prisma data-ownership table, hotspots, raw SQL, shared utilities, and cross-domain observations that don't fit cleanly in the JSON schema.

## 1. Methodology and scope

- All repository evidence in this document is pinned to commit `368bcc8d0a9f4c0ea185ca33d4dd1193d8def9ef` (`main` HEAD at the start of this task), read via `git show`/`git ls-tree`, **not** the live working tree.
- **Why pinned, not live:** during this task the shared working tree was observed to have modified `server/prisma/schema.prisma`, modified `server/prisma/migrations/migration_lock.toml`, and an untracked `server/src/services/communicationConsent/` directory plus a new migration directory — none of which are part of commit `368bcc8`. This matches a phenomenon F0-002's own evidence already documented (concurrent KVKK development modifying the shared tree in real time). None of these files were created, staged, or touched by this task.
- Two Prisma models observed only in the uncommitted working-tree schema (`PatientCommunicationPreference`, `PatientCommunicationConsentEvent`) are **excluded** from the 88-model committed baseline used throughout this document and are not evidence of established architecture.
- Ownership below is **file-level and model-level responsibility inferred from repository evidence** (filenames, imports, route mounting, schema comments) — it documents the current de-facto state. It is **not** a claim that module boundaries, public contracts, or entitlement enforcement already exist. No module currently enforces its boundary; a single shared `PrismaClient` is used everywhere.
- CodeGraph (`.codegraph/`) is present in this repository but was not queried through the MCP tool for this pass; targeted `git show`/`grep`/`Read` against the CODEGRAPH DISCIPLINE-scoped roots (`server/src/{routes,services,jobs,middleware,utils}`, `server/prisma/schema.prisma`, `src/{pages,components,services}`) was sufficient and kept token usage lower for a repository of this size (56 route files, 79 service files, 88 models, 64 frontend pages).
- `bridge-agent/` and `windows-bridge/` top-level directories exist (confirmed via `git ls-tree`) but their internal contents were **not** scanned — out of the CODEGRAPH DISCIPLINE-scoped roots for this task. Treat imaging-device-bridge frontend/agent internals as unverified, not absent.

## 2. Domain overview

29 domains were identified: 13 Core Platform, 7 Core Clinical Operations, 8 Optional Operational, 1 additional evidence-based domain not in the task's required list (Dental Laboratory / Prosthetics Tracking — see §7), and 5 folded into 4 "planned/not implemented" entries. Full per-domain detail (backend/frontend ownership, models, tests, contract candidates, criticality, maturity, evidence notes, uncertainty) is in `F0-003_module_ownership_inventory.json` → `domains[]`. Summary:

| Domain | Classification | Criticality | Maturity |
|---|---|---|---|
| Identity and Access | core platform | regulatory/tenant-critical | partially bounded |
| Organization / Clinic / Membership | core platform | regulatory/tenant-critical | partially bounded |
| Tenant Security and Scope | core platform | regulatory/tenant-critical | clearly bounded |
| Permissions / Roles | core platform | high-risk | mixed |
| Audit and Activity | core platform | regulatory/tenant-critical | clearly bounded |
| Privacy / Consent / Retention / DSR | core platform | regulatory/tenant-critical | mixed |
| Security Incident Response and Detection | core platform | regulatory/tenant-critical | clearly bounded |
| Configuration and Secrets | core platform | high-risk | partially bounded |
| Observability / Operational Events | core platform | elevated | clearly bounded |
| Shared Events / Queue / Idempotency | core platform | high-risk | partially bounded |
| Storage Abstraction | core platform | high-risk | partially bounded |
| Notifications | core platform | normal | clearly bounded |
| Platform Administration | platform capability | high-risk | mixed |
| Patients | core clinical | regulatory/tenant-critical | partially bounded |
| Appointments and Availability | core clinical | regulatory/tenant-critical | partially bounded |
| Treatment Cases | core clinical | elevated | partially bounded |
| Dental Chart / Procedures | core clinical | elevated | clearly bounded |
| Public Booking | core clinical | elevated | partially bounded |
| Basic Payments | core clinical | elevated | clearly bounded |
| Tasks and Follow-up | core clinical | normal | clearly bounded |
| Messaging — WhatsApp | optional operational | elevated | mixed |
| Messaging — Instagram | optional operational | elevated | mixed |
| Messaging — SMS | optional operational | elevated | clearly bounded |
| Messaging — Email | optional operational | normal | partially bounded |
| Messaging AI Orchestration | optional operational | elevated | shared/ambiguous |
| Automations / Recall / Follow-up | optional operational | elevated | clearly bounded |
| Imaging — Server Ingest and Viewer | optional operational | elevated | mixed |
| Imaging — Device Bridge / Windows Bridge | external adapter/integration | elevated | partially bounded |
| Inventory | optional operational | normal | clearly bounded |
| Insurance | optional operational | normal | clearly bounded |
| Advanced Finance — Compensation and Payouts | optional operational | elevated | clearly bounded |
| Reporting / Analytics | optional operational | normal | shared/ambiguous |
| Dental Laboratory / Prosthetics Tracking | optional operational | normal | clearly bounded |
| AI Platform / AI Gateway | planned/not implemented | normal | planned only |
| Integration Platform (Official/Ministry Adapters) | planned/not implemented | normal | planned only |
| Billing / Subscription Engine | planned/not implemented | normal | planned only |
| Campaign / Health Tourism / Invoicing | planned/not implemented | normal | planned only |

## 3. Data ownership — full Prisma model inventory (88 models, committed baseline)

Tenant scope legend: **G** = global, **OS** = organization-scoped, **CS** = clinic-scoped, **US** = user-scoped, **PI** = parent-inherited (join/derived table), **MA** = mixed/ambiguous.
Sensitivity legend: **OP** = operational, **FIN** = financial, **PD** = personal data, **HD** = health/special-category data, **CR** = credentials/secrets, **AU** = audit/security evidence.

| Model | Primary owner domain | Scope | Principal key | Sensitivity | Cross-domain access | Notes |
|---|---|---|---|---|---|---|
| Clinic | Organization/Clinic/Membership | OS | organizationId | OP | read by nearly every domain | root tenant entity |
| User | Identity and Access | OS(+CS home) | organizationId, clinicId | CR+PD | read by nearly every domain | passwordHash; role string |
| DoctorAvailability | Appointments and Availability | CS | clinicId | OP | — | |
| DoctorOffDay | Appointments and Availability | CS | clinicId | OP | — | |
| Patient | Patients | OS(+CS primary) | organizationId | PD/HD-adjacent | read by Appointments, TreatmentCases, Messaging (all 3 channels), Imaging, Lab, Finance, Reporting, Privacy | most cross-referenced model (18+ inbound relations) |
| AppointmentType | Appointments and Availability | CS | clinicId | OP | read by TreatmentCases, Inventory (materials), Finance | acts as service catalog |
| Appointment | Appointments and Availability | CS | clinicId | OP (PD-adjacent via patient link) | read by Messaging, Tasks, Imaging, Reporting | |
| AppointmentRequest | Appointments and Availability | CS | clinicId | PD | **written directly** by Public Booking, Messaging-WhatsApp, Messaging-Instagram | transitional cross-domain write, see §6 |
| ContactRequest | Appointments and Availability (channel-agnostic intake) | CS | clinicId | PD | written by Messaging channels | shared/ambiguous owner |
| WhatsAppConversationState | Messaging — WhatsApp | CS | clinicId | PD | — | |
| WhatsAppConversationMessage | Messaging — WhatsApp | CS | clinicId | PD | — | |
| TreatmentCase | Treatment Cases | CS | clinicId | HD-adjacent | read by Finance, Recall, Lab, Imaging | |
| TreatmentPackage | Treatment Cases | CS | clinicId | OP | read by Inventory, Post-Treatment | |
| TreatmentPackageItem | Treatment Cases | CS | clinicId | OP | — | |
| AppointmentTypeMaterial | Inventory | CS | clinicId | OP | FK's into Appointments' AppointmentType | legitimate join table |
| TreatmentPackageMaterial | Inventory | CS | clinicId | OP | FK's into TreatmentCases' TreatmentPackage | legitimate join table |
| TreatmentPackageApplication | Treatment Cases | CS | clinicId | OP | triggers Inventory stock deduction | |
| InsuranceProvision | Insurance | CS | clinicId | FIN/PD | — | |
| Task | Tasks and Follow-up | CS | clinicId | OP | referenced by Recall (taskId FK) | |
| Payment | Basic Payments | CS | clinicId | FIN | read by Finance (earnings), Recall, Reporting | |
| MessageTemplate | **Shared Contract/Reference Data** | CS | clinicId | OP | used by WhatsApp (Meta template fields) and SMS (SmsMessage.templateId) | genuinely cross-channel |
| SentMessage | Messaging — WhatsApp (primary; provider/whatsappConnectionId fields dominant) | CS(+OS) | clinicId | PD | read by Reporting, Recall | channel-agnostic in shape but WhatsApp-heavy in practice |
| ActivityLog | Audit and Activity | CS | clinicId | AU | written by many domains | |
| Setting | Configuration and Secrets | CS | clinicId | OP | — | |
| ClinicRecallSetting | Automations / Recall / Follow-up | CS | clinicId | OP | — | |
| RecallCandidate | Automations / Recall / Follow-up | CS | clinicId | PD | reads Patient, TreatmentCase, Appointment, Payment | |
| RecallAction | Automations / Recall / Follow-up | CS | clinicId | PD | references Task (Tasks domain) | |
| PatientAttachment | Patients | CS | clinicId | PD/HD | legalHold managed by Privacy domain | see §6 |
| ToothRecord | Dental Chart / Procedures | CS | clinicId | HD | — | |
| PaymentPlan | Basic Payments | CS | clinicId | FIN | — | |
| PaymentPlanInstallment | Basic Payments | PI (via planId) | clinicId (via plan) | FIN | — | |
| PractitionerCompensationRule | Advanced Finance | CS | clinicId | FIN | — | |
| ServiceCompensationRule | Advanced Finance | CS | clinicId | FIN | — | |
| PractitionerEarning | Advanced Finance | CS | clinicId | FIN | reads Payment directly | |
| PractitionerPayout | Advanced Finance | CS | clinicId | FIN | — | |
| InventoryItem | Inventory | **OS** (not CS) | organizationId | OP | — | scope inconsistency vs. InventoryTransaction, flagged for F5 |
| InventoryTransaction | Inventory | CS | clinicId | OP | written by Dental Chart/Procedures (treatmentStockDeduction.ts) | see §6 |
| TreatmentPlanProcedure | Dental Chart / Procedures | CS | clinicId | HD | triggers Inventory + Recall | |
| Notification | Notifications | CS | clinicId | OP | — | |
| Plan | Organization/Clinic/Membership (reference) | **G** | none | OP | read by Platform Administration, entitlement checks everywhere | commercial entitlement source |
| PlatformAdmin | Platform Administration | **G** | none | CR | — | platform staff, not tenant |
| ClinicInvitation | Organization/Clinic/Membership | CS(+OS) | clinicId | PD | — | |
| Organization | Organization/Clinic/Membership | **OS (root)** | id | OP | — | |
| UserClinic | Organization/Clinic/Membership | CS | clinicId | OP | — | join table |
| PatientClinic | Patients | CS | clinicId | PD | — | join table |
| ClinicWorkingHours | Organization/Clinic/Membership | CS(+OS) | clinicId | OP | — | |
| WhatsAppConnection | Messaging — WhatsApp | **OS** | organizationId | CR | — | encrypted tokens |
| ClinicWhatsAppConnection | Messaging — WhatsApp | CS(+OS) | clinicId | OP | — | join table |
| WhatsAppInboxEntry | Messaging — WhatsApp | **OS** | organizationId | PD | — | |
| AuditLog | Audit and Activity | **OS** | organizationId | AU | — | deliberately separate from ActivityLog per schema comment |
| OperationalEvent | Observability / Operational Events | OS(+CS) | organizationId | OP | — | |
| MessagingInboundEvent | Shared Events / Queue / Idempotency | **MA** (nullable org/clinic) | none required | OP | explicitly designed channel-agnostic | positive shared-contract example |
| JobLock | Shared Events / Queue / Idempotency | **G** | name | OP | — | |
| InstagramConnection | Messaging — Instagram | **OS** | organizationId | CR | — | |
| ClinicInstagramConnection | Messaging — Instagram | CS(+OS) | clinicId | OP | — | join table |
| InstagramInboxEntry | Messaging — Instagram | **OS** | organizationId | PD | — | |
| InstagramConversationMessage | Messaging — Instagram | OS(+CS) | organizationId | PD | — | |
| PostTreatmentMessageTemplate | Automations / Recall / Follow-up | CS(+OS) | clinicId | OP | — | |
| PostTreatmentMessageQueue | Automations / Recall / Follow-up | CS(+OS) | clinicId | PD | — | |
| PlatformSetting | Configuration and Secrets | **G** | key | OP | likely release-flag storage | |
| PatientPrivacyRequest | Privacy / Consent / Retention / DSR | CS | clinicId | PD | — | KVKK/GDPR DSR requests |
| PasswordResetToken | Identity and Access | **US** | userId | CR | — | |
| EmailVerificationToken | Identity and Access | **US** | userId | CR | — | |
| ClinicLegalProfile | Privacy / Consent / Retention / DSR | CS(+OS) | clinicId | PD/legal | — | |
| PublicBookingNoticeEvidence | Privacy / Consent / Retention / DSR | CS(+OS) | clinicId | AU | linked from Appointments (AppointmentRequest) | privacy *evidence*, not consent |
| ChannelConsentLog | Privacy / Consent / Retention / DSR | CS(+OS) | clinicId | PD | written by Messaging-WhatsApp/Instagram consent-gate flows | legitimate collaboration |
| ClinicSmsSettings | Messaging — SMS | CS(+OS) | clinicId | OP | — | addonEnabled = real entitlement flag |
| SmsMessage | Messaging — SMS | CS(+OS) | clinicId | PD | — | |
| SmsUsageCounter | Messaging — SMS | CS | clinicId | OP | — | |
| PlatformSmsProvider | Platform Administration | **G** | region+providerCode | CR | — | platform-level, clinics never see |
| Laboratory | Dental Laboratory / Prosthetics Tracking | CS | clinicId | OP | — | |
| LabWorkOrder | Dental Laboratory / Prosthetics Tracking | CS | clinicId | HD-adjacent | reads Patient, TreatmentCase | |
| LabWorkOrderStatusHistory | Dental Laboratory / Prosthetics Tracking | PI (via labWorkOrderId) | — | AU | append-only | |
| LabOrderAttachment | Dental Laboratory / Prosthetics Tracking | CS | clinicId | PD/HD | — | |
| ImagingDevice | Imaging — Server Ingest and Viewer | CS | clinicId | OP | — | |
| ImagingRequest | Imaging — Server Ingest and Viewer | CS | clinicId | HD | reads Appointment, TreatmentCase | |
| ImagingStudy | Imaging — Server Ingest and Viewer | CS | clinicId | HD (special-category) | legalHold managed by Privacy domain | see §6 |
| ImagingBridgeAgent | Imaging — Device Bridge | CS | clinicId | CR (tokenHash)+device metadata | — | |
| ImagingBridgePairing | Imaging — Device Bridge | CS | clinicId | CR (codeHash) | — | |
| ImagingBridgePairingDevice | Imaging — Device Bridge | PI (via pairingId) | — | OP | — | |
| ImagingBridgeBinding | Imaging — Device Bridge | CS | clinicId | OP | — | |
| ImagingImage | Imaging — Server Ingest and Viewer | CS | clinicId | HD (special-category) | — | never hard-deleted per schema comments |
| PatientPrivacyExportArchive | Privacy / Consent / Retention / DSR | CS(+OS) | clinicId | PD | — | short-lived export artifact |
| ClinicBulkExportArchive | Privacy / Consent / Retention / DSR | CS(+OS) | clinicId | PD/FIN | — | feature-flagged off by default |
| ClinicBulkExportPasswordAttempt | Privacy / Consent / Retention / DSR | CS | clinicId | AU | — | step-up brute-force lockout |
| SecuritySignalEvent | Security Incident Response and Detection | **MA** (nullable org/clinic) | none required | AU | — | append-only |
| SecurityIncident | Security Incident Response and Detection | **MA** (nullable org/clinic) | none required | AU | — | mutable aggregate |
| SecurityIncidentActivity | Security Incident Response and Detection | PI (via incidentId) | — | AU | — | immutable history |

**Coverage: 88 / 88 committed Prisma models mapped to exactly one primary owner domain.** No model was silently omitted. `MessageTemplate` and `MessagingInboundEvent`/`SecuritySignalEvent`/`SecurityIncident` are the only models using the "Shared Contract/Reference Data" or mixed/ambiguous scope categories permitted by the task instructions for genuine multi-owner cases; every other model has exactly one primary owner even where it is read cross-domain.

**Migration/deletion/legal-hold concerns observed (not remediated in this task):**
- `Patient`, `PatientAttachment`, `ImagingStudy`/`ImagingImage`, `LabWorkOrder`/`LabOrderAttachment` carry KVKK anonymization/legal-hold/deletion-review concerns documented extensively in schema comments and `docs/compliance/` — F0-003 does not re-verify or change any of this behavior.
- `InventoryItem` (organization-scoped) vs. `InventoryTransaction` (clinic-scoped) is a genuine scope inconsistency worth carrying into F5 (tenant/RLS) design, not something this task resolves.
- No model was found missing a tenant-scope column that would need blanket `organizationId` backfill beyond what §3's Phase-1b comments already document as in-progress/completed in the schema itself (e.g. `Clinic.organizationId`, `User.organizationId`, `Patient.organizationId`, `InventoryItem.organizationId` are already present per schema comments "Phase 1b: NOT NULL after backfill").

## 4. Cross-domain dependency observations (light — full matrix is F0-004's deliverable)

Per [`DEPENDENCY_MAP.md`](../DEPENDENCY_MAP.md), the full satır/sütun import-evidence matrix (C/E/S/X classification) is explicitly F0-004's job and is **not** duplicated here. The following are notable observations surfaced incidentally while building the module map, recorded so F0-004 does not have to rediscover them:

| Source domain | Target domain | Evidence | Access type | Notes |
|---|---|---|---|---|
| Messaging — WhatsApp | Patients | `server/src/routes/whatsapp.ts` (`ensureWhatsAppContactPatient`, ~line 1206; `handleIncomingWhatsAppMessage`, ~line 2486) | direct Prisma create/read of `Patient`/`User` | transitional — no Patients-owned command exists to route through |
| Messaging — WhatsApp / Instagram | Appointments and Availability | route/service files across both channels write `AppointmentRequest` directly | direct write | transitional — `AppointmentRequest.source` field (whatsapp/instagram/public) already models this as a legitimate multi-source intake, but no command contract exists |
| Dental Chart / Procedures | Inventory | `server/src/services/treatmentStockDeduction.ts` | direct write of `InventoryTransaction` | transitional — candidate for the task spec's named "Inventory stock-adjustment command" |
| Privacy / Consent / Retention / DSR | Patients, Imaging | writes/reads `PatientAttachment.legalHold`, `ImagingStudy.legalHold` | direct field access on another domain's table | intentional per schema comments (KVKK lifecycle), not accidental — still a candidate for a future explicit LegalHold contract |
| Reporting / Analytics | Patients, Appointments, Payments, Treatment Cases | `server/src/routes/reports.ts` (raw SQL, see §5) | direct read, including raw SQL | expected for a reporting surface but currently has no read-model boundary (ADR-017 PROPOSED) |
| Advanced Finance | Basic Payments | `server/src/services/earningService.ts` | direct read of `Payment` | legitimate business collaboration |
| (all domains) | Tenant Security and Scope, Identity and Access | nearly universal import of `middleware/auth.ts`, `middleware/clinicAccess.ts`, `utils/clinicScope.ts` | expected core dependency | high blast radius by design — not a violation |

No instance was found in this pass of a feature module directly importing another feature module's *provider adapter* (e.g., a non-messaging route importing `services/whatsapp/EvolutionWhatsAppProvider.ts`) — the observed violations are all direct-table-access-shaped, not adapter-leak-shaped. This is a narrower, spot-check-level finding, not an exhaustive import audit; F0-004 should treat it as a starting hypothesis, not a conclusion.

## 5. Large / mixed-responsibility file inventory (hotspots)

See `F0-003_module_ownership_inventory.json` → `hotspots[]` for the full structured form. Summary:

| File | Lines | Routes | Primary risk |
|---|---|---|---|
| `server/src/routes/whatsapp.ts` | 3999 | 7 | **High** — ~3600 of 3999 lines are conversation-AI/patient-matching/booking-flow business logic embedded in a route file; only lines 3616-3999 are actual route handlers |
| `server/src/routes/platformAdmin.ts` | 1201 | 40 | **Elevated** — spans clinic, organization, plan, backup, and SMS-provider administration in one file |
| `server/src/routes/imaging.ts` | 1303 | 27 | **Elevated** — large but stays within the Imaging domain |
| `server/src/routes/reports.ts` | 512 | 5 | **Elevated** — raw-SQL cross-domain read surface, see §4/§6 |
| `server/src/routes/instagramInbox.ts` | 796 | 11 | Normal — sized proportionally |
| `server/src/routes/whatsappInbox.ts` | 807 | 8 | Normal — sized proportionally |

This task performs **no refactor**. Recommended strangler sequencing is recorded per-file in the JSON inventory for F1/F2 planning.

## 6. Raw SQL inventory

16 files under `server/src` contain `$queryRaw`/`$executeRaw`/`$queryRawUnsafe`/`$executeRawUnsafe` calls (full list in the JSON inventory → `raw_sql_locations[]`, reproducible via `grep -rl '\$queryRaw\|\$executeRaw' server/src`). Individual SQL statements were **not** audited line-by-line for tenant-predicate correctness in this task — that level of detail is deferred to F0-004 (cross-domain classification) and a dedicated tenant-security review ahead of F5 (RLS). The most notable owning files: `routes/reports.ts` (reporting-analytics, cross-domain reads), `routes/platformAdmin.ts` (platform administration, cross-domain), `services/privacy/*` (3 files — bulk-export/anonymization/password-attempt logic), `routes/imaging.ts` and `routes/imagingBridgePublic.ts` (imaging), `services/security/securityIncidentService.ts`, `services/appointmentRequestSafety.ts` (advisory-lock pattern), `routes/operationalMonitoring.ts`, and `server/src/index.ts` (likely a startup/health-check query). 4 of the 16 matches are in test files, not production code.

## 7. Shared utility classification

See `F0-003_module_ownership_inventory.json` → `shared_utilities_classification[]` for the full list. Key findings:

- **True platform primitives, correctly placed:** `logger.ts`, `encryption.ts`, `secrets.ts`, `fileSignature.ts`, `filePreview.ts`, `jobLock.ts`, `concurrency.ts`, `safeError.ts`, `excelImport.ts`.
- **Security/tenant-critical helpers, correctly placed:** `clinicScope.ts`, `tenantGuard.ts`, `relationGuards.ts`, `middleware/clinicAccess.ts`, `roles.ts`, `passwordStepUp.ts`, `inboundRateLimiter.ts`.
- **Domain-specific utilities in the wrong shared location** (candidates for later relocation under a domain or messaging-shared namespace, not touched in this task): `webhookVerification.ts` and `webhookRouting.ts` (messaging-only), `messageSanitizer.ts` (messaging-only), `whatsappDate.ts` (WhatsApp-only), `patientName.ts` (Patients-only), `noShowFollowUp.ts` (Appointments/Recall-only), `overdueInstallments.ts` and `overdueReceivables.ts` (Payments-only).
- **Compatibility helper:** `legacyWhatsApp.ts` — filename signals legacy/compat status.
- **Uncertain, not independently inspected in this pass:** `prismaSelects.ts`, `helpers.ts`, `counterStore.ts`.

## 8. Domain-and-module additions to the task's required list

- **Dental Laboratory / Prosthetics Tracking** was added as its own domain (routes/laboratories.ts, routes/labOrders.ts, services/labOrders/*, 4 models, 1 test file, 1 page) — not in the task's required domain list, but clear, self-contained repository evidence supports treating it independently rather than folding it into Treatment Cases or Inventory.
- **Messaging — Email** was kept separate from Identity and Access despite having no dedicated route file or model, because `emailService.ts`/`emailTemplates.ts` are imported for both auth flows and (potentially) clinic-facing notifications; this is flagged as genuinely ambiguous, not resolved.

## 9. Governance observation (not a judgment call by this task)

`AGENTS.md` §"Important MVP Rule" explicitly lists "Medical imaging storage" as something to avoid unless explicitly requested, alongside prescription management, AI medical diagnosis, full EHR, insurance integration, lab integration, and complex accounting. Repository evidence shows substantial implementations exist for several of these: Imaging (27-route `imaging.ts` plus a full device-bridge subsystem), Insurance (`InsuranceProvision` + routes), Dental Laboratory tracking, and Advanced Finance/compensation. This is recorded as a factual observation of a gap between the MVP charter and current implementation — not a recommendation to remove anything, and not evidence this task is authorized to act on.

## 10. Unresolved / explicitly unverified items

1. Whether `F0-002` Stage B (production evidence) will confirm or contradict any deployment-topology assumption implicit in this map — none was made; this map is 100% repository-only.
2. Exact line-level decomposition of `routes/whatsapp.ts` into AI-orchestration vs. WhatsApp-provider vs. Appointments-writing code was not performed (file-level hotspot flag only).
3. Raw SQL statements were inventoried by file, not audited statement-by-statement for tenant-predicate correctness.
4. `bridge-agent/` and `windows-bridge/` internal structure is unverified (out of scope per CODEGRAPH DISCIPLINE).
5. The full cross-domain import/call-evidence dependency matrix (C/E/S/X) is explicitly deferred to F0-004.
6. Test runtime, reliability, and CI-layer classification is explicitly deferred to F0-005.
7. Whether `ContactRequest` and `Messaging — Email` are correctly assigned to their current owner domains vs. deserving independent/different ownership is flagged as genuinely ambiguous in §3 and the JSON inventory, not resolved.
8. The 2 uncommitted Prisma models and the uncommitted `communicationConsent` service directory observed in the working tree during this task were **not** evaluated for domain ownership — they are not part of the committed evidence base this map is built from.

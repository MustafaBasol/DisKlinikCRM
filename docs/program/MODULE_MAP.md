# MODULE_MAP — Domain and Module Ownership Map

Son güncelleme: 2026-07-18 (F0-003)

> **Durum:** Bu doküman artık **depo-kanıtıyla doğrulanmış** (repository-evidence-verified) bir domain/modül sahiplik haritasıdır — F0-001'deki geçici hedef harita F0-003 tarafından gerçek dosya/model sahipliğiyle **revize edilmiştir**. Aşağıdaki her girdi mevcut kodun **gerçek** sorumluluk dağılımını belgeler; bu, modül sınırlarının **uygulandığı** anlamına gelmez. Kod tabanında bugün tek bir paylaşılan `PrismaClient` kullanılır ve hiçbir modülün sınırı derleme/lint zamanında zorlanmaz (F2'nin işi).
>
> Detaylı kanıt: [evidence/F0-003_MODULE_OWNERSHIP_EVIDENCE.md](evidence/F0-003_MODULE_OWNERSHIP_EVIDENCE.md) (Prisma model sahiplik tablosu, hotspot envanteri, raw SQL, shared utility sınıflandırması, cross-domain gözlemler).
> Yapısal/makine-okunur envanter: [evidence/F0-003_module_ownership_inventory.json](evidence/F0-003_module_ownership_inventory.json) (domain başına backend/frontend dosya listesi, contract adayları, criticality/maturity).
>
> **Kapsam dışı (bu görevde yapılmadı):** dosya taşıma, `server/src/modules`/`server/src/platform` hedef yapısının oluşturulması, module manifest'leri, eslint-boundaries, `public.ts` contract'ların implementasyonu, route→service refactor'u, import değişiklikleri, feature flag/entitlement eklenmesi, Prisma şema değişikliği, migration, test değişikliği, runtime davranış değişikliği, deployment değişikliği.
>
> Tüm kanıt commit `368bcc8d0a9f4c0ea185ca33d4dd1193d8def9ef` (`main` HEAD, bu görevin başlangıcı) üzerinden `git show`/`git ls-tree` ile sabitlenmiştir — çalışma ağacı değil, çünkü görev sırasında paylaşımlı çalışma ağacının eşzamanlı (KVKK) çalışma tarafından değiştirilmekte olduğu gözlemlenmiştir (bkz. evidence dokümanı §1).

## Core Platform

| Domain | Sınıflandırma | Criticality | Maturity | Kanıt |
|---|---|---|---|---|
| Identity and Access | core platform | regulatory/tenant-critical | partially bounded | `routes/auth.ts`, `middleware/auth.ts`, `User`/`PasswordResetToken`/`EmailVerificationToken` |
| Organization / Clinic / User Membership | core platform | regulatory/tenant-critical | partially bounded | `routes/clinicRegistration.ts`, `organizationBranches.ts`, `Organization`/`Clinic`/`Plan` |
| Tenant Security and Scope | core platform | regulatory/tenant-critical | clearly bounded | `middleware/clinicAccess.ts`, `utils/clinicScope.ts`, `utils/tenantGuard.ts` |
| Permissions / Roles | core platform | high-risk | mixed | `utils/roles.ts` + inline per-route checks (not fully centralized) |
| Entitlements and Release Flags | *see note* | — | — | No dedicated entitlement service found; `Plan.features` (JSON) and per-domain ad hoc flags (`ClinicSmsSettings.addonEnabled`, `PlatformSetting`) are the current de-facto mechanisms — not a bounded domain today |
| Audit and Activity | core platform | regulatory/tenant-critical | clearly bounded | `utils/activity.ts`, `utils/auditLog.ts`, `ActivityLog`/`AuditLog` |
| Privacy / Consent / Retention / Data Subject Rights | core platform | regulatory/tenant-critical | mixed | `routes/patientPrivacy.ts`, `gdprExport.ts`, `clinicBulkExport.ts`, `services/privacy/*` (10 files), 7 models |
| Security Incident Response and Detection | core platform | regulatory/tenant-critical | clearly bounded | `routes/platformSecurityIncidents.ts`, `services/security/*`, `SecuritySignalEvent`/`SecurityIncident`/`SecurityIncidentActivity` |
| Configuration and Secrets | core platform | high-risk | partially bounded | `routes/settings.ts`, `utils/secrets.ts`, `utils/encryption.ts`, `Setting`/`PlatformSetting` |
| Observability / Operational Events | core platform | elevated | clearly bounded | `routes/operationalMonitoring.ts`, `services/operationalEventService.ts`, `OperationalEvent` |
| Shared Events / Queue Contracts / Idempotency | core platform | high-risk | partially bounded | `services/messagingInboundIdempotency.ts`, `utils/jobLock.ts`, `MessagingInboundEvent`/`JobLock` |
| Storage Abstraction | core platform | high-risk | partially bounded | `services/fileStorage.ts`, `utils/fileSignature.ts` |
| Notifications | core platform | normal | clearly bounded | `routes/notifications.ts`, `Notification` |
| Platform Administration | platform capability | high-risk | mixed | `routes/platformAdmin.ts` (1201 lines/40 routes — hotspot), `middleware/platformAuth.ts`, `PlatformAdmin`/`PlatformSmsProvider` |

## Core Clinical Operations

| Domain | Sınıflandırma | Criticality | Maturity | Kanıt |
|---|---|---|---|---|
| Patients | core clinical | regulatory/tenant-critical | partially bounded | `routes/patients.ts`, `patientsImport.ts`, `Patient`/`PatientAttachment`/`PatientClinic` — en çok referans alınan model (18+ ilişki) |
| Appointments and Availability | core clinical | regulatory/tenant-critical | partially bounded | `routes/appointments.ts`, `appointmentRequests.ts`, `schedules.ts`, `Appointment`/`AppointmentType`/`AppointmentRequest`/`DoctorAvailability`/`DoctorOffDay`/`ContactRequest` |
| Treatment Cases | core clinical | elevated | partially bounded | `routes/treatmentCases.ts`, `treatmentPackages.ts`, `TreatmentCase`/`TreatmentPackage*` |
| Dental Chart / Procedures | core clinical | elevated | clearly bounded | `routes/dentalChart.ts`, `treatmentPlanProcedures.ts`, `ToothRecord`/`TreatmentPlanProcedure` |
| Public Booking | core clinical | elevated | partially bounded | `routes/publicBooking.ts` — no dedicated model; writes into Appointments + Privacy data |
| Basic Payments | core clinical | elevated | clearly bounded | `routes/payments.ts`, `paymentPlans.ts`, `Payment`/`PaymentPlan`/`PaymentPlanInstallment` |
| Tasks and Follow-up | core clinical | normal | clearly bounded | `routes/tasks.ts`, `Task` — added per AGENTS.md's explicit "Follow-up tasks" MVP entity |

## Optional / Operational Domains

| Domain | Sınıflandırma | Criticality | Maturity | Kanıt |
|---|---|---|---|---|
| Messaging — WhatsApp | optional operational | elevated | mixed | `routes/whatsapp.ts` (**3999 lines, hotspot** — only 7 of the file's routes are actual handlers), `whatsappInbox.ts`, `metaWhatsAppWebhook.ts`, `services/whatsapp/*` |
| Messaging — Instagram | optional operational | elevated | mixed | `routes/instagramInbox.ts`, `instagramWebhook.ts`, `services/instagram/*` |
| Messaging — SMS | optional operational | elevated | clearly bounded | `routes/sms.ts`, `services/sms/*` (8 files) — `ClinicSmsSettings.addonEnabled` is the cleanest real commercial-entitlement example in the repo |
| Messaging — Email | optional operational | normal | partially bounded | `services/emailService.ts`, `emailTemplates.ts` — no dedicated route/model; ambiguous vs. Identity and Access |
| Messaging AI Orchestration | optional operational | elevated | shared/ambiguous | `services/whatsappConversationAgent.ts`, `whatsappInterpreter.ts`, `whatsappStepAwareNlu.ts`, etc. — currently WhatsApp-specific, not a channel-agnostic AI platform |
| Automations / Reminders / Follow-up / Recall | optional operational | elevated | clearly bounded | `routes/recall.ts`, `postTreatment.ts`, `jobs/reminders.ts`, `RecallCandidate`/`RecallAction`/`PostTreatmentMessage*` |
| Imaging — Server Ingest and Viewer | optional operational | elevated | mixed | `routes/imaging.ts` (**1303 lines/27 routes**), `ImagingDevice`/`ImagingRequest`/`ImagingStudy`/`ImagingImage` |
| Imaging — Device Bridge / Windows Bridge | external adapter/integration | elevated | partially bounded | `routes/imagingBridgePublic.ts`, `services/imaging/bridge*.ts`, `bridge-agent/`, `windows-bridge/` (internals unscanned — out of task scope) |
| Inventory | optional operational | normal | clearly bounded | `routes/inventory.ts`, `InventoryItem`/`InventoryTransaction` — note: `InventoryItem` is organization-scoped while `InventoryTransaction` is clinic-scoped (flagged for F5) |
| Insurance | optional operational | normal | clearly bounded | `routes/insuranceProvisions.ts`, `InsuranceProvision` — internal tracking only, no real insurer adapter |
| Advanced Finance — Compensation and Payouts | optional operational | elevated | clearly bounded | `routes/financeDashboard.ts`, `compensationRules.ts`, `practitionerEarnings.ts`, `services/earningService.ts` |
| Reporting / Analytics | optional operational | normal | shared/ambiguous | `routes/reports.ts` (raw-SQL hotspot), `dashboard.ts` — no dedicated models; widest cross-domain read footprint |
| Dental Laboratory / Prosthetics Tracking | optional operational | normal | clearly bounded | `routes/laboratories.ts`, `labOrders.ts`, `Laboratory`/`LabWorkOrder*` — **added beyond the original required list**; clear, self-contained repository evidence supports independent ownership |

## Planned / Not Implemented

Per repository evidence, the following are **confirmed absent**, not merely unverified — no routes, services, or models were found:

| Domain | Kanıt durumu |
|---|---|
| AI Platform / AI Gateway | Only a generic `services/googleAiStudio.ts` exists; no provider registry, model routing, cost metering, safety policy, or AI Gateway. AI usage today is embedded entirely inside Messaging AI Orchestration (WhatsApp-specific). |
| Integration Platform (Official/Ministry Adapters) | No Sağlık Bakanlığı or other official-integration code found; each channel (WhatsApp/Instagram/SMS) has its own bespoke provider-factory pattern. |
| Billing / Subscription Engine | `Plan.features` is the only real entitlement storage; `PricingPage.tsx`/`components/pricing/*` are marketing surfaces, not a functioning subscription-billing system. |
| Campaign Management, Health Tourism, Lead Management, Call Center, Marketing Analytics, Invoicing, e-Invoice/e-Archive, Accounting Connectors, Insurance Connectors, Ministry Integrations | No routes, services, models, or dedicated frontend surfaces found for any of these. |

## Governance note (factual observation, not a recommendation)

`AGENTS.md` explicitly lists medical imaging storage, insurance integration, laboratory integration, and complex accounting as things to avoid unless explicitly requested for the MVP. Repository evidence shows substantial, real implementations exist for Imaging, Insurance, Dental Laboratory tracking, and Advanced Finance/compensation. This is recorded as a fact about the gap between the MVP charter and current implementation; it is not a judgment this task is authorized to act on. See evidence document §9.

## Cross-domain dependencies and future contracts

The full satır/sütun (row/column) cross-domain import-evidence matrix is **F0-004's deliverable** — see [DEPENDENCY_MAP.md](DEPENDENCY_MAP.md). This task recorded a small set of notable observations incidentally (Messaging directly writing Patients/Appointments data, Dental Chart writing Inventory directly, Privacy directly touching legalHold fields on Patients/Imaging tables, Reporting's wide raw-SQL read footprint) — see evidence document §4 so F0-004 does not have to rediscover them.

Contract candidates evaluated against real evidence (not invented): `PatientDirectory`/`PatientReferenceQuery`, `AppointmentReferenceQuery`, `AppointmentCompleted`/`ProcedureCompleted` events, `PaymentReceived` event, `ImagingStudyReceived` event, a Consent/Privacy evidence service, `StoragePort`, a Messaging send/automation command, an Inventory stock-adjustment command, a Reporting read-model boundary, and an `AiProvider`/`AiGateway` contract. Full rationale per candidate is in the evidence document and the JSON inventory's `contract_candidates` field per domain.

## Data ownership

Every one of the 88 committed Prisma models (`server/prisma/schema.prisma` at commit `368bcc8`) is assigned to exactly one primary owner domain, tenant scope, and sensitivity classification in [evidence/F0-003_MODULE_OWNERSHIP_EVIDENCE.md §3](evidence/F0-003_MODULE_OWNERSHIP_EVIDENCE.md#3-data-ownership--full-prisma-model-inventory-88-models-committed-baseline). This satisfies the "every Prisma model represented exactly once" F0-003 coverage requirement; see [data-ownership requirements in the evidence doc] for the 4 models using the explicitly-permitted "Shared Contract/Reference Data" or mixed/ambiguous categories.

## Large / mixed-responsibility file hotspots

See [evidence document §5](evidence/F0-003_MODULE_OWNERSHIP_EVIDENCE.md#5-large--mixed-responsibility-file-inventory-hotspots) and the JSON inventory's `hotspots[]` array. Highlights: `routes/whatsapp.ts` (3999 lines, only ~380 are actual route handlers — the rest is embedded conversation-AI/patient-matching/booking-flow business logic) and `routes/platformAdmin.ts` (1201 lines/40 routes spanning 5+ admin sub-areas). **No refactor was performed in this task.**

## Doğrulama planı — sonraki adımlar

- **F0-004 — Cross-Module Dependency Map**: bu haritadaki domain kümesini kullanarak tam import/çağrı-kanıtlı bağımlılık matrisini dolduracak ([DEPENDENCY_MAP.md](DEPENDENCY_MAP.md)).
- **F0-005 — Test Inventory**: bu haritadaki domain→test dosyası eşlemesini kullanarak süre/güvenilirlik/CI-katmanı ölçümünü yapacak ([TEST_OWNERSHIP.md](TEST_OWNERSHIP.md)).
- **ADR-001 / ADR-015**: bu haritayı ve F0-004 çıktısını kanıt olarak kullanacak (henüz `PROPOSED`).

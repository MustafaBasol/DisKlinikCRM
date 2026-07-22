# Affected-Module Test Matrix

Task: ARCH-TEST-001 · Companion to: [`AFFECTED_MODULE_TEST_STRATEGY.md`](AFFECTED_MODULE_TEST_STRATEGY.md)

**Status: PROPOSED / NOT ACTIVE — data reference only, nothing here is wired into CI.**

Baseline: commit `3b4ec9d468f6f93dc67aae5c1fe8fbfe6c7ce80c`, rebaselined 2026-07-22 to `origin/main` tip `7c2aea5a084c38de5732fda65ca0874aa8d46024` (PR #208 merge — 5 new `docs/operations/pilot/**` files only, confirmed no technical impact on this analysis; see `AFFECTED_MODULE_TEST_STRATEGY.md`'s rebaseline note). Sources: F0-003 (`MODULE_MAP.md`), F0-004 (`DEPENDENCY_MAP.md`), F0-005 (`TEST_OWNERSHIP.md` + `F0-005_test_inventory.json`, baseline `7fcf2f8`), this task's own grep of all 57 route files and header-read of the 20 test files added since F0-005.

All commands below are `cd server &&` relative unless prefixed `root:`. `DB` column: **none** = pure logic; **DB-live** = imports `db.js` directly (a live `PrismaClient` connects at import time — needs `DATABASE_URL`); **dbVerification** = the dedicated disposable-Postgres suite under `server/src/tests/dbVerification/`.

---

## 1. F0-003 domain → module reconciliation (all 37 domains accounted for)

| Module | F0-003 domain(s) |
|---|---|
| 1. Auth / Tenant Scope | Identity and Access · Tenant Security and Scope · Organization/Clinic/User Membership · Permissions/Roles · Entitlements and Release Flags |
| 2. Patients | Patients · (sec.) Storage Abstraction · (sec.) Tasks and Follow-up |
| 3. Appointments | Appointments and Availability |
| 4. Appointment Requests | (carve-out of Appointments and Availability + Public Booking) |
| 5. Dental Chart | Dental Chart/Procedures · (sec.) Treatment Cases · (sec.) Dental Laboratory/Prosthetics Tracking · (sec.) Imaging — Server Ingest and Viewer |
| 6. Payments | Basic Payments · (sec.) Advanced Finance — Compensation and Payouts |
| 7. Inventory | Inventory |
| 8. Insurance | Insurance |
| 9. Messaging | Messaging — SMS · Messaging — Email · Automations/Reminders/Follow-up/Recall · Notifications · Cross-Domain Contract (`MessageTemplate`) |
| 10. WhatsApp / Meta | Messaging — WhatsApp · Messaging — Instagram · Messaging AI Orchestration |
| 11. Privacy / KVKK | Privacy/Consent/Retention/DSR · (sec.) Security Incident Response and Detection · (sec.) Audit and Activity |
| 12. Reports | Reporting/Analytics · (sec.) Observability/Operational Events |
| 13. Platform Admin | Platform Administration · (sec.) Configuration and Secrets |
| 14. Imaging Device Bridge (own CI, out of scope) | Imaging — Device Bridge/Windows Bridge |
| *cross-cutting, not module-owned* | Audit and Activity¹ · Configuration and Secrets¹ · Observability/Operational Events¹ · Shared Events/Queue/Idempotency¹ · Storage Abstraction¹ |

¹ Listed twice where a domain is both "folded as secondary into one module" (its route/model surface) and "cross-cutting" (its low-level utility files, e.g. `utils/auditLog.ts`, `utils/secrets.ts`) — a file-level distinction. Cross-cutting utility files trigger the full-suite fallback (strategy doc §11) instead of being attributed to one module.

---

## 2. Per-module detail

Each row's **Test files** lists this task's placement; `(sec.)` marks a secondary/cross-cutting test. Full per-file source-dependency detail (imports, DB requirement, exact npm script) is in §7 for the 20 files added since F0-005, and in F0-005's own `F0-005_test_inventory.json` `testFiles[]` for the other 72.

### 2.1 Auth / Tenant Scope

- **Owned runtime paths:** `routes/auth.ts`, `routes/clinicRegistration.ts`, `routes/users.ts`, `routes/usersImport.ts`, `routes/organizationBranches.ts`, `middleware/auth.ts`, `middleware/clinicAccess.ts`, `middleware/csrf.ts`, `middleware/planLimits.ts`, `utils/clinicScope.ts`, `utils/roles.ts`, `utils/sessionCookies.ts`, `utils/authFallback.ts`, `utils/totp.ts`, `utils/passwordResetToken.ts`
- **Direct dependencies:** none inbound-owned (this is the platform's dependency sink — F0-004 §6 measured 114 inbound edges into Identity and Access, 39 into Tenant Security, the two highest fan-in domains after Org/Membership and Appointments). Outbound: `services/emailService.ts`/`emailTemplates.ts` (verification/reset mail)
- **Public contracts:** `/api/auth/*`, `/api/users*`, `/api/organization/branches`, plus every other module's routes indirectly (all pass through `authenticate`/`authorize`/`requireClinicAccess`)
- **Fan-in (this task's measurement):** `middleware/auth.ts` imported by 48/57 route files; `utils/clinicScope.ts` by 36/57; `utils/roles.ts` by 10/57
- **Test files (primary):** `emailVerification.test.ts` (`test:email-verification`), `passwordReset.test.ts` (`test:password-reset`), `sessionCookieCsrf.test.ts` (`test:auth`, chained with platformAdmin.test.ts — see §8 note 1), `totp.test.ts` (`test:totp`), `staffOnboarding.test.ts` (`test:staff-onboarding`), `userImportOnboarding.test.ts` (`test:user-import-onboarding`), `multiBranchAccess.test.ts` (`test:roles`), `billingFinancialTreatmentCaseSelect.test.ts` (`test:billing-financial-select`), `billingPatientAccess.test.ts` (`test:billing-patient-access`), `treatmentCaseClinicScope.test.ts` (`test:treatment-case-scope`), `treatmentPackagePermissions.test.ts` (no script — direct `tsx`), plus the 6 clinic-scope-fix characterization tests placed here per F0-005's own precedent (a clinic-scope-correctness test's principal behavior is Tenant Security, not the route file it happens to scan): `appointmentRequestRecordScope.test.ts`, `dentalChartClinicScope.test.ts`, `reportsClinicScope.test.ts`, `messagesRecordScope.test.ts`, `kvkkHigh006Batch2ClinicScope.test.ts` (no script), `kvkkHigh006Batch3ClinicScope.test.ts` — and all 6 `dbVerification/kvkkHigh006Db*.test.ts` files (clinic-scope-access-pattern verification against a live disposable Postgres)
- **DB required:** `dbVerification/*` = yes (disposable Postgres). All others = none.
- **Mandatory regression set (commands):** `npm run test:auth && npm run test:email-verification && npm run test:password-reset && npm run test:totp && npm run test:staff-onboarding && npm run test:user-import-onboarding && npm run test:roles && npm run test:billing-financial-select && npm run test:billing-patient-access && npm run test:treatment-case-scope && npm run test:appointment-request-record-scope && npm run test:dental-chart-clinic-scope && npm run test:reports-clinic-scope && npm run test:messages-record-scope && npm run test:kvkk-high006-batch3 && npx tsx src/tests/treatmentPackagePermissions.test.ts && npx tsx src/tests/kvkkHigh006Batch2ClinicScope.test.ts` (+ `npm run test:kvkk-high006-db-verification` only if a disposable Postgres is available in the run environment — see strategy doc §12)
- **Full-suite trigger conditions:** ANY change to `middleware/auth.ts`, `middleware/clinicAccess.ts`, `utils/clinicScope.ts`, `utils/roles.ts`, `server/src/db.ts`, or `server/src/index.ts` — per strategy doc §11 rule 2, these are fan-in ≥10 files and escalate to the full suite rather than staying module-local, because 48/57 (auth) and 36/57 (clinicScope) route files depend on them.

### 2.2 Patients

- **Owned runtime paths:** `routes/patients.ts`, `routes/patientsImport.ts`, `routes/attachments.ts`, `routes/tasks.ts`
- **Direct dependencies:** reads into Appointments, Treatment Cases, Messaging conversation tables (communication-history tab, F0-004 §4); writes `PatientAttachment`/`ActivityLog`. Highest inbound fan-in of any clinical domain (52 edges, F0-004 §6) — Dental Chart, Privacy, Public Booking, Messaging, Tenant Security all read `Patient`.
- **Public contracts:** `/api/patients*`, `/api/patients/:id/dental-chart*` (proxy — see Dental Chart), `/api/tasks`
- **Test files:** `excelImport.test.ts` (`test:imports`), `patientName.test.ts` (`test:patient-name`), `patientSharedPhone.test.ts` (no script), `patientPrivacy.test.ts` (`test:patient-privacy` — see §2.11, dual-relevant), `filePreview.test.ts` (`test:file-preview`, Storage-Abstraction-secondary), `whatsappConversationPersistence.test.ts` (`test:wa-persistence`, reads `routes/patients.ts` source)
- **DB required:** none of the above
- **Mandatory regression set:** `npm run test:imports && npm run test:patient-name && npx tsx src/tests/patientSharedPhone.test.ts && npm run test:patient-privacy && npm run test:file-preview && npm run test:wa-persistence`
- **Full-suite trigger conditions:** a change to `Patient`/`PatientAttachment`/`PatientClinic` in `prisma/schema.prisma` (per strategy §11 rule 3, schema changes always fall back); a change simultaneously touching `patients.ts` AND any of WhatsApp/Meta's 4 high-risk files (§5 escalation)

### 2.3 Appointments

- **Owned runtime paths:** `routes/appointments.ts`, `routes/schedules.ts`, `routes/services.ts`, `routes/noShows.ts`, `routes/recall.ts`'s availability-adjacent parts (recall itself is Messaging, §2.9)
- **Direct dependencies:** `DoctorAvailability`/`DoctorOffDay` are written cross-domain by `routes/users.ts` (Auth/Tenant-Scope module) — F0-004 §5.1's first reviewed cycle, `medium` risk, recommended fix is moving that CRUD into `schedules.ts` (not done by this task). Reads `AppointmentType`, `ClinicWorkingHours`.
- **Public contracts:** `/api/appointments*`, `/api/schedules*`/`/api/availability`, `/api/services`, `/api/no-shows*`
- **Test files:** `appointmentAvailabilityService.test.ts` (`test:availability-service`), `appointmentUpdateValidation.test.ts` (`test:appointment-update-validation`), `noShow.test.ts` (`test:no-shows`), `noShowFollowUpParity.test.ts` (`test:no-show-follow-up-parity` — **not in aggregate `npm run test`**), `scheduleAccess.test.ts` (`test:schedule`), `servicePricing.test.ts` (`test:pricing`), `overdueInstallments.test.ts`/`overdueReceivables.test.ts` (dashboard-adjacent, placed here as secondary — **both not in aggregate `npm run test`**, and `overdueInstallments.test.ts` has a confirmed live 2-assertion regression per F0-005 §9.2)
- **DB required:** none
- **Mandatory regression set:** `npm run test:availability-service && npm run test:appointment-update-validation && npm run test:no-shows && npm run test:no-show-follow-up-parity && npm run test:schedule && npm run test:pricing`
- **Full-suite trigger conditions:** a change to `services/appointmentRequestSafety.ts` (the `pg_advisory_xact_lock` safe-booking pattern shared with Appointment Requests/Public Booking — §5); a change to `Appointment`/`AppointmentType`/`DoctorAvailability`/`DoctorOffDay` in the Prisma schema

### 2.4 Appointment Requests

- **Owned runtime paths:** `routes/appointmentRequests.ts`, `routes/contactRequests.ts`, `routes/publicBooking.ts`, `services/appointmentRequestSafety.ts`, `services/appointments/appointmentAvailabilityService.ts` (shared with Appointments)
- **Direct dependencies:** `services/whatsappAvailability.ts` (WhatsApp/Meta-owned) is imported by `publicBooking.ts` for slot computation — F0-004 §9's "misplaced-shared-utility" finding, a real cross-module coupling not yet fixed
- **Public contracts:** `/api/appointment-requests*`, `/api/contact-requests`, `/api/public/booking/*` (unauthenticated — no CSRF/clinic-scope interceptor, confirmed by the frontend survey)
- **Test files:** `appointmentRequestOverlapSafety.test.ts` (`test:overlap-safety`), `contactRequests.test.ts` (`test:contact-requests`), `publicBookingAvailability.test.ts` (`test:public-booking`), `publicBookingSlotConsistency.test.ts` (`test:public-booking-slots`), `publicBookingSlotRequired.test.ts` (`test:public-booking-slot-required`), `publicBookingNoticeEvidence.test.ts` (`test:notice-evidence`, Privacy-secondary), `appointmentRequestRecordScope.test.ts` (secondary — primary is Auth/Tenant Scope, §2.1), `src/pages/__tests__/bookingWidgetHelpers.test.ts` (`root: npm run test:booking-widget-helpers`)
- **DB required:** none
- **Mandatory regression set:** `npm run test:overlap-safety && npm run test:contact-requests && npm run test:public-booking && npm run test:public-booking-slots && npm run test:public-booking-slot-required && npm run test:notice-evidence && npm run test:appointment-request-record-scope` + `root: npm run test:booking-widget-helpers`
- **Full-suite trigger conditions:** any change to `services/appointmentRequestSafety.ts` (shared advisory-lock pattern — a regression here silently reintroduces the double-booking class of bug F0-004 §3 flagged as the single most severe cross-module finding); any change simultaneously touching this module and WhatsApp/Meta's `whatsappInbox.ts` (§5 — the exact file missing this module's safe locking pattern)

### 2.5 Dental Chart

- **Owned runtime paths:** `routes/dentalChart.ts`, `routes/treatmentPlanProcedures.ts`, `routes/treatmentCases.ts`, `routes/treatmentPackages.ts`, `routes/laboratories.ts`, `routes/labOrders.ts`, `routes/imaging.ts`, `services/labOrders/*`, `services/imaging/*` (Server/Viewer side only — bridge-internal files belong to module 14), `services/treatmentStockDeduction.ts` (writes into Inventory — F0-004 §2.1 canonical write path)
- **Direct dependencies:** `services/treatmentStockDeduction.ts` → Inventory (`InventoryItem`/`InventoryTransaction` writes, a proven cross-module cycle, F0-004 §5.1 `medium` risk); `routes/imaging.ts` ↔ `routes/imagingBridgePublic.ts` (module 14) share row-locked raw-SQL reads on `ImagingBridgeAgent`/`ImagingDevice` (F0-004 §5.1, `medium` risk cycle)
- **Public contracts:** `/api/patients/:id/dental-chart*`, `/api/treatment-cases*`, `/api/treatment-packages*`, `/api/treatment-plan-procedures*` (proxied via `treatmentCases`/`patients` in `api.ts`), `/api/laboratories*`, `/api/lab-orders*`, `/api/imaging*`
- **Test files:** `dentalChartClinicScope.test.ts` (secondary — primary Auth/Tenant Scope), `labOrders.test.ts` (`test:lab-orders`), `imaging.test.ts` (`test:imaging`), `kvkkAttachmentImagingLifecycle.test.ts` (`test:kvkk-lifecycle`, Privacy-secondary), `src/components/imaging/__tests__/dicomHelpers.test.ts` (`root: npm run test:dicom-helpers`)
- **DB required:** none of the above (imaging bridge pairing/onboarding/update tests belong to module 14, not this module)
- **Mandatory regression set:** `npm run test:lab-orders && npm run test:imaging && npm run test:kvkk-lifecycle && npm run test:dental-chart-clinic-scope` + `root: npm run test:dicom-helpers`
- **Full-suite trigger conditions:** any change to `services/treatmentStockDeduction.ts` (also run Inventory's set, §6); `TreatmentCase`/`ToothRecord`/`InventoryItem`/`InventoryTransaction` schema changes

### 2.6 Payments

- **Owned runtime paths:** `routes/payments.ts`, `routes/paymentPlans.ts`, `routes/financeDashboard.ts`, `routes/compensationRules.ts`, `routes/practitionerEarnings.ts`, `routes/practitionerPayouts.ts`, `services/earningService.ts`
- **Direct dependencies:** `services/earningService.ts` reads `Payment` directly (F0-004 §4's own "legitimate business collaboration" example, no write). No cross-module writes found into any Payment model (F0-004 §4).
- **Public contracts:** `/api/payments*`, `/api/payment-plans*`, `/api/finance*`, `/api/compensation-rules*`, `/api/practitioner-earnings*`, `/api/practitioner-payouts*`
- **Test files:** `paymentValidation.test.ts` (`test:payment-validation`), `paymentBillingEdit.test.ts` (`test:payment-billing-edit`), `financeDashboard.test.ts` (`test:finance`), `overdueInstallments.test.ts`/`overdueReceivables.test.ts` (secondary — primary placed under Appointments/dashboard §2.3, cite here too since both touch `PaymentPlanInstallment`), `kvkkHigh006Batch2ClinicScope.test.ts` (secondary — primary Auth/Tenant Scope, covers `paymentPlans.ts`)
- **DB required:** none
- **Mandatory regression set:** `npm run test:payment-validation && npm run test:payment-billing-edit && npm run test:finance`
- **Full-suite trigger conditions:** `Payment`/`PaymentPlan`/`PaymentPlanInstallment`/`PractitionerEarning` schema changes

### 2.7 Inventory

- **Owned runtime paths:** `routes/inventory.ts`
- **Direct dependencies:** written cross-module by both Dental Chart (`services/treatmentStockDeduction.ts`) and directly by `routes/treatmentCases.ts`/`treatmentPackages.ts` (also Dental-Chart-module-owned) — F0-004 §4/§10 `CC-10` candidate, two independent write paths into the same target
- **Public contracts:** `/api/inventory*`
- **Test files:** **none dedicated.** Only coverage is `kvkkHigh006Batch2ClinicScope.test.ts` (secondary — a clinic-scope characterization test that `readFileSync`s `routes/inventory.ts`, primary-owned by Auth/Tenant Scope) and the indirect `dbVerification` DB-verification suite's fixture data touching `inventoryItem`/`inventoryTransaction` models incidentally, not as a target of assertions.
- **DB required:** none directly testable
- **Mandatory regression set:** `npx tsx src/tests/kvkkHigh006Batch2ClinicScope.test.ts` (the only test that names `routes/inventory.ts` at all) — **this is a known coverage gap, not a design choice; see §8 note 2.**
- **Full-suite trigger conditions:** ANY change to `routes/inventory.ts` — because the module has no dedicated regression test, a change here cannot be verified by a targeted run at all; treat as an automatic full-suite trigger until a dedicated `inventory.test.ts` exists (implementation-task follow-up, not in this task's scope)

### 2.8 Insurance

- **Owned runtime paths:** `routes/insuranceProvisions.ts`
- **Direct dependencies:** reads `Patient`, `TreatmentCase`. No cross-module writes found (F0-004).
- **Public contracts:** `/api/insurance-provisions*`
- **Test files:** **none dedicated** in `server/src/tests/`. Only coverage: `kvkkHigh006Batch2ClinicScope.test.ts` (secondary, same as Inventory) and `dbVerification/kvkkHigh006DbInsuranceListBehavior.test.ts` (DB-verification, clinic-scope list-behavior specifically for insurance).
- **DB required:** `dbVerification/kvkkHigh006DbInsuranceListBehavior.test.ts` = yes (disposable Postgres)
- **Mandatory regression set:** `npx tsx src/tests/kvkkHigh006Batch2ClinicScope.test.ts && npm run test:kvkk-high006-db-insurance-list-behavior` (second command requires a disposable Postgres — see strategy §12)
- **Full-suite trigger conditions:** ANY change to `routes/insuranceProvisions.ts` — same zero-dedicated-coverage gap as Inventory (§8 note 2).

### 2.9 Messaging (channel-agnostic)

- **Owned runtime paths:** `routes/messages.ts`, `routes/sms.ts`, `routes/recall.ts`, `routes/postTreatment.ts`, `routes/communicationPreferences.ts`, `routes/notifications.ts`, `services/sms/*`, `services/communicationConsent/*`, `services/channelConsentGate.ts`, `services/emailService.ts`, `services/emailTemplates.ts`, `services/metaTemplateService.ts`, `services/postTreatmentMessaging.ts`, `services/recallCandidateService.ts`, `services/recallSettings.ts`, `jobs/reminders.ts`, `jobs/metaTemplateSyncJob.ts`, `jobs/dataRetentionCleanupJob.ts` (Privacy-secondary)
- **Direct dependencies:** `MessageTemplate` is F0-003's confirmed shared-contract model, read by both this module and WhatsApp/Meta (§10) without being a violation. `jobs/reminders.ts` directly creates `SentMessage` (WhatsApp/Meta-owned) — F0-004 §7's `CC-11` candidate (Messaging send command), not yet implemented.
- **Public contracts:** `/api/messages*`, `/api/sms*`, `/api/recall*`, `/api/message-templates*`, `/api/communication-preferences*` (naming per frontend survey: `/api/patients/:id/communication-preferences*`), `/api/notifications`
- **Test files:** `messageSafetyHardening.test.ts` (`test:msg-safety`), `messageTemplatePurpose.test.ts` (`test:purpose`), `messageTemplateWabaBinding.test.ts` (`test:template-waba-binding`), `metaTemplateService.test.ts` (`test:meta-template` — **not in aggregate**), `metaTemplateSyncJob.test.ts` (`test:meta-template-sync`), `smsModule.test.ts` (`test:sms`), `postTreatmentMessaging.test.ts` (`test:post-treatment`), `communicationConsent.test.ts` (`test:communication-consent`, **DB-live**), `communicationConsentAuditReport.test.ts` (`test:communication-consent-audit-report`, **DB-live**), `communicationPreferenceBackfill.test.ts` (`test:communication-consent-backfill`, **DB-live**), `communicationPreferenceReconciliationReport.test.ts` (`test:communication-consent-reconciliation-report`, **DB-live**), `communicationPreferencesRoute.test.ts` (`test:communication-consent-matrix-route`, **DB-live**), `legacyConsentCorrection.test.ts` (`test:legacy-consent-correction`, **DB-live**), `legacyReconciliationResolver.test.ts` (`test:communication-consent-reconciliation`, **DB-live**), `messagesConsentGate.test.ts` (`test:messages-consent-gate`, **DB-live**), `recallConsentGate.test.ts` (`test:recall-consent-gate`, **DB-live**), `messagesRecordScope.test.ts` (secondary, primary Auth/Tenant Scope), `kvkkHigh006Batch3ClinicScope.test.ts` (secondary, primary Auth/Tenant Scope), `channelConsentFlowResume.test.ts` (`test:consent-resume` — **not in aggregate**), `channelConsentGate.test.ts` (no script), `operationalMonitoring.test.ts` (secondary, Reports-owned primary — see §2.12), `src/components/__tests__/communicationConsentMatrixHelpers.test.ts` (`root: npm run test:communication-consent-matrix`)
- **DB required:** **11 of the above files import `db.js` directly and need a live Postgres — this is the module with by far the largest DB-required surface in the repository.** This task's own re-check of the current tree confirms this beyond F0-005's original 4-file DB-required count (§8 note 3).
- **Mandatory regression set (non-DB subset, always runnable):** `npm run test:msg-safety && npm run test:purpose && npm run test:template-waba-binding && npm run test:meta-template && npm run test:meta-template-sync && npm run test:sms && npm run test:post-treatment && npm run test:messages-record-scope && npm run test:kvkk-high006-batch3 && npm run test:consent-resume && npx tsx src/tests/channelConsentGate.test.ts` + `root: npm run test:communication-consent-matrix`
- **Mandatory regression set (DB-required subset — only if disposable Postgres available):** `npm run test:communication-consent && npm run test:communication-consent-audit-report && npm run test:communication-consent-backfill && npm run test:communication-consent-reconciliation-report && npm run test:communication-consent-matrix-route && npm run test:legacy-consent-correction && npm run test:communication-consent-reconciliation && npm run test:messages-consent-gate && npm run test:recall-consent-gate`
- **Full-suite trigger conditions:** any change to `services/channelConsentGate.ts` (F0-004 §5.1's Privacy↔WhatsApp cycle pivot — also run Privacy/KVKK and WhatsApp/Meta sets, §5); `MessageTemplate` schema change (shared-contract model, also run WhatsApp/Meta's set)

### 2.10 WhatsApp / Meta

- **Owned runtime paths:** `routes/whatsapp.ts` (**3999 lines — repo's largest hotspot**), `routes/whatsappInbox.ts`, `routes/metaWhatsAppWebhook.ts`, `routes/organizationWhatsApp.ts`, `routes/instagramInbox.ts`, `routes/instagramWebhook.ts`, `routes/organizationInstagram.ts`, `services/whatsapp/*`, `services/instagram/*`, `services/whatsappAgentPrompt.ts`, `whatsappAgentSchema.ts`, `whatsappAvailability.ts`, `whatsappBookingFlow.ts`, `whatsappClarification.ts`, `whatsappConversationAgent.ts`, `whatsappInterpreter.ts`, `whatsappPublicApi.ts`, `whatsappResolvedIntentRouter.ts`, `whatsappStepAwareNlu.ts`, `whatsappWebhookPayload.ts`
- **Direct dependencies — the repository's highest-risk module.** Source of **all 9 of F0-004's high-risk boundary-violation edges** (§3 there, §5 here): direct `Patient.create`/`Patient.update`/`Appointment.create`/`Appointment.update` writes bypassing Patients' and Appointments'/Appointment-Requests' own write paths. Also the single "god module" signature in the codebase — 106 outbound + 49 inbound cross-domain edges simultaneously (F0-004 §6).
- **Public contracts:** `/api/whatsapp*`, `/api/organization/whatsapp-connections*`, `/api/instagram/inbox/*`, `/api/organization/instagram-connections*`, `/api/public/whatsapp` (unauthenticated webhook)
- **Test files:** `whatsappAgentEvaluation.test.ts` (`test:agent`), `whatsappAwaitingServiceStep.test.ts` (`test:meta-wa`), `whatsappConversationPersistence.test.ts` (`test:wa-persistence`, Patients-secondary), `whatsappIdentityAndPostBooking.test.ts` (`test:meta-wa`), `whatsappInbox.test.ts` (`test:inbox`), `whatsappOutboundMessaging.test.ts` (`test:outbound` — **not in aggregate**), `whatsappProvider.test.ts` (`test:whatsapp`), `whatsappStepAwareNlu.test.ts` (`test:meta-wa`), `metaWhatsAppWebhook.test.ts` (`test:meta-wa`), `instagramAssistantParity.test.ts`/`instagramConversion.test.ts`/`instagramProvider.test.ts` (`test:instagram`)
- **DB required:** none of the above (all use in-process fakes/fixtures, per F0-005's own finding that this domain's tests are unit-shaped despite the domain's high real-world DB write volume — see §8 note 4, this is itself a coverage-quality concern, not just a gap)
- **Mandatory regression set:** `npm run test:agent && npm run test:meta-wa && npm run test:wa-persistence && npm run test:inbox && npm run test:outbound && npm run test:whatsapp && npm run test:instagram`
- **Full-suite trigger conditions:** **ANY change to `routes/whatsapp.ts`, `routes/whatsappInbox.ts`, `services/whatsapp/metaWhatsAppAiProcessor.ts`, or `services/instagram/instagramAiConversationProcessor.ts` — mandatory escalation per §5, always also runs Patients + Appointments + Appointment Requests regression sets, not just this module's own.** This is the single most important rule in this entire design (F0-004's own words: "the clearest single god-module signature in the codebase").

### 2.11 Privacy / KVKK

- **Owned runtime paths:** `routes/patientPrivacy.ts`, `routes/gdprExport.ts`, `routes/clinicBulkExport.ts`, `routes/publicClinicKvkk.ts`, `routes/clinicLegalProfile.ts`, `routes/platformSecurityIncidents.ts`, `services/privacy/*` (10 files), `services/security/*`, `jobs/dataRetentionCleanupJob.ts`, `jobs/clinicBulkExportWorker.ts`/`clinicBulkExportCleanupJob.ts`, `jobs/patientPrivacyExportCleanupJob.ts`
- **Direct dependencies:** highest outbound fan-out after WhatsApp (97 edges, F0-004 §6) — a single legally-mandated cross-cutting concern (anonymization/export/retention), not diffuse coupling. Direct raw-SQL writes into WhatsApp/Instagram conversation tables during anonymization (F0-004 §8, `high` risk — not injection risk, an architectural cross-module write). `channelConsentGate.ts` (Messaging-owned) reads Privacy's consent models — the accepted direction of the Privacy↔WhatsApp cycle (F0-004 §5.1).
- **Public contracts:** `/api/patients/:id/privacy/*`, `/api/gdpr-export*`, `/api/clinic/:id/bulk-export*`, `/api/public/clinics/:slug/kvkk`, `/api/clinics/:id/legal-profile`, `/api/platform/security-incidents*`
- **Test files:** `aiPrivacyBoundary.test.ts` (no script), `channelConsentGate.test.ts` (no script, secondary — see §2.9), `channelConsentFlowResume.test.ts` (secondary — primary Messaging, §2.9), `clinicBulkExport.test.ts` (`test:clinic-bulk-export` — **known STABLE_FAIL, CRLF line-ending issue, F0-005 §9.1, not a product defect**), `clinicLegalProfile.test.ts` (no script), `dataRetentionCleanupJob.test.ts` (`test:data-retention`), `kvkkAttachmentImagingLifecycle.test.ts` (`test:kvkk-lifecycle`, secondary primary Dental Chart), `patientPrivacy.test.ts` (`test:patient-privacy`, secondary primary Patients), `publicBookingNoticeEvidence.test.ts` (`test:notice-evidence`, secondary primary Appointment Requests), `securityIncident.test.ts` (`test:security-incidents`, **DB-live**, partially blocked per F0-005 §9.3), `src/components/settings/__tests__/clinicBulkExportSelectionHelpers.test.ts` (`root: npm run test:clinic-bulk-export-selection`), `src/components/__tests__/communicationConsentMatrixHelpers.test.ts` (secondary — primary Messaging)
- **DB required:** `securityIncident.test.ts` = yes (partially — first 8 assertions run without DB, F0-005 §9.3)
- **Mandatory regression set:** `npx tsx src/tests/aiPrivacyBoundary.test.ts && npx tsx src/tests/channelConsentGate.test.ts && npm run test:clinic-bulk-export && npx tsx src/tests/clinicLegalProfile.test.ts && npm run test:data-retention && npm run test:kvkk-lifecycle && npm run test:patient-privacy && npm run test:notice-evidence && npm run test:security-incidents` + `root: npm run test:clinic-bulk-export-selection`
- **Full-suite trigger conditions:** any change to `services/privacy/patientAnonymization.ts` (also run WhatsApp/Meta's set — the cross-module raw-SQL write target, F0-004 §8); any change to `services/channelConsentGate.ts` (also run Messaging's set, §5)

### 2.12 Reports

- **Owned runtime paths:** `routes/reports.ts`, `routes/dashboard.ts`, `routes/organizationDashboard.ts`, `routes/operationalMonitoring.ts`
- **Direct dependencies:** widest cross-domain **read** footprint (67 edges, F0-004 §6) — reads Payments, Appointments, Treatment Cases, Patients, owns zero Prisma models itself. Raw-SQL reads over `Payment`/`Appointment` in `reports.ts`, single-table each, `clinicId`-parameterized (F0-004 §8, `medium` risk, whitelisted period-unit string interpolation not user-controlled).
- **Public contracts:** `/api/reports*`, `/api/dashboard/stats`, `/api/organization*` (dashboard portion), `/api/ops*`
- **Test files:** `dashboard.test.ts` (`test:dashboard`), `organizationDashboard.test.ts` (`test:orgdash`), `operationalMonitoring.test.ts` (`test:ops`), `reportsClinicScope.test.ts` (secondary — primary Auth/Tenant Scope), `overdueInstallments.test.ts`/`overdueReceivables.test.ts` (secondary — primary Appointments/Payments)
- **DB required:** none
- **Mandatory regression set:** `npm run test:dashboard && npm run test:orgdash && npm run test:ops`
- **Full-suite trigger conditions:** none module-specific beyond the standard schema/shared-utility rules (§11) — this module is a pure read-side aggregator with no write path of its own

### 2.13 Platform Admin

- **Owned runtime paths:** `routes/platformAdmin.ts` (**1267 lines/40 routes — second-largest hotspot**), `routes/platformSecurityIncidents.ts` (Privacy-secondary, §2.11), `middleware/platformAuth.ts`, `services/platformAdminAudit.ts`, `services/platformSettings.ts`, `services/backupService.ts`
- **Direct dependencies:** 64 outbound edges spanning Identity, Org/Membership, SMS, Security-Incident, Privacy, Appointments, Patients (F0-004 §7) — confirms no internal sub-module split exists in this file today. Directly writes `ClinicSmsSettings` (SMS-owned) as its designed cross-tenant configuration role (F0-004 §4, accepted).
- **Public contracts:** `/api/platform/*` — **per the frontend survey, this entire contract surface is NOT centralized in `src/services/api.ts`; 7 page files (`src/pages/platform/*.tsx`) call `api.get/post/patch/put/delete('/platform/...')` directly.** A path-prefix-only changed-file rule for this module must therefore key on the URL string, not an `api.ts` service-object name (§3 note).
- **Test files:** `platformAdmin.test.ts` (`test:auth` — **note: chained together with `sessionCookieCsrf.test.ts` under a script literally named `test:auth`, even though this file is Platform-Admin-owned, not Auth-owned; see §8 note 1**, **DB-live**), `platformBackup.test.ts` (no script found — needs external verification, §8 note 5)
- **DB required:** `platformAdmin.test.ts` = yes
- **Mandatory regression set:** `npm run test:auth` (runs both files in the chain — accept the Auth-module overlap per §8 note 1) `&& npx tsx src/tests/platformBackup.test.ts`
- **Full-suite trigger conditions:** none module-specific beyond standard rules; flagged as a hotspot (1267 lines, 40 routes, 5+ admin sub-areas) where a "small" diff is unusually likely to be an undetected multi-area change — recommend treating any diff touching more than ~100 lines of this single file as a soft signal to also run Auth/Tenant Scope and Privacy/KVKK sets, though this is a judgment call, not evidence-derived (flag for external review)

### 2.14 Imaging Device Bridge (out of primary scope — already has dedicated CI)

- **Owned runtime paths:** `routes/imagingBridgePublic.ts`, `services/imaging/bridge*.ts`, `bridge-agent/`, `windows-bridge/`
- **Existing CI:** `.github/workflows/windows-bridge-pr.yml`, triggered on `paths: [windows-bridge/**, server/src/services/imaging/**, server/src/routes/imaging*.ts, server/src/tests/imaging*.ts, src/components/imaging/**]` — already runs `test:imaging`, `test:imaging-bridge-pairing`, `test:imaging-bridge-onboarding`, `test:imaging-bridge-update`, `test:dicom-helpers`, `test:onboarding-helpers`, `test:pairing-poller`, all 4 `dotnet test` projects, all 4 installer PowerShell scripts, plus root `npm run build` and server `npm run typecheck`.
- **This design does not change this workflow.** It is cited as the one existing precedent for path-based test selection in this repository (strategy doc §3) and cross-referenced so a future implementer does not duplicate its trigger for module 5 (Dental Chart)'s `imaging.test.ts`, which is Server/Viewer-side and already covered here too — an intentional, accepted overlap, not a bug.

---

## 3. Changed-file → module path-prefix mapping

Longest-prefix-match, evaluated top to bottom (first specific match wins; a file matching only a broader rule falls through):

| Path prefix | Module |
|---|---|
| `server/src/routes/auth.ts`, `clinicRegistration.ts`, `users.ts`, `usersImport.ts`, `organizationBranches.ts` | Auth / Tenant Scope |
| `server/src/middleware/**` | Auth / Tenant Scope (+ full-suite trigger, §11 rule 2) |
| `server/src/utils/clinicScope.ts`, `utils/roles.ts` | Auth / Tenant Scope (+ full-suite trigger) |
| `server/src/routes/patients.ts`, `patientsImport.ts`, `attachments.ts`, `tasks.ts` | Patients |
| `server/src/routes/appointments.ts`, `schedules.ts`, `services.ts`, `noShows.ts` | Appointments |
| `server/src/routes/appointmentRequests.ts`, `contactRequests.ts`, `publicBooking.ts` | Appointment Requests |
| `server/src/services/appointmentRequestSafety.ts` | Appointment Requests (+ escalate to Appointments) |
| `server/src/routes/dentalChart.ts`, `treatmentPlanProcedures.ts`, `treatmentCases.ts`, `treatmentPackages.ts`, `laboratories.ts`, `labOrders.ts`, `imaging.ts` | Dental Chart |
| `server/src/services/treatmentStockDeduction.ts` | Dental Chart (+ escalate to Inventory) |
| `server/src/services/imaging/**` (non-bridge-public files) | Dental Chart |
| `server/src/routes/imagingBridgePublic.ts`, `bridge-agent/**`, `windows-bridge/**` | Module 14 (already CI'd — no change) |
| `server/src/routes/payments.ts`, `paymentPlans.ts`, `financeDashboard.ts`, `compensationRules.ts`, `practitionerEarnings.ts`, `practitionerPayouts.ts` | Payments |
| `server/src/routes/inventory.ts` | Inventory (+ automatic full-suite trigger, §2.7) |
| `server/src/routes/insuranceProvisions.ts` | Insurance (+ automatic full-suite trigger, §2.8) |
| `server/src/routes/messages.ts`, `sms.ts`, `recall.ts`, `postTreatment.ts`, `communicationPreferences.ts`, `notifications.ts` | Messaging |
| `server/src/services/sms/**`, `communicationConsent/**`, `channelConsentGate.ts` | Messaging (channelConsentGate.ts also escalates to Privacy/KVKK) |
| `server/src/routes/whatsapp.ts`, `whatsappInbox.ts`, `metaWhatsAppWebhook.ts`, `organizationWhatsApp.ts`, `instagramInbox.ts`, `instagramWebhook.ts`, `organizationInstagram.ts` | WhatsApp / Meta (4 files listed in §5 also trigger cross-module escalation) |
| `server/src/services/whatsapp/**`, `services/instagram/**`, `services/whatsapp*.ts` (flat files) | WhatsApp / Meta |
| `server/src/routes/patientPrivacy.ts`, `gdprExport.ts`, `clinicBulkExport.ts`, `publicClinicKvkk.ts`, `clinicLegalProfile.ts`, `platformSecurityIncidents.ts` | Privacy / KVKK |
| `server/src/services/privacy/**`, `services/security/**` | Privacy / KVKK |
| `server/src/routes/reports.ts`, `dashboard.ts`, `organizationDashboard.ts`, `operationalMonitoring.ts` | Reports |
| `server/src/routes/platformAdmin.ts` | Platform Admin |
| `server/src/middleware/platformAuth.ts`, `services/platformAdminAudit.ts`, `services/platformSettings.ts`, `services/backupService.ts` | Platform Admin |
| `src/pages/platform/**` | Platform Admin (frontend — no `api.ts` service object exists, §2.13 note) |
| `server/prisma/schema.prisma`, `server/prisma/migrations/**` | **full-suite fallback (§11 rule 3)** |
| `server/package.json`, `package.json` (root) `scripts` block | **full-suite fallback (§11 rule 4)** |
| `server/src/db.ts`, `server/src/index.ts` | **full-suite fallback (§11 rule 2)** |
| anything else under `server/src/**`, `src/**` not matched above | **full-suite fallback (§11 rule 1 — unmapped file)** |

Frontend (`src/`) files map to the same module as the backend route(s) their nearest domain folder/page corresponds to, per the frontend survey's domain grouping (`src/pages/`, `src/components/` subfolders) — not exhaustively re-tabulated here since the survey found `src/services/api.ts` is a single shared client with no per-module file split on the frontend (a `src/services/api.ts` change itself is therefore a **full-suite trigger**, §11 rule 1 equivalent — it is the frontend's own fan-in≥10 file).

---

## 4. Module → test-command mapping

Consolidated from §2 — see each module's "Mandatory regression set" line. No new command is introduced anywhere in this table; every command already exists in `server/package.json`, root `package.json`, or is a direct `npx tsx`/existing test file invocation already used elsewhere in the repo's own documentation (F0-005).

---

## 5. High-risk escalation rules

| Trigger file(s) | Also run (beyond the file's own module) | Evidence |
|---|---|---|
| `routes/whatsapp.ts`, `routes/whatsappInbox.ts`, `services/whatsapp/metaWhatsAppAiProcessor.ts`, `services/instagram/instagramAiConversationProcessor.ts` | Patients + Appointments + Appointment Requests | F0-004 §3, 9 high-risk `Patient`/`Appointment` direct-write edges |
| `routes/users.ts` (writes `DoctorAvailability`/`DoctorOffDay`) | Appointments | F0-004 §5.1 cycle 1 |
| `services/channelConsentGate.ts` | Privacy/KVKK ↔ Messaging (both directions) | F0-004 §5.1 cycle 2 |
| `services/treatmentStockDeduction.ts`, `routes/treatmentCases.ts`, `routes/treatmentPackages.ts` | Inventory ↔ Dental Chart (both directions) | F0-004 §5.1 cycle 3 |
| `routes/imaging.ts`, `routes/imagingBridgePublic.ts` | Dental Chart ↔ Module 14 (both directions; module 14's own CI already runs on this, no new CI action needed) | F0-004 §5.1 cycle 4 |
| `services/privacy/patientAnonymization.ts` | WhatsApp/Meta + Privacy/KVKK | F0-004 §8, direct raw-SQL cross-module write |
| `jobs/reminders.ts` | WhatsApp/Meta (writes `SentMessage`) | F0-004 §7 |

---

## 6. Cross-module contract-test rules

No dedicated contract test exists for any of F0-004's 15 `CC-*` candidates (confirmed by grep — no file name or content references `CC-0\d` or a `contracts/` directory). Per the strategy doc §9, this design's only available cross-module contract check today is "also run the neighboring module's mandatory regression set," already folded into §5's escalation table. This table exists to make that gap explicit and traceable to F0-004's own candidate list, not to claim a stronger guarantee than exists:

| Contract candidate (F0-004 §10) | Modules it would connect | Current substitute (this design) |
|---|---|---|
| CC-01/CC-02 PatientDirectory / Patient command | Patients ↔ WhatsApp/Meta | §5 escalation row 1 |
| CC-03/CC-04 AppointmentReferenceQuery / booking command | Appointments, Appointment Requests ↔ WhatsApp/Meta | §5 escalation row 1 |
| CC-09 PatientAnonymized event | Privacy/KVKK → WhatsApp/Meta | §5 escalation row 5 |
| CC-10 Inventory stock-adjustment command | Dental Chart ↔ Inventory | §5 escalation row 3 |
| CC-11 Messaging send command | Messaging ↔ WhatsApp/Meta | §5 escalation row 6 |
| CC-12 Consent/Privacy evidence service | Privacy/KVKK ↔ Messaging | §5 escalation row 2 (already exists informally as `channelConsentGate.ts`) |
| CC-05/06/07/08/13/14/15 | (no current proven edge to substitute for, or F2/F6+/F8+ scoped per F0-004) | none — not applicable today |

---

## 7. Test files added since F0-005's baseline (`7fcf2f8` → `3b4ec9d`) — full disposition

**This is a local reconciliation performed by this task for this design's own purposes — it is not an authoritative update to F0-005's committed evidence.** F0-005's original classification used 5 parallel read-only agents against a defined methodology (evidence doc §1); this task placed the 20 files below with a single-pass header/import read, a lighter-weight process. Treat the placements below as a first-pass working assumption, not a re-verified F0-005 finding. All 20 placed above; consolidated list for traceability:

| File | Module (primary) | DB required |
|---|---|---|
| `appointmentRequestRecordScope.test.ts` | Auth / Tenant Scope | no |
| `communicationConsentAuditReport.test.ts` | Messaging | yes |
| `communicationPreferenceReconciliationReport.test.ts` | Messaging | yes |
| `communicationPreferencesRoute.test.ts` | Messaging | yes |
| `dbVerification/kvkkHigh006DbClinicScopeAccess.test.ts` | Auth / Tenant Scope | yes |
| `dbVerification/kvkkHigh006DbInputHandling.test.ts` | Auth / Tenant Scope | yes |
| `dbVerification/kvkkHigh006DbInsuranceListBehavior.test.ts` | Insurance | yes |
| `dbVerification/kvkkHigh006DbPlanLimitsQuota.test.ts` | Auth / Tenant Scope | yes |
| `dbVerification/kvkkHigh006DbRecordOwnedMutationScope.test.ts` | Auth / Tenant Scope | yes |
| `dbVerification/kvkkHigh006DbTargetClinicCreation.test.ts` | Auth / Tenant Scope | yes |
| `dentalChartClinicScope.test.ts` | Auth / Tenant Scope | no |
| `kvkkHigh006Batch2ClinicScope.test.ts` | Auth / Tenant Scope | no |
| `kvkkHigh006Batch3ClinicScope.test.ts` | Auth / Tenant Scope | no |
| `legacyConsentCorrection.test.ts` | Messaging | yes |
| `legacyReconciliationResolver.test.ts` | Messaging | yes |
| `messagesConsentGate.test.ts` | Messaging | yes |
| `messagesRecordScope.test.ts` | Auth / Tenant Scope | no |
| `planLimitsTargetClinicFix.test.ts` | Auth / Tenant Scope | no |
| `recallConsentGate.test.ts` | Messaging | yes |
| `reportsClinicScope.test.ts` | Auth / Tenant Scope | no |

---

## 8. Notes and open items

1. **`test:auth` (server npm script) chains `sessionCookieCsrf.test.ts` (Auth-owned) and `platformAdmin.test.ts` (Platform-Admin-owned) into one script.** A future affected-test-selection implementation invoking `npm run test:auth` for an Auth-only change will also run Platform Admin's test, and vice versa — a small, accepted over-trigger (extra coverage, not missing coverage), left as-is because splitting the script is a `package.json` change this design-only task must not make.
2. **Inventory and Insurance have no dedicated test file each** — both modules' entire coverage is one shared characterization test (`kvkkHigh006Batch2ClinicScope.test.ts`) plus, for Insurance only, one DB-verification file. This is a genuine, pre-existing coverage gap this task did not create and is not in scope to fix; it is the reason both modules' full-suite-trigger condition (§2.7/§2.8) is "any change at all," not a targeted set.
3. **Messaging has 11 DB-required test files — the largest DB-dependent surface of any module**, discovered by this task's own import-level check (all 11 `import prisma from '../db.js'` directly), beyond F0-005's original count which only flagged 4 DB-required files repo-wide. A future CI implementation that provisions disposable Postgres (strategy doc §15 item 3) will unblock most of this module's currently-unverifiable-in-CI test coverage.
4. **WhatsApp/Meta — the module with the highest real-world write risk (F0-004's 9 high-risk edges) — has zero DB-required tests, and this remains an open, unresolved gap**, i.e. its entire regression set runs against in-process fakes, never against a real Prisma call site. F0-004 §7 already names this: three of the domain's own test files' header comments self-document that they deliberately don't exercise the real write paths. This is flagged as a coverage-quality risk distinct from a coverage-quantity gap — targeted-test-selection cannot compensate for a test suite that doesn't exercise the code path it claims to protect. Closing it is out of this task's scope (design only, no test authored).
5. **`platformBackup.test.ts` has no `package.json` script mapping found by this task's search** (neither individual nor part of an aggregate) — flagged for external verification before this matrix is relied upon, since a missing script here would mean the module's already-thin second test file is entirely unreachable outside a manual `npx tsx` invocation, same as `patientSharedPhone.test.ts`/`treatmentPackagePermissions.test.ts`/etc.

# Patient Field Gap & Secure Identity Decision Package

**Tasks:** `F3-DATA-MIG-001` (source inventory) · `F3-DATA-MIG-002` (source→NoraMedi mapping) ·
`F3-DATA-MIG-003` (national identifier secure data model)

**Phase:** Parallel Product & Operations → Clinic Data Migration. **This document does not authorize
F5, does not alter the F4 recovery lifecycle, and changes no program state.**

**Companion to** [CLINIC_DATA_MIGRATION_CONTRACT.md](CLINIC_DATA_MIGRATION_CONTRACT.md) (merged
PR #442). That document remains the accepted historical evidence base and is **not overwritten**.
This one extends it with per-column mapping completeness, a secure identity architecture, and a
ranked gap package. Where the two disagree, §2 below records the correction and the repo evidence
that forces it.

---

## 0. Governance boundary — READ FIRST

```text
IMPLEMENTATION_PERFORMED        = NONE / DOCS ONLY
SCHEMA_CHANGE_RECOMMENDED       = YES
SCHEMA_CHANGE_AUTHORIZED        = NO  (NOT_AUTHORIZED_YET)
MIGRATION_CREATED               = NO
MIGRATION_TESTED                = NO
PRODUCTION_MIGRATION            = NO
```

No application, schema, migration, parser, route, permission, UI or test code was changed by this
task. Every recommendation below is a **proposal for program-owner architecture review**, per
[NORAMEDI_MASTER_TRACKER.md](NORAMEDI_MASTER_TRACKER.md) §2.3 (no agent may self-approve) and
[KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md](KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md) §4 — *"Design work
being allowed does not authorize implementation."*

**Program state is unchanged and re-verified:** `F4 COMPLETE` **NO** ·
`FIRST_CUSTOMER_RECOVERY_GATE` **NOT_SATISFIED** · `F5 AUTHORIZED` **NO** ·
`R-030` / `R-030-DB` / `R-030-FILES` **OPEN** · `repo2` **NOT ACTIVATED**.

**The existing basic clinic patient import remains `RETAINED / OUT_OF_SCOPE / UNCHANGED`.**
`server/src/routes/patientsImport.ts`, `src/components/PatientImportModal.tsx`,
`src/pages/Patients.tsx` and `src/utils/permissions.ts` were **inspected as evidence only**. No
change is made or recommended to them by this document. One pre-existing defect found inside that
boundary is reported in §2 (D-2) **for a separate future task**, not for repair here.

---

## 1. Baseline

| Property | Value |
| --- | --- |
| Branch | `docs/f3-data-mig-001-002-003-field-gap-identity-contract` |
| Base | `origin/main` @ `c67f6ebdec49b991aaf49e7b26b6b40cf2683d8f` (merge of PR #442) |
| Working tree at start | clean |
| Evidence sources | `server/prisma/schema.prisma` (3,697 lines, 105 models) · `server/src/schemas/index.ts` · `server/src/routes/patients.ts` · `server/src/utils/encryption.ts` · `scripts/log-privacy-guard/` · `docs/program/`, `docs/compliance/`, `docs/vendor/` · ClickUp tasks `F3-DATA-MIG-001…013`, `US-01.8` |
| Real workbook | **not re-opened by this task.** All figures are aggregates restated from the merged contract §3. `REAL_XLS_DATA_COMMITTED_TO_GIT = NO`, `RAW_PII_IN_LOGS = 0` |

---

## 2. Corrections to the merged contract

Each correction is forced by repository evidence, verified at the cited line. The merged document's
historical record stands; these are amendments, not deletions.

| # | Merged contract | Verified repo truth | Severity |
| --- | --- | --- | --- |
| **C-1** | §3 header: *"The 91 source columns"*; structure table *"91 named columns"*, dimensions `columns 0 … 91` | **The enumerated list contains exactly 90 unique names** (programmatically extracted from `:271-286`; 90 tokens, 90 unique, zero duplicates). Under the BIFF8 exclusive-end `DIMENSIONS` convention — the same convention that makes `rows 0 … 14890` mean 1 header + 14,890 data rows — `columns 0 … 91` means **91 columns**. **One column name is missing from the transcription.** | **HIGH — contract defect.** No mapping profile can be certified complete until `F3-DATA-MIG-001` re-emits the verbatim header row |
| **C-2** | §7: `ADRES_KODU` → `Patient.postalCode`, *"IMPORT if it is a postal code — VERIFY FIRST"* | `Patient.postalCode` **exists** (`schema.prisma:232`) — the field claim is correct. But `ADRES_KODU` in Turkish PMS exports is commonly the **UAVT national address code (10 digits)**, not a 5-digit `posta kodu`. The "VERIFY FIRST" was never resolved | **HIGH — silent corruption risk.** Downgraded to `MANUAL_REVIEW` pending a digit-length histogram |
| **C-3** | §7: `ULKE`/`UYRUK` → *"IGNORE — 0 % fill"* | `Patient.country` **exists** (`schema.prisma:233`). `IGNORE` is the wrong disposition for a **valid mapping that simply carries zero rows for this customer** — recording it as IGNORE means the next customer's country data silently drops. `ULKE` → `IMPORT_DIRECT` (0 rows carried); `UYRUK` → `BLOCKED_NO_DESTINATION` (no `nationality` field) | MEDIUM |
| **C-4** | §7: `SOSYAL_GUVENCE_NO`, `VERGINO`, `ENABIZTAKIPNO`, `YUPASS_NO`, `HTS_KODU` → **IGNORE** | These are government/health identifiers with real product need (SGK billing, e-Nabız, health tourism). *No destination* ≠ *unwanted*. Reclassified `BLOCKED_NO_DESTINATION` | MEDIUM |
| **C-5** | §7: `EVTELEFONU`, `ISTELEFONU` → **IGNORE** | `Patient` has exactly **one** phone field (`schema.prisma:228`). Secondary phones are patient contact data with no destination → `BLOCKED_NO_DESTINATION`. **They must never be written to `PatientEmergencyContact.phone`** (`:328`) — synthesising an emergency contact from a home phone fabricates a legal-decision-maker record | MEDIUM |
| **C-6** | §7: `DOSYANO`, `REHBER_ID`, `HASTARENGI`, `RESIMUZANTI`, … → *"IGNORE — vendor-internal"* | **`DOSYANO` (chart/file number) is clinic-facing, not vendor-internal** — it is the number reception staff quote and that is written on every paper chart. Dropping it makes the clinic's physical archive unresolvable post-migration. Reclassified `BLOCKED_NO_DESTINATION` | **HIGH — operational** |
| **C-7** | §7: `KANGURUBU, ONEMLINOT, UZUNNOT, KONTROLNOTU` → *"DEFER … Empty in this file"* | Only `UZUNNOT` is measured 0 % and `KANGURUBU` at 1 row. **`ONEMLINOT` and `KONTROLNOTU` fill rates were never measured** — "empty in this file" is unsupported for them, and they are the two most likely to hold KVKK Art. 6 clinical free text. Reclassified `BLOCKED_LEGAL_DECISION`, fill `UNKNOWN` | **HIGH — unsupported claim** |
| **C-8** | §7: `HASTADOKTOR` → *"MAP — not needed for patient-only import"* | Correct, but incomplete. **`Patient` has no practitioner field of any kind** (`schema.prisma:221-293` — relations only, no `primaryPractitionerId`). Even a fully resolved `User.id` has nowhere to land. Two gaps, not one | MEDIUM |
| **C-9** | §7: *"of 91 source columns, ~11 map into NoraMedi's current patient model"* | Recomputed: **10 columns land unconditionally** in **9 distinct `Patient` fields** (`MAHALLE` + `ADRESI` compose into `address`), **+3 gated on a legal decision**, **+1 gated on profiling**. Directionally right, composition wrong | LOW |
| **C-10** | §7 dispositions ~30 of 91 columns, most in groups | **61 columns had no individual disposition.** All 91 are individually dispositioned in §5 | — |
| **D-1** | §4.1 G-6: *"6 competing phone implementations"* | **8 production `normalizePhone*` implementations**, not 6. The two missed: `services/whatsappWebhookPayload.ts:29` and `services/whatsappPublicApi.ts:8` (the latter wired into two zod transforms). Plus **4 `getPhoneVariants` copies, one behaviourally different** — only `routes/whatsapp.ts:227-254` has foreign-number branches (11-digit and 12-digit non-TR), and it is a **route-local private const, not exported** | MEDIUM — G-6 is larger than recorded |
| **D-2** | *(not recorded)* | **The existing basic importer accepts, documents and validates a `gender` column, then silently discards it.** Template header `gender (male/female/other)` (`utils/excelImport.ts:55`), user-facing instructions (`:100`), validator `VALID_GENDERS` (`patientsImport.ts:104`, `:174`), carried into preview (`:208`) — and **absent from `prisma.patient.create`** (`:335-348`). Clinics are told their gender data imported; it does not. Same root cause as G-2/`CINSIYET` | **HIGH — silent data loss.** Pre-existing, **inside the out-of-scope basic importer (§1 of the merged contract). Reported only; not changed, and no change recommended here.** Belongs to a separate future task |
| **D-3** | §19 K-2: *"the legacy vendor's identity … unknown"* | **Strong candidate identified: DigiDentiS.** `docs/vendor/digidentis/DigiDentiS_Takvim_API_Documentation_v3.2.html` is in the repo, NoraMedi already integrates its calendar API (`server/src/services/externalCalendar/digidentis/`), and its patient contract names `patient_tc_no` (string, 11), `patient_passport_no` (string, 20), `patient_nationality` (integer, default Turkey `213`), `patient_mobile_cc` (string, default `+90`), `patient_gender` (integer, Male `1` / Female `2` / Default `0`) — the exact identity/demographic set the workbook carries. **Not proof the workbook came from DigiDentiS**, but it converts K-2 from "unknown" to "one documented, testable hypothesis" | MEDIUM — materially narrows K-1/K-2 |
| **D-4** | §7 *"Fields the migration must NOT set"* | Correct and retained. Adding: `Patient` has **no unique constraint of any kind** — only `@@index([clinicId, phone])` and `@@index([clinicId, email])` (`schema.prisma:291-292`), confirmed against the baseline DDL and all 75 migrations. There is therefore no database-level protection against duplicate patients today, by any key | Context |
| **D-5** | §7: *"Do **not** write `deletedAt`"* | Correct — and stronger than stated. **`Patient.deletedAt` is a phantom column: it is declared (`schema.prisma:254`), filtered on in ~15 places, and written by nothing.** A repo-wide search for `deletedAt: new Date()` in `server/src` returns two hits, both non-Patient (`routes/laboratories.ts:101`, `routes/labOrders.ts:304`). Every patient "soft delete" is `patientStatus='archived'` | Context — reinforces the rule |
| **D-6** | *(not recorded)* | **Patient search is not accent-insensitive.** `routes/patients.ts:68-75` uses `contains` + `mode:'insensitive'` (Postgres `ILIKE`), and there is **no `unaccent`, no `citext`, no `pg_trgm` and no custom `COLLATE` in any of the 75 migrations**. So `Şahin` ≠ `Sahin`, `Öztürk` ≠ `Ozturk`. `ILIKE '%…%'` also cannot use either B-tree index, so search is a sequential scan under clinic scope | **HIGH for a Turkish legacy dataset** — post-migration staff search will miss patients whose names were typed with different diacritics. Affects verification and duplicate review, not the write path |
| **D-7** | *(not recorded)* | **`Patient.primaryClinicId` is set only by a one-off script** (`server/src/scripts/migrate-to-multibranch.ts:139-140`). No runtime create path sets it — not `patients.ts:288`, not `patientsImport.ts:335`, not the WhatsApp/Instagram paths. But `services/patientOrganizationMetrics.ts:46,49` counts **by `primaryClinicId`** | **HIGH — migration-relevant.** All 14,890 imported patients would be **invisible to the organization dashboard's patient counts**. The migration must decide explicitly whether to set `primaryClinicId`; the reconciliation report must not use that dashboard as a baseline |
| **D-8** | *(not recorded)* | **Three incompatible `source` vocabularies coexist.** The zod write enum (`schemas/index.ts:35`) omits `whatsapp` and `meta_whatsapp`, which runtime code already writes (`routes/whatsapp.ts:1369`, `metaWhatsAppAiProcessor.ts:762`); the importer uses a fourth list including `online` (`patientsImport.ts:105`). A `PUT` on a WhatsApp-originated patient returns **400** | MEDIUM — pre-existing. **Consequence for migration: it must write only values inside the zod enum, or it creates rows the API cannot subsequently update** |
| **D-9** | *(not recorded)* | **`Patient.notes` has no UI control.** `PatientForm.tsx` holds it in state but renders no input; it is displayed read-only on the detail page as "Clinical Alerts". Its only writer is the Excel importer. `postalCode` and `country` have **no writer anywhere in the product** | **Decisive for §11.** Clinical notes imported into `Patient.notes` could **not be edited or removed by clinic staff through any UI** |

---

## 3. Source dataset inventory (F3-DATA-MIG-001)

### 3.1 What exists vs what a full migration needs

Of **20 datasets** a full clinic migration touches, **1 exists**.

| # | Dataset | Destination model | Exists? | Evidence | First-customer blocker |
| --- | --- | --- | --- | --- | --- |
| D-1 | **Patient master data** | `Patient` (`schema.prisma:221-317`) | **YES** — 14,890 rows | the workbook | **YES** — the entire in-scope deliverable |
| D-2 | Practitioner master | `User` (`:114-186`) | **NO** — 25 opaque labels | `HASTADOKTOR`, 25 distinct | YES for clinical lanes (`Appointment.practitionerId` is non-nullable, `:519`); **NO** for patient-only |
| D-3 | Service / procedure catalogue | `AppointmentType` (`:484-511`) | **NO** | absent; implied by `UCRETTARIFESI`/`KURUMTARIFE` | YES for clinical (`Appointment.appointmentTypeId` non-nullable, `:521`) |
| D-4 | Appointment history | `Appointment` (`:513-562`) | **NO** | only `SONRANDEVUTARIHI` summary | NO for v1 |
| D-5 | Treatment cases | `TreatmentCase` (`:675-714`) | **NO** | `TEDAVIDURUMU` 3/14,890 | NO for v1. Extra blocker: `treatmentCaseSchema` exposes no `createdAt`/`closedAt` — the API **structurally cannot backdate a case** |
| D-6 | Procedure history | `TreatmentPlanProcedure` (`:1454-1495`) | **NO** | no procedure-level column | NO for v1. Highest side-effect surface (WhatsApp scheduled off `Date.now()`; inventory decrement in-transaction) |
| D-7 | **Dental chart / odontogram** | `ToothRecord` (`:1191-1207`) | **UNKNOWN** | **not listed in merged §5's expected-dataset table at all** | NO for v1 — **but must be added to the K-1 request.** A dental migration without the odontogram is clinically incomplete |
| D-8 | Payment movements | `Payment` (`:900-925`) | **NO** | `RISK_TUTARI` 2/14,890 | NO for v1. Compounded by U-4/U-5 |
| D-9 | **Payment plans / installments** | `PaymentPlan`, `PaymentPlanInstallment` (`:1209-1253`) | **UNKNOWN** | implied by `ODEMESONTARIHI` + `CARIODEMESTATU`; **not listed in merged §5** | NO — add to K-1 |
| D-10 | **Invoices / e-Fatura** | **NONE — no invoice model exists.** `grep -i "invoice\|fatura\|tariff\|tarife"` over `schema.prisma` → **zero matches** | UNKNOWN | source carries `VERGIDAIRESI`, `VERGINO`, `HESAP_KODU`, `UST_HESAP_KODU` — a chart-of-accounts hierarchy | NO — but **invoice history is unmigratable by construction, not merely unscheduled.** New open decision |
| D-11 | Practitioner compensation | `PractitionerEarning`, `PractitionerPayout` (`:1254-1351`) | UNKNOWN | — | NO. Earnings are **not a trustworthy reconciliation baseline** (U-4) |
| D-12 | Inventory / stock | `InventoryItem`, … (`:1352-1453`) | UNKNOWN | — | NO. **Ordering constraint:** if D-6 is ever imported through an application path it decrements stock, so opening balances load **after** — or the deduction path is suppressed (G-8: no suppression flag exists) |
| D-13 | **Documents / attachments** | `PatientAttachment` (`:1162-1189`) | **YES, implied** | `RESIMUZANTI` + `DOSYAVAR` are pointers to files **outside the spreadsheet** | NO for v1 — **URGENT to request.** An unsized binary corpus, with `R-030-FILES` `OPEN` and the recovery gate `NOT_SATISFIED`. Most likely to break the schedule |
| D-14 | **Imaging** | `ImagingStudy`, `ImagingImage` (`:2813-2994`) | **YES, implied** | `SONGORUNTUTARIHI` proves an imaging subsystem | NO for v1. Note `ImagingStudy.source` already accepts `'import'` (`:2830`) — a genuine reuse opportunity |
| D-15 | Clinical notes | `PatientMedicalHistory` (`:372-425`), `Patient.notes` | PARTIAL — carriers present, content mostly absent | `ONEMLINOT`/`KONTROLNOTU` **unmeasured**; `UZUNNOT` 0 % | NO on volume; **YES on the legal gate** |
| D-16 | Insurance provisions | `InsuranceProvision` (`:841-870`) | NO (transactions) | patient-level attributes only | NO. Blocked twice: needs D-2 for the non-nullable `createdById` (`:864`), and a source export that does not exist |
| D-17 | **Tariff / fee schedules** | **NONE — no price-list model.** `AppointmentType.basePrice` is the only price carrier | UNKNOWN | `UCRETTARIFESI`, `KURUMTARIFE` are assignments *into* a vendor price list | NO — but architecturally significant: NoraMedi models **one price per service per clinic**; the source models **per-patient/per-institution tariff selection**. A model mismatch, not a mapping gap |
| D-18 | Lab work orders | `LabWorkOrder`, … (`:2632-2761`) | UNKNOWN | no implying column | NO — add to K-1 for completeness |
| D-19 | Communication history | `SentMessage`, `SmsMessage`, … | **NO** | only send-summary flags | NO — **and should be explicitly declined.** `PatientCommunicationConsentEvent` is append-only and service-owned; a migration must never write it directly |
| D-20 | Consent evidence | `PatientCommunicationPreference` (`:2314-2375`) | **NO** | `KVKKONAYKODU` 0 %, `KVKKSMS` 0 % | NO for import — **YES commercially.** See §9 |

**Consequence.** The honest ceiling remains patient master data. Merged §19 item 7 (request the
remaining vendor exports) is the **highest-leverage open action in the program** — nothing beyond
patient master data can be *designed*, let alone built, until those files arrive. This document adds
four datasets to that request that merged §5 omits: **D-7 odontogram, D-9 payment plans, D-13/D-14
the binary corpora, D-18 lab orders**.

### 3.2 A condition that must be attached to the export request

**Only `HASTA_ID` joins.** It is 100 % populated and 14,890/14,890 unique; phone and name are
empirically disproven as keys (28.6 % and 25.7 % collision rates). Every dependent export must
therefore be validated to **carry `HASTA_ID`** before it is accepted. If the vendor's appointment
export keys on `DOSYANO` or an internal row id instead, that export is unusable and must be
re-requested. **Make "must carry `HASTA_ID`" an explicit condition of the request**, not a discovery
made after the files arrive.

### 3.3 Columns whose meaning requires customer confirmation

Merged §7 assigns several of these to a blanket *"IGNORE — vendor-internal"* **without having
established what they are**. That is disposition-by-assumption; this list closes it.

| # | Column | Why ambiguous | What turns on the answer |
| --- | --- | --- | --- |
| 1 | `AILEGURUBU` | "Family group" — household key or marketing segment? **Never profiled** | **Highest value.** A real household key would explain the 4,261 shared-phone rows and let dry-run separate legitimate family sharing from data-entry collision — directly improving the mandatory shared-phone impact report |
| 2 | `ADRES_KODU` | 5-digit postal code or 10-digit UAVT address code? | Decides `Patient.postalCode`. Wrong answer silently corrupts a typed field (C-2) |
| 3 | `DOSYAVAR` | Physical folder flag or digital-attachment flag? | If digital, it **sizes the attachment corpus (D-13) from the workbook alone** — the fastest available estimate of the binary problem |
| 4 | `RESIMUZANTI` | Stores only an extension ⇒ images live elsewhere under a naming convention (probably keyed on `HASTA_ID`) | Whether patient photos are recoverable at all |
| 5 | `KVKKILKKODU` | 4,633 distinct over 4,754 rows — a record id in *another register*, not a flag | K-4. If it references a consent-form archive, that archive is requestable and could be genuine `evidenceType` — the only route to a `granted` state |
| 6 | `REHBER_ID` | Guide / directory / agency id | If a health-tourism agency FK, it has commercial meaning and implies an unrequested table |
| 7 | `HTS_KODU` | Acronym unexpanded | If health-tracking-system, it is health-linked and must be re-classed SPECIAL |
| 8 | `YUPASS_NO` | Foreign-national pass, issuer unclear | Whether it joins the identity-encryption decision |
| 9 | `CALISMAGURUBU` | Employer, corporate account, or internal work queue? | If corporate, implies an unrequested corporate-customer export |
| 10 | `KURUMREFERANSI` | Institutional referrer — free text or FK? | As #9 |
| 11 | `CHECKBOX` | Unlabelled boolean | Unknowable from data. **An unlabelled flag that turns out to be a legal or clinical marker and was silently dropped is a defect discovered after go-live** |
| 12 | `REFERANSI` | Free-text referrer that may name **another person** | ⚠ Third-party PII. Its natural destination `Patient.source` is enum-constrained and is treated as PII by no privacy tooling |
| 13 | `UNVANI` | Honorific (Bay/Bayan) or professional title (Dr./Av.)? | Honorific is redundant with `CINSIYET`; a title is real PII |
| 14 | `SOSYAL_GUVENCE_KURUMU` | Payer institution — free text or coded? | Whether D-16 is normalizable |

---

## 4. Current NoraMedi Patient capability — verified

### 4.1 The model

`Patient` (`schema.prisma:221-317`) — complete scalar surface:

```
id · clinicId · firstName · lastName · email? · phone? · dateOfBirth? · address? · city?
postalCode? · country? · patientStatus(="new") · source? · notes? · communicationConsent(=false)
marketingConsent(=false) · smsOptOut(=false) · smsOptOutAt? · organizationId · primaryClinicId?
isAnonymized(=false) · anonymizedAt? · anonymizedById? · anonymizationReason?
createdAt · updatedAt · deletedAt?
```

**Indexes:** `@@index([clinicId, phone])`, `@@index([clinicId, email])` (`:291-292`).
**Unique constraints: none.**

**Confirmed absent** — repo-wide search of `schema.prisma` for
`tcNo|tcKimlik|identityNumber|nationalId|national_id|passport|gender|cinsiyet|nationality|uyruk`
returns **zero matches**. There is no identity number, no gender, no nationality, and no district
field anywhere in the schema.

### 4.2 Validation

`patientBaseSchema` (`server/src/schemas/index.ts:24-38`) accepts exactly: `firstName` `min(1)`,
`lastName` `min(1)`, `email` (`''`→null, `.email()`), `phone` (free), `dateOfBirth`
(**refined: not in the future**), `address`, `city`, `postalCode`, `country`, `patientStatus`
(enum `new|active|inactive|archived`), `source` (**enum** `google|referral|social_media|instagram|
website|phone|walk_in|doctolib|other`), `notes`, `communicationConsent`, `marketingConsent`.
`patientSchema = patientBaseSchema`; `patientUpdateSchema = .partial()`.

**Consequence for mapping:** `REFERANSI` (free-text referrer) **cannot** be coerced into
`Patient.source` — it would destroy the referrer identity and pollute a typed marketing enum.

### 4.3 The finding that decides the identity model

**`GET /api/patients/:id` uses `include:` with no top-level `select:`** (`routes/patients.ts:167-191`)
and responds with a full spread — `res.json({ ...patient, treatmentCases…, toothRecords, … })`
(`:273`). `POST /api/patients` returns the whole record (`:296`), as does the update path.

> **Any new scalar column added to `Patient` is returned to every authorized clinic role's browser
> with zero code change.** For an encrypted identity value that means shipping ciphertext to the
> client; for a lookup hash it means shipping a **stable cross-tenant patient correlator**.
>
> A child-model relation is returned **only when explicitly `include`d** — and it would not be.
> This makes a separate model safe *by construction* rather than safe *by remembering to refactor
> the hottest patient route*.

### 4.4 Field-list touchpoints — the blast radius of any new `Patient` scalar

Every location holding a hard-coded list of Patient fields, each of which must be updated when a
field is added:

| Touchpoint | Location | Shape | Failure mode if forgotten |
| --- | --- | --- | --- |
| Patient detail / create / update responses | `routes/patients.ts:167-191`, `:273`, `:296`, `:337` | **whole-record spread** | **Auto-leaks** |
| Anonymization payload | `services/privacy/patientAnonymization.ts:283-303` | **deny-list**, hand-enumerated | **Silently retains the value forever** |
| KVKK subject-access export | `routes/patientPrivacy.ts:118-138` | allow-list, **19 of 27 fields** | Silently **missing** from the export — an Art. 11 completeness gap |
| Clinic bulk export | `services/privacy/clinicBulkExportFieldAllowlists.ts:49-72` (`satisfies Prisma.PatientSelect`) | allow-list, 21 fields | Missing from export |
| **`patientListSelect`** | `utils/prismaSelects.ts:38-46` (11 fields) | allow-list | List response **and the `BILLING` privacy boundary** — adding a field here makes it BILLING-visible. Guarded by `tests/billingPatientAccess.test.ts:54-61` |
| **`patientContactSelect`** | `utils/prismaSelects.ts:30-36` | allow-list | **18 call sites** across reminders, appointments, messages, payments, SMS, inbox |
| Write validation | `server/src/schemas/index.ts:24-38` | allow-list | Field unwritable via API |
| Search predicate | `routes/patients.ts:68-75` | allow-list | Field unsearchable |
| Basic importer template + write | `utils/excelImport.ts:49-61`; `routes/patientsImport.ts:90-102`, `:335-349` | allow-list | (out of scope — see D-2) |
| Reporting | `routes/reports.ts:342-345` | the **only** `patient.groupBy` in the server tree, on `source` | Absent from reports |
| Frontend form + i18n | `src/components/PatientForm.tsx:18-33`; `src/locales/{en,tr,fr,de}/patients.json` | allow-list; **9 labels only** | Not editable, unlabelled in 4 locales |

**Two live drifts already exist in these lists**, proving they are not self-maintaining:

1. **Anonymization vs. schema.** `patientAnonymization.ts:283-303` nulls `firstName`→`'Anonim'`,
   `lastName`→`'Hasta'`, `email`, `phone`, `dateOfBirth`, `address`, `city`, `postalCode`,
   `country`, `notes`, forces both consents false and sets the markers — **but does not reset
   `smsOptOut` / `smsOptOutAt`**, which are consent-adjacent. There is no
   `satisfies Prisma.PatientUpdateInput` exhaustiveness guard and no schema-vs-payload test.
2. **The one test that looks like a guard re-implements the payload.**
   `tests/patientPrivacy.test.ts:122-169` builds its own anonymization object (`:131-140`) and is
   **already out of sync with production** — it omits `city`, `postalCode`, `country`, both
   consents, and all three anonymization markers. It proves nothing about the real code path.
3. The subject-export and bulk-export allow-lists **already disagree** with each other on
   `smsOptOut`, `smsOptOutAt`, `primaryClinicId`.

> **The structural finding: no schema-drift guard exists for any `Patient` field list.** The only
> tests that read `schema.prisma` cover imaging, attachments, lab orders, booking evidence and SMS —
> **none asserts anything about `Patient`**. The bulk-export test checks a *secret denylist* only,
> never allowlist-vs-model parity. **Adding a column to `Patient` therefore breaks nothing in CI, and
> is silently absent from the KVKK export, the bulk export, and anonymization.**
>
> **Anonymization is fail-open.** This is the single strongest argument for keeping identity data in
> a separate model whose omission is *visible* (a whole missing relation is reviewable) rather than a
> forgotten key inside a deny-list payload that has already demonstrably drifted. A schema-integrity
> guard in the style of `tests/kvkkHigh007High008SchemaIntegrity.test.ts:37-45` should accompany
> **any** new Patient-domain field, whichever design is chosen.

### 4.5 Cryptography available today

`server/src/utils/encryption.ts` — the **only** reversible field encryption in the product:

| Property | Value |
| --- | --- |
| Algorithm | `aes-256-gcm` (`:16`) |
| Key | `process.env.ENCRYPTION_KEY`, 64 hex chars = 32 bytes, **used raw — no KDF** (`:19-28`) |
| IV | `randomBytes(12)` **per call** (`:36`) ⇒ **non-deterministic** |
| Format | hex `iv(24) + authTag(32) + ciphertext` (`:11,40`) |
| Version prefix | `TAGGED_SECRET_PREFIX = 'enc:v1:'` (`:58`) — a **format** version, not a key version |
| Legacy tolerance | `decryptSecretTagged` returns unprefixed values **as plaintext** (`:72-76`) — fail-**open** |
| Boot check | `isEncryptionKeyConfigured()` (`:103-106`), fatal only when `NODE_ENV==='production'` |
| **Key rotation** | **NONE.** No mechanism, no key-id column, no re-encrypt script |

**Because the IV is random per call, `encryptSecret()` output can never be matched by equality.**
Any searchable identity design therefore *requires* a separate lookup mechanism — this is forced by
the primitive, not a design preference.

**Current usage is machine secrets only:** TOTP secrets (`schema.prisma:1545`), WhatsApp/Meta/
Instagram tokens, external-calendar client and webhook secrets, SMS provider credentials.
**No patient PII column anywhere in the product is encrypted.**

**The one keyed-lookup precedent** — `hashClientIp()`
(`server/src/utils/passwordStepUp.ts:103-109`): `createHmac('sha256', secret)`, with a **dedicated**
env var `CLINIC_BULK_EXPORT_IP_HASH_SECRET`, an explicit written rule against reuse of
`JWT_SECRET`/`ENCRYPTION_KEY` (`:12-13`, `:82-87`), a **fail-closed per-request** assertion
(`:79-89`), stored under a tenant-scoped composite unique `@@unique([userId, clinicId, ipHash])`
(`schema.prisma:3182`).

### 4.6 The privacy guard would not protect a new identity field

`scripts/log-privacy-guard/lib/scanner.ts:125`:

```ts
const DIRECT_PII_IDENTIFIER_NAMES = new Set(['email', 'phone']);
```

> A `nationalId` / `tckn` / `identityNumber` identifier passed to `logger.info()` produces
> **zero violations**. The guard that gates CI would be **silently green** on the most sensitive
> field in the product. Extending this set is a mandatory deliverable of whichever task implements
> the field — not an optional hardening.

---

## 5. Source→NoraMedi field matrix (F3-DATA-MIG-002)

All 91 columns, individually dispositioned. Column 91 is an explicit placeholder pending C-1.

Legend — `DATA_CLASSIFICATION`: `PII` · `SPECIAL` (KVKK Art. 6) · `ID#` (identity number) ·
`FIN` · `OPS` · `VENDOR` · `CONSENT?` · `PRES`.
`IMPORT_DIRECT` = writable after trim only; `IMPORT_AFTER_NORMALIZATION` = requires a semantic
transform.

| SOURCE_FIELD | MEANING | FILL | TYPE | NORA_MODEL.FIELD | DEST? | NORM | VALID | REF_MAP | CLASS | DECISION | BLOCKER | TASK |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `HASTA_ID` | Vendor patient PK | 100 % / 14,890 uniq | str | *(provenance)* `sourceId` | **NO** | trim | unique-in-file | NO | OPS | `IMPORT_AFTER_SCHEMA_FIELD` | G-3 provenance undecided | MIG-004 |
| `ADI` | First name | 100 % | str | `Patient.firstName` `:225` | YES | trim, collapse | `min(1)` | NO | PII | `IMPORT_DIRECT` | — | MIG-005 |
| `SOYADI` | Last name | 100 % | str | `Patient.lastName` `:226` | YES | trim | `min(1)`; reject placeholders | NO | PII | `IMPORT_DIRECT` | — | MIG-005 |
| `UNVANI` | Title / honorific | UNKNOWN | str | — | **NO** | — | — | NO | PII | `BLOCKED_NO_DESTINATION` | G-E14; fill unmeasured | MIG-002 |
| `BABAADI` | Father's name | UNKNOWN | str | — | **NO** | — | — | NO | PII | `BLOCKED_NO_DESTINATION` | G-E12 | MIG-003 |
| `ANNEADI` | Mother's name | UNKNOWN | str | — | **NO** | — | — | NO | PII | `BLOCKED_NO_DESTINATION` | G-E12 | MIG-003 |
| `CINSIYET` | Gender | **79.3 %** / 2 distinct | str | — | **NO** | 2-value map | enum | NO | PII | `BLOCKED_NO_DESTINATION` | **G-E5 — 11,807 values, no destination** | MIG-002 |
| `DOGUMTARIHI` | Date of birth | 69.5 % | date 10,332 / str 10 | `Patient.dateOfBirth` `:229` | YES | serial→date, **UTC-noon anchor** | **not future** (`schemas:29`) | NO | PII | `IMPORT_AFTER_NORMALIZATION` | future-dated rows → `INVALID` at dry-run | MIG-005 |
| `DOGUMIL` | Birth province | UNKNOWN | str | — | **NO** | — | — | NO | PII | `BLOCKED_NO_DESTINATION` | G-E13 | MIG-002 |
| `DOGUMILCE` | Birth district | UNKNOWN | str | — | **NO** | — | — | NO | PII | `BLOCKED_NO_DESTINATION` | G-E13 | MIG-002 |
| `MEDENIHALI` | Marital status | UNKNOWN | str | — | **NO** | — | — | NO | PII | `BLOCKED_NO_DESTINATION` | G-E15; no consumer | MIG-002 |
| `MESLEGI` | Occupation | UNKNOWN | str | — | **NO** | — | — | NO | PII | `BLOCKED_NO_DESTINATION` | G-E16. **Trap:** `occupation` `:331` is on `PatientEmergencyContact` | MIG-002 |
| `EGITIMDURUMU` | Education level | UNKNOWN | str | — | **NO** | — | — | NO | PII | `BLOCKED_NO_DESTINATION` | G-E17; **recommend NOT building** | MIG-002 |
| `UYRUK` | Nationality | **0 %** | — | — | **NO** | — | — | NO | PII | `BLOCKED_NO_DESTINATION` | G-E9. 0 % ⇒ **cannot be a first-customer blocker** | US-01.8 |
| `ULKE` | Country of residence | **0 %** | — | `Patient.country` `:233` | **YES** | trim | — | NO | PII | `IMPORT_DIRECT` | mapping valid, 0 rows carried (C-3) | MIG-002 |
| `TCNO` | T.C. identity no | **77.2 %** / 11,500 | num 10,799 / str 701 | — | **NO** | digit-shape class | 11-digit + checksum | NO | **ID#** | `BLOCKED_NO_DESTINATION` | **G-E4** + encryption decision | MIG-003 |
| `PASAPORTNO` | Passport no | **0 %** | — | — | **NO** | — | — | NO | **ID#** | `BLOCKED_NO_DESTINATION` | G-E4; 0 % ⇒ not P0 | US-01.8 |
| `SOSYAL_GUVENCE_NO` | SGK no | **0 %** | — | — | **NO** | — | — | NO | **ID#** | `BLOCKED_NO_DESTINATION` | G-E4 (C-4) | MIG-003 |
| `SOSYAL_GUVENCE_KURUMU` | SGK institution | UNKNOWN | str | — | **NO** | — | — | **YES** | OPS | `BLOCKED_NO_DESTINATION` | G-E19 | MIG-006 |
| `ENABIZTAKIPNO` | e-Nabız tracking no | **0 %** | — | — | **NO** | — | — | NO | **ID#** | `BLOCKED_NO_DESTINATION` | G-E4 (C-4) | MIG-003 |
| `YUPASS_NO` | Foreign pass no | UNKNOWN | str | — | **NO** | — | — | NO | **ID#** | `BLOCKED_NO_DESTINATION` | G-E4; meaning unconfirmed | US-01.8 |
| `HTS_KODU` | Health-tourism code | UNKNOWN | str | — | **NO** | — | — | NO | **ID#** | `BLOCKED_NO_DESTINATION` | G-E4; acronym unexpanded | US-01.8 |
| `VERGIDAIRESI` | Tax office | UNKNOWN | str | — | **NO** | — | — | NO | FIN | `BLOCKED_NO_DESTINATION` | G-E26 | MIG-002 |
| `VERGINO` | Tax number | UNKNOWN | str/num | — | **NO** | — | 10-digit VKN | NO | **ID#**/FIN | `BLOCKED_NO_DESTINATION` | G-E4. **Likely explains the 72 twelve-digit values misfiled in `TCNO`** | MIG-003 |
| `EVTELEFONU` | Home phone | 0.3 % | mixed | — | **NO** | — | — | NO | PII | `BLOCKED_NO_DESTINATION` | G-E8 (C-5). **Never → `PatientEmergencyContact.phone`** | MIG-002 |
| `ISTELEFONU` | Work phone | 1.1 % | mixed | — | **NO** | — | — | NO | PII | `BLOCKED_NO_DESTINATION` | G-E8 (C-5) | MIG-002 |
| `CEPTELEFONU` | Mobile | **91.4 %** | str 13,342 / num 271 | `Patient.phone` `:228` | YES | **canonical normalizer (G-6)**; restore leading `0` on 271 rows | none in schema | NO | PII | `IMPORT_AFTER_NORMALIZATION` | **Never dedup on phone.** Dry-run must report every pre-existing patient flipped 1→2 matches | MIG-005 |
| `FAX` | Fax | UNKNOWN | str | — | **NO** | — | — | NO | PII | `BLOCKED_NO_DESTINATION` | G-E8; **recommend NOT building** | MIG-002 |
| `EMAIL` | E-mail | **0.05 %** (7 rows, 1 valid) | str | `Patient.email` `:227` | YES | trim, lower, `''`→NULL | `.email()` | NO | PII | `IMPORT_AFTER_NORMALIZATION` | ~6 of 7 will fail. **Unusable as identity** | MIG-005 |
| `ADRESI` | Street address | UNKNOWN | str | `Patient.address` `:230` | YES | trim | — | NO | PII | `IMPORT_DIRECT` | — | MIG-005 |
| `ADRES_KODU` | Address code | UNKNOWN | str/num | `Patient.postalCode` `:232` | **field YES / semantics NO** | pending | 5-digit posta kodu vs 10-digit UAVT | NO | PII | `MANUAL_REVIEW` | **C-2 — needs a digit-length histogram first** | MIG-001 |
| `IL` | Province | UNKNOWN | str | `Patient.city` `:231` | YES | trim | — | NO | PII | `IMPORT_DIRECT` | no canonicalization exists | MIG-005 |
| `ILCE` | District | ≈13 rows | str | — | **NO** | — | — | NO | PII | `BLOCKED_NO_DESTINATION` | G-E7 | MIG-002 |
| `MAHALLE` | Neighbourhood | UNKNOWN | str | `Patient.address` `:230` (**composed**) | via composition | documented `MAHALLE`+`ADRESI` → `address` | — | NO | PII | `IMPORT_AFTER_NORMALIZATION` | composition rule must be **stable across reruns** or idempotency breaks | MIG-005 |
| `KANGURUBU` | Blood group | 1 row | str | — | **NO** | — | ABO/Rh | NO | **SPECIAL** | `BLOCKED_NO_DESTINATION` | G-E11 + Art. 6 legal gate | MIG-002 |
| `ONEMLINOT` | Important clinical note | **UNKNOWN (C-7)** | str | `Patient.notes` `:236` | **YES** | composition | length bound | NO | **SPECIAL** | `BLOCKED_LEGAL_DECISION` | destination exists; blocker is purely legal | MIG-002 |
| `UZUNNOT` | Long note | **0 %** | — | `Patient.notes` `:236` | **YES** | — | — | NO | **SPECIAL** | `BLOCKED_LEGAL_DECISION` | 0 % here; gate applies to next customer | MIG-002 |
| `KONTROLNOTU` | Recall note | **UNKNOWN (C-7)** | str | `Patient.notes` `:236` | **YES** | composition | length bound | NO | **SPECIAL** | `BLOCKED_LEGAL_DECISION` | as `ONEMLINOT` | MIG-002 |
| `TEDAVIDURUMU` | Treatment status | **0.02 %** (3 rows) | num | — | **NO** | — | — | NO | OPS | `IGNORE_SUMMARY_NOT_TRANSACTION` | 3/14,890 proves no treatment history | MIG-001 |
| `SUBE_ID` | Branch id | 61 % / **1 distinct** | str | — | **NO** (deliberate) | — | — | NO | VENDOR | `IGNORE_VENDOR_INTERNAL` | cannot derive destination clinic; operator-selected | MIG-013 |
| `HASTADOKTOR` | Assigned doctor label | **99.5 %** / 25 distinct | str | `User.id` via map — **and no `Patient` field to hold it** | **NO** (both) | exact match only | must resolve | **YES (25)** | OPS | `IMPORT_AFTER_REFERENCE_MAPPING` | **C-8** — G-E2 (map store) + G-E3 (destination column) | MIG-006 |
| `REFERANSI` | Referring person/source | UNKNOWN | str | — (`Patient.source` is **enum-constrained**) | **NO** | — | — | partial | OPS | `BLOCKED_NO_DESTINATION` | G-E18. **Do not coerce into `source`.** ⚠ third-party PII | MIG-002 |
| `KURUMREFERANSI` | Institutional referrer | UNKNOWN | str | — | **NO** | — | — | **YES** | OPS | `BLOCKED_NO_DESTINATION` | G-E19 | MIG-006 |
| `REHBER_ID` | Guide/agency id | UNKNOWN | str/num | — | **NO** | — | — | **YES** | VENDOR | `IGNORE_VENDOR_INTERNAL` | K-2: re-open if profiling shows an agency FK | MIG-001 |
| `CALISMAGURUBU` | Working group | UNKNOWN | str | — | **NO** | — | — | NO | VENDOR | `IGNORE_VENDOR_INTERNAL` | meaning unconfirmed | MIG-006 |
| `AILEGURUBU` | Family group | UNKNOWN | str/num | — | **NO** | — | — | NO | OPS | `BLOCKED_NO_DESTINATION` | **G-E20 — the missing explanation for the 28.6 % shared-phone population** | MIG-005 |
| `UCRETTARIFESI` | Fee tariff | UNKNOWN | str | — | **NO** | — | — | **YES** | FIN | `BLOCKED_NO_DESTINATION` | G-E21; model mismatch (D-17) | MIG-006 |
| `KURUMTARIFE` | Institution tariff | UNKNOWN | str | — | **NO** | — | — | **YES** | FIN | `BLOCKED_NO_DESTINATION` | G-E19 | MIG-006 |
| `SIGORTATURU` | Insurance type | UNKNOWN | str | — | **NO** | — | map to `insuranceTypes` (`schemas:5`) | **YES** | FIN | `BLOCKED_NO_DESTINATION` | G-E23. Creating an `InsuranceProvision` to hold a type would **fabricate a financial record** | MIG-006 |
| `RISK_TUTARI` | Outstanding balance | **0.01 %** (2 rows) | num | — | **NO** | — | — | NO | FIN | `IGNORE_SUMMARY_NOT_TRANSACTION` | no financial history exists | MIG-001 |
| `INDIRIMORANI` | Standing discount | UNKNOWN | num | — | **NO** | — | 0–100 % | NO | FIN | `BLOCKED_NO_DESTINATION` | G-E22 — a **standing attribute**, not a summary | MIG-002 |
| `CARIODEMESTATU` | Current-account status | UNKNOWN | str/num | — | **NO** | — | — | NO | FIN | `IGNORE_SUMMARY_NOT_TRANSACTION` | merged §13 records **three coexisting definitions of "outstanding"** | MIG-001 |
| `ODEMESONTARIHI` | Payment due date | UNKNOWN | date | — | **NO** | — | — | NO | FIN | `IGNORE_SUMMARY_NOT_TRANSACTION` | — | MIG-001 |
| `SONODEMETARIHI` | Last payment date | UNKNOWN | date | — | **NO** | — | — | NO | FIN | `IGNORE_SUMMARY_NOT_TRANSACTION` | — | MIG-001 |
| `ODEMENOTU` | Payment note | UNKNOWN | str | — | **NO** | — | — | NO | FIN | `IGNORE_SUMMARY_NOT_TRANSACTION` | **do not divert into `Patient.notes`** | MIG-001 |
| `ODEMENOTTARIHI` | Payment-note date | UNKNOWN | date | — | **NO** | — | — | NO | FIN | `IGNORE_SUMMARY_NOT_TRANSACTION` | — | MIG-001 |
| `SMSBORCTARIH` | Debt-SMS date | UNKNOWN | date | — | **NO** | — | — | NO | FIN | `IGNORE_SUMMARY_NOT_TRANSACTION` | **never read as consent or opt-out evidence** | MIG-001 |
| `SMSODEMETARIHI` | Payment-SMS date | UNKNOWN | date | — | **NO** | — | — | NO | FIN | `IGNORE_SUMMARY_NOT_TRANSACTION` | as above | MIG-001 |
| `SONISLEMTARIHI` | Last procedure date | UNKNOWN | date | — | **NO** | — | — | NO | OPS | `IGNORE_SUMMARY_NOT_TRANSACTION` | ⚠ a synthesised value would **mass-fabricate recall candidates** on one staff click | MIG-001 |
| `SONKONTROLTARIHI` | Last check-up | UNKNOWN | date | — | **NO** | — | — | NO | OPS | `IGNORE_SUMMARY_NOT_TRANSACTION` | as above | MIG-001 |
| `TEDAVISONTARIHI` | Treatment end | UNKNOWN | date | — | **NO** | — | — | NO | OPS | `IGNORE_SUMMARY_NOT_TRANSACTION` | — | MIG-001 |
| `TEDAVIBITISTARIH` | Treatment completion | UNKNOWN | date | — | **NO** | — | — | NO | OPS | `IGNORE_SUMMARY_NOT_TRANSACTION` | `treatmentCaseSchema` exposes no `createdAt`/`closedAt` | MIG-001 |
| `SONRANDEVUTARIHI` | Last appointment | UNKNOWN | date | — | **NO** | — | — | NO | OPS | `IGNORE_SUMMARY_NOT_TRANSACTION` | availability check evaluates **today's** roster | MIG-001 |
| `SONANKETTARIHI` | Last survey | UNKNOWN | date | — | **NO** | — | — | NO | OPS | `IGNORE_SUMMARY_NOT_TRANSACTION` | — | MIG-001 |
| `SONGORUNTUTARIHI` | Last imaging | UNKNOWN | date | — | **NO** | — | — | NO | OPS | `IGNORE_SUMMARY_NOT_TRANSACTION` | evidence an imaging corpus exists (D-14) | MIG-001 |
| `KONTROLPERYODU` | Recall interval | UNKNOWN | num | — | **NO** | — | positive int | NO | OPS | `BLOCKED_NO_DESTINATION` | G-E24 — a **standing setting**, genuinely useful | MIG-002 |
| `HATIRLAT` | Reminder flag | UNKNOWN | bool | — | **NO** | — | — | NO | OPS | `BLOCKED_NO_DESTINATION` | **G-E25 — HARD RULE: never map to any consent field.** Recommend NOT building | MIG-002 |
| `KVKKONAYKODU` | KVKK approval code | **0 %** | — | `PatientCommunicationPreference` (service-owned) | model YES / value NO | — | — | NO | **CONSENT?** | `BLOCKED_LEGAL_DECISION` | 0 %; `evidence_required` enforced | MIG-002 |
| `KVKKILKKODU` | KVKK initial code | 31.9 % / **4,633 distinct** | num | *(run metadata)* | **NO** | — | — | NO | **CONSENT?** | `HISTORICAL_METADATA_ONLY` | near-unique **code**, not a state. K-4 | MIG-004 |
| `KVKKSMS` | KVKK SMS flag | **0 %** | — | — | model YES / value NO | — | — | NO | **CONSENT?** | `BLOCKED_LEGAL_DECISION` | 0 % | MIG-002 |
| `MESAJOK` | "Messaging OK" flag | UNKNOWN | bool | — | **NO** | — | — | NO | **CONSENT?** | `IGNORE_VENDOR_INTERNAL` | **never map to consent** — discarded deliberately | MIG-002 |
| `SMSGONDERILDI` | SMS-sent flag | UNKNOWN | bool | — | **NO** | — | — | NO | **CONSENT?** | `IGNORE_VENDOR_INTERNAL` | delivery evidence, not consent | MIG-002 |
| `KAYITTARIHI` | Registration date | 100 % (2016→2026) | date | *(run metadata)* | **NO** | serial→date | — | NO | OPS | `HISTORICAL_METADATA_ONLY` | **do not overwrite `createdAt`** (`@default(now())`) — 10 yrs of tenure has no faithful home | MIG-004 |
| `KAYITSAATI` | Registration time | UNKNOWN | str/time | *(run metadata)* | **NO** | combine w/ date | — | NO | OPS | `HISTORICAL_METADATA_ONLY` | as above | MIG-004 |
| `KAYDEDEN` | Recorded-by (staff) | UNKNOWN | str | *(run metadata)* | **NO** | — | — | **YES** if resolved | OPS | `HISTORICAL_METADATA_ONLY` | same reference contract as `HASTADOKTOR` | MIG-006 |
| `SILINDI` | Soft-delete flag | 100 % / **172 true** | bool | `Patient.patientStatus` `:234` | YES | `true`→`'archived'` | enum | NO | OPS | `IMPORT_AFTER_NORMALIZATION` | **must NOT write `deletedAt`**. Archived rows do not consume plan quota | MIG-005 |
| `DOSYAVAR` | Has a file | UNKNOWN | bool | — | **NO** | — | — | NO | VENDOR | `IGNORE_VENDOR_INTERNAL` | valuable as a **D-13 inventory signal** | MIG-001 |
| `CHECKBOX` | Unlabelled checkbox | UNKNOWN | bool | — | **NO** | — | — | NO | VENDOR | `IGNORE_VENDOR_INTERNAL` | **if profiling shows consent-like semantics → `BLOCKED_LEGAL_DECISION`** | MIG-001 |
| `HESAP_KODU` | Ledger account code | UNKNOWN | str | — | **NO** | — | — | NO | VENDOR | `IGNORE_VENDOR_INTERNAL` | no ledger model (D-10) | MIG-001 |
| `UST_HESAP_KODU` | Parent ledger code | UNKNOWN | str | — | **NO** | — | — | NO | VENDOR | `IGNORE_VENDOR_INTERNAL` | as above | MIG-001 |
| `DOSYANO` | Patient chart number | UNKNOWN | str/num | — | **NO** | — | uniqueness TBM | NO | OPS | `BLOCKED_NO_DESTINATION` | **G-E6 (C-6) — clinic-facing, not vendor-internal** | MIG-005 |
| `SUBEDOSYANO` | Branch file no | UNKNOWN | str/num | — | **NO** | — | — | NO | OPS | `BLOCKED_NO_DESTINATION` | G-E6 | MIG-005 |
| `ALTDOSYANO` | Sub-file no | UNKNOWN | str/num | — | **NO** | — | — | NO | OPS | `BLOCKED_NO_DESTINATION` | G-E6 | MIG-005 |
| `ULKEGIRISTARIHI` | Country entry date | **UNMEASURED** | date | — | **NO** | serial→date | — | NO | PII | `BLOCKED_NO_DESTINATION` | G-E10 | US-01.8 |
| `ULKECIKISTARIHI` | Country exit date | **UNMEASURED** | date | — | **NO** | serial→date | — | NO | PII | `BLOCKED_NO_DESTINATION` | G-E10 | US-01.8 |
| `GELDIGIULKE` | Country of origin | **UNMEASURED** | str | — | **NO** | ISO-3166 | — | **YES** | PII | `BLOCKED_NO_DESTINATION` | G-E10. **`Patient.country` is residence and is already claimed by `ULKE`** | US-01.8 |
| `TURIZM` | Health-tourism flag | **UNMEASURED** | bool | — | **NO** | — | — | NO | OPS | `BLOCKED_NO_DESTINATION` | G-E10 — cheapest tourism gap | US-01.8 |
| `RESIMUZANTI` | Photo file extension | UNKNOWN | str | — | **NO** | — | — | NO | VENDOR | `IGNORE_VENDOR_INTERNAL` | a filename fragment; images not in this export | MIG-001 |
| `HASTARENGI` | UI row colour | UNKNOWN | str/num | — | **NO** | — | — | NO | **PRES** | `IGNORE_VENDOR_INTERNAL` | vendor UI state | MIG-002 |
| `EK_ACIKLAMA` | Additional description | UNKNOWN | str | `Patient.notes` `:236` (fit unconfirmed) | field YES / semantics NO | pending | length bound | NO | **SPECIAL (presumed)** | `MANUAL_REVIEW` | profile for clinical content → `BLOCKED_LEGAL_DECISION` or `IMPORT_AFTER_NORMALIZATION` | MIG-001 |
| `UNENUMERATED_COLUMN_91` | **Never named in the merged contract** | — | — | — | — | — | — | — | — | `MANUAL_REVIEW` | **C-1 — contract defect** | MIG-001 |

### 5.1 Decision counts

| IMPORT_DECISION | Count |
| --- | --- |
| `IMPORT_DIRECT` | **5** |
| `IMPORT_AFTER_NORMALIZATION` | **5** |
| `IMPORT_AFTER_REFERENCE_MAPPING` | **1** |
| `IMPORT_AFTER_SCHEMA_FIELD` | **1** |
| `HISTORICAL_METADATA_ONLY` | **4** |
| `MANUAL_REVIEW` | **3** |
| `IGNORE_VENDOR_INTERNAL` | **11** |
| `IGNORE_SUMMARY_NOT_TRANSACTION` | **16** |
| `BLOCKED_LEGAL_DECISION` | **5** |
| `BLOCKED_INVALID_SOURCE` | **0** |
| `BLOCKED_NO_DESTINATION` | **40** |
| **Total** | **91** |

`5+5+1+1+4+3+11+16+5+0+40 = 91` ✓

**Rolled up to the report's requested buckets:** `IMPORT_DIRECT` 5 · `IMPORT_AFTER_NORMALIZATION` 5 ·
`IMPORT_AFTER_REFERENCE_MAPPING` 1 · `IMPORT_AFTER_SCHEMA_FIELD` 1 · `HISTORICAL_METADATA_ONLY` 4 ·
`IGNORE` **27** (11 vendor-internal + 16 summary) · `BLOCKED` **45** (40 no-destination + 5 legal) ·
`MANUAL_REVIEW` 3.

**`BLOCKED_INVALID_SOURCE` is deliberately 0.** `TCNO`'s 8.5 % malformed values are a **row-level**
classification, not a column-level one — the column itself is valid and migratable.

**Headline: 12 of 91 columns (13.2 %) reach a NoraMedi field today** — 10 unconditionally, 3 gated
on a legal decision, 2 unresolved. **40 columns (44 %) have no destination at all.**

---

## 6. TC / national identifier recommendation (F3-DATA-MIG-003)

### 6.0 R1 program-owner decision — priority correction

```text
TC_NATIONAL_IDENTITY_FIRST_CUSTOMER_PRIORITY = P0_FIRST_CUSTOMER_BLOCKER
PATIENT_IDENTITY_DOCUMENT_MODEL              = CANDIDATE_ACCEPTED_FOR_NEXT_DESIGN_STAGE
SCHEMA_IMPLEMENTATION_AUTHORIZED             = NO
PATIENT_IDENTITY_CRYPTO_KEY_SEPARATION       = REQUIRED
IDENTITY_LOOKUP_TOKEN_TENANT_BOUND           = YES
```

**This section (§6) and §15 previously ranked `TCNO`/G-E4 as `P1_REQUIRED_BEFORE_FULL_MIGRATION`.**
That ranking is **corrected by program-owner decision, R1**. The objective of this program is a
complete, controlled clinic-data migration for the first customer. The real source contains
**~11,500 populated `TCNO` values** — a major patient identity dataset. The absence of an existing
NoraMedi route or report that *consumes* a TC number does not make it acceptable to silently discard
that dataset during a "full migration." **`TCNO` is therefore `P0_FIRST_CUSTOMER_BLOCKER`, alongside
`G-E1` (provenance).** §15 is corrected accordingly below.

This does **not** mean invalid legacy TC values are imported as verified identities. Every value is
row-classified before any write:

```text
VALID              — 11 digits, checksum passes
INVALID_LEGACY      — wrong shape/checksum but present; historical data-entry error, not corruption
AMBIGUOUS           — plausible identity value whose ownership relative to the patient row is unclear
                       (e.g. §6.5 guardian/child semantics)
DUPLICATE_SOURCE     — the same normalized value appears against ≥2 patients in the source
MANUAL_REVIEW        — does not resolve cleanly into the above; requires a human decision before write
```

`§6.5`'s per-case table is restated using this vocabulary. **Patient execution must not start until
an accepted secure identity destination design exists** — promoting the priority to P0 makes that
design a first-customer *blocker*, not merely a P1 nice-to-have finished "sometime before full
migration."

### 6.1 Decision summary

| Question | Recommendation | Status |
| --- | --- | --- |
| First-customer priority | **`P0_FIRST_CUSTOMER_BLOCKER`** (§6.0 — program-owner decision, R1) | DECIDED |
| Where does it live | A separate child model, working name `PatientIdentityDocument` — *not* scalars on `Patient` | **`CANDIDATE_ACCEPTED_FOR_NEXT_DESIGN_STAGE`.** The exact Prisma shape in §6.3 is illustrative, not an approved schema |
| Encryption | Dedicated, isolated key material for patient identity data — **not** the general `ENCRYPTION_KEY` and **not** its lifecycle. See §6.2a | `NOT_AUTHORIZED_YET` — architecture required, not implemented |
| Searchable | **Yes, exact-match only**, via an **HMAC-SHA256 lookup column, tenant-bound** (§6.4) | `CANDIDATE_ACCEPTED_FOR_NEXT_DESIGN_STAGE` |
| DB unique constraint | **No cross-patient unique at launch.** Non-unique index + application-level duplicate *warning*. Reason is unresolved legacy semantics and dirty-data compatibility (§6.5), not a claim that duplicate identities are correct domain behavior | `CANDIDATE_ACCEPTED_FOR_NEXT_DESIGN_STAGE` |
| Checksum | Enforced at write time for `TCKN`; migration **quarantines the value, never blocks the patient row** | `CANDIDATE_ACCEPTED_FOR_NEXT_DESIGN_STAGE` |
| Key rotation | None exists today for any key. Ship `cryptoVersion Int @default(1)` plus a rotation-capable key hierarchy from day one (§6.2a) | `NOT_AUTHORIZED_YET` |
| Platform Admin visibility | **Split by capability, not a single "NONE."** See §6.6a | `CANDIDATE_ACCEPTED_FOR_NEXT_DESIGN_STAGE` |

**None of the above is schema-authorized.** `SCHEMA_IMPLEMENTATION_AUTHORIZED = NO`. This section
proposes an architecture for the next design review; it does not approve a Prisma schema, and §6.3's
model listing must not be read as pre-approved.

### 6.2 Why a child model, not columns on `Patient`

Two facts, both verified, not preferences:

1. **`Patient` scalars auto-leak.** `GET /patients/:id` uses `include:` with no `select:`
   (`routes/patients.ts:167-191`) and spreads the whole record (`:273`); create and update return
   the whole record too. Using Option 1 safely would require converting the **highest-traffic
   patient endpoint** from `include:` to `select:` **first** — a behaviour-changing refactor of the
   hottest route, performed under an active schema freeze, purely to make a new column safe. A
   relation is returned only when explicitly included. **Option 2 needs none of that.**
2. **The multi-document rewrite is already scheduled by the customer's own data and by US-01.8.**
   The source carries `PASAPORTNO`, `UYRUK`, `YUPASS_NO`, `HTS_KODU`; US-01.8 specifies
   `identityDocType [TC/MAVI_KART/PASAPORT]`. Option 1 handles the second document type by adding a
   second `*Encrypted` + `*LookupHash` column pair, the third by adding a third — and the eventual
   consolidation into a document model **is exactly the destructive migration this task is asked to
   avoid**.

Option 3 (a single encrypted JSON blob on `Patient`) is **disqualified**: a JSON blob cannot carry a
lookup index, so it cannot be searched at all, and it inherits the same auto-leak problem.

**Precedent for the shape.** `PatientEmergencyContact` (`schema.prisma:318-340`) and
`PatientMedicalHistory` (`:372-425`) are both patient-adjacent additive child models with
denormalized `patientId` + `clinicId` + `organizationId`, shipped as US-01.2 / US-01.1-P1 in
migrations `20260803120000` and `20260803135254` — **after** the freeze's conditions 2–3 were
satisfied. `PatientMedicalHistory` explicitly models KVKK special-category data. This is a live,
merged precedent for exactly this shape.

### 6.2a Crypto-key separation — R1 correction, withdraws key reuse

**Withdrawn.** An earlier draft of this section recommended reusing `utils/encryption.ts`
`encryptSecretTagged` — i.e. the general platform `ENCRYPTION_KEY` — for patient identity ciphertext.
**That recommendation is withdrawn.** `ENCRYPTION_KEY` today protects **rotatable machine secrets**
(TOTP secrets, WhatsApp/Meta/Instagram tokens, calendar and SMS provider credentials): if it leaks,
every one of those secrets can be revoked and reissued at the provider. **A T.C. Kimlik No is
immutable, lifelong, government-issued regulated PII** — it cannot be reissued if the key protecting
it is compromised. Sharing a key means sharing a blast radius between two data classes with
fundamentally different consequence profiles, and it means a future rotation of one forces a
rotation conversation about the other. §6.8's "decisive asymmetry" argument already makes this case
for retention; R1 extends the same logic to key *identity*, not just key *lifecycle timing*.

```text
PATIENT_IDENTITY_CRYPTO_KEY_SEPARATION = REQUIRED
```

The patient-identity encryption boundary must be designed (not implemented in this PR) to support:

- **dedicated key material, or an equivalent isolated key hierarchy** — never the same key object,
  env var, or secret-manager entry as `ENCRYPTION_KEY` or any provider/platform secret;
- **`cryptoVersion`** on every row (already present in §6.3's illustrative shape) so a future key
  generation is distinguishable per record;
- **future key rotation** — a defined (if not yet built) procedure for introducing a new key
  generation without a destructive rewrite;
- **backwards decryption during rotation** — old-generation ciphertext must remain readable while a
  rotation is in progress, keyed off `cryptoVersion`;
- **fail-closed startup/configuration** — the service must refuse to start (or refuse identity writes)
  if the dedicated key material is missing or malformed, mirroring the fail-closed pattern already
  established by `assertIpHashSecretConfigured()` (`passwordStepUp.ts:79-89`), not the weaker
  production-only boot check in `isEncryptionKeyConfigured()` (`encryption.ts:103-106`);
- **no raw PII logging** — no path may log the plaintext value, the encryption key, or the pepper;
- **a testable key lifecycle** — key/pepper presence, fail-closed behavior, and rotation logic must be
  coverable by tests independent of any real key material;
- **a path to future KMS / envelope encryption** — the design must not force a destructive `Patient`
  or identity-model redesign when the platform later adopts a KMS-backed envelope scheme (e.g. a
  wrapped data-key per record instead of a single static key).

**Not implemented in this PR.** No key management code, no env var wiring, and no encryption code are
added by this documentation-only change. Where an illustrative candidate name is useful for
readability (e.g. in §6.3's Prisma doc-comments or §6.4's HMAC formula), it is marked illustrative,
not final — the final name and key-management mechanism are decided at schema-implementation review,
not here.

### 6.3 Proposed model — PROPOSAL ONLY, `NOT_AUTHORIZED_YET`

**Illustrative only — `SCHEMA_IMPLEMENTATION_AUTHORIZED = NO` (§6.0).** This Prisma shape is the
leading candidate for the next design stage, not an approved schema. Field names, the encryption
call, and the pepper env-var name below are illustrative placeholders pending §6.2a's key-separation
architecture — none of it is authorized for implementation.

```prisma
/// F3-DATA-MIG-003. ILLUSTRATIVE ONLY — not an approved schema (§6.0, §6.2a).
/// Encrypted national/travel identity documents.
/// docType: TCKN | PASSPORT | FOREIGN_ID   (stable backend string contract, per the
///   Patient.patientStatus / PatientEmergencyContact.contactType convention — NOT a Prisma enum)
/// valueEncrypted: AES-256-GCM under DEDICATED patient-identity key material — NEVER the general
///   ENCRYPTION_KEY or its lifecycle (§6.2a, PATIENT_IDENTITY_CRYPTO_KEY_SEPARATION = REQUIRED).
///   utils/encryption.ts's algorithm/format may be reused as a primitive; its key object may not.
/// lookupHash: HMAC-SHA256(identityLookupKey, organizationId:docType:normalizedValue) — tenant-bound
///   by construction (§6.4). NEVER an unkeyed hash — the valid TC space is ~9e8 and exhaustively
///   invertible in <1s. `identityLookupKey` is an illustrative name for a dedicated, isolated pepper.
/// cryptoVersion: key/pepper generation. No rotation mechanism exists today; this column exists
///   so that adding one later is an additive backfill, not a destructive rewrite (§6.2a).
model PatientIdentityDocument {
  id             String       @id @default(uuid())
  patientId      String
  patient        Patient      @relation(fields: [patientId], references: [id])
  clinicId       String
  clinic         Clinic       @relation(fields: [clinicId], references: [id])
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id])
  docType        String
  valueEncrypted String
  lookupHash     String
  cryptoVersion  Int          @default(1)
  isVerified     Boolean      @default(false)
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  @@unique([patientId, docType])                 // one TCKN per patient — satisfied by all legacy data
  @@index([organizationId, docType, lookupHash]) // NOT unique — see §6.5
}
```

### 6.4 Lookup design — tenant-bound, and why an unkeyed hash is unacceptable

**R1 correction — the tenant-binding property is now stated as a required invariant, not an
implementation detail.** A single global `HMAC(globalPepper, normalizedTCNO)` — with no tenant input
in the hashed data — is **not accepted**: the same person produces the same stable lookup token in
every organization that happens to serve them, which makes the lookup column a **cross-tenant
correlator** readable by anyone with DB access, independent of the encryption boundary.

```text
IDENTITY_LOOKUP_TOKEN_TENANT_BOUND = YES
```

**Required invariant:** *the same normalized identity value in two different organizations must not
produce the same persisted lookup token.* Any uniqueness or indexing built on the lookup token must
also be tenant-scoped — `@@index([organizationId, docType, lookupHash])` in §6.3 already scopes on
`organizationId` first; that scoping is load-bearing, not incidental, and must not be dropped in
implementation.

A TC number is 11 digits with `d1 ≠ 0`, and `d10`/`d11` are checksums derived from `d1..d9`. The
valid space is therefore **≈ 9 × 10⁸**, not 10¹¹. A commodity GPU computes ~10¹⁰ SHA-256/s.

> **An unkeyed `sha256(tc)` column is exhaustively invertible in well under one second — it is
> plaintext with extra steps.** A keyed HMAC is not a hardening nicety; it is the entire security
> property, and on its own it is **not** sufficient — the tenant-binding property above is a second,
> independent requirement layered on top of it.

**Candidate designs** (both satisfy the invariant; the choice is deferred to schema-implementation
review, not decided here):

```text
Candidate A — org id folded into the hashed data, one global key:
  lookupHash = HMAC-SHA256(
    key  = identityLookupKey,                      // illustrative name; a single dedicated,
                                                     // isolated pepper (§6.2a) — never ENCRYPTION_KEY
    data = organizationId + ':' + docType + ':' + normalizedValue
  )

Candidate B — a per-organization derived lookup key, org id absent from the data:
  orgLookupKey = HKDF(identityLookupKey, salt = organizationId)   // or an equivalent per-org
                                                                    // derivation / envelope key
  lookupHash   = HMAC-SHA256(key = orgLookupKey, data = docType + ':' + normalizedValue)
```

| | Candidate A (org id in data) | Candidate B (org id in key derivation) |
| --- | --- | --- |
| Tenant-bound? | Yes — different `organizationId` ⇒ different hash input ⇒ different token | Yes — different `organizationId` ⇒ different derived key ⇒ different token |
| Key management surface | One key to escrow/rotate | One key to escrow + a derivation function to keep stable; a bug in derivation is a silent tenant-isolation failure |
| Blast radius of a leaked pepper | One leaked pepper decodes lookup tokens for **every** tenant (still cannot recover plaintext without the encryption key — §6.2a keeps that separate) | One leaked *derived* key exposes lookup correlation for one tenant only, if per-tenant keys are also stored separately rather than re-derived from one root |
| Complexity | Lower — matches the illustrative shape already in §6.3 | Higher — needs a documented, versioned derivation function |
| Recommendation | **Leading candidate for the next design stage**, on simplicity grounds | Documented as the alternative; revisit if per-tenant key isolation becomes a requirement independent of this migration |

- **Dedicated key, never `ENCRYPTION_KEY`, never shared with the patient-identity encryption key
  either (§6.2a).** The repo already states the "never reuse a general secret for a purpose-specific
  HMAC" rule in writing (`passwordStepUp.ts:12-13`, `:82-87`) and enforces it **per request,
  fail-closed** (`assertIpHashSecretConfigured()`, `:79-89`) — not merely at boot. Mirror that pattern
  for whichever candidate is chosen.
- **Search UX:** only when the query is exactly 11 digits **and passes the checksum**, compute the
  HMAC (Candidate A or B) and add `{ identityDocuments: { some: { lookupHash } } }` to the existing
  `where.OR` (`patients.ts:68-75`), scoped by the request's `organizationId` as it already is today.
  Otherwise it stays a name/phone/email search. **No plaintext TC ever reaches a log, a query string,
  or an ORM `contains`.** Substring search over an identity number is impossible by design — and
  undesirable anyway.
- **Recovery asymmetry worth recording:** if the patient-identity encryption key is lost but the
  lookup key/pepper survives, search still works while display is permanently dead; if the lookup
  key/pepper is lost but the encryption key survives, lookups can be **rebuilt** by decrypting and
  re-hashing (Candidate A) or re-deriving (Candidate B). Losing both is unrecoverable. **All key
  material must be escrowed.**

### 6.5 Uniqueness and legacy-data policy

**Decision: no cross-patient unique constraint at launch — same outcome as the prior draft, corrected
reasoning.**

**R1 correction — withdrawn claim.** The prior draft argued that duplicate TCs across patients are
**legitimate domain semantics**, citing `PatientEmergencyContact.isLegalDecisionMaker`'s documented
non-uniqueness as proof that "a parent's TC recorded against a minor" is an intentional, accepted
pattern. **That claim is withdrawn.** `isLegalDecisionMaker` documents *guardianship*, a relationship
concept that belongs to the guardian/relationship domain — it does not prove that recording a
guardian's identity number **on the child's own verified identity record** is correct behavior. The
source workbook may well contain exactly that pattern, but its presence there is **source ambiguity
and data-quality debt**, not evidence of a legitimate domain rule. The correct classification for a
cross-patient duplicate TC, using the §6.0 vocabulary, is:

```text
AMBIGUOUS       — is this a genuine duplicate, a shared-guardian entry, or a data-entry error?
MANUAL_REVIEW   — resolved by a human, not inferred or auto-merged
```

**No duplicate identity record is ever automatically merged.** This section does not adopt a design
that treats guardian-TC-on-child as correct; it only decides where the *constraint* sits, for reasons
that are independent of that question:

| Reason no hard DB unique constraint at this stage | Evidence |
| --- | --- |
| Unresolved legacy semantics | 30 duplicate values across 60 rows in the source; whether each is a genuine duplicate, a guardian-on-minor entry, or a data-entry error is **not determinable from the workbook alone** and needs manual collision resolution, not an inferred rule |
| Dirty-data migration compatibility | A hard unique constraint would hard-block those 60 real rows on day one, before any human has reviewed which ones are genuine collisions |
| Asymmetric cost | Adding a unique index later, after manual review, is additive. Discovering at migration time that 60 rows cannot be written is a blocked go-live |
| Precedent for a *soft* signal, not a *hard* one | The repo's established answer to a soft identifier is a **warning API, not a constraint** — `GET /patients/check-phone-duplicate` (`routes/patients.ts:36-42`) |

Keep `@@unique([patientId, docType])` — that *is* a genuine invariant and all legacy data satisfies
it. Detect cross-patient collisions in the application and surface a **soft duplicate warning for
manual review** — never an automatic merge, and never a claim that the duplicate is legitimate.

**Checksum**, enforced at write time via a zod `.refine()` mirroring the existing `dateOfBirth`
refine (`schemas/index.ts:29`):
`11 digits; d1 ≠ 0; d10 = ((d1+d3+d5+d7+d9)*7 − (d2+d4+d6+d8)) mod 10; d11 = (d1+…+d10) mod 10`.

**Migration classification — the patient row is never lost:**

| Case | Count | Classification | Action |
| --- | --- | --- | --- |
| Valid shape + valid checksum | ≤ 10,525 | `VALID` | Import; `isVerified = true` |
| 11 digits, checksum fails | subset | `INVALID_LEGACY` | **Do not write the document.** Emit `IDENTITY_CHECKSUM_INVALID`. **Patient still imports** |
| 10/12/13-digit or 12–20-char string | ~975 | `INVALID_LEGACY` | **Do not write.** `IDENTITY_SHAPE_INVALID` (sub-code `LIKELY_TAX_NUMBER` for 12-digit — see `VERGINO`). **Patient still imports** |
| Duplicate across ≥2 patients | 60 rows / 30 values | `AMBIGUOUS` → `MANUAL_REVIEW` | **Import the patient rows; do not auto-resolve or merge the identity records.** `IDENTITY_DUPLICATE_WARNING`, reporting **`HASTA_ID`s only — never the TC value** — routed for human collision review, not treated as legitimate by default |
| Blank | 3,390 | — | Skip; not an error |
| `SILINDI = true` legacy rows | 172 | — | **Do not import an identity document at all** — these arrive already `archived`; storing identity numbers for records the clinic has already deleted has no lawful purpose |

**Rationale for never blocking the patient row:** the merged contract reserves `BLOCK THE ROW` for
*data corruption* (float coercion), and records **0 triggers in this file**. Legacy dirt is not
corruption. Losing a patient because their 2016 TC entry has a typo is a worse outcome than
importing them without an identity document; the value stays recoverable from the source workbook.

**This is also where US-01.8 and the migration must deliberately diverge.** US-01.8's Gherkin says
*"numara 11 hane değilse veya algoritma doğrulamasından geçmezse **kayıt reddedilmeli**"* — reject
the record. That is right for a receptionist typing a TC off an ID card, and **wrong** for a
migration carrying a decade of legacy entries: applying it literally would reject ~975 patients.
**Same validation function, two different failure policies** — reject at the interactive form,
quarantine-and-report at the migration boundary. This must be stated explicitly or an implementer
will reuse the form's policy and silently lose patients.

### 6.6 Authorization and masking

Roles (`src/utils/permissions.ts:37-44`): `OWNER`, `ORG_ADMIN`, `CLINIC_MANAGER`, `DENTIST`,
`RECEPTIONIST`, `BILLING`, `ASSISTANT`; plus `PlatformAdmin` — a **flat superuser with no role tier**.

| Role | Default | Unmask to full | Rationale |
| --- | --- | --- | --- |
| `OWNER` | MASKED | ✅ audited | Data controller |
| `ORG_ADMIN` | MASKED | ✅ audited | Data controller |
| `CLINIC_MANAGER` | MASKED | ✅ audited | Runs front desk / insurance |
| `RECEPTIONIST` | MASKED | ✅ audited | **The role that actually types the TC off the ID card.** Denying unmask defeats the feature |
| `BILLING` | MASKED | ⚠️ **gated — ship MASKED-only** | e-Fatura needs the buyer TC, but **no e-invoice feature exists** (D-10). Revisit when it does |
| `DENTIST` | MASKED | ❌ | Clinically irrelevant; already the most restricted patient scope |
| `ASSISTANT` | **NONE** | ❌ | Not in the `authorize()` list for `GET /api/patients` at all |
| **`PlatformAdmin`** (ordinary APIs/UI) | **NONE — no unmask, no exception** | ❌ | `routes/platformAdmin.ts` touches patients only via `count()` and `_count` aggregates. **The platform has never read a patient row through its ordinary APIs. This must not be the feature that changes that.** Migration write-through is a distinct, separately-authorized capability — see §6.6a |

**Mask format: `*******1234`** — `***`+last-4 is the established convention
(`utils/logRedaction.ts:9-13`, `services/privacy/redaction.ts:182-186`), padded to 11 chars.
**Last-4 rather than first-3 is the deliberately lower-leakage choice:** `d10`/`d11` are
checksum-derived, so a last-4 mask exposes only 2 free digits (~9×10⁴ candidates after applying both
checksums), whereas a first-3 mask exposes 3 (~10⁴). **Compute the mask server-side; never send
plaintext and let the client mask.**

**Unmask must be audited fail-closed** via `writeAuditLogInTx()` (`utils/auditLog.ts:79-98` — *"if
either fails, both roll back together"*), **not** the fire-and-forget `writeAuditLog` whose errors
are swallowed (`:55-58`). Action `patient_identity_unmasked`; this extends the existing *view*-audit
precedent `patient_record_viewed` (`patients.ts:154-163`). **Audit metadata must carry `docType` and
`isVerified` only — never the value, never the ciphertext, never the lookup hash.** No sanitizer
will stop a mistake here: `auditLog.ts:50` and `platformAdminAudit.ts:52` are **pass-throughs**, and
`safeMetadata` is documented as *"caller's responsibility"*. Cover it with an exact-key `deepEqual`
test modeled on `tests/retentionManualRunAudit.test.ts:575-611`.

**No password step-up for a single-record unmask** — the 5-minute step-up window is calibrated for
bulk archive export and is far too heavy for a check-in desk. **Do** add a per-user hourly unmask
cap with a Postgres-authoritative counter modeled on `ClinicBulkExportPasswordAttempt`
(`schema.prisma:3171-3184`). **Bulk unmasking is the real exfiltration risk, not a single lookup.**

### 6.6a Platform Admin — split write from read (R1 correction)

**Withdrawn.** An earlier draft's "Platform Admin gets NONE" was overly broad — it conflated two
different capabilities that must be governed differently: **ordinary plaintext access to an
identity value**, and **the migration ingest pipeline's need to write encrypted identity data on the
customer's behalf**. The Platform Admin Migration Center (owned by `F3-DATA-MIG-013`) is, by design,
the operator of the migration — it must be able to move source identity data into the encrypted
destination without a human at the clinic re-entering it, and without that necessarily meaning
Platform Admin staff can *read* it back out in plaintext through ordinary tooling.

```text
PLATFORM_ADMIN_GENERAL_PLAINTEXT_READ      = NO
PLATFORM_ADMIN_GENERAL_UNMASK              = NO
PLATFORM_ADMIN_MIGRATION_WRITE_THROUGH     = YES
PLATFORM_ADMIN_MIGRATION_RAW_VALUE_LOGGING = NO
PLATFORM_ADMIN_MIGRATION_AUDIT             = YES
```

- **`PLATFORM_ADMIN_GENERAL_PLAINTEXT_READ = NO` / `PLATFORM_ADMIN_GENERAL_UNMASK = NO`.** Nothing in
  §6.6's role table changes: through the ordinary Platform Admin APIs and UI — the same surfaces used
  for support, billing, and operations — identity values remain inaccessible, exactly as the withdrawn
  "NONE" language intended for that surface.
- **`PLATFORM_ADMIN_MIGRATION_WRITE_THROUGH = YES`.** The migration service, running under Platform
  Admin authorization (`F3-DATA-MIG-013`'s scope), **ingests source identity data, normalizes and
  classifies it (§6.0's `VALID`/`INVALID_LEGACY`/`AMBIGUOUS`/`DUPLICATE_SOURCE`/`MANUAL_REVIEW`
  vocabulary), encrypts it under the dedicated identity key (§6.2a), and persists it** — without that
  pipeline exposing plaintext through any ordinary Platform Admin API or UI screen. This is a
  purpose-built, narrow write path, not a general read/write grant to the role.
- **`PLATFORM_ADMIN_MIGRATION_RAW_VALUE_LOGGING = NO`.** The migration pipeline is held to the same
  no-raw-PII-logging rule as §6.2a and §6.7 — a write-through capability is not an exemption from it.
- **Migration verification uses only:** masked values (§6.6's mask format), counts, row
  classifications (§6.0's vocabulary), checksums/tokens where safe (e.g. the lookup hash, never the
  plaintext or the encryption key), and audit metadata. **Not plaintext identity values.** A
  reconciliation report that needs to prove "the 10,525 valid TCs were written" proves it by count and
  classification, never by rendering the values.
- **`PLATFORM_ADMIN_MIGRATION_AUDIT = YES`.** Every migration write to `PatientIdentityDocument` is
  audited via the same fail-closed transactional path as unmask (`writeAuditLogInTx()`,
  `auditLog.ts:79-98`), carrying `docType`, classification, and outcome — never the value, the
  ciphertext, or the lookup hash, mirroring §6.6's unmask-audit rule.
- **Not implemented in this PR.** This section documents the required capability split for the next
  design/implementation stage; no migration write-through code, route, or authorization change is
  made here.

### 6.7 Audit, logging and anonymization consequences

- **Audit payloads will not auto-capture the value** — `ActivityLog` has only `description` and
  `metadataJson` (`schema.prisma:1025-1026`), there is **no `changes`/`before`/`after` column** and
  **no generic field-diff helper anywhere in `server/src`**. Every Patient audit write is a
  hand-enumerated literal. This is call-site discipline, not an enforced guarantee.
- **Two existing hazards not to inherit:** `ActivityLog.description` already carries raw patient
  names at four sites in `patients.ts` — never interpolate an identity number into a description.
  And `metadataJson` is **never scrubbed by anonymization** (`patientAnonymization.ts:431` rewrites
  only `description`), so a raw phone written at `routes/whatsapp.ts:1385` survives anonymization
  today.
- **Anonymization must explicitly destroy the identity record** — a hard `deleteMany` of the child
  row, not redaction or nulling. An identity number has no clinical value to preserve, unlike
  medical history. Skip and report rows under `legalHold`, mirroring `redactPatientAttachments`
  (`patientAnonymization.ts:72-101`, `:144-147`). **Under Option 2 this is one reviewable
  `deleteMany`; under Option 1 it would be three more keys buried in an already-"handled" deny-list
  payload that has demonstrably drifted (§4.4).**
- **Exports:** the **masked** value goes into the clinic bulk export
  (`clinicBulkExportFieldAllowlists.ts:49-72`); the **plaintext** value goes into the patient's own
  KVKK Art. 11 subject-access export (`patientPrivacy.ts:116-139`) — the data subject is entitled to
  their own identity number, and that download is already step-up-protected, one-time-claim, 1 h TTL.
- **Extend `DIRECT_PII_IDENTIFIER_NAMES`** (`scripts/log-privacy-guard/lib/scanner.ts:125`) with the
  chosen field names, add an unsafe fixture, and re-baseline. **Without this the guard is silent on
  the new field** (§4.6).

### 6.8 Key management, retention and backup — stated without softening

**Rotation does not exist** — no mechanism, no key-id column, no re-encrypt script, no schedule.
This is corroborated in three separate program documents, not inferred.

> **The decisive asymmetry.** Every current consumer of `ENCRYPTION_KEY` stores a **rotatable**
> secret: if the key leaks, you revoke the Meta token at Meta and re-save it. **A T.C. Kimlik No is
> immutable and lifelong — it cannot be rotated, because the "provider" is the Turkish state.**
> `ENCRYPTION_KEY` compromise is already classified SEV-1; putting 10,525 citizens' identity numbers
> behind that same never-rotated key raises the consequence of that SEV-1 from *"re-issue some API
> tokens"* to *"permanently disclosed national identifiers for a clinic's entire patient base."*
> **Mandatory mitigation: ship `cryptoVersion` from day one** so a future rotation is an additive
> backfill rather than a destructive rewrite.

**Retention.** There is **no hard-delete path for a patient anywhere** — `DELETE` is archive-only
(`patients.ts:362-365`), and the retention job explicitly excludes `Patient`
(`services/privacy/dataRetentionPolicy.ts:20-21`). Documented retention for patient identity data is
literally *"Süresiz"* (indefinite), and KVKK-HIGH-003 is `Waiting for legal review`.

> **Absent an explicit rule, an imported TC would sit encrypted in the database forever — including
> for the 172 already-soft-deleted rows.** That is a decision this task must force, not inherit.
> Recommended: archive → no change (archive is reversible); anonymization → hard delete;
> retention expiry → **delete identity documents first**, because an identity number is the
> highest-value / lowest-utility field on the record and should have the *shortest* retention, not
> the same indefinite one.

**Backup exposure.** The pgBackRest passphrase (`/etc/pgbackrest/pgbackrest.conf`, `0600 postgres`)
and `ENCRYPTION_KEY` (`server/.env`, root-owned) **live on the same host**, and both PM2 processes
run as root. The runbook already says repository encryption *"does not defend against compromise of
this host … Any claim broader than that is false."* Two further items a reviewer must weigh:

1. **The backup wrapper hands `ENCRYPTION_KEY` to an unreviewed external host script on every run** —
   `BACKUP_SCRIPT_ENV_ALLOWLIST` exists but is deliberately off by default. **Set it before the
   first TC is written**, not after.
2. **Escrow both `ENCRYPTION_KEY` and the new pepper** outside the failure domain of both hosts.
   Record names, never values.

> **Do not let this encryption decision be presented as closing KVKK-HIGH-001.** App-level AES-GCM
> on this column buys real protection against stolen backup media, provider staff and a leaked
> `pg_dump`. It buys **nothing** against production host compromise.

### 6.9 Classification note

`TCNO` is classified **`ID`**, a class the merged contract's own legend holds distinct from `PII`
and `SPECIAL`. The Kurul 31/01/2018-2018/10 özel-nitelikli measures are cited in the compliance
corpus only for **health** data. **A national identity number does not automatically trigger the
special-category control set**; its lawful basis sits in the ordinary identity/contact row (m.5/2-c).
This matters because it keeps the identity decision separate from the §10 special-category decision,
which is genuinely blocked on legal review.

---

## 7. Passport / nationality / health tourism — reconciliation with US-01.8

### 7.0 Module-boundary correction (R1, program-owner decision)

**Health Tourism / International Patient Operations is a separate future module, not part of Patient
Core or this migration.** Program-owner decision: it will be implemented later as its own modular-
monolith domain/add-on. **US-01.8 must not be used to justify pulling health-tourism workflows into
Patient Core or into this migration's implementation.** US-01.8 is used below **only as backlog and
requirements context** — evidence that the concepts exist and are unimplemented — not as authorization
to build them here or to widen this migration's scope.

**Explicitly deferred to the future Health Tourism module** — none of the following is created,
designed, or implemented by this document or by the migration: `healthTourismType`, the tourism
travel workflow, hotel bookings, transfer logistics, agency relationships, the tourism funnel,
tourism analytics, tourism-specific UI, and tourism entitlements/billing.

**Identity, passport, and nationality concepts may belong to Patient Core — but only where an
independent general patient-identity requirement justifies them, unrelated to the paid Health
Tourism module.** That independent requirement already exists and is documented in full in §6: the
program owner's `TC_NATIONAL_IDENTITY_FIRST_CUSTOMER_PRIORITY = P0_FIRST_CUSTOMER_BLOCKER` decision
is driven by ~11,500 populated domestic `TCNO` values in a **domestic, single-branch clinic's**
patient book (§7.1) — it has nothing to do with health tourism. Where §7.2 below recommends field
names for `nationality` or `passportNumber`, those recommendations are naming guidance **for the
general patient-identity model in §6**, in case a future need for them arises independent of
US-01.8 — they are not, and must not be read as, an authorization to build the Health Tourism module
now.

**US-01.8 exists.** It is `[KISMEN] US-01.8 · Sağlık turizmi alanları (uyruk, pasaport, dil, ülke
kodu)`, ClickUp `869ecymu1`, under `EPIC-01 · Hasta Yönetimi`, priority **Should**, assigned. Its
technical scope is verbatim: `nationality · identityDocType [TC/MAVI_KART/PASAPORT] · passportNo ·
phoneCountryCode · preferredLanguage · healthTourismType`.

**It exists only in ClickUp — there is no `US-01.8` string anywhere in the repository.** Repo
evidence and backlog evidence must therefore be combined deliberately: the backlog establishes that
the requirement *exists*; the repo establishes that **every one of its concepts is unimplemented**,
with one exception.

| Concept | Backlog | Prisma | Zod | API | UI | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| `nationality` | US-01.8 | ✗ | ✗ | ✗ | ✗ | NOT_IMPLEMENTED |
| `identityDocType` | US-01.8 (`TC/MAVI_KART/PASAPORT`) | ✗ | ✗ | ✗ | ✗ | NOT_IMPLEMENTED |
| TC identity number | US-01.8 + `TCNO` 77.2 % | ✗ | ✗ | ✗ | ✗ | NOT_IMPLEMENTED — **§6** |
| `passportNo` | US-01.8 + `PASAPORTNO` 0 % | ✗ | ✗ | ✗ | ✗ | NOT_IMPLEMENTED |
| **`phoneCountryCode`** | US-01.8 (*"Must-level dependency"* for E.164/WhatsApp) | **✓ `PatientEmergencyContact.phoneCountryCode` `:329`** | hand-rolled | ✓ (emergency contacts) | ✓ (`PatientEmergencyContactForm`, localized in all 4 locales) | **PARTIAL — implemented on the wrong model** |
| `preferredLanguage` | US-01.8 | ✗ on `Patient`. Related: `Clinic.defaultLanguage:19`, `MessageTemplate.language:935`, `ChannelConsentLog.locale:2283` | ✗ | ✗ | ✗ | NOT_IMPLEMENTED. **Outbound messaging picks language from the *clinic*, not the patient — a German patient at a Turkish clinic gets Turkish** |
| `healthTourismType` | US-01.8 + `TURIZM` unmeasured | ✗ | ✗ | ✗ | ✗ | NOT_IMPLEMENTED |
| staff-UI i18n | — | n/a | n/a | n/a | ✓ 4 locales (`src/i18n/config.ts:389-390`) | IMPLEMENTED — **staff UI only, not patient-facing** |

### 7.1 Verdict for the first customer

**The migration needs zero health-tourism fields.** Every tourism column with a measured value is
**0 % populated** (`UYRUK`, `PASAPORTNO`); three more are asserted empty (`ULKE`, `YUPASS_NO`,
`HTS_KODU`); and — a correction worth stating — **the four columns in the merged contract's own
"Health tourism" group (`ULKEGIRISTARIHI`, `ULKECIKISTARIHI`, `GELDIGIULKE`, `TURIZM`) were never
measured at all.** They appear in neither the §3 fill-rate table nor the §7 matrix. **Do not cite a
fill rate for them; none exists.**

The customer's profile is unambiguous: `TCNO` 77.2 % filled with well-formed 11-digit values,
`SUBE_ID` a single distinct value, passport and nationality empty. **This is a single-branch Turkish
clinic with a domestic patient book.** Adding tourism fields would import `NULL` for all 14,890 rows.

> **`TCNO` is a domestic-identity requirement, not a health-tourism one.** Conflating the two would
> over-scope a blocking migration gap behind a *Should*-priority product initiative. Solve G-2 in
> §6; let US-01.8 proceed on its own track.

### 7.2 Naming — avoid the duplicate-concept trap

| Concept | Recommended name | Reasoning |
| --- | --- | --- |
| Phone country code | **`phoneCountryCode`** | **Reuse verbatim** — `PatientEmergencyContact.phoneCountryCode` (`:329`) already exists, is localized in 4 locales, and defaults to `'+90'` in the UI. A divergent name on `Patient` would be a near-duplicate. Note it stores a **display prefix**, not E.164 — it does not close G-6 |
| National identity number | **`nationalIdNumber`** (or the `docType='TCKN'` row in §6.3) | Avoid `tcNo` — it locks a 4-locale product to one jurisdiction. Avoid bare `identityNumber` — too generic beside tax/social-security numbers |
| Passport | **`passportNumber`** | Repo style spells words out (`postalCode`, `phoneCountryCode`, `dateOfBirth`) and never abbreviates to `No`. **Reject `passportNo` despite both the workbook and the vendor API using it** |
| Nationality | **`nationality`**, ISO-3166-1 alpha-2 `String?` | ⚠ **Highest collision risk in the whole set: `Patient.country` (`:233`) is the *address* country and is already claimed by `ULKE`.** Both fields must carry `///` doc-comments disambiguating *citizenship* from *address country*. The vendor API uses an integer code (`213`); translate at the boundary |
| Patient language | **`preferredLanguage`** | Three divergent names already exist (`defaultLanguage`, `language`, `locale`). A 4th is regrettable, but `preferredLanguage` is the only one that signals *"the patient's preference, overriding the clinic default"*. Constrain to `['tr','en','de','fr']` |
| `identityDocType` | **Do not add as a separate scalar** | US-01.8 requests it, but §6.3's `docType` **already carries exactly this information** as part of the identity-document key. Adding a second discriminator on `Patient` would be the duplicate-concept error §4 of the brief warns against. **Satisfy US-01.8's requirement through `PatientIdentityDocument.docType`** — and extend its vocabulary with `MAVI_KART` when US-01.8 is implemented |
| Country of origin, entry/exit dates, `healthTourismType` | **Defer — do not name yet** | Unmeasured; the owning domain (PCM) is unbuilt. `GELDIGIULKE` would be a **third** country-ish field beside `country` and `nationality` |

**No Prisma `enum` should be introduced.** The schema uses `String` with the allowed values in a
`///` doc-comment throughout (`patientStatus`, `contactType`, `channel`, `purpose`). Follow it.

### 7.3 The real internationalization blocker is phone, not nationality

**8 divergent phone normalizers exist, not the 6 recorded as G-6** (§2 D-1). Only one — a
**route-local, non-exported const** at `routes/whatsapp.ts:227-254` — has any foreign-number
awareness (11-digit and 12-digit non-TR branches). Every other matcher will fail to link a German or
UK patient's WhatsApp number to their imported record. Nothing persists E.164: `whatsapp.ts:1369`
writes digits-only into `Patient.phone`, and `smsRouting.ts:28`'s `+90…` output is computed at send
time and discarded.

The 271 leading-zero-destroyed rows are reconstructable **only under a Turkish assumption**. A
10-digit `532…` is genuinely ambiguous between TR-with-lost-zero and a foreign number — **the
migration must classify, not guess.**

---

## 8. Gender recommendation

**R1 correction — the field remains a recommendation, not an accepted final contract.**

```text
GENDER_FIELD_REQUIRED      = YES
GENDER_DOMAIN_CONTRACT     = NOT_AUTHORIZED_YET
```

**Recommendation: add gender. `P1`, not `P0`.** This section previously called the basic importer's
published `male/female/other` template "decisive" evidence of a NoraMedi domain contract. **That
framing is corrected.** The importer's template column **validates and then discards** the value
(`patientsImport.ts:104` vs. `:335-348`, §2 D-2) — it is real, useful **repository evidence** that
the product has publicly *communicated* a vocabulary to customers, but a value that is validated and
thrown away is not proof of a **persisted domain contract**. No `gender` column exists anywhere in
`schema.prisma`, and this document does not authorize adding one.

| Question | Answer |
| --- | --- |
| Does NoraMedi represent gender anywhere today? | **No** — zero matches in `schema.prisma` |
| Does the product already *publish* a vocabulary to customers? | **Yes** — the basic importer's template (`excelImport.ts:55`), instruction sheet (`:100`), and validator (`patientsImport.ts:104`) all say `male/female/other`. **This is evidence a future contract should account for, not proof one already exists** — the value is discarded, never stored (§2 D-2) |
| Value model (illustrative, not authorized) | **`String?` with `male \| female \| other \| unknown`** in a `///` doc-comment — not a Prisma enum. **Exact field name and enum are decided at schema-implementation review**, not here |
| Nullable / unknown behavior | Yes, no default. The 20.7 % blank source rows map to `NULL` / unknown |
| `other` vs. unknown | **Not the same state.** `other` is an affirmative, patient-reported value; a blank/legacy row that was never asked is `NULL`/unknown. The value model must keep them distinct, not collapse an unanswered field into `other` |
| Legacy blank values | Remain `NULL`/unknown — never defaulted to any of `male`/`female`/`other` |
| Backward compatibility | Additive, nullable, zero backfill, if and when authorized |

**Do not change the existing basic importer.** §2 D-2's silent-discard defect stays exactly as
reported — out of scope, reported only, belongs to a separate future task.

> **If a `gender` field is later authorized, it should account for the vocabulary the product has
> already published (`male | female | other` plus a null/unknown state) rather than default to the
> source's 2-value `CINSIYET`** — but that alignment decision, the field name, and the enum are made
> at schema-implementation review, not asserted as settled here.

**Supporting evidence for the recommendation** (none of it converts the recommendation into an
authorized contract):

- **Source data is clean and substantial** — `CINSIYET` is 79.3 % filled with exactly 2 distinct
  values. It is the second-best-populated unmapped column in the file (11,807 real values).
- **A clinical consumer already exists.** `PatientMedicalHistory.pregnancyStatus`
  (`schema.prisma:405`) ships today and is clinically incoherent without sex.
- **The external vendor contract models it** — DigiDentiS `patient_gender` (integer; Male `1`,
  Female `2`, Default `0`). Note it is a **3-state model including an explicit unknown**, which
  corroborates the recommendation and translates cleanly at the boundary.
- **Not P0:** no current screen requires gender to create or treat a patient. The clinic can operate
  on day one without it. It is P1 because "full migration" cannot honestly be claimed while 11,807
  values are dropped — and because the field's absence is *already* causing silent data loss through
  the existing importer (§2 D-2).

**Ministry integrations** (e-Nabız / MBYS) are scheduled at month 3–6 in the product roadmap and
would require gender — but that is a supporting argument, not the basis for the recommendation.

---

## 9. Address and demographic decisions

| Field | Current state | Decision | Priority |
| --- | --- | --- | --- |
| `address` | `Patient.address` `:230` exists | **IMPORT.** Compose `MAHALLE` + `ADRESI` under a **documented, stable** rule — instability across reruns breaks idempotency | — |
| `city` | `Patient.city` `:231` exists | **IMPORT `IL` → `city`.** ⚠ Free text with **no canonicalization** — no province lookup table exists anywhere in the repo, so `İSTANBUL`/`Istanbul`/`ISTANBUL` will coexist | P2 to normalize |
| `district` | **Absent** | **ADD `Patient.district`.** Structurally required for Turkish addresses. Only ~13 source rows, so **not a first-customer blocker** | **P2** |
| `postalCode` | `Patient.postalCode` `:232` exists | **DO NOT MAP `ADRES_KODU` YET.** `MANUAL_REVIEW` pending a digit-length histogram — a 10-digit UAVT code written into `postalCode` silently corrupts a typed field (C-2) | P1 to resolve |
| `country` | `Patient.country` `:233` exists | **Keep the mapping** for `ULKE` even at 0 % fill (C-3). ⚠ It is API-writable but **has no UI input** — `PatientForm.tsx` holds `country` in state with no rendered control. A pre-existing dead field | P2 |
| Reference tables | **None exist** — no province, district, or country lookup data anywhere in the repo | US-01.8's DoD requires *"Ülke/İl/İlçe cascading lookup tabloları seed edildi"*. **Net-new work, owned by US-01.8, not by the migration** | P2 |
| Birth place (`DOGUMIL`/`DOGUMILCE`), marital status, occupation, education, parent names | Absent | **DEFER** — all unmeasured, no identified product consumer. `EGITIMDURUMU` and `HATIRLAT`: **recommend NOT building** | DEFER |

---

## 10. Consent / KVKK source-field decision

**Default: never invent consent. All 14,890 migrated patients enter at `unknown` /
`communicationConsent = false` / `marketingConsent = false`.**

| Source field | Fill | Classification |
| --- | --- | --- |
| `KVKKONAYKODU` | **0 %** | `INSUFFICIENT_EVIDENCE` — nothing to migrate |
| `KVKKSMS` | **0 %** | `INSUFFICIENT_EVIDENCE` — nothing to migrate |
| `KVKKILKKODU` | 31.9 %, 4,633 distinct of 4,754 | **`HISTORICAL_METADATA_ONLY`.** A near-unique **record identifier in another register**, not a consent state. Retained in the run record only. **K-4: if it references a consent-form archive, that archive is requestable and could be genuine `evidenceType`** |
| `MESAJOK` | UNKNOWN | **`IGNORE`** — operational flag |
| `SMSGONDERILDI` | UNKNOWN | **`IGNORE`** — delivery evidence, not consent |
| `SMSBORCTARIH`, `SMSODEMETARIHI` | UNKNOWN | **`IGNORE`** — must never be read as consent or opt-out evidence |
| `HATIRLAT` | UNKNOWN | **`IGNORE`** — **hard rule: never map to any consent field.** Its only realistic use is the forbidden mapping; recommend not building a destination at all |
| `CHECKBOX` | UNKNOWN | **`LEGAL_REVIEW_REQUIRED` if profiling shows consent-like semantics.** An unlabelled boolean must never be auto-mapped |

NoraMedi's authoritative model is `PatientCommunicationPreference` (`schema.prisma:2314-2375`);
`setCommunicationPreference()` enforces `evidence_required` — a `granted` state **cannot** be written
without a real `evidenceType`. `source: 'import'` is a legal enum value but is still evidence-gated.
`PatientCommunicationConsentEvent` is append-only and service-owned and **must never be written
directly by a migration**.

> **A commercial consequence that is not currently recorded as such:** all 14,890 migrated patients
> arrive **non-messageable on day one**. This is technically correct and legally required — but it is
> a first-customer *expectation* problem, not a technical one, and the customer will discover it
> immediately. It belongs in the go-live conversation, not in a defect report. `K-5` (does the
> customer hold signed KVKK forms?) is the only route to changing it, and even then only through
> `setCommunicationPreference()` with genuine per-patient evidence — never by bulk default.

---

## 11. Clinical special-category decision

**All of `KANGURUBU`, `ONEMLINOT`, `UZUNNOT`, `KONTROLNOTU` → `BLOCKED_LEGAL_DECISION`.**

- **Legal basis:** KVKK Art. 6 special category. Unresolved. `BLOCKED_LEGAL_DECISION` is the correct
  state and this task does not attempt to settle it.
- **Do not import into generic `Patient.notes`.** The destination technically exists
  (`schema.prisma:236`) — the blocker is purely legal, which makes this *more* dangerous, not less,
  because nothing in the code would stop it.
- **A second, independent reason not to use `Patient.notes` — it is write-only from the UI.**
  `PatientForm.tsx` holds `notes` in state but **renders no input control**; the detail page displays
  it read-only as "Clinical Alerts", and its only writer in the entire product is the Excel importer.
  **Special-category clinical text imported there could not be edited or removed by clinic staff
  through any interface** — which would make a KVKK rectification or erasure request unserviceable
  without a developer. That is disqualifying on its own, before the legal question is even reached.
- **Correct domain ownership:** clinical content belongs in `PatientMedicalHistory`
  (`schema.prisma:372-425`) — already versioned, already documented as special-category, already
  additive. A blood-type field belongs there (`G-E11`), **not** on `Patient`, and must join the
  anonymization redaction path alongside `allergies` (`:396`).
- **Measurement correction (C-7):** only `UZUNNOT` is measured 0 % and `KANGURUBU` at 1 row.
  **`ONEMLINOT` and `KONTROLNOTU` were never measured.** The merged contract's *"Empty in this file"*
  is unsupported for them — and they are precisely the two most likely to hold clinical free text.
  **Profile them before the legal question is even asked**, because the answer's cost depends on the
  volume.
- `EK_ACIKLAMA` → `MANUAL_REVIEW`: if it holds clinical text it becomes `BLOCKED_LEGAL_DECISION`; if
  purely administrative, `IMPORT_AFTER_NORMALIZATION` into `notes`. **Not decidable from the column
  name.**

---

## 12. Provenance / source-ID decision

**`HASTA_ID` is migration provenance, never patient business identity.** It is 100 % populated and
14,890/14,890 unique — the only viable key, since phone (28.6 % shared) and name (25.7 % colliding)
are empirically disproven. **It must never be surfaced as the patient's medical identity.**

**No design is adopted here.** The merged contract's §6.1 candidates stand, with this document's
added evidence:

| | Design (a) — provenance on `Patient` | Design (b) — separate provenance/mapping tables |
| --- | --- | --- |
| Shape | `Patient.sourceSystem` + `sourceExternalId`, `@@unique([organizationId, sourceSystem, sourceExternalId])` | `MigrationRun` + `MigrationImportedRecord`, `@@unique([runId, entityType, sourceId])` |
| Blast radius | **Alters `Patient`** — and per §4.3 **auto-leaks the vendor source id to every clinic client** through the whole-record spread | **Zero existing models touched** |
| Freeze framing | The merged contract already calls this *"the materially larger ask"* | Matches the additive-new-table category, closest to the R-079 precedent |
| Recommendation | — | **Design (b) is the lower-risk starting point**, for the same auto-leak reason that decides §6.2. **Not adopted — architecture review owns this** |

**Relationship to F3-DATA-MIG-004:** the provenance store is that task's deliverable. This document
supplies the requirement (`sourceSystem`, `sourceEntity`, `sourceId`, destination reference,
**tenant-scoped** uniqueness) and the evidence that `HASTA_ID` satisfies the `sourceId` role. A
globally unique index over vendor source ids would itself be a cross-tenant hazard.

**A zero-migration foundation exists and should be built regardless of the outcome** — dry-run
classification and reporting need no durable provenance because a dry-run writes no domain rows.
This is why PRs 0–3 are not blocked by this decision.

**Also retained as run metadata, not as patient fields:** `KAYITTARIHI` + `KAYITSAATI` (10 years of
registration tenure — **do not overwrite `Patient.createdAt`**, which is `@default(now())` and means
"row created in NoraMedi"), `KAYDEDEN`, and `KVKKILKKODU`.

---

## 13. Practitioner reference-mapping contract

Measured: `HASTADOKTOR` 99.5 % filled, **25 distinct opaque labels**. K-3 (do they map 1:1 onto
NoraMedi practitioners?) remains **UNVERIFIED**.

**Mapping key:**

```
(sourceSystem, organizationId, entityType='practitioner', sourcePractitionerValue) → User.id
```

`sourceSystem` is mandatory — two vendors will both emit `Dr. Ahmet Yılmaz`. Uniqueness is
**tenant-scoped**. `sourcePractitionerValue` is stored **byte-exact as exported** — no trimming, no
case folding, no Turkish-locale casing, no diacritic stripping. Normalization may be *computed* for
display and proposal ranking, but the stored key is raw, or reruns silently re-key.

**States:** `UNMAPPED` → every row carrying it classifies `MAPPING_REQUIRED` ·
`MAPPED_APPROVED` · `MAPPED_IGNORED` (explicitly "do not carry") · `CONFLICTED` → run halts.

**Prohibitions — non-negotiable:**

1. **No fuzzy matching.** No Levenshtein, no trigram, no normalized-name equality, no threshold
   matching, no LLM adjudication. Exact byte equality or `UNMAPPED`.
2. **No auto-create of `User` rows.** `User` carries `passwordHash`, `role`, `email` and
   `commissionRate` — a migration-created practitioner is a **credentialed, payable account**
   created without an onboarding decision.
3. **No partial application.** All 25 reach `MAPPED_APPROVED` or `MAPPED_IGNORED`, or
   practitioner-dependent execution does not start. Patient-only import is exempt.
4. **No inference from `SUBE_ID`** — 1 distinct value, 39 % blank; it carries no practitioner signal.
5. **Approval is human and attributed** — recording the approving Platform Admin, timestamp and exact
   source value. Frontend selection is not approval evidence.
6. **The same contract governs `KAYDEDEN`** if ever resolved (`entityType='staff_user'`).

**Ownership:** `F3-DATA-MIG-002` defines the contract **now** (key shape, states, prohibitions, and
the two structural gaps G-E2/G-E3). `F3-DATA-MIG-006` implements the store, the approval UI/API and
the 25-value resolution (closing K-3), extended to services and branches. `F3-DATA-MIG-013` owns
Platform-Admin-only authorization for those endpoints.

---

## 14. Proposed additive schema package — PROPOSAL ONLY

```text
SCHEMA_CHANGE_RECOMMENDED = YES
SCHEMA_CHANGE_AUTHORIZED  = NO   (NOT_AUTHORIZED_YET — program-owner architecture review required)
MIGRATION_CREATED         = NO
```

All items are **additive, expand-migrate-contract, no destructive change**. Ordered by priority.

| ID | Field / model | Why required | Source need | Security | Backward compat | Index | Unique | Encryption | Rollback | Task | P0? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **G-E1** | Provenance store — design (a) or (b), §12 | Idempotent rerun, rollback, reconciliation | `HASTA_ID` 100 %, 14,890 unique | OPS | (b) fully additive; (a) alters `Patient` | `(runId, entityType)` | `@@unique([runId, entityType, sourceId])` **tenant-scoped** | NO | drop additive tables | MIG-004 | **YES** |
| **G-E4** | `PatientIdentityDocument` (§6.3, `CANDIDATE_ACCEPTED_FOR_NEXT_DESIGN_STAGE`) | No identity storage exists | `TCNO` 77.2 % (11,500) | **ID# — highest in codebase** | additive child model; `Patient` untouched | `@@index([organizationId, docType, lookupHash])` — tenant-scoped | `@@unique([patientId, docType])` only | **YES — mandatory, dedicated key separate from `ENCRYPTION_KEY`** (§6.2a) + tenant-bound HMAC lookup (§6.4) | drop model | MIG-003 | **YES — P0 (§6.0, §15, program-owner decision R1)** |
| **G-E5** | `Patient.gender` `String?` (§8) | No gender field; product already promises one | `CINSIYET` 79.3 % | PII | nullable, no default, zero backfill | none | none | NO | drop column | MIG-002 | NO — P1 |
| **G-E2** | `MigrationReferenceMap` | `User`/`AppointmentType` have no provenance | `HASTADOKTOR` 25 distinct | OPS | fully additive | `(sourceSystem, entityType, status)` | `@@unique([organizationId, sourceSystem, entityType, sourceValue])` | NO | drop table | MIG-006 | NO — P1 |
| **G-E3** | `Patient.primaryPractitionerId` FK? | Resolved `User.id` has nowhere to land (C-8) | `HASTADOKTOR` 99.5 % | OPS | nullable, zero backfill | `@@index([clinicId, primaryPractitionerId])` | none | NO | null then drop | MIG-006 | NO — P1 |
| **G-E6** | `Patient.chartNumber` (+ branch/sub) | Legacy chart lookup; paper-archive resolution (C-6) | `DOSYANO` **UNMEASURED** | OPS | nullable | `@@index([clinicId, chartNumber])` | **NOT unique** until fill+collisions measured | NO | drop columns | MIG-005 | NO — P1 *conditional on measurement* |
| **G-E7** | `Patient.district` | TR addresses need province+district | `ILCE` ~13 rows | PII | nullable | none | none | NO | drop column | MIG-002 | NO — P2 |
| **G-E20** | `Patient.familyGroupKey` | Explains the 28.6 % shared-phone population | `AILEGURUBU` **UNMEASURED** | PII | nullable | `@@index([clinicId, familyGroupKey])` | none | NO | drop column | MIG-005 | NO — P2 |
| **G-E8** | `Patient.alternatePhone` (+label) | One phone field only (C-5) | 0.3 % / 1.1 % | PII | nullable. **Must be excluded from `@@index([clinicId, phone])` matching** or it changes the shared-phone invariant | none | none | NO | drop columns | MIG-002 | NO — P2 |
| **G-E9 / G-E10** | `nationality`, health-tourism block | US-01.8 | **0 % / UNMEASURED** | PII | nullable | optional | none | NO | drop columns | US-01.8 | **NO — explicitly disqualified for this customer** |
| **G-E11** | `PatientMedicalHistory.bloodType` | Emergency clinical safety | `KANGURUBU` 1 row | **SPECIAL** | additive to the versioned model; must join anonymization | none | none | per legal decision | drop column | MIG-002 | NO — DEFER |
| **G-E18** | `Patient.referredBy` free text | `source` is enum-constrained | `REFERANSI` UNMEASURED | PII | nullable; **must not alter the `source` enum** | none | none | NO | drop column | MIG-002 | NO — P2 |
| **G-E19** | `CorporateAccount` + FK | No corporate concept exists | `KURUMREFERANSI` etc. | OPS/FIN | additive model + nullable FK | `@@index([organizationId])` | `@@unique([organizationId, name])` | NO | drop FK then model | MIG-006 | NO — P2 |
| **G-E23 / G-E24** | `Patient.insuranceType`, `recallIntervalMonths` | Avoids fabricating an `InsuranceProvision`; per-patient recall cadence | UNMEASURED | FIN / OPS | nullable, no default | none | none | NO | drop columns | MIG-006 / -002 | NO — P2 |
| **G-E12…17, 21, 22, 25, 26** | parent names, birth place, title, marital status, education, price list, discount, reminder flag, tax office | Completeness only | all UNMEASURED | PII/FIN | nullable | none | none | NO | drop columns | MIG-002/-003 | **NO — DEFER.** `EGITIMDURUMU` and `HATIRLAT`: **recommend NOT building** |

**Mandatory proof if any of this is later authorized** (per the merged contract §12 and the
compliance corpus): `prisma migrate deploy` against a fresh empty disposable DB, then
`prisma migrate diff --from-config-datasource … --to-schema …` producing **zero** statements for the
owned tables, plus a schema-integrity regression guard in the style of
`server/src/tests/kvkkHigh007High008SchemaIntegrity.test.ts:37-45`, plus an `ALTER TABLE ADD COLUMN`
lock-duration review against pilot table sizes.

---

## 15. First-customer blocker ranking

**R1 correction.** This section previously ranked `G-E4` (identity documents / `TCNO`) as
`P1_REQUIRED_BEFORE_FULL_MIGRATION`, reasoning from *current product consumption* (no route or report
reads an identity number today). **The program owner has corrected that reasoning (§6.0):** the
relevant test for a full clinic migration is not "does NoraMedi consume this field today" but "is this
a major, well-populated patient identity dataset that a *complete, controlled* migration would
otherwise silently discard." ~11,500 populated `TCNO` values fail that test as a P1. **`G-E4` moves to
`P0_FIRST_CUSTOMER_BLOCKER`, alongside `G-E1`.**

### `P0_FIRST_CUSTOMER_BLOCKER` — two, by program-owner decision (R1)

**G-E1, the provenance store.** The only gap justified purely on **measured** evidence: `HASTA_ID` is
100 % filled and perfectly unique, and every alternative key is empirically disproven (28.6 % shared
phones, 25.7 % colliding names). Without a durable `HASTA_ID → Patient.id` record, a rerun duplicates
14,890 patients, rollback cannot identify what the run wrote, and reconciliation cannot close. **Every
other gap can be backfilled later *through* G-E1; G-E1 cannot be backfilled through anything.**

**G-E4, the secure identity document model.** Promoted from P1 by program-owner decision (§6.0):
`TCNO` is 77.2 % filled — **11,500 real values**, the second-most-populated PII field in the source
after name and DOB. Discarding it would mean the "full clinic migration" silently drops a major
identity dataset, which the program owner has ruled unacceptable regardless of whether any current
NoraMedi route consumes the value. **Patient execution must not start until an accepted secure
identity destination design exists** (§6.0) — that design (§6.1–§6.6a) is
`CANDIDATE_ACCEPTED_FOR_NEXT_DESIGN_STAGE`, not yet `SCHEMA_IMPLEMENTATION_AUTHORIZED`, so **G-E4 is a P0 blocker on the
design/authorization step, not on this document delivering working code.**

**Relationship between the two P0s:** G-E1 (provenance) and G-E4 (identity) are independent gaps that
happen to share a priority tier — G-E1 blocks safe rerun/rollback of *any* patient row; G-E4 blocks
completeness of the identity data specifically. Resolving one does not resolve the other; both must
clear before patient execution starts.

### `P1_REQUIRED_BEFORE_FULL_MIGRATION`

`G-E5` gender · `G-E2` reference map · `G-E3` practitioner FK · `G-E6` chart number *(conditional on
an unmade measurement)*.

### `P2_PRODUCT_ENHANCEMENT`

`G-E7` district · `G-E20` family group · `G-E8` alternate phone · `G-E9`/`G-E10` nationality and
health tourism · `G-E18` referredBy · `G-E19` corporate accounts · `G-E23` insurance type ·
`G-E24` recall interval · address canonicalization.

### `DEFER`

`G-E11` blood type *(1 row + a legal gate — two independent reasons)* · `G-E12` parent names ·
`G-E13` birth place · `G-E14` title · `G-E15` marital status · `G-E17` education *(no consumer —
recommend not building)* · `G-E21` price list · `G-E22` discount · `G-E25` reminder flag *(recommend
not building)* · `G-E26` tax office.

> **Explicitly stated, because it is the discipline this ranking depends on:** `UYRUK`,
> `PASAPORTNO`, `SOSYAL_GUVENCE_NO`, `ENABIZTAKIPNO`, `KVKKONAYKODU` and `KVKKSMS` are **measured at
> 0 % fill** in this customer's file. `KANGURUBU` is 1 row; `RISK_TUTARI` 2 rows; `TEDAVIDURUMU` 3
> rows. **None can be a first-customer blocker — there is no data to lose.** Any future ranking that
> promotes them must cite a *different* customer's measured export, not this one. Equally: fields
> marked UNMEASURED cannot be ranked P0 either, because the measurement that would justify it has not
> been taken.

---

## 16. ClickUp task mapping

All task IDs verified to exist. **No ClickUp task was created, updated or transitioned by this
task** — lifecycle updates are the program controller's.

| Task | ID | Findings owned |
| --- | --- | --- |
| `F3-DATA-MIG-001` — source export & inventory | `869egwvze` | §3 dataset register (D-1…D-20, incl. 4 datasets merged §5 omits) · §3.2 the `HASTA_ID` export condition · §3.3 the 14 ambiguous columns · **C-1 (re-emit the header row)** · C-2 `ADRES_KODU` histogram · C-7 profile `ONEMLINOT`/`KONTROLNOTU` · `EK_ACIKLAMA` and `CHECKBOX` profiling · **D-3 the DigiDentiS vendor hypothesis** |
| `F3-DATA-MIG-002` — mapping & contract | `869egww04` | §5 the full 91-column matrix · §5.1 counts · C-3…C-6, C-9, C-10 · §8 gender · §9 address · §10 consent · §11 special-category · §13 the mapping contract *definition* |
| `F3-DATA-MIG-003` — identity model | `869egww36` | **§6 in full** — model shape, encryption, lookup HMAC, uniqueness, checksum, masking, authorization, audit, retention, backup, `cryptoVersion` · G-E4 · the US-01.8 validation-policy divergence (§6.5) |
| `F3-DATA-MIG-004` — staging / batch / idempotency | `869egww5m` | §12 provenance candidates · G-E1 · `KVKKILKKODU`, `KAYITTARIHI`, `KAYITSAATI`, `KAYDEDEN` as run metadata |
| `F3-DATA-MIG-005` — patient master import & duplicates | `869egww76` | Row-level import behaviour · `SILINDI` → `archived` · phone normalization consumption · G-E6, G-E20 · the shared-phone impact report |
| `F3-DATA-MIG-006` — practitioner / branch / service mapping | `869egww97` | §13 implementation · G-E2, G-E3, G-E19, G-E21, G-E23 · K-3 |
| `F3-DATA-MIG-013` — Platform Admin Migration Center | `869egwwqj` | §6.6 authorization matrix · §6.6a write/read capability split (no general plaintext read/unmask; scoped migration write-through, audited) · mapping-endpoint authorization |
| `US-01.8` — health tourism fields | `869ecymu1` | §7 in full · G-E9, G-E10 · `phoneCountryCode` reuse · `preferredLanguage` · **`identityDocType` satisfied via `PatientIdentityDocument.docType`, not a duplicate scalar** · the cascading lookup tables in its own DoD |

### 16.1 Pre-existing defects — R1 classification (not to be silently absorbed into migration work)

**These findings are accepted evidence, produced by inspecting the existing product while
researching the migration.** They are correctly separated so they are never quietly folded into a
migration-implementation PR's scope. Classified per program-owner instruction:

```text
PRE_EXISTING          = YES
CAUSED_BY_MIGRATION   = NO
SEPARATE_TASK_REQUIRED = YES
```

applies to each of the five findings below. **No existing ClickUp task was identified in this pass
that already covers any of them** — this document does not invent duplicate tasks; it recommends the
program owner open (or point to) the smallest task that fits each, if one already exists outside the
scope this task searched.

1. **New `Patient` scalar auto-exposure through broad API projection** (§4.3) — `GET/POST/PUT
   /api/patients` use `include:`/whole-record spreads with no top-level `select:`
   (`routes/patients.ts:167-191`, `:273`, `:296`, `:337`), so any future scalar added to `Patient`
   ships to every authorized clinic role's client with zero code change. `PRE_EXISTING = YES` ·
   `CAUSED_BY_MIGRATION = NO` · `SEPARATE_TASK_REQUIRED = YES`.
2. **Patient anonymization / export field-list schema drift is fail-open** (§4.4) — the
   anonymization deny-list, the KVKK subject-access allow-list, and the clinic bulk-export allow-list
   already disagree with each other and with `schema.prisma` (`smsOptOut`/`smsOptOutAt` drift), and no
   test asserts allow-list-vs-model parity. `PRE_EXISTING = YES` · `CAUSED_BY_MIGRATION = NO` ·
   `SEPARATE_TASK_REQUIRED = YES`.
3. **The log-privacy guard does not recognize national identity fields** (§4.6) —
   `DIRECT_PII_IDENTIFIER_NAMES` (`scripts/log-privacy-guard/lib/scanner.ts:125`) covers only
   `email`/`phone`; it would stay silently green on a new `nationalId`/`tckn`/`identityNumber` field.
   `PRE_EXISTING = YES` · `CAUSED_BY_MIGRATION = NO` · `SEPARATE_TASK_REQUIRED = YES`.
4. **`primaryClinicId` runtime population gap** (§2 D-7) — no runtime create path sets
   `Patient.primaryClinicId`; only a one-off script does
   (`server/src/scripts/migrate-to-multibranch.ts:139-140`), yet the organization dashboard counts by
   it (`patientOrganizationMetrics.ts:46,49`). Imported patients would be invisible to that dashboard
   unless the migration explicitly decides to set it. `PRE_EXISTING = YES` ·
   `CAUSED_BY_MIGRATION = NO` · `SEPARATE_TASK_REQUIRED = YES`.
5. **Accent-insensitive Patient search gap** (§2 D-6) — `routes/patients.ts:68-75` uses
   `ILIKE`-style `contains`/`mode:'insensitive'` with no `unaccent`/`citext`/`pg_trgm` anywhere in 75
   migrations, so `Şahin` ≠ `Sahin`. A direct hazard for a Turkish legacy dataset's post-migration
   duplicate review. `PRE_EXISTING = YES` · `CAUSED_BY_MIGRATION = NO` · `SEPARATE_TASK_REQUIRED =
   YES`.

### 16.2 Other cross-cutting items with no natural home

Recommend the program owner assign them; same non-absorption principle as §16.1, lower individual
severity:

- **§2 D-2** — the basic importer's silent `gender` drop. **Inside the out-of-scope boundary; needs
  its own task.**
- **§2 D-1 / G-6** — 8 phone normalizers, not 6; only a non-exported route-local const handles
  foreign numbers.
- **§2 D-8** — three incompatible `source` vocabularies; production already holds values the write
  schema rejects.
- **§2 D-9** — `Patient.notes` has no UI control; `postalCode`/`country` have no writer at all.
- **D-10** — invoice history is unmigratable by construction; no invoice model exists.

---

## 17. What the program owner needs to decide

Only genuine owner decisions. Everything else above is a recommendation with evidence attached.

1. ~~Is identity data in scope for first-customer go-live?~~ **DECIDED, R1 (§6.0):**
   `TC_NATIONAL_IDENTITY_FIRST_CUSTOMER_PRIORITY = P0_FIRST_CUSTOMER_BLOCKER`. Identity data is in
   scope for the full clinic migration; `G-E4` is `P0`. What remains open is **not** whether it is in
   scope, but the design and authorization steps below (items 2–2b).
2. **Approve, reject, or send back for revision the `PatientIdentityDocument` candidate architecture**
   (§6.1–§6.6a): the child-model shape (§6.3, `CANDIDATE_ACCEPTED_FOR_NEXT_DESIGN_STAGE`), the
   dedicated crypto-key-separation requirement (§6.2a), the tenant-bound lookup design and its choice
   between Candidate A / Candidate B (§6.4), the no-hard-unique-at-launch policy (§6.5), and the
   Platform Admin write-through/read split (§6.6a). **`SCHEMA_IMPLEMENTATION_AUTHORIZED = NO`** until
   this review completes — this is the P0 blocker's actual critical-path step, not a schema PR.
2a. **Name the dedicated key material and its custodian** — accepting that a new, isolated secret
   (illustrative name `identityLookupKey` / equivalent for the encryption key) enters the environment,
   **separate from `ENCRYPTION_KEY`** (§6.2a), with its own escrow and rotation story.
2b. **Choose Candidate A vs Candidate B for the tenant-bound lookup HMAC** (§6.4), or request a third.
3. **Provenance design (a) vs (b)** (§12). Blocks PR 4 onward; blocks nothing in PRs 0–3.
4. **Special-category legal decision** (§11) — `KANGURUBU` and the clinical note columns. Requires
   legal input, not engineering.
5. **Plan limits.** `PLAN_LIMIT_DECISION_REQUIRED_BEFORE_EXECUTION = YES` — 14,890 patients against a
   `Clinic.maxPatients` default of 500. A commercial decision, reached long before any schema question,
   and the full migration **must not silently bypass commercial/entitlement limits**. Dry-run must
   report, before any execution decision is made: source active patient count; destination current
   count; resulting count after the run; the organization's plan cap; the clinic's cap; and whether
   execution is blocked or allowed against those caps. See §18a.
6. **Consent expectation with the customer** (§10) — the entire migrated base arrives
   non-messageable. Needs to be said out loud before go-live, not after.
7. **Request the remaining vendor exports** (§3.1), now including the odontogram, payment plans, lab
   orders and the binary corpora — **with `HASTA_ID` as an acceptance condition** (§3.2).
8. **`.xls` parser dependency** (unchanged from merged §19 item 1) — a supply-chain decision.
9. **Mandatory MFA for Platform Admin migration routes** (unchanged from merged §19 item 5).

---

## 18. Next implementation task

**Recommended: `F3-DATA-MIG-001` (targeted re-profiling), *not* `F3-DATA-MIG-PR0`.**

PR 0 is genuinely unblocked and needs no schema change — but it is not the highest-value next step,
because **this document's own matrix cannot be certified complete until a short, cheap measurement
pass is done**, and several dispositions above are explicitly gated on it:

| Must measure | Unblocks |
| --- | --- |
| **The verbatim 91-column header row** | C-1 — no mapping profile can be frozen while one column is unnamed |
| `ADRES_KODU` digit-length histogram | C-2 — `postalCode` mapping, currently `MANUAL_REVIEW` |
| `ONEMLINOT`, `KONTROLNOTU` fill | C-7 — sizes the special-category legal question before it is asked |
| `DOSYANO` fill + collisions | G-E6's priority, currently P1-conditional |
| `AILEGURUBU` fill + correlation with shared phones | G-E20 — could materially improve the dedup report |
| `EK_ACIKLAMA`, `CHECKBOX` content shape | Their `MANUAL_REVIEW` dispositions |

This is a **read-only profiling pass over a file that is already available**, using the same
scratchpad-only reader as the merged analysis. It creates no code, no schema and no PR risk, and it
converts six "UNMEASURED" cells into rankable evidence. It is measured in hours.

**Then `F3-DATA-MIG-PR0`** (Platform Admin intake safety foundation — no schema, no domain writes),
followed by PR 1 once the parser dependency is decided.

**Dependency reality:** `F3-DATA-MIG-003` cannot be *implemented* before owner decisions 1–2, and
`F3-DATA-MIG-005` (patient execution) cannot start before the §12 provenance decision. Neither
blocks PR 0.

---

## 19. Accepted findings, unknowns and safety

### Accepted findings

1. `Patient` has **no** identity, gender, nationality or district field; **no unique constraint of
   any kind**; and its detail/create/update routes return the whole record.
2. **12 of 91 source columns (13.2 %) reach a NoraMedi field today; 40 (44 %) have no destination.**
3. The only viable migration key is `HASTA_ID`. Phone and name are empirically disproven.
4. The product's **only** reversible encryption is non-deterministic AES-256-GCM over machine
   secrets, with **no key rotation**; no patient PII column is encrypted.
5. The CI log-privacy guard would be **silently green** on a new identity field.
6. **The existing basic importer already collects gender and silently discards it** — the product
   promises a `male/female/other` vocabulary it does not store.
7. Health-tourism fields are **not** a first-customer concern: every measured tourism column is 0 %.
8. US-01.8's TC validation policy (**reject**) and the migration's (**quarantine**) must deliberately
   differ, or ~975 patients are lost.
9. **No schema-drift guard exists for any Patient field list — anonymization is fail-open.** A new
   column breaks nothing in CI and is silently absent from both exports and from erasure.
10. **Patient search is not accent-insensitive** and cannot use an index — a direct hazard for a
    Turkish legacy dataset.
11. **`primaryClinicId` is never set at runtime**, so imported patients would not appear in the
    organization dashboard's patient counts.
12. `Patient.deletedAt` is a **phantom column** — declared, filtered on, written by nothing.

### Remaining unknowns

`C-1` the 91st column · fill rates for the ~30 columns never profiled · `K-1`/`K-2` the remaining
vendor exports (narrowed by D-3 but not closed) · `K-3` the 25 practitioner labels · `K-4`
`KVKKILKKODU`'s meaning · `K-5` whether signed consent forms exist · the size of the D-13/D-14 binary
corpora · whether `ADRES_KODU` is a postal code.

### Merge, deployment and program safety

- **Merge safety:** documentation only. Two files touched, both under `docs/program/`. No
  application, schema, migration, test, permission or CI file is modified. No runtime behaviour can
  change.
- **Deployment safety:** nothing to deploy. `MIGRATION_CREATED = NO`.
- **Program state preservation:** `F4 COMPLETE` **NO** · `FIRST_CUSTOMER_RECOVERY_GATE`
  **NOT_SATISFIED** · `F5 AUTHORIZED` **NO** · `R-030` / `R-030-DB` / `R-030-FILES` **OPEN** ·
  `repo2` **NOT ACTIVATED**. This task changes none of them and does not touch the F4 recovery
  lifecycle.
- **Out-of-scope boundary preserved:** the basic clinic patient importer is unchanged; its one
  reported defect (D-2) is explicitly left for a separate task.

### R1 correction record (this revision)

Applied against program-owner review of PR #443. Documentation-only; no schema, migration,
encryption, parser, route, UI, or existing-importer code was touched.

| # | Correction | Where |
| --- | --- | --- |
| 1 | `TCNO`/identity data promoted `P1` → `P0_FIRST_CUSTOMER_BLOCKER` | §6.0, §15, §14 (`G-E4`), §17 item 1 |
| 2 | `PatientIdentityDocument` marked `CANDIDATE_ACCEPTED_FOR_NEXT_DESIGN_STAGE`, `SCHEMA_IMPLEMENTATION_AUTHORIZED = NO` | §6.0, §6.1, §6.3 |
| 3 | Withdrew reuse of general `ENCRYPTION_KEY`; required dedicated key separation | §6.2a |
| 4 | Corrected HMAC to an explicit tenant-bound design with documented candidates | §6.4 |
| 5 | Split Platform Admin capability: no general plaintext read/unmask, but audited migration write-through | §6.6, §6.6a |
| 6 | Withdrew "guardian TC on child is legitimate domain semantics"; reclassified `AMBIGUOUS`/`MANUAL_REVIEW` | §6.5 |
| 7 | Gender reframed as recommendation only; added `GENDER_FIELD_REQUIRED`/`GENDER_DOMAIN_CONTRACT` tags | §8 |
| 8 | Health Tourism confirmed as a separate future module; US-01.8 not used to widen migration/Patient-Core scope | §7.0 |
| 9 | Five pre-existing defects explicitly tagged `PRE_EXISTING`/`CAUSED_BY_MIGRATION`/`SEPARATE_TASK_REQUIRED` | §16.1 |
| 10 | Plan-limit decision requirement and dry-run reporting fields made explicit | §17 item 5 |
| 11 | Provenance — unchanged; both designs remain open, `P0` unchanged | §12 |
| 12 | Next task confirmed unchanged: `F3-DATA-MIG-001` targeted re-profiling | §18 |

### Lifecycle

```text
AGENT_COMPLETED                    = YES
APPLICABLE_DOC_PRIVACY_GATE_PASSED = YES  (log-privacy-guard:scan --strict-baseline, no new violations)
IMPLEMENTATION_PERFORMED           = NONE / DOCS ONLY
PR_OPENED                          = DRAFT
MERGED                             = NO
DEPLOYED                           = NO
PRODUCTION_VERIFIED                = NO
R1_CORRECTIONS_APPLIED             = YES
```

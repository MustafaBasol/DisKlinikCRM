# Clinic Data Migration Contract — First-Customer Readiness

**Task:** `F3-DATA-MIG-PREP-001` — Klinik tam veri taşıma readiness ve migration contract
**Date:** 2026-08-18
**Baseline:** `origin/main` @ `283a9efd69e8bc370327f4490b3202c739a931d7`
**Status:** `ANALYSIS_COMPLETE` — contract established, **no implementation performed**

---

## 0. Governance boundary — READ FIRST

> This is a **parallel first-customer Product & Operations lane executed while F4 is `BLOCKED_EXTERNAL`.**
> It does **not** authorize F5 and does **not** satisfy `FIRST_CUSTOMER_RECOVERY_GATE`.

This document changes **no** program state. The following values are restated from the authoritative
tracker and are **unchanged** by this task:

| Marker | Value | Source |
| --- | --- | --- |
| Architecture phase | **F4 — Object Storage, Backup, PITR and Restore Evidence** | `NORAMEDI_MASTER_TRACKER.md` |
| `F4 COMPLETE` | **`NO`** | `NORAMEDI_MASTER_TRACKER.md` |
| `FIRST_CUSTOMER_RECOVERY_GATE` | **`NOT_SATISFIED`** | `NORAMEDI_MASTER_TRACKER.md` |
| `F5 AUTHORIZED` | **`NO`** | `NORAMEDI_MASTER_TRACKER.md` |
| `R-030` / `R-030-DB` / `R-030-FILES` | **`OPEN` / `OPEN` / `OPEN`** | `RISK_REGISTER.md` |
| `repo2` | **NOT ACTIVATED** | `RISK_REGISTER.md` |

Why this lane is allowed while F4 is blocked: F4's remaining work is gated on an **external**
dependency (second Türkiye VPS / off-host recovery procurement). This lane touches none of that
surface, and `KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md` §4 explicitly permits documentation, repository
evidence collection and design in parallel.

### Two governance constraints that shape everything below

**(1) Migration execution in production is itself gated on F4.**
Because `FIRST_CUSTOMER_RECOVERY_GATE = NOT_SATISFIED`, there is presently **no verified off-host
recovery path**. A clinic data migration is a large, hard-to-reverse write. Running one before that
gate closes means a failed migration has no proven restore. This is independent of whether the
migration *code* is ready.

**(2) The schema changes this contract identifies as mandatory are currently FROZEN.**
`KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md` §3 item 1 — *"Broad Prisma schema refactoring"* — remains in
force, gated on §5 condition 5 (external declaration that the KVKK baseline is stable), which is
**not satisfied**. §4 of the same document states: *"Design work being allowed does not authorize
implementation."*

Per `NORAMEDI_MASTER_TRACKER.md` §8, only the **program owner** may grant a narrow scoped exception,
and §2.3 states no agent may self-approve one. The precedent for what an acceptable exception looks
like is `F4_STORAGE_AND_BACKUP.md:535-548` (R-079): *"yalnızca R-079'a mahsus, en küçük eklemeli
migration"* — two columns and one index, mirroring an existing model.

**Therefore this task performed no implementation and created no migration.** §12 states exactly what
exception would need to be requested, and why the feature cannot be built without it.

---

## 1. Permanent product decision

**Patient import and full clinic data migration are PLATFORM ADMIN operations only.**

Clinics MUST NOT perform patient imports themselves. The following tenant-scoped roles must be
denied at the **backend authorization boundary** — frontend hiding is not acceptance evidence:

`OWNER`, `ORG_ADMIN`, `CLINIC_MANAGER`, `RECEPTIONIST`, `DENTIST` / practitioner roles, `BILLING`,
and every other clinic/tenant-scoped role.

`organizationId` and `clinicId` MUST be explicitly selected by the operator and **independently
re-verified by the backend**. The destination tenant must never be derived from active clinic
context, tenant session, default clinic, or frontend-only state.

### Current repository state contradicts this decision

**`CLINIC_FACING_IMPORT_UI_EXISTS = YES`** · **`CLINIC_FACING_IMPORT_API_EXISTS = YES`**

| Layer | Evidence | Roles currently allowed |
| --- | --- | --- |
| Backend patient import | `server/src/routes/patientsImport.ts:58` — `const IMPORT_ROLES = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST'];` | OWNER, ORG_ADMIN, CLINIC_MANAGER, **RECEPTIONIST** |
| Endpoints | `patientsImport.ts:63` `GET /api/patients/import-template`; `:225` `POST /api/patients/import-preview`; `:278` `POST /api/patients/import-confirm` | guarded by `authorize(IMPORT_ROLES)` at `:65`, `:227`, `:280` |
| Registration | `server/src/index.ts:241` `app.use('/api', patientsImportRoutes)` — mounted **after** clinic `authenticate` at `:237` | clinic session boundary |
| Frontend | `src/components/PatientImportModal.tsx` (component `:47`); trigger `src/pages/Patients.tsx:86-88`; rendered `:243-247` | — |
| Frontend gate | `src/utils/permissions.ts:349` `canImportPatients()` | same four roles |
| Staff import (same pattern) | `server/src/routes/usersImport.ts:63` — `['OWNER','ORG_ADMIN','CLINIC_MANAGER']`; UI `src/components/UserImportModal.tsx:52` | three roles |

**Classification: CONFLICT with the permanent product rule.**

A nuance that keeps the remediation correctly scoped: the existing clinic-facing import is a
**500-row, `.xlsx`-only, template-driven patient-list import** (`MAX_IMPORT_ROWS = 500`,
`server/src/utils/excelImport.ts:11`; `MAX_FILE_SIZE_BYTES = 5 MiB`, `:12`). It is *not* a clinic
data migration and cannot become one. The permanent rule governs **full clinic data migration**.

The program owner must choose:

- **Option A (recommended, smallest safe path).** Retain the 500-row template import as a
  clinic-facing convenience feature and rule it **explicitly out of scope** of the migration product
  rule — but remove `RECEPTIONIST` from `IMPORT_ROLES`, and keep the row cap as the structural
  guarantee that it can never be used to bulk-load a legacy export.
- **Option B (strict reading).** Deprecate and remove the clinic-facing import entirely; all patient
  loading becomes Platform Admin only.

This document does **not** choose. It records that a decision is **required** and that the current
state satisfies neither. **No change was made to any of these files by this task.**

---

## 2. Current-state capability matrix

Docs are not implementation evidence. Every row is backed by repository evidence.

| Area | Existing support | Exact repo evidence | Reusable | Gap |
| --- | --- | --- | --- | --- |
| Platform Admin migration | **NONE** | `server/src/routes/platformAdmin.ts` — zero `multer` usage; `prisma.patient.*` only `count()` at `:307`, `:352` | Platform auth gate `platformAdmin.ts:154` | Entire feature |
| Clinic-facing import | **EXISTS (conflicts)** | `patientsImport.ts:58`, `:225`, `:278` | Two-phase preview→confirm shape | Violates product rule |
| `.xlsx` parsing | **YES** | `server/src/utils/excelImport.ts:246` `wb.xlsx.load(buffer)` | `parseExcelFile()` `:241`, `cellToString()` `:20` | Bound to a 500-row template |
| **`.xls` (legacy BIFF8)** | **NO** | ExcelJS 4.4.0 exposes only `xlsx` and `csv` readers — `server/node_modules/exceljs/lib/doc/workbook.js:33,38` | — | **Requires a new dependency** |
| CSV parsing | **NO (unwired)** | ExcelJS ships a `csv` reader; no code path calls it | ExcelJS `csv` | Not wired up |
| File-type verification | **EXTENSION/MIME ONLY** | `patientsImport.ts:33-41` — `mimetype === '…sheet' \|\| originalname.endsWith('.xlsx')` (note the `\|\|`) | — | **No magic-byte check** |
| Patient dedup | **INCONSISTENT — 5 predicates** | `whatsapp.ts:1310`; `metaWhatsAppAiProcessor.ts:676`; `publicBooking.ts:330`; `patientsImport.ts:114-129`; `instagramAiConversationProcessor.ts:617` | — | No canonical rule |
| Phone normalization | **6 COMPETING IMPLS** | `whatsapp.ts:225`; `whatsappInbox.ts:37`; `conversationMessageStore.ts:18`; `instagramAiConversationProcessor.ts:128`; `metaWhatsAppAiProcessor.ts:232`; `clinicResolver.ts:63`. E.164 only at `smsRouting.ts:28` — send-time, **never persisted** | `smsRouting.ts` rules | **No canonical normalizer** |
| Practitioner mapping | **NONE** | No `sourceSystem`/`externalId` on `User` | — | Entire capability |
| Service mapping | **NONE** | `AppointmentType` (`schema.prisma:484-511`) has no provenance | — | Entire capability |
| Treatment historical creation | **NO SAFE PATH** | Only route handlers; side effects inlined in the same transaction — `treatmentPlanProcedures.ts:151-192` | — | See §8 |
| Payment historical creation | **NO SAFE PATH** | `POST /api/payments` stamps `createdById` from session (`payments.ts:100`) and defaults `paidAt` to `new Date()` (`schemas/index.ts:299`) | — | See §8 |
| Dry-run / preview | **PARTIAL (clinic import only)** | `patientsImport.ts:225` preview performs no writes | Two-phase shape | Not Platform Admin; no mapping stage |
| **Idempotency** | **IMPOSSIBLE TODAY** | `Patient` has **zero** unique constraints (`schema.prisma:221-317`); no `CREATE UNIQUE INDEX … ON "Patient"` in any of the 75 migrations | — | **Requires schema change** |
| **Rollback** | **NONE** | No provenance column on any patient/clinical/finance entity | — | **Requires schema change** |
| Reconciliation | **PARTIAL (reusable reads)** | `services/reports/revenueByPeriodQuery.ts:73+`; `routes/reports.ts:46-147`; `routes/financeDashboard.ts:136-252` | Yes — as read-side primitives | No run-scoped diffing |
| Audit | **YES (platform side)** | `services/platformAdminAudit.ts:39` `writePlatformAdminAuditEventInTx`; in-tx usage `platformAdmin.ts:673-688` | **Yes — reuse directly** | No migration action types |
| Temp source cleanup | **N/A (no disk)** | Every upload uses `multer.memoryStorage()` — `patientsImport.ts:30`, `usersImport.ts:35`, `attachments.ts:70`, `imaging.ts:103`, `labOrders.ts:338` | Memory-only pattern; `fileStorage.ts:419` `ensureExportTempDir()` if disk is ever needed | Large files need a stream story |

---

## 3. Real legacy XLS analysis — safe metadata only

**No raw row, patient name, phone, e-mail, identity number, address, note or financial value from
this workbook appears in this document, in any log, in any test fixture, or in Git.**

### Provenance and Git safety

| Property | Value |
| --- | --- |
| Filename | `hastalar tüm liste (1).xls` |
| Location | `C:\Users\Mustafa\Downloads\` — **outside the repository worktree** |
| Inside worktree? | **NO** — `git ls-files --error-unmatch` → *did not match any file(s) known to git* |
| Any `.xls`/`.xlsx` in repo? | **NONE** (`find . -iname '*.xls*'`, excluding `node_modules`) |
| `REAL_XLS_DATA_COMMITTED_TO_GIT` | **`NO`** |

Because the workbook lives outside the worktree, no `.gitignore` change was required and none was
made. Note for future work: `.gitignore` covers `uploads/`, `server/uploads/`, `.tmp/`,
`server/.tmp/`, `coverage/`, `*.log`, `*.db|sqlite*` — **no rule covers `*.xls`/`*.xlsx`/`*.csv`
elsewhere in the tree**, so any future migration artifact written outside those directories would be
committable.

### Container and format

| Property | Value |
| --- | --- |
| Magic bytes | `D0 CF 11 E0 A1 B1 1A E1` — OLE2 / Compound File Binary |
| Format | **Legacy binary Excel, BIFF8** (CFB stream named `Workbook`, not `Book` ⇒ BIFF8, not BIFF5) |
| File size | 11,291,648 bytes (≈ 10.8 MiB) |
| `Workbook` stream | 11,192,891 bytes |
| Streams present | `Workbook`, `\x05SummaryInformation`, `\x05DocumentSummaryInformation` |
| Encrypted / password-protected | **NO** |
| HTML masquerading as Excel | **NO** — genuine OLE2 |

### Workbook structure

| Property | Value |
| --- | --- |
| Sheets | **1** |
| Sheet name | `Sayfa1` (Turkish default "Sheet1" — carries no clinic identity) |
| Visibility | visible; **0** hidden / very-hidden sheets |
| Date epoch | **1900** (`DATEMODE` = 0) |
| Dimensions | rows `0 … 14890`, columns `0 … 91` |
| Header row | row 0, **91 named columns** |
| Data rows | **14,890** |
| Cells profiled | 1,369,880 |
| Shared-string table | 165,366 references / **53,981 unique strings** |
| **Formulas** | **0** |
| **Merged cell ranges** | **0** |
| **Error cells** | **0** |
| Turkish characters | Correctly recovered — the SST mixes compressed (8-bit) and UTF-16LE runs; both decoded |

### Parse performance (measured)

Measured with a self-contained OLE2/BIFF8 reader written for this analysis (scratchpad only — **not
added to the repository**), because no `.xls`-capable parser exists anywhere in the toolchain.

| Metric | Value |
| --- | --- |
| BIFF record-layer parse | **140 ms** |
| Full cell walk + profiling | **283 ms** |
| **Total** | **≈ 423 ms** for 10.8 MiB / 14,890 rows / 1.37 M cells |
| Memory approach | Whole file buffered (11 MiB) — acceptable at this size; see §11 for the scale rule |

**Legacy `.xls` parsing is not a performance problem. It is a dependency problem.**

### The current parser fails on this file — with a misleading error

Reproducing the exact production call (`excelImport.ts:246`) against the real workbook:

```
wb.xlsx.load(buffer)   →  DID NOT THROW
wb.worksheets.length   →  0
wb.worksheets[0]       →  undefined
```

ExcelJS silently returns an **empty workbook** rather than rejecting the format. Production is saved
only by the next line, `if (!ws) throw new Error('Excel dosyası boş veya okunamadı')`
(`excelImport.ts:249`), which the route maps to a **500**. So a first customer uploading their real
export — or merely renaming it `.xls` → `.xlsx` to get past the extension filter — receives
*"Excel file is empty or unreadable"* and a server error, rather than *"legacy .xls is not
supported"*. Per §14 of the task contract, a data-format condition must not surface as a 500.

**This is the single most user-visible first-customer defect found.** It is cheap to fix
(magic-byte detection + a typed error) and requires no schema change — see §14, PR 1.

### The 91 source columns

Column names only. Grouped by migration disposition.

- **Identity / naming** — `HASTA_ID`, `ADI`, `SOYADI`, `UNVANI`, `BABAADI`, `ANNEADI`, `CINSIYET`, `DOGUMTARIHI`, `DOGUMIL`, `DOGUMILCE`, `MEDENIHALI`, `MESLEGI`, `EGITIMDURUMU`, `UYRUK`, `ULKE`
- **Government / health identifiers** — `TCNO`, `PASAPORTNO`, `SOSYAL_GUVENCE_NO`, `SOSYAL_GUVENCE_KURUMU`, `ENABIZTAKIPNO`, `YUPASS_NO`, `HTS_KODU`, `VERGIDAIRESI`, `VERGINO`
- **Contact** — `EVTELEFONU`, `ISTELEFONU`, `CEPTELEFONU`, `FAX`, `EMAIL`, `ADRESI`, `ADRES_KODU`, `IL`, `ILCE`, `MAHALLE`
- **Clinical (KVKK Art. 6 special category)** — `KANGURUBU`, `ONEMLINOT`, `UZUNNOT`, `KONTROLNOTU`, `TEDAVIDURUMU`
- **Reference / mapping** — `SUBE_ID`, `HASTADOKTOR`, `REFERANSI`, `KURUMREFERANSI`, `REHBER_ID`, `CALISMAGURUBU`, `AILEGURUBU`, `UCRETTARIFESI`, `KURUMTARIFE`, `SIGORTATURU`
- **Financial summary (NOT transactions)** — `RISK_TUTARI`, `INDIRIMORANI`, `CARIODEMESTATU`, `ODEMESONTARIHI`, `SONODEMETARIHI`, `ODEMENOTU`, `ODEMENOTTARIHI`, `SMSBORCTARIH`, `SMSODEMETARIHI`
- **Operational summary (NOT history)** — `SONISLEMTARIHI`, `SONKONTROLTARIHI`, `TEDAVISONTARIHI`, `TEDAVIBITISTARIH`, `SONRANDEVUTARIHI`, `SONANKETTARIHI`, `SONGORUNTUTARIHI`, `KONTROLPERYODU`, `HATIRLAT`
- **Consent-like** — `KVKKONAYKODU`, `KVKKILKKODU`, `KVKKSMS`, `MESAJOK`, `SMSGONDERILDI`
- **Record lifecycle** — `KAYITTARIHI`, `KAYITSAATI`, `KAYDEDEN`, `SILINDI`, `DOSYAVAR`, `CHECKBOX`
- **Accounting / filing** — `HESAP_KODU`, `UST_HESAP_KODU`, `DOSYANO`, `SUBEDOSYANO`, `ALTDOSYANO`
- **Health tourism** — `ULKEGIRISTARIHI`, `ULKECIKISTARIHI`, `GELDIGIULKE`, `TURIZM`
- **Presentation** — `RESIMUZANTI`, `HASTARENGI`, `EK_ACIKLAMA`

### Measured data-quality profile (aggregate counts only)

| Source column | Fill | Storage types observed | Distinct | Migration-relevant finding |
| --- | --- | --- | --- | --- |
| `HASTA_ID` | 100 % (14,890) | string | **14,890 — all unique** | **Stable source primary key. This is the provenance anchor.** |
| `SUBE_ID` | 61 % (9,083) | string | **1** | Single branch, 39 % blank ⇒ **cannot derive destination clinic**; operator must select it |
| `HASTADOKTOR` | 99.5 % (14,814) | string | **25** | **25 practitioner mappings required** before any clinical import |
| `TCNO` | 77.2 % (11,500) | **number 10,799 / string 701** | 11,470 | See identity hazard below |
| `CEPTELEFONU` | 91.4 % (13,613) | **string 13,342 / number 271** | 10,908 (last-10) | See phone hazards below |
| `EVTELEFONU` / `ISTELEFONU` | 0.3 % / 1.1 % | mixed | 50 / 166 | Effectively unused |
| `EMAIL` | **0.05 % (7 rows)** | string | 7 | **Only 1 of 7 is even email-shaped.** E-mail is unusable as an identifier |
| `ADI` / `SOYADI` | 100 % | string | 3,341 / 3,513 | See name-collision hazard below |
| `DOGUMTARIHI` | 69.5 % (10,342) | **date 10,332 / string 10** | — | Mixed encoding; serial range `1903-01-01 … 2026-12-08` — **max is in the future** |
| `KAYITTARIHI` | 100 % | date serial | — | `2016-02-05 … 2026-08-13` — 10 years of registration history, uniformly typed |
| `SILINDI` | 100 % | boolean | 2 | **172 soft-deleted**, 14,718 active |
| `CINSIYET` | 79.3 % | string | **2** | Clean 2-value enum; 20.7 % unknown |
| `KVKKONAYKODU` | **0 %** | — | 0 | **Empty** |
| `KVKKSMS` | **0 %** | — | 0 | **Empty** |
| `KVKKILKKODU` | 31.9 % (4,754) | number | 4,633 | A near-unique **code/id**, not a boolean consent flag |
| `RISK_TUTARI` | **0.01 % (2 rows)** | number | 1 | **No financial history** |
| `TEDAVIDURUMU` | **0.02 % (3 rows)** | number | 3 | **No treatment history** |
| `PASAPORTNO`, `SOSYAL_GUVENCE_NO`, `UYRUK`, `UZUNNOT`, `ENABIZTAKIPNO` | **0 %** | — | 0 | Empty in practice (schema still declares them) |
| `KANGURUBU` | 1 row | string | 1 | Effectively empty |

#### Hazard 1 — identity numbers (`TCNO`)

Digit-length histogram of the 11,500 populated values:

| Shape | Count | Disposition |
| --- | --- | --- |
| numeric, 11 digits | **10,525** | Plausibly a valid TC kimlik no |
| numeric, 10 digits | 194 | **INVALID** — a TC number never starts with `0`, so this is not leading-zero loss; it is bad legacy data |
| numeric, 12 digits | 72 | **INVALID** for TC (possibly a tax number) |
| numeric, 7/8/9/13 digits | 8 | **INVALID** |
| string, 12–20 chars | 696 | **INVALID as TC** — none are 11 chars; likely foreign IDs or formatted values |
| string, 1–8 chars | 5 | **INVALID** |
| **scientific notation** | **0** | **No float coercion damage** — 11-digit values are exactly representable in float64 |
| **non-integer** | **0** | — |

- **Good news:** Excel did **not** destroy any identity value. There is no scientific-notation
  hazard and no precision loss in this file. §17's `BLOCK THE ROW` rule has **0 triggers here** —
  but it must still be implemented, because it is a property of *this* file, not of `.xls` generally.
- **Bad news:** ~975 of 11,500 values (8.5 %) are not validly-shaped TC numbers, and **30 values are
  duplicated across 60 rows**.
- **Decisive news:** **NoraMedi's `Patient` model has no identity-number field at all.** Verified —
  zero matches for `tcNo|tcKimlik|identityNumber|nationalId|passport` in `server/prisma/schema.prisma`.
  **`TCNO` and `PASAPORTNO` have no destination.** See §6 gap G-2.

#### Hazard 2 — phone (`CEPTELEFONU`)

| Finding | Count | Consequence |
| --- | --- | --- |
| Stored as **number** | **271** | Leading `0` destroyed by Excel (`0532…` → `532…`). Must be reconstructed during normalization |
| Stored as string with leading `0` | 13,265 | The dominant, well-formed shape |
| Stored as string without leading `0` | 77 | Mixed |
| **Distinct phones (last 10 digits)** | 10,908 | — |
| **Phone values shared by >1 patient** | **1,835** | — |
| **Rows sharing a phone with another row** | **4,261 (28.6 % of all rows)** | **Phone can never be a dedup key for this customer** |

This is not an anomaly to be cleaned — shared family/guardian phones are an **enforced NoraMedi
product invariant**, with a dedicated regression suite (`server/src/tests/patientSharedPhone.test.ts`)
and explicit code contracts: `whatsapp.ts:1326-1331` returns `null` on multiple matches specifically
so a message is never attached to the wrong patient.

**Second-order hazard.** Every imported patient added on a phone that an *existing* patient already
uses flips that phone's match count from 1 → 2, which **silently disables WhatsApp/Meta/Instagram
auto-linking for the patient who was already there** (`whatsapp.ts:1331`,
`metaWhatsAppAiProcessor.ts:710-712`). **Importing patients can degrade message routing for patients
the migration never touched.** This must be measured and reported by dry-run.

#### Hazard 3 — name collisions

`ADI` + `SOYADI` pairs: **12,804 distinct pairs**; **1,740 pairs occur more than once**, covering
**3,825 rows (25.7 %)**.

Combined with hazard 2, this proves §29's rule empirically for this customer: **`name + phone` is
not a viable identity key.** Only `HASTA_ID` is.

#### Hazard 4 — dates

`DOGUMTARIHI` mixes 10,332 numeric serials with 10 strings, and its maximum serial decodes to
**2026-12-08 — a future birth date** (today is 2026-08-18). NoraMedi's own `patientSchema` refines
`dateOfBirth` to reject future dates (`server/src/schemas/index.ts:29`), so such rows would be
rejected by validation. Dry-run must surface them as `INVALID` **before** execution, not at write time.

---

## 4. Root gaps

### 4.1 Missing capability

| ID | Gap | Evidence |
| --- | --- | --- |
| G-1 | **No legacy `.xls` parser** anywhere in the toolchain | ExcelJS 4.4.0 has only `xlsx`/`csv` readers (`workbook.js:33,38`); no `xlsx`/SheetJS/`node-xlsx`/`xlrd` installed |
| G-2 | **No identity-number field on `Patient`** | zero matches for `tcNo\|identityNumber\|nationalId\|passport` in `schema.prisma` |
| G-3 | **No provenance columns anywhere** | `Patient`, `Appointment`, `TreatmentCase`, `TreatmentPlanProcedure`, `Payment`, `User`, `AppointmentType` all lack `sourceSystem`/`externalId` |
| G-4 | **No Platform-Admin upload endpoint** | `platformAdmin.ts` contains zero `multer` usage |
| G-5 | **No platform-side clinic-scoping helper** | no platform equivalent of `getAccessibleClinicIds()` (`utils/clinicScope.ts:128`) |
| G-6 | **No canonical phone normalizer** | 6 competing implementations; the only E.164 producer (`smsRouting.ts:28`) is send-time and never persisted |
| G-7 | **No clinical/finance write contracts** | every create is an inline route handler; the architecture guardrail's precedent contracts are **read-only** |
| G-8 | **No side-effect suppression mechanism** | repo-wide search for `skipNotification\|suppressNotif\|isImport\|importMode\|skipSideEffect\|historicalImport` in `server/src` returns **nothing** |
| G-9 | **No mapping/profile stage** | the existing import is fixed-template; there is no header-discovery or mapping-proposal concept |

### 4.2 Unsafe behavior (present today, independent of migration)

| ID | Issue | Evidence |
| --- | --- | --- |
| U-1 | **Legacy `.xls` surfaces as a 500** with a misleading message | `excelImport.ts:246-249`; reproduced against the real file |
| U-2 | **File type trusted from extension/MIME only** | `patientsImport.ts:33-41` — the `\|\|` means a client-declared MIME *or* a `.xlsx` suffix suffices; no content sniffing |
| U-3 | **Clinic-facing import violates the permanent product rule** | `patientsImport.ts:58` includes `RECEPTIONIST` |
| U-4 | **`earningService` queries a non-existent column** | `services/earningService.ts:127` and `:181` pass `deletedAt: null` to `prisma.payment.aggregate`, but `Payment` has no `deletedAt` (verified in `schema.prisma:900-925`). Raises `PrismaClientValidationError`, swallowed by `.catch(console.error)` at `payments.ts:125`, `:200`, `treatmentCases.ts:260`, `:327`. **Billed-base earning generation is dead and `collectedAmount` is never refreshed.** Pre-existing; not caused by migration, but it means **earnings figures cannot be trusted as a reconciliation baseline** |
| U-5 | **No `$transaction` in the finance domain** | verified absent across `payments.ts`, `paymentPlans.ts`, `earningService.ts`, `practitionerPayouts.ts`. `paymentPlans.ts:225-250` can leave a paid `Payment` with an unpaid installment |
| U-6 | **Unscoped patient reads in messaging** | `services/postTreatmentMessaging.ts:124-127`, `:218`, `:256`, `:294` — `findUnique({ where: { id } })` with no org/clinic filter, feeding name+phone into outbound message rendering |

U-4, U-5 and U-6 are **pre-existing defects discovered during this analysis**. They are reported
here and should be tracked separately; **this task changed none of them.**

### 4.3 Unknown / unverified

| ID | Unknown |
| --- | --- |
| K-1 | Whether the customer can export **treatment, procedure, payment, appointment and practitioner** data at all — the patient workbook proves none of it exists (see §5) |
| K-2 | The legacy vendor's identity and its export tooling/format for the other entity types |
| K-3 | Whether `HASTADOKTOR`'s 25 values map 1:1 onto NoraMedi `User` practitioners for this clinic |
| K-4 | Whether `KVKKILKKODU` carries any legally meaningful consent evidence in the source system |
| K-5 | Whether the customer holds signed KVKK forms that could justify a `granted` consent state |

---

## 5. The patient workbook is NOT the clinic migration

Measured, not assumed:

| Expected dataset | Present in this workbook? | Evidence |
| --- | --- | --- |
| Patient master data | **YES** — 14,890 rows, 91 columns | §3 |
| Treatment history | **NO** | `TEDAVIDURUMU` populated in **3 of 14,890 rows** |
| Procedure history | **NO** | no procedure-level column exists |
| Payment movements | **NO** | `RISK_TUTARI` populated in **2 of 14,890 rows**; only summary columns (`CARIODEMESTATU`, `SONODEMETARIHI`, …) |
| Appointment history | **NO** | only `SONRANDEVUTARIHI` — a single "last appointment" summary |
| Practitioner master data | **NO** — only 25 opaque labels | `HASTADOKTOR` |
| Service/procedure catalogue | **NO** | absent |

The date-shaped columns (`SONISLEMTARIHI`, `TEDAVISONTARIHI`, `SONODEMETARIHI`, `SONRANDEVUTARIHI`,
…) are **last-event summaries**, not transaction logs. Per §19 of the task contract, **transaction
history must never be reconstructed from summary columns.**

**Consequence:** a full clinic migration requires **additional source exports** from the legacy
vendor (K-1/K-2). Those exports must be obtained and profiled before treatment/finance migration can
be designed, let alone built. Until then the honest capability ceiling is **patient master data
only**.

---

## 6. Accepted canonical migration contract

Vendor column names must never appear in patient, treatment or finance services. The boundary:

```
Vendor / legacy workbook  (HASTA_ID, ADI, SOYADI, CEPTELEFONU, …)
        ↓   source adapter + mapping profile   ← the ONLY layer that knows vendor names
Canonical migration contract                    ← vendor-neutral
        ↓   validation / normalization
NoraMedi domain application contracts
```

### 6.1 Provenance — the anchor of idempotency and rollback

Every migrated entity carries:

| Field | Meaning |
| --- | --- |
| `sourceSystem` | stable vendor/profile identifier (e.g. `legacy-dental-tr-v1`) |
| `sourceEntity` | `patient` \| `practitioner` \| `service` \| `treatment_case` \| `procedure` \| `appointment` \| `payment` |
| `sourceId` | the vendor's own primary key — for patients, `HASTA_ID` (proven 100 % unique) |

Uniqueness must be **tenant-scoped**: `@@unique([organizationId, sourceSystem, sourceEntity, sourceId])`.
A global unique index would itself be a cross-tenant hazard.

**This is currently unimplementable** — see G-3 and §12.

### 6.2 Canonical package shape

Derived from actual NoraMedi models, not copied from a template:

```
ClinicMigrationPackage
  metadata        { sourceSystem, profileVersion, organizationId, clinicId,
                    sourceFileChecksums[], operatorPlatformAdminId, runId }
  patients[]      → Patient
  practitioners[] → User            (reference mapping only — never created by migration)
  services[]      → AppointmentType (reference mapping only)
  treatmentCases[]→ TreatmentCase   ← BLOCKED: no source data (§5), no write contract (G-7)
  procedures[]    → TreatmentPlanProcedure ← BLOCKED: same
  appointments[]  → Appointment     ← BLOCKED: same
  payments[]      → Payment         ← BLOCKED: same
```

**Only `patients[]` is in scope for first-customer readiness.** The others are declared so the domain
is not designed around a single spreadsheet, and are explicitly marked blocked.

### 6.3 Dry-run row classification

```
VALID_NEW · VALID_MATCHED · NORMALIZED · AMBIGUOUS · MAPPING_REQUIRED
INVALID   · DUPLICATE_SOURCE · DUPLICATE_DESTINATION · SKIPPED_BY_POLICY · BLOCKED
```

Data-quality conditions produce a classification and a counted report — **never an HTTP 500**.

---

## 7. Field-mapping matrix — patient master data

`R` = required, `O` = optional. Sensitivity: `PII`, `SPECIAL` (KVKK Art. 6), `ID` (identity number).

| Source | NoraMedi model.field | R/O | Normalization | Validation | Collision policy | Sens. | Decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `HASTA_ID` | *(provenance)* `sourceId` | **R** | trim | non-empty, unique in file | `DUPLICATE_SOURCE` | — | **IMPORT — blocked on G-3** |
| `ADI` | `Patient.firstName` | **R** | trim, collapse spaces | `min(1)` | — | PII | **IMPORT** |
| `SOYADI` | `Patient.lastName` | **R** | trim | `min(1)`; reject `-`/`unknown`/`bilinmiyor` | — | PII | **IMPORT** |
| `CEPTELEFONU` | `Patient.phone` | O | **canonical normalizer (G-6)**; restore leading `0` for the 271 numeric rows | none in schema | **never dedup on phone**; report shared-phone count | PII | **IMPORT after G-6** |
| `EVTELEFONU`, `ISTELEFONU` | — | — | — | — | — | PII | **IGNORE** — 0.3 %/1.1 % fill, no destination field |
| `EMAIL` | `Patient.email` | O | trim, lowercase, `''` → `NULL` | `.email()` | none (no unique constraint) | PII | **IMPORT** — only ~1 usable row |
| `TCNO` | **none** | — | — | — | — | **ID** | **BLOCKED — no destination field (G-2)** |
| `PASAPORTNO` | **none** | — | — | — | — | **ID** | **BLOCKED (G-2)** — empty in this file |
| `SOSYAL_GUVENCE_NO`, `VERGINO`, `ENABIZTAKIPNO`, `YUPASS_NO`, `HTS_KODU` | **none** | — | — | — | — | **ID** | **IGNORE** — no destination; empty in this file |
| `DOGUMTARIHI` | `Patient.dateOfBirth` | O | serial→date (1900 epoch, **UTC-noon anchor** to avoid TZ drift); parse the 10 string variants explicitly | **not in the future** (`schemas/index.ts:29`) | — | PII | **IMPORT** |
| `CINSIYET` | **none** | — | — | — | — | PII | **BLOCKED — `Patient` has no gender field** |
| `ADRESI` | `Patient.address` | O | trim | — | — | PII | **IMPORT** |
| `IL` / `ILCE` | `Patient.city` / — | O | trim | — | — | PII | **IMPORT `IL`→`city`**; `ILCE` has no field (13 rows) |
| `ADRES_KODU` | `Patient.postalCode` | O | trim | — | — | PII | **IMPORT** if it is a postal code — **VERIFY FIRST** |
| `ULKE` / `UYRUK` | `Patient.country` / — | O | trim | — | — | PII | **IGNORE** — 0 % fill |
| `SILINDI` | `Patient.patientStatus` | O | `true` → `'archived'` | enum | — | — | **IMPORT** — 172 rows. Do **not** write `deletedAt`: `DELETE` sets `patientStatus='archived'` (`patients.ts:362-365`) |
| `KAYITTARIHI` (+`KAYITSAATI`) | *(none — `createdAt` is `@default(now())`)* | — | — | — | — | — | **IGNORE for `createdAt`**; retain in the migration record as provenance metadata |
| `HASTADOKTOR` | *(reference map → `User.id`)* | O | exact match on the 25 values | must resolve | `MAPPING_REQUIRED` blocks the row | — | **MAP — not needed for patient-only import** |
| `SUBE_ID` | — | — | — | — | — | — | **IGNORE** — 1 distinct value, 39 % blank; destination clinic is **operator-selected** |
| `KVKKONAYKODU`, `KVKKSMS` | **none** | — | — | — | — | — | **IGNORE** — 0 % fill |
| `KVKKILKKODU` | **none** | — | — | — | — | — | **HISTORICAL METADATA ONLY** — see §9 |
| `MESAJOK`, `SMSGONDERILDI` | **none** | — | — | — | — | — | **IGNORE — never map to consent** |
| `KANGURUBU`, `ONEMLINOT`, `UZUNNOT`, `KONTROLNOTU` | `Patient.notes` (candidate) | — | — | — | — | **SPECIAL** | **DEFER** — KVKK Art. 6 special-category data; requires an explicit legal decision. Empty in this file |
| `RISK_TUTARI`, `CARIODEMESTATU`, `SONODEMETARIHI`, `ODEMENOTU`, … | — | — | — | — | — | — | **IGNORE** — summary, not transactions (§5) |
| `TEDAVIDURUMU`, `SONISLEMTARIHI`, `TEDAVISONTARIHI`, … | — | — | — | — | — | — | **IGNORE** — summary, not history (§5) |
| `HESAP_KODU`, `DOSYANO`, `REHBER_ID`, `HASTARENGI`, `RESIMUZANTI`, … | — | — | — | — | — | — | **IGNORE** — vendor-internal |

**Fields the migration must NOT set:** `communicationConsent`, `marketingConsent`, `smsOptOut`,
`smsOptOutAt`, `isAnonymized`, `anonymizedAt`, `anonymizedById`, `anonymizationReason`, `deletedAt`.

**Net first-customer outcome:** of 91 source columns, **~11 map into NoraMedi's current patient
model**. Two of the customer's most important identity columns (`TCNO`, `CINSIYET`) have **no
destination at all**.

---

## 8. Historical side-effect assessment

**Question (§31): can historical clinical/financial records be created with zero present-day side
effects today? — Answer: `PARTIAL`, and `NO` through any application path.**

There are no DB triggers (no `CREATE TRIGGER` in any of the 75 migrations), no event bus, and no
outbox. A direct Prisma write therefore has no implicit side effects. But **every** creation path is
an Express route handler with side effects inlined, **no suppression flag exists anywhere** (G-8),
and writing raw Prisma from a migration module would violate the modular-monolith direction the
architecture guardrail exists to protect (G-7).

### Side effects that would fire through application paths

| Side effect | Trigger | Path | Severity |
| --- | --- | --- | --- |
| **Outbound WhatsApp/Instagram message** | procedure completion, appointment completion | `treatmentPlanProcedures.ts:203-213`, `:334-344`; `appointments.ts:641-651` → `postTreatmentMessaging.ts:206`, `:242` | **CRITICAL** |
| **Inventory stock decrement + `InventoryTransaction`** | procedure create/complete | `treatmentPlanProcedures.ts:172`, `:276` → `treatmentStockDeduction.ts:144`, `:167` — **inside the same `$transaction`** | **CRITICAL** |
| **Low-stock notification** | same | `treatmentStockDeduction.ts:190` → `inventoryAlerts.ts:19` | HIGH |
| **`PractitionerEarning` creation** | treatment-case create/update; payment set to `paid` | `treatmentCases.ts:260`, `:327`; `payments.ts:124-126` → `earningService.ts` | HIGH |
| **ActivityLog / AuditLog** | every create | `utils/activity.ts:15`; `utils/auditLog.ts:38` | MEDIUM |
| **Availability rejection of historical slots** | appointment create | `appointments.ts:345`, `:355` → `helpers.ts:214` — evaluates **today's** roster against a historical date | HIGH (blocks, not corrupts) |

**The sharpest finding.** `postTreatmentMessaging.ts:136`:

```ts
const scheduledAt = new Date(Date.now() + template.sendDelayMinutes * 60_000);
```

Messages are scheduled relative to **now**, never to the clinical record's own date. A cron
(`jobs/reminders.ts:655`) then sends them for real. **Importing a decade of completed procedures
through the application path would send live WhatsApp messages to thousands of patients about
treatments finished years ago.** This alone makes an application-path historical import
unacceptable.

### Date-stamping corruption

`treatmentPlanProcedures.ts:149` (`const now = new Date()` → `completedAt`, `stockDeductedAt`),
`appointments.ts:570` (`closedAt: new Date()`), `earningService.ts:216-217` (`periodMonth/Year` from
`new Date()`), and `treatmentCaseSchema` (`schemas/index.ts:222-244`) which **exposes no `createdAt`
or `closedAt`** — so **the API cannot backdate a treatment case at all**.

### Schedulers — audited

| Scanner | Verdict |
| --- | --- |
| Appointment reminder cron | **SAFE** — forward-looking window (`reminders.ts:214-219`) |
| Post-treatment sender | **SAFE** *iff* no queue row is written (`postTreatmentMessaging.ts:320`) |
| External-calendar sync | **SAFE** — driven by link rows a migration never creates |
| In-app notifications | **SAFE** — `startTime: { gte: now }` |
| Data-retention cleanup | **SAFE** — never touches clinical models |
| **Recall candidate generation** | **⚠ HIGH HAZARD, but manual-only.** `recallCandidateService.ts:560` scans **backwards over all history**. Not on any cron — its sole caller is `POST /api/recall/generate` (`routes/recall.ts:145`), a staff action. After a history import, one click mass-creates `RecallCandidate` rows, Tasks and **draft** `SentMessage` rows. It never sends. Needs an explicit post-import runbook step and, ideally, a provenance-keyed suppression window |

### Required acceptance outcome

```
UNINTENDED_MESSAGES              = 0
UNINTENDED_STOCK_MOVEMENTS       = 0
UNINTENDED_AI_CALLS              = 0
UNINTENDED_CURRENT_AUTOMATIONS   = 0
```

For **patient-only** import these are structurally satisfiable today: creating a `Patient` triggers
only an `ActivityLog` row and a WhatsApp conversation backfill on channel paths — no messaging, no
stock, no AI, no events. **For clinical/financial import they are not**, and the narrowest contract
that would make them so is:

1. A **public write contract per clinical domain** (following the `F2-ORG-DASH-METRICS-CONTRACT`
   read-contract precedent) accepting explicit `createdAt`/`completedAt`/`closedAt` and writing only
   its own model.
2. Those contracts **never invoke** the five side-effect calls above — the correct design is
   *not to call them*, since all five are route-level, not model-level hooks. **No `if (isMigration)`
   scattered through the system.**
3. Provenance columns (G-3).
4. A documented post-import guard on `POST /api/recall/generate`.

---

## 9. KVKK / consent assessment

**Source consent-like fields are NOT NoraMedi consent evidence.**

| Source field | Fill | Classification |
| --- | --- | --- |
| `KVKKONAYKODU` | **0 %** | Nothing to migrate |
| `KVKKSMS` | **0 %** | Nothing to migrate |
| `KVKKILKKODU` | 31.9 %, 4,633 distinct of 4,754 | **Historical source metadata only** — a near-unique code, not a consent state. **Insufficient evidence** |
| `MESAJOK`, `SMSGONDERILDI` | — | Operational flags. **Never map to consent** |

NoraMedi's authoritative model is `PatientCommunicationPreference` (`schema.prisma:2314-2375`), and
`setCommunicationPreference()` (`communicationConsent/communicationConsentAdmin.ts:225`) enforces
`evidence_required` (`:241-246`): a `granted` state **cannot be written without a real
`evidenceType`**. `source: 'import'` is a legal enum value and is deliberately excluded from
`DIGITAL_GRANT_SOURCES`, so it is not blocked on `noticeVersion` — but it is still blocked on
evidence.

**Contract:** migrated patients enter with consent state `unknown` (the default, which never implies
consent — model doc `schema.prisma:2313`). `communicationConsent`/`marketingConsent` stay `false`.
A `granted` state may only ever be written if the customer supplies per-patient evidence (K-5), and
then only through `setCommunicationPreference()` with a genuine `evidenceType` — never by direct
write, and never by bulk-defaulting. `PatientCommunicationConsentEvent` is append-only and
service-owned; a migration must never write it directly.

Note `PatientCommunicationPreference.actorPlatformAdminId` (`:2358`) **already exists**, so a
Platform-Admin-initiated consent write is structurally representable when evidence does exist.

---

## 10. Platform Admin authorization model

The boundary already exists and is strong. Reuse it — do not build a parallel one.

| Dimension | Clinic (`middleware/auth.ts`) | Platform (`middleware/platformAuth.ts`) |
| --- | --- | --- |
| Cookie | `hcrm_session` | `hcrm_platform_session` |
| CSRF cookie | `csrf_token` | `platform_csrf_token` |
| JWT secret | `JWT_SECRET` | `PLATFORM_JWT_SECRET` — **separate; cross-verification impossible** |
| Token `type` claim | `'clinic'` | `'platform'` / `'platform_admin'`, else 403 (`platformAuth.ts:72`) |
| Identity table | `prisma.user` | **`prisma.platformAdmin`** (`platformAuth.ts:85`) |
| Revocation | cached 15 s | exact `credentialVersion`, **no cache** (`:103-111`) |
| MFA | none | TOTP, **opt-in** (`platformAdmin.ts:95` — `if (admin.totpEnabledAt)`) |

**Required mounting:** a dedicated router composed exactly as `platformAdmin.ts:154`
(`router.use(authenticatePlatformAdmin, csrfProtection('platform'))`), registered in
`server/src/index.ts` alongside `:224/:228/:231` — i.e. **before** the clinic `authenticate` at `:237`.

**Required negative proofs** (backend rejection; frontend hiding is not evidence):

```
OWNER_DENIED · ORG_ADMIN_DENIED · CLINIC_MANAGER_DENIED · RECEPTIONIST_DENIED
DENTIST_DENIED · BILLING_DENIED · UNAUTHENTICATED_DENIED
CLINIC_COOKIE_CANNOT_AUTHORIZE_PLATFORM_MIGRATION
ORG_CLINIC_MISMATCH_REJECTED · CROSS_ORG_DESTINATION_REJECTED
```

Each must also assert **zero side effects, including zero audit rows** — the pattern established at
`server/src/tests/retentionManualRunAudit.test.ts:236-253`.

**Two gaps worth flagging to the program owner:** Platform Admin has **no role tier** (every
authenticated platform admin has full access) and **MFA is opt-in, not mandatory**. Given that this
feature would grant bulk write access to patient PII across every tenant, mandatory MFA for the
migration routes is a reasonable precondition.

**Destination targeting.** There is no existing platform-side scoping helper (G-5). Every route
re-derives its target from its own path/query param. The migration must therefore verify explicitly,
on every request, that `clinic.organizationId === organizationId` — Prisma does **not** enforce
`Clinic.organizationId === Patient.organizationId` (two independent FKs, no composite key), so a
structurally valid but tenant-incoherent patient is creatable.

---

## 11. Transaction, scale and performance rules

- **Never** wrap the import in one transaction. Bounded batches (500–1,000 rows), deterministic
  ordering by `sourceId`, per-batch atomicity, checkpoints, resumability.
- **Never** one DB query per row. Pre-load the destination scope once and match in memory — the
  existing import already does this (`patientsImport.ts:114-129`).
- Measured baseline: 14,890 rows / 10.8 MiB parses in **≈ 423 ms**. Parsing is not the bottleneck;
  DB writes are.
- **Plan limits.** Two independent caps are enforced by `checkPatientLimit`
  (`middleware/planLimits.ts:95-119`), both returning **402**: the organization cap from
  `Plan.maxPatients` (`planLimits.ts:24-31`) and the clinic cap from `Clinic.maxPatients`
  (`:45-58`), which defaults to `500` (`schema.prisma:24`). Both count only
  `deletedAt: null AND patientStatus != 'archived'`. A 14,890-row import **must** be reconciled
  against both caps beforehand, or it will either be rejected mid-run or — if it bypasses the
  middleware by writing Prisma directly — silently push the tenant far past its paid plan.
  **This is a commercial decision, not a technical one.**
- **Second-order load.** `whatsapp.ts:1311` and `metaWhatsAppAiProcessor.ts:694` load *every*
  non-deleted patient in a clinic on each unmatched inbound message. Growing a clinic from hundreds
  to ~15,000 patients makes every inbound WhatsApp message a full-clinic scan. **This must be fixed
  before, not after, a large import.**

---

## 12. Schema / migration status

```
MIGRATION_REQUIRED   = YES (for any implementation) — NO (for this task)
MIGRATION_CREATED    = NO
MIGRATION_TESTED     = NO
PRODUCTION_MIGRATION = NO
ROLLBACK_METHOD      = N/A (nothing created)
```

**No Prisma migration was created, and none may be created without an explicit program-owner scoped
freeze exception** (`KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md` §3 item 1; `NORAMEDI_MASTER_TRACKER.md`
§8; §2.3 — no agent may self-approve).

### The exception that would need to be requested

Expand-migrate-contract, additive only, no destructive change:

| # | Change | Purpose |
| --- | --- | --- |
| 1 | `MigrationRun` table — `id`, `organizationId`, `clinicId`, `sourceSystem`, `profileVersion`, `status`, `sourceChecksums`, `actorPlatformAdminId`, timestamps | Run identity, reconciliation, resumability |
| 2 | `MigrationImportedRecord` table — `runId`, `entityType`, `sourceId`, `destinationId`, `outcome` (`created`/`matched`/`updated`), `createdAt`; `@@unique([runId, entityType, sourceId])` | Idempotency + provenance-aware rollback |
| 3 | `Patient.sourceSystem` + `Patient.sourceExternalId`, with `@@unique([organizationId, sourceSystem, sourceExternalId])` | Tenant-scoped idempotency anchor |

Items 1–2 are additive tables touching no existing model — the closest precedent to the R-079
exception. Item 3 alters `Patient` and is the harder ask.

**A zero-migration alternative exists and should be evaluated first.** `dataRetentionManualRunAudit.ts`
models an entire Platform-Admin run lifecycle on `PlatformAdminAuditEvent`'s free-form
`action`/`outcome` + JSON `safeMetadata` (`:11-12`) **with no schema change at all**. That covers
items 1–2 for a dry-run-only capability. It does **not** cover item 3 — without a unique provenance
column on `Patient` there is no idempotent *execution*. So: **dry-run is buildable today; execution
is not.**

If the exception is granted, the mandatory proof (per `docs/compliance/53-…md:182-183`, `:503-507`)
is: `prisma migrate deploy` against a fresh empty disposable DB, then
`npx prisma migrate diff --from-config-datasource prisma.config.ts --to-schema prisma/schema.prisma --script`
producing **zero** statements for the owned tables — plus a schema-integrity regression guard in the
style of `server/src/tests/kvkkHigh007High008SchemaIntegrity.test.ts:37-45`.

---

## 13. Reconciliation design

Produced per `runId`, deterministic, comparing input against destination.

**Counts:** `rowsInFile`, `parsed`, `valid`, `invalid`, `blocked`, `ambiguous`, `mappingRequired`,
`created`, `matched`, `updated`, `skippedByPolicy`, `failed`. Invariant:
`created + matched + updated + skipped + invalid + blocked + ambiguous + mappingRequired == parsed`.

**Patient checks:** destination count of `Patient` where `(organizationId, sourceSystem)` matches the
run equals `created + matched`; every `MigrationImportedRecord.destinationId` resolves to a live row
in the target clinic; **zero** rows outside the target `(organizationId, clinicId)`.

**Shared-phone impact report (mandatory, migration-specific).** For every phone touched, the
before/after count of patients in the destination clinic sharing it, and the list of **pre-existing**
patients whose auto-link status flipped from unique to ambiguous (§3 hazard 2). This is the
side-effect that is otherwise invisible.

**Financial reconciliation (when finance migration exists):** totals by **currency** and by payment
method. Reusable primitives: `services/reports/revenueByPeriodQuery.ts:73+` (best available),
`routes/reports.ts:46-147`, `routes/financeDashboard.ts:136-252`,
`services/privacy/clinicBulkExportFieldAllowlists.ts:109-121` (sanctioned per-tenant payment extract
— ideal pre/post snapshot).

Three caveats that must be stated in any financial reconciliation, not discovered later:
1. **No aggregate groups by currency anywhere** — every existing query sums `amount` across mixed
   currencies as bare numbers. Reconciliation must add its own currency grouping.
2. **Three different definitions of "outstanding"** coexist (`pending`; `pending|partial`; the
   overdue-receivables union). Pick one and name it.
3. **Earnings are not a trustworthy baseline** — see U-4.

---

## 14. Rollback design

DB PITR is **not** the normal rollback mechanism — and per §0 it is not currently a *provable* one
either. Rollback must be provenance-aware, driven by `MigrationImportedRecord`:

| Outcome recorded | Rollback rule |
| --- | --- |
| `created` | Deletable — but only after verifying **no dependent rows** were created since (appointments, payments, messages, consent events). If dependents exist, downgrade to `archived` rather than delete |
| `updated` | **Not automatically reversible** — requires the pre-image. Either store the changed fields' prior values in `MigrationImportedRecord`, or declare updates out of scope for v1 |
| `matched` | **Never delete.** The row pre-existed the migration |

**Recommendation for v1: forbid `updated` entirely.** A patient-master-data import should only ever
`create` or `match`. That makes rollback a bounded delete over `created` rows and removes the entire
pre-image problem.

Clinical and financial rollback must be conservative and manual — reversing payments or procedures
automatically is not safe given U-4/U-5.

---

## 15. Recommended PR sequence

Revised from the default sequence on the basis of repository evidence. **Nothing below is
authorized by this task.**

| PR | Scope | Schema? | Blocked on |
| --- | --- | --- | --- |
| **PR 0** | **Product decision + smallest fix.** Resolve §1 Option A/B. Add magic-byte file-type detection and a typed `LEGACY_XLS_UNSUPPORTED` error so a real `.xls` no longer 500s (U-1, U-2). Remove `RECEPTIONIST` from `IMPORT_ROLES` if Option A | **NO** | Program-owner decision on A/B |
| **PR 1** | **Legacy `.xls` parser + canonical source contract + synthetic `.xls` fixture.** Requires a dependency decision — SheetJS's npm-published `xlsx@0.18.5` carries known advisories and current SheetJS is distributed off-npm. **This is a supply-chain decision for the program owner**, not an agent's | **NO** | Dependency approval |
| **PR 2** | Platform-Admin-only upload + header discovery + mapping proposal + **dry-run only** (no writes), on `PlatformAdminAuditEvent` with **no schema change** — the `dataRetentionManualRunAudit` pattern. Full authorization + tenant-isolation test matrix | **NO** | PR 1 |
| **PR 3** | Canonical phone normalizer (G-6), consolidating the 6 implementations behind one contract | **NO** | — (independently valuable) |
| **PR 4** | Provenance schema + idempotent patient **execution** | **YES** | **Program-owner freeze exception (§12)** |
| **PR 5** | Practitioner / service reference mapping | YES | PR 4 + K-3 |
| **PR 6** | Historical treatment/procedure migration + domain write contracts + side-effect suppression | YES | PR 5 + **K-1/K-2 source files** |
| **PR 7** | Historical finance migration | YES | PR 6 + U-4/U-5 fixed |
| **PR 8** | Reconciliation + rollback + evidence + first-customer rehearsal | — | All above + **`FIRST_CUSTOMER_RECOVERY_GATE = SATISFIED`** |

**PRs 0–3 need no schema change and are therefore not blocked by the KVKK freeze.** They are the
entire near-term path.

---

## 16. Test matrix

To be implemented with the PRs above; mapped to existing patterns to imitate.

| # | Test | Layer | Imitate |
| --- | --- | --- | --- |
| 1 | Unauthenticated → 401, **zero** audit rows | 3 | `server/src/tests/retentionManualRunAudit.test.ts:236-239` |
| 2 | Clinic JWT (`type=clinic_user`) → 401/403, zero rows, `next()` never called | 3 | same `:245-253`; `platformAdmin.test.ts:298` |
| 3 | Each of OWNER/ORG_ADMIN/CLINIC_MANAGER/RECEPTIONIST/DENTIST/BILLING denied | 3 | as above |
| 4 | Cross-org destination rejected | 3 | `dbVerification/kvkkHigh006DbClinicScopeAccess.test.ts:103-113` (**list→403, detail→404**) |
| 5 | Same-org unassigned clinic denied, not silently emptied | 3 | same `:84-94` |
| 6 | Writes land only in the target tenant | 3 | `dbVerification/kvkkHigh006DbRecordOwnedMutationScope.test.ts` |
| 7 | Dedup never inspects another tenant | 3 | as #6 |
| 8 | `safeMetadata` carries no PII | 3 | `retentionManualRunAudit.test.ts:297-298` |
| 9 | Dry-run mutates nothing | 3 | same `:267-294` |
| 10 | Magic-byte rejection: renamed `.exe`/HTML/`.xls`-as-`.xlsx` | 2 | `excelImport.test.ts` |
| 11 | Legacy `.xls` yields a typed error, **not a 500** | 2 | new (U-1) |
| 12 | Synthetic `.xls` dirty-data fixture: blank email, malformed/duplicate/shared-family phone, missing name, ambiguous practitioner, deleted row, malformed date, identity-coercion hazard, duplicate source id | 2 | `excelImport.test.ts` |
| 13 | Shared-family phone never merges two patients | 2 | `patientSharedPhone.test.ts` |
| 14 | Idempotent rerun creates no duplicates | 3 | requires PR 4 |
| 15 | Failure in batch N → resume preserves prior batches, no duplicates | 3 | requires PR 4 |
| 16 | No PII in logs; `log-privacy-guard:scan --strict-baseline` green **with no new baseline exception** | 1 | `.github/workflows/ci-layers.yml:316-317` |
| 17 | Schema-integrity guard for any new table/index | 3 | `kvkkHigh007High008SchemaIntegrity.test.ts:37-45` |

**Registration is mandatory or CI never runs it:** add each backend test as a leaf `test:<name>`
script in `server/package.json`, then append it to `server:test:non-disposable` (no infra) or
`server:test:disposable-db` (real Postgres).

**Commands:** `cd server && npm run typecheck` · `npm run <leaf>` · `npm run server:test:non-disposable` ·
`npm run test:runtime:postgres` (repo root, provisions Docker Postgres) ·
`npm run log-privacy-guard:scan -- --strict-baseline` · `npm run build` · `npm run test:vitest`.

---

## 17. First-customer capability state

```
PATIENT_MASTER_DATA_READY   = NO   (parser + provenance missing)
TREATMENT_HISTORY_READY     = NO   (no source data; no write contract)
PROCEDURE_HISTORY_READY     = NO   (same)
FINANCIAL_HISTORY_READY     = NO   (no source data; U-4/U-5 open)
REFERENCE_MAPPING_READY     = NO
IDEMPOTENT_RERUN_READY      = NO   (no unique constraint anywhere)
ROLLBACK_READY              = NO   (no provenance)
RECONCILIATION_READY        = NO
PLATFORM_ADMIN_UI_READY     = NO
PRODUCTION_DEPLOYED         = NO
PRODUCTION_VERIFIED         = NO
```

Lifecycle states, kept distinct per §45:

```
PARSER_IMPLEMENTED         = NO
PARSER_TESTS_PASSED        = NO
REAL_XLS_DRY_RUN_VERIFIED  = NO
PATIENT_IMPORT_VERIFIED    = NO
TREATMENT_IMPORT_VERIFIED  = NO
FINANCE_IMPORT_VERIFIED    = NO
FULL_CLINIC_MIGRATION_VERIFIED = NO
DEPLOYED                   = NO
PRODUCTION_VERIFIED        = NO
```

---

## 18. Real XLS state

```
REAL_XLS_FIXTURE_AVAILABLE   = YES
REAL_XLS_INSPECTED           = YES   (structure + aggregate profile only)
LEGACY_XLS_PARSING_SUPPORTED = NO    (in NoraMedi; ExcelJS 4.4.0 cannot)
REAL_XLS_DRY_RUN_EXECUTED    = NO    (no dry-run capability exists)
REAL_XLS_IMPORT_EXECUTED     = NO
REAL_XLS_DATA_COMMITTED_TO_GIT = NO
RAW_PII_IN_LOGS              = 0
```

---

## 19. Open decisions for the program owner

1. **§1 Option A or B** — scope of the clinic-facing import.
2. **`.xls` dependency** — which parser, given the supply-chain profile (PR 1).
3. **Freeze exception** — grant or withhold the additive migration in §12 (blocks PR 4+).
4. **`TCNO` / `CINSIYET`** — add fields to `Patient`, or accept that the customer's identity and
   gender data cannot be migrated (G-2). Identity numbers would additionally require an
   encryption-at-rest decision; `utils/encryption.ts` currently protects **secrets only**, and no
   patient PII column is encrypted.
5. **Plan limits** — 14,890 patients versus a `maxPatients` default of 500 (§11).
6. **Mandatory MFA** for Platform Admin migration routes (§10).
7. **Special-category data** (`KANGURUBU`, clinical notes) — legal decision required before mapping.
8. **Source exports** — request treatment/procedure/payment/appointment/practitioner exports from
   the legacy vendor (K-1/K-2). Nothing beyond patient master data can be designed without them.

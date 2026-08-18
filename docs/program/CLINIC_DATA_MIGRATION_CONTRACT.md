# Clinic Data Migration Contract — First-Customer Readiness

**Task:** `F3-DATA-MIG-PREP-001` — Klinik tam veri taşıma readiness ve migration contract
**Date:** 2026-08-18
**Baseline:** `origin/main` @ `283a9efd69e8bc370327f4490b3202c739a931d7`
**Status:** `PR_READY_FOR_ARCHITECTURE_REVIEW` — contract established, **no implementation performed**
**Revision:** `R2` (2026-08-18) — program-owner corrections applied on the same branch and the same
draft PR #442, superseding `R1`. Corrections are itemised in §20.

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

**(2) Any schema change durable execution turns out to need is `NOT AUTHORIZED YET`.**
That is the correct classification — **not** "permanently forbidden", and **not** "already permitted".
`KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md` §3 item 1 prohibits *"Broad Prisma schema refactoring"* and
remains in force, gated on §5 condition 5 (external declaration that the KVKK baseline is stable),
which is **not satisfied**; §4 of the same document states *"Design work being allowed does not
authorize implementation."*

That prohibition must **not** be converted into a blanket ban on every conceivable additive migration.
A narrow additive change is a different category from a broad refactor, and
`F4_STORAGE_AND_BACKUP.md:535-548` (R-079) is the standing precedent for one being granted:
*"yalnızca R-079'a mahsus, en küçük eklemeli migration"* — two columns and one index, mirroring an
existing model. What the freeze does guarantee is that **no schema change may be implemented before
explicit program-owner architecture review** (`NORAMEDI_MASTER_TRACKER.md` §8; §2.3 — no agent may
self-approve).

**No schema exception is granted by this document or by its R1 review.** This task therefore performed
no implementation and created no migration. §12 records what review would have to weigh, and §15 shows
that the entire near-term path does not depend on the answer.

---

## 1. Permanent product decision

**The NEW full clinic data migration capability is a PLATFORM ADMIN operation only.**

That rule governs the capability this document designs: the one that ingests a legacy vendor's export
set (`.xls`, `.xlsx`, CSV, several related files) and loads patient master data, treatments,
procedures, payments, appointments, practitioners and services, with provenance, idempotency,
reconciliation, rollback and run evidence.

Clinics MUST NOT perform full clinic data migration. The following tenant-scoped roles must be denied
at the **backend authorization boundary** — frontend hiding is not acceptance evidence:

`OWNER`, `ORG_ADMIN`, `CLINIC_MANAGER`, `RECEPTIONIST`, `DENTIST` / practitioner roles, `BILLING`,
and every other clinic/tenant-scoped role.

`organizationId` and `clinicId` MUST be explicitly selected by the operator and **independently
re-verified by the backend**. The destination tenant must never be derived from active clinic
context, tenant session, default clinic, or frontend-only state.

### Scope boundary — the rule is NOT retroactive

```text
FULL_CLINIC_DATA_MIGRATION           = PLATFORM_ADMIN_ONLY          (new capability — this document)
EXISTING_BASIC_CLINIC_PATIENT_IMPORT = RETAINED / OUT_OF_SCOPE / UNCHANGED
```

These are **two separate capabilities.** The Platform-Admin-only rule attaches to the new one. It is
**not** applied retroactively to the existing basic clinic patient importer, which is working
functionality that predates this program.

### Existing basic clinic patient import — retained, working, out of scope

```text
EXISTING BASIC CLINIC PATIENT IMPORT
STATUS = EXISTS / WORKING / OUT_OF_SCOPE
```

**Accepted decision (R2, program owner): keep it exactly as it is.**

No work in this migration program removes it, disables it, changes its roles, drops `RECEPTIONIST`,
moves it to Platform Admin, alters `PatientImportModal.tsx` or `patientsImport.ts`, changes its row
limit or its `.xlsx` behaviour, or reuses/refactors it as part of the new migration engine. Only a
future independent task that explicitly targets this feature may change it.

An earlier revision of this document (`R1`) classified this importer as a conflict requiring removal.
**That classification was wrong. It is withdrawn in full**, together with the `F3-DATA-MIG-PR0`
removal task it proposed.

It is recorded below as **repository evidence** — patterns the new capability should imitate rather
than reinvent — and not as a defect or as work.

**`CLINIC_FACING_IMPORT_UI_EXISTS = YES`** · **`CLINIC_FACING_IMPORT_API_EXISTS = YES`** — both
**intentional and retained**.

| Layer | Evidence | Roles currently allowed |
| --- | --- | --- |
| Backend patient import | `server/src/routes/patientsImport.ts:58` — `const IMPORT_ROLES = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST'];` | OWNER, ORG_ADMIN, CLINIC_MANAGER, **RECEPTIONIST** |
| Endpoints | `patientsImport.ts:63` `GET /api/patients/import-template`; `:225` `POST /api/patients/import-preview`; `:278` `POST /api/patients/import-confirm` | guarded by `authorize(IMPORT_ROLES)` at `:65`, `:227`, `:280` |
| Registration | `server/src/index.ts:241` `app.use('/api', patientsImportRoutes)` — mounted **after** clinic `authenticate` at `:237` | clinic session boundary |
| Frontend | `src/components/PatientImportModal.tsx` (component `:47`); trigger `src/pages/Patients.tsx:86-88`; rendered `:243-247` | — |
| Frontend gate | `src/utils/permissions.ts:349` `canImportPatients()` | same four roles |
| Staff import (same pattern) | `server/src/routes/usersImport.ts:63` — `['OWNER','ORG_ADMIN','CLINIC_MANAGER']`; UI `src/components/UserImportModal.tsx:52` | three roles |

**Classification: WORKING FUNCTIONALITY, OUT OF SCOPE. Not a conflict.**

What it is: a **500-row, `.xlsx`-only, template-driven patient-list import** (`MAX_IMPORT_ROWS = 500`,
`server/src/utils/excelImport.ts:11`; `MAX_FILE_SIZE_BYTES = 5 MiB`, `:12`). That row cap is precisely
why it is a different product from a clinic data migration and cannot become one — it structurally
cannot bulk-load a 14,890-row legacy export. The two capabilities do not overlap, so the existence of
one does not compromise the boundary of the other.

**Untouchable file list for this program** — no migration-program PR may modify any of these:

- `server/src/routes/patientsImport.ts`
- `src/components/PatientImportModal.tsx`
- `src/pages/Patients.tsx`
- `src/utils/permissions.ts` (`canImportPatients()`, `:349`)
- the existing Excel import utilities and the current clinic-import tests

The separate **staff / user import** (`server/src/routes/usersImport.ts`,
`src/components/UserImportModal.tsx`) is likewise out of scope and untouched.

**What the existing importer is useful for** — patterns the new Platform Admin capability should
imitate rather than reinvent:

| Pattern | Where |
| --- | --- |
| `.xlsx` parsing | `server/src/utils/excelImport.ts:241` `parseExcelFile()`; `:20` `cellToString()` |
| Two-phase preview → confirm | `patientsImport.ts:225` (performs no writes) → `:278` |
| Row-level normalization and per-row error reporting | `patientsImport.ts:114-129` |
| Memory-only upload handling | `multer.memoryStorage()`, `patientsImport.ts:30` |

**No code was changed by this task, by R1, or by R2. All three are documentation-only.**

---

## 2. Current-state capability matrix

Docs are not implementation evidence. Every row is backed by repository evidence.

| Area | Existing support | Exact repo evidence | Reusable | Gap |
| --- | --- | --- | --- | --- |
| Platform Admin migration | **NONE** | `server/src/routes/platformAdmin.ts` — zero `multer` usage; `prisma.patient.*` only `count()` at `:307`, `:352` | Platform auth gate `platformAdmin.ts:154` | Entire feature |
| Existing basic clinic patient import | **EXISTS / WORKING / OUT_OF_SCOPE** | `patientsImport.ts:58`, `:225`, `:278` | Two-phase preview→confirm shape; `.xlsx` parse; memory-upload pattern | **None — retained unchanged (§1)**; a 500-row template import is a different product from clinic data migration |
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
| **Idempotency** | **NO ACCEPTED MECHANISM** | No durable cross-run provenance store exists anywhere. `Patient` carries no source-provenance field and has **zero** unique constraints (`schema.prisma:221-317`) — no `CREATE UNIQUE INDEX … ON "Patient"` in any of the 75 migrations | — | **Requires an accepted provenance design (§6.1)** |
| **Rollback** | **NO ACCEPTED MECHANISM** | No provenance record on any patient/clinical/finance entity, so the set of rows a given run wrote cannot be identified afterwards | — | **Requires an accepted provenance design (§6.1)** |
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
| U-1 | **Legacy `.xls` surfaces as a 500** with a misleading message | `excelImport.ts:246-249`; reproduced against the real file. **The remediation belongs in the NEW Platform Admin migration intake (§15, PR 0), which must classify by content signature and return a typed unsupported-format error. The existing basic importer is out of scope and is not changed by this program (§1).** |
| U-2 | **File type trusted from extension/MIME only** | `patientsImport.ts:33-41` — the `\|\|` means a client-declared MIME *or* a `.xlsx` suffix suffices; no content sniffing. **Reported only: pre-existing, inside the out-of-scope basic importer (§1). This task neither changes it nor recommends changing it here — it is raised for a future independent task. The NEW migration intake must do content-signature classification from the start (§15, PR 0).** |
| U-3 | ~~Clinic-facing patient import violates the permanent product rule~~ — **WITHDRAWN (R2)** | **Not a defect.** The existing basic clinic patient import is **retained, working and out of scope** (§1); the Platform-Admin-only rule governs the new full migration capability only and is not retroactive. Row kept as a numbered placeholder so U-4/U-5/U-6 references stay stable |
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

Idempotent rerun and provenance-aware rollback both need the same thing: a **durable, cross-run record
of which destination row a given source record produced.** Whatever form that record takes, it must
carry the equivalent of:

| Element | Meaning |
| --- | --- |
| `sourceSystem` | stable vendor/profile identifier (e.g. `legacy-dental-tr-v1`) |
| `sourceEntity` | `patient` \| `practitioner` \| `service` \| `treatment_case` \| `procedure` \| `appointment` \| `payment` |
| `sourceId` | the vendor's own primary key — for patients, `HASTA_ID` (proven 100 % unique) |
| destination reference | the NoraMedi row the source record resolved to |

**Uniqueness must be tenant-scoped**, on the equivalent of
`(organizationId, sourceSystem, sourceEntity, sourceId)`. A globally unique index over vendor source
ids would itself be a cross-tenant hazard.

#### Current state — stated precisely

- NoraMedi currently has **no accepted durable cross-run migration provenance / idempotency
  mechanism.**
- `Patient` currently has **no source-provenance fields and no unique constraint** carrying one
  (`schema.prisma:221-317`; no `CREATE UNIQUE INDEX … ON "Patient"` in any of the 75 migrations).
- Durable execution therefore **requires an accepted provenance design** before it can be built.

This is a statement about an **absent accepted design**, not a claim that idempotency is impossible in
principle.

#### What this document deliberately does NOT decide

At least two designs satisfy the requirement, and choosing between them is an **architecture-review
decision, not an analysis output**:

- **(a) Provenance on `Patient` itself** — source fields on the entity, with a tenant-scoped unique
  constraint.
- **(b) A separate migration provenance / mapping table** — run and record tables holding
  `(runId, entityType, sourceId) → destinationId` with appropriate uniqueness and invariants, leaving
  `Patient` untouched.

They differ materially in blast radius, in what the freeze boundary has to weigh, and in how
reconciliation and rollback are expressed. Both are viable. **Neither is adopted here.** §12 records the
lifecycle state; §15 records that parsing, file-signature detection, the Platform Admin authorization
shell and full dry-run reporting **do not depend on this decision at all.**

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

Stated as lifecycle values rather than a single flag, because the honest answer differs by stage:

```text
MIGRATION_REQUIRED_FOR_ANALYSIS                       = NO
MIGRATION_REQUIRED_FOR_PARSER_AND_DRY_RUN_FOUNDATION  = NO
MIGRATION_REQUIRED_FOR_DURABLE_EXECUTION              = UNRESOLVED / LIKELY YES
MIGRATION_CREATED                                     = NO
MIGRATION_TESTED                                      = NO
PRODUCTION_MIGRATION                                  = NO
ROLLBACK_METHOD                                       = N/A (nothing created)
```

`MIGRATION_REQUIRED_FOR_DURABLE_EXECUTION` is **`UNRESOLVED`, not `YES`**. The final execution schema
depends on which provenance design is accepted (§6.1). Both candidate designs are expected to need
*some* additive schema — hence `LIKELY YES` — but the shape, the table count, and whether `Patient`
itself is touched at all are open questions for architecture review.

What is **not** open: parsing, file-signature detection, the Platform Admin authorization shell,
header discovery, mapping proposal and full dry-run reporting are all buildable with **no schema
change whatsoever** (§15, PRs 0–3). An earlier revision of this document stated
`MIGRATION_REQUIRED = YES (for any implementation)`; that was **incorrect** and is withdrawn — the
document's own evidence contradicts it.

**No Prisma migration was created by this task.** Any schema change required for durable execution must
receive **explicit program-owner architecture review before implementation**
(`NORAMEDI_MASTER_TRACKER.md` §8; §2.3 — no agent may self-approve). **No schema exception is granted by
this document or by its R1 review.**

### What architecture review would have to weigh

Expand-migrate-contract, additive only, no destructive change. The table below is **illustrative of the
shape of the request** — it is not an adopted design, and the design column shows which §6.1 option each
item belongs to:

| # | Candidate change | Purpose | §6.1 design |
| --- | --- | --- | --- |
| 1 | `MigrationRun` table — `id`, `organizationId`, `clinicId`, `sourceSystem`, `profileVersion`, `status`, `sourceChecksums`, `actorPlatformAdminId`, timestamps | Run identity, reconciliation, resumability | (b) |
| 2 | `MigrationImportedRecord` table — `runId`, `entityType`, `sourceId`, `destinationId`, `outcome` (`created`/`matched`/`updated`), `createdAt`; `@@unique([runId, entityType, sourceId])` | Idempotency + provenance-aware rollback | (b) |
| 3 | `Patient.sourceSystem` + `Patient.sourceExternalId`, with `@@unique([organizationId, sourceSystem, sourceExternalId])` | Tenant-scoped idempotency anchor on the entity itself | (a) |

Items 1–2 are additive tables touching no existing model — the closest precedent to the R-079
exception. Item 3 alters `Patient` and is the materially larger ask. A design built on 1–2 alone may
avoid touching `Patient` at all; weighing that trade-off is precisely what review is for.

**A zero-migration foundation exists and should be built first regardless of the outcome.**
`dataRetentionManualRunAudit.ts` models an entire Platform-Admin run lifecycle on
`PlatformAdminAuditEvent`'s free-form `action`/`outcome` + JSON `safeMetadata` (`:11-12`) **with no
schema change at all**. That is sufficient for a **dry-run-only** capability — classification,
reporting and reconciliation counts — because a dry-run writes no domain rows and so needs no durable
provenance. It is **not** sufficient for durable execution. So: **dry-run is buildable today; execution
awaits an accepted provenance design.**

If a migration is later approved, the mandatory proof (per `docs/compliance/53-…md:182-183`, `:503-507`)
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
run equals `created + matched`; every provenance record's destination reference resolves to a live row
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
either. Rollback must be provenance-aware, driven by whatever durable provenance record the accepted
§6.1 design provides:

| Outcome recorded | Rollback rule |
| --- | --- |
| `created` | Deletable — but only after verifying **no dependent rows** were created since (appointments, payments, messages, consent events). If dependents exist, downgrade to `archived` rather than delete |
| `updated` | **Not automatically reversible** — requires the pre-image. Either store the changed fields' prior values alongside the provenance record, or declare updates out of scope for v1 |
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
| **PR 0** — **`F3-DATA-MIG-PR0`** | **Platform Admin full-migration intake safety foundation.** A **NEW** Platform Admin migration route/shell only: explicit `organizationId` + `clinicId` targeting re-verified by the backend; the Platform Admin authorization boundary (§10); safe file-type/**signature** classification; **typed unsupported-format errors** (U-1, U-2 remediated in the new intake). **No domain writes. No schema change. No change to the existing basic clinic patient importer** | **NO** | — **ready to scope** |
| **PR 1** — **`F3-DATA-MIG-PR1`** | **Legacy `.xls` parser + canonical migration source contract + synthetic `.xls` fixture + parser/security tests.** Requires a maintained-parser dependency decision — SheetJS's npm-published `xlsx@0.18.5` carries known advisories and current SheetJS is distributed off-npm. **This is a supply-chain decision for the program owner**, not an agent's. Vendor-neutral canonical input contract (§6). **No change to the basic clinic importer's behaviour** | **NO** | Dependency approval |
| **PR 2** — **`F3-DATA-MIG-PR2`** | **Platform Admin upload / mapping / dry-run.** Header discovery, mapping proposal, validation, **dry-run and preview with zero domain writes**, on `PlatformAdminAuditEvent` with **no schema change** — the `dataRetentionManualRunAudit` pattern. Full authorization + tenant-isolation test matrix | **NO** | PR 1 |
| **PR 3** | Canonical normalization — canonical phone normalizer (G-6), consolidating the 6 implementations behind one contract | **NO** | — (independently valuable) |
| **PR 4** | Provenance + idempotent patient **execution** | **LIKELY** | **Accepted §6.1 provenance design, then program-owner architecture review of whatever schema it needs (§12)** |
| **PR 5** | Practitioner / service reference mapping | YES | PR 4 + K-3 |
| **PR 6** | Historical treatment/procedure migration + domain write contracts + side-effect suppression | YES | PR 5 + **K-1/K-2 source files** |
| **PR 7** | Historical finance migration | YES | PR 6 + U-4/U-5 fixed |
| **PR 8** | Reconciliation + rollback + evidence + first-customer rehearsal | — | All above + **`FIRST_CUSTOMER_RECOVERY_GATE = SATISFIED`** |

**PRs 0–3 need no schema change and are therefore not blocked by the freeze boundary.** They are the
entire near-term path, and none of them waits on the §6.1 provenance decision.

**Every PR above builds NEW Platform Admin surface. None of them touches the existing basic clinic
patient importer** (§1) — not its routes, its UI, its roles, its row limit, its `.xlsx` behaviour or
its tests, and it is not reused or refactored as part of the migration engine.

An earlier revision (`R1`) proposed a PR 0 that removed the clinic-facing importer. **That is
withdrawn**; PR 0 is now purely additive new-capability work.

---

## 16. Test matrix

To be implemented with the PRs above; mapped to existing patterns to imitate.

| # | Test | Layer | Imitate |
| --- | --- | --- | --- |
| 1 | Unauthenticated → 401, **zero** audit rows | 3 | `server/src/tests/retentionManualRunAudit.test.ts:236-239` |
| 2 | Clinic JWT (`type=clinic_user`) → 401/403, zero rows, `next()` never called | 3 | same `:245-253`; `platformAdmin.test.ts:298` |
| 3 | Each of OWNER/ORG_ADMIN/CLINIC_MANAGER/RECEPTIONIST/DENTIST/BILLING denied **on the new Platform Admin migration routes**. The existing basic clinic importer keeps its own authorization unchanged and is not asserted against here | 3 | as above |
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
| 14 | Idempotent rerun creates no duplicates | 3 | requires the accepted §6.1 provenance design (PR 4) |
| 15 | Failure in batch N → resume preserves prior batches, no duplicates | 3 | requires the accepted §6.1 provenance design (PR 4) |
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
PATIENT_MASTER_DATA_READY   = NO   (no legacy parser; no accepted provenance design)
TREATMENT_HISTORY_READY     = NO   (no source data; no write contract)
PROCEDURE_HISTORY_READY     = NO   (same)
FINANCIAL_HISTORY_READY     = NO   (no source data; U-4/U-5 open)
REFERENCE_MAPPING_READY     = NO
IDEMPOTENT_RERUN_READY      = NO   (no accepted provenance design — §6.1)
ROLLBACK_READY              = NO   (no durable provenance record — §6.1)
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

**Closed in R2:** the scope of the existing basic clinic patient import. **It is retained exactly as
it is, and is out of scope for this program** (§1). The Platform-Admin-only rule applies to the new
full clinic data migration capability alone and is not retroactive. R1's contrary conclusion — that
the importer conflicted and had to be removed — is withdrawn.

Still open:

1. **`.xls` dependency** — which parser, given the supply-chain profile (PR 1).
2. **Provenance design** — (a) provenance fields on `Patient` with tenant-scoped uniqueness, or (b) a
   separate provenance/mapping table (§6.1) — followed by explicit architecture review of whatever
   additive migration the chosen design needs (§12). Blocks PR 4 onward; **blocks nothing in PRs 0–3**.
3. **`TCNO` / `CINSIYET`** — add fields to `Patient`, or accept that the customer's identity and
   gender data cannot be migrated (G-2). Identity numbers would additionally require an
   encryption-at-rest decision; `utils/encryption.ts` currently protects **secrets only**, and no
   patient PII column is encrypted.
4. **Plan limits** — 14,890 patients versus a `maxPatients` default of 500 (§11).
5. **Mandatory MFA** for Platform Admin migration routes (§10).
6. **Special-category data** (`KANGURUBU`, clinical notes) — legal decision required before mapping.
7. **Source exports** — request treatment/procedure/payment/appointment/practitioner exports from
   the legacy vendor (K-1/K-2). Nothing beyond patient master data can be designed without them.

---

## 20. This task's execution lifecycle and R1 corrections

### Execution lifecycle — stated without inflation

**No TypeScript, application, schema, migration, parser, UI, permissions, route or test code was
changed** by `F3-DATA-MIG-PREP-001` or by its `R1` and `R2` correction passes. No application typecheck and no server suite was
run, because running one would produce evidence about code this task never touched. A generic
`TESTS_PASSED = YES` would therefore be misleading, and is **not** claimed:

```text
AGENT_COMPLETED                    = YES
APPLICABLE_DOC_PRIVACY_GATE_PASSED = YES
APPLICATION_TESTS_RUN              = NO
TYPECHECK_RUN                      = NO
SERVER_SUITE_RUN                   = NO
PR_OPENED                          = YES   (#442, DRAFT)
MERGED                             = NO
DEPLOYED                           = NO
PRODUCTION_VERIFIED                = NO
```

The one applicable gate, with its exact command and its real result:

| Command | Result |
| --- | --- |
| `npm run log-privacy-guard:scan -- --strict-baseline` | **PASS, exit 0** — 269 files scanned, *"No new violations"*, 103 grandfathered entries, **no new baseline exception added** |
| `git diff --check` | exit 0 |
| `git diff --numstat` on `NORAMEDI_MASTER_TRACKER.md` | additive only — **zero deleted lines** |

### R2 product-scope correction (supersedes R1 item 1)

| # | Correction | Applied in |
| --- | --- | --- |
| R2-1 | **The existing basic clinic patient import is RETAINED, WORKING and OUT OF SCOPE.** `EXISTING_BASIC_CLINIC_PATIENT_IMPORT = RETAINED / OUT_OF_SCOPE / UNCHANGED`. No migration-program work removes it, disables it, changes its roles, drops `RECEPTIONIST`, moves it to Platform Admin, touches `PatientImportModal.tsx` / `patientsImport.ts`, changes its row limit or `.xlsx` behaviour, or reuses it in the migration engine | §1 |
| R2-2 | **Only the NEW full clinic data migration capability is Platform Admin-only**, and the rule is **not retroactive**. `FULL_CLINIC_DATA_MIGRATION = PLATFORM_ADMIN_ONLY` | §1, §10 |
| R2-3 | **All "conflict / must be removed" wording withdrawn.** The importer is reclassified `EXISTS / WORKING / OUT_OF_SCOPE` and recorded as reusable repository evidence rather than a defect; U-3 is marked **WITHDRAWN** | §1, §2 matrix, §4.2 (U-1/U-2/U-3), §19, §20 |
| R2-4 | **PR sequence replaced.** `F3-DATA-MIG-PR0` is now *Platform Admin full-migration intake safety foundation* — new surface only, no domain writes, no schema change, no change to the existing importer. PR 1 parser + canonical source contract; PR 2 upload/mapping/dry-run | §15 |
| R2-5 | **Pre-existing findings inside the out-of-scope importer are reported, not actioned** — U-2's extension/MIME-only file-type trust is raised for a future independent task; the remediation for this program lands in the new intake | §4.2 |

**R1 item 1 below is superseded by the R2 table above. R1 items 2–6 stand unchanged.**

### R1 architecture-review corrections

| # | Correction | Applied in |
| --- | --- | --- |
| 1 | ~~Product decision closed — removal is final~~ — **SUPERSEDED BY R2.** The importer is retained and out of scope; see the R2 table above | §1 (rewritten) |
| 2 | **Idempotency/provenance overclaim corrected.** "Impossible" → *no accepted durable cross-run provenance mechanism*; two valid designs recorded; the final schema is deliberately **not** pre-decided here | §2, §6.1, §13, §14, §17 |
| 3 | **`MIGRATION_REQUIRED` split into precise lifecycle values.** Analysis and the parser/dry-run foundation are `NO`; durable execution is `UNRESOLVED / LIKELY YES`. The former blanket `YES (for any implementation)` is withdrawn as contradicted by this document's own evidence | §12 |
| 4 | **Freeze-boundary wording corrected to `NOT AUTHORIZED YET`.** The prohibition on *broad* Prisma refactoring is no longer presented as an automatic ban on every narrow additive migration; what is required is explicit program-owner architecture review. **No schema exception is granted by R1** | §0, §12 |
| 5 | **Test lifecycle stated precisely** — no unqualified `TESTS_PASSED = YES`; the exact command run and its real result are preserved | §20 (this section) |
| 6 | **Program state re-verified unchanged** — `F4 COMPLETE = NO`, `FIRST_CUSTOMER_RECOVERY_GATE = NOT_SATISFIED`, `F5 AUTHORIZED = NO`, `R-030` / `R-030-DB` / `R-030-FILES` `OPEN`, `repo2` NOT ACTIVATED | §0 |

**R1 and R2 both changed documentation only, on the same branch and the same draft PR #442. No new PR
was opened, nothing was merged, and nothing was deployed. No runtime, schema, migration, parser, UI,
permissions, route or test file was modified by any revision of this task.**

---

## 21. Patient Field Gap & Secure Identity Decision Package

**Added by `F3-DATA-MIG-001` / `-002` / `-003` (2026-08-18). Additive — nothing above this line is
altered, withdrawn or overwritten.** The record of PR #442 stands as accepted historical evidence.

The follow-on analysis lives in a companion document so this contract is not duplicated:

**→ [PATIENT_FIELD_GAP_AND_IDENTITY_DECISION_PACKAGE.md](PATIENT_FIELD_GAP_AND_IDENTITY_DECISION_PACKAGE.md)**

It extends this contract with:

- **complete per-column coverage** — all 91 source columns individually dispositioned, where §7 above
  dispositioned ~30, most of them in groups;
- **a secure national-identifier architecture** answering §19 open decision 3 (`TCNO`) — model shape,
  encryption, searchable lookup, uniqueness, masking, authorization, audit, retention and backup;
- **an explicit gender recommendation** answering the `CINSIYET` half of that decision;
- **a ranked gap package** (P0 / P1 / P2 / defer) with a proposed additive schema set, all marked
  `NOT_AUTHORIZED_YET`;
- **an expanded source dataset register** adding four datasets §5 above does not list — the
  odontogram, payment plans, lab orders, and the attachment/imaging binary corpora.

### Corrections it applies to this document

Recorded here so this contract is not read in isolation. Full evidence in §2 of the companion.

| # | Correction |
| --- | --- |
| C-1 | §3 declares **91** named columns and enumerates **90**. One column name is missing from the transcription — **no mapping profile can be certified complete until the verbatim header row is re-emitted** |
| C-2 | `ADRES_KODU` → `Patient.postalCode` is downgraded to `MANUAL_REVIEW`; it is plausibly a 10-digit UAVT address code, not a 5-digit postal code |
| C-3 | `ULKE` is a **valid mapping carrying zero rows**, not an `IGNORE` |
| C-4 | The government/health identifiers are `BLOCKED_NO_DESTINATION`, not `IGNORE` |
| C-5 | `EVTELEFONU` / `ISTELEFONU` are `BLOCKED_NO_DESTINATION`. **They must never be written to `PatientEmergencyContact`** |
| C-6 | `DOSYANO` is **clinic-facing, not vendor-internal** — dropping it makes the clinic's paper archive unresolvable |
| C-7 | `ONEMLINOT` and `KONTROLNOTU` fill rates were **never measured**; "empty in this file" is unsupported for them |
| C-8 | `Patient` has **no practitioner field at all**, so a resolved `User.id` has nowhere to land — two gaps, not one |
| D-1 | G-6 undercounts: there are **8** phone normalizers, not 6 |
| D-3 | K-2 narrows to a testable hypothesis — **DigiDentiS**, whose API contract is already in this repo and already integrated |

**No program state changed. No schema, migration or runtime code was created or modified.**
`SCHEMA_CHANGE_AUTHORIZED = NO`.

### 21.1 R1 program-owner corrections (2026-08-18) — additive, nothing above withdrawn

The companion document received a program-owner architecture-review pass (R1) after this §21 was
first added. **Additive only** — the §21 record above and PR #442's evidence stand unchanged. R1's
corrections, in full, live in the companion document; summarized here so this contract is not read in
isolation:

| # | R1 correction | Companion §§ |
| --- | --- | --- |
| 1 | `TCNO`/national-identity data reclassified `P0_FIRST_CUSTOMER_BLOCKER` (was `P1`) — a program-owner decision, not an engineering one. The absence of a current NoraMedi consumer does not make discarding ~11,500 identity values acceptable for a full clinic migration | §6.0, §15 |
| 2 | `PatientIdentityDocument` is `CANDIDATE_ACCEPTED_FOR_NEXT_DESIGN_STAGE` — the leading candidate, explicitly **not** an approved schema | §6.0, §6.1, §6.3 |
| 3 | Withdrawn: reusing the general `ENCRYPTION_KEY` for patient identity ciphertext. Required: dedicated, isolated key material with `cryptoVersion`, rotation, backwards decryption, fail-closed startup, no raw-PII logging, testable lifecycle, and a path to future KMS/envelope encryption | §6.2a |
| 4 | HMAC lookup design corrected to an explicit tenant-bound requirement — a single global `HMAC(pepper, normalizedTCNO)` is rejected; the same identity value in two organizations must never produce the same lookup token | §6.4 |
| 5 | Platform Admin access split: no general plaintext read/unmask, but an audited migration write-through capability that ingests, classifies, encrypts and persists identity data without exposing plaintext through ordinary APIs/UI | §6.6, §6.6a |
| 6 | Withdrawn: "a parent's TC on a child's row proves duplicate identities are legitimate domain semantics." Corrected: source ambiguity / data-quality debt, classified `AMBIGUOUS` / `MANUAL_REVIEW`, never auto-merged. The no-hard-unique-constraint outcome is unchanged; the reasoning is corrected | §6.5 |
| 7 | Gender remains a recommendation (`GENDER_FIELD_REQUIRED = YES`, `GENDER_DOMAIN_CONTRACT = NOT_AUTHORIZED_YET`), not proof of an accepted contract — the basic importer validates and discards the value, which is evidence, not a persisted contract | §8 |
| 8 | Health Tourism confirmed as a separate future modular-monolith module; US-01.8 is backlog/context evidence only and must not be used to pull tourism workflows into Patient Core or this migration | §7.0 |
| 9 | Five pre-existing defects explicitly tagged `PRE_EXISTING = YES` / `CAUSED_BY_MIGRATION = NO` / `SEPARATE_TASK_REQUIRED = YES`: broad-projection scalar auto-exposure, anonymization/export field-list drift, log-privacy-guard identity-field gap, `primaryClinicId` runtime gap, accent-insensitive search gap | §16.1 |
| 10 | `PLAN_LIMIT_DECISION_REQUIRED_BEFORE_EXECUTION = YES` made explicit, with required dry-run reporting fields (source/destination counts, resulting count, org/clinic plan caps, blocked/allowed) | §17 item 5 |

**Still true after R1:** `SCHEMA_CHANGE_AUTHORIZED = NO`, `MIGRATION_CREATED = NO`. No schema,
migration, encryption, parser, route, UI, or existing-importer code was touched by R1 — documentation
only. Program state (`F4 COMPLETE` **NO** · `FIRST_CUSTOMER_RECOVERY_GATE` **NOT_SATISFIED** ·
`F5 AUTHORIZED` **NO** · `R-030`/`R-030-DB`/`R-030-FILES` **OPEN** · `repo2` **NOT ACTIVATED**) is
unchanged.

### 21.2 R3 targeted re-profiling corrections (`F3-DATA-MIG-001`, 2026-08-18) — additive, nothing above withdrawn

The companion document's own §18 named six cheap evidence gaps left after R1/R2 and recommended a
short, read-only re-profiling pass over the real workbook before the next PR. That pass was executed
(2026-08-18) — **the first time in this task family that the real workbook was actually re-opened**;
R1/R2 both worked from aggregates restated from §3 above. Full evidence lives in the companion
document's §19 R3 record and its §2a/§5/§14/§15/§18 updates; summarized here so this contract is not
read in isolation:

| # | R3 correction | Companion §§ |
| --- | --- | --- |
| 1 | **C-1 closed.** The missing 91st column name is `YAKINLIKKODU` (relationship/kinship code), omitted from every prior transcription including this contract's own §3. Measured 0.00 % filled | §5 matrix, C-11 |
| 2 | **C-2's measurement gap closed for this workbook.** `ADRES_KODU` measured 0.00 % filled — no data exists to resolve the UAVT-vs-postal-code question. **Disposition stays `MANUAL_REVIEW` (R4-corrected)** — 0 rows would be written for this source, but 0 % fill does not establish a direct mapping, and the semantic question itself remains open for any future source | §5 matrix, C-12 |
| 3 | **C-7 closed.** `ONEMLINOT` measured 45.70 % filled with substantial free text (confirms and strengthens the legal-decision blocker); `KONTROLNOTU` measured 0.01 % filled (near-vestigial). **Disposition stays `BLOCKED_LEGAL_DECISION` (R4-corrected)** — low volume does not remove the KVKK Art. 6 gate; row-level manual review of the 2 affected rows may follow as an additional step after the legal decision, not in place of it | §5 matrix, C-13/C-14 |
| 4 | **G-E6's measurement gap closed.** `DOSYANO` measured 98.84 % filled, 99.88 % distinct among filled (17 duplicate pairs). Confirms — does not merely restate — C-6's "clinic-facing, not vendor-internal" conclusion | §5 matrix, §14, C-15 |
| 5 | **G-E20 withdrawn.** `AILEGURUBU` measured 100 % filled, 100 % distinct, and never repeats even inside groups of rows sharing the same phone number — this refutes, not confirms, the family/household-key hypothesis that motivated G-E20. Reclassified vendor-internal | §5 matrix, §14, C-16 |

**Bonus finding:** `YAKINLIKKODU` (the C-1 column) is measured 0.00 % filled in this workbook — it is
the more plausible relationship-code candidate than `AILEGURUBU` if a family/household key is ever
needed again, but this workbook carries no data in it either.

**Not measured by R3, still open** (never part of this task's six-item scope, not a sixth targeted
item): `EK_ACIKLAMA`/`CHECKBOX` content shape, and roughly 25 other columns whose fill was never
profiled. **The full 91-column matrix is therefore not yet fully frozen**, though all six gaps this
task was scoped to close were measured and closed.

**No program state changed. No schema, migration, parser, route, permission, UI or existing-importer
code was created or modified.** `SCHEMA_CHANGE_AUTHORIZED = NO`. The scratchpad-only Python/`xlrd`
reader used for this measurement was never committed to this repository; the real workbook itself was
never copied into the worktree, committed, or attached anywhere, and no raw PII/PHI cell value was
printed or logged.

### 21.3 R4 architecture-review corrections (PR #444, 2026-08-18) — additive, nothing above withdrawn

Program-owner architecture review of PR #444 found two classification defects and one bookkeeping
defect in §21.2 above, corrected on the same branch/PR. Full evidence in the companion document's
"R4 architecture-review correction record"; summarized here so this contract is not read in isolation:

| # | R4 correction | Companion §§ |
| --- | --- | --- |
| 1 | `ADRES_KODU`: 0.00 % fill closes the measurement gap, not the semantic question. `IMPORT_DIRECT` was misleading — reverted to `MANUAL_REVIEW`, explicit `0 rows to write` for this source; the UAVT-vs-postal-code question stays open | §5 matrix, §5.1 counts |
| 2 | `KONTROLNOTU`: 2 populated rows does not remove the KVKK Art. 6 legal/special-category gate. Reverted `MANUAL_REVIEW` → `BLOCKED_LEGAL_DECISION`; row-level manual review may be an additional step **after** the legal basis/domain decision, not a replacement for it | §5 matrix, §5.1 counts |
| 3 | R3 bookkeeping corrected: the six user-requested measurements (header, `ADRES_KODU`, `ONEMLINOT`, `KONTROLNOTU`, `DOSYANO`, `AILEGURUBU`) were all six measured/closed. `EK_ACIKLAMA`/`CHECKBOX` was never one of those six and is no longer counted as the sixth item in the "must measure" table. The full 91-column matrix remains `NOT YET FULLY FROZEN` | §18, §19 lifecycle block |

**Preserved, not reopened by R4:** `YAKINLIKKODU` identification; `ONEMLINOT` measured and remains
`BLOCKED_LEGAL_DECISION`; `DOSYANO` P1 evidence; `AILEGURUBU` hypothesis withdrawal; no real workbook
in Git; no runtime/schema/migration/parser/UI code changed; program state unchanged.

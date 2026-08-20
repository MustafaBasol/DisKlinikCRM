# F3-DATA-MIG-TODAY-001-R10 — Final First-Customer Coverage

**Task:** `F3-DATA-MIG-TODAY-001-R10-FINAL-COVERAGE`
**Phase:** F3 Production Hardening / Clinic Data Migration
**Base:** `origin/main` @ `85943c2421601585a4cc25a2d926cdd3e3d9f7ed`
**Status:** `PR_OPEN (DRAFT)` · `MERGED = NO` · `DEPLOYED = NO` · `REAL_CUSTOMER_EXECUTE = NOT PERFORMED`

---

## 0. Baseline correction — read first

The task brief named `ea96af8a91c5161285e39edab07d894b0ff8356e` as the production/main baseline.
That commit **is** in `origin/main`'s history (it is the merge of PR #462), but `origin/main` had
already advanced past it to `85943c2` (merge of PR #459, the F4 imaging / VPS2 storage lane). This
task branched from **`85943c2`**, not from the stated SHA.

Consequence for the tracker: the R9 entry still records `MERGED = NO` for PR #462, which is now
stale — #462 is merged. That line is corrected additively by this task's tracker entry rather than
rewritten in place.

---

## 1. What this task set out to remove

R9 shipped a fail-closed data-loss gate and, correctly, refused to let the first customer execute.
Its blocking reasons were:

| R9 blocker | Status after R10 |
| --- | --- |
| 58 of 91 source columns never measured | **GONE** — all 91 measured |
| 5 unconfirmed system exclusions | Now 8, all measured-safe, still operator-confirmed |
| 4 manual-review columns | **GONE** — 3 given real fields, 1 preserved |
| 3 sensitive-review columns | **REMAIN** — genuine KVKK Art. 6 decision |
| 25 practitioner references unapproved | **RESOLVABLE** — the workflow works end to end |
| "NoraMedi has no field for it" (10 columns) | **GONE** — every one has a destination |

---

## 2. The measurement, and why the previous evidence could not be trusted

R9's fill table was a HAND TRANSCRIPTION of
`PATIENT_FIELD_GAP_AND_IDENTITY_DECISION_PACKAGE.md` §5. R10 replaced it with the output of the
repository's **own analyze code** — `parseSourceWorkbook()` then `profileColumns()` from
`server/src/services/migration/parser/canonicalParser.ts` — run over the accepted workbook and
emitted mechanically, so it cannot drift from the file again.

```
file      hastalar tüm liste.xls
sha256    f08c001991b5e2b6647d2a1b3b51156dce82511edaa900843bb01e4384da5612
size      11,291,648 bytes (OLE2 / BIFF8)
sheet     "Sayfa1", single visible sheet, 1900 date epoch
shape     14,891 × 92 physical → 91 named columns × 14,890 data rows
          (physical column 0 is the structurally-empty leading column and is
           dropped by the canonical parser, exactly as documented)
```

### 2.1 The transcription was materially wrong

| Column | R9 recorded | Actually measured |
| --- | --- | --- |
| **`ULKE`** | **0 %** | **14,890 / 14,890 (100.00 %)** |
| `CINSIYET` | 11,807 | 11,814 |
| `DOGUMTARIHI` | 10,349 | 10,342 |
| `EVTELEFONU` | 45 | 50 |
| `ISTELEFONU` | 164 | 166 |
| `CEPTELEFONU` | 13,609 | 13,613 |
| `HASTADOKTOR` | 14,816 | 14,814 |
| `KVKKILKKODU` | 4,750 | 4,754 |

`ULKE` is the one that matters: a gate deciding whether clinic data may be dropped was reading a
figure **off by every row in the file**.

### 2.2 Measuring made the picture bigger, not smaller

26 of the 58 unknowns turned out to carry data. Ten of them were `BLOCKED` — real rows with nowhere
to go, invisible to R9 precisely because nobody had profiled them:

`UNVANI` 14,890 · `SUBEDOSYANO` 9,105 · `FAX` 96 · `MEDENIHALI` 57 · `ANNEADI` 25 ·
`BABAADI` 18 · `ALTDOSYANO` 10 · `TURIZM` 6 · `SIGORTATURU` 2 · `UCRETTARIFESI` 1

### 2.3 Questions the measurement CLOSED

- **`KVKKILKKODU` — K-4 is answered, and the answer is NOT consent.** 4,754 rows / 4,633 distinct;
  every value a 5-digit integer in `[10023, 99971]`; fill by registration year **0 % for 2016–2021,
  44 % in 2022, 100 % for 2023–2026**; co-occurs with `MESAJOK = true` on **exactly one row**. That
  is a sequential register key switched on mid-2022 — not a flag, not correlated with messaging.
  It is preserved as a vendor reference and grants no lawful basis.
- **`MESAJOK`** — 14,153 filled, **only 4 true**. The hard rule (never map to consent) is intact,
  and the measurement makes it concrete: reading it as consent would have granted a basis for 4
  patients while implying a decision about 14,149 others.
- **`KVKKONAYKODU` / `KVKKSMS`** — both measured **0 %**. The consent gate holds at zero cost.
- **`SUBE_ID`** — 9,083 rows, **one distinct value: the literal string `"none"`**. The standing
  question of reconciling source branch semantics against the target clinic is closed: there are
  none.
- **`AILEGURUBU`** — **identical to `HASTA_ID` on all 14,890 rows.** Not a family key; a copy of a
  primary key already imported as `provenance.sourceId`.
- **`UNVANI`** — 100 % of values contain the patient's own `ADI`; 2–3 words. A derived "Ad Soyad"
  display string, not a title. No honorific field was ever needed.
- **`KANGURUBU`** — 1 filled row, value `"Bilinmiyor"` (*Unknown*). **This export contains no blood
  group data at all.**

### 2.4 A category the old table could not express

Ten columns are filled but **CONSTANT** — one distinct value across every filled row, so they
distinguish no patient from any other: `UST_HESAP_KODU` (13,985 × one ledger code), `SUBE_ID`,
`KAYDEDEN` (14,890 × `"admin"`), `CHECKBOX` (3,500 × `"Yeni"`), `DOSYAVAR` (3,051 × `"false"`),
`KANGURUBU`, `RISK_TUTARI` (2 × `"0"`), `UCRETTARIFESI`, `EK_ACIKLAMA`, `ODEMESONTARIHI`.

`informationContent` records this. It is **decision-support, not a decision**: every one is still
counted `MEANINGFUL` by the gate and still requires an explicit operator confirmation.
`fillEvidenceClassOf()` is deliberately unchanged.

---

## 3. What was built

### 3.1 Schema — additive only, one migration

`20260820120000_add_patient_district_contact_points_and_preserved_source_values`

| Object | Why |
| --- | --- |
| `Patient.district String?` | The missing half of a Turkish address. `Patient.city` is UNCHANGED and keeps its province/il meaning; the UI simply labels it "Province / İl". Not folded into `address` — composition order would then depend on fill rate and break rerun stability. |
| `PatientContactPoint` | Secondary patient phones (home/work/other). **Not** `PatientEmergencyContact`: routing a patient's own second number there would fabricate a named third party and, through `isLegalDecisionMaker`, a clinical decision-making authority nobody asserted. |
| `MigrationPreservedSourceValue` | Controlled legacy preservation — one ROW per value, never a JSON blob. |

**`Patient.phone` is untouched.** It remains THE primary number; WhatsApp inbound matching, the
shared-family-phone behaviour (1,883 numbers shared across 4,390 rows in this export), SMS routing
and `@@index([clinicId, phone])` all continue to read it and only it. Nothing in
`PatientContactPoint` participates in patient matching.

**Why preservation is not a JSON dump.** Each row carries `migrationRunId` (which run),
`sourceSystem` (which vendor), `sourceColumn` (byte-exact vendor column), `sourceRowNumber`, and a
`sensitivity`. There is no clinic-facing write API; the only writer is the Platform-Admin-gated
executor. It is EVIDENCE, never current clinical truth: no clinical, messaging, billing or
patient-matching code path reads it.

**Why no encrypted identifier model was built.** Every government-identifier column in this
workbook measured **0 filled rows** — `PASAPORTNO`, `SOSYAL_GUVENCE_NO`, `ENABIZTAKIPNO`,
`YUPASS_NO`, `HTS_KODU`, `VERGINO`. `TCNO` already has its encrypted home in
`PatientIdentityDocument`. Building a second crypto boundary for data that does not exist would be
speculative complexity; if a future source carries one, it belongs in `PatientIdentityDocument`.

**Why no legacy consent-evidence model was built.** There is no consent evidence to import.
`KVKKONAYKODU` and `KVKKSMS` are 0 %; `MESAJOK` is a vendor UI toggle with 4 true values;
`KVKKILKKODU` is provably a register key. Building a consent model here would have created a
container with nothing lawful to put in it.

### 3.2 Mapping

New destinations: `patient.district`, `patient.contactPoint.home`, `patient.contactPoint.work`, and
`legacy.preservedSourceValue` in a **new `legacy_preservation` group**.

That group is deliberately **not** `historical_evidence`. The latter exists to let a `LEGAL_BLOCKED`
consent column through the gate under a narrow exception; it still has **zero members** and remains
structurally unreachable. Keeping them apart is what stops *"we needed somewhere to put
SUBEDOSYANO"* from becoming *"a migration may write consent evidence"*.

New disposition `PRESERVE_LEGACY_SOURCE` resolves to `AUTO_REVIEW`: **proposed, never applied**.
Writing PII into a new table is a decision with privacy weight. Accepting it loses nothing; the
alternative was discarding the column.

`allowsIndependentMultiUse` marks the one destination where N columns produce N distinguishable rows
rather than one composed value, so the collision rule and the composition-ordering rule both
correctly stand down for it.

### 3.3 Privacy — wired, not merely declared

All three additions reach every surface: subject-access export; anonymization (**hard delete** for
both new models, ordered BEFORE `isAnonymized = true`, plus the already-anonymized backfill branch);
clinic bulk export (RESTRICTED preserved values filtered in the Prisma `where`, so they never enter
process memory); data retention (new category, 10-year default with recorded reasoning); the
deletion-review inventory; and the log-privacy guard's `DIRECT_PII_IDENTIFIER_NAMES`.

The schema-drift guard now parses both new models and asserts their tenant columns, their exact
indexes, their pinned long index names, and that anonymization deletes both — so a future refactor
that drops a privacy pass fails loudly.

---

## 4. Real-workbook rehearsal

Driven through the **actual Platform Admin route stack** (auth gate + real handlers, including
multer for the upload), against the real workbook and a disposable PostgreSQL 16.

```
STEP 1  create run          OK   status=CREATED
STEP 2  upload              OK   status=UPLOADED  bytes=11,291,648  format=xls
STEP 3  ANALYZE             OK   610–1077 ms   status=MAPPING_REQUIRED
        totalSourceRows=14,890   headerColumnCount=91
STEP 4  mappings            OK   91 columns persisted
        MEASURED 91/91   UNMEASURED 0   zero-data 42   meaningful 49
        states: AUTO_CONFIDENT=18 AUTO_REVIEW=21 BLOCKED=22 IGNORE=23
                LEGAL_BLOCKED=2 MANUAL_REQUIRED=1 SENSITIVE_REVIEW_REQUIRED=4
STEP 5  accept-auto         OK   21 AUTO_REVIEW -> RESOLVED
STEP 6  operator decisions  OK   50 columns decided   status=MAPPING_READY
STEP 7  references          OK   25 distinct HASTADOKTOR values, all resolved
STEP 8  DRY RUN             OK   ~1,450 ms
        parsedRows=14,890  validRows=14,889  invalidRows=1
        expectedCreateCount=14,889  referenceMappingBlockers=0  manualReviewRows=0
```

### 4.1 Data-loss gate — the real run

```
totalSourceColumns       91
meaningfulSourceColumns  49
zeroDataColumns          42
unmeasuredFillColumns     0
resolved                 38   (41 when special-category columns are approved)
manualReview              0
sensitiveReview           0
operatorConfirmed        11   (8 when special-category columns are approved)
UNCONFIRMED exclusions    0
blockedMeaningful         0
legalBlockedMeaningful    0
unaccountedMeaningful     0
balanced               true
SATISFIED              TRUE
```

Verified under **both** legitimate operator answers for the three KVKK Art. 6 columns —
declining them (operator-confirmed exclusion) and approving them (imported) — and the gate is
`satisfied = true` either way.

### 4.2 The one remaining dry-run blocker

```
[ROW_VALUE_INVALID] date_excel_serial: value is in the future;
                    the patient write schema rejects future birth dates
```

**One row** of 14,890 carries a future date of birth. `executable = false` because
`blockerList.length === 0` is part of the executable condition — pre-existing R7/R8/R9 fail-closed
behaviour, deliberately not weakened here. This is a **source-data defect for the customer to
correct**, not an engineering gap: the alternative (silently skipping the row) is exactly the
silent data loss this programme exists to prevent.

`REAL_CUSTOMER_EXECUTE` was **not** performed and is **not** authorized by this task.

---

## 5. Complete 91-column disposition table

Every column ends in one of the four required states. `FILLED` is the measured non-empty row count
out of 14,890. No cell value appears anywhere in this document.

| # | SOURCE_HEADER | FILLED | ZERO? | INFO | MAPPING_STATE | SEMANTIC_CLASS (disposition) | TARGET_DOMAIN | TARGET_FIELD / MODEL | TRANSFORM | SENS? | REVIEW? | PRESERVED? | EXCLUSION_ALLOWED? | FINAL_STATUS |
|---|---|---:|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `HASTA_ID` | 14,890 | — | VARYING | AUTO_CONFIDENT | IMPORT_AFTER_SCHEMA_FIELD | MigrationRecord | `provenance.sourceId` | `provenance_source_id` | — | — | — | — | B · CANONICAL_DOMAIN_RECORD |
| 2 | `HESAP_KODU` | 0 | YES | NO_DATA | IGNORE | IGNORE_VENDOR_INTERNAL | — | — | — | — | — | — | YES (operator) | ZERO_DATA — nothing to lose |
| 3 | `UST_HESAP_KODU` | 13,985 | — | CONSTANT | IGNORE | IGNORE_VENDOR_INTERNAL | — | — | — | — | — | — | YES (operator) | D · EXPLICIT_OPERATOR_CONFIRMED_EXCLUSION |
| 4 | `SUBE_ID` | 9,083 | — | CONSTANT | IGNORE | IGNORE_VENDOR_INTERNAL | — | — | — | — | — | — | YES (operator) | D · EXPLICIT_OPERATOR_CONFIRMED_EXCLUSION |
| 5 | `UYRUK` | 0 | YES | NO_DATA | BLOCKED | BLOCKED_NO_DESTINATION | — | — | — | — | — | — | YES (operator) | ZERO_DATA — nothing to lose |
| 6 | `ULKE` | 14,890 | — | VARYING | AUTO_CONFIDENT | IMPORT_DIRECT | Patient | `patient.country` | `trim` | — | — | — | — | A · CANONICAL_NORAMEDI_FIELD |
| 7 | `TCNO` | 11,500 | — | VARYING | AUTO_CONFIDENT | IMPORT_AFTER_SCHEMA_FIELD | PatientIdentityDocument | `patient.identity.tckn` | `identity_tckn` | — | — | — | — | B · CANONICAL_DOMAIN_RECORD |
| 8 | `PASAPORTNO` | 0 | YES | NO_DATA | BLOCKED | BLOCKED_NO_DESTINATION | — | — | — | — | — | — | YES (operator) | ZERO_DATA — nothing to lose |
| 9 | `SOSYAL_GUVENCE_NO` | 0 | YES | NO_DATA | BLOCKED | BLOCKED_NO_DESTINATION | — | — | — | — | — | — | YES (operator) | ZERO_DATA — nothing to lose |
| 10 | `SOSYAL_GUVENCE_KURUMU` | 0 | YES | NO_DATA | BLOCKED | BLOCKED_NO_DESTINATION | — | — | — | — | — | — | YES (operator) | ZERO_DATA — nothing to lose |
| 11 | `YAKINLIKKODU` | 0 | YES | NO_DATA | BLOCKED | BLOCKED_NO_DESTINATION | — | — | — | — | — | — | YES (operator) | ZERO_DATA — nothing to lose |
| 12 | `DOSYANO` | 14,718 | — | VARYING | AUTO_CONFIDENT | IMPORT_AFTER_SCHEMA_FIELD | Patient | `patient.chartNumber` | `chart_number` | — | — | — | — | A · CANONICAL_NORAMEDI_FIELD |
| 13 | `SUBEDOSYANO` | 9,105 | — | VARYING | AUTO_REVIEW | PRESERVE_LEGACY_SOURCE | MigrationPreservedSourceValue | `legacy.preservedSourceValue` | `preserve_source_value` | — | — | YES | — | C · CONTROLLED_LEGACY_SOURCE_PRESERVATION |
| 14 | `ADI` | 14,890 | — | VARYING | AUTO_CONFIDENT | IMPORT_DIRECT | Patient | `patient.firstName` | `trim_collapse` | — | — | — | — | A · CANONICAL_NORAMEDI_FIELD |
| 15 | `SOYADI` | 14,890 | — | VARYING | AUTO_CONFIDENT | IMPORT_DIRECT | Patient | `patient.lastName` | `trim` | — | — | — | — | A · CANONICAL_NORAMEDI_FIELD |
| 16 | `RESIMUZANTI` | 0 | YES | NO_DATA | IGNORE | IGNORE_VENDOR_INTERNAL | — | — | — | — | — | — | YES (operator) | ZERO_DATA — nothing to lose |
| 17 | `UNVANI` | 14,890 | — | VARYING | AUTO_REVIEW | PRESERVE_LEGACY_SOURCE | MigrationPreservedSourceValue | `legacy.preservedSourceValue` | `preserve_source_value` | — | — | YES | — | C · CONTROLLED_LEGACY_SOURCE_PRESERVATION |
| 18 | `CINSIYET` | 11,814 | — | VARYING | AUTO_CONFIDENT | IMPORT_AFTER_SCHEMA_FIELD | Patient | `patient.gender` | `gender_tr` | — | — | — | — | A · CANONICAL_NORAMEDI_FIELD |
| 19 | `KANGURUBU` | 1 | — | CONSTANT | SENSITIVE_REVIEW_REQUIRED | IMPORT_AFTER_SENSITIVE_REVIEW | Patient | `patient.bloodGroup` | `blood_group_tr` | YES | YES | — | — | A · CANONICAL_NORAMEDI_FIELD |
| 20 | `BABAADI` | 18 | — | VARYING | AUTO_REVIEW | PRESERVE_LEGACY_SOURCE | MigrationPreservedSourceValue | `legacy.preservedSourceValue` | `preserve_source_value` | — | — | YES | — | C · CONTROLLED_LEGACY_SOURCE_PRESERVATION |
| 21 | `ANNEADI` | 25 | — | VARYING | AUTO_REVIEW | PRESERVE_LEGACY_SOURCE | MigrationPreservedSourceValue | `legacy.preservedSourceValue` | `preserve_source_value` | — | — | YES | — | C · CONTROLLED_LEGACY_SOURCE_PRESERVATION |
| 22 | `DOGUMIL` | 0 | YES | NO_DATA | BLOCKED | BLOCKED_NO_DESTINATION | — | — | — | — | — | — | YES (operator) | ZERO_DATA — nothing to lose |
| 23 | `DOGUMILCE` | 0 | YES | NO_DATA | BLOCKED | BLOCKED_NO_DESTINATION | — | — | — | — | — | — | YES (operator) | ZERO_DATA — nothing to lose |
| 24 | `DOGUMTARIHI` | 10,342 | — | VARYING | AUTO_CONFIDENT | IMPORT_AFTER_NORMALIZATION | Patient | `patient.dateOfBirth` | `date_excel_serial` | — | — | — | — | A · CANONICAL_NORAMEDI_FIELD |
| 25 | `MEDENIHALI` | 57 | — | VARYING | AUTO_REVIEW | PRESERVE_LEGACY_SOURCE | MigrationPreservedSourceValue | `legacy.preservedSourceValue` | `preserve_source_value` | — | — | YES | — | C · CONTROLLED_LEGACY_SOURCE_PRESERVATION |
| 26 | `MESLEGI` | 0 | YES | NO_DATA | BLOCKED | BLOCKED_NO_DESTINATION | — | — | — | — | — | — | YES (operator) | ZERO_DATA — nothing to lose |
| 27 | `EVTELEFONU` | 50 | — | VARYING | AUTO_CONFIDENT | IMPORT_AFTER_SCHEMA_FIELD | PatientContactPoint | `patient.contactPoint.home` | `phone_tr` | — | — | — | — | A · CANONICAL_NORAMEDI_FIELD |
| 28 | `ISTELEFONU` | 166 | — | VARYING | AUTO_CONFIDENT | IMPORT_AFTER_SCHEMA_FIELD | PatientContactPoint | `patient.contactPoint.work` | `phone_tr` | — | — | — | — | A · CANONICAL_NORAMEDI_FIELD |
| 29 | `CEPTELEFONU` | 13,613 | — | VARYING | AUTO_CONFIDENT | IMPORT_AFTER_NORMALIZATION | Patient | `patient.phone` | `phone_tr` | — | — | — | — | A · CANONICAL_NORAMEDI_FIELD |
| 30 | `FAX` | 96 | — | VARYING | AUTO_REVIEW | PRESERVE_LEGACY_SOURCE | MigrationPreservedSourceValue | `legacy.preservedSourceValue` | `preserve_source_value` | — | — | YES | — | C · CONTROLLED_LEGACY_SOURCE_PRESERVATION |
| 31 | `EMAIL` | 7 | — | VARYING | AUTO_CONFIDENT | IMPORT_AFTER_NORMALIZATION | Patient | `patient.email` | `lower_trim` | — | — | — | — | A · CANONICAL_NORAMEDI_FIELD |
| 32 | `ADRESI` | 1,456 | — | VARYING | AUTO_CONFIDENT | IMPORT_AFTER_NORMALIZATION | Patient | `patient.address` | `compose_address` | — | — | — | — | A · CANONICAL_NORAMEDI_FIELD |
| 33 | `ADRES_KODU` | 0 | YES | NO_DATA | MANUAL_REQUIRED | MANUAL_REVIEW | — | — | — | — | YES | — | YES (operator) | ZERO_DATA — nothing to lose |
| 34 | `IL` | 14 | — | VARYING | AUTO_CONFIDENT | IMPORT_DIRECT | Patient | `patient.city` | `trim` | — | — | — | — | A · CANONICAL_NORAMEDI_FIELD |
| 35 | `ILCE` | 13 | — | VARYING | AUTO_CONFIDENT | IMPORT_AFTER_SCHEMA_FIELD | Patient | `patient.district` | `trim` | — | — | — | — | A · CANONICAL_NORAMEDI_FIELD |
| 36 | `MAHALLE` | 0 | YES | NO_DATA | AUTO_CONFIDENT | IMPORT_AFTER_NORMALIZATION | Patient | `patient.address` | `compose_address` | — | — | — | YES (operator) | ZERO_DATA — nothing to lose |
| 37 | `REFERANSI` | 0 | YES | NO_DATA | BLOCKED | BLOCKED_NO_DESTINATION | — | — | — | — | — | — | YES (operator) | ZERO_DATA — nothing to lose |
| 38 | `KURUMREFERANSI` | 0 | YES | NO_DATA | BLOCKED | BLOCKED_NO_DESTINATION | — | — | — | — | — | — | YES (operator) | ZERO_DATA — nothing to lose |
| 39 | `INDIRIMORANI` | 0 | YES | NO_DATA | BLOCKED | BLOCKED_NO_DESTINATION | — | — | — | — | — | — | YES (operator) | ZERO_DATA — nothing to lose |
| 40 | `UCRETTARIFESI` | 1 | — | CONSTANT | AUTO_REVIEW | PRESERVE_LEGACY_SOURCE | MigrationPreservedSourceValue | `legacy.preservedSourceValue` | `preserve_source_value` | — | — | YES | — | C · CONTROLLED_LEGACY_SOURCE_PRESERVATION |
| 41 | `RISK_TUTARI` | 2 | — | CONSTANT | IGNORE | IGNORE_SUMMARY_NOT_TRANSACTION | — | — | — | — | — | — | YES (operator) | D · EXPLICIT_OPERATOR_CONFIRMED_EXCLUSION |
| 42 | `EK_ACIKLAMA` | 1 | — | CONSTANT | AUTO_REVIEW | PRESERVE_LEGACY_SOURCE | MigrationPreservedSourceValue | `legacy.preservedSourceValue` | `preserve_source_value` | — | — | YES | — | C · CONTROLLED_LEGACY_SOURCE_PRESERVATION |
| 43 | `VERGIDAIRESI` | 0 | YES | NO_DATA | BLOCKED | BLOCKED_NO_DESTINATION | — | — | — | — | — | — | YES (operator) | ZERO_DATA — nothing to lose |
| 44 | `VERGINO` | 0 | YES | NO_DATA | BLOCKED | BLOCKED_NO_DESTINATION | — | — | — | — | — | — | YES (operator) | ZERO_DATA — nothing to lose |
| 45 | `HASTADOKTOR` | 14,814 | — | VARYING | AUTO_CONFIDENT | IMPORT_AFTER_REFERENCE_MAPPING | Patient | `patient.primaryPractitionerId` | `practitioner_reference` | — | — | — | — | A · CANONICAL_NORAMEDI_FIELD |
| 46 | `ONEMLINOT` | 6,805 | — | VARYING | SENSITIVE_REVIEW_REQUIRED | IMPORT_AFTER_SENSITIVE_REVIEW | Patient | `patient.notes` | `compose_notes` | YES | YES | — | — | A · CANONICAL_NORAMEDI_FIELD |
| 47 | `UZUNNOT` | 0 | YES | NO_DATA | SENSITIVE_REVIEW_REQUIRED | IMPORT_AFTER_SENSITIVE_REVIEW | Patient | `patient.notes` | `compose_notes` | YES | YES | — | YES (operator) | ZERO_DATA — nothing to lose |
| 48 | `HATIRLAT` | 14,890 | — | VARYING | AUTO_REVIEW | PRESERVE_LEGACY_SOURCE | MigrationPreservedSourceValue | `legacy.preservedSourceValue` | `preserve_source_value` | — | — | YES | — | C · CONTROLLED_LEGACY_SOURCE_PRESERVATION |
| 49 | `CALISMAGURUBU` | 0 | YES | NO_DATA | IGNORE | IGNORE_VENDOR_INTERNAL | — | — | — | — | — | — | YES (operator) | ZERO_DATA — nothing to lose |
| 50 | `AILEGURUBU` | 14,890 | — | VARYING | IGNORE | IGNORE_VENDOR_INTERNAL | — | — | — | — | — | — | YES (operator) | D · EXPLICIT_OPERATOR_CONFIRMED_EXCLUSION |
| 51 | `HASTARENGI` | 0 | YES | NO_DATA | IGNORE | IGNORE_VENDOR_INTERNAL | — | — | — | — | — | — | YES (operator) | ZERO_DATA — nothing to lose |
| 52 | `TEDAVIDURUMU` | 3 | — | VARYING | AUTO_REVIEW | PRESERVE_LEGACY_SOURCE | MigrationPreservedSourceValue | `legacy.preservedSourceValue` | `preserve_source_value` | — | — | YES | — | C · CONTROLLED_LEGACY_SOURCE_PRESERVATION |
| 53 | `KONTROLPERYODU` | 0 | YES | NO_DATA | BLOCKED | BLOCKED_NO_DESTINATION | — | — | — | — | — | — | YES (operator) | ZERO_DATA — nothing to lose |
| 54 | `SONISLEMTARIHI` | 331 | — | VARYING | AUTO_REVIEW | PRESERVE_LEGACY_SOURCE | MigrationPreservedSourceValue | `legacy.preservedSourceValue` | `preserve_source_value` | — | — | YES | — | C · CONTROLLED_LEGACY_SOURCE_PRESERVATION |
| 55 | `MESAJOK` | 14,153 | — | VARYING | AUTO_REVIEW | PRESERVE_LEGACY_SOURCE | MigrationPreservedSourceValue | `legacy.preservedSourceValue` | `preserve_source_value` | — | — | YES | — | C · CONTROLLED_LEGACY_SOURCE_PRESERVATION |
| 56 | `SONKONTROLTARIHI` | 0 | YES | NO_DATA | IGNORE | IGNORE_SUMMARY_NOT_TRANSACTION | — | — | — | — | — | — | YES (operator) | ZERO_DATA — nothing to lose |
| 57 | `TEDAVISONTARIHI` | 0 | YES | NO_DATA | IGNORE | IGNORE_SUMMARY_NOT_TRANSACTION | — | — | — | — | — | — | YES (operator) | ZERO_DATA — nothing to lose |
| 58 | `ODEMESONTARIHI` | 1 | — | CONSTANT | IGNORE | IGNORE_SUMMARY_NOT_TRANSACTION | — | — | — | — | — | — | YES (operator) | D · EXPLICIT_OPERATOR_CONFIRMED_EXCLUSION |
| 59 | `SONODEMETARIHI` | 202 | — | VARYING | AUTO_REVIEW | PRESERVE_LEGACY_SOURCE | MigrationPreservedSourceValue | `legacy.preservedSourceValue` | `preserve_source_value` | — | — | YES | — | C · CONTROLLED_LEGACY_SOURCE_PRESERVATION |
| 60 | `KONTROLNOTU` | 2 | — | VARYING | SENSITIVE_REVIEW_REQUIRED | IMPORT_AFTER_SENSITIVE_REVIEW | Patient | `patient.notes` | `compose_notes` | YES | YES | — | — | A · CANONICAL_NORAMEDI_FIELD |
| 61 | `SONRANDEVUTARIHI` | 13,403 | — | VARYING | AUTO_REVIEW | PRESERVE_LEGACY_SOURCE | MigrationPreservedSourceValue | `legacy.preservedSourceValue` | `preserve_source_value` | — | — | YES | — | C · CONTROLLED_LEGACY_SOURCE_PRESERVATION |
| 62 | `ODEMENOTU` | 3 | — | VARYING | AUTO_REVIEW | PRESERVE_LEGACY_SOURCE | MigrationPreservedSourceValue | `legacy.preservedSourceValue` | `preserve_source_value` | — | — | YES | — | C · CONTROLLED_LEGACY_SOURCE_PRESERVATION |
| 63 | `CARIODEMESTATU` | 0 | YES | NO_DATA | IGNORE | IGNORE_SUMMARY_NOT_TRANSACTION | — | — | — | — | — | — | YES (operator) | ZERO_DATA — nothing to lose |
| 64 | `ODEMENOTTARIHI` | 0 | YES | NO_DATA | IGNORE | IGNORE_SUMMARY_NOT_TRANSACTION | — | — | — | — | — | — | YES (operator) | ZERO_DATA — nothing to lose |
| 65 | `KAYITTARIHI` | 14,890 | — | VARYING | AUTO_REVIEW | PRESERVE_LEGACY_SOURCE | MigrationPreservedSourceValue | `legacy.preservedSourceValue` | `preserve_source_value` | — | — | YES | — | C · CONTROLLED_LEGACY_SOURCE_PRESERVATION |
| 66 | `KAYITSAATI` | 14,890 | — | VARYING | AUTO_REVIEW | PRESERVE_LEGACY_SOURCE | MigrationPreservedSourceValue | `legacy.preservedSourceValue` | `preserve_source_value` | — | — | YES | — | C · CONTROLLED_LEGACY_SOURCE_PRESERVATION |
| 67 | `CHECKBOX` | 3,500 | — | CONSTANT | IGNORE | IGNORE_VENDOR_INTERNAL | — | — | — | — | — | — | YES (operator) | D · EXPLICIT_OPERATOR_CONFIRMED_EXCLUSION |
| 68 | `KAYDEDEN` | 14,890 | — | CONSTANT | IGNORE | HISTORICAL_METADATA_ONLY | — | — | — | — | — | — | YES (operator) | D · EXPLICIT_OPERATOR_CONFIRMED_EXCLUSION |
| 69 | `SILINDI` | 14,890 | — | VARYING | AUTO_CONFIDENT | IMPORT_AFTER_NORMALIZATION | Patient | `patient.patientStatus` | `deleted_to_status` | — | — | — | — | A · CANONICAL_NORAMEDI_FIELD |
| 70 | `KURUMTARIFE` | 0 | YES | NO_DATA | BLOCKED | BLOCKED_NO_DESTINATION | — | — | — | — | — | — | YES (operator) | ZERO_DATA — nothing to lose |
| 71 | `REHBER_ID` | 0 | YES | NO_DATA | IGNORE | IGNORE_VENDOR_INTERNAL | — | — | — | — | — | — | YES (operator) | ZERO_DATA — nothing to lose |
| 72 | `KVKKONAYKODU` | 0 | YES | NO_DATA | LEGAL_BLOCKED | BLOCKED_LEGAL_DECISION | — | — | — | — | — | — | YES (operator) | ZERO_DATA — nothing to lose |
| 73 | `KVKKILKKODU` | 4,754 | — | VARYING | AUTO_REVIEW | PRESERVE_LEGACY_SOURCE | MigrationPreservedSourceValue | `legacy.preservedSourceValue` | `preserve_source_value` | — | — | YES | — | C · CONTROLLED_LEGACY_SOURCE_PRESERVATION |
| 74 | `KVKKSMS` | 0 | YES | NO_DATA | LEGAL_BLOCKED | BLOCKED_LEGAL_DECISION | — | — | — | — | — | — | YES (operator) | ZERO_DATA — nothing to lose |
| 75 | `SMSBORCTARIH` | 0 | YES | NO_DATA | IGNORE | IGNORE_SUMMARY_NOT_TRANSACTION | — | — | — | — | — | — | YES (operator) | ZERO_DATA — nothing to lose |
| 76 | `SMSGONDERILDI` | 0 | YES | NO_DATA | IGNORE | IGNORE_VENDOR_INTERNAL | — | — | — | — | — | — | YES (operator) | ZERO_DATA — nothing to lose |
| 77 | `TEDAVIBITISTARIH` | 0 | YES | NO_DATA | IGNORE | IGNORE_SUMMARY_NOT_TRANSACTION | — | — | — | — | — | — | YES (operator) | ZERO_DATA — nothing to lose |
| 78 | `SONANKETTARIHI` | 0 | YES | NO_DATA | IGNORE | IGNORE_SUMMARY_NOT_TRANSACTION | — | — | — | — | — | — | YES (operator) | ZERO_DATA — nothing to lose |
| 79 | `DOSYAVAR` | 3,051 | — | CONSTANT | IGNORE | IGNORE_VENDOR_INTERNAL | — | — | — | — | — | — | YES (operator) | D · EXPLICIT_OPERATOR_CONFIRMED_EXCLUSION |
| 80 | `SONGORUNTUTARIHI` | 0 | YES | NO_DATA | IGNORE | IGNORE_SUMMARY_NOT_TRANSACTION | — | — | — | — | — | — | YES (operator) | ZERO_DATA — nothing to lose |
| 81 | `ENABIZTAKIPNO` | 0 | YES | NO_DATA | BLOCKED | BLOCKED_NO_DESTINATION | — | — | — | — | — | — | YES (operator) | ZERO_DATA — nothing to lose |
| 82 | `ULKEGIRISTARIHI` | 0 | YES | NO_DATA | BLOCKED | BLOCKED_NO_DESTINATION | — | — | — | — | — | — | YES (operator) | ZERO_DATA — nothing to lose |
| 83 | `ULKECIKISTARIHI` | 0 | YES | NO_DATA | BLOCKED | BLOCKED_NO_DESTINATION | — | — | — | — | — | — | YES (operator) | ZERO_DATA — nothing to lose |
| 84 | `HTS_KODU` | 0 | YES | NO_DATA | BLOCKED | BLOCKED_NO_DESTINATION | — | — | — | — | — | — | YES (operator) | ZERO_DATA — nothing to lose |
| 85 | `SMSODEMETARIHI` | 0 | YES | NO_DATA | IGNORE | IGNORE_SUMMARY_NOT_TRANSACTION | — | — | — | — | — | — | YES (operator) | ZERO_DATA — nothing to lose |
| 86 | `EGITIMDURUMU` | 0 | YES | NO_DATA | BLOCKED | BLOCKED_NO_DESTINATION | — | — | — | — | — | — | YES (operator) | ZERO_DATA — nothing to lose |
| 87 | `YUPASS_NO` | 0 | YES | NO_DATA | BLOCKED | BLOCKED_NO_DESTINATION | — | — | — | — | — | — | YES (operator) | ZERO_DATA — nothing to lose |
| 88 | `SIGORTATURU` | 2 | — | VARYING | AUTO_REVIEW | PRESERVE_LEGACY_SOURCE | MigrationPreservedSourceValue | `legacy.preservedSourceValue` | `preserve_source_value` | — | — | YES | — | C · CONTROLLED_LEGACY_SOURCE_PRESERVATION |
| 89 | `GELDIGIULKE` | 0 | YES | NO_DATA | BLOCKED | BLOCKED_NO_DESTINATION | — | — | — | — | — | — | YES (operator) | ZERO_DATA — nothing to lose |
| 90 | `TURIZM` | 6 | — | VARYING | AUTO_REVIEW | PRESERVE_LEGACY_SOURCE | MigrationPreservedSourceValue | `legacy.preservedSourceValue` | `preserve_source_value` | — | — | YES | — | C · CONTROLLED_LEGACY_SOURCE_PRESERVATION |
| 91 | `ALTDOSYANO` | 10 | — | VARYING | AUTO_REVIEW | PRESERVE_LEGACY_SOURCE | MigrationPreservedSourceValue | `legacy.preservedSourceValue` | `preserve_source_value` | — | — | YES | — | C · CONTROLLED_LEGACY_SOURCE_PRESERVATION |

**Totals by final status**

- A_CANONICAL: **18**
- B_DOMAIN: **2**
- C_PRESERVED: **21**
- D_EXCLUSION: **8**
- ZERO_DATA: **42**
- TOTAL: **91**

---

## 6. Rollback

| Layer | Position |
| --- | --- |
| **Application rollback** | Revert the commits. The previous release reads none of the new objects. |
| **Database compatibility** | The previous release runs unchanged against this schema: two tables it does not know about, and one nullable column its SELECTs do not name. |
| **Migration rollback** | **Not required.** Leave the column and tables in place — that is the intended path. A true schema rollback is a separate CONTRACT migration (`DROP TABLE` ×2, `ALTER TABLE "Patient" DROP COLUMN "district"`) and destroys preserved legacy evidence. |
| **Data rollback** | Preserved values and contact points are run-scoped; `MigrationPreservedSourceValue` cascades on run deletion. |

**Lock / rewrite risk:** `ADD COLUMN ... TEXT` with no `DEFAULT` is a catalog-only change on
PostgreSQL 11+ — an `ACCESS EXCLUSIVE` lock for the catalog update, no table rewrite, no row scan.
The two `CREATE TABLE`s take no lock on existing data; their foreign keys take a brief
`SHARE ROW EXCLUSIVE` on the referenced tables with nothing to validate. Verified by applying all
**79** migrations to an empty PostgreSQL 16 and re-diffing: none of the three objects remains in
the residual diff.

**Pre-existing drift found (NOT introduced here, NOT fixed here).** `prisma migrate diff` between
the committed migrations and `schema.prisma` reports changes unrelated to this task — dropped and
recreated foreign keys on `ImagingStudy`, `InventoryItem`, `InventoryTransaction`, `Patient`,
`WhatsAppConversationMessage`; a dropped `User_organizationId_email_key` index; altered column
defaults on `Clinic`, `Organization`, `ClinicLegalProfile`, `Plan`, `PlatformAdmin`, `UserClinic`,
`ClinicInstagramConnection`, `InstagramConnection`, `InstagramInboxEntry`; a data-type change on
`WhatsAppConnection`; and nine index renames. This migration deliberately contains **only** its own
three objects. Anyone running `prisma migrate dev` on this repo will otherwise generate destructive
statements. **Recommend a separate reconciliation task.**

---

## 7. Remaining blockers

**Engineering blockers: 0.**

Remaining items are decisions that belong to people:

1. **Three KVKK Art. 6 special-category columns** — `ONEMLINOT` (6,805 rows of clinical free text),
   `KONTROLNOTU` (2), `KANGURUBU` (1, and its only value is *"Unknown"*). Approve or decline.
2. **Eight measured-safe exclusions** to confirm — each provably CONSTANT or redundant (§2.4).
3. **Twenty-one preservation proposals** to accept — one `accept-auto` click; accepting loses nothing.
4. **Twenty-five practitioner references.** The workbook carries no doctor names, only opaque vendor
   record ids of the form `9999-99-99-99-99-99-9999`. Resolving them needs the customer's doctor
   register; no engineering change can substitute for it.
5. **One row with a future date of birth**, to be corrected in the source workbook.
6. `ADRES_KODU` semantics (UAVT vs postal code) remain unresolved — and measured at **0 rows**, so
   the open question costs nothing.

---

## 8. Security

`REAL_XLS_DATA_COMMITTED_TO_GIT = NO` · `RAW_PII_IN_LOGS = 0`

The workbook is not in the repository and was never printed. All evidence in this document is
aggregate counts, vendor column headers (schema, not data), and structural classifications. The
handful of literal values quoted — `"none"`, `"admin"`, `"Yeni"`, `"false"`, `"0"`, `"Bilinmiyor"`
— are constant vendor codes shared by thousands of rows, carry no personal information, and are
quoted because the operator's exclusion decision depends on knowing them.

`log-privacy-guard --strict-baseline` passes with **no new baseline exception**.

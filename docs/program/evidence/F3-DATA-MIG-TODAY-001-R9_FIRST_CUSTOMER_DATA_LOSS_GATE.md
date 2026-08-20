# F3-DATA-MIG-TODAY-001-R9 — First-customer data-loss gate

**Task:** `F3-DATA-MIG-TODAY-001-R9-DATA-LOSS-GATE`
**PR:** #462 (DRAFT) · branch `hotfix/f3-data-mig-today-001-final-r7`
**Status:** implementation + tests complete · **NOT MERGED · NOT DEPLOYED · CUSTOMER MIGRATION NOT EXECUTED**

---

## 0. What the program owner rejected, and why they were right

R7/R8 claimed a first-customer data-loss gate on this accounting:

```
meaningful 87 = resolved 15 + manualReview 1 + sensitiveReview 3 + explicitlyExcluded 68
```

Both halves of that line were wrong.

**`explicitlyExcluded` was not explicit.** It was defined in
`migrationMapping.test.ts` as "mapping state ∈ {IGNORE, BLOCKED, LEGAL_BLOCKED}",
described in `validateMapping.ts` as a state the operator "affirmatively chose".
Those states arrive from `firstCustomerMatrix.ts` — a mapping profile computed
from a decision document, before any workbook is uploaded — and are written by
the analyze route with `isAutoSuggested: true` and no decider at all. Nobody
chose them. A system-generated mapping-policy exclusion is a recommendation.

**`meaningful 87` was not measured.** The test computed fill as
`filledCount = ZERO_DATA.has(field) ? 0 : 1`, where `ZERO_DATA` was a
hand-written set of four names. Every other column was declared data-bearing by
fiat. That single line manufactured the 87 out of nothing.

The real numbers, from the accepted profile, are different in **both**
directions.

---

## 1. Real meaningful-column inventory (STEP 1)

Source: `docs/program/PATIENT_FIELD_GAP_AND_IDENTITY_DECISION_PACKAGE.md` §5
`FILL` column, as measured by the R3 targeted re-profiling (§19) — the one pass
that actually opened the 14,890-row workbook. Transcribed verbatim, with each
row's evidence string, into
`server/src/services/migration/mapping/firstCustomerMeasuredFill.ts`.

| Fill evidence class | Columns |
| --- | ---: |
| **MEANINGFUL** (measured, ≥ 1 filled row) | **23** |
| **ZERO_DATA** (measured, 0 / 14,890) | **10** |
| **UNMEASURED** (never profiled — fill genuinely unknown) | **58** |
| Total named columns | **91** |

**58 of 91 columns have never been profiled.** That is the headline finding of
R9, and it is not new information the program was hiding from itself — R3's own
record says the matrix is `NOT YET FULLY FROZEN`. What is new is that the gate
now refuses to treat "unmeasured" as "empty".

The 23 measured-meaningful columns:

| Source header | Filled rows | Class | Disposition (R9) |
| --- | ---: | --- | --- |
| `HASTA_ID` | 14,890 | OPS | `IMPORT_AFTER_SCHEMA_FIELD` |
| `ADI` | 14,890 | PII | `IMPORT_DIRECT` |
| `SOYADI` | 14,890 | PII | `IMPORT_DIRECT` |
| `AILEGURUBU` | 14,890 | VENDOR | `IGNORE_VENDOR_INTERNAL` |
| `KAYITTARIHI` | 14,890 | OPS | `HISTORICAL_METADATA_ONLY` |
| `SILINDI` | 14,890 | OPS | `IMPORT_AFTER_NORMALIZATION` |
| `HASTADOKTOR` | 14,816 | OPS | `IMPORT_AFTER_REFERENCE_MAPPING` |
| `DOSYANO` | 14,718 | OPS | `IMPORT_AFTER_SCHEMA_FIELD` |
| `CEPTELEFONU` | 13,609 | PII | `IMPORT_AFTER_NORMALIZATION` |
| `CINSIYET` | 11,807 | PII | `IMPORT_AFTER_SCHEMA_FIELD` |
| `TCNO` | 11,500 | ID# | `IMPORT_AFTER_SCHEMA_FIELD` |
| `DOGUMTARIHI` | 10,349 | PII | `IMPORT_AFTER_NORMALIZATION` |
| `SUBE_ID` | 9,083 | VENDOR | `IGNORE_VENDOR_INTERNAL` |
| `ONEMLINOT` | 6,805 | SPECIAL | `IMPORT_AFTER_SENSITIVE_REVIEW` |
| `KVKKILKKODU` | 4,750 | CONSENT? | `MANUAL_REVIEW` **(R9 change)** |
| `ISTELEFONU` | 164 | PII | `MANUAL_REVIEW` **(R9 change)** |
| `EVTELEFONU` | 45 | PII | `MANUAL_REVIEW` **(R9 change)** |
| `ILCE` | ~13 | PII | `MANUAL_REVIEW` **(R9 change)** |
| `EMAIL` | 7 | PII | `IMPORT_AFTER_NORMALIZATION` |
| `TEDAVIDURUMU` | 3 | OPS | `IGNORE_SUMMARY_NOT_TRANSACTION` |
| `KONTROLNOTU` | 2 | SPECIAL | `IMPORT_AFTER_SENSITIVE_REVIEW` |
| `RISK_TUTARI` | 2 | FIN | `IGNORE_SUMMARY_NOT_TRANSACTION` |
| `KANGURUBU` | 1 | SPECIAL | `IMPORT_AFTER_SENSITIVE_REVIEW` |

The 10 measured-zero columns: `UYRUK`, `ULKE`, `PASAPORTNO`,
`SOSYAL_GUVENCE_NO`, `ENABIZTAKIPNO`, `ADRES_KODU`, `UZUNNOT`, `KVKKONAYKODU`,
`KVKKSMS`, `YAKINLIKKODU`.

The complete 91-row field-by-field table is in §9 below.

**No raw patient value appears anywhere in this document, in the evidence
module, or in the gate. Counts, column headers and classifications only.**

---

## 2. Audit of every current non-import decision (STEP 2)

### 2.1 Measured-meaningful `IGNORE` — 6 columns, one by one

| Column | Filled | Category | Decision |
| --- | ---: | :---: | --- |
| `KVKKILKKODU` | 4,750 | **E** | **RECLASSIFIED → `MANUAL_REVIEW`.** §3.3 #5: "a record id in ANOTHER register… if it references a consent-form archive, that archive is requestable and could be genuine `evidenceType` — the only route to a `granted` state." Consent evidence must not be fabricated and must not be discarded. Program-owner question. |
| `SUBE_ID` | 9,083 | **B** | Vendor-internal: **1 distinct value**; the destination clinic is operator-selected at run creation. Exclusion recommended — **operator confirmation required before Execute**. |
| `AILEGURUBU` | 14,890 | **B** | Vendor-internal: C-16 *empirically refuted* the family-key hypothesis (100 % distinct; no repeats inside any of the 1,557 shared-phone groups). Opaque per-record id. Exclusion recommended — **operator confirmation required**. |
| `KAYITTARIHI` | 14,890 | **D** | Historical metadata: must not overwrite `createdAt` (`@default(now())`); ten years of tenure has no faithful destination. Exclusion recommended — **operator confirmation required**. |
| `TEDAVIDURUMU` | 3 | **C** | Summary of a treatment history that does not exist in this export (D-5 absent). Exclusion recommended — **operator confirmation required**. |
| `RISK_TUTARI` | 2 | **C** | Balance summary with no payment history behind it (D-8 absent). Exclusion recommended — **operator confirmation required**. |

No category **A** column was left in `IGNORE`.

### 2.2 Measured-meaningful `BLOCKED` — 3 columns, all reclassified

| Column | Filled | Category | Decision |
| --- | ---: | :---: | --- |
| `EVTELEFONU` | 45 | **A** | **RECLASSIFIED → `MANUAL_REVIEW`.** A contact route for 45 real patients. `Patient` has one phone field, already claimed by `CEPTELEFONU`, so there is genuinely nowhere for it to go — but "nowhere to go" is a question, not an answer. Hard rule unchanged: never divert into `PatientEmergencyContact.phone`. |
| `ISTELEFONU` | 164 | **A** | **RECLASSIFIED → `MANUAL_REVIEW`.** Same constraint, same correction. |
| `ILCE` | ~13 | **A** | **RECLASSIFIED → `MANUAL_REVIEW`.** Small, but 13 real patients whose district was recorded. Not folded into `address` — that would make composition depend on fill rate and break rerun stability. |

**No destination was invented for any of them.** An honest open question
outranks a plausible wrong answer, and `MANUAL_REQUIRED` blocks Execute.

### 2.3 Measured-meaningful `LEGAL_BLOCKED` — **none**

Both remaining `BLOCKED_LEGAL_DECISION` columns (`KVKKONAYKODU`, `KVKKSMS`) are
measured at **0 %** filled. Nothing is lost, and the rule that a migration may
not manufacture a lawful basis stands. The four columns R7 moved off the legal
gate (`ONEMLINOT`, `KONTROLNOTU`, `UZUNNOT`, `KANGURUBU`) are in
`SENSITIVE_REVIEW_REQUIRED`, which is undecided and blocks Execute.

### 2.4 Unmeasured columns — 58, category **F**

27 in `BLOCKED`, 27 in `IGNORE`, 3 in a writing state, 1 in `MANUAL_REQUIRED`.
These were **not** reclassified wholesale: doing so would substitute one guess
for another. Instead the gate is **data-driven at run time** — it reads the fill
count the analyzer measured from the uploaded workbook, so a column that turns
out to hold data becomes a blocking decision automatically, and one measured
empty is auto-excluded. Until a workbook is analyzed, all 58 block.

---

## 3. The accounting gate, corrected (STEP 3)

The rejected shortcut is gone:

```
- IGNORE / BLOCKED / LEGAL_BLOCKED  =>  explicitlyExcluded
```

replaced by a distinction between:

| | |
| --- | --- |
| `SYSTEM_RECOMMENDED_EXCLUSION` | the profile or engine proposes not to import. A **recommendation**. Blocks Execute. |
| `OPERATOR_CONFIRMED_EXCLUSION` | a named Platform Admin saved that decision **for this run**. Auditable. The only one that satisfies the gate. |

### How operator confirmation is represented — **no schema change, no new workflow**

`MigrationFieldMapping` already carried the evidence, and the two write paths
already kept it honest:

| Write path | What it stamps |
| --- | --- |
| `POST .../analyze` | deletes and recreates every row with `isAutoSuggested: true`, `decidedByPlatformAdminId` and `decidedAt` NULL |
| `PUT .../mappings` | updates **only the rows the operator submitted**, stamping `isAutoSuggested: false`, `decidedByPlatformAdminId`, `decidedAt` |

Two consequences fall out for free and are exactly right:

* **Re-analyzing revokes every prior confirmation.** A confirmation is about the
  column *as measured*, not about its name.
* **"Not sent" can never masquerade as "decided"**, because `updateMany` is
  scoped to the submitted `sourceField`.

Confirming an exclusion is therefore the action the operator already has: leave
the column ignored and save. All three fields are required together
(fail-closed) — a stale `isAutoSuggested: false` with no decider proves nothing,
and a decider with no timestamp is not an auditable event.

**`ALTER TABLE` count: 0. Prisma migration count: 0.**

---

## 4. Execute gate (STEP 4)

`runDryRun` now evaluates the gate over the persisted mapping rows and emits a
**per-column** blocker for each failure, so the operator is told *which* column:

| Condition (meaningful data) | Blocker code |
| --- | --- |
| system-recommended ignore, not operator-confirmed | `MAPPING_EXCLUSION_NOT_CONFIRMED` |
| `BLOCKED` / `BLOCKED_NO_DESTINATION` | `MAPPING_MEANINGFUL_COLUMN_BLOCKED` |
| `LEGAL_BLOCKED` with no accepted disposition | `MAPPING_MEANINGFUL_COLUMN_BLOCKED` |
| fill never measured | `MAPPING_FILL_UNMEASURED` |
| state the accounting does not recognise | `MAPPING_DATA_LOSS_UNACCOUNTED` |
| unresolved / sensitive-review pending | `MAPPING_REQUIRED` (pre-existing) |

**Zero-data columns never block.** Meaningful ones cannot pass without a
decision.

`assertExecutable` is defence in depth: it refuses a run whose gate is
unsatisfied *independently* of the `executable` flag, and refuses a dry-run
summary persisted **before the gate existed** — a stale `executable: true`
computed without the gate is not evidence, and the fix is to re-run the dry run.

---

## 5. `BLOCKED_NO_DESTINATION` (STEP 5)

Of the 35 entries: **3 carry measured data**, 5 are measured zero, 27 are
unmeasured.

All three measured ones (`EVTELEFONU`, `ISTELEFONU`, `ILCE`) were moved to
`MANUAL_REVIEW` — a field-by-field program decision, recorded with its reason in
`firstCustomerMatrix.ts`. `BLOCKED_NO_DESTINATION` is now **32**.

**No generic JSON dumping field was created.** No destination was added at all.
The three columns have no home in the product, and saying so out loud — in a
state that blocks the run — is the correct answer.

---

## 6. The real data-loss equation (STEP 6)

Computed by the shipping gate over the real measured fill
(`migrationDataLossGate.test.ts` #6c), for the first customer **as the run would
first be analyzed**:

```
meaningful 23 = resolved 11
              + manualReview 4
              + sensitiveReview 3
              + operatorConfirmedExcluded 0
              + UNCONFIRMED 5
              + blocked 0
              + legalBlocked 0
              + unaccounted 0

separately:   zero-data 10 · UNMEASURED (blocking) 58
```

`balanced = true` · **`satisfied = false`** · **`executable = false`**

Outstanding, by name:

* **5 unconfirmed exclusions** — `AILEGURUBU`, `KAYITTARIHI`, `RISK_TUTARI`,
  `SUBE_ID`, `TEDAVIDURUMU`
* **4 manual reviews** — `EVTELEFONU`, `ISTELEFONU`, `ILCE`, `KVKKILKKODU`
* **3 sensitive reviews** — `ONEMLINOT`, `KONTROLNOTU`, `KANGURUBU`
* **58 unmeasured columns** — closed by re-analyzing the real workbook, which
  measures every column and reduces this to a decision list

`blockedMeaningful = 0` · `legalBlockedMeaningful = 0` ·
`unaccountedMeaningful = 0`.

**The objective was never to make the equation balance.** It balanced before, on
invented numbers. It balances now on measured ones, and it says the first
customer is **not** execute-eligible — which is the true answer.

---

## 7. Tests

New suite `server/src/tests/migrationDataLossGate.test.ts` — **19/19 passed**,
covering all nine required proofs:

| # | Claim | Test |
| --- | --- | --- |
| 1 | system IGNORE ≠ explicit exclusion | #1 |
| 2 | meaningful ignored column blocks until confirmed | #2, #2b, DB `1c` |
| 3 | zero-data ignored column does not block | #3 |
| 4 | meaningful `BLOCKED_NO_DESTINATION` blocks | #4, #4b |
| 5 | meaningful `LEGAL_BLOCKED` blocks unless accepted historical/evidence disposition | #5 |
| 6 | operator-confirmed exclusion is auditable and counts exactly once | #6b |
| 7 | tenant/platform auth intact | `migrationPlatformAuthScope` 24/24, `migrationAnalyzeLifecycleDb` auth section |
| 8 | sensitive fields remain masked | `migrationColumnPreview` 36/36 |
| 9 | accounting does not depend on raw values being logged | #8, #8b |

Full runs (all green):

| Suite | Result |
| --- | --- |
| `test:migration-parser` | 45/45 |
| `test:migration-mapping` | 71/71 |
| `test:migration-data-loss-gate` (new) | 19/19 |
| `test:migration-column-preview` | 36/36 |
| `test:migration-reports` | 15/15 |
| `test:migration-platform-auth-scope` | 24/24 |
| `test:migration-patient-schema-drift` | 19/19 |
| `test:migration-execution-db` (disposable PG) | 23/23 |
| `test:migration-analyze-lifecycle-db` (disposable PG) | 28/28 |
| frontend `platformMigrationHelpers` | 70/70 |
| frontend migration vitest (4 files) | 16/16 |
| `server` `tsc --noEmit` | clean |
| root `tsc -b` | clean |

**Total: 316 passed, 0 failed.**

DB suites ran against a purpose-provisioned disposable `postgres:16-alpine`
(`prisma migrate deploy`, identity-crypto secrets supplied per
`server/.env.example`), removed afterwards. No shared or production database was
touched.

---

## 8. Safety

| | |
| --- | --- |
| Schema / Prisma migration | **none** — the gate reuses existing columns |
| Privacy | gate report carries counts, booleans and vendor **column headers** only; asserted structurally by test #8 |
| Tenant isolation | unchanged; `migrationPlatformAuthScope` 24/24 and the DB auth section green |
| Rollback | revert the commit. No data, schema or config change to undo. The only behavioural effect is that runs become *harder* to execute |
| Direction of failure | fail-**closed** throughout: unmeasured blocks, unknown state blocks, partial decision evidence blocks, missing gate report blocks |

---

## 9. Complete field-by-field inventory (all 91 columns)

Categories: **A** clinic-operational-required · **B** vendor-internal/technical ·
**C** derived/summary duplicate · **D** historical metadata not required for
operation · **E** consent/evidence that must not be fabricated · **F**
unknown / needs program-owner review.

| # | SOURCE HEADER | EXCEL COL | FILLED | FILL EVIDENCE | MATRIX DISPOSITION (R9) | MAPPING STATE | DESTINATION | CATEGORY | FINAL DECISION | REASON |
| ---: | --- | :---: | ---: | --- | --- | --- | --- | :---: | --- | --- |
| 1 | `HASTA_ID` | B | 14,890 | 100 % / 14,890 uniq | `IMPORT_AFTER_SCHEMA_FIELD` | `AUTO_CONFIDENT` | `provenance.sourceId` | — | **RESOLVED** | Mapped to `provenance.sourceId`. |
| 2 | `ADI` | C | 14,890 | 100 % | `IMPORT_DIRECT` | `AUTO_CONFIDENT` | `patient.firstName` | — | **RESOLVED** | Mapped to `patient.firstName`. |
| 3 | `SOYADI` | D | 14,890 | 100 % | `IMPORT_DIRECT` | `AUTO_CONFIDENT` | `patient.lastName` | — | **RESOLVED** | Mapped to `patient.lastName`. |
| 4 | `UNVANI` | E | **UNMEASURED** | UNKNOWN | `BLOCKED_NO_DESTINATION` | `BLOCKED` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends BLOCKED_NO_DESTINATION, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 5 | `BABAADI` | F | **UNMEASURED** | UNKNOWN | `BLOCKED_NO_DESTINATION` | `BLOCKED` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends BLOCKED_NO_DESTINATION, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 6 | `ANNEADI` | G | **UNMEASURED** | UNKNOWN | `BLOCKED_NO_DESTINATION` | `BLOCKED` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends BLOCKED_NO_DESTINATION, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 7 | `CINSIYET` | H | 11,807 | 79.3 % / 2 distinct | `IMPORT_AFTER_SCHEMA_FIELD` | `AUTO_CONFIDENT` | `patient.gender` | — | **RESOLVED** | Mapped to `patient.gender`. |
| 8 | `DOGUMTARIHI` | I | 10,349 | 69.5 % | `IMPORT_AFTER_NORMALIZATION` | `AUTO_CONFIDENT` | `patient.dateOfBirth` | — | **RESOLVED** | Mapped to `patient.dateOfBirth`. |
| 9 | `DOGUMIL` | J | **UNMEASURED** | UNKNOWN | `BLOCKED_NO_DESTINATION` | `BLOCKED` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends BLOCKED_NO_DESTINATION, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 10 | `DOGUMILCE` | K | **UNMEASURED** | UNKNOWN | `BLOCKED_NO_DESTINATION` | `BLOCKED` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends BLOCKED_NO_DESTINATION, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 11 | `MEDENIHALI` | L | **UNMEASURED** | UNKNOWN | `BLOCKED_NO_DESTINATION` | `BLOCKED` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends BLOCKED_NO_DESTINATION, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 12 | `MESLEGI` | M | **UNMEASURED** | UNKNOWN | `BLOCKED_NO_DESTINATION` | `BLOCKED` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends BLOCKED_NO_DESTINATION, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 13 | `EGITIMDURUMU` | N | **UNMEASURED** | UNKNOWN | `BLOCKED_NO_DESTINATION` | `BLOCKED` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends BLOCKED_NO_DESTINATION, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 14 | `UYRUK` | O | 0 | 0 % | `BLOCKED_NO_DESTINATION` | `BLOCKED` | — | D | **ZERO_DATA — auto-excluded** | Measured 0% filled. Nothing to lose. |
| 15 | `ULKE` | P | 0 | 0 % | `IMPORT_DIRECT` | `AUTO_CONFIDENT` | `patient.country` | — | **RESOLVED** | Mapped to `patient.country`. |
| 16 | `TCNO` | Q | 11,500 | 77.2 % / 11,500 | `IMPORT_AFTER_SCHEMA_FIELD` | `AUTO_CONFIDENT` | `patient.identity.tckn` | — | **RESOLVED** | Mapped to `patient.identity.tckn`. |
| 17 | `PASAPORTNO` | R | 0 | 0 % | `BLOCKED_NO_DESTINATION` | `BLOCKED` | — | D | **ZERO_DATA — auto-excluded** | Measured 0% filled. Nothing to lose. |
| 18 | `SOSYAL_GUVENCE_NO` | S | 0 | 0 % | `BLOCKED_NO_DESTINATION` | `BLOCKED` | — | D | **ZERO_DATA — auto-excluded** | Measured 0% filled. Nothing to lose. |
| 19 | `SOSYAL_GUVENCE_KURUMU` | T | **UNMEASURED** | UNKNOWN | `BLOCKED_NO_DESTINATION` | `BLOCKED` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends BLOCKED_NO_DESTINATION, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 20 | `ENABIZTAKIPNO` | U | 0 | 0 % | `BLOCKED_NO_DESTINATION` | `BLOCKED` | — | D | **ZERO_DATA — auto-excluded** | Measured 0% filled. Nothing to lose. |
| 21 | `YUPASS_NO` | V | **UNMEASURED** | UNKNOWN | `BLOCKED_NO_DESTINATION` | `BLOCKED` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends BLOCKED_NO_DESTINATION, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 22 | `HTS_KODU` | W | **UNMEASURED** | UNKNOWN | `BLOCKED_NO_DESTINATION` | `BLOCKED` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends BLOCKED_NO_DESTINATION, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 23 | `VERGIDAIRESI` | X | **UNMEASURED** | UNKNOWN | `BLOCKED_NO_DESTINATION` | `BLOCKED` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends BLOCKED_NO_DESTINATION, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 24 | `VERGINO` | Y | **UNMEASURED** | UNKNOWN | `BLOCKED_NO_DESTINATION` | `BLOCKED` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends BLOCKED_NO_DESTINATION, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 25 | `EVTELEFONU` | Z | 45 | 0.3 % | `MANUAL_REVIEW` | `MANUAL_REQUIRED` | — | A | **MANUAL_REVIEW_REQUIRED** | Clinic-operational contact route for 45 patients. R9 -> MANUAL_REVIEW. |
| 26 | `ISTELEFONU` | AA | 164 | 1.1 % | `MANUAL_REVIEW` | `MANUAL_REQUIRED` | — | A | **MANUAL_REVIEW_REQUIRED** | Clinic-operational contact route for 164 patients. R9 -> MANUAL_REVIEW. |
| 27 | `CEPTELEFONU` | AB | 13,609 | 91.4 % | `IMPORT_AFTER_NORMALIZATION` | `AUTO_CONFIDENT` | `patient.phone` | — | **RESOLVED** | Mapped to `patient.phone`. |
| 28 | `FAX` | AC | **UNMEASURED** | UNKNOWN | `BLOCKED_NO_DESTINATION` | `BLOCKED` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends BLOCKED_NO_DESTINATION, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 29 | `EMAIL` | AD | 7 | 0.05 % (7 rows, 1 valid) | `IMPORT_AFTER_NORMALIZATION` | `AUTO_CONFIDENT` | `patient.email` | — | **RESOLVED** | Mapped to `patient.email`. |
| 30 | `ADRESI` | AE | **UNMEASURED** | UNKNOWN | `IMPORT_AFTER_NORMALIZATION` | `AUTO_CONFIDENT` | `patient.address` | — | **RESOLVED** | Mapped to `patient.address`. |
| 31 | `ADRES_KODU` | AF | 0 | 0.00 % (0/14,890) — R3 | `MANUAL_REVIEW` | `MANUAL_REQUIRED` | — | F | **MANUAL_REVIEW_REQUIRED** | Measured 0% filled; UAVT-vs-postal-code semantics still unresolved. Stays MANUAL_REVIEW. |
| 32 | `IL` | AG | **UNMEASURED** | UNKNOWN | `IMPORT_DIRECT` | `AUTO_CONFIDENT` | `patient.city` | — | **RESOLVED** | Mapped to `patient.city`. |
| 33 | `ILCE` | AH | 13 | ≈13 rows | `MANUAL_REVIEW` | `MANUAL_REQUIRED` | — | A | **MANUAL_REVIEW_REQUIRED** | Clinic-operational address component, ~13 patients. R9 -> MANUAL_REVIEW. |
| 34 | `MAHALLE` | AI | **UNMEASURED** | UNKNOWN | `IMPORT_AFTER_NORMALIZATION` | `AUTO_CONFIDENT` | `patient.address` | — | **RESOLVED** | Mapped to `patient.address`. |
| 35 | `KANGURUBU` | AJ | 1 | 1 row | `IMPORT_AFTER_SENSITIVE_REVIEW` | `SENSITIVE_REVIEW_REQUIRED` | `patient.bloodGroup` | E | **SENSITIVE_REVIEW_REQUIRED** | KVKK Art. 6 special-category; a Platform Admin approves the destination column by column. |
| 36 | `ONEMLINOT` | AK | 6,805 | 45.70 % (6,805/14,890) — R3 | `IMPORT_AFTER_SENSITIVE_REVIEW` | `SENSITIVE_REVIEW_REQUIRED` | `patient.notes` | E | **SENSITIVE_REVIEW_REQUIRED** | KVKK Art. 6 special-category; a Platform Admin approves the destination column by column. |
| 37 | `UZUNNOT` | AL | 0 | 0 % | `IMPORT_AFTER_SENSITIVE_REVIEW` | `SENSITIVE_REVIEW_REQUIRED` | `patient.notes` | E | **SENSITIVE_REVIEW_REQUIRED** | KVKK Art. 6 special-category; a Platform Admin approves the destination column by column. |
| 38 | `KONTROLNOTU` | AM | 2 | 0.01 % (2/14,890) — R3 | `IMPORT_AFTER_SENSITIVE_REVIEW` | `SENSITIVE_REVIEW_REQUIRED` | `patient.notes` | E | **SENSITIVE_REVIEW_REQUIRED** | KVKK Art. 6 special-category; a Platform Admin approves the destination column by column. |
| 39 | `TEDAVIDURUMU` | AN | 3 | 0.02 % (3 rows) | `IGNORE_SUMMARY_NOT_TRANSACTION` | `IGNORE` | — | C | **EXPLICIT_OPERATOR_EXCLUSION REQUIRED** | Summary of a treatment history that does not exist in this export (3/14,890, D-5 absent). Exclusion recommended; operator confirmation REQUIRED. |
| 40 | `SUBE_ID` | AO | 9,083 | 61 % / 1 distinct | `IGNORE_VENDOR_INTERNAL` | `IGNORE` | — | B | **EXPLICIT_OPERATOR_EXCLUSION REQUIRED** | Vendor branch id, 1 distinct value; destination clinic is operator-selected. Exclusion recommended; operator confirmation REQUIRED. |
| 41 | `HASTADOKTOR` | AP | 14,816 | 99.5 % / 25 distinct | `IMPORT_AFTER_REFERENCE_MAPPING` | `AUTO_CONFIDENT` | `patient.primaryPractitionerId` | — | **RESOLVED** | Mapped to `patient.primaryPractitionerId`. |
| 42 | `REFERANSI` | AQ | **UNMEASURED** | UNKNOWN | `BLOCKED_NO_DESTINATION` | `BLOCKED` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends BLOCKED_NO_DESTINATION, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 43 | `KURUMREFERANSI` | AR | **UNMEASURED** | UNKNOWN | `BLOCKED_NO_DESTINATION` | `BLOCKED` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends BLOCKED_NO_DESTINATION, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 44 | `REHBER_ID` | AS | **UNMEASURED** | UNKNOWN | `IGNORE_VENDOR_INTERNAL` | `IGNORE` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends IGNORE_VENDOR_INTERNAL, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 45 | `CALISMAGURUBU` | AT | **UNMEASURED** | UNKNOWN | `IGNORE_VENDOR_INTERNAL` | `IGNORE` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends IGNORE_VENDOR_INTERNAL, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 46 | `AILEGURUBU` | AU | 14,890 | 100.00 % (14,890/14,890) — R3 | `IGNORE_VENDOR_INTERNAL` | `IGNORE` | — | B | **EXPLICIT_OPERATOR_EXCLUSION REQUIRED** | Opaque per-record vendor identifier; C-16 empirically refuted the family-key hypothesis (100% distinct). Exclusion recommended; operator confirmation REQUIRED. |
| 47 | `UCRETTARIFESI` | AV | **UNMEASURED** | UNKNOWN | `BLOCKED_NO_DESTINATION` | `BLOCKED` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends BLOCKED_NO_DESTINATION, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 48 | `KURUMTARIFE` | AW | **UNMEASURED** | UNKNOWN | `BLOCKED_NO_DESTINATION` | `BLOCKED` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends BLOCKED_NO_DESTINATION, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 49 | `SIGORTATURU` | AX | **UNMEASURED** | UNKNOWN | `BLOCKED_NO_DESTINATION` | `BLOCKED` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends BLOCKED_NO_DESTINATION, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 50 | `RISK_TUTARI` | AY | 2 | 0.01 % (2 rows) | `IGNORE_SUMMARY_NOT_TRANSACTION` | `IGNORE` | — | C | **EXPLICIT_OPERATOR_EXCLUSION REQUIRED** | Balance summary with no payment history behind it (2/14,890, D-8 absent). Exclusion recommended; operator confirmation REQUIRED. |
| 51 | `INDIRIMORANI` | AZ | **UNMEASURED** | UNKNOWN | `BLOCKED_NO_DESTINATION` | `BLOCKED` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends BLOCKED_NO_DESTINATION, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 52 | `CARIODEMESTATU` | BA | **UNMEASURED** | UNKNOWN | `IGNORE_SUMMARY_NOT_TRANSACTION` | `IGNORE` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends IGNORE_SUMMARY_NOT_TRANSACTION, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 53 | `ODEMESONTARIHI` | BB | **UNMEASURED** | UNKNOWN | `IGNORE_SUMMARY_NOT_TRANSACTION` | `IGNORE` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends IGNORE_SUMMARY_NOT_TRANSACTION, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 54 | `SONODEMETARIHI` | BC | **UNMEASURED** | UNKNOWN | `IGNORE_SUMMARY_NOT_TRANSACTION` | `IGNORE` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends IGNORE_SUMMARY_NOT_TRANSACTION, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 55 | `ODEMENOTU` | BD | **UNMEASURED** | UNKNOWN | `IGNORE_SUMMARY_NOT_TRANSACTION` | `IGNORE` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends IGNORE_SUMMARY_NOT_TRANSACTION, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 56 | `ODEMENOTTARIHI` | BE | **UNMEASURED** | UNKNOWN | `IGNORE_SUMMARY_NOT_TRANSACTION` | `IGNORE` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends IGNORE_SUMMARY_NOT_TRANSACTION, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 57 | `SMSBORCTARIH` | BF | **UNMEASURED** | UNKNOWN | `IGNORE_SUMMARY_NOT_TRANSACTION` | `IGNORE` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends IGNORE_SUMMARY_NOT_TRANSACTION, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 58 | `SMSODEMETARIHI` | BG | **UNMEASURED** | UNKNOWN | `IGNORE_SUMMARY_NOT_TRANSACTION` | `IGNORE` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends IGNORE_SUMMARY_NOT_TRANSACTION, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 59 | `SONISLEMTARIHI` | BH | **UNMEASURED** | UNKNOWN | `IGNORE_SUMMARY_NOT_TRANSACTION` | `IGNORE` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends IGNORE_SUMMARY_NOT_TRANSACTION, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 60 | `SONKONTROLTARIHI` | BI | **UNMEASURED** | UNKNOWN | `IGNORE_SUMMARY_NOT_TRANSACTION` | `IGNORE` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends IGNORE_SUMMARY_NOT_TRANSACTION, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 61 | `TEDAVISONTARIHI` | BJ | **UNMEASURED** | UNKNOWN | `IGNORE_SUMMARY_NOT_TRANSACTION` | `IGNORE` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends IGNORE_SUMMARY_NOT_TRANSACTION, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 62 | `TEDAVIBITISTARIH` | BK | **UNMEASURED** | UNKNOWN | `IGNORE_SUMMARY_NOT_TRANSACTION` | `IGNORE` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends IGNORE_SUMMARY_NOT_TRANSACTION, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 63 | `SONRANDEVUTARIHI` | BL | **UNMEASURED** | UNKNOWN | `IGNORE_SUMMARY_NOT_TRANSACTION` | `IGNORE` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends IGNORE_SUMMARY_NOT_TRANSACTION, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 64 | `SONANKETTARIHI` | BM | **UNMEASURED** | UNKNOWN | `IGNORE_SUMMARY_NOT_TRANSACTION` | `IGNORE` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends IGNORE_SUMMARY_NOT_TRANSACTION, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 65 | `SONGORUNTUTARIHI` | BN | **UNMEASURED** | UNKNOWN | `IGNORE_SUMMARY_NOT_TRANSACTION` | `IGNORE` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends IGNORE_SUMMARY_NOT_TRANSACTION, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 66 | `KONTROLPERYODU` | BO | **UNMEASURED** | UNKNOWN | `BLOCKED_NO_DESTINATION` | `BLOCKED` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends BLOCKED_NO_DESTINATION, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 67 | `HATIRLAT` | BP | **UNMEASURED** | UNKNOWN | `IGNORE_VENDOR_INTERNAL` | `IGNORE` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends IGNORE_VENDOR_INTERNAL, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 68 | `KVKKONAYKODU` | BQ | 0 | 0 % | `BLOCKED_LEGAL_DECISION` | `LEGAL_BLOCKED` | — | E | **ZERO_DATA — auto-excluded** | Measured 0% filled. Writing it would fabricate consent nobody gave. |
| 69 | `KVKKILKKODU` | BR | 4,750 | 31.9 % / 4,633 distinct | `MANUAL_REVIEW` | `MANUAL_REQUIRED` | — | E | **MANUAL_REVIEW_REQUIRED** | Consent-adjacent register key, 4,750 rows (§3.3 #5). Must not be fabricated into consent nor dropped. R9 -> MANUAL_REVIEW (program-owner question). |
| 70 | `KVKKSMS` | BS | 0 | 0 % | `BLOCKED_LEGAL_DECISION` | `LEGAL_BLOCKED` | — | E | **ZERO_DATA — auto-excluded** | Measured 0% filled. Writing it would fabricate consent nobody gave. |
| 71 | `MESAJOK` | BT | **UNMEASURED** | UNKNOWN | `IGNORE_VENDOR_INTERNAL` | `IGNORE` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends IGNORE_VENDOR_INTERNAL, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 72 | `SMSGONDERILDI` | BU | **UNMEASURED** | UNKNOWN | `IGNORE_VENDOR_INTERNAL` | `IGNORE` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends IGNORE_VENDOR_INTERNAL, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 73 | `KAYITTARIHI` | BV | 14,890 | 100 % (2016→2026) | `HISTORICAL_METADATA_ONLY` | `IGNORE` | — | D | **EXPLICIT_OPERATOR_EXCLUSION REQUIRED** | Registration date, 100% filled; must not overwrite createdAt and has no faithful destination. Exclusion recommended; operator confirmation REQUIRED. |
| 74 | `KAYITSAATI` | BW | **UNMEASURED** | UNKNOWN | `HISTORICAL_METADATA_ONLY` | `IGNORE` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends HISTORICAL_METADATA_ONLY, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 75 | `KAYDEDEN` | BX | **UNMEASURED** | UNKNOWN | `HISTORICAL_METADATA_ONLY` | `IGNORE` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends HISTORICAL_METADATA_ONLY, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 76 | `SILINDI` | BY | 14,890 | 100 % / 172 true | `IMPORT_AFTER_NORMALIZATION` | `AUTO_CONFIDENT` | `patient.patientStatus` | — | **RESOLVED** | Mapped to `patient.patientStatus`. |
| 77 | `DOSYAVAR` | BZ | **UNMEASURED** | UNKNOWN | `IGNORE_VENDOR_INTERNAL` | `IGNORE` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends IGNORE_VENDOR_INTERNAL, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 78 | `CHECKBOX` | CA | **UNMEASURED** | UNKNOWN | `IGNORE_VENDOR_INTERNAL` | `IGNORE` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends IGNORE_VENDOR_INTERNAL, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 79 | `HESAP_KODU` | CB | **UNMEASURED** | UNKNOWN | `IGNORE_VENDOR_INTERNAL` | `IGNORE` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends IGNORE_VENDOR_INTERNAL, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 80 | `UST_HESAP_KODU` | CC | **UNMEASURED** | UNKNOWN | `IGNORE_VENDOR_INTERNAL` | `IGNORE` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends IGNORE_VENDOR_INTERNAL, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 81 | `DOSYANO` | CD | 14,718 | 98.84 % (14,718/14,890) — R3 | `IMPORT_AFTER_SCHEMA_FIELD` | `AUTO_CONFIDENT` | `patient.chartNumber` | — | **RESOLVED** | Mapped to `patient.chartNumber`. |
| 82 | `SUBEDOSYANO` | CE | **UNMEASURED** | UNKNOWN | `BLOCKED_NO_DESTINATION` | `BLOCKED` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends BLOCKED_NO_DESTINATION, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 83 | `ALTDOSYANO` | CF | **UNMEASURED** | UNKNOWN | `BLOCKED_NO_DESTINATION` | `BLOCKED` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends BLOCKED_NO_DESTINATION, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 84 | `ULKEGIRISTARIHI` | CG | **UNMEASURED** | UNMEASURED | `BLOCKED_NO_DESTINATION` | `BLOCKED` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends BLOCKED_NO_DESTINATION, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 85 | `ULKECIKISTARIHI` | CH | **UNMEASURED** | UNMEASURED | `BLOCKED_NO_DESTINATION` | `BLOCKED` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends BLOCKED_NO_DESTINATION, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 86 | `GELDIGIULKE` | CI | **UNMEASURED** | UNMEASURED | `BLOCKED_NO_DESTINATION` | `BLOCKED` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends BLOCKED_NO_DESTINATION, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 87 | `TURIZM` | CJ | **UNMEASURED** | UNMEASURED | `BLOCKED_NO_DESTINATION` | `BLOCKED` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends BLOCKED_NO_DESTINATION, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 88 | `RESIMUZANTI` | CK | **UNMEASURED** | UNKNOWN | `IGNORE_VENDOR_INTERNAL` | `IGNORE` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends IGNORE_VENDOR_INTERNAL, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 89 | `HASTARENGI` | CL | **UNMEASURED** | UNKNOWN | `IGNORE_VENDOR_INTERNAL` | `IGNORE` | — | F | **BLOCKS EXECUTE — fill UNMEASURED** | System recommends IGNORE_VENDOR_INTERNAL, but the column was never profiled, so the recommendation cannot be shown to be safe. Re-analyze measures it; the gate then requires the matching decision. |
| 90 | `EK_ACIKLAMA` | CM | **UNMEASURED** | UNKNOWN | `MANUAL_REVIEW` | `MANUAL_REQUIRED` | — | F | **MANUAL_REVIEW_REQUIRED** | Semantics unresolved; a human must answer before Execute. |
| 91 | `YAKINLIKKODU` | CN | 0 | 0.00 % (0/14,890) — R3 | `BLOCKED_NO_DESTINATION` | `BLOCKED` | — | D | **ZERO_DATA — auto-excluded** | Measured 0.00% (0/14,890). Nothing to lose. |

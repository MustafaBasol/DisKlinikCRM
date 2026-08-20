# F3-DATA-MIG-TODAY-001-R11 — Preserved Source Value: operator-selectable destination

**Task:** `F3-DATA-MIG-TODAY-001-R11-PRESERVED-SOURCE-MAPPING-UX`
**Phase:** F3 Production Hardening / Clinic Data Migration
**Base:** `origin/main` @ `881cfbc811aea0d79341b597c42d8b764c2ab8e4` (the R10 production release SHA)
**Status:** `PR_OPEN (DRAFT)` · `MERGED = NO` · `DEPLOYED = NO` · `REAL_CUSTOMER_EXECUTE = NOT PERFORMED`

---

## 0. What R11 corrects, precisely

R10's deployment was **successful**. Frontend SHA = backend SHA = public SHA, API health OK, worker
online, 79 migrations applied. Nothing about the release failed.

What R10 recorded that production later invalidated is one line:

> `REMAINING_ENGINEERING_BLOCKERS = 0`

That claim was proven against the **backend**. It was never proven through the **operator's actual
mapping screen**, and the screen is where the migration is actually driven. R11 is a workflow
completeness correction, not a deployment failure.

---

## 1. Root cause

R10 added the destination `legacy.preservedSourceValue` to the backend catalog under a new group
`legacy_preservation`, wired it through `validateMapping`, the data-loss gate, the executor and every
privacy surface. All of that works and is covered by tests.

The mapping screen does **not** render the backend catalog directly. `MigrationMappingStep.tsx`
renders:

```tsx
destinationGroups.map(group => destinations.filter(d => d.group === group))
```

where `destinationGroups` is the frontend's **own hard-coded whitelist**,
`DESTINATION_GROUPS` in `src/services/platformMigrationApi.ts`. That array listed seven groups.
`legacy_preservation` was not one of them.

So the server sent the preservation destination on every `/mappings` response, and the frontend
dropped it before it could become an `<option>`.

**Two independent whitelists describing one catalog, with no test tying them together.** That is the
defect class, and it is what the new parity test closes.

### Why the screen looked "blocked" rather than merely missing an option

The six real first-customer columns do not arrive undecided. The first-customer matrix already
dispositions them `PRESERVE_LEGACY_SOURCE`, which resolves to state `AUTO_REVIEW` **with
`destinationField` already set to `legacy.preservedSourceValue`**.

So the `<select>` was handed a `value` for which no `<option>` existed. A browser renders that as
blank. The column read as unmapped, the operator had no way to select preservation back, and the
row's only remaining affordances were "Yok say" / "Engelle" — which is exactly the reported
"Engellendi / Hedef yok — atla" symptom.

### Second, independent defect

`MigrationMappingStep.tsx` also had:

```tsx
const destSelectionLocked = isLegalBlocked || isBlocked;
```

`BLOCKED` is a **system recommendation** ("no destination found"), not a decision. Locking the
dropdown turned that recommendation into an irreversible verdict: a column carrying real data could
be recommended-blocked with no operator route to anywhere. Removing `isBlocked` from that lock is the
second half of the fix. `LEGAL_BLOCKED` stays locked and is still not rendered as a `<select>` at all.

---

## 2. Why R10's tests could not have caught this

R10's backend tests assert `DESTINATION_FIELDS` contains `legacy.preservedSourceValue`
(`migrationMapping.test.ts`), that it validates without collision, and that the executor writes it
(`migrationR10WritePathDb.test.ts`). Every one of those still passes on the broken build.

The frontend `DESTINATION_GROUPS` literal was never asserted against the backend catalog by any test
in the repository. Verified: `grep -rn "DESTINATION_GROUPS" server/src src --include=*.ts` returns no
test file. The gap was structural, not an oversight in any one test.

---

## 3. Third defect found while fixing this: the legal gate was not server-enforced

The mapping PUT route persists the client's `state` verbatim:

```ts
state: String(entry.state ?? 'MANUAL_REQUIRED'),
```

`validateMappings` Rule 4 forbids a `LEGAL_BLOCKED` row from carrying a destination, but it reads the
state **as written**. A payload that moved the row to `RESOLVED` in the same request therefore left
Rule 4 nothing to fire on, and the KVKK Art. 6 gate lifted silently. Until R11 the only thing holding
the gate was that the screen declined to render a control.

Since R11's whole purpose is to make destinations more reachable, the one class that must stay
unreachable is now pinned at the write, in `server/src/services/migration/mapping/legalGateGuard.ts`:
a column **stored** as `LEGAL_BLOCKED` cannot be re-mapped, re-stated, or ignored. The guard reads
the stored states inside the same transaction and ignores whatever the payload asserted.

`IGNORE` is refused too. It writes nothing, so allowing it would leak no data — but it would relabel
a legal exclusion as an ordinary operator exclusion and drop the column out of the `LEGAL_BLOCKED`
tally the dry run reports. The UI's "Yok say" button is correspondingly hidden for legally-gated rows.

This cannot strand a run: `dryRun.ts` deliberately keeps `LEGAL_BLOCKED` out of the blockers that
suppress `executable`.

---

## 4. Changes

| File | Change |
| --- | --- |
| `src/services/platformMigrationApi.ts` | `legacy_preservation` added to `DESTINATION_GROUPS`, deliberately **last** so preservation sits below every canonical destination |
| `src/components/platform/migration/MigrationMappingStep.tsx` | `destSelectionLocked` narrowed to `isLegalBlocked`; "Yok say" hidden for legally-gated rows |
| `src/locales/{tr,en,fr,de}/platform.json` | group label, destination label, transform label — 3 keys × 4 locales |
| `server/src/services/migration/mapping/legalGateGuard.ts` | **NEW.** Fail-closed guard: a stored `LEGAL_BLOCKED` column cannot be edited from the mapping screen |
| `server/src/routes/platformMigration.ts` | PUT `/mappings` reads stored states in-transaction and calls the guard before applying edits |
| `src/pages/__tests__/migrationDestinationGroupParity.test.ts` | **NEW.** Frontend/backend group parity + locale parity |
| `server/src/tests/migrationPreservedSourceMapping.test.ts` | **NEW.** Preservation transitions, multi-use, the six columns, legal-gate enforcement |
| `package.json`, `server/package.json`, `.github/workflows/ci-layers.yml` | test registration + CI reachability |

**No schema migration.** R10's `MigrationPreservedSourceValue`,
`20260820120000_add_patient_district_contact_points_and_preserved_source_values`, already supports
everything R11 needs. R11 adds no column, no model and no Prisma change. The pre-existing Prisma
drift R10 identified is **untouched** and still belongs to its own separate task.

**TR wording shipped:** `Korunan Kaynak Değeri` (destination), `Korunan Kaynak Değerleri` (group),
`Kaynak değerini birebir koru` (transform). EN/FR/DE equivalents shipped in the same commit.

---

## 5. The `historical_evidence` trap, and why the parity test does not fall into it

The backend group union also contains `historical_evidence`. That group is **deliberately empty**: it
is the narrow exception that lets a `LEGAL_BLOCKED` consent column past the data-loss gate
(`hasAcceptedHistoricalEvidenceDisposition`). R10 kept legacy preservation in its own separate group
precisely so shipping preservation could not, as a side effect, unlock the consent exception.

A naive "every backend group must be in the frontend whitelist" test would have instructed the next
maintainer to render the consent exception in the operator's dropdown. The parity test therefore
encodes it as an explicit, documented exclusion and additionally asserts the group is **still empty** —
so adding a destination to it fails the build and forces a deliberate consent decision instead.

---

## 6. Real-workbook acceptance

Run against the real first-customer workbook in its controlled local location. **Never copied into
the repository, never committed, no cell value printed.** The harness used the repository's own
`parseSourceWorkbook` → `profileColumns` → `suggestMappings` → `validateMappings` →
`evaluateDataLossGate` → `runDryRun`, against a disposable PostgreSQL 16 container with all 79
migrations applied.

**Execute was NOT performed.**

### Analyze

```
sheet="Sayfa1" headers=91 rows=14890 format=xls warnings=[EMPTY_LEADING_COLUMN_DROPPED]
91 source columns measured · every column profiled
```

Measured fill counts — these **independently reproduce R10's figures exactly**:

| Column | Measured filled |
| --- | --- |
| SUBEDOSYANO | 9,105 |
| UNVANI | 14,890 |
| BABAADI | 18 |
| ANNEADI | 25 |
| MEDENIHALI | 57 |
| KVKKILKKODU | 4,754 |

### Field mapping

All six arrive `AUTO_REVIEW` with `dest=legacy.preservedSourceValue` **already proposed** — confirming
the production symptom was a value with no rendered option, not a missing backend disposition.

R10 typed mappings intact, not regressed into preservation:
`ILCE → patient.district`, `EVTELEFONU → patient.contactPoint.home`,
`ISTELEFONU → patient.contactPoint.work`.

### Save → reload → validate

```
6 explicit preservation decisions: SUBEDOSYANO, UNVANI, BABAADI, ANNEADI, MEDENIHALI, KVKKILKKODU
  (each AUTO_REVIEW -> RESOLVED)
accept-all-safe promoted 15 AUTO_REVIEW rows
27 undecided excluded + 23 proposed IGNORE(s) explicitly confirmed by the operator
all six preservation decisions survive reload · total preserved columns after reload: 21
mapping is valid · mapped=39 unresolved=0 blocked=0 legalBlocked=2 ignored=50
```

### Data-loss gate

```
totalSourceColumns=91 meaningful=49 zeroData=42
resolved=38 manualReview=0 sensitiveReview=0 operatorConfirmedExcluded=11
UNMEASURED=0  UNACCOUNTED=0  BLOCKED_MEANINGFUL=0  UNCONFIRMED_EXCLUSION=0  LEGAL_BLOCKED_MEANINGFUL=0
balanced=true  satisfied=true
```

Reaching `UNCONFIRMED_EXCLUSION = 0` required the operator to **explicitly confirm** the 23 columns
the matrix merely *proposed* `IGNORE` for — `isOperatorConfirmed` requires `isAutoSuggested === false`
**and** a named decider **and** a timestamp. The gate was not weakened to get there.

### Legal gate, proven on this workbook's own gated columns

```
legally gated columns in this workbook: KVKKONAYKODU, KVKKSMS
legal gate refuses a mapping edit on a real gated column  ✓
no R11 preserve-target is legally gated                   ✓
```

### Reference mapping → Dry-run

```
practitioner reference column: HASTADOKTOR — 25 distinct values needing an approved map
totalSourceRows=14890 parsed=14890 valid=14889 warning=478 blocked=0 invalid=1
expectedCreate=14889 expectedReuse=0 expectedSkipped=0
blockers=1 legalExclusions=2 warnings=6
  BLOCKER ROW_VALUE_INVALID: date_excel_serial: value is in the future;
    the patient write schema rejects future birth dates [patient.dateOfBirth]
  legal exclusion [KVKKONAYKODU] · legal exclusion [KVKKSMS]
```

- **No MAPPING-attributable blocker remains.**
- The **one known bad future birth-date row** is still reported as a source-data validation finding
  (`invalidRows = 1`), attributed to `patient.dateOfBirth`, and is **not silently repaired**. There is
  no operator correction workflow, so it remains a customer data question.
- The two legally-gated columns stay **excluded, not blocking**, as designed.

**`EXECUTE PERFORMED: NO`.**

---

## 7. Verification

| Check | Result |
| --- | --- |
| `server tsc --noEmit` | **exit 0** |
| root `tsc --noEmit` | **exit 0** |
| `npm run build` | **exit 0** (built in 34.80s) |
| `test:migration-preserved-source-mapping` (new) | **21 / 21** |
| `test:migration-destination-group-parity` (new) | **8 / 8** |
| `test:migration-mapping` | **71 / 71** |
| `test:migration-data-loss-gate` | **19 / 19** |
| `test:migration-parser` | **45 / 45** |
| `test:migration-column-preview` | **36 / 36** |
| `test:migration-reports` | **15 / 15** |
| `test:migration-platform-auth-scope` | **24 / 24** |
| `test:migration-patient-schema-drift` | **31 / 31** |
| `test:patient-privacy` | **38 / 38** |
| `test:data-retention` | **48 / 48** |
| `test:clinic-bulk-export` | **118 / 118** |
| `test:platform-migration-helpers` | **70 / 70** |
| `test:log-privacy-guard` | **39 / 39** |
| `log-privacy-guard:scan` | **no new violations** (303 files) |
| `test:vitest` | **270 / 270** (23 files) |
| `git diff --check` | **clean** |

Both new tests were confirmed to **fail before the fix**: the parity test reported
`legacy_preservation` missing from the whitelist and `legacy.preservedSourceValue is dropped by the
group filter` (5 passed / 2 failed) on the unmodified tree.

---

## 8. Impact assessment

| Area | Impact |
| --- | --- |
| Tenant isolation | **None.** No query, scope or predicate changed. Preserved rows keep R10's organization/clinic scoping. |
| Privacy / subject-access export | **None.** R10 wiring unchanged; `migration-patient-schema-drift` (31/31) re-proves preserved values reach the export. |
| Anonymization | **None.** Hard delete of preserved values on anonymization still asserted and passing. |
| Retention | **None.** Category and 10-year default unchanged. |
| Bulk export | **None.** RESTRICTED preserved values still filtered in the Prisma `where`. |
| Logging / PII | **Improved.** New refusal message names source **columns** only; log-privacy scan reports no new violations. |
| Consent | **Strengthened.** KVKKILKKODU preserved, never consent; no consent-shaped destination exists in the catalog; the legal gate is now enforced server-side, closing a real pre-existing bypass. |
| Backward compatibility | **Full.** Additive only. Existing saved mappings, runs and summaries parse unchanged; no schema, no contract removal. |

**Rollback:** revert the application commit. No schema change, so no migration rollback exists or is
required.

---

## 9. Status

`AGENT_COMPLETED = YES` · `TESTS_PASSED = YES` · `PR_OPENED = YES (DRAFT)` · `MERGED = NO` ·
`DEPLOYED = NO` · `PRODUCTION_VERIFIED = NO` · `REAL_CUSTOMER_EXECUTE_SAFE = NO`

`REAL_CUSTOMER_EXECUTE_SAFE` stays **NO**. R11 removes the engineering blocker that made preservation
unreachable, and the real-workbook Dry-run is data-loss-safe, but execution remains gated on human
decisions that are not engineering work: the 25 unresolved HASTADOKTOR practitioner references, the
1 invalid future birth date, and program-owner sign-off on the KVKK Art. 6 columns.

`REAL_XLS_DATA_COMMITTED_TO_GIT = NO` · `RAW_PII_IN_LOGS = 0`

This task changes no program line: `F4 COMPLETE = NO`, `FIRST_CUSTOMER_RECOVERY_GATE = NOT_SATISFIED`,
`F5 AUTHORIZED = NO`.

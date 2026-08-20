# F3-DATA-MIG-TODAY-001-R12 — Final Import Workflow Convergence

**Phase:** F3 — Production Hardening / Clinic Data Migration
**Base:** `origin/main` @ `5de3cee` (the release the defect was reported against)
**Branch:** `hotfix/f3-data-mig-r12-final-import-workflow-convergence`
**Execute against real customer data:** **NO.** Not performed, and out of scope for this task.

---

## 1. Why R10 and R11 were green while production was broken

Both previous rounds shipped successfully and neither is invalidated here. What
they never proved is the thing that was broken: **the payload the browser
sends.**

Every existing suite drove the mapping rules with a payload a *test author*
wrote — one row, well-formed, containing exactly what the test was about. The
shipped screen wrote a different payload: **all 91 rows, on every edit.** No
test in the repository had ever sent that.

This round's regression suite is written at that seam. It reproduces the
shipped client's request shape against the real Express route stack and a real
database, and it walks the operator journey end to end rather than asserting
rules in isolation.

---

## 2. Reproduced production defect and root cause

**Symptom (release `5de3cee`):** changing `SUBEDOSYANO` — or any other ordinary
mapping — returned **HTTP 400**. Repeated clicks produced repeated 400s. The
mapping step could not progress at all.

**Root cause, in two halves:**

| | |
|---|---|
| Client | `MigrationMappingStep.persistMapping` updated one row locally, then serialised **every** mapping (`next.map(...)`) into the `PUT /mappings` body. |
| Server | R11's `legalGateGuard` was fed every `sourceField` in that body and treated **presence** as an attempt to edit. The first customer's two stored `LEGAL_BLOCKED` consent columns (`KVKKONAYKODU`, `KVKKSMS`) rode along in every save, so the guard refused the whole request. |

**Fix — `server/src/services/migration/mapping/mappingWriteDiff.ts`:** the true
semantic diff is computed **server-side, against the stored rows, inside the
route's own transaction.** Presence is not an edit; a change is.

Three outcomes per submitted row:

- **NO-OP** — the proposal already matches what is stored and the row is already
  operator-confirmed. Nothing written, nothing refused. *This is the case the
  400 was firing on.*
- **WRITE** — the semantic tuple changes, **or** the tuple matches but the row
  has never been operator-confirmed (the R9 data-loss gate's confirmation path).
- **REFUSED** — the stored row is `LEGAL_BLOCKED` and the proposal would change
  it. Fail closed, whole request, no partial write. Refused even to `IGNORE`.

A `LEGAL_BLOCKED` row whose proposal does not change it is a no-op and is
**deliberately not stamped either**: recording "a Platform Admin decided this"
over a KVKK Art. 6 gate would relabel a program-owner decision as an operator
one.

The client now sends only the edited row. **That is a clarity fix, not the
security fix** — a hand-crafted 91-row request gets the same answer, because
nothing reads a client-asserted "changed" flag.

---

## 3. Four further defects found in the same workflow

None of these were reported. All are closed here.

### 3.1 Empty columns created work

42 of the real workbook's 91 columns are **measured at 0 populated values.** Two
of them (`ADRES_KODU`, `UZUNNOT`) sat in undecided states and **blocked the
mapping step outright**; 22 more rendered as red `BLOCKED` obstacles. Not one
could lose a single value however it was decided.

A **measured**-empty column now settles itself as `IGNORE` /
`EMPTY_SOURCE_COLUMN`.

- **MEASURED is load-bearing.** A column with no profile is *unmeasured*, and
  unmeasured is not zero — the same fail-closed rule `dataLossGate.ts` applies.
  Such a column is left untouched.
- **`LEGAL_BLOCKED` is never settled this way, even when empty.** It would be
  arithmetically harmless and would delete the recorded *reason* those columns
  are withheld — and the next workbook from this vendor will have them
  populated. They already cost the operator nothing (the gate scores them
  `ZERO_DATA`).

### 3.2 A save that wrote nothing invalidated a valid dry run

A `PUT` resolving to zero writes still took the "mapping changed" hop, knocking
a `DRY_RUN_COMPLETE` run back to `MAPPING_REQUIRED`. Now a zero-write save moves
nothing.

### 3.3 Absent payload fields were coerced, not inherited

The route coerced an absent `state` to `MANUAL_REQUIRED` and an absent
`destinationField` to `null`. Harmless with a full-collection client; a **live
data-loss path** with a delta one, because the client now sends one row and
anything it forgot would blank the stored value. Absent fields now inherit.

### 3.4 One bad row stopped 14,889 good ones — first-customer blocker

`executable` was `blockers.length === 0`, and `blockers` mixes findings about
the **run** with findings about **one row**. The real workbook has a single
future birth date. That produced one `ROW_VALUE_INVALID` entry, which made the
**entire 14,890-row run non-executable**, with no route forward except
hand-editing the vendor's file.

The executor already recorded a `MigrationRowOutcome` for such a row and
continued, so nothing was ever at risk of being silently lost — the flag was
measuring the wrong thing.

**Where the line is now:**

| Class | Codes | Effect |
|---|---|---|
| ROW-LEVEL | `ROW_VALUE_INVALID`, `ROW_REQUIRED_FIELD_MISSING` | Row rejected, counted, exported. Run proceeds. |
| RUN-LEVEL | every `MAPPING_*`, `PLAN_LIMIT_EXCEEDED`, `DUPLICATE_SOURCE_RECORD`, `REFERENCE_UNRESOLVED` | Run stops. |

`DUPLICATE_SOURCE_RECORD` and `REFERENCE_UNRESOLVED` are run-level **on
purpose**. A duplicate vendor id is the *transactional invariant* exception: two
rows claiming one id mean a rerun cannot tell which patient it already created,
and a wrong merge is not something a later correction can cleanly undo. An
unresolved practitioner would silently skip that clinician's entire caseload,
and is resolved once per unique id one step earlier.

`blockers` still carries both on the wire. `runLevelBlockers` and `rejectedRows`
are now stated explicitly so the screen, the export and the gate read one number.

### 3.5 (Hardening) A full-collection PUT recorded 89 implied decisions

Because submitting an unconfirmed exclusion **is** the R9 confirmation, a client
that re-sent the whole collection asserted an operator decision about every
undecided column — 89 of them on the real workbook. The R12 screen sends only
the edited row, so this no longer happens in the product; and the audit event
now **names** any column a request confirmed without changing, so a mass
confirmation through the API can never be silent. Vendor column headers are
schema, never patient data.

---

## 4. Operator state simplification

The screen renders the operator's vocabulary, projected in one place
(`operatorMappingStatus`) from the unchanged internal state machine. **No
server-side rule is relaxed.**

| Operator | Turkish | Derived from |
|---|---|---|
| MATCHED | Eşleşti | `AUTO_CONFIDENT`/`RESOLVED` with a canonical destination |
| PRESERVED | Saklanacak eski veri | decided, targeting `legacy.preservedSourceValue` |
| NEEDS_REVIEW | Kontrol et | `MANUAL_REQUIRED` / `AUTO_REVIEW` / `SENSITIVE_REVIEW_REQUIRED` |
| EMPTY | Boş sütun | measured 0 fill, non-writing state |
| IGNORED | Aktarılmayacak | `IGNORE` with data |
| ERROR | Hatalı | `BLOCKED`/`LEGAL_BLOCKED` with data, or an unknown state |

An **unmeasured** column is never reported as EMPTY — the screen must not
contradict the gate. The internal state stays visible in small type for support.

**Bulk actions.** `accept-auto` (safe preservation suggestions, unchanged) and
the new `POST /mappings/confirm-exclusions`, which takes an **explicit named
list** — there is no "confirm everything" mode, each row is stamped
individually, the audit event names the columns, and it refuses a legally gated
column or anything that is not a system-recommended exclusion.

---

## 5. Rejected-row export and the correction loop

`GET /migrations/runs/:id/reports/rejected[?format=csv]` — after Dry-run **and**
after Execute.

**XLSX (preferred):**
- Sheet 1 `Düzeltilecek Kayıtlar` — the rejected rows under the **original
  vendor headers**, nothing added. That is what makes it re-uploadable verbatim:
  analyze proposes the same mapping, so a corrected file needs no re-mapping.
- Sheet 2 `Hata Listesi` — source row number, `HASTA_ID`, source column,
  NoraMedi field, error code, Turkish explanation, correction guidance, the
  offending value, and the run reference.

**CSV** emits the diagnostic sheet only (a CSV has one table).

`rowRejection.ts` is the **single** definition of "cannot be imported", shared
with the dry run, so the count on screen and the rows in the file cannot drift.

**No schema change.** The list is **recomputed** from the current mapping and
the already-retained source file. A stored list would be a snapshot that every
mapping write would have to remember to invalidate.

**Privacy contract of this artifact** (deliberately different from
`migrationReports.ts`, and in its own module for that reason): it carries source
values on purpose — you cannot correct a row you cannot see — but only rejected
rows, only mapped columns (never a legally gated one), only for an
authenticated Platform Admin, with no public URL, and its contents never reach a
log, an error message or an audit record. The audit event records counts only.

**Re-import.** Supported and proven: download → fix in Excel → upload the
**rejected-only** file → analyze → map → dry-run → execute. A partial file is
safe because identity is provenance (`HASTA_ID`), never row position: already-
imported rows MATCH, the corrected row is created once.

---

## 6. CSP

Both violations were in `index.html`, which is NoraMedi-controlled.

- **Google Fonts stylesheet + two preconnects: REMOVED.** The production CSP
  already blocked the stylesheet, so production has been rendering in the
  `system-ui` fallback all along — removing the tag changes nothing visually and
  removes the error. `Inter` stays first in the font stack; self-hosting it is a
  typography decision with its own review and will need no CSS change.
- **Inline theme script → `/theme-init.js`**, a same-origin **classic**
  (non-deferred) script that `script-src 'self'` already allows. Not `defer`, not
  `type="module"`: both would run after first paint, which is the flash it
  prevents.

**The policy was not widened.** No `unsafe-inline`, no external style origin.

---

## 7. Evidence

### 7.1 Real workbook — 14,890 rows × 91 columns

Read from its controlled location outside the repository. Never committed. No
cell value printed.

| | before R12 | after R12 |
|---|---|---|
| operator mapping actions | ~50 per-column confirmations | **5** (2 bulk + 3 genuine decisions) |
| columns needing a human on arrival | 26 | 24 → **3** after the two bulk clicks |
| measured-empty columns creating work | 2 blocking + 22 red rows | **0** |
| dry run | `executable: false` | `executable: true` |
| rejected rows | invisible | **1**, downloadable |

Dry-run: `TOTAL 14,890 · VALID 14,889 · INVALID 1 · REJECTED 1 · WILL CREATE
14,889 · WILL UPDATE 0 · WILL SKIP 0`, `executable: true`, run-level blockers
**0**, data-loss gate satisfied.

The three remaining decisions are exactly the ones a human should make — all
KVKK Art. 6 special-category: `ONEMLINOT` (6,805), `KONTROLNOTU` (2),
`KANGURUBU` (1). Reference mapping asks about **25 unique** `HASTADOKTOR` ids,
not 14,890 rows.

The one rejected row is source row **14,488**, `INVALID_FUTURE_BIRTH_DATE` on
`patient.dateOfBirth`, with a Turkish explanation and a correction instruction.

**No fabricated consent:** `KVKKONAYKODU` / `KVKKSMS` carry no destination and
stay gated; `KVKKILKKODU` (4,754 values) is preserved as historic source data,
never as current consent; no `ChannelConsentLog` or communication preference row
is written by any migration path.

### 7.2 Committed regression suite

`server/src/tests/migrationImportWorkflowConvergenceDb.test.ts` — **48/48**,
registered under `server:test:disposable-db`. Drives the real Express route
stack against a disposable Postgres and covers: the reproduced 400; fail-closed
on a real legal-gate edit (whole request, nothing written); a gated no-op
succeeding and staying unstamped; idempotent re-save; PATCH inheritance;
enum/destination validation before any write; empty-column settling; both bulk
actions and everything they refuse; mapping validity, advance and round trip;
the dry-run split; a populated legal gate still stopping Execute; the XLSX and
CSV exports including what must **not** be in them; audit records with counts
and no content; tenant scope and the Platform Admin gate; the write-plan
contract directly; and the complete correction loop — Execute, download, fix,
re-upload the rejected-only file, import exactly the one missing patient with no
duplicates. All on synthetic rows in a throwaway tenant.

### 7.3 Live-server acceptance (production-equivalent, same route stack)

Run against a locally running API and Postgres with a seeded throwaway tenant
and a synthetic workbook. Both harnesses are local-only and untracked.

**HTTP level — 33/33.** Real Platform Admin cookie session, real CSRF, real
Express, over the network on the same port the browser uses. Login → create →
upload → analyze → mapping (including the **exact payload the shipped client
sent**) → reload → bulk actions → validate → advance → reference mapping →
dry-run → download and open the rejected workbook. Run left at
`DRY_RUN_COMPLETE`; Execute never called.

**Rendered-component level — 5/5.** The real `MigrationMappingStep` and
`MigrationDryRunStep`, rendered in a DOM, wired to a real axios instance against
the live server, driven through the actual controls: the mapping screen loads;
preservation is a selectable option; changing `SUBEDOSYANO` saves with **no
error banner**; the request the *screen* built carried **one** row and no gated
column; a fresh mount (a page reload) shows the saved choice; the bulk buttons
work and the operator headline renders; the dry-run screen shows the plain-
language valid/rejected split and offers the download, which fetches a real
XLSX. `/execute` is never called.

**Console/HTTP hygiene.** Across the clean acceptance runs, **every** request
from normal operator use returned 2xx — 0 application 4xx/5xx. The only 4xx are
the two deliberate fail-closed refusals the harness fires on purpose (a real
legal-gate edit; a bulk confirm on a gated column). The built `index.html`
contains no external origin and no inline script.

### 7.4 Suites re-run

All green: `migration-parser` 45, `migration-mapping` 74,
`migration-preserved-source-mapping` 21, `migration-data-loss-gate` 19,
`migration-column-preview` 36, `migration-reports` 15,
`migration-platform-auth-scope` 24, `migration-patient-schema-drift` 31,
`patient-blood-group` 16, `migration-execution-db` 23,
`migration-r10-write-path-db` 21, `migration-analyze-lifecycle-db` 28,
`migration-import-workflow-convergence-db` 48, `patient-identity-db` 25,
`platform-migration-helpers` 75, `migration-destination-group-parity` 8,
`vitest` 270 (23 files). Both TypeScript projects typecheck clean.

> The DB suites need `PATIENT_IDENTITY_ENCRYPTION_KEY` and
> `PATIENT_IDENTITY_LOOKUP_SECRET` (64-char hex, distinct). Absent, they fail
> wholesale with `IDENTITY_CRYPTO_NOT_CONFIGURED` — an environment gap, not a
> regression. CI generates them; a local run must export them.

---

## 8. Deliberate behaviour changes

Both are re-asserted in the suites, and neither is a silent drift.

1. **A NAMED zero-fill column now settles itself** instead of staying
   `MANUAL_REQUIRED`. R5's distinction between named and headerless has no
   data-loss basis once the fill is measured at zero. The half of R5 that does
   have one — any data, or unmeasured fill, still requires a human — is
   unchanged.
2. **The mapping chips are the operator vocabulary**, not engine states. The old
   chips asked the operator to filter by concepts they had to learn first, and
   two of them returned almost nothing but measured-empty columns.

---

## 9. Schema, rollback, safety

- **Schema:** no migration, no Prisma change, no new model. The rejected-row
  list is derived, not stored.
- **Rollback:** revert the branch. Nothing is persisted in a new shape; every
  new field on `DryRunSummary` is optional and every consumer treats absent as
  unknown rather than as satisfied.
- **Tenant/KVKK:** no new cross-tenant read path. The one new download is
  run-scoped, Platform Admin only, and never logged. No consent is inferred or
  written anywhere.
- **Execute:** not performed against customer data, and still gated behind the
  program owner's explicit authorization.

# F3-DATA-MIG-TODAY-001-R12 — Final Import Workflow Convergence

**Phase:** F3 — Production Hardening / Clinic Data Migration
**Base:** `origin/main` @ `5de3cee` (the release the defect was reported against)
**Integrated:** `origin/main` @ `16887e6` merged in as `6853930` after F4-IMAGING-001-R6 landed — see §10
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

---

## 10. Integration with `origin/main` (F4-IMAGING-001-R6)

R12 was cut from `5de3cee`. While it was in review `main` advanced by four
commits — the F4-IMAGING-001-R6 storage-placement discriminator (PR #464) —
and GitHub reported PR #466 as `CONFLICTING`. `origin/main` @ `16887e6` was
merged **into** this branch (the repository's convention for this situation;
the branch is already pushed and public, so it is not rebased) as
`6853930`. No R12 commit was rewritten and no F4 R6 commit was altered.

**Conflicts: exactly one file, `server/package.json`.** Both sides edited the
same run of test-aggregate lines. Resolved as a **union**, key by key:

| Key | Taken from | Why |
| --- | --- | --- |
| `server:test:non-disposable` | main | F4 R6 appended `test:imaging-storage-placement-call-sites` and `test:imaging-placement-fail-closed`; R12 never touched this key |
| `server:test:disposable-db` | R12 | R12 registered `test:migration-import-workflow-convergence-db`; main never touched this key |
| `server:test:storage-integration` | main | F4 R6 appended `test:imaging-storage-placement`; R12 never touched this key |
| `server:test:legacy-db-required` | either | Textually identical; R12's copy differs only by the trailing comma the new key requires |
| `test:migration-import-workflow-convergence-db` | R12 | New key, R12 only |

Verified mechanically rather than by eye: comparing the resolved `scripts`
object against `origin/main`'s, **exactly two keys differ** — R12's new script
and R12's `disposable-db` line — and **nothing main added is missing**. The
`test:ci-classify` suite, which fails if any test script is absent from every
aggregate, passes (28/28).

`docs/program/NORAMEDI_MASTER_TRACKER.md` auto-merged cleanly. The two lanes
append in different places (F3 migration newest-first at the top, F4 imaging
appended at the end), so there was no textual overlap and both entries are
intact.

**F4 R6 preserved, checked and not assumed.** `git diff origin/main` over
`server/prisma/` and every imaging/storage source file is **empty** — the
migration `20260820130000_add_imaging_image_storage_backend`, the
`schema.prisma` change, `fileStorage.ts`, `imagingRemoteStorage.ts`,
`imaging/ops.ts`, `imaging/public.ts`, `imagingIngestCore.ts`,
`routes/imaging.ts` and `fileBackupService.ts` are byte-identical to main. F4
R6's own suites pass on this branch: `imaging-storage-placement-call-sites`
14/14, `imaging-placement-fail-closed` 13/13, `imaging-remote-storage` 39/39,
`imaging` 104/104, `file-backup` 15/15,
`file-backup-imaging-ops-migration` 12/12.

**R12 still adds no migration.** `prisma migrate status` against a disposable
PostgreSQL reported the F4 R6 migration as the *only* pending one; after
`prisma migrate deploy` (never `migrate dev`) all **80** migrations are applied
and the schema is up to date. `git diff 5de3cee -- server/prisma/` shows the
F4 R6 migration and its schema block and nothing else.

### Post-integration re-verification

Everything below was re-run **after** the merge commit, on `6853930`.

| Check | Command | Result |
| --- | --- | --- |
| Working tree | `git status --short` | clean |
| Whitespace / conflict markers | `git diff --check` | clean |
| Server typecheck | `npm --prefix server run typecheck` | pass |
| Frontend typecheck + prod build | `npm run build` | pass (`tsc -b` + `vite build`, 26.2s) |
| Layer 1 tooling | `typecheck:runtime`, `test:runtime:unit`, `test:runtime:storage-gate`, `test:runtime:minio-readiness`, `typecheck:ci-classify`, `test:ci-classify`, `typecheck:guardrail`, `guardrail:test`, `typecheck:log-privacy-guard`, `test:log-privacy-guard` | 74 / 61 / 29 / 28 / 74 / 39 passed, 0 failed |
| Log privacy guard | `npm run log-privacy-guard:scan -- --strict-baseline` | 306 files, **no new violations** |
| Layer 2 | `npm --prefix server run server:test:non-disposable` | **3,035 passed, 0 failed** (36 suites) |
| Layer 3 | `npm run test:runtime:postgres` | **616 passed, 0 failed** (32 suites, exit 0, cleanup clean) |
| Layer 5 frontend leaves | 9 scripts | 36 / 21 / 8 / 26 / 24 / 29 / 24 / 75 / 8 passed, 0 failed |
| Layer 5 vitest | `npm run test:vitest` | **270 passed** (23 files) |

**Layer 3 needed two runs, and the first failure is recorded rather than
glossed over.** Run 1 died at `test:platform-admin-login-totp-gate` on
`CHARACTERIZATION: a numeric valid OTP is accepted via String() coercion`
(`401 !== 200`) — the known ~10% leading-zero TOTP flake, unrelated to R12 and
unrelated to F4 R6, and it aborts the `&&` chain before the migration suites
run at all. Run 2 on the same tree passed that assertion and every suite after
it (616/616, exit 0). The migration suites were additionally run individually
against a disposable PostgreSQL, so their result does not depend on that
coin-flip.

One further local-only artifact, recorded for the same reason: `test:platform-backup`
fails on this workstation with `401 !== 403` because `server/.env` supplies a
real `PLATFORM_JWT_SECRET`, while the test signs its clinic-type token with the
hard-coded `getSecret` default. Checked out at `origin/main` the same suite
fails identically (24 passed, 1 failed), so it is neither an R12 nor an
integration regression; CI generates no `.env`, so it passes there, and the
Layer 2 run above was executed with that default exported to match CI.

Migration suites, each re-run individually on the merged tree against a
disposable PostgreSQL:

`migration-import-workflow-convergence-db` **48/48** · `migration-r10-write-path-db` 21/21 ·
`migration-analyze-lifecycle-db` 28/28 · `migration-execution-db` 23/23 ·
`patient-identity-db` 25/25 · `migration-parser` 45/45 · `migration-mapping` 74/74 ·
`migration-preserved-source-mapping` 21/21 · `migration-data-loss-gate` 19/19 ·
`migration-column-preview` 36/36 · `migration-reports` 15/15 ·
`migration-platform-auth-scope` 24/24 · `migration-patient-schema-drift` 31/31 ·
`patient-blood-group` 16/16 · frontend `platform-migration-helpers` 75/75 ·
`migration-destination-group-parity` 8/8.

### Acceptance scenarios re-run after integration

| # | Scenario | Result |
| --- | --- | --- |
| A | Change one ordinary mapping while unchanged protected rows exist | HTTP **200** (was 400) |
| B | Actually mutate a protected consent/legal row | **400**, fail-closed, refusal names the column |
| C | Measured-empty source column | settled, no operator action, no blocker |
| D | Real workbook, 91 columns × 14,890 rows | converges in **5 clicks**; 3 genuine human decisions remain |
| E | Dry run | **14,889 valid / 1 rejected** (`INVALID_FUTURE_BIRTH_DATE`, source row 14,488), `executable: true`, 0 run-level blockers |
| F | Rejected-row download | XLSX **and** CSV 200; original vendor headers, TR message + fix + run id; gated column excluded; Platform-Admin/run-scoped; **0 of 39 fixture cell values appear in the server log** |
| G | Correction / re-import loop | proven by §10 of the convergence DB suite (idempotent by provenance, no duplicate patients) |
| H | Real-customer Execute | **NOT PERFORMED.** The run stops at `DRY_RUN_COMPLETE` |

Harness totals: real-workbook acceptance **27/27**, HTTP acceptance over the
live route stack **41/41**, rendered-component acceptance against the live
server **5/5**. Server request log for the whole HTTP pass: 18×200, 1×201,
**2×400 — both the deliberate fail-closed refusals of scenario B**, zero 5xx,
zero unintended 4xx.

**Rollback after integration** is unchanged: reverting the R12 commits leaves
the merge's F4 R6 content intact, and R12 still owns no schema object.

---

## 11. R12-UX-CLOSURE — the two UX defects real operator acceptance found (2026-08-20)

**Task:** F3-DATA-MIG-TODAY-001-R12-UX-CLOSURE. **Same R12 lifecycle — no R13,
no second unrelated task.** **Base:** `origin/main` @ `073b145f` (the release
this section's defects were reported against — the merge commit that landed
everything §1–§10 above). **Branch:** `hotfix/f3-data-mig-r12-ux-closure`.
**Not merged, not deployed, real-customer Execute not performed.**

Everything through §10 above was operator-verified through Reference Mapping.
Continuing acceptance on the SAME first-customer workbook exposed two further
UX defects on the mapping screen — neither a regression of §1–§10, both new
observations from continuing the same acceptance pass one step further.

### 11.1 Defect A — no explicit "approve the already-correct suggestion" action

**Symptom.** For a row in `SENSITIVE_REVIEW_REQUIRED` ("Kontrol et") whose
proposed destination the operator agreed with — `ONEMLINOT`/`KONTROLNOTU` →
`patient.notes` via `compose_notes`, `composeOrder` 1/2, and `KANGURUBU` →
`patient.bloodGroup` via `blood_group_tr` — there was no way to accept the
suggestion as-is. Because `MigrationMappingStep`'s per-field handlers only
persisted on an actual destination/transform/composeOrder change, the operator
had to pick a different destination (Korunan Kaynak Değeri), save, then pick
the correct one again, purely to trigger a write that moved the row out of
`SENSITIVE_REVIEW_REQUIRED`. Unnecessary risk (a wrong value briefly on
record) for zero benefit.

**Root cause.** `handleDestinationChange` / `handleTransformChange` /
`handleComposeOrderChange` each persisted a real edit; nothing persisted "same
tuple, decision made." The server side already supported exactly this shape —
`mappingWriteDiff.ts` (§ above, R12) treats a `state`-only change as a
semantic change and writes it, stamping the audit fields — but the client
never sent it.

**Fix — no new server route.** `MigrationMappingStep.handleApproveMapping`
sends the row's SAME `destinationField`/`transform`/`composeOrder` with only
`state: 'RESOLVED'`, through the SAME `PUT /migrations/runs/:id/mappings` +
`mappingWriteDiff.ts` path every other edit already uses. A new pure predicate,
`platformMigrationHelpers.canApproveMapping`, gates the button: only a
`SENSITIVE_REVIEW_REQUIRED` row whose current destination exists in the
catalog and whose transform/composeOrder already satisfy
`validateMapping.ts`'s per-row rules gets the button — never `LEGAL_BLOCKED`,
never a row with no destination. The security boundary is the SAME one §2/§5
already established: `legalGateGuard.ts` refuses any edit to a stored
`LEGAL_BLOCKED` row regardless of what the client sends, so a hand-crafted
"approve" against one still fails closed.

### 11.2 Defect B — "Yok say" left destination residue

**Symptom.** Clicking "Yok say" on `KANGURUBU` set `state = IGNORE` but left
`destinationField = patient.bloodGroup` in place, producing
`MAPPING_INVALID — KANGURUBU is marked ignored but still carries destination
"patient.bloodGroup"` (`validateMapping.ts`'s existing IGNORE rule).

**Root cause.** `handleMarkIgnore` updated only `state`; `persistMapping`
always sends the full four-field tuple, so the untouched `destinationField`
rode along in the same write the state change went out in — the identical
shape of defect §2's production 400, one level down (a stale field surviving
inside a single row's payload instead of across the whole collection).

**Fix.** The same updater now also sets `destinationField`, `transform` and
`composeOrder` to `null`, so `persistMapping` clears all four fields in ONE
PUT row, applied in ONE `updateMany` inside the existing transaction —
atomic by construction, not a two-step decision.

### 11.3 What did NOT change

No Prisma migration, no new destination, no new mapping state, no relaxed
guard. `mappingWriteDiff.ts`, `legalGateGuard.ts`, `dataLossGate.ts` and
`validateMapping.ts` are byte-identical to `073b145f`. Changed files:
`src/components/platform/migration/MigrationMappingStep.tsx`,
`src/pages/platformMigrationHelpers.ts` (new `canApproveMapping`),
`src/locales/{tr,en,fr,de}/platform.json` (`actions.approve` /
`actions.approveHint`), plus the three test files below and
`server/package.json` (one new `test:migration-mapping-approval-db` script,
registered into `server:test:disposable-db`).

### 11.4 Verification

| Suite | Result |
| --- | --- |
| `test:platform-migration-helpers` (new `canApproveMapping` cases) | **85/85** |
| `MigrationMappingStep.vitest.test.tsx` (5 pre-existing + 5 new) | **10/10** |
| `server/src/tests/migrationMappingApprovalDb.test.ts` (new, DB-backed, real route stack + real Postgres) | **19/19** |
| `migrationImportWorkflowConvergenceDb.test.ts` — R12 400 regression, re-run unmodified | **48/48** |
| `migrationMapping.test.ts` | **74/74** |
| `migrationDataLossGate.test.ts` | **19/19** |
| Frontend `tsc --noEmit` | clean |
| Server `tsc --noEmit` | clean |

The new DB suite proves, against a real disposable PostgreSQL and the real
Express route stack (no mocks): approving `ONEMLINOT` returns 2xx and leaves
`destinationField`/`transform`/`composeOrder` byte-identical, with
`composeOrder: 1` intact; approving `KONTROLNOTU` preserves `composeOrder: 2`;
both stamp `decidedByPlatformAdminId`/`decidedAt` and survive a reload through
the real `GET`; the untouched stored `LEGAL_BLOCKED` row (`KVKKONAYKODU`,
populated) is neither written nor stamped by either approval; a hand-crafted
approve-shaped `PUT` directly against that `LEGAL_BLOCKED` row is refused
(`MAPPING_INVALID`, names the column); a `SENSITIVE_REVIEW_REQUIRED` row with
no destination can never be made to validate even by an "approve"-shaped
request; ignoring `KANGURUBU` clears all three fields atomically and leaves no
`MAPPING_INVALID` issue; and approving two of three `SENSITIVE_REVIEW_REQUIRED`
rows while ignoring the third drives `sensitiveReviewCount` and
`unresolvedCount` to 0 and advances the run to `MAPPING_READY`.

**Real-customer Execute: not performed.** No dry-run or execute step was
touched by this task.

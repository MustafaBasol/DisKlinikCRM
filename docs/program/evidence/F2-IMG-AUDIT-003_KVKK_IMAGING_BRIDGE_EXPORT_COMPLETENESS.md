# F2-IMG-AUDIT-003 — KVKK Per-Patient Export Completeness for Bridge-Linked Imaging

**Phase:** F2 — Modular Boundaries and Public Contracts (Stage 3 implementation)
**Task ID:** F2-IMG-AUDIT-003
**Mode:** CHARACTERIZE + IMPLEMENT (single PR, per fast-program-mode instructions)
**Branch:** `feature/f2-img-audit-003-kvkk-export-completeness`
**Baseline:** `origin/main` @ `bb50212` (merge of PR #345)
**Prior decision (unchanged):** F2-IMG-AUDIT-002 = `NO_ACTION_REQUIRED` — machine bridge ingest
events remain in `AuditLog` only; no fake/borrowed `User` was written to `ActivityLog`.

**R1 update (this revision):** a blocking review finding on PR #349 — merging two independently
500-capped sources without a final global cap could export up to 1000 `activityHistory` rows,
breaking the pre-existing global-500 contract. Fixed by a final cap in `mergePatientActivityHistory`
plus deterministic tie-break ordering. See §15.

---

## 1. Problem

`patientPrivacy.ts`'s per-patient KVKK export (`collectStructuredExportData` →
`activityHistory`) derived exclusively from `ActivityLog`. Bridge-originated imaging ingest
(`imagingBridgePublic.ts`) writes only to `AuditLog` (by design — see F2-IMG-AUDIT-002). When a
bridge-ingested study resolves a real `patientId` via `imagingRequestId`, that ingestion event was
completely absent from the patient's KVKK data-subject export, while the same logical event for a
manually-uploaded study appears (`imaging.ts` writes both `AuditLog` and `ActivityLog`).

## 2. Go/no-go characterization (Phase 1)

| Condition | Finding |
|---|---|
| Patient linkage resolvable without heuristic text parsing? | **Yes.** `AuditLog.entityId` (a bridge-ingested `ImagingStudy.id`) is a structured id join to `ImagingStudy.patientId`. `ImagingStudy.patientId` is only ever set via an explicit `imagingRequestId` supplied by the bridge caller — imagingBridgePublic.ts's own comment: "Kontrollü opsiyonel bağlama... Ad/telefon/dosya adından eşleştirme YOKTUR" (no name/phone/filename matching). |
| `clinicId` enforceable directly? | **Yes.** `AuditLog.clinicId` is a direct column, always populated by the bridge route (`agent.clinicId`). |
| Raw storage path/token/secret needed for export? | **No.** Bridge audit `metadata` is `{deviceId, modality, fileSize, mimeType, duplicate}` only — no storageKey, filesystem path, token, or DICOM raw metadata is ever written there (confirmed by reading both `writeAuditLog` call sites in `imagingBridgePublic.ts`). |

All three conditions held → proceeded to implementation in this same PR.

## 3. Patient linkage mechanism

```
AuditLog.entityId  (= ImagingStudy.id, for entityType='imaging_study')
        │  structured id lookup, no text/name/phone matching
        ▼
ImagingStudy.patientId  (set only via bridge-caller-supplied imagingRequestId)
```

Implementation queries `ImagingStudy` first (`clinicId`, `patientId`, `source: 'bridge'` →
`{id}`), then queries `AuditLog` for `entityId IN (those ids)`. No relation exists in Prisma
between `AuditLog` and `ImagingStudy` (polymorphic `entityId`), so this two-step lookup is
required — it is still a pure structured-id join, never a text/name search.

## 4. Exact `AuditLog` allowlist

Query (`patientActivityHistoryExport.ts` → `collectBridgeImagingActivityForPatient`):

```ts
prisma.auditLog.findMany({
  where: {
    organizationId,               // tenant predicate — org
    clinicId,                     // tenant predicate — clinic
    entityType: 'imaging_study',  // exact action/entity allowlist
    entityId: { in: studyIds },   // structured id join result, not free text
    action: 'imaging_bridge_study_ingested',
  },
  select: { id: true, action: true, entityType: true, metadata: true, createdAt: true },
  orderBy: { createdAt: 'desc' },
  take: MAX_PATIENT_ACTIVITY_HISTORY_ROWS,   // per-source fetch cap; R1 final cap applied in mergePatientActivityHistory (§15)
});
```

Only `modality` and `duplicate` are read out of the selected `metadata` JSON to build a
human-readable description; the raw `metadata` object is never spread into the export entry.

## 5. Exact tenant predicates

- `ImagingStudy` lookup: `{ patientId, clinicId, source: 'bridge' }`
- `AuditLog` lookup: `{ organizationId, clinicId, entityType, entityId: { in: studyIds }, action }`

Both `organizationId` and `clinicId` are applied as literal `WHERE` equality predicates — proven
load-bearing (not incidental) by tests 3b/4b below, which query a genuinely-existing patient's own
real id under a deliberately wrong `clinicId`/`organizationId` and assert zero rows return.

## 6. Dedupe strategy

Merge identity is `${source}:${id}` (`mergePatientActivityHistory` in
`patientActivityHistoryExport.ts`) — each row's own structured primary key from its origin table
(`ActivityLog.id` or `AuditLog.id`), prefixed by source so cross-table collision is structurally
impossible.

**Why not `entityId + action + source`:** the bridge route can legitimately write two `AuditLog`
rows sharing the same `entityId` + `action` for one `ImagingStudy` — an original ingest
(`duplicate:false`) and a later duplicate-detected retry (`duplicate:true`, F2-IMG-AUDIT-001-FIX).
These are genuinely distinct real-world events (two separate upload attempts). Collapsing on
anything less specific than the row's own id would silently drop real audit evidence — the task's
explicit "preserve every genuinely distinct event" requirement. Row-id-based identity was chosen
specifically to avoid that failure mode (proven by test 6a/6c).

Manual ActivityLog and bridge AuditLog were also confirmed **not** to produce natural duplicates:
a given `ImagingStudy` is created by exactly one route (`source: 'manual_upload' | 'bridge'`), so
the same creation event never has both an `ActivityLog` row and a bridge `AuditLog` row. Later
`link`/`unlink` actions on a bridge-ingested study do write `ActivityLog` — but under a different
`action` value, so they are genuinely separate events, not duplicates.

## 7. Exported DTO (additive, backward compatible)

`activityHistory` array entries gain one additive field; no existing field was removed or
renamed:

```ts
interface PatientActivityHistoryEntry {
  id: string;
  action: string;
  entityType: string;
  description: string | null;
  createdAt: Date;
  source: 'staff' | 'bridge';   // NEW — additive, truthful actor category
}
```

No frontend consumer of `activityHistory` exists (confirmed by grep across `src/`) — this is a
downloaded JSON/ZIP payload only, so the additive field carries zero UI regression risk.

## 8. Before/after example

**Before** (bridge-linked study, `imagingRequestId` resolved a patient — event invisible):

```json
{ "activityHistory": [] }
```

**After** (same scenario):

```json
{
  "activityHistory": [
    {
      "id": "5c2e...-auditlog-id",
      "action": "imaging_bridge_study_ingested",
      "entityType": "imaging_study",
      "description": "Görüntüleme çalışması köprü (cihaz) üzerinden içe aktarıldı (PX)",
      "createdAt": "2026-08-09T10:00:00.000Z",
      "source": "bridge"
    }
  ]
}
```

A patient with both a manual upload and a bridge ingest now sees both, distinctly labeled:

```json
{
  "activityHistory": [
    { "id": "...", "action": "create", "entityType": "imaging_study", "description": "Görüntüleme çalışması yüklendi (manual)", "createdAt": "...", "source": "staff" },
    { "id": "...", "action": "imaging_bridge_study_ingested", "entityType": "imaging_study", "description": "Görüntüleme çalışması köprü (cihaz) üzerinden içe aktarıldı (PX)", "createdAt": "...", "source": "bridge" }
  ]
}
```

## 9. Files changed

| File | Change |
|---|---|
| `server/src/services/privacy/patientActivityHistoryExport.ts` | Export projection: `collectBridgeImagingActivityForPatient`, `mergePatientActivityHistory`. **R1:** added the `MAX_PATIENT_ACTIVITY_HISTORY_ROWS` constant and a final `.slice(0, 500)` global cap + deterministic tie-break (`createdAt` DESC, source rank, `id` lexical) in `mergePatientActivityHistory` — see §15. |
| `server/src/routes/patientPrivacy.ts` | `collectStructuredExportData` now also fetches bridge imaging activity (parallel query) and merges it into `activityHistory`. Used by both `/export` and `/export-package` routes. **R1:** the `activityLog` query's `take: 500` now references the same `MAX_PATIENT_ACTIVITY_HISTORY_ROWS` constant instead of an independent magic number. |
| `server/src/tests/dbVerification/imagingBridgeKvkkExportCompleteness.test.ts` | Disposable-Postgres test suite. **R1:** added 19 new assertions (11 pure-unit cap/ordering tests + 8 real-DB cap-triggering end-to-end tests), 30 total. |
| `server/package.json` | Registered `test:imaging-bridge-kvkk-export-completeness`; appended to the `server:test:disposable-db` aggregate (runs under `npm run test:runtime:postgres`). Unchanged in R1. |

No `ActivityLog`/`AuditLog` schema change. No migration. No bridge ingest route change. No new
audit-write contract — this reads an already-written `AuditLog` field.

## 10. Test results

**R1 revision** (current — see §15 for the R1 finding/fix):

| Suite | Result |
|---|---|
| `cd server && npm run typecheck` | Pass (0 errors) |
| `cd server && npm run test:kvkk-lifecycle` | 110 passed, 0 failed |
| `cd server && npm run test:patient-privacy` | 38 passed, 0 failed |
| `cd server && npm run test:patient-medical-history` | 28 passed, 0 failed |
| `cd server && npm run test:imaging-bridge-kvkk-export-completeness` | **30 passed, 0 failed** (11 original scenarios, 19 new R1 cap/ordering assertions — run standalone against a disposable Postgres container) |
| `npm run guardrail:test` (repo root) | 74 passed, 0 failed |
| `npm run guardrail:scan` (repo root) | exit 0 (report-only; no new findings gate this task — advisory signal per the tool's own disclaimer) |
| `npm run test:runtime:postgres -- --summary-file=postgres-run-summary.json` (repo root; full `server:test:disposable-db` aggregate, ~20 suites, independently-provisioned disposable Postgres) | `migration.code: 0`, `test.code: 0`, `cleanup.success: true`, `outcome.exitCode: 0`, reasons `["tests passed", "cleanup succeeded"]` |
| `git diff --check` | clean (only CRLF-normalization notices, no trailing-whitespace/conflict-marker findings) |

Note: `guardrail:test`/`guardrail:scan` are repo-root scripts (`package.json`, not
`server/package.json`) — run from the repo root, not `cd server`.

**Pre-R1 baseline** (superseded, kept for history): `imagingBridgeKvkkExportCompleteness.test.ts`
16 passed, 0 failed, covering the original 10 required scenarios.

## 11. Migration status

**None.** No Prisma schema change, no migration file. Confirmed by `git status` outside
`server/prisma/`.

## 12. Security / KVKK impact

- **Completeness (fixed):** a patient's KVKK data-subject export now includes bridge-linked
  imaging ingest events that were previously silently omitted.
- **Tenant isolation:** every new query is `organizationId`+`clinicId` scoped; adversarial tests
  (3b/4b) prove these predicates are load-bearing, not incidental.
- **No new leakage surface:** allowlisted fields only — no storageKey, filesystem path, token, or
  raw DICOM metadata is ever read out of `AuditLog.metadata` into the export (test 9, with a
  poisoned-metadata fixture).
- **No actor fabrication:** bridge entries are labeled `source: 'bridge'` — no `userId`/`user`
  field is ever attached, consistent with F2-IMG-AUDIT-002's decision to never borrow/fabricate a
  `User` identity for a machine actor (test 8).
- **No regression:** existing manual staff `ActivityLog` entries remain present and unchanged
  (test 5); the export shape is backward compatible when a patient has zero bridge imaging
  (test 10).

## 13. Rollback

Revert the four changed/added files listed in §9. No data migration, no schema change, no
backfill — a revert is a pure code rollback. The bridge route's own audit-write behavior is
untouched throughout, so rollback has zero effect on `AuditLog` write-side behavior.

## 14. PR / head / CI

PR opened, not merged (per task instructions). See PR description for head SHA and CI status —
this evidence document intentionally does not embed a PR number/URL to avoid staleness; refer to
the open PR against `feature/f2-img-audit-003-kvkk-export-completeness`.

## 15. R1 — global 500-row cardinality cap (blocking review finding)

**Task:** F2-IMG-AUDIT-003-R1 (ClickUp `869efwdtd`). Same PR (#349), same branch — no new PR.

### 15.1 Baseline reconciliation

Main had advanced since this branch was created (PR #346 CI portability, PR #347 F2-GAPA-001).
Neither PR touched `patientPrivacy.ts`, `patientActivityHistoryExport.ts`, or this test file (both
touched `orphanFileInspection.ts` / imaging-lifecycle-migration test files only — confirmed via
`git log --oneline <branch-point>..origin/main -- <these paths>`, zero hits before the merge).

```
git fetch origin main
git rev-parse origin/main   # a10ac98cf3b209b5e14cddf9ab1c997dbc44cf15
git merge origin/main --no-edit
```

Result: **clean merge, zero conflicts** (merge commit `a6f0bf7`). No duplicate fix existed on main
for this finding — reconciliation did not reveal prior art to defer to.

### 15.2 The finding

`mergePatientActivityHistory` fetched up to 500 staff `ActivityLog` rows (`patientPrivacy.ts`'s
existing `take: 500`) and up to 500 bridge `AuditLog` rows
(`MAX_BRIDGE_IMAGING_AUDIT_ROWS`, also 500), then merged and sorted with **no final cap**. Before
F2-IMG-AUDIT-003, `ActivityLog`'s own `take: 500` was the export's only source, so it was also the
de facto global cap. Adding a second independently-capped source without a final combined cap could
export up to 1000 `activityHistory` rows for one patient — an unintended
backward-compatibility/cardinality regression.

### 15.3 The fix

`server/src/services/privacy/patientActivityHistoryExport.ts`:

- Added `export const MAX_PATIENT_ACTIVITY_HISTORY_ROWS = 500` — the single named constant for this
  cardinality contract. `MAX_BRIDGE_IMAGING_AUDIT_ROWS` (bridge fetch cap) now derives from it, and
  `patientPrivacy.ts`'s `activityLog.findMany({ take: ... })` now references it directly, replacing
  the previous independent magic `500`.
- `mergePatientActivityHistory` now sorts by `createdAt` DESC with a deterministic secondary
  tie-break — source rank (`staff` before `bridge`, an arbitrary but stable rank), then `id`
  lexical — and applies a final `.slice(0, MAX_PATIENT_ACTIVITY_HISTORY_ROWS)`. The tie-break is a
  pure function of row content, never `Map` insertion order.
- Dedupe identity is **unchanged**: `${source}:${id}` — per the task's explicit instruction not to
  switch to `entityId + action` (two genuinely distinct bridge ingest attempts for one study must
  never collapse).

### 15.4 Tests added (19 new assertions, 30 total in the suite)

All in `imagingBridgeKvkkExportCompleteness.test.ts`, sections 11–21 (see the file's header comment
for the full mapping to the task's 11 required scenarios):

- **11–18** (pure, DB-free unit tests directly against `mergePatientActivityHistory` with synthetic
  rows — the cap/tie-break logic is a pure function, so this is both the most precise and by far the
  fastest way to prove it): staff-only 600→500, bridge-only 600→500, mixed 600→500 with the newest
  500 across both sources winning, older-staff-displaced-by-newer-bridge and the symmetric case,
  deterministic equal-`createdAt` ordering independent of input array order, and two legitimate
  same-action bridge rows surviving a boundary-triggering 501-candidate merge.
- **19–21** (real disposable-Postgres, cap-triggering end-to-end): a single patient with 260 real
  `ActivityLog` rows + 260 real bridge `AuditLog` rows (520 candidates, interleaved timestamps, one
  row poisoned with storageKey/path/token/raw-metadata) run through the actual `/export` route
  handler — proves the fetch-level `take: 500` per source AND the merge-level final cap work
  together in the true code path (exactly 500 returned, newest 250 of each source survive, oldest 10
  of each displaced), that sibling-clinic/cross-org bridge rows present in the same run still never
  leak in, that the poisoned row's metadata still never leaks, and that the staff-only entry shape
  stays backward compatible once the cap is engaged.

No assertion in the original 10-scenario suite was weakened or removed.

### 15.5 Validation

See §10 (updated in place for this revision) — all listed suites pass, full disposable-Postgres
orchestrator run (independently-provisioned container, 73 migrations applied cleanly) exits 0 with
`server:test:disposable-db` (includes this suite) passing.

### 15.6 Security / KVKK impact (R1-specific)

- No schema change, no migration (confirmed: `git status` outside `server/prisma/migrations/`).
- No `ActivityLog`/`AuditLog` actor-model change.
- No bridge write-side change (`imagingBridgePublic.ts` untouched).
- No cross-clinic/cross-org exposure change — predicates untouched; §15.4's item 19 re-proves
  isolation holds under a cap-triggering (>500) dataset, not just the small fixtures used elsewhere
  in this suite.
- No storage/path/token/raw-metadata leakage change — §15.4's item 20 re-proves this under the
  capped/sorted output.
- No arbitrary metadata export, no fake/borrowed user identity — both unchanged from §12.
- Net effect is **strictly more conservative** than the pre-R1 code on this branch (caps a
  previously-uncapped path back down to the historical 500-row contract); it cannot itself introduce
  a new completeness gap versus the pre-F2-IMG-AUDIT-003 baseline, since that baseline was also
  capped at 500.

### 15.7 Rollback

Revert the two edited files (`patientActivityHistoryExport.ts`, `patientPrivacy.ts`) and the test
file to their pre-R1 (`e42f543`) state. No data migration, no schema change — pure code rollback,
same as §13.

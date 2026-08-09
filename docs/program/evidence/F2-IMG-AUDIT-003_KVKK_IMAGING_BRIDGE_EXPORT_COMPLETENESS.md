# F2-IMG-AUDIT-003 — KVKK Per-Patient Export Completeness for Bridge-Linked Imaging

**Phase:** F2 — Modular Boundaries and Public Contracts (Stage 3 implementation)
**Task ID:** F2-IMG-AUDIT-003
**Mode:** CHARACTERIZE + IMPLEMENT (single PR, per fast-program-mode instructions)
**Branch:** `feature/f2-img-audit-003-kvkk-export-completeness`
**Baseline:** `origin/main` @ `bb50212` (merge of PR #345)
**Prior decision (unchanged):** F2-IMG-AUDIT-002 = `NO_ACTION_REQUIRED` — machine bridge ingest
events remain in `AuditLog` only; no fake/borrowed `User` was written to `ActivityLog`.

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
  take: 500,   // same cap as the existing activityLogs query
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
| `server/src/services/privacy/patientActivityHistoryExport.ts` | **New.** Export projection: `collectBridgeImagingActivityForPatient`, `mergePatientActivityHistory`. |
| `server/src/routes/patientPrivacy.ts` | `collectStructuredExportData` now also fetches bridge imaging activity (parallel query) and merges it into `activityHistory`. Used by both `/export` and `/export-package` routes. |
| `server/src/tests/dbVerification/imagingBridgeKvkkExportCompleteness.test.ts` | **New.** Disposable-Postgres test suite, 16 assertions across the 10 required scenarios. |
| `server/package.json` | Registered `test:imaging-bridge-kvkk-export-completeness`; appended to the `server:test:disposable-db` aggregate (runs under `npm run test:runtime:postgres`). |

No `ActivityLog`/`AuditLog` schema change. No migration. No bridge ingest route change. No new
audit-write contract — this reads an already-written `AuditLog` field.

## 10. Test results

| Suite | Result |
|---|---|
| `cd server && npm run typecheck` | Pass (0 errors) |
| `cd server && npm run test:kvkk-lifecycle` | 110 passed, 0 failed |
| `cd server && npm run test:patient-privacy` | 38 passed, 0 failed |
| `cd server && npm run test:patient-medical-history` | 28 passed, 0 failed |
| `cd server && npx tsx src/tests/patientEmergencyContacts.test.ts` | 31 passed, 0 failed |
| **New:** `imagingBridgeKvkkExportCompleteness.test.ts` (within `npm run test:runtime:postgres`) | **16 passed, 0 failed**, covering all 10 required scenarios (1–10; scenario 5 and 8 additionally verified end-to-end via the real `/export` route handler) |
| `npm run test:runtime:postgres -- --summary-file=postgres-run-summary.json` (full disposable-db aggregate, ~20 suites) | `exitCode: 0`, `"tests passed"`, `"cleanup succeeded"` |
| `npm run guardrail:test` | 74 passed, 0 failed |
| `npm run guardrail:scan` | exit 0 (report-only; no new findings gate this task — advisory signal per the tool's own disclaimer) |
| `git diff --check` | clean, no output |

Full disposable-Postgres run log confirms suite ordering and isolation: the new suite's 16
assertions run immediately after `Privacy-Imaging-Lifecycle-Port-Migration` (18 passed) and before
`whatsappPublicApiExplicitClinicBinding` (29 passed) in the `server:test:disposable-db` chain,
with the orchestrator's final `cleanup.success: true` and `outcome.exitCode: 0`.

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
